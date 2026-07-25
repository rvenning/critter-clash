// Persistence: gamekit storage configured for Critter Clash.
// cc_* localStorage keys, "critterclash" Firestore collection.
//
// Nothing here is spendable, so every field merges by max — two devices can
// never take progress away from each other. The chosen team is the exception:
// it's a preference, not an achievement, so the newer write simply wins.

// Named rather than inlined into createStorage, which keeps them in a closure:
// the merge is the one function that can permanently destroy a save, so
// tests/storage.test.js has to be able to call it directly.
const PROGRESS = {
  blank: () => ({
    levels: {},            // { [idx]: { stars, turns } } best result per level
    party: null,           // chosen loadout, e.g. ["hop","digger","zip"]
    hats: {},              // { [critterId]: hatId } — cosmetic only
    perks: [],             // permanent boosts chosen after a level win
    stats: {},             // lifetime counters for the trophy shelf
    duelWins: 0,
    seenHelp: false,
    updated: 0,
  }),

  merge: (a, b) => {
    const levels = { ...(a.levels || {}) };
    for (const [idx, lv] of Object.entries(b.levels || {})) {
      const cur = levels[idx];
      levels[idx] = !cur ? lv : {
        stars: Math.max(cur.stars || 0, lv.stars || 0),
        turns: Math.min(cur.turns || 999, lv.turns || 999),   // fewer turns is better
      };
    }
    // Trophy counters are lifetime totals, so the bigger number is the one
    // that has seen more play. Perks and hats are sets: keep everything.
    const stats = { ...(a.stats || {}) };
    for (const [k, v] of Object.entries(b.stats || {})) stats[k] = Math.max(stats[k] || 0, v || 0);
    const perks = [...new Set([...(a.perks || []), ...(b.perks || [])])];
    return {
      ...a, ...b,
      levels, stats, perks,
      hats: { ...(a.hats || {}), ...(b.hats || {}) },
      duelWins: Math.max(a.duelWins || 0, b.duelWins || 0),
      seenHelp: !!(a.seenHelp || b.seenHelp),
      party: b.party || a.party,
    };
  },
};

const Storage = GK.createStorage({
  prefix: "cc",
  collection: "critterclash",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});

/* ----- Critter Clash helpers ----- */
Object.assign(Storage, {
  totalStars(progress) {
    return Object.values(progress.levels || {}).reduce((s, l) => s + (l.stars || 0), 0);
  },

  // How many levels have been cleared — this is what unlocks new critters.
  cleared(progress) { return Object.keys(progress.levels || {}).length; },

  // Levels unlock in order: the one after the highest you've finished.
  unlockedLevel(progress) {
    let max = -1;
    for (const k of Object.keys(progress.levels || {})) max = Math.max(max, Number(k));
    return Math.min(max + 1, LEVELS.length - 1);
  },

  // The saved loadout, filtered to what's actually unlocked, topped up to
  // `slots` so a stale save can never deploy a locked critter or a short team.
  party(progress, slots) {
    const open = unlockedCritters(this.cleared(progress));
    const out = (progress.party || DEFAULT_PARTY).filter(id => open.includes(id));
    for (const id of [...DEFAULT_PARTY, ...open]) {
      if (out.length >= (slots || 3)) break;
      if (!out.includes(id)) out.push(id);
    }
    return out.slice(0, slots || 3);
  },

  saveParty(profileId, party) {
    const prog = this.getProgress(profileId);
    prog.party = party;
    this.saveProgress(profileId, prog);
    return prog;
  },

  // Lifetime counters for the trophy shelf. Monotonic, so max() merging across
  // devices can never lose a tally.
  bump(profileId, counts) {
    const prog = this.getProgress(profileId);
    prog.stats = prog.stats || {};
    for (const [k, v] of Object.entries(counts)) prog.stats[k] = (prog.stats[k] || 0) + v;
    this.saveProgress(profileId, prog);
    return prog;
  },

  takePerk(profileId, perkId) {
    const prog = this.getProgress(profileId);
    prog.perks = [...new Set([...(prog.perks || []), perkId])];
    this.saveProgress(profileId, prog);
    return prog;
  },

  setHat(profileId, critterId, hatId) {
    const prog = this.getProgress(profileId);
    prog.hats = prog.hats || {};
    if (hatId) prog.hats[critterId] = hatId; else delete prog.hats[critterId];
    this.saveProgress(profileId, prog);
    return prog;
  },

  recordResult(profileId, result) {
    const prog = this.getProgress(profileId);
    if (result.mode === "duel") {
      if (result.win) prog.duelWins = (prog.duelWins || 0) + 1;
    } else if (result.win) {
      const cur = prog.levels[result.levelIdx];
      prog.levels[result.levelIdx] = {
        stars: Math.max(result.stars, (cur && cur.stars) || 0),
        turns: Math.min(result.turns, (cur && cur.turns) || 999),
      };
    }
    this.saveProgress(profileId, prog);
    return prog;
  },
});
