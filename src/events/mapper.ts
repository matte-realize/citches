import { config } from "../config.js";
import type { GrowthSignals } from "../aggregate/aggregator.js";
import type { Aggregate, AttackKind, CommunityProgress, Counts, ScoreSnapshot, SimEvent } from "../types.js";

/** Which attack each flavour of negativity summons. */
const ATTACK_FOR_RULE: Record<string, AttackKind[]> = {
  hate: ["meteor", "fire"], toxic: ["meteor", "fire"], shouting: ["storm"],
  spam: ["swarm"], copypasta: ["swarm"], flood: ["swarm", "storm"], lowEffort: ["fire"]
};
const ATTACK_REASON: Record<string, string> = {
  hate: "HATE", toxic: "TOXIC CHAT", shouting: "ALL CAPS STORM", spam: "SPAM SWARM", copypasta: "COPYPASTA SWARM", flood: "CHAT FLOOD", lowEffort: "LOW EFFORT"
};

export class EventMapper {
  private readonly sessionStartedAt = Date.now();
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
  private lastTickAt = Date.now();
  private negativeMix: Record<string, number> = {};
  private snapshot: ScoreSnapshot = { total: 0, gained: 0, lost: 0, threat: 0, threatRatio: 0, pops: [] };

  get score(): ScoreSnapshot { return this.snapshot; }

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

  map(aggregate: Aggregate, delta: Counts, deltaRaidViewers: number, signals: GrowthSignals): SimEvent[] {
    const rateScale = Math.max(1, aggregate.messagesPerSecond / config.events.rateReference);
    const events: SimEvent[] = [];
    const growth = config.growth;
    const now = Date.now();
    const seconds = Math.min(5, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    const eligible = signals.eligibleMessages;
    if (eligible > 0) {
      const averageComplexity = signals.complexityTotal / eligible;
      const positiveRatio = signals.positiveMessages / eligible;
      const minutesLive = (Date.now() - this.sessionStartedAt) / 60_000;
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
    this.updateScore(signals, seconds);

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
        events.push({ type: "build", kind: "landmark", count });
      } else if (this.houseProgress >= growth.progressThreshold) {
        const count = Math.min(growth.maxBuildsPerPulse, Math.floor(this.houseProgress / growth.progressThreshold));
        this.houseProgress -= count * growth.progressThreshold;
        this.lastBuildAt = now;
        events.push({ type: "build", kind: "house", count });
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
    return events;
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
    const before = this.threat;
    this.threat = Math.max(0, this.threat - threat.decayPerSecond * seconds - signals.plusPoints * threat.positiveDefense - amplified);
    let washBonus = 0;
    this.peakThreatRatio = Math.max(this.peakThreatRatio, this.threat / threat.destroyThreshold);
    if (before > 0 && this.threat === 0) {
      if (this.peakThreatRatio >= threat.washOutFrom) { washBonus = threat.washOutBonus; byLabel["HATERS WASHED OUT"] = washBonus; }
      this.peakThreatRatio = 0;
    }
    // The rarity boost sharpens the danger meter; the score itself counts points at face value.
    this.scoreTotal += signals.plusPoints + signals.minusPoints + washBonus;
    this.threat = Math.min(this.threat, threat.destroyThreshold * threat.maxDestroysPerPulse * threat.backlogPulses);
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
      threatRatio: Math.min(1, this.threat / threat.destroyThreshold),
      pops
    };
  }

  /** A destruction pulse, paced like build pulses: one or two buildings each time the meter fills. */
  private maybeAttack(now: number): SimEvent | undefined {
    const threat = config.threat;
    if (this.threat < threat.destroyThreshold || now - this.lastAttackAt < threat.cooldownMs) return undefined;
    const count = Math.min(threat.maxDestroysPerPulse, Math.floor(this.threat / threat.destroyThreshold));
    this.threat -= count * threat.destroyThreshold;
    this.lastAttackAt = now;
    const [rule] = Object.entries(this.negativeMix).sort((a, b) => b[1] - a[1])[0] ?? ["toxic"];
    // The attack matches its cause and scales with the damage: spam is always a swarm and caps
    // are always lightning, just bigger. Toxic chat starts as a fire and escalates to a meteor.
    const flavour = ATTACK_FOR_RULE[rule] ?? ["fire"];
    const toxic = rule === "toxic" || rule === "hate" || rule === "lowEffort";
    const kind: AttackKind = rule === "hate" || (toxic && count >= 3) ? "meteor" : toxic ? "fire" : flavour[Math.floor(Math.random() * flavour.length)];
    this.snapshot = { ...this.snapshot, threat: Math.round(this.threat * 10) / 10, threatRatio: Math.min(1, this.threat / threat.destroyThreshold) };
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
