export interface ChatMessage {
  timestamp: number;
  user: string;
  text: string;
  emotes: string[];
  isRaid: boolean;
  raidViewerCount: number;
  supportPoints?: number;
  /** The chatter's Twitch name colour, used for the flag on their home. */
  color?: string;
}

export type Category = "RAID" | "SPAM" | "QUESTION" | "HATE" | "COMMENT";
export interface Counts { RAID: number; SPAM: number; QUESTION: number; HATE: number; COMMENT: number }
export interface Aggregate { timestamp: number; counts: Counts; messagesPerSecond: number; raidViewers: number; supportPoints: number }
export interface CommunityProgress {
  technology: { era: number; name: string; current: number; goal: number; ratio: number };
  recovery: { active: boolean; era: number; current: number; goal: number; ratio: number };
  /** Buildings knocked down and not yet rebuilt; new construction waits until they are. */
  repair: { ruins: number; ratio: number };
}
export type SimEvent =
  | { type: "advancement"; era: number; name: string }
  /** Technology fell back below a milestone: the city drops to `era` (named `name`). */
  | { type: "regression"; era: number; name: string }
  | { type: "build"; kind: "house" | "landmark"; count: number; builders?: string[] }
  | { type: "effect"; kind: "fireworks"; intensity: number }
  | { type: "boom"; viewers: number }
  /** Quiet chat wears one building down a step; positive chat repairs the most worn one. */
  /** `gentle` wear happens while the city sleeps and never takes a building past "shabby". */
  | { type: "decay"; count: number; gentle?: boolean }
  /** The story moves on: an endless sequence of chapters named after what the community did. */
  | { type: "chapter"; number: number; title: string; day: number; hero?: string }
  /** The community came back after a long break: repairs are half price for a while. */
  | { type: "welcome"; awayHours: number }
  | { type: "repair"; count: number; by?: string }
  /** Chat rebuilds buildings an attack knocked down, on their rubble, before building anything new. */
  | { type: "rebuild"; count: number; builders?: string[] }
  /** A chat command: `ok` is false when the chatter could not afford it (`cost`) or it did nothing. */
  | { type: "command"; command: ChatCommand; user: string; ok: boolean; cost?: number; reason?: string }
  /** A home owner came back or kept contributing, so their home grows a level (1-3). */
  | { type: "homeUpgrade"; owner: string; level: number; color?: string }
  /** The community capitol grew a stage; its top donors get banners. */
  | { type: "capitol"; stage: number; donors: CapitolDonor[] }
  | { type: "disaster"; kind: AttackKind; intensity: number; damageCount?: number; durationMs?: number; reason?: string; natural?: boolean; severity?: number }
  /** Offline: a household packs up and leaves; back online, chat brings families home. */
  | { type: "moveOut"; count: number }
  | { type: "moveIn"; count: number };

/**
 * Chat-caused attacks (fire, meteor, storm, swarm) and natural disasters that strike for no
 * reason at all. The later ones only appear once the city reaches the Kardashev eras.
 */
export type AttackKind = "fire" | "meteor" | "storm" | "swarm"
  | "quake" | "flood" | "tornado"
  | "flare" | "asteroid" | "drones"
  | "gamma" | "blackhole";
export type ChatCommand = "plant" | "repair" | "cheer" | "home" | "donate";
export interface CapitolDonor { name: string; points: number; color?: string }
/** Progress of the community capitol: stage 0 is the bare campfire, 5 the Grand Capitol. */
export interface CapitolProgress { stage: number; current: number; goal: number; lockedUntilEra?: number }
export interface ScorePop { label: string; points: number }
/** Running city score shown in the overlay: total points, danger meter, and labelled pops for this tick. */
export interface ChatHighlight { user: string; text: string }
export interface ScoreSnapshot {
  total: number; gained: number; lost: number; threat: number; threatRatio: number; pops: ScorePop[];
  /** Chatters who have earned the city the most points this session. */
  topBuilders?: Array<{ name: string; points: number }>;
  /** Chatters who backed the stream with bits, subs and gifts, by support points. */
  topSupporters?: Array<{ name: string; points: number }>;
  /** Biggest !donate patrons of the capitol. */
  topPatrons?: Array<{ name: string; points: number }>;
  /** The meter is full and an attack is massing: milliseconds until it strikes. */
  incomingMs?: number;
  /** Running totals since the city was founded (never a rate). */
  activity?: { messages: number; counts: Counts; chatters: number };
  /** The most wholesome message of this tick, for villagers to say out loud. */
  highlight?: ChatHighlight;
  /** Whether the city is currently wearing down from quiet chat, being repaired, or steady. */
  upkeep?: "decaying" | "repairing" | "steady";
  capitol?: CapitolProgress;
  /** How representative the current crowd is, and whether a marathon session is tiring growth. */
  community?: { chatters: number; multiplier: number; tired: boolean };
  story?: { day: number; chapter: number; title?: string; next: number; goal: number };
}
export interface ChronicleEntry { number: number; title: string; day: number; hero?: string }

export interface MessageSource {
  connect(): Promise<void>;
  onMessage(handler: (message: ChatMessage) => void): void;
  close(): Promise<void>;
}
