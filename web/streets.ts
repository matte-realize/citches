import { Group } from "three";
import { Batcher, coneGeo, cylinderGeo, sharedMat, sphereGeo } from "./kit.js";
import type { CityTheme } from "./theme.js";

/** Neighbour order shared by roads, doors and traffic: +z, +x, -z, -x. */
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
export const ASPHALT_HALF = 0.28;
export const ROAD_Y = 0.025;
export const SIDEWALK_Y = 0.05;

export interface StreetCell { px: number; pz: number; links: boolean[]; doors: boolean[]; hash: number }

/** Walkable surface height so actors sit on the road instead of hovering over it. */
export function streetSurface(cell: StreetCell | undefined, era: number, localX: number, localZ: number) {
  if (!cell) return 0;
  if (era < 2) return 0.012;
  if (era < 4) return 0.022;
  const inCenter = Math.abs(localX) < ASPHALT_HALF && Math.abs(localZ) < ASPHALT_HALF;
  const anyLink = cell.links.some(Boolean);
  if (inCenter && anyLink) return ROAD_Y;
  for (let d = 0; d < 4; d++) {
    if (!cell.links[d]) continue;
    const [dx, dz] = DIRS[d];
    const along = localX * dx + localZ * dz;
    const across = Math.abs(localX * dz - localZ * dx);
    if (along > 0 && across < ASPHALT_HALF) return ROAD_Y;
  }
  return SIDEWALK_Y;
}

