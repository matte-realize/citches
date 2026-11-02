import "@fontsource/press-start-2p/400.css";
import "./endcard.css";

/**
 * End card for the demo video (/endcard.html). A night sky, a pixel skyline that rises out of the
 * ground block by block (a city built from chat), then CITCHES bounces in letter by letter and the
 * tagline types out underneath. Everything, text included, is drawn on one low-resolution canvas
 * and scaled up, so the logo is made of the same chunky pixels as the city.
 * R or a click replays it; ?still shows the finished card straight away.
 */
const canvas = document.querySelector<HTMLCanvasElement>("#sky")!;
const ctx = canvas.getContext("2d")!;
const still = new URLSearchParams(location.search).has("still");
const TITLE = "CITCHES";
const TAGLINE = "the city made from your chat";
const FONT = '"Press Start 2P"';
const GOLD = "#ffd35a", GOLD_DEEP = "#b7791f", INK = "#10141c", CREAM = "#f4ecd8";

let pixel = 6;
type Building = { x: number; w: number; h: number; delay: number; color: string; roof: number; windows: Array<[number, number, number]> };
type Star = { x: number; y: number; phase: number; size: number };
type Glyph = { image: HTMLCanvasElement; width: number; height: number };
let buildings: Building[] = [];
let stars: Star[] = [];
let titleGlyphs: Glyph[] = [];
let taglineGlyphs: Glyph[] = [];
let titleScale = 3;
let cols = 0, rows = 0;
let started = performance.now();
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const BODY = ["#1b2433", "#202b3d", "#243247", "#1d2738"];
const LIGHT = ["#ffd35a", "#ffe08a", "#ffb84d", "#7cf29a"];

/**
 * One character as hard pixels: drawn at the font's native 8px grid, every pixel snapped to fully
 * on or off (no anti-aliasing), then scaled up by whole pixels and given the game's stepped shadow.
 */
function glyph(char: string, scale: number, face: string, shade: string, shadow: string | undefined): Glyph {
  const base = document.createElement("canvas");
  base.width = 8; base.height = 8;
  const b = base.getContext("2d")!;
  b.font = `8px ${FONT}`;
  b.textBaseline = "top";
  b.fillStyle = "#fff";
  b.fillText(char, 0, 0);
  const mask = b.getImageData(0, 0, 8, 8).data;
  const depth = shadow ? 2 : 1;
  const out = document.createElement("canvas");
  out.width = 8 * scale + depth; out.height = 8 * scale + depth;
  const o = out.getContext("2d")!;
  const paint = (color: string, dx: number, dy: number) => {
    o.fillStyle = color;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (mask[(y * 8 + x) * 4 + 3] > 110) o.fillRect(x * scale + dx, y * scale + dy, scale, scale);
  };
  if (shadow) paint(shadow, 2, 2);
  paint(shade, 1, 1);
  paint(face, 0, 0);
  return { image: out, width: out.width, height: out.height };
}

function layout() {
  // Coarser pixels on big screens so the card looks the same at any size.
  pixel = Math.max(2, Math.round(Math.min(innerWidth / 1600, innerHeight / 900) * 4));
  canvas.width = Math.ceil(innerWidth / pixel);
  canvas.height = Math.ceil(innerHeight / pixel);
  cols = canvas.width; rows = canvas.height;
  ctx.imageSmoothingEnabled = false;
  seed = 7;
  buildings = [];
  let x = -2;
  while (x < cols) {
    const w = 9 + Math.floor(random() * 13);
    // Taller towers toward the middle, low homes at the edges, like the city in the game.
    const centre = 1 - Math.abs((x + w / 2) / cols - 0.5) * 2;
    const h = Math.floor(rows * (0.08 + centre * 0.2 + random() * 0.1));
    const windows: Array<[number, number, number]> = [];
    for (let wy = 3; wy < h - 2; wy += 3) for (let wx = 2; wx < w - 2; wx += 3) if (random() < 0.55) windows.push([wx, wy, Math.floor(random() * LIGHT.length)]);
    buildings.push({ x, w, h, delay: 200 + random() * 1600 + Math.abs(x + w / 2 - cols / 2) * 4, color: BODY[Math.floor(random() * BODY.length)], roof: random() < 0.3 ? 1 + Math.floor(random() * 3) : 0, windows });
    x += w + (random() < 0.3 ? 1 : 0);
  }
  stars = Array.from({ length: Math.floor(cols * rows / 300) }, () => ({ x: Math.floor(random() * cols), y: Math.floor(random() * rows * 0.6), phase: random() * Math.PI * 2, size: random() < 0.15 ? 2 : 1 }));
  // The logo fills most of the width; the tagline sits at the font's native size.
  titleScale = Math.max(2, Math.floor((cols * 0.8) / (TITLE.length * 9)));
  titleGlyphs = [...TITLE].map(char => glyph(char, titleScale, GOLD, GOLD_DEEP, INK));
  taglineGlyphs = [...TAGLINE].map(char => glyph(char, 1, CREAM, INK, undefined));
}

