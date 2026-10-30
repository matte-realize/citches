import { config } from "../config.js";
import type { GrowthSignals } from "../aggregate/aggregator.js";
import type { Aggregate, CommunityProgress, Counts, SimEvent } from "../types.js";

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

    while (this.technologyEra < config.technology.milestones.length
      && this.technologyProgress >= config.technology.milestones[this.technologyEra].points) {
      const milestone = config.technology.milestones[this.technologyEra];
      this.technologyEra++;
      events.push({ type: "advancement", era: this.technologyEra, name: milestone.name });
    }

    const now = Date.now();
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
    if (delta.SPAM >= config.events.fireworksThreshold) events.push({ type: "effect", kind: "fireworks", intensity: intensity(delta.SPAM) });
    if (delta.RAID && deltaRaidViewers >= config.events.raidMinimumViewers) events.push({ type: "boom", viewers: deltaRaidViewers });
    if (aggregate.counts.HATE >= config.events.disasterThreshold && delta.HATE > 0) {
      const disasterIntensity = intensity(delta.HATE);
      events.push({
        type: "disaster",
        kind: Math.random() < 0.5 ? "fire" : "meteor",
        intensity: disasterIntensity,
        damageCount: Math.max(1, Math.ceil(disasterIntensity * config.events.destroyedBuildingsPerIntensity)),
        durationMs: config.events.burnDurationMs
      });
      this.startRecovery(disasterIntensity);
    }
    return events;
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
