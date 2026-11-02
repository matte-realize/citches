import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import type { Batcher } from "./kit.js";
import { block, coneGeo, cylinderGeo, place, sharedMat, sphereGeo } from "./kit.js";
import type { Animated } from "./specials.js";
import type { CityTheme } from "./theme.js";

/**
 * A bustling town: shops on the ground floor, an airfield that grows into an airport, a mall,
 * plus the aircraft and balloons that fill the sky. Everything stays inside its 1x1 lot.
 */
type Random = () => number;
const glow = (color: number, intensity = 1.6) => sharedMat(color, 0.3, { emissive: color, emissiveIntensity: intensity });
const keep = <T extends { userData: Record<string, unknown> }>(object: T) => { object.userData.keep = true; return object; };
const AWNINGS = [0xd9534f, 0x3f8fd2, 0x4fae6a, 0xf2c94c, 0xb06ad9, 0xf08a4b];

/** Airfield (industrial era) or airport (airships onward): runway, hangar or terminal, tower, a parked plane. */
export function airport(b: Group, a: Animated[], theme: CityTheme, random: Random, batch: Batcher, era: number) {
  const modern = era >= 5;
  block(b, 0.98, 0.012, 0.98, 0, 0.006, 0, sharedMat(modern ? 0x8d9298 : 0x6f8f52, 1), 0, false);
  // Runway along x with centre dashes and threshold bars.
  block(b, 0.98, 0.016, 0.26, 0, 0.012, 0.24, sharedMat(modern ? 0x3a3c40 : 0x8a7a5a, 0.95), 0, false);
  for (let i = -3; i <= 3; i++) batch.box(sharedMat(0xe9e6dc, 0.7), 0.07, 0.004, 0.016, i * 0.13, 0.022, 0.24);
  for (const x of [-0.44, 0.44]) for (let j = -2; j <= 2; j++) batch.box(sharedMat(0xe9e6dc, 0.7), 0.04, 0.004, 0.025, x, 0.022, 0.24 + j * 0.045);
  if (modern) for (let i = -4; i <= 4; i++) batch.add(sphereGeo(0.012, 4, 3), glow(i % 2 ? 0x7cf29a : 0xffe08a, 2), i * 0.11, 0.026, 0.375);
  if (modern) {
    // Terminal with a glass front and a control tower.
    block(b, 0.56, 0.2, 0.26, -0.14, 0.1, -0.24, sharedMat(0xdfe2e4, 0.5, { metalness: 0.15 }));
    block(b, 0.54, 0.1, 0.01, -0.14, 0.12, -0.105, sharedMat(0x9fd8ff, 0.1, { emissive: 0x6fa8c0, emissiveIntensity: 0.4 }), 0, false);
    const roof = place(b, cylinderGeo(0.14, 0.14, 0.58, 12, ), sharedMat(0xe9edf0, 0.4), -0.14, 0.2, -0.24);
    roof.rotation.z = Math.PI / 2;
    roof.scale.set(1, 1, 0.5);
    place(b, cylinderGeo(0.04, 0.05, 0.6, 8), sharedMat(0xdfe2e4, 0.5), 0.3, 0.3, -0.26);
    place(b, cylinderGeo(0.09, 0.06, 0.08, 8), sharedMat(0x26343d, 0.15, { emissive: 0x3a6a8a, emissiveIntensity: 0.5 }), 0.3, 0.64, -0.26);
    place(b, cylinderGeo(0.1, 0.1, 0.02, 8), sharedMat(0xdfe2e4, 0.5), 0.3, 0.69, -0.26);
    const beacon = keep(place(b, sphereGeo(0.02, 6, 4), glow(0xff3322, 2.6), 0.3, 0.73, -0.26, false));
    a.push({ kind: "blink", object: beacon, period: 1.3, offset: random() });
  } else {
    // Curved hangar, windsock on a pole.
    const hangar = place(b, cylinderGeo(0.2, 0.2, 0.42, 12, ), sharedMat(0xa8acae, 0.5, { metalness: 0.3 }), -0.18, 0.02, -0.24);
    hangar.rotation.z = Math.PI / 2;
    block(b, 0.42, 0.02, 0.42, -0.18, 0.01, -0.24, sharedMat(0x6a6e70, 0.9), 0, false);
    place(b, cylinderGeo(0.006, 0.006, 0.36, 4), sharedMat(0x3a3530, 0.6), 0.36, 0.18, -0.3);
    const sock = keep(place(b, coneGeo(0.03, 0.14, 6), sharedMat(0xf08a4b, 0.7), 0.42, 0.34, -0.3));
    sock.rotation.z = Math.PI / 2;
    a.push({ kind: "sway", object: sock, speed: 2.2, amount: 0.25 });
  }
  // A parked aircraft on the apron.
  plane(b, modern ? 0.42 : 0.34, 0.2, 0.24, modern, theme);
  b.userData.airport = true;
}

