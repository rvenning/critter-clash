"use strict";
// Data linter for the campaign. A mistyped map row or a unit standing inside a
// rock is invisible until a kid opens the level, so it fails here instead.
//
//   cd critter-clash && node --test

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const M = loadScripts({
  baseDir: ROOT,
  files: ["js/tiles.js", "js/critters.js", "js/enemies.js", "js/levels.js", "js/rewards.js"],
  exports: ["TILES", "COLS", "CRITTERS", "BUGS", "LEVELS", "DUELS", "WEATHER", "DEFAULT_PARTY",
            "unlockedCritters", "HATS", "PERKS", "TROPHIES", "perkChoices", "unlockedHats"],
});
const { TILES, COLS, CRITTERS, BUGS, LEVELS, DUELS, WEATHER, DEFAULT_PARTY, unlockedCritters,
        HATS, PERKS, TROPHIES, perkChoices, unlockedHats } = M;

const tileAt = (rows, r, c) =>
  (r < 0 || c < 0 || r >= rows.length || c >= COLS) ? null : TILES[rows[r][c]];

// Where can a unit of this kind stand / walk through? Mirrors Rules.canPass /
// canEnd — kept as its own tiny copy so a bug in the engine can't make a
// broken level lint clean.
function walkable(rows, r, c, { flier = false, leaper = false } = {}) {
  const t = tileAt(rows, r, c);
  if (!t) return false;
  if (flier || leaper) return !t.solid;
  return !t.solid && !t.water;
}

function flood(rows, from, kind) {
  const seen = new Set([from.join(",")]);
  const q = [from];
  while (q.length) {
    const [r, c] = q.pop();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc, k = nr + "," + nc;
      if (seen.has(k)) continue;
      if (!walkable(rows, nr, nc, kind)) continue;
      seen.add(k); q.push([nr, nc]);
    }
  }
  return seen;
}

const allMaps = () => [
  ...LEVELS.map((l, i) => ({ label: `L${i + 1} "${l.name}"`, rows: l.rows })),
  ...DUELS.map((d, i) => ({ label: `Duel ${i + 1} "${d.name}"`, rows: d.rows })),
];

test("campaign shape: 20 levels, bosses at 7/14/20, every boss is registered", () => {
  assert.equal(LEVELS.length, 20);
  LEVELS.forEach((lv, i) => {
    const shouldBoss = [7, 14, 20].includes(i + 1);
    assert.equal(!!lv.boss, shouldBoss, `L${i + 1} boss flag`);
    if (lv.boss) {
      assert.ok(BUGS[lv.boss] && BUGS[lv.boss].boss, `L${i + 1} unknown boss "${lv.boss}"`);
      assert.ok(lv.bugs.some(b => b.t === lv.boss), `L${i + 1} boss not placed on the map`);
    }
  });
});

test("every map row is exactly COLS wide with known tile characters", () => {
  const fails = [];
  for (const { label, rows } of allMaps()) {
    rows.forEach((row, r) => {
      if (row.length !== COLS) fails.push(`${label} row ${r}: width ${row.length}`);
      for (const ch of row) if (!TILES[ch]) fails.push(`${label} row ${r}: unknown tile "${ch}"`);
    });
    if (rows.length < 6 || rows.length > 11) fails.push(`${label}: ${rows.length} rows`);
  }
  assert.deepEqual(fails, []);
});

test("every unit starts on a tile it could stand on, and nothing overlaps", () => {
  const fails = [];
  LEVELS.forEach((lv, i) => {
    const label = `L${i + 1} "${lv.name}"`;
    const taken = new Map();
    const place = (r, c, who, kind) => {
      const t = tileAt(lv.rows, r, c);
      if (!t) return fails.push(`${label}: ${who} spawns off the map at ${r},${c}`);
      if (t.solid) return fails.push(`${label}: ${who} spawns inside a ${t.name} at ${r},${c}`);
      if (t.water && !kind.flier) fails.push(`${label}: ${who} spawns in the pond at ${r},${c}`);
      if (t.hazard) fails.push(`${label}: ${who} spawns on ${t.name} at ${r},${c}`);
      const k = r + "," + c;
      if (taken.has(k)) fails.push(`${label}: ${who} spawns on top of ${taken.get(k)}`);
      taken.set(k, who);
    };
    // Player spawns must suit ANY loadout, so check them as plain walkers.
    lv.party.forEach(([r, c], n) => place(r, c, `party slot ${n + 1}`, {}));
    lv.bugs.forEach(b => {
      if (!BUGS[b.t]) return fails.push(`${label}: unknown bug "${b.t}"`);
      place(b.r, b.c, b.t, BUGS[b.t]);
    });
    // 3 slots normally; the tutorial gets 2 and the finale gets 4.
    if (lv.party.length < 2 || lv.party.length > 4) fails.push(`${label}: ${lv.party.length} party slots`);
  });
  assert.deepEqual(fails, []);
});

