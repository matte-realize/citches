import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { normalizeTwitchMessage, type NormalizeOverrides } from "./normalize.js";
import type { ChatMessage, MessageSource } from "../types.js";

function normalize(row: any): ChatMessage {
  if (typeof row?.timestamp === "number" && typeof row?.user === "string") return {
    timestamp: row.timestamp, user: row.user, text: row.text ?? "", emotes: row.emotes ?? [],
    isRaid: Boolean(row.isRaid), raidViewerCount: Number(row.raidViewerCount ?? 0),
    supportPoints: Number(row.supportPoints ?? 0)
  };
  const overrides: NormalizeOverrides = { event: row.event, giftCount: row.giftCount };
  return normalizeTwitchMessage(row.tags ?? {}, row.text ?? "", Number(row.receivedAt ?? Date.now()), overrides);
}

export class ReplaySource implements MessageSource {
  private handler: (message: ChatMessage) => void = () => {};
  private stopped = false;
  constructor(private file: string, private speed = 1) {}
  onMessage(handler: (message: ChatMessage) => void) { this.handler = handler; }
  async connect() {
    const lines = createInterface({ input: createReadStream(this.file), crlfDelay: Infinity });
    let firstTimestamp: number | undefined;
    const startedAt = Date.now();
    for await (const line of lines) {
      if (this.stopped || !line.trim()) continue;
      let message: ChatMessage;
      try { message = normalize(JSON.parse(line)); } catch { console.warn("Skipping invalid JSONL row"); continue; }
      firstTimestamp ??= message.timestamp;
      const target = startedAt + Math.max(0, message.timestamp - firstTimestamp) / this.speed;
      const delay = target - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      if (!this.stopped) { console.log(`[replay] ${message.user}: ${message.text}`); this.handler(message); }
    }
    console.log("Replay finished");
  }
  async close() { this.stopped = true; }
}
