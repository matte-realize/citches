import { Group, Vector3 } from "three";
import type { Object3D } from "three";
import { Batcher, block, coneGeo, cylinderGeo, place, prismGeo, pyramidGeo, sharedMat, sphereGeo, tint } from "./kit.js";
import type { CityTheme, CityThemeId } from "./theme.js";

type Random = () => number;
/** Moving bits the city animates every frame. Parts are flagged `keep` so baking leaves them alone. */
export type Animated =
  | { kind: "spin"; object: Object3D; axis: "x" | "y" | "z"; speed: number }
  | { kind: "blink"; object: Object3D; period: number; offset: number }
  | { kind: "sway"; object: Object3D; speed: number; amount: number }
  | { kind: "smoke"; at: Vector3; rate: number; color: number };

export type SpecialStyle =
  | "well" | "stall" | "totem"
  | "windmill" | "smithy" | "fountain" | "watchtower"
  | "factory" | "waterTower" | "gasStation" | "arcade"
  | "radioTower" | "turbines" | "dataCenter" | "stadium" | "solarFarm";

export const SPECIALS_BY_ERA: SpecialStyle[][] = [
  ["well", "stall", "totem"],
  ["well", "stall", "totem"],
  ["windmill", "smithy", "fountain", "watchtower", "stall"],
  ["windmill", "smithy", "fountain", "watchtower"],
  ["factory", "waterTower", "gasStation", "arcade", "fountain"],
  ["radioTower", "turbines", "dataCenter", "stadium", "arcade", "gasStation"],
  ["radioTower", "turbines", "dataCenter", "stadium", "solarFarm"]
];

/**
 * Civic buildings and gadgets that give each district a purpose: wells and stalls in the village,
 * windmills and smithies in town, factories and arcades in the industrial era, turbines and data
 * centres later. Each returns the parts that animate. Entrances face +z like homes.
 */
export class SpecialKit {
  private recent: SpecialStyle[] = [];
  constructor(private random: Random, private theme: CityTheme, private themeId: CityThemeId) {}

  private pick<T>(list: readonly T[]): T { return list[Math.floor(this.random() * list.length)]; }
  private wall() { return sharedMat(tint(this.pick(this.theme.house), this.random, 0.03, 0.1), 0.86); }
  private roof() { return sharedMat(tint(this.pick(this.theme.roof), this.random, 0.02, 0.08), 0.85); }
  private stone() { return sharedMat(this.theme.stone, 0.85); }
  private glow(color: number, intensity = 1.6) { return sharedMat(color, 0.3, { emissive: color, emissiveIntensity: intensity }); }
  private keep<T extends Object3D>(object: T) { object.userData.keep = true; return object; }

  choose(era: number): SpecialStyle {
    const pool = SPECIALS_BY_ERA[Math.max(0, Math.min(6, era))];
    const fresh = pool.filter(style => !this.recent.includes(style));
    const style = this.pick(fresh.length ? fresh : pool);
    this.recent.push(style);
    if (this.recent.length > 2) this.recent.shift();
    return style;
  }

  build(building: Group, era: number, style = this.choose(era)): Animated[] {
    const animated: Animated[] = [];
    const batch = new Batcher();
    (this[style] as (b: Group, a: Animated[], batch: Batcher, era: number) => void).call(this, building, animated, batch, era);
    batch.flush(building);
    building.userData.style = style;
    return animated;
  }

