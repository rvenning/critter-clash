// The turn engine. Owns the whole match state and nothing else — no canvas, no
// DOM, no audio. render.js draws whatever this says is true and feeds input
// back in; audio and effects hang off the event stream. That split is what
// lets tests/bot.test.js play every level headlessly in a few milliseconds.
//
// Sides are "p" (the critters) and "e" (the bugs). In duel mode both sides are
// human, which is the only difference between campaign and hot-seat.

const Game = {
  g: null,
  onEvent: null,      // (ev) => void — sound + particles
  onDone: null,       // (result) => void — App.matchOver
  onChange: null,     // () => void — the HUD needs a repaint
  // Headless callers (the balance bot) want the bugs' whole turn to resolve
  // inside endTurn(). render.js sets this false and pumps aiStep() on a timer
  // so a child can watch one bug move at a time.
  autoRunAi: true,

  /* ============================ setting up ============================ */

  // party: array of critter ids. handicap: { p: extraHp, e: extraHp }.
  startLevel(levelIdx, party, opts) {
    const lv = LEVELS[levelIdx];
    const g = this.blank(lv.rows, opts);
    g.levelIdx = levelIdx;
    g.level = lv;
    g.mode = "campaign";
    g.objective = lv.objective;
    g.limit = lv.limit;
    g.par = lv.par;
    g.surviveFor = lv.survive || 0;

    const team = (party && party.length ? party : DEFAULT_PARTY).slice(0, lv.party.length);
    lv.party.forEach(([r, c], i) => {
      const id = team[i] || DEFAULT_PARTY[i % DEFAULT_PARTY.length];
      g.units.push(this.makeUnit(CRITTERS[id], "p", r, c, g));
    });
    for (const b of lv.bugs) g.units.push(this.makeUnit(BUGS[b.t], "e", b.r, b.c, g));

    g.totalBerries = this.countBerries(g);
    this.g = g;
    this.beginTurn("p");
    return g;
  },

  // Hot-seat: same engine, both sides human, optional health handicap so a
  // 4-year-old can take on an 8-year-old and win.
  startDuel(duelIdx, teamA, teamB, handicap) {
    const d = DUELS[duelIdx];
    const g = this.blank(d.rows, { handicap });
    g.mode = "duel";
    g.duel = d;
    g.objective = "defeat";
    g.limit = 24;
    g.par = 99;
    g.human = { p: true, e: true };
    d.a.forEach(([r, c], i) => g.units.push(this.makeUnit(CRITTERS[teamA[i]], "p", r, c, g)));
    d.b.forEach(([r, c], i) => g.units.push(this.makeUnit(CRITTERS[teamB[i]], "e", r, c, g)));
    g.totalBerries = this.countBerries(g);
    this.g = g;
    this.beginTurn("p");
    return g;
  },

  blank(rows, opts) {
    opts = opts || {};
    const g = {
      board: rows.slice(),
      rows: rows.length,
      cols: COLS,
      units: [],
      uid: 1,
      turn: "p",
      turnNo: 1,
      state: "playing",
      berries: 0,
      totalBerries: 0,
      lost: 0,                       // critters knocked out this match
      human: { p: true, e: false },
      handicap: opts.handicap || {},
      perks: opts.perks || [],
    };
    // Every state change in the match funnels through here: the engine counts
    // its own casualties (a lost critter costs a star) and passes the event on
    // to whoever is drawing and making noise.
    g.emit = (ev) => {
      if (ev.type === "ko" && ev.u.side === "p") g.lost++;
      if (this.onEvent) this.onEvent(ev);
    };
    return g;
  },

  // Stats are copied onto the unit rather than read from the registry, because
  // perks and handicaps change them per match — writing to `def` would leak
  // one profile's upgrades into every other game on the device.
  makeUnit(def, side, r, c, g) {
    const bonus = (g.handicap && g.handicap[side]) || 0;
    const u = {
      uid: g.uid++, def, side, r, c,
      hp: def.hp + bonus, maxHp: def.hp + bonus,
      move: def.move, atk: def.atk, range: def.range || 1, armour: def.armour || 0,
      powerRange: def.power ? def.power.range : 0,
      cdBonus: 0, brave: false,
      cd: 0, webbed: 0, alive: true,
      moved: false, acted: false, prev: null,
      sx: c, sy: r,                 // smoothed draw position, eased by render.js
    };
    return applyPerks(g.perks, def, u);
  },

  countBerries(g) {
    let n = 0;
    for (const row of g.board) for (const ch of row) if (TILES[ch] && TILES[ch].goal) n++;
    return n;
  },

  /* ============================ turn flow ============================ */

  units(side) { return this.g.units.filter(u => u.alive && u.side === side); },
  isHuman(side) { return !!this.g.human[side]; },

  beginTurn(side) {
    const g = this.g;
    g.turn = side;
    for (const u of this.units(side)) {
      u.moved = false; u.acted = false; u.prev = null;
      if (u.cd > 0) u.cd--;
      if (u.webbed > 0) u.webbed--;
    }
    if (side === "p") this.weatherPhase();
    if (!this.isHuman(side)) { this.summonPhase(side); this.reinforcePhase(); }
    this.changed();
  },

  // One extra rule for the whole level, announced on the banner. Deliberately
  // never lethal on its own: the wind won't blow anybody into the pond, because
  // losing a critter to weather you didn't choose is just unfair.
  weatherPhase() {
    const g = this.g;
    const w = g.level && g.level.weather;
    if (!w || g.turnNo < 2) return;
    if (w === "sun") {
      for (const u of this.units("p")) if (u.hp < u.maxHp) Rules.heal(g, u, 1);
      g.emit({ type: "weather", weather: "sun" });
      return;
    }
    if (w === "wind") {
      const [dr, dc] = WEATHER.wind.dir;
      // Nudge everyone standing in the open. Cover shelters you, and a unit
      // already against something solid just holds on.
      for (const u of [...g.units].filter(u => u.alive)) {
        const here = Rules.tile(g, u.r, u.c);
        if (!here || here.cover || u.def.heavy) continue;
        const nr = u.r + dr, nc = u.c + dc, t = Rules.tile(g, nr, nc);
        if (!t || t.solid || t.water || Rules.unitAt(g, nr, nc)) continue;
        u.r = nr; u.c = nc;
        g.emit({ type: "shove", u });
        Rules.landOn(g, u, [dr, dc]);
      }
      g.emit({ type: "weather", weather: "wind" });
    }
    // "rain" is handled in Rules.moveTo — a long move slides one extra square.
  },

  // "Survive" levels send fresh bugs in over the top edge. Without them,
  // holding out is achieved by putting the iPad down — the balance bot caught
  // exactly that on two of the three.
  reinforcePhase() {
    const g = this.g;
    const rf = g.level && g.level.reinforce;
    if (!rf || g.turnNo < 2 || g.turnNo % rf.every !== 0) return;
    let placed = 0;
    for (let r = 0; r < g.rows && placed < rf.n; r++) {
      for (let c = 0; c < g.cols && placed < rf.n; c++) {
        const t = Rules.tile(g, r, c);
        if (!t || t.solid || t.water || t.hazard || Rules.unitAt(g, r, c)) continue;
        const nu = this.makeUnit(BUGS[rf.type], "e", r, c, g);
        g.units.push(nu);
        g.emit({ type: "summon", u: nu, reinforcement: true });
        placed++;
      }
    }
  },

  // Bosses call in friends every few turns. Placed on the first free tile
  // beside them so the arrival is always visible.
  summonPhase(side) {
    const g = this.g;
    for (const u of this.units(side)) {
      const s = u.def.summon;
      if (!s) continue;
      u.summonTick = (u.summonTick || 0) + 1;
      if (u.summonTick % s.every !== 0) continue;
      for (let i = 0; i < s.n; i++) {
        const spot = this.freeTileNear(u);
        if (!spot) break;
        const nu = this.makeUnit(BUGS[s.type], side, spot[0], spot[1], g);
        g.units.push(nu);
        g.emit({ type: "summon", u: nu });
      }
    }
  },

  freeTileNear(u) {
    const g = this.g;
    for (const ring of [1, 2]) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.abs(dr) + Math.abs(dc) !== ring) continue;
          const r = u.r + dr, c = u.c + dc, t = Rules.tile(g, r, c);
          if (t && !t.solid && !t.water && !Rules.unitAt(g, r, c)) return [r, c];
        }
      }
    }
    return null;
  },

  // Everyone on this side has both moved and acted.
  sideDone(side) { return this.units(side).every(u => u.acted); },

  endTurn() {
    const g = this.g;
    // Safety net: the player API checks after every action, but a bot driving
    // Rules directly can win mid-turn and only find out here.
    this.checkEnd();
    if (g.state !== "playing") return;
    const next = g.turn === "p" ? "e" : "p";
    if (next === "p") {
      g.turnNo++;
      // Survive levels are won by outlasting the bugs' last swing.
      if (g.surviveFor && g.turnNo > g.surviveFor) return this.finish(true);
      if (g.turnNo > g.limit) return this.finish(false, "time");
    }
    this.beginTurn(next);
    if (!this.isHuman(next) && this.autoRunAi) this.runAiTurn();
  },

  // One AI unit acts. Returns true while there is more to do, so render.js can
  // pace it and a test can spin it to completion.
  aiStep() {
    const g = this.g;
    if (g.state !== "playing" || this.isHuman(g.turn)) return false;
    const u = this.units(g.turn).find(x => !x.acted);
    if (!u) return false;
    AI.execute(g, u, AI.plan(g, u));
    u.moved = u.acted = true;
    this.checkEnd();
    this.changed();
    return g.state === "playing" && !!this.units(g.turn).find(x => !x.acted);
  },

  runAiTurn() {
    let guard = 40;
    while (this.aiStep() && guard-- > 0) { /* keep going */ }
    if (this.g.state === "playing") this.endTurn();
  },

  /* ============================ player actions ============================ */

  canControl(u) {
    const g = this.g;
    return g.state === "playing" && u.alive && u.side === g.turn && this.isHuman(u.side) && !u.acted;
  },

  moveUnit(u, r, c) {
    if (!this.canControl(u) || u.moved) return false;
    if (!Rules.reachable(this.g, u).has(key(r, c))) return false;
    Rules.moveTo(this.g, u, r, c);
    this.checkEnd();
    this.changed();
    return true;
  },

  // Kids mis-tap. A move can always be taken back until the unit acts.
  undoMove(u) {
    if (!u.prev || u.acted || !u.alive || !this.canControl(u)) return false;
    u.r = u.prev.r; u.c = u.prev.c;
    u.prev = null; u.moved = false;
    this.g.emit({ type: "undo", u });
    this.changed();
    return true;
  },

  attack(u, target) {
    if (!this.canControl(u)) return false;
    if (!Rules.targetsFor(this.g, u).includes(target)) return false;
    Rules.attack(this.g, u, target);
    this.afterAction();
    return true;
  },

  power(u, target) {
    if (!this.canControl(u) || u.cd > 0) return false;
    if (!Rules.powerTargets(this.g, u).includes(target)) return false;
    Rules.usePower(this.g, u, target);
    this.afterAction();
    return true;
  },

  // Stand still and be done — sometimes the right move is no move.
  hold(u) {
    if (!this.canControl(u)) return false;
    u.moved = true; u.acted = true;
    this.g.emit({ type: "hold", u });
    this.changed();
    return true;
  },

  afterAction() {
    this.checkEnd();
    this.changed();
  },

  /* ============================ win & loss ============================ */

  checkEnd() {
    const g = this.g;
    if (g.state !== "playing") return;
    if (!this.units("p").length) return this.finish(false, "wiped");
    // "Hold out" levels are lost the moment a critter goes down. Endurance
    // alone can be achieved by putting the iPad on the table — the bot proved
    // it — so the objective is keeping the whole team on its feet.
    if (g.surviveFor && g.lost > 0) return this.finish(false, "fallen");
    if (g.mode === "duel") {
      if (!this.units("e").length) return this.finish(true);
      return;
    }
    if (g.totalBerries > 0 && g.berries >= g.totalBerries) return this.finish(true);
    if (g.objective === "defeat" && !this.units("e").length) return this.finish(true);
  },

  finish(win, why) {
    const g = this.g;
    if (g.state !== "playing") return;
    g.state = win ? "won" : "lost";
    const clean = g.lost === 0;
    // A survive win lands on the turn AFTER the last one you had to hold, so
    // report the number the level actually asked for.
    const turns = win && g.surviveFor ? g.surviveFor : g.turnNo;
    const result = {
      win, why, levelIdx: g.levelIdx, mode: g.mode,
      turns, par: g.par, clean,
      stars: win ? (turns <= g.par && clean ? 3 : (turns <= g.par || clean ? 2 : 1)) : 0,
      winner: g.mode === "duel" ? (this.units("p").length ? "p" : "e") : null,
    };
    g.result = result;
    g.emit({ type: win ? "win" : "lose" });
    this.changed();
    if (this.onDone) this.onDone(result);
  },

  changed() { if (this.onChange) this.onChange(); },
};
