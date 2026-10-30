import { ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, IcosahedronGeometry, LineBasicMaterial, LineLoop, Mesh, MeshStandardMaterial, OctahedronGeometry, OrthographicCamera, PCFShadowMap, PlaneGeometry, PointLight, SRGBColorSpace, Scene, SphereGeometry, Vector3, WebGLRenderer } from "three";
import type { ColorRepresentation, Material, MeshStandardMaterialParameters, Object3D } from "three";
import type { SimEvent } from "../src/types.js";

type TileKind = "empty" | "house" | "landmark" | "fire";
type Tile = { x: number; z: number; kind: TileKind; road: boolean; group: Group; building?: Group; trees: Group[]; burningUntil?: number; revealing?: boolean; revealElapsed?: number };
type Particle = { mesh: Mesh; velocity: Vector3; life: number; maxLife: number; gravity: number };
type PathSegment = { mesh: Mesh; length: number; horizontal: boolean };
type CivicActor = { group: Group; kind: "animal" | "wagon" | "car" | "blimp"; x: number; z: number; phase: number; range: number };

const GRID = 32;
export const CITY_THEMES = {
  ancient: { label: "Ancient Empire", sky: 0x111f2a, grass: [0x355849, 0x3b604d, 0x41634f, 0x345348], road: [0x344047, 0x38434a, 0x303c42], house: [0xc99664, 0xb87d54, 0xd4bd8f, 0x9b765b], roof: [0x806041, 0x8b5a48, 0x67554a], window: [0xffd27c, 0xffe8b1, 0xf4c36f], stone: 0xb79a72, foliage: [0x538462, 0x67966c, 0x3e735e], accent: 0xd7b36c, glow: 0xf3b96e },
  fantasy: { label: "Mythic Realm", sky: 0x181c36, grass: [0x344e48, 0x405754, 0x454b66], road: [0x34394d, 0x3e4056, 0x303646], house: [0x8e83aa, 0xb07d86, 0x7f9d99, 0xc2a77a], roof: [0x554b74, 0x7d526e, 0x46616e], window: [0x8ff0e0, 0xd8afff, 0xffd982], stone: 0x9e9fb8, foliage: [0x5b977d, 0x609c8c, 0x4a806e], accent: 0xa8efd7, glow: 0x75e4dc },
  solarpunk: { label: "Solarpunk Haven", sky: 0x14272b, grass: [0x416448, 0x4f7050, 0x3f6048], road: [0x3a4744, 0x424e49, 0x35433e], house: [0xc5a679, 0xb8c18e, 0x8eb29d, 0xe0c18b], roof: [0x54725b, 0x66815e, 0x927650], window: [0xffd98a, 0xb8efe2, 0xffecb5], stone: 0xa9b294, foliage: [0x69a46f, 0x81b67d, 0x508769], accent: 0x9de5be, glow: 0x92efc5 },
  cyberpunk: { label: "Neon Megacity", sky: 0x100f25, grass: [0x253445, 0x29364b, 0x293347], road: [0x29283d, 0x323048, 0x242438], house: [0x566682, 0x66547d, 0x486e78, 0x80607e], roof: [0x37364f, 0x4d385c, 0x344859], window: [0x52f2e1, 0xff77cc, 0xffc46e], stone: 0x737594, foliage: [0x3b806e, 0x52896c, 0x416d71], accent: 0xff77cc, glow: 0x42e8ec }
} as const;
export type CityThemeId = keyof typeof CITY_THEMES;
export function themeFromSearch(search = window.location.search): CityThemeId {
  const choice = new URLSearchParams(search).get("theme");
  return choice && choice in CITY_THEMES ? choice as CityThemeId : "ancient";
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
  private actors: CivicActor[] = [];
  private actorClock = 0;
  private activeRadius = 4.5;
  private totalBuildings = 0;
  private technologyEra = 0;
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
    this.seedFoundingHall();
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

  private get eraIndex(): number { return this.technologyEra; }

  get stage(): string {
    return ["FOUNDING VILLAGE", "VILLAGE & FARMING", "BRONZE & MASONRY", "CLASSICAL KINGDOM", "INDUSTRIAL CITY", "AGE OF AIRSHIPS", "EMPIRE"][this.eraIndex];
  }

  get themeName(): string { return this.theme.label.toUpperCase(); }
  get selectedThemeId(): CityThemeId { return this.themeId; }

  get landArea(): number { return this.tiles.filter(tile => tile.group.visible).length; }

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

  private seedFoundingHall() {
    const tile = this.tileByCoord.get(this.key(15, 15));
    if (!tile) return;
    this.makeLandmark(tile);
    this.totalBuildings = 1;
  }

  private expandPlot() {
    if (this.activeRadius >= 15.5) return;
    this.setActiveRadius(Math.min(15.5, this.activeRadius + 2));
  }

  private addPathSegment(from: Vector3, to: Vector3) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.5) return;
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const length = Math.max(0.22, Math.abs(horizontal ? dx : dz));
    const mesh = new Mesh(new BoxGeometry(1, 0.018, 1), mat(this.theme.road[0], 1));
    mesh.position.set((from.x + to.x) / 2, 0.014, (from.z + to.z) / 2);
    this.root.add(mesh);
    this.paths.push({ mesh, length, horizontal });
    this.stylePath(mesh, length, horizontal);
  }

  private stylePath(mesh: Mesh, length: number, horizontal: boolean) {
    const era = this.technologyEra;
    const width = era < 2 ? 0.1 + era * 0.025 : era === 2 ? 0.16 : era === 3 ? 0.21 : 0.27;
    mesh.geometry.dispose();
    mesh.geometry = new BoxGeometry(horizontal ? length : width, 0.018, horizontal ? width : length);
    const surface = era < 2 ? (era === 0 ? 0x79623e : 0x8c7955)
      : era === 2 ? 0x807c6c
      : era === 3 ? this.theme.road[0]
      : this.theme.road[1];
    const material = mesh.material as MeshStandardMaterial;
    material.color.setHex(surface);
    material.roughness = era < 3 ? 1 : 0.82;
  }

  private connectNewBuilding(tile: Tile) {
    const existing = this.tiles.filter(other => other !== tile && other.building && other.kind !== "fire");
    if (!existing.length) return;
    const target = new Vector3(tile.group.position.x, 0.014, tile.group.position.z);
    const sourceTile = existing.reduce((nearest, other) => {
      const distance = Math.abs(tile.x - other.x) + Math.abs(tile.z - other.z);
      const nearestDistance = Math.abs(tile.x - nearest.x) + Math.abs(tile.z - nearest.z);
      return distance < nearestDistance ? other : nearest;
    });
    const source = new Vector3(sourceTile.group.position.x, 0.014, sourceTile.group.position.z);
    const corner = new Vector3(target.x, 0.014, source.z);
    this.addPathSegment(source, corner);
    this.addPathSegment(corner, target);
  }

  private upgradePaths() {
    for (const path of this.paths) this.stylePath(path.mesh, path.length, path.horizontal);
  }

  private addActor(group: Group, kind: CivicActor["kind"], x: number, z: number, range = 1.2) {
    group.position.set(x, kind === "blimp" ? 5.1 : 0.02, z);
    this.root.add(group);
    this.actors.push({ group, kind, x, z, phase: this.random() * Math.PI * 2, range });
  }

  private addAnimal(tile: Tile) {
    if (this.actors.filter(actor => actor.kind === "animal").length >= 8) return;
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
    this.addActor(animal, "animal", tile.group.position.x + (this.random() - 0.5) * 0.6, tile.group.position.z + (this.random() - 0.5) * 0.6, 0.42);
  }

  private addWagon(tile: Tile) {
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
    this.addActor(wagon, "wagon", tile.group.position.x, tile.group.position.z, 1.8);
  }

  private addCar(x: number, z: number) {
    if (this.actors.filter(actor => actor.kind === "car").length >= 4) return;
    const car = new Group();
    const paint = mat(this.color(this.theme.house), 0.4, { metalness: 0.2 });
    this.box(car, 0.56, 0.18, 0.3, 0, 0, 0.18, 0, paint);
    this.box(car, 0.29, 0.17, 0.25, 0, -0.015, 0.34, 0, mat(this.theme.window[0], 0.25, { metalness: 0.12 }));
    for (const wx of [-0.19, 0.19]) for (const wz of [-0.16, 0.16]) {
      const wheel = new Mesh(new CylinderGeometry(0.055, 0.055, 0.045, 8), mat(0x25282a, 0.95));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(wx, 0.08, wz); car.add(wheel);
    }
    this.addActor(car, "car", x, z, 2.6);
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
    this.technologyEra = Math.max(this.technologyEra, Math.min(6, era));
    this.upgradePaths();
    if (this.technologyEra === 1) {
      const huts = this.tiles.filter(tile => tile.building && tile.kind === "landmark");
      if (huts[0]) { this.addAnimal(huts[0]); this.addAnimal(huts[0]); }
    }
    if (this.technologyEra === 2) {
      this.expandPlot();
      const home = this.tiles.find(tile => tile.building) ?? this.tiles[0];
      this.addWagon(home);
      this.addWagon(home);
    } else if (this.technologyEra === 3) {
      this.expandPlot();
      const home = this.tiles.find(tile => tile.building) ?? this.tiles[0];
      this.addWagon(home);
    } else if (this.technologyEra === 4) {
      this.expandPlot();
      this.addCar(0, 0);
      this.addCar(1, 1);
    } else if (this.technologyEra === 5) {
      this.expandPlot();
      this.addBlimp(0);
      this.addBlimp(1);
    } else if (this.technologyEra === 6) {
      this.expandPlot();
      this.addCar(-2, 1);
      this.addBlimp(2);
    }
  }

  private updateActors(delta: number) {
    this.actorClock += delta;
    for (const actor of this.actors) {
      const time = this.actorClock;
      if (actor.kind === "animal") {
        actor.group.position.x = actor.x + Math.sin(time * 0.8 + actor.phase) * actor.range;
        actor.group.position.z = actor.z + Math.cos(time * 0.57 + actor.phase) * actor.range * 0.65;
        actor.group.position.y = 0.02 + Math.abs(Math.sin(time * 3 + actor.phase)) * 0.025;
        actor.group.rotation.y = Math.sin(time * 0.6 + actor.phase) * 0.45;
      } else if (actor.kind === "blimp") {
        actor.group.position.x = actor.x + Math.sin(time * 0.11 + actor.phase) * actor.range;
        actor.group.position.z = actor.z + Math.cos(time * 0.08 + actor.phase) * actor.range * 0.55;
        actor.group.position.y = 5.1 + Math.sin(time * 0.28 + actor.phase) * 0.28;
        actor.group.rotation.y = Math.sin(time * 0.11 + actor.phase) * 0.18;
      } else {
        const speed = actor.kind === "car" ? 0.34 : 0.2;
        const angle = time * speed + actor.phase;
        actor.group.position.x = actor.x + Math.sin(angle) * actor.range;
        actor.group.position.z = actor.z + Math.cos(angle * 0.84) * actor.range * 0.64;
        actor.group.position.y = 0.02;
        actor.group.rotation.y = Math.atan2(Math.cos(angle) * actor.range * speed, -Math.sin(angle * 0.84) * actor.range * 0.64 * speed);
      }
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

  private makeHouse(tile: Tile, immediate = false) {
    const building = new Group();
    const era = this.eraIndex;
    if (era <= 1 && this.themeId === "ancient") {
      this.makeAncientHut(building);
      tile.group.add(building);
      tile.building = building;
      tile.kind = "house";
      this.animateBuild(building, tile, immediate);
      return;
    }
    const width = 0.72 + this.random() * 0.2;
    const depth = 0.72 + this.random() * 0.2;
    const style = this.random();
    const floors = era === 0 ? (style > 0.7 ? 2 : 1)
      : era === 1 ? (style > 0.65 ? 3 : 2)
      : era === 2 ? (style > 0.72 ? 4 : 2)
      : era === 3 ? (style > 0.68 ? 6 : 3)
      : era === 4 ? (style > 0.72 ? 7 : style > 0.4 ? 5 : 3)
      : Math.floor(4 + this.random() * 5);
    const floorHeight = era < 2 ? 0.52 : era < 4 ? 0.6 : 0.68;
    const height = 0.28 + floors * floorHeight;
    const wall = mat(this.color(this.theme.house), era >= 4 ? 0.45 : 0.82, era >= 4 ? { metalness: 0.18 } : {});
    this.box(building, width + 0.12, 0.13, depth + 0.12, this.theme.stone, 0, 0.14, 0);
    this.box(building, width, height, depth, 0, 0, height / 2 + 0.16, 0, wall);
    const windowRows = Math.max(1, floors - (era < 2 ? 0 : 1));
    this.addWindows(building, width, depth, height, windowRows, era >= 3 ? 3 : 2);
    this.box(building, 0.19, 0.38, 0.045, era < 2 ? 0x765037 : 0x624737, 0, 0.35, depth / 2 + 0.026);

    if (era < 4 && (style < 0.66 || era < 2)) {
      const roofColor = era === 0 && this.themeId === "ancient" ? 0x97764e : this.color(this.theme.roof);
      const roofHeight = era < 2 ? 0.36 : 0.52;
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
      const capColor = era >= 4 && this.themeId === "cyberpunk" ? 0x31314d : 0x384a4b;
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
    this.addThemeDetails(building, width, height, depth);
    tile.group.add(building);
    tile.building = building;
    tile.kind = "house";
    this.animateBuild(building, tile, immediate);
  }

  private makeAncientHut(building: Group) {
    const plaster = mat(this.color([0xb59a69, 0xa78658, 0xc0a775, 0x92744f]), 1);
    const thatchColors = [0x9d7945, 0xb28c50, 0xc09a59, 0x886b40];
    const wood = mat(0x513925, 1);
    this.box(building, 1.02, 0.11, 0.98, 0x756044, 0, 0.11, 0);
    const walls = new Mesh(new CylinderGeometry(0.42, 0.49, 0.68, 9, 1), plaster);
    walls.position.y = 0.48;
    walls.castShadow = true;
    walls.receiveShadow = true;
    building.add(walls);

    // Exposed timber uprights and a rough ring beam make the hut read as hand-built.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      this.box(building, 0.075, 0.82, 0.075, 0, Math.cos(angle) * 0.45, 0.53, Math.sin(angle) * 0.45, wood);
    }
    const ringBeam = new Mesh(new CylinderGeometry(0.5, 0.5, 0.075, 9), wood);
    ringBeam.position.y = 0.88;
    building.add(ringBeam);

    const roofColor = this.color(thatchColors);
    const roof = new Mesh(new ConeGeometry(0.72, 0.78, 9), mat(roofColor, 1));
    roof.position.y = 1.18;
    roof.castShadow = true;
    building.add(roof);
    // Short straw-colored ribs break up the smooth cone and catch the light.
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const rib = new Mesh(new CylinderGeometry(0.018, 0.026, 0.73, 4), mat(this.color(thatchColors), 1));
      rib.position.set(Math.cos(angle) * 0.36, 1.22, Math.sin(angle) * 0.36);
      rib.rotation.z = -Math.cos(angle) * 0.42;
      rib.rotation.x = Math.sin(angle) * 0.42;
      building.add(rib);
    }
    const door = this.box(building, 0.21, 0.42, 0.055, 0, 0, 0.35, 0.47, wood);
    door.rotation.y = 0.08;

    // A shared cooking fire sits just outside each home, ringed with stones and kindling.
    const hearth = new Group();
    hearth.position.set(0.49, 0.1, 0.53);
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      const stone = new Mesh(new IcosahedronGeometry(0.075, 0), mat(i % 2 ? 0x786f58 : 0x938366));
      stone.scale.set(1.2, 0.7, 0.9);
      stone.position.set(Math.cos(angle) * 0.22, 0, Math.sin(angle) * 0.22);
      hearth.add(stone);
    }
    const logA = new Mesh(new CylinderGeometry(0.035, 0.045, 0.34, 6), wood);
    logA.rotation.z = Math.PI / 2; logA.rotation.y = 0.4; hearth.add(logA);
    const logB = logA.clone(); logB.rotation.y = -0.5; hearth.add(logB);
    for (let i = 0; i < 3; i++) {
      const flame = new Mesh(new ConeGeometry(0.075 - i * 0.012, 0.25 + i * 0.08, 6), mat(i === 1 ? 0xffa43d : 0xffd26b, 0.45, { emissive: i === 1 ? 0xff4e14 : 0xf28a23, emissiveIntensity: 1.8 }));
      flame.position.set((i - 1) * 0.055, 0.17 + i * 0.035, (i % 2) * 0.045);
      flame.userData.hearthPhase = i * 1.7;
      hearth.add(flame);
    }
    building.add(hearth);
    building.userData.hearth = hearth;
  }

  private makeLandmark(tile: Tile, immediate = false) {
    const building = new Group();
    const era = this.eraIndex;
    const stone = mat(this.theme.stone, 0.65);
    if (era <= 1 && this.themeId === "ancient") {
      // The village keeps its shared timber-and-thatch lodge until stonework is unlocked.
      const lodge = new Group();
      this.makeAncientHut(lodge);
      lodge.scale.setScalar(1.4);
      building.add(lodge);
    } else if (era === 1) {
      this.box(building, 1.05, 0.3, 0.98, 0x8d7658, 0, 0.23, 0);
      this.box(building, 0.88, 0.8, 0.82, 0, 0, 0.78, 0, stone);
      this.addWindows(building, 0.88, 0.82, 0.8, 2, 3);
      for (const x of [-0.32, 0.32]) {
        const column = new Mesh(new CylinderGeometry(0.055, 0.065, 1.0, 10), mat(0xd6c49c));
        column.position.set(x, 0.75, 0.43); building.add(column);
      }
      const dome = new Mesh(new SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(this.theme.accent, 0.44, { metalness: 0.2 }));
      dome.position.y = 1.2; dome.castShadow = true; building.add(dome);
    } else if (era === 2) {
      this.box(building, 0.96, 0.4, 0.96, 0, 0, 0.28, 0, stone);
      this.box(building, 0.62, 2.5, 0.62, 0, 0, 1.73, 0, mat(0x77736b));
      this.addWindows(building, 0.62, 0.62, 2.5, 5, 2);
      for (const [x, z] of [[-0.29,-0.29],[0.29,-0.29],[-0.29,0.29],[0.29,0.29]]) {
        this.box(building, 0.18, 0.36, 0.18, 0x625d57, x, 3.16, z);
      }
      this.box(building, 0.82, 0.12, 0.82, 0x625d57, 0, 2.99, 0);
      const flag = this.box(building, 0.025, 0.75, 0.025, this.theme.accent, 0, 3.55, 0);
      this.box(building, 0.34, 0.22, 0.025, this.theme.accent, 0.13, 3.78, 0);
      flag.castShadow = true;
    } else if (era === 3) {
      const brick = mat(this.theme.house[1], 0.88);
      this.box(building, 0.92, 2.25, 0.82, 0, 0, 1.205, 0, brick);
      this.addWindows(building, 0.92, 0.82, 2.25, 5, 3);
      const clock = new Mesh(new CylinderGeometry(0.19, 0.19, 0.035, 16), mat(0xe6d09a, 0.4));
      clock.rotation.x = Math.PI / 2; clock.position.set(0, 2.05, 0.43); building.add(clock);
      this.box(building, 0.28, 1.1, 0.28, 0x6a5548, 0.27, 2.9, -0.12);
      const smoke = new Mesh(new ConeGeometry(0.22, 0.48, 8), mat(0x69584d));
      smoke.position.set(0.27, 3.68, -0.12); building.add(smoke);
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
    this.addThemeDetails(building, 0.75, 2.5, 0.75);
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
  }

  private addThemeDetails(building: Group, width: number, height: number, depth: number) {
    if (this.themeId === "cyberpunk") {
      for (const x of [-width * 0.38, width * 0.38]) {
        const strip = new Mesh(new BoxGeometry(0.035, Math.min(height * 0.82, 3.4), 0.028), mat(this.theme.accent, 0.25, { emissive: this.theme.glow, emissiveIntensity: 1.7 }));
        strip.position.set(x, Math.min(height * 0.55, 1.8), depth / 2 + 0.03); building.add(strip);
      }
    } else if (this.themeId === "solarpunk") {
      const planter = this.box(building, width * 0.8, 0.06, depth * 0.7, 0x476c4d, 0, height + 0.28, 0);
      for (const x of [-0.18, 0.18]) {
        const plant = new Mesh(new ConeGeometry(0.09, 0.22, 5), mat(this.theme.accent));
        plant.position.set(x, height + 0.42, 0); building.add(plant);
      }
      planter.receiveShadow = true;
    } else if (this.themeId === "fantasy") {
      const crystal = new Mesh(new OctahedronGeometry(0.1), mat(this.theme.accent, 0.2, { emissive: this.theme.glow, emissiveIntensity: 1.3 }));
      crystal.position.set(0, height + 0.3, 0); building.add(crystal);
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
      let available = this.tiles.filter(tile => tile.group.visible && !tile.road && tile.kind === "empty");
      if (!available.length && this.activeRadius < 15.5) {
        this.expandPlot();
        available = this.tiles.filter(tile => tile.group.visible && !tile.road && tile.kind === "empty");
      }
      if (!available.length) return;
      const occupied = this.tiles.filter(tile => tile.kind === "house" || tile.kind === "landmark");
      const near = available.filter(tile => !occupied.length || occupied.some(other => Math.abs(tile.x - other.x) + Math.abs(tile.z - other.z) <= 3));
      const pool = near.length ? near : available;
      const tile = pool[Math.floor(this.random() * pool.length)];
      for (const tree of tile.trees) tile.group.remove(tree);
      tile.trees = [];
      this.connectNewBuilding(tile);
      if (kind === "house") this.makeHouse(tile, immediate); else this.makeLandmark(tile, immediate);
      this.totalBuildings++;
      if (this.themeId === "ancient" && this.technologyEra <= 1 && this.totalBuildings % 2 === 0) this.addAnimal(tile);
    }
  }

  boom(viewers: number, historical = false) {
    const count = Math.min(24, Math.max(2, Math.ceil(viewers / 5)));
    this.build("house", count, historical);
    if (!historical) this.fireworks(0, 0, Math.min(2.8, 0.8 + viewers / 800));
  }

  disaster(intensity: number, historical = false) {
    const occupied = this.tiles.filter(tile => tile.kind === "house" || tile.kind === "landmark");
    const count = Math.min(occupied.length, Math.max(1, Math.ceil(intensity * 1.5)));
    for (const tile of occupied.sort(() => this.random() - 0.5).slice(0, count)) {
      if (historical) this.destroyBuilding(tile);
      else { tile.kind = "fire"; tile.burningUntil = performance.now() + 2100; this.addFlames(tile); }
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
    else if (event.type === "disaster") this.disaster(event.intensity, historical);
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
