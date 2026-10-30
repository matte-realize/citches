import { config } from "../config.js";
import { classify } from "../classify/classifier.js";
import type { Aggregate, Category, ChatMessage, Counts } from "../types.js";

const emptyCounts = (): Counts => ({ RAID: 0, SPAM: 0, QUESTION: 0, HATE: 0, COMMENT: 0 });
export class Aggregator {
  private messages: Array<{ message: ChatMessage; receivedAt: number }> = [];
  private timer?: NodeJS.Timeout;
  constructor(private tick: (aggregate: Aggregate) => void, private windowMs = config.aggregateWindowMs) {}
  add(message: ChatMessage) { this.messages.push({ message, receivedAt: Date.now() }); }
  start() {
    this.timer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      const recent = this.messages.filter(item => item.receivedAt >= cutoff);
      this.messages = this.messages.filter(item => item.receivedAt >= cutoff);
      const counts = emptyCounts();
      let raidViewers = 0;
      for (const { message } of recent) {
        counts[classify(message) as Category]++;
        if (message.isRaid) raidViewers += message.raidViewerCount;
      }
      this.tick({ timestamp: now, counts, messagesPerSecond: recent.length / (this.windowMs / 1000), raidViewers });
    }, this.windowMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