/** A small aircraft: fuselage along x, wings across. Used parked and in flight. */
export function plane(parent: Group, size: number, x: number, z: number, jet: boolean, theme: CityTheme) {
  const body = new Group();
  body.position.set(x, 0.03 + size * 0.14, z);
  const paint = sharedMat(jet ? 0xf4f6f8 : 0xd9534f, 0.4, { metalness: 0.2 });
  const fuselage = place(body, cylinderGeo(size * 0.12, size * 0.1, size * 1.1, 8), paint, 0, 0, 0);
  fuselage.rotation.z = Math.PI / 2;
  place(body, sphereGeo(size * 0.12, 8, 6), paint, size * 0.55, 0, 0);
  block(body, size * 0.3, size * 0.03, size * 1.2, size * 0.05, -size * 0.02, 0, paint);
  block(body, size * 0.18, size * 0.02, size * 0.42, -size * 0.48, size * 0.02, 0, paint);
  block(body, size * 0.16, size * 0.24, size * 0.02, -size * 0.48, size * 0.12, 0, sharedMat(theme.accent, 0.5));
  if (jet) for (const s of [-1, 1]) place(body, cylinderGeo(size * 0.05, size * 0.05, size * 0.18, 6), sharedMat(0x9aa0a6, 0.4), size * 0.05, -size * 0.07, s * size * 0.3).rotation.z = Math.PI / 2;
  parent.add(body);
  return body;
}

/** A free-standing flying model for the sky (airliner or prop plane), facing +x. */
export function flyingPlane(theme: CityTheme, jet: boolean) {
  const root = new Group();
  plane(root, jet ? 0.9 : 0.6, 0, 0, jet, theme).position.y = 0;
  const light = new Mesh(new SphereGeometry(0.05, 6, 4), new MeshStandardMaterial({ color: 0xff3322, emissive: 0xff3322, emissiveIntensity: 2.4 }));
  light.position.set(0, 0.2, 0);
  root.add(light);
  return root;
}

/** A hot-air balloon: striped envelope, basket and burner glow. */
export function balloon(random: Random) {
  const root = new Group();
  const colors = [AWNINGS[Math.floor(random() * AWNINGS.length)], AWNINGS[Math.floor(random() * AWNINGS.length)], 0xf4ecd8];
  for (let i = 0; i < 6; i++) {
    const panel = new Mesh(new SphereGeometry(0.5, 12, 10, (i / 6) * Math.PI * 2, Math.PI / 3), new MeshStandardMaterial({ color: colors[i % 3], roughness: 0.8 }));
    panel.scale.set(1, 1.2, 1);
    root.add(panel);
  }
  const neck = new Mesh(new SphereGeometry(0.2, 8, 6), new MeshStandardMaterial({ color: colors[0], roughness: 0.8 }));
  neck.position.y = -0.55;
  neck.scale.set(1, 0.8, 1);
  root.add(neck);
  const basket = new Mesh(new SphereGeometry(0.1, 6, 4), new MeshStandardMaterial({ color: 0x8a6a43, roughness: 1 }));
  basket.position.y = -0.95;
  basket.scale.set(1, 0.8, 1);
  root.add(basket);
  const flame = new Mesh(new SphereGeometry(0.05, 6, 4), new MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a22, emissiveIntensity: 2.5 }));
  flame.position.y = -0.78;
  root.add(flame);
  return root;
}

