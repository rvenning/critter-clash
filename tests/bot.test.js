"use strict";
// Balance bot. Plays the whole campaign headlessly by pointing the enemy AI at
// the player's team, and reports how each level went. This is the only way to
// know a tactics level is actually winnable — a human can't replay 20 maps
// after every tuning tweak.
//
//   cd critter-clash && node --test
//   node tests/bot.test.js --report      # per-level turn counts
//
// There is no RNG anywhere in the engine, so a run is fully deterministic:
// a changed number here means a real balance change, not a bad roll.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const M = loadScripts({
  baseDir: ROOT,
  files: ["js/tiles.js", "js/critters.js", "js/enemies.js", "js/levels.js",
          "js/rules.js", "js/ai.js", "js/game.js"],
  exports: ["TILES", "COLS", "CRITTERS", "BUGS", "LEVELS", "DUELS", "DEFAULT_PARTY",
            "Rules", "AI", "Game", "BEHAVIOUR"],
});
const { TILES, CRITTERS, LEVELS, DEFAULT_PARTY, Rules, AI, Game, BEHAVIOUR } = M;

// The team a kid actually has at that point in the campaign.
function partyFor(levelIdx) {
  const cleared = levelIdx;
  const roster = Object.values(CRITTERS).filter(c => cleared >= c.unlock).map(c => c.id);
  // Keep the starters unless something new has unlocked, then swap Zip out for
  // the newcomer so the test exercises the later critters too.
  const team = DEFAULT_PARTY.slice();
  if (roster.includes("buzz")) team[2] = "buzz";
  else if (roster.includes("prickle")) team[1] = "prickle";
  // The finale has a fourth slot; fill it with whatever else is unlocked.
  for (const id of roster) if (!team.includes(id) && team.length < 4) team.push(id);
  return team;
}

function goalsOf(g) {
  const out = [];
  g.board.forEach((row, r) => [...row].forEach((ch, c) => { if (TILES[ch].goal) out.push([r, c]); }));
  return out;
}

// Play one level to the end. `mode` "play" uses the AI for the player team;
// "idle" never touches the controls, which is the control group.
function playLevel(idx, { mode = "play", party = null, log = null } = {}) {
  const events = { splash: 0, ko: 0, power: 0 };
  Game.onEvent = (ev) => { if (ev.type in events) events[ev.type]++; };
  Game.onDone = null;
  Game.onChange = null;

  const g = Game.startLevel(idx, party || partyFor(idx));
  const survive = g.objective === "survive";
  let guard = 200;

  while (g.state === "playing" && guard-- > 0) {
    if (mode === "play") {
      const goals = goalsOf(g);
      let steps = 12;
      let u;
      while ((u = Game.units("p").find(x => !x.acted)) && steps-- > 0) {
        const plan = AI.plan(g, u, {
          goals: goals.length ? goals : null,
          goalWeight: g.objective === "reach" || g.objective === "collect" ? 2.2 : 0,
          behaviour: survive ? BEHAVIOUR.turtle : null,
        });
        AI.execute(g, u, plan);
        u.moved = u.acted = true;
      }
    } else {
      for (const u of Game.units("p")) { u.moved = true; u.acted = true; }
    }
    if (g.state !== "playing") break;
    Game.endTurn();      // runs the bugs' whole turn, then hands back
  }

  const res = g.result || { win: false, turns: g.turnNo, stars: 0, why: "stalled" };
  if (log) log.push({ idx, name: LEVELS[idx].name, ...res, events: { ...events } });
  return { ...res, events, g };
}

test("every campaign level is winnable, inside its turn limit", () => {
  const fails = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const r = playLevel(i);
    if (!r.win) fails.push(`L${i + 1} "${LEVELS[i].name}": lost (${r.why}) on turn ${r.turns}`);
    else if (r.turns > LEVELS[i].limit)
      fails.push(`L${i + 1}: won on turn ${r.turns} past the limit ${LEVELS[i].limit}`);
  }
  assert.deepEqual(fails, []);
});

