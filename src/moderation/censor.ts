/**
 * Chat moderation shared by the backend, the in-browser demo and the extension.
 *
 * Two tiers:
 * - SEVERE terms (slurs, hate slogans, self-harm harassment) make a message hateful: it is scored
 *   as hate, never shown on screen, and a username containing one is never displayed.
 * - PROFANITY is ordinary Twitch swearing: it is not penalised, but it is masked on screen, and
 *   villagers never repeat a message that needed masking.
 *
 * Matching runs on a normalised copy of the text (accents stripped, leetspeak folded, zero-width
 * characters removed) and lets every letter repeat and be split by punctuation ("f.u.u.c.k"),
 * while word boundaries keep innocent words ("class", "Scunthorpe", "Niger") safe.
 */

type Mode = "word" | "stem" | "any";
interface Term { letters: string; mode: Mode }

const term = (spec: string): Term => {
  // "=word" must be the whole word (plurals allowed), "^stem" starts a word, plain matches anywhere.
  if (spec.startsWith("=")) return { letters: spec.slice(1), mode: "word" };
  if (spec.startsWith("^")) return { letters: spec.slice(1), mode: "stem" };
  return { letters: spec, mode: "any" };
};

/** Slurs and hate. Kept as stems so variants and plurals are caught. */
const SEVERE = [
  "nigger", "nigga", "^nigg", "=niglet", "=chink", "=spic", "=wetback", "=kike", "=gook", "=coon", "=beaner",
  "=raghead", "=towelhead", "=sandnigger", "=tranny", "=trannies", "^faggot", "=fag", "=dyke",
  "=kys", "killyourself", "kilyourself", "heilhitler", "siegheil", "=1488", "whitepower", "gasthejews",
  "=paki", "=golliwog", "=jigaboo", "=porchmonkey", "=junglebunny", "=shemale", "=rape", "=raping", "^rapist"
].map(term);

/** Insults never shown on screen and scored as toxic chat, but not as full hate. */
const TOXIC = ["^retard", "=tard", "=autist", "=spaz", "=mong"].map(term);

/** Everyday swearing: masked on screen, never scored as hate. */
const PROFANITY = [
  "^fuck", "^fuk", "=fck", "=fk", "=shit", "^shitt", "=shithead", "bullshit", "horseshit", "=sh1t", "^bitch", "^cunt", "=dick", "=dicks", "=dickhead", "=cock", "=cocks", "^cocksuck",
  "^puss", "^asshole", "=ass", "=arse", "^bastard", "^slut", "^whore", "^wank", "=twat", "=prick", "^bollock",
  "=piss", "=pissed", "=cum", "^porn", "=nudes", "=boobs", "=tits", "=titties", "=stfu", "=wtf", "=milf", "=thot",
  "^jizz", "=hoe", "=hoes", "^horny", "^blowjob", "=bj", "^dildo", "^penis", "^vagina"
].map(term);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e", "£": "l" };
const LEET_KEEP_DIGITS = new Set(["1488"]);

/** Normalised text plus, for each normalised character, its index in the original. */
function normalise(text: string, keepDigits = false) {
  let out = "";
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const original = text[i];
    const folded = original.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const char of folded) {
      if (/[​-‍⁠﻿­]/.test(char)) continue;
      out += !keepDigits && LEET[char] ? LEET[char] : char;
      index.push(i);
    }
  }
  return { out, index };
}

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Each letter may repeat and be split by a little punctuation; `spaced` also allows spaces. */
function pattern(t: Term, spaced: boolean) {
  // Long phrases ("heil hitler") are matched across spaces even in strict mode.
  const gap = spaced || t.letters.length >= 8 ? "[^a-z0-9]{0,2}" : "[^a-z0-9\\s]{0,2}";
  const body = [...t.letters].map(char => `${escape(char)}+`).join(gap);
  const before = t.mode === "any" ? "" : "(?<![a-z])";
  const after = t.mode === "word" ? "(?:e?s|z)?(?![a-z])" : "";
  return new RegExp(`${before}${body}${after}`, "g");
}

const compile = (terms: Term[], spaced: boolean) => terms.map(t => ({ t, re: pattern(t, spaced), digits: /\d/.test(t.letters) }));
const SEVERE_STRICT = compile(SEVERE, false);
const TOXIC_STRICT = compile(TOXIC, false);
const BLOCKED_SPACED = compile([...SEVERE, ...TOXIC], true);
const PROFANITY_SPACED = compile(PROFANITY, true);

function spans(text: string, compiled: ReturnType<typeof compile>) {
  const plain = normalise(text);
  const digits = normalise(text, true);
  const found: Array<[number, number]> = [];
  for (const { t, re, digits: numeric } of compiled) {
    const source = numeric && LEET_KEEP_DIGITS.has(t.letters) ? digits : plain;
    re.lastIndex = 0;
    for (const match of source.out.matchAll(re)) {
      const start = source.index[match.index!];
      const end = source.index[match.index! + match[0].length - 1] + 1;
      found.push([start, end]);
    }
  }
  return found;
}

/** A toxic insult that is hidden from screen and scored like toxic chat. */
export function isToxicSlur(text: string) {
  return spans(text, TOXIC_STRICT).length > 0;
}

/** Hateful: slurs, hate slogans or self-harm harassment, strictly matched (no spaced-out letters). */
export function isHateful(text: string) {
  return spans(text, SEVERE_STRICT).length > 0;
}

export interface Moderated {
  /** Text safe to show, with swearing masked. */
  text: string;
  /** Contains a slur or hate: never show it at all. */
  blocked: boolean;
  /** Anything was masked (or a link/handle removed). */
  masked: boolean;
}

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|gg|tv|io|ly|me|xyz|ru|co)(?:\/\S*)?/gi;

/** Make chat safe to put on screen. */
export function moderate(text: string): Moderated {
  if (spans(text, BLOCKED_SPACED).length) return { text: "", blocked: true, masked: true };
  const mask = new Array(text.length).fill(false);
  for (const [start, end] of spans(text, PROFANITY_SPACED)) for (let i = start; i < end; i++) if (/\S/.test(text[i])) mask[i] = true;
  let masked = mask.some(Boolean);
  let out = "";
  for (let i = 0; i < text.length; i++) out += mask[i] ? (/[a-z0-9]/i.test(text[i]) ? "*" : text[i]) : text[i];
  const unlinked = out.replace(LINK, "[link]");
  if (unlinked !== out) masked = true;
  return { text: unlinked, blocked: false, masked };
}

/** A username fit for the screen, or a neutral stand-in when it contains a slur or swearing. */
export function displayName(name: string, fallback = "a neighbour") {
  if (!name) return fallback;
  if (spans(name, BLOCKED_SPACED).length) return fallback;
  return moderate(name).masked ? fallback : name;
}
