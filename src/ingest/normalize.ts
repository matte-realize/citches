import { config } from "../config.js";
import type { ChatMessage } from "../types.js";

export interface NormalizeOverrides { event?: string; giftCount?: number }

function normalizeEmotes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (!raw || typeof raw !== "object") return [];
  const emotes: string[] = [];
  for (const [id, ranges] of Object.entries(raw as Record<string, unknown>)) {
    const occurrences = Array.isArray(ranges) ? ranges.length : String(ranges ?? "").split(",").filter(Boolean).length;
    for (let i = 0; i < occurrences; i++) emotes.push(id);
  }
  return emotes;
}

function supportValue(tags: Record<string, any>, override?: NormalizeOverrides): number {
  const nativePoints = Number(tags.bits ?? 0) / config.support.bitsPerPoint;
  if (nativePoints > 0) return nativePoints;
  const kind = override?.event ?? tags["msg-id"] ?? "";
  if (["sub", "resub", "subscription"].includes(kind)) return config.support.subscriptionPoints;
  if (["subgift", "anonsubgift", "giftpaidupgrade", "anongiftpaidupgrade"].includes(kind)) return config.support.giftPoints;
  if (["submysterygift", "anonsubmysterygift"].includes(kind)) {
    const count = override?.giftCount ?? Number(tags["msg-param-mass-gift-count"] ?? 1);
    return Math.max(1, count) * config.support.mysteryGiftPointsPerSub;
  }
  return 0;
}

export function normalizeTwitchMessage(
  tags: Record<string, any>, text: string,
  fallbackTimestamp = Date.now(), overrides?: NormalizeOverrides
): ChatMessage {
  return {
    timestamp: Number(tags["tmi-sent-ts"] ?? fallbackTimestamp),
    user: tags.username ?? tags.login ?? tags["display-name"] ?? "anonymous",
    text,
    emotes: normalizeEmotes(tags.emotes),
    isRaid: (overrides?.event ?? tags["msg-id"]) === "raid",
    raidViewerCount: Number(tags["msg-param-viewerCount"] ?? 0),
    supportPoints: supportValue(tags, overrides)
  };
}
