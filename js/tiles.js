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
};

// Every level map is this wide. Fixed so the linter can check row widths and
// so the board always reads well in portrait.
const COLS = 8;

function tileAt(board, r, c) {
  if (r < 0 || c < 0 || r >= board.length || c >= COLS) return null;   // off-board
  return TILES[board[r][c]] || TILES["."];
}
