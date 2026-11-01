import { Group } from "three";
import type { Material } from "three";
import { Batcher, bakeStatic, block, coneGeo, cylinderGeo, place, prismGeo, pyramidGeo, sharedMat, sphereGeo, tint } from "./kit.js";
import type { Animated } from "./specials.js";
import type { CityTheme, CityThemeId } from "./theme.js";
import type { CapitolDonor } from "../src/types.js";

type Random = () => number;
export type CapitolStyle = "egypt" | "rome" | "norse" | "japan";

/** Theme names for each capitol stage (index = stage, 0 is the bare campfire). */
export const CAPITOL_NAMES: Record<CapitolStyle, string[]> = {
  egypt: ["Campfire", "Gathering Circle", "House of Elders", "Hall of Pillars", "Temple Complex", "Temple of the Sun"],
  rome: ["Campfire", "Gathering Circle", "Curia", "Basilica", "Forum", "Capitolium"],
  norse: ["Campfire", "Gathering Circle", "Longhall", "Thing Hall", "Great Hall", "Great Mead Hall"],
  japan: ["Campfire", "Gathering Circle", "Village Hall", "Shrine Hall", "Castle", "Imperial Castle"]
};

/**
 * The community capitol around the founding campfire. It occupies the 3x3 central block and keeps
 * an open courtyard at its heart (|x| < 0.85, z > -0.85) for the fire and the villagers, so it
 * grows as a U around the plaza: a back wing, then side wings, then towers, domes and banners.
 * Coordinates are relative to the block centre; +z faces the main street.
 */
export function buildCapitol(stage: number, style: CapitolStyle, theme: CityTheme, random: Random, donors: CapitolDonor[] = []) {
  const group = new Group();
  const animated: Animated[] = [];
  const windows = new Batcher();
  const stone = sharedMat(theme.stone, 0.85);
  const wall = sharedMat(tint(theme.house[1], random, 0.01, 0.04), 0.8);
  const roof = sharedMat(theme.roof[0], 0.82);
  const accent = sharedMat(theme.accent, 0.7);
  const gold = sharedMat(0xffd35a, 0.3, { metalness: 0.7, emissive: 0x7a5a10, emissiveIntensity: 0.5 });
  const lit = () => { const c = theme.window[Math.floor(random() * theme.window.length)]; return sharedMat(c, 0.3, { emissive: c, emissiveIntensity: 0.8 }); };
  const row = (x0: number, x1: number, y: number, z: number, count: number, w = 0.07, h = 0.12) => {
    for (let i = 0; i < count; i++) windows.box(lit(), w, h, 0.012, x0 + ((i + 0.5) / count) * (x1 - x0), y, z);
  };
  const keep = <T extends { userData: Record<string, unknown> }>(object: T) => { object.userData.keep = true; return object; };

  // Stage 1: paved plaza ring, benches and banner poles. Kept at every later stage.
  if (stage >= 1) {
    place(group, cylinderGeo(1.05, 1.05, 0.02, 24), sharedMat(tint(theme.stone, random, 0.01, 0.08), 0.9), 0, 0.012, 0, false);
    place(group, cylinderGeo(0.4, 0.4, 0.022, 16), sharedMat(0x6b6458, 0.9), 0, 0.014, 0, false);
    for (const [x, z] of [[-1.2, 1.2], [1.2, 1.2], [-1.2, -1.2], [1.2, -1.2]] as const) {
      place(group, cylinderGeo(0.02, 0.025, 0.7, 5), sharedMat(0x5a3f2a, 1), x, 0.35, z);
      const banner = keep(block(group, 0.16, 0.24, 0.01, x + 0.08, 0.56, z, accent));
      animated.push({ kind: "sway", object: banner, speed: 2 + random(), amount: 0.12 });
      const lamp = keep(place(group, sphereGeo(0.04, 6, 4), sharedMat(theme.glow, 0.3, { emissive: theme.glow, emissiveIntensity: 1.6 }), x, 0.74, z, false));
      animated.push({ kind: "blink", object: lamp, period: 3 + random(), offset: random() });
    }
  }
  // Stage 2+: the back wing.
  if (stage >= 2) {
    const h = stage === 2 ? 0.55 : stage === 3 ? 0.8 : 1.05;
    const width = stage >= 4 ? 2.9 : 2.2;
    block(group, width + 0.1, 0.08, 0.7, 0, 0.04, -1.15, stone);
    block(group, width, h, 0.6, 0, h / 2 + 0.08, -1.15, wall);
    for (let f = 0; f < Math.max(1, Math.round(h / 0.32)); f++) row(-width / 2 + 0.1, width / 2 - 0.1, 0.25 + f * 0.3, -0.845, Math.round(width / 0.22));
    block(group, 0.3, 0.32, 0.03, 0, 0.24, -0.84, sharedMat(0x3a2f26, 0.8));
    backRoof(group, style, width, h + 0.08, roof, stone, gold, stage);
  }
  // Stage 3+: side wings (colonnades at stage 3, full wings later) and front steps.
  if (stage >= 3) {
    for (const side of [-1, 1]) {
      const x = side * 1.17;
      if (stage === 3) {
        for (let i = 0; i < 5; i++) place(group, cylinderGeo(0.035, 0.04, 0.5, 8), stone, x, 0.29, -0.8 + i * 0.4);
        block(group, 0.12, 0.06, 1.8, x, 0.57, 0, roof);
      } else {
        const h = stage === 4 ? 0.7 : 0.85;
        block(group, 0.56, h, 1.9, x, h / 2 + 0.06, -0.1, wall);
        for (let f = 0; f < 2; f++) windows.box(lit(), 0.012, 0.12, 0.08, x - side * 0.285, 0.25 + f * 0.3, 0.1);
        for (let f = 0; f < 2; f++) for (let i = 0; i < 5; i++) windows.box(lit(), 0.012, 0.12, 0.08, x + side * 0.285, 0.25 + f * 0.3, -0.8 + i * 0.36);
        sideRoof(group, style, x, h + 0.06, roof);
      }
    }
  }
  // Stage 4+: the grand centrepiece rising over the back wing, and gate pillars.
  if (stage >= 4) {
    centrepiece(group, style, theme, roof, stone, gold, accent, stage, animated);
    // Gate pillars flank the path in from the main street.
    for (const x of [-0.42, 0.42]) {
      block(group, 0.14, 0.6, 0.14, x, 0.3, 1.2, stone);
      place(group, sphereGeo(0.06, 6, 4), stage >= 5 ? gold : stone, x, 0.66, 1.2);
    }
  }
  // Stage 5: gold trim, a beacon, fountains and banners for the top donors.
  if (stage >= 5) {
    block(group, 2.92, 0.04, 0.62, 0, 1.15, -1.15, gold);
    for (const [x, z] of [[-1.25, 1.1], [1.25, 1.1]] as const) {
      place(group, cylinderGeo(0.16, 0.18, 0.08, 12), stone, x, 0.04, z);
      place(group, cylinderGeo(0.13, 0.13, 0.01, 12), sharedMat(0x4aa8d0, 0.1, { emissive: 0x1d6f9a, emissiveIntensity: 0.6 }), x, 0.085, z, false);
      animated.push({ kind: "smoke", at: { x, y: 0.12, z } as never, rate: 3, color: 0xbfe8f5 });
    }
    donors.slice(0, 4).forEach((donor, index) => {
      const x = -0.9 + index * 0.6;
      place(group, cylinderGeo(0.012, 0.012, 0.6, 4), sharedMat(0x3a3530, 0.6), x, 1.45, -0.86);
      const flag = keep(block(group, 0.18, 0.11, 0.01, x + 0.09, 1.68, -0.86, sharedMat(donor.color ?? 0xffd35a, 0.7)));
      animated.push({ kind: "sway", object: flag, speed: 2.5 + index * 0.3, amount: 0.25 });
    });
  }
  windows.flush(group);
  bakeStatic(group, 2);
  return { group, animated };
}

