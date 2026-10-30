import { config } from "../config.js";
import { classify } from "../classify/classifier.js";
import { analyzeMessage } from "../classify/signals.js";
import type { Aggregate, Category, ChatMessage, Counts } from "../types.js";

const emptyCounts = (): Counts => ({ RAID: 0, SPAM: 0, QUESTION: 0, HATE: 0, COMMENT: 0 });
export interface GrowthSignals { eligibleMessages: number; positiveMessages: number; complexityTotal: number; supportPoints: number }
export class Aggregator {
  private messages: Array<{ message: ChatMessage; receivedAt: number; category: Category; signal: ReturnType<typeof analyzeMessage> }> = [];
  private pending: Array<{ message: ChatMessage; category: Category; signal: ReturnType<typeof analyzeMessage> }> = [];
  private timer?: NodeJS.Timeout;
  constructor(
    private tick: (aggregate: Aggregate, deltaCounts: Counts, deltaRaidViewers: number, growthSignals: GrowthSignals) => void,
    private windowMs = config.aggregateWindowMs,
    private tickMs = config.aggregateTickMs
  ) {}
  add(message: ChatMessage) {
    const category = classify(message);
    const signal = analyzeMessage(message, category);
    this.messages.push({ message, receivedAt: Date.now(), category, signal });
    this.pending.push({ message, category, signal });
  }
  start() {
    this.timer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      const recent = this.messages.filter(item => item.receivedAt >= cutoff);
      this.messages = this.messages.filter(item => item.receivedAt >= cutoff);
      const counts = emptyCounts();
      let raidViewers = 0;
      let supportPoints = 0;
      for (const { message, category, signal } of recent) {
        counts[category]++;
        if (message.isRaid) raidViewers += message.raidViewerCount;
        supportPoints += signal.supportPoints;
      }
      const deltaCounts = emptyCounts();
      const growthSignals: GrowthSignals = { eligibleMessages: 0, positiveMessages: 0, complexityTotal: 0, supportPoints: 0 };
      let deltaRaidViewers = 0;
      for (const { message, category, signal } of this.pending) {
        deltaCounts[category]++;
        if (message.isRaid) deltaRaidViewers += message.raidViewerCount;
        if (signal.eligible) growthSignals.eligibleMessages++;
        if (signal.positive) growthSignals.positiveMessages++;
        growthSignals.complexityTotal += signal.complexity;
        growthSignals.supportPoints += signal.supportPoints;
      }
      this.pending = [];
      this.tick({ timestamp: now, counts, messagesPerSecond: recent.length / (this.windowMs / 1000), raidViewers, supportPoints }, deltaCounts, deltaRaidViewers, growthSignals);
    }, this.tickMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