/** Shopping mall: big-box shell, glowing sign, car park with parked cars, trolley bay. */
export function mall(b: Group, a: Animated[], theme: CityTheme, random: Random, batch: Batcher) {
  block(b, 0.98, 0.012, 0.98, 0, 0.006, 0, sharedMat(0x3a3c40, 0.95), 0, false);
  block(b, 0.86, 0.32, 0.46, 0, 0.16, -0.2, sharedMat(0xe6e0d4, 0.6));
  block(b, 0.88, 0.03, 0.48, 0, 0.335, -0.2, sharedMat(theme.accent, 0.5));
  block(b, 0.3, 0.2, 0.012, 0, 0.11, 0.035, sharedMat(0x9fd8ff, 0.1, { emissive: 0x9fd8ff, emissiveIntensity: 0.5 }), 0, false);
  block(b, 0.5, 0.08, 0.02, 0, 0.27, 0.04, glow(theme.glow, 2), 0, false);
  for (let i = -3; i <= 3; i++) batch.box(sharedMat(0xe9e6dc, 0.7), 0.01, 0.003, 0.14, i * 0.12, 0.014, 0.3);
  for (let i = 0; i < 4; i++) {
    const x = (Math.floor(random() * 7) - 3) * 0.12 + 0.06;
    batch.box(sharedMat(AWNINGS[i % AWNINGS.length], 0.4, { metalness: 0.3 }), 0.08, 0.05, 0.13, x, 0.04, 0.3, 0, true);
  }
  const sign = keep(place(b, sphereGeo(0.03, 6, 4), glow(0xff6ab8, 2.4), 0.36, 0.38, 0.03, false));
  a.push({ kind: "blink", object: sign, period: 1.1, offset: random() });
}

/** A row of little shops: awnings, glowing windows, goods out front. The home builder calls this for "shopfront". */
export function shopfront(building: Group, windows: Batcher, theme: CityTheme, random: Random, era: number, wall: () => MeshStandardMaterial, roof: () => MeshStandardMaterial) {
  const modern = era >= 4;
  const floors = modern ? 2 + Math.floor(random() * 2) : 2;
  const fh = 0.28, w = 0.86, d = 0.6, z = -0.08, h = floors * fh;
  block(building, w, h, d, 0, h / 2, z, wall());
  // Two or three shop units across the ground floor.
  const units = modern ? 3 : 2;
  const unitW = w / units;
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + unitW * (i + 0.5);
    const color = AWNINGS[Math.floor(random() * AWNINGS.length)];
    windows.box(sharedMat(0xfff0c2, 0.3, { emissive: 0xffd98a, emissiveIntensity: 0.8 }), unitW * 0.7, fh * 0.55, 0.01, x, fh * 0.4, z + d / 2 + 0.004);
    // Striped awning, angled out over the pavement.
    for (let s = 0; s < 4; s++) windows.box(sharedMat(s % 2 ? 0xf4ecd8 : color, 0.8), unitW * 0.86 / 4, 0.012, 0.14, x - unitW * 0.86 * 0.375 + s * unitW * 0.86 / 4, fh * 0.78, z + d / 2 + 0.07, 0, true);
    windows.box(modern ? sharedMat(color, 0.3, { emissive: color, emissiveIntensity: 1.2 }) : sharedMat(0x5a3f2a, 0.9), unitW * 0.6, 0.05, 0.012, x, fh * 0.92, z + d / 2 + 0.006);
    // Goods out front: crates of produce, a sandwich board.
    if (random() < 0.7) {
      windows.box(sharedMat(0x8a6a43, 1), 0.07, 0.04, 0.05, x - unitW * 0.25, 0.02, z + d / 2 + 0.1, 0, true);
      windows.add(sphereGeo(0.018, 5, 4), sharedMat(AWNINGS[(i + 2) % AWNINGS.length], 0.8), x - unitW * 0.25, 0.05, z + d / 2 + 0.1, 1.6, 0.6, 1.2);
    } else windows.box(sharedMat(0x30353a, 0.8), 0.04, 0.07, 0.012, x + unitW * 0.25, 0.035, z + d / 2 + 0.12, 0.2, true);
  }
  // Flats above with plain windows.
  for (let f = 1; f < floors; f++) for (let i = 0; i < 4; i++) windows.box(sharedMat(0x2a3440, 0.3, { emissive: 0xffd98a, emissiveIntensity: random() < 0.4 ? 0.6 : 0 }), 0.08, 0.1, 0.01, -w / 2 + w * (i + 0.5) / 4, f * fh + fh * 0.5, z + d / 2 + 0.004);
  block(building, w + 0.04, 0.04, d + 0.04, 0, h + 0.02, z, roof());
  if (modern && random() < 0.5) {
    block(building, 0.14, 0.1, 0.1, 0.24, h + 0.09, z - 0.1, sharedMat(0xc8ccc8, 0.6));
  }
}
