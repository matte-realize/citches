import { config } from "../config.js";
import type { Category, ChatMessage } from "../types.js";

const questionStart = /^(who|what|why|how|when|where|is|are|can|do|does)\b/i;
export function classify(message: ChatMessage): Category {
  if (message.isRaid) return "RAID";
  const text = message.text.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const emoteRatio = words.length ? (message.emotes.length + words.filter(w => /^:[^:]+:$/.test(w)).length) / words.length : 0;
  const repeated = /(.)\1{4,}/i.test(text) || /\b(\w{1,4})(?:\s+\1){2,}\b/i.test(text);
  if (emoteRatio >= config.spam.emoteRatio || repeated || (text.length <= config.spam.maxShortMessageLength && words.length >= config.spam.shortRepeatMinimum)) return "SPAM";
  if (text.includes("?") || questionStart.test(text)) return "QUESTION";
  const lower = text.toLowerCase();
  if (config.hateKeywords.some(word => word && lower.includes(word.toLowerCase()))) return "HATE";
  return "COMMENT";
}
