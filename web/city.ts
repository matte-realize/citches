import { ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, IcosahedronGeometry, LineBasicMaterial, LineLoop, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap, PlaneGeometry, PointLight, SRGBColorSpace, Scene, SphereGeometry, TorusGeometry, Vector3, WebGLRenderer } from "three";
import type { ColorRepresentation, Material, MeshStandardMaterialParameters, Object3D } from "three";
import type { SimEvent } from "../src/types.js";
import type { CommunityProgress } from "../src/types.js";

type TileKind = "empty" | "house" | "landmark" | "fire";
type Tile = { x: number; z: number; kind: TileKind; road: boolean; group: Group; building?: Group; trees: Group[]; burningUntil?: number; revealing?: boolean; revealElapsed?: number };
type Particle = { mesh: Mesh; velocity: Vector3; life: number; maxLife: number; gravity: number };
type PathSegment = { mesh: Mesh; start: Vector3; end: Vector3; length: number; horizontal: boolean; motorable: boolean };
type CivicActor = { group: Group; kind: "person" | "animal" | "wagon" | "car" | "blimp"; x: number; z: number; phase: number; range: number; walks?: boolean; route?: Vector3[]; routeProgress?: number };
type AccessPlan = { dx: number; dz: number; yaw: number; route: Tile[] };

