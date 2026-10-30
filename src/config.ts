export const config = {
  aggregateWindowMs: Number(process.env.AGGREGATE_WINDOW_MS ?? 5000),
  aggregateTickMs: Number(process.env.AGGREGATE_TICK_MS ?? 250),
  websocketPort: Number(process.env.WS_PORT ?? 8787),
  websocketHistoryLimit: Number(process.env.WS_HISTORY_LIMIT ?? 10000),
  hateKeywords: ["placeholder_hate_word"],
  positiveKeywords: ["love", "great", "awesome", "amazing", "nice", "good", "gg", "thanks", "thank", "fun", "hype", "pog", "beautiful", "well done", "congrats", "proud", "excited"],
  spam: { emoteRatio: 0.6, repeatedCharacterLength: 5, maxShortMessageLength: 4, shortRepeatMinimum: 3 },
  events: {
    rateReference: 4, countMultiplier: 1, intensityMultiplier: 1,
    raidMinimumViewers: 1, disasterThreshold: 2, fireworksThreshold: 1
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
  support: {
    bitsPerPoint: 100, subscriptionPoints: 2.5, giftPoints: 3.5,
    mysteryGiftPointsPerSub: 1.2, growthMultiplier: 0.42
  }
};
