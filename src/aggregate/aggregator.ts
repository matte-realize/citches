import { config } from "../config.js";
import { classify } from "../classify/classifier.js";
import { analyzeMessage } from "../classify/signals.js";
import { ScoreContext, scoreMessage } from "../score/rules.js";
import type { ScoreHit } from "../score/rules.js";
import type { Aggregate, Category, ChatCommand, ChatMessage, Counts } from "../types.js";

const emptyCounts = (): Counts => ({ RAID: 0, SPAM: 0, QUESTION: 0, HATE: 0, COMMENT: 0 });
export interface GrowthSignals {
  eligibleMessages: number; positiveMessages: number; complexityTotal: number; supportPoints: number;
  /** Sum of plus and minus points from the scoring rules this tick. */
  plusPoints: number; minusPoints: number;
  /** Messages scored this tick, and how many of them carried any minus. */
  scoredMessages: number; minusMessages: number;
  /** Points per rule id and per visible label, for attacks and overlay pops. */
  byRule: Record<string, number>; byLabel: Record<string, number>;
  /** Plus points earned per chatter this tick (only chatters who netted positive). */
  byUser: Record<string, number>;
  /** Best purely positive message this tick, if any. */
  highlight?: { user: string; text: string; points: number };
  /** Chat commands typed this tick ("!plant" and friends). */
  commands: Array<{ user: string; command: ChatCommand; color?: string; amount?: number }>;
  /** Latest known name colour per chatter. */
  colors: Record<string, string>;
}

const COMMAND = /^!(plant|repair|cheer|home|donate)\b\s*(\d+)?/i;
export class Aggregator {
  private messages: Array<{ message: ChatMessage; receivedAt: number; category: Category; signal: ReturnType<typeof analyzeMessage> }> = [];
  private pending: Array<{ message: ChatMessage; category: Category; signal: ReturnType<typeof analyzeMessage>; hits: ScoreHit[] }> = [];
  private scoreContext = new ScoreContext();
  private pendingCommands: Array<{ user: string; command: ChatCommand; color?: string; amount?: number }> = [];
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private tick: (aggregate: Aggregate, deltaCounts: Counts, deltaRaidViewers: number, growthSignals: GrowthSignals) => void,
    private windowMs = config.aggregateWindowMs,
    private tickMs = config.aggregateTickMs
  ) {}
  /** `receivedAt` defaults to now; the calibration harness passes each message's own timestamp. */
  add(message: ChatMessage, receivedAt = Date.now()) {
    // Commands act on the city but are not scored, so they cannot be farmed for points.
    const command = COMMAND.exec(message.text.trim());
    if (command) { this.pendingCommands.push({ user: message.user, command: command[1].toLowerCase() as ChatCommand, color: message.color, amount: command[2] ? Number(command[2]) : undefined }); return; }
    const category = classify(message);
    const signal = analyzeMessage(message, category);
    this.messages.push({ message, receivedAt, category, signal });
    this.pending.push({ message, category, signal, hits: scoreMessage(message, category, signal, this.scoreContext) });
  }
  start() {
    this.timer = setInterval(() => this.flush(), this.tickMs);
  }

  /** Close the current tick. Live mode calls this on a timer; the harness calls it on message time. */
  flush(now = Date.now()) {
    {
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
      const growthSignals: GrowthSignals = { eligibleMessages: 0, positiveMessages: 0, complexityTotal: 0, supportPoints: 0, plusPoints: 0, minusPoints: 0, scoredMessages: 0, minusMessages: 0, byRule: {}, byLabel: {}, byUser: {}, commands: this.pendingCommands, colors: {} };
      this.pendingCommands = [];
      let deltaRaidViewers = 0;
      for (const { message, category, signal, hits } of this.pending) {
        growthSignals.scoredMessages++;
        if (message.color) growthSignals.colors[message.user] = message.color;
        const negative = hits.some(hit => hit.points < 0);
        if (negative) growthSignals.minusMessages++;
        const earned = hits.reduce((sum, hit) => sum + hit.points, 0);
        if (earned > 0 && message.user) growthSignals.byUser[message.user] = (growthSignals.byUser[message.user] ?? 0) + earned;
        const text = message.text.trim();
        if (!negative && earned >= 1 && text.length >= 6 && text.length <= 90 && (!growthSignals.highlight || earned > growthSignals.highlight.points)) {
          growthSignals.highlight = { user: message.user, text, points: earned };
        }
        for (const hit of hits) {
          if (hit.points >= 0) growthSignals.plusPoints += hit.points; else growthSignals.minusPoints += hit.points;
          growthSignals.byRule[hit.rule] = (growthSignals.byRule[hit.rule] ?? 0) + hit.points;
          if (hit.label) growthSignals.byLabel[hit.label] = (growthSignals.byLabel[hit.label] ?? 0) + hit.points;
        }
        deltaCounts[category]++;
        if (message.isRaid) deltaRaidViewers += message.raidViewerCount;
        if (signal.eligible) growthSignals.eligibleMessages++;
        if (signal.positive) growthSignals.positiveMessages++;
        growthSignals.complexityTotal += signal.complexity;
        growthSignals.supportPoints += signal.supportPoints;
      }
      this.pending = [];
      this.tick({ timestamp: now, counts, messagesPerSecond: recent.length / (this.windowMs / 1000), raidViewers, supportPoints }, deltaCounts, deltaRaidViewers, growthSignals);
    }
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
