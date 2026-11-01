import { Group } from "three";
import type { Material } from "three";
import { Batcher, block, coneGeo, cylinderGeo, place, prismGeo, pyramidGeo, sharedMat, sphereGeo, tint } from "./kit.js";
import type { CityTheme, CityThemeId } from "./theme.js";
import { addGadgets } from "./specials.js";

type Random = () => number;
export type HomeStyle =
  | "cottage" | "courtyard" | "rowhouses" | "tower" | "farmstead" | "signature"
  | "apartment" | "walkup" | "setback" | "round" | "villa" | "gardenTower";

const FLOWERS = [0xe46a8a, 0xf2c94c, 0xf08a4b, 0xb98be0, 0xf5f0e6];
const DOORS = [0x624737, 0x3f5d6b, 0x7a3b32, 0x4c5e3b, 0x2f2a28, 0x8a6a3a];
const BRICK = [0x9c4f3a, 0x8a4434, 0xa8644a, 0x7d5041, 0xb07a5a];

/**
 * Builds a wide range of homes. Every home keeps its entrance on the +z face (the city rotates
 * the lot to face its street) and stays inside the 1x1 lot so neighbours never overlap.
 */
export class HomeKit {
  private recent: HomeStyle[] = [];
  constructor(private random: Random, private theme: CityTheme, private themeId: CityThemeId) {}

  private pick<T>(list: readonly T[]): T { return list[Math.floor(this.random() * list.length)]; }
  private wall() { return sharedMat(tint(this.pick(this.theme.house), this.random, 0.03, 0.12), 0.86); }
  private roofMat() { return sharedMat(tint(this.pick(this.theme.roof), this.random, 0.02, 0.08), 0.85); }
  private stone() { return sharedMat(this.theme.stone, 0.85); }
  private door() { return sharedMat(this.random() < 0.3 ? this.theme.accent : this.pick(DOORS), 0.9); }

  chooseStyle(era: number): HomeStyle {
    const pool: HomeStyle[] = era <= 3
      ? ["cottage", "courtyard", "rowhouses", "tower", "signature", "signature", ...(era === 2 ? ["farmstead", "cottage"] as HomeStyle[] : ["tower", "rowhouses"] as HomeStyle[])]
      : ["apartment", "walkup", "setback", "round", "villa", "rowhouses", ...(era >= 5 ? ["gardenTower", "villa"] as HomeStyle[] : ["walkup"] as HomeStyle[])];
    const fresh = pool.filter(style => !this.recent.includes(style));
    const style = this.pick(fresh.length ? fresh : pool);
    this.recent.push(style);
    if (this.recent.length > 3) this.recent.shift();
    return style;
  }

  private era = 0;

  build(building: Group, era: number, style = this.chooseStyle(era)) {
    this.era = era;
    const windows = new Batcher();
    const ctx = { building, era, windows };
    switch (style) {
      case "cottage": this.cottage(ctx); break;
      case "courtyard": this.courtyard(ctx); break;
      case "rowhouses": this.rowhouses(ctx); break;
      case "tower": this.tower(ctx); break;
      case "farmstead": this.farmstead(ctx); break;
      case "signature": this.signature(ctx); break;
      case "apartment": this.apartment(ctx); break;
      case "walkup": this.walkup(ctx); break;
      case "setback": this.setback(ctx); break;
      case "round": this.round(ctx); break;
      case "villa": this.villa(ctx); break;
      case "gardenTower": this.gardenTower(ctx); break;
    }
    windows.flush(building);
    building.userData.style = style;
  }

