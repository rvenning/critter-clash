// The bugs. Same stat shape as CRITTERS so one engine drives both sides — the
// only extra field is `ai`, which picks how the utility scorer in js/ai.js
// weights its choices:
//
//   charge   close on the nearest critter and swing
//   weakest  ignore distance, dive on whoever has the least health left
//   kite     shoot from max range and stay out of arm's reach
//
// Extras: `web` slows what it hits for a turn, `sweep` hits everything
// adjacent at once, `summon` calls friends in every N enemy turns.

const BUGS = {
  ant: {
    id: "ant", name: "Ant", emoji: "🐜", color: "#a3703f",
    hp: 4, move: 3, atk: 2, range: 1, armour: 0, ai: "charge",
  },
  beetle: {
    id: "beetle", name: "Beetle", emoji: "🪲", color: "#6f8f4a",
    hp: 7, move: 2, atk: 3, range: 1, armour: 0, ai: "charge",
  },
  skeeter: {
    id: "skeeter", name: "Skeeter", emoji: "🦟", color: "#9d8ec9",
    hp: 5, move: 5, atk: 3, range: 1, armour: 0, flier: true, ai: "weakest",
  },
  snail: {
    id: "snail", name: "Snail", emoji: "🐌", color: "#c98fb0",
    hp: 14, move: 1, atk: 3, range: 1, armour: 2, ai: "charge",
  },
  spider: {
    id: "spider", name: "Spider", emoji: "🕷️", color: "#8d7fa8",
    hp: 7, move: 3, atk: 2, range: 3, armour: 0, web: true, ai: "kite",
  },
  scorpion: {
    id: "scorpion", name: "Scorpion", emoji: "🦂", color: "#d98a4a",
    hp: 14, move: 2, atk: 4, range: 1, armour: 1, push: 1, ai: "charge",
  },

  /* ---------- bosses ---------- */
  chomp: {
    id: "chomp", name: "Chomp", emoji: "🪲", color: "#8fbf5a", boss: true, heavy: true,
    hp: 24, move: 2, atk: 4, range: 1, armour: 1, ai: "charge",
    summon: { type: "ant", every: 3, n: 1 },
    intro: "CHOMP the giant beetle! He's armoured — Digger's Quake gets through.",
  },
  weaver: {
    id: "weaver", name: "Weaver", emoji: "🕷️", color: "#b07fd4", boss: true, heavy: true,
    // move 1: a boss that kites at the party's own speed is an endless chase,
    // not a fight. Anchoring it lets a melee team corner it in a few turns.
    hp: 22, move: 1, atk: 3, range: 3, armour: 0, web: true, ai: "kite",
    summon: { type: "spider", every: 4, n: 1 },
    intro: "THE WEAVER shoots from way back and gums you up. Close the gap fast!",
  },
  king: {
    id: "king", name: "Scorpion King", emoji: "🦂", color: "#e0713c", boss: true, heavy: true,
    // No armour: subtracting 1 from a 2-damage peck is a 50% tax, so armour on
    // a big HP pool quietly makes half the roster useless. The sweep is the
    // King's difficulty — the health bar shouldn't be too.
    hp: 28, move: 2, atk: 4, range: 1, armour: 0, sweep: true, ai: "charge",
    summon: { type: "scorpion", every: 5, n: 1 },
    intro: "THE SCORPION KING! His tail sweeps everyone standing next to him.",
  },
};
