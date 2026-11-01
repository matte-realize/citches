import { config } from "../config.js";
import type { GrowthSignals } from "../aggregate/aggregator.js";
import type { Aggregate, AttackKind, ChatCommand, CommunityProgress, Counts, ScoreSnapshot, SimEvent } from "../types.js";

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
  spent?: Array<[string, number]>;
  capitolFund?: number; capitolStage?: number; donors?: Array<[string, number]>;
  owners?: Array<[string, number, string]>;
}

export class EventMapper {
  private sessionStartedAt?: number;
  private houseProgress = 0;
  private landmarkProgress = 0;
  private technologyProgress = 0;
  private technologyEra = 0;
  private recoveryActive = false;
  private recoveryEra = 0;
  private recoveryProgress = 0;
  private recoveryGoal = 0;
  private lastBuildAt = 0;
  private scoreTotal = 0;
  private threat = 0;
  private lastAttackAt = 0;
  private lastFireworksAt = 0;
  private recentMessages = 0;
  private recentMinusMessages = 0;
  private peakThreatRatio = 0;
  private plusRate = 0; // exponentially weighted plus points per minute
  private typicalRate = 0; // the channel's normal pace, over a much longer window
  private decayProgress = 0;
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
      houseProgress: this.houseProgress, landmarkProgress: this.landmarkProgress,
      technologyProgress: this.technologyProgress, technologyEra: this.technologyEra,
      recoveryActive: this.recoveryActive, recoveryEra: this.recoveryEra,
      recoveryProgress: this.recoveryProgress, recoveryGoal: this.recoveryGoal,
      scoreTotal: this.scoreTotal, threat: this.threat, snapshot: { ...this.snapshot, highlight: undefined },
      outstandingWear: this.outstandingWear,
      capitolFund: this.capitolFund, capitolStage: this.capitolStage,
      donors: [...this.donors].sort((a, b) => b[1] - a[1]).slice(0, 50),
      spent: [...this.spent].slice(-500),
      owners: [...this.owners].slice(-300).map(([name, owner]) => [name, owner.level, owner.color ?? ""] as [string, number, string]),
      leaderboard: [...this.leaderboard].sort((a, b) => b[1] - a[1]).slice(0, 50)
    };
  }

  importState(state: Partial<MapperState>) {
    const numbers = ["houseProgress", "landmarkProgress", "technologyProgress", "technologyEra", "recoveryEra", "recoveryProgress", "recoveryGoal", "scoreTotal", "threat", "outstandingWear", "capitolFund", "capitolStage"] as const;
    for (const key of numbers) if (typeof state[key] === "number" && Number.isFinite(state[key])) this[key] = state[key] as number;
    if (typeof state.recoveryActive === "boolean") this.recoveryActive = state.recoveryActive;
    if (state.snapshot) this.snapshot = { ...state.snapshot, pops: [] };
    if (Array.isArray(state.donors)) this.donors = new Map(state.donors.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (Array.isArray(state.spent)) this.spent = new Map(state.spent.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
    if (Array.isArray(state.owners)) for (const [name, level, color] of state.owners) if (typeof name === "string") this.owners.set(name, { level: Number(level) || 0, lastSeen: 0, earned: 0, color: color || undefined });
    if (Array.isArray(state.leaderboard)) this.leaderboard = new Map(state.leaderboard.filter(([name, points]) => typeof name === "string" && Number.isFinite(points)));
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
      }
    };
  }

  /** `now` defaults to the clock; the calibration harness passes message time so hours replay in seconds. */
  map(aggregate: Aggregate, delta: Counts, deltaRaidViewers: number, signals: GrowthSignals, now = Date.now()): SimEvent[] {
    const rateScale = Math.max(1, aggregate.messagesPerSecond / config.events.rateReference);
    const events: SimEvent[] = [];
    const growth = config.growth;
    this.sessionStartedAt ??= now;
    const seconds = Math.min(5, (now - (this.lastTickAt ?? now)) / 1000);
    this.lastTickAt = now;
    const eligible = signals.eligibleMessages;
    if (eligible > 0) {
      const averageComplexity = signals.complexityTotal / eligible;
      const positiveRatio = signals.positiveMessages / eligible;
      const minutesLive = (now - this.sessionStartedAt) / 60_000;
      const longevity = 1 + growth.longevityMultiplier * Math.min(1, minutesLive / growth.longevityMinutes);
      const chatPace = Math.min(1.35, 0.85 + aggregate.messagesPerSecond / config.events.rateReference * 0.08);
      const pointsPerMessage = (growth.basePoints + averageComplexity * growth.complexityMultiplier + positiveRatio * growth.positivityMultiplier) * longevity * chatPace;
      this.houseProgress += delta.COMMENT * pointsPerMessage;
      this.landmarkProgress += delta.QUESTION * pointsPerMessage;
      const technology = config.technology;
      this.technologyProgress += (
        eligible * technology.chatPoint
        + signals.complexityTotal * technology.complexityPoint
        + signals.positiveMessages * technology.positivityPoint
      ) * longevity * chatPace;
    }
    this.houseProgress += signals.supportPoints * config.support.growthMultiplier;
    this.technologyProgress += signals.supportPoints * config.technology.supportPointMultiplier;

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

    // Minuses slow technology down, but never undo a milestone that was already reached.
    const eraFloor = this.technologyEra > 0 ? config.technology.milestones[this.technologyEra - 1].points : 0;
    this.technologyProgress = Math.max(eraFloor, this.technologyProgress + signals.minusPoints * config.threat.technologyPenalty);
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
      events.push({ type: "advancement", era: this.technologyEra, name: milestone.name });
    }

    if (now - this.lastBuildAt >= growth.buildCooldownMs) {
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
    const upkeep = this.updateUpkeep(signals, now, seconds);
    if (upkeep) events.push(upkeep);
    const capitol = this.growCapitol(signals);
    if (capitol) events.push(capitol);
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
    this.capitolFund += signals.plusPoints * settings.share;
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
      if (this.repairProgress >= upkeep.repairPoints && now - this.lastRepairAt >= upkeep.repairCooldownMs) {
        this.repairProgress -= upkeep.repairPoints;
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
    this.threat = Math.max(0, this.threat - threat.decayPerSecond * seconds - signals.plusPoints * threat.positiveDefense - amplified);
    let washBonus = 0;
    this.peakThreatRatio = Math.max(this.peakThreatRatio, this.threat / (this.threshold * METER_PULSES));
    if (before > 0 && this.threat === 0) {
      if (this.peakThreatRatio >= threat.washOutFrom) { washBonus = threat.washOutBonus; byLabel["HATERS WASHED OUT"] = washBonus; }
      this.peakThreatRatio = 0;
    }
    // The rarity boost sharpens the danger meter; the score itself counts points at face value.
    this.scoreTotal += signals.plusPoints + signals.minusPoints + washBonus;
    this.threat = Math.min(this.threat, this.threshold * threat.maxDestroysPerPulse * threat.backlogPulses);
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
      highlight: signals.highlight ? { user: signals.highlight.user, text: signals.highlight.text } : undefined
    };
  }

  /** A destruction pulse, paced like build pulses: one or two buildings each time the meter fills. */
  private maybeAttack(now: number): SimEvent | undefined {
    const threat = config.threat;
    if (this.threat < this.threshold || now - this.lastAttackAt < threat.cooldownMs) return undefined;
    const count = Math.min(threat.maxDestroysPerPulse, Math.floor(this.threat / this.threshold));
    this.threat -= count * this.threshold;
    this.lastAttackAt = now;
    const [rule] = Object.entries(this.negativeMix).sort((a, b) => b[1] - a[1])[0] ?? ["toxic"];
    // The attack matches its cause and scales with the damage: spam is always a swarm and caps
    // are always lightning, just bigger. Toxic chat starts as a fire and escalates to a meteor.
    const flavour = ATTACK_FOR_RULE[rule] ?? ["fire"];
    const toxic = rule === "toxic" || rule === "hate" || rule === "lowEffort";
    const kind: AttackKind = rule === "hate" || (toxic && count >= 3) ? "meteor" : toxic ? "fire" : flavour[Math.floor(Math.random() * flavour.length)];
    this.snapshot = { ...this.snapshot, threat: Math.round(this.threat * 10) / 10, threatRatio: Math.min(1, this.threat / (this.threshold * METER_PULSES)) };
    return {
      type: "disaster", kind, intensity: count, damageCount: count,
      durationMs: config.events.burnDurationMs,
      reason: ATTACK_REASON[rule] ?? "TROUBLE"
    };
  }


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
