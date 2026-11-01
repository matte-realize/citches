import { Group, MathUtils } from "three";
import type { Object3D } from "three";
import { bakeStatic, block, coneGeo, cylinderGeo, place, sharedMat, sphereGeo } from "./kit.js";

/**
 * Agents move every frame, so they skip the (static) shadow map. A flat dark footprint baked into
 * the model keeps them visibly planted on the ground instead.
 */
function contactShadow(parent: Group, width: number, length: number) {
  const shadow = block(parent, width, 0.004, length, 0, 0.003, 0, sharedMat(0x1a1c1e, 1), 0, false);
  shadow.receiveShadow = false;
}
function bakeAgent(root: Group, movingParts: Group[]) {
  for (const part of movingParts) { bakeStatic(part, 2); part.userData.keep = true; }
  bakeStatic(root, 2);
  root.traverse(object => { object.castShadow = false; });
}
import type { CityTheme, CityThemeId } from "./theme.js";

type Random = () => number;
const pick = <T>(random: Random, list: readonly T[]) => list[Math.floor(random() * list.length)];

export interface PersonRig {
  root: Group; body: Group; head: Group;
  legL: Group; legR: Group; armL: Group; armR: Group;
  height: number;
}

const SKIN = [0xf1c6a3, 0xe0b08a, 0xc68e66, 0xa36d4b, 0x7b4f34, 0x5c3a27];
const HAIR = [0x2a211b, 0x3d2c20, 0x5a3b24, 0x8a5a32, 0xb48a52, 0x1d1d22, 0x9a958c];
const EARLY_CLOTH = [0x846342, 0x75644b, 0x9a714d, 0x695849, 0xa88b62, 0x6f7a56, 0xb39a6d];
const MODERN_CLOTH = [0x3b6ea5, 0xc0504d, 0xe0b84a, 0x5b8c5a, 0x8a5fa8, 0x2f3e46, 0xe48a3c, 0xf0ece0, 0x4bb3b0, 0xd46a8c];
const PANTS = [0x3a3f4a, 0x2e3b55, 0x4a3b2e, 0x5d5a52, 0x1f2328];

/** An articulated villager: legs and arms hang from pivots so they can swing while walking or gesturing. */
export function makePerson(random: Random, era: number, themeId: CityThemeId, theme: CityTheme): PersonRig {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const style = theme.style;
  const skin = sharedMat(pick(random, SKIN), 1);
  const modern = era >= 4;
  const clothColor = random() < 0.25 ? theme.accent : pick(random, modern ? MODERN_CLOTH : EARLY_CLOTH);
  const cloth = sharedMat(clothColor, 0.95);
  const pants = sharedMat(modern ? pick(random, PANTS) : pick(random, EARLY_CLOTH), 1);
  const scale = random() < 0.12 ? 0.72 : 0.9 + random() * 0.18;
  body.scale.setScalar(scale);

  // Torso and, for robe-wearing eras, a flared skirt.
  place(body, cylinderGeo(0.062, 0.082, 0.2, 7), cloth, 0, 0.29, 0);
  if (!modern && (style === "egypt" || style === "rome" || style === "japan" || random() < 0.3)) {
    place(body, cylinderGeo(0.08, 0.11, 0.12, 7), cloth, 0, 0.17, 0);
  }
  if (random() < 0.3) place(body, sphereGeo(0.035, 6, 4), sharedMat(modern ? pick(random, MODERN_CLOTH) : 0x6b4a2e, 1), 0, 0.3, -0.075); // satchel / backpack

  const head = new Group();
  head.position.y = 0.44;
  body.add(head);
  place(head, sphereGeo(0.064, 8, 6), skin, 0, 0, 0);
  const hair = place(head, sphereGeo(0.067, 8, 5), sharedMat(pick(random, HAIR), 1), 0, 0.025, -0.008);
  hair.scale.set(1.02, 0.62, 1.04);
  // Era and theme hats give crowds some silhouette variety.
  const hatRoll = random();
  if (!modern && style === "japan" && hatRoll < 0.4) {
    place(head, coneGeo(0.13, 0.06, 10), sharedMat(0xc9a86a, 1), 0, 0.07, 0);
  } else if (!modern && style === "norse" && hatRoll < 0.35) {
    place(head, sphereGeo(0.075, 8, 5), sharedMat(0x7a6650, 1), 0, 0.035, 0).scale.set(1, 0.75, 1);
  } else if (!modern && style === "egypt" && hatRoll < 0.4) {
    block(head, 0.15, 0.05, 0.14, 0, 0.04, -0.01, sharedMat(0xe8dcc0, 1));
    block(head, 0.15, 0.1, 0.03, 0, -0.03, -0.06, sharedMat(0xe8dcc0, 1));
  } else if (modern && hatRoll < 0.22) {
    place(head, cylinderGeo(0.07, 0.07, 0.03, 10), sharedMat(pick(random, MODERN_CLOTH), 0.8), 0, 0.06, 0);
    block(head, 0.08, 0.012, 0.06, 0, 0.05, 0.07, sharedMat(pick(random, MODERN_CLOTH), 0.8));
  }

  const limb = (x: number, y: number, length: number, radius: number, material: ReturnType<typeof sharedMat>, endMaterial: ReturnType<typeof sharedMat>) => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    place(pivot, cylinderGeo(radius * 0.85, radius, length, 5), material, 0, -length / 2, 0);
    place(pivot, sphereGeo(radius * 1.15, 5, 4), endMaterial, 0, -length, radius * 0.4);
    body.add(pivot);
    return pivot;
  };
  const legL = limb(-0.036, 0.19, 0.17, 0.028, pants, sharedMat(0x2b241e, 1));
  const legR = limb(0.036, 0.19, 0.17, 0.028, pants, sharedMat(0x2b241e, 1));
  const armL = limb(-0.088, 0.375, 0.16, 0.022, cloth, skin);
  const armR = limb(0.088, 0.375, 0.16, 0.022, cloth, skin);
  armL.rotation.z = -0.12; armR.rotation.z = 0.12;
  const footprint = place(root, cylinderGeo(0.09, 0.09, 0.004, 8), sharedMat(0x1a1c1e, 1), 0, 0.003, 0, false);
  footprint.receiveShadow = false;
  // Merge each limb and the body into a couple of draw calls; limbs stay separate so they can swing.
  for (const part of [legL, legR, armL, armR, head]) { bakeStatic(part, 2); part.userData.keep = true; }
  bakeStatic(body, 2);
  root.traverse(object => { object.castShadow = false; });
  return { root, body, head, legL, legR, armL, armR, height: 0.5 * scale };
}

