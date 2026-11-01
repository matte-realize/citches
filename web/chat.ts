import { Aggregator } from "../src/aggregate/aggregator.js";
import { EventMapper } from "../src/events/mapper.js";
import type { MapperState } from "../src/events/mapper.js";
import { normalizeTwitchMessage } from "../src/ingest/normalize.js";
import type { ChatMessage, SimEvent } from "../src/types.js";
import type { CityFeed, CityTick } from "./transport.js";

/** Parse one IRCv3 line from Twitch chat into tags, command and trailing text. */
export function parseIrcLine(line: string) {
  let rest = line;
  const tags: Record<string, any> = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    for (const pair of rest.slice(1, space).split(";")) {
      const eq = pair.indexOf("=");
      const key = eq < 0 ? pair : pair.slice(0, eq);
      const raw = eq < 0 ? "" : pair.slice(eq + 1);
      tags[key] = raw.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\").replace(/\\r/g, "\r").replace(/\\n/g, "\n");
    }
    rest = rest.slice(space + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) { const space = rest.indexOf(" "); prefix = rest.slice(1, space); rest = rest.slice(space + 1); }
  const trailingAt = rest.indexOf(" :");
  const head = trailingAt >= 0 ? rest.slice(0, trailingAt) : rest;
  const text = trailingAt >= 0 ? rest.slice(trailingAt + 2) : "";
  const [command, ...params] = head.split(" ");
  // emotes arrive as "25:0-4,12-16/1902:6-10"; the normalizer expects { id: [ranges] }.
  if (typeof tags.emotes === "string") {
    const emotes: Record<string, string[]> = {};
    for (const part of tags.emotes.split("/").filter(Boolean)) { const [id, ranges = ""] = part.split(":"); emotes[id] = ranges.split(",").filter(Boolean); }
    tags.emotes = emotes;
  }
  tags.username ??= tags.login ?? prefix.split("!")[0];
  return { tags, prefix, command, params, text };
}

/** Anonymous, read-only Twitch chat over the official IRC WebSocket. No login or backend needed. */
export class TwitchChatClient {
  private socket?: WebSocket;
  private closed = false;
  private retry = 1000;
  constructor(private channel: string, private onMessage: (message: ChatMessage) => void, private onStatus: (status: string) => void) {}

  connect() {
    const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 1000;
      socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      socket.send("PASS SCHMOOPIIE");
      socket.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      socket.send(`JOIN #${this.channel}`);
      this.onStatus(`READING #${this.channel.toUpperCase()}`);
    };
    socket.onmessage = event => {
      for (const line of String(event.data).split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) { socket.send("PONG :tmi.twitch.tv"); continue; }
        const { tags, command, text } = parseIrcLine(line);
        if (command === "PRIVMSG") this.onMessage(normalizeTwitchMessage(tags, text));
        else if (command === "USERNOTICE") this.onMessage(normalizeTwitchMessage(tags, text, Date.now(), { event: tags["msg-id"] }));
      }
    };
    socket.onclose = () => {
      if (this.closed) return;
      this.onStatus("RECONNECTING…");
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(30_000, this.retry * 2);
    };
  }

  close() { this.closed = true; this.socket?.close(); }
}

interface SavedCity { version: 1; mapper: MapperState; events: SimEvent[]; savedAt: number }
type StorageArea = { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
const extensionStorage = (): StorageArea | undefined => (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local;
const MAX_SAVED_EVENTS = 4000;

/**
 * Builds a city straight from a channel's live chat in the browser: chat -> scoring rules ->
 * events, the same pipeline the backend runs. Each channel's city is saved and resumed.
 */
export class TwitchChatFeed implements CityFeed {
  private client?: TwitchChatClient;
  private aggregator?: Aggregator;
  private saveTimer?: ReturnType<typeof setInterval>;
  private history: SimEvent[] = [];
  private mapper = new EventMapper();
  private dirty = false;
  constructor(private channel: string) {}

  private get key() { return `city:${this.channel}`; }

  private async load(): Promise<SavedCity | undefined> {
    try {
      const area = extensionStorage();
      const raw = area ? (await area.get(this.key))[this.key] : JSON.parse(localStorage.getItem(this.key) ?? "null");
      return raw && (raw as SavedCity).version === 1 ? raw as SavedCity : undefined;
    } catch { return undefined; }
  }

  private async save() {
    if (!this.dirty) return;
    this.dirty = false;
    // Keep every milestone, trim the oldest construction so storage stays small.
    if (this.history.length > MAX_SAVED_EVENTS) {
      const milestones = this.history.filter(event => event.type === "advancement");
      const rest = this.history.filter(event => event.type !== "advancement").slice(-(MAX_SAVED_EVENTS - milestones.length));
      this.history = [...milestones, ...rest];
    }
    const saved: SavedCity = { version: 1, mapper: this.mapper.exportState(), events: this.history, savedAt: Date.now() };
    try {
      const area = extensionStorage();
      if (area) await area.set({ [this.key]: saved });
      else localStorage.setItem(this.key, JSON.stringify(saved));
    } catch { /* storage full or unavailable: the city simply won't persist */ }
  }

  async start(onTick: (tick: CityTick) => void, onStatus: (status: string) => void) {
    const saved = await this.load();
    if (saved) {
      this.mapper.importState(saved.mapper);
      this.history = saved.events.filter(event => event.type !== "effect");
      // Time the city spent closed: gentle, capped wear, never to ruin.
      const away = this.mapper.timeAway(Date.now() - saved.savedAt);
      this.history.push(...away);
      if (away.length) this.dirty = true;
      onTick({ type: "tick", events: this.history, progress: this.mapper.progress, score: this.mapper.score, replay: true });
    }
    this.aggregator = new Aggregator((aggregate, delta, raidViewers, signals) => {
      const events = this.mapper.map(aggregate, delta, raidViewers, signals);
      for (const event of events) if (event.type !== "effect") { this.history.push(event); this.dirty = true; }
      if (signals.scoredMessages) this.dirty = true;
      onTick({ type: "tick", aggregate, events, progress: this.mapper.progress, score: this.mapper.score });
    });
    this.aggregator.start();
    this.client = new TwitchChatClient(this.channel, message => this.aggregator?.add(message), onStatus);
    this.client.connect();
    this.saveTimer = setInterval(() => void this.save(), 8000);
    addEventListener("pagehide", () => void this.save());
  }

  stop() {
    void this.save();
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.aggregator?.stop();
    this.client?.close();
  }
}
