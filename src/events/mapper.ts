import { config } from "../config.js";
import type { GrowthSignals } from "../aggregate/aggregator.js";
import type { Aggregate, Counts, SimEvent } from "../types.js";

export class EventMapper {
  private readonly sessionStartedAt = Date.now();
  private houseProgress = 0;
  private landmarkProgress = 0;
  private lastBuildAt = 0;

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
    }
    this.houseProgress += signals.supportPoints * config.support.growthMultiplier;

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
      events.push({ type: "disaster", kind: Math.random() < 0.5 ? "fire" : "meteor", intensity: intensity(delta.HATE) });
    }
    return events;
  }
}
