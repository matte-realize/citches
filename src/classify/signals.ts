import { config } from "../config.js";
import type { Category, ChatMessage } from "../types.js";
import { readSlang } from "../score/slang.js";

export interface MessageSignal {
  eligible: boolean;
  positive: boolean;
  complexity: number;
  supportPoints: number;
}

export function analyzeMessage(message: ChatMessage, category: Category): MessageSignal {
  const supportPoints = Math.max(0, Number(message.supportPoints ?? 0));
  const words = message.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (!words.length || (category !== "COMMENT" && category !== "QUESTION")) {
    return { eligible: false, positive: false, complexity: 0, supportPoints };
  }
  const uniqueRatio = new Set(words).size / words.length;
  const lengthScore = Math.min(words.length / 14, 1);
  const sentences = message.text.split(/[.!?]+/).filter(part => part.trim().length > 0).length;
  const structureScore = Math.min(Math.max(0, sentences - 1) / 2, 1);
  const complexity = Math.min(1, lengthScore * 0.48 + uniqueRatio * 0.34 + structureScore * 0.18);
  const lower = message.text.toLowerCase();
  const slang = readSlang(message.text);
  const positive = slang.hype + slang.love > 0 || config.positiveKeywords.some(keyword => {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, "u").test(lower);
  });
  return { eligible: true, positive, complexity, supportPoints };
}
