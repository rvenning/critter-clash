// One brain, both sides. The bugs use it to play their turn; tests/bot.test.js
// points the same code at the player's team to check every level is winnable
// and that a team that does nothing loses.
//
// For each unit: enumerate every tile it can finish on, score the best action
// available from that tile, add a positional score, take the max. Ties break
// on (row, col) so a run is reproducible.
//
// Behaviours only change the WEIGHTS, not the algorithm:
//   charge   closing distance matters, being hit back doesn't
//   weakest  hunt the lowest-health target wherever it is
//   kite     sit at maximum range and treat adjacency as poison

// `byPath` decides which yardstick the approach term uses. Anything that wants
// to close the distance must measure the walk AROUND the pond, not the straight
// line across it — greedy Manhattan parks a walker on the shore forever, which
// is exactly how Level 3 first came out unwinnable. Kiters keep Manhattan,
// because shots ignore terrain and standing across water is good play.
const BEHAVIOUR = {
  charge:  { approach: 2.0, risk: 0.30, cover: 0.6, prefRange: 1, byPath: true },
  weakest: { approach: 2.0, risk: 0.20, cover: 0.4, prefRange: 1, byPath: true, huntWeak: true },
  kite:    { approach: 0.9, risk: 1.30, cover: 2.0, prefRange: null, byPath: false }, // prefRange = own range
  // Not used by any bug — it's how the test bot plays "hold out" levels, and
  // how a future hint button would suggest a defensive move. Pure fleeing
  // (a negative approach term) is worse than useless: it never thins the
  // swarm, so the damage keeps climbing. Holding at arm's length and killing
  // whatever wanders in is what a careful player actually does.
  turtle:  { approach: 0.9, risk: 1.20, cover: 2.5, prefRange: null, byPath: true },
};

