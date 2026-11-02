import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { StaticMerger } from "./merge.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { Quaternion, ACESFilmicToneMapping, BasicShadowMap, Box3, ShaderMaterial, BoxGeometry, DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, IcosahedronGeometry, LineBasicMaterial, LineLoop, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap, PlaneGeometry, PointLight, SRGBColorSpace, Scene, SphereGeometry, TorusGeometry, Vector3, WebGLRenderer } from "three";
import type { ColorRepresentation, Material, MeshStandardMaterialParameters } from "three";
import type { AttackKind, SimEvent } from "../src/types.js";
import type { CommunityProgress } from "../src/types.js";
import { HomeKit } from "./homes.js";
import { buildModernLandmark } from "./landmarks.js";
import { CAPITOL_NAMES, buildCapitol, capitolStyleFor } from "./capitol.js";
import type { CapitolDonor } from "../src/types.js";
import { SpecialKit } from "./specials.js";
import type { Animated } from "./specials.js";
import { bakeStatic, disposeObject, fitFootprint, grimeMaterial, scaleSharedGlow } from "./kit.js";
import { lightingAt, localHour } from "./daycycle.js";
import { CityLife } from "./life.js";
import type { Door, NetCell } from "./life.js";
import { DIRS, STREET_RANK, buildStreetLayer } from "./streets.js";
import type { StreetStyle } from "./streets.js";
import { CITY_THEMES } from "./theme.js";
import * as bustle from "./bustle.js";
import type { CityThemeId } from "./theme.js";

export { CITY_THEMES } from "./theme.js";
export type { CityThemeId } from "./theme.js";

type TileKind = "empty" | "house" | "landmark" | "fire";
type Tile = { x: number; z: number; kind: TileKind; road: boolean; group: Group; building?: Group; trees: Group[]; burningUntil?: number; revealing?: boolean; revealElapsed?: number; index: number;
  /** Rubble left by an attack, and who/what stood there, so chat can rebuild it first. */
  rubblePile?: Group; formerKind?: "house" | "landmark"; formerOwner?: string };
