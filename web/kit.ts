import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, SphereGeometry } from "three";
import type { BufferGeometry as Geometry, ColorRepresentation, Material, MeshStandardMaterialParameters } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Shared materials and geometry are flagged so disposal of one building never breaks another. */
const materialCache = new Map<string, MeshStandardMaterial>();
const geometryCache = new Map<string, Geometry>();

export function sharedMat(color: ColorRepresentation, roughness = 0.88, extra: Partial<MeshStandardMaterialParameters> = {}) {
  const hex = new Color(color).getHex();
  const key = `${hex}|${roughness}|${JSON.stringify(extra)}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({ color: hex, roughness, ...extra });
    material.userData.shared = true;
    materialCache.set(key, material);
  }
  return material;
}

function cachedGeometry(key: string, make: () => Geometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometry.userData.shared = true;
    geometryCache.set(key, geometry);
  }
  return geometry;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const unitBox = () => cachedGeometry("box", () => new BoxGeometry(1, 1, 1));
export const cylinderGeo = (top: number, bottom: number, height: number, segments = 8) =>
  cachedGeometry(`cyl|${r3(top)}|${r3(bottom)}|${r3(height)}|${segments}`, () => new CylinderGeometry(top, bottom, height, segments));
export const sphereGeo = (radius: number, ws = 8, hs = 6) => cachedGeometry(`sph|${r3(radius)}|${ws}|${hs}`, () => new SphereGeometry(radius, ws, hs));
export const coneGeo = (radius: number, height: number, segments = 8) => cachedGeometry(`cone|${r3(radius)}|${r3(height)}|${segments}`, () => new ConeGeometry(radius, height, segments));
/** Unit pyramid with a 1x1 square base resting on y=0, apex at y=1. */
export const pyramidGeo = () => cachedGeometry("pyramid", () => {
  const geometry = new ConeGeometry(Math.SQRT1_2, 1, 4);
  geometry.rotateY(Math.PI / 4);
  geometry.translate(0, 0.5, 0);
  return geometry;
});
/** Unit triangular prism: base x -0.5..0.5 on y=0, ridge at y=1 running along z -0.5..0.5. */
export const prismGeo = () => cachedGeometry("prism", () => {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0, 1, -0.5];
  const A2 = [-0.5, 0, 0.5], B2 = [0.5, 0, 0.5], C2 = [0, 1, 0.5];
  const faces = [A2, B2, C2, B, A, C, A, A2, C2, A, C2, C, B, C2, B2, B, C, C2, A, B, B2, A, B2, A2];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(faces.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
});

export function place(parent: Object3D, geometry: Geometry, material: Material, x: number, y: number, z: number, shadow = true) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Box centred at (x, y, z). Uses one shared unit cube scaled per mesh. */
export function block(parent: Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: Material, rotY = 0, shadow = true) {
  const mesh = place(parent, unitBox(), material, x, y, z, shadow);
  mesh.scale.set(w, h, d);
  mesh.rotation.y = rotY;
  return mesh;
}

/** Collects many identical small parts (windows, cobbles, lamps) into instanced draws. */
export class Batcher {
  private batches = new Map<string, { geometry: Geometry; material: Material; matrices: Matrix4[]; shadow: boolean }>();
  private dummy = new Object3D();
  add(geometry: Geometry, material: Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0, shadow = false) {
    const key = `${geometry.uuid}|${material.uuid}|${shadow}`;
    let batch = this.batches.get(key);
    if (!batch) { batch = { geometry, material, matrices: [], shadow }; this.batches.set(key, batch); }
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, rotY, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    batch.matrices.push(this.dummy.matrix.clone());
  }
  box(material: Material, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, shadow = false) {
    this.add(unitBox(), material, x, y, z, w, h, d, rotY, shadow);
  }
  flush(parent: Object3D) {
    for (const batch of this.batches.values()) {
      const mesh = new InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = batch.shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.batches.clear();
  }
}

export function disposeObject(root: Object3D) {
  root.traverse(object => {
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Mesh) {
      if (!object.geometry.userData.shared) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (!material.userData.shared) material.dispose();
    }
  });
}

export function tint(color: number, random: () => number, hue = 0.02, light = 0.06) {
  const result = new Color(color);
  result.offsetHSL((random() - 0.5) * hue, (random() - 0.5) * 0.08, (random() - 0.5) * light);
  return result.getHex();
}

const vertexColorMaterials = new Map<number, MeshStandardMaterial>();
/** Shared vertex-coloured material per roughness band, so differently coloured parts can merge. */
function vertexColorMaterial(roughness: number) {
  const band = Math.round(roughness * 4) / 4;
  let material = vertexColorMaterials.get(band);
  if (!material) {
    material = new MeshStandardMaterial({ vertexColors: true, roughness: band });
    material.userData.shared = true;
    vertexColorMaterials.set(band, material);
  }
  return material;
}

/** Plain opaque colours can be baked into vertex colours; glowing, metallic or see-through ones keep their material. */
function bakeKey(material: Material) {
  if (!(material instanceof MeshStandardMaterial) || material.transparent || material.vertexColors || material.map) return material.uuid;
  const glows = material.emissiveIntensity > 0 && (material.emissive.r + material.emissive.g + material.emissive.b) > 0;
  if (glows || material.metalness > 0.2) return material.uuid;
  return `vc|${Math.round(material.roughness * 4) / 4}`;
}

/**
 * Merge a finished object's static meshes. Plain-coloured parts become vertex colours on one shared
 * material, so a building made of 60 parts usually draws in two or three calls (and the same in
 * the shadow pass). Objects flagged `userData.keep` (moving parts, flames) are left untouched.
 */
export function bakeStatic(root: Object3D, minMeshes = 4) {
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: Material; geometries: Geometry[]; shadow: boolean }>();
  const remove: Mesh[] = [];
  const visit = (object: Object3D) => {
    if (object !== root && object.userData.keep) return;
    if (object instanceof Mesh && !(object instanceof InstancedMesh) && !Array.isArray(object.material)) {
      const material = object.material as Material;
      const key = bakeKey(material);
      const source = object.geometry as Geometry;
      const geometry: Geometry = source.index ? source.toNonIndexed() : source.clone();
      for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      if (key.startsWith("vc|")) {
        const color = (material as MeshStandardMaterial).color;
        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
        geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      }
      const entry = groups.get(key) ?? { material: key.startsWith("vc|") ? vertexColorMaterial((material as MeshStandardMaterial).roughness) : material, geometries: [] as Geometry[], shadow: false };
      entry.geometries.push(geometry);
      entry.shadow ||= object.castShadow;
      groups.set(key, entry);
      remove.push(object);
    }
    for (const child of [...object.children]) visit(child);
  };
  visit(root);
  if (remove.length < minMeshes) { for (const entry of groups.values()) entry.geometries.forEach(g => g.dispose()); return; }
  for (const mesh of remove) {
    mesh.removeFromParent();
    if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
    const material = mesh.material as Material;
    if (!material.userData.shared && bakeKey(material).startsWith("vc|")) material.dispose();
  }
  for (const { material, geometries, shadow } of groups.values()) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const empty: Object3D[] = [];
  root.traverse(object => { if (object !== root && object.type === "Group" && object.children.length === 0 && !object.userData.keep) empty.push(object); });
  empty.forEach(object => object.removeFromParent());
}
