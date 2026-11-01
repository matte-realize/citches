import { Group, MathUtils, Vector3 } from "three";
import { cylinderGeo, disposeObject, place, sharedMat } from "./kit.js";
import { makeBlimp, makeBus, makeCar, makePerson, makeSheep, makeWagon, posePerson } from "./models.js";
import type { PersonPose, PersonRig, VehicleModel } from "./models.js";
import { DIRS, ROAD_Y, streetSurface } from "./streets.js";
import type { StreetCell } from "./streets.js";
import type { CityTheme, CityThemeId } from "./theme.js";

export type NetCell = StreetCell & { key: string; x: number; z: number };
export interface Door { key: string; dir: number; point: Vector3 }
export interface LifeHost {
  random(): number;
  cellAt(x: number, z: number): { cell?: NetCell; localX: number; localZ: number };
  cityRadius(): number;
}

type Kind = "person" | "car" | "bus" | "wagon" | "sheep" | "blimp";
type State = "emerge" | "toLane" | "walk" | "chat" | "idle" | "toDoor" | "enter" | "gather" | "roam" | "graze" | "drive" | "fly" | "leave";
interface Traversal { cur: string; prev?: string; next?: string; t: number; p0: Vector3; p1: Vector3; p2: Vector3; len: number }
interface Seat { pos: Vector3; face: number; bench: boolean; taken?: Agent }
interface Agent {
  id: number; kind: Kind; group: Group; state: State;
  rig?: PersonRig; model?: VehicleModel; sheep?: ReturnType<typeof makeSheep>;
  pos: Vector3; avoid: Vector3; heading: number; speed: number; cruise: number; phase: number; radius: number;
  trav?: Traversal; route: string[]; goalDoor?: Door;
  timer: number; target?: Vector3; partner?: Agent; anchor?: Vector3; seat?: Seat;
  wait: number; ghost: number; chatCooldown: number; scale: number; pose: PersonPose; panic: number; cheer: number; dead?: boolean;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const dirVec = (d: number) => new Vector3(DIRS[d][0], 0, DIRS[d][1]);
const rightOf = (v: Vector3) => new Vector3(-v.z, 0, v.x);
const angleLerp = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Everything that moves in the city: villagers with walk cycles, lane-following traffic that
 * yields at intersections, grazing sheep and blimps. Agents push each other apart so nobody
 * walks through anybody else.
 */
export class CityLife {
  private agents: Agent[] = [];
  private cells = new Map<string, NetCell>();
  private linked: NetCell[] = [];
  private doors: Door[] = [];
  private seats: Seat[] = [];
  private nextId = 1;
  private era = 0;
  private houses = 0;
  private populationClock = 0;
  private clock = 0;
  /** Crowd caps; the overlay runs inside another busy page, so it uses lighter limits. */
  limits = { people: 48, cars: 22 };
  private asleep = false;
  private night = false;

  constructor(private root: Group, private host: LifeHost, private theme: CityTheme, private themeId: CityThemeId) {}

  private get random() { return this.host.random; }
  private pedestrianLane() { return this.era < 2 ? 0.07 : this.era < 4 ? 0.15 : 0.38; }
  private vehicleLane(kind: Kind) { return kind === "wagon" ? 0.07 : 0.135; }

  setNetwork(cells: Map<string, NetCell>, doors: Door[], houses: number) {
    this.cells = cells;
    this.linked = [...cells.values()].filter(cell => cell.links.some(Boolean));
    this.doors = doors;
    this.houses = houses;
  }

  /** Late at night fewer villagers are out and about (traffic too). */
  setNight(night: boolean) { this.night = night; }

  /**
   * Bedtime: walkers head home and go indoors, cars park and vanish, the fireside group nods off
   * and sheep lie down. Waking up lets everyone back out.
   */
  setAsleep(asleep: boolean) {
    this.asleep = asleep;
    if (!asleep) return;
    for (const agent of this.agents) {
      if (agent.kind === "car" || agent.kind === "bus" || agent.kind === "wagon") agent.state = "leave";
      else if (agent.kind === "person" && !agent.seat) this.goHome(agent);
      else if (agent.kind === "person" && agent.seat && agent.state === "roam") agent.state = "gather";
    }
  }

