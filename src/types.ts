export interface ChatMessage {
  timestamp: number;
  user: string;
  text: string;
  emotes: string[];
  isRaid: boolean;
  raidViewerCount: number;
}

export type Category = "RAID" | "SPAM" | "QUESTION" | "HATE" | "COMMENT";
export interface Counts { RAID: number; SPAM: number; QUESTION: number; HATE: number; COMMENT: number }
export interface Aggregate { timestamp: number; counts: Counts; messagesPerSecond: number; raidViewers: number }
export type SimEvent =
  | { type: "build"; kind: "house" | "landmark"; count: number }
  | { type: "effect"; kind: "fireworks"; intensity: number }
  | { type: "boom"; viewers: number }
  | { type: "disaster"; kind: "fire" | "meteor"; intensity: number };

export interface MessageSource {
  connect(): Promise<void>;
  onMessage(handler: (message: ChatMessage) => void): void;
  close(): Promise<void>;
}