test("objectives match the map: berries exist iff the level wants them", () => {
  const fails = [];
  LEVELS.forEach((lv, i) => {
    const label = `L${i + 1} "${lv.name}"`;
    let berries = 0;
    for (const row of lv.rows) for (const ch of row) if (TILES[ch].goal) berries++;
    if (lv.objective === "reach" && berries !== 1) fails.push(`${label}: "reach" wants 1 berry, has ${berries}`);
    if (lv.objective === "collect" && berries < 2) fails.push(`${label}: "collect" wants 2+ berries, has ${berries}`);
    if ((lv.objective === "defeat" || lv.objective === "survive") && berries)
      fails.push(`${label}: "${lv.objective}" level has ${berries} stray berries`);
    if (lv.objective === "survive") {
      if (!lv.survive) fails.push(`${label}: survive level has no turn count`);
      else if (lv.limit < lv.survive) fails.push(`${label}: limit ${lv.limit} < survive ${lv.survive}`);
    }
    if (!(lv.par >= 3 && lv.par <= lv.limit)) fails.push(`${label}: par ${lv.par} vs limit ${lv.limit}`);
  });
  assert.deepEqual(fails, []);
});

test("a plain walker can reach every berry and every bug from every spawn", () => {
  // The nastiest way to ship a broken level: an objective only a flier can get
  // to, while the player brought three ground critters. Flood fill from each
  // party spawn as a walker and demand the objective is in there.
  const fails = [];
  LEVELS.forEach((lv, i) => {
    const label = `L${i + 1} "${lv.name}"`;
    const goals = [];
    lv.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (TILES[ch].goal) goals.push([r, c]); }));
    const targets = lv.objective === "reach" || lv.objective === "collect"
      ? goals
      : lv.bugs.filter(b => !BUGS[b.t].flier).map(b => [b.r, b.c]);

    for (const spawn of lv.party) {
      const seen = flood(lv.rows, spawn, {});
      for (const [tr, tc] of targets) {
        // Reaching a bug means reaching a tile NEXT to it.
        const ok = lv.objective === "reach" || lv.objective === "collect"
          ? seen.has(tr + "," + tc)
          : [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => seen.has((tr + dr) + "," + (tc + dc)));
        if (!ok) fails.push(`${label}: walker at ${spawn} can't reach ${tr},${tc}`);
      }
    }
  });
  assert.deepEqual(fails, []);
});

test("duel maps are symmetric enough to be fair", () => {
  const fails = [];
  DUELS.forEach((d, i) => {
    const label = `Duel ${i + 1} "${d.name}"`;
    if (d.a.length !== d.b.length) fails.push(`${label}: uneven teams`);
    if (d.a.length !== 3) fails.push(`${label}: expected 3 spawns a side`);
    // Rotating the map 180° must give the same map back.
    const R = d.rows.length;
    for (let r = 0; r < R; r++) for (let c = 0; c < COLS; c++) {
      const mirror = d.rows[R - 1 - r][COLS - 1 - c];
      if (d.rows[r][c] !== mirror) fails.push(`${label}: not symmetric at ${r},${c}`);
    }
    for (const [r, c] of [...d.a, ...d.b]) {
      const t = tileAt(d.rows, r, c);
      if (!t || t.solid || t.water || t.hazard) fails.push(`${label}: bad spawn ${r},${c}`);
    }
  });
  assert.deepEqual(fails, []);
});