  // ---------- village ----------
  private well(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x8e8264, 1), 0, false);
    place(b, cylinderGeo(0.2, 0.22, 0.2, 12), this.stone(), 0, 0.1, 0);
    place(b, cylinderGeo(0.16, 0.16, 0.02, 12), sharedMat(0x3f6f8a, 0.2, { emissive: 0x1d4f6a, emissiveIntensity: 0.4 }), 0, 0.19, 0);
    for (const x of [-0.2, 0.2]) place(b, cylinderGeo(0.018, 0.02, 0.42, 5), sharedMat(0x6b4a2e, 1), x, 0.32, 0);
    const roof = place(b, prismGeo(), this.roof(), 0, 0.5, 0);
    roof.scale.set(0.56, 0.18, 0.36);
    const winch = this.keep(new Group());
    winch.position.set(0, 0.42, 0);
    place(winch, cylinderGeo(0.025, 0.025, 0.36, 6), sharedMat(0x5a3f2a, 1), 0, 0, 0).rotation.z = Math.PI / 2;
    block(winch, 0.08, 0.012, 0.012, 0.18, 0.04, 0, sharedMat(0x5a3f2a, 1));
    b.add(winch);
    a.push({ kind: "spin", object: winch, axis: "x", speed: 0.8 });
    place(b, cylinderGeo(0.035, 0.03, 0.05, 6), sharedMat(0x7a5a3a, 1), 0.28, 0.025, 0.2);
  }

  private stall(b: Group, a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x9a8a64, 1), 0, false);
    const cloths = [this.theme.accent, 0xe8dcc0, 0xc9553f, 0xd9a441];
    for (const [x, z] of [[-0.24, -0.12], [0.24, -0.12]] as const) {
      block(b, 0.36, 0.12, 0.24, x, 0.06, z, sharedMat(0x7a5a3a, 1));
      for (const sx of [-1, 1]) place(b, cylinderGeo(0.012, 0.012, 0.36, 4), sharedMat(0x5a3f2a, 1), x + sx * 0.16, 0.18, z + 0.1);
      const awning = this.keep(block(b, 0.42, 0.02, 0.32, x, 0.37, z + 0.02, sharedMat(this.pick(cloths), 0.9)));
      awning.rotation.x = 0.18;
      a.push({ kind: "sway", object: awning, speed: 1.4 + this.random(), amount: 0.04 });
      for (let i = 0; i < 6; i++) batch.add(sphereGeo(0.03, 5, 4), sharedMat(this.pick([0xd9772f, 0xc0392b, 0x8fbf4a, 0xf2c94c]), 0.9), x - 0.12 + (i % 3) * 0.12, 0.15, z - 0.04 + Math.floor(i / 3) * 0.08, 1, 1, 1, 0, true);
    }
    for (let i = 0; i < 3; i++) block(b, 0.1, 0.1, 0.1, -0.3 + i * 0.13, 0.05, 0.3, sharedMat(0x8a6a43, 1), i * 0.3);
    place(b, cylinderGeo(0.05, 0.045, 0.12, 8), sharedMat(0x7a5a3a, 1), 0.32, 0.06, 0.3);
  }

  private totem(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x8e8264, 1), 0, false);
    place(b, cylinderGeo(0.36, 0.4, 0.06, 10), this.stone(), 0, 0.03, 0);
    const colors = [this.theme.accent, 0xc9553f, 0xe8c14a, 0x5b7fa8];
    for (let i = 0; i < 4; i++) {
      block(b, 0.2 - i * 0.02, 0.18, 0.2 - i * 0.02, 0, 0.15 + i * 0.18, 0, sharedMat(i % 2 ? 0x7a5a3a : 0x5a3f2a, 1));
      block(b, 0.06, 0.04, 0.012, -0.04, 0.17 + i * 0.18, 0.1 - i * 0.01, sharedMat(colors[i], 0.8));
      block(b, 0.06, 0.04, 0.012, 0.04, 0.17 + i * 0.18, 0.1 - i * 0.01, sharedMat(colors[i], 0.8));
    }
    for (const side of [-1, 1]) block(b, 0.22, 0.04, 0.06, side * 0.16, 0.7, 0, sharedMat(colors[0], 0.8));
    for (const [x, z] of [[-0.3, 0.26], [0.3, 0.26]] as const) {
      place(b, cylinderGeo(0.06, 0.04, 0.1, 8), this.stone(), x, 0.05, z);
      const flame = this.keep(place(b, coneGeo(0.04, 0.1, 6), this.glow(0xff9a3a, 2), x, 0.15, z, false));
      a.push({ kind: "blink", object: flame, period: 0.35 + this.random() * 0.2, offset: this.random() });
    }
  }

  // ---------- town ----------
  private windmill(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x8a9a5a, 1), 0, false);
    place(b, cylinderGeo(0.2, 0.28, 0.8, 8), this.wall(), 0, 0.4, -0.05);
    place(b, coneGeo(0.25, 0.26, 8), this.roof(), 0, 0.93, -0.05);
    block(b, 0.1, 0.16, 0.02, 0, 0.08, 0.22, sharedMat(0x4a3628, 1));
    const sails = this.keep(new Group());
    sails.position.set(0, 0.74, 0.22);
    place(sails, cylinderGeo(0.03, 0.03, 0.06, 6), sharedMat(0x3a2a1e, 1), 0, 0, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const arm = new Group();
      arm.rotation.z = (i * Math.PI) / 2;
      block(arm, 0.025, 0.5, 0.015, 0, 0.27, 0.02, sharedMat(0x5a3f2a, 1));
      block(arm, 0.11, 0.38, 0.008, 0.06, 0.3, 0.025, sharedMat(0xe8dcc0, 0.95));
      sails.add(arm);
    }
    b.add(sails);
    a.push({ kind: "spin", object: sails, axis: "z", speed: 0.9 + this.random() * 0.5 });
    for (let i = 0; i < 3; i++) { const sack = place(b, sphereGeo(0.05, 6, 4), sharedMat(0xd8c69c, 1), 0.3, 0.04, 0.2 + i * 0.07); sack.scale.set(1, 0.8, 1); }
  }

  private smithy(b: Group, a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x6e6a5a, 1), 0, false);
    block(b, 0.7, 0.36, 0.5, -0.06, 0.18, -0.16, this.wall());
    const roof = place(b, prismGeo(), this.roof(), -0.06, 0.36, -0.16);
    roof.scale.set(0.8, 0.2, 0.6);
    // Open-fronted forge with a glowing hearth, anvil and a smoking chimney.
    block(b, 0.3, 0.2, 0.24, 0.26, 0.1, 0.18, sharedMat(0x5a504a, 0.9));
    block(b, 0.36, 0.03, 0.3, 0.26, 0.215, 0.18, this.roof());
    const coals = this.keep(block(b, 0.16, 0.05, 0.12, 0.26, 0.05, 0.24, this.glow(0xff6a22, 2.4), 0, false));
    a.push({ kind: "blink", object: coals, period: 0.6, offset: 0 });
    block(b, 0.1, 0.06, 0.05, 0.02, 0.08, 0.28, sharedMat(0x2b2e31, 0.5, { metalness: 0.6 }));
    block(b, 0.04, 0.06, 0.04, 0.02, 0.03, 0.28, sharedMat(0x3a3530, 0.7));
    block(b, 0.1, 0.4, 0.1, -0.3, 0.56, -0.28, sharedMat(0x6b665a, 0.9));
    a.push({ kind: "smoke", at: new Vector3(-0.3, 0.8, -0.28), rate: 3, color: 0x6a6a6a });
    for (let i = 0; i < 4; i++) batch.box(sharedMat(0x8a8a8a, 0.5, { metalness: 0.5 }), 0.02, 0.16, 0.01, -0.36 + i * 0.05, 0.2, 0.095, 0, true);
  }

  private fountain(b: Group, a: Animated[]) {
    block(b, 0.96, 0.03, 0.96, 0, 0.015, 0, this.stone(), 0, false);
    place(b, cylinderGeo(0.38, 0.4, 0.12, 16), this.stone(), 0, 0.09, 0);
    place(b, cylinderGeo(0.34, 0.34, 0.02, 16), sharedMat(0x4aa8d0, 0.1, { emissive: 0x1d6f9a, emissiveIntensity: 0.55 }), 0, 0.14, 0);
    place(b, cylinderGeo(0.06, 0.08, 0.36, 8), this.stone(), 0, 0.3, 0);
    place(b, cylinderGeo(0.16, 0.12, 0.05, 12), this.stone(), 0, 0.48, 0);
    const spout = this.keep(place(b, coneGeo(0.08, 0.16, 8), sharedMat(0x9fe0f5, 0.1, { emissive: 0x4ab0d8, emissiveIntensity: 0.8 }), 0, 0.58, 0, false));
    a.push({ kind: "sway", object: spout, speed: 6, amount: 0.15 });
    a.push({ kind: "smoke", at: new Vector3(0, 0.6, 0), rate: 4, color: 0xbfe8f5 });
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      place(b, cylinderGeo(0.03, 0.03, 0.18, 5), sharedMat(0x6d4c35, 1), Math.sin(angle) * 0.44, 0.09, Math.cos(angle) * 0.44);
      place(b, sphereGeo(0.07, 6, 5), sharedMat(this.pick(this.theme.foliage), 1), Math.sin(angle) * 0.44, 0.22, Math.cos(angle) * 0.44);
    }
  }

  private watchtower(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x7d8a5a, 1), 0, false);
    const wood = sharedMat(0x5a3f2a, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(b, cylinderGeo(0.025, 0.03, 1.2, 5), wood, sx * 0.18, 0.6, sz * 0.18);
    for (const y of [0.35, 0.75]) { block(b, 0.42, 0.025, 0.025, 0, y, 0.18, wood); block(b, 0.42, 0.025, 0.025, 0, y, -0.18, wood); }
    block(b, 0.5, 0.04, 0.5, 0, 1.2, 0, wood);
    block(b, 0.5, 0.12, 0.02, 0, 1.28, 0.24, wood);
    block(b, 0.5, 0.12, 0.02, 0, 1.28, -0.24, wood);
    const top = place(b, pyramidGeo(), this.roof(), 0, 1.42, 0);
    top.scale.set(0.6, 0.3, 0.6);
    place(b, cylinderGeo(0.01, 0.01, 0.3, 4), wood, 0, 1.86, 0);
    const flag = this.keep(new Group());
    flag.position.set(0, 1.96, 0);
    block(flag, 0.2, 0.1, 0.01, 0.1, 0, 0, sharedMat(this.theme.accent, 0.8));
    b.add(flag);
    a.push({ kind: "sway", object: flag, speed: 3, amount: 0.35 });
    const lantern = this.keep(place(b, sphereGeo(0.04, 6, 5), this.glow(this.theme.glow, 2), 0, 1.3, 0.26, false));
    a.push({ kind: "blink", object: lantern, period: 1.4, offset: this.random() });
  }

  // ---------- industrial ----------
  private factory(b: Group, a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(0x5f5c55, 1), 0, false);
    const brick = sharedMat(this.pick([0x9c4f3a, 0x8a4434, 0x7d5041]), 0.95);
    block(b, 0.86, 0.42, 0.62, 0, 0.21, -0.12, brick);
    // Saw-tooth roof with glowing skylights.
    for (let i = 0; i < 3; i++) {
      const tooth = place(b, prismGeo(), sharedMat(0x3a4044, 0.8), -0.28 + i * 0.28, 0.42, -0.12);
      tooth.scale.set(0.28, 0.16, 0.62);
      batch.box(this.glow(0xffd98a, 0.9), 0.012, 0.1, 0.56, -0.36 + i * 0.28, 0.48, -0.12);
    }
    for (const [x, h] of [[-0.3, 1.1], [-0.12, 0.9]] as const) {
      place(b, cylinderGeo(0.05, 0.07, h, 10), sharedMat(0x8a4434, 0.9), x, h / 2, -0.38);
      place(b, cylinderGeo(0.06, 0.06, 0.04, 10), sharedMat(0x2b2e31, 0.7), x, h, -0.38);
      a.push({ kind: "smoke", at: new Vector3(x, h + 0.05, -0.38), rate: 6, color: 0x7a7a7a });
    }
    block(b, 0.3, 0.26, 0.02, 0.18, 0.13, 0.195, sharedMat(0x3a4448, 0.7));
    for (let i = 0; i < 5; i++) batch.box(this.glow(this.pick(this.theme.window), 0.6), 0.1, 0.12, 0.012, -0.36 + i * 0.18, 0.28, 0.195);
    for (let i = 0; i < 3; i++) block(b, 0.12, 0.12, 0.12, -0.3 + i * 0.15, 0.06, 0.35, sharedMat(0x8a6a43, 1), i * 0.4);
    const gear = this.keep(new Group());
    gear.position.set(0.32, 0.5, 0.2);
    for (let i = 0; i < 6; i++) block(gear, 0.04, 0.2, 0.02, 0, 0, 0, sharedMat(0xd9a441, 0.4, { metalness: 0.6 }), 0).rotation.z = (i * Math.PI) / 6;
    b.add(gear);
    a.push({ kind: "spin", object: gear, axis: "z", speed: 1.6 });
  }

  private waterTower(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x6f7a5a, 1), 0, false);
    const steel = sharedMat(0x5a646a, 0.5, { metalness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = place(b, cylinderGeo(0.02, 0.025, 1.0, 5), steel, sx * 0.2, 0.5, sz * 0.2); leg.rotation.z = -sx * 0.06; leg.rotation.x = sz * 0.06; }
    for (const y of [0.35, 0.7]) { block(b, 0.42, 0.02, 0.02, 0, y, 0.2, steel); block(b, 0.02, 0.02, 0.42, 0.2, y, 0, steel); }
    place(b, cylinderGeo(0.3, 0.3, 0.38, 14), sharedMat(this.random() < 0.5 ? this.theme.accent : 0xb8bcb4, 0.6), 0, 1.18, 0);
    place(b, coneGeo(0.32, 0.18, 14), sharedMat(0x5a646a, 0.6), 0, 1.46, 0);
    block(b, 0.42, 0.06, 0.01, 0, 1.2, 0.305, sharedMat(0xf4ecd8, 0.8));
    const beacon = this.keep(place(b, sphereGeo(0.03, 6, 5), this.glow(0xff4433, 2.4), 0, 1.58, 0, false));
    a.push({ kind: "blink", object: beacon, period: 1.2, offset: this.random() });
  }

  private gasStation(b: Group, a: Animated[]) {
    block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(0x4a4d50, 0.9), 0, false);
    const paint = sharedMat(this.random() < 0.5 ? 0xc0392b : this.theme.accent, 0.5);
    for (const [x, z] of [[-0.3, 0.05], [0.3, 0.05], [-0.3, 0.35], [0.3, 0.35]] as const) place(b, cylinderGeo(0.02, 0.02, 0.4, 6), sharedMat(0xd8d8d0, 0.6), x, 0.2, z);
    block(b, 0.76, 0.06, 0.46, 0, 0.42, 0.2, paint);
    block(b, 0.78, 0.02, 0.48, 0, 0.395, 0.2, this.glow(0xfff0c2, 1.2));
    for (const x of [-0.12, 0.12]) {
      block(b, 0.08, 0.18, 0.06, x, 0.09, 0.2, sharedMat(0xe9e4d8, 0.6));
      block(b, 0.06, 0.04, 0.01, x, 0.14, 0.235, this.glow(0x7cf29a, 1.4));
    }
    block(b, 0.5, 0.26, 0.26, 0, 0.13, -0.3, sharedMat(0xe9e4d8, 0.7));
    block(b, 0.36, 0.12, 0.012, 0, 0.15, -0.165, this.glow(this.pick(this.theme.window), 0.7));
    place(b, cylinderGeo(0.015, 0.015, 0.7, 5), sharedMat(0x30353a, 0.5), 0.4, 0.35, -0.38);
    const sign = this.keep(block(b, 0.2, 0.14, 0.03, 0.4, 0.74, -0.38, this.glow(0xffd35a, 1.6), 0, false));
    a.push({ kind: "spin", object: sign, axis: "y", speed: 0.8 });
  }

  private arcade(b: Group, a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(0x3a3d40, 0.9), 0, false);
    block(b, 0.82, 0.5, 0.6, 0, 0.25, -0.12, sharedMat(0x2b2f3a, 0.7));
    block(b, 0.84, 0.04, 0.62, 0, 0.52, -0.12, sharedMat(0x1d2028, 0.7));
    const neon = [0xff4fd8, 0x4ff0ff, 0xffe44f, 0x7cf29a];
    for (let i = 0; i < 3; i++) {
      const letter = this.keep(block(b, 0.18, 0.1, 0.02, -0.24 + i * 0.24, 0.42, 0.185, this.glow(neon[i], 2.2), 0, false));
      a.push({ kind: "blink", object: letter, period: 0.5 + i * 0.15, offset: i * 0.3 });
    }
    for (const x of [-0.2, 0.2]) batch.box(this.glow(0x6fa8ff, 0.8), 0.22, 0.2, 0.012, x, 0.16, 0.185);
    block(b, 0.14, 0.26, 0.02, 0, 0.13, 0.19, sharedMat(0x1a1c22, 0.5));
    // Arcade cabinets on the forecourt.
    for (let i = 0; i < 3; i++) {
      const x = -0.28 + i * 0.28;
      block(b, 0.1, 0.22, 0.1, x, 0.11, 0.34, sharedMat(neon[(i + 1) % 4], 0.6));
      batch.box(this.glow(0xe8f0ff, 1.2), 0.07, 0.06, 0.01, x, 0.17, 0.395);
    }
  }

  // ---------- modern ----------
  private radioTower(b: Group, a: Animated[]) {
    block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(0x5f6458, 1), 0, false);
    const steel = sharedMat(0xc8463a, 0.5, { metalness: 0.3 });
    const white = sharedMat(0xe9e6dc, 0.6);
    for (let i = 0; i < 8; i++) {
      const w = 0.3 - i * 0.032;
      const y = 0.15 + i * 0.3;
      const mat = i % 2 ? white : steel;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(b, cylinderGeo(0.012, 0.014, 0.32, 4), mat, sx * w / 2, y, sz * w / 2);
      block(b, w, 0.015, 0.015, 0, y + 0.15, w / 2, mat); block(b, w, 0.015, 0.015, 0, y + 0.15, -w / 2, mat);
      block(b, 0.015, 0.015, w, w / 2, y + 0.15, 0, mat); block(b, 0.015, 0.015, w, -w / 2, y + 0.15, 0, mat);
    }
    for (let i = 0; i < 3; i++) {
      const beacon = this.keep(place(b, sphereGeo(0.035, 6, 5), this.glow(0xff3322, 2.6), 0, 0.9 + i * 0.85, 0.06, false));
      a.push({ kind: "blink", object: beacon, period: 1.1, offset: i * 0.2 });
    }
    const dish = place(b, sphereGeo(0.16, 10, 6, ), white, 0.2, 1.4, 0.1);
    dish.scale.set(1, 1, 0.3);
    block(b, 0.28, 0.2, 0.2, -0.28, 0.1, 0.28, sharedMat(0xd8d4c8, 0.7));
  }

  private turbines(b: Group, a: Animated[]) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x6f8f52, 1), 0, false);
    for (const [x, z, h] of [[-0.24, -0.2, 1.5], [0.24, 0.18, 1.25]] as const) {
      place(b, cylinderGeo(0.025, 0.045, h, 8), sharedMat(0xe9e6dc, 0.5), x, h / 2, z);
      block(b, 0.07, 0.07, 0.14, x, h, z, sharedMat(0xe9e6dc, 0.5));
      const rotor = this.keep(new Group());
      rotor.position.set(x, h, z + 0.08);
      for (let i = 0; i < 3; i++) {
        const blade = new Group();
        blade.rotation.z = (i * Math.PI * 2) / 3;
        block(blade, 0.04, 0.5, 0.012, 0, 0.26, 0, sharedMat(0xf4f2ea, 0.5));
        rotor.add(blade);
      }
      b.add(rotor);
      a.push({ kind: "spin", object: rotor, axis: "z", speed: 1.6 + this.random() });
      const tip = this.keep(place(b, sphereGeo(0.02, 5, 4), this.glow(0xff3322, 2.4), x, h + 0.05, z, false));
      a.push({ kind: "blink", object: tip, period: 1.6, offset: this.random() });
    }
  }

  private dataCenter(b: Group, a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.02, 0.96, 0, 0.01, 0, sharedMat(0x4a4d50, 0.9), 0, false);
    block(b, 0.86, 0.34, 0.66, 0, 0.17, -0.1, sharedMat(0xd8dcd8, 0.5, { metalness: 0.2 }));
    block(b, 0.88, 0.03, 0.68, 0, 0.35, -0.1, sharedMat(0x2b2e31, 0.6));
    // Rows of blinking server lights along the front.
    const colors = [0x7cf29a, 0x4ff0ff, 0xffd35a];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
      const light = this.keep(block(b, 0.03, 0.02, 0.012, -0.32 + i * 0.13, 0.08 + row * 0.09, 0.235, this.glow(colors[(row + i) % 3], 2), 0, false));
      a.push({ kind: "blink", object: light, period: 0.3 + this.random() * 0.9, offset: this.random() });
    }
    for (let i = 0; i < 3; i++) {
      batch.box(sharedMat(0x8a9095, 0.5, { metalness: 0.4 }), 0.16, 0.06, 0.16, -0.26 + i * 0.26, 0.4, -0.18, 0, true);
      const fan = this.keep(new Group());
      fan.position.set(-0.26 + i * 0.26, 0.44, -0.18);
      block(fan, 0.14, 0.008, 0.02, 0, 0, 0, sharedMat(0x30353a, 0.5));
      block(fan, 0.02, 0.008, 0.14, 0, 0, 0, sharedMat(0x30353a, 0.5));
      b.add(fan);
      a.push({ kind: "spin", object: fan, axis: "y", speed: 8 });
    }
  }

  private stadium(b: Group, a: Animated[]) {
    block(b, 0.98, 0.02, 0.98, 0, 0.01, 0, sharedMat(0x5f6458, 1), 0, false);
    const shell = place(b, cylinderGeo(0.48, 0.44, 0.26, 20), sharedMat(this.theme.accent, 0.6), 0, 0.13, 0);
    shell.scale.set(1, 1, 0.82);
    const pitch = place(b, cylinderGeo(0.36, 0.36, 0.02, 20), sharedMat(0x4fa04a, 0.9), 0, 0.27, 0);
    pitch.scale.set(1, 1, 0.78);
    block(b, 0.02, 0.005, 0.5, 0, 0.285, 0, sharedMat(0xf4f2ea, 0.8), 0, false);
    for (const [x, z] of [[-0.42, -0.34], [0.42, -0.34], [-0.42, 0.34], [0.42, 0.34]] as const) {
      place(b, cylinderGeo(0.012, 0.015, 0.7, 4), sharedMat(0x30353a, 0.5), x, 0.35, z);
      const lamp = this.keep(block(b, 0.1, 0.05, 0.03, x, 0.72, z, this.glow(0xfff8dc, 2.4), 0, false));
      a.push({ kind: "blink", object: lamp, period: 3 + this.random() * 2, offset: this.random() });
    }
    for (let i = 0; i < 3; i++) { const ball = this.keep(place(b, sphereGeo(0.02, 5, 4), sharedMat(0xf4f2ea, 0.6), -0.1 + i * 0.1, 0.3, 0, false)); a.push({ kind: "sway", object: ball, speed: 2 + i, amount: 0.6 }); }
  }

  private solarFarm(b: Group, _a: Animated[], batch: Batcher) {
    block(b, 0.96, 0.012, 0.96, 0, 0.006, 0, sharedMat(0x7d8a5a, 1), 0, false);
    const panel = sharedMat(0x203a5c, 0.2, { metalness: 0.6, emissive: 0x0a1a33, emissiveIntensity: 0.5 });
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const x = -0.3 + col * 0.3, z = -0.3 + row * 0.3;
      batch.box(sharedMat(0x8a9095, 0.5), 0.02, 0.1, 0.02, x, 0.05, z, 0, true);
      block(b, 0.24, 0.015, 0.2, x, 0.12, z, panel).rotation.x = -0.4;
    }
    block(b, 0.14, 0.12, 0.1, 0.38, 0.06, 0.4, sharedMat(0xd8d4c8, 0.7));
  }
}

