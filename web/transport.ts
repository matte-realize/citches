import { Aggregator } from "../src/aggregate/aggregator.js";
import { EventMapper } from "../src/events/mapper.js";
import type { Aggregate, ChatMessage, CommunityProgress, ScoreSnapshot, SimEvent } from "../src/types.js";

export interface CityTick { type: "tick"; aggregate?: Aggregate; events: SimEvent[]; progress?: CommunityProgress; score?: ScoreSnapshot; replay?: boolean }
export interface CityFeed { start(onTick: (tick: CityTick) => void, onStatus: (status: string) => void): void; stop(): void }

/** Local backend (npm run live / replay) over WebSocket. */
export class WebSocketFeed implements CityFeed {
  private socket?: WebSocket;
  constructor(private url: string) {}
  start(onTick: (tick: CityTick) => void, onStatus: (status: string) => void) {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => onStatus("CONNECTED");
    socket.onmessage = message => {
      const data = JSON.parse(message.data);
      if (data.type === "tick") onTick(data);
    };
    socket.onclose = () => onStatus("OFFLINE · TRY ?demo=1");
  }
  stop() { this.socket?.close(); }
}

type TwitchExt = {
  onAuthorized(callback: (auth: { channelId: string; token: string }) => void): void;
  listen(target: string, callback: (target: string, contentType: string, message: string) => void): void;
  configuration: { broadcaster?: { content: string }; onChanged(callback: () => void): void; set(segment: "broadcaster", version: string, content: string): void };
};

/** Settings only the broadcaster can change, stored in Twitch's extension configuration service. */
export interface BroadcasterConfig { theme?: string; corner?: "br" | "bl"; size?: "small" | "medium" | "large"; ebsUrl?: string }

export function readBroadcasterConfig(): BroadcasterConfig {
  try { return JSON.parse(window.Twitch?.ext.configuration.broadcaster?.content ?? "{}") as BroadcasterConfig; } catch { return {}; }
}

/** Resolves once Twitch has delivered the configuration (or after a short timeout). */
export function waitForBroadcasterConfig(timeoutMs = 2500): Promise<BroadcasterConfig> {
  const ext = window.Twitch?.ext;
  if (!ext) return Promise.resolve({});
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(readBroadcasterConfig()); } };
    ext.configuration.onChanged(finish);
    setTimeout(finish, timeoutMs);
  });
}
declare global { interface Window { Twitch?: { ext: TwitchExt } } }

/**
 * Twitch Extension overlay: the backend publishes batched ticks over Extension PubSub
 * (see src/twitch/extension.ts). On load, the overlay fetches /snapshot from the backend
 * (EBS) so late viewers see the same city as everyone else.
 */
export class TwitchExtensionFeed implements CityFeed {
  constructor(private ebsUrl?: string) {}
  static available() { return Boolean(window.Twitch?.ext); }
  start(onTick: (tick: CityTick) => void, onStatus: (status: string) => void) {
    const ext = window.Twitch!.ext;
    let snapshotLoaded = false;
    const ebs = () => this.ebsUrl ?? readBroadcasterConfig().ebsUrl;
    ext.onAuthorized(async auth => {
      onStatus("LIVE ON TWITCH");
      const base = ebs();
      if (snapshotLoaded || !base) return;
      snapshotLoaded = true;
      try {
        const response = await fetch(`${base.replace(/\/$/, "")}/snapshot`, { headers: { Authorization: `Bearer ${auth.token}` } });
        const snapshot = await response.json() as { history: Array<{ events: SimEvent[] }>; latest?: CityTick };
        for (const tick of snapshot.history) onTick({ type: "tick", events: tick.events, replay: true });
        if (snapshot.latest) onTick({ ...snapshot.latest, events: [], replay: true });
      } catch { onStatus("LIVE · NO SNAPSHOT"); }
    });
    ext.listen("broadcast", (_target, _type, message) => {
      try { const tick = JSON.parse(message); if (tick.type === "tick") onTick(tick); } catch { /* ignore malformed */ }
    });
  }
  stop() {}
}

const WHOLESOME = [
  "gg that was such a good play", "love this community so much", "thanks for streaming today, this is great", "that was awesome!!",
  "pog", "W streamer", "this build is honestly beautiful", "congrats on the win, well deserved", "lets gooo hype",
  "I think the left route would work better because the enemy rotates late and you get the high ground first.",
  "Really proud of how far this city has come. The new district looks fantastic.", "thank you for the tips earlier, they helped a lot",
  "what's the plan for the next era?", "how did you learn to play like that?", "is this the final level?", "nice", "respect", "wp", "<3 <3"
];
const TROLLS = [
  "THIS IS SO BORING WAKE UP", "trash gameplay", "L", "L L L", "ratio", "cringe", "mid", "skill issue", "ResidentSleeper ResidentSleeper ResidentSleeper",
  "SPAM SPAM SPAM SPAM", "ff", "uninstall", "LMAOOOOOOOO", "WHY IS NOTHING HAPPENING", "copium", "worst stream ever"
];
const OPENERS = ["", "ok ", "yo ", "honestly ", "chat ", "wow ", "omg ", "bro "];
const CLOSERS = ["", " fr", " today", " lol", " again", " right now", " chat", " :)"];
/** Vary wholesome lines so ordinary chat is not mistaken for copypasta. */
const varied = (text: string) => `${OPENERS[Math.floor(Math.random() * OPENERS.length)]}${text}${CLOSERS[Math.floor(Math.random() * CLOSERS.length)]}`;
const PASTA = "this city is fake and the mayor is a cardboard cutout";

/** Browser-only demo: simulated chat through the real aggregator and scoring rules. */
export class DemoFeed implements CityFeed {
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private aggregator?: Aggregator;
  constructor(private speed = 1) {}
  start(onTick: (tick: CityTick) => void, onStatus: (status: string) => void) {
    onStatus("DEMO CHAT");
    const mapper = new EventMapper();
    this.aggregator = new Aggregator((aggregate, delta, raidViewers, signals) => {
      const events = mapper.map(aggregate, delta, raidViewers, signals);
      onTick({ type: "tick", aggregate, events, progress: mapper.progress, score: mapper.score });
    });
    this.aggregator.start();
    const started = Date.now();
    const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const send = (text: string, user = `viewer${Math.floor(Math.random() * 400)}`, extra: Partial<ChatMessage> = {}) =>
      this.aggregator?.add({ timestamp: Date.now(), user, text, emotes: [], isRaid: false, raidViewerCount: 0, ...extra });
    this.timers.push(setInterval(() => {
      // Every ~75 s a troll wave rolls through for ~16 s, enough to fill the danger meter.
      const cycle = ((Date.now() - started) / 1000 * this.speed) % 75;
      const trolling = cycle > 55 && cycle < 71;
      const burst = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < burst; i++) {
        if (trolling && Math.random() < 0.78) {
          const roll = Math.random();
          if (roll < 0.2) send(PASTA);
          else if (roll < 0.35) send(pick(TROLLS), "spammer42");
          else send(pick(TROLLS));
        } else send(varied(pick(WHOLESOME)));
      }
      if (Math.random() < 0.012) send("", "supporter", { supportPoints: 2.5 });
      if (Math.random() < 0.003) send("", "raider", { isRaid: true, raidViewerCount: 60 + Math.floor(Math.random() * 200) });
    }, Math.max(40, 140 / this.speed)));
  }
  stop() { this.timers.forEach(clearInterval); this.aggregator?.stop(); }
}
