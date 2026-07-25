// The player's team. Five critters, each with ONE special power on a cooldown,
// so a kid can hold the whole roster in their head. Adding a critter is one
// entry here plus a `kind` case in Rules.usePower.
//
//   move    tiles of movement per turn (diagonals don't count — 4-way grid)
//   range   1 = melee, >1 = shoots over heads
//   armour  subtracted from incoming damage (never below 1)
//   leaper  movement ignores rocks/water/units, but can't END on them
//   flier   moves over everything and may END on water
//   thorns  damage reflected back at whoever hits it in melee
//   unlock  levels you must have cleared before it joins the team

const CRITTERS = {
  hop: {
    id: "hop", name: "Hop", emoji: "🐸", color: "#5ddb7a", unlock: 0,
    hp: 12, move: 3, atk: 3, range: 1, armour: 0, leaper: true,
    blurb: "Leaps clean over rocks and ponds.",
    power: {
      id: "tongue", name: "Tongue Snap", icon: "👅", cd: 3, range: 3,
      kind: "pull", dmg: 2,
      desc: "Yank a bug one tile closer and bonk it for 2.",
    },
  },
  digger: {
    id: "digger", name: "Digger", emoji: "🦫", color: "#c98a53", unlock: 0,
    hp: 16, move: 2, atk: 4, range: 1, armour: 1,
    blurb: "Tough, hits hard, smashes rock.",
    power: {
      id: "quake", name: "Quake", icon: "💥", cd: 4, range: 1,
      kind: "blast", dmg: 3,
      desc: "Thump the ground: 3 damage to every bug beside you, and nearby rocks crumble.",
    },
  },
  zip: {
    id: "zip", name: "Zip", emoji: "🐦", color: "#63b8ff", unlock: 0,
    hp: 10, move: 4, atk: 2, range: 3, armour: 0, flier: true,
    blurb: "Flies anywhere and pecks from a distance.",
    power: {
      id: "gust", name: "Gust", icon: "🌀", cd: 3, range: 3,
      kind: "push", push: 2, dmg: 1,
      desc: "Blow a bug 2 tiles back — aim it at the pond!",
    },
  },
  prickle: {
    id: "prickle", name: "Prickle", emoji: "🦔", color: "#d9a441", unlock: 8,
    hp: 15, move: 2, atk: 3, range: 1, armour: 1, thorns: 2,
    blurb: "Spiky — bugs hurt themselves hitting her.",
    power: {
      id: "roll", name: "Roll", icon: "🎳", cd: 3, range: 4,
      kind: "charge", dmg: 3, push: 1,
      desc: "Barrel in a straight line, bowling over every bug in the way.",
    },
  },
  buzz: {
    id: "buzz", name: "Buzz", emoji: "🐝", color: "#ffd45e", unlock: 14,
    hp: 11, move: 3, atk: 2, range: 2, armour: 0, flier: true,
    blurb: "Keeps the team patched up.",
    power: {
      id: "pollen", name: "Pollen", icon: "✨", cd: 3, range: 3,
      kind: "heal", heal: 5,
      desc: "Sprinkle pollen on a friend to heal 5.",
    },
  },
};

// Team order used when a profile hasn't picked a loadout yet.
const DEFAULT_PARTY = ["hop", "digger", "zip"];

function unlockedCritters(levelsCleared) {
  return Object.values(CRITTERS).filter(c => levelsCleared >= c.unlock).map(c => c.id);
}