test("every named weather is a real one", () => {
  for (const lv of LEVELS)
    if (lv.weather) assert.ok(WEATHER[lv.weather], `"${lv.name}" has unknown weather "${lv.weather}"`);
  assert.deepEqual(WEATHER.wind.dir.length, 2, "wind needs a direction");
});

test("scenery and pickups are placed somewhere reachable, and never under a spawn", () => {
  const fails = [];
  LEVELS.forEach((lv, i) => {
    const label = `L${i + 1} "${lv.name}"`;
    const taken = new Set([...lv.party.map(([r, c]) => r + "," + c),
                           ...lv.bugs.map(b => b.r + "," + b.c)]);
    lv.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const t = TILES[ch];
      if (!t.pickup && !t.bounce && !t.sticky && !t.hive) return;
      if (taken.has(r + "," + c)) fails.push(`${label}: ${t.name} at ${r},${c} is under a unit`);
      // A pickup nobody can walk to is just decoration; check from every spawn.
      if (t.pickup) {
        const ok = lv.party.some(sp => flood(lv.rows, sp, {}).has(r + "," + c));
        if (!ok) fails.push(`${label}: ${t.name} at ${r},${c} is unreachable on foot`);
      }
    }));
  });
  assert.deepEqual(fails, []);
});

test("reward tables are sane: hats unlock in order, perks are all applicable", () => {
  const stars = Object.values(HATS).map(h => h.stars);
  assert.deepEqual(stars, [...stars].sort((a, b) => a - b), "hats should be listed cheapest first");
  assert.ok(Math.max(...stars) <= LEVELS.length * 3, "a hat costs more stars than the game contains");
  assert.equal(unlockedHats(0).length, 0, "nothing free at zero stars");
  assert.equal(unlockedHats(999).length, Object.keys(HATS).length);
  for (const [id, p] of Object.entries(PERKS)) {
    assert.equal(p.id, id);
    assert.ok(p.name && p.desc && p.icon, `perk ${id} needs presentation`);
  }
  // The offer must always be two DIFFERENT perks until the pool runs dry.
  for (let taken = 0; taken < Object.keys(PERKS).length - 2; taken++) {
    const have = Object.keys(PERKS).slice(0, taken);
    for (let lv = 0; lv < LEVELS.length; lv++) {
      const c = perkChoices(have, lv);
      assert.equal(c.length, 2, `level ${lv + 1} with ${taken} taken offered ${c.length}`);
      assert.notEqual(c[0], c[1], "offered the same perk twice");
      assert.deepEqual(c.filter(id => have.includes(id)), [], "offered a perk already taken");
    }
  }
  assert.deepEqual(perkChoices(Object.keys(PERKS), 0), [], "nothing left to offer");
  for (const t of TROPHIES) assert.ok(t.icon && t.label && t.id);
});

test("critter and bug registries are internally consistent", () => {
  for (const [id, c] of Object.entries(CRITTERS)) {
    assert.equal(c.id, id, `${id} id mismatch`);
    assert.ok(c.hp >= 5 && c.hp <= 16, `${id} hp ${c.hp}`);
    assert.ok(c.move >= 1 && c.move <= 5, `${id} move ${c.move}`);
    assert.ok(c.power && c.power.cd >= 2 && c.power.desc, `${id} power`);
    assert.ok(c.emoji && c.color && c.blurb, `${id} presentation`);
  }
  for (const [id, b] of Object.entries(BUGS)) {
    assert.equal(b.id, id, `${id} id mismatch`);
    assert.ok(["charge", "weakest", "kite"].includes(b.ai), `${id} unknown ai "${b.ai}"`);
    assert.ok(b.hp > 0 && b.atk > 0, `${id} stats`);
    if (b.boss) {
      assert.ok(b.heavy, `boss ${id} must be heavy — a shove into the pond would end it instantly`);
      assert.ok(b.intro, `boss ${id} needs an intro line`);
    }
  }
  assert.deepEqual(DEFAULT_PARTY.filter(id => !CRITTERS[id]), [], "default party has an unknown critter");
  assert.deepEqual(unlockedCritters(0).sort(), [...DEFAULT_PARTY].sort(), "level 1 should offer exactly the starters");
  assert.equal(unlockedCritters(99).length, Object.keys(CRITTERS).length, "everything unlocks eventually");
});
