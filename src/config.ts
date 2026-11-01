// Browser-safe: the web demo runs this same scoring pipeline, where process.env does not exist.
const env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {};

export const config = {
  aggregateWindowMs: Number(env.AGGREGATE_WINDOW_MS ?? 5000),
  aggregateTickMs: Number(env.AGGREGATE_TICK_MS ?? 250),
  websocketPort: Number(env.WS_PORT ?? 8787),
  websocketHistoryLimit: Number(env.WS_HISTORY_LIMIT ?? 10000),
  hateKeywords: (env.HATE_KEYWORDS ?? "placeholder_hate_word").split(",").map(word => word.trim()).filter(Boolean),
  positiveKeywords: ["love", "great", "awesome", "amazing", "nice", "good", "gg", "thanks", "thank", "fun", "hype", "pog", "beautiful", "well done", "congrats", "proud", "excited"],
  /**
   * Every message runs through the rules in src/score/rules.ts. Each rule's hit is multiplied by
   * its weight here: positive weights are pluses, negative weights are minuses. Minuses build up
   * the city's threat meter; when it fills, the city is attacked.
   */
  scoring: {
    weights: {
      chat: 0.1, hype: 1, kindness: 1.4, bigBrain: 1.2, curious: 0.5, support: 4,
      hate: -6, toxic: -1.6, spam: -0.45, shouting: -0.6, copypasta: -0.8, flood: -0.6, lowEffort: -0.2
    },
    negativeKeywords: [
      "trash", "garbage", "boring", "cringe", "mid", "sucks", "suck", "worst", "stupid", "idiot", "dumb", "loser", "washed",
      "ratio", "l", "ff", "uninstall", "noob", "terrible", "awful", "ew", "stfu", "shut up", "dogshit", "lame", "bad", "hate",
      "residentsleeper", "notlikethis", "wutface", "dansgame", "copium", "skill issue"
    ],
    kindKeywords: ["thank you", "thanks", "ty", "appreciate", "welcome", "proud of", "you got this", "respect", "well played", "wp", "<3"],
    bigBrainComplexity: 0.55,
    shoutMinLetters: 10, shoutRatio: 0.75,
    copypastaMinLength: 12, copypastaRepeats: 3,
    floodWindowMs: 10_000, floodMessages: 4,
    memoryMs: 20_000
  },
  threat: {
    /**
     * Destruction mirrors construction: minus points fill the danger meter, and each time it
     * fills a building is knocked down, in paced pulses just like build pulses.
     */
    destroyThreshold: 4, maxDestroysPerPulse: 2, cooldownMs: 2600,
    decayPerSecond: 0.12, positiveDefense: 0.22,
    technologyPenalty: 0.35
  },
  spam: { emoteRatio: 0.6, repeatedCharacterLength: 5, maxShortMessageLength: 4, shortRepeatMinimum: 3 },
  events: {
    rateReference: 4, countMultiplier: 1, intensityMultiplier: 1,
    raidMinimumViewers: 1, disasterThreshold: 2, fireworksThreshold: 2.5, fireworksCooldownMs: 6000,
    destroyedBuildingsPerIntensity: 2.4, burnDurationMs: 3500
  },
  growth: {
    progressThreshold: 1.4, landmarkThreshold: 2.1,
    basePoints: 0.08, complexityMultiplier: 0.24, positivityMultiplier: 0.32,
    longevityMultiplier: 0.45, longevityMinutes: 30,
    buildCooldownMs: 2200, maxBuildsPerPulse: 3
  },
  technology: {
    milestones: [
      { name: "HUTS & GATHERING", points: 65 },
      { name: "SETTLED HOMES", points: 180 },
      { name: "STONE CITY", points: 360 },
      { name: "INDUSTRIAL CITY", points: 650 },
      { name: "AGE OF AIRSHIPS", points: 1000 },
      { name: "EMPIRE", points: 1450 }
    ],
    chatPoint: 0.12, complexityPoint: 0.42, positivityPoint: 0.7,
    supportPointMultiplier: 3.5
  },
  recovery: {
    basePoints: 24, pointsPerIntensity: 20,
    supportPointMultiplier: 6, positiveMessagePoints: 1, complexityPoint: 0.2,
    eraLossPerIntensity: 4, maxEraLoss: 2
  },
  support: {
    bitsPerPoint: 100, subscriptionPoints: 2.5, giftPoints: 3.5,
    mysteryGiftPointsPerSub: 1.2, growthMultiplier: 0.42
  }
};