/** Little rooftop and kerbside gadgets for modern homes: dishes, antennas, AC units, mailboxes. */
export function addGadgets(parent: Group, random: Random, roofY: number, roofW: number, roofD: number, cx: number, cz: number, era: number) {
  if (era < 4) return;
  const metal = sharedMat(0xb8bcc0, 0.4, { metalness: 0.5 });
  const roll = random();
  if (roll < 0.4) {
    place(parent, cylinderGeo(0.008, 0.01, 0.06, 4), metal, cx + roofW * 0.25, roofY + 0.03, cz - roofD * 0.2);
    const dish = place(parent, sphereGeo(0.05, 8, 5), sharedMat(0xe9e6dc, 0.5), cx + roofW * 0.25, roofY + 0.08, cz - roofD * 0.2);
    dish.scale.set(1, 1, 0.35);
    dish.rotation.x = -0.6;
  } else if (roll < 0.7) {
    place(parent, cylinderGeo(0.006, 0.006, 0.24, 4), metal, cx - roofW * 0.25, roofY + 0.12, cz - roofD * 0.25);
    for (let i = 0; i < 3; i++) block(parent, 0.12 - i * 0.03, 0.006, 0.006, cx - roofW * 0.25, roofY + 0.14 + i * 0.04, cz - roofD * 0.25, metal, 0, false);
  }
  if (random() < 0.6) {
    block(parent, 0.08, 0.06, 0.07, cx + roofW * 0.2, roofY + 0.03, cz + roofD * 0.2, sharedMat(0xc8ccc8, 0.6));
    block(parent, 0.05, 0.005, 0.05, cx + roofW * 0.2, roofY + 0.065, cz + roofD * 0.2, sharedMat(0x30353a, 0.6), 0, false);
  }
  if (era >= 6 && random() < 0.35) {
    // Delivery drone parked on the roof.
    block(parent, 0.06, 0.02, 0.06, cx, roofY + 0.03, cz, sharedMat(0x30353a, 0.5));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(parent, cylinderGeo(0.018, 0.018, 0.004, 8), sharedMat(0x7cf29a, 0.4, { emissive: 0x2a8a49, emissiveIntensity: 0.8 }), cx + sx * 0.04, roofY + 0.045, cz + sz * 0.04, false);
  }
}
