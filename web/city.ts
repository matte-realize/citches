import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { ACESFilmicToneMapping, BasicShadowMap, ShaderMaterial, Box3, BoxGeometry, DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, IcosahedronGeometry, LineBasicMaterial, LineLoop, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap, PlaneGeometry, PointLight, SRGBColorSpace, Scene, SphereGeometry, TorusGeometry, Vector3, WebGLRenderer } from "three";
import type { ColorRepresentation, Material, MeshStandardMaterialParameters } from "three";
import type { AttackKind, SimEvent } from "../src/types.js";
import type { CommunityProgress } from "../src/types.js";
import { HomeKit } from "./homes.js";
import { SpecialKit } from "./specials.js";
import type { Animated } from "./specials.js";
import { bakeStatic, disposeObject } from "./kit.js";
import { CityLife } from "./life.js";
import type { Door, NetCell } from "./life.js";
import { DIRS, buildStreetLayer } from "./streets.js";
import { CITY_THEMES } from "./theme.js";
import type { CityThemeId } from "./theme.js";

export { CITY_THEMES } from "./theme.js";
export type { CityThemeId } from "./theme.js";

type TileKind = "empty" | "house" | "landmark" | "fire";
type Tile = { x: number; z: number; kind: TileKind; road: boolean; group: Group; building?: Group; trees: Group[]; burningUntil?: number; revealing?: boolean; revealElapsed?: number; index: number };
type Particle = { position: Vector3; velocity: Vector3; size: number; color: Color; life: number; maxLife: number; gravity: number; drag?: number };
const MAX_PARTICLES = 900;
type AccessPlan = { dx: number; dz: number; yaw: number; route: Tile[] };
/** `pixelSize` is how many screen pixels each rendered pixel covers (1 = smooth, 1.5 = default pixel art). */
export interface CityOptions { transparent?: boolean; zoom?: number; pixelSize?: number; maxFps?: number }

const GRID = 32;
export function themeFromSearch(search = window.location.search): CityThemeId {
  const choice = new URLSearchParams(search).get("theme");
  const aliases: Record<string, CityThemeId> = { ancient: "egypt", fantasy: "rome", solarpunk: "norse", cyberpunk: "japan" };
  if (choice && choice in CITY_THEMES) return choice as CityThemeId;
  return choice ? aliases[choice] ?? "egypt" : "egypt";
}

const mat = (color: ColorRepresentation, roughness = 0.88, extra: Partial<MeshStandardMaterialParameters> = {}) =>
  new MeshStandardMaterial({ color, roughness, ...extra });