  private goHome(agent: Agent) {
    if (agent.state === "enter" || agent.state === "toDoor" || !agent.trav) { if (agent.state !== "enter" && agent.state !== "toDoor") agent.dead = true; return; }
    if (agent.partner) { agent.partner.partner = undefined; agent.partner = undefined; }
    if (agent.state === "emerge") { agent.state = "enter"; agent.timer = 0.4 - agent.scale * 0.4; return; }
    const tr = agent.trav;
    const here = this.cells.get(tr.cur);
    const doors = [...this.doors].sort((a, b) => a.point.distanceToSquared(agent.pos) - b.point.distanceToSquared(agent.pos));
    for (const door of doors.slice(0, 6)) {
      const route = this.findRoute(tr.cur, door.key);
      if (!route) continue;
      agent.goalDoor = door;
      agent.route = route;
      tr.next = agent.route.shift();
      agent.cruise = Math.max(agent.cruise, 0.2);
      if (!tr.next && door.key === tr.cur) { agent.target = door.point; agent.state = "toDoor"; }
      else this.rejoinLane(agent);
      return;
    }
    if (!here) agent.dead = true;
  }

  setEra(era: number) {
    if (era === this.era) return;
    this.era = era;
    for (const agent of this.agents) {
      if (agent.kind === "wagon" && era >= 4) agent.state = "leave";
      if (agent.kind === "person" && agent.trav && agent.state === "walk") this.rejoinLane(agent);
    }
    const blimps = this.agents.filter(agent => agent.kind === "blimp").length;
    const wanted = era >= 6 ? 3 : era >= 5 ? 2 : 0;
    for (let i = blimps; i < wanted; i++) this.spawnBlimp(i);
  }

  // ---------- spawning ----------
  private addAgent(kind: Kind, group: Group, pos: Vector3, extra: Partial<Agent> = {}): Agent {
    group.position.copy(pos);
    this.root.add(group);
    const agent: Agent = {
      id: this.nextId++, kind, group, state: "idle", pos: pos.clone(), avoid: new Vector3(), heading: 0, speed: 0, cruise: 0.2,
      phase: this.random() * Math.PI * 2, radius: 0.075, route: [], timer: 0, wait: 0, ghost: 0, chatCooldown: 2, scale: 1, pose: "idle", panic: 0, cheer: 0, ...extra
    };
    this.agents.push(agent);
    return agent;
  }

  /** Founding villagers gathered round the first campfire, some sat on logs. */
  seedGathering(center: Vector3, count = 4) {
    const seatCount = 6;
    for (let i = 0; i < seatCount; i++) {
      const angle = (i / seatCount) * Math.PI * 2 + 0.3;
      const pos = new Vector3(center.x + Math.sin(angle) * 0.72, 0, center.z + Math.cos(angle) * 0.72);
      const seat: Seat = { pos, face: angle + Math.PI, bench: i % 2 === 0 };
      if (seat.bench) {
        const log = place(this.root, cylinderGeo(0.05, 0.055, 0.34, 7), sharedMat(0x5a3f2a, 1), pos.x, 0.05, pos.z);
        log.rotation.order = "YZX";
        log.rotation.z = Math.PI / 2;
        log.rotation.y = angle;
      }
      this.seats.push(seat);
    }
    for (let i = 0; i < count; i++) {
      const seat = this.seats[(i * 2 + (i > 2 ? 1 : 0)) % seatCount];
      const rig = makePerson(this.random, 0, this.themeId, this.theme);
      const agent = this.addAgent("person", rig.root, seat.pos, { rig, state: "gather", seat, heading: seat.face, timer: 2 + this.random() * 6, anchor: center.clone() });
      seat.taken = agent;
    }
  }

  private joinGathering() {
    const seat = this.seats.find(candidate => !candidate.taken);
    if (!seat) return;
    // Newcomers walk in from the edge of the clearing rather than appearing on the log.
    const rig = makePerson(this.random, this.era, this.themeId, this.theme);
    const outward = seat.pos.clone().sub(this.seats[0].pos.clone().add(this.seats[3]?.pos ?? this.seats[0].pos).multiplyScalar(0.5)).setY(0).normalize();
    const start = seat.pos.clone().addScaledVector(outward, 1.2);
    const agent = this.addAgent("person", rig.root, start, { rig, state: "roam", seat, target: seat.pos, timer: 3 + this.random() * 5, scale: 1 });
    seat.taken = agent;
  }

  addSheep(pasture: Vector3) {
    if (this.agents.filter(agent => agent.kind === "sheep").length >= 10) return;
    const sheep = makeSheep(this.random);
    this.addAgent("sheep", sheep.root, pasture.clone().add(new Vector3((this.random() - 0.5) * 0.3, 0, (this.random() - 0.5) * 0.3)), {
      sheep, anchor: pasture.clone(), state: "graze", timer: this.random() * 4, radius: 0.12, heading: this.random() * Math.PI * 2
    });
  }

