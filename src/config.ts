export const config = {
  aggregateWindowMs: Number(process.env.AGGREGATE_WINDOW_MS ?? 5000),
  websocketPort: Number(process.env.WS_PORT ?? 8787),
  hateKeywords: ["placeholder_hate_word"],
  spam: { emoteRatio: 0.6, repeatedCharacterLength: 5, maxShortMessageLength: 4, shortRepeatMinimum: 3 },
  events: {
    rateReference: 4, countMultiplier: 1, intensityMultiplier: 1,
    raidMinimumViewers: 1, disasterThreshold: 2, fireworksThreshold: 1
  }
};