export function buildStreetLayer(cells: StreetCell[], era: number, theme: CityTheme): Group {
  const group = new Group();
  const batch = new Batcher();
  // Pieces along direction d: centre offset `from..to` along the direction with a given width.
  const arm = (material: ReturnType<typeof sharedMat>, cell: StreetCell, d: number, from: number, to: number, width: number, y: number, h: number) => {
    const [dx, dz] = DIRS[d];
    const mid = (from + to) / 2;
    const len = to - from;
    batch.box(material, dx ? len : width, h, dx ? width : len, cell.px + dx * mid, y, cell.pz + dz * mid);
  };

  if (era < 2) {
    const dirt = sharedMat(era === 0 ? 0x79623e : 0x8c7955, 1);
    const pebble = sharedMat(0x948a76, 1);
    for (const cell of cells) {
      batch.box(dirt, 0.26, 0.012, 0.26, cell.px, 0.006, cell.pz);
      for (let d = 0; d < 4; d++) {
        if (cell.links[d]) arm(dirt, cell, d, 0, 0.5, 0.22, 0.006, 0.012);
        else if (cell.doors[d]) arm(dirt, cell, d, 0, 0.5, 0.13, 0.005, 0.01);
      }
      for (let i = 0; i < 3; i++) {
        const h = (cell.hash * (i + 3)) % 97 / 97;
        if (h < 0.5) continue;
        batch.box(pebble, 0.04, 0.025, 0.035, cell.px + (h - 0.75) * 1.6, 0.012, cell.pz + ((cell.hash >> (i + 2)) % 9 - 4) * 0.09);
      }
    }
  } else if (era < 4) {
    const edge = sharedMat(theme.road[2], 1);
    const stone = sharedMat(era === 2 ? 0x8a8170 : 0xa79f88, 0.95);
    const cobble = sharedMat(era === 2 ? 0x7a7262 : 0x938b76, 0.95);
    for (const cell of cells) {
      batch.box(edge, 0.46, 0.016, 0.46, cell.px, 0.008, cell.pz);
      batch.box(stone, 0.4, 0.02, 0.4, cell.px, 0.012, cell.pz);
      for (let d = 0; d < 4; d++) {
        if (cell.links[d]) {
          arm(edge, cell, d, 0.2, 0.5, 0.46, 0.008, 0.016);
          arm(stone, cell, d, 0.2, 0.5, 0.4, 0.012, 0.02);
        } else if (cell.doors[d]) arm(stone, cell, d, 0.2, 0.5, 0.16, 0.01, 0.016);
      }
      for (let i = 0; i < 4; i++) {
        const hx = ((cell.hash >> i) % 7) / 7 - 0.43;
        const hz = ((cell.hash >> (i + 3)) % 7) / 7 - 0.43;
        batch.box(cobble, 0.07, 0.004, 0.05, cell.px + hx * 0.36, 0.024, cell.pz + hz * 0.36);
      }
      if (era === 3 && cell.hash % 4 === 0) {
        const corner = [0.36, -0.36][cell.hash % 2];
        batch.box(sharedMat(0x3b3631, 0.7), 0.03, 0.42, 0.03, cell.px + corner, 0.21, cell.pz + 0.36, 0, true);
        batch.box(sharedMat(theme.glow, 0.3, { emissive: theme.glow, emissiveIntensity: 1.6 }), 0.07, 0.08, 0.07, cell.px + corner, 0.45, cell.pz + 0.36);
      }
    }
  } else {
    const asphalt = sharedMat(era >= 6 ? 0x2b2e33 : 0x37393c, 0.92);
    const walk = sharedMat(era >= 5 ? 0xb3b0a5 : 0x9e9a8c, 0.95);
    const curb = sharedMat(0x7d7a70, 0.9);
    const line = sharedMat(0xe3c46b, 0.7, { emissive: 0x5a4a1c, emissiveIntensity: 0.25 });
    const stripe = sharedMat(0xe9e6dc, 0.7);
    const pole = sharedMat(0x30353a, 0.5, { metalness: 0.4 });
    const bulb = sharedMat(0xfff0c2, 0.2, { emissive: theme.glow, emissiveIntensity: 2.2 });
    const leaf = sharedMat(theme.foliage[1], 1);
    const hs = ASPHALT_HALF, rim = 0.5 - hs, mid = (0.5 + hs) / 2;
    for (const cell of cells) {
      const anyLink = cell.links.some(Boolean);
      // 3x3 split: corners are always sidewalk, edges are road only when linked.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.box(walk, rim, SIDEWALK_Y, rim, cell.px + sx * mid, SIDEWALK_Y / 2, cell.pz + sz * mid);
      batch.box(anyLink ? asphalt : walk, hs * 2, anyLink ? ROAD_Y : SIDEWALK_Y, hs * 2, cell.px, (anyLink ? ROAD_Y : SIDEWALK_Y) / 2, cell.pz);
      for (let d = 0; d < 4; d++) {
        const linked = cell.links[d];
        arm(linked ? asphalt : walk, cell, d, hs, 0.5, hs * 2, (linked ? ROAD_Y : SIDEWALK_Y) / 2, linked ? ROAD_Y : SIDEWALK_Y);
        if (!linked && anyLink) arm(curb, cell, d, hs - 0.012, hs + 0.012, hs * 2, SIDEWALK_Y / 2 + 0.003, SIDEWALK_Y + 0.006);
        if (!linked && cell.doors[d]) arm(sharedMat(0xc9c4b4, 0.9), cell, d, hs + 0.04, 0.5, 0.14, SIDEWALK_Y + 0.002, 0.006);
      }
      const linkCount = cell.links.filter(Boolean).length;
      const straight = linkCount === 2 && ((cell.links[0] && cell.links[2]) || (cell.links[1] && cell.links[3]));
      if (straight) {
        const d = cell.links[0] ? 0 : 1;
        arm(line, cell, d, -0.16, 0.16, 0.022, ROAD_Y + 0.002, 0.004);
      } else if (linkCount >= 3) {
        for (let d = 0; d < 4; d++) {
          if (!cell.links[d]) continue;
          const [dx, dz] = DIRS[d];
          for (const offset of [-0.2, -0.1, 0, 0.1, 0.2]) {
            batch.box(stripe, dx ? 0.13 : 0.05, 0.004, dx ? 0.05 : 0.13, cell.px + dx * 0.39 + dz * offset, ROAD_Y + 0.002, cell.pz + dz * 0.39 + dx * offset);
          }
        }
      } else if (linkCount === 1) {
        for (let d = 0; d < 4; d++) if (cell.links[d]) arm(line, cell, d, 0.3, 0.46, 0.022, ROAD_Y + 0.002, 0.004);
      }
      // Street furniture on free corners.
      const cornerX = cell.hash % 2 ? 1 : -1;
      const cornerZ = (cell.hash >> 1) % 2 ? 1 : -1;
      if (cell.hash % 3 === 0) {
        const x = cell.px + cornerX * 0.4, z = cell.pz + cornerZ * 0.4;
        batch.add(cylinderGeo(0.014, 0.018, 0.62, 6), pole, x, SIDEWALK_Y + 0.31, z, 1, 1, 1, 0, true);
        batch.box(pole, 0.12, 0.018, 0.018, x - cornerX * 0.05, SIDEWALK_Y + 0.62, z, 0, false);
        batch.add(sphereGeo(0.035, 8, 6), bulb, x - cornerX * 0.1, SIDEWALK_Y + 0.6, z);
      } else if (cell.hash % 5 === 1) {
        const x = cell.px - cornerX * 0.4, z = cell.pz - cornerZ * 0.4;
        batch.box(curb, 0.12, 0.04, 0.12, x, SIDEWALK_Y + 0.02, z);
        batch.add(cylinderGeo(0.012, 0.016, 0.16, 5), sharedMat(0x5d4433, 1), x, SIDEWALK_Y + 0.1, z);
        batch.add(sphereGeo(0.085, 7, 5), leaf, x, SIDEWALK_Y + 0.23, z, 1, 1.1, 1, 0, true);
      } else if (era >= 5 && cell.hash % 7 === 2) {
        const x = cell.px + cornerX * 0.4, z = cell.pz - cornerZ * 0.4;
        batch.add(coneGeo(0.03, 0.08, 6), sharedMat(0xe3743a, 0.7), x, SIDEWALK_Y + 0.04, z);
      }
    }
  }
  batch.flush(group);
  return group;
}
