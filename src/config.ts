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
    destroyThreshold: 3.5, minThreshold: 1.8, maxThreshold: 9, adaptiveShare: 0.06, rateWindowSeconds: 90,
    maxDestroysPerPulse: 8, cooldownMs: 140_000,
    /** Once the meter fills, the attack masses for a short warning, then strikes (never closer than minGapMs apart). */
    warningMs: 12_000, minGapMs: 135_000,
    decayPerSecond: 0.05, positiveDefense: 0.12,
    /** Danger above this many pulses' worth is dropped, so a burst of trolls cannot snowball. */
    backlogPulses: 1.5,
    /**
     * Haters are a small minority in most chats, so each minus is amplified when negativity is
     * rare: up to (1 + rarityBoost)x when almost nobody is negative, 1x when everyone is.
     */
    rarityBoost: 1.5, rarityWindowSeconds: 60,
    /** Draining a meter that was at least this full back to zero earns a "HATERS WASHED OUT" bonus. */
    washOutFrom: 0.5, washOutBonus: 6,
    technologyPenalty: 0.8,
    /** Every chat-driven attack takes this many times the buildings its meter pulses paid for. */
    attackSizeMultiplier: 1.15,
    /** Attacks grow with sqrt(pace / reference), from 1x at this pace up to maxSpeedScale. */
    speedReferencePerMinute: 30, maxSpeedScale: 3, speedWindowSeconds: 300
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
    /** Weathering: even a busy, happy city wears a little every few minutes; bigger eras wear faster. */
    entropyMinutes: 5, entropyPerEra: 0.08,
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
  /**
   * Community over grind. Each chatter's plus points shrink as they pile up within a few minutes
   * (so one superfan or bot cannot carry the city), more distinct chatters speed growth up, and
   * very long continuous sessions slowly tire growth until the city has slept.
   */
  community: {
    perChatterSoftCap: 14, perChatterWindowMinutes: 5,
    /** Chat bots never build, score or appear on leaderboards (add your own with IGNORE_USERS). */
    ignoreUsers: ["nightbot", "streamelements", "moobot", "fossabot", "streamlabs", "soundalerts", "wizebot", "botisimo", "sery_bot", "kofistreambot", "pokemoncommunitygame", "commanderroot", "streamstickers", ...(env.IGNORE_USERS ?? "").split(",").map(name => name.trim().toLowerCase()).filter(Boolean)],
    breadthWindowMinutes: 5, minMultiplier: 0.8, maxMultiplier: 1.35,
    fatigueAfterHours: 6, fatiguePerHour: 0.1, minFatigue: 0.4, restHours: 2
  },
  /**
   * While the city sleeps it still fades, gently: one wear step every `sleepWearMinutes`, never past
   * "shabby". Coming back after `welcomeAfterMinutes` makes repairs half price for a while.
   */
  rest: {
    sleepWearMinutes: 20, maxTimeAwaySteps: 10, timeAwayStepsPerHour: 2, welcomeAfterMinutes: 30, welcomeMinutes: 10,
    /** While offline a household moves out every so often; chat brings families back. */
    moveOutMinutes: 14, maxVacancyShare: 0.6, moveInPoints: 8, welcomeMoveIns: 3, timeAwayMoveOutsPerHour: 3, maxTimeAwayMoveOuts: 12
  },
  /**
   * Natural disasters strike for no reason at all, but only while people are around (so an idle
   * or bot-run stream is not punished twice). They escalate as the story goes on, and the
   * Kardashev eras bring catastrophes on a planetary, stellar and galactic scale.
   */
  catastrophes: {
    minutesBetween: [8, 16],
    /** Catastrophe gap for Empire and below, Type I, Type II and Type III. */
    gapScale: [1, 0.8, 0.65, 0.5],
    /**
     * Danger grows exponentially with each era (1.15^era: x1.4 by Stone City, x2.3 by Empire,
     * x3.5 by Type III), so each new era is harder to hold. Progress toward the next era slows
     * the same way, more gently.
     */
    dangerPerEra: 1.15, progressDragPerEra: 1.06,
    /** Each chapter makes trouble a little worse, up to a cap. */
    escalationPerChapter: 0.05, maxEscalation: 1.8,
    /** A strong positive chat braces the city: one fewer building lost. */
    bracedPlusPerMinute: 30,
    warmupMinutes: 5
  },
  /** Endless story: each chapter needs a little more community effort than the last. */
  story: { firstChapterPoints: 120, chapterGrowth: 1.3 },
  /** Owned homes grow when their owner comes back after a break or keeps contributing. */
  homes: { returnGapMs: 10 * 60_000, upgradePoints: 30, maxLevel: 3 },
  /** What `npm run calibrate` checks the danger system against, using real chat logs. */
  calibration: {
    // Losses really sting but never outpace growth. Very busy chats build ~40 homes a minute while
    // attacks stay capped as events, so their ratio sits lowest; hence the 4% floor.
    lostPerBuilt: [0.04, 0.4] as [number, number],
    minutesBetweenAttacks: [2.3, 7] as [number, number],  // an attack is an event, not background noise
    lostPerAttack: [2, 7] as [number, number],            // average per attack at 30 msg/min; scales with pace
    maxLostPerMinute: 20                                   // worst minute (an attack plus a disaster), scales with pace
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
      { name: "HUTS & GATHERING", points: 80 },
      { name: "SETTLED HOMES", points: 260 },
      { name: "STONE CITY", points: 600 },
      { name: "INDUSTRIAL CITY", points: 1200 },
      { name: "AGE OF AIRSHIPS", points: 2100 },
      { name: "EMPIRE", points: 3400 },
      // The Kardashev scale: a planet's worth of energy, then a star's, then a galaxy's.
      { name: "TYPE I · PLANETARY", points: 5400 },
      { name: "TYPE II · STELLAR", points: 8500 },
      { name: "TYPE III · GALACTIC", points: 13000 }
    ],
    chatPoint: 0.12, complexityPoint: 0.42, positivityPoint: 0.7,
    /** Above this pace (messages/min) each message is worth (reference / pace) ^ volumeDamping. */
    volumeReferencePerMinute: 20, volumeDamping: 0.6,
    /** Each negative message cancels this many positive ones from the positivity bonus. */
    negativeOffset: 2,
    supportPointMultiplier: 3.5,
    /**
     * Eras can be lost. Progress may fall below the last milestone (toxic chat, destruction, long
     * absences); once it is this share of that era's span below the milestone, the era drops.
     * The gap keeps a city sitting on the line from flickering between eras.
     */
    regressionMargin: 0.35,
    /** A freshly reached era is safe for this long, so one bad minute can't snatch it straight back. */
    regressionGraceMinutes: 8,
    /** Each building destroyed by an attack or catastrophe costs this share of the current era's span. */
    disasterLossShare: 0.005,
    /** Hours away drain this share of the current era's span per hour, up to the cap. */
    awayLossSharePerHour: 0.03, maxAwayLossShare: 0.25
  },
  /**
   * After any attack or disaster, new construction halts and every bit of chat progress goes into
   * rebuilding the ruins first. Repairs cost a share of a new build, and bits/subs count extra.
   */
  repair: { costShare: 0.55, maxPerPulse: 4, supportMultiplier: 1.5, maxRuins: 60 },
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
