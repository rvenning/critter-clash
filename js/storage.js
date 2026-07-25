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
    duelWins: 0,
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
    return {
      ...a, ...b,
      levels,
      duelWins: Math.max(a.duelWins || 0, b.duelWins || 0),
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
