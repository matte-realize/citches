import { config } from "../config.js";
import type { GrowthSignals } from "../aggregate/aggregator.js";
import type { Aggregate, AttackKind, ChatCommand, ChronicleEntry, CommunityProgress, Counts, ScoreSnapshot, SimEvent } from "../types.js";

/** Local calendar day (YYYY-MM-DD) of a timestamp, in this machine's time zone. */
const NATURAL_REASON: Partial<Record<AttackKind, string>> = {
  quake: "EARTHQUAKE", flood: "FLASH FLOOD", tornado: "TORNADO", fire: "WILDFIRE", storm: "SUPERSTORM",
  flare: "SOLAR FLARE", asteroid: "ASTEROID", drones: "ROGUE AI", gamma: "GAMMA-RAY BURST", blackhole: "BLACK HOLE"
};

function localDay(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const CHAPTER_TITLES: Record<string, string[]> = {
  built: ["The Building Boom", "Rise of the Neighbourhoods", "The Cranes Arrive", "A City of Many Hands", "New Streets, New Faces"],
  repaired: ["The Great Restoration", "Hammers and Hope", "Mending the Streets", "Fixing What Was Broken"],
  attacks: ["The Siege of the Trolls", "Smoke Over the Rooftops", "Hard Times", "The City Holds Its Ground"],
  washed: ["The Haters Washed Out", "Calm After the Storm", "Kindness Wins the Day"],
  eras: ["A New Age Dawns", "The Age of Wonders", "Leaps and Bounds"],
  capitol: ["The Hall Rises", "Heart of the City", "Stones of the Capitol"],
  quiet: ["The Long Quiet", "Dust and Silence", "Waiting for Voices"],
  erasLost: ["The Fall", "A Dark Age", "What Was Lost"]
};
/** Name a chapter after what dominated it, weighted so rarer moments (eras, capitol) win ties. */
function chapterTitle(tally: Record<string, number>, number: number) {
  const weights: Record<string, number> = { built: 0.15, repaired: 0.6, attacks: 1.5, washed: 3, eras: 6, capitol: 5, quiet: 0.4, erasLost: 7 };
  const [kind] = Object.entries(tally).map(([key, count]) => [key, count * (weights[key] ?? 1)] as const).sort((a, b) => b[1] - a[1])[0] ?? ["built"];
  const options = CHAPTER_TITLES[kind] ?? CHAPTER_TITLES.built;
  return options[number % options.length];
}

/** The danger meter is full when about this many buildings' worth of trouble has built up. */
const METER_PULSES = 3;

/** Which attack each flavour of negativity summons. */
const ATTACK_FOR_RULE: Record<string, AttackKind[]> = {
  hate: ["meteor", "fire"], toxic: ["meteor", "fire"], shouting: ["storm"],
  spam: ["swarm"], copypasta: ["swarm"], flood: ["swarm", "storm"], lowEffort: ["fire"]
};
const ATTACK_REASON: Record<string, string> = {
  hate: "HATE", toxic: "TOXIC CHAT", shouting: "ALL CAPS STORM", spam: "SPAM SWARM", copypasta: "COPYPASTA SWARM", flood: "CHAT FLOOD", lowEffort: "LOW EFFORT"
};

export interface MapperState {
  houseProgress: number; landmarkProgress: number; technologyProgress: number; technologyEra: number;
  recoveryActive: boolean; recoveryEra: number; recoveryProgress: number; recoveryGoal: number;
  scoreTotal: number; threat: number; snapshot: ScoreSnapshot;
  leaderboard?: Array<[string, number]>;
  outstandingWear?: number;
  ruins?: number; rebuildProgress?: number;
  spent?: Array<[string, number]>;
  capitolFund?: number; capitolStage?: number; donors?: Array<[string, number]>;
  foundedAt?: number; chapter?: number; chapterPoints?: number; chronicle?: ChronicleEntry[]; lastMessageAt?: number; awakeSince?: number;
  owners?: Array<[string, number, string]>;
  supporters?: Array<[string, number]>;
  vacancies?: number; activeDays?: number; lastActiveDay?: string; totalMessages?: number; totalCounts?: Counts; everChatted?: number;
}

export class EventMapper {
  private sessionStartedAt?: number;
  private houseProgress = 0;
  private landmarkProgress = 0;
  /** Buildings knocked down by attacks and disasters that chat has not rebuilt yet. */
  private ruins = 0;
  private rebuildProgress = 0;
  private technologyProgress = 0;
  private technologyEra = 0;
  /** When the current era was reached (it can't be lost straight away). */
  private advancedAt = -Infinity;
  private recoveryActive = false;
  private recoveryEra = 0;
  private recoveryProgress = 0;
  private recoveryGoal = 0;
  private lastBuildAt = 0;
  private scoreTotal = 0;
  private threat = 0;
  private lastAttackAt = 0;
  /** When the danger meter last filled; the attack strikes a short warning later. */
  private massingSince?: number;
  private strikeAt() { return Math.max((this.massingSince ?? 0) + config.threat.warningMs, this.lastAttackAt + config.threat.minGapMs); }
  private lastFireworksAt = 0;
  private recentMessages = 0;
  /** Chat pace in messages per minute, smoothed over a few minutes so a spam burst is not "a big chat". */
  private chatPerMinute = 0;
  private paceAt?: number;
  private recentMinusMessages = 0;
  private peakThreatRatio = 0;
  private plusRate = 0; // exponentially weighted plus points per minute
  private typicalRate = 0; // the channel's normal pace, over a much longer window
  private decayProgress = 0;
  private entropyProgress = 0;
  private repairProgress = 0;
  private outstandingWear = 0;
  private lastMessageAt?: number;
  private lastDecayAt = 0;
  private lastRepairAt = 0;
  private upkeep: "decaying" | "repairing" | "steady" = "steady";
  private threshold = config.threat.destroyThreshold;

  /** Current minus points needed to knock one building down. */
  get destroyThreshold() { return this.threshold; }
  /** Points per chatter since the last build (credited on it) and across the whole session. */
  private contributors = new Map<string, number>();
  private leaderboard = new Map<string, number>();
  /** Points each chatter has spent on commands; their balance is leaderboard points minus this. */
  private spent = new Map<string, number>();
  private commandReadyAt = new Map<string, number>();
  private owners = new Map<string, { level: number; lastSeen: number; earned: number; color?: string }>();
  private colors = new Map<string, string>();
  private capitolFund = 0;
  // Community and story
  private recentChatters = new Map<string, number>();
  private awakeSince?: number;
  private foundedAt?: number;
  /** Days the community actually showed up (distinct local calendar days with scored chat). */
  private activeDays = 0;
  private lastActiveDay?: string;
  private totalMessages = 0;
  private totalCounts: Counts = { RAID: 0, SPAM: 0, QUESTION: 0, HATE: 0, COMMENT: 0 };
  private everChatted = 0;
  private supporters = new Map<string, number>();
  private vacancies = 0;
  private moveOutProgress = 0;
  private moveInProgress = 0;
  private nextCatastropheAt?: number;
  private chapter = 0;
  private chapterPoints = 0;
  private chronicle: ChronicleEntry[] = [];
  private tally = { built: 0, repaired: 0, attacks: 0, washed: 0, eras: 0, capitol: 0, quiet: 0, erasLost: 0 };
  private heroes = new Map<string, number>();
  private welcomeUntil = 0;
  private sleepWear = 0;
  private growthMultiplier = 1;
  /** Demo only: speeds up era progress so a short recording can show level-ups. Live chat always uses 1. */
  technologyBoost = 1;
  private capitolStage = 0;
  private donors = new Map<string, number>();

  /** A chatter's spendable points. */
  balance(user: string) { return Math.floor((this.leaderboard.get(user) ?? 0) - (this.spent.get(user) ?? 0)); }
  private lastTickAt?: number;
  private negativeMix: Record<string, number> = {};
  private snapshot: ScoreSnapshot = { total: 0, gained: 0, lost: 0, threat: 0, threatRatio: 0, pops: [] };

  get score(): ScoreSnapshot { return this.snapshot; }

  /** Serializable progress so a city can be saved and resumed (used by the browser extension). */
  exportState(): MapperState {
    return {
      houseProgress: this.houseProgress, landmarkProgress: this.landmarkProgress, ruins: this.ruins, rebuildProgress: this.rebuildProgress,
      technologyProgress: this.technologyProgress, technologyEra: this.technologyEra,
      recoveryActive: this.recoveryActive, recoveryEra: this.recoveryEra,
      recoveryProgress: this.recoveryProgress, recoveryGoal: this.recoveryGoal,
      scoreTotal: this.scoreTotal, threat: this.threat, snapshot: { ...this.snapshot, highlight: undefined },
      outstandingWear: this.outstandingWear,
      capitolFund: this.capitolFund, capitolStage: this.capitolStage,
      foundedAt: this.foundedAt, chapter: this.chapter, chapterPoints: this.chapterPoints, chronicle: this.chronicle,
      lastMessageAt: this.lastMessageAt, awakeSince: this.awakeSince,
      donors: [...this.donors].sort((a, b) => b[1] - a[1]).slice(0, 50),
      spent: [...this.spent].slice(-500),
      owners: [...this.owners].slice(-300).map(([name, owner]) => [name, owner.level, owner.color ?? ""] as [string, number, string]),
      leaderboard: [...this.leaderboard].sort((a, b) => b[1] - a[1]).slice(0, 50),
      supporters: [...this.supporters].sort((a, b) => b[1] - a[1]).slice(0, 50),
      vacancies: this.vacancies, activeDays: this.activeDays, lastActiveDay: this.lastActiveDay, totalMessages: this.totalMessages, totalCounts: this.totalCounts, everChatted: this.everChatted
    };
  }

  importState(state: Partial<MapperState>) {
    const numbers = ["houseProgress", "landmarkProgress", "ruins", "rebuildProgress", "technologyProgress", "technologyEra", "recoveryEra", "recoveryProgress", "recoveryGoal", "scoreTotal", "threat", "outstandingWear", "capitolFund", "capitolStage", "foundedAt", "chapter", "chapterPoints", "lastMessageAt", "awakeSince", "activeDays", "totalMessages", "everChatted", "vacancies"] as const;
    for (const key of numbers) if (typeof state[key] === "number" && Number.isFinite(state[key])) this[key] = state[key] as number;
    if (typeof state.recoveryActive === "boolean") this.recoveryActive = state.recoveryActive;
    if (state.snapshot) this.snapshot = { ...state.snapshot, pops: [] };
    if (Array.isArray(state.chronicle)) this.chronicle = state.chronicle.filter(entry => entry && typeof entry.title === "string").slice(-40);
    if (Array.isArray(state.donors)) this.donors = new Map(state.donors.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (Array.isArray(state.spent)) this.spent = new Map(state.spent.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (Array.isArray(state.owners)) for (const [name, level, color] of state.owners) if (typeof name === "string") this.owners.set(name, { level: Number(level) || 0, lastSeen: 0, earned: 0, color: color || undefined });
    if (Array.isArray(state.leaderboard)) this.leaderboard = new Map(state.leaderboard.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (Array.isArray(state.supporters)) this.supporters = new Map(state.supporters.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (typeof state.lastActiveDay === "string") this.lastActiveDay = state.lastActiveDay;
    if (state.totalCounts) for (const key of Object.keys(this.totalCounts) as Array<keyof Counts>) this.totalCounts[key] = Number(state.totalCounts[key]) || 0;
    // Older saves only knew when the city was founded: count that as its first active day.
    if (!this.activeDays && this.foundedAt !== undefined) this.activeDays = 1;
    if (!this.everChatted) this.everChatted = this.leaderboard.size;
  }

  get progress(): CommunityProgress {
    const milestones = config.technology.milestones;
    const next = milestones[this.technologyEra];
    const previousGoal = this.technologyEra > 0 ? milestones[this.technologyEra - 1].points : 0;
    const technologyGoal = next ? next.points - previousGoal : 1;
    const technologyCurrent = next ? Math.min(technologyGoal, Math.max(0, this.technologyProgress - previousGoal)) : 1;
    return {
      technology: {
        era: this.technologyEra,
        name: next?.name ?? "EMPIRE COMPLETE",
        current: technologyCurrent,
        goal: technologyGoal,
        ratio: technologyGoal > 0 ? technologyCurrent / technologyGoal : 1
      },
      recovery: {
        active: this.recoveryActive,
        era: this.recoveryEra,
        current: this.recoveryProgress,
        goal: this.recoveryGoal,
        ratio: this.recoveryGoal > 0 ? Math.min(1, this.recoveryProgress / this.recoveryGoal) : 0
      },
      repair: { ruins: Math.ceil(this.ruins), ratio: Math.min(1, this.rebuildProgress / this.repairCost()) }
    };
  }

  /** `now` defaults to the clock; the calibration harness passes message time so hours replay in seconds. */
  map(aggregate: Aggregate, delta: Counts, deltaRaidViewers: number, signals: GrowthSignals, now = Date.now()): SimEvent[] {
    const rateScale = Math.max(1, aggregate.messagesPerSecond / config.events.rateReference);
    const events: SimEvent[] = [];
    const growth = config.growth;
    const paceSeconds = Math.min(5, (now - (this.paceAt ?? now)) / 1000);
    this.paceAt = now;
    const keepPace = Math.exp(-paceSeconds / config.threat.speedWindowSeconds);
    this.chatPerMinute = this.chatPerMinute * keepPace + aggregate.messagesPerSecond * 60 * (1 - keepPace);
    this.sessionStartedAt ??= now;
    this.foundedAt ??= now;
    const wakeEvent = this.noteActivity(signals, now);
    this.countActivity(delta, signals, now);
    if (wakeEvent) events.push(wakeEvent);
    if (wakeEvent && this.vacancies > 0) {
      // Coming back after a break: the first families return straight away.
      const back = Math.min(this.vacancies, config.rest.welcomeMoveIns);
      this.vacancies -= back;
      events.push({ type: "moveIn", count: back });
    }
    this.growthMultiplier = this.communityMultiplier(signals, now);
    const seconds = Math.min(5, (now - (this.lastTickAt ?? now)) / 1000);
    this.lastTickAt = now;
    const eligible = signals.eligibleMessages;
    if (eligible > 0) {
      const averageComplexity = signals.complexityTotal / eligible;
      const positiveRatio = signals.positiveMessages / eligible;
      const minutesLive = (now - this.sessionStartedAt) / 60_000;
      const longevity = 1 + growth.longevityMultiplier * Math.min(1, minutesLive / growth.longevityMinutes);
      const chatPace = Math.min(1.35, 0.85 + aggregate.messagesPerSecond / config.events.rateReference * 0.08);
      const pointsPerMessage = (growth.basePoints + averageComplexity * growth.complexityMultiplier + positiveRatio * growth.positivityMultiplier) * longevity * chatPace * this.growthMultiplier;
      this.houseProgress += delta.COMMENT * pointsPerMessage;
      this.landmarkProgress += delta.QUESTION * pointsPerMessage;
      const technology = config.technology;
      // Big chats advance faster, but with diminishing returns: past the reference pace every
      // message counts for less, so 10x the chat is roughly 2.5x the progress, not 10x.
      const perMinute = aggregate.messagesPerSecond * 60;
      const volumeDamping = perMinute > technology.volumeReferencePerMinute
        ? (technology.volumeReferencePerMinute / perMinute) ** technology.volumeDamping : 1;
      // Positivity is net of negativity: each negative message cancels some positive ones.
      const netPositive = Math.max(0, signals.positiveMessages - signals.minusMessages * technology.negativeOffset);
      this.technologyProgress += (
        eligible * technology.chatPoint
        + signals.complexityTotal * technology.complexityPoint
        + netPositive * technology.positivityPoint
      ) * longevity * this.growthMultiplier * volumeDamping * this.technologyBoost / Math.pow(config.catastrophes.progressDragPerEra, this.technologyEra);
    }
    this.houseProgress += signals.supportPoints * config.support.growthMultiplier * this.growthMultiplier;
    this.technologyProgress += signals.supportPoints * config.technology.supportPointMultiplier * this.growthMultiplier;

    if (this.recoveryActive) {
      const recovery = config.recovery;
      this.recoveryProgress += signals.supportPoints * recovery.supportPointMultiplier
        + signals.positiveMessages * recovery.positiveMessagePoints
        + signals.complexityTotal * recovery.complexityPoint;
      if (this.recoveryProgress >= this.recoveryGoal) {
        this.recoveryProgress = this.recoveryGoal;
        this.recoveryActive = false;
        this.recoveryEra = this.technologyEra;
      }
    }

    // Minuses push technology back, and far enough back the city loses its era (see regress()).
    this.technologyProgress = Math.max(0, this.technologyProgress + signals.minusPoints * config.threat.technologyPenalty);
    for (const [user, points] of Object.entries(signals.byUser)) {
      this.contributors.set(user, (this.contributors.get(user) ?? 0) + points);
      this.leaderboard.set(user, (this.leaderboard.get(user) ?? 0) + points);
    }
    if (this.leaderboard.size > 600) {
      const kept = [...this.leaderboard].sort((a, b) => b[1] - a[1]).slice(0, 300);
      this.leaderboard = new Map(kept);
    }
    for (const [user, color] of Object.entries(signals.colors)) this.colors.set(user, color);
    this.updateScore(signals, seconds);
    events.push(...this.runCommands(signals, now), ...this.growHomes(signals, now));

    while (this.technologyEra < config.technology.milestones.length
      && this.technologyProgress >= config.technology.milestones[this.technologyEra].points) {
      const milestone = config.technology.milestones[this.technologyEra];
      this.technologyEra++;
      this.advancedAt = now;
      events.push({ type: "advancement", era: this.technologyEra, name: milestone.name });
    }

    if (this.ruins > 0) {
      // Ruins first: new construction halts and all progress (plus extra for bits and subs) rebuilds.
      const repair = config.repair;
      this.rebuildProgress += this.houseProgress + this.landmarkProgress
        + signals.supportPoints * config.support.growthMultiplier * repair.supportMultiplier * this.growthMultiplier;
      this.houseProgress = 0;
      this.landmarkProgress = 0;
      const cost = this.repairCost();
      if (now - this.lastBuildAt >= growth.buildCooldownMs && this.rebuildProgress >= cost) {
        const count = Math.min(repair.maxPerPulse, Math.ceil(this.ruins), Math.floor(this.rebuildProgress / cost));
        this.rebuildProgress -= count * cost;
        this.ruins = Math.max(0, this.ruins - count);
        this.lastBuildAt = now;
        events.push({ type: "rebuild", count, builders: this.takeBuilders() });
        // Leftover effort carries over to new construction once the last ruin is rebuilt.
        if (this.ruins === 0) { this.houseProgress = this.rebuildProgress; this.rebuildProgress = 0; }
      }
    } else if (now - this.lastBuildAt >= growth.buildCooldownMs) {
      if (this.landmarkProgress >= growth.landmarkThreshold) {
        const count = Math.min(growth.maxBuildsPerPulse, Math.floor(this.landmarkProgress / growth.landmarkThreshold));
        this.landmarkProgress -= count * growth.landmarkThreshold;
        this.lastBuildAt = now;
        events.push({ type: "build", kind: "landmark", count, builders: this.takeBuilders() });
      } else if (this.houseProgress >= growth.progressThreshold) {
        const count = Math.min(growth.maxBuildsPerPulse, Math.floor(this.houseProgress / growth.progressThreshold));
        this.houseProgress -= count * growth.progressThreshold;
        this.lastBuildAt = now;
        events.push({ type: "build", kind: "house", count, builders: this.takeBuilders() });
      }
    }

    const intensity = (count: number) => Math.min(10, count * config.events.intensityMultiplier * rateScale);
    // Celebrations come from bursts of hype and kindness, not from spam.
    const cheer = (signals.byRule.hype ?? 0) + (signals.byRule.kindness ?? 0) + (signals.byRule.support ?? 0);
    if (cheer >= config.events.fireworksThreshold && now - this.lastFireworksAt >= config.events.fireworksCooldownMs) {
      this.lastFireworksAt = now;
      events.push({ type: "effect", kind: "fireworks", intensity: Math.min(10, cheer * 0.6 * rateScale) });
    }
    if (delta.RAID && deltaRaidViewers >= config.events.raidMinimumViewers) events.push({ type: "boom", viewers: deltaRaidViewers });
    if (aggregate.counts.HATE >= config.events.disasterThreshold && delta.HATE > 0) {
      const disasterIntensity = intensity(delta.HATE);
      events.push({
        type: "disaster",
        kind: Math.random() < 0.5 ? "fire" : "meteor",
        intensity: disasterIntensity,
        damageCount: Math.max(1, Math.ceil(disasterIntensity * config.events.destroyedBuildingsPerIntensity)),
        durationMs: config.events.burnDurationMs,
        reason: "HATE"
      });
      this.startRecovery(disasterIntensity);
    }
    const attack = this.maybeAttack(now);
    if (attack) events.push(attack);
    // A full meter is not a stuck meter: it is an attack massing at the gates, striking when the
    // cooldown ends unless positive chat breaks it up first.
    const massing = !attack && this.threat >= this.threshold;
    // While an attack waits out the gap, the bar charges steadily toward it instead of sitting full;
    // only the last few seconds are a countdown.
    const until = massing ? Math.max(0, this.strikeAt() - now) : undefined;
    const charge = massing ? Math.min(1, (now - this.lastAttackAt) / Math.max(1, this.strikeAt() - this.lastAttackAt)) : undefined;
    this.snapshot = {
      ...this.snapshot,
      incomingMs: until !== undefined && until <= config.threat.warningMs ? until : undefined,
      threatRatio: charge !== undefined ? Math.max(0.35, charge) : this.snapshot.threatRatio
    };
    if (!attack) {
      const natural = this.maybeCatastrophe(now);
      if (natural) events.push(natural);
    }
    const moving = this.updateHouseholds(signals, now, seconds);
    if (moving) events.push(moving);
    const upkeep = this.updateUpkeep(signals, now, seconds);
    if (upkeep) events.push(upkeep);
    const capitol = this.growCapitol(signals);
    if (capitol) events.push(capitol);
    for (const event of events) if (event.type === "disaster") this.loseTechnology((event.damageCount ?? 1) * config.technology.disasterLossShare);
    events.push(...this.regress(now));
    for (const event of events) {
      if (event.type === "disaster") this.ruins = Math.min(config.repair.maxRuins, this.ruins + (event.damageCount ?? 1));
      if (event.type === "build" || event.type === "rebuild") this.tally.built += event.count;
      else if (event.type === "repair") this.tally.repaired += event.count;
      else if (event.type === "disaster") this.tally.attacks++;
      else if (event.type === "advancement") this.tally.eras++;
      else if (event.type === "regression") this.tally.erasLost++;
      else if (event.type === "capitol") this.tally.capitol++;
      else if (event.type === "decay") this.tally.quiet++;
    }
    if (signals.byLabel["HATERS WASHED OUT"]) this.tally.washed++;
    const chapter = this.advanceStory(signals, now);
    if (chapter) events.push(chapter);
    this.snapshot.community = { chatters: this.activeChatters(now), multiplier: Math.round(this.growthMultiplier * 100) / 100, tired: this.fatigue(now) < 0.95 };
    this.snapshot.story = { day: this.day(now), chapter: this.chapter, title: this.chronicle[this.chronicle.length - 1]?.title, next: Math.round(this.chapterPoints), goal: Math.round(this.chapterGoal()) };
    this.snapshot.upkeep = this.upkeep;
    this.snapshot.capitol = this.capitol;
    return events;
  }

  private runCommands(signals: GrowthSignals, now: number): SimEvent[] {
    const events: SimEvent[] = [];
    const settings = config.commands;
    for (const { user, command, color, amount } of signals.commands.slice(0, settings.maxPerTick)) {
      if (command === "donate") { const event = this.donate(user, amount, color, now); if (event) events.push(event); continue; }
      const rule = settings[command];
      if (!rule?.enabled) continue;
      if (color) this.colors.set(user, color);
      const key = `${user}|${command}`;
      if ((this.commandReadyAt.get(key) ?? 0) > now) continue; // on cooldown: ignore quietly
      // Failures only get a short cooldown (enough to stop notice spam); successes the full one.
      const fail = (reason: string) => { this.commandReadyAt.set(key, now + 10_000); events.push({ type: "command", command, user, ok: false, cost: rule.cost, reason }); };
      if (command === "repair" && this.outstandingWear <= 0) { fail("nothing to repair"); continue; }
      if (this.balance(user) < rule.cost) { fail("points"); continue; }
      this.commandReadyAt.set(key, now + rule.cooldownMs);
      this.spent.set(user, (this.spent.get(user) ?? 0) + rule.cost);
      if (command === "repair") { this.outstandingWear--; events.push({ type: "repair", count: 1, by: user }); }
      else events.push({ type: "command", command: command as ChatCommand, user, ok: true, cost: rule.cost });
    }
    if (this.commandReadyAt.size > 2000) for (const [key, at] of this.commandReadyAt) if (at < now) this.commandReadyAt.delete(key);
    return events;
  }

  /** `!donate 10`: spend your own points on the capitol; donations count double. */
  private donate(user: string, requested: number | undefined, color: string | undefined, now: number): SimEvent | undefined {
    const rule = config.capitol.donate;
    if (!rule.enabled) return undefined;
    if (color) this.colors.set(user, color);
    const key = `${user}|donate`;
    if ((this.commandReadyAt.get(key) ?? 0) > now) return undefined;
    const amount = Math.min(this.balance(user), Math.max(rule.minAmount, Math.floor(requested ?? rule.defaultAmount)));
    if (amount < rule.minAmount) { this.commandReadyAt.set(key, now + 10_000); return { type: "command", command: "donate", user, ok: false, cost: rule.minAmount, reason: "points" }; }
    this.commandReadyAt.set(key, now + rule.cooldownMs);
    this.spent.set(user, (this.spent.get(user) ?? 0) + amount);
    this.capitolFund += amount * config.capitol.donationMultiplier;
    this.donors.set(user, (this.donors.get(user) ?? 0) + amount);
    return { type: "command", command: "donate", user, ok: true, cost: amount };
  }

  /** The fund grows with every plus point; a stage completes when it is funded and the era allows. */
  private growCapitol(signals: GrowthSignals): SimEvent | undefined {
    const settings = config.capitol;
    this.capitolFund += signals.plusPoints * settings.share * this.growthMultiplier;
    const next = settings.stages[this.capitolStage];
    if (!next || this.capitolFund < next.points || this.technologyEra < next.era) return undefined;
    this.capitolStage++;
    const donors = [...this.donors].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, points]) => ({ name, points, color: this.colors.get(name) }));
    return { type: "capitol", stage: this.capitolStage, donors };
  }

  get capitol() {
    const stages = config.capitol.stages;
    const next = stages[this.capitolStage];
    const previous = this.capitolStage > 0 ? stages[this.capitolStage - 1].points : 0;
    return next
      ? { stage: this.capitolStage, current: Math.max(0, this.capitolFund - previous), goal: next.points - previous, lockedUntilEra: this.technologyEra < next.era ? next.era : undefined }
      : { stage: this.capitolStage, current: 1, goal: 1 };
  }

  /** Home owners who come back after a break, or keep contributing, see their home grow. */
  private growHomes(signals: GrowthSignals, now: number): SimEvent[] {
    const events: SimEvent[] = [];
    const settings = config.homes;
    for (const [user, points] of Object.entries(signals.byUser)) {
      const owner = this.owners.get(user);
      if (!owner) continue;
      const returning = now - owner.lastSeen > settings.returnGapMs;
      owner.lastSeen = now;
      owner.earned += points;
      if (owner.level < settings.maxLevel && (returning || owner.earned >= settings.upgradePoints)) {
        owner.level++;
        owner.earned = 0;
        events.push({ type: "homeUpgrade", owner: user, level: owner.level, color: this.colors.get(user) ?? owner.color });
      }
    }
    return events;
  }

  // ---------- community and story ----------
  private activeChatters(now: number) {
    const window = config.community.breadthWindowMinutes * 60_000;
    let count = 0;
    for (const [user, at] of this.recentChatters) { if (now - at <= window) count++; else this.recentChatters.delete(user); }
    return count;
  }

  /** Continuous sessions tire growth after a few hours; a long enough sleep resets it. */
  private fatigue(now: number) {
    const settings = config.community;
    if (this.awakeSince === undefined) return 1;
    const hours = (now - this.awakeSince) / 3_600_000;
    return Math.max(settings.minFatigue, 1 - Math.max(0, hours - settings.fatigueAfterHours) * settings.fatiguePerHour);
  }

  /** More distinct chatters means faster growth; a marathon slowly slows it. */
  private communityMultiplier(signals: GrowthSignals, now: number) {
    for (const user of Object.keys(signals.byUser)) this.recentChatters.set(user, now);
    const settings = config.community;
    const breadth = Math.min(settings.maxMultiplier, Math.max(settings.minMultiplier, settings.minMultiplier + 0.1 * Math.log2(1 + this.activeChatters(now))));
    return breadth * this.fatigue(now);
  }

  /** Kardashev tier: 0 up to Empire, then 1, 2, 3 for Type I, II, III. */
  private get tier() { return Math.max(0, Math.min(3, this.technologyEra - 6)); }
  /** How much worse trouble is now than at the start: later chapters and higher tiers. */
  private dangerScale() {
    const settings = config.catastrophes;
    const story = Math.min(settings.maxEscalation, 1 + this.chapter * settings.escalationPerChapter);
    return story * Math.pow(settings.dangerPerEra, this.technologyEra);
  }
  /** Bigger pulses as the city climbs: one more every three eras, two more per Kardashev tier. */
  /**
   * Faster chats take bigger hits: a 300 msg/min chat builds ten times as fast as a 30 msg/min one,
   * so its attacks scale up too (square root of the pace ratio, capped) to still sting.
   */
  private speedScale() {
    const threat = config.threat;
    return Math.min(threat.maxSpeedScale, Math.max(1, Math.sqrt(this.chatPerMinute / threat.speedReferencePerMinute)));
  }
  private maxDestroys() { return config.threat.maxDestroysPerPulse + Math.floor(Math.min(6, this.technologyEra) / 3) + this.tier * 2; }

  /**
   * Natural disasters: no cause, no warning. Earthquakes, floods and tornadoes at first; solar
   * flares, asteroids and rogue drones for a planetary civilisation; gamma bursts and black holes
   * for a galactic one. Only while the community is here; a strong positive chat braces the city.
   */
  private maybeCatastrophe(now: number): SimEvent | undefined {
    const settings = config.catastrophes;
    const awake = this.lastMessageAt !== undefined && now - this.lastMessageAt < config.upkeep.pauseAfterSilenceMs;
    const warmed = this.sessionStartedAt !== undefined && now - this.sessionStartedAt > settings.warmupMinutes * 60_000;
    const schedule = () => {
      const [low, high] = settings.minutesBetween;
      this.nextCatastropheAt = now + (low + Math.random() * (high - low)) * settings.gapScale[this.tier] * 60_000;
    };
    if (this.nextCatastropheAt === undefined) schedule();
    // Asleep, the clock simply waits: nothing natural strikes an empty city.
    if (!awake || !warmed) { if (this.nextCatastropheAt! < now) this.nextCatastropheAt = now + 60_000; return undefined; }
    if (now < this.nextCatastropheAt! || now - this.lastAttackAt < config.threat.cooldownMs / 2) return undefined;
    schedule();
    const tier = this.tier;
    const pools: AttackKind[][] = [
      ["quake", "flood", "tornado", "fire", "storm"],
      ["quake", "flood", "tornado", "flare", "asteroid", "drones"],
      ["flare", "asteroid", "drones", "storm", "quake"],
      ["gamma", "blackhole", "asteroid", "flare", "drones"]
    ];
    const pool = pools[tier];
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const braced = this.plusRate >= settings.bracedPlusPerMinute ? 1 : 0;
    const base = 1 + Math.floor(Math.random() * 2) + tier + (kind === "blackhole" || kind === "gamma" ? 1 : 0);
    const count = Math.max(1, Math.min(Math.round(this.maxDestroys() * this.speedScale()), Math.round(base * Math.sqrt(this.dangerScale()) * this.speedScale()) - braced));
    this.lastAttackAt = now;
    return {
      type: "disaster", kind, intensity: count, damageCount: count, natural: true, severity: this.dangerScale(),
      durationMs: config.events.burnDurationMs,
      reason: NATURAL_REASON[kind] ?? "ACT OF NATURE"
    };
  }

  /**
   * Households: while the stream is offline, a family packs up every so often (never more than
   * a share of the town); once chat is back, positive points move families home again.
   */
  private updateHouseholds(signals: GrowthSignals, now: number, seconds: number): SimEvent | undefined {
    const rest = config.rest;
    const awake = this.lastMessageAt !== undefined && now - this.lastMessageAt < config.upkeep.pauseAfterSilenceMs;
    if (!awake && this.lastMessageAt !== undefined) {
      this.moveOutProgress += seconds / (rest.moveOutMinutes * 60);
      if (this.moveOutProgress >= 1) {
        this.moveOutProgress -= 1;
        this.vacancies++;
        return { type: "moveOut", count: 1 };
      }
      return undefined;
    }
    if (this.vacancies <= 0 || signals.plusPoints <= 0) return undefined;
    this.moveInProgress += signals.plusPoints;
    if (this.moveInProgress < rest.moveInPoints) return undefined;
    this.moveInProgress -= rest.moveInPoints;
    this.vacancies--;
    return { type: "moveIn", count: 1 };
  }

  /** Track when the community is present; coming back after a long break earns a welcome. */
  private noteActivity(signals: GrowthSignals, now: number): SimEvent | undefined {
    if (!signals.scoredMessages) return undefined;
    const rest = config.rest;
    const away = this.lastMessageAt === undefined ? 0 : now - this.lastMessageAt;
    if (this.awakeSince === undefined || away > config.community.restHours * 3_600_000) this.awakeSince = now;
    if (this.lastMessageAt !== undefined && away > rest.welcomeAfterMinutes * 60_000) {
      this.welcomeUntil = now + rest.welcomeMinutes * 60_000;
      return { type: "welcome", awayHours: Math.round(away / 360_000) / 10 };
    }
    return undefined;
  }

  /** The story's day number counts days the community was active, not calendar days since founding. */
  day(_now?: number) { return Math.max(1, this.activeDays); }

  private countActivity(delta: Counts, signals: GrowthSignals, now: number) {
    for (const key of Object.keys(this.totalCounts) as Array<keyof Counts>) this.totalCounts[key] += delta[key] ?? 0;
    this.totalMessages += Object.values(delta).reduce((sum, n) => sum + n, 0);
    for (const user of Object.keys(signals.byUser)) if (!this.leaderboard.has(user)) this.everChatted++;
    for (const [user, points] of Object.entries(signals.bySupporter ?? {})) this.supporters.set(user, (this.supporters.get(user) ?? 0) + points);
    if (!signals.scoredMessages) return;
    const today = localDay(now);
    if (today !== this.lastActiveDay) { this.lastActiveDay = today; this.activeDays++; }
  }
  private chapterGoal() { return config.story.firstChapterPoints * Math.pow(config.story.chapterGrowth, this.chapter); }

  /** Chapters never run out; each is named after what the community did since the last one. */
  private advanceStory(signals: GrowthSignals, now: number): SimEvent | undefined {
    this.chapterPoints += signals.plusPoints * this.growthMultiplier;
    for (const [user, points] of Object.entries(signals.byUser)) this.heroes.set(user, (this.heroes.get(user) ?? 0) + points);
    if (this.chapterPoints < this.chapterGoal()) return undefined;
    this.chapterPoints -= this.chapterGoal();
    this.chapter++;
    const hero = [...this.heroes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const title = chapterTitle(this.tally, this.chapter);
    const entry: ChronicleEntry = { number: this.chapter, title, day: this.day(now), hero };
    this.chronicle.push(entry);
    if (this.chronicle.length > 40) this.chronicle.shift();
    this.tally = { built: 0, repaired: 0, attacks: 0, washed: 0, eras: 0, capitol: 0, quiet: 0, erasLost: 0 };
    this.heroes.clear();
    return { type: "chapter", ...entry };
  }

  get story() { return [...this.chronicle]; }

  /**
   * Wear for time the city was closed (e.g. reopening the extension days later): gentle, capped,
   * and never past "shabby", so a break always leaves something to come back to.
   */
  /** Points between the milestone of `era` and the one before it. */
  private eraSpan(era: number) {
    const milestones = config.technology.milestones;
    if (era <= 0) return milestones[0].points;
    const top = milestones[Math.min(era, milestones.length) - 1].points;
    return top - (era >= 2 ? milestones[era - 2].points : 0);
  }

  /** Knock technology back by a share of the current era's span (so it bites at every era). */
  private loseTechnology(share: number) {
    if (share <= 0) return;
    this.technologyProgress = Math.max(0, this.technologyProgress - share * this.eraSpan(Math.max(1, this.technologyEra)));
  }

  /** Drop eras whose milestone the city has fallen well below. */
  private regress(now = Date.now()): SimEvent[] {
    const events: SimEvent[] = [];
    if (now - this.advancedAt < config.technology.regressionGraceMinutes * 60_000) return events;
    const milestones = config.technology.milestones;
    while (this.technologyEra > 0) {
      const floor = milestones[this.technologyEra - 1].points;
      if (this.technologyProgress >= floor - config.technology.regressionMargin * this.eraSpan(this.technologyEra)) break;
      this.technologyEra--;
      const name = this.technologyEra > 0 ? milestones[this.technologyEra - 1].name : "THE FIRST CAMPFIRE";
      events.push({ type: "regression", era: this.technologyEra, name });
    }
    if (events.length && this.recoveryActive) this.recoveryEra = Math.min(this.recoveryEra, this.technologyEra);
    return events;
  }

  timeAway(ms: number): SimEvent[] {
    const rest = config.rest;
    const steps = Math.min(rest.maxTimeAwaySteps, Math.floor((ms / 3_600_000) * rest.timeAwayStepsPerHour));
    this.outstandingWear += steps;
    const leaving = Math.min(rest.maxTimeAwayMoveOuts, Math.floor((ms / 3_600_000) * rest.timeAwayMoveOutsPerHour));
    this.vacancies += leaving;
    const events: SimEvent[] = [];
    if (steps > 0) events.push({ type: "decay", count: steps, gentle: true });
    if (leaving > 0) events.push({ type: "moveOut", count: leaving });
    // While nobody was around, know-how faded too.
    const technology = config.technology;
    this.loseTechnology(Math.min(technology.maxAwayLossShare, (ms / 3_600_000) * technology.awayLossSharePerHour));
    events.push(...this.regress());
    return events;
  }

  /** Quiet chat wears the city down; positive chat repairs it. Paused while the city sleeps. */
  private updateUpkeep(signals: GrowthSignals, now: number, seconds: number): SimEvent | undefined {
    const upkeep = config.upkeep;
    if (signals.scoredMessages) this.lastMessageAt = now;
    const keepTypical = Math.exp(-seconds / (upkeep.typicalWindowMinutes * 60));
    this.typicalRate = this.typicalRate * keepTypical + this.plusRate * (1 - keepTypical);
    const quietLevel = Math.max(upkeep.quietFloorPerMinute, this.typicalRate * upkeep.quietShare);
    const awake = this.lastMessageAt !== undefined && now - this.lastMessageAt < upkeep.pauseAfterSilenceMs;
    const warmedUp = this.sessionStartedAt !== undefined && now - this.sessionStartedAt > upkeep.warmupMinutes * 60_000;
    const quiet = awake && warmedUp && this.plusRate < quietLevel;
    this.upkeep = "steady";
    if (!awake && this.lastMessageAt !== undefined) {
      // Asleep: the city still fades a little, but only ever to "shabby" (the renderer caps it).
      this.sleepWear += seconds / (config.rest.sleepWearMinutes * 60);
      if (this.sleepWear >= 1) { this.sleepWear -= 1; this.outstandingWear++; return { type: "decay", count: 1, gentle: true }; }
      return undefined;
    }
    // Weathering never stops while the city is awake: chat has to keep repairing it.
    if (awake && warmedUp) {
      this.entropyProgress += seconds / ((upkeep.entropyMinutes * 60) / (1 + this.technologyEra * upkeep.entropyPerEra));
      if (this.entropyProgress >= 1 && now - this.lastDecayAt >= upkeep.minDecayGapMs) {
        this.entropyProgress -= 1;
        this.lastDecayAt = now;
        this.outstandingWear++;
        return { type: "decay", count: 1 };
      }
    }
    if (quiet) {
      this.decayProgress += (seconds / upkeep.decayStepSeconds) * (1 - this.plusRate / quietLevel);
      this.upkeep = "decaying";
      if (this.decayProgress >= 1 && now - this.lastDecayAt >= upkeep.minDecayGapMs) {
        this.decayProgress -= 1;
        this.lastDecayAt = now;
        this.outstandingWear++;
        return { type: "decay", count: 1 };
      }
    } else this.decayProgress = Math.max(0, this.decayProgress - seconds / upkeep.decayStepSeconds);
    if (this.outstandingWear > 0 && signals.plusPoints > 0) {
      this.repairProgress = Math.min(upkeep.repairPoints * 2, this.repairProgress + signals.plusPoints);
      if (!quiet) this.upkeep = "repairing";
      const repairCost = now < this.welcomeUntil ? upkeep.repairPoints / 2 : upkeep.repairPoints;
      if (this.repairProgress >= repairCost && now - this.lastRepairAt >= upkeep.repairCooldownMs) {
        this.repairProgress -= repairCost;
        this.lastRepairAt = now;
        this.outstandingWear--;
        return { type: "repair", count: 1 };
      }
    }
    return undefined;
  }

  /** The top contributors since the last build get the credit for it; the first one owns it. */
  private takeBuilders(now = this.lastTickAt ?? Date.now()) {
    const names = [...this.contributors].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
    this.contributors.clear();
    for (const name of names) if (!this.owners.has(name)) this.owners.set(name, { level: 1, lastSeen: now, earned: 0, color: this.colors.get(name) });
    return names.length ? names : undefined;
  }

  private updateScore(signals: GrowthSignals, seconds: number) {
    const threat = config.threat;
    // Rolling share of messages that carried a minus; rare negativity hits harder.
    const keep = Math.exp(-seconds / threat.rarityWindowSeconds);
    this.recentMessages = this.recentMessages * keep + signals.scoredMessages;
    this.recentMinusMessages = this.recentMinusMessages * keep + signals.minusMessages;
    const minusShare = this.recentMessages > 0 ? this.recentMinusMessages / this.recentMessages : 0;
    const amplified = signals.minusPoints * (1 + threat.rarityBoost * (1 - Math.min(1, minusShare)));
    const byLabel = { ...signals.byLabel };
    if (seconds > 0) {
      const keepRate = Math.exp(-seconds / threat.rateWindowSeconds);
      this.plusRate = this.plusRate * keepRate + (signals.plusPoints / seconds) * 60 * (1 - keepRate);
      const target = this.plusRate * threat.adaptiveShare;
      this.threshold = Math.min(threat.maxThreshold, Math.max(threat.minThreshold, target || threat.destroyThreshold));
    }
    const before = this.threat;
    // Danger grows with the story and with the city's reach: a Type II civilisation makes enemies.
    this.threat = Math.max(0, this.threat - threat.decayPerSecond * seconds - signals.plusPoints * threat.positiveDefense - amplified * this.dangerScale());
    let washBonus = 0;
    this.peakThreatRatio = Math.max(this.peakThreatRatio, this.threat / (this.threshold * METER_PULSES));
    if (before > 0 && this.threat === 0) {
      if (this.peakThreatRatio >= threat.washOutFrom) { washBonus = threat.washOutBonus; byLabel["HATERS WASHED OUT"] = washBonus; }
      this.peakThreatRatio = 0;
    }
    // The rarity boost sharpens the danger meter; the score itself counts points at face value.
    this.scoreTotal += signals.plusPoints + signals.minusPoints + washBonus;
    this.threat = Math.min(this.threat, this.threshold * this.maxDestroys() * threat.backlogPulses);
    const fade = Math.exp(-seconds / 20);
    for (const rule of Object.keys(this.negativeMix)) this.negativeMix[rule] *= fade;
    for (const [rule, points] of Object.entries(signals.byRule)) if (points < 0) this.negativeMix[rule] = (this.negativeMix[rule] ?? 0) - points;
    const pops = Object.entries(byLabel)
      .filter(([, points]) => Math.abs(points) >= 0.25)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4)
      .map(([label, points]) => ({ label, points: Math.round(points * 10) / 10 }));
    this.snapshot = {
      total: Math.round(this.scoreTotal * 10) / 10,
      gained: Math.round((signals.plusPoints + washBonus) * 10) / 10,
      lost: Math.round(signals.minusPoints * 10) / 10,
      threat: Math.round(this.threat * 10) / 10,
      threatRatio: Math.min(1, this.threat / (this.threshold * METER_PULSES)),
      pops,
      topBuilders: [...this.leaderboard].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, points]) => ({ name, points: Math.round(points) })),
      topSupporters: [...this.supporters].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, points]) => ({ name, points: Math.round(points * 10) / 10 })),
      topPatrons: [...this.donors].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, points]) => ({ name, points: Math.round(points) })),
      activity: { messages: this.totalMessages, counts: { ...this.totalCounts }, chatters: this.everChatted },
      highlight: signals.highlight ? { user: signals.highlight.user, text: signals.highlight.text } : undefined
    };
  }

  /** A destruction pulse, paced like build pulses: one or two buildings each time the meter fills. */
  private maybeAttack(now: number): SimEvent | undefined {
    const threat = config.threat;
    if (this.threat < this.threshold) { this.massingSince = undefined; return undefined; }
    this.massingSince ??= now;
    if (now < this.strikeAt()) return undefined;
    this.massingSince = undefined;
    const pulses = Math.min(this.maxDestroys(), Math.floor(this.threat / this.threshold));
    this.threat -= pulses * this.threshold;
    const count = Math.round(pulses * this.speedScale() * config.threat.attackSizeMultiplier);
    this.lastAttackAt = now;
    const [rule] = Object.entries(this.negativeMix).sort((a, b) => b[1] - a[1])[0] ?? ["toxic"];
    // The attack matches its cause and scales with the damage: spam is always a swarm and caps
    // are always lightning, just bigger. Toxic chat starts as a fire and escalates to a meteor.
    const flavour = ATTACK_FOR_RULE[rule] ?? ["fire"];
    const toxic = rule === "toxic" || rule === "hate" || rule === "lowEffort";
    let kind: AttackKind = rule === "hate" || (toxic && count >= 3) ? "meteor" : toxic ? "fire" : flavour[Math.floor(Math.random() * flavour.length)];
    // Space-age cities get space-age versions of the same trouble.
    if (this.technologyEra >= 7) kind = ({ meteor: "asteroid", swarm: "drones", fire: this.technologyEra >= 8 ? "flare" : "fire" } as Partial<Record<AttackKind, AttackKind>>)[kind] ?? kind;
    this.snapshot = { ...this.snapshot, threat: Math.round(this.threat * 10) / 10, threatRatio: Math.min(1, this.threat / (this.threshold * METER_PULSES)) };
    return {
      type: "disaster", kind, intensity: count, damageCount: count, severity: this.dangerScale(),
      durationMs: config.events.burnDurationMs,
      reason: ATTACK_REASON[rule] ?? "TROUBLE"
    };
  }


  private repairCost() { return config.growth.progressThreshold * config.repair.costShare; }

  private startRecovery(intensity: number) {
    const recovery = config.recovery;
    const previousRecoveryEra = this.recoveryActive ? this.recoveryEra : this.technologyEra;
    if (!this.recoveryActive) {
      this.recoveryProgress = 0;
      this.recoveryGoal = 0;
    }
    const eraLoss = Math.min(recovery.maxEraLoss, Math.max(1, Math.ceil(intensity / recovery.eraLossPerIntensity)));
    this.recoveryEra = Math.min(previousRecoveryEra, Math.max(0, this.technologyEra - eraLoss));
    this.recoveryGoal += recovery.basePoints + intensity * recovery.pointsPerIntensity;
    this.recoveryProgress = Math.max(0, this.recoveryProgress - intensity * 2);
    this.recoveryActive = true;
  }
}