type Particle = { position: Vector3; velocity: Vector3; size: number; color: Color; life: number; maxLife: number; gravity: number; drag?: number };
const MAX_PARTICLES = 900;
type AccessPlan = { dx: number; dz: number; yaw: number; route: Tile[] };
/** `pixelSize` is how many screen pixels each rendered pixel covers (1 = smooth, 1.5 = default pixel art). */
export interface CityOptions {
  transparent?: boolean; zoom?: number; pixelSize?: number; maxFps?: number;
  /** IANA time zone for day and night; the viewer's own clock when omitted. */
  timeZone?: string;
  /** Pin the time of day (0-24) for demos and screenshots. */
  hour?: number;
}

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
  private lastShadowUpdate = 0;
  private static readonly SHADOW_UPDATE_MS = 100;
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
  /** Architecture family of the current theme. */
  private get style() { return this.theme.style; }
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
  /** Viewer camera: zoom multiplier and the ground point the camera looks at, both eased. */
  private userZoom = 1;
  private targetUserZoom = 1;
  private pan = new Vector3();
  private targetPan = new Vector3();
  private follow = false;
  static readonly MIN_ZOOM = 0.6;
  static readonly MAX_ZOOM = 8;

  constructor(private host: HTMLElement, themeId: CityThemeId = themeFromSearch(), options: CityOptions = {}) {
    this.themeId = themeId;
    this.theme = CITY_THEMES[themeId];
    this.transparent = Boolean(options.transparent);
    this.zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    this.maxFps = options.maxFps ?? 60;
    this.merger.enabled = new URLSearchParams(window.location.search).get("merge") !== "0";
    this.timeZone = options.timeZone;
    this.fixedHour = options.hour;
    this.randomState = [...themeId].reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    this.planStreetGrid();
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
    this.hemi = new HemisphereLight(0xc8e0e4, 0x30453a, 2.65);
    this.scene.add(this.hemi);
    const moon = new DirectionalLight(0xc4def0, 3.1);
    this.sun = moon;
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
    this.fill = warm;
  }

  // ---------- time of day and sleep ----------
  private hemi!: HemisphereLight;
  private sun!: DirectionalLight;
  private fill!: DirectionalLight;
  private timeZone?: string;
  private fixedHour?: number;
  private daylightClock = 0;
  private asleep = false;
  private fireScale = 1;
  private nightGlow = 1;

  /** Follow a time zone ("America/New_York"), or the viewer's own clock when undefined. */
  setTimeZone(timeZone?: string) { this.timeZone = timeZone; this.daylightClock = 0; }

  private updateDaylight(delta: number) {
    this.daylightClock -= delta;
    if (this.daylightClock > 0) return;
    this.daylightClock = 5;
    const light = lightingAt(this.fixedHour ?? localHour(this.timeZone));
    this.hemi.color.copy(light.sky);
    this.hemi.groundColor.copy(light.ground);
    this.hemi.intensity = light.hemi * (this.asleep ? 0.85 : 1);
    this.sun.color.copy(light.sun);
    this.sun.intensity = light.sunIntensity;
    this.fill.color.copy(light.fill);
    this.fill.intensity = light.fillIntensity;
    const [x, y, z] = light.sunDirection;
    if (this.sun.position.distanceTo(new Vector3(x, y, z)) > 0.4) { this.sun.position.set(x, y, z); this.shadowsDirty = true; }
    this.renderer.toneMappingExposure = light.exposure;
    if (!this.transparent) {
      const sky = new Color(this.theme.sky).lerp(light.background, light.daylight);
      (this.scene.background as Color).copy(sky);
      this.scene.fog?.color.copy(sky);
    }
    // Windows, lamps and neon: bright at night, faint by day, mostly off while the city sleeps.
    this.nightGlow = light.glow;
    scaleSharedGlow(this.asleep ? 0.22 : 0.3 + 0.7 * light.glow);
    this.life.setNight(light.glow > 0.8);
  }

  get isAsleep() { return this.asleep; }

  /** The stream went offline (or came back): send everyone to bed, or wake the city up. */
  setAsleep(asleep: boolean) {
    if (asleep === this.asleep) return;
    this.asleep = asleep;
    this.life.setAsleep(asleep);
    this.daylightClock = 0;
  }

  /** Screen points above a few homes, for floating "Zzz" while the city sleeps. */
  sleepyPoints(count = 3) {
    const homes = this.tiles.filter(tile => tile.building && tile.kind === "house");
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count && homes.length; i++) {
      const home = homes[Math.floor(Math.random() * homes.length)];
      points.push(this.screenPoint(home.group.position.clone().setY(0.6)));
    }
    if (this.hearthTile) points.push(this.screenPoint(this.hearthTile.group.position.clone().setY(0.1)));
    return points;
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
    this.camera.zoom = 1.18 * this.zoom * this.userZoom;
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
    const lift = this.groundAnchor();
    this.camera.left = -this.viewSpan * this.aspect / 2;
    this.camera.right = this.viewSpan * this.aspect / 2;
    this.camera.top = this.viewSpan / 2 + lift;
    this.camera.bottom = -this.viewSpan / 2 + lift;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Overlay only: shift the view so the front tip of the ground sits on the bottom edge of the
   * frame (right on the scoreboard bar) instead of floating mid-box over an empty transparent band.
   * Computed at the default zoom from the camera's fixed iso angle, so pan, zoom and quarter turns
   * still work on top of it (the plot is symmetric under rotation).
   */
  private groundAnchor() {
    if (!this.transparent) return 0;
    // The camera looks at the origin from cameraBase; its screen-up direction in the world:
    const forward = this.cameraBase.clone().negate().normalize();
    const up = new Vector3(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
    const reach = this.activeRadius + 0.5;
    const low = -reach * (Math.abs(up.x) + Math.abs(up.z)); // lowest ground corner, in view units
    const halfSpan = this.viewSpan / 2 / (1.18 * this.zoom);
    return low + ChatCity.GROUND_ANCHOR * halfSpan;
  }
  /** Where the ground's front tip lands in the overlay frame: 1 = exactly on the bottom edge. */
  private static readonly GROUND_ANCHOR = 0.96;

  private get eraIndex(): number { return this.recoveryEra ?? this.technologyEra; }

  get stage(): string {
    const era = ["CAMPFIRE SETTLEMENT", "HUTS & GATHERING", "SETTLED HOMES", "STONE CITY", "INDUSTRIAL CITY", "AGE OF AIRSHIPS", "EMPIRE", "TYPE I · PLANETARY", "TYPE II · STELLAR", "TYPE III · GALACTIC"][this.eraIndex];
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
    this.updateCameraFrustum();
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
      cells.set(key, {
        key, x: tile.x, z: tile.z, px, pz, links, doors: doorFlags, hash: Math.abs(Math.imul(tile.x * 73856093 ^ tile.z * 19349663, 2654435761)) >>> 3,
        style: this.streetStyleAt(tile), styles: DIRS.map((_, d) => this.streetStyleAt(tile, d))
      });
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
    // Empty homes have no residents walking about.
    const houses = this.tiles.filter(tile => tile.building && tile.kind === "house" && !tile.building.userData.vacant).length;
    this.life.setNetwork(cells, doors, houses);
  }

  private unlockTechnology(era: number) {
    const previousEra = this.technologyEra;
    this.technologyEra = Math.max(this.technologyEra, Math.min(ChatCity.MAX_ERA, era));
    this.streetsDirty = true;
    this.life.setEra(Math.min(6, this.technologyEra));
    if (this.technologyEra >= 7 && this.technologyEra !== previousEra) this.buildSky();
    if (this.technologyEra > previousEra && this.technologyEra >= 1) this.expandPlot();
    if (this.technologyEra > previousEra && this.technologyEra >= 2) this.tryRenewDistrict();
    if (this.technologyEra === 1 && previousEra < 1) {
      const firstHome = this.tiles.find(tile => tile.building && tile.kind === "house");
      if (firstHome) { this.addAnimal(firstHome); this.addAnimal(firstHome); }
    }
  }

  /**
   * The city falls back an era: new construction uses the older style, space-age sky works come
   * down, and the newest buildings start to crumble. Chat can climb back up.
   */
  private loseEra(era: number, historical: boolean) {
    const previousEra = this.technologyEra;
    this.technologyEra = Math.max(0, Math.min(ChatCity.MAX_ERA, era));
    if (this.technologyEra >= previousEra) return;
    if (this.recoveryEra !== undefined) this.recoveryEra = Math.min(this.recoveryEra, this.technologyEra);
    this.streetsDirty = true;
    this.life.setEra(Math.min(6, this.technologyEra));
    if (this.technologyEra >= 7) this.buildSky();
    else if (this.sky) { this.root.remove(this.sky); disposeObject(this.sky); this.sky = undefined; }
    // Buildings from the lost era are the first to fall into disrepair.
    const stranded = this.tiles.filter(tile => tile.building && (tile.building.userData.era ?? 0) > this.technologyEra && tile.building.userData.collapse === undefined);
    for (const tile of stranded.slice(0, 8)) this.setWear(tile, ((tile.building!.userData.wear as number | undefined) ?? 0) + 1);
    if (historical) return;
    this.flashSky(0x3a1a22, 1.6);
    this.shake = Math.max(this.shake, 0.8);
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
    // Only unowned, standing homes are redeveloped: nobody loses the home they earned.
    const homes = this.tiles.filter(tile => tile.building && tile.kind === "house" && !tile.building.userData.owner && tile.building.userData.collapse === undefined);
    for (const center of homes) {
      const cluster = homes
        .filter(tile => Math.abs(tile.x - center.x) + Math.abs(tile.z - center.z) <= 2)
        .sort((a, b) => (a === center ? -1 : b === center ? 1 : 0))
        .slice(0, 3);
      if (cluster.length < 3 || !this.findAccessPlan(center)) continue;
      // Build the new landmark first; only clear the neighbours once it is standing.
      const old = center.building!;
      center.group.remove(old);
      center.building = undefined;
      center.kind = "empty";
      const renewed = era >= 4 ? this.makeSkyscraper(center) : this.makeLandmark(center);
      if (!renewed) { center.group.add(old); center.building = old; center.kind = "house"; continue; }
      disposeObject(old);
      for (const tile of cluster.slice(1)) {
        if (!tile.building) continue;
        tile.group.remove(tile.building);
        disposeObject(tile.building);
        tile.building = undefined;
        tile.kind = "empty";
        this.totalBuildings = Math.max(0, this.totalBuildings - 1);
      }
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
    // The fire burns down to embers while the city sleeps.
    this.fireScale += ((this.asleep ? 0.3 : 1) - this.fireScale) * Math.min(1, delta * 0.8);
    this.campfire?.children.forEach(child => {
      if (!(child instanceof Mesh) || child.userData.firePhase === undefined) return;
      const phase = (child.userData.firePhase as number) + this.actorClock * (this.asleep ? 2 : 5);
      const f = this.fireScale;
      child.scale.set((0.9 + Math.sin(phase) * 0.15) * f, (0.82 + Math.sin(phase * 1.3) * 0.28) * f, (0.9 + Math.cos(phase) * 0.15) * f);
    });
  }

  private makeHouse(tile: Tile, immediate = false): boolean {
    const building = new Group();
    const era = this.eraIndex;
    if (era >= 2) {
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
    return false;
  }

  private makeAncientHut(building: Group, includeHearth = false) {
    this.homes.yardClutter(building);
    if (!includeHearth && this.random() < (this.eraIndex === 0 ? 0.4 : 0.25)) {
      this.homes.primitive(building);
      return;
    }
    const hutStyle = Math.floor(this.random() * 4);
    const woodColor = this.style === "norse" ? 0x493525 : this.style === "japan" ? 0x573c30 : 0x745133;
    const wood = mat(woodColor, 1);
    const wallColor = this.color(this.theme.house);
    const roofColor = this.color(this.theme.roof);

    if (this.style === "norse") {
      this.box(building, 1.02, 0.12, 0.96, this.theme.stone, 0, 0.12, 0);
      this.box(building, 0.86, 0.58, 0.74, 0, 0, 0.47, 0, mat(wallColor, 1));
      for (const x of [-0.43, 0.43]) this.box(building, 0.08, 0.92, 0.08, 0, x, 0.58, 0, wood);
      const leftRoof = this.box(building, 0.62, 0.12, 1.0, 0, -0.24, 0.91, 0, mat(roofColor, 1));
      leftRoof.rotation.z = -0.61;
      const rightRoof = this.box(building, 0.62, 0.12, 1.0, 0, 0.24, 0.91, 0, mat(roofColor, 1));
      rightRoof.rotation.z = 0.61;
      this.box(building, 0.12, 0.12, 1.05, 0, 0, 1.22, 0, wood);
      this.box(building, 0.2, 0.4, 0.06, 0, 0, 0.34, 0.4, wood);
    } else if (this.style === "japan") {
      this.box(building, 0.94, 0.1, 0.9, 0x704f3a, 0, 0.18, 0, wood);
      this.box(building, 0.78, 0.52, 0.66, 0, 0, 0.51, 0, mat(wallColor, 0.92));
      for (const x of [-0.36, 0.36]) for (const z of [-0.3, 0.3]) this.box(building, 0.055, 0.82, 0.055, 0, x, 0.55, z, wood);
      const leftRoof = this.box(building, 0.62, 0.1, 0.96, 0, -0.25, 0.89, 0, mat(roofColor, 0.82));
      leftRoof.rotation.z = -0.48;
      const rightRoof = this.box(building, 0.62, 0.1, 0.96, 0, 0.25, 0.89, 0, mat(roofColor, 0.82));
      rightRoof.rotation.z = 0.48;
      this.box(building, 0.2, 0.42, 0.055, 0, 0, 0.36, 0.35, wood);
      for (const x of [-0.38, 0.38]) this.box(building, 0.12, 0.045, 0.12, 0, x, 0.92, 0.38, mat(this.theme.accent, 0.65));
    } else if (this.style === "rome") {
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
        // Lie each rib along the cone's surface, top leaning in toward the peak.
        rib.position.set(Math.cos(angle) * 0.34, 1.18, Math.sin(angle) * 0.34);
        rib.rotation.z = Math.cos(angle) * 0.74; rib.rotation.x = -Math.sin(angle) * 0.74; building.add(rib);
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
      buildModernLandmark(building, this.themeId, this.theme, () => this.random(), false);
    }
    if (era === 2 || era === 3) {
      this.box(building, 0.2, 0.4, 0.055, 0, 0, 0.23, 0.48, mat(0x513925, 1));
    }
    // Town-era landmarks are already built in their civilization's style, so no extra trim.
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
    return true;
  }

  // ---------- upkeep: wear and repair ----------
  private buildCounter = 0;
  /** Lets the HUD announce collapses and repairs. */
  onUpkeep?: (kind: "collapse" | "repair", at: Vector3) => void;

  private wearable() {
    return this.tiles.filter(tile => tile.building && !tile.building.userData.monument && (tile.kind === "house" || tile.kind === "landmark") && tile.building.userData.collapse === undefined && (tile.building.userData.buildElapsed ?? 1) >= 0.82);
  }

  /** Quiet chat: an old building (chosen with a bias toward the oldest) gets more run down. */
  private wearDown(historical: boolean, gentle = false) {
    // Gentle wear (while asleep or away) can run a place down to a ruin but never knocks it over,
    // and empty homes whose families moved out go first.
    const candidates = this.wearable().filter(tile => !gentle || (tile.building!.userData.wear ?? 0) < 3)
      .sort((a, b) => (gentle ? Number(Boolean(b.building!.userData.vacant)) - Number(Boolean(a.building!.userData.vacant)) : 0) || (a.building!.userData.builtAt ?? 0) - (b.building!.userData.builtAt ?? 0));
    if (!candidates.length) return;
    // Mostly the oldest third of the city, sometimes anywhere.
    const pool = this.random() < 0.75 ? candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 3))) : candidates;
    const tile = pool[Math.floor(this.random() * pool.length)];
    const level = (tile.building!.userData.wear ?? 0) + 1;
    if (level > 3) {
      // A ruin left alone finally gives way and leaves a rubble lot behind.
      if (historical) { this.destroyBuilding(tile); this.addRubble(tile); }
      else { tile.building!.userData.collapse = 0; tile.building!.userData.leavesRubble = true; this.onUpkeep?.("collapse", tile.group.position.clone()); }
      return;
    }
    this.setWear(tile, level);
    if (!historical) for (let i = 0; i < 6; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.7, 0.3 + this.random() * 0.5, (this.random() - 0.5) * 0.7)), 0x8a8070, 0.04, 1.1, new Vector3(0, -0.2, 0), 0.6, true);
  }

  /** Positive chat: the most run-down building gets fixed up a step. */
  private repairOne(historical: boolean): Vector3 | undefined {
    const worn = this.wearable().filter(tile => (tile.building!.userData.wear ?? 0) > 0).sort((a, b) => (b.building!.userData.wear ?? 0) - (a.building!.userData.wear ?? 0));
    const tile = worn[0];
    if (!tile) return undefined;
    this.setWear(tile, (tile.building!.userData.wear ?? 0) - 1);
    if (historical) return tile.group.position.clone();
    for (let i = 0; i < 10; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.6, 0.4 + this.random() * 0.6, (this.random() - 0.5) * 0.6)), i % 2 ? 0xffe08a : 0x9ff0b8, 0.035, 0.9, new Vector3(0, 0.8, 0), 0.4);
    this.onUpkeep?.("repair", tile.group.position.clone());
    return tile.group.position.clone();
  }

  // ---------- the community capitol ----------
  private capitolGroup?: Group;
  private capitolStage = 0;

  /** Theme name for a capitol stage, e.g. "Capitolium" or "Imperial Castle". */
  capitolName(stage = this.capitolStage) { return (CAPITOL_NAMES[this.themeId] ?? CAPITOL_NAMES[this.style])[Math.max(0, Math.min(5, stage))]; }

  private setCapitol(stage: number, donors: CapitolDonor[], historical: boolean) {
    const center = this.hearthTile;
    if (!center || stage <= this.capitolStage && this.capitolGroup) return;
    this.capitolStage = stage;
    if (this.capitolGroup) { this.root.remove(this.capitolGroup); disposeObject(this.capitolGroup); }
    const { group, animated } = buildCapitol(stage, capitolStyleFor(this.themeId, this.theme), this.theme, () => this.random(), donors, this.themeId);
    // The capitol owns the 3x3 clearing around the hearth; it must not reach the homes beyond it.
    const fit = fitFootprint(group, ChatCity.CAPITOL_HALF, animated.flatMap(part => part.kind === "spin" ? [part] : []));
    if (fit < 1) for (const part of animated) if (part.kind === "smoke") part.at.multiplyScalar(fit);
    group.position.copy(center.group.position).setY(0);
    this.root.add(group);
    this.capitolGroup = group;
    for (const part of animated) this.animated.push({ tile: center, building: group, part });
    this.shadowsDirty = true;
    if (historical) return;
    // Rise in chunky steps like any build, with a wide dust ring and a city-wide party.
    let t = 0;
    group.scale.y = 0.05;
    this.effects.push(delta => {
      t += delta / 1.6;
      group.scale.y = Math.max(0.05, Math.ceil(Math.min(1, t) * 8) / 8);
      this.shadowsDirty = true;
      return t >= 1;
    });
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      this.puff(group.position.clone().add(new Vector3(Math.cos(angle) * 1.4, 0.06, Math.sin(angle) * 1.4)), 0xb8a888, 0.06, 1, new Vector3(Math.cos(angle) * 1.3, 0.5, Math.sin(angle) * 1.3), 1.2, true);
    }
    this.focus.copy(group.position);
    this.celebrate();
    this.onNotice?.({ kind: "capitol", user: "", at: group.position.clone().setY(1.2), level: stage });
  }

  // ---------- the audience game: commands and owned homes ----------
  /** Lets the HUD show who did what: "@name planted a tree", name tags over homes, etc. */
  onNotice?: (notice: { kind: "plant" | "repair" | "cheer" | "home" | "nohome" | "broke" | "fine" | "upgrade" | "claim" | "donate" | "capitol" | "chapter" | "welcome" | "moveOut" | "moveIn"; user: string; at?: Vector3; level?: number; cost?: number; color?: string; title?: string }) => void;
  private homesByOwner = new Map<string, Tile[]>();

  private ownerColor(owner: string, color?: string) {
    if (color) return new Color(color).getHex();
    let hash = 0;
    for (const char of owner) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return new Color().setHSL((hash % 360) / 360, 0.65, 0.55).getHex();
  }

  private claimHome(tile: Tile, owner: string) {
    tile.building!.userData.owner = owner;
    const homes = (this.homesByOwner.get(owner) ?? []).filter(home => home.building?.userData.owner === owner);
    homes.push(tile);
    this.homesByOwner.set(owner, homes);
    const level = Math.max(1, ...homes.map(home => (home.building!.userData.ownerLevel as number | undefined) ?? 0));
    this.decorateHome(tile, level, tile.building!.userData.ownerColor as string | undefined);
  }

  private ownedHomes(owner: string) {
    return (this.homesByOwner.get(owner) ?? []).filter(tile => tile.building?.userData.owner === owner);
  }

  private upgradeHome(owner: string, level: number, color: string | undefined, historical: boolean) {
    const homes = this.ownedHomes(owner);
    for (const tile of homes) {
      this.decorateHome(tile, level, color);
      if (!historical) for (let i = 0; i < 12; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.6, 0.5 + this.random() * 0.8, (this.random() - 0.5) * 0.6)), i % 3 ? 0xffe08a : this.ownerColor(owner, color), 0.04, 1, new Vector3(0, 0.9, 0), 0.4);
    }
    if (!historical && homes[0]) this.onNotice?.({ kind: "upgrade", user: owner, at: homes[0].group.position.clone(), level });
  }

  /**
   * An owned home flies its owner's colour. Level 1: flag and mailbox. Level 2: a garden and a
   * lantern. Level 3: a golden weathervane and a warm glow.
   */
  private decorateHome(tile: Tile, level: number, color?: string) {
    const building = tile.building!;
    const owner = building.userData.owner as string;
    building.userData.ownerLevel = Math.max(level, building.userData.ownerLevel ?? 0);
    if (color) building.userData.ownerColor = color;
    const old = building.userData.ownerProps as Group | undefined;
    if (old) { building.remove(old); disposeObject(old); }
    const props = new Group();
    props.userData.keep = true;
    const tint = mat(this.ownerColor(owner, building.userData.ownerColor), 0.7);
    const top = new Box3().setFromObject(building).max.y;
    const pole = new Mesh(new CylinderGeometry(0.008, 0.008, 0.32, 4), mat(0x3a3530, 0.6));
    pole.position.set(0.36, 0.16, 0.38);
    const flag = new Mesh(new BoxGeometry(0.13, 0.08, 0.008), tint);
    flag.position.set(0.43, 0.28, 0.38);
    const mailbox = new Mesh(new BoxGeometry(0.05, 0.05, 0.07), tint);
    mailbox.position.set(-0.36, 0.1, 0.42);
    props.add(pole, flag, mailbox);
    const tier = building.userData.ownerLevel as number;
    if (tier >= 2) {
      for (let i = 0; i < 6; i++) {
        const bloom = new Mesh(new SphereGeometry(0.022, 5, 4), mat([0xe46a8a, 0xf2c94c, 0xb98be0, 0xf5f0e6][i % 4], 0.9));
        bloom.position.set(-0.2 + i * 0.08, 0.035, 0.44);
        props.add(bloom);
      }
      const lantern = new Mesh(new BoxGeometry(0.04, 0.06, 0.04), mat(this.theme.glow, 0.3, { emissive: this.theme.glow, emissiveIntensity: 1.6 }));
      lantern.position.set(0.18, 0.26, 0.43);
      props.add(lantern);
    }
    if (tier >= 3) {
      const vane = new Mesh(new ConeGeometry(0.03, 0.14, 4), mat(0xffd35a, 0.3, { metalness: 0.7, emissive: 0x8a6a1a, emissiveIntensity: 0.6 }));
      vane.position.set(0, top + 0.08, 0);
      const arrow = new Mesh(new BoxGeometry(0.16, 0.012, 0.012), mat(0xffd35a, 0.3, { metalness: 0.7 }));
      arrow.position.set(0, top + 0.12, 0);
      props.add(vane, arrow);
      props.userData.vane = arrow;
    }
    building.add(props);
    building.userData.ownerProps = props;
    this.shadowsDirty = true;
  }

  private runCommand(event: Extract<SimEvent, { type: "command" }>, historical: boolean) {
    if (!event.ok) {
      if (!historical) this.onNotice?.({ kind: event.reason === "points" ? "broke" : "fine", user: event.user, cost: event.cost });
      return;
    }
    if (event.command === "plant") {
      const spot = this.plantTree(historical);
      if (!historical) this.onNotice?.({ kind: "plant", user: event.user, at: spot, cost: event.cost });
    } else if (event.command === "cheer" && !historical) {
      this.celebrate();
      this.onNotice?.({ kind: "cheer", user: event.user, at: this.focus.clone(), cost: event.cost });
    } else if (event.command === "donate" && !historical && this.hearthTile) {
      for (let i = 0; i < 10; i++) this.puff(this.hearthTile.group.position.clone().add(new Vector3((this.random() - 0.5) * 1.5, 0.8 + this.random() * 0.6, -0.9)), 0xffd35a, 0.035, 1, new Vector3(0, 0.9, 0), 0.4);
      this.onNotice?.({ kind: "donate", user: event.user, at: this.hearthTile.group.position.clone().setY(1), cost: event.cost });
    } else if (event.command === "home" && !historical) {
      const homes = this.ownedHomes(event.user);
      if (!homes.length) { this.onNotice?.({ kind: "nohome", user: event.user }); return; }
      for (const home of homes) this.beacon(home.group.position, this.ownerColor(event.user, home.building!.userData.ownerColor));
      this.onNotice?.({ kind: "home", user: event.user, at: homes[0].group.position.clone() });
    }
  }

  /** A chatter-planted tree: on an empty lot or a block's backyard, growing up from a sapling. */
  private plantTree(historical: boolean) {
    const spots = this.tiles.filter(tile => tile.group.visible && tile.kind === "empty" && !tile.building && !this.isStreet(tile) && !this.pathTiles.has(this.key(tile.x, tile.z)) && !this.actorTiles.has(this.key(tile.x, tile.z)) && tile.trees.length < 3);
    const hearth = this.hearthTile;
    spots.sort((a, b) => (hearth ? Math.hypot(a.x - hearth.x, a.z - hearth.z) - Math.hypot(b.x - hearth.x, b.z - hearth.z) : 0));
    const tile = spots[Math.floor(this.random() * Math.min(spots.length, 12))];
    if (!tile) return undefined;
    this.addTree(tile, (this.random() - 0.5) * 0.5, (this.random() - 0.5) * 0.5, 0.55 + this.random() * 0.3);
    const tree = tile.trees[tile.trees.length - 1];
    if (!historical && tree) {
      const final = tree.scale.x;
      tree.scale.setScalar(0.05);
      let t = 0;
      this.effects.push(delta => { t += delta / 1.2; const s = Math.min(1, t); tree.scale.setScalar(final * (s < 1 ? 1 - Math.pow(1 - s, 3) + Math.sin(s * Math.PI) * 0.15 : 1)); this.shadowsDirty = true; return s >= 1; });
      for (let i = 0; i < 8; i++) this.puff(tile.group.position.clone().add(new Vector3(0, 0.3, 0)), 0x8fdf6a, 0.03, 0.8, new Vector3((this.random() - 0.5) * 1.2, 0.8, (this.random() - 0.5) * 1.2), 1);
    }
    return tile.group.position.clone();
  }

  /** A column of light over someone's home for a few seconds. */
  private beacon(at: Vector3, color: number) {
    const pillar = new Mesh(new CylinderGeometry(0.16, 0.22, 6, 8, 1, true), new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
    pillar.position.copy(at).setY(3);
    this.root.add(pillar);
    let t = 0;
    this.effects.push(delta => {
      t += delta;
      (pillar.material as MeshBasicMaterial).opacity = 0.35 * Math.max(0, 1 - t / 5) * (0.8 + Math.sin(t * 8) * 0.2);
      if (t < 5) return false;
      this.root.remove(pillar); disposeObject(pillar);
      return true;
    });
  }

  /** A random owned home or monument (for the HUD's rotating name tags). */
  featuredHome() {
    const owned = this.tiles.filter(tile => tile.building?.userData.owner || tile.building?.userData.monument);
    const tile = owned[Math.floor(Math.random() * owned.length)];
    if (!tile) return undefined;
    const data = tile.building!.userData;
    const at = this.screenPoint(tile.group.position.clone().setY(0.5));
    return data.monument
      ? { owner: data.monumentLabel as string, at, level: 3, monument: true }
      : { owner: data.owner as string, at, level: data.ownerLevel as number };
  }

  /**
   * Each chapter of the city's story leaves a monument on a lot near the capitol: a figure on a
   * plinth, named for the chapter and its hero. They are never worn down or attacked.
   */
  private raiseMonument(number: number, title: string, hero: string | undefined, historical: boolean) {
    const center = this.hearthTile;
    if (!center) return;
    const lots = this.tiles.filter(tile => this.isOpenLot(tile) && this.findAccessPlan(tile));
    lots.sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z));
    const tile = lots[0];
    if (!tile) { if (!historical) this.onNotice?.({ kind: "chapter", user: hero ?? "", level: number, title }); return; }
    for (const tree of tile.trees) tile.group.remove(tree);
    tile.trees = [];
    const building = new Group();
    const stone = mat(this.theme.stone, 0.8);
    const bronze = mat(number % 3 === 0 ? 0xffd35a : 0xb07a4a, 0.35, { metalness: 0.6 });
    const lawn = new Mesh(new BoxGeometry(0.96, 0.012, 0.96), mat(this.theme.foliage[1], 1));
    lawn.position.y = 0.006;
    const plinth = new Mesh(new BoxGeometry(0.34, 0.24, 0.34), stone); plinth.position.y = 0.12;
    const cap = new Mesh(new BoxGeometry(0.4, 0.04, 0.4), stone); cap.position.y = 0.26;
    const body = new Mesh(new CylinderGeometry(0.06, 0.09, 0.3, 8), bronze); body.position.y = 0.43;
    const head = new Mesh(new SphereGeometry(0.06, 8, 6), bronze); head.position.y = 0.63;
    const arm = new Mesh(new BoxGeometry(0.03, 0.22, 0.03), bronze); arm.position.set(0.08, 0.62, 0); arm.rotation.z = -0.5;
    const plaque = new Mesh(new BoxGeometry(0.18, 0.08, 0.01), mat(0x2a2620, 0.6)); plaque.position.set(0, 0.13, 0.176);
    building.add(lawn, plinth, cap, body, head, arm, plaque);
    for (let i = 0; i < 4; i++) {
      const bloom = new Mesh(new SphereGeometry(0.03, 5, 4), mat([0xe46a8a, 0xf2c94c, 0xb98be0, 0xf5f0e6][i], 0.9));
      bloom.position.set(Math.sin(i * 1.57) * 0.3, 0.04, Math.cos(i * 1.57) * 0.3);
      building.add(bloom);
    }
    if (!this.connectNewBuilding(tile, building)) return;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    building.userData.special = true;
    building.userData.monument = true;
    building.userData.monumentLabel = hero ? `Ch.${number} ${title} · ${hero}` : `Ch.${number} ${title}`;
    this.animateBuild(building, tile, historical);
    if (!historical) {
      this.focus.copy(tile.group.position);
      this.onNotice?.({ kind: "chapter", user: hero ?? "", at: tile.group.position.clone(), level: number, title });
    }
  }

  private setWear(tile: Tile, level: number) {
    const building = tile.building!;
    level = Math.max(0, Math.min(3, level));
    building.userData.wear = level;
    // Grime: swap baked vertex-colour materials for darker shared copies.
    building.traverse(object => {
      if (!(object instanceof Mesh) || object instanceof InstancedMesh) {
        if (object instanceof InstancedMesh && object.parent === building) object.visible = level < 2; // windows go dark when abandoned
        return;
      }
      const material = object.material as MeshStandardMaterial;
      if (!material.vertexColors) return;
      const base = (material.userData.vertexColorBase as MeshStandardMaterial | undefined) ?? material;
      object.material = level === 0 ? base : grimeMaterial(base, level);
    });
    // Lean a little more with each step.
    const lean = [0, 0, 0.025, 0.055][level];
    building.rotation.z = lean * (tile.x % 2 ? 1 : -1);
    building.rotation.x = lean * 0.5 * (tile.z % 2 ? 1 : -1);
    // Rebuild the clutter of neglect.
    const old = building.userData.wearProps as Group | undefined;
    if (old) { building.remove(old); disposeObject(old); }
    building.userData.wearProps = undefined;
    if (level === 0) { this.shadowsDirty = true; return; }
    const props = new Group();
    props.userData.keep = true;
    // Cracks running down the front and side walls, more of them as it gets worse.
    const top = new Box3().setFromObject(building).max.y;
    const crack = mat(0x2a2420, 1);
    for (let i = 0; i < level * 2; i++) {
      const height = Math.min(0.5, top * 0.4) * (0.5 + this.random() * 0.5);
      const piece = new Mesh(new BoxGeometry(0.018, height, 0.01), crack);
      const front = i % 2 === 0;
      piece.position.set(front ? (this.random() - 0.5) * 0.6 : 0.42, Math.max(0.2, top * (0.3 + this.random() * 0.5)), front ? 0.43 : (this.random() - 0.5) * 0.6);
      if (!front) piece.rotation.y = Math.PI / 2;
      piece.rotation.z = (this.random() - 0.5) * 0.7;
      props.add(piece);
    }
    const weeds = mat(0x4e6e3a, 1);
    for (let i = 0; i < 3 + level * 3; i++) {
      const tuft = new Mesh(new ConeGeometry(0.03, 0.08 + level * 0.03, 4), weeds);
      tuft.position.set((this.random() - 0.5) * 0.85, 0.04, (this.random() - 0.5) * 0.85);
      props.add(tuft);
    }
    if (level >= 2) {
      const plank = mat(0x6b4f36, 1);
      for (let i = 0; i < 3; i++) {
        const board = new Mesh(new BoxGeometry(0.14, 0.03, 0.012), plank);
        board.position.set((i - 1) * 0.2, 0.2 + this.random() * 0.25, 0.4);
        board.rotation.z = (this.random() - 0.5) * 0.8;
        props.add(board);
      }
      const vine = mat(0x3f6a34, 1);
      for (let i = 0; i < 4; i++) {
        const strand = new Mesh(new BoxGeometry(0.03, 0.2 + this.random() * 0.3, 0.02), vine);
        strand.position.set(-0.38 + this.random() * 0.15, 0.15 + i * 0.12, 0.38);
        props.add(strand);
      }
    }
    if (level >= 3) {
      const stone = mat(0x7a7262, 1);
      for (let i = 0; i < 7; i++) {
        const chunk = new Mesh(new BoxGeometry(0.06 + this.random() * 0.06, 0.04 + this.random() * 0.05, 0.06 + this.random() * 0.06), stone);
        chunk.position.set((this.random() - 0.5) * 0.9, 0.03, 0.3 + this.random() * 0.15);
        chunk.rotation.y = this.random() * 3;
        props.add(chunk);
      }
    }
    bakeStatic(props, 2);
    building.add(props);
    building.userData.wearProps = props;
    this.shadowsDirty = true;
  }

  private addRubble(tile: Tile) {
    const pile = new Group();
    const stone = mat(0x7a7262, 1), wood = mat(0x5a4632, 1);
    for (let i = 0; i < 9; i++) {
      const chunk = new Mesh(new BoxGeometry(0.07 + this.random() * 0.1, 0.04 + this.random() * 0.07, 0.07 + this.random() * 0.1), i % 3 ? stone : wood);
      chunk.position.set((this.random() - 0.5) * 0.7, 0.04, (this.random() - 0.5) * 0.7);
      chunk.rotation.set(this.random() * 0.4, this.random() * 3, this.random() * 0.4);
      pile.add(chunk);
    }
    bakeStatic(pile, 2);
    tile.group.add(pile);
    tile.trees.push(pile); // cleared like trees when the lot is rebuilt
    tile.rubblePile = pile;
    this.shadowsDirty = true;
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
    this.animated = this.animated.filter(entry => entry.tile.building === entry.building || (entry.building === this.capitolGroup && entry.building !== undefined));
    for (const { building, part } of this.animated) {
      if (part.kind === "spin") part.object.rotation[part.axis] += part.speed * delta;
      else if (part.kind === "blink") part.object.visible = ((clock / part.period + part.offset) % 1) < 0.55;
      else if (part.kind === "sway") part.object.rotation.z = Math.sin(clock * part.speed + part.amount * 10) * part.amount;
      else if (this.random() < part.rate * delta * (this.asleep ? 0.3 : 1) && this.particles.length < 520) {
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
    buildModernLandmark(building, this.themeId, this.theme, () => this.random(), true);
    if (!this.connectNewBuilding(tile, building)) return false;
    tile.group.add(building);
    tile.building = building;
    tile.kind = "landmark";
    this.animateBuild(building, tile, immediate);
    return true;
  }

  private makeThemeLandmark(building: Group, era: number, stone: MeshStandardMaterial) {
    const wood = mat(0x62462e, 1);
    if (this.style === "egypt") {
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
    } else if (this.style === "rome") {
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
    } else if (this.style === "norse") {
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
    if (this.style === "egypt") {
      for (const x of [-width * 0.36, width * 0.36]) {
        const pilaster = new Mesh(new CylinderGeometry(0.035, 0.05, Math.min(height * 0.9, 2.4), 7), mat(0xc4a86f, 0.92));
        pilaster.position.set(x, height / 2 + 0.16, depth / 2 + 0.025); building.add(pilaster);
      }
      const lintel = this.box(building, width * 0.94, 0.07, 0.07, 0, 0, height + 0.19, depth / 2 + 0.035, mat(0xb18a4d, 0.85));
      lintel.receiveShadow = true;
    } else if (this.style === "rome") {
      for (const x of [-width * 0.36, width * 0.36]) {
        const column = new Mesh(new CylinderGeometry(0.035, 0.05, Math.min(height * 0.9, 2.2), 8), mat(0xe0d3b5, 0.78));
        column.position.set(x, height / 2 + 0.16, depth / 2 + 0.04); building.add(column);
        this.box(building, 0.12, 0.055, 0.12, 0, x, height + 0.19, depth / 2 + 0.04, mat(0xd4c29f, 0.8));
      }
      this.box(building, width * 1.04, 0.075, 0.12, 0, 0, height + 0.24, depth / 2 + 0.04, mat(this.theme.roof[0], 0.86));
    } else if (this.style === "norse") {
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
    // Lots are 1x1 and neighbours build right up to the edge: shrink anything wider than its lot.
    const spinning = this.animated.flatMap(entry => entry.building === building && entry.part.kind === "spin" ? [entry.part] : []);
    const fit = fitFootprint(building, ChatCity.LOT_HALF, spinning);
    if (fit < 1) {
      for (const entry of this.animated) if (entry.building === building && entry.part.kind === "smoke") entry.part.at.multiplyScalar(fit);
    }
    // Chimneys recorded by the home kit: about half of them smoke.
    for (const at of (building.userData.smoke as Array<{ x: number; y: number; z: number }> | undefined) ?? []) {
      if (this.random() < 0.5) this.animated.push({ tile, building, part: { kind: "smoke", at: new Vector3(at.x * fit, at.y * fit, at.z * fit), rate: 1.1, color: 0x8a8a8a } });
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
    building.userData.builtAt = this.buildCounter++;
    building.scale.set(1, immediate ? 1 : 0.02, 1);
    building.position.y = immediate ? 0 : 0.49;
  }

  // ---------- town planning ----------
  // Street lines cut the plot into blocks of uneven size, like a real town: tight 2x2 blocks where
  // lines sit three apart, the classic eight-lots-round-a-backyard block at four, and deep blocks
  // with a shared courtyard at five. The central block round the founding campfire is always the
  // classic one, and each line gets a character (boulevard, lane, brick, tram, market).
  private static readonly BUILD_STEPS = 6;
  private static readonly UNBUILD_SECONDS = 0.9;
  private static readonly CENTRAL_LINES = [13, 17];
  private streetLinesX = new Set<number>();
  private streetLinesZ = new Set<number>();
  private lineStyles = new Map<string, StreetStyle>();

  private planStreetGrid() {
    // Seeded from the theme so a city keeps its street plan across reloads, without touching the
    // main random stream that buildings use.
    let seed = [...this.themeId].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2246822519) >>> 0, 0x9e3779b9);
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const spacing = () => [3, 4, 4, 5, 5, 4][Math.floor(rand() * 6)];
    const styleFor = (central: boolean): StreetStyle => {
      if (central) return "boulevard";
      const roll = rand();
      return roll < 0.32 ? "avenue" : roll < 0.5 ? "lane" : roll < 0.66 ? "brick" : roll < 0.82 ? "tram" : roll < 0.94 ? "market" : "boulevard";
    };
    for (const [axis, lines] of [["x", this.streetLinesX], ["z", this.streetLinesZ]] as const) {
      const [low, high] = ChatCity.CENTRAL_LINES;
      for (const line of ChatCity.CENTRAL_LINES) lines.add(line);
      for (let at = high + spacing(); at < GRID; at += spacing()) lines.add(at);
      for (let at = low - spacing(); at >= 0; at -= spacing()) lines.add(at);
      // The two lines framing the plaza on one axis are the boulevard; the other axis gets one.
      for (const line of [...lines].sort((a, b) => a - b)) {
        const central = axis === "x" ? ChatCity.CENTRAL_LINES.includes(line) : line === high;
        let style = styleFor(central);
        // Narrow lanes only between small blocks would be cramped; tight blocks get lanes, wide get avenues.
        if (!central && lines.has(line - 3) && lines.has(line + 3) && rand() < 0.5) style = "lane";
        this.lineStyles.set(`${axis}${line}`, style);
      }
    }
  }

  /** Street character of a road arm leaving a tile in direction d (or of the tile's middle). */
  private streetStyleAt(tile: Tile, d?: number): StreetStyle {
    const onX = this.streetLinesX.has(tile.x), onZ = this.streetLinesZ.has(tile.z);
    const xs = this.lineStyles.get(`x${tile.x}`), zs = this.lineStyles.get(`z${tile.z}`);
    if (d !== undefined) {
      // Arms along z run down an x line; arms along x run along a z line.
      const style = DIRS[d][0] === 0 ? (onX ? xs : undefined) : (onZ ? zs : undefined);
      if (style) return style;
    }
    if (onX && onZ && xs && zs) return STREET_RANK[xs] >= STREET_RANK[zs] ? xs : zs;
    return (onX ? xs : onZ ? zs : undefined) ?? "avenue";
  }

  private isStreet(tile: Tile) { return this.streetLinesX.has(tile.x) || this.streetLinesZ.has(tile.z); }
  /** Deep in a block: not on, nor beside, any street line. */
  private deep(value: number, lines: Set<number>) { return !lines.has(value) && !lines.has(value - 1) && !lines.has(value + 1); }
  private isInterior(tile: Tile) { return this.deep(tile.x, this.streetLinesX) && this.deep(tile.z, this.streetLinesZ); }
  /** The backyard tile of a lot's block nearest the lot (blocks three apart have none). */
  private blockInterior(tile: Tile) {
    const nearest = (value: number, lines: Set<number>) => {
      let lo = value, hi = value;
      while (lo > 0 && !lines.has(lo)) lo--;
      while (hi < GRID - 1 && !lines.has(hi)) hi++;
      let best: number | undefined;
      for (let v = lo + 1; v < hi; v++) if (this.deep(v, lines) && (best === undefined || Math.abs(v - value) < Math.abs(best - value))) best = v;
      return best;
    };
    const bx = nearest(tile.x, this.streetLinesX), bz = nearest(tile.z, this.streetLinesZ);
    return bx === undefined || bz === undefined ? undefined : this.tileByCoord.get(this.key(bx, bz));
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

  build(kind: "house" | "landmark", count: number, immediate = false, builders: string[] = []) {
    const owners = kind === "house" ? [...builders] : [];
    let unplaced = 0;
    for (let n = 0; n < Math.min(30, Math.max(0, count)); n++) {
      let tile = this.chooseLot(kind);
      if (!tile && this.activeRadius < 15.5) {
        this.expandPlot();
        tile = this.chooseLot(kind);
      }
      // The plot is full: the rest of this growth modernises old buildings instead (below).
      if (!tile) { unplaced = Math.min(30, count) - n; break; }
      for (const tree of tile.trees) tile.group.remove(tree);
      tile.trees = [];
      // Every few homes the district gets a civic building: a well, windmill, factory, arcade...
      this.buildsSinceSpecial++;
      const special = kind === "house" && this.buildsSinceSpecial >= 4 && this.random() < 0.45;
      const built = special ? this.makeSpecial(tile, immediate) : kind === "house" ? this.makeHouse(tile, immediate) : this.makeLandmark(tile, immediate);
      if (built && special) this.buildsSinceSpecial = 0;
      if (!built) continue;
      // The chatters credited for this build own the homes it made, one each.
      const owner = owners.shift();
      if (owner && tile.kind === "house" && tile.building) this.claimHome(tile, owner);
      this.focus.copy(tile.group.position);
      this.totalBuildings++;
      if (this.technologyEra <= 1 && this.totalBuildings % 2 === 0) this.addAnimal(tile);
      else this.tendBackyard(tile);
      this.streetsDirty = true;
    }
    this.tryRenewDistrict();
    for (let i = 0; i < 1 + unplaced; i++) if (!this.upgradeOldHome(immediate)) break;
  }

  /** Neighbourhoods modernise over time: one home two or more eras behind is rebuilt in today's style. */
  private upgradeOldHome(immediate: boolean): boolean {
    if (this.recoveryEra !== undefined || this.eraIndex < 2) return false;
    const current = (tile: Tile) => tile.building && tile.building.userData.collapse === undefined && !tile.building.userData.monument;
    // Village lodges and other landmarks three or more eras out of date are rebuilt too (not civic specials).
    const staleLandmark = this.tiles.find(tile => current(tile) && tile.kind === "landmark" && !tile.building!.userData.special && (tile.building!.userData.era ?? 0) <= this.eraIndex - 3);
    if (staleLandmark && this.random() < 0.5) {
      const old = staleLandmark.building!;
      staleLandmark.group.remove(old);
      staleLandmark.building = undefined;
      staleLandmark.kind = "empty";
      if (this.makeLandmark(staleLandmark, immediate)) { disposeObject(old); return true; }
      staleLandmark.group.add(old); staleLandmark.building = old; staleLandmark.kind = "landmark";
    }
    // Civic specials too: a village well does not survive into the space age.
    const staleSpecial = this.tiles.find(tile => current(tile) && tile.building!.userData.special && (tile.building!.userData.era ?? 0) <= this.eraIndex - 3);
    if (staleSpecial && this.random() < 0.35) {
      const old = staleSpecial.building!;
      staleSpecial.group.remove(old);
      staleSpecial.building = undefined;
      staleSpecial.kind = "empty";
      if (this.makeSpecial(staleSpecial, immediate)) { disposeObject(old); return true; }
      staleSpecial.group.add(old); staleSpecial.building = old; staleSpecial.kind = "landmark";
    }
    const stale = this.tiles.filter(tile => current(tile) && tile.kind === "house" && (tile.building!.userData.era ?? 0) <= this.eraIndex - 2);
    if (!stale.length) return false;
    const tile = stale[Math.floor(this.random() * stale.length)];
    const old = tile.building!;
    tile.group.remove(old);
    tile.building = undefined;
    tile.kind = "empty";
    if (this.makeHouse(tile, immediate)) {
      // Owners keep their home (and its level) when it is rebuilt in a newer style.
      if (old.userData.owner) {
        tile.building!.userData.ownerLevel = old.userData.ownerLevel;
        tile.building!.userData.ownerColor = old.userData.ownerColor;
        this.claimHome(tile, old.userData.owner as string);
      }
      disposeObject(old);
      return true;
    }
    tile.group.add(old); tile.building = old; tile.kind = "house";
    return false;
  }


  // ---------- rebuilding after attacks ----------
  private pendingRebuilds = 0;
  private rebuilders: string[] = [];
  private rebuildTimer = 0;

  /** Chat rebuilds what an attack knocked down: rubble lots first, one after another, before anything new. */
  rebuild(count: number, immediate = false, builders: string[] = []) {
    if (immediate) {
      for (let n = 0; n < count; n++) {
        const lot = this.nextRubbleLot();
        if (lot) this.rebuildLot(lot, true, builders[n]);
        else this.build("house", 1, true, builders[n] ? [builders[n]] : []);
      }
      return;
    }
    this.pendingRebuilds += Math.max(0, count);
    this.rebuilders.push(...builders);
  }

  private hasRubble(tile: Tile) { return !!tile.rubblePile && tile.trees.includes(tile.rubblePile) && this.isOpenLot(tile); }

  /** Rubble closest to the heart of town is cleared first. */
  private nextRubbleLot() {
    const hearth = this.hearthTile;
    let best: Tile | undefined, bestDistance = Infinity;
    for (const tile of this.tiles) {
      if (!this.hasRubble(tile)) continue;
      const distance = hearth ? Math.hypot(tile.x - hearth.x, tile.z - hearth.z) : 0;
      if (distance < bestDistance) { best = tile; bestDistance = distance; }
    }
    return best;
  }

  private rebuildLot(tile: Tile, immediate: boolean, builder?: string) {
    for (const tree of tile.trees) tile.group.remove(tree);
    tile.trees = [];
    tile.rubblePile = undefined;
    const kind = tile.formerKind ?? "house";
    const built = kind === "landmark" ? this.makeLandmark(tile, immediate) : this.makeHouse(tile, immediate);
    if (!built) return false;
    // The family that lived here gets its home back; otherwise the chatter who rebuilt it moves in.
    const owner = tile.formerOwner ?? builder;
    if (owner && tile.kind === "house" && tile.building) this.claimHome(tile, owner);
    tile.formerKind = undefined;
    tile.formerOwner = undefined;
    this.totalBuildings++;
    this.streetsDirty = true;
    if (!immediate) {
      this.focus.copy(tile.group.position);
      for (let i = 0; i < 8; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.7, 0.2 + this.random() * 0.5, (this.random() - 0.5) * 0.7)), [0xffe08a, 0xfff4c8, 0x9be8ff][i % 3], 0.05, 0.9, new Vector3((this.random() - 0.5) * 0.8, 1.2, (this.random() - 0.5) * 0.8), 0.9, true);
    }
    return true;
  }

  private updateRebuilds(delta: number) {
    if (this.pendingRebuilds <= 0) return;
    this.rebuildTimer -= delta;
    if (this.rebuildTimer > 0) return;
    this.rebuildTimer = 0.35;
    const lot = this.nextRubbleLot();
    if (lot) {
      if (this.rebuildLot(lot, false, this.rebuilders.shift())) this.pendingRebuilds--;
      return;
    }
    // No rubble yet: wait while the attack is still burning or toppling, otherwise build fresh.
    const settling = this.tiles.some(tile => tile.kind === "fire" || tile.building?.userData.collapse !== undefined);
    if (settling) return;
    this.build("house", this.pendingRebuilds, false, this.rebuilders.splice(0));
    this.pendingRebuilds = 0;
  }

  boom(viewers: number, historical = false) {
    const count = Math.min(24, Math.max(2, Math.ceil(viewers / 5)));
    this.build("house", count, historical);
    if (!historical) { this.fireworks(0, 0, Math.min(2.8, 0.8 + viewers / 800)); this.life.cheer(5); }
  }

  disaster(intensity: number, historical = false, damageCount?: number, durationMs = 3600, kind: AttackKind = "fire") {
    const occupied = this.tiles.filter(tile => tile.building && !tile.building.userData.monument && (tile.kind === "house" || tile.kind === "landmark"));
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
      for (const tile of damageSet) {
        const kind = tile.kind === "landmark" ? "landmark" : "house";
        this.destroyBuilding(tile);
        tile.formerKind = kind;
        for (const tree of tile.trees) tile.group.remove(tree);
        tile.trees = [];
        this.addRubble(tile);
      }
      return;
    }
    const target = seed.group.position.clone();
    this.focus.copy(target);
    this.life.panic(target, 1.6 + count * 0.6, 4);
    const scale = Math.min(1, 0.45 + count * 0.2);
    const ignite = (tile: Tile) => {
      if (!tile.building || tile.kind === "fire") return;
      tile.formerKind = tile.kind === "landmark" ? "landmark" : "house";
      tile.kind = "fire"; tile.burningUntil = performance.now() + durationMs; this.addFlames(tile);
    };
    if (kind === "meteor") this.meteorStrike(target, () => { damageSet.forEach(ignite); this.shake = 0.3 + scale * 0.3; }, scale);
    else if (kind === "asteroid") this.meteorStrike(target, () => { damageSet.forEach(ignite); this.shake = 0.9; this.flashSky(0xffb070, 1.2); }, 1.25 + scale * 0.5);
    else if (kind === "storm") this.lightningStorm(target, damageSet, ignite, scale);
    else if (kind === "swarm") this.locustSwarm(target, damageSet, scale);
    else if (kind === "drones") this.locustSwarm(target, damageSet, scale, true);
    else if (kind === "quake") this.earthquake(target, damageSet, scale);
    else if (kind === "flood") this.flashFlood(target, damageSet, scale);
    else if (kind === "tornado") this.tornado(target, damageSet, scale);
    else if (kind === "flare") this.solarFlare(damageSet, ignite);
    else if (kind === "gamma") this.gammaBurst(target, damageSet, ignite);
    else if (kind === "blackhole") this.blackHole(target, damageSet);
    else damageSet.forEach(ignite);
  }

  /** A glowing rock streaks in, then the impact sets the district alight. */
  // ---------- natural disasters and catastrophes ----------
  private static readonly MAX_ERA = 9;
  /** Half a lot, less a small gap so neighbouring buildings never touch. */
  private static readonly LOT_HALF = 0.46;
  /** Half the hearth's 3x3 clearing, less the same gap. */
  private static readonly CAPITOL_HALF = 1.42;

  /** Knock a building down in reverse-build steps, leaving rubble. */
  private topple(tile: Tile, rubble = true) {
    const building = tile.building;
    if (!building || building.userData.collapse !== undefined) return;
    building.userData.collapse = 0;
    building.userData.leavesRubble = rubble;
  }

  /** Brief tint of the whole sky (and lights) for flares, asteroid impacts and bursts. */
  private flashSky(color: number, seconds = 1) {
    const light = this.claimLight(color, 60, 0.4, new Vector3(0, 14, 0));
    let t = 0;
    this.effects.push(delta => {
      t += delta;
      if (light) light.intensity = Math.max(0, 80 * (1 - t / seconds));
      if (t < seconds) return false;
      this.releaseLight(light);
      return true;
    });
  }

  /** Earthquake: the ground shudders, cracks open and buildings shake apart one by one. */
  private earthquake(target: Vector3, damage: Tile[], scale: number) {
    const cracks: Mesh[] = [];
    for (let i = 0; i < 7; i++) {
      const crack = new Mesh(new BoxGeometry(0.9 + this.random() * 1.6, 0.012, 0.05), mat(0x1c1612, 1));
      crack.position.copy(target).add(new Vector3((this.random() - 0.5) * 4, 0.07, (this.random() - 0.5) * 4));
      crack.rotation.y = this.random() * Math.PI;
      crack.scale.x = 0.01;
      this.root.add(crack);
      cracks.push(crack);
    }
    damage.forEach((tile, index) => { if (tile.building) tile.building.userData.quakeAt = 0.6 + index * 0.35; });
    let t = 0;
    this.effects.push(delta => {
      t += delta;
      this.shake = Math.max(this.shake, t < 2.6 ? 0.55 + scale * 0.3 : 0);
      for (const crack of cracks) crack.scale.x = Math.min(1, t / 1.2);
      for (const tile of damage) {
        const building = tile.building;
        if (!building) continue;
        if (building.userData.quakeAt !== undefined && t < building.userData.quakeAt) building.rotation.z = Math.sin(t * 40) * 0.04;
        else if (building.userData.quakeAt !== undefined) {
          building.userData.quakeAt = undefined;
          building.rotation.z = 0;
          this.topple(tile);
        }
      }
      if (t < 2 + damage.length * 0.35) return false;
      if (t < 14) return false;
      for (const crack of cracks) { this.root.remove(crack); crack.geometry.dispose(); }
      return true;
    });
  }

  /** Flash flood: water rises over a district, sweeps the weakest homes away and drains. */
  private flashFlood(target: Vector3, damage: Tile[], scale: number) {
    const radius = 1.6 + scale * 1.6;
    const water = new Mesh(new CylinderGeometry(radius, radius, 0.02, 28), new MeshStandardMaterial({ color: 0x3f8fd2, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.62, emissive: 0x1a4a7a, emissiveIntensity: 0.3 }));
    water.position.copy(target).setY(0.02);
    this.root.add(water);
    damage.forEach((tile, index) => { if (tile.building) tile.building.userData.floodAt = 1.4 + index * 0.4; });
    let t = 0;
    const peak = 0.34;
    this.effects.push(delta => {
      t += delta;
      const rise = t < 1.6 ? t / 1.6 : t < 4.4 ? 1 : Math.max(0, 1 - (t - 4.4) / 2.2);
      water.position.y = 0.02 + rise * peak;
      water.scale.setScalar(0.4 + Math.min(1, t / 1.6) * 0.6);
      if (this.random() < 0.6 && rise > 0.3) this.puff(water.position.clone().add(new Vector3((this.random() - 0.5) * radius * 1.4, 0.02, (this.random() - 0.5) * radius * 1.4)), 0xdff4ff, 0.03, 0.6, new Vector3(0, 0.4, 0), 1.5, true);
      for (const tile of damage) {
        const building = tile.building;
        if (building?.userData.floodAt !== undefined && t >= building.userData.floodAt) { building.userData.floodAt = undefined; this.topple(tile); }
      }
      if (t < 6.6) return false;
      this.root.remove(water);
      water.geometry.dispose();
      (water.material as MeshStandardMaterial).dispose();
      return true;
    });
  }

  /** Tornado: a twisting funnel wanders through and lifts buildings apart as it passes. */
  private tornado(target: Vector3, damage: Tile[], scale: number) {
    const funnel = new Group();
    const material = new MeshStandardMaterial({ color: 0x8a8f96, roughness: 1, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 7; i++) {
      const ring = new Mesh(new TorusGeometry(0.12 + i * 0.11, 0.05 + i * 0.012, 5, 14), material);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.2 + i * 0.42;
      funnel.add(ring);
    }
    funnel.scale.setScalar(0.8 + scale * 0.4);
    const path = [target.clone().add(new Vector3(-4, 0, 3)), ...damage.map(tile => tile.group.position.clone()), target.clone().add(new Vector3(4, 0, -4))];
    funnel.position.copy(path[0]);
    this.root.add(funnel);
    let t = 0;
    const legSeconds = 1.1;
    this.effects.push(delta => {
      t += delta;
      const leg = Math.min(path.length - 2, Math.floor(t / legSeconds));
      const f = Math.min(1, (t - leg * legSeconds) / legSeconds);
      funnel.position.lerpVectors(path[leg], path[leg + 1], f);
      funnel.rotation.y += delta * 9;
      funnel.children.forEach((ring, i) => { ring.position.x = Math.sin(t * 3 + i) * 0.06 * i; });
      for (let i = 0; i < 3; i++) this.puff(funnel.position.clone().add(new Vector3((this.random() - 0.5) * 0.6, 0.1, (this.random() - 0.5) * 0.6)), 0x9a8a72, 0.05, 0.9, new Vector3((this.random() - 0.5) * 2, 2.5, (this.random() - 0.5) * 2), 0.6, true);
      if (leg >= 1 && f > 0.6) { const tile = damage[leg - 1]; if (tile) this.topple(tile); }
      this.shake = Math.max(this.shake, 0.15);
      if (t < legSeconds * (path.length - 1)) return false;
      this.root.remove(funnel);
      funnel.children.forEach(ring => (ring as Mesh).geometry.dispose());
      material.dispose();
      return true;
    });
  }

  /** Solar flare: the sky blazes orange, the grid browns out and exposed roofs catch fire. */
  private solarFlare(damage: Tile[], ignite: (tile: Tile) => void) {
    this.flashSky(0xff9a3a, 2.2);
    scaleSharedGlow(0.1);
    this.daylightClock = 4; // hold the brown-out before daylight restores the glow
    let t = 0;
    damage.forEach((tile, index) => { if (tile.building) tile.building.userData.flareAt = 0.5 + index * 0.25; });
    this.effects.push(delta => {
      t += delta;
      for (const tile of damage) {
        const building = tile.building;
        if (building?.userData.flareAt !== undefined && t >= building.userData.flareAt) { building.userData.flareAt = undefined; ignite(tile); }
      }
      if (t < 3.2) return false;
      this.daylightClock = 0;
      return true;
    });
  }

  /** Gamma-ray burst: a violet beam from deep space scorches a line through the city. */
  private gammaBurst(target: Vector3, damage: Tile[], ignite: (tile: Tile) => void) {
    const beam = new Mesh(new CylinderGeometry(0.22, 0.32, 40, 12, 1, true), new MeshStandardMaterial({ color: 0xd46bff, emissive: 0xb04aff, emissiveIntensity: 3, transparent: true, opacity: 0.75, side: 2 }));
    beam.position.copy(target).setY(20);
    beam.scale.set(0.05, 1, 0.05);
    this.root.add(beam);
    this.flashSky(0xc88aff, 1.6);
    let t = 0;
    this.effects.push(delta => {
      t += delta;
      const width = t < 0.4 ? t / 0.4 : t < 1.8 ? 1 : Math.max(0.01, 1 - (t - 1.8) / 0.8);
      beam.scale.set(width * (1 + Math.sin(t * 40) * 0.08), 1, width);
      if (t > 0.4 && t < 1.8) {
        this.shake = Math.max(this.shake, 0.5);
        for (let i = 0; i < 2; i++) this.puff(target.clone().setY(0.2), [0xd46bff, 0xffffff][i], 0.07, 0.8, new Vector3((this.random() - 0.5) * 4, 2 + this.random() * 2, (this.random() - 0.5) * 4), 3);
      }
      if (t > 0.6 && damage.length) { damage.forEach(ignite); damage.forEach(tile => this.topple(tile)); damage = []; }
      if (t < 2.6) return false;
      this.root.remove(beam);
      beam.geometry.dispose();
      (beam.material as MeshStandardMaterial).dispose();
      return true;
    });
  }

  /** Black hole: a pinprick opens above the city and swallows buildings whole, no rubble left. */
  private blackHole(target: Vector3, damage: Tile[]) {
    const hole = new Group();
    hole.position.copy(target).setY(2.6);
    const core = new Mesh(new SphereGeometry(0.5, 16, 12), new MeshBasicMaterial({ color: 0x000000 }));
    const disk = new Mesh(new TorusGeometry(0.95, 0.16, 8, 40), new MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6a20, emissiveIntensity: 2.4 }));
    disk.rotation.x = Math.PI / 2 - 0.3;
    const halo = new Mesh(new TorusGeometry(1.3, 0.04, 6, 40), new MeshStandardMaterial({ color: 0xd46bff, emissive: 0xb04aff, emissiveIntensity: 2, transparent: true, opacity: 0.7 }));
    halo.rotation.x = Math.PI / 2 - 0.3;
    hole.add(core, disk, halo);
    hole.scale.setScalar(0.01);
    this.root.add(hole);
    const victims = damage.map((tile, index) => ({ tile, at: 1.2 + index * 0.45, start: tile.building?.position.clone() }));
    let t = 0;
    const end = 2.2 + damage.length * 0.45 + 1.4;
    this.effects.push(delta => {
      t += delta;
      const grow = t < 1 ? t : t > end - 1 ? Math.max(0.01, end - t) : 1;
      hole.scale.setScalar(grow);
      disk.rotation.z += delta * 3;
      halo.rotation.z -= delta * 1.5;
      this.shake = Math.max(this.shake, 0.2 * grow);
      for (let i = 0; i < 3; i++) {
        // Debris spirals inward.
        const angle = this.random() * Math.PI * 2, r = 2 + this.random() * 2;
        const from = hole.position.clone().add(new Vector3(Math.cos(angle) * r, -1.8 + this.random(), Math.sin(angle) * r));
        this.puff(from, [0x9a8a72, 0xffa040, 0xd46bff][i], 0.04, 0.7, hole.position.clone().sub(from).multiplyScalar(1.4), 0, true);
      }
      for (const victim of victims) {
        const building = victim.tile.building;
        if (!building || t < victim.at) continue;
        const f = Math.min(1, (t - victim.at) / 0.9);
        const local = victim.tile.group.worldToLocal(hole.position.clone());
        building.position.lerpVectors(victim.start ?? building.position, local, f * f);
        building.scale.setScalar(Math.max(0.01, 1 - f));
        building.rotation.y += delta * 6 * f;
        if (f >= 1) { this.destroyBuilding(victim.tile); victim.tile.building = undefined; }
      }
      if (t < end) return false;
      this.root.remove(hole);
      for (const part of [core, disk, halo]) { part.geometry.dispose(); (part.material as MeshStandardMaterial).dispose(); }
      return true;
    });
  }

  // ---------- Kardashev skies ----------
  private sky?: Group;

  /** Megastructures overhead: satellites (Type I), an orbital ring and space elevator (Type II), a wormhole (Type III). */
  private buildSky() {
    if (this.sky) { this.root.remove(this.sky); disposeObject(this.sky); }
    const sky = new Group();
    const era = this.technologyEra;
    const glow = mat(this.theme.glow, 0.3, { emissive: this.theme.glow, emissiveIntensity: 2 });
    const metal = mat(0xdfe4e8, 0.35, { metalness: 0.5 });
    const spinners: Array<{ object: Object3D; speed: number }> = [];
    // Type I: satellites and a swarm of orbital mirrors.
    const orbit = new Group();
    orbit.position.y = 9;
    for (let i = 0; i < 5; i++) {
      const satellite = new Group();
      const angle = (i / 5) * Math.PI * 2;
      satellite.position.set(Math.cos(angle) * (this.activeRadius + 3), (i % 2) * 0.8, Math.sin(angle) * (this.activeRadius + 3));
      satellite.add(new Mesh(new BoxGeometry(0.22, 0.22, 0.32), metal));
      for (const sx of [-1, 1]) {
        const panel = new Mesh(new BoxGeometry(0.6, 0.02, 0.26), mat(0x2a4a8a, 0.3, { metalness: 0.4 }));
        panel.position.x = sx * 0.42;
        satellite.add(panel);
      }
      const light = new Mesh(new SphereGeometry(0.05, 6, 4), glow);
      light.position.y = 0.14;
      satellite.add(light);
      orbit.add(satellite);
    }
    sky.add(orbit);
    spinners.push({ object: orbit, speed: 0.08 });
    if (era >= 8) {
      // Type II: an orbital ring and a space elevator rising from the capitol.
      const ring = new Group();
      ring.position.y = 17;
      const band = new Mesh(new TorusGeometry(this.activeRadius + 5, 0.14, 8, 72), metal);
      band.rotation.x = Math.PI / 2;
      ring.add(band);
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const lamp = new Mesh(new SphereGeometry(0.1, 6, 4), glow);
        lamp.position.set(Math.cos(angle) * (this.activeRadius + 5), 0, Math.sin(angle) * (this.activeRadius + 5));
        ring.add(lamp);
      }
      ring.rotation.z = 0.12;
      sky.add(ring);
      spinners.push({ object: ring, speed: 0.04 });
      const base = this.hearthTile?.group.position ?? new Vector3();
      const tether = new Mesh(new CylinderGeometry(0.04, 0.04, 40, 6), mat(0xe9edf0, 0.4, { metalness: 0.4 }));
      tether.position.set(base.x + 1.4, 20, base.z - 1.4);
      sky.add(tether);
      const climber = new Mesh(new BoxGeometry(0.3, 0.4, 0.3), glow);
      climber.position.set(base.x + 1.4, 2, base.z - 1.4);
      climber.userData.climber = true;
      sky.add(climber);
    }
    if (era >= 9) {
      // Type III: a wormhole held open above the city.
      const gate = new Group();
      gate.position.set(-this.activeRadius - 2, 11, -this.activeRadius - 2);
      gate.rotation.y = Math.PI / 4;
      const rim = new Mesh(new TorusGeometry(2.2, 0.22, 10, 48), mat(0x262b33, 0.4, { metalness: 0.6, emissive: 0xb04aff, emissiveIntensity: 0.6 }));
      const swirl = new Mesh(new CylinderGeometry(2, 2, 0.02, 40), new MeshStandardMaterial({ color: 0x6fd8ff, emissive: 0x9a5aff, emissiveIntensity: 1.6, transparent: true, opacity: 0.6 }));
      swirl.rotation.x = Math.PI / 2;
      const eye = new Mesh(new SphereGeometry(0.5, 12, 8), new MeshBasicMaterial({ color: 0xffffff }));
      gate.add(rim, swirl, eye);
      sky.add(gate);
      spinners.push({ object: swirl, speed: 0.6 });
    }
    sky.userData.spinners = spinners;
    this.root.add(sky);
    this.sky = sky;
  }

  private updateSky(delta: number) {
    const sky = this.sky;
    if (!sky) return;
    for (const { object, speed } of sky.userData.spinners as Array<{ object: Object3D; speed: number }>) object.rotation.y += speed * delta;
    for (const child of sky.children) if (child.userData.climber) child.position.y = 2 + (Math.sin(this.actorClock * 0.15) * 0.5 + 0.5) * 30;
  }

  // ---------- air traffic ----------
  private airClock = 12;
  private airborne = 0;

  /** Hot-air balloons over a growing town, prop planes and airliners later, takeoffs from airports. */
  private updateAirTraffic(delta: number) {
    this.airClock -= delta;
    if (this.airClock > 0 || this.asleep) return;
    const era = this.technologyEra;
    this.airClock = 14 + this.random() * 16;
    if (this.airborne >= 4) return;
    const airports = this.tiles.filter(tile => tile.building?.userData.style === "airport" && tile.building.userData.collapse === undefined);
    const day = this.nightGlow < 0.7;
    const roll = this.random();
    if (era >= 2 && era <= 6 && day && roll < 0.35) this.flyBalloon();
    else if (airports.length && era >= 4 && roll < 0.75) this.flyPlane(airports[Math.floor(this.random() * airports.length)], era >= 5);
    else if (era >= 5) this.flyPlane(undefined, true);
  }

  private flyBalloon() {
    const balloon = bustle.balloon(() => this.random());
    const reach = this.activeRadius + 6;
    const angle = this.random() * Math.PI * 2;
    const from = new Vector3(Math.cos(angle) * reach, 4 + this.random() * 2.5, Math.sin(angle) * reach);
    const to = from.clone().multiplyScalar(-1).setY(from.y + 1.5);
    balloon.scale.setScalar(0.55 + this.random() * 0.25);
    balloon.position.copy(from);
    this.root.add(balloon);
    this.airborne++;
    let t = 0;
    const seconds = 60 + this.random() * 30;
    this.effects.push(delta => {
      t += delta / seconds;
      balloon.position.lerpVectors(from, to, t);
      balloon.position.y += Math.sin(t * 40) * 0.15;
      if (t < 1) return false;
      this.root.remove(balloon);
      disposeObject(balloon);
      this.airborne--;
      return true;
    });
  }

  /** A takeoff from an airport tile (rolls down the runway, climbs out), or an airliner passing high over. */
  private flyPlane(from: Tile | undefined, jet: boolean) {
    const plane = bustle.flyingPlane(this.theme, jet);
    plane.scale.setScalar(from ? 0.45 : 0.8);
    this.root.add(plane);
    this.airborne++;
    const reach = this.activeRadius + 8;
    let t = 0;
    const heading = this.random() * Math.PI * 2;
    const start = from ? from.group.position.clone().setY(0.08) : new Vector3(Math.cos(heading) * reach, 8 + this.random() * 2, Math.sin(heading) * reach);
    const direction = from ? new Vector3(1, 0, 0).applyQuaternion(from.building!.getWorldQuaternion(new Quaternion())).setY(0).normalize() : start.clone().multiplyScalar(-1).setY(0).normalize();
    const seconds = from ? 16 : 22;
    this.effects.push(delta => {
      t += delta;
      const f = t / seconds;
      if (from) {
        // Taxi and roll for a moment, then climb away.
        const roll = Math.min(t, 2.5) * Math.min(t, 2.5) * 0.12;
        const climb = Math.max(0, t - 2.5);
        plane.position.copy(start).addScaledVector(direction, roll + climb * 1.6).setY(start.y + climb * climb * 0.16);
        plane.scale.setScalar(0.45 + Math.min(0.35, climb * 0.05));
        plane.rotation.z = Math.min(0.25, climb * 0.1);
      } else plane.position.copy(start).addScaledVector(direction, f * reach * 2);
      plane.rotation.y = Math.atan2(-direction.z, direction.x);
      if (f < 1) return false;
      this.root.remove(plane);
      disposeObject(plane);
      this.airborne--;
      return true;
    });
  }

  // ---------- households ----------
  /** Offline: a family packs up and leaves; their home goes dark with a sign out front. */
  private moveOut(historical: boolean) {
    const homes = this.tiles.filter(tile => tile.building && tile.kind === "house" && !tile.building.userData.vacant && tile.building.userData.collapse === undefined);
    const vacant = this.tiles.filter(tile => tile.building?.userData.vacant).length;
    if (!homes.length || vacant >= Math.ceil((homes.length + vacant) * 0.6)) return;
    // Outskirts empty first: people drift away from the edges of town.
    const hearth = this.hearthTile;
    homes.sort((a, b) => (hearth ? Math.hypot(b.x - hearth.x, b.z - hearth.z) - Math.hypot(a.x - hearth.x, a.z - hearth.z) : 0) + (this.random() - 0.5) * 2);
    const tile = homes[0];
    const building = tile.building!;
    building.userData.vacant = true;
    const sign = new Group();
    sign.userData.keep = true;
    sign.userData.vacancySign = true;
    const post = new Mesh(new BoxGeometry(0.02, 0.22, 0.02), mat(0x5a3f2a, 1));
    post.position.y = 0.11;
    const board = new Mesh(new BoxGeometry(0.16, 0.09, 0.012), mat(this.technologyEra >= 4 ? 0xd9342b : 0xc9b38a, 0.8));
    board.position.y = 0.2;
    const stripe = new Mesh(new BoxGeometry(0.12, 0.018, 0.014), mat(0xf4ecd8, 0.8));
    stripe.position.y = 0.2;
    sign.add(post, board, stripe);
    sign.position.set(0.32, 0, 0.4);
    building.add(sign);
    if ((building.userData.wear ?? 0) < 1) this.setWear(tile, 1);
    this.streetsDirty = true;
    if (historical) return;
    // Boxes carried out to the street.
    for (let i = 0; i < 8; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.5, 0.15, 0.45)), [0xb08a5a, 0xc9a26a][i % 2], 0.05, 1.4, new Vector3((this.random() - 0.5) * 0.4, 0.6, 0.8), 1.2, true);
    this.onNotice?.({ kind: "moveOut", user: "", at: tile.group.position.clone() });
  }

  /** Back online: a family moves home again, the sign comes down and the lights come on. */
  private moveIn(historical: boolean) {
    const tile = this.tiles.find(candidate => candidate.building?.userData.vacant);
    if (!tile) return;
    const building = tile.building!;
    building.userData.vacant = false;
    const sign = building.children.find(child => child.userData.vacancySign);
    if (sign) { building.remove(sign); disposeObject(sign); }
    this.streetsDirty = true;
    if (historical) return;
    for (let i = 0; i < 10; i++) this.puff(tile.group.position.clone().add(new Vector3((this.random() - 0.5) * 0.6, 0.4 + this.random() * 0.5, (this.random() - 0.5) * 0.6)), i % 2 ? 0xffe08a : 0x9ff0b8, 0.035, 0.9, new Vector3(0, 0.8, 0), 0.4);
    this.onNotice?.({ kind: "moveIn", user: "", at: tile.group.position.clone() });
  }

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
  private locustSwarm(target: Vector3, damage: Tile[], scale = 1, drones = false) {
    const bugs: Mesh[] = [];
    // Rogue AI: the same swarm, but glowing red machine drones.
    const bugMat = drones ? mat(0x30353a, 0.4, { emissive: 0xff2a2a, emissiveIntensity: 1.6 }) : mat(0x2a2a1e, 0.8);
    const geometry = drones ? new BoxGeometry(0.09, 0.025, 0.09) : new BoxGeometry(0.05, 0.03, 0.08);
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
    else if (event.type === "regression") this.loseEra(event.era, historical);
    else if (event.type === "build") this.build(event.kind, event.count, historical, event.builders);
    else if (event.type === "rebuild") this.rebuild(event.count, historical, event.builders);
    else if (event.type === "command") this.runCommand(event, historical);
    else if (event.type === "capitol") this.setCapitol(event.stage, event.donors, historical);
    else if (event.type === "homeUpgrade") this.upgradeHome(event.owner, event.level, event.color, historical);
    else if (event.type === "boom") this.boom(event.viewers, historical);
    else if (event.type === "disaster") this.disaster(event.intensity, historical, event.damageCount, event.durationMs, event.kind);
    else if (event.type === "effect" && !historical) { this.fireworks(this.focus.x, this.focus.z, event.intensity); this.life.cheer(3); }
    else if (event.type === "decay") for (let i = 0; i < event.count; i++) this.wearDown(historical, event.gentle);
    else if (event.type === "moveOut") for (let i = 0; i < event.count; i++) this.moveOut(historical);
    else if (event.type === "moveIn") for (let i = 0; i < event.count; i++) this.moveIn(historical);
    else if (event.type === "chapter") this.raiseMonument(event.number, event.title, event.hero, historical);
    else if (event.type === "welcome" && !historical) { this.life.cheer(4); this.onNotice?.({ kind: "welcome", user: "", level: Math.round(event.awayHours) }); }
    else if (event.type === "repair") for (let i = 0; i < event.count; i++) { const at = this.repairOne(historical); if (event.by && at && !historical) this.onNotice?.({ kind: "repair", user: event.by, at }); }
  }

  private updateBuildings(delta: number) {
    this.updateRebuilds(delta);
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
        if (step >= steps) {
          const rubble = building.userData.leavesRubble;
          this.destroyBuilding(tile);
          if (rubble) { for (const tree of tile.trees) tile.group.remove(tree); tile.trees = []; this.addRubble(tile); }
        }
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
        if (tile.burningUntil && performance.now() >= tile.burningUntil && building.userData.collapse === undefined) { building.userData.collapse = 0; building.userData.leavesRubble = true; }
      }
    }
  }

  private destroyBuilding(tile: Tile) {
    if (tile.building) {
      tile.formerKind = tile.kind === "landmark" ? "landmark" : tile.kind === "fire" ? tile.formerKind ?? "house" : "house";
      tile.formerOwner = tile.building.userData.owner as string | undefined;
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


  /** While a late joiner rebuilds the city's past, frames are skipped entirely. */
  private catchingUp = false;
  /** Merges quiet regions of finished buildings so a grown city stays cheap to draw on stream. */
  private merger = new StaticMerger(this.root, () => {
    const moving = new Set<Object3D>();
    for (const { part } of this.animated) if (part.kind !== "smoke") moving.add(part.object);
    return moving;
  });
  setCatchingUp(on: boolean) {
    this.catchingUp = on;
    if (!on) { this.previousFrame = performance.now(); this.frameBudget = 0; this.shadowsDirty = true; }
  }

  private animate = () => {
    if (this.destroyed || this.catchingUp) return;
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
    this.updateDaylight(delta);
    this.updateTrafficLights();
    this.birdClock -= delta;
    if (this.birdClock <= 0) { this.birdClock = 25 + this.random() * 30; if (!this.asleep && this.nightGlow < 0.9) this.launchBirds(); }
    if (this.streetsDirty) this.rebuildStreets();
    if (this.merger.update(this.tiles, now)) this.shadowsDirty = true;
    this.updateCampfire(delta);
    this.updateSky(delta);
    this.updateAirTraffic(delta);
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
    this.updateViewerCamera(delta);
    const cos = Math.cos(this.viewAngle), sin = Math.sin(this.viewAngle);
    const baseX = this.cameraBase.x * cos - this.cameraBase.z * sin, baseZ = this.cameraBase.x * sin + this.cameraBase.z * cos;
    this.camera.position.set(this.pan.x + baseX + (Math.random() - 0.5) * jolt, this.cameraBase.y + (Math.random() - 0.5) * jolt, this.pan.z + baseZ + (Math.random() - 0.5) * jolt);
    this.camera.lookAt(this.pan.x, 0, this.pan.z);
    if (this.groundDirty) {
      this.ground.instanceMatrix.needsUpdate = true;
      if (this.ground.instanceColor) this.ground.instanceColor.needsUpdate = true;
      this.groundDirty = false;
    }
    // Moving construction and burning buildings can dirty shadows every frame. Updating the full
    // 2048² shadow map at render rate is expensive, so refresh it at most 10 times per second.
    if (this.shadowsDirty && now - this.lastShadowUpdate >= ChatCity.SHADOW_UPDATE_MS) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
      this.lastShadowUpdate = now;
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  };

  /** Screen point over a random building or villager that is actually on screen. */
  scatterPoint() {
    const rect = this.host.getBoundingClientRect();
    const built = this.tiles.filter(tile => tile.building && tile.group.visible);
    for (let attempt = 0; attempt < 8; attempt++) {
      const world = built.length && this.random() < 0.75
        ? built[Math.floor(this.random() * built.length)].group.position.clone().setY(0.5 + this.random() * 0.4)
        : this.life.speakerPosition()?.setY(0.2);
      if (!world) continue;
      const point = this.screenPoint(world);
      if (point.x > rect.left + 80 && point.x < rect.right - 80 && point.y > rect.top + 70 && point.y < rect.bottom - 170) return point;
    }
    return undefined;
  }

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

  // ---------- viewer camera: zoom, pan, follow ----------

  private updateViewerCamera(delta: number) {
    if (this.follow) this.targetPan.set(this.focus.x, 0, this.focus.z);
    this.clampPan(this.targetPan);
    const ease = 1 - Math.exp(-10 * delta);
    this.pan.lerp(this.targetPan, ease);
    const zoom = this.userZoom + (this.targetUserZoom - this.userZoom) * ease;
    if (Math.abs(zoom - this.userZoom) > 1e-5) {
      this.userZoom = Math.abs(this.targetUserZoom - zoom) < 1e-4 ? this.targetUserZoom : zoom;
      this.camera.zoom = 1.18 * this.zoom * this.userZoom;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Keep the camera over the island: the further in you zoom, the further you may roam. */
  private clampPan(pan: Vector3) {
    pan.y = 0;
    const limit = this.activeRadius + 3;
    const length = Math.hypot(pan.x, pan.z);
    if (length > limit) pan.multiplyScalar(limit / length);
  }

  /** The ground point under a CSS pixel position (client coordinates), for the current camera. */
  groundAt(clientX: number, clientY: number) {
    const rect = this.host.getBoundingClientRect();
    const ndc = new Vector3((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, -1);
    const origin = ndc.clone().unproject(this.camera);
    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    if (Math.abs(direction.y) < 1e-6) return undefined;
    const t = -origin.y / direction.y;
    return origin.addScaledVector(direction, t).setY(0);
  }

  /** Zoom by a factor, keeping the ground point under the cursor fixed when one is given. */
  zoomBy(factor: number, clientX?: number, clientY?: number) {
    const next = Math.min(ChatCity.MAX_ZOOM, Math.max(ChatCity.MIN_ZOOM, this.targetUserZoom * factor));
    if (next === this.targetUserZoom) return;
    if (clientX !== undefined && clientY !== undefined) {
      const anchor = this.groundAt(clientX, clientY);
      if (anchor) {
        // In an orthographic view the anchor's offset from the centre scales with 1/zoom.
        this.follow = false;
        const keep = this.userZoom / next;
        this.targetPan.set(anchor.x - (anchor.x - this.pan.x) * keep, 0, anchor.z - (anchor.z - this.pan.z) * keep);
      }
    }
    this.targetUserZoom = next;
  }

  /** Drag the ground from one screen point to another (1:1 under the cursor). */
  dragPan(fromX: number, fromY: number, toX: number, toY: number) {
    const from = this.groundAt(fromX, fromY), to = this.groundAt(toX, toY);
    if (!from || !to) return;
    this.follow = false;
    this.pan.sub(to).add(from);
    this.clampPan(this.pan);
    this.targetPan.copy(this.pan);
  }

  /** Move the view in screen directions (right, up), in world units scaled by the zoom. */
  panBy(right: number, up: number) {
    this.follow = false;
    const step = this.viewSpan / 2 / this.userZoom;
    // Screen up is the camera's heading flattened onto the ground; screen right is perpendicular.
    const heading = new Vector3();
    this.camera.getWorldDirection(heading);
    heading.setY(0).normalize();
    const upX = heading.x, upZ = heading.z;
    const rightX = -heading.z, rightZ = heading.x;
    this.targetPan.x += (rightX * right + upX * up) * step;
    this.targetPan.z += (rightZ * right + upZ * up) * step;
  }

  /** Smoothly glide to a world point and zoom in on it. */
  lookAt(clientX: number, clientY: number, factor = 2) {
    const point = this.groundAt(clientX, clientY);
    if (!point) return;
    this.follow = false;
    this.targetPan.copy(point);
    this.targetUserZoom = Math.min(ChatCity.MAX_ZOOM, Math.max(ChatCity.MIN_ZOOM, this.targetUserZoom * factor));
  }

  /** Follow the latest build or attack around the city. Returns whether following is now on. */
  toggleFollow(on = !this.follow) {
    this.follow = on;
    if (on && this.targetUserZoom < 2) this.targetUserZoom = 2.5;
    return this.follow;
  }

  resetView() {
    this.follow = false;
    this.targetPan.set(0, 0, 0);
    this.targetUserZoom = 1;
  }

  get viewerZoom() { return this.targetUserZoom; }
  get following() { return this.follow; }

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
    this.merger.dispose();
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}
