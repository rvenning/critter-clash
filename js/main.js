// App shell: screens, the level map, the team picker, hot-seat duel setup and
// results. Profiles, PINs, family sync and the install button all come from
// gamekit — this file only wires them to Critter Clash's own flow.

const AVATARS = ["🐸", "🦫", "🐦", "🦔", "🐝", "🦊", "🐨", "🐢", "🦉", "🐙", "🦖", "⭐"];

const App = {
  profile: null,
  duel: { map: 0, a: null, b: null, handicap: "none" },
  lastTurn: null,

  el(id) { return document.getElementById(id); },

  async init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound;
    // Music gets its own switch: kids often want the effects without the tune.
    Music.enabled = settings.music !== false;
    GK.UI.onScreenChange = (name) => {
      View.running = name === "game";
      if (name !== "game") Music.stop();
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);
    this.bindMusicToggle();

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) => `⭐ ${Storage.totalStars(prog)}/${LEVELS.length * 3} · 🗺️ ${Storage.cleared(prog)} levels`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Player",
    });

    Game.autoRunAi = false;            // render.js paces the bugs' turn
    Game.onEvent = (ev) => { this.tally(ev); View.onEvent(ev); };
    Game.onChange = () => this.onChange();
    Game.onDone = (res) => this.matchOver(res);

    GK.initPWA({ appName: "Critter Clash" });
    View.boot();

    GK.Debug.init({ storage: Storage, title: "CRITTER CLASH" })
      .jump("level", LEVELS.length, (n) => this.startLevel(n - 1))
      .action("win now", () => Game.finish(true))
      .action("hurt team", () => { for (const u of Game.units("p")) Rules.damage(Game.g, u, 3, null, "debug"); });

    this.showScreen("splash");
    Storage.initFirebase().then(ok => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "map") this.showMap();
    });
  },

  showScreen(name) { GK.UI.showScreen(name); },

  bindMusicToggle() {
    const paint = () => document.querySelectorAll(".btn-music")
      .forEach(b => { b.textContent = Music.enabled ? "🎵" : "🎵̸"; b.classList.toggle("off", !Music.enabled); });
    document.querySelectorAll(".btn-music").forEach(b => b.onclick = () => {
      Music.enabled = !Music.enabled;
      const s = Storage.getSettings(); s.music = Music.enabled; Storage.saveSettings(s);
      paint(); Sfx.click();
    });
    paint();
  },

  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `🐾 Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.classList.add("ghost");
      start.textContent = "👥 Switch Player";
    } else {
      cont.style.display = "none";
      start.classList.remove("ghost");
      start.textContent = "🕹️ Play";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  progress() { return Storage.getProgress(this.profile.id); },

  /* ============================ level map ============================ */

  showMap() {
    if (!this.profile) return this.play();
    const prog = this.progress();
    const unlocked = Storage.unlockedLevel(prog);
    const done = Storage.cleared(prog);

    this.el("map-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("map-stars").textContent = `⭐ ${Storage.totalStars(prog)}/${LEVELS.length * 3}`;

    const cont = this.el("btn-continue");
    if (Object.keys(prog.levels || {}).length < LEVELS.length) {
      const lv = LEVELS[unlocked];
      cont.innerHTML = `▶️ ${lv.boss ? "☠️ BOSS: " : `Level ${unlocked + 1} — `}${GK.util.esc(lv.name)}`;
      cont.onclick = () => { Sfx.click(); this.startLevel(unlocked); };
    } else {
      cont.innerHTML = "🏆 Every bug beaten! Replay any level";
      cont.onclick = () => Sfx.click();
    }

    const wrap = this.el("level-grid");
    wrap.innerHTML = "";
    LEVELS.forEach((lv, i) => {
      const result = prog.levels[i];
      const state = result ? "done" : i <= unlocked ? "open" : "locked";
      const cell = document.createElement("button");
      cell.className = `lvl ${state}${lv.boss ? " boss" : ""}`;
      cell.title = lv.name;
      cell.innerHTML = state === "locked"
        ? `<span class="lvl-n">🔒</span>`
        : `<span class="lvl-n">${lv.boss ? "☠️" : i + 1}</span>
           <span class="lvl-stars">${result ? "★".repeat(result.stars) + "☆".repeat(3 - result.stars) : ""}</span>`;
      if (state !== "locked") cell.onclick = () => { Sfx.click(); this.startLevel(i); };
      wrap.appendChild(cell);
    });

    // The team button only means anything once there's a choice to make.
    const roster = unlockedCritters(done);
    const teamBtn = this.el("btn-team");
    teamBtn.style.display = roster.length > 3 ? "" : "none";
    this.showScreen("map");
  },

  // Trophy-shelf counters, gathered from the engine's event stream during a
  // match and banked in one write when it ends.
  counts: {},
  tally(ev) {
    const c = this.counts;
    if (ev.type === "ko") {
      if (ev.u.side === "e") { c.bonked = (c.bonked || 0) + 1; if (ev.cause === "splash") c.dunked = (c.dunked || 0) + 1; }
      else c.fallen = (c.fallen || 0) + 1;
    } else if (ev.type === "berry") c.berries = (c.berries || 0) + 1;
    else if (ev.type === "power") c.powers = (c.powers || 0) + 1;
  },

  hatFor(critterId) {
    const id = this.profile && this.progress().hats[critterId];
    return id ? HATS[id] : null;
  },

  startLevel(idx) {
    const lv = LEVELS[idx];
    const prog0 = this.progress();
    const party = Storage.party(prog0, lv.party.length);
    Game.startLevel(idx, party, { perks: prog0.perks || [] });
    this.el("hud-level").textContent = `${idx + 1}. ${lv.name}`;
    // Match the starting side so the first onChange doesn't fire a "YOUR TURN"
    // banner straight over the level's own opening announcement.
    this.lastTurn = "p";
    this.showScreen("game");
    View.start();
    Music.start(lv.boss ? "boss" : "garden");
    if (lv.boss) {
      Sfx.bossRoar();
      View.say(BUGS[lv.boss].name.toUpperCase() + "!", BUGS[lv.boss].intro);
      View.punchZoom(Game.units("e").find(u => u.def.boss));
    }
    this.onChange();
    // First time this profile has ever played: teach the loop before anything
    // else happens. Afterwards it lives behind the pause button.
    const prog = this.progress();
    if (!prog.seenHelp) {
      prog.seenHelp = true;
      Storage.saveProgress(this.profile.id, prog);
      setTimeout(() => GK.UI.openModal("modal-help"), 250);
    }
  },

  /* ============================ team picker ============================ */

  showTeam() {
    Sfx.click();
    const prog = this.progress();
    const roster = unlockedCritters(Storage.cleared(prog));
    let team = Storage.party(prog, 3);

    const wrap = this.el("team-list");
    const render = () => {
      wrap.innerHTML = "";
      for (const id of Object.keys(CRITTERS)) {
        const c = CRITTERS[id];
        const open = roster.includes(id);
        const on = team.includes(id);
        const card = document.createElement("button");
        card.className = `crit-card${on ? " on" : ""}${open ? "" : " locked"}`;
        const hat = this.hatFor(id);
        card.innerHTML = open ? `
          <span class="crit-emoji">${hat ? `<i class="crit-hat">${hat.emoji}</i>` : ""}${c.emoji}</span>
          <span class="crit-info">
            <b>${c.name}</b><span class="crit-blurb">${c.blurb}</span>
            <span class="crit-stats">❤️ ${c.hp} · 👟 ${c.move} · 👊 ${c.atk}${c.range > 1 ? ` · 🎯 ${c.range}` : ""}${c.armour ? ` · 🛡️ ${c.armour}` : ""}</span>
            <span class="crit-power">${c.power.icon} <b>${c.power.name}</b> — ${c.power.desc}</span>
          </span>
          <span class="crit-pick">${on ? "✓" : "+"}</span>`
          : `<span class="crit-emoji">🔒</span>
             <span class="crit-info"><b>${c.name}</b>
             <span class="crit-blurb">Joins after ${c.unlock} levels</span></span>`;
        if (open) card.onclick = () => {
          if (team.includes(id)) { if (team.length > 1) team = team.filter(x => x !== id); }
          else if (team.length < 3) team.push(id);
          else team = [...team.slice(1), id];        // oldest pick rotates out
          Sfx.select();
          Storage.saveParty(this.profile.id, team);
          render();
        };
        wrap.appendChild(card);
      }
      this.el("team-count").textContent = `${team.length}/3 chosen`;
      this.renderHats(render);
    };
    render();
    this.showScreen("team");
  },

  // Hats are pure decoration, which is exactly why they matter at this age:
  // pick a critter, then pick a hat, and it turns up on the board.
  renderHats(refresh) {
    const prog = this.progress();
    const stars = Storage.totalStars(prog);
    const open = unlockedHats(stars);
    const box = this.el("hat-list");
    const next = Object.values(HATS).find(h => stars < h.stars);
    this.el("hat-hint").textContent = next
      ? `Tap a critter's hat to change it. Next hat at ⭐ ${next.stars}.`
      : "Every hat unlocked!";
    box.innerHTML = "";
    const team = Storage.party(prog, 3);
    for (const id of team) {
      const c = CRITTERS[id];
      const worn = this.hatFor(id);
      const b = document.createElement("button");
      b.className = "hat-slot";
      b.innerHTML = `<span class="hat-crit">${c.emoji}</span><span class="hat-worn">${worn ? worn.emoji : "＋"}</span>`;
      b.title = `${c.name}: ${worn ? worn.name : "no hat"}`;
      b.onclick = () => {
        // Cycle: none → each unlocked hat → none.
        const order = [null, ...open.map(h => h.id)];
        const cur = order.indexOf(worn ? worn.id : null);
        Storage.setHat(this.profile.id, id, order[(cur + 1) % order.length]);
        Sfx.select();
        refresh();
      };
      box.appendChild(b);
    }
  },

  /* ============================ hot-seat duel ============================ */

  showDuel() {
    Sfx.click();
    const roster = unlockedCritters(Storage.cleared(this.progress()));
    this.duel.a = this.duel.a || DEFAULT_PARTY.slice(0, 3);
    this.duel.b = this.duel.b || DEFAULT_PARTY.slice(0, 3);

    const chips = (side) => {
      const box = this.el(`duel-${side}`);
      box.innerHTML = "";
      for (const id of roster) {
        const c = CRITTERS[id];
        const on = this.duel[side].includes(id);
        const chip = document.createElement("button");
        chip.className = `chip${on ? " on" : ""}`;
        chip.innerHTML = `${c.emoji}<span>${c.name}</span>`;
        chip.onclick = () => {
          const t = this.duel[side];
          if (t.includes(id)) { if (t.length > 1) this.duel[side] = t.filter(x => x !== id); }
          else if (t.length < 3) t.push(id);
          else this.duel[side] = [...t.slice(1), id];
          Sfx.select();
          chips(side);
        };
        box.appendChild(chip);
      }
    };
    chips("a"); chips("b");

    const maps = this.el("duel-maps");
    maps.innerHTML = "";
    DUELS.forEach((d, i) => {
      const b = document.createElement("button");
      b.className = `chip${this.duel.map === i ? " on" : ""}`;
      b.textContent = d.name;
      b.onclick = () => { this.duel.map = i; Sfx.select(); this.showDuel(); };
      maps.appendChild(b);
    });

    const hcp = this.el("duel-handicap");
    hcp.innerHTML = "";
    for (const [id, label] of [["none", "Even match"], ["a", "Player 1 gets +6 ❤️"], ["b", "Player 2 gets +6 ❤️"]]) {
      const b = document.createElement("button");
      b.className = `chip${this.duel.handicap === id ? " on" : ""}`;
      b.textContent = label;
      b.onclick = () => { this.duel.handicap = id; Sfx.select(); this.showDuel(); };
      hcp.appendChild(b);
    }
    this.showScreen("duel");
  },

  startDuel() {
    Sfx.click();
    const pad = (t) => { const o = t.slice(0, 3); while (o.length < 3) o.push(DEFAULT_PARTY[o.length]); return o; };
    const h = this.duel.handicap;
    Game.startDuel(this.duel.map, pad(this.duel.a), pad(this.duel.b),
      h === "a" ? { p: 6 } : h === "b" ? { e: 6 } : {});
    this.el("hud-level").textContent = `⚔️ ${DUELS[this.duel.map].name}`;
    // Match the starting side so the first onChange doesn't fire a "YOUR TURN"
    // banner straight over the level's own opening announcement.
    this.lastTurn = "p";
    this.showScreen("game");
    View.start();
    Music.start("garden");
    this.onChange();
  },

  /* ============================ in-game HUD ============================ */

  onChange() {
    const g = Game.g;
    if (!g) return;
    if (this.lastTurn !== g.turn) {
      this.lastTurn = g.turn;
      if (g.state === "playing") {
        if (g.mode === "duel") {
          View.say(g.turn === "p" ? "PLAYER 1" : "PLAYER 2");
          Sfx.newTurn();
        } else if (g.turn === "p") { View.say("YOUR TURN"); Sfx.newTurn(); }
        else { View.say("BUGS' TURN"); Sfx.bugTurn(); }
        // Only advance if the current pick is stale — otherwise the fresh
        // selection made when the match started gets skipped past.
        if (Game.isHuman(g.turn) && (!View.sel || View.sel.acted || View.sel.side !== g.turn)) View.selectNext();
      }
    }
    this.el("hud-turn").textContent = g.surviveFor
      ? `Turn ${Math.min(g.turnNo, g.surviveFor)}/${g.surviveFor}`
      : `Turn ${g.turnNo}/${g.limit}`;
    this.el("hud-goal").textContent = this.goalText(g);
    this.refreshBar();
  },

  goalText(g) {
    if (g.mode === "duel") return "Last team standing";
    switch (g.objective) {
      case "reach": return "🍓 Reach the berry";
      case "collect": return `🍓 Berries ${g.berries}/${g.totalBerries}`;
      case "survive": return "🛡️ Keep everyone standing";
      default: return `🐛 Bugs left: ${Game.units("e").length}`;
    }
  },

  // "How far can this one go?" in words, next to the dots that answer it on the
  // board. The number was never written down anywhere before.
  statLine(u) {
    const bits = [`❤️ ${u.hp}/${u.maxHp}`];
    if (u.moved) bits.push("👟 moved already");
    else bits.push(`👟 moves ${Rules.moveBudget(u)}${u.webbed ? " (stuck!)" : ""}`);
    bits.push(`👊 hits ${u.atk}`);
    if (u.range > 1) bits.push(`🎯 range ${u.range}`);
    if (u.armour) bits.push(`🛡️ ${u.armour}`);
    return bits.join(" · ");
  },

  refreshBar() {
    const g = Game.g, u = View.sel;
    const bar = this.el("action-bar");
    const card = this.el("sel-card");
    if (!u) {
      card.innerHTML = `<span class="sel-hint">${Game.isHuman(g.turn) ? "Tap one of your critters" : "The bugs are moving…"}</span>`;
      bar.classList.add("empty");
    } else {
      bar.classList.remove("empty");
      const p = u.def.power;
      if (View.mode === "power") {
        // Aiming: the card stops being a status readout and becomes the
        // instructions, because this is the exact moment the player is asking
        // "what does this button even do?".
        card.innerHTML = `
          <span class="sel-emoji">${p.icon}</span>
          <span class="sel-info">
            <b>${p.name}</b>
            <span class="sel-desc">${p.desc}</span>
            <span class="sel-num">Tap a bug in a purple ring — or tap the button again to cancel.</span>
          </span>`;
      } else {
        card.innerHTML = `
          <span class="sel-emoji">${u.def.emoji}</span>
          <span class="sel-info">
            <b>${u.def.name}</b>
            <span class="sel-hp"><i style="width:${Math.max(0, u.hp / u.maxHp) * 100}%"></i></span>
            <span class="sel-num">${this.statLine(u)}</span>
          </span>`;
      }
      const pow = this.el("btn-power");
      pow.disabled = !!u.cd || u.acted;
      pow.classList.toggle("armed", View.mode === "power");
      pow.innerHTML = u.cd
        ? `${p.icon} ${p.name} <em>${u.cd}</em>`
        : `${p.icon} ${p.name}`;
      pow.title = p.desc;
      this.el("btn-undo").disabled = !u.prev || u.acted;
      this.el("btn-wait").disabled = u.acted;
    }
    const ends = this.el("btn-end");
    ends.disabled = !Game.isHuman(g.turn) || g.state !== "playing";
    const left = Game.units(g.turn).filter(x => !x.acted).length;
    ends.textContent = left ? `End Turn (${left} left)` : "End Turn";
  },

  showHelp() {
    Sfx.click();
    GK.UI.closeModal("modal-pause");
    GK.UI.openModal("modal-help");
  },

  power() { Sfx.click(); View.togglePower(); },
  undo() { if (View.sel) { Game.undoMove(View.sel); View.refresh(); } },
  wait() { if (View.sel) { Game.hold(View.sel); View.afterAct(); } },
  endTurn() { Sfx.click(); View.sel = null; View.mode = "move"; Game.endTurn(); },

  quit() {
    GK.UI.closeModal("modal-pause");
    Game.g.state = "quit";
    this.showMap();
  },

  /* ============================ results ============================ */

  matchOver(res) {
    Storage.recordResult(this.profile.id, res);
    const duel = res.mode === "duel";
    const prog = Storage.bump(this.profile.id, {
      ...this.counts,
      turns: res.turns,
      perfect: res.win && !duel && res.clean ? 1 : 0,
      duels: duel && res.win ? 1 : 0,
    });
    this.counts = {};
    this.el("res-emoji").textContent = res.win ? (duel ? "🏆" : res.stars === 3 ? "🌟" : "🎉") : "😿";
    this.el("res-title").textContent = duel
      ? `${res.winner === "p" ? "Player 1" : "Player 2"} wins!`
      : res.win ? (LEVELS[res.levelIdx].boss ? "BOSS BEATEN!" : `Level ${res.levelIdx + 1} clear!`)
        : this.lossText(res);
    this.el("res-stars").innerHTML = duel ? "" :
      [0, 1, 2].map(s => `<span class="star ${s < res.stars ? "on" : ""}">★</span>`).join("");
    this.el("res-detail").textContent = duel ? `${prog.duelWins} duels won on this profile`
      : res.win ? `Finished in ${res.turns} turn${res.turns === 1 ? "" : "s"} (par ${res.par})${res.clean ? " · nobody fell" : ""}`
        : "";

    const retry = this.el("res-retry"), next = this.el("res-next");
    retry.textContent = res.win ? "↻ Replay" : "↻ Try Again";
    retry.className = res.win ? "btn ghost" : "btn";
    retry.onclick = () => { Sfx.click(); duel ? this.startDuel() : this.startLevel(res.levelIdx); };
    const hasNext = res.win && !duel && res.levelIdx + 1 < LEVELS.length;
    next.style.display = hasNext ? "" : "none";
    if (hasNext) {
      next.textContent = LEVELS[res.levelIdx + 1].boss ? "☠️ Next: Boss!" : `▶️ Level ${res.levelIdx + 2}`;
      next.onclick = () => { Sfx.click(); this.startLevel(res.levelIdx + 1); };
    }
    // Unlocking a new critter is the biggest reward in the game — say so.
    const before = res.win && !duel ? Storage.cleared(prog) - 1 : Storage.cleared(prog);
    const gained = unlockedCritters(Storage.cleared(prog)).filter(id => !unlockedCritters(before).includes(id));
    const un = this.el("res-unlock");
    un.style.display = gained.length ? "" : "none";
    if (gained.length) {
      const c = CRITTERS[gained[0]];
      un.innerHTML = `${c.emoji} <b>${c.name} joins your team!</b> ${c.blurb}`;
      setTimeout(() => Sfx.sparkle(), 500);
    }
    this.el("res-finished").style.display =
      (res.win && !duel && res.levelIdx === LEVELS.length - 1) ? "" : "none";
    this.offerPerk(res, prog);
    setTimeout(() => { if (res.win) Sfx.stars(res.stars); }, 350);
    setTimeout(() => this.showScreen("results"), 900);   // let the last hit land
  },

  // A win offers a choice of two small permanent boosts. Each is offered once,
  // so the well runs dry around level 10 rather than snowballing forever.
  offerPerk(res, prog) {
    const box = this.el("res-perks");
    box.innerHTML = "";
    const choices = res.win && !res.mode.startsWith("duel")
      ? perkChoices(prog.perks || [], res.levelIdx) : [];
    box.style.display = choices.length ? "" : "none";
    if (!choices.length) return;
    box.innerHTML = `<div class="perk-title">🎁 Pick a reward</div>`;
    const row = document.createElement("div");
    row.className = "perk-row";
    for (const id of choices) {
      const p = PERKS[id];
      const b = document.createElement("button");
      b.className = "perk-card";
      b.innerHTML = `<span class="perk-icon">${p.icon}</span><b>${p.name}</b><span>${p.desc}</span>`;
      b.onclick = () => {
        Storage.takePerk(this.profile.id, id);
        Sfx.sparkle();
        box.innerHTML = `<div class="perk-title">🎁 ${p.icon} <b>${p.name}</b> — ${p.desc}</div>`;
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  },

  /* ============================ trophy shelf ============================ */

  showTrophies() {
    Sfx.click();
    const prog = this.progress();
    const stats = prog.stats || {};
    this.el("trophy-list").innerHTML = TROPHIES.map(t =>
      `<div class="trophy"><span class="trophy-icon">${t.icon}</span>
         <span class="trophy-label">${t.label}</span>
         <b class="trophy-num">${(stats[t.id] || 0).toLocaleString()}</b></div>`).join("");
    const perks = (prog.perks || []).map(id => PERKS[id]).filter(Boolean);
    this.el("trophy-perks").innerHTML = perks.length
      ? `<h3>🎁 Rewards earned</h3>` + perks.map(p =>
          `<div class="trophy"><span class="trophy-icon">${p.icon}</span>
             <span class="trophy-label">${p.name} — ${p.desc}</span></div>`).join("")
      : `<p class="screen-hint">Win a level to earn your first reward.</p>`;
    this.showScreen("trophies");
  },

  lossText(res) {
    if (res.why === "fallen") return "A critter fell!";
    if (res.why === "time") return "Out of turns!";
    return "Your team is worn out!";
  },

  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: r => `<span class="lb-stat">⭐ ${Storage.totalStars(r.progress)}</span>
                  <span class="lb-stat">🗺️ ${Storage.cleared(r.progress)}</span>
                  <span class="lb-stat">⚔️ ${r.progress.duelWins || 0}</span>`,
      sort: (a, b) => Storage.totalStars(b.progress) - Storage.totalStars(a.progress),
      meId: this.profile?.id,
      empty: "No players yet — tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

window.addEventListener("DOMContentLoaded", () => App.init());
