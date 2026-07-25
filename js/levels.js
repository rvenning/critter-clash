// The campaign. Every level is an 8-wide ASCII map (chars from js/tiles.js)
// plus explicit unit placements — terrain in the map, units in a list, so a
// typo in one can't silently become the other. tests/levels.test.js lints all
// of it: row widths, unknown chars, units on solid ground, overlaps, and a
// flood fill proving a walking critter can actually reach the objective.
//
//   objective  "defeat" all bugs · "reach" a berry · "collect" every berry
//              · "survive" N of your turns
//   par        turns for the 3rd star (also needs a full team at the end)
//   limit      hard turn limit — run out and the level is lost
//
// Bosses at 7, 14 and 20. Prickle joins after level 8, Buzz after level 14.

// One optional rule per level, announced on the opening banner.
const WEATHER = {
  wind: { id: "wind", icon: "🌬️", name: "Windy", dir: [0, 1],
          blurb: "A breeze pushes everyone in the open one square east each turn. Bushes shelter you." },
  rain: { id: "rain", icon: "🌧️", name: "Rainy",
          blurb: "Wet grass! A long dash slides you one extra square." },
  sun:  { id: "sun",  icon: "☀️", name: "Sunny",
          blurb: "Warm sunshine — your critters heal 1 health each turn." },
};

