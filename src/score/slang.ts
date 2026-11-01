/**
 * Twitch chat slang. Chat stretches and repeats words ("WWWW", "pogggg", "LOOOOL", "W W W"), so
 * tokens are matched by pattern rather than exact spelling. Classification checks this before its
 * spam rules, so a wall of W's counts as hype instead of spam.
 */
export type SlangKind = "hype" | "laugh" | "love" | "negative";

const PATTERNS: Array<[SlangKind, RegExp]> = [
  // Wins and hype
  ["hype", /^(w+|dub+|pog+(ger+s|champ|u|gies|o)?|lets+go+|letsgo+|lfg+|goat(ed)?|based|clutch|peak|cinema|banger|huge|insane|gg+(wp)?|ez+clap|hype+|pogchamp|poggers|letsgooo+|sheesh+|fire|bussin|elite|cracked|w[- ]?(streamer|chat|stream|play|take))$/i],
  // Laughter, including Japanese (ｗ / 草), Spanish (jaja), Portuguese (kkkk) and Korean (ㅋㅋ)
  ["laugh", /^(lo+l+|lmf?a+o+|rofl|kekw?|lul+w?|omegalul|xd+|(ha){2,}h?|(he){2,}|jaja+|(ja){2,}|k{3,}|ｗ+|草+|ㅋ{2,}|icant|💀+|😂+|🤣+)$/i],
  // Affection and respect
  ["love", /^(<3+|❤️*|❤+|💜+|o7|respect|wholesome|ily|ty+|tysm|thx|bless(ed)?|comfy|cozy|aww+|cute)$/i],
  // Classic chat negativity
  ["negative", /^(l+|ratio|mid|cringe|residentsleeper|boring|ff|trash|copium|clueless|pepega|weirdchamp|dansgame|wutface|yikes|flop|fell ?off|washed|bozo)$/i]
];

export function slangOf(token: string): SlangKind | undefined {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(token)) return kind;
  return undefined;
}

export interface SlangSummary { tokens: number; hype: number; laugh: number; love: number; negative: number; allSlang: boolean; positiveOnly: boolean }

/** Count slang in a message; `positiveOnly` means every token is hype, laughter or love. */
export function readSlang(text: string): SlangSummary {
  const tokens = text.trim().split(/\s+/).filter(Boolean).map(token => token.replace(/^[^\p{L}\p{N}<❤💜💀😂🤣ｗ草ㅋ]+|[^\p{L}\p{N}❤💜💀😂🤣ｗ草ㅋ3]+$/gu, "")).filter(Boolean);
  const summary: SlangSummary = { tokens: tokens.length, hype: 0, laugh: 0, love: 0, negative: 0, allSlang: tokens.length > 0, positiveOnly: tokens.length > 0 };
  const negations = new Set(["not", "never", "isnt", "isn't", "aint", "ain't", "no", "wasnt", "wasn't"]);
  for (const [index, token] of tokens.entries()) {
    let kind = slangOf(token);
    // "not mid", "never boring": a negated insult is a compliment.
    if (kind === "negative" && index > 0 && negations.has(tokens[index - 1].toLowerCase())) kind = "love";
    if (!kind) { summary.allSlang = false; summary.positiveOnly = false; continue; }
    summary[kind]++;
    if (kind === "negative") summary.positiveOnly = false;
  }
  // Multi-word hype phrases: "LETS GOOOO", "W streamer", "gg wp", "ez clap".
  const phrase = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(let'?s go+o*|lets go+o*|w (streamer|chat|stream|play|take|rizz)|gg wp|ez clap|no way+|big w|huge w|massive w)!*$/i.test(phrase)) {
    summary.hype = Math.max(1, summary.hype);
    summary.allSlang = true;
    summary.positiveOnly = summary.negative === 0;
  }
  // Japanese chat often attaches ｗ to the end of a sentence: "言ってたｗｗ" is a laugh too.
  if (!summary.laugh && /[ｗ草]{1,}$|(?<=[^\x00-\x7F])w{2,}$/u.test(text.trim())) summary.laugh = 1;
  return summary;
}
