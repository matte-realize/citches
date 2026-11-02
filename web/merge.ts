import { BufferAttribute, BufferGeometry, Color as ThreeColor, FrontSide, InstancedMesh, Matrix3, Matrix4, Mesh, Object3D } from "three";
import type { Color, Material, MeshStandardMaterial } from "three";
import { bakeKey, vertexColorMaterial } from "./kit.js";

/** A geometry flattened to non-indexed position/normal(/colour) arrays, cached per geometry. */
type Flat = { position: ArrayLike<number>; normal: ArrayLike<number>; color?: ArrayLike<number>; count: number };
const flatCache = new WeakMap<BufferGeometry, Flat>();
function flat(source: BufferGeometry): Flat {
  let entry = flatCache.get(source);
  if (entry) return entry;
  const geometry = source.index ? source.toNonIndexed() : source.attributes.normal ? source : source.clone();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const read = (name: string) => {
    const attribute = geometry.getAttribute(name) as BufferAttribute | undefined;
    if (!attribute) return undefined;
    if (attribute.itemSize === 3 && !(attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return attribute.array;
    const out = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) { out[i * 3] = attribute.getX(i); out[i * 3 + 1] = attribute.getY(i); out[i * 3 + 2] = attribute.getZ(i); }
    return out;
  };
  entry = { position: read("position")!, normal: read("normal")!, color: read("color"), count: geometry.attributes.position.count };
  if (geometry !== source) geometry.dispose();
  flatCache.set(source, entry);
  return entry;
}

/**
 * Draw-call budget for streams.
 *
 * Every building is a handful of meshes, so a grown city costs thousands of draw calls per frame
 * (and the pixel pass and shadows multiply that). Settled buildings never change shape, so each
 * 8x8-tile region of quiet buildings is merged into one mesh per material. The originals are only
 * hidden (moved to an unrendered layer), never touched otherwise: the moment anything about a
 * region changes - a build, wear, a collapse, a tree - it falls back to the originals instantly
 * and is merged again once it has been quiet for a moment.
 */

const HIDDEN_LAYER = 7;
const REGION = 8;
const QUIET_MS = 1200;
// Fingerprinting every model means walking thousands of scene nodes. Once merged, the city only
// needs this check occasionally; edit/build paths still show the live geometry immediately.
const CHECK_MS = 1000;
/** Building parts other code animates every frame (see `updateBuildings`). */
const LIVE_PARTS = ["hearth", "flames"];

export interface MergeTile { x: number; z: number; group: Object3D; building?: Object3D; trees: Object3D[]; revealing?: boolean }

interface Region { signature: number; mergedSignature?: number; changedAt: number; merged: Mesh[]; hidden: Object3D[] }

export class StaticMerger {
  private regions = new Map<number, Region>();
  private lastCheck = 0;
  private instance = new Matrix4();
  private color = new ThreeColor();
  /** Disable with ?merge=0 to compare. */
  enabled = true;

  /** `root` holds the merged meshes; `moving` returns objects other code animates every frame. */
  constructor(private root: Object3D, private moving: () => Set<Object3D>) {}

  /** Called once per frame; does real work a few times a second. Returns true when shadows need a redraw. */
  update(tiles: MergeTile[], now: number, budgetMs = 6) {
    if (!this.enabled || now - this.lastCheck < CHECK_MS) return false;
    this.lastCheck = now;
    const byRegion = new Map<number, MergeTile[]>();
    for (const tile of tiles) {
      const key = Math.floor(tile.x / REGION) * 1000 + Math.floor(tile.z / REGION);
      let list = byRegion.get(key);
      if (!list) byRegion.set(key, list = []);
      list.push(tile);
    }
    const moving = this.moving();
    let changed = false;
    const started = performance.now();
    for (const [key, list] of byRegion) {
      let region = this.regions.get(key);
      if (!region) this.regions.set(key, region = { signature: NaN, changedAt: now, merged: [], hidden: [] });
      const signature = this.signature(list, moving);
      if (signature !== region.signature) {
        region.signature = signature;
        region.changedAt = now;
        if (region.mergedSignature !== undefined && region.mergedSignature !== signature) { this.unmerge(region); changed = true; }
      }
      if (region.mergedSignature === signature || now - region.changedAt < QUIET_MS || performance.now() - started > budgetMs) continue;
      this.unmerge(region);
      this.merge(region, list, moving);
      region.mergedSignature = signature;
      changed = true;
    }
    return changed;
  }

  dispose() { for (const region of this.regions.values()) this.unmerge(region); this.regions.clear(); }

  /** A building takes part once it has finished rising and is not coming down. */
  private settled(tile: MergeTile) {
    const building = tile.building;
    return !tile.revealing && building !== undefined && building.userData.settled === true && building.userData.collapse === undefined;
  }

  /** Meshes of a tile that can be merged: static, opaque and not animated. */
  private collect(tile: MergeTile, moving: Set<Object3D>, out: Mesh[]) {
    const roots: Object3D[] = [...tile.trees];
    if (this.settled(tile)) roots.push(tile.building!);
    for (const root of roots) {
      // Parts animated every frame stay live. Anything else that changes (owner flags, wear
      // clutter, signs) simply changes the region's signature and un-merges it.
      const skip = new Set<Object3D>();
      for (const name of LIVE_PARTS) if (root.userData[name] instanceof Object3D) skip.add(root.userData[name]);
      const visit = (object: Object3D) => {
        if (skip.has(object) || moving.has(object) || !object.visible) return;
        if (object.userData.phase !== undefined || object.userData.hearthPhase !== undefined) return;
        if (object instanceof Mesh && !Array.isArray(object.material) && !(object.material as Material).transparent) out.push(object);
        for (const child of object.children) visit(child);
      };
      visit(root);
    }
  }

  /** A cheap fingerprint of everything that would make a merged copy stale. */
  private signature(tiles: MergeTile[], moving: Set<Object3D>) {
    let hash = 0;
    const mix = (value: number) => { hash = (Math.imul(hash ^ Math.round(value * 1000), 2654435761) + 0x9e3779b9) | 0; };
    for (const tile of tiles) {
      mix(tile.building?.id ?? -1);
      mix(this.settled(tile) ? 1 : 0);
      if (!this.settled(tile) && !tile.trees.length) continue;
      const meshes: Mesh[] = [];
      this.collect(tile, moving, meshes);
      mix(meshes.length);
      for (const mesh of meshes) {
        mix(mesh.id);
        mix((mesh.material as Material & { id: number }).id);
        const e = mesh.matrixWorld.elements;
        mix(e[0] + e[5] * 3 + e[10] * 7 + e[4] * 11 + e[1] * 13 + e[12] * 17 + e[13] * 19 + e[14] * 23);
      }
    }
    return hash;
  }

  private merge(region: Region, tiles: MergeTile[], moving: Set<Object3D>) {
    const meshes: Mesh[] = [];
    for (const tile of tiles) this.collect(tile, moving, meshes);
    if (meshes.length < 2) return;
    this.root.updateMatrixWorld();
    const toRoot = new Matrix4().copy(this.root.matrixWorld).invert();
    type Part = { data: Flat; matrix: Matrix4; tint?: Color; ownColors: boolean };
    const groups = new Map<string, { material: Material; cast: boolean; receive: boolean; colored: boolean; parts: Part[]; vertices: number }>();
    for (const mesh of meshes) {
      const source = mesh.material as Material;
      // Plain colours (and grimy vertex-coloured copies) fold into one shared vertex-colour
      // material, so a region draws in a handful of calls however many paints it uses.
      // Glowing, metallic and see-through materials keep their own (night lighting drives them).
      const standard = source as MeshStandardMaterial;
      const foldable = (bakeKey(source).startsWith("vc|") || (standard.isMeshStandardMaterial && standard.vertexColors && !standard.transparent && !standard.map
        && !(standard.emissiveIntensity > 0 && standard.emissive.getHex() !== 0) && standard.metalness <= 0.2))
        && standard.side === FrontSide && !standard.flatShading;
      // Per-instance colours can only be carried over by folding; otherwise leave the batch live.
      if (mesh instanceof InstancedMesh && mesh.instanceColor && !foldable) continue;
      const material = foldable ? vertexColorMaterial(standard.roughness) : source;
      const colored = foldable || (source as { vertexColors?: boolean }).vertexColors === true;
      const tint = foldable ? standard.color : undefined;
      // Only read the geometry's colours if its own material used them (shared shapes can carry stale ones).
      const ownColors = (source as { vertexColors?: boolean }).vertexColors === true;
      const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, colored, parts: [], vertices: 0 });
      const data = flat(mesh.geometry);
      const world = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
      if (mesh instanceof InstancedMesh) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, this.instance);
          let own = tint;
          if (mesh.instanceColor && tint) { mesh.getColorAt(i, this.color); own = this.color.clone().multiply(tint); }
          group.parts.push({ data, matrix: new Matrix4().multiplyMatrices(world, this.instance), tint: own, ownColors });
          group.vertices += data.count;
        }
      } else { group.parts.push({ data, matrix: world, tint, ownColors }); group.vertices += data.count; }
      mesh.layers.set(HIDDEN_LAYER);
      region.hidden.push(mesh);
    }
    // Vertices are transformed straight into one preallocated buffer per material: no clones.
    const normalMatrix = new Matrix3();
    for (const { material, cast, receive, colored, parts, vertices } of groups.values()) {
      const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3);
      const color = colored ? new Float32Array(vertices * 3).fill(1) : undefined;
      let o = 0;
      for (const { data, matrix, tint, ownColors } of parts) {
        const tr = tint?.r ?? 1, tg = tint?.g ?? 1, tb = tint?.b ?? 1;
        const m = matrix.elements;
        const n = normalMatrix.getNormalMatrix(matrix).elements;
        const p = data.position, q = data.normal;
        for (let i = 0; i < data.count * 3; i += 3, o += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          position[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
          position[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          position[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          const a = q[i], b = q[i + 1], c = q[i + 2];
          const nx = n[0] * a + n[3] * b + n[6] * c, ny = n[1] * a + n[4] * b + n[7] * c, nz = n[2] * a + n[5] * b + n[8] * c;
          const len = Math.hypot(nx, ny, nz) || 1;
          normal[o] = nx / len; normal[o + 1] = ny / len; normal[o + 2] = nz / len;
          if (color) {
            const base = ownColors ? data.color : undefined;
            color[o] = (base ? base[i] : 1) * tr; color[o + 1] = (base ? base[i + 1] : 1) * tg; color[o + 2] = (base ? base[i + 2] : 1) * tb;
          }
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(position, 3));
      geometry.setAttribute("normal", new BufferAttribute(normal, 3));
      if (color) geometry.setAttribute("color", new BufferAttribute(color, 3));
      geometry.computeBoundingSphere();
      const merged = new Mesh(geometry, material);
      merged.castShadow = cast;
      merged.receiveShadow = receive;
      merged.matrixAutoUpdate = false;
      merged.userData.merged = true;
      this.root.add(merged);
      region.merged.push(merged);
    }
  }

  private unmerge(region: Region) {
    for (const mesh of region.merged) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    for (const object of region.hidden) object.layers.set(0);
    region.merged = [];
    region.hidden = [];
    region.mergedSignature = undefined;
  }
}