const AI = {
  // The full plan for one unit: where to stand and what to do there.
  plan(g, u, opts) {
    opts = opts || {};
    const w = opts.behaviour || BEHAVIOUR[u.def.ai] || BEHAVIOUR.charge;
    const foes = g.units.filter(o => o.alive && o.side !== u.side);
    if (!foes.length && !opts.goals) return null;

    const home = { r: u.r, c: u.c };
    let best = null;

    // Walking distance to whatever this unit is chasing, measured once for the
    // whole board and then read off per candidate tile.
    const chase = this.chaseTargets(u, foes, w);
    const field = w.byPath && chase.length ? this.terrainField(g, u, chase.map(o => [o.r, o.c])) : null;
    const goalField = opts.goals && opts.goals.length ? this.terrainField(g, u, opts.goals) : null;

    for (const k of Rules.reachable(g, u).keys()) {
      const [r, c] = k.split(",").map(Number);
      u.r = r; u.c = c;                          // pretend to stand here
      const act = this.bestAction(g, u, w);
      const pos = this.positionScore(g, u, w, foes, opts, field, goalField);
      const steps = Math.abs(r - home.r) + Math.abs(c - home.c);
      const score = (act ? act.score : 0) + pos - steps * 0.01;
      if (!best || score > best.score + 1e-9) best = { score, r, c, act };
      u.r = home.r; u.c = home.c;
    }

    u.r = home.r; u.c = home.c;
    return best;
  },

  // Best thing this unit could do from wherever it currently stands.
  bestAction(g, u, w) {
    let best = null;
    const consider = (cand) => { if (!best || cand.score > best.score) best = cand; };

    // Boss sweep: one swing at everyone adjacent.
    if (u.def.sweep) {
      const hits = g.units.filter(o => o.alive && o.side !== u.side && Rules.dist(u, o) === 1);
      if (hits.length) {
        let s = 0;
        for (const o of hits) s += this.hitValue(g, u, o, Rules.damageOf(g, u, o), w);
        consider({ type: "sweep", score: s * 1.05 });     // slight nudge to prefer the crowd
      }
    }

    for (const o of Rules.targetsFor(g, u)) {
      const dmg = Rules.damageOf(g, u, o);
      consider({ type: "attack", target: o, score: this.hitValue(g, u, o, dmg, w) });
    }

    const p = u.def.power;
    if (p && u.cd === 0) {
      for (const o of Rules.powerTargets(g, u)) {
        let s;
        if (p.kind === "heal") {
          s = Math.min(p.heal, o.maxHp - o.hp) * 1.6 + (o.hp <= o.maxHp * 0.35 ? 6 : 0);
        } else if (p.kind === "blast") {
          // Hits everything adjacent, so value the whole ring, not one bug.
          s = g.units.filter(x => x.alive && x.side !== u.side && Rules.dist(u, x) === 1)
            .reduce((t, x) => t + this.hitValue(g, u, x, Rules.damageOf(g, u, x, p.dmg), w), 0);
        } else if (p.kind === "charge") {
          s = this.chargeValue(g, u, o, p, w);
        } else {
          s = this.hitValue(g, u, o, Rules.powerDamage(p), w);
          if (p.kind === "push" && this.pushIsFatal(g, u, o, p.push)) s += 14;
          if (p.kind === "pull" && this.pullIsFatal(g, u, o)) s += 14;
        }
        if (s > 0) consider({ type: "power", target: o, score: s + 0.5 });   // powers are free value
      }
    }
    return best;
  },

  hitValue(g, u, target, dmg, w) {
    const dealt = Math.min(dmg, target.hp);
    let s = dealt * 2;
    if (dmg >= target.hp) s += 10;                                   // finish it
    if (w.huntWeak) s += (10 - target.hp) * 0.4;
    if (target.def.boss) s += 1;
    return s;
  },

  // A roll damages everything in a straight line — worth the whole line.
  chargeValue(g, u, target, p, w) {
    const sr = Math.sign(target.r - u.r), sc = Math.sign(target.c - u.c);
    let s = 0;
    for (let i = 1; i <= p.range; i++) {
      const r = u.r + sr * i, c = u.c + sc * i, t = Rules.tile(g, r, c);
      if (!t || t.solid) break;
      const o = Rules.unitAt(g, r, c);
      if (o && o.side !== u.side) s += this.hitValue(g, u, o, Rules.powerDamage(p), w);
      else if (o) break;
    }
    return s;
  },

  // Would a shove put them in the pond? This is the signature move of the
  // game, so both the bugs and the test bot need to see it coming.
  pushIsFatal(g, u, target, dist) {
    if (target.def.flier || target.def.heavy) return false;
    const dr = target.r - u.r, dc = target.c - u.c;
    let sr = 0, sc = 0;
    if (Math.abs(dr) >= Math.abs(dc)) sr = Math.sign(dr) || -1; else sc = Math.sign(dc);
    let r = target.r, c = target.c;
    for (let i = 0; i < dist; i++) {
      const nr = r + sr, nc = c + sc, t = Rules.tile(g, nr, nc);
      if (!t || t.solid || Rules.unitAt(g, nr, nc)) return false;
      r = nr; c = nc;
      if (t.water) return true;
    }
    return false;
  },

  pullIsFatal(g, u, target) {
    if (target.def.flier || target.def.heavy) return false;
    const dr = Math.sign(u.r - target.r), dc = Math.sign(u.c - target.c);
    const [sr, sc] = Math.abs(u.r - target.r) >= Math.abs(u.c - target.c) ? [dr, 0] : [0, dc];
    const t = Rules.tile(g, target.r + sr, target.c + sc);
    return !!(t && t.water && !Rules.unitAt(g, target.r + sr, target.c + sc));
  },

  // Which enemies is this unit actually interested in?
  chaseTargets(u, foes, w) {
    if (!foes.length) return [];
    if (!w.huntWeak) return foes;
    const min = Math.min(...foes.map(o => o.hp));
    return foes.filter(o => o.hp <= min + 2);
  },

  // Breadth-first walking distance from a set of tiles, over terrain THIS unit
  // can cross. Unit occupancy is ignored: bodies move, terrain doesn't.
  terrainField(g, u, sources) {
    const open = (r, c) => {
      const t = Rules.tile(g, r, c);
      if (!t || t.solid) return u.def.flier || u.def.leaper ? !!t : false;
      return !(t.water && !(u.def.flier || u.def.leaper));
    };
    const d = new Map();
    let frontier = [];
    for (const [r, c] of sources) { d.set(key(r, c), 0); frontier.push([r, c]); }
    let step = 0;
    while (frontier.length && step < 64) {
      step++;
      const next = [];
      for (const [r, c] of frontier) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc, k = key(nr, nc);
          if (d.has(k) || !open(nr, nc)) continue;
          d.set(k, step);
          next.push([nr, nc]);
        }
      }
      frontier = next;
    }
    return d;
  },

  // How good is this square to be standing on when the turn ends?
  positionScore(g, u, w, foes, opts, field, goalField) {
    let s = 0;
    const tile = Rules.tile(g, u.r, u.c);
    // A bush is worth a lot to something that shoots and hides, and almost
    // nothing to something whose job is to walk up and hit you — weighting
    // cover flat made the tank sit in a bush all match instead of engaging.
    if (tile.cover) s += tile.cover * (w.cover != null ? w.cover : 1);
    if (tile.hazard) s -= 5;

    // Distance to whoever we care about — walked, not flown, unless this unit
    // shoots (in which case the straight line is what counts).
    if (foes.length) {
      let bestD = Infinity;
      for (const o of this.chaseTargets(u, foes, w)) {
        const d = field
          ? (field.has(key(u.r, u.c)) ? field.get(key(u.r, u.c)) : Rules.dist(u, o) * 1.5)
          : Rules.dist(u, o);
        if (d < bestD) bestD = d;
      }
      const want = w.prefRange === null ? (u.def.range || 1) : w.prefRange;
      s -= Math.abs(bestD - want) * w.approach;
    }

    // Objective pull, for the campaign bot: berries and exits are the point.
    if (opts.goals && opts.goals.length) {
      const k = key(u.r, u.c);
      const d = goalField && goalField.has(k)
        ? goalField.get(k)
        : Math.min(...opts.goals.map(([gr, gc]) => Math.abs(u.r - gr) + Math.abs(u.c - gc))) * 1.5;
      s -= d * (opts.goalWeight || 1.2);
    }

    // How much incoming damage does this square invite next turn? Measured
    // against what's left of this unit — 4 damage is a scratch on Digger and
    // half of Zip — so wounded critters start looking for safer ground.
    let risk = 0;
    for (const o of foes) {
      const reach = Rules.moveBudget(o) + (o.def.range || 1);
      if (Rules.dist(u, o) <= reach) risk += o.def.atk;
    }
    s -= (risk / Math.max(3, u.hp)) * 12 * w.risk;
    return s;
  },

  // Carry out a plan. Split from plan() so the UI can animate between the two.
  execute(g, u, plan) {
    if (!plan) { u.moved = u.acted = true; return; }
    if (plan.r !== u.r || plan.c !== u.c) Rules.moveTo(g, u, plan.r, plan.c);
    if (!u.alive) return;                                  // walked into the pond
    const act = plan.act;
    if (!act) { u.moved = u.acted = true; return; }
    if (act.type === "sweep") Rules.sweep(g, u);
    else if (act.type === "attack" && act.target.alive) Rules.attack(g, u, act.target);
    else if (act.type === "power" && act.target.alive) Rules.usePower(g, u, act.target);
    u.moved = u.acted = true;
  },
};
