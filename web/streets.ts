import { Color, Group, InstancedMesh, MeshBasicMaterial, Object3D } from "three";
import { Batcher, coneGeo, cylinderGeo, sharedMat, sphereGeo } from "./kit.js";
import type { CityTheme } from "./theme.js";

/** Neighbour order shared by roads, doors and traffic: +z, +x, -z, -x. */
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
export const ASPHALT_HALF = 0.28;
export const ROAD_Y = 0.025;
export const SIDEWALK_Y = 0.05;

export const MARKET_Y = 0.035;

/**
 * Every street line in the city has a character, like a real town: a tree-lined boulevard down
 * the main axis, narrow back lanes, heritage brick streets, tram avenues and car-light market
 * streets. Widths differ, but every one keeps the shared lane offsets so traffic still fits.
 */
export type StreetStyle = "avenue" | "boulevard" | "lane" | "brick" | "tram" | "market";
export const STREET_HALF: Record<StreetStyle, number> = { avenue: 0.28, boulevard: 0.32, lane: 0.2, brick: 0.24, tram: 0.3, market: 0.28 };
/** Which style wins the middle of an intersection. */
export const STREET_RANK: Record<StreetStyle, number> = { boulevard: 5, tram: 4, avenue: 3, brick: 2, market: 1, lane: 0 };

export interface StreetCell {
  px: number; pz: number; links: boolean[]; doors: boolean[]; hash: number;
  /** Style of the street arm leaving in each direction, and of the cell's middle. */
  styles?: StreetStyle[]; style?: StreetStyle;
}

const cellStyle = (cell: StreetCell): StreetStyle => cell.style ?? "avenue";
const armStyle = (cell: StreetCell, d: number): StreetStyle => cell.styles?.[d] ?? cellStyle(cell);
/** A market street paves the whole cell flush, but only where every arm is market too. */
const isPlaza = (cell: StreetCell) => cellStyle(cell) === "market" && cell.links.every((linked, d) => !linked || armStyle(cell, d) === "market");

/** Walkable surface height so actors sit on the road instead of hovering over it. */
export function streetSurface(cell: StreetCell | undefined, era: number, localX: number, localZ: number) {
  if (!cell) return 0;
  if (era < 2) return 0.012;
  if (era < 4) return 0.022;
  if (isPlaza(cell)) return MARKET_Y;
  const half = STREET_HALF[cellStyle(cell)];
  const inCenter = Math.abs(localX) < half && Math.abs(localZ) < half;
  const anyLink = cell.links.some(Boolean);
  if (inCenter && anyLink) return ROAD_Y;
  for (let d = 0; d < 4; d++) {
    if (!cell.links[d]) continue;
    const [dx, dz] = DIRS[d];
    const along = localX * dx + localZ * dz;
    const across = Math.abs(localX * dz - localZ * dx);
    if (along > 0 && across < STREET_HALF[armStyle(cell, d)]) return ROAD_Y;
  }
  return SIDEWALK_Y;
}