const GRID = 32;
export const CITY_THEMES = {
  egypt: { label: "Nile Kingdom", sky: 0x172937, grass: [0x4e7058, 0x57775c, 0x647a58, 0x436b5d], road: [0x826f56, 0x927f61, 0x73654e], house: [0xc69c62, 0xd3ae72, 0xb88650, 0xd8c08b], roof: [0xa27b46, 0xb18b52, 0x8a693e], window: [0xf4d58c, 0xffe6aa, 0xc79c55], stone: 0xc9b27d, foliage: [0x51836a, 0x65936e, 0x46765f], accent: 0x45a6a0, glow: 0xffd275 },
  rome: { label: "Roman Republic", sky: 0x202c36, grass: [0x426348, 0x4b684c, 0x586c4e, 0x3e5b45], road: [0x635f56, 0x726d60, 0x5c584f], house: [0xc98f68, 0xd3b68c, 0xb97d59, 0xe0cda6], roof: [0x984f3d, 0xb05b42, 0x8b493b], window: [0xffd58d, 0xf4e0b4, 0xf2c16e], stone: 0xd1c2a0, foliage: [0x4c7953, 0x64865a, 0x426b4d], accent: 0x9b563f, glow: 0xf2c77c },
  norse: { label: "Norse Settlement", sky: 0x263642, grass: [0x3e5b50, 0x466456, 0x526b5a, 0x3a554b], road: [0x5c6057, 0x6b6b5c, 0x50574e], house: [0x9d7b53, 0xb39360, 0x79634b, 0xc0a778], roof: [0x4e5b47, 0x6b704f, 0x5d483a], window: [0xf1c978, 0xe8d29d, 0xffdc8b], stone: 0x9b927c, foliage: [0x477252, 0x56805b, 0x3b654c], accent: 0xd2a75f, glow: 0xf3bd68 },
  japan: { label: "Imperial Japan", sky: 0x282d3d, grass: [0x3d6550, 0x4e7057, 0x5b775d, 0x3e5f4e], road: [0x68695f, 0x777466, 0x5d6259], house: [0xb98a64, 0xc8aa82, 0x9f7158, 0xd5bd92], roof: [0x454a50, 0x5c514b, 0x77604e], window: [0xffd99b, 0xf4e6c7, 0xffc878], stone: 0xb5a88d, foliage: [0x517853, 0x67905e, 0x49755e], accent: 0xb84748, glow: 0xf1c879 }
} as const;
export type CityThemeId = keyof typeof CITY_THEMES;
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
  readonly renderer = new WebGLRenderer({ antialias: true, alpha: false });
  private root = new Group();
  private tiles: Tile[] = [];
  private tileByCoord = new Map<string, Tile>();
  private particles: Particle[] = [];
  private paths: PathSegment[] = [];
  private automotiveRoads: Mesh[] = [];
  private pathTiles = new Set<string>();
  private actorTiles = new Set<string>();
  private pathEdges: Array<[string, string]> = [];
  private actors: CivicActor[] = [];
  private actorClock = 0;
  private campfire?: Group;
  private lastRedevelopedEra = 1;
  private activeRadius = 4.5;
  private totalBuildings = 0;
  private technologyEra = 0;
  private recoveryEra?: number;
  private plotBorder?: LineLoop;
  private theme: typeof CITY_THEMES[CityThemeId];
  private themeId: CityThemeId;
  private previousFrame = performance.now();
  private destroyed = false;
  private resizeObserver?: ResizeObserver;
  private randomState = 1;
  private aspect = 1;
  private viewSpan = 18;
  private targetSpan = 18;

  constructor(private host: HTMLElement, themeId: CityThemeId = themeFromSearch()) {
    this.themeId = themeId;
    this.theme = CITY_THEMES[themeId];
    this.randomState = [...themeId].reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.domElement.className = "city-canvas";
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color(this.theme.sky);
    this.scene.fog = new Fog(this.theme.sky, 48, 100);
    this.scene.add(this.root);
    this.addLighting();
    this.makeGround();
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
        const slab = new Mesh(new BoxGeometry(0.99, road ? 0.075 : 0.12, 0.99), mat(tileColor));
        slab.position.y = road ? -0.04 : -0.06;
        slab.receiveShadow = true;
        group.add(slab);
        this.root.add(group);
        const tile: Tile = { x, z, kind: "empty", road, group, trees: [] };
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
    tile.group.add(tree);
    tile.trees.push(tree);
  }

  private frameCamera() {
    this.camera.position.set(35, 43, 35);
    this.camera.lookAt(0, 0, 0);
    this.camera.zoom = 1.18;
    this.camera.updateProjectionMatrix();
  }

  private resize = () => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.aspect = width / height;
    this.renderer.setSize(width, height, false);
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
    }
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
      this.addPathSegment(
        new Vector3(hearthPath.group.position.x, 0.014, hearthPath.group.position.z),
        new Vector3(tile.group.position.x, 0.014, tile.group.position.z + 0.38)
      );
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const clearing = this.tileByCoord.get(this.key(tile.x + dx, tile.z + dz));
      if (!clearing || clearing === tile || clearing === hearthPath) continue;
      this.actorTiles.add(this.key(clearing.x, clearing.z));
      for (const tree of clearing.trees) clearing.group.remove(tree);
      clearing.trees = [];
    }
    for (let i = 0; i < 4; i++) this.addPerson(tile, i);
  }

  private addPerson(tile: Tile, index: number, walking = false) {
    const person = new Group();
    const tunics = [0x846342, 0x75644b, 0x9a714d, 0x695849];
    const body = new Mesh(new CylinderGeometry(0.07, 0.105, 0.29, 6), mat(tunics[index % tunics.length], 1));
    body.position.y = 0.25; person.add(body);
    const head = new Mesh(new SphereGeometry(0.07, 7, 6), mat(0xb9815c, 1));
    head.position.y = 0.46; person.add(head);
    const hair = new Mesh(new SphereGeometry(0.072, 7, 5), mat(0x392d23, 1));
    hair.scale.set(1.04, 0.55, 1.04); hair.position.y = 0.5; person.add(hair);
    for (const x of [-0.095, 0.095]) {
      const arm = new Mesh(new CylinderGeometry(0.025, 0.03, 0.25, 5), mat(0xb9815c, 1));
      arm.position.set(x, 0.27, 0); arm.rotation.z = x < 0 ? -0.18 : 0.18; person.add(arm);
      const leg = new Mesh(new CylinderGeometry(0.027, 0.032, 0.19, 5), mat(0x44382d, 1));
      leg.position.set(x * 0.42, 0.09, 0); person.add(leg);
    }
    const angle = index * Math.PI / 2 + Math.PI / 4;
    const radius = 0.8 + (index % 2) * 0.14;
    const pathOrigin = walking ? this.findPathOrigin(tile.group.position.x, tile.group.position.z) : undefined;
    this.addActor(person, "person", pathOrigin?.x ?? tile.group.position.x + Math.cos(angle) * radius, pathOrigin?.z ?? tile.group.position.z + Math.sin(angle) * radius, walking ? 0 : 0.06, walking);
    person.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
  }

  private expandPlot() {
    if (this.activeRadius >= 15.5) return;
    this.setActiveRadius(Math.min(15.5, this.activeRadius + 2));
  }

  private addPathSegment(from: Vector3, to: Vector3, motorable = false) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.08) return;
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const length = Math.max(0.08, Math.abs(horizontal ? dx : dz));
    const mesh = new Mesh(new BoxGeometry(1, 0.018, 1), mat(this.theme.road[0], 1));
    mesh.position.set((from.x + to.x) / 2, 0.014, (from.z + to.z) / 2);
    this.root.add(mesh);
    const segment = { mesh, start: from.clone(), end: to.clone(), length, horizontal, motorable };
    this.paths.push(segment);
    this.stylePath(segment);
    if (motorable && this.technologyEra >= 4) this.addAutomotiveRoad(segment);
  }

  private stylePath(path: PathSegment) {
    const era = this.technologyEra;
    const width = era < 2 ? 0.1 + era * 0.025 : 0.14;
    const { mesh, length, horizontal } = path;
    mesh.geometry.dispose();
    mesh.geometry = new BoxGeometry(horizontal ? length : width, 0.018, horizontal ? width : length);
    const offset = era >= 4 ? 0.32 : 0;
    mesh.position.set((path.start.x + path.end.x) / 2 + (horizontal ? 0 : offset), 0.014, (path.start.z + path.end.z) / 2 + (horizontal ? offset : 0));
    const surface = era < 2 ? (era === 0 ? 0x79623e : 0x8c7955)
      : era === 2 ? 0x807c6c
      : 0xaaa18a;
    const material = mesh.material as MeshStandardMaterial;
    material.color.setHex(surface);
    material.roughness = era < 3 ? 1 : 0.82;
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
      const route = this.findRouteToPath(access, tile);
      if (route && (!best || route.length < best.route.length)) best = { dx: direction.dx, dz: direction.dz, yaw: direction.yaw, route };
    }
    return best;
  }

  private connectNewBuilding(tile: Tile, building: Group): boolean {
    const access = this.findAccessPlan(tile);
    if (!access) return false;
    building.rotation.y = access.yaw;

    const center = new Vector3(tile.group.position.x, 0.014, tile.group.position.z);
    const threshold = center.clone().add(new Vector3(access.dx * 0.49, 0, access.dz * 0.49));
    const routeStart = access.route[0];
    for (const tree of routeStart.trees) routeStart.group.remove(tree);
    routeStart.trees = [];
    const routePosition = new Vector3(routeStart.group.position.x, 0.014, routeStart.group.position.z);
    this.addPathSegment(threshold, routePosition);
    this.pathTiles.add(this.key(routeStart.x, routeStart.z));
    for (let i = 1; i < access.route.length; i++) {
      const from = access.route[i - 1];
      const to = access.route[i];
      for (const tree of to.trees) to.group.remove(tree);
      to.trees = [];
      this.addPathSegment(
        new Vector3(from.group.position.x, 0.014, from.group.position.z),
        new Vector3(to.group.position.x, 0.014, to.group.position.z),
        true
      );
      this.pathTiles.add(this.key(to.x, to.z));
    }
    this.refreshActorRoutes();
    return true;
  }

  private upgradePaths() {
    for (const path of this.paths) this.stylePath(path);
    if (this.technologyEra >= 4) this.buildAutomotiveRoads();
  }

  private addAutomotiveRoad(path: PathSegment) {
    const { start, end, length, horizontal } = path;
    const road = new Mesh(new BoxGeometry(horizontal ? length : 0.44, 0.024, horizontal ? 0.44 : length), mat(this.theme.road[2], 0.96));
    road.position.set((start.x + end.x) / 2, 0.022, (start.z + end.z) / 2);
    road.receiveShadow = true;
    this.root.add(road);
    this.automotiveRoads.push(road);
    if (length > 0.7) {
      const dash = new Mesh(new BoxGeometry(horizontal ? 0.36 : 0.025, 0.008, horizontal ? 0.025 : 0.36), mat(0xc5ab6b, 0.9));
      dash.position.set((start.x + end.x) / 2, 0.036, (start.z + end.z) / 2);
      this.root.add(dash);
      this.automotiveRoads.push(dash);
    }
  }

  private buildAutomotiveRoads() {
    for (const road of this.automotiveRoads) {
      this.root.remove(road);
      this.disposeTree(road);
    }
    this.automotiveRoads = [];
    for (const path of this.paths) if (path.motorable) this.addAutomotiveRoad(path);
  }

  private addActor(group: Group, kind: CivicActor["kind"], x: number, z: number, range = 1.2, walks = false) {
    group.position.set(x, kind === "blimp" ? 5.1 : 0.02, z);
    this.root.add(group);
    const actor: CivicActor = { group, kind, x, z, phase: this.random() * Math.PI * 2, range, walks };
    if (kind === "wagon" || kind === "car" || (kind === "person" && walks)) actor.route = this.buildActorRoute(x, z);
    this.actors.push(actor);
  }

  private addAnimal(tile: Tile) {
    if (this.actors.filter(actor => actor.kind === "animal").length >= 8) return;
    const pasture = this.tiles
      .filter(cell => cell.group.visible && cell.kind === "empty" && !cell.building && !this.pathTiles.has(this.key(cell.x, cell.z)) && !this.actorTiles.has(this.key(cell.x, cell.z)))
      .filter(cell => Math.abs(cell.x - tile.x) + Math.abs(cell.z - tile.z) <= 2)
      .sort((a, b) => (Math.abs(a.x - tile.x) + Math.abs(a.z - tile.z)) - (Math.abs(b.x - tile.x) + Math.abs(b.z - tile.z)))[0];
    if (!pasture) return;
    for (const tree of pasture.trees) pasture.group.remove(tree);
    pasture.trees = [];
    this.actorTiles.add(this.key(pasture.x, pasture.z));
    const animal = new Group();
    const wool = mat(this.random() > 0.35 ? 0xe1d6bd : 0x8e7657, 1);
    const dark = mat(0x453a2e, 1);
    const body = new Mesh(new SphereGeometry(0.17, 8, 6), wool);
    body.scale.set(1.25, 0.9, 0.82); body.position.y = 0.21; animal.add(body);
    const head = new Mesh(new SphereGeometry(0.085, 7, 5), dark);
    head.position.set(0.19, 0.28, 0); animal.add(head);
    for (const x of [-0.12, 0.12]) for (const z of [-0.095, 0.095]) {
      const leg = new Mesh(new CylinderGeometry(0.018, 0.02, 0.13, 5), dark);
      leg.position.set(x, 0.09, z); animal.add(leg);
    }
    this.addActor(animal, "animal", pasture.group.position.x + (this.random() - 0.5) * 0.16, pasture.group.position.z + (this.random() - 0.5) * 0.16, 0.12);
  }

  private findPathOrigin(x = 0, z = 0) {
    const candidates = [...this.pathTiles].map(key => this.tileByCoord.get(key)).filter((tile): tile is Tile => Boolean(tile));
    candidates.sort((a, b) => Math.hypot(a.group.position.x - x, a.group.position.z - z) - Math.hypot(b.group.position.x - x, b.group.position.z - z));
    return candidates[0] ? new Vector3(candidates[0].group.position.x, 0.02, candidates[0].group.position.z) : new Vector3(0, 0.02, 0);
  }

  private buildActorRoute(x: number, z: number): Vector3[] {
    const pathCells = [...this.pathTiles].map(key => this.tileByCoord.get(key)).filter((tile): tile is Tile => Boolean(tile && tile.group.visible));
    if (pathCells.length < 2) return pathCells.map(tile => new Vector3(tile.group.position.x, 0.02, tile.group.position.z));
    const start = pathCells.reduce((nearest, tile) => Math.hypot(tile.group.position.x - x, tile.group.position.z - z) < Math.hypot(nearest.group.position.x - x, nearest.group.position.z - z) ? tile : nearest);
    const startKey = this.key(start.x, start.z);
    const queue = [start];
    const previous = new Map<string, string | undefined>([[startKey, undefined]]);
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
    let farthest = start;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      farthest = current;
      for (const [dx, dz] of directions) {
        const next = this.tileByCoord.get(this.key(current.x + dx, current.z + dz));
        if (!next || !next.group.visible) continue;
        const nextKey = this.key(next.x, next.z);
        if (!this.pathTiles.has(nextKey) || previous.has(nextKey)) continue;
        previous.set(nextKey, this.key(current.x, current.z));
        queue.push(next);
      }
    }
    const route: Tile[] = [];
    let key: string | undefined = this.key(farthest.x, farthest.z);
    while (key !== undefined) {
      const tile = this.tileByCoord.get(key);
      if (tile) route.push(tile);
      key = previous.get(key);
    }
    return route.reverse().map(tile => new Vector3(tile.group.position.x, 0.02, tile.group.position.z));
  }

  private refreshActorRoutes() {
    for (const actor of this.actors) {
      if (actor.kind === "wagon" || actor.kind === "car" || (actor.kind === "person" && actor.walks)) actor.route = this.buildActorRoute(actor.x, actor.z);
    }
  }

  private addWagon() {
    if (this.actors.filter(actor => actor.kind === "wagon").length >= 3) return;
    const wagon = new Group();
    const wood = mat(0x68482d, 1);
    const horse = new Mesh(new SphereGeometry(0.12, 8, 6), mat(0x78543a, 1));
    horse.scale.set(1.4, 0.9, 0.7); horse.position.set(-0.28, 0.2, 0); wagon.add(horse);
    const head = new Mesh(new SphereGeometry(0.065, 6, 5), wood); head.position.set(-0.43, 0.3, 0); wagon.add(head);
    this.box(wagon, 0.42, 0.12, 0.3, 0, 0.12, 0.28, 0, wood);
    for (const z of [-0.19, 0.19]) {
      const wheel = new Mesh(new CylinderGeometry(0.14, 0.14, 0.055, 10), mat(0x392d23, 1));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(0.1, 0.16, z); wagon.add(wheel);
    }
    const origin = this.findPathOrigin();
    this.addActor(wagon, "wagon", origin.x, origin.z, 0);
  }

  private addCar() {
    if (this.actors.filter(actor => actor.kind === "car").length >= 4) return;
    const car = new Group();
    const paint = mat(this.color(this.theme.house), 0.4, { metalness: 0.2 });
    this.box(car, 0.56, 0.18, 0.3, 0, 0, 0.18, 0, paint);
    this.box(car, 0.29, 0.17, 0.25, 0, -0.015, 0.34, 0, mat(this.theme.window[0], 0.25, { metalness: 0.12 }));
    for (const wx of [-0.19, 0.19]) for (const wz of [-0.16, 0.16]) {
      const wheel = new Mesh(new CylinderGeometry(0.055, 0.055, 0.045, 8), mat(0x25282a, 0.95));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(wx, 0.08, wz); car.add(wheel);
    }
    const origin = this.findPathOrigin();
    this.addActor(car, "car", origin.x, origin.z, 0);
  }

  private addBlimp(index: number) {
    const blimp = new Group();
    const envelope = new Mesh(new SphereGeometry(0.48, 12, 8), mat(this.theme.accent, 0.58));
    envelope.scale.set(1.8, 0.7, 0.72); blimp.add(envelope);
    const gondola = new Mesh(new BoxGeometry(0.42, 0.11, 0.15), mat(0x604a36, 0.85));
    gondola.position.y = -0.36; blimp.add(gondola);
    for (const x of [-0.13, 0.13]) {
      const cable = new Mesh(new CylinderGeometry(0.012, 0.012, 0.22, 4), mat(0x514538));
      cable.position.set(x, -0.24, 0); blimp.add(cable);
    }
    this.addActor(blimp, "blimp", (index - 0.5) * 2, -2, 5.5 + index);
  }

  private unlockTechnology(era: number) {
    const previousEra = this.technologyEra;
    this.technologyEra = Math.max(this.technologyEra, Math.min(6, era));
    this.upgradePaths();
    if (this.technologyEra > previousEra && this.technologyEra >= 1) this.expandPlot();
    if (this.technologyEra > previousEra && this.technologyEra >= 2) this.tryRenewDistrict();
    if (this.technologyEra === 1) {
      const firstHome = this.tiles.find(tile => tile.building && tile.kind === "house");
      if (firstHome) { this.addAnimal(firstHome); this.addAnimal(firstHome); }
    }
    if (this.technologyEra === 2) {
      this.addWagon();
      this.addWagon();
    } else if (this.technologyEra === 3) {
      this.addWagon();
    } else if (this.technologyEra === 4) {
      this.addCar();
      this.addCar();
    } else if (this.technologyEra === 5) {
      this.addBlimp(0);
      this.addBlimp(1);
    } else if (this.technologyEra === 6) {
      this.addCar();
      this.addBlimp(2);
    }
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
          this.disposeTree(tile.building);
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

  private updateActors(delta: number) {
    this.actorClock += delta;
    this.campfire?.children.forEach(child => {
      if (!(child instanceof Mesh) || child.userData.firePhase === undefined) return;
      const phase = (child.userData.firePhase as number) + this.actorClock * 5;
      child.scale.set(0.9 + Math.sin(phase) * 0.15, 0.82 + Math.sin(phase * 1.3) * 0.28, 0.9 + Math.cos(phase) * 0.15);
    });
    for (const actor of this.actors) {
      const time = this.actorClock;
      if (actor.kind === "person" && actor.walks) {
        this.moveAlongPath(actor, delta, 0.17);
      } else if (actor.kind === "person" || actor.kind === "animal") {
        const speed = actor.kind === "person" ? 0.42 : 0.8;
        actor.group.position.x = actor.x + Math.sin(time * speed + actor.phase) * actor.range;
        actor.group.position.z = actor.z + Math.cos(time * speed * 0.72 + actor.phase) * actor.range * 0.65;
        actor.group.position.y = 0.02 + Math.abs(Math.sin(time * (actor.kind === "person" ? 1.7 : 3) + actor.phase)) * 0.025;
        actor.group.rotation.y = Math.sin(time * 0.6 + actor.phase) * 0.45;
      } else if (actor.kind === "blimp") {
        actor.group.position.x = actor.x + Math.sin(time * 0.11 + actor.phase) * actor.range;
        actor.group.position.z = actor.z + Math.cos(time * 0.08 + actor.phase) * actor.range * 0.55;
        actor.group.position.y = 5.1 + Math.sin(time * 0.28 + actor.phase) * 0.28;
        actor.group.rotation.y = Math.sin(time * 0.11 + actor.phase) * 0.18;
      } else {
        this.moveAlongPath(actor, delta, actor.kind === "car" ? 0.48 : 0.22);
      }
    }
  }

  private moveAlongPath(actor: CivicActor, delta: number, speed: number) {
    const route = actor.route ?? [];
    if (route.length < 2) return;
    const span = route.length - 1;
    const cycle = span * 2;
    actor.routeProgress = ((actor.routeProgress ?? 0) + delta * speed) % cycle;
    const position = actor.routeProgress <= span ? actor.routeProgress : cycle - actor.routeProgress;
    const index = Math.min(span - 1, Math.floor(position));
    const fraction = position - index;
    const from = route[index];
    const to = route[index + 1];
    actor.group.position.lerpVectors(from, to, fraction);
    if (this.technologyEra >= 4 && actor.kind === "person") {
      const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.z - from.z);
      if (horizontal) actor.group.position.z += 0.32;
      else actor.group.position.x += 0.32;
    }
    actor.group.position.y = 0.02;
    actor.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
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

  private makeHouse(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const era = this.eraIndex;
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
    const style = this.random();
    const floors = era === 2 ? (style > 0.72 ? 4 : 2)
      : era === 3 ? (style > 0.68 ? 6 : 3)
      : era === 4 ? (style > 0.72 ? 7 : style > 0.4 ? 5 : 3)
      : Math.floor(4 + this.random() * 5);
    const floorHeight = era < 4 ? 0.6 : 0.68;
    const height = 0.28 + floors * floorHeight;
    const wall = mat(this.color(this.theme.house), era >= 4 ? 0.45 : 0.82, era >= 4 ? { metalness: 0.18 } : {});
    this.box(building, width + 0.12, 0.13, depth + 0.12, this.theme.stone, 0, 0.14, 0);
    this.box(building, width, height, depth, 0, 0, height / 2 + 0.16, 0, wall);
    const windowRows = Math.max(1, floors - (era < 3 ? 0 : 1));
    this.addWindows(building, width, depth, height, windowRows, era >= 3 ? 3 : 2);
    this.box(building, 0.19, 0.38, 0.045, 0x624737, 0, 0.35, depth / 2 + 0.026);

    if (era < 4 && style < 0.66) {
      const roofColor = this.color(this.theme.roof);
      const roofHeight = 0.52;
      const roof = new Mesh(new ConeGeometry(Math.max(width, depth) * 0.79, roofHeight, 4), mat(roofColor));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = height + 0.16 + roofHeight / 2;
      roof.castShadow = true;
      building.add(roof);
      if (this.random() > 0.42) {
        const chimney = this.box(building, 0.1, 0.24, 0.1, this.color(this.theme.roof), width * 0.22, height + 0.35, -depth * 0.12);
        chimney.castShadow = true;
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
      if (style > 0.84) {
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
    if (era > 1) this.addThemeDetails(building, 0.75, 2.5, 0.75, era);
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
    return true;
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
    building.userData.buildElapsed = immediate ? 1 : 0;
    building.userData.tile = tile;
    building.scale.set(1, immediate ? 1 : 0.02, 1);
    building.position.y = immediate ? 0 : 0.49;
  }

  build(kind: "house" | "landmark", count: number, immediate = false) {
    for (let n = 0; n < Math.min(30, Math.max(0, count)); n++) {
      const hearthTile = this.tiles.find(tile => tile.kind === "landmark" && !tile.building);
      const canUseLot = (tile: Tile) => tile.group.visible && tile.kind === "empty"
        && !this.pathTiles.has(this.key(tile.x, tile.z))
        && !this.actorTiles.has(this.key(tile.x, tile.z))
        && (!hearthTile || Math.abs(tile.x - hearthTile.x) + Math.abs(tile.z - hearthTile.z) > 1)
        && this.accessNeighbors(tile).some(neighbor => neighbor.tile?.group.visible && !neighbor.tile.building && (neighbor.tile.kind === "empty" || this.pathTiles.has(this.key(neighbor.tile.x, neighbor.tile.z))));
      let available = this.tiles.filter(canUseLot);
      if (!available.length && this.activeRadius < 15.5) {
        this.expandPlot();
        available = this.tiles.filter(canUseLot);
      }
      if (!available.length) return;
      const occupied = this.tiles.filter(tile => (tile.building && tile.kind !== "fire") || tile === hearthTile);
      const near = available.filter(tile => !occupied.length || occupied.some(other => Math.abs(tile.x - other.x) + Math.abs(tile.z - other.z) <= 3));
      const pool = (near.length ? near : available).filter(tile => this.findAccessPlan(tile));
      if (!pool.length) return;
      const tile = pool[Math.floor(this.random() * pool.length)];
      for (const tree of tile.trees) tile.group.remove(tree);
      tile.trees = [];
      const built = kind === "house" ? this.makeHouse(tile, immediate) : this.makeLandmark(tile, immediate);
      if (!built) continue;
      this.totalBuildings++;
      if (this.technologyEra <= 1 && this.totalBuildings % 2 === 0) this.addAnimal(tile);
      if (this.totalBuildings % 3 === 0) this.addPerson(tile, this.totalBuildings, true);
    }
    this.tryRenewDistrict();
  }

  boom(viewers: number, historical = false) {
    const count = Math.min(24, Math.max(2, Math.ceil(viewers / 5)));
    this.build("house", count, historical);
    if (!historical) this.fireworks(0, 0, Math.min(2.8, 0.8 + viewers / 800));
  }

  disaster(intensity: number, historical = false, damageCount?: number, durationMs = 3600) {
    const occupied = this.tiles.filter(tile => tile.building && (tile.kind === "house" || tile.kind === "landmark"));
    const count = Math.min(occupied.length, Math.max(1, damageCount ?? Math.ceil(intensity * 2.4)));
    const seed = occupied[Math.floor(this.random() * occupied.length)];
    const damageNoise = new Map(occupied.map(tile => [tile, this.random()]));
    const damageSet = seed
      ? occupied.sort((a, b) => {
          const distanceA = Math.abs(a.x - seed.x) + Math.abs(a.z - seed.z) + (damageNoise.get(a) ?? 0) * 0.25;
          const distanceB = Math.abs(b.x - seed.x) + Math.abs(b.z - seed.z) + (damageNoise.get(b) ?? 0) * 0.25;
          return distanceA - distanceB;
        }).slice(0, count)
      : [];
    for (const tile of damageSet) {
      if (historical) this.destroyBuilding(tile);
      else { tile.kind = "fire"; tile.burningUntil = performance.now() + durationMs; this.addFlames(tile); }
    }
  }

  private addFlames(tile: Tile) {
    const flames = new Group();
    for (let i = 0; i < 5; i++) {
      const flame = new Mesh(new ConeGeometry(0.12 + this.random() * 0.1, 0.45 + this.random() * 0.4, 6), mat(i % 2 ? 0xff9b42 : 0xffdf76, 0.4, { emissive: 0xff5c19, emissiveIntensity: 1.3 }));
      flame.position.set((this.random() - 0.5) * 0.55, 0.5 + this.random() * 0.6, (this.random() - 0.5) * 0.55);
      flame.userData.phase = this.random() * Math.PI * 2;
      flames.add(flame);
    }
    const light = new PointLight(0xff6a32, 1.8, 3.2, 2);
    light.position.y = 1.1;
    flames.add(light);
    tile.building?.add(flames);
    if (tile.building) tile.building.userData.flames = flames;
  }

  fireworks(x: number, z: number, intensity: number) {
    const origin = new Vector3(x, 2.2, z);
    const colorList = [0xffcb6b, 0xe98770, 0x89d4c5, 0x99b9e6, 0xf1e6c4];
    const amount = Math.min(70, Math.max(18, Math.round(24 * intensity)));
    for (let i = 0; i < amount; i++) {
      const color = colorList[Math.floor(this.random() * colorList.length)];
      const mesh = new Mesh(new SphereGeometry(0.045 + this.random() * 0.03, 6, 6), mat(color, 0.24, { emissive: color, emissiveIntensity: 1.8 }));
      mesh.position.copy(origin);
      this.scene.add(mesh);
      const velocity = new Vector3((this.random() - 0.5) * 4.2, this.random() * 3 + 1.6, (this.random() - 0.5) * 4.2);
      const life = 0.8 + this.random() * 0.8;
      this.particles.push({ mesh, velocity, life, maxLife: life, gravity: 4.2 });
    }
  }

  apply(event: SimEvent, historical = false) {
    if (event.type === "advancement") this.unlockTechnology(event.era);
    else if (event.type === "build") this.build(event.kind, event.count, historical);
    else if (event.type === "boom") this.boom(event.viewers, historical);
    else if (event.type === "disaster") this.disaster(event.intensity, historical, event.damageCount, event.durationMs);
    else if (event.type === "effect" && !historical) this.fireworks(0, 0, event.intensity);
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
      }
      const building = tile.building;
      if (!building) continue;
      const elapsed = (building.userData.buildElapsed ?? 0) + delta;
      building.userData.buildElapsed = elapsed;
    const progress = Math.min(1, elapsed / 0.82);
      const eased = progress < 1 ? 1 - Math.pow(1 - progress, 4) : 1;
      const bounce = progress < 1 ? 0.065 * Math.sin(progress * Math.PI) * (1 - progress) : 0;
      building.scale.y = 0.02 + eased * 0.98 + bounce;
      building.position.y = (1 - building.scale.y) * 0.5;

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
          } else if (child instanceof PointLight) child.intensity = 1.55 + 0.45 * Math.sin(performance.now() * 0.012);
        });
        if (tile.burningUntil && performance.now() >= tile.burningUntil) this.destroyBuilding(tile);
      }
    }
  }

  private destroyBuilding(tile: Tile) {
    if (tile.building) {
      tile.group.remove(tile.building);
      this.disposeTree(tile.building);
      tile.building = undefined;
    }
    tile.kind = "empty";
    tile.burningUntil = undefined;
    if (this.random() > 0.45) this.addTree(tile, (this.random() - 0.5) * 0.36, (this.random() - 0.5) * 0.36, 0.45 + this.random() * 0.35);
  }

  private disposeTree(group: Object3D) {
    group.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
  }

  private updateParticles(delta: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= delta;
      particle.velocity.y -= particle.gravity * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      const alpha = Math.max(0, particle.life / particle.maxLife);
      particle.mesh.scale.setScalar(alpha);
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.disposeTree(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private animate = () => {
    if (this.destroyed) return;
    const now = performance.now();
    const delta = Math.min((now - this.previousFrame) / 1000, 0.05);
    this.previousFrame = now;
    const oldSpan = this.viewSpan;
    this.viewSpan += (this.targetSpan - this.viewSpan) * (1 - Math.exp(-3.6 * delta));
    if (Math.abs(oldSpan - this.viewSpan) > 0.001) this.updateCameraFrustum();
    this.updateBuildings(delta);
    this.updateActors(delta);
    this.updateParticles(delta);
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.destroyed = true;
    window.removeEventListener("resize", this.resize);
    this.resizeObserver?.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}