export class ChatCity {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-24, 24, 24, -24, 0.1, 200);
  readonly renderer: WebGLRenderer;
  private root = new Group();
  private tiles: Tile[] = [];
  private tileByCoord = new Map<string, Tile>();
  private particles: Particle[] = [];
  /** Every spark, ember and dust mote is one instance of a single cube mesh: one draw call total. */
  private particleMesh = (() => {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }), MAX_PARTICLES);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.setColorAt(0, new Color(1, 1, 1));
    return mesh;
  })();
  private particleDummy = new Object3D();
  /** All ground tiles are instances of one slab: a single draw call however big the plot grows. */
  private ground = (() => {
    const mesh = new InstancedMesh(new BoxGeometry(0.99, 0.12, 0.99), new MeshStandardMaterial({ roughness: 0.88 }), GRID * GRID);
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return mesh;
  })();
  private groundDirty = true;
  /** The shadow map is only redrawn when something that casts a shadow changes. */
  private shadowsDirty = true;
  private maxFps: number;
  private frameBudget = 0;

  private writeGround(tile: Tile) {
    const dummy = this.particleDummy;
    if (!tile.group.visible) dummy.scale.setScalar(0);
    else dummy.scale.set(1, tile.group.scale.y, 1);
    dummy.position.set(tile.group.position.x, tile.group.position.y - 0.06 * tile.group.scale.y, tile.group.position.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    this.ground.setMatrixAt(tile.index, dummy.matrix);
    this.groundDirty = true;
  }
  /**
   * Fires and lightning share a fixed pool of point lights. Adding or removing lights changes
   * three.js shader variants and recompiles every material, so the light count never changes.
   */
  private lightPool: PointLight[] = Array.from({ length: 4 }, () => {
    const light = new PointLight(0xffffff, 0, 3, 2);
    light.userData.free = true;
    return light;
  });

  private claimLight(color: number, distance: number, decay: number, at: Vector3) {
    const light = this.lightPool.find(candidate => candidate.userData.free);
    if (!light) return undefined;
    light.userData.free = false;
    light.color.setHex(color);
    light.distance = distance;
    light.decay = decay;
    light.position.copy(at);
    light.intensity = 0;
    return light;
  }

  private releaseLight(light?: PointLight) {
    if (!light) return;
    light.intensity = 0;
    light.userData.free = true;
  }
  private pathTiles = new Set<string>();
  private actorTiles = new Set<string>();
  /** Street tile key -> directions (DIRS index) where a front door opens onto it. */
  private doorLinks = new Map<string, Set<number>>();
  private streetLayer?: Group;
  private streetsDirty = true;
  private streetEra = -1;
  private streetCells = new Map<string, NetCell>();
  private life: CityLife;
  private homes: HomeKit;
  private specials: SpecialKit;
  /** Spinning sails, blinking beacons and chimney smoke, tied to the building they belong to. */
  private animated: Array<{ tile: Tile; building: Group; part: Animated }> = [];
  private buildsSinceSpecial = 0;
  private birdClock = 12;
  private actorClock = 0;
  private hearthTile?: Tile;
  private shake = 0;
  private pastures = 0;
  private effects: Array<(delta: number) => boolean> = [];
  /** World point of the latest build or attack, so the HUD can pop points out of it. */
  readonly focus = new Vector3();
  private campfire?: Group;
  private lastRedevelopedEra = 1;
  private activeRadius = 4.5;
  private totalBuildings = 0;
  private technologyEra = 0;
  private recoveryEra?: number;
  private plotBorder?: LineLoop;
  private island?: Group;
  private theme: typeof CITY_THEMES[CityThemeId];
  private themeId: CityThemeId;
  private previousFrame = performance.now();
  private destroyed = false;
  private resizeObserver?: ResizeObserver;
  private randomState = 1;
  private aspect = 1;
  private viewSpan = 18;
  private targetSpan = 18;
  private transparent: boolean;
  private zoom: number;
  private pixelSize: number;
  private composer?: EffectComposer;
  private cameraBase = new Vector3(35, 43, 35);
  /** Camera orbit in quarter turns; the view swings smoothly to each 90 degree step. */
  private viewAngle = 0;
  private targetViewAngle = 0;
  private viewQuarter = 0;

  constructor(private host: HTMLElement, themeId: CityThemeId = themeFromSearch(), options: CityOptions = {}) {
    this.themeId = themeId;
    this.theme = CITY_THEMES[themeId];
    this.transparent = Boolean(options.transparent);
    this.zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    this.maxFps = options.maxFps ?? 60;
    this.randomState = [...themeId].reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    this.homes = new HomeKit(() => this.random(), this.theme, themeId);
    this.specials = new SpecialKit(() => this.random(), this.theme, themeId);
    this.life = new CityLife(this.root, {
      random: () => this.random(),
      cellAt: (x, z) => {
        const tx = Math.floor(x + GRID / 2), tz = Math.floor(z + GRID / 2);
        const cell = this.streetCells.get(this.key(tx, tz));
        return { cell, localX: x - (tx - GRID / 2 + 0.5), localZ: z - (tz - GRID / 2 + 0.5) };
      },
      cityRadius: () => this.activeRadius
    }, this.theme, themeId);
    if (options.transparent) this.life.limits = { people: 30, cars: 14 };
    // Isometric pixel art to match the HUD: render at low resolution, outline edges, upscale crisp.
    this.pixelSize = Math.max(1, Math.min(8, options.pixelSize ?? 1.5));
    const pixelArt = this.pixelSize > 1;
    // Work in device pixels so retina screens keep detail and every art pixel is a whole number wide.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const devicePixelSize = Math.max(2, Math.round(this.pixelSize * dpr));
    this.renderer = new WebGLRenderer({ antialias: !pixelArt, alpha: true, premultipliedAlpha: true });
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = pixelArt ? BasicShadowMap : PCFShadowMap; // hard-edged pixel shadows
    if (pixelArt) {
      this.composer = new EffectComposer(this.renderer);
      const pixelPass = new RenderPixelatedPass(devicePixelSize, this.scene, this.camera, { normalEdgeStrength: 0.35, depthEdgeStrength: 0.55 });
      // Outlines darken colour only, so silhouettes stay opaque over a transparent overlay.
      const fsQuad = (pixelPass as unknown as { _fsQuad: { material: ShaderMaterial } })._fsQuad;
      fsQuad.material.fragmentShader = fsQuad.material.fragmentShader.replace("gl_FragColor = texel * Strength;", "gl_FragColor = vec4(texel.rgb * Strength, texel.a);");
      fsQuad.material.needsUpdate = true;
      this.composer.addPass(pixelPass);
      this.composer.addPass(new OutputPass());
    }
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.domElement.className = "city-canvas";
    host.appendChild(this.renderer.domElement);

    if (this.transparent) {
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = new Color(this.theme.sky);
      this.scene.fog = new Fog(this.theme.sky, 48, 100);
    }
    this.scene.add(this.root);
    this.scene.add(this.particleMesh);
    for (const light of this.lightPool) this.root.add(light);
    this.addLighting();
    this.makeGround();
    this.root.add(this.ground);
    this.makeTiles();
    this.setActiveRadius(this.activeRadius);
    this.seedFoundingCamp();
    this.frameCamera();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.host);
    this.renderer.setAnimationLoop(this.animate);
  }

  private addLighting() {
    this.scene.add(new HemisphereLight(0xc8e0e4, 0x30453a, 2.65));
    const moon = new DirectionalLight(0xc4def0, 3.1);
    moon.position.set(-18, 32, 13);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -26; moon.shadow.camera.right = 26;
    moon.shadow.camera.top = 26; moon.shadow.camera.bottom = -26;
    moon.shadow.bias = -0.00025;
    this.scene.add(moon);
    const warm = new DirectionalLight(0xffba78, 0.7);
    warm.position.set(20, 13, -24);
    this.scene.add(warm);
  }

  private makeGround() {
    if (this.transparent) return; // the overlay floats the plot over the stream as an island
    const ground = new Mesh(new PlaneGeometry(46, 46), mat(this.theme.grass[0]));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.11;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private makeTiles() {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const road = false;
        const group = new Group();
        group.position.set(x - GRID / 2 + 0.5, 0, z - GRID / 2 + 0.5);
        group.visible = false;
        const colorSet = this.theme.grass;
        const terrainHash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
        const tileColor = colorSet[Math.floor((terrainHash % 1) * colorSet.length)];
        this.ground.setColorAt(this.tiles.length, new Color(tileColor));
        this.root.add(group);
        const tile: Tile = { x, z, kind: "empty", road, group, trees: [], index: this.tiles.length };
        this.tiles.push(tile);
        this.tileByCoord.set(this.key(x, z), tile);
      }
    }

    // A few planted courtyards break up the blocks and make the grid feel lived in.
    for (const tile of this.tiles) {
      if (!tile.road && ((tile.x * 11 + tile.z * 17) % 53 === 0)) {
        this.addTree(tile, -0.23, -0.18, 0.72);
        this.addTree(tile, 0.2, 0.16, 0.55);
      }
    }
  }

  private addTree(tile: Tile, x: number, z: number, scale: number) {
    const tree = new Group();
    tree.position.set(x, 0.02, z);
    tree.scale.setScalar(scale);
    const trunk = new Mesh(new CylinderGeometry(0.055, 0.08, 0.42, 5), mat(0x78553d));
    trunk.position.y = 0.21;
    trunk.castShadow = true;
    tree.add(trunk);
    const greens = this.theme.foliage;
    for (let i = 0; i < 3; i++) {
      const crown = new Mesh(new IcosahedronGeometry(0.24 - i * 0.025, 1), mat(greens[(tile.x + tile.z + i) % greens.length], 1));
      crown.position.set((i - 1) * 0.08, 0.46 + i * 0.15, ((i % 2) - 0.5) * 0.08);
      crown.castShadow = true;
      tree.add(crown);
    }
    bakeStatic(tree, 2);
    tile.group.add(tree);
    tile.trees.push(tree);
    this.shadowsDirty = true;
  }

  private frameCamera() {
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 0, 0);
    this.camera.zoom = 1.18 * this.zoom;
    this.camera.updateProjectionMatrix();
  }

  private resize = () => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.updateCameraFrustum();
  };

  private updateCameraFrustum() {
    this.camera.left = -this.viewSpan * this.aspect / 2;
    this.camera.right = this.viewSpan * this.aspect / 2;
    this.camera.top = this.viewSpan / 2;
    this.camera.bottom = -this.viewSpan / 2;
    this.camera.updateProjectionMatrix();
  }

  private get eraIndex(): number { return this.recoveryEra ?? this.technologyEra; }

  get stage(): string {
    const era = ["CAMPFIRE SETTLEMENT", "HUTS & GATHERING", "SETTLED HOMES", "STONE CITY", "INDUSTRIAL CITY", "AGE OF AIRSHIPS", "EMPIRE"][this.eraIndex];
    return this.recoveryEra === undefined ? era : `RECOVERY · ${era}`;
  }

  get themeName(): string { return this.theme.label.toUpperCase(); }
  get selectedThemeId(): CityThemeId { return this.themeId; }

  get landArea(): number { return this.tiles.filter(tile => tile.group.visible).length; }

  setCommunityProgress(progress: CommunityProgress["recovery"]) {
    const wasRecovering = this.recoveryEra !== undefined;
    this.recoveryEra = progress.active ? Math.min(this.technologyEra, progress.era) : undefined;
    if (wasRecovering && this.recoveryEra === undefined && this.technologyEra >= 2) {
      this.lastRedevelopedEra = Math.min(this.lastRedevelopedEra, this.technologyEra - 1);
      this.tryRenewDistrict();
    }
  }

  private setActiveRadius(radius: number) {
    this.activeRadius = radius;
    this.targetSpan = 18 + Math.max(0, radius - 4.5) * 1.9;
    const center = (GRID - 1) / 2;
    for (const tile of this.tiles) {
      const shouldBeVisible = Math.abs(tile.x - center) <= radius && Math.abs(tile.z - center) <= radius;
      if (shouldBeVisible && !tile.group.visible) {
        tile.group.visible = true;
        tile.group.scale.y = 0.015;
        tile.group.position.y = -0.07;
        tile.revealing = true;
        tile.revealElapsed = 0;
      } else if (!shouldBeVisible) tile.group.visible = false;
      this.writeGround(tile);
    }
    this.shadowsDirty = true;
    if (this.plotBorder) {
      this.root.remove(this.plotBorder);
      this.plotBorder.geometry.dispose();
      (this.plotBorder.material as Material).dispose();
    }
    const edge = radius + 0.5;
    const points = [
      new Vector3(-edge, 0.035, -edge), new Vector3(edge, 0.035, -edge),
      new Vector3(edge, 0.035, edge), new Vector3(-edge, 0.035, edge)
    ];
    this.plotBorder = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0xb5b37a, transparent: true, opacity: 0.62 }));
    this.root.add(this.plotBorder);
    if (this.transparent) {
      // A chunky earth skirt so the plot reads as a floating island over the stream.
      if (this.island) { this.root.remove(this.island); disposeObject(this.island); }
      this.island = new Group();
      const size = edge * 2;
      const soil = new Mesh(new BoxGeometry(size, 0.5, size), mat(0x5e4632, 1));
      soil.position.y = -0.37;
      const rock = new Mesh(new BoxGeometry(size * 0.86, 0.5, size * 0.86), mat(0x4a3b30, 1));
      rock.position.y = -0.82;
      const tip = new Mesh(new BoxGeometry(size * 0.6, 0.45, size * 0.6), mat(0x3d3129, 1));
      tip.position.y = -1.25;
      this.island.add(soil, rock, tip);
      this.root.add(this.island);
    }
  }

  private seedFoundingCamp() {
    const tile = this.tileByCoord.get(this.key(15, 15));
    if (!tile) return;
    this.campfire = new Group();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const stone = new Mesh(new IcosahedronGeometry(0.09, 0), mat(i % 2 ? 0x756c55 : 0x928269));
      stone.scale.set(1.2, 0.68, 0.9);
      stone.position.set(Math.cos(angle) * 0.28, 0.015, Math.sin(angle) * 0.28);
      this.campfire.add(stone);
    }
    const log = new Mesh(new CylinderGeometry(0.05, 0.06, 0.46, 6), mat(0x493321, 1));
    log.rotation.z = Math.PI / 2; log.rotation.y = 0.5; log.position.y = 0.07; this.campfire.add(log);
    const crossingLog = log.clone(); crossingLog.rotation.y = -0.55; this.campfire.add(crossingLog);
    for (let i = 0; i < 4; i++) {
      const flame = new Mesh(new ConeGeometry(0.13 - i * 0.018, 0.35 + i * 0.055, 7), mat(i % 2 ? 0xff8d32 : 0xffd36b, 0.4, { emissive: 0xff5718, emissiveIntensity: 2.0 }));
      flame.position.set((this.random() - 0.5) * 0.12, 0.26 + i * 0.025, (this.random() - 0.5) * 0.12);
      flame.userData.firePhase = i * 1.2;
      this.campfire.add(flame);
    }
    for (const tree of tile.trees) tile.group.remove(tree);
    tile.trees = [];
    tile.group.add(this.campfire);
    tile.kind = "landmark";
    const hearthPath = this.tileByCoord.get(this.key(tile.x, tile.z + 1));
    if (hearthPath) {
      for (const tree of hearthPath.trees) hearthPath.group.remove(tree);
      hearthPath.trees = [];
      this.pathTiles.add(this.key(hearthPath.x, hearthPath.z));
      this.addDoor(hearthPath, 2);
    }
    this.hearthTile = tile;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const clearing = this.tileByCoord.get(this.key(tile.x + dx, tile.z + dz));
      if (!clearing || clearing === tile || clearing === hearthPath) continue;
      this.actorTiles.add(this.key(clearing.x, clearing.z));
      for (const tree of clearing.trees) clearing.group.remove(tree);
      clearing.trees = [];
    }
    // The story starts with a single villager tending the fire; others arrive as huts go up.
    this.life.seedGathering(tile.group.position.clone(), 1);
  }

  private expandPlot() {
    if (this.activeRadius >= 15.5) return;
    this.setActiveRadius(Math.min(15.5, this.activeRadius + 2));
  }

  private accessNeighbors(tile: Tile) {
    return [
      { dx: 0, dz: 1, yaw: 0 },
      { dx: 1, dz: 0, yaw: Math.PI / 2 },
      { dx: 0, dz: -1, yaw: Math.PI },
      { dx: -1, dz: 0, yaw: -Math.PI / 2 }
    ].map(direction => ({ ...direction, tile: this.tileByCoord.get(this.key(tile.x + direction.dx, tile.z + direction.dz)) }));
  }

  private findRouteToPath(start: Tile, blocked?: Tile): Tile[] | undefined {
    const startKey = this.key(start.x, start.z);
    const queue = [start];
    const previous = new Map<string, string | undefined>([[startKey, undefined]]);
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const currentKey = this.key(current.x, current.z);
      if (this.pathTiles.has(currentKey)) {
        const route: Tile[] = [];
        let key: string | undefined = currentKey;
        while (key !== undefined) {
          const cell = this.tileByCoord.get(key);
          if (cell) route.push(cell);
          key = previous.get(key);
        }
        return route.reverse();
      }
      for (const [dx, dz] of directions) {
        const next = this.tileByCoord.get(this.key(current.x + dx, current.z + dz));
        if (!next || next === blocked || !next.group.visible || next.building) continue;
        if (this.actorTiles.has(this.key(next.x, next.z))) continue;
        if (!this.isStreet(next) && !this.pathTiles.has(this.key(next.x, next.z))) continue;
        if (next.kind !== "empty" && !this.pathTiles.has(this.key(next.x, next.z))) continue;
        const nextKey = this.key(next.x, next.z);
        if (previous.has(nextKey)) continue;
        previous.set(nextKey, currentKey);
        queue.push(next);
      }
    }
    return undefined;
  }

  private findAccessPlan(tile: Tile): AccessPlan | undefined {
    let best: AccessPlan | undefined;
    for (const direction of this.accessNeighbors(tile)) {
      const access = direction.tile;
      if (!access || !access.group.visible || access.building || this.actorTiles.has(this.key(access.x, access.z))) continue;
      const accessKey = this.key(access.x, access.z);
      if (access.kind !== "empty" && !this.pathTiles.has(accessKey)) continue;
      if (!this.isStreet(access) && !this.pathTiles.has(accessKey)) continue;
      const route = this.findRouteToPath(access, tile);
      // Prefer fronting a street that already exists, then the shortest extension.
      if (route && (!best || route.length < best.route.length)) best = { dx: direction.dx, dz: direction.dz, yaw: direction.yaw, route };
    }
    return best;
  }

  private connectNewBuilding(tile: Tile, building: Group): boolean {
    const access = this.findAccessPlan(tile);
    if (!access) return false;
    building.rotation.y = access.yaw;
    for (const step of access.route) {
      for (const tree of step.trees) step.group.remove(tree);
      step.trees = [];
      this.pathTiles.add(this.key(step.x, step.z));
    }
    // The door opens from the street tile back toward the building.
    const doorDir = DIRS.findIndex(([dx, dz]) => dx === -access.dx && dz === -access.dz);
    this.addDoor(access.route[0], doorDir);
    this.streetsDirty = true;
    return true;
  }

  private addDoor(street: Tile, dir: number) {
    const key = this.key(street.x, street.z);
    const set = this.doorLinks.get(key) ?? new Set<number>();
    set.add(dir);
    this.doorLinks.set(key, set);
    this.streetsDirty = true;
  }

  /** Rebuild street meshes and the traffic graph from the current path tiles. */
  private rebuildStreets() {
    this.streetsDirty = false;
    this.shadowsDirty = true;
    this.streetEra = this.technologyEra;
    const cells = new Map<string, NetCell>();
    const doors: Door[] = [];
    for (const key of this.pathTiles) {
      const tile = this.tileByCoord.get(key);
      if (!tile || !tile.group.visible) continue;
      const links = DIRS.map(([dx, dz]) => {
        const neighbor = this.tileByCoord.get(this.key(tile.x + dx, tile.z + dz));
        return Boolean(neighbor && neighbor.group.visible && this.pathTiles.has(this.key(neighbor.x, neighbor.z)));
      });
      const doorSet = this.doorLinks.get(key);
      const doorFlags = DIRS.map(([dx, dz], d) => {
        if (!doorSet?.has(d)) return false;
        const neighbor = this.tileByCoord.get(this.key(tile.x + dx, tile.z + dz));
        return Boolean(neighbor && (neighbor.building || neighbor === this.hearthTile));
      });
      const px = tile.group.position.x, pz = tile.group.position.z;
      cells.set(key, { key, x: tile.x, z: tile.z, px, pz, links, doors: doorFlags, hash: Math.abs(Math.imul(tile.x * 73856093 ^ tile.z * 19349663, 2654435761)) >>> 3 });
      doorFlags.forEach((open, d) => {
        if (!open) return;
        const neighbor = this.tileByCoord.get(this.key(tile.x + DIRS[d][0], tile.z + DIRS[d][1]));
        if (!neighbor?.building || neighbor.kind === "fire") return;
        doors.push({ key, dir: d, point: new Vector3(px + DIRS[d][0] * 0.46, 0, pz + DIRS[d][1] * 0.46) });
      });
    }
    this.streetCells = cells;
    if (this.streetLayer) { this.root.remove(this.streetLayer); disposeObject(this.streetLayer); }
    this.streetLayer = buildStreetLayer([...cells.values()], this.technologyEra, this.theme);
    this.root.add(this.streetLayer);
    const houses = this.tiles.filter(tile => tile.building && tile.kind === "house").length;
    this.life.setNetwork(cells, doors, houses);
  }

  private unlockTechnology(era: number) {
    const previousEra = this.technologyEra;
    this.technologyEra = Math.max(this.technologyEra, Math.min(6, era));
    this.streetsDirty = true;
    this.life.setEra(this.technologyEra);
    if (this.technologyEra > previousEra && this.technologyEra >= 1) this.expandPlot();
    if (this.technologyEra > previousEra && this.technologyEra >= 2) this.tryRenewDistrict();
    if (this.technologyEra === 1 && previousEra < 1) {
      const firstHome = this.tiles.find(tile => tile.building && tile.kind === "house");
      if (firstHome) { this.addAnimal(firstHome); this.addAnimal(firstHome); }
    }
  }

  private addAnimal(tile: Tile) {
    if (this.pastures >= 5) return;
    const pasture = this.tiles
      .filter(cell => cell.group.visible && this.isInterior(cell) && cell.kind === "empty" && !cell.building && !this.actorTiles.has(this.key(cell.x, cell.z)))
      .sort((a, b) => (Math.abs(a.x - tile.x) + Math.abs(a.z - tile.z)) - (Math.abs(b.x - tile.x) + Math.abs(b.z - tile.z)))[0];
    if (!pasture) return;
    for (const tree of pasture.trees) pasture.group.remove(tree);
    pasture.trees = [];
    this.actorTiles.add(this.key(pasture.x, pasture.z));
    // A little paddock fence so the flock has a home.
    const paddock = new Group();
    const fence = mat(0x8a6d4e, 1);
    for (const [dx, dz, w, d] of [[0, 0.45, 0.94, 0.03], [0, -0.45, 0.94, 0.03], [0.45, 0, 0.03, 0.94], [-0.45, 0, 0.03, 0.94]] as const) {
      const rail = new Mesh(new BoxGeometry(w, 0.03, d), fence);
      rail.position.set(dx, 0.09, dz);
      paddock.add(rail);
    }
    for (const sx of [-0.45, 0, 0.45]) for (const sz of [-0.45, 0.45]) {
      const post = new Mesh(new BoxGeometry(0.035, 0.13, 0.035), fence);
      post.position.set(sx, 0.065, sz); paddock.add(post);
      const side = post.clone(); side.position.set(sz, 0.065, sx); paddock.add(side);
    }
    bakeStatic(paddock, 2);
    pasture.group.add(paddock);
    this.shadowsDirty = true;
    this.pastures++;
    const center = pasture.group.position.clone();
    this.life.addSheep(center);
    this.life.addSheep(center);
  }

  private tryRenewDistrict() {
    const era = this.technologyEra;
    if (era < 2 || this.recoveryEra !== undefined || era <= this.lastRedevelopedEra) return;
    const homes = this.tiles.filter(tile => tile.building && tile.kind === "house");
    for (const center of homes) {
      const cluster = homes
        .filter(tile => Math.abs(tile.x - center.x) + Math.abs(tile.z - center.z) <= 2)
        .sort((a, b) => (a === center ? -1 : b === center ? 1 : 0))
        .slice(0, 3);
      if (cluster.length < 3 || !this.findAccessPlan(center)) continue;
      for (const tile of cluster) {
        if (tile.building) {
          tile.group.remove(tile.building);
          disposeObject(tile.building);
          tile.building = undefined;
          tile.kind = "empty";
          this.totalBuildings = Math.max(0, this.totalBuildings - 1);
        }
      }
      const renewed = era >= 4 ? this.makeSkyscraper(center) : this.makeLandmark(center);
      if (!renewed) continue;
      this.totalBuildings++;
      this.lastRedevelopedEra = era;
      return;
    }
  }

  private key(x: number, z: number) { return `${x},${z}`; }
  private random() {
    let value = this.randomState += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
  private color(colors: readonly number[]) { return colors[Math.floor(this.random() * colors.length)]; }
  private box(parent: Group, width: number, height: number, depth: number, color: number, x: number, y: number, z: number, material?: MeshStandardMaterial) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material ?? mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addWindows(parent: Group, width: number, depth: number, height: number, floors: number, cols = 2) {
    const frame = mat(0x27383d, 0.45, { metalness: 0.15 });
    for (let floor = 0; floor < floors; floor++) {
      const y = 0.22 + floor * (height / Math.max(1, floors));
      for (let col = 0; col < cols; col++) {
        const x = (col - (cols - 1) / 2) * Math.min(0.24, width / (cols + 1));
        const lit = this.random() > 0.24;
        const glass = mat(lit ? this.color(this.theme.window) : 0x344a50, 0.28, {
          emissive: lit ? this.color(this.theme.window) : 0x101a1e,
          emissiveIntensity: lit ? 0.62 : 0.05,
          metalness: 0.08
        });
        const window = new Mesh(new BoxGeometry(0.12, 0.15, 0.025), glass);
        window.position.set(x, y, depth / 2 + 0.014);
        parent.add(window);
        const sideWindow = new Mesh(new BoxGeometry(0.025, 0.15, 0.12), glass);
        sideWindow.position.set(width / 2 + 0.014, y, (col - (cols - 1) / 2) * Math.min(0.24, depth / (cols + 1)));
        parent.add(sideWindow);
        // Fine dark frames make the lit windows read as part of a facade.
        const sill = new Mesh(new BoxGeometry(0.14, 0.025, 0.035), frame);
        sill.position.set(x, y - 0.09, depth / 2 + 0.018);
        parent.add(sill);
      }
    }
  }

  private updateCampfire(delta: number) {
    this.actorClock += delta;
    this.campfire?.children.forEach(child => {
      if (!(child instanceof Mesh) || child.userData.firePhase === undefined) return;
      const phase = (child.userData.firePhase as number) + this.actorClock * 5;
      child.scale.set(0.9 + Math.sin(phase) * 0.15, 0.82 + Math.sin(phase * 1.3) * 0.28, 0.9 + Math.cos(phase) * 0.15);
    });
  }

  private makeHouse(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const era = this.eraIndex;
    if (era >= 2 && this.random() < 0.8) {
      this.homes.build(building, era);
      if (!this.connectNewBuilding(tile, building)) return false;
      tile.group.add(building);
      tile.building = building;
      tile.kind = "house";
      this.animateBuild(building, tile, immediate);
      return true;
    }
    if (era <= 1) {
      this.makeAncientHut(building, this.totalBuildings > 0 && this.totalBuildings % 5 === 0);
      if (!this.connectNewBuilding(tile, building)) return false;
      tile.group.add(building);
      tile.building = building;
      tile.kind = "house";
      this.animateBuild(building, tile, immediate);
      return true;
    }
    const width = 0.72 + this.random() * 0.2;
    const depth = 0.72 + this.random() * 0.2;
    const variant = Math.floor(this.random() * 4);
    const floors = era === 2 ? (variant === 3 ? 4 : 2)
      : era === 3 ? (variant === 3 ? 6 : 3)
      : era === 4 ? (variant === 3 ? 7 : variant === 2 ? 5 : 3)
      : Math.floor(4 + this.random() * 5);
    const floorHeight = era < 4 ? 0.6 : 0.68;
    const height = 0.28 + floors * floorHeight;
    const wall = mat(this.color(this.theme.house), era >= 4 ? 0.45 : 0.82, era >= 4 ? { metalness: 0.18 } : {});
    this.box(building, width + 0.12, 0.13, depth + 0.12, this.theme.stone, 0, 0.14, 0);
    this.box(building, width, height, depth, 0, 0, height / 2 + 0.16, 0, wall);

    // Small attached wings, balconies, porches, and roof rooms break up the repeated box silhouette.
    if (variant === 0) {
      const porchDepth = 0.2;
      this.box(building, width * 0.76, 0.075, porchDepth, this.theme.stone, 0, 0.19, depth / 2 + porchDepth / 2 - 0.015);
      for (const x of [-width * 0.29, width * 0.29]) {
        this.box(building, 0.045, 0.5, 0.045, this.theme.accent, x, 0.46, depth / 2 + porchDepth * 0.72, mat(this.theme.stone, 0.8));
      }
      const canopy = this.box(building, width * 0.9, 0.075, porchDepth * 1.16, this.theme.roof[0], 0, 0.75, depth / 2 + porchDepth * 0.58);
      canopy.rotation.x = this.themeId === "japan" ? -0.06 : 0;
    } else if (variant === 1) {
      const wingWidth = width * 0.34;
      const wingHeight = height * 0.7;
      const wing = this.box(building, wingWidth, wingHeight, depth * 0.72, this.color(this.theme.house), -width * 0.57, wingHeight / 2 + 0.16, -depth * 0.04, mat(this.color(this.theme.house), 0.86));
      wing.castShadow = true;
      this.box(building, wingWidth + 0.06, 0.08, depth * 0.78, this.theme.roof[0], -width * 0.57, wingHeight + 0.2, -depth * 0.04);
      this.box(building, 0.13, 0.31, 0.035, 0, -width * 0.57, 0.33, depth * 0.33, mat(0x624737, 0.95));
    } else if (variant === 2 && floors > 2) {
      const balconyY = floorHeight + 0.2;
      this.box(building, width * 0.82, 0.07, 0.19, this.theme.stone, 0, balconyY, depth / 2 + 0.075);
      for (const x of [-width * 0.36, -width * 0.12, width * 0.12, width * 0.36]) {
        this.box(building, 0.035, 0.22, 0.035, this.theme.accent, x, balconyY + 0.14, depth / 2 + 0.15, mat(this.theme.stone, 0.78));
      }
      this.box(building, width * 0.86, 0.045, 0.045, this.theme.stone, 0, balconyY + 0.26, depth / 2 + 0.15);
    } else if (variant === 3) {
      const roofRoom = this.box(building, width * 0.48, 0.38, depth * 0.5, this.theme.roof[1], width * 0.18, height + 0.37, -depth * 0.12, mat(this.color(this.theme.house), 0.8));
      roofRoom.castShadow = true;
      this.box(building, width * 0.58, 0.1, depth * 0.62, this.theme.roof[0], width * 0.18, height + 0.61, -depth * 0.12);
    }
    const windowRows = Math.max(1, floors - (era < 3 ? 0 : 1));
    this.addWindows(building, width, depth, height, windowRows, era >= 3 ? 3 : 2);
    this.box(building, 0.19, 0.38, 0.045, 0x624737, 0, 0.35, depth / 2 + 0.026);

    if (era < 4 && variant !== 1) {
      const roofColor = this.color(this.theme.roof);
      if (variant === 0) {
        const pitch = this.themeId === "norse" ? 0.68 : this.themeId === "japan" ? 0.38 : 0.52;
        for (const side of [-1, 1]) {
          const slope = this.box(building, width * 0.76, 0.11, depth * (this.themeId === "japan" ? 1.22 : 1.04), roofColor, side * width * 0.2, height + 0.35, 0);
          slope.rotation.z = side * pitch;
        }
        this.box(building, 0.08, 0.1, depth * 1.06, roofColor, 0, height + 0.65, 0);
      } else if (variant === 2) {
        const roofHeight = 0.5;
        const roof = new Mesh(new ConeGeometry(Math.max(width, depth) * 0.76, roofHeight, this.themeId === "japan" ? 5 : 4), mat(roofColor));
        roof.rotation.y = Math.PI / 4;
        roof.position.y = height + 0.16 + roofHeight / 2;
        roof.castShadow = true;
        building.add(roof);
      } else {
        const parapet = mat(this.theme.stone, 0.82);
        for (const [x, z, w, d] of [[0, depth / 2, width + 0.05, 0.08], [0, -depth / 2, width + 0.05, 0.08], [width / 2, 0, 0.08, depth], [-width / 2, 0, 0.08, depth]] as const) {
          this.box(building, w, 0.18, d, this.theme.stone, x, height + 0.24, z, parapet);
        }
        if (this.themeId === "egypt") {
          for (const x of [-width * 0.38, 0, width * 0.38]) this.box(building, 0.09, 0.12, 0.09, this.theme.accent, x, height + 0.39, depth / 2, mat(this.theme.accent, 0.7));
        }
      }
    } else {
      const capColor = this.themeId === "japan" ? 0x45434a : this.themeId === "egypt" ? 0xa88b5d : 0x384a4b;
      this.box(building, width + 0.08, 0.1, depth + 0.08, capColor, 0, height + 0.22, 0);
      if (floors >= 4) {
        for (let floor = 1; floor < floors; floor++) {
          const y = 0.16 + floor * floorHeight;
          this.box(building, width * 0.82, 0.045, 0.13, this.theme.stone, 0, y, depth / 2 + 0.08);
          this.box(building, width * 0.82, 0.035, 0.035, 0x303d41, 0, y + 0.08, depth / 2 + 0.14);
        }
      }
      if (variant === 1 || variant === 3) {
        const rooftop = new Mesh(new CylinderGeometry(0.12, 0.18, 0.2, 8), mat(this.color(this.theme.roof)));
        rooftop.position.y = height + 0.32;
        building.add(rooftop);
      }
    }
    this.addThemeDetails(building, width, height, depth, era);
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "house";
    this.animateBuild(building, tile, immediate);
    return true;
  }

  private makeAncientHut(building: Group, includeHearth = false) {
    this.homes.yardClutter(building);
    if (!includeHearth && this.random() < (this.eraIndex === 0 ? 0.4 : 0.25)) {
      this.homes.primitive(building);
      return;
    }
    const hutStyle = Math.floor(this.random() * 4);
    const woodColor = this.themeId === "norse" ? 0x493525 : this.themeId === "japan" ? 0x573c30 : 0x745133;
    const wood = mat(woodColor, 1);
    const wallColor = this.color(this.theme.house);
    const roofColor = this.color(this.theme.roof);

    if (this.themeId === "norse") {
      this.box(building, 1.02, 0.12, 0.96, this.theme.stone, 0, 0.12, 0);
      this.box(building, 0.86, 0.58, 0.74, 0, 0, 0.47, 0, mat(wallColor, 1));
      for (const x of [-0.43, 0.43]) this.box(building, 0.08, 0.92, 0.08, 0, x, 0.58, 0, wood);
      const leftRoof = this.box(building, 0.62, 0.12, 1.0, 0, -0.24, 0.91, 0, mat(roofColor, 1));
      leftRoof.rotation.z = -0.61;
      const rightRoof = this.box(building, 0.62, 0.12, 1.0, 0, 0.24, 0.91, 0, mat(roofColor, 1));
      rightRoof.rotation.z = 0.61;
      this.box(building, 0.12, 0.12, 1.05, 0, 0, 1.22, 0, wood);
      this.box(building, 0.2, 0.4, 0.06, 0, 0, 0.34, 0.4, wood);
    } else if (this.themeId === "japan") {
      this.box(building, 0.94, 0.1, 0.9, 0x704f3a, 0, 0.18, 0, wood);
      this.box(building, 0.78, 0.52, 0.66, 0, 0, 0.51, 0, mat(wallColor, 0.92));
      for (const x of [-0.36, 0.36]) for (const z of [-0.3, 0.3]) this.box(building, 0.055, 0.82, 0.055, 0, x, 0.55, z, wood);
      const leftRoof = this.box(building, 0.62, 0.1, 0.96, 0, -0.25, 0.89, 0, mat(roofColor, 0.82));
      leftRoof.rotation.z = -0.48;
      const rightRoof = this.box(building, 0.62, 0.1, 0.96, 0, 0.25, 0.89, 0, mat(roofColor, 0.82));
      rightRoof.rotation.z = 0.48;
      this.box(building, 0.2, 0.42, 0.055, 0, 0, 0.36, 0.35, wood);
      for (const x of [-0.38, 0.38]) this.box(building, 0.12, 0.045, 0.12, 0, x, 0.92, 0.38, mat(this.theme.accent, 0.65));
    } else if (this.themeId === "rome") {
      this.box(building, 0.96, 0.12, 0.9, this.theme.stone, 0, 0.12, 0);
      this.box(building, 0.78, 0.56, 0.68, 0, 0, 0.48, 0, mat(wallColor, 1));
      for (const x of [-0.38, 0.38]) this.box(building, 0.07, 0.82, 0.07, 0, x, 0.57, 0, wood);
      const roof = new Mesh(new ConeGeometry(0.68, 0.58, 4), mat(roofColor, 1));
      roof.rotation.y = Math.PI / 4; roof.position.y = 1.0; building.add(roof);
      this.box(building, 0.2, 0.4, 0.055, 0, 0, 0.33, 0.36, wood);
    } else {
      const plaster = mat(wallColor, 1);
      this.box(building, 1.02, 0.11, 0.98, this.theme.stone, 0, 0.11, 0);
      const walls = new Mesh(new CylinderGeometry(0.42, 0.49, 0.68, 9, 1), plaster);
      walls.position.y = 0.48; walls.castShadow = true; walls.receiveShadow = true; building.add(walls);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        this.box(building, 0.075, 0.82, 0.075, 0, Math.cos(angle) * 0.45, 0.53, Math.sin(angle) * 0.45, wood);
      }
      const ringBeam = new Mesh(new CylinderGeometry(0.5, 0.5, 0.075, 9), wood);
      ringBeam.position.y = 0.88; building.add(ringBeam);
      const roof = new Mesh(new ConeGeometry(0.72, 0.78, 9), mat(roofColor, 1));
      roof.position.y = 1.18; roof.castShadow = true; building.add(roof);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const rib = new Mesh(new CylinderGeometry(0.018, 0.026, 0.73, 4), mat(this.color(this.theme.roof), 1));
        rib.position.set(Math.cos(angle) * 0.36, 1.22, Math.sin(angle) * 0.36);
        rib.rotation.z = -Math.cos(angle) * 0.42; rib.rotation.x = Math.sin(angle) * 0.42; building.add(rib);
      }
      const door = this.box(building, 0.21, 0.42, 0.055, 0, 0, 0.35, 0.47, wood);
      door.rotation.y = 0.08;
    }

    if (hutStyle === 1) {
      const storehouse = this.box(building, 0.34, 0.42, 0.38, 0, -0.38, 0.39, -0.3, mat(wallColor, 1));
      storehouse.castShadow = true;
      this.box(building, 0.4, 0.1, 0.46, 0, -0.38, 0.67, -0.3, mat(roofColor, 1));
      this.box(building, 0.055, 0.56, 0.055, 0, -0.52, 0.39, -0.3, wood);
    } else if (hutStyle === 2) {
      this.box(building, 0.68, 0.08, 0.24, this.theme.stone, 0.03, 0.16, 0.56);
      for (const x of [-0.23, 0.29]) this.box(building, 0.045, 0.4, 0.045, 0, x, 0.39, 0.63, wood);
      this.box(building, 0.74, 0.075, 0.28, 0, 0.03, 0.62, 0.58, mat(roofColor, 0.96));
    } else if (hutStyle === 3) {
      const chimney = new Mesh(new CylinderGeometry(0.07, 0.09, 0.42, 6), mat(this.theme.stone, 0.96));
      chimney.position.set(-0.26, 1.16, -0.1);
      building.add(chimney);
      this.box(building, 0.24, 0.07, 0.3, 0, 0.4, 0.25, -0.22, mat(0x8a744f, 1));
    }

    if (includeHearth) this.addCookingHearth(building, wood);
  }

  private addCookingHearth(parent: Group, wood = mat(0x493321, 1)) {
    const hearth = new Group();
    hearth.position.set(0.49, 0.1, 0.53);
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      const stone = new Mesh(new IcosahedronGeometry(0.075, 0), mat(i % 2 ? 0x786f58 : 0x938366));
      stone.scale.set(1.2, 0.7, 0.9); stone.position.set(Math.cos(angle) * 0.22, 0, Math.sin(angle) * 0.22); hearth.add(stone);
    }
    const logA = new Mesh(new CylinderGeometry(0.035, 0.045, 0.34, 6), wood);
    logA.rotation.z = Math.PI / 2; logA.rotation.y = 0.4; hearth.add(logA);
    const logB = logA.clone(); logB.rotation.y = -0.5; hearth.add(logB);
    for (let i = 0; i < 3; i++) {
      const flame = new Mesh(new ConeGeometry(0.075 - i * 0.012, 0.25 + i * 0.08, 6), mat(i === 1 ? 0xffa43d : 0xffd26b, 0.45, { emissive: i === 1 ? 0xff4e14 : 0xf28a23, emissiveIntensity: 1.8 }));
      flame.position.set((i - 1) * 0.055, 0.17 + i * 0.035, (i % 2) * 0.045); flame.userData.hearthPhase = i * 1.7; hearth.add(flame);
    }
    hearth.userData.keep = true;
    parent.add(hearth);
    parent.userData.hearth = hearth;
  }

  private makeLandmark(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const era = this.eraIndex;
    const stone = mat(this.theme.stone, 0.65);
    if (era <= 1) {
      // The village keeps its shared timber-and-thatch lodge until stonework is unlocked.
      const lodge = new Group();
      this.makeAncientHut(lodge);
      lodge.scale.setScalar(1.4);
      building.add(lodge);
    } else if (era === 2 || era === 3) {
      this.makeThemeLandmark(building, era, stone);
    } else {
      const style = Math.floor(this.random() * 3);
      if (style === 0) {
        const baseH = 0.65;
        this.box(building, 0.94, baseH, 0.94, 0, 0, baseH / 2 + 0.08, 0, stone);
        this.addWindows(building, 0.94, 0.94, baseH, 2, 3);
        this.box(building, 0.58, 3.05, 0.58, 0, 0, 0.08 + baseH + 1.525, 0, mat(0x829a9f, 0.4, { metalness: 0.2 }));
        this.addWindows(building, 0.58, 0.58, 3.05, 9, 2);
        this.box(building, 0.74, 0.12, 0.74, 0x6a7d7d, 0, 0.08 + baseH + 3.05, 0);
        const spire = new Mesh(new ConeGeometry(0.16, 0.9, 8), mat(this.theme.accent, 0.38, { metalness: 0.4 }));
        spire.position.y = 0.08 + baseH + 3.05 + 0.5; spire.castShadow = true; building.add(spire);
      } else if (style === 1) {
        this.box(building, 0.96, 0.72, 0.96, 0, 0, 0.44, 0, stone);
        this.addWindows(building, 0.96, 0.96, 0.72, 2, 3);
        const dome = new Mesh(new SphereGeometry(0.39, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(this.theme.accent, 0.45, { metalness: 0.25 }));
        dome.position.y = 0.84; dome.castShadow = true; building.add(dome);
        const cap = new Mesh(new ConeGeometry(0.07, 0.35, 8), mat(0xd6b270, 0.42, { metalness: 0.3 }));
        cap.position.y = 1.25; building.add(cap);
      } else {
        const towerH = 4.1;
        this.box(building, 0.64, towerH, 0.64, 0, 0, towerH / 2 + 0.08, 0, mat(0x9da6ac, 0.42, { metalness: 0.22 }));
        this.addWindows(building, 0.64, 0.64, towerH, 12, 2);
        this.box(building, 0.8, 0.12, 0.8, 0x78878a, 0, towerH + 0.14, 0);
        const antenna = new Mesh(new CylinderGeometry(0.025, 0.06, 0.9, 6), mat(this.theme.accent, 0.45, { metalness: 0.35 }));
        antenna.position.y = towerH + 0.63; building.add(antenna);
        const beacon = new Mesh(new SphereGeometry(0.065, 8, 6), mat(this.theme.glow, 0.2, { emissive: this.theme.glow, emissiveIntensity: 1.4 }));
        beacon.position.y = towerH + 1.08; building.add(beacon);
      }
    }
    if (era > 1) {
      this.box(building, 0.2, 0.4, 0.055, 0, 0, 0.23, 0.48, mat(0x513925, 1));
    }
    if (era > 1) {
      // Fit the trim to the landmark's real height so nothing floats above short buildings.
      const top = new Box3().setFromObject(building).max.y;
      this.addThemeDetails(building, 0.75, Math.max(0.4, top - 0.24), 0.75, era);
    }
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
    return true;
  }

  private makeSpecial(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const parts = this.specials.build(building, this.eraIndex);
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    building.userData.special = true;
    for (const part of parts) this.animated.push({ tile, building, part });
    this.animateBuild(building, tile, immediate);
    return true;
  }

  private updateAnimated(delta: number) {
    const clock = this.actorClock;
    this.animated = this.animated.filter(entry => entry.tile.building === entry.building);
    for (const { building, part } of this.animated) {
      if (part.kind === "spin") part.object.rotation[part.axis] += part.speed * delta;
      else if (part.kind === "blink") part.object.visible = ((clock / part.period + part.offset) % 1) < 0.55;
      else if (part.kind === "sway") part.object.rotation.z = Math.sin(clock * part.speed + part.amount * 10) * part.amount;
      else if (this.random() < part.rate * delta && this.particles.length < 520) {
        const at = building.localToWorld(new Vector3(part.at.x, part.at.y, part.at.z));
        this.puff(at, part.color, 0.045 + this.random() * 0.03, 1.8 + this.random(), new Vector3((this.random() - 0.5) * 0.12, 0.32 + this.random() * 0.2, (this.random() - 0.5) * 0.12), -0.12, true);
      }
    }
  }

  private trafficPhase = -1;
  /** Intersection lights cycle green, yellow, red; streets on alternating diagonals are out of step. */
  private updateTrafficLights() {
    const bulbs = this.streetLayer?.userData.trafficBulbs as InstancedMesh | undefined;
    if (!bulbs) return;
    const step = Math.floor(this.actorClock * 2); // re-colour twice a second at most
    if (step === this.trafficPhase) return;
    this.trafficPhase = step;
    const phases = bulbs.userData.phases as number[];
    const colour = new Color();
    phases.forEach((offset, index) => {
      const t = (this.actorClock / 8 + offset) % 1;
      colour.setHex(t < 0.42 ? 0x3cff6a : t < 0.5 ? 0xffd23c : 0xff3c3c);
      bulbs.setColorAt(index, colour);
    });
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  }

  /** A small flock crosses the sky now and then. */
  private launchBirds() {
    const flock = new Group();
    const wingMat = mat(0x1d1f24, 1);
    const wings: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const bird = new Group();
      bird.position.set((i % 3) * 0.45 - 0.45, (i % 2) * 0.2, Math.floor(i / 2) * 0.35);
      for (const side of [-1, 1]) {
        const wing = new Mesh(new BoxGeometry(0.16, 0.012, 0.06), wingMat);
        wing.position.x = side * 0.08;
        wing.userData.side = side;
        bird.add(wing);
        wings.push(wing);
      }
      flock.add(bird);
    }
    const span = this.activeRadius + 6;
    const fromLeft = this.random() < 0.5;
    const start = new Vector3(fromLeft ? -span : span, 4 + this.random() * 1.5, (this.random() - 0.5) * span);
    const end = new Vector3(-start.x, start.y + 0.5, -start.z * 0.5);
    flock.lookAt(end);
    this.root.add(flock);
    let t = 0;
    this.effects.push(delta => {
      t += delta / 9;
      flock.position.lerpVectors(start, end, t);
      for (const wing of wings) wing.rotation.z = Math.sin(this.actorClock * 14 + wing.parent!.position.x * 5) * 0.6 * wing.userData.side;
      if (t < 1) return false;
      this.root.remove(flock);
      disposeObject(flock);
      return true;
    });
  }

  /** Era milestones get a proper party: volleys of fireworks while everyone cheers. */
  private celebrate() {
    this.life.cheer(6);
    let t = 0, shots = 0;
    this.effects.push(delta => {
      t += delta;
      if (t > shots * 0.45 && shots < 6) {
        shots++;
        this.fireworks((this.random() - 0.5) * this.activeRadius, (this.random() - 0.5) * this.activeRadius, 1.6);
      }
      return shots >= 6;
    });
  }

  private makeSkyscraper(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const glass = mat(this.theme.house[1], 0.32, { metalness: 0.22 });
    this.box(building, 0.98, 0.28, 0.98, 0x77766a, 0, 0.18, 0);
    this.box(building, 0.58, 5.2, 0.58, 0, 0, 2.92, 0, glass);
    this.addWindows(building, 0.58, 0.58, 5.2, 15, 2);
    for (const x of [-0.34, 0.34]) {
      this.box(building, 0.045, 5.25, 0.045, 0x505d61, x, 2.9, 0, mat(0x505d61, 0.5, { metalness: 0.36 }));
    }
    this.box(building, 0.72, 0.16, 0.72, 0x626d70, 0, 5.6, 0);
    const antenna = new Mesh(new CylinderGeometry(0.025, 0.05, 0.75, 6), mat(this.theme.accent, 0.4, { metalness: 0.3 }));
    antenna.position.y = 6.04; building.add(antenna);
    const entrance = this.box(building, 0.22, 0.42, 0.06, 0, 0, 0.23, 0.5, mat(0x29343a, 0.35, { metalness: 0.2 }));
    entrance.material.emissive.setHex(this.theme.glow);
    entrance.material.emissiveIntensity = 0.16;
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
    return true;
  }

  private makeThemeLandmark(building: Group, era: number, stone: MeshStandardMaterial) {
    const wood = mat(0x62462e, 1);
    if (this.themeId === "egypt") {
      this.box(building, 0.98, 0.18, 0.98, 0, 0, 0.16, 0, stone);
      if (era === 2) {
        this.box(building, 0.82, 0.42, 0.82, 0, 0, 0.43, 0, mat(0xcab477, 1));
        this.box(building, 0.62, 0.42, 0.62, 0, 0, 0.85, 0, mat(0xd4bd83, 1));
        this.box(building, 0.4, 0.4, 0.4, 0, 0, 1.25, 0, mat(0xddc78d, 1));
        const cap = new Mesh(new ConeGeometry(0.29, 0.48, 4), mat(0xc7a967, 1));
        cap.rotation.y = Math.PI / 4; cap.position.y = 1.69; building.add(cap);
      } else {
        this.box(building, 0.9, 0.18, 0.82, 0, 0, 0.34, 0, mat(0xd4c08e, 1));
        for (const x of [-0.36, 0, 0.36]) {
          const column = new Mesh(new CylinderGeometry(0.075, 0.09, 1.2, 8), mat(0xc3aa70, 1));
          column.position.set(x, 0.98, 0.25); building.add(column);
          this.box(building, 0.2, 0.08, 0.2, 0, x, 1.61, 0.25, mat(0xd9c38d, 1));
        }
        this.box(building, 0.96, 0.2, 0.86, 0, 0, 1.73, 0, mat(0xd5bf87, 1));
        const obelisk = new Mesh(new ConeGeometry(0.13, 1.0, 4), mat(this.theme.accent, 0.75));
        obelisk.position.set(0.3, 0.72, -0.3); building.add(obelisk);
      }
    } else if (this.themeId === "rome") {
      this.box(building, 1.0, 0.24, 0.94, 0, 0, 0.2, 0, stone);
      if (era === 2) {
        for (const x of [-0.34, 0, 0.34]) {
          const column = new Mesh(new CylinderGeometry(0.07, 0.085, 1.2, 10), mat(0xe0d3b5, 0.7));
          column.position.set(x, 0.91, 0.28); building.add(column);
          const capital = this.box(building, 0.16, 0.09, 0.16, 0, x, 1.56, 0.28, mat(0xd8c59e, 0.7));
          capital.castShadow = true;
        }
        this.box(building, 0.98, 0.2, 0.88, 0, 0, 1.66, 0, mat(this.theme.house[1], 0.86));
        const pediment = new Mesh(new ConeGeometry(0.68, 0.48, 4), mat(this.theme.stone, 0.72));
        pediment.rotation.y = Math.PI / 4; pediment.position.y = 1.98; building.add(pediment);
      } else {
        for (const x of [-0.36, 0.36]) this.box(building, 0.16, 1.35, 0.2, 0, x, 0.99, 0.32, mat(0xc8b998, 0.72));
        const arch = new Mesh(new TorusGeometry(0.36, 0.085, 8, 18, Math.PI), mat(0xc8b998, 0.72));
        arch.position.set(0, 1.53, 0.32); building.add(arch);
        this.box(building, 0.98, 0.18, 0.3, 0, 0, 2.03, 0.24, mat(this.theme.house[1], 0.85));
        this.box(building, 0.12, 0.42, 0.08, 0, 0, 2.32, 0.24, mat(this.theme.accent, 0.7));
      }
    } else if (this.themeId === "norse") {
      this.box(building, 0.98, 0.18, 0.94, 0, 0, 0.16, 0, stone);
      if (era === 2) {
        this.box(building, 0.78, 0.76, 0.68, 0, 0, 0.63, 0, wood);
        for (const x of [-0.4, 0.4]) this.box(building, 0.08, 1.15, 0.08, 0, x, 0.72, 0, mat(0x493525, 1));
        const left = this.box(building, 0.6, 0.14, 0.92, 0, -0.22, 1.18, 0, mat(this.theme.roof[0], 1)); left.rotation.z = -0.62;
        const right = this.box(building, 0.6, 0.14, 0.92, 0, 0.22, 1.18, 0, mat(this.theme.roof[0], 1)); right.rotation.z = 0.62;
        this.box(building, 0.1, 0.1, 1.0, 0, 0, 1.48, 0, wood);
      } else {
        this.box(building, 0.7, 2.25, 0.7, 0, 0, 1.39, 0, stone);
        this.addWindows(building, 0.7, 0.7, 2.25, 4, 2);
        const roof = new Mesh(new ConeGeometry(0.58, 0.75, 5), mat(this.theme.roof[1], 1));
        roof.position.y = 2.93; building.add(roof);
        this.box(building, 0.08, 0.68, 0.08, 0, 0, 3.48, 0, wood);
        this.box(building, 0.34, 0.15, 0.04, 0, 0.1, 3.67, 0, mat(this.theme.accent, 0.8));
      }
    } else {
      this.box(building, 0.98, 0.18, 0.94, 0, 0, 0.16, 0, stone);
      this.box(building, 0.56, era === 2 ? 1.6 : 2.2, 0.56, 0, 0, era === 2 ? 1.05 : 1.35, 0, wood);
      const tiers = era === 2 ? 3 : 4;
      for (let tier = 0; tier < tiers; tier++) {
        const y = 0.58 + tier * 0.52;
        const width = 0.92 - tier * 0.13;
        this.box(building, width, 0.1, width, 0, 0, y, 0, mat(this.theme.roof[tier % this.theme.roof.length], 0.82));
        for (const x of [-width * 0.42, width * 0.42]) {
          const eave = this.box(building, 0.16, 0.07, width * 1.1, 0, x, y + 0.05, 0, mat(this.theme.roof[tier % this.theme.roof.length], 0.8));
          eave.rotation.z = x < 0 ? -0.12 : 0.12;
        }
      }
    }
  }

  private addThemeDetails(building: Group, width: number, height: number, depth: number, era: number) {
    if (era <= 1) return;
    if (this.themeId === "egypt") {
      for (const x of [-width * 0.36, width * 0.36]) {
        const pilaster = new Mesh(new CylinderGeometry(0.035, 0.05, Math.min(height * 0.9, 2.4), 7), mat(0xc4a86f, 0.92));
        pilaster.position.set(x, height / 2 + 0.16, depth / 2 + 0.025); building.add(pilaster);
      }
      const lintel = this.box(building, width * 0.94, 0.07, 0.07, 0, 0, height + 0.19, depth / 2 + 0.035, mat(0xb18a4d, 0.85));
      lintel.receiveShadow = true;
    } else if (this.themeId === "rome") {
      for (const x of [-width * 0.36, width * 0.36]) {
        const column = new Mesh(new CylinderGeometry(0.035, 0.05, Math.min(height * 0.9, 2.2), 8), mat(0xe0d3b5, 0.78));
        column.position.set(x, height / 2 + 0.16, depth / 2 + 0.04); building.add(column);
        this.box(building, 0.12, 0.055, 0.12, 0, x, height + 0.19, depth / 2 + 0.04, mat(0xd4c29f, 0.8));
      }
      this.box(building, width * 1.04, 0.075, 0.12, 0, 0, height + 0.24, depth / 2 + 0.04, mat(this.theme.roof[0], 0.86));
    } else if (this.themeId === "norse") {
      for (const x of [-width * 0.4, width * 0.4]) {
        this.box(building, 0.055, height * 0.94, 0.06, 0, x, height / 2 + 0.16, depth / 2 + 0.035, mat(0x493525, 1));
      }
      this.box(building, width * 1.04, 0.08, 0.09, 0, 0, height * 0.62, depth / 2 + 0.04, mat(0x493525, 1));
    } else {
      this.box(building, width * 1.2, 0.07, depth * 1.16, 0, 0, height + 0.18, 0, mat(this.theme.roof[0], 0.82));
      for (const x of [-width * 0.57, width * 0.57]) {
        const bracket = this.box(building, 0.08, 0.2, 0.08, 0, x, height + 0.1, depth * 0.43, mat(0x5d4536, 0.95));
        bracket.rotation.z = x < 0 ? -0.25 : 0.25;
      }
      if (era >= 3) {
        const lantern = new Mesh(new BoxGeometry(0.12, 0.17, 0.12), mat(this.theme.accent, 0.7, { emissive: this.theme.accent, emissiveIntensity: 0.16 }));
        lantern.position.set(width * 0.42, Math.min(height * 0.58, 1.3), depth / 2 + 0.07); building.add(lantern);
      }
    }
  }

  private animateBuild(building: Group, tile: Tile, immediate = false) {
    // Chimneys recorded by the home kit: about half of them smoke.
    for (const at of (building.userData.smoke as Array<{ x: number; y: number; z: number }> | undefined) ?? []) {
      if (this.random() < 0.5) this.animated.push({ tile, building, part: { kind: "smoke", at: new Vector3(at.x, at.y, at.z), rate: 1.1, color: 0x8a8a8a } });
    }
    bakeStatic(building);
    if (!immediate) {
      // Construction dust ring plus a few gold sparkles.
      const base = tile.group.position;
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        this.puff(base.clone().add(new Vector3(Math.cos(angle) * 0.42, 0.05, Math.sin(angle) * 0.42)), 0xb8a888, 0.05, 0.7, new Vector3(Math.cos(angle) * 0.9, 0.4, Math.sin(angle) * 0.9), 1.2, true);
      }
      for (let i = 0; i < 6; i++) this.puff(base.clone().add(new Vector3((this.random() - 0.5) * 0.5, 0.6 + this.random() * 0.6, (this.random() - 0.5) * 0.5)), 0xffe08a, 0.035, 0.9, new Vector3(0, 0.7, 0), 0.4);
    }
    building.userData.buildElapsed = immediate ? 1 : 0;
    building.userData.tile = tile;
    building.userData.era = this.eraIndex;
    building.scale.set(1, immediate ? 1 : 0.02, 1);
    building.position.y = immediate ? 0 : 0.49;
  }

  // ---------- town planning ----------
  // Streets run every BLOCK tiles, so the plot divides into 3x3 blocks: eight lots that front a
  // street around one interior tile kept as a backyard, garden or paddock. The founding campfire
  // sits in the central block, which stays an open plaza.
  private static readonly BLOCK = 4;
  private static readonly BUILD_STEPS = 6;
  private static readonly UNBUILD_SECONDS = 0.9;
  private static readonly STREET_OFFSET = 13;
  private gridMod(value: number) { const m = (value - ChatCity.STREET_OFFSET) % ChatCity.BLOCK; return m < 0 ? m + ChatCity.BLOCK : m; }
  private isStreet(tile: Tile) { return this.gridMod(tile.x) === 0 || this.gridMod(tile.z) === 0; }
  private isInterior(tile: Tile) { return this.gridMod(tile.x) === 2 && this.gridMod(tile.z) === 2; }
  private blockInterior(tile: Tile) {
    const bx = tile.x - this.gridMod(tile.x) + 2, bz = tile.z - this.gridMod(tile.z) + 2;
    return this.tileByCoord.get(this.key(bx, bz));
  }

  private isOpenLot(tile: Tile) {
    const key = this.key(tile.x, tile.z);
    return tile.group.visible && tile.kind === "empty" && !tile.building && !this.isStreet(tile) && !this.isInterior(tile)
      && !this.pathTiles.has(key) && !this.actorTiles.has(key);
  }

  /** Score a lot like a planner would: infill existing streets, grow compactly, finish blocks. */
  private lotScore(tile: Tile, kind: "house" | "landmark", extension: number) {
    const hearth = this.hearthTile;
    const distance = hearth ? Math.hypot(tile.x - hearth.x, tile.z - hearth.z) : 0;
    let neighbors = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const other = this.tileByCoord.get(this.key(tile.x + dx, tile.z + dz));
      if (other && other !== tile && other.building && !this.isStreet(other)) neighbors++;
    }
    const streetSides = this.accessNeighbors(tile).filter(n => n.tile && this.isStreet(n.tile)).length;
    let score = -distance * 0.45 - extension * 1.1 + neighbors * 0.55 + this.random() * 0.7;
    if (kind === "landmark") score += (streetSides >= 2 ? 1.6 : 0) - neighbors * 0.3; // landmarks like corners and breathing room
    else if (streetSides >= 2 && distance > 3) score -= 0.25; // ordinary homes leave corners for shops and landmarks
    return score;
  }

  /** Street tiles each lot would need to pave, from one multi-source search over the planned grid. */
  private streetDistances() {
    const distance = new Map<string, number>();
    const queue: Tile[] = [];
    for (const key of this.pathTiles) {
      const tile = this.tileByCoord.get(key);
      if (tile?.group.visible) { distance.set(key, 0); queue.push(tile); }
    }
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      const d = distance.get(this.key(current.x, current.z))!;
      for (const [dx, dz] of DIRS) {
        const next = this.tileByCoord.get(this.key(current.x + dx, current.z + dz));
        if (!next || !next.group.visible || next.building || !this.isStreet(next)) continue;
        const key = this.key(next.x, next.z);
        if (distance.has(key) || this.actorTiles.has(key)) continue;
        distance.set(key, d + 1);
        queue.push(next);
      }
    }
    return distance;
  }

  private chooseLot(kind: "house" | "landmark") {
    const distance = this.streetDistances();
    const ranked: Array<{ tile: Tile; score: number }> = [];
    for (const tile of this.tiles) {
      if (!this.isOpenLot(tile)) continue;
      let extension = Infinity;
      for (const { tile: street } of this.accessNeighbors(tile)) {
        if (!street || !this.isStreet(street)) continue;
        const d = distance.get(this.key(street.x, street.z));
        if (d !== undefined) extension = Math.min(extension, d === 0 ? 0 : d + 1);
      }
      if (extension === Infinity) continue;
      ranked.push({ tile, score: this.lotScore(tile, kind, extension) });
    }
    ranked.sort((a, b) => b.score - a.score);
    // Only the front-runners pay for a full route check.
    return ranked.slice(0, 6).find(({ tile }) => this.findAccessPlan(tile))?.tile;
  }

  /** When a block gets its first neighbours, its middle becomes a shared backyard. */
  private tendBackyard(lot: Tile) {
    const yard = this.blockInterior(lot);
    if (!yard || !yard.group.visible || yard.building || yard.trees.length || this.actorTiles.has(this.key(yard.x, yard.z))) return;
    const style = Math.floor(this.random() * 3);
    if (style === 0) {
      this.addTree(yard, -0.2, -0.18, 0.72);
      this.addTree(yard, 0.22, 0.2, 0.58);
    } else {
      this.addTree(yard, (this.random() - 0.5) * 0.4, (this.random() - 0.5) * 0.4, 0.65);
      const plot = new Group();
      const soil = new Mesh(new BoxGeometry(0.5, 0.025, 0.36), mat(0x4a3a2a, 1));
      soil.position.y = 0.012;
      plot.add(soil);
      for (let i = 0; i < 3; i++) {
        const row = new Mesh(new BoxGeometry(0.44, 0.04, 0.05), mat(style === 1 ? 0x6b8f3e : 0xd8be73, 1));
        row.position.set(0, 0.035, -0.11 + i * 0.11);
        plot.add(row);
      }
      plot.position.set(0.12, 0, -0.15);
      yard.group.add(plot);
      yard.trees.push(plot);
    }
  }

  build(kind: "house" | "landmark", count: number, immediate = false) {
    for (let n = 0; n < Math.min(30, Math.max(0, count)); n++) {
      let tile = this.chooseLot(kind);
      if (!tile && this.activeRadius < 15.5) {
        this.expandPlot();
        tile = this.chooseLot(kind);
      }
      if (!tile) return;
      for (const tree of tile.trees) tile.group.remove(tree);
      tile.trees = [];
      // Every few homes the district gets a civic building: a well, windmill, factory, arcade...
      this.buildsSinceSpecial++;
      const special = kind === "house" && this.buildsSinceSpecial >= 4 && this.random() < 0.45;
      const built = special ? this.makeSpecial(tile, immediate) : kind === "house" ? this.makeHouse(tile, immediate) : this.makeLandmark(tile, immediate);
      if (built && special) this.buildsSinceSpecial = 0;
      if (!built) continue;
      this.focus.copy(tile.group.position);
      this.totalBuildings++;
      if (this.technologyEra <= 1 && this.totalBuildings % 2 === 0) this.addAnimal(tile);
      else this.tendBackyard(tile);
      this.streetsDirty = true;
    }
    this.tryRenewDistrict();
    this.upgradeOldHome(immediate);
  }

  /** Neighbourhoods modernise over time: one home two or more eras behind is rebuilt in today's style. */
  private upgradeOldHome(immediate: boolean) {
    if (this.recoveryEra !== undefined || this.eraIndex < 2) return;
    const stale = this.tiles.filter(tile => tile.building && tile.kind === "house" && (tile.building.userData.era ?? 0) <= this.eraIndex - 2);
    if (!stale.length) return;
    const tile = stale[Math.floor(this.random() * stale.length)];
    const old = tile.building!;
    tile.group.remove(old);
    tile.building = undefined;
    tile.kind = "empty";
    if (this.makeHouse(tile, immediate)) disposeObject(old);
    else { tile.group.add(old); tile.building = old; tile.kind = "house"; }
  }

  boom(viewers: number, historical = false) {
    const count = Math.min(24, Math.max(2, Math.ceil(viewers / 5)));
    this.build("house", count, historical);
    if (!historical) { this.fireworks(0, 0, Math.min(2.8, 0.8 + viewers / 800)); this.life.cheer(5); }
  }

  disaster(intensity: number, historical = false, damageCount?: number, durationMs = 3600, kind: AttackKind = "fire") {
    const occupied = this.tiles.filter(tile => tile.building && (tile.kind === "house" || tile.kind === "landmark"));
    const count = Math.min(occupied.length, Math.max(1, damageCount ?? Math.ceil(intensity * 2.4)));
    // Trouble arrives from outside: outskirts homes are hit first, landmarks last.
    const hearth = this.hearthTile;
    const exposure = (tile: Tile) => (hearth ? Math.hypot(tile.x - hearth.x, tile.z - hearth.z) : 0) + this.random() * 3 - (tile.kind === "landmark" ? 4 : 0) - (tile.burningUntil ? 99 : 0);
    const seed = occupied.reduce<Tile | undefined>((best, tile) => !best || exposure(tile) > exposure(best) ? tile : best, undefined);
    const damageNoise = new Map(occupied.map(tile => [tile, this.random()]));
    const candidates = occupied.filter(tile => tile.building?.userData.collapse === undefined && tile.kind !== "fire");
    const damageSet = seed
      ? candidates.sort((a, b) => {
          const distanceA = Math.abs(a.x - seed.x) + Math.abs(a.z - seed.z) + (damageNoise.get(a) ?? 0) * 0.25;
          const distanceB = Math.abs(b.x - seed.x) + Math.abs(b.z - seed.z) + (damageNoise.get(b) ?? 0) * 0.25;
          return distanceA - distanceB;
        }).slice(0, count)
      : [];
    if (historical || !seed) {
      for (const tile of damageSet) this.destroyBuilding(tile);
      return;
    }
    const target = seed.group.position.clone();
    this.focus.copy(target);
    this.life.panic(target, 1.6 + count * 0.6, 4);
    const scale = Math.min(1, 0.45 + count * 0.2);
    const ignite = (tile: Tile) => {
      if (!tile.building || tile.kind === "fire") return;
      tile.kind = "fire"; tile.burningUntil = performance.now() + durationMs; this.addFlames(tile);
    };
    if (kind === "meteor") this.meteorStrike(target, () => { damageSet.forEach(ignite); this.shake = 0.3 + scale * 0.3; }, scale);
    else if (kind === "storm") this.lightningStorm(target, damageSet, ignite, scale);
    else if (kind === "swarm") this.locustSwarm(target, damageSet, scale);
    else damageSet.forEach(ignite);
  }

  /** A glowing rock streaks in, then the impact sets the district alight. */
  private meteorStrike(target: Vector3, onImpact: () => void, scale = 1) {
    const rock = new Group();
    rock.scale.setScalar(scale);
    const core = new Mesh(new IcosahedronGeometry(0.45, 1), mat(0x4a3428, 0.9, { emissive: 0xff5a1f, emissiveIntensity: 1.4 }));
    const glow = new Mesh(new SphereGeometry(0.7, 12, 8), new MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a22, emissiveIntensity: 2, transparent: true, opacity: 0.45 }));
    rock.add(core, glow);
    const start = target.clone().add(new Vector3(-9, 14, -6));
    rock.position.copy(start);
    this.root.add(rock);
    let t = 0;
    this.effects.push(delta => {
      t += delta / 1.1;
      const eased = t * t;
      rock.position.lerpVectors(start, target, Math.min(1, eased));
      core.rotation.x += delta * 6; core.rotation.y += delta * 4;
      if (this.random() < 0.9) this.puff(rock.position, 0xff9a3a, 0.16, 0.5, new Vector3((this.random() - 0.5) * 0.6, 0.4, (this.random() - 0.5) * 0.6));
      if (t < 1) return false;
      this.root.remove(rock);
      disposeObject(rock);
      for (let i = 0; i < Math.round(46 * scale); i++) {
        const color = [0xff7a22, 0xffc04d, 0x5a4a3a, 0x8a7a6a][i % 4];
        this.puff(target.clone().setY(0.3), color, 0.06 + this.random() * 0.08, 0.7 + this.random() * 0.8, new Vector3((this.random() - 0.5) * 6, 2 + this.random() * 4, (this.random() - 0.5) * 6), 6);
      }
      const crater = new Mesh(new CylinderGeometry(0.9 * scale, 1.05 * scale, 0.02, 18), mat(0x2b2420, 1));
      crater.position.copy(target).setY(0.03);
      this.root.add(crater);
      let fade = 0;
      this.effects.push(dt => { fade += dt; if (fade > 12) { this.root.remove(crater); disposeObject(crater); return true; } return false; });
      onImpact();
      return true;
    });
  }

  /** A dark cloud rolls over and lightning picks off buildings one strike at a time. */
  private lightningStorm(target: Vector3, damage: Tile[], ignite: (tile: Tile) => void, scale = 1) {
    const cloud = new Group();
    cloud.scale.setScalar(0.5 + scale * 0.5);
    const cloudMat = new MeshStandardMaterial({ color: 0x3a4250, roughness: 1, transparent: true, opacity: 0 });
    for (let i = 0; i < 9; i++) {
      const puff = new Mesh(new SphereGeometry(0.9 + this.random() * 0.6, 10, 8), cloudMat);
      puff.position.set((this.random() - 0.5) * 3.4, (this.random() - 0.5) * 0.4, (this.random() - 0.5) * 2.4);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    cloud.position.copy(target).setY(6.2);
    this.root.add(cloud);
    const flash = this.claimLight(0xc8d8ff, 18, 1.5, target.clone().setY(5));
    let t = 0;
    const queue = [...damage];
    let nextStrike = 0.6;
    const lifetime = 2.4 + queue.length * 0.6;
    this.effects.push(delta => {
      t += delta;
      cloudMat.opacity = Math.min(0.92, t * 1.6) * (t > lifetime - 1 ? Math.max(0, lifetime - t) : 1);
      cloud.position.x += Math.sin(t * 0.8) * delta * 0.3;
      if (flash) flash.intensity *= Math.exp(-delta * 14);
      for (let i = 0; i < 3; i++) this.puff(cloud.position.clone().add(new Vector3((this.random() - 0.5) * 3.4, -0.4, (this.random() - 0.5) * 2.4)), 0x9fb6d8, 0.025, 0.6, new Vector3(0, -9, 0), 0);
      if (t >= nextStrike && queue.length) {
        const tile = queue.shift()!;
        nextStrike = t + 0.35 + this.random() * 0.35;
        this.bolt(cloud.position.clone().setY(5.8), tile.group.position.clone().setY(0.6));
        if (flash) flash.intensity = 30;
        this.shake = Math.max(this.shake, 0.25);
        ignite(tile);
      }
      if (t < lifetime) return false;
      this.root.remove(cloud);
      this.releaseLight(flash);
      disposeObject(cloud); cloudMat.dispose();
      return true;
    });
  }

  private bolt(from: Vector3, to: Vector3) {
    const bolt = new Group();
    const boltMat = new MeshStandardMaterial({ color: 0xe8f0ff, emissive: 0xbfd4ff, emissiveIntensity: 3, transparent: true, opacity: 1 });
    let previous = from.clone();
    for (let i = 1; i <= 7; i++) {
      const point = from.clone().lerp(to, i / 7);
      if (i < 7) point.add(new Vector3((this.random() - 0.5) * 0.6, 0, (this.random() - 0.5) * 0.6));
      const length = previous.distanceTo(point);
      const piece = new Mesh(new BoxGeometry(0.06, length, 0.06), boltMat);
      piece.position.lerpVectors(previous, point, 0.5);
      piece.lookAt(point);
      piece.rotateX(Math.PI / 2);
      bolt.add(piece);
      previous = point;
    }
    this.root.add(bolt);
    let t = 0;
    this.effects.push(delta => {
      t += delta;
      boltMat.opacity = Math.max(0, 1 - t / 0.3) * (Math.sin(t * 80) > -0.3 ? 1 : 0.2);
      if (t < 0.3) return false;
      this.root.remove(bolt); disposeObject(bolt); boltMat.dispose();
      return true;
    });
  }

  /** A buzzing swarm sweeps in and gnaws buildings down to rubble. */
  private locustSwarm(target: Vector3, damage: Tile[], scale = 1) {
    const bugs: Mesh[] = [];
    const bugMat = mat(0x2a2a1e, 0.8);
    const geometry = new BoxGeometry(0.05, 0.03, 0.08);
    const entry = target.clone().add(new Vector3(this.activeRadius + 4, 1.6, -this.activeRadius));
    for (let i = 0; i < Math.round(90 * scale); i++) {
      const bug = new Mesh(geometry, bugMat);
      bug.position.copy(entry).add(new Vector3((this.random() - 0.5) * 2, (this.random() - 0.5) * 1, (this.random() - 0.5) * 2));
      bug.userData.phase = this.random() * Math.PI * 2;
      bug.userData.radius = 0.6 + this.random() * 1.4;
      bugs.push(bug);
      this.root.add(bug);
    }
    let t = 0;
    const center = new Vector3();
    damage.forEach((tile, index) => { if (tile.building) tile.building.userData.gnawAt = 1.5 + index * 0.4; });
    const leaveAt = 2.4 + damage.length * 0.4;
    this.effects.push(delta => {
      t += delta;
      const arrive = Math.min(1, t / 1.4);
      const leaving = t > leaveAt ? (t - leaveAt) / 1.2 : 0;
      center.lerpVectors(entry, target.clone().setY(0.9), arrive * arrive * (3 - 2 * arrive));
      if (leaving) center.add(new Vector3(-leaving * 10, leaving * 6, leaving * 8));
      for (const bug of bugs) {
        const phase = bug.userData.phase + t * 5;
        const r = bug.userData.radius * (arrive < 1 ? 0.6 : 1);
        bug.position.set(center.x + Math.cos(phase) * r, center.y + Math.sin(phase * 1.7) * 0.5, center.z + Math.sin(phase) * r);
        bug.rotation.y = -phase;
      }
      for (const tile of damage) {
        const building = tile.building;
        if (!building || building.userData.gnawAt === undefined || t < building.userData.gnawAt) continue;
        building.userData.gnawAt = undefined;
        building.userData.collapse = 0;
      }
      if (t < leaveAt + 1.2) return false;
      for (const bug of bugs) this.root.remove(bug);
      geometry.dispose();
      return true;
    });
  }

  private puff(at: Vector3, color: number, size: number, life: number, velocity: Vector3, gravity = 1.5, dull = false) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const tint = new Color(color);
    if (dull) tint.multiplyScalar(0.75);
    this.particles.push({ position: at.clone(), velocity, size: size * 1.6, color: tint, life, maxLife: life, gravity, drag: 1.2 });
  }


  private addFlames(tile: Tile) {
    const flames = new Group();
    for (let i = 0; i < 5; i++) {
      const flame = new Mesh(new ConeGeometry(0.12 + this.random() * 0.1, 0.45 + this.random() * 0.4, 6), mat(i % 2 ? 0xff9b42 : 0xffdf76, 0.4, { emissive: 0xff5c19, emissiveIntensity: 1.3 }));
      flame.position.set((this.random() - 0.5) * 0.55, 0.5 + this.random() * 0.6, (this.random() - 0.5) * 0.55);
      flame.userData.phase = this.random() * Math.PI * 2;
      flames.add(flame);
    }
    flames.userData.keep = true;
    tile.building?.add(flames);
    if (tile.building) {
      tile.building.userData.flames = flames;
      tile.building.userData.light = this.claimLight(0xff6a32, 3.2, 2, tile.group.position.clone().setY(1.1));
    }
  }

  fireworks(x: number, z: number, intensity: number) {
    const origin = new Vector3(x, 2.2, z);
    const colorList = [0xffcb6b, 0xe98770, 0x89d4c5, 0x99b9e6, 0xf1e6c4];
    const amount = Math.min(70, Math.max(18, Math.round(24 * intensity)));
    for (let i = 0; i < amount && this.particles.length < MAX_PARTICLES; i++) {
      const color = new Color(colorList[Math.floor(this.random() * colorList.length)]).multiplyScalar(1.4);
      const velocity = new Vector3((this.random() - 0.5) * 4.2, this.random() * 3 + 1.6, (this.random() - 0.5) * 4.2);
      const life = 0.8 + this.random() * 0.8;
      this.particles.push({ position: origin.clone(), velocity, size: 0.09 + this.random() * 0.05, color, life, maxLife: life, gravity: 4.2 });
    }
  }


  apply(event: SimEvent, historical = false) {
    if (event.type === "advancement") { this.unlockTechnology(event.era); if (!historical) this.celebrate(); }
    else if (event.type === "build") this.build(event.kind, event.count, historical);
    else if (event.type === "boom") this.boom(event.viewers, historical);
    else if (event.type === "disaster") this.disaster(event.intensity, historical, event.damageCount, event.durationMs, event.kind);
    else if (event.type === "effect" && !historical) { this.fireworks(this.focus.x, this.focus.z, event.intensity); this.life.cheer(3); }
  }

  private updateBuildings(delta: number) {
    for (const tile of this.tiles) {
      if (tile.revealing) {
        tile.revealElapsed = (tile.revealElapsed ?? 0) + delta;
        const reveal = Math.min(1, tile.revealElapsed / 0.78);
        const smooth = 1 - Math.pow(1 - reveal, 3);
        tile.group.scale.y = 0.015 + smooth * 0.985;
        tile.group.position.y = -0.07 * (1 - smooth);
        if (reveal >= 1) tile.revealing = false;
        this.writeGround(tile);
        this.shadowsDirty = true;
      }
      const building = tile.building;
      if (!building) continue;
      if (building.userData.collapse !== undefined) {
        // Demolition is construction in reverse: the building steps down in chunky pixel layers.
        const before = building.userData.collapse as number;
        building.userData.collapse = before + delta;
        const c = building.userData.collapse as number;
        const steps = ChatCity.BUILD_STEPS;
        const step = Math.min(steps, Math.floor((c / ChatCity.UNBUILD_SECONDS) * steps));
        if (step > Math.floor((before / ChatCity.UNBUILD_SECONDS) * steps)) {
          for (let i = 0; i < 5; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.8, 0.15 + (1 - step / steps) * 0.6, (this.random() - 0.5) * 0.8)), [0x9a8a72, 0x6b5f50, 0xb8a888][i % 3], 0.07, 0.8, new Vector3((this.random() - 0.5) * 1.2, 0.9, (this.random() - 0.5) * 1.2), 1.2, true);
          building.position.x = (this.random() - 0.5) * 0.05;
        }
        building.scale.y = Math.max(0.04, 1 - step / steps);
        this.shadowsDirty = true;
        if (step >= steps) this.destroyBuilding(tile);
        continue;
      }
      const elapsed = (building.userData.buildElapsed ?? 0) + delta;
      building.userData.buildElapsed = elapsed;
      const progress = Math.min(1, elapsed / 0.82);
      if (progress < 1 || !building.userData.settled) {
        this.shadowsDirty = true;
        // Builds stack up in the same chunky steps as demolition, then land with a little bounce.
        const eased = 1 - Math.pow(1 - progress, 2);
        const stepped = Math.max(1, Math.ceil(eased * ChatCity.BUILD_STEPS)) / ChatCity.BUILD_STEPS;
        const settle = progress >= 1 ? Math.max(0, 1 - (elapsed - 0.82) / 0.25) : 0;
        building.scale.y = stepped + Math.sin(settle * Math.PI) * 0.06;
        building.position.y = 0;
        if (progress >= 1 && settle <= 0) { building.userData.settled = true; building.scale.y = 1; }
      }

      const hearth = building.userData.hearth as Group | undefined;
      hearth?.children.forEach(child => {
        if (!(child instanceof Mesh) || child.userData.hearthPhase === undefined) return;
        const phase = (child.userData.hearthPhase as number) + performance.now() * 0.006;
        child.scale.set(0.88 + Math.sin(phase) * 0.18, 0.86 + Math.sin(phase * 1.4) * 0.28, 0.88 + Math.cos(phase) * 0.18);
      });

      if (tile.kind === "fire") {
        const flames = building.userData.flames as Group | undefined;
        flames?.children.forEach((child, index) => {
          if (child instanceof Mesh) {
            const phase = (child.userData.phase as number) + performance.now() * 0.008;
            child.scale.set(0.8 + Math.sin(phase) * 0.25, 0.78 + Math.sin(phase * 1.3) * 0.38, 0.8 + Math.cos(phase) * 0.2);
          }
        });
        const light = building.userData.light as PointLight | undefined;
        if (light) light.intensity = 1.55 + 0.45 * Math.sin(performance.now() * 0.012 + tile.x);
        if (tile.burningUntil && performance.now() >= tile.burningUntil && building.userData.collapse === undefined) building.userData.collapse = 0;
      }
    }
  }

  private destroyBuilding(tile: Tile) {
    if (tile.building) {
      this.releaseLight(tile.building.userData.light as PointLight | undefined);
      tile.group.remove(tile.building);
      disposeObject(tile.building);
      tile.building = undefined;
      this.streetsDirty = true;
      this.shadowsDirty = true;
    }
    tile.kind = "empty";
    tile.burningUntil = undefined;
    if (this.random() > 0.45) this.addTree(tile, (this.random() - 0.5) * 0.36, (this.random() - 0.5) * 0.36, 0.45 + this.random() * 0.35);
  }

  private updateParticles(delta: number) {
    const mesh = this.particleMesh;
    const dummy = this.particleDummy;
    let write = 0;
    for (const particle of this.particles) {
      particle.life -= delta;
      if (particle.life <= 0) continue;
      particle.velocity.y -= particle.gravity * delta;
      if (particle.drag) particle.velocity.multiplyScalar(Math.exp(-particle.drag * delta));
      particle.position.addScaledVector(particle.velocity, delta);
      // Shrink in hard steps so particles blink out like sprites instead of fading smoothly.
      const steps = Math.ceil((particle.life / particle.maxLife) * 4) / 4;
      dummy.position.copy(particle.position);
      dummy.scale.setScalar(particle.size * steps);
      dummy.updateMatrix();
      mesh.setMatrixAt(write, dummy.matrix);
      mesh.setColorAt(write, particle.color);
      this.particles[write++] = particle;
    }
    this.particles.length = write;
    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }


  private animate = () => {
    if (this.destroyed) return;
    const now = performance.now();
    // Overlays cap the frame rate: a 30 fps city is plenty over a 30/60 fps stream and halves GPU work.
    this.frameBudget += now - this.previousFrame;
    if (this.maxFps < 60 && this.frameBudget < 1000 / this.maxFps - 2) { this.previousFrame = now; return; }
    const delta = Math.min(this.frameBudget / 1000, 0.07);
    this.frameBudget = 0;
    this.previousFrame = now;
    const oldSpan = this.viewSpan;
    this.viewSpan += (this.targetSpan - this.viewSpan) * (1 - Math.exp(-3.6 * delta));
    if (Math.abs(oldSpan - this.viewSpan) > 0.001) this.updateCameraFrustum();
    this.updateBuildings(delta);
    this.updateAnimated(delta);
    this.updateTrafficLights();
    this.birdClock -= delta;
    if (this.birdClock <= 0) { this.birdClock = 25 + this.random() * 30; this.launchBirds(); }
    if (this.streetsDirty) this.rebuildStreets();
    this.updateCampfire(delta);
    this.life.update(delta);
    // Effects may schedule more effects (bolts, craters) while running; collect those too.
    const running = this.effects;
    this.effects = [];
    const unfinished = running.filter(effect => !effect(delta));
    this.effects.push(...unfinished);
    this.updateParticles(delta);
    this.shake = Math.max(0, this.shake - delta * 1.4);
    const jolt = this.shake * this.shake * 0.5;
    this.viewAngle += (this.targetViewAngle - this.viewAngle) * (1 - Math.exp(-7 * delta));
    if (Math.abs(this.targetViewAngle - this.viewAngle) < 0.0005) this.viewAngle = this.targetViewAngle;
    const cos = Math.cos(this.viewAngle), sin = Math.sin(this.viewAngle);
    const baseX = this.cameraBase.x * cos - this.cameraBase.z * sin, baseZ = this.cameraBase.x * sin + this.cameraBase.z * cos;
    this.camera.position.set(baseX + (Math.random() - 0.5) * jolt, this.cameraBase.y + (Math.random() - 0.5) * jolt, baseZ + (Math.random() - 0.5) * jolt);
    this.camera.lookAt(0, 0, 0);
    if (this.groundDirty) {
      this.ground.instanceMatrix.needsUpdate = true;
      if (this.ground.instanceColor) this.ground.instanceColor.needsUpdate = true;
      this.groundDirty = false;
    }
    if (this.shadowsDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowsDirty = false; }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  };

  speakerPoint() {
    const at = this.life.speakerPosition();
    return at ? this.screenPoint(at.setY(at.y - 0.8)) : undefined;
  }

  /** Turn the view a quarter turn (+1 clockwise, -1 counter-clockwise). */
  rotateView(steps: number) {
    this.viewQuarter = ((this.viewQuarter + steps) % 4 + 4) % 4;
    this.targetViewAngle += steps * Math.PI / 2;
  }
  get viewDirection() { return this.viewQuarter; }

  /** Project a world point to CSS pixels inside the host element. */
  screenPoint(world: Vector3) {
    const projected = world.clone().setY(world.y + 0.8).project(this.camera);
    const rect = this.host.getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) / 2 * rect.width, y: rect.top + (1 - projected.y) / 2 * rect.height };
  }

  destroy() {
    this.destroyed = true;
    this.life.dispose();
    window.removeEventListener("resize", this.resize);
    this.resizeObserver?.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}