/** Overshooting ease: things land with a little bounce, like the game's build animation. */
const bounce = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = 1.7, u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
};

function draw(now: number) {
  const elapsed = still ? 1e9 : now - started;
  const sky = ctx.createLinearGradient(0, 0, 0, rows);
  sky.addColorStop(0, "#0b1018");
  sky.addColorStop(0.65, "#162236");
  sky.addColorStop(1, "#2b3a4f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cols, rows);
  for (const star of stars) {
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(now / 900 + star.phase));
    ctx.fillStyle = `rgba(244, 236, 216, ${twinkle * Math.min(1, elapsed / 1200)})`;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  const ground = rows - Math.max(4, Math.floor(rows * 0.06));
  for (const b of buildings) {
    const grown = Math.round(b.h * bounce((elapsed - b.delay) / 700));
    if (grown <= 0) continue;
    const top = ground - grown;
    ctx.fillStyle = INK;
    ctx.fillRect(b.x - 1, top - 1, b.w + 2, grown + 1);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, top, b.w, grown);
    ctx.fillStyle = "#2a3850";
    ctx.fillRect(b.x, top, b.w, 1);
    if (b.roof && grown >= b.h) { ctx.fillStyle = INK; ctx.fillRect(b.x + Math.floor(b.w / 2) - 1, top - b.roof - 1, 2, b.roof + 1); }
    // Windows switch on one by one once the building has finished rising.
    const lit = Math.max(0, (elapsed - b.delay - 700) / 900);
    b.windows.forEach(([wx, wy, tone], index) => {
      if (wy >= grown - 1 || index / b.windows.length > lit) return;
      ctx.fillStyle = LIGHT[tone];
      ctx.fillRect(b.x + wx, top + wy, 1, 1);
    });
  }
  ctx.fillStyle = INK;
  ctx.fillRect(0, ground, cols, rows - ground);
  ctx.fillStyle = "#1f8a49";
  ctx.fillRect(0, ground, cols, 1);

  // CITCHES: each letter drops from above with a bounce, then the word keeps a one-pixel wave.
  const advance = 8 * titleScale + titleScale;
  const titleWidth = advance * TITLE.length - titleScale;
  const titleY = Math.round(rows * 0.3);
  let x = Math.round((cols - titleWidth) / 2);
  titleGlyphs.forEach((g, index) => {
    const t = (elapsed - 2200 - index * 120) / 700;
    if (t > 0) {
      const drop = Math.round((1 - bounce(t)) * -(titleY + g.height));
      const wave = t > 1.6 ? Math.round(Math.sin(now / 380 - index * 0.7) * titleScale * 0.5) : 0;
      ctx.drawImage(g.image, x, titleY + drop + wave);
    }
    x += advance;
  });

  // Tagline: typed out one character at a time, in the same pixels.
  const typed = Math.floor(Math.max(0, elapsed - 3500) / 45);
  const tagWidth = TAGLINE.length * 8;
  let tx = Math.round((cols - tagWidth) / 2);
  const tagY = titleY + 8 * titleScale + Math.max(6, Math.round(titleScale * 3));
  taglineGlyphs.forEach((g, index) => {
    if (index < typed) ctx.drawImage(g.image, tx, tagY);
    tx += 8;
  });
  requestAnimationFrame(draw);
}

const replay = () => { started = performance.now(); };
addEventListener("resize", layout);
addEventListener("keydown", event => { if (event.key.toLowerCase() === "r") replay(); });
addEventListener("click", replay);
// The pixel font must be loaded before the letters are traced into pixels.
await document.fonts.load(`8px ${FONT}`);
layout();
started = performance.now();
requestAnimationFrame(draw);
