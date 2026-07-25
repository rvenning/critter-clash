// Things to collect. None of this changes how a critter moves or fights except
// PERKS, which are deliberately small — the point is a reason to come back, not
// a power spiral.
//
//   HATS   cosmetic only, unlocked with stars, worn by any critter
//   PERKS  one chosen after each level win, permanent, each offered once
//   TROPHIES  lifetime counters shown on the shelf

const HATS = {
  // Every hat has to read against a green critter on green grass, which rules
  // out the obvious leaf.
  bow:     { id: "bow",     emoji: "🎀", name: "Red Bow",     stars: 3 },
  party:   { id: "party",   emoji: "🎉", name: "Party Hat",   stars: 8 },
  cap:     { id: "cap",     emoji: "🧢", name: "Ball Cap",    stars: 14 },
  flower:  { id: "flower",  emoji: "🌸", name: "Blossom",     stars: 20 },
  helmet:  { id: "helmet",  emoji: "⛑️", name: "Hard Hat",    stars: 28 },
  tophat:  { id: "tophat",  emoji: "🎩", name: "Top Hat",     stars: 36 },
  wizard:  { id: "wizard",  emoji: "🪄", name: "Wand & Star", stars: 45 },
  crown:   { id: "crown",   emoji: "👑", name: "Crown",       stars: 55 },
};

function unlockedHats(totalStars) {
  return Object.values(HATS).filter(h => totalStars >= h.stars);
}

// Perks are applied when a unit is created (js/game.js). Keep every one small
// and legible — a child should be able to point at a perk and say what it did.
const PERKS = {
  hearty:   { id: "hearty",   icon: "❤️", name: "Hearty",      desc: "Every critter gets +2 health." },
  swift:    { id: "swift",    icon: "👟", name: "Swift Feet",  desc: "Hop and Zip move one square further." },
  strong:   { id: "strong",   icon: "💪", name: "Strong Arms", desc: "Digger and Prickle hit for 1 more." },
  ready:    { id: "ready",    icon: "⚡", name: "Warmed Up",   desc: "Everyone starts each level with their special ready." },
  quick:    { id: "quick",    icon: "🔁", name: "Quick Study", desc: "Specials recharge one turn sooner." },
  tough:    { id: "tough",    icon: "🛡️", name: "Thick Skin",  desc: "Every critter takes 1 less damage from bugs." },
  sharp:    { id: "sharp",    icon: "🎯", name: "Sharp Eyes",  desc: "Zip and Buzz shoot one square further." },
  bouncy:   { id: "bouncy",   icon: "🦘", name: "Bouncy",      desc: "Hop's leap and Prickle's roll go one square further." },
  lucky:    { id: "lucky",    icon: "🍀", name: "Lucky Charm", desc: "Everyone gets +1 health and +1 damage." },
  brave:    { id: "brave",    icon: "🦁", name: "Brave Heart", desc: "Critters below half health hit for 1 more." },
};

// Two choices after a win, drawn from what this profile hasn't taken yet.
// Deterministic from the level index so re-reading the same result screen
// can't reroll into something better.
function perkChoices(taken, levelIdx) {
  const pool = Object.keys(PERKS).filter(id => !taken.includes(id));
  if (pool.length <= 2) return pool;
  const a = pool[(levelIdx * 7) % pool.length];
  const rest = pool.filter(id => id !== a);
  const b = rest[(levelIdx * 5 + 3) % rest.length];
  return [a, b];
}

// Applied to every unit as it's built. `def` is the registry entry, `u` the
// live unit — mutate the unit, never the shared def.
function applyPerks(perks, def, u) {
  if (!perks || !perks.length || u.side !== "p") return u;
  const has = (id) => perks.includes(id);
  if (has("hearty")) { u.hp += 2; u.maxHp += 2; }
  if (has("lucky")) { u.hp += 1; u.maxHp += 1; u.atk += 1; }
  if (has("swift") && (def.id === "hop" || def.id === "zip")) u.move += 1;
  if (has("strong") && (def.id === "digger" || def.id === "prickle")) u.atk += 1;
  if (has("sharp") && (def.id === "zip" || def.id === "buzz")) u.range += 1;
  if (has("tough")) u.armour += 1;
  if (has("quick")) u.cdBonus += 1;
  if (has("brave")) u.brave = true;
  if (has("bouncy")) {
    if (def.id === "hop") u.move += 1;
    if (def.id === "prickle") u.powerRange += 1;
  }
  return u;
}

const TROPHIES = [
  { id: "bonked",  icon: "👊", label: "Bugs bonked" },
  { id: "dunked",  icon: "💦", label: "Bugs dunked in the pond" },
  { id: "berries", icon: "🍓", label: "Berries collected" },
  { id: "powers",  icon: "✨", label: "Special moves used" },
  { id: "perfect", icon: "🌟", label: "Levels won without a scratch" },
  { id: "turns",   icon: "⏳", label: "Turns taken" },
  { id: "duels",   icon: "⚔️", label: "Duels won" },
  { id: "fallen",  icon: "😿", label: "Critters carried home" },
];