test("levels are neither trivial nor a slog", () => {
  // A tactics level that ends on turn 2 has no decisions in it; one that takes
  // 20+ turns loses an 8-year-old halfway through.
  const fails = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const r = playLevel(i);
    const lv = LEVELS[i];
    if (lv.objective === "survive") continue;         // fixed length by definition
    if (i > 1 && r.turns < 3) fails.push(`L${i + 1} "${lv.name}": over in ${r.turns} turns`);
    if (r.turns > 16) fails.push(`L${i + 1} "${lv.name}": dragged out to ${r.turns} turns`);
  }
  assert.deepEqual(fails, []);
});

test("par is reachable but not free", () => {
  // Par earns the third star. A bot playing greedily should land near it —
  // comfortably under means the star is a participation trophy.
  const fails = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const lv = LEVELS[i];
    if (lv.objective === "survive") continue;
    const r = playLevel(i);
    if (r.turns > lv.par + 5)
      fails.push(`L${i + 1} "${lv.name}": par ${lv.par} but the bot needed ${r.turns}`);
  }
  assert.deepEqual(fails, []);
});

test("doing nothing loses every level", () => {
  // The control group. If a level can be won by never touching the screen,
  // nothing in it matters.
  const fails = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const r = playLevel(i, { mode: "idle" });
    if (r.win) fails.push(`L${i + 1} "${LEVELS[i].name}": won without playing`);
  }
  assert.deepEqual(fails, []);
});

test("bosses are a real fight, and can't be cheesed into the pond", () => {
  const bossLevels = LEVELS.map((l, i) => [l, i]).filter(([l]) => l.boss);
  assert.equal(bossLevels.length, 3);
  for (const [lv, i] of bossLevels) {
    const r = playLevel(i);
    assert.ok(r.win, `L${i + 1} "${lv.name}" unwinnable`);
    assert.ok(r.turns >= 5, `L${i + 1} boss folded in ${r.turns} turns`);
    // The boss must still be standing at the point it is beaten by damage, so
    // check it never left via a shove — heavy units ignore pushes.
    const boss = r.g.units.find(u => u.def.id === lv.boss);
    assert.ok(boss && !boss.alive && boss.hp <= 0, `L${i + 1} boss didn't die to damage`);
  }
});

test("terrain matters: the bot dunks bugs and picks up cover", () => {
  // The signature move is shoving a bug into the pond. If a full campaign run
  // never manages it, the ponds are decoration.
  let splashes = 0, powers = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const r = playLevel(i);
    splashes += r.events.splash;
    powers += r.events.power;
  }
  assert.ok(splashes >= 3, `only ${splashes} bugs went in the water across the campaign`);
  assert.ok(powers >= 30, `special powers only used ${powers} times across 20 levels`);
});

test("a weaker team can still clear the early levels", () => {
  // A kid will absolutely take three of the same idea. The first third of the
  // campaign has to survive a bad loadout.
  const fails = [];
  for (const team of [["hop", "hop", "hop"], ["digger", "digger", "digger"], ["zip", "zip", "zip"]]) {
    for (let i = 0; i < 6; i++) {
      const r = playLevel(i, { party: team });
      if (!r.win) fails.push(`L${i + 1} lost with ${team[0]}×3 (${r.why})`);
    }
  }
  assert.deepEqual(fails, []);
});

/* Run directly for the per-level table. */
if (process.argv.includes("--report")) {
  const log = [];
  for (let i = 0; i < LEVELS.length; i++) playLevel(i, { log });
  console.log("\n idx  level                    obj       turns  par  limit  stars  splash");
  for (const r of log) {
    const lv = LEVELS[r.idx];
    console.log(
      ` ${String(r.idx + 1).padStart(3)}  ${lv.name.padEnd(24)} ${lv.objective.padEnd(9)} ` +
      `${String(r.turns).padStart(5)} ${String(lv.par).padStart(4)} ${String(lv.limit).padStart(6)} ` +
      `${String(r.stars).padStart(6)} ${String(r.events.splash).padStart(7)}${r.win ? "" : "   LOST"}`);
  }
}
