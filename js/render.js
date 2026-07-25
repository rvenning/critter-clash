// Canvas, input and pacing. Everything the player sees and touches lives here;
// game.js holds the truth and never knows about any of it.
//
// The board is laid out fresh on every resize from the level's own dimensions,
// so an 8x7 duel map and an 8x8 campaign map both fill the screen. Drawing is
// in CSS pixels — resize() puts the DPR scale into the context transform.

const View = {
  cv: null, ctx: null,
  cell: 40, ox: 0, oy: 0, W: 0, H: 0, DPR: 1,
  sel: null,               // selected critter
  mode: "move",            // "move" | "power" — what a tap on the board means
  reach: new Map(),        // tiles the selection can finish on
  banner: null,            // { text, sub, t } big turn announcement
  bubbles: [],             // { u, text, t } speech bubbles
  zoom: null,              // { r, c, t, dur } camera punch
  aiWait: 0,
  shownIntro: false,
  running: false,

  boot() {
    this.cv = document.getElementById("cv");
    this.ctx = this.cv.getContext("2d");
    this.resize();
    const re = () => this.resize();
    window.addEventListener("resize", re);
    // iOS settles its viewport lazily (toolbars, rotation, standalone launch),
    // so measure again well after the event as well as on it.
    window.addEventListener("orientationchange", () => setTimeout(re, 350));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", re);
    this.cv.addEventListener("pointerdown", (e) => this.onTap(e));
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  resize() {
    const wrap = this.cv.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // The game screen is display:none until it's shown, which measures 0x0 —
    // retry rather than caching a broken layout.
    if (!w || !h) { setTimeout(() => this.resize(), 200); return; }
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    // A canvas is a replaced element: the width/height ATTRIBUTES are the
    // backing store, and without an explicit CSS size it renders at that size
    // and overflows every retina screen. css/style.css pins it to 100%/100%.
    this.cv.style.width = w + "px";
    this.cv.style.height = h + "px";
    this.cv.width = Math.round(w * this.DPR);
    this.cv.height = Math.round(h * this.DPR);
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.W = w; this.H = h;
    this.layout();
  },

  layout() {
    const g = Game.g;
    const rows = g ? g.rows : 8, cols = g ? g.cols : 8;
    const pad = 10;
    this.cell = Math.floor(Math.min((this.W - pad * 2) / cols, (this.H - pad * 2) / rows));
    this.ox = Math.round((this.W - this.cell * cols) / 2);
    this.oy = Math.round((this.H - this.cell * rows) / 2);
  },

  /* ============================ match lifecycle ============================ */

  start() {
    this.sel = null; this.mode = "move"; this.reach = new Map();
    this.aiWait = 0; this.shownIntro = false;
    this.bubbles = []; this.zoom = null;
    Fx.timeScale = 1;
    Fx.reset();
    for (const u of Game.g.units) { u.sx = u.c; u.sy = u.r; }
    this.resize();                       // the stage only has a size once shown
    this.selectNext();
    const lv = Game.g.level;
    const w = lv && lv.weather && WEATHER[lv.weather];
    this.say(
      Game.g.mode === "duel" ? "PLAYER 1" : w ? `${w.icon} ${w.name.toUpperCase()}` : "YOUR TURN",
      w ? w.blurb : lv ? lv.hint : "");
  },

  say(text, sub) { this.banner = { text, sub: sub || "", t: 0 }; },

  // A quick shove of the camera toward something important (a boss arriving).
  // Taps are ignored while it runs, so nobody loses a move to a moving board.
  punchZoom(u) { if (u) this.zoom = { r: u.r, c: u.c, t: 0, dur: 1.3 }; },

  zoomFactor() {
    if (!this.zoom) return 1;
    const k = this.zoom.t / this.zoom.dur;               // 0..1
    return 1 + 0.34 * Math.sin(Math.min(1, k) * Math.PI);
  },

  /* ============================ input ============================ */

  cellAt(e) {
    const rect = this.cv.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left - this.ox) / this.cell);
    const r = Math.floor((e.clientY - rect.top - this.oy) / this.cell);
    return { r, c };
  },

  onTap(e) {
    const g = Game.g;
    if (!g || g.state !== "playing" || !Game.isHuman(g.turn)) return;
    if (this.zoom) return;                  // the board is moving — don't misread a tap
    e.preventDefault();
    const { r, c } = this.cellAt(e);
    if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) { this.select(null); return; }
    const hit = Rules.unitAt(g, r, c);

    // Aiming a special: only a valid target does anything, and any other tap
    // quietly backs out rather than moving somewhere unexpected.
    if (this.mode === "power" && this.sel) {
      if (hit && Rules.powerTargets(g, this.sel).includes(hit)) {
        Game.power(this.sel, hit);
        this.mode = "move";
        this.afterAct();
      } else {
        this.mode = "move";
        this.refresh();
      }
      return;
    }

    if (this.sel && hit && hit.side !== this.sel.side && Rules.targetsFor(g, this.sel).includes(hit)) {
      Game.attack(this.sel, hit);
      this.afterAct();
      return;
    }
    if (hit && Game.canControl(hit)) { this.select(hit); return; }
    if (this.sel && this.reach.has(key(r, c)) && !this.sel.moved) {
      Game.moveUnit(this.sel, r, c);
      this.refresh();
      return;
    }
    this.select(null);
  },

  select(u) {
    this.sel = u && Game.canControl(u) ? u : null;
    this.mode = "move";
    if (u) Sfx.select();
    this.refresh();
  },

  // Hand the player straight to the next critter that still has a turn — with
  // three units and a small board, hunting for who's left is pure friction.
  selectNext() {
    const g = Game.g;
    if (!g || !Game.isHuman(g.turn)) { this.sel = null; this.refresh(); return; }
    const pool = Game.units(g.turn);
    const start = pool.indexOf(this.sel) + 1;
    for (let i = 0; i < pool.length; i++) {
      const u = pool[(start + i) % pool.length];
      if (!u.acted) { this.select(u); return; }
    }
    this.select(null);
  },

  afterAct() {
    if (Game.g.state !== "playing") { this.refresh(); return; }
    this.selectNext();
  },

  togglePower() {
    if (!this.sel || this.sel.cd > 0 || this.sel.acted) return;
    this.mode = this.mode === "power" ? "move" : "power";
    Sfx.select();
    this.refresh();
  },

  refresh() {
    const g = Game.g;
    this.reach = this.sel && !this.sel.moved && Game.canControl(this.sel)
      ? Rules.reachable(g, this.sel) : new Map();
    if (App.refreshBar) App.refreshBar();
  },

  /* ============================ loop ============================ */

  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    requestAnimationFrame((t2) => this.loop(t2));
    if (!this.running || !Game.g) return;

    // Bugs act one at a time on a timer so a child can follow what happened.
    const g = Game.g;
    if (g.state === "playing" && !Game.isHuman(g.turn)) {
      this.aiWait -= dt;
      if (this.aiWait <= 0) {
        this.aiWait = 0.45;
        if (!Game.aiStep()) Game.endTurn();
      }
    }

    for (const u of g.units) {
      u.sx += (u.c - u.sx) * Math.min(1, dt * 14);
      u.sy += (u.r - u.sy) * Math.min(1, dt * 14);
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.9) this.banner = null;
    }
    if (this.zoom) {
      this.zoom.t += dt;
      if (this.zoom.t > this.zoom.dur) this.zoom = null;
    }
    for (const b of this.bubbles) b.t += dt;
    this.bubbles = this.bubbles.filter(b => b.t < 1.6);
    Fx.update(dt);
    GK.Debug.frame(dt);
    this.render();
  },

  /* ============================ drawing ============================ */

  px(c) { return this.ox + c * this.cell; },
  py(r) { return this.oy + r * this.cell; },

  render() {
    const g = Game.g, ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.drawSurround();

    const z = this.zoomFactor();
    if (z !== 1) {
      const cx = this.px(this.zoom.c) + this.cell / 2, cy = this.py(this.zoom.r) + this.cell / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(z, z);
      ctx.translate(-cx, -cy);
    }
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) this.drawTile(r, c);
    }
    this.drawHighlights();
    // Draw from the top down so a critter never hides the one behind it.
    for (const u of [...g.units].filter(u => u.alive).sort((a, b) => a.sy - b.sy)) this.drawUnit(u);
    this.drawBubbles();
    Fx.render(ctx);
    if (z !== 1) ctx.restore();
    this.drawBanner();
  },

  // The board's aspect rarely matches the screen's, so there is always spare
  // space around it. Paint that as the surrounding garden — undergrowth and a
  // soil rim under the board — so the grid reads as a patch of a real place
  // instead of a rectangle floating in a void.
  drawSurround() {
    const ctx = this.ctx, g = Game.g;
    const gr = ctx.createLinearGradient(0, 0, 0, this.H);
    gr.addColorStop(0, "#16301f");
    gr.addColorStop(1, "#0e1f16");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, this.W, this.H);

    const bw = g.cols * this.cell, bh = g.rows * this.cell;
    // Scattered undergrowth, skipping anything that would land on the board.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const step = Math.max(26, Math.round(this.cell * 0.7));
    for (let y = step / 2; y < this.H; y += step) {
      for (let x = step / 2; x < this.W; x += step) {
        if (x > this.ox - 8 && x < this.ox + bw + 8 && y > this.oy - 8 && y < this.oy + bh + 8) continue;
        const h = Math.floor(GK.util.hash2(Math.round(x), Math.round(y)) * 997);
        if (h % 4) continue;
        ctx.globalAlpha = 0.16 + (h % 3) * 0.05;
        ctx.font = `${Math.round(step * 0.6)}px serif`;
        ctx.fillText(["🌿", "🍃", "🌾", "🪵"][h % 4 === 0 ? (h >> 2) % 4 : 0], x, y);
      }
    }
    ctx.globalAlpha = 1;

    // Soil rim + shadow under the play area.
    const pad = Math.round(this.cell * 0.18);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    this.roundRect(this.ox - pad, this.oy - pad + 3, bw + pad * 2, bh + pad * 2, pad);
    ctx.fill();
    ctx.fillStyle = "#3a2d1e";
    this.roundRect(this.ox - pad, this.oy - pad, bw + pad * 2, bh + pad * 2, pad);
    ctx.fill();
  },

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  },

  drawTile(r, c) {
    const ctx = this.ctx, cell = this.cell;
    const t = Rules.tile(Game.g, r, c);
    const x = this.px(c), y = this.py(r);
    // A stable per-cell hash gives the meadow some variety. hash2 returns a
    // FLOAT 0-1, so scale before taking a modulus or every cell looks alike.
    const h = Math.floor(GK.util.hash2(r, c) * 997);
    const shades = {
      grass: ["#3f7a45", "#457f49", "#3a7241"],
      bush:  ["#2c5f38", "#2f6a3c", "#2a5a34"],
      rock:  ["#6b6f74", "#767a80", "#63676c"],
      cliff: ["#4a4d52", "#525559", "#45484c"],
      water: ["#2a6a97", "#2f74a4", "#27618c"],
      thorn: ["#5c4a2e", "#644f31", "#55452b"],
      berry: ["#3f7a45", "#457f49", "#3a7241"],
      hive:  ["#8a6a2a", "#96742f", "#7d5f26"],
      shroom: ["#47854d", "#4d8b52", "#427f49"],
      honey: ["#7d6420", "#886d25", "#735c1d"],
      apple: ["#3f7a45", "#457f49", "#3a7241"],
      acorn: ["#3f7a45", "#457f49", "#3a7241"],
      clover: ["#3f7a45", "#457f49", "#3a7241"],
    };
    ctx.fillStyle = (shades[t.id] || shades.grass)[h % 3];
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = "rgba(0,0,0,.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, cell - 1, cell - 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mid = cell / 2;
    if (t.id === "water") {
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const yy = y + cell * (0.35 + i * 0.3) + Math.sin(performance.now() / 700 + r + c + i) * 1.5;
        ctx.beginPath();
        ctx.moveTo(x + cell * .2, yy);
        ctx.lineTo(x + cell * .8, yy);
        ctx.stroke();
      }
    } else if (t.id === "rock" || t.id === "cliff") {
      ctx.font = `${Math.round(cell * .5)}px serif`;
      ctx.fillText(t.id === "rock" ? "🪨" : "⛰️", x + mid, y + mid + 1);
    } else if (t.id === "bush") {
      ctx.font = `${Math.round(cell * .48)}px serif`;
      ctx.fillText("🌿", x + mid, y + mid + 1);
    } else if (t.id === "thorn") {
      ctx.font = `${Math.round(cell * .46)}px serif`;
      ctx.fillText("🌵", x + mid, y + mid + 1);
    } else if (t.id === "berry") {
      const bob = Math.sin(performance.now() / 300 + c) * cell * .05;
      ctx.font = `${Math.round(cell * .55)}px serif`;
      ctx.fillText("🍓", x + mid, y + mid + bob);
    } else if (t.emoji) {
      // Everything else that has a face: hives, mushrooms, honey, pickups.
      // Pickups bob so they read as "come and get me" rather than scenery.
      const live = t.pickup || t.bounce;
      const bob = live ? Math.sin(performance.now() / 320 + r + c) * cell * .06 : 0;
      ctx.font = `${Math.round(cell * (t.solid ? .55 : .5))}px serif`;
      ctx.fillText(t.emoji, x + mid, y + mid + bob);
    } else if (h % 7 === 0) {
      ctx.font = `${Math.round(cell * .3)}px serif`;
      ctx.globalAlpha = .75;
      ctx.fillText(h % 14 === 0 ? "🌼" : "🌱", x + mid, y + mid);
      ctx.globalAlpha = 1;
    }
  },

  drawHighlights() {
    const g = Game.g, ctx = this.ctx, cell = this.cell;
    if (!this.sel) return;
    const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.16;

    if (this.mode === "move") {
      // A wash of colour over green grass is nearly invisible; a bright dot in
      // the middle of each square reads instantly, even on a sunlit iPad.
      for (const k of this.reach.keys()) {
        const [r, c] = k.split(",").map(Number);
        if (r === this.sel.r && c === this.sel.c) continue;
        const x = this.px(c) + cell / 2, y = this.py(r) + cell / 2;
        ctx.fillStyle = `rgba(150,255,190,${0.16 + pulse * 0.1})`;
        ctx.fillRect(this.px(c) + 3, this.py(r) + 3, cell - 6, cell - 6);
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.13 + pulse * 0.02), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(180,255,205,.92)";
        ctx.fill();
        ctx.strokeStyle = "rgba(20,60,35,.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      for (const o of Rules.targetsFor(g, this.sel)) {
        this.ring(o, `rgba(255,110,110,${.6 + pulse * .4})`);
        this.tag(o, "-" + Rules.damageOf(g, this.sel, o), "#ff9a8a");
      }
    } else {
      for (const o of Rules.powerTargets(g, this.sel)) {
        this.ring(o, `rgba(210,140,255,${.65 + pulse * .35})`);
        this.drawPowerPreview(this.sel, o, pulse);
      }
    }

    // The selected critter's own tile.
    ctx.strokeStyle = "#ffe27a";
    ctx.lineWidth = 3;
    ctx.strokeRect(this.px(this.sel.c) + 2, this.py(this.sel.r) + 2, cell - 4, cell - 4);
  },

  // Show what a special will actually DO before it's used: where the bug ends
  // up, how much it hurts, and a splash if the shove would put it in the pond.
  // "Gust" and "Tongue Snap" mean nothing to a child; an arrow into the water
  // needs no explaining at all.
  drawPowerPreview(u, target, pulse) {
    const g = Game.g, ctx = this.ctx, cell = this.cell, p = u.def.power;
    const centre = (r, c) => [this.px(c) + cell / 2, this.py(r) + cell / 2];

    if (p.kind === "heal") { this.tag(target, "+" + p.heal, "#8affb0"); return; }
    this.tag(target, "-" + Rules.powerDamage(p), "#ffb0ff");

    let pv = null;
    if (p.kind === "push") pv = Rules.pushPreview(g, u, target, p.push);
    else if (p.kind === "pull") pv = Rules.pullPreview(g, u, target);
    else if (p.kind === "charge") {
      // Trace the lane the roll will plough through.
      const sr = Math.sign(target.r - u.r), sc = Math.sign(target.c - u.c);
      const [x1, y1] = centre(u.r, u.c);
      const [x2, y2] = centre(u.r + sr * p.range, u.c + sc * p.range);
      ctx.strokeStyle = `rgba(255,200,120,${.5 + pulse * .3})`;
      ctx.lineWidth = cell * .18;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineCap = "butt";
      return;
    } else if (p.kind === "blast") {
      const [x, y] = centre(target.r, target.c);
      ctx.font = `${Math.round(cell * .4)}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("💥", x, y - cell * .34);
      return;
    }
    if (!pv || (!pv.moved && !pv.immune)) return;

    if (pv.immune) { this.tag(target, "too heavy", "#ffd45e", cell * .5); return; }
    const [x1, y1] = centre(target.r, target.c);
    const [x2, y2] = centre(pv.r, pv.c);
    ctx.strokeStyle = pv.fatal ? "#7ec8f0" : "rgba(255,255,255,.75)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // Arrowhead at the landing square.
    const a = Math.atan2(y2 - y1, x2 - x1), h = cell * .18;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - h * Math.cos(a - 0.5), y2 - h * Math.sin(a - 0.5));
    ctx.lineTo(x2 - h * Math.cos(a + 0.5), y2 - h * Math.sin(a + 0.5));
    ctx.closePath();
    ctx.fillStyle = pv.fatal ? "#7ec8f0" : "rgba(255,255,255,.75)";
    ctx.fill();
    if (pv.fatal) {
      ctx.font = `${Math.round(cell * .46)}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("💦", x2, y2);
    }
  },

  // A small label pinned above a unit.
  tag(u, text, colour, dy) {
    const ctx = this.ctx, cell = this.cell;
    ctx.font = `bold ${Math.round(cell * .28)}px 'Baloo 2', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = this.px(u.c) + cell / 2, y = this.py(u.r) + cell / 2 - (dy || cell * .42);
    ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  },

  ring(u, colour) {
    const ctx = this.ctx, cell = this.cell;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.px(u.c) + cell / 2, this.py(u.r) + cell / 2, cell * .42, 0, Math.PI * 2);
    ctx.stroke();
  },

  drawUnit(u) {
    const ctx = this.ctx, cell = this.cell;
    const x = this.px(u.sx) + cell / 2, y = this.py(u.sy) + cell / 2;
    const boss = u.def.boss;
    const size = Math.round(cell * (boss ? .78 : .6));

    ctx.save();
    if (u.acted && Game.isHuman(u.side)) ctx.globalAlpha = .55;   // already had its turn

    // Shadow, so a critter reads as standing ON the tile.
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + cell * .3, cell * .27, cell * .1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Whose side is this? Everything in the game hangs off that question, so
    // it gets a filled disc in the team colour with a hard rim — bugs red,
    // critters their own colour — not a subtle tint.
    const mine = u.side === "p";
    ctx.fillStyle = mine ? u.def.color : "#c0392b";
    ctx.globalAlpha *= .34;
    ctx.beginPath();
    ctx.arc(x, y + cell * .06, cell * .37, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = u.acted && Game.isHuman(u.side) ? .55 : 1;
    ctx.strokeStyle = mine ? u.def.color : "#e35b4a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + cell * .06, cell * .37, 0, Math.PI * 2);
    ctx.stroke();

    // Idle life: everyone breathes on their own rhythm, the selected critter
    // bounces, and the winning team throws a little jig.
    const now = performance.now();
    const phase = u.uid * 0.9;
    let bob = Math.sin(now / 620 + phase) * cell * .022;
    let tilt = 0;
    if (u === this.sel) bob = Math.sin(now / 220) * cell * .05;
    if (Game.g.state === "won" && mine) {
      bob = -Math.abs(Math.sin(now / 190 + phase)) * cell * .22;
      tilt = Math.sin(now / 190 + phase) * 0.26;
    }
    ctx.font = `${size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (tilt) {
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.rotate(tilt);
      ctx.fillText(u.def.emoji, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(u.def.emoji, x, y + bob);
    }
    const hat = mine && App.hatFor && App.hatFor(u.def.id);
    if (hat) {
      ctx.font = `${Math.round(size * .55)}px serif`;
      ctx.fillText(hat.emoji, x + cell * .02, y + bob - size * .5);
    }

    // Health bar under everyone — the whole game is "how much is left?".
    const bw = cell * .62, bh = Math.max(3, cell * .09);
    const bx = x - bw / 2, by = y + cell * .32;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(bx, by, bw, bh);
    const frac = Math.max(0, u.hp / u.maxHp);
    // Green bars are yours, orange bars are theirs — readable at a glance even
    // when both sides are critters in a duel.
    ctx.fillStyle = mine
      ? (frac > .6 ? "#5ddb7a" : frac > .3 ? "#ffd45e" : "#ff6b6b")
      : (frac > .6 ? "#e8894a" : frac > .3 ? "#e0642f" : "#c0392b");
    ctx.fillRect(bx, by, bw * frac, bh);

    if (u.webbed) { ctx.font = `${Math.round(cell * .3)}px serif`; ctx.fillText("🕸️", x + cell * .3, y - cell * .28); }
    if (u.cd > 0 && u.side === "p") {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.beginPath();
      ctx.arc(x - cell * .3, y - cell * .3, cell * .15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(cell * .2)}px sans-serif`;
      ctx.fillText(String(u.cd), x - cell * .3, y - cell * .29);
    }
    ctx.restore();
  },

  drawBanner() {
    if (!this.banner) return;
    const ctx = this.ctx, b = this.banner;
    const a = b.t < 0.2 ? b.t / 0.2 : b.t > 1.4 ? Math.max(0, (1.9 - b.t) / 0.5) : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, this.H * .34, this.W, b.sub ? 74 : 52);
    ctx.fillStyle = "#ffe27a";
    ctx.font = "bold 26px 'Baloo 2', sans-serif";
    ctx.fillText(b.text, this.W / 2, this.H * .34 + 34);
    if (b.sub) {
      ctx.fillStyle = "#e8f5e9";
      ctx.font = "14px 'Baloo 2', sans-serif";
      ctx.fillText(b.sub, this.W / 2, this.H * .34 + 60);
    }
    ctx.restore();
  },

  /* ============================ chatter ============================ */
  // Critters and bugs say things. It is the cheapest personality there is and
  // it's what turns pieces on a grid into animals in a garden.
  say2(u, text) {
    if (!u || !u.alive) return;
    this.bubbles = this.bubbles.filter(b => b.u !== u).slice(-3);
    this.bubbles.push({ u, text, t: 0 });
  },

  chat(u, kind) {
    const table = u.side === "p" ? CHATTER.critter : CHATTER.bug;
    const lines = (CHATTER.own[u.def.id] && CHATTER.own[u.def.id][kind]) || table[kind];
    if (!lines || !lines.length) return;
    this.say2(u, lines[Math.floor(Math.random() * lines.length)]);
  },

  drawBubbles() {
    const ctx = this.ctx, cell = this.cell;
    for (const b of this.bubbles) {
      if (!b.u.alive && b.t > 0.4) continue;
      const a = b.t < .12 ? b.t / .12 : b.t > 1.2 ? Math.max(0, (1.6 - b.t) / .4) : 1;
      const x = this.px(b.u.sx) + cell / 2;
      const y = this.py(b.u.sy) + cell / 2 - cell * .62 - Math.min(8, b.t * 14);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `bold ${Math.max(10, Math.round(cell * .26))}px 'Baloo 2', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(b.text).width + cell * .3, h = cell * .38;
      ctx.fillStyle = b.u.side === "p" ? "rgba(255,255,255,.94)" : "rgba(255,214,214,.94)";
      this.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.beginPath();                       // little tail pointing at the speaker
      ctx.moveTo(x - cell * .07, y + h / 2 - 1);
      ctx.lineTo(x + cell * .07, y + h / 2 - 1);
      ctx.lineTo(x, y + h / 2 + cell * .12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1a2b20";
      ctx.fillText(b.text, x, y);
      ctx.restore();
    }
  },

  /* ============================ event reactions ============================ */
  // Sound and particles for whatever the engine just did.
  onEvent(ev) {
    const u = ev.u;
    const at = (unit) => ({ x: this.px(unit.sx) + this.cell / 2, y: this.py(unit.sy) + this.cell / 2 });
    switch (ev.type) {
      case "move": Sfx[u.def.leaper || u.def.flier ? "hop" : "step"](); break;
      case "attack": case "sweep": {
        Sfx.whack();
        Fx.addShake(ev.type === "sweep" ? 6 : 3);
        this.chat(u, "hit");
        break;
      }
      case "power": {
        Sfx[ev.power.kind === "heal" ? "sparkle" : ev.power.kind === "pull" ? "gulp" : "zap"]();
        const p = at(u);
        Fx.burst(p.x, p.y, u.def.color, 12, 130, .5, 3);
        this.chat(u, "power");
        break;
      }
      case "damage": {
        if (!u.alive) break;
        const p = at(u);
        Fx.text(p.x, p.y - this.cell * .3, "-" + ev.amount, { color: "#ff8a8a", size: 15 });
        Fx.burst(p.x, p.y, "#ff6b6b", 6, 90, .35, 2.2);
        if (u.side === "p") Sfx.hurt();
        if (ev.amount >= 4 || u.hp <= u.maxHp * .34) this.chat(u, "hurt");
        break;
      }
      case "heal": {
        const p = at(u);
        Fx.text(p.x, p.y - this.cell * .3, "+" + ev.amount, { color: "#8affb0", size: 15 });
        break;
      }
      case "splash": {
        Sfx.splash();
        const p = at(u);
        // A proper fountain: a wide low burst plus a column of droplets thrown
        // straight up, so the signature move of the game gets the biggest
        // reaction on the board.
        Fx.burst(p.x, p.y, "#7ec8f0", 22, 170, .7, 3.4);
        Fx.burst(p.x, p.y - this.cell * .2, "#cdeeff", 14, 90, .9, 2.4);
        Fx.addShake(5);
        this.chat(u, "splash");
        break;
      }
      case "berry": {
        Sfx.berry();
        const p = at(u);
        Fx.burst(p.x, p.y, "#ff6f91", 16, 140, .6, 3);
        this.chat(u, "berry");
        break;
      }
      case "rubble": {
        Sfx.crumble();
        Fx.burst(this.px(ev.c) + this.cell / 2, this.py(ev.r) + this.cell / 2, "#9aa0a6", 14, 120, .5, 3);
        break;
      }
      case "ko": {
        const p = at(u);
        Fx.burst(p.x, p.y, u.side === "p" ? u.def.color : "#c0392b", 24, 175, .8, 3.6);
        Sfx[u.side === "p" ? "down" : "bugDown"]();
        Fx.addShake(8);
        // A beat of slow motion on the finishing blow. In a game where one move
        // takes half a minute to choose, the payoff has to land.
        Fx.timeScale = 0.35;
        clearTimeout(this._slowmo);
        this._slowmo = setTimeout(() => { Fx.timeScale = 1; }, 260);
        break;
      }
      case "summon": {
        const p = at(u);
        Fx.burst(p.x, p.y, "#d18aff", 14, 120, .5, 3);
        if (ev.reinforcement) GK.UI.toast("More bugs are coming!");
        break;
      }
      case "web": case "stuck": Sfx.zap(); break;
      case "bounce": { Sfx.hop(); const p = at(u); Fx.burst(p.x, p.y, "#9ae06b", 10, 120, .4, 2.4); break; }
      case "slide": Sfx.step(); break;
      case "pickup": {
        Sfx[ev.kind === "heal" ? "sparkle" : ev.kind === "lucky" ? "berry" : "gulp"]();
        const p = at(u);
        Fx.burst(p.x, p.y, ev.kind === "lucky" ? "#8affb0" : "#ffd45e", 16, 140, .6, 3);
        break;
      }
      case "hive": {
        Sfx.crumble();
        const x = this.px(ev.c) + this.cell / 2, y = this.py(ev.r) + this.cell / 2;
        Fx.burst(x, y, "#ffd45e", 26, 190, .8, 3);
        Fx.addShake(7);
        GK.UI.toast("🐝 The bees are angry!");
        break;
      }
      case "weather": if (ev.weather === "wind") Sfx.step(); break;
      case "win": {
        Sfx.victory();
        Music.stop();
        Fx.confetti(this.W, this.H, ["#5ddb7a", "#ffd45e", "#ff6f91", "#63b8ff"], 90);
        const team = Game.units("p");
        team.forEach((t, i) => setTimeout(() => this.chat(t, "win"), 200 + i * 260));
        break;
      }
      case "lose": Sfx.defeat(); break;
    }
  },
};
