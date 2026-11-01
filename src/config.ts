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
      chat: 0.1, hype: 1, laugh: 0.3, kindness: 1.4, bigBrain: 1.2, curious: 0.5, support: 4,
      hate: -10, toxic: -2.2, spam: -0.5, shouting: -0.4, copypasta: -1, flood: -0.8, lowEffort: -0.25
    },
    negativeKeywords: [
      "trash", "garbage", "boring", "cringe", "mid", "sucks", "suck", "worst", "stupid", "idiot", "dumb", "loser", "washed",
      "ratio", "l", "ff", "uninstall", "noob", "terrible", "awful", "ew", "stfu", "shut up", "dogshit", "lame", "bad", "hate",
      "residentsleeper", "notlikethis", "wutface", "dansgame", "copium", "skill issue"
    ],
    kindKeywords: ["thank you", "thanks", "ty", "appreciate", "welcome", "proud of", "you got this", "respect", "well played", "wp", "<3"],
    bigBrainComplexity: 0.55,
    /** Caps are normal hype on Twitch; only long, mostly-capital messages count as shouting. */
    shoutMinLetters: 20, shoutRatio: 0.8,
    copypastaMinLength: 12, copypastaRepeats: 3,
    floodWindowMs: 10_000, floodMessages: 5,
    memoryMs: 20_000
  },
  threat: {
    /**
     * Destruction mirrors construction: minus points fill the danger meter, and each time it
     * fills a building is knocked down, in paced pulses just like build pulses.
     */
    /**
     * Adaptive threshold: knocking a building down costs `adaptiveShare` of the community's plus
     * points from the last minute, clamped to [minThreshold, maxThreshold]. Big fast chats need
     * more negativity to do damage; small friendly ones feel a few trolls. `destroyThreshold` is
     * the starting value before there is any history.
     */
    destroyThreshold: 4.5, minThreshold: 2.5, maxThreshold: 14, adaptiveShare: 0.1, rateWindowSeconds: 90,
    maxDestroysPerPulse: 5, cooldownMs: 180_000,
    decayPerSecond: 0.06, positiveDefense: 0.18,
    /** Danger above this many pulses' worth is dropped, so a burst of trolls cannot snowball. */
    backlogPulses: 1.5,
    /**
     * Haters are a small minority in most chats, so each minus is amplified when negativity is
     * rare: up to (1 + rarityBoost)x when almost nobody is negative, 1x when everyone is.
     */
    rarityBoost: 1.5, rarityWindowSeconds: 60,
    /** Draining a meter that was at least this full back to zero earns a "HATERS WASHED OUT" bonus. */
    washOutFrom: 0.5, washOutBonus: 6,
    technologyPenalty: 0.35
  },
  /** What counts as spam. Short emote reactions and stretched words ("noooo") are normal chat. */
  /**
   * Upkeep: no activity, no progress. When chat is quiet compared with the channel's own normal
   * pace, buildings slowly wear down (weathered, shabby, ruined, then collapse). Positive chat
   * repairs the most worn ones. Wear pauses once chat has been silent long enough for the city to
   * fall asleep, so a stream ending never turns the city to ruins.
   */
  upkeep: {
    quietShare: 0.35,          // quiet = plus points below this share of the channel's typical rate...
    quietFloorPerMinute: 1.5,  // ...or below ~one positive message a minute, whichever is higher
    decayStepSeconds: 60,      // at most one wear step a minute, in fully quiet chat
    minDecayGapMs: 12_000,
    pauseAfterSilenceMs: 240_000,
    warmupMinutes: 2,          // no wear during the first minutes of a session
    repairPoints: 9,           // plus points that repair one wear step
    repairCooldownMs: 3000,
    typicalWindowMinutes: 20
  },
  /**
   * Chat commands. Chatters spend the points their positive messages earned; each command has a
   * per-viewer cooldown so nobody can spam it.
   */
  commands: {
    plant: { enabled: true, cost: 3, cooldownMs: 60_000 },
    repair: { enabled: true, cost: 6, cooldownMs: 90_000 },
    cheer: { enabled: true, cost: 4, cooldownMs: 45_000 },
    home: { enabled: true, cost: 0, cooldownMs: 30_000 },
    maxPerTick: 3
  },
  /**
   * The community capitol in the central plaza. A share of every plus point funds it, chatters can
   * `!donate` their own points (worth double), and each stage also needs a minimum era.
   */
  capitol: {
    share: 0.15,
    donationMultiplier: 2,
    donate: { enabled: true, defaultAmount: 10, minAmount: 3, cooldownMs: 20_000 },
    // Cumulative fund needed for each stage, and the era each stage needs.
    stages: [
      { points: 40, era: 0 },   // 1 Gathering Circle
      { points: 160, era: 1 },  // 2 Town Hall
      { points: 420, era: 2 },  // 3 Great Hall
      { points: 900, era: 3 },  // 4 Capitol
      { points: 1700, era: 4 }  // 5 Grand Capitol
    ]
  },
  /** Owned homes grow when their owner comes back after a break or keeps contributing. */
  homes: { returnGapMs: 10 * 60_000, upgradePoints: 30, maxLevel: 3 },
  /** What `npm run calibrate` checks the danger system against, using real chat logs. */
  calibration: {
    lostPerBuilt: [0.03, 0.3] as [number, number],     // losses are noticeable but never outpace growth
    minutesBetweenAttacks: [3, 8] as [number, number],  // an attack is an event, not background noise
    lostPerAttack: [1, 4] as [number, number],          // average buildings taken per attack
    maxLostPerMinute: 6                                   // worst minute, outside of hate events
  },
  spam: { emoteRatio: 0.8, emoteWallMinimum: 6, repeatedCharacterLength: 14, repeatedWordMinimum: 6 },
  events: {
    rateReference: 4, countMultiplier: 1, intensityMultiplier: 1,
    raidMinimumViewers: 1, disasterThreshold: 2, fireworksThreshold: 2.5, fireworksCooldownMs: 6000,
    destroyedBuildingsPerIntensity: 2.4, burnDurationMs: 3500
  },
  growth: {
    progressThreshold: 1.4, landmarkThreshold: 2.1,
    basePoints: 0.08, complexityMultiplier: 0.24, positivityMultiplier: 0.32,
    longevityMultiplier: 0.45, longevityMinutes: 30,
    buildCooldownMs: 1400, maxBuildsPerPulse: 3
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
