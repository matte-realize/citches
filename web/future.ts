import { BoxGeometry, Group, Mesh, OctahedronGeometry, TorusGeometry } from "three";
import type { Batcher } from "./kit.js";
import { block, coneGeo, cylinderGeo, place, sharedMat, sphereGeo } from "./kit.js";
import type { Animated } from "./specials.js";
import type { CityTheme } from "./theme.js";

/**
 * The Kardashev eras: Type I (planetary), Type II (stellar) and Type III (galactic). Every piece
 * stays inside its 1x1 lot and borrows the civilization's glow colour, so a Nile Kingdom launch
 * pad still glows its own way.
 */
type Random = () => number;
const ceramic = () => sharedMat(0xe9edf0, 0.45, { metalness: 0.15 });
const graphite = () => sharedMat(0x262b33, 0.5, { metalness: 0.3 });
const glass = () => sharedMat(0x9fd8ff, 0.1, { transparent: true, opacity: 0.32, metalness: 0.2 });
const glow = (color: number, intensity = 1.8) => sharedMat(color, 0.3, { emissive: color, emissiveIntensity: intensity });
const keep = <T extends { userData: Record<string, unknown> }>(object: T) => { object.userData.keep = true; return object; };
const pad = (b: Group, color = 0x8d9298) => block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(color, 0.9), 0, false);

// ---------- Type I: planetary ----------

export function launchPad(b: Group, a: Animated[], theme: CityTheme, random: Random) {
  pad(b, 0x7c8084);
  place(b, cylinderGeo(0.3, 0.34, 0.06, 16), sharedMat(0x5a5e63, 0.9), 0.05, 0.03, 0.05);
  for (let i = 0; i < 6; i++) block(b, 0.06, 0.004, 0.012, 0.05 + Math.cos(i) * 0.2, 0.062, 0.05 + Math.sin(i) * 0.2, sharedMat(0xf2c94c, 0.6), i, false);
  // Gantry: four legs with cross-bracing and swing arms.
  const steel = sharedMat(0xc0392b, 0.6, { metalness: 0.3 });
  for (const [x, z] of [[-0.36, -0.3], [-0.24, -0.3], [-0.36, -0.18], [-0.24, -0.18]] as const) block(b, 0.02, 1.3, 0.02, x, 0.65, z, steel);
  for (let y = 0.15; y < 1.3; y += 0.2) {
    block(b, 0.14, 0.015, 0.015, -0.3, y, -0.3, steel, 0, false);
    block(b, 0.015, 0.015, 0.14, -0.36, y + 0.1, -0.24, steel, 0, false);
  }
  for (const y of [0.55, 0.95]) block(b, 0.28, 0.02, 0.03, -0.13, y, -0.2, steel, 0.6, false);
  // The rocket: body, interstage bands, nose and fins.
  const rocket = keep(new Group());
  rocket.position.set(0.05, 0.06, 0.05);
  place(rocket, cylinderGeo(0.08, 0.08, 1.05, 12), ceramic(), 0, 0.55, 0);
  for (const y of [0.3, 0.75]) place(rocket, cylinderGeo(0.082, 0.082, 0.04, 12), graphite(), 0, y, 0, false);
  place(rocket, coneGeo(0.08, 0.24, 12), sharedMat(theme.accent, 0.5), 0, 1.2, 0);
  for (let i = 0; i < 4; i++) block(rocket, 0.012, 0.16, 0.1, Math.cos(i * Math.PI / 2) * 0.1, 0.1, Math.sin(i * Math.PI / 2) * 0.1, graphite(), i * Math.PI / 2 + Math.PI / 2);
  b.add(rocket);
  b.userData.rocket = rocket;
  const beacon = keep(place(b, sphereGeo(0.025, 6, 4), glow(0xff3322, 2.4), -0.3, 1.33, -0.24, false));
  a.push({ kind: "blink", object: beacon, period: 1.2, offset: random() });
}

