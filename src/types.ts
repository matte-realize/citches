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
  | { type: "build"; kind: "house" | "landmark"; count: number }
  | { type: "effect"; kind: "fireworks"; intensity: number }
  | { type: "boom"; viewers: number }
  | { type: "disaster"; kind: "fire" | "meteor"; intensity: number; damageCount?: number; durationMs?: number };

export interface MessageSource {
  connect(): Promise<void>;
  onMessage(handler: (message: ChatMessage) => void): void;
  close(): Promise<void>;
}
