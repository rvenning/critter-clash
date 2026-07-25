// Terrain registry. Levels are ASCII maps (js/levels.js) and every character
// here is one tile type. Terrain is the whole tactical puzzle in Critter
// Clash — a bug shoved into the pond is worth more than three hits.
//
//   solid   nothing may stand here; blocks ground movement and shots
//   water   ground critters can't enter; anything pushed in is washed out
//   hazard  damage dealt when a unit ENTERS or is pushed onto the tile
//   cover   armour bonus while standing here
//   goal    counts for "reach"/"collect" objectives

const TILES = {
  ".": { id: "grass", name: "Grass",  solid: false, water: false, hazard: 0, cover: 0, goal: false },
  "%": { id: "bush",  name: "Bush",   solid: false, water: false, hazard: 0, cover: 1, goal: false },
  "#": { id: "rock",  name: "Rock",   solid: true,  water: false, hazard: 0, cover: 0, goal: false, breakable: true },
  "@": { id: "cliff", name: "Cliff",  solid: true,  water: false, hazard: 0, cover: 0, goal: false, breakable: false },
  "~": { id: "water", name: "Pond",   solid: false, water: true,  hazard: 0, cover: 0, goal: false },
  "^": { id: "thorn", name: "Thorns", solid: false, water: false, hazard: 2, cover: 0, goal: false },
  "*": { id: "berry", name: "Berry",  solid: false, water: false, hazard: 0, cover: 0, goal: true },

  /* ---- things to set off ---- */
  // A beehive is a rock that fights back: smash it, or shove a bug into it,
  // and it stings everything standing beside it.
  "H": { id: "hive",  name: "Beehive", solid: true, water: false, hazard: 0, cover: 0, goal: false,
         breakable: true, hive: 3, emoji: "🍯" },
  // Land on the mushroom and you keep going — two more squares the way you
  // were already travelling. Works on bugs too.
  "o": { id: "shroom", name: "Bouncy Mushroom", solid: false, water: false, hazard: 0, cover: 0, goal: false,
         bounce: 2, emoji: "🍄" },
  // Honey is sticky: whoever finishes their move in it is slowed next turn.
  "&": { id: "honey", name: "Honey", solid: false, water: false, hazard: 0, cover: 0, goal: false,
         sticky: true, emoji: "🯄" },

  /* ---- pickups, taken by critters only ---- */
  "+": { id: "apple",  name: "Apple",  solid: false, water: false, hazard: 0, cover: 0, goal: false,
         pickup: "heal", amount: 5, emoji: "🍎" },
  "n": { id: "acorn",  name: "Acorn",  solid: false, water: false, hazard: 0, cover: 0, goal: false,
         pickup: "ready", emoji: "🌰" },
  "l": { id: "clover", name: "Lucky Clover", solid: false, water: false, hazard: 0, cover: 0, goal: false,
         pickup: "lucky", amount: 2, emoji: "🍀" },
};

// Every level map is this wide. Fixed so the linter can check row widths and
// so the board always reads well in portrait.
const COLS = 8;

function tileAt(board, r, c) {
  if (r < 0 || c < 0 || r >= board.length || c >= COLS) return null;   // off-board
  return TILES[board[r][c]] || TILES["."];
}