  private spawnPerson() {
    const door = this.doors[Math.floor(this.random() * this.doors.length)];
    if (!door || this.agents.some(agent => agent.kind === "person" && agent.pos.distanceTo(door.point) < 0.2)) return;
    const rig = makePerson(this.random, this.era, this.themeId, this.theme);
    const back = dirVec(door.dir).multiplyScalar(-1);
    const agent = this.addAgent("person", rig.root, door.point, {
      rig, state: "emerge", scale: 0, heading: Math.atan2(back.x, back.z), cruise: 0.15 + this.random() * 0.08, timer: 0
    });
    agent.trav = { cur: door.key, t: 0.5, p0: new Vector3(), p1: new Vector3(), p2: new Vector3(), len: 1 };
    rig.root.scale.setScalar(0.001);
  }

  private spawnVehicle(kind: "car" | "bus" | "wagon") {
    if (!this.linked.length) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cell = this.linked[Math.floor(this.random() * this.linked.length)];
      const options = cell.links.map((linked, d) => linked ? d : -1).filter(d => d >= 0);
      const dir = options[Math.floor(this.random() * options.length)];
      const nextKey = `${cell.x + DIRS[dir][0]},${cell.z + DIRS[dir][1]}`;
      const spot = new Vector3(cell.px, 0, cell.pz);
      if (this.agents.some(agent => (agent.kind === "car" || agent.kind === "bus" || agent.kind === "wagon") && agent.pos.distanceTo(spot) < 0.9)) continue;
      const model = kind === "car" ? makeCar(this.random, this.era, this.theme) : kind === "bus" ? makeBus(this.random, this.theme) : makeWagon(this.random);
      const agent = this.addAgent(kind, model.root, spot, {
        model, state: "drive", scale: 0, radius: model.width / 2, cruise: kind === "car" ? 0.5 + this.random() * 0.25 : kind === "bus" ? 0.38 : 0.24
      });
      agent.trav = { cur: cell.key, next: nextKey, t: 0.5, p0: new Vector3(), p1: new Vector3(), p2: new Vector3(), len: 1 };
      this.setupCurve(agent);
      this.curvePoint(agent.trav, agent.trav.t, agent.pos);
      agent.heading = this.curveHeading(agent.trav, agent.trav.t);
      model.root.scale.setScalar(0.001);
      return;
    }
  }

  private spawnBlimp(index: number) {
    const model = makeBlimp(this.theme);
    this.addAgent("blimp", model.root, new Vector3(0, 5, 0), { model, state: "fly", phase: index * 2.1, cruise: 0.05 + index * 0.012, radius: 1 });
  }

  // ---------- route geometry ----------
  private dirBetween(from: string, to: string) {
    const a = this.cells.get(from), b = this.cells.get(to);
    if (!a || !b) return new Vector3(0, 0, 1);
    return new Vector3(Math.sign(b.x - a.x), 0, Math.sign(b.z - a.z));
  }

  private laneFor(agent: Agent) { return agent.kind === "person" ? this.pedestrianLane() : this.vehicleLane(agent.kind); }

  /** One quadratic curve per tile: enter on the lane at one edge, leave on the lane at the next edge. */
  private setupCurve(agent: Agent) {
    const tr = agent.trav!;
    const cell = this.cells.get(tr.cur);
    if (!cell) return;
    const center = new Vector3(cell.px, 0, cell.pz);
    const lane = this.laneFor(agent);
    const hx = Math.sin(agent.heading), hz = Math.cos(agent.heading);
    const fallback = Math.abs(hx) > Math.abs(hz) ? new Vector3(Math.sign(hx), 0, 0) : new Vector3(0, 0, Math.sign(hz) || 1);
    const dirOut = tr.next ? this.dirBetween(tr.cur, tr.next) : tr.prev ? this.dirBetween(tr.prev, tr.cur) : fallback;
    const dirIn = tr.prev ? this.dirBetween(tr.prev, tr.cur) : dirOut.clone();
    tr.p0.copy(center).addScaledVector(dirIn, -0.5).addScaledVector(rightOf(dirIn), lane);
    tr.p2.copy(center).addScaledVector(dirOut, 0.5).addScaledVector(rightOf(dirOut), lane);
    const dot = dirIn.dot(dirOut);
    if (dot > 0.5) tr.p1.lerpVectors(tr.p0, tr.p2, 0.5);
    else if (dot < -0.5) tr.p1.copy(center).addScaledVector(dirIn, 0.5);
    else tr.p1.copy(center).addScaledVector(rightOf(dirIn), lane).addScaledVector(rightOf(dirOut), lane);
    tr.len = Math.max(0.2, (tr.p0.distanceTo(tr.p2) + tr.p0.distanceTo(tr.p1) + tr.p1.distanceTo(tr.p2)) / 2);
  }

