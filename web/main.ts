import { Application, Container, Graphics, Text } from "pixi.js";
import type { SimEvent } from "../src/types.js";
import "./style.css";


async function main() {
const app = new Application();
await app.init({ background: "#101923", resizeTo: window, antialias: true });
document.querySelector<HTMLDivElement>("#app")!.appendChild(app.canvas);
const world = new Container();
app.stage.addChild(world);
const overlay = document.createElement("div");
overlay.className = "debug";
overlay.textContent = "Connecting to chat…";
document.body.appendChild(overlay);

const GRID = 32, TILE_W = 28, TILE_H = 16;
type Tile = { x: number; y: number; kind: "empty" | "house" | "landmark" | "fire" };
const tiles: Tile[] = Array.from({ length: GRID * GRID }, (_, i) => ({ x: i % GRID, y: Math.floor(i / GRID), kind: "empty" }));
const tileGraphics = new Map<Tile, Graphics>();
function position(x: number, y: number) { return { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 }; }
function drawTile(tile: Tile) {
  let graphic = tileGraphics.get(tile);
  if (!graphic) { graphic = new Graphics(); tileGraphics.set(tile, graphic); world.addChild(graphic); }
  graphic.clear();
  const colors = { empty: 0x263a42, house: 0x53b6a2, landmark: 0xe8bd67, fire: 0xef694b };
  const p = position(tile.x, tile.y);
  graphic.poly([0,-TILE_H/2,TILE_W/2,0,0,TILE_H/2,-TILE_W/2,0]).fill({ color: colors[tile.kind], alpha: tile.kind === "empty" ? 0.7 : 1 });
  if (tile.kind === "house" || tile.kind === "landmark") {
    const h = tile.kind === "house" ? 10 : 19;
    graphic.poly([-6,-h,0,-h-5,6,-h,6,-2,0,2,-6,-2]).fill({ color: tile.kind === "house" ? 0x368977 : 0xc29245 });
  }
  if (tile.kind === "fire") graphic.circle(0, -5, 5).fill({ color: 0xffcc55 });
  graphic.position.set(p.x, p.y);
}
for (const tile of tiles) drawTile(tile);
function layout() {
  const bounds = world.getLocalBounds();
  const scale = Math.min((window.innerWidth - 40) / bounds.width, (window.innerHeight - 40) / bounds.height, 1.3);
  world.scale.set(scale); world.position.set(window.innerWidth / 2 - (bounds.left + bounds.width/2)*scale, window.innerHeight / 2 - (bounds.top + bounds.height/2)*scale);
}
layout(); window.addEventListener("resize", layout);
function place(kind: "house" | "landmark", count: number) {
  for (let n = 0; n < Math.min(count, tiles.length); n++) {
    const empty = tiles.filter(t => t.kind === "empty"); if (!empty.length) return;
    const occupied = tiles.filter(t => t.kind === "house" || t.kind === "landmark");
    const candidates = empty.filter(t => !occupied.length || occupied.some(o => Math.abs(o.x-t.x)+Math.abs(o.y-t.y) <= 3));
    const target = (candidates.length ? candidates : empty)[Math.floor(Math.random() * (candidates.length || empty.length))];
    target.kind = kind; drawTile(target);
  }
}
function disaster(intensity: number) {
  const targets = tiles.filter(t => t.kind === "house" || t.kind === "landmark");
  const count = Math.min(targets.length, Math.max(1, Math.ceil(intensity * 2)));
  for (const tile of targets.sort(() => Math.random() - 0.5).slice(0, count)) {
    tile.kind = "fire"; drawTile(tile);
    setTimeout(() => { tile.kind = "empty"; drawTile(tile); }, 1800);
  }
}
function applyEvent(event: SimEvent) {
  if (event.type === "build") place(event.kind, event.count);
  if (event.type === "boom") place("house", Math.min(20, Math.ceil(event.viewers / 5)));
  if (event.type === "disaster") disaster(event.intensity);
  if (event.type === "effect") {
    const old = overlay.style.boxShadow; overlay.style.boxShadow = `0 0 ${Math.min(40,event.intensity*4)}px #f7c65c`;
    setTimeout(() => overlay.style.boxShadow = old, 500);
  }
}
const host = location.hostname || "localhost";
const socket = new WebSocket(`ws://${host}:8787`);
socket.onopen = () => overlay.textContent = "Connected; waiting for chat…";
socket.onmessage = message => {
  const data = JSON.parse(message.data);
  if (data.type !== "tick") return;
  const { counts, messagesPerSecond } = data.aggregate;
  overlay.textContent = `Chat City · ${messagesPerSecond.toFixed(1)} msg/s\nRAID ${counts.RAID}  SPAM ${counts.SPAM}  QUESTION ${counts.QUESTION}  HATE ${counts.HATE}  COMMENT ${counts.COMMENT}`;
  for (const event of data.events as SimEvent[]) applyEvent(event);
};
socket.onclose = () => overlay.textContent = "Disconnected from backend";
}

void main();
