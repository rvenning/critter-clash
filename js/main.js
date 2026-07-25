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
    Sfx.enabled = Storage.getSettings().sound;
    GK.UI.onScreenChange = (name) => {
      View.running = name === "game";
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) => `⭐ ${Storage.totalStars(prog)}/${LEVELS.length * 3} · 🗺️ ${Storage.cleared(prog)} levels`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Player",
    });

    Game.autoRunAi = false;            // render.js paces the bugs' turn
    Game.onEvent = (ev) => View.onEvent(ev);
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

  startLevel(idx) {
    const lv = LEVELS[idx];
    const party = Storage.party(this.progress(), lv.party.length);
    Game.startLevel(idx, party);
    this.el("hud-level").textContent = `${idx + 1}. ${lv.name}`;
    this.lastTurn = null;
    this.showScreen("game");
    View.start();
    if (lv.boss) {
      Sfx.bossRoar();
      View.say(BUGS[lv.boss].name.toUpperCase() + "!", BUGS[lv.boss].intro);
    }
    this.onChange();
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
        card.innerHTML = open ? `
          <span class="crit-emoji">${c.emoji}</span>
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
    };
    render();
    this.showScreen("team");
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
    this.lastTurn = null;
    this.showScreen("game");
    View.start();
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
      card.innerHTML = `
        <span class="sel-emoji">${u.def.emoji}</span>
        <span class="sel-info">
          <b>${u.def.name}</b>
          <span class="sel-hp"><i style="width:${Math.max(0, u.hp / u.maxHp) * 100}%"></i></span>
          <span class="sel-num">❤️ ${u.hp}/${u.maxHp}${u.webbed ? " · 🕸️ slowed" : ""}</span>
        </span>`;
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
    const prog = Storage.recordResult(this.profile.id, res);
    const duel = res.mode === "duel";
    this.el("res-emoji").textContent = res.win ? (duel ? "🏆" : res.stars === 3 ? "🌟" : "🎉") : "😿";
    this.el("res-title").textContent = duel
      ? `${res.winner === "p" ? "Player 1" : "Player 2"} wins!`
      : res.win ? (LEVELS[res.levelIdx].boss ? "BOSS BEATEN!" : `Level ${res.levelIdx + 1} clear!`)
        : this.lossText(res);
    this.el("res-stars").innerHTML = duel ? "" :
      [0, 1, 2].map(s => `<span class="star ${s < res.stars ? "on" : ""}">★</span>`).join("");
    this.el("res-detail").textContent = duel ? `${prog.duelWins} duels won on this profile`
      : res.win ? `Finished in ${res.turns} turns (par ${res.par})${res.clean ? " · nobody fell" : ""}`
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
    setTimeout(() => { if (res.win) Sfx.stars(res.stars); }, 350);
    setTimeout(() => this.showScreen("results"), 900);   // let the last hit land
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
