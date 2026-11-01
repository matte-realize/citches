import { config } from "../config.js";
import type { MessageSignal } from "../classify/signals.js";
import type { Category, ChatMessage } from "../types.js";
import { readSlang } from "./slang.js";
import type { SlangSummary } from "./slang.js";

/** One labelled reason a message moved the city score, e.g. { label: "HYPE", points: 1 }. */
export interface ScoreHit { rule: string; label: string; points: number }

export interface RuleInput {
  message: ChatMessage;
  category: Category;
  signal: MessageSignal;
  text: string;
  lower: string;
  words: string[];
  context: ScoreContext;
  slang: SlangSummary;
}

/**
 * A scoring rule returns a multiplier (0 = no hit). Points come from config so the whole
 * scoring economy can be retuned without touching rule code. Add a rule by appending here
 * and giving it a weight in `config.scoring.weights`.
 */
export interface ScoreRule { id: keyof typeof config.scoring.weights; label: string; silent?: boolean; test(input: RuleInput): number }

const keywordMatcher = (keywords: readonly string[], allowNegation = false) => {
  const escaped = keywords.filter(Boolean).map(word => word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return () => false;
  // "not bad" / "never boring" flip the meaning, so a negated keyword does not count.
  const negation = allowNegation ? "(?<!(?:not|never|isnt|isn't|aint|ain't|no)\\s)" : "";
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${negation}(?:${escaped.join("|")})(?:$|[^\\p{L}\\p{N}])`, "u");
  return (lower: string) => pattern.test(lower);
};

const isToxic = keywordMatcher(config.scoring.negativeKeywords, true);
const isHate = keywordMatcher(config.hateKeywords);
const isKind = keywordMatcher(config.scoring.kindKeywords);
const isHype = keywordMatcher(config.positiveKeywords);
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Short rolling memory used by rules that need more than one message (copypasta, floods). */
export class ScoreContext {
  private texts: Array<{ key: string; at: number }> = [];
  private users: Array<{ user: string; at: number }> = [];
  private now = Date.now();
  /** Times come from the messages themselves, so replays at any speed behave like live chat. */
  observe(message: ChatMessage, now = message.timestamp || Date.now()) {
    this.now = now;
    const horizon = now - config.scoring.memoryMs;
    this.texts = this.texts.filter(item => item.at >= horizon);
    this.users = this.users.filter(item => item.at >= horizon);
    const key = normalize(message.text);
    if (key.length >= config.scoring.copypastaMinLength) this.texts.push({ key, at: now });
    this.users.push({ user: message.user, at: now });
  }
  repeats(text: string) {
    const key = normalize(text);
    if (key.length < config.scoring.copypastaMinLength) return 0;
    return this.texts.filter(item => item.key === key).length;
  }
  userBurst(user: string, windowMs: number, now = this.now) {
    return this.users.filter(item => item.user === user && item.at >= now - windowMs).length;
  }
}

export const SCORE_RULES: ScoreRule[] = [
  // ---- pluses ----
  { id: "chat", label: "CHAT", silent: true, test: ({ signal }) => signal.eligible ? 1 : 0 },
  // A "W" (or WWWW, W W W) is a win: it counts once, however many times it is repeated.
  { id: "hype", label: "HYPE", test: ({ lower, signal, slang }) => signal.eligible && (slang.hype > 0 || isHype(lower)) ? 1 : 0 },
  { id: "laugh", label: "LOL", test: ({ slang }) => slang.laugh > 0 ? 1 : 0 },
  { id: "kindness", label: "KINDNESS", test: ({ lower, signal, slang }) => signal.eligible && (slang.love > 0 || isKind(lower)) ? 1 : 0 },
  { id: "bigBrain", label: "BIG BRAIN", test: ({ signal, text, context }) => signal.complexity >= config.scoring.bigBrainComplexity && context.repeats(text) < 2 ? 1 : 0 },
  { id: "curious", label: "CURIOUS", test: ({ category }) => category === "QUESTION" ? 1 : 0 },
  { id: "support", label: "SUPPORT", test: ({ signal }) => signal.supportPoints },
  // ---- minuses ----
  { id: "hate", label: "HATE", test: ({ lower }) => isHate(lower) ? 1 : 0 },
  { id: "toxic", label: "TOXIC", test: ({ lower, slang }) => slang.negative > 0 || isToxic(lower) ? 1 : 0 },
  { id: "spam", label: "SPAM", test: ({ category }) => category === "SPAM" ? 1 : 0 },
  {
    id: "shouting", label: "SHOUTING", test: ({ text, category }) => {
      if (category === "SPAM" || readSlang(text).positiveOnly) return 0; // "WWWWWWWWWW" is cheering, not shouting
      const letters = text.replace(/[^\p{L}]/gu, "");
      if (letters.length < config.scoring.shoutMinLetters) return 0;
      const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
      return upper / letters.length >= config.scoring.shoutRatio ? 1 : 0;
    }
  },
  { id: "copypasta", label: "COPYPASTA", test: ({ text, context }) => context.repeats(text) >= config.scoring.copypastaRepeats ? 1 : 0 },
  { id: "flood", label: "FLOOD", test: ({ message, context }) => context.userBurst(message.user, config.scoring.floodWindowMs) >= config.scoring.floodMessages ? 1 : 0 },
  { id: "lowEffort", label: "MEH", test: ({ words, lower, category, slang }) => category !== "SPAM" && slang.tokens <= 1 && !slang.allSlang && !slang.laugh && words.length <= 1 && lower.replace(/[^\p{L}\p{N}]/gu, "").length === 1 && !isHype(lower) ? 1 : 0 }
];

export function scoreMessage(message: ChatMessage, category: Category, signal: MessageSignal, context: ScoreContext): ScoreHit[] {
  const text = message.text.trim();
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}']+/gu) ?? [];
  context.observe(message);
  const input: RuleInput = { message, category, signal, text, lower, words, context, slang: readSlang(text) };
  const hits: ScoreHit[] = [];
  for (const rule of SCORE_RULES) {
    const amount = rule.test(input);
    if (!amount) continue;
    hits.push({ rule: rule.id, label: rule.silent ? "" : rule.label, points: amount * config.scoring.weights[rule.id] });
  }
  // Pasted text earns no pluses, however nice it sounds.
  if (hits.some(hit => hit.rule === "copypasta")) return hits.filter(hit => hit.points < 0 || hit.rule === "chat");
  return hits;
}
