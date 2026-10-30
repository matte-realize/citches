import { config } from "../config.js";
import type { Aggregate, SimEvent } from "../types.js";

export function mapEvents(aggregate: Aggregate): SimEvent[] {
  const scale = Math.max(1, aggregate.messagesPerSecond / config.events.rateReference);
  const out: SimEvent[] = [];
  const count = (n: number) => Math.max(0, Math.round(n * config.events.countMultiplier * scale));
  const intensity = (n: number) => Math.min(10, n * config.events.intensityMultiplier * scale);
  const houses = count(aggregate.counts.COMMENT);
  const landmarks = count(aggregate.counts.QUESTION);
  if (houses) out.push({ type: "build", kind: "house", count: houses });
  if (landmarks) out.push({ type: "build", kind: "landmark", count: landmarks });
  if (aggregate.counts.SPAM >= config.events.fireworksThreshold) out.push({ type: "effect", kind: "fireworks", intensity: intensity(aggregate.counts.SPAM) });
  if (aggregate.raidViewers >= config.events.raidMinimumViewers && aggregate.raidViewers > 0) out.push({ type: "boom", viewers: aggregate.raidViewers });
  if (aggregate.counts.HATE >= config.events.disasterThreshold) out.push({ type: "disaster", kind: "fire", intensity: intensity(aggregate.counts.HATE) });
  return out;
}
