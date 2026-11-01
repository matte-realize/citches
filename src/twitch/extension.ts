import { createHmac } from "node:crypto";
import type { Aggregate, CommunityProgress, ScoreSnapshot, SimEvent } from "../types.js";

/**
 * Publishes city ticks to every viewer of the Twitch Extension overlay through Extension PubSub.
 * Twitch allows roughly one broadcast per second and 5 KB per message, so ticks are merged into
 * one batch per interval. Enabled only when all four TWITCH_EXT_* variables are set.
 */
export interface ExtensionTick { aggregate: Aggregate; events: SimEvent[]; progress: CommunityProgress; score: ScoreSnapshot }

const MAX_BYTES = 4800;

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signExtensionJwt(secretBase64: string, ownerId: string, channelId: string, ttlSeconds = 60) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    user_id: ownerId, role: "external", channel_id: channelId,
    pubsub_perms: { send: ["broadcast"] }
  }));
  const signature = base64url(createHmac("sha256", Buffer.from(secretBase64, "base64")).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

export class ExtensionPublisher {
  private pending: ExtensionTick[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private failures = 0;

  constructor(private clientId: string, private secret: string, private ownerId: string, private channelId: string, private intervalMs = 1100) {}

  static fromEnv(env = process.env) {
    const { TWITCH_EXT_CLIENT_ID, TWITCH_EXT_SECRET, TWITCH_EXT_OWNER_ID, TWITCH_BROADCASTER_ID } = env;
    if (!TWITCH_EXT_CLIENT_ID || !TWITCH_EXT_SECRET || !TWITCH_EXT_OWNER_ID || !TWITCH_BROADCASTER_ID) return undefined;
    return new ExtensionPublisher(TWITCH_EXT_CLIENT_ID, TWITCH_EXT_SECRET, TWITCH_EXT_OWNER_ID, TWITCH_BROADCASTER_ID);
  }

  start() { this.timer = setInterval(() => void this.flush(), this.intervalMs); }
  stop() { if (this.timer) clearInterval(this.timer); }
  push(tick: ExtensionTick) { this.pending.push(tick); }

  /** Merge pending ticks: all events, summed pops, latest progress/score/aggregate. */
  private batch() {
    if (!this.pending.length) return undefined;
    const latest = this.pending[this.pending.length - 1];
    const events = this.pending.flatMap(tick => tick.events);
    const popTotals = new Map<string, number>();
    for (const tick of this.pending) for (const pop of tick.score.pops) popTotals.set(pop.label, (popTotals.get(pop.label) ?? 0) + pop.points);
    const pops = [...popTotals].map(([label, points]) => ({ label, points: Math.round(points * 10) / 10 })).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 6);
    this.pending = [];
    const tick = { type: "tick", aggregate: latest.aggregate, events, progress: latest.progress, score: { ...latest.score, pops } };
    let json = JSON.stringify(tick);
    // Stay under the PubSub size cap by dropping the bulkiest optional data first.
    while (json.length > MAX_BYTES && tick.events.length) { tick.events.pop(); json = JSON.stringify(tick); }
    return json;
  }

  private async flush() {
    const message = this.batch();
    if (!message) return;
    try {
      const response = await fetch("https://api.twitch.tv/helix/extensions/pubsub", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${signExtensionJwt(this.secret, this.ownerId, this.channelId)}`,
          "Client-Id": this.clientId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target: ["broadcast"], broadcaster_id: this.channelId, is_global_broadcast: false, message })
      });
      if (!response.ok && this.failures++ < 5) console.warn(`extension pubsub ${response.status}: ${await response.text()}`);
    } catch (error) {
      if (this.failures++ < 5) console.warn("extension pubsub failed", error);
    }
  }
}