export type PersonPose = "walk" | "idle" | "talk" | "sit" | "wave" | "cheer" | "panic" | "sleep";
export function posePerson(rig: PersonRig, pose: PersonPose, phase: number, stride = 1) {
  const s = Math.sin(phase);
  let legL = 0, legR = 0, armL = 0, armR = 0, armLz = -0.12, armRz = 0.12, bob = 0, lean = 0, headYaw = 0, headPitch = 0;
  if (pose === "walk" || pose === "panic") {
    const swing = (pose === "panic" ? 0.95 : 0.62) * stride;
    legL = s * swing; legR = -s * swing;
    armL = -s * swing * 0.85; armR = s * swing * 0.85;
    bob = Math.abs(Math.cos(phase)) * 0.022 * stride;
    lean = 0.08 * stride;
    if (pose === "panic") { armL = -2.6 + s * 0.4; armR = -2.6 - s * 0.4; armLz = -0.4; armRz = 0.4; }
  } else if (pose === "idle") {
    bob = Math.sin(phase * 0.5) * 0.004;
    headYaw = Math.sin(phase * 0.23) * 0.5;
    armL = Math.sin(phase * 0.5) * 0.05; armR = -armL;
  } else if (pose === "talk") {
    bob = Math.abs(Math.sin(phase * 1.6)) * 0.006;
    armR = -0.7 - Math.max(0, Math.sin(phase * 1.3)) * 0.7;
    armRz = 0.3 + Math.sin(phase * 2.1) * 0.2;
    armL = -0.2 - Math.max(0, Math.sin(phase * 0.9 + 1.5)) * 0.6;
    headPitch = Math.sin(phase * 1.7) * 0.12;
    headYaw = Math.sin(phase * 0.6) * 0.2;
  } else if (pose === "sit") {
    legL = legR = -1.45;
    bob = -0.1;
    armL = armR = -0.55 + Math.sin(phase * 0.8) * 0.08;
    armRz = 0.2 + Math.max(0, Math.sin(phase * 0.7)) * 0.35;
    headYaw = Math.sin(phase * 0.3) * 0.35;
  } else if (pose === "sleep") {
    // Slumped by the fire, head nodding, slow breathing.
    legL = legR = -1.4;
    bob = -0.13 + Math.sin(phase * 0.35) * 0.004;
    lean = 0.28;
    armL = armR = -0.35;
    armLz = -0.25; armRz = 0.25;
    headPitch = 0.6 + Math.sin(phase * 0.35) * 0.05;
  } else if (pose === "wave") {
    armR = -2.7; armRz = 0.4 + Math.sin(phase * 5) * 0.35;
    bob = Math.abs(Math.sin(phase * 2)) * 0.008;
  } else if (pose === "cheer") {
    const jump = Math.max(0, Math.sin(phase * 3));
    bob = jump * 0.08;
    armL = armR = -2.8; armLz = -0.35 - jump * 0.2; armRz = 0.35 + jump * 0.2;
    legL = legR = -jump * 0.3;
  }
  const ease = (from: number, to: number) => MathUtils.lerp(from, to, 0.3);
  rig.legL.rotation.x = ease(rig.legL.rotation.x, legL);
  rig.legR.rotation.x = ease(rig.legR.rotation.x, legR);
  rig.armL.rotation.x = ease(rig.armL.rotation.x, armL);
  rig.armR.rotation.x = ease(rig.armR.rotation.x, armR);
  rig.armL.rotation.z = ease(rig.armL.rotation.z, armLz);
  rig.armR.rotation.z = ease(rig.armR.rotation.z, armRz);
  rig.body.position.y = ease(rig.body.position.y, bob);
  rig.body.rotation.x = ease(rig.body.rotation.x, lean);
  rig.head.rotation.y = ease(rig.head.rotation.y, headYaw);
  rig.head.rotation.x = ease(rig.head.rotation.x, headPitch);
}