  private curvePoint(tr: Traversal, t: number, out: Vector3) {
    const u = 1 - t;
    out.set(
      u * u * tr.p0.x + 2 * u * t * tr.p1.x + t * t * tr.p2.x, 0,
      u * u * tr.p0.z + 2 * u * t * tr.p1.z + t * t * tr.p2.z
    );
    return out;
  }

  private curveHeading(tr: Traversal, t: number) {
    const dx = 2 * (1 - t) * (tr.p1.x - tr.p0.x) + 2 * t * (tr.p2.x - tr.p1.x);
    const dz = 2 * (1 - t) * (tr.p1.z - tr.p0.z) + 2 * t * (tr.p2.z - tr.p1.z);
    return Math.atan2(dx, dz);
  }

  private neighbors(key: string) {
    const cell = this.cells.get(key);
    if (!cell) return [];
    return cell.links.flatMap((linked, d) => linked ? [`${cell.x + DIRS[d][0]},${cell.z + DIRS[d][1]}`] : []);
  }

  private findRoute(from: string, to: string): string[] | undefined {
    if (from === to) return [];
    const previous = new Map<string, string>([[from, from]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      for (const next of this.neighbors(current)) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        if (next === to) {
          const route = [next];
          let step = current;
          while (step !== from) { route.unshift(step); step = previous.get(step)!; }
          return route;
        }
        queue.push(next);
      }
    }
    return undefined;
  }

