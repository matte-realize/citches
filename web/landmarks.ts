import { Group } from "three";
import type { Material } from "three";
import { Batcher, block, cylinderGeo, place, prismGeo, pyramidGeo, sharedMat, sphereGeo, tint } from "./kit.js";
import type { CityTheme, CityThemeId } from "./theme.js";

type Random = () => number;

/**
 * Industrial-and-later landmarks and skyscrapers drawn in each civilization's own architecture,
 * replacing the generic glass towers. `tall` gives the skyscraper version.
 */
export function buildModernLandmark(building: Group, themeId: CityThemeId, theme: CityTheme, random: Random, tall: boolean) {
  const windows = new Batcher();
  const lit = () => {
    const color = theme.window[Math.floor(random() * theme.window.length)];
    return random() > 0.2 ? sharedMat(color, 0.3, { emissive: color, emissiveIntensity: 0.7 }) : sharedMat(0x34474c, 0.3);
  };
  /** Window grid on the two faces the camera usually sees plus the back pair. */
  const grid = (cx: number, cz: number, w: number, d: number, y0: number, floors: number, fh: number) => {
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + fh * 0.55;
      for (const [face, span] of [[0, w], [1, d], [2, w], [3, d]] as const) {
        const cols = Math.max(1, Math.floor(span / 0.16));
        for (let c = 0; c < cols; c++) {
          const t = (c - (cols - 1) / 2) * (span / (cols + 0.5));
          if (face === 0) windows.box(lit(), 0.07, fh * 0.5, 0.012, cx + t, y, cz + d / 2 + 0.006);
          else if (face === 2) windows.box(lit(), 0.07, fh * 0.5, 0.012, cx + t, y, cz - d / 2 - 0.006);
          else if (face === 1) windows.box(lit(), 0.012, fh * 0.5, 0.07, cx + w / 2 + 0.006, y, cz + t);
          else windows.box(lit(), 0.012, fh * 0.5, 0.07, cx - w / 2 - 0.006, y, cz + t);
        }
      }
    }
  };
  const door = (w: number, z: number, material: Material) => block(building, w, 0.26, 0.03, 0, 0.13, z, material);
  const fh = 0.3;
  const style = theme.style;

  if (style === "egypt") {
    // Sandstone tiers narrowing upward with a gold pyramidion; teal glass bands.
    const sand = sharedMat(tint(0xd3ae72, random, 0.02, 0.06), 0.8);
    const tiers = tall ? 5 : 3;
    let w = 0.86, y = 0;
    for (let i = 0; i < tiers; i++) {
      const floors = tall ? 4 : 2;
      const h = floors * fh;
      block(building, w, h, w, 0, y + h / 2, 0, i % 2 ? sharedMat(tint(0xc69c62, random), 0.8) : sand);
      grid(0, 0, w, w, y, floors, fh);
      block(building, w + 0.04, 0.04, w + 0.04, 0, y + h + 0.02, 0, sharedMat(theme.accent, 0.6));
      y += h; w *= 0.8;
    }
    if (themeId === "aztec") {
      // Stepped pyramid crowned with a red-roofed temple.
      block(building, w * 0.7, 0.24, w * 0.6, 0, y + 0.12, 0, sharedMat(0xc9553f, 0.8));
      block(building, w * 0.8, 0.05, w * 0.7, 0, y + 0.265, 0, sharedMat(theme.accent, 0.7));
    } else if (themeId === "arabian") {
      // Onion dome and a pair of minarets.
      const dome = place(building, sphereGeo(w * 0.42, 12, 8), sharedMat(theme.roof[0], 0.4, { metalness: 0.3 }), 0, y + w * 0.3, 0);
      dome.scale.set(1, 1.35, 1);
      place(building, cylinderGeo(0.01, 0.03, 0.2, 6), sharedMat(0xffd35a, 0.3, { metalness: 0.7 }), 0, y + w * 0.9, 0);
      for (const x of [-0.38, 0.38]) {
        place(building, cylinderGeo(0.04, 0.05, y + 0.5, 8), sand, x, (y + 0.5) / 2, -0.36);
        place(building, sphereGeo(0.06, 8, 5), sharedMat(theme.roof[0], 0.4), x, y + 0.55, -0.36).scale.set(1, 1.4, 1);
      }
    } else {
      const cap = place(building, pyramidGeo(), sharedMat(0xffd35a, 0.3, { metalness: 0.7, emissive: 0x7a5a10, emissiveIntensity: 0.5 }), 0, y, 0);
      cap.scale.set(w + 0.06, w * 0.9, w + 0.06);
    }
    for (const x of [-0.36, 0.36]) { const ob = place(building, cylinderGeo(0.03, 0.05, 0.5, 4), sand, x, 0.25, 0.4); ob.rotation.y = Math.PI / 4; }
    door(0.2, 0.44, sharedMat(0x3a2f26, 0.8));
  } else if (style === "rome") {
    // Arcaded travertine base, columned middle and a copper dome.
    const travertine = sharedMat(tint(0xe0cda6, random, 0.02, 0.05), 0.75);
    const baseH = 0.5;
    block(building, 0.9, baseH, 0.9, 0, baseH / 2, 0, travertine);
    for (let i = 0; i < 4; i++) block(building, 0.12, 0.3, 0.012, -0.3 + i * 0.2, 0.15, 0.456, sharedMat(0x3a2f26, 0.8));
    const floors = tall ? 12 : 5;
    const h = floors * fh;
    block(building, 0.66, h, 0.66, 0, baseH + h / 2, 0, travertine);
    grid(0, 0, 0.66, 0.66, baseH, floors, fh);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      place(building, cylinderGeo(0.025, 0.03, 0.4, 8), sharedMat(0xf0e6cc, 0.7), Math.sin(angle) * 0.3, baseH + h + 0.2, Math.cos(angle) * 0.3);
    }
    block(building, 0.72, 0.05, 0.72, 0, baseH + h + 0.42, 0, travertine);
    const dome = place(building, sphereGeo(0.32, 14, 8), sharedMat(themeId === "greek" ? theme.roof[0] : 0x5f9e8a, 0.5, { metalness: themeId === "greek" ? 0.1 : 0.4 }), 0, baseH + h + 0.44, 0);
    dome.scale.set(1, 0.7, 1);
    place(building, sphereGeo(0.04, 6, 4), sharedMat(0xffd35a, 0.3, { metalness: 0.7 }), 0, baseH + h + 0.68, 0);
  } else if (style === "norse") {
    // Dark timber and steel stave tower with stacked steep roofs and dragon-head gables.
    // Medieval keeps are stone; Norse stave towers are timber.
    const timber = sharedMat(tint(themeId === "medieval" ? 0x8a8880 : 0x5d483a, random, 0.02, 0.06), 0.9);
    const stages = tall ? 4 : 2;
    let y = 0, w = 0.8;
    for (let i = 0; i < stages; i++) {
      const floors = tall ? 3 : 2;
      const h = floors * fh;
      block(building, w, h, w, 0, y + h / 2, 0, timber);
      grid(0, 0, w, w, y, floors, fh);
      for (let k = 0; k < 5; k++) block(building, 0.02, h, 0.012, -w / 2 + 0.06 + (k * (w - 0.12)) / 4, y + h / 2, w / 2 + 0.008, sharedMat(0x2f241c, 1), 0, false);
      const roof = place(building, prismGeo(), sharedMat(themeId === "medieval" ? theme.roof[i % 2] : i % 2 ? 0x3a4440 : 0x5f7a45, 0.9), 0, y + h, 0);
      roof.scale.set(w + 0.14, 0.28, w + 0.14);
      for (const side of [-1, 1]) {
        const horn = block(building, 0.03, 0.14, 0.03, 0, y + h + 0.3, side * (w / 2 + 0.07), sharedMat(theme.accent, 0.8));
        horn.rotation.x = side * 0.5;
      }
      y += h + 0.1; w *= 0.78;
    }
    place(building, cylinderGeo(0.015, 0.015, 0.5, 5), sharedMat(0x8a9095, 0.5), 0, y + 0.3, 0);
    door(0.18, 0.4, sharedMat(0x2f241c, 1));
  } else {
    // Modern pagoda: a floor of glass under each flared, red-trimmed eave, topped with a sorin spire.
    const levels = tall ? 9 : 5;
    let y = 0, w = 0.74;
    const tile = sharedMat(tint(theme.roof[0], random, 0.02, 0.05), 0.8);
    for (let i = 0; i < levels; i++) {
      const h = fh * (i === 0 ? 1.3 : 1);
      block(building, w, h, w, 0, y + h / 2, 0, sharedMat(themeId === "china" ? (i % 3 === 0 ? 0xd8c8a8 : 0xb03a32) : i % 3 === 0 ? 0xd5bd92 : 0xc8aa82, 0.8));
      grid(0, 0, w, w, y, 1, h);
      block(building, w + 0.22, 0.035, w + 0.22, 0, y + h + 0.02, 0, tile);
      block(building, w + 0.24, 0.015, w + 0.24, 0, y + h + 0.045, 0, sharedMat(0xc0392b, 0.7));
      y += h + 0.05; w *= tall ? 0.96 : 0.92;
    }
    place(building, cylinderGeo(0.02, 0.03, 0.6, 6), sharedMat(0xd9a441, 0.3, { metalness: 0.7 }), 0, y + 0.3, 0);
    for (let i = 0; i < 5; i++) place(building, cylinderGeo(0.05, 0.05, 0.012, 10), sharedMat(0xd9a441, 0.3, { metalness: 0.7 }), 0, y + 0.08 + i * 0.07, 0);
    for (const x of [-0.36, 0.36]) {
      block(building, 0.06, 0.16, 0.06, x, 0.08, 0.42, sharedMat(0xb5a88d, 0.9));
      block(building, 0.09, 0.06, 0.09, x, 0.19, 0.42, sharedMat(theme.glow, 0.3, { emissive: theme.glow, emissiveIntensity: 1 }), 0, false);
    }
    door(0.2, 0.38, sharedMat(0x3a2f26, 0.8));
  }
  windows.flush(building);
}
