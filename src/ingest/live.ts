import tmi from "tmi.js";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage, MessageSource } from "../types.js";

export class LiveSource implements MessageSource {
  private client?: InstanceType<typeof tmi.Client>;
  private handler: (message: ChatMessage) => void = () => {};
  private logFile = "";
  constructor(private channel: string) {}
  onMessage(handler: (message: ChatMessage) => void) { this.handler = handler; }
  async connect() {
    const safeChannel = this.channel.replace(/^#/, "").toLowerCase();
    await mkdir("logs", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = join("logs", `${safeChannel}-${date}.jsonl`);
    const client = new tmi.Client({ options: { debug: false }, connection: { reconnect: true, secure: true }, channels: [safeChannel] });
    this.client = client;
    client.on("message", async (_channel, tags, text, self) => {
      if (self) return;
      const raw = { receivedAt: Date.now(), channel: safeChannel, tags, text };
      await appendFile(this.logFile, `${JSON.stringify(raw)}\n`);
      const message: ChatMessage = {
        timestamp: Number(tags["tmi-sent-ts"] ?? Date.now()), user: tags.username ?? "anonymous", text,
        emotes: Object.keys(tags.emotes ?? {}), isRaid: tags["msg-id"] === "raid",
        raidViewerCount: Number(tags["msg-param-viewerCount"] ?? 0)
      };
      console.log(`[${new Date(message.timestamp).toISOString()}] ${message.user}: ${message.text}`);
      this.handler(message);
    });
    client.on("raided", async (channel, username, viewers) => {
      const raw = { receivedAt: Date.now(), channel, tags: { "msg-id": "raid", username, "msg-param-viewerCount": String(viewers) }, text: "" };
      await appendFile(this.logFile, `${JSON.stringify(raw)}\n`);
      const message: ChatMessage = { timestamp: Date.now(), user: username, text: "", emotes: [], isRaid: true, raidViewerCount: viewers };
      console.log(`RAID ${username} (${viewers} viewers)`);
      this.handler(message);
    });
    await client.connect();
    console.log(`Connected to #${safeChannel}; logging to ${this.logFile}`);
  }
  async close() { await this.client?.disconnect(); }
}