export function fusionReactor(b: Group, a: Animated[], theme: CityTheme) {
  pad(b, 0x6d7278);
  place(b, cylinderGeo(0.42, 0.44, 0.12, 20), ceramic(), 0, 0.06, 0);
  const dome = place(b, sphereGeo(0.3, 16, 10), ceramic(), 0, 0.12, 0);
  dome.scale.set(1, 0.75, 1);
  const ring = keep(new Group());
  ring.position.set(0, 0.36, 0);
  const torus = new Mesh(new TorusGeometry(0.36, 0.035, 8, 28), glow(theme.glow, 2.2));
  torus.rotation.x = Math.PI / 2;
  ring.add(torus);
  for (let i = 0; i < 6; i++) block(ring, 0.05, 0.05, 0.08, Math.cos(i * Math.PI / 3) * 0.36, 0, Math.sin(i * Math.PI / 3) * 0.36, graphite(), -i * Math.PI / 3);
  b.add(ring);
  a.push({ kind: "spin", object: ring, axis: "y", speed: 1.2 });
  const core = keep(place(b, sphereGeo(0.07, 10, 8), glow(0xfff4c8, 3), 0, 0.42, 0, false));
  a.push({ kind: "blink", object: core, period: 2.4, offset: 0 });
  for (const sx of [-1, 1]) block(b, 0.1, 0.22, 0.1, sx * 0.36, 0.11, 0.34, graphite());
}

export function weatherSpire(b: Group, a: Animated[], theme: CityTheme) {
  pad(b, 0x737880);
  place(b, cylinderGeo(0.2, 0.28, 0.16, 8), ceramic(), 0, 0.08, 0);
  place(b, cylinderGeo(0.025, 0.07, 1.7, 8), ceramic(), 0, 1.0, 0);
  for (const [y, r, speed] of [[0.7, 0.2, 1.4], [1.1, 0.15, -2], [1.45, 0.1, 2.8]] as const) {
    const halo = keep(new Group());
    halo.position.y = y;
    const torus = new Mesh(new TorusGeometry(r, 0.012, 6, 24), glow(theme.glow, 1.8));
    torus.rotation.x = Math.PI / 2 + 0.3;
    halo.add(torus);
    b.add(halo);
    a.push({ kind: "spin", object: halo, axis: "y", speed });
  }
  const orb = keep(place(b, sphereGeo(0.06, 10, 8), glow(0x9ff0ff, 2.6), 0, 1.9, 0, false));
  a.push({ kind: "blink", object: orb, period: 3, offset: 0.2 });
}

export function maglevHub(b: Group, a: Animated[], theme: CityTheme, random: Random, batch: Batcher) {
  pad(b, 0x6a6f75);
  // An elevated guideway on slim pylons with a streamlined train resting at the platform.
  for (const x of [-0.36, 0, 0.36]) block(b, 0.05, 0.36, 0.05, x, 0.18, -0.1, ceramic());
  block(b, 0.96, 0.04, 0.12, 0, 0.38, -0.1, ceramic());
  block(b, 0.94, 0.006, 0.02, 0, 0.403, -0.1, glow(theme.glow, 1.4), 0, false);
  const train = place(b, cylinderGeo(0.05, 0.05, 0.7, 10), sharedMat(0xf4f6f8, 0.3, { metalness: 0.3 }), 0, 0.46, -0.1);
  train.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) place(b, sphereGeo(0.05, 10, 6), sharedMat(0xf4f6f8, 0.3, { metalness: 0.3 }), sx * 0.35, 0.46, -0.1).scale.set(1.8, 1, 1);
  for (let i = -3; i <= 3; i++) batch.box(glow(0x9fd8ff, 1.2), 0.05, 0.02, 0.004, i * 0.09, 0.47, -0.05);
  // Platform canopy and stairs.
  block(b, 0.7, 0.02, 0.3, 0, 0.6, 0.16, glass());
  for (const x of [-0.32, 0.32]) block(b, 0.02, 0.6, 0.02, x, 0.3, 0.28, graphite());
  block(b, 0.6, 0.14, 0.26, 0, 0.07, 0.2, ceramic());
  const sign = keep(place(b, sphereGeo(0.02, 6, 4), glow(0x7cf29a, 2.4), 0.3, 0.64, 0.3, false));
  a.push({ kind: "blink", object: sign, period: 1.8, offset: random() });
}

// ---------- Type II: stellar ----------

