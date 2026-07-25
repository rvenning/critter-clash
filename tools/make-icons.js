// Generate icons/ — a frog facing off against a beetle across a garden tile.
// Run: node tools/make-icons.js  (from the critter-clash folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;               // 1 unit = 1% of the icon

  const DEEP = "#14261b", MID = "#1d3626", LEAF = "#2f6b3f", GRID = "#3f7a45";
  const FROG = "#5ddb7a", FROG_D = "#37a355", BUG = "#c0392b", BUG_D = "#8c2a1f";
  const EYE = "#ffffff", INK = "#12232e", SUN = "#ffe27a";

  // Ground, with a hint of the tactical grid the whole game is played on.
  cv.fillRect(0, 0, big, big, DEEP);
  cv.fillRect(0, 20 * u, big, 62 * u, MID);

  // maskable art stays inside the safe centre (~72%)
  const s = pad ? 0.76 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // Two grid squares: the frog's and the bug's.
  cv.fillRect(at(8), at(30), sz(38), sz(38), LEAF);
  cv.fillRect(at(54), at(30), sz(38), sz(38), GRID);

  // Frog on the left square.
  const fx = at(27), fy = at(52);
  cv.fillCircle(fx, fy + sz(3), sz(17), FROG_D);
  cv.fillCircle(fx, fy, sz(15), FROG);
  cv.fillCircle(fx - sz(7), fy - sz(11), sz(6), FROG);
  cv.fillCircle(fx + sz(7), fy - sz(11), sz(6), FROG);
  cv.fillCircle(fx - sz(7), fy - sz(11), sz(3), EYE);
  cv.fillCircle(fx + sz(7), fy - sz(11), sz(3), EYE);
  cv.fillCircle(fx - sz(7), fy - sz(11), sz(1.5), INK);
  cv.fillCircle(fx + sz(7), fy - sz(11), sz(1.5), INK);

  // Beetle on the right square.
  const bx = at(73), by = at(52);
  cv.fillCircle(bx, by + sz(2), sz(14), BUG_D);
  cv.fillCircle(bx, by, sz(12), BUG);
  cv.fillRect(bx - sz(1.2), by - sz(12), sz(2.4), sz(24), BUG_D);
  cv.fillCircle(bx - sz(5), by - sz(9), sz(2.5), EYE);
  cv.fillCircle(bx + sz(5), by - sz(9), sz(2.5), EYE);

  // A star overhead — the campaign currency.
  cv.fillCircle(at(50), at(16), sz(7), SUN);

  return downsample(cv.px, big, SS);
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), encodePNG(192, 192, paint(192, false)));
fs.writeFileSync(path.join(OUT, "icon-512.png"), encodePNG(512, 512, paint(512, false)));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), encodePNG(512, 512, paint(512, true)));
console.log("icons written to", OUT);
