// Combat and movement maths. Every function here is pure-ish: it takes the
// game state `g` and mutates only that, never the DOM, canvas or audio — so
// tests/bot.test.js can play thousands of turns headlessly.
//
// The grid is 4-way. Distance is Manhattan, so "range 1" means orthogonally
// adjacent and a range-3 shot covers a diamond. Ranged attacks deliberately
// IGNORE terrain — "can it hit me?" must be answerable by an 8-year-old at a
// glance, and a line-of-sight rule makes that a geometry problem instead.

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const key = (r, c) => r + "," + c;

const Rules = {
  /* ---------------- board queries ---------------- */
  tile(g, r, c) {
    if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return null;
    return TILES[g.board[r][c]] || TILES["."];
  },

  setTile(g, r, c, ch) {
    const row = g.board[r];
    g.board[r] = row.slice(0, c) + ch + row.slice(c + 1);
  },

  unitAt(g, r, c) {
    return g.units.find(u => u.alive && u.r === r && u.c === c) || null;
  },

  dist(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c); },

  /* ---------------- movement ---------------- */
  // Webs cut movement in half (rounded up) for one turn.
  moveBudget(u) {
    return u.webbed ? Math.max(1, Math.ceil(u.move / 2)) : u.move;
  },

  // May this unit travel THROUGH the tile? Leapers and fliers go over
  // anything; walkers need open dry ground with no enemy standing on it.
  canPass(g, u, r, c) {
    const t = this.tile(g, r, c);
    if (!t) return false;
    if (u.def.flier || u.def.leaper) return true;
    if (t.solid || t.water) return false;
    const o = this.unitAt(g, r, c);
    return !o || o.side === u.side;      // squeeze past friends, not enemies
  },

  // May this unit STOP on the tile? Only fliers can perch on water.
  canEnd(g, u, r, c) {
    const t = this.tile(g, r, c);
    if (!t || t.solid) return false;
    if (t.water && !u.def.flier) return false;
    return !this.unitAt(g, r, c);
  },

  // BFS out to the move budget. Returns Map "r,c" -> steps for every tile the
  // unit could finish its move on (always includes where it already stands).
  reachable(g, u) {
    const budget = this.moveBudget(u);
    const seen = new Map([[key(u.r, u.c), 0]]);
    const out = new Map([[key(u.r, u.c), 0]]);
    let frontier = [[u.r, u.c, 0]];
    while (frontier.length) {
      const next = [];
      for (const [r, c, d] of frontier) {
        if (d >= budget) continue;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc, k = key(nr, nc);
          if (seen.has(k)) continue;
          if (!this.canPass(g, u, nr, nc)) continue;
          seen.set(k, d + 1);
          next.push([nr, nc, d + 1]);
          if (this.canEnd(g, u, nr, nc)) out.set(k, d + 1);
        }
      }
      frontier = next;
    }
    return out;
  },

  // Shortest walk between two tiles for this unit, as a list of cells
  // (excluding the start). Null when there's no route.
  path(g, u, tr, tc) {
    const from = new Map([[key(u.r, u.c), null]]);
    let frontier = [[u.r, u.c]];
    const budget = this.moveBudget(u);
    for (let d = 0; d < budget && frontier.length; d++) {
      const next = [];
      for (const [r, c] of frontier) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc, k = key(nr, nc);
          if (from.has(k) || !this.canPass(g, u, nr, nc)) continue;
          from.set(k, [r, c]);
          next.push([nr, nc]);
        }
      }
      frontier = next;
    }
    if (!from.has(key(tr, tc))) return null;
    const out = [];
    let cur = [tr, tc];
    while (cur) {
      out.unshift(cur);
      cur = from.get(key(cur[0], cur[1]));
    }
    out.shift();
    return out;
  },

  // Walk a unit to a tile. Berries are picked up on arrival, thorns bite.
  moveTo(g, u, r, c) {
    const p = this.path(g, u, r, c);
    u.prev = { r: u.r, c: u.c };          // for the undo button
    const from = { r: u.r, c: u.c };
    u.r = r; u.c = c; u.moved = true;
    g.emit({ type: "move", u, path: p || [[r, c]] });
    const last = p && p.length > 1 ? p[p.length - 2] : [from.r, from.c];
    const dir = [Math.sign(r - last[0]), Math.sign(c - last[1])];
    // Rain makes the grass slippery: a long dash carries you one square past
    // where you meant to stop. Never into the pond — weather shouldn't drown
    // anyone — but quite capable of parking you next to a scorpion.
    if (g.level && g.level.weather === "rain" && p && p.length >= 2) {
      const nr = r + dir[0], nc = c + dir[1], t = this.tile(g, nr, nc);
      if (t && !t.solid && !t.water && !this.unitAt(g, nr, nc)) {
        u.r = nr; u.c = nc;
        g.emit({ type: "slide", u });
      }
    }
    this.landOn(g, u, dir);
    return true;
  },

  // Everything that happens when a unit arrives on a tile, however it got
  // there (walked, pushed, leapt, bounced). Water is the big one: anything
  // that can't fly is washed out of the fight. `dir` is how it was travelling,
  // which the bouncy mushroom needs to know where to fling it next.
  landOn(g, u, dir, chain) {
    const t = this.tile(g, u.r, u.c);
    if (!t) return;
    if (t.water && !u.def.flier) {
      g.emit({ type: "splash", u });
      this.knockOut(g, u, "splash");
      return;
    }
    if (t.goal && u.side === "p") {
      this.setTile(g, u.r, u.c, ".");
      g.berries++;
      g.emit({ type: "berry", u });
    }
    if (t.pickup && u.side === "p") this.takePickup(g, u, t);
    if (t.sticky) { u.webbed = 2; g.emit({ type: "stuck", u }); }
    if (t.hazard) this.damage(g, u, t.hazard, null, "thorn");
    // Boing. Capped so two mushrooms facing each other can't ping-pong.
    if (t.bounce && dir && u.alive && (chain || 0) < 2) this.bounce(g, u, dir, t.bounce, chain || 0);
  },

  bounce(g, u, dir, dist, chain) {
    const [sr, sc] = dir;
    if (!sr && !sc) return;
    let moved = 0;
    for (let i = 0; i < dist; i++) {
      const nr = u.r + sr, nc = u.c + sc, t = this.tile(g, nr, nc);
      if (!t || t.solid || this.unitAt(g, nr, nc)) break;
      u.r = nr; u.c = nc; moved++;
      if (t.water && !u.def.flier) break;
    }
    if (!moved) return;
    g.emit({ type: "bounce", u });
    this.landOn(g, u, dir, chain + 1);
  },

  takePickup(g, u, t) {
    if (t.pickup === "heal") this.heal(g, u, t.amount);
    else if (t.pickup === "ready") u.cd = 0;
    else if (t.pickup === "lucky") {
      for (const f of g.units.filter(f => f.alive && f.side === u.side)) {
        f.maxHp += t.amount;
        f.hp += t.amount;
      }
    }
    this.setTile(g, u.r, u.c, ".");
    g.emit({ type: "pickup", u, kind: t.pickup });
  },

  // Smashing a beehive stings everything standing next to it. Used by Digger's
  // Quake and by anything shoved into one.
  burstHive(g, r, c) {
    const t = this.tile(g, r, c);
    if (!t || !t.hive) return false;
    this.setTile(g, r, c, ".");
    g.emit({ type: "hive", r, c });
    for (const [dr, dc] of DIRS) {
      const o = this.unitAt(g, r + dr, c + dc);
      if (o) this.damage(g, o, t.hive, null, "bees");
    }
    return true;
  },

  /* ---------------- attacking ---------------- */
  armourOf(g, u) {
    const t = this.tile(g, u.r, u.c);
    return u.armour + ((t && t.cover) || 0);
  },

  damageOf(g, atk, def, base) {
    let raw = base != null ? base : atk.atk;
    // "Brave Heart": a wounded critter swings harder.
    if (base == null && atk.brave && atk.hp <= atk.maxHp / 2) raw += 1;
    return Math.max(1, raw - this.armourOf(g, def));   // never zero: no stalemates
  },

  // Special moves land in full — armour and cover don't stop them. It gives
  // every power a reason to exist against snails and bosses, and it's a rule a
  // child can hold onto: "your special always hurts".
  powerDamage(p) { return Math.max(1, p.dmg || 1); },

  targetsFor(g, u) {
    const range = u.range;
    return g.units.filter(o => o.alive && o.side !== u.side && this.dist(u, o) <= range);
  },

  // A plain attack: damage, then any on-hit extras (webs, knockback, spikes).
  attack(g, u, target) {
    g.emit({ type: "attack", u, target });
    const dmg = this.damageOf(g, u, target);
    this.damage(g, target, dmg, u, "hit");
    if (u.def.web && target.alive) {
      target.webbed = 2;                       // this turn + their next one
      g.emit({ type: "web", u: target });
    }
    if (u.def.push && target.alive) this.push(g, target, u, u.def.push);
    // Prickle's spikes: melee attackers hurt themselves.
    if (target.alive && target.def.thorns && this.dist(u, target) <= 1) {
      this.damage(g, u, target.def.thorns, target, "spikes");
    }
    u.acted = true; u.moved = true;
  },

  // Boss tail sweep: everything standing next to it, at once.
  sweep(g, u) {
    g.emit({ type: "sweep", u });
    for (const o of g.units.filter(o => o.alive && o.side !== u.side && this.dist(u, o) === 1)) {
      this.damage(g, o, this.damageOf(g, u, o), u, "hit");
      if (o.alive && o.def.thorns) this.damage(g, u, o.def.thorns, o, "spikes");
    }
    u.acted = true; u.moved = true;
  },

  damage(g, u, amount, src, cause) {
    if (!u.alive) return;
    u.hp -= amount;
    g.emit({ type: "damage", u, amount, cause });
    if (u.hp <= 0) this.knockOut(g, u, cause);
  },

  heal(g, u, amount) {
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    g.emit({ type: "heal", u, amount: u.hp - before });
  },

  knockOut(g, u, cause) {
    u.alive = false;
    u.hp = 0;
    g.emit({ type: "ko", u, cause });
  },

  // Where would a shove send them, and what would happen? Pure — no state is
  // touched — so the renderer can draw the outcome on the board BEFORE the
  // player commits, and the AI can ask the same question when planning.
  pushPreview(g, from, target, dist) {
    const out = { tiles: [], r: target.r, c: target.c, moved: 0, blocked: false, fatal: false, immune: false };
    if (target.def.heavy) { out.immune = true; return out; }
    const dr = target.r - from.r, dc = target.c - from.c;
    let sr = 0, sc = 0;
    if (Math.abs(dr) >= Math.abs(dc)) sr = Math.sign(dr) || (target.r <= from.r ? -1 : 1);
    else sc = Math.sign(dc);
    if (!sr && !sc) sr = -1;
    out.dir = [sr, sc];
    for (let i = 0; i < dist; i++) {
      const nr = out.r + sr, nc = out.c + sc, t = this.tile(g, nr, nc);
      if (!t || t.solid || this.unitAt(g, nr, nc)) { out.blocked = true; out.into = t && t.hive ? [nr, nc] : null; break; }
      out.r = nr; out.c = nc; out.moved++;
      out.tiles.push([nr, nc]);
      if (t.water && !target.def.flier) { out.fatal = true; break; }
    }
    return out;
  },

  // Same question for a yank: one tile along the dominant axis, toward `to`.
  pullPreview(g, to, target) {
    const out = { tiles: [], r: target.r, c: target.c, moved: 0, fatal: false, immune: !!target.def.heavy };
    if (out.immune) return out;
    const dr = Math.sign(to.r - target.r), dc = Math.sign(to.c - target.c);
    const [sr, sc] = Math.abs(to.r - target.r) >= Math.abs(to.c - target.c) ? [dr, 0] : [0, dc];
    const nr = target.r + sr, nc = target.c + sc, t = this.tile(g, nr, nc);
    if (!t || t.solid || this.unitAt(g, nr, nc)) return out;
    out.r = nr; out.c = nc; out.moved = 1; out.tiles.push([nr, nc]);
    out.fatal = !!(t.water && !target.def.flier);
    return out;
  },

  // Shove a unit directly away from `from`. Hitting a wall, a rock or another
  // unit stops it short for 1 bump damage; landing in the pond takes it out of
  // the fight entirely.
  push(g, u, from, dist) {
    const pv = this.pushPreview(g, from, u, dist);
    if (pv.immune) { g.emit({ type: "resist", u }); return; }
    if (pv.blocked) {
      this.damage(g, u, 1, from, "bump");                 // thumped into something solid
      if (pv.into) this.burstHive(g, pv.into[0], pv.into[1]);
    }
    if (pv.moved && u.alive) {
      u.r = pv.r; u.c = pv.c;
      g.emit({ type: "shove", u });
      this.landOn(g, u, pv.dir);
    }
  },

  /* ---------------- special powers ---------------- */
  // Which tiles/units a power can be aimed at, given where the unit stands.
  powerTargets(g, u) {
    const p = u.def.power;
    if (!p || u.cd > 0) return [];
    const enemies = g.units.filter(o => o.alive && o.side !== u.side);
    const friends = g.units.filter(o => o.alive && o.side === u.side && o !== u);
    switch (p.kind) {
      case "pull":
        // Needs somewhere to yank them FROM, so never point-blank.
        return enemies.filter(o => this.dist(u, o) > 1 && this.dist(u, o) <= u.powerRange);
      case "push":
        return enemies.filter(o => this.dist(u, o) <= u.powerRange);
      case "blast":
        return enemies.filter(o => this.dist(u, o) === 1);
      case "heal":
        return friends.filter(o => this.dist(u, o) <= u.powerRange && o.hp < o.maxHp);
      case "charge":
        // Straight lines only — the roll has to be readable before you commit.
        return enemies.filter(o => (o.r === u.r || o.c === u.c) && this.dist(u, o) <= u.powerRange);
      default:
        return [];
    }
  },

  usePower(g, u, target) {
    const p = u.def.power;
    g.emit({ type: "power", u, target, power: p });
    switch (p.kind) {
      case "pull": {
        this.damage(g, target, this.powerDamage(p), u, "hit");
        if (target.alive) this.pullToward(g, target, u);
        break;
      }
      case "push": {
        this.damage(g, target, this.powerDamage(p), u, "hit");
        if (target.alive) this.push(g, target, u, p.push);
        break;
      }
      case "blast": {
        for (const o of g.units.filter(o => o.alive && o.side !== u.side && this.dist(u, o) === 1))
          this.damage(g, o, this.powerDamage(p), u, "hit");
        for (const [dr, dc] of DIRS) {
          const r = u.r + dr, c = u.c + dc, t = this.tile(g, r, c);
          if (t && t.hive) this.burstHive(g, r, c);
          else if (t && t.breakable) { this.setTile(g, r, c, "."); g.emit({ type: "rubble", r, c }); }
        }
        break;
      }
      case "heal":
        this.heal(g, target, p.heal);
        break;
      case "charge": {
        const sr = Math.sign(target.r - u.r), sc = Math.sign(target.c - u.c);
        for (let i = 0; i < u.powerRange; i++) {
          const nr = u.r + sr, nc = u.c + sc, t = this.tile(g, nr, nc);
          if (!t || t.solid) break;
          const o = this.unitAt(g, nr, nc);
          if (o) {
            if (o.side === u.side) break;
            this.damage(g, o, this.powerDamage(p), u, "hit");
            if (o.alive) { this.push(g, o, u, p.push); if (this.unitAt(g, nr, nc)) break; }
          }
          if (!this.canEnd(g, u, nr, nc)) break;
          u.r = nr; u.c = nc;
          g.emit({ type: "shove", u });
        }
        this.landOn(g, u, [sr, sc]);
        break;
      }
    }
    u.cd = Math.max(1, p.cd - (u.cdBonus || 0));
    u.acted = true; u.moved = true;
  },

  pullToward(g, u, to) {
    const pv = this.pullPreview(g, to, u);
    if (!pv.moved) return;
    const dir = [Math.sign(pv.r - u.r), Math.sign(pv.c - u.c)];
    u.r = pv.r; u.c = pv.c;
    g.emit({ type: "shove", u });
    this.landOn(g, u, dir);
  },
};