export function beamCollector(b: Group, a: Animated[], theme: CityTheme) {
  pad(b, 0x5d6268);
  place(b, cylinderGeo(0.14, 0.2, 0.3, 10), ceramic(), 0, 0.15, 0);
  const dish = place(b, sphereGeo(0.42, 18, 8), sharedMat(0xdfe4e8, 0.3, { metalness: 0.4 }), 0, 0.72, 0);
  dish.scale.set(1, 0.32, 1);
  place(b, cylinderGeo(0.02, 0.02, 0.5, 6), graphite(), 0, 0.82, 0);
  place(b, sphereGeo(0.05, 8, 6), glow(theme.glow, 2.6), 0, 1.08, 0, false);
  // The power beam from the orbital swarm: tall, see-through, gently pulsing.
  const beam = keep(place(b, cylinderGeo(0.035, 0.035, 9, 8, ), sharedMat(theme.glow, 0.2, { emissive: theme.glow, emissiveIntensity: 2.4, transparent: true, opacity: 0.4 }), 0, 5.6, 0, false));
  a.push({ kind: "blink", object: beam, period: 4, offset: 0.1 });
}

export function habitatPark(b: Group, a: Animated[], theme: CityTheme, random: Random) {
  pad(b, 0x5f7a45);
  place(b, cylinderGeo(0.45, 0.46, 0.05, 24), ceramic(), 0, 0.025, 0);
  for (let i = 0; i < 6; i++) {
    const x = (random() - 0.5) * 0.5, z = (random() - 0.5) * 0.5;
    place(b, cylinderGeo(0.012, 0.016, 0.14, 5), sharedMat(0x5d4433, 1), x, 0.12, z);
    place(b, sphereGeo(0.07 + random() * 0.04, 7, 5), sharedMat(theme.foliage[i % theme.foliage.length], 1), x, 0.24, z);
  }
  place(b, cylinderGeo(0.12, 0.12, 0.01, 14), sharedMat(0x4aa0c8, 0.2), 0.18, 0.055, -0.16);
  const dome = keep(place(b, sphereGeo(0.44, 20, 10), glass(), 0, 0.04, 0, false));
  dome.scale.set(1, 0.85, 1);
  for (let i = 0; i < 4; i++) {
    const rib = new Mesh(new TorusGeometry(0.44, 0.008, 4, 24, Math.PI), ceramic());
    rib.rotation.y = i * Math.PI / 4;
    rib.position.y = 0.04;
    rib.scale.set(1, 0.85, 1);
    b.add(rib);
  }
  const light = keep(place(b, sphereGeo(0.03, 6, 4), glow(theme.glow, 2), 0, 0.42, 0, false));
  a.push({ kind: "blink", object: light, period: 2.2, offset: random() });
}

export function starForge(b: Group, a: Animated[], theme: CityTheme) {
  pad(b, 0x4a4e55);
  // A captive micro-star held by three magnetic arms: the city taps a sun of its own.
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const arm = new Group();
    arm.rotation.y = angle;
    block(arm, 0.08, 0.9, 0.08, 0.36, 0.45, 0, graphite());
    block(arm, 0.22, 0.06, 0.06, 0.26, 0.92, 0, ceramic());
    b.add(arm);
  }
  place(b, cylinderGeo(0.36, 0.4, 0.08, 18), ceramic(), 0, 0.04, 0);
  const star = keep(new Group());
  star.position.y = 0.78;
  place(star, sphereGeo(0.16, 14, 10), glow(0xffd36b, 3.2), 0, 0, 0, false);
  const corona = new Mesh(new TorusGeometry(0.22, 0.012, 6, 28), glow(0xffa040, 2.4));
  corona.rotation.x = 1.1;
  star.add(corona);
  const corona2 = new Mesh(new TorusGeometry(0.26, 0.01, 6, 28), glow(theme.glow, 2));
  corona2.rotation.x = -0.6; corona2.rotation.y = 0.8;
  star.add(corona2);
  b.add(star);
  a.push({ kind: "spin", object: star, axis: "y", speed: 1.8 });
}

// ---------- Type III: galactic ----------