export interface VehicleModel { root: Group; wheels: Object3D[]; legs: Group[]; length: number; width: number; wheelRadius: number; propeller?: Object3D }

const CAR_PAINT = [0xc0392b, 0x2e6da4, 0xe8c14a, 0x3d8b5a, 0xe9e4d8, 0x2b2f36, 0x8e5ba8, 0xd9772f, 0x5fa8c9, 0x9a2f48];

function wheel(parent: Group, x: number, z: number, radius: number) {
  const hub = new Group();
  hub.position.set(x, radius, z);
  const tire = place(hub, cylinderGeo(radius, radius, 0.04, 10), sharedMat(0x1e2124, 0.95), 0, 0, 0);
  tire.rotation.z = Math.PI / 2;
  const rim = block(hub, 0.042, radius * 0.9, radius * 0.25, 0, 0, 0, sharedMat(0xb8bcc0, 0.4, { metalness: 0.6 }));
  rim.castShadow = false;
  parent.add(hub);
  return hub;
}

/** Cars face +z so `rotation.y = atan2(dx, dz)` points them along the lane. Wheels touch y=0. */
export function makeCar(random: Random, era: number, theme: CityTheme): VehicleModel {
  const root = new Group();
  const style = era >= 5 ? pick(random, ["sedan", "sedan", "taxi", "van", "sport"] as const) : pick(random, ["vintage", "vintage", "pickup", "van"] as const);
  const paintColor = style === "taxi" ? 0xf0c330 : random() < 0.2 ? theme.accent : pick(random, CAR_PAINT);
  const paint = sharedMat(paintColor, 0.35, { metalness: 0.35 });
  const glass = sharedMat(0x26343d, 0.15, { metalness: 0.5 });
  const r = 0.045;
  const length = style === "van" ? 0.5 : style === "sport" ? 0.46 : 0.48;
  const width = 0.25;
  block(root, width, 0.085, length, 0, r + 0.045, 0, paint);
  if (style === "vintage") {
    block(root, width * 0.92, 0.09, length * 0.48, 0, r + 0.13, -0.04, glass);
    block(root, width * 0.96, 0.025, length * 0.5, 0, r + 0.185, -0.04, paint);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const fender = place(root, sphereGeo(0.06, 8, 5), paint, x * width * 0.42, r + 0.04, z * length * 0.3);
      fender.scale.set(0.8, 0.7, 1.3);
    }
  } else if (style === "pickup") {
    block(root, width * 0.92, 0.1, length * 0.34, 0, r + 0.13, length * 0.08, glass);
    block(root, width * 0.96, 0.025, length * 0.36, 0, r + 0.19, length * 0.08, paint);
    block(root, width, 0.06, length * 0.4, 0, r + 0.115, -length * 0.28, sharedMat(0x5b4430, 1));
  } else if (style === "van") {
    block(root, width * 0.96, 0.16, length * 0.8, 0, r + 0.165, -length * 0.06, paint);
    block(root, width * 0.97, 0.07, length * 0.7, 0, r + 0.18, -length * 0.06, glass);
  } else {
    const cabin = style === "sport" ? 0.07 : 0.09;
    block(root, width * 0.88, cabin, length * 0.5, 0, r + 0.09 + cabin / 2, -0.02, glass);
    block(root, width * 0.9, 0.022, length * 0.42, 0, r + 0.1 + cabin, -0.02, paint);
    if (style === "taxi") block(root, 0.08, 0.03, 0.04, 0, r + 0.14 + cabin, -0.02, sharedMat(0xfff3c4, 0.4, { emissive: 0xffd36b, emissiveIntensity: 0.9 }));
    if (style === "sport") block(root, width * 0.9, 0.02, 0.04, 0, r + 0.13, -length * 0.48, paint);
  }
  const head = sharedMat(0xfff4cc, 0.3, { emissive: 0xffe2a0, emissiveIntensity: 1.6 });
  const tail = sharedMat(0xff4a3a, 0.3, { emissive: 0xff2a1a, emissiveIntensity: 1.2 });
  for (const x of [-0.08, 0.08]) {
    block(root, 0.05, 0.03, 0.012, x, r + 0.055, length / 2 + 0.004, head, 0, false);
    block(root, 0.05, 0.025, 0.012, x, r + 0.055, -length / 2 - 0.004, tail, 0, false);
  }
  const wheels = [-1, 1].flatMap(x => [-1, 1].map(z => wheel(root, x * (width / 2 - 0.005), z * length * 0.31, r)));
  contactShadow(root, width + 0.04, length + 0.04);
  bakeAgent(root, wheels as Group[]);
  return { root, wheels, legs: [], length, width, wheelRadius: r };
}