export function buildStreetLayer(cells: StreetCell[], era: number, theme: CityTheme): Group {
  const group = new Group();
  const batch = new Batcher();
  const trafficSpots: Array<{ x: number; z: number; phase: number }> = [];
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
    // Town streets: wide paved high streets, ordinary roads and narrow cobbled lanes.
    const widthFor = (style: StreetStyle) => style === "boulevard" || style === "tram" ? 0.52 : style === "lane" || style === "brick" ? 0.3 : 0.4;
    const hedge = sharedMat(theme.foliage[1], 1);
    for (const cell of cells) {
      const centre = widthFor(cellStyle(cell));
      batch.box(edge, centre + 0.06, 0.016, centre + 0.06, cell.px, 0.008, cell.pz);
      batch.box(stone, centre, 0.02, centre, cell.px, 0.012, cell.pz);
      for (let d = 0; d < 4; d++) {
        const width = widthFor(armStyle(cell, d));
        if (cell.links[d]) {
          arm(edge, cell, d, centre / 2, 0.5, width + 0.06, 0.008, 0.016);
          arm(stone, cell, d, centre / 2, 0.5, width, 0.012, 0.02);
        } else if (cell.doors[d]) arm(stone, cell, d, centre / 2, 0.5, 0.16, 0.01, 0.016);
      }
      // High streets get clipped hedges along both verges.
      const straight = cell.links.filter(Boolean).length === 2 && ((cell.links[0] && cell.links[2]) || (cell.links[1] && cell.links[3]));
      if (straight && widthFor(cellStyle(cell)) > 0.5) {
        const d = cell.links[0] ? 0 : 1;
        const [dx, dz] = DIRS[d];
        for (const side of [-1, 1]) batch.box(hedge, dx ? 0.7 : 0.06, 0.06, dx ? 0.06 : 0.7, cell.px + dz * side * 0.36, 0.03, cell.pz + dx * side * 0.36, 0, true);
      }
      for (let i = 0; i < 4; i++) {
        const hx = ((cell.hash >> i) % 7) / 7 - 0.43;
        const hz = ((cell.hash >> (i + 3)) % 7) / 7 - 0.43;
        batch.box(cobble, 0.07, 0.004, 0.05, cell.px + hx * 0.36, 0.024, cell.pz + hz * 0.36);
      }
      // Town-era street life: barrels, crates and notice boards on the verges.
      const devX = cell.px + (cell.hash % 2 ? 1 : -1) * 0.4, devZ = cell.pz - ((cell.hash >> 1) % 2 ? 1 : -1) * 0.4;
      if (cell.hash % 5 === 3) {
        batch.add(cylinderGeo(0.035, 0.035, 0.08, 8), sharedMat(0x7a5a3a, 1), devX, 0.04, devZ, 1, 1, 1, 0, true);
        batch.box(sharedMat(0x8a6a43, 1), 0.07, 0.07, 0.07, devX + 0.07, 0.035, devZ, 0.4, true);
      } else if (cell.hash % 7 === 5) {
        batch.box(sharedMat(0x5a3f2a, 1), 0.02, 0.2, 0.02, devX - 0.05, 0.1, devZ, 0, true);
        batch.box(sharedMat(0x5a3f2a, 1), 0.02, 0.2, 0.02, devX + 0.05, 0.1, devZ, 0, true);
        batch.box(sharedMat(0xd8c69c, 1), 0.13, 0.09, 0.012, devX, 0.17, devZ, 0, true);
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
    const brick = sharedMat(0x8e5441, 0.95);
    const mortar = sharedMat(0x6a3c2f, 0.95);
    const laneTop = sharedMat(0x4a4b4c, 0.95);
    const rail = sharedMat(0xa9adb2, 0.35, { metalness: 0.6 });
    const pavers = [sharedMat(0xd9c6a0, 0.9), sharedMat(0xb98a64, 0.9)];
    const planter = sharedMat(0x6d6a60, 0.9);
    const grass = sharedMat(theme.foliage[0], 1);
    const surface = (style: StreetStyle) => style === "brick" ? brick : style === "lane" ? laneTop : asphalt;
    for (const cell of cells) {
      const anyLink = cell.links.some(Boolean);
      const linkCount = cell.links.filter(Boolean).length;
      const straight = linkCount === 2 && ((cell.links[0] && cell.links[2]) || (cell.links[1] && cell.links[3]));
      const style = cellStyle(cell);
      if (isPlaza(cell)) {
        // Market street: flush chequered pavers wall to wall, planters and bollards instead of curbs.
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) batch.box(pavers[(i + j + (cell.hash & 1)) % 2], 0.25, MARKET_Y, 0.25, cell.px - 0.375 + i * 0.25, MARKET_Y / 2, cell.pz - 0.375 + j * 0.25);
        for (let d = 0; d < 4; d++) {
          if (cell.links[d]) continue;
          const [dx, dz] = DIRS[d];
          for (const offset of [-0.3, 0, 0.3]) batch.add(cylinderGeo(0.012, 0.014, 0.07, 6), pole, cell.px + dx * 0.32 + dz * offset, MARKET_Y + 0.035, cell.pz + dz * 0.32 + dx * offset, 1, 1, 1, 0, true);
        }
        if (straight) {
          const d = cell.links[0] ? 0 : 1;
          const [dx, dz] = DIRS[d];
          const side = cell.hash & 2 ? 1 : -1;
          // A stall awning or a planter on one verge.
          const x = cell.px + dz * side * 0.4, z = cell.pz + dx * side * 0.4;
          if (cell.hash % 3 === 0) {
            batch.add(coneGeo(0.13, 0.07, 6), sharedMat([0xd9534f, 0x3f8fd2, 0xf2c94c][cell.hash % 3 === 0 ? (cell.hash >> 3) % 3 : 0], 0.8), x, MARKET_Y + 0.2, z, 1, 1, 1, 0, true);
            batch.add(cylinderGeo(0.006, 0.006, 0.2, 4), pole, x, MARKET_Y + 0.1, z);
            batch.box(sharedMat(0x8a6a43, 0.9), 0.14, 0.05, 0.08, x, MARKET_Y + 0.05, z, dx ? 0 : Math.PI / 2, true);
          } else {
            batch.box(planter, 0.12, 0.05, 0.12, x, MARKET_Y + 0.025, z, 0, true);
            batch.add(sphereGeo(0.07, 7, 5), leaf, x, MARKET_Y + 0.1, z, 1, 0.9, 1, 0, true);
          }
        }
      } else {
        const hc = anyLink ? STREET_HALF[style] : ASPHALT_HALF;
        const rim = 0.5 - hc, mid = (0.5 + hc) / 2;
        // Corners are sidewalk; the middle and each linked arm are road at that arm's own width.
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.box(walk, rim, SIDEWALK_Y, rim, cell.px + sx * mid, SIDEWALK_Y / 2, cell.pz + sz * mid);
        batch.box(anyLink ? surface(style) : walk, hc * 2, anyLink ? ROAD_Y : SIDEWALK_Y, hc * 2, cell.px, (anyLink ? ROAD_Y : SIDEWALK_Y) / 2, cell.pz);
        for (let d = 0; d < 4; d++) {
          const linked = cell.links[d];
          const ha = linked ? STREET_HALF[armStyle(cell, d)] : hc;
          const [dx, dz] = DIRS[d];
          arm(linked ? surface(armStyle(cell, d)) : walk, cell, d, hc, 0.5, ha * 2, (linked ? ROAD_Y : SIDEWALK_Y) / 2, linked ? ROAD_Y : SIDEWALK_Y);
          if (linked && ha < hc) {
            // Narrow arm off a wide junction: pavement fills the step.
            const w = hc - ha, len = 0.5 - hc, along = (0.5 + hc) / 2, across = (hc + ha) / 2;
            for (const side of [-1, 1]) batch.box(walk, dx ? len : w, SIDEWALK_Y, dx ? w : len, cell.px + dx * along + dz * side * across, SIDEWALK_Y / 2, cell.pz + dz * along + dx * side * across);
          }
          if (!linked && anyLink) arm(curb, cell, d, hc - 0.012, hc + 0.012, hc * 2, SIDEWALK_Y / 2 + 0.003, SIDEWALK_Y + 0.006);
          if (!linked && cell.doors[d]) arm(sharedMat(0xc9c4b4, 0.9), cell, d, hc + 0.04, 0.5, 0.14, SIDEWALK_Y + 0.002, 0.006);
        }
        if (straight) {
          const d = cell.links[0] ? 0 : 1;
          const [dx, dz] = DIRS[d];
          if (style === "boulevard") {
            // Planted median with a young tree every other block and lamps between.
            arm(curb, cell, d, -0.5, 0.5, 0.05, ROAD_Y + 0.012, 0.024);
            arm(grass, cell, d, -0.5, 0.5, 0.036, ROAD_Y + 0.026, 0.004);
            if (cell.hash % 2) {
              batch.add(cylinderGeo(0.008, 0.01, 0.14, 5), sharedMat(0x5d4433, 1), cell.px, ROAD_Y + 0.09, cell.pz);
              batch.add(sphereGeo(0.06, 7, 5), leaf, cell.px, ROAD_Y + 0.19, cell.pz, 1, 1.15, 1, 0, true);
            } else {
              batch.add(cylinderGeo(0.008, 0.01, 0.4, 5), pole, cell.px, ROAD_Y + 0.22, cell.pz, 1, 1, 1, 0, true);
              for (const side of [-1, 1]) batch.add(sphereGeo(0.025, 6, 4), bulb, cell.px + dz * side * 0.05, ROAD_Y + 0.41, cell.pz + dx * side * 0.05);
              batch.box(pole, dz ? 0.12 : 0.012, 0.012, dz ? 0.012 : 0.12, cell.px, ROAD_Y + 0.42, cell.pz);
            }
          } else if (style === "tram") {
            // Rails sunk into each lane, and catenary poles carrying the overhead wire.
            for (const lane of [-0.135, 0.135]) for (const gauge of [-0.03, 0.03]) {
              const off = lane + gauge;
              batch.box(rail, dx ? 1 : 0.008, 0.004, dx ? 0.008 : 1, cell.px + dz * off, ROAD_Y + 0.002, cell.pz + dx * off);
            }
            for (const lane of [-0.135, 0.135]) batch.box(sharedMat(0x22262b, 0.5), dx ? 1 : 0.004, 0.004, dx ? 0.004 : 1, cell.px + dz * lane, 0.5, cell.pz + dx * lane);
            if (cell.hash % 2 === 0) {
              const side = cell.hash & 4 ? 1 : -1;
              const x = cell.px + dz * side * 0.36, z = cell.pz + dx * side * 0.36;
              batch.add(cylinderGeo(0.01, 0.012, 0.48, 5), pole, x, SIDEWALK_Y + 0.24, z, 1, 1, 1, 0, true);
              batch.box(pole, dz ? 0.36 : 0.01, 0.01, dz ? 0.01 : 0.36, cell.px + dz * side * 0.18, 0.51, cell.pz + dx * side * 0.18);
            }
          } else if (style === "brick") {
            // Running-bond courses across the street and a pale edge line.
            for (let i = -2; i <= 2; i++) batch.box(mortar, dx ? 0.01 : 0.46, 0.003, dx ? 0.46 : 0.01, cell.px + dx * i * 0.2, ROAD_Y + 0.001, cell.pz + dz * i * 0.2);
            for (const side of [-1, 1]) {
              const off = side * (STREET_HALF.brick - 0.03);
              batch.box(stripe, dx ? 1 : 0.012, 0.003, dx ? 0.012 : 1, cell.px + dz * off, ROAD_Y + 0.002, cell.pz + dx * off);
            }
          } else if (style === "lane") {
            // Back lanes: no markings, bins and the odd crate against the walls.
            const side = cell.hash & 2 ? 1 : -1;
            if (cell.hash % 3 !== 1) {
              batch.box(sharedMat([0x3b6d4a, 0x30353a, 0x2e5d8a][cell.hash % 3], 0.7), 0.06, 0.08, 0.06, cell.px + dz * side * 0.4 + dx * 0.15, SIDEWALK_Y + 0.04, cell.pz + dx * side * 0.4 + dz * 0.15, 0, true);
            }
            if (cell.hash % 4 === 0) batch.box(sharedMat(0x8a6a43, 1), 0.07, 0.07, 0.07, cell.px - dz * side * 0.4 - dx * 0.1, SIDEWALK_Y + 0.035, cell.pz - dx * side * 0.4 - dz * 0.1, 0.5, true);
          } else {
            arm(line, cell, d, -0.16, 0.16, 0.022, ROAD_Y + 0.002, 0.004);
          }
        } else if (linkCount >= 3) {
          const ring = style === "boulevard" || style === "tram";
          if (ring) {
            // Big junctions get a coloured box junction so the crossing reads from far away.
            batch.box(sharedMat(0xa0473b, 0.9), hc * 1.2, 0.003, hc * 1.2, cell.px, ROAD_Y + 0.001, cell.pz);
          }
          for (let d = 0; d < 4; d++) {
            if (!cell.links[d]) continue;
            const [dx, dz] = DIRS[d];
            const half = STREET_HALF[armStyle(cell, d)];
            const at = Math.min(0.42, hc + 0.1);
            for (let offset = -half + 0.08; offset <= half - 0.07; offset += 0.1) {
              batch.box(stripe, dx ? 0.13 : 0.05, 0.004, dx ? 0.05 : 0.13, cell.px + dx * at + dz * offset, ROAD_Y + 0.002, cell.pz + dz * at + dx * offset);
            }
          }
        } else if (linkCount === 1 && style !== "lane") {
          for (let d = 0; d < 4; d++) if (cell.links[d]) arm(line, cell, d, 0.3, 0.46, 0.022, ROAD_Y + 0.002, 0.004);
        }
      }
      if (isPlaza(cell)) continue;
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
      // Street devices on the two remaining corners.
      const dx = cell.px + cornerX * 0.4, dz = cell.pz - cornerZ * 0.4;
      const ex = cell.px - cornerX * 0.4, ez = cell.pz + cornerZ * 0.4;
      const y = SIDEWALK_Y;
      const device = (cell.hash >> 2) % 9;
      if (device === 0) { // phone booth
        batch.box(sharedMat(0xc0392b, 0.6), 0.08, 0.2, 0.08, dx, y + 0.1, dz, 0, true);
        batch.box(sharedMat(0xfff0c2, 0.3, { emissive: 0xffd98a, emissiveIntensity: 0.9 }), 0.082, 0.1, 0.082, dx, y + 0.12, dz);
      } else if (device === 1) { // vending machine
        batch.box(sharedMat(0x2e6da4, 0.5), 0.08, 0.16, 0.06, dx, y + 0.08, dz, 0, true);
        batch.box(sharedMat(0xe8f4ff, 0.3, { emissive: 0x9fd4ff, emissiveIntensity: 1.1 }), 0.06, 0.08, 0.062, dx, y + 0.1, dz);
      } else if (device === 2) { // mailbox
        batch.box(sharedMat(0x2f5fa8, 0.6), 0.05, 0.07, 0.04, dx, y + 0.075, dz, 0, true);
        batch.box(sharedMat(0x30353a, 0.6), 0.012, 0.04, 0.012, dx, y + 0.02, dz);
      } else if (device === 3) { // fire hydrant
        batch.add(cylinderGeo(0.018, 0.022, 0.06, 6), sharedMat(0xd9342b, 0.6), dx, y + 0.03, dz, 1, 1, 1, 0, true);
        batch.add(sphereGeo(0.02, 6, 4), sharedMat(0xd9342b, 0.6), dx, y + 0.065, dz);
      } else if (device === 4) { // bus stop shelter
        batch.box(sharedMat(0xcfe8ee, 0.2, { emissive: 0x6fa8c0, emissiveIntensity: 0.35 }), 0.16, 0.12, 0.008, dx, y + 0.06, dz - 0.035);
        batch.box(sharedMat(0x30353a, 0.5), 0.18, 0.012, 0.08, dx, y + 0.125, dz, 0, true);
        batch.box(sharedMat(0x8a6a43, 0.9), 0.12, 0.012, 0.03, dx, y + 0.035, dz - 0.015);
      } else if (device === 5 || device === 6) { // bench
        batch.box(sharedMat(0x8a6a43, 0.9), 0.12, 0.012, 0.04, ex, y + 0.035, ez, 0, true);
        batch.box(sharedMat(0x8a6a43, 0.9), 0.12, 0.03, 0.008, ex, y + 0.055, ez - 0.02);
      } else if (device === 7 && era >= 5) { // EV charger
        batch.box(sharedMat(0xe9e6dc, 0.5), 0.04, 0.12, 0.03, dx, y + 0.06, dz, 0, true);
        batch.box(sharedMat(0x7cf29a, 0.3, { emissive: 0x2fd06a, emissiveIntensity: 1.4 }), 0.03, 0.02, 0.032, dx, y + 0.1, dz);
      }
      const spot = Math.min(0.4, STREET_HALF[style] + 0.03);
      if (linkCount >= 3 && !isPlaza(cell)) trafficSpots.push({ x: cell.px + cornerX * spot, z: cell.pz - cornerZ * spot, phase: Math.abs(Math.round(cell.px + cell.pz)) % 2 ? 0 : 0.5 });
    }
  }
  batch.flush(group);
  // Traffic lights: poles are static, the bulbs are one instanced mesh whose colours cycle.
  const spots = trafficSpots;
  if (spots.length) {
    const poles = new Batcher();
    for (const spot of spots) {
      poles.add(cylinderGeo(0.01, 0.012, 0.3, 5), sharedMat(0x30353a, 0.5, { metalness: 0.4 }), spot.x, SIDEWALK_Y + 0.15, spot.z, 1, 1, 1, 0, true);
      poles.box(sharedMat(0x1d2024, 0.6), 0.04, 0.09, 0.04, spot.x, SIDEWALK_Y + 0.33, spot.z);
    }
    poles.flush(group);
    const bulbs = new InstancedMesh(sphereGeo(0.018, 6, 4), new MeshBasicMaterial({ toneMapped: false }), spots.length);
    const dummy = new Object3D();
    spots.forEach((spot, index) => {
      dummy.position.set(spot.x, SIDEWALK_Y + 0.33, spot.z);
      dummy.updateMatrix();
      bulbs.setMatrixAt(index, dummy.matrix);
      bulbs.setColorAt(index, new Color(0x3cff6a));
    });
    bulbs.userData.phases = spots.map(spot => spot.phase);
    group.add(bulbs);
    group.userData.trafficBulbs = bulbs;
  }
  return group;
}
