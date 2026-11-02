import { config } from "../config.js";
import type { Category, ChatMessage } from "../types.js";
import { readSlang } from "../score/slang.js";
import { isHateful } from "../moderation/censor.js";

const questionStart = /^(who|what|why|how|when|where|is|are|can|do|does)\b/i;
export function classify(message: ChatMessage): Category {
  if (message.isRaid) return "RAID";
  const text = message.text.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  if (isHateful(text) || config.hateKeywords.some(word => word && lower.includes(word.toLowerCase()))) return "HATE";
  // "W", "W W W", "POGGGG", "KEKW KEKW": all-positive slang is enthusiasm, not spam.
  if (readSlang(text).positiveOnly) return "COMMENT";
  // Fast chats are mostly short reactions ("LUL", "noooo", "no no no"). Only real floods count as
  // spam: a wall of emotes, one character held for ages, or one word hammered over and over.
  const spam = config.spam;
  const emoteCount = message.emotes.length + words.filter(w => /^:[^:]+:$/.test(w)).length;
  const emoteWall = emoteCount >= spam.emoteWallMinimum && emoteCount / Math.max(1, words.length) >= spam.emoteRatio;
  const characterFlood = new RegExp(`(.)\\1{${spam.repeatedCharacterLength - 1},}`, "u").test(text);
  const wordHammer = new RegExp(`\\b(\\w{1,6})(?:\\s+\\1){${spam.repeatedWordMinimum - 1},}\\b`, "iu").test(text);
  if (emoteWall || characterFlood || wordHammer) return "SPAM";
  if (text.includes("?") || questionStart.test(text)) return "QUESTION";
  return "COMMENT";
}