  /** Early alternative dwellings mixed in with the theme huts, plus yard clutter for every hut. */
  primitive(building: Group, kind = this.pick(["tent", "pit", "stilt"] as const)) {
    const hide = sharedMat(tint(this.themeId === "egypt" ? 0xd8c69c : 0xb89b74, this.random, 0.03, 0.12), 1);
    const wood = sharedMat(0x6b4a2e, 1);
    if (kind === "tent") {
      const tent = place(building, coneGeo(0.36, 0.72, 7), hide, 0, 0.36, -0.05);
      tent.castShadow = true;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const pole = place(building, cylinderGeo(0.01, 0.012, 0.3, 4), wood, Math.sin(a) * 0.05, 0.78, -0.05 + Math.cos(a) * 0.05);
        pole.rotation.x = Math.cos(a) * 0.3; pole.rotation.z = -Math.sin(a) * 0.3;
      }
      for (let i = 0; i < 3; i++) block(building, 0.2, 0.012, 0.01, 0, 0.2 + i * 0.12, 0.28 - i * 0.05, sharedMat(this.theme.accent, 0.9), 0, false);
      block(building, 0.14, 0.26, 0.02, 0, 0.13, 0.29, sharedMat(0x3a2a1e, 1));
    } else if (kind === "pit") {
      const dome = place(building, sphereGeo(0.4, 10, 6), sharedMat(0x6e7a46, 1), 0, -0.02, -0.04);
      dome.scale.set(1, 0.7, 1);
      place(building, cylinderGeo(0.42, 0.44, 0.06, 12), this.stone(), 0, 0.03, -0.04);
      block(building, 0.18, 0.2, 0.16, 0, 0.1, 0.32, sharedMat(0x5a4632, 1));
      block(building, 0.12, 0.16, 0.02, 0, 0.08, 0.405, sharedMat(0x2b2018, 1));
      place(building, cylinderGeo(0.03, 0.035, 0.12, 6), this.stone(), 0.12, 0.3, -0.12);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(building, cylinderGeo(0.025, 0.03, 0.3, 5), wood, sx * 0.28, 0.15, -0.06 + sz * 0.24);
      block(building, 0.68, 0.04, 0.6, 0, 0.31, -0.06, wood);
      block(building, 0.56, 0.32, 0.48, 0, 0.49, -0.08, sharedMat(tint(this.pick(this.theme.house), this.random), 1));
      this.gable(building, 0.56, 0.48, 0.65, 0.32, this.roofMat(), false, 0, -0.08, 0.07);
      for (let i = 0; i < 5; i++) block(building, 0.14, 0.02, 0.05, 0, 0.05 + i * 0.06, 0.4 - i * 0.03, wood, 0, false);
      block(building, 0.13, 0.22, 0.02, 0, 0.43, 0.165, sharedMat(0x3a2a1e, 1));
    }
  }

  yardClutter(building: Group) {
    const roll = this.random();
    const wood = sharedMat(0x7a5a3a, 1);
    if (roll < 0.25) {
      for (let i = 0; i < 5; i++) { const log = place(building, cylinderGeo(0.022, 0.022, 0.16, 6), wood, -0.38, 0.025 + Math.floor(i / 3) * 0.045, -0.2 + (i % 3) * 0.045); log.rotation.x = Math.PI / 2; }
    } else if (roll < 0.5) {
      for (const x of [-0.42, -0.24]) place(building, cylinderGeo(0.01, 0.01, 0.24, 4), wood, x, 0.12, 0.36);
      block(building, 0.2, 0.01, 0.01, -0.33, 0.22, 0.36, wood, 0, false);
      block(building, 0.12, 0.1, 0.005, -0.33, 0.16, 0.36, sharedMat(0xa08060, 1));
    } else if (roll < 0.75) {
      block(building, 0.26, 0.025, 0.18, 0.32, 0.012, 0.32, sharedMat(0x4a3a2a, 1));
      for (let i = 0; i < 6; i++) place(building, sphereGeo(0.025, 5, 4), sharedMat(this.pick([0x6b8f3e, 0x7fa04a, 0xd8be73]), 1), 0.22 + (i % 3) * 0.1, 0.04, 0.28 + Math.floor(i / 3) * 0.08, false);
    } else {
      for (let i = 0; i < 3; i++) place(building, sphereGeo(0.04, 7, 5), sharedMat(this.pick([0x9a5a3a, 0xa8744a, 0x7a4a32]), 1), 0.34 + i * 0.05, 0.035, 0.36 - i * 0.04).scale.set(1, 1.15, 1);
    }
  }

  // ---------- shared pieces ----------
  private windowMat(lit = this.random() > 0.25) {
    const color = this.pick(this.theme.window);
    return lit ? sharedMat(color, 0.3, { emissive: color, emissiveIntensity: 0.65 }) : sharedMat(0x34474c, 0.3, { emissive: 0x0d171a, emissiveIntensity: 0.1 });
  }

  /** Windows on all four faces of a box footprint. */
  private windowsOn(batch: Batcher, cx: number, cz: number, w: number, d: number, y0: number, floors: number, floorH: number, opts: { tall?: boolean; skipFrontGround?: boolean; shutters?: Material } = {}) {
    const winH = opts.tall ? floorH * 0.55 : Math.min(0.16, floorH * 0.42);
    for (let floor = 0; floor < floors; floor++) {
      const y = y0 + floor * floorH + floorH * 0.55;
      for (const face of [0, 1, 2, 3]) {
        const span = face % 2 === 0 ? w : d;
        const cols = Math.max(1, Math.min(4, Math.floor(span / 0.2)));
        for (let c = 0; c < cols; c++) {
          const t = (c - (cols - 1) / 2) * (span / (cols + 0.4));
          if (opts.skipFrontGround && floor === 0 && face === 0 && Math.abs(t) < 0.12) continue;
          const material = this.windowMat();
          const out = 0.008;
          // Dark frame behind the pane and a pale sill underneath give each window some depth.
          const frame = sharedMat(0x2a2620, 0.8), sill = sharedMat(0xe8e0cc, 0.8);
          if (face === 0) {
            batch.box(frame, 0.122, winH + 0.022, 0.016, cx + t, y, cz + d / 2 + 0.004);
            batch.box(material, 0.1, winH, 0.02, cx + t, y, cz + d / 2 + out);
            batch.box(sill, 0.13, 0.018, 0.04, cx + t, y - winH / 2 - 0.012, cz + d / 2 + 0.016);
          } else if (face === 2) {
            batch.box(frame, 0.122, winH + 0.022, 0.016, cx + t, y, cz - d / 2 - 0.004);
            batch.box(material, 0.1, winH, 0.02, cx + t, y, cz - d / 2 - out);
          } else if (face === 1) {
            batch.box(frame, 0.016, winH + 0.022, 0.122, cx + w / 2 + 0.004, y, cz + t);
            batch.box(material, 0.02, winH, 0.1, cx + w / 2 + out, y, cz + t);
            batch.box(sill, 0.04, 0.018, 0.13, cx + w / 2 + 0.016, y - winH / 2 - 0.012, cz + t);
          } else {
            batch.box(frame, 0.016, winH + 0.022, 0.122, cx - w / 2 - 0.004, y, cz + t);
            batch.box(material, 0.02, winH, 0.1, cx - w / 2 - out, y, cz + t);
          }
          if (opts.shutters && face === 0) for (const s of [-1, 1]) batch.box(opts.shutters, 0.03, winH, 0.015, cx + t + s * 0.068, y, cz + d / 2 + 0.012);
        }
      }
    }
    // Trim bands between storeys.
    if (floors > 1) {
      const trim = sharedMat(tint(this.theme.stone, this.random, 0.01, 0.05), 0.8);
      for (let floor = 1; floor < floors; floor++) {
        const y = y0 + floor * floorH;
        batch.box(trim, w + 0.02, 0.025, d + 0.02, cx, y, cz, 0, true);
      }
    }
  }

  /** Each civilization keeps its character after industrialisation. */
  private themeTouch(parent: Group, w: number, d: number, h: number, x: number, z: number, floors: number, fh: number) {
    if (this.themeId === "egypt") {
      this.palm(parent, x + w * 0.3, z - d * 0.25);
      for (const child of parent.children.slice(-10)) child.position.y += h; // lift the palm onto the roof
      this.awning(parent, w * 0.4, d * 0.35, h, x - w * 0.15, z + d * 0.1);
    } else if (this.themeId === "rome") {
      this.hip(parent, w + 0.06, d + 0.06, h, 0.18, sharedMat(tint(0xb05b42, this.random), 0.85), x, z);
      for (const sx of [-1, 1]) place(parent, cylinderGeo(0.025, 0.03, 0.34, 8), sharedMat(0xe0d3b5, 0.7), x + sx * 0.12, 0.17, z + d / 2 + 0.05);
      block(parent, 0.32, 0.04, 0.08, x, 0.36, z + d / 2 + 0.05, sharedMat(0xe0d3b5, 0.7));
    } else if (this.themeId === "norse") {
      for (let i = 0; i < 5; i++) block(parent, 0.02, h * 0.98, 0.012, x - w / 2 + 0.08 + (i * (w - 0.16)) / 4, h / 2, z + d / 2 + 0.008, sharedMat(0x4f3a28, 1), 0, false);
      this.gable(parent, w, d, h, 0.3, sharedMat(this.random() < 0.5 ? 0x3a4440 : 0x5f7a45, 0.9), this.random() < 0.5, x, z, 0.04);
    } else {
      const tile = sharedMat(tint(this.pick(this.theme.roof), this.random), 0.85);
      for (let floor = 2; floor < floors; floor += 2) block(parent, w + 0.16, 0.03, d + 0.16, x, floor * fh + 0.02, z, tile);
      block(parent, w + 0.2, 0.035, d + 0.2, x, h + 0.02, z, tile);
      const lantern = block(parent, 0.07, 0.1, 0.07, x + w / 2 - 0.05, 0.3, z + d / 2 + 0.06, sharedMat(this.theme.accent, 0.6, { emissive: this.theme.accent, emissiveIntensity: 0.9 }));
      lantern.castShadow = false;
    }
  }

  private gable(parent: Group, w: number, d: number, y: number, rise: number, material: Material, ridgeAlongX = false, x = 0, z = 0, overhang = 0.05) {
    const roof = place(parent, prismGeo(), material, x, y, z);
    roof.scale.set((ridgeAlongX ? d : w) + overhang * 2, rise, (ridgeAlongX ? w : d) + overhang * 2);
    if (ridgeAlongX) roof.rotation.y = Math.PI / 2;
    return roof;
  }

  private hip(parent: Group, w: number, d: number, y: number, rise: number, material: Material, x = 0, z = 0) {
    const roof = place(parent, pyramidGeo(), material, x, y, z);
    roof.scale.set(w, rise, d);
    return roof;
  }

  /** Theme-appropriate roof over a box. */
  private themedRoof(parent: Group, w: number, d: number, y: number, x = 0, z = 0, material = this.roofMat()) {
    if (this.themeId === "egypt") {
      this.parapet(parent, w, d, y, x, z);
      if (this.random() < 0.5) this.awning(parent, w * 0.5, d * 0.45, y, x + w * 0.18, z - d * 0.15);
    } else if (this.themeId === "rome") {
      this.hip(parent, w + 0.08, d + 0.08, y, 0.2 + this.random() * 0.08, material, x, z);
    } else if (this.themeId === "norse") {
      const turf = this.random() < 0.5;
      this.gable(parent, w, d, y, 0.32, turf ? sharedMat(0x5f7a45, 1) : material, this.random() < 0.5, x, z, 0.06);
    } else {
      block(parent, w + 0.2, 0.035, d + 0.2, x, y + 0.015, z, material);
      this.hip(parent, w + 0.06, d + 0.06, y + 0.03, 0.24, material, x, z);
    }
  }

  private parapet(parent: Group, w: number, d: number, y: number, x = 0, z = 0) {
    const material = this.stone();
    block(parent, w + 0.03, 0.08, 0.04, x, y + 0.04, z + d / 2, material);
    block(parent, w + 0.03, 0.08, 0.04, x, y + 0.04, z - d / 2, material);
    block(parent, 0.04, 0.08, d, x + w / 2, y + 0.04, z, material);
    block(parent, 0.04, 0.08, d, x - w / 2, y + 0.04, z, material);
  }

  private awning(parent: Group, w: number, d: number, y: number, x: number, z: number) {
    const cloth = sharedMat(this.random() < 0.5 ? this.theme.accent : 0xe8dcc0, 0.9);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(parent, cylinderGeo(0.01, 0.01, 0.22, 4), sharedMat(0x6b4a2e, 1), x + sx * w / 2, y + 0.11, z + sz * d / 2);
    const top = block(parent, w + 0.04, 0.015, d + 0.04, x, y + 0.23, z, cloth);
    top.rotation.x = 0.08;
  }

  private chimney(parent: Group, x: number, y: number, z: number) {
    block(parent, 0.07, 0.24, 0.07, x, y + 0.12, z, sharedMat(this.themeId === "norse" ? 0x6b665a : 0x8a5a44, 0.9));
    block(parent, 0.09, 0.025, 0.09, x, y + 0.25, z, sharedMat(0x4a4038, 0.9));
    // The city puffs smoke from some chimneys (local position, read after the home is built).
    (parent.userData.smoke ??= []).push({ x, y: y + 0.28, z });
  }

  private entrance(parent: Group, x: number, z: number, height = 0.24, width = 0.11) {
    block(parent, width + 0.03, height + 0.02, 0.022, x, height / 2 + 0.025, z + 0.006, sharedMat(0x3a2f26, 0.9));
    block(parent, width, height, 0.03, x, height / 2 + 0.02, z + 0.012, this.door());
    block(parent, 0.014, 0.014, 0.01, x + width * 0.3, height * 0.5 + 0.02, z + 0.03, sharedMat(0xd9a441, 0.4, { metalness: 0.6 }), 0, false);
    if (this.era >= 3) {
      const lamp = block(parent, 0.03, 0.04, 0.03, x + width / 2 + 0.04, height * 0.85, z + 0.03, sharedMat(this.theme.glow, 0.3, { emissive: this.theme.glow, emissiveIntensity: 1.4 }), 0, false);
      lamp.receiveShadow = false;
    }
    if (this.random() < 0.5) block(parent, width + 0.06, 0.02, 0.07, x, height + 0.06, z + 0.03, this.roofMat());
    block(parent, width + 0.04, 0.025, 0.06, x, 0.012, z + 0.035, this.stone());
  }

  private tree(parent: Group, x: number, z: number, scale = 1, color?: number) {
    place(parent, cylinderGeo(0.018 * scale, 0.026 * scale, 0.22 * scale, 5), sharedMat(0x6d4c35, 1), x, 0.11 * scale, z);
    const crown = color ?? this.pick(this.theme.foliage);
    place(parent, sphereGeo(0.1 * scale, 7, 5), sharedMat(crown, 1), x, 0.27 * scale, z);
    place(parent, sphereGeo(0.075 * scale, 7, 5), sharedMat(crown, 1), x + 0.04 * scale, 0.35 * scale, z - 0.02 * scale);
  }

  private palm(parent: Group, x: number, z: number) {
    const trunk = sharedMat(0x8a6a45, 1);
    for (let i = 0; i < 4; i++) place(parent, cylinderGeo(0.018, 0.022, 0.1, 5), trunk, x + i * 0.008, 0.05 + i * 0.095, z);
    const frond = sharedMat(0x5c8f4e, 1);
    for (let i = 0; i < 6; i++) {
      const leaf = block(parent, 0.03, 0.012, 0.2, x + 0.03 + Math.sin(i) * 0.06, 0.4, z + Math.cos(i) * 0.06, frond, i * Math.PI / 3);
      leaf.rotation.x = 0.4;
    }
  }

  private flowers(parent: Group, x: number, z: number, w: number, d: number) {
    block(parent, w, 0.03, d, x, 0.015, z, sharedMat(0x4a3a2a, 1));
    for (let i = 0; i < Math.round(w * d * 140); i++) {
      place(parent, sphereGeo(0.018, 5, 4), sharedMat(this.pick(FLOWERS), 0.9), x + (this.random() - 0.5) * w * 0.9, 0.045, z + (this.random() - 0.5) * d * 0.9, false);
    }
  }

  private fence(parent: Group, x0: number, x1: number, z: number, material = sharedMat(this.themeId === "japan" ? 0x5b4b3a : 0x8a6d4e, 1), gapCenter?: number) {
    const count = Math.round((x1 - x0) / 0.08);
    for (let i = 0; i <= count; i++) {
      const x = x0 + (i / count) * (x1 - x0);
      if (gapCenter !== undefined && Math.abs(x - gapCenter) < 0.08) continue;
      block(parent, 0.018, 0.09, 0.018, x, 0.045, z, material, 0, false);
    }
    if (gapCenter === undefined) block(parent, x1 - x0, 0.014, 0.012, (x0 + x1) / 2, 0.07, z, material, 0, false);
    else {
      block(parent, gapCenter - 0.08 - x0, 0.014, 0.012, (x0 + gapCenter - 0.08) / 2, 0.07, z, material, 0, false);
      block(parent, x1 - gapCenter - 0.08, 0.014, 0.012, (x1 + gapCenter + 0.08) / 2, 0.07, z, material, 0, false);
    }
  }

  private lawn(parent: Group, color: number = this.pick(this.theme.foliage)) {
    block(parent, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(tint(color, this.random, 0.01, 0.06), 1), 0, false);
  }

  // ---------- pre-industrial archetypes ----------
  private cottage({ building, era, windows }: Ctx) {
    this.lawn(building);
    const w = 0.5 + this.random() * 0.12, d = 0.46 + this.random() * 0.08;
    const floors = era >= 3 && this.random() < 0.6 ? 2 : 1;
    const fh = 0.3, h = floors * fh, z = -0.12;
    block(building, w, h, d, 0, h / 2, z, this.wall());
    this.windowsOn(windows, 0, z, w, d, 0, floors, fh, { skipFrontGround: true, shutters: this.random() < 0.6 ? sharedMat(this.theme.accent, 0.9) : undefined });
    this.entrance(building, 0, z + d / 2);
    const ridgeAlongX = this.random() < 0.5;
    if (this.themeId === "egypt") this.themedRoof(building, w, d, h, 0, z);
    else this.gable(building, w, d, h, 0.22 + this.random() * 0.1, this.roofMat(), ridgeAlongX, 0, z);
    if (this.themeId !== "egypt") this.chimney(building, w * 0.3, h + 0.05, z - d * 0.2);
    if (this.random() < 0.5) this.flowers(building, -0.25, 0.32, 0.3, 0.14);
    else this.tree(building, -0.3, 0.3, 0.9);
    if (this.random() < 0.7) this.fence(building, -0.46, 0.46, 0.45, undefined, 0);
    if (this.random() < 0.4) place(building, cylinderGeo(0.04, 0.035, 0.08, 8), sharedMat(0x8a6a43, 1), 0.32, 0.04, 0.28); // barrel
  }

  private courtyard({ building, era, windows }: Ctx) {
    this.lawn(building, 0x8e8264);
    const wallMat = this.wall();
    const fh = 0.3, floors = era >= 3 ? 2 : 1, h = fh * floors;
    // Back block plus a side wing form an L around a small courtyard.
    block(building, 0.9, h, 0.36, 0, h / 2, -0.28, wallMat);
    block(building, 0.32, h * 0.8, 0.5, -0.29, h * 0.4, 0.15, wallMat);
    this.windowsOn(windows, 0, -0.28, 0.9, 0.36, 0, floors, fh);
    this.windowsOn(windows, -0.29, 0.15, 0.32, 0.5, 0, 1, h * 0.8, { skipFrontGround: true });
    this.entrance(building, -0.29, 0.4);
    this.themedRoof(building, 0.9, 0.36, h, 0, -0.28);
    this.themedRoof(building, 0.32, 0.5, h * 0.8, -0.29, 0.15);
    // Low garden wall closing the courtyard.
    block(building, 0.04, 0.12, 0.5, 0.44, 0.06, 0.15, this.stone());
    block(building, 0.5, 0.12, 0.04, 0.2, 0.06, 0.42, this.stone());
    if (this.themeId === "egypt") this.palm(building, 0.18, 0.12);
    else if (this.themeId === "japan") this.tree(building, 0.18, 0.12, 0.9, 0xc0503e);
    else this.tree(building, 0.18, 0.12, 0.9);
    if (this.random() < 0.5) place(building, cylinderGeo(0.06, 0.07, 0.05, 10), sharedMat(0x5f8fa0, 0.3, { metalness: 0.2 }), 0.05, 0.03, 0.22); // fountain / well
  }

  private rowhouses({ building, era, windows }: Ctx) {
    const units = this.random() < 0.5 ? 2 : 3;
    const unitW = 0.92 / units;
    const modern = era >= 4;
    for (let i = 0; i < units; i++) {
      const x = -0.46 + unitW * (i + 0.5);
      const floors = modern ? 3 + Math.floor(this.random() * 3) : 2 + Math.floor(this.random() * (era >= 3 ? 3 : 2));
      const fh = modern ? 0.32 : 0.3, h = floors * fh, d = 0.62 + this.random() * 0.12, z = -0.1;
      const material = modern && this.random() < 0.5 ? sharedMat(this.pick(BRICK), 0.9) : this.wall();
      block(building, unitW - 0.01, h, d, x, h / 2, z, material);
      this.windowsOn(windows, x, z, unitW - 0.01, d, 0, floors, fh, { skipFrontGround: true, tall: modern });
      this.entrance(building, x, z + d / 2, 0.22, 0.09);
      // Front stoop + optional bay window.
      if (this.random() < 0.5) block(building, unitW * 0.55, fh * 0.7, 0.08, x, fh * 1.45, z + d / 2 + 0.04, material);
      if (modern || this.themeId === "egypt" || this.random() < 0.4) {
        block(building, unitW, 0.05, d + 0.03, x, h + 0.025, z, this.stone());
        if (this.random() < 0.4) this.chimney(building, x + unitW * 0.2, h, z - d * 0.25);
      } else this.gable(building, unitW - 0.01, d, h, 0.2 + this.random() * 0.1, this.roofMat(), false, x, z, 0.02);
      if (this.random() < 0.5) this.flowers(building, x, 0.38, unitW * 0.7, 0.08);
    }
  }

  private tower({ building, era, windows }: Ctx) {
    this.lawn(building, 0x7f7458);
    const floors = era >= 3 ? 4 + Math.floor(this.random() * 2) : 3;
    const fh = 0.3, w = 0.5, d = 0.5, h = floors * fh;
    const material = this.wall();
    block(building, w, h, d, -0.1, h / 2, -0.1, material);
    this.windowsOn(windows, -0.1, -0.1, w, d, 0, floors, fh, { skipFrontGround: true });
    this.entrance(building, -0.1, 0.15);
    // Top floor steps back, leaving a terrace with plants.
    const top = 0.3;
    block(building, top, fh, top, -0.18, h + fh / 2, -0.18, material);
    this.windowsOn(windows, -0.18, -0.18, top, top, h, 1, fh);
    this.themedRoof(building, top, top, h + fh, -0.18, -0.18);
    this.parapet(building, w, d, h, -0.1, -0.1);
    for (const [x, z] of [[0.05, 0.05], [-0.25, 0.05]]) place(building, sphereGeo(0.045, 6, 5), sharedMat(this.pick(this.theme.foliage), 1), x, h + 0.06, z);
    // External stair climbing the side.
    const stair = this.stone();
    for (let i = 0; i < floors * 2; i++) block(building, 0.1, 0.04, 0.08, 0.2, 0.05 + i * (h / (floors * 2)), -0.32 + i * (0.5 / (floors * 2)), stair, 0, false);
    if (this.themeId === "egypt") this.palm(building, 0.32, 0.3);
    else this.tree(building, 0.32, 0.3, 0.8);
  }

  private farmstead({ building, windows }: Ctx) {
    this.lawn(building, 0x7d8a4e);
    const w = 0.46, d = 0.4, h = 0.3;
    block(building, w, h, d, -0.2, h / 2, -0.18, this.wall());
    this.windowsOn(windows, -0.2, -0.18, w, d, 0, 1, h, { skipFrontGround: true });
    this.entrance(building, -0.2, 0.02);
    this.gable(building, w, d, h, 0.22, this.roofMat(), true, -0.2, -0.18);
    // Barn
    const barnColor = this.themeId === "norse" ? 0x7a3b2c : this.themeId === "japan" ? 0x5b4b3a : 0x9a7a52;
    block(building, 0.3, 0.32, 0.4, 0.28, 0.16, -0.2, sharedMat(barnColor, 0.95));
    this.gable(building, 0.3, 0.4, 0.32, 0.18, this.roofMat(), false, 0.28, -0.2, 0.03);
    block(building, 0.14, 0.2, 0.02, 0.28, 0.1, 0.005, sharedMat(0x4a3628, 1));
    // Hay bales and a crop row.
    for (const x of [0.15, 0.32]) { const bale = place(building, cylinderGeo(0.06, 0.06, 0.1, 10), sharedMat(0xd8be73, 1), x, 0.06, 0.3); bale.rotation.z = Math.PI / 2; }
    for (let i = 0; i < 3; i++) block(building, 0.34, 0.04, 0.04, -0.24, 0.02, 0.22 + i * 0.08, sharedMat(i % 2 ? 0x6b8f3e : 0x7fa04a, 1));
    this.fence(building, -0.46, 0.46, 0.46);
  }

  private signature({ building, era, windows }: Ctx) {
    if (this.themeId === "egypt") {
      // Mudbrick house with rooftop terrace, stair and shade awning.
      this.lawn(building, 0xb59a6a);
      const h = era >= 3 ? 0.62 : 0.4;
      block(building, 0.78, h, 0.62, 0, h / 2, -0.12, this.wall());
      this.windowsOn(windows, 0, -0.12, 0.78, 0.62, 0, era >= 3 ? 2 : 1, 0.3, { skipFrontGround: true });
      this.entrance(building, -0.15, 0.19);
      block(building, 0.34, 0.26, 0.3, -0.18, h + 0.13, -0.26, this.wall());
      this.parapet(building, 0.78, 0.62, h, 0, -0.12);
      this.awning(building, 0.3, 0.24, h, 0.16, -0.06);
      for (let i = 0; i < 5; i++) block(building, 0.12, 0.04, 0.07, 0.35, 0.04 + i * h / 5, 0.15 - i * 0.07, this.stone(), 0, false);
      this.palm(building, -0.38, 0.32);
      place(building, sphereGeo(0.04, 6, 5), sharedMat(0x9a5a3a, 1), 0.2, 0.04, 0.33); // pot
    } else if (this.themeId === "rome") {
      // Domus: tiled roof around an open atrium, a small portico in front.
      this.lawn(building, 0x8b8a62);
      const h = era >= 3 ? 0.48 : 0.38;
      block(building, 0.86, h, 0.7, 0, h / 2, -0.1, this.wall());
      this.windowsOn(windows, 0, -0.1, 0.86, 0.7, 0, 1, h, { skipFrontGround: true });
      const tiles = this.roofMat();
      for (const [x, z, w, d, rx, rz] of [[0, 0.17, 0.92, 0.2, -0.35, 0], [0, -0.37, 0.92, 0.2, 0.35, 0], [0.33, -0.1, 0.2, 0.52, 0, 0.35], [-0.33, -0.1, 0.2, 0.52, 0, -0.35]] as const) {
        const slab = block(building, w, 0.04, d, x, h + 0.06, z, tiles);
        slab.rotation.x = rx; slab.rotation.z = rz;
      }
      block(building, 0.3, 0.02, 0.28, 0, h + 0.005, -0.1, sharedMat(0x4f7f95, 0.2, { metalness: 0.3 }));
      for (const x of [-0.14, 0.14]) place(building, cylinderGeo(0.03, 0.035, 0.32, 8), sharedMat(0xe0d3b5, 0.7), x, 0.16, 0.34);
      const pediment = place(building, prismGeo(), sharedMat(this.theme.stone, 0.75), 0, 0.32, 0.32);
      pediment.scale.set(0.42, 0.12, 0.1);
      this.entrance(building, 0, 0.25);
      this.tree(building, 0.36, 0.36, 0.7, 0x3f5a35);
    } else if (this.themeId === "norse") {
      // Longhouse with turf roof and carved crossed gables.
      this.lawn(building, 0x5c7348);
      const h = 0.3;
      block(building, 0.92, h, 0.5, 0, h / 2, -0.12, sharedMat(0x6b4f35, 1));
      for (let i = 0; i < 7; i++) block(building, 0.025, h, 0.52, -0.42 + i * 0.14, h / 2, -0.12, sharedMat(0x4f3a28, 1), 0, false);
      this.windowsOn(windows, 0, -0.12, 0.92, 0.5, 0, 1, h, { skipFrontGround: true });
      this.gable(building, 0.92, 0.5, h, 0.34, sharedMat(this.random() < 0.6 ? 0x5f7a45 : 0x8a7a4a, 1), true, 0, -0.12, 0.06);
      for (const x of [-0.5, 0.5]) for (const side of [-1, 1]) {
        const horn = block(building, 0.03, 0.18, 0.03, x, h + 0.36, -0.12 + side * 0.05, sharedMat(this.theme.accent, 0.8));
        horn.rotation.x = side * 0.6;
      }
      this.entrance(building, 0.1, 0.13);
      for (let i = 0; i < 6; i++) { const log = place(building, cylinderGeo(0.025, 0.025, 0.2, 6), sharedMat(0x7a5a3a, 1), -0.3, 0.03 + Math.floor(i / 3) * 0.05, 0.25 + (i % 3) * 0.05); log.rotation.z = Math.PI / 2; }
      if (this.random() < 0.5) place(building, sphereGeo(0.1, 7, 5), sharedMat(0xc9b37a, 1), 0.3, 0.06, 0.3).scale.set(1, 0.6, 1);
    } else {
      // Machiya with a veranda, flared tile roofs and a lantern garden.
      this.lawn(building, 0x6f8a5a);
      const fh = 0.3, floors = era >= 3 ? 2 : 1;
      const w = 0.72, d = 0.56, z = -0.14;
      block(building, w + 0.08, 0.06, d + 0.12, 0, 0.03, z + 0.03, sharedMat(0x6a4b35, 1)); // engawa
      block(building, w, fh * floors, d, 0, (fh * floors) / 2 + 0.06, z, this.wall());
      for (let i = 0; i < 6; i++) block(building, 0.02, fh * floors, 0.02, -w / 2 + (i * w) / 5, (fh * floors) / 2 + 0.06, z + d / 2 + 0.005, sharedMat(0x4a3428, 1), 0, false);
      this.windowsOn(windows, 0, z, w, d, 0.06, floors, fh, { skipFrontGround: true });
      const tile = this.roofMat();
      if (floors > 1) block(building, w + 0.2, 0.03, d + 0.2, 0, fh + 0.07, z, tile);
      this.themedRoof(building, w, d, fh * floors + 0.06, 0, z, tile);
      this.entrance(building, 0, z + d / 2);
      // Stone lantern and a maple.
      block(building, 0.06, 0.12, 0.06, 0.34, 0.06, 0.32, this.stone());
      block(building, 0.1, 0.05, 0.1, 0.34, 0.14, 0.32, sharedMat(this.theme.glow, 0.4, { emissive: this.theme.glow, emissiveIntensity: 0.8 }));
      place(building, pyramidGeo(), this.stone(), 0.34, 0.165, 0.32).scale.set(0.13, 0.06, 0.13);
      this.tree(building, -0.34, 0.32, 0.8, this.random() < 0.5 ? 0xc0503e : 0xe6a3b8);
    }
  }

  // ---------- industrial and later archetypes ----------
  private apartment({ building, era, windows }: Ctx) {
    const floors = 4 + Math.floor(this.random() * (era >= 5 ? 5 : 3));
    const fh = 0.32, w = 0.78, d = 0.7, h = floors * fh, z = -0.08;
    const material = this.random() < 0.4 ? sharedMat(this.pick(BRICK), 0.9) : this.wall();
    block(building, w + 0.06, 0.08, d + 0.06, 0, 0.04, z, this.stone());
    block(building, w, h, d, 0, h / 2 + 0.04, z, material);
    this.windowsOn(windows, 0, z, w, d, 0.04, floors, fh, { tall: true, skipFrontGround: true });
    this.entrance(building, 0, z + d / 2, 0.24, 0.16);
    const rail = sharedMat(0x2f3538, 0.5, { metalness: 0.4 });
    const slab = this.stone();
    for (let f = 1; f < floors; f++) {
      const y = 0.04 + f * fh;
      for (const x of [-0.22, 0.22]) {
        if (this.random() < 0.2) continue;
        windows.box(slab, 0.26, 0.025, 0.1, x, y, z + d / 2 + 0.05, 0, true);
        windows.box(rail, 0.26, 0.06, 0.01, x, y + 0.04, z + d / 2 + 0.1);
        if (this.random() < 0.3) windows.add(sphereGeo(0.03, 5, 4), sharedMat(this.pick(FLOWERS), 0.9), x + 0.08, y + 0.04, z + d / 2 + 0.07);
      }
      if (this.random() < 0.4) windows.box(sharedMat(0xb9bcb8, 0.6), 0.07, 0.06, 0.05, w / 2 + 0.03, y + 0.1, z + (this.random() - 0.5) * 0.4);
    }
    block(building, w + 0.04, 0.05, d + 0.04, 0, h + 0.065, z, this.stone());
    if (era === 4) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(building, cylinderGeo(0.008, 0.008, 0.12, 4), rail, 0.2 + sx * 0.06, h + 0.15, z - 0.12 + sz * 0.06);
      place(building, cylinderGeo(0.09, 0.09, 0.14, 10), sharedMat(0x7a5a3d, 1), 0.2, h + 0.28, z - 0.12);
      place(building, coneGeo(0.1, 0.06, 10), sharedMat(0x5a4a3a, 1), 0.2, h + 0.38, z - 0.12);
    } else this.roofGarden(building, w * 0.8, d * 0.7, h + 0.09, 0, z);
    addGadgets(building, this.random, h + 0.09, w, d, 0, z, era);
    this.themeTouch(building, w, d, h + 0.09, 0, z, floors, fh);
  }

  private walkup({ building, era, windows }: Ctx) {
    const floors = 3 + Math.floor(this.random() * 3);
    const fh = 0.3, w = 0.66, d = 0.74, h = floors * fh, x = -0.08, z = -0.05;
    const brick = sharedMat(this.pick(BRICK), 0.95);
    block(building, w, h, d, x, h / 2, z, brick);
    this.windowsOn(windows, x, z, w, d, 0, floors, fh, { skipFrontGround: true, shutters: sharedMat(0xe8e2d2, 0.8) });
    this.entrance(building, x, z + d / 2, 0.24, 0.13);
    // Cornice and stoop.
    block(building, w + 0.06, 0.06, d + 0.06, x, h + 0.03, z, sharedMat(0xd8cfbd, 0.8));
    for (let i = 0; i < 3; i++) block(building, 0.2, 0.03, 0.04, x, 0.015 + i * 0.03, z + d / 2 + 0.1 - i * 0.035, this.stone());
    // Fire escape zig-zag on the +x face.
    const iron = sharedMat(0x2a2e31, 0.6, { metalness: 0.5 });
    for (let f = 1; f < floors; f++) {
      const y = f * fh;
      windows.box(iron, 0.1, 0.015, 0.36, x + w / 2 + 0.05, y, z, 0, true);
      windows.box(iron, 0.008, 0.06, 0.36, x + w / 2 + 0.1, y + 0.03, z);
      const ladder = block(building, 0.06, 0.012, 0.32, x + w / 2 + 0.05, y - fh / 2, z, iron, 0, false);
      ladder.rotation.x = (f % 2 ? 1 : -1) * 0.75;
    }
    for (const cx of [-0.18, 0.08]) this.chimney(building, x + cx, h + 0.04, z - 0.2);
    addGadgets(building, this.random, h + 0.06, w, d, x + 0.05, z + 0.05, era);
    if (this.themeId === "japan" || this.themeId === "norse") this.themeTouch(building, w, d, h + 0.06, x, z, floors, fh);
    if (era >= 5) this.solar(building, 0.3, 0.3, h + 0.07, x + 0.1, z + 0.12);
    this.tree(building, 0.38, 0.38, 0.8);
  }

  private setback({ building, era, windows }: Ctx) {
    const material = this.wall();
    const tiers = 3;
    let y = 0, w = 0.86, d = 0.8;
    const fh = 0.32;
    for (let t = 0; t < tiers; t++) {
      const floors = t === 0 ? 3 + Math.floor(this.random() * 2) : 2 + Math.floor(this.random() * 2);
      const h = floors * fh;
      block(building, w, h, d, 0, y + h / 2, -0.04, t % 2 ? sharedMat(tint(this.theme.stone, this.random), 0.8) : material);
      this.windowsOn(windows, 0, -0.04, w, d, y, floors, fh, { tall: true, skipFrontGround: t === 0 });
      block(building, w + 0.03, 0.035, d + 0.03, 0, y + h + 0.017, -0.04, sharedMat(0x3a4448, 0.6));
      y += h;
      w *= 0.72; d *= 0.72;
    }
    this.entrance(building, 0, 0.36, 0.28, 0.2);
    const spire = place(building, coneGeo(0.07, 0.5, 8), sharedMat(this.theme.accent, 0.35, { metalness: 0.5 }), 0, y + 0.25, -0.04);
    spire.castShadow = true;
    if (era >= 5) place(building, sphereGeo(0.03, 6, 5), sharedMat(0xff5544, 0.3, { emissive: 0xff3322, emissiveIntensity: 2 }), 0, y + 0.52, -0.04, false);
  }

  private round({ building, era, windows }: Ctx) {
    const floors = 5 + Math.floor(this.random() * 4);
    const fh = 0.3, r = 0.32, h = floors * fh, z = -0.05;
    const shell = place(building, cylinderGeo(r, r, h, 16), this.wall(), 0, h / 2, z);
    shell.castShadow = true;
    const ring = sharedMat(0xe4e0d4, 0.7);
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      if (f > 0) place(building, cylinderGeo(r + 0.06, r + 0.06, 0.025, 16), ring, 0, y, z);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + (f % 2) * 0.2;
        windows.box(this.windowMat(), 0.1, fh * 0.5, 0.02, Math.sin(a) * (r + 0.008), y + fh * 0.55, z + Math.cos(a) * (r + 0.008), a);
      }
    }
    place(building, cylinderGeo(r + 0.03, r + 0.03, 0.05, 16), this.stone(), 0, h + 0.025, z);
    place(building, sphereGeo(0.2, 12, 6, ), sharedMat(this.theme.accent, 0.4, { metalness: 0.3 }), 0, h + 0.05, z).scale.set(1, 0.5, 1);
    this.entrance(building, 0, z + r, 0.24, 0.14);
    if (era >= 5) place(building, cylinderGeo(0.01, 0.01, 0.4, 4), sharedMat(0x8a9095, 0.5), 0, h + 0.3, z);
  }

  private villa({ building, era, windows }: Ctx) {
    this.lawn(building, 0x5d8a52);
    const white = sharedMat(this.random() < 0.6 ? 0xece7dc : tint(this.pick(this.theme.house), this.random), 0.7);
    const dark = sharedMat(0x3b3f42, 0.6);
    block(building, 0.6, 0.3, 0.44, -0.12, 0.15, -0.2, white);
    block(building, 0.46, 0.26, 0.4, 0.12, 0.43, -0.14, this.random() < 0.5 ? dark : white); // cantilevered upper box
    // Big glass fronts.
    const glow = this.pick(this.theme.window);
    block(building, 0.44, 0.2, 0.012, -0.12, 0.14, 0.025, sharedMat(glow, 0.2, { emissive: glow, emissiveIntensity: 0.55 }));
    block(building, 0.36, 0.16, 0.012, 0.12, 0.43, 0.065, sharedMat(glow, 0.2, { emissive: glow, emissiveIntensity: 0.4 }));
    this.windowsOn(windows, -0.12, -0.2, 0.6, 0.44, 0, 1, 0.3);
    block(building, 0.64, 0.025, 0.48, -0.12, 0.31, -0.2, dark);
    block(building, 0.5, 0.025, 0.44, 0.12, 0.57, -0.14, dark);
    block(building, 0.1, 0.22, 0.02, -0.38, 0.11, 0.025, this.door());
    // Pool, deck and hedges.
    block(building, 0.36, 0.03, 0.22, 0.24, 0.016, 0.28, sharedMat(0xd8cdb8, 0.8));
    block(building, 0.3, 0.012, 0.16, 0.24, 0.033, 0.28, sharedMat(0x48b6d6, 0.1, { emissive: 0x1d7fa8, emissiveIntensity: 0.6 }));
    for (let i = 0; i < 4; i++) block(building, 0.09, 0.08, 0.09, -0.42 + i * 0.1, 0.04, 0.42, sharedMat(this.theme.foliage[0], 1));
    if (era >= 5) this.solar(building, 0.4, 0.3, 0.58, 0.12, -0.14);
    else addGadgets(building, this.random, 0.58, 0.46, 0.4, 0.12, -0.14, era);
    this.tree(building, 0.4, -0.38, 0.8);
  }

  private gardenTower({ building, windows }: Ctx) {
    const floors = 6 + Math.floor(this.random() * 4);
    const fh = 0.3, w = 0.6, d = 0.6, h = floors * fh, z = -0.05;
    block(building, w, h, d, 0, h / 2, z, sharedMat(0xd9dcd6, 0.5, { metalness: 0.15 }));
    this.windowsOn(windows, 0, z, w, d, 0, floors, fh, { tall: true, skipFrontGround: true });
    const leaf = this.theme.foliage;
    for (let f = 1; f < floors; f += 1) {
      const side = f % 4;
      const y = f * fh;
      const [x, zz, bw, bd] = side === 0 ? [0, z + d / 2 + 0.06, w * 0.9, 0.12] : side === 1 ? [w / 2 + 0.06, z, 0.12, d * 0.9] : side === 2 ? [0, z - d / 2 - 0.06, w * 0.9, 0.12] : [-w / 2 - 0.06, z, 0.12, d * 0.9];
      windows.box(sharedMat(0xbfc3bd, 0.6), bw, 0.03, bd, x, y, zz, 0, true);
      for (let i = 0; i < 3; i++) windows.add(sphereGeo(0.05, 6, 5), sharedMat(leaf[(f + i) % leaf.length], 1), x + (bw > bd ? (i - 1) * bw / 3 : 0), y + 0.05, zz + (bw > bd ? 0 : (i - 1) * bd / 3), 1, 0.8, 1, 0, true);
    }
    const accent = sharedMat(this.theme.glow, 0.3, { emissive: this.theme.glow, emissiveIntensity: 1.2 });
    for (const sx of [-1, 1]) block(building, 0.015, h, 0.015, sx * (w / 2 + 0.005), h / 2, z + d / 2 + 0.005, accent, 0, false);
    this.roofGarden(building, w * 0.9, d * 0.9, h, 0, z);
    this.entrance(building, 0, z + d / 2, 0.26, 0.18);
    this.themeTouch(building, w * 0.9, d * 0.9, h + 0.03, 0, z, floors, fh);
  }

  private roofGarden(parent: Group, w: number, d: number, y: number, x: number, z: number) {
    block(parent, w, 0.03, d, x, y + 0.015, z, sharedMat(0x5c7a45, 1));
    for (let i = 0; i < 4; i++) place(parent, sphereGeo(0.05, 6, 5), sharedMat(this.pick(this.theme.foliage), 1), x + (this.random() - 0.5) * w * 0.8, y + 0.06, z + (this.random() - 0.5) * d * 0.8);
  }

  private solar(parent: Group, w: number, d: number, y: number, x: number, z: number) {
    const panel = sharedMat(0x203a5c, 0.2, { metalness: 0.6, emissive: 0x0a1a33, emissiveIntensity: 0.4 });
    for (let i = 0; i < 2; i++) {
      const p = block(parent, w / 2 - 0.02, 0.015, d, x - w / 4 + (i * w) / 2, y + 0.05, z, panel);
      p.rotation.x = -0.35;
    }
  }
}

type Ctx = { building: Group; era: number; windows: Batcher };
