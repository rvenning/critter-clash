"use strict";
// Progress + cross-device merge. These are the functions that can silently
// destroy a kid's save: two iPads syncing through Firestore both call
// mergeProgress, and a mistake there takes stars away permanently.
//
//   cd critter-clash && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const { Storage, PROGRESS, LEVELS, CRITTERS } = loadScripts({
  baseDir: ROOT,
  browser: true,
  files: ["js/tiles.js", "js/critters.js", "js/enemies.js", "js/levels.js",
          "lib/gk-util.js", "lib/gk-storage.js", "js/storage.js"],
  // No firebase-config.js: window.FIREBASE_CONFIG stays undefined, which is
  // how createStorage is told to run offline-only.
  exports: ["Storage", "PROGRESS", "LEVELS", "CRITTERS"],
});

const merge = PROGRESS.merge;
const blank = PROGRESS.blank;

test("merging keeps the best of both devices", () => {
  const iPad = { ...blank(), levels: { 0: { stars: 3, turns: 4 }, 1: { stars: 1, turns: 12 } }, duelWins: 2 };
  const phone = { ...blank(), levels: { 1: { stars: 2, turns: 9 }, 2: { stars: 2, turns: 7 } }, duelWins: 5 };
  const m = merge(iPad, phone);
  assert.deepEqual(m.levels[0], { stars: 3, turns: 4 }, "a level only one device has survives");
  assert.deepEqual(m.levels[1], { stars: 2, turns: 9 }, "best stars AND fewest turns win");
  assert.deepEqual(m.levels[2], { stars: 2, turns: 7 });
  assert.equal(m.duelWins, 5);
});

test("merging is symmetric and never loses stars", () => {
  const a = { ...blank(), levels: { 3: { stars: 3, turns: 5 } } };
  const b = { ...blank(), levels: { 3: { stars: 1, turns: 20 } } };
  assert.deepEqual(merge(a, b).levels[3], merge(b, a).levels[3]);
  assert.equal(merge(b, a).levels[3].stars, 3, "an older device must not overwrite a better result");
});

test("a field a newer version added survives an older client's merge", () => {
  const older = { ...blank(), levels: {} };
  const newer = { ...blank(), levels: {}, futureField: 42 };
  assert.equal(merge(older, newer).futureField, 42);
});

test("the team preference follows the newer write, not the max", () => {
  const a = { ...blank(), party: ["hop", "digger", "zip"] };
  const b = { ...blank(), party: ["prickle", "buzz", "hop"] };
  assert.deepEqual(merge(a, b).party, ["prickle", "buzz", "hop"]);
  assert.deepEqual(merge(b, { ...blank(), party: null }).party, ["prickle", "buzz", "hop"],
    "a device that never chose a team shouldn't wipe one that did");
});

test("levels unlock strictly in order", () => {
  assert.equal(Storage.unlockedLevel(blank()), 0);
  assert.equal(Storage.unlockedLevel({ ...blank(), levels: { 0: { stars: 1 }, 1: { stars: 1 } } }), 2);
  const all = { ...blank(), levels: {} };
  for (let i = 0; i < LEVELS.length; i++) all.levels[i] = { stars: 3, turns: 4 };
  assert.equal(Storage.unlockedLevel(all), LEVELS.length - 1, "never points past the last level");
  assert.equal(Storage.totalStars(all), LEVELS.length * 3);
});

test("the deployed party is always legal, whatever is in the save", () => {
  // A save from a future version, a save naming a locked critter, and a save
  // with a half-empty team all have to produce a full, unlocked team.
  const fresh = blank();
  assert.deepEqual(Storage.party(fresh, 3).sort(), ["digger", "hop", "zip"]);

  const cheeky = { ...blank(), party: ["buzz", "prickle", "buzz"] };
  const team = Storage.party(cheeky, 3);
  assert.equal(team.length, 3);
  for (const id of team) assert.ok(CRITTERS[id], `unknown critter ${id}`);
  assert.deepEqual(team.filter(id => CRITTERS[id].unlock > 0), [],
    "a save can't deploy critters this profile hasn't unlocked yet");

  const done = { ...blank(), levels: {}, party: ["buzz"] };
  for (let i = 0; i < 15; i++) done.levels[i] = { stars: 3, turns: 4 };
  const four = Storage.party(done, 4);
  assert.equal(four.length, 4, "the finale's fourth slot always gets filled");
  assert.equal(new Set(four).size, 4, "and never with the same critter twice");
  assert.ok(four.includes("buzz"), "the player's own pick comes first");
});

test("recording a result only ever improves a level", () => {
  const id = "p1";
  Storage.saveProgress(id, { ...blank(), levels: { 0: { stars: 3, turns: 4 } } });
  Storage.recordResult(id, { mode: "campaign", win: true, levelIdx: 0, stars: 1, turns: 11 });
  assert.deepEqual(Storage.getProgress(id).levels[0], { stars: 3, turns: 4 }, "a sloppy replay can't demote a 3-star");

  Storage.recordResult(id, { mode: "campaign", win: false, levelIdx: 1, stars: 0, turns: 9 });
  assert.equal(Storage.getProgress(id).levels[1], undefined, "a loss must not unlock the next level");

  Storage.recordResult(id, { mode: "duel", win: true });
  Storage.recordResult(id, { mode: "duel", win: false });
  assert.equal(Storage.getProgress(id).duelWins, 1, "only duel wins count");
});