function backRoof(group: Group, style: CapitolStyle, width: number, y: number, roof: Material, stone: Material, gold: Material, stage: number) {
  if (style === "egypt") {
    block(group, width + 0.06, 0.08, 0.66, 0, y + 0.04, -1.15, stone);
    // Pylon gate towers flanking the entrance.
    for (const x of [-0.42, 0.42]) {
      const pylon = place(group, cylinderGeo(0.16, 0.24, 0.9 + stage * 0.08, 4), stone, x, (0.9 + stage * 0.08) / 2 + 0.08, -0.82);
      pylon.rotation.y = Math.PI / 4;
      pylon.scale.set(1.3, 1, 0.5);
    }
    if (stage >= 3) for (const x of [-1.0, 1.0]) { const ob = place(group, coneGeo(0.07, 0.9, 4), gold, x, 0.53, -0.75); ob.rotation.y = Math.PI / 4; }
  } else if (style === "rome") {
    const pediment = place(group, prismGeo(), stone, 0, y, -1.15);
    pediment.rotation.y = Math.PI / 2;
    pediment.scale.set(0.66, 0.26, width + 0.08);
    for (let i = 0; i < 6; i++) place(group, cylinderGeo(0.035, 0.04, y - 0.08, 8), sharedMat(0xf0e6cc, 0.7), -0.75 + i * 0.3, (y - 0.08) / 2 + 0.08, -0.8);
  } else if (style === "norse") {
    const ridge = place(group, prismGeo(), roof, 0, y, -1.15);
    ridge.rotation.y = Math.PI / 2;
    ridge.scale.set(0.8, 0.5, width + 0.12);
    for (const x of [-width / 2 - 0.06, width / 2 + 0.06]) for (const side of [-1, 1]) {
      const horn = block(group, 0.04, 0.22, 0.04, x, y + 0.55, -1.15 + side * 0.06, sharedMat(0xd2a75f, 0.8));
      horn.rotation.x = side * 0.55;
    }
  } else {
    block(group, width + 0.3, 0.04, 0.9, 0, y + 0.02, -1.15, roof);
    const hip = place(group, pyramidGeo(), roof, 0, y + 0.04, -1.15);
    hip.scale.set(width + 0.1, 0.3, 0.7);
    if (stage >= 3) for (const x of [-width / 2, width / 2]) block(group, 0.12, 0.05, 0.12, x, y + 0.06, -0.78, gold);
  }
}