export function makeBus(random: Random, theme: CityTheme): VehicleModel {
  const root = new Group();
  const paint = sharedMat(random() < 0.5 ? theme.accent : 0xd9a441, 0.4, { metalness: 0.25 });
  const length = 0.82, width = 0.27, r = 0.05;
  block(root, width, 0.2, length, 0, r + 0.13, 0, paint);
  block(root, width * 1.01, 0.07, length * 0.9, 0, r + 0.17, -0.01, sharedMat(0xcfe8ee, 0.2, { emissive: 0xffe6a8, emissiveIntensity: 0.55 }));
  block(root, width * 0.9, 0.02, length * 0.8, 0, r + 0.24, 0, sharedMat(0xd8d8d0, 0.6));
  block(root, 0.18, 0.04, 0.01, 0, r + 0.2, length / 2 + 0.005, sharedMat(0xffb347, 0.3, { emissive: 0xff9d2e, emissiveIntensity: 1.2 }), 0, false);
  const head = sharedMat(0xfff4cc, 0.3, { emissive: 0xffe2a0, emissiveIntensity: 1.6 });
  for (const x of [-0.09, 0.09]) block(root, 0.05, 0.03, 0.01, x, r + 0.06, length / 2 + 0.005, head, 0, false);
  const wheels = [-1, 1].flatMap(x => [-0.3, 0.26].map(z => wheel(root, x * (width / 2 - 0.005), z, r)));
  contactShadow(root, width + 0.04, length + 0.04);
  bakeAgent(root, wheels as Group[]);
  return { root, wheels, legs: [], length, width, wheelRadius: r };
}