  /** Pick a fresh errand: visit another home or stroll to a random street. */
  private plan(agent: Agent) {
    const tr = agent.trav!;
    agent.goalDoor = undefined;
    agent.route = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const visit = this.random() < 0.6 && this.doors.length > 1;
      const goalKey = visit ? undefined : this.linked[Math.floor(this.random() * this.linked.length)]?.key;
      const door = visit ? this.doors[Math.floor(this.random() * this.doors.length)] : undefined;
      const route = this.findRoute(tr.cur, door?.key ?? goalKey ?? tr.cur);
      if (!route || (route.length === 0 && !door && attempt < 3)) continue;
      agent.route = route;
      agent.goalDoor = door;
      break;
    }
    tr.next = agent.route.shift();
  }

  private rejoinLane(agent: Agent) {
    const tr = agent.trav!;
    tr.t = 0.5;
    this.setupCurve(agent);
    agent.target = this.curvePoint(tr, 0.5, new Vector3());
    agent.state = "toLane";
  }

  /** World position above a random visible villager (used for chat speech bubbles). */
  speakerPosition(): Vector3 | undefined {
    const people = this.agents.filter(agent => agent.kind === "person" && agent.scale > 0.9);
    const speaker = people[Math.floor(this.random() * people.length)];
    return speaker ? speaker.group.position.clone().setY(0.62) : undefined;
  }

  // ---------- events from the city ----------
  panic(center: Vector3, radius: number, seconds: number) {
    for (const agent of this.agents) {
      if (agent.kind !== "person" && agent.kind !== "sheep") continue;
      if (agent.pos.distanceTo(center) < radius) agent.panic = seconds;
    }
  }

  cheer(seconds: number) {
    for (const agent of this.agents) if (agent.kind === "person" && agent.state !== "enter") agent.cheer = seconds * (0.6 + this.random() * 0.6);
  }

  // ---------- simulation ----------
  update(delta: number) {
    this.clock += delta;
    this.populationClock += delta;
    if (this.populationClock > 0.35) { this.populationClock = 0; this.managePopulation(); }
    for (const agent of this.agents) {
      agent.panic = Math.max(0, agent.panic - delta);
      agent.cheer = Math.max(0, agent.cheer - delta);
      if (agent.kind === "person") this.updatePerson(agent, delta);
      else if (agent.kind === "sheep") this.updateSheep(agent, delta);
      else if (agent.kind === "blimp") this.updateBlimp(agent, delta);
      else this.updateVehicle(agent, delta);
    }
    this.separate(delta);
    for (const agent of this.agents) this.render(agent, delta);
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const agent = this.agents[i];
      if (!agent.dead) continue;
      if (agent.seat) agent.seat.taken = undefined;
      if (agent.partner) { agent.partner.partner = undefined; if (agent.partner.state === "chat") agent.partner.timer = 0; }
      this.root.remove(agent.group);
      disposeObject(agent.group);
      this.agents.splice(i, 1);
    }
  }

  private managePopulation() {
    if (this.asleep) return;
    const count = (kind: Kind) => this.agents.filter(agent => agent.kind === kind && agent.state !== "leave").length;
    const walkers = this.agents.filter(agent => agent.kind === "person" && agent.state !== "gather" && !(agent.seat && agent.state === "roam")).length;
    // More villagers gather round the fire as the first huts appear (one per home, up to five).
    const gatherers = this.agents.filter(agent => agent.kind === "person" && agent.seat).length;
    if (this.seats.length && gatherers < Math.min(5, 1 + this.houses)) this.joinGathering();
    const wantPeople = this.doors.length && this.linked.length + this.doors.length > 1 ? Math.min(this.night ? Math.ceil(this.limits.people * 0.4) : this.limits.people, 2 + Math.round(this.houses * (this.night ? 0.3 : 0.8))) : 0;
    if (walkers < wantPeople) this.spawnPerson();
    const roads = this.linked.length;
    if (this.era >= 2 && this.era < 4 && count("wagon") < Math.min(5, Math.floor(roads / 6))) this.spawnVehicle("wagon");
    if (this.era >= 4) {
      if (count("car") < Math.min(this.night ? Math.ceil(this.limits.cars * 0.4) : this.limits.cars, Math.floor(roads / 3.5))) this.spawnVehicle("car");
      if (this.era >= 5 && count("bus") < Math.min(3, Math.floor(roads / 18))) this.spawnVehicle("bus");
    }
  }

  private walkTo(agent: Agent, target: Vector3, delta: number, speed: number) {
    tmp.copy(target).sub(agent.pos);
    tmp.y = 0;
    const distance = tmp.length();
    if (distance < 0.02) return true;
    const step = Math.min(distance, speed * delta);
    agent.pos.addScaledVector(tmp.normalize(), step);
    agent.heading = angleLerp(agent.heading, Math.atan2(tmp.x, tmp.z), Math.min(1, delta * 10));
    agent.speed = speed;
    return distance - step < 0.02;
  }

  private updatePerson(agent: Agent, delta: number) {
    agent.chatCooldown = Math.max(0, agent.chatCooldown - delta);
    const hurry = agent.panic > 0 ? 2.2 : 1;
    agent.speed = 0;
    agent.pose = agent.cheer > 0 ? "cheer" : "idle";
    switch (agent.state) {
      case "gather": {
        const seat = agent.seat!;
        agent.heading = angleLerp(agent.heading, seat.face, Math.min(1, delta * 4));
        if (this.asleep) { agent.pose = "sleep"; break; }
        agent.pose = agent.cheer > 0 ? "cheer" : seat.bench ? "sit" : Math.sin(this.clock * 0.4 + agent.phase) > 0.2 ? "talk" : "idle";
        agent.timer -= delta;
        if (agent.timer <= 0) {
          const index = this.seats.indexOf(seat);
          const options = [-1, 1].map(step => this.seats[(index + step + this.seats.length) % this.seats.length]).filter(s => !s.taken);
          const chosen = options[Math.floor(this.random() * options.length)];
          if (chosen) { seat.taken = undefined; chosen.taken = agent; agent.seat = chosen; agent.target = chosen.pos; agent.state = "roam"; }
          agent.timer = 5 + this.random() * 9;
        }
        break;
      }
      case "roam": {
        agent.pose = "walk";
        if (this.walkTo(agent, agent.target!, delta, 0.16 * hurry)) agent.state = agent.seat ? "gather" : "idle";
        break;
      }
      case "emerge": {
        agent.timer += delta;
        agent.scale = Math.min(1, agent.timer / 0.45);
        if (agent.scale >= 1) {
          this.plan(agent);
          if (!agent.trav!.next && agent.goalDoor) { agent.target = agent.goalDoor.point; agent.state = "toDoor"; }
          else this.rejoinLane(agent);
        }
        break;
      }
      case "toLane": {
        agent.pose = "walk";
        if (this.walkTo(agent, agent.target!, delta, agent.cruise * hurry)) agent.state = "walk";
        break;
      }
      case "walk": {
        const tr = agent.trav!;
        const blocked = this.blockedAhead(agent, 0.3);
        if (blocked) agent.wait += delta; else agent.wait = 0;
        const go = !blocked || agent.wait > 1.2 || agent.panic > 0;
        if (go) {
          agent.speed = agent.cruise * hurry;
          tr.t += (agent.speed * delta) / tr.len;
          while (tr.t >= 1) {
            tr.t -= 1;
            if (!tr.next) { tr.t = 0.5; break; }
            tr.prev = tr.cur; tr.cur = tr.next; tr.next = agent.route.shift();
            this.setupCurve(agent);
          }
          if (!tr.next && agent.route.length === 0 && tr.t >= 0.5 && tr.prev !== undefined) {
            this.arrive(agent);
          } else if (!tr.next && tr.prev === undefined && tr.t >= 0.5) this.arrive(agent);
        }
        if (agent.state === "walk") {
          this.curvePoint(tr, Math.min(tr.t, 1), agent.pos);
          agent.heading = angleLerp(agent.heading, this.curveHeading(tr, Math.min(tr.t, 1)), Math.min(1, delta * 12));
          agent.pose = agent.speed > 0 ? (agent.panic > 0 ? "panic" : "walk") : "idle";
        }
        break;
      }
      case "idle": {
        agent.timer -= delta;
        if (this.asleep) { this.goHome(agent); break; }
        agent.pose = agent.cheer > 0 ? "cheer" : Math.sin(agent.phase + this.clock) > 0.7 ? "wave" : "idle";
        if (agent.timer <= 0) { this.plan(agent); this.rejoinLane(agent); }
        break;
      }
      case "chat": {
        agent.timer -= delta;
        if (this.asleep) agent.timer = 0;
        if (agent.partner) {
          tmp.copy(agent.partner.pos).sub(agent.pos);
          agent.heading = angleLerp(agent.heading, Math.atan2(tmp.x, tmp.z), Math.min(1, delta * 6));
        }
        agent.pose = agent.cheer > 0 ? "cheer" : Math.sin(this.clock * 0.9 + agent.phase) > -0.2 ? "talk" : "idle";
        if (agent.timer <= 0 || agent.panic > 0) {
          if (agent.partner?.partner === agent) agent.partner.partner = undefined;
          agent.partner = undefined;
          agent.chatCooldown = 8 + this.random() * 8;
          agent.state = "walk";
        }
        break;
      }
      case "toDoor": {
        agent.pose = "walk";
        if (this.walkTo(agent, agent.goalDoor!.point, delta, agent.cruise * hurry)) { agent.state = "enter"; agent.timer = 0; }
        break;
      }
      case "enter": {
        agent.timer += delta;
        agent.scale = Math.max(0, 1 - agent.timer / 0.4);
        if (agent.scale <= 0) agent.dead = true;
        break;
      }
      default: break;
    }
    // Chance meetings: two walkers on the same side of the street stop for a chat.
    if (agent.state === "walk" && agent.chatCooldown <= 0 && agent.panic <= 0) {
      for (const other of this.agents) {
        if (other === agent || other.kind !== "person" || other.state !== "walk" || other.chatCooldown > 0) continue;
        if (agent.pos.distanceToSquared(other.pos) > 0.1) continue;
        if (this.random() > 0.35) { agent.chatCooldown = 3; break; }
        for (const [a, b] of [[agent, other], [other, agent]] as const) { a.state = "chat"; a.partner = b; a.timer = 2.5 + this.random() * 3; }
        break;
      }
    }
  }

  private arrive(agent: Agent) {
    if (agent.goalDoor && agent.goalDoor.key === agent.trav!.cur) {
      agent.state = "toDoor";
    } else {
      agent.state = "idle";
      agent.timer = 0.8 + this.random() * 2.5;
    }
  }

  /** True when something sits in this agent's path within `reach`. */
  private blockedAhead(agent: Agent, reach: number) {
    const fx = Math.sin(agent.heading), fz = Math.cos(agent.heading);
    const isVehicle = agent.kind !== "person";
    for (const other of this.agents) {
      if (other === agent || other.kind === "blimp" || other.kind === "sheep" || other.scale < 0.5) continue;
      const otherVehicle = other.kind !== "person";
      if (!isVehicle && !otherVehicle) continue; // walkers handle each other with separation and chats
      const dx = other.pos.x - agent.pos.x, dz = other.pos.z - agent.pos.z;
      const along = dx * fx + dz * fz;
      const lateral = Math.abs(dx * fz - dz * fx);
      const otherHalf = otherVehicle ? (other.model?.length ?? 0.4) / 2 : 0.05;
      if (along <= 0 || along > reach + otherHalf) continue;
      const corridor = (isVehicle ? agent.model!.width / 2 : 0.06) + (otherVehicle ? other.model!.width / 2 : 0.07);
      if (lateral > corridor) continue;
      if (isVehicle && !otherVehicle) {
        const crossing = Math.abs(Math.cos(other.heading - agent.heading)) < 0.75 || other.speed === 0;
        if (!crossing && along > 0.22) continue;
      }
      if (isVehicle && otherVehicle) {
        // Tie-break mutual blocks so intersections never deadlock.
        const ofx = Math.sin(other.heading), ofz = Math.cos(other.heading);
        const backAlong = -dx * ofx - dz * ofz;
        const backLateral = Math.abs(-dx * ofz + dz * ofx);
        if (backAlong > 0 && backAlong < reach + 0.3 && backLateral < corridor && agent.id < other.id) continue;
      }
      return true;
    }
    return false;
  }

  private updateVehicle(agent: Agent, delta: number) {
    const model = agent.model!;
    if (agent.state === "leave") {
      agent.scale = Math.max(0, agent.scale - delta * 1.6);
      if (agent.scale <= 0) agent.dead = true;
    } else agent.scale = Math.min(1, agent.scale + delta * 1.6);
    const tr = agent.trav!;
    if (!this.cells.has(tr.cur)) { agent.state = "leave"; return; }
    const reach = agent.kind === "bus" ? 0.75 : 0.5;
    agent.ghost = Math.max(0, agent.ghost - delta);
    const blocked = agent.ghost <= 0 && this.blockedAhead(agent, reach);
    if (blocked) agent.wait += delta; else agent.wait = 0;
    if (agent.wait > 2.6) { agent.ghost = 1.2; agent.wait = 0; }
    const turning = Math.abs(Math.atan2(Math.sin(this.curveHeading(tr, 0.9) - this.curveHeading(tr, 0.1)), Math.cos(this.curveHeading(tr, 0.9) - this.curveHeading(tr, 0.1)))) > 0.5;
    const targetSpeed = blocked ? 0 : agent.cruise * (turning ? 0.6 : 1);
    agent.speed = MathUtils.lerp(agent.speed, targetSpeed, Math.min(1, delta * (blocked ? 7 : 2.2)));
    tr.t += (agent.speed * delta) / tr.len;
    while (tr.t >= 1) {
      tr.t -= 1;
      const options = this.neighbors(tr.next ?? tr.cur);
      tr.prev = tr.cur;
      tr.cur = tr.next ?? tr.cur;
      const forward = options.filter(key => key !== tr.prev);
      tr.next = forward.length ? forward[Math.floor(this.random() * forward.length)] : options[0];
      if (!tr.next) { agent.state = "leave"; tr.next = tr.prev; }
      this.setupCurve(agent);
    }
    this.curvePoint(tr, tr.t, agent.pos);
    agent.heading = this.curveHeading(tr, tr.t);
    for (const wheel of model.wheels) wheel.rotation.x += (agent.speed * delta) / model.wheelRadius;
    if (model.legs.length) model.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(this.clock * 9 * (agent.speed / agent.cruise) + i * Math.PI / 2 + (i % 2) * Math.PI) * 0.5 * Math.min(1, agent.speed / 0.1); });
  }

  private updateSheep(agent: Agent, delta: number) {
    const sheep = agent.sheep!;
    agent.timer -= delta;
    agent.speed = 0;
    // Asleep: lie down in the paddock.
    const lying = this.asleep ? 0.6 : 1;
    sheep.root.scale.y += (lying - sheep.root.scale.y) * Math.min(1, delta * 2);
    if (this.asleep) { sheep.head.rotation.x = MathUtils.lerp(sheep.head.rotation.x, 0.9, delta * 2); return; }
    if (agent.state === "graze") {
      sheep.head.rotation.x = MathUtils.lerp(sheep.head.rotation.x, 0.7 + Math.sin(this.clock * 3 + agent.phase) * 0.15, delta * 4);
      if (agent.timer <= 0 || agent.panic > 0) {
        agent.target = agent.anchor!.clone().add(new Vector3((this.random() - 0.5) * 0.62, 0, (this.random() - 0.5) * 0.62));
        agent.state = "roam";
      }
    } else {
      sheep.head.rotation.x = MathUtils.lerp(sheep.head.rotation.x, 0, delta * 5);
      if (this.walkTo(agent, agent.target!, delta, agent.panic > 0 ? 0.32 : 0.11)) { agent.state = "graze"; agent.timer = 2 + this.random() * 5; }
    }
    const moving = agent.speed > 0;
    sheep.legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(this.clock * 12 + (i % 2 === (i >> 1) % 2 ? 0 : Math.PI)) * 0.5 : MathUtils.lerp(leg.rotation.x, 0, delta * 6); });
  }

  private updateBlimp(agent: Agent, delta: number) {
    const radius = Math.max(4, this.host.cityRadius() * 0.75);
    agent.phase += delta * agent.cruise;
    const angle = agent.phase;
    agent.pos.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.7);
    const dx = -Math.sin(angle) * radius, dz = Math.cos(angle) * radius * 0.7;
    agent.heading = Math.atan2(dx, dz);
    if (agent.model?.propeller) agent.model.propeller.rotation.z += delta * 14;
  }

  /** Soft collisions: walkers and animals push apart; vehicles push walkers off their lane. */
  private separate(delta: number) {
    const soft = this.agents.filter(agent => (agent.kind === "person" || agent.kind === "sheep") && agent.scale > 0.3 && agent.state !== "enter");
    const vehicles = this.agents.filter(agent => (agent.kind === "car" || agent.kind === "bus" || agent.kind === "wagon") && agent.scale > 0.3);
    for (const agent of soft) agent.avoid.multiplyScalar(Math.exp(-1.8 * delta));
    for (let i = 0; i < soft.length; i++) {
      const a = soft[i];
      for (let j = i + 1; j < soft.length; j++) {
        const b = soft[j];
        tmp.copy(a.pos).add(a.avoid).sub(tmp2.copy(b.pos).add(b.avoid));
        tmp.y = 0;
        const min = a.radius + b.radius;
        const distSq = tmp.lengthSq();
        if (distSq >= min * min) continue;
        const dist = Math.sqrt(distSq) || 0.001;
        if (distSq < 1e-6) tmp.set(Math.sin(a.id), 0, Math.cos(a.id));
        tmp.normalize().multiplyScalar((min - dist) / 2);
        const aFixed = a.state === "gather" && a.seat?.bench;
        const bFixed = b.state === "gather" && b.seat?.bench;
        if (!aFixed) a.avoid.add(bFixed ? tmp.clone().multiplyScalar(2) : tmp);
        if (!bFixed) b.avoid.sub(aFixed ? tmp.clone().multiplyScalar(2) : tmp);
      }
      for (const v of vehicles) {
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const dx = a.pos.x + a.avoid.x - v.pos.x, dz = a.pos.z + a.avoid.z - v.pos.z;
        const half = v.model!.length / 2 - v.model!.width / 2;
        const along = MathUtils.clamp(dx * fx + dz * fz, -half, half);
        const cx = dx - along * fx, cz = dz - along * fz;
        const dist = Math.hypot(cx, cz) || 0.001;
        const min = v.model!.width / 2 + a.radius;
        if (dist < min) a.avoid.add(new Vector3(cx / dist, 0, cz / dist).multiplyScalar(min - dist));
      }
    }
    for (const agent of soft) if (agent.avoid.lengthSq() > 0.09) agent.avoid.setLength(0.3);
  }

  private render(agent: Agent, delta: number) {
    const group = agent.group;
    const x = agent.pos.x + agent.avoid.x, z = agent.pos.z + agent.avoid.z;
    if (agent.kind === "blimp") {
      group.position.set(x, 5 + Math.sin(this.clock * 0.3 + agent.id) * 0.25, z);
      group.rotation.y = agent.heading;
      group.rotation.z = Math.sin(this.clock * 0.4 + agent.id) * 0.04;
      return;
    }
    const { cell, localX, localZ } = this.host.cellAt(x, z);
    let y = streetSurface(cell, this.era, localX, localZ);
    if (agent.kind !== "person" && agent.kind !== "sheep" && this.era >= 4) y = ROAD_Y;
    if (agent.kind === "car" || agent.kind === "bus") y += Math.sin(this.clock * 18 + agent.id) * 0.002 * Math.min(1, agent.speed * 3);
    group.position.set(x, y, z);
    group.rotation.y = agent.kind === "person" || agent.kind === "sheep" ? angleLerp(group.rotation.y, agent.heading, Math.min(1, delta * 12)) : agent.heading;
    group.scale.setScalar(Math.max(0.001, agent.scale));
    if (agent.rig) {
      if (agent.speed > 0) agent.phase += delta * agent.speed * 55;
      else agent.phase += delta * 2;
      posePerson(agent.rig, agent.pose, agent.phase, Math.min(1.2, agent.speed / 0.16 || 1));
    }
  }

  dispose() {
    for (const agent of this.agents) { this.root.remove(agent.group); disposeObject(agent.group); }
    this.agents = [];
  }
}
