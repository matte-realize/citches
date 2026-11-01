export interface ChatMessage {
  timestamp: number;
  user: string;
  text: string;
  emotes: string[];
  isRaid: boolean;
  raidViewerCount: number;
  supportPoints?: number;
}

export type Category = "RAID" | "SPAM" | "QUESTION" | "HATE" | "COMMENT";
export interface Counts { RAID: number; SPAM: number; QUESTION: number; HATE: number; COMMENT: number }
export interface Aggregate { timestamp: number; counts: Counts; messagesPerSecond: number; raidViewers: number; supportPoints: number }
export interface CommunityProgress {
  technology: { era: number; name: string; current: number; goal: number; ratio: number };
  recovery: { active: boolean; era: number; current: number; goal: number; ratio: number };
}
export type SimEvent =
  | { type: "advancement"; era: number; name: string }
  | { type: "build"; kind: "house" | "landmark"; count: number; builders?: string[] }
  | { type: "effect"; kind: "fireworks"; intensity: number }
  | { type: "boom"; viewers: number }
  /** Quiet chat wears one building down a step; positive chat repairs the most worn one. */
  | { type: "decay"; count: number }
  | { type: "repair"; count: number }
  | { type: "disaster"; kind: AttackKind; intensity: number; damageCount?: number; durationMs?: number; reason?: string };

export type AttackKind = "fire" | "meteor" | "storm" | "swarm";
export interface ScorePop { label: string; points: number }
/** Running city score shown in the overlay: total points, danger meter, and labelled pops for this tick. */
export interface ChatHighlight { user: string; text: string }
export interface ScoreSnapshot {
  total: number; gained: number; lost: number; threat: number; threatRatio: number; pops: ScorePop[];
  /** Chatters who have earned the city the most points this session. */
  topBuilders?: Array<{ name: string; points: number }>;
  /** The most wholesome message of this tick, for villagers to say out loud. */
  highlight?: ChatHighlight;
  /** Whether the city is currently wearing down from quiet chat, being repaired, or steady. */
  upkeep?: "decaying" | "repairing" | "steady";
}

export interface MessageSource {
  connect(): Promise<void>;
  onMessage(handler: (message: ChatMessage) => void): void;
  close(): Promise<void>;
}