const LEVELS = [
  {
    name: "Sunny Meadow", objective: "defeat", par: 5, limit: 15,
    hint: "Tap a critter, tap where to go, then tap a bug to bonk it.",
    rows: [
      "........",
      "..%..%..",
      "........",
      "...##...",
      "........",
      "..%..%..",
      "........",
      "........",
    ],
    party: [[7, 2], [7, 5]],
    bugs: [{ t: "ant", r: 1, c: 2 }, { t: "ant", r: 1, c: 5 }],
  },
  {
    name: "Stepping Stones", objective: "defeat", par: 6, limit: 16,
    hint: "Hop leaps over ponds and Zip flies. Digger has to walk around!",
    rows: [
      "........",
      "..~~~~..",
      "..~~~~..",
      "........",
      "...##...",
      "........",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 3], [7, 6]],
    bugs: [{ t: "beetle", r: 0, c: 2 }, { t: "beetle", r: 0, c: 5 }, { t: "ant", r: 3, c: 4 }],
  },
  {
    name: "Pond Push", objective: "defeat", par: 6, limit: 16,
    hint: "Bugs can't swim. Zip's Gust blows them straight into the water!",
    rows: [
      "........",
      "..%..%..",
      "...~~...",
      "..~~~~..",
      "...~~...",
      "..%..%..",
      "........",
      "........",
    ],
    party: [[7, 2], [7, 4], [6, 6]],
    bugs: [{ t: "beetle", r: 1, c: 2 }, { t: "beetle", r: 1, c: 5 }, { t: "ant", r: 0, c: 4 }],
  },
  {
    name: "Thorn Patch", objective: "defeat", par: 7, limit: 18, weather: "wind",
    hint: "Thorns prickle anyone who steps on them — bugs included.",
    rows: [
      "........",
      ".^^..^^.",
      "........",
      "..^oo^..",
      "........",
      ".^^..^^.",
      "...+....",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [{ t: "beetle", r: 1, c: 3 }, { t: "beetle", r: 1, c: 4 }, { t: "skeeter", r: 0, c: 6 }],
  },
  {
    name: "Berry Run", objective: "reach", par: 5, limit: 12,
    hint: "Grab the berry! You don't have to beat every bug.",
    rows: [
      "...*....",
      "##....##",
      "........",
      "..####..",
      "........",
      "##....##",
      "........",
      "........",
    ],
    party: [[7, 3], [7, 4], [6, 1]],
    bugs: [{ t: "beetle", r: 2, c: 1 }, { t: "beetle", r: 2, c: 6 }, { t: "ant", r: 4, c: 4 }],
  },
  {
    name: "Rockfall", objective: "defeat", par: 7, limit: 18,
    hint: "Digger's Quake shatters the rocks around him.",
    rows: [
      "........",
      ".###H##.",
      "........",
      ".##..##.",
      "........",
      ".##H###.",
      "...n....",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "beetle", r: 0, c: 3 }, { t: "beetle", r: 0, c: 4 },
      { t: "ant", r: 2, c: 1 }, { t: "ant", r: 2, c: 6 },
    ],
  },
  {
    name: "Chomp's Clearing", objective: "defeat", par: 9, limit: 22, boss: "chomp",
    hint: "Chomp is armoured — big hits get through, little ones bounce off.",
    rows: [
      "........",
      "..%..%..",
      "........",
      "..#..#..",
      "........",
      "..%..%..",
      "........",
      "........",
    ],
    party: [[7, 2], [7, 4], [7, 6]],
    bugs: [
      { t: "chomp", r: 1, c: 3 },
      { t: "ant", r: 2, c: 1 }, { t: "ant", r: 2, c: 6 },
    ],
  },
  {
    name: "Web Corner", objective: "defeat", par: 8, limit: 20,
    hint: "Spiders shoot webs from far away and slow you down. Rush them!",
    rows: [
      "........",
      "#......#",
      "........",
      "..%%%%..",
      "........",
      "#......#",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "spider", r: 0, c: 1 }, { t: "spider", r: 0, c: 6 },
      { t: "beetle", r: 1, c: 4 },
    ],
  },
  {
    name: "Three Berries", objective: "collect", par: 8, limit: 20, weather: "sun",
    hint: "Collect all three berries. Split up — you have three critters!",
    rows: [
      "*......*",
      "..####..",
      "..&..&..",
      ".#....#.",
      "........",
      "..%..%..",
      "...*....",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "ant", r: 2, c: 1 }, { t: "ant", r: 2, c: 6 },
      { t: "skeeter", r: 2, c: 4 }, { t: "beetle", r: 4, c: 3 },
    ],
  },
  {
    name: "Hold the Log", objective: "survive", survive: 6, par: 6, limit: 6,
    hint: "Keep ALL THREE critters standing for 6 turns. Bushes are armour!",
    reinforce: { type: "ant", every: 2, n: 1 },
    rows: [
      "........",
      "........",
      "..~~~~..",
      "..~~~~..",
      "........",
      "%%....%%",
      "........",
      "........",
    ],
    party: [[6, 3], [6, 4], [7, 2]],
    bugs: [
      { t: "beetle", r: 0, c: 1 }, { t: "beetle", r: 0, c: 6 },
      { t: "ant", r: 0, c: 3 }, { t: "ant", r: 0, c: 4 },
      { t: "skeeter", r: 1, c: 7 },
    ],
  },
  {
    name: "Snail Pass", objective: "defeat", par: 9, limit: 22,
    hint: "Snails have thick shells. Weak pecks barely scratch them.",
    rows: [
      "........",
      ".%....%.",
      "........",
      "###..###",
      "........",
      ".%....%.",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "snail", r: 1, c: 2 }, { t: "snail", r: 1, c: 5 },
      { t: "beetle", r: 0, c: 4 }, { t: "ant", r: 2, c: 0 },
    ],
  },
  {
    name: "Scorpion Gully", objective: "defeat", par: 9, limit: 22, weather: "rain",
    hint: "The scorpion hits hard AND knocks you back. Gang up on it.",
    rows: [
      "..#..#..",
      "........",
      ".^....^.",
      "........",
      "..~~~~..",
      "........",
      ".^....^.",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "scorpion", r: 1, c: 3 },
      { t: "ant", r: 1, c: 1 }, { t: "ant", r: 1, c: 6 },
      { t: "beetle", r: 3, c: 4 },
    ],
  },
  {
    name: "Island Hop", objective: "reach", par: 7, limit: 16, weather: "sun",
    hint: "Walkers go the long way round. Flyers go straight over.",
    rows: [
      "...*....",
      "..~~~~..",
      "..~~~~..",
      "...%%...",
      "..~~~~..",
      "..~~~~..",
      "........",
      "...l....",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "skeeter", r: 0, c: 5 }, { t: "spider", r: 3, c: 1 },
      { t: "beetle", r: 6, c: 3 },
    ],
  },
  {
    name: "Weaver's Hollow", objective: "defeat", par: 10, limit: 24, boss: "weaver",
    hint: "The Weaver keeps its distance. Chase it down before the webs pile up.",
    rows: [
      "@......@",
      "..%..%..",
      "........",
      "..#..#..",
      "........",
      "..%..%..",
      "........",
      "@......@",
    ],
    party: [[6, 1], [6, 4], [6, 6]],
    bugs: [
      { t: "weaver", r: 1, c: 4 },
      { t: "spider", r: 2, c: 1 }, { t: "beetle", r: 2, c: 6 },
    ],
  },
  {
    name: "Bramble Maze", objective: "collect", par: 10, limit: 24,
    hint: "Three berries again — but the thorns bite on the way.",
    rows: [
      "*..^^..*",
      ".##..##.",
      "...++...",
      "^..HH..^",
      "........",
      ".##..##.",
      "...*....",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "spider", r: 2, c: 1 }, { t: "spider", r: 2, c: 6 },
      { t: "beetle", r: 4, c: 3 }, { t: "ant", r: 4, c: 4 },
    ],
  },
  {
    name: "Swarm", objective: "survive", survive: 6, par: 6, limit: 6,
    hint: "So many! Nobody may fall — back into a corner so they can't surround you.",
    reinforce: { type: "ant", every: 2, n: 1 },
    rows: [
      "........",
      "........",
      ".%....%.",
      "..####..",
      "........",
      ".%....%.",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "ant", r: 0, c: 1 }, { t: "ant", r: 0, c: 3 },
      { t: "ant", r: 0, c: 6 }, { t: "skeeter", r: 1, c: 0 },
      { t: "beetle", r: 2, c: 3 },
    ],
  },
  {
    name: "Deep Pond", objective: "reach", par: 8, limit: 18,
    hint: "The berry is right across the water — if you can fly.",
    rows: [
      "...*....",
      "........",
      ".~~~~~~.",
      ".~~~~~~.",
      ".~~~~~~.",
      "........",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "spider", r: 1, c: 3 }, { t: "skeeter", r: 1, c: 5 },
      { t: "beetle", r: 5, c: 1 }, { t: "scorpion", r: 5, c: 6 },
    ],
  },
  {
    name: "The Nest", objective: "defeat", par: 11, limit: 26,
    hint: "Everything at once. Use your powers the moment they're ready.",
    rows: [
      "@......@",
      ".%....%.",
      "..H..H..",
      "...nn...",
      "..~~~~..",
      "........",
      ".%....%.",
      "@......@",
    ],
    party: [[6, 1], [6, 4], [6, 6]],
    bugs: [
      { t: "scorpion", r: 1, c: 3 },
      { t: "spider", r: 0, c: 1 }, { t: "snail", r: 2, c: 4 },
    ],
  },
  {
    name: "Last Stand", objective: "survive", survive: 7, par: 7, limit: 7,
    hint: "Seven turns, nobody falls. Keep moving and use your powers.",
    reinforce: { type: "ant", every: 4, n: 1 },
    rows: [
      "........",
      "..%%%%..",
      "........",
      "#.^..^.#",
      "........",
      "..%%%%..",
      "........",
      "........",
    ],
    party: [[7, 1], [7, 4], [7, 6]],
    bugs: [
      { t: "scorpion", r: 0, c: 2 },
      { t: "spider", r: 1, c: 0 }, { t: "skeeter", r: 0, c: 7 },
      { t: "ant", r: 2, c: 3 }, { t: "ant", r: 2, c: 4 },
    ],
  },
  {
    name: "Scorpion King's Court", objective: "defeat", par: 12, limit: 28, boss: "king", weather: "wind",
    hint: "The final bug. His tail sweeps EVERYONE beside him — don't crowd in.",
    rows: [
      // Ponds at the EDGES, not across the middle: a full-width pond makes the
      // slow melee critter walk around for four turns while the squishy ones
      // get eaten, which is a map problem masquerading as a difficulty spike.
      "@......@",
      "...##...",
      "........",
      ".^+..+^.",
      "..o..o..",
      "~~....~~",
      "........",
      "@......@",
    ],
    // The only level with a fourth slot — bring everyone you've unlocked.
    party: [[6, 1], [6, 3], [6, 4], [6, 6]],
    bugs: [
      { t: "king", r: 2, c: 3 },
      { t: "scorpion", r: 1, c: 1 }, { t: "spider", r: 1, c: 6 },
    ],
  },
];

// Hot-seat maps: two players, one iPad, symmetric spawns. Team A starts at the
// bottom, team B at the top, and the handicap in main.js can hand the younger
// player extra health.
const DUELS = [
  {
    name: "Garden Standoff",
    rows: [
      "........",
      "..%..%..",
      "........",
      "##.~~.##",
      "........",
      "..%..%..",
      "........",
    ],
    a: [[6, 1], [6, 3], [6, 6]],
    b: [[0, 1], [0, 4], [0, 6]],
  },
  {
    name: "Thorn Arena",
    rows: [
      "........",
      ".^....^.",
      "........",
      "..#~~#..",
      "........",
      ".^....^.",
      "........",
    ],
    a: [[6, 1], [6, 4], [6, 6]],
    b: [[0, 1], [0, 3], [0, 6]],
  },
  {
    name: "Rock Garden",
    rows: [
      "........",
      "..####..",
      "........",
      "...~~...",
      "........",
      "..####..",
      "........",
    ],
    a: [[6, 0], [6, 3], [6, 7]],
    b: [[0, 0], [0, 4], [0, 7]],
  },
];