function sideRoof(group: Group, style: CapitolStyle, x: number, y: number, roof: Material) {
  if (style === "egypt") { block(group, 0.6, 0.06, 1.94, x, y + 0.03, -0.1, roof); return; }
  if (style === "japan") { block(group, 0.8, 0.035, 2.1, x, y + 0.02, -0.1, roof); const hip = place(group, pyramidGeo(), roof, x, y + 0.04, -0.1); hip.scale.set(0.6, 0.22, 1.94); return; }
  const gable = place(group, prismGeo(), roof, x, y, -0.1);
  gable.scale.set(0.66, style === "norse" ? 0.4 : 0.22, 1.98);
}

function centrepiece(group: Group, style: CapitolStyle, theme: CityTheme, roof: Material, stone: Material, gold: Material, accent: Material, stage: number, animated: Animated[]) {
  const big = stage >= 5 ? 1.25 : 1;
  if (style === "egypt") {
    // A pyramid behind the temple, capped in gold at the final stage.
    const pyramid = place(group, pyramidGeo(), sharedMat(tint(0xd8c08b, () => 0.5), 0.8), 0, 1.13, -1.15);
    pyramid.scale.set(1.3 * big, 1.1 * big, 0.62);
    const cap = place(group, pyramidGeo(), gold, 0, 1.13 + 0.9 * big, -1.15);
    cap.scale.set(0.26 * big, 0.2 * big, 0.12);
  } else if (style === "rome") {
    place(group, cylinderGeo(0.42 * big, 0.44 * big, 0.3, 18), stone, 0, 1.28, -1.15);
    const dome = place(group, sphereGeo(0.44 * big, 16, 8), sharedMat(0x5f9e8a, 0.5, { metalness: 0.4 }), 0, 1.42, -1.15);
    dome.scale.set(1, 0.75, 1);
    place(group, cylinderGeo(0.06, 0.08, 0.16, 8), stage >= 5 ? gold : stone, 0, 1.42 + 0.34 * big, -1.15);
  } else if (style === "norse") {
    // A stave tower with stacked steep roofs.
    let y = 1.13, w = 0.6 * big;
    for (let i = 0; i < (stage >= 5 ? 3 : 2); i++) {
      block(group, w, 0.36, w, 0, y + 0.18, -1.15, sharedMat(0x5d483a, 0.9));
      const top = place(group, pyramidGeo(), roof, 0, y + 0.36, -1.15);
      top.scale.set(w + 0.16, 0.34, w + 0.16);
      y += 0.6; w *= 0.72;
    }
    place(group, cylinderGeo(0.015, 0.015, 0.3, 4), gold, 0, y + 0.1, -1.15);
  } else {
    // Castle keep: stone base, white tiers with flared roofs.
    // The keep rises clear of the back wing's roof.
    block(group, 0.9 * big, 0.36, 0.6, 0, 1.6, -1.15, stone);
    let y = 1.78, w = 0.8 * big;
    for (let i = 0; i < (stage >= 5 ? 4 : 3); i++) {
      block(group, w, 0.28, Math.min(0.56, w), 0, y + 0.14, -1.15, sharedMat(0xf2eee2, 0.8));
      block(group, w + 0.24, 0.035, Math.min(0.56, w) + 0.24, 0, y + 0.3, -1.15, roof);
      block(group, w + 0.26, 0.015, Math.min(0.56, w) + 0.26, 0, y + 0.325, -1.15, accent);
      y += 0.34; w *= 0.8;
    }
    for (const x of [-0.12, 0.12]) { const fish = place(group, coneGeo(0.03, 0.1, 5), gold, x, y + 0.06, -1.15); fish.rotation.z = x > 0 ? -0.6 : 0.6; }
  }
  if (stage >= 5) {
    const beacon = place(group, sphereGeo(0.05, 6, 4), sharedMat(theme.glow, 0.3, { emissive: theme.glow, emissiveIntensity: 2.4 }), 0, 2.6, -1.15, false);
    beacon.userData.keep = true;
    animated.push({ kind: "blink", object: beacon, period: 2, offset: 0 });
  }
}

export const capitolStyleFor = (themeId: CityThemeId | string): CapitolStyle => (["egypt", "rome", "norse", "japan"].includes(themeId) ? themeId : "rome") as CapitolStyle;