export function stargate(b: Group, a: Animated[], theme: CityTheme) {
  pad(b, 0x3c3f48);
  block(b, 0.8, 0.08, 0.36, 0, 0.04, 0.1, graphite());
  for (let i = 0; i < 3; i++) block(b, 0.5 - i * 0.1, 0.04, 0.1, 0, 0.1 + i * 0.04, 0.32 - i * 0.06, ceramic());
  const ring = new Mesh(new TorusGeometry(0.38, 0.06, 8, 30), graphite());
  ring.position.set(0, 0.5, -0.05);
  b.add(ring);
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI * 2 / 9;
    const chevron = keep(place(b, new BoxGeometry(0.05, 0.05, 0.08), glow(0xff9a3a, 2.2), Math.cos(angle) * 0.38, 0.5 + Math.sin(angle) * 0.38, -0.05, false));
    chevron.rotation.z = angle;
    a.push({ kind: "blink", object: chevron, period: 3.6, offset: i / 9 });
  }
  // The event horizon: a shimmering disc that slowly turns.
  const horizon = keep(new Group());
  horizon.position.set(0, 0.5, -0.05);
  const disc = place(horizon, cylinderGeo(0.33, 0.33, 0.01, 24), sharedMat(0x6fd8ff, 0.1, { emissive: theme.glow, emissiveIntensity: 1.6, transparent: true, opacity: 0.7 }), 0, 0, 0, false);
  disc.rotation.x = Math.PI / 2;
  const swirl = place(horizon, cylinderGeo(0.2, 0.2, 0.012, 6), sharedMat(0xe0f6ff, 0.1, { emissive: 0xbfe8ff, emissiveIntensity: 2, transparent: true, opacity: 0.5 }), 0, 0, 0.004, false);
  swirl.rotation.x = Math.PI / 2;
  b.add(horizon);
  a.push({ kind: "spin", object: horizon, axis: "z", speed: 0.9 });
}

export function monolith(b: Group, a: Animated[], theme: CityTheme, random: Random) {
  pad(b, 0x2c2f36);
  block(b, 0.26, 1.6, 0.08, 0, 0.8, 0, sharedMat(0x0d0e12, 0.2, { metalness: 0.6 }));
  for (const sx of [-1, 1]) block(b, 0.006, 1.6, 0.084, sx * 0.13, 0.8, 0, glow(theme.glow, 2), 0, false);
  // Fragments of something older orbit it.
  const orbit = keep(new Group());
  orbit.position.y = 0.9;
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    const shard = place(orbit, new OctahedronGeometry(0.04 + random() * 0.03, 0), glow(0xd46bff, 1.6), Math.cos(angle) * 0.36, (random() - 0.5) * 0.5, Math.sin(angle) * 0.36, false);
    shard.rotation.set(random() * 3, random() * 3, 0);
  }
  b.add(orbit);
  a.push({ kind: "spin", object: orbit, axis: "y", speed: 0.6 });
}

export function crystalSpire(b: Group, a: Animated[], theme: CityTheme, random: Random) {
  pad(b, 0x343844);
  const colors = [0xd46bff, theme.glow, 0x7ff0ff];
  for (let i = 0; i < 7; i++) {
    const tall = i === 0;
    const h = tall ? 1.8 : 0.4 + random() * 0.7;
    const x = tall ? 0 : (random() - 0.5) * 0.6, z = tall ? 0 : (random() - 0.5) * 0.6;
    const crystal = place(b, new OctahedronGeometry(1, 0), sharedMat(colors[i % 3], 0.15, { emissive: colors[i % 3], emissiveIntensity: tall ? 1.4 : 0.9, metalness: 0.3 }), x, h / 2, z);
    crystal.scale.set(tall ? 0.14 : 0.07, h / 2, tall ? 0.14 : 0.07);
    crystal.rotation.y = random() * 3;
    crystal.rotation.z = tall ? 0 : (random() - 0.5) * 0.5;
  }
  const halo = keep(new Group());
  halo.position.y = 1.4;
  const torus = new Mesh(new TorusGeometry(0.24, 0.01, 6, 28), glow(0xffffff, 2));
  torus.rotation.x = Math.PI / 2;
  halo.add(torus);
  b.add(halo);
  a.push({ kind: "sway", object: halo, speed: 0.8, amount: 0.25 });
}

// ---------- homes for the far future ----------