export function makeWagon(random: Random): VehicleModel {
  const root = new Group();
  const wood = sharedMat(0x68482d, 1);
  const horseCoat = sharedMat(pick(random, [0x78543a, 0x3b2a20, 0xb08a62, 0xd8cfc0]), 1);
  // Horse up front (+z).
  const horse = new Group();
  horse.position.set(0, 0, 0.27);
  const torso = place(horse, sphereGeo(0.085, 8, 6), horseCoat, 0, 0.19, 0);
  torso.scale.set(0.75, 0.75, 1.5);
  const neck = place(horse, cylinderGeo(0.03, 0.04, 0.13, 6), horseCoat, 0, 0.26, 0.1);
  neck.rotation.x = 0.6;
  place(horse, sphereGeo(0.04, 6, 5), horseCoat, 0, 0.31, 0.16).scale.set(0.8, 0.8, 1.4);
  const legs: Group[] = [];
  for (const x of [-0.04, 0.04]) for (const z of [-0.08, 0.08]) {
    const leg = new Group();
    leg.position.set(x, 0.16, z);
    place(leg, cylinderGeo(0.014, 0.016, 0.16, 5), horseCoat, 0, -0.08, 0);
    horse.add(leg);
    legs.push(leg);
  }
  root.add(horse);
  for (const x of [-0.05, 0.05]) block(root, 0.015, 0.015, 0.22, x, 0.17, 0.13, wood);
  // Cart behind with big wooden wheels and some cargo.
  block(root, 0.24, 0.05, 0.3, 0, 0.15, -0.12, wood);
  for (const x of [-0.12, 0.12]) block(root, 0.015, 0.07, 0.3, x, 0.2, -0.12, wood);
  const cargo = random();
  if (cargo < 0.5) for (const z of [-0.2, -0.06]) place(root, cylinderGeo(0.045, 0.045, 0.1, 8), sharedMat(0x8a6a43, 1), 0, 0.23, z);
  else place(root, sphereGeo(0.1, 8, 5), sharedMat(0xd8be73, 1), 0, 0.2, -0.12).scale.set(1, 0.6, 1.3);
  const wheels = [-0.135, 0.135].map(x => wheel(root, x, -0.14, 0.08));
  contactShadow(root, 0.3, 0.72);
  bakeAgent(root, [...wheels as Group[], ...legs]);
  return { root, wheels, legs, length: 0.7, width: 0.28, wheelRadius: 0.08 };
}

export function makeBlimp(theme: CityTheme): VehicleModel {
  const root = new Group();
  const skin = sharedMat(theme.accent, 0.55);
  const envelope = place(root, sphereGeo(0.48, 14, 10), skin, 0, 0, 0);
  envelope.scale.set(0.72, 0.7, 1.8);
  for (const [x, y, rz] of [[0, 0.3, 0], [0, -0.3, 0], [0.3, 0, Math.PI / 2], [-0.3, 0, Math.PI / 2]] as const) {
    const fin = block(root, 0.03, 0.26, 0.3, x, y, -0.78, sharedMat(0xe8dcc0, 0.7));
    fin.rotation.z = rz;
  }
  block(root, 0.15, 0.1, 0.42, 0, -0.38, 0.05, sharedMat(0x604a36, 0.85));
  block(root, 0.152, 0.04, 0.36, 0, -0.37, 0.05, sharedMat(theme.glow, 0.3, { emissive: theme.glow, emissiveIntensity: 1.1 }), 0, false);
  for (const z of [-0.08, 0.18]) place(root, cylinderGeo(0.01, 0.01, 0.2, 4), sharedMat(0x514538), 0, -0.25, z);
  const propeller = new Group();
  propeller.position.set(0, -0.38, -0.2);
  block(propeller, 0.26, 0.03, 0.01, 0, 0, 0, sharedMat(0x3a3530, 0.6));
  root.add(propeller);
  propeller.userData.keep = true;
  bakeStatic(root, 2);
  return { root, wheels: [], legs: [], length: 1.7, width: 0.7, wheelRadius: 1, propeller };
}

export function makeSheep(random: Random) {
  const root = new Group();
  const wool = sharedMat(random() > 0.3 ? 0xe9dfca : 0x8e7657, 1);
  const dark = sharedMat(0x3f352b, 1);
  const body = place(root, sphereGeo(0.13, 8, 6), wool, 0, 0.17, 0);
  body.scale.set(0.82, 0.85, 1.2);
  const head = new Group();
  head.position.set(0, 0.2, 0.14);
  place(head, sphereGeo(0.06, 7, 5), dark, 0, 0, 0.03).scale.set(0.85, 0.9, 1.2);
  root.add(head);
  const legs: Group[] = [];
  for (const x of [-0.06, 0.06]) for (const z of [-0.08, 0.08]) {
    const leg = new Group();
    leg.position.set(x, 0.11, z);
    place(leg, cylinderGeo(0.015, 0.017, 0.11, 5), dark, 0, -0.055, 0);
    root.add(leg);
    legs.push(leg);
  }
  const footprint = place(root, cylinderGeo(0.13, 0.13, 0.004, 8), sharedMat(0x2a3326, 1), 0, 0.003, 0, false);
  footprint.receiveShadow = false;
  bakeAgent(root, [head, ...legs]);
  return { root, head, legs };
}
