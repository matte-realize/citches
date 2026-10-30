import tmi from "tmi.js";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { normalizeTwitchMessage, type NormalizeOverrides } from "./normalize.js";
import type { ChatMessage, MessageSource } from "../types.js";

export class LiveSource implements MessageSource {
  private client?: InstanceType<typeof tmi.Client>;
  private handler: (message: ChatMessage) => void = () => {};
  private logFile = "";
  constructor(private channel: string) {}
  onMessage(handler: (message: ChatMessage) => void) { this.handler = handler; }

  private async receive(channel: string, tags: Record<string, any>, text: string, overrides?: NormalizeOverrides) {
    const receivedAt = Date.now();
    const raw = { receivedAt, channel, tags, text, ...overrides };
    await appendFile(this.logFile, `${JSON.stringify(raw)}\n`);
    const message = normalizeTwitchMessage(tags, text, receivedAt, overrides);
    const supportLabel = message.supportPoints ? ` [support +${message.supportPoints.toFixed(1)}]` : "";
    console.log(`[${new Date(message.timestamp).toISOString()}] ${message.user}: ${message.text}${supportLabel}`);
    this.handler(message);
  }

  async connect() {
    const safeChannel = this.channel.replace(/^#/, "").toLowerCase();
    await mkdir("logs", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = join("logs", `${safeChannel}-${date}.jsonl`);
    const client = new tmi.Client({ options: { debug: false }, connection: { reconnect: true, secure: true }, channels: [safeChannel] });
    this.client = client;
    client.on("message", (_channel, tags, text, self) => {
      if (!self) void this.receive(safeChannel, tags, text);
    });
    client.on("raided", (channel, username, viewers) => {
      void this.receive(safeChannel, {
        "msg-id": "raid", username, "msg-param-viewerCount": String(viewers)
      }, "", { event: "raid" });
    });

    // USERNOTICE events are separate from ordinary PRIVMSG chat messages.
    client.on("subscription", (channel, username, methods, message, userstate) => {
      void this.receive(safeChannel, { ...userstate, username, "msg-id": "sub" }, message ?? "", { event: "sub" });
    });
    client.on("resub", (channel, username, months, message, userstate) => {
      void this.receive(safeChannel, { ...userstate, username, "msg-id": "resub", "msg-param-cumulative-months": String(months) }, message ?? "", { event: "resub" });
    });
    client.on("subgift", (channel, username, streakMonths, recipient, methods, userstate) => {
      void this.receive(safeChannel, { ...userstate, username, "msg-id": "subgift", "msg-param-recipient-name": recipient }, "", { event: "subgift" });
    });
    client.on("submysterygift", (channel, username, numberOfSubs, methods, userstate) => {
      void this.receive(safeChannel, { ...userstate, username, "msg-id": "submysterygift", "msg-param-mass-gift-count": String(numberOfSubs) }, "", { event: "submysterygift", giftCount: numberOfSubs });
    });
    client.on("giftpaidupgrade", (channel, username, gifter, userstate) => {
      void this.receive(safeChannel, { ...userstate, username, "msg-id": "giftpaidupgrade" }, "", { event: "giftpaidupgrade" });
    });
    client.on("anongiftpaidupgrade", (channel, username, userstate) => {
      void this.receive(safeChannel, { ...userstate, username: username ?? "anonymous", "msg-id": "anongiftpaidupgrade" }, "", { event: "anongiftpaidupgrade" });
    });
    await client.connect();
    console.log(`Connected to #${safeChannel}; logging to ${this.logFile}`);
  }
  async close() { await this.client?.disconnect(); }
}