/** Tapering stacked rings with glowing bands: a whole neighbourhood in one tower. */
export function arcology(building: Group, windows: Batcher, theme: CityTheme, random: Random, era: number) {
  const levels = 5 + Math.floor(random() * 3) + (era >= 9 ? 2 : 0);
  let y = 0;
  for (let i = 0; i < levels; i++) {
    const r = 0.36 - i * 0.025;
    const h = 0.26;
    place(building, cylinderGeo(r, r + 0.02, h, 12), i % 2 ? ceramic() : sharedMat(0xd5dbe0, 0.4, { metalness: 0.2 }), 0, y + h / 2, -0.04);
    windows.add(cylinderGeo(r + 0.005, r + 0.005, 0.05, 12), glow(theme.glow, 1.2), 0, y + h * 0.62, -0.04);
    if (i % 2 === 0) for (let j = 0; j < 3; j++) {
      const angle = random() * Math.PI * 2;
      windows.add(sphereGeo(0.045, 6, 5), sharedMat(theme.foliage[j % theme.foliage.length], 1), Math.cos(angle) * (r + 0.02), y + h + 0.03, -0.04 + Math.sin(angle) * (r + 0.02), 1, 0.8, 1, 0, true);
    }
    y += h;
  }
  place(building, cylinderGeo(0.01, 0.02, 0.5, 6), ceramic(), 0, y + 0.25, -0.04);
  place(building, sphereGeo(0.03, 6, 4), glow(0xff3322, 2.4), 0, y + 0.5, -0.04, false);
  block(building, 0.2, 0.16, 0.06, 0, 0.08, 0.34, glass());
}

/** A glass dome home with a garden ring and a hover-car pad. */
export function domeHome(building: Group, windows: Batcher, theme: CityTheme, random: Random) {
  place(building, cylinderGeo(0.4, 0.42, 0.06, 20), ceramic(), 0, 0.03, -0.05);
  const shell = place(building, sphereGeo(0.32, 16, 10), sharedMat(0xe2e8ec, 0.35, { metalness: 0.15 }), 0, 0.06, -0.08);
  shell.scale.set(1, 0.9, 1);
  const window = place(building, sphereGeo(0.325, 16, 10), sharedMat(0x1d2a3a, 0.1, { metalness: 0.5 }), 0, 0.06, -0.08);
  window.scale.set(1, 0.9, 1);
  window.rotation.y = random() * 0.5;
  // Glass band and door.
  windows.add(cylinderGeo(0.33, 0.33, 0.04, 20), glow(theme.glow, 1.1), 0, 0.2, -0.08);
  block(building, 0.14, 0.18, 0.06, 0, 0.09, 0.23, ceramic());
  block(building, 0.08, 0.13, 0.01, 0, 0.075, 0.262, sharedMat(0x1d2a3a, 0.2));
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    windows.add(sphereGeo(0.04, 6, 5), sharedMat(theme.foliage[i % theme.foliage.length], 1), Math.cos(angle) * 0.4, 0.07, -0.05 + Math.sin(angle) * 0.4, 1, 0.8, 1, 0, true);
  }
  block(building, 0.2, 0.01, 0.2, 0.3, 0.065, 0.3, graphite(), 0, false);
  windows.add(cylinderGeo(0.05, 0.05, 0.004, 12), glow(0x7cf29a, 1.4), 0.3, 0.072, 0.3);
}

/** A slim core with sleeping pods clipped on, each window glowing. */
export function podTower(building: Group, windows: Batcher, theme: CityTheme, random: Random) {
  const h = 1.6 + random() * 0.8;
  place(building, cylinderGeo(0.1, 0.12, h, 10), ceramic(), 0, h / 2, -0.05);
  for (let y = 0.25; y < h - 0.1; y += 0.2) {
    const turns = 3 + Math.floor(random() * 2);
    for (let i = 0; i < turns; i++) {
      const angle = (i / turns) * Math.PI * 2 + y * 3;
      const x = Math.cos(angle) * 0.22, z = -0.05 + Math.sin(angle) * 0.22;
      windows.add(sphereGeo(0.09, 8, 6), sharedMat(i % 2 ? 0xe9edf0 : 0xd2d9df, 0.4, { metalness: 0.15 }), x, y, z, 1.2, 0.8, 1, -angle, true);
      windows.add(sphereGeo(0.04, 6, 4), glow(theme.glow, 1.3), x + Math.cos(angle) * 0.08, y, z + Math.sin(angle) * 0.08);
    }
  }
  place(building, coneGeo(0.12, 0.3, 10), ceramic(), 0, h + 0.15, -0.05);
  block(building, 0.22, 0.2, 0.12, 0, 0.1, 0.22, glass());
}
