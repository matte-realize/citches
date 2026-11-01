# Chat City

A Twitch chat driven isometric civilization. The city begins around a shared founding hall on a small plot, then expands outward as the community builds a lasting, positive, expressive stream together. Live chat and JSONL replay use the same message-source interface and WebSocket event protocol.

## Run

```sh
npm install
npm run live -- <channel>
# or
npm run replay -- <path-to-jsonl> [speed]
```

No backend handy? Open the web app with `?demo=1` (or `?demo=4` for 4x chat) to run the real scoring pipeline on simulated chat, including periodic troll waves that attack the city.

In another terminal, run `npm run dev:web` and open the printed Vite URL. Streamers can choose a civilization theme from the on-screen selector: Nile Kingdom, Roman Republic, Norse Settlement, or Imperial Japan. Each theme changes the palette and the architecture as the settlement grows. The selection is saved in the view URL (`?theme=...`), so it can be kept as a stream layout; changing it reconnects and rebuilds the current city from the backend's recent event history. The browser connects to port `8787` by default; `?wsPort=8790` selects another local port. For the backend, configure the socket with `WS_PORT`.

`AGGREGATE_WINDOW_MS` sets the rolling count window (default 5 seconds); `AGGREGATE_TICK_MS` sets the UI refresh cadence (default 250 ms). Live mode also accepts `TWITCH_CHANNEL`.

## Community growth

Ordinary short messages add a small amount of progress. Longer, more varied and positive comments add more. Progress also grows gradually over a sustained session, and is emitted in paced construction pulses rather than building one structure per message. Questions grow landmarks. Raids create a construction burst; spam/emote surges create fireworks; hate events can cause a fire or meteor.

Twitch Bits/cheers, subscriptions, resubs, and gifted subscriptions add shared support progress. Emotes are normalized by occurrence, not just unique emote type. External cash donation alerts (such as Streamlabs or StreamElements) are not available through anonymous Twitch IRC; they need a separate authorized integration.

The renderer begins with people gathered around one shared campfire, then grows from huts to homes and a city. Each building faces a connected pedestrian path; placement routes around occupied plots and reserves clear space for residents and livestock. The first technology milestone expands the plot, and each later milestone opens another ring. The bottom progress panel names the next milestone and shows exact community points earned against the target, alongside the percentage fill. Industrial milestones add a separate vehicle road beside the footpaths. Wagons follow established paths, cars use the later road network, and blimps arrive in the aviation era. As technology advances, the community can redevelop several older homes into a landmark or, in the industrial era and beyond, a skyscraper; redevelopment waits until a safe, accessible cluster is available. Disasters can destroy a concentrated district; rebuilding enters a temporary lower-era housing phase until positive chat and fan support refill the recovery meter. Once recovery completes, another neighborhood can be renewed at the city’s current level. Rendering stays separate from chat transport so an extension adapter can replace the local WebSocket.

## Points, minuses and attacks

Every message runs through a list of scoring rules (`src/score/rules.ts`). Each rule returns a hit and is weighted in `config.scoring.weights`: positive weights are pluses, negative weights are minuses. Add a new rule by appending to `SCORE_RULES` and giving it a weight. Twitch slang lives in `src/score/slang.ts` and is matched by pattern, so stretched spellings like `WWWW` or `pogggg` count. Short reactions and stretched words are normal chat, not spam, so fast chats build at full speed.

| Pluses | Minuses |
| --- | --- |
| HYPE (positive words and Twitch slang: W, WWWW, LETS GOOO, POG, GG, based, peak...), LOL (LUL, KEKW, LMAOOO, ｗｗ, 草, jaja, kkkk), KINDNESS (thanks, respect, <3, o7), BIG BRAIN (long, varied messages), CURIOUS (questions), SUPPORT (bits/subs), plus a small silent bonus for any real chat | TOXIC (insult/negativity list), HATE (`HATE_KEYWORDS` env, comma separated), SPAM (emote walls, 14+ repeated characters, one word hammered 6+ times), SHOUTING (20+ letters, mostly caps), COPYPASTA (the same text 3+ times in 20 s), FLOOD (one user posting 5+ times in 10 s), MEH (single-character messages), plus negative slang like L, ratio, mid and cringe ("not mid" counts as a compliment) |

Points accumulate into the on-screen **CITY POINTS** counter, and each tick's biggest reasons float up from the city as `+1.4 KINDNESS` / `-1.6 COPYPASTA` pops. Destruction mirrors construction: minus points fill the **DANGER** meter (`config.threat`), pluses drain it, and every time it fills a building is knocked down. These are paced pulses of one or two buildings, like build pulses, instead of one big disaster at the end. The dominant kind of negativity picks how it falls, and the attack grows with the damage: all caps calls lightning and spam, copypasta or floods call a locust swarm at any size, while toxic chat starts as a fire and escalates to a meteor once three buildings are at stake. Because haters are usually a small minority, each minus hits the meter harder when negativity is rare (`rarityBoost`). The community fights back by out-building the damage and draining the meter: emptying a meter that was at least half full earns a `HATERS WASHED OUT` bonus. Outskirts homes are hit before the old centre and landmarks. Demolition plays the build animation in reverse, stepping down in chunky layers. Minuses also slightly slow technology progress, but never undo a milestone that was already reached. Only hate keywords trigger a big disaster and a recovery period.

### Calibrating the danger system

The danger threshold adapts to each chat: knocking a building down costs a share (`adaptiveShare`) of the community's plus points from the last minute and a half, clamped between `minThreshold` and `maxThreshold`. Big, fast chats need more negativity to do damage, and small, friendly ones feel a few trolls. Attacks are spaced at least `cooldownMs` apart, so each one is an event of a few buildings rather than constant single losses.

```sh
npm run calibrate                      # every log in logs/
npm run calibrate -- logs/xqc-*.jsonl
```

`calibrate` replays real chat logs through the same pipeline on message time (hours in seconds) and checks attack spacing, attack size, the worst minute, whether the city keeps growing, and losses per build against `config.calibration`. Live mode records every chat it reads into `logs/`, so the check gets better the more streams it has seen. Retune `config.threat` and rerun until all targets are met.

## Upkeep: no activity, no progress

A city needs its community. When chat goes quiet compared with the channel's own normal pace (or drops below roughly one positive message a minute), buildings slowly wear down, oldest first: **weathered** (grime, weeds, cracks), **shabby** (darker, boarded windows, vines, lights out, a slight lean), **ruined** (rubble, a heavier lean), and finally they **collapse** into a rubble lot that can be rebuilt. At most one wear step happens a minute. Positive chat repairs the most worn buildings first, with sparkles and a `FIXED!` pop, and the scoreboard says whether quiet chat is wearing the city down or chat is repairing it. A small but kind chat never decays; a slow, neutral one stalls and looks run down until a burst of hype brings it back. Wear pauses once the city falls asleep, so ending a stream never turns the city to ruins. Tuning lives in `config.upkeep`, and `npm run calibrate` reports wear and repairs per hour.

## Day, night and bedtime

The sun follows the local time: it rises in the east, arcs over the city (shadows move with it) and sets in the west, through pink dawns and orange dusks, with a moonlit night in between. Windows, street lamps and neon glow at night and fade by day, and fewer villagers and cars are out late. By default every viewer sees their own time of day; on Twitch the streamer can instead pin their own time zone on the configuration page. `?tz=Europe/Paris` follows a zone and `?hour=19` pins the time for demos.

When the stream goes offline the city goes to bed. Walkers head home and go inside, cars park and disappear, the villagers by the campfire nod off while it burns down to embers, sheep lie down, most lights go out and Z's drift up from the homes. When chat returns, everyone wakes with a "GOOD MORNING!". Offline is detected from the backend disconnecting, from the Twitch page (browser extension), or from chat being silent for four minutes (`?sleepAfter=` in seconds). `?sleep=1` forces bedtime for testing.

## Town planning

The plot is laid out in planned blocks: streets run every four tiles, so each block is eight street-facing lots around a backyard tile (trees, vegetable plots or a sheep paddock). The founding campfire sits in the central block as an open plaza. New homes go to the best lot: infill on streets that already exist first, then compact growth outward, finishing partly built blocks before starting new ones; landmarks prefer corner lots. Every home's front door faces its street.

The city is drawn as isometric pixel art to match the HUD: the scene renders at low resolution, gets dark outlines wherever depth or surface direction changes, and is upscaled with hard pixel edges and hard shadows. `?pixel=1.5` is the default (3 device pixels per art pixel on retina screens); `?pixel=2` or `3` is chunkier and `?pixel=1` renders smooth.

## Browser extension (any Twitch stream)

The Chrome extension draws a city over **any** Twitch channel you watch. It needs no backend: it reads that channel's public chat anonymously and runs the same scoring pipeline in the browser. Each channel's city is saved in the extension, so it is still there next time you visit.

```sh
npm run build:extension
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick the `extension-dist/` folder. Open any live channel on twitch.tv. The toolbar popup switches the city on or off, picks the civilization, corner and size, and can reset the current channel's city. Hover the player for the rotate buttons. Only you see the city; it is not added to the stream.

What you will see:

- The city is named after the channel, and the scoreboard lists its **top builders**.
- Builds pop up credited to the chatters whose messages paid for them, for example `+1 HOME by name & name`.
- Villagers repeat wholesome chat messages in speech bubbles.
- Every few homes the district gets a civic building for its era: wells, stalls and totems; windmills, smithies, fountains and watchtowers; factories, water towers, gas stations and arcades; radio towers, wind turbines, data centres, stadiums and solar farms. Each civilization swaps in its own versions: obelisks, granaries and palm oases on the Nile; shrines, aqueducts and a colosseum in Rome; rune stones in the Norse lands; torii gates, water-wheel mills and koi ponds in Japan. Industrial-era landmarks and skyscrapers are themed too: sandstone tiers with gold pyramidions, travertine towers with copper domes, timber stave towers with dragon gables, and modern pagodas.
- Streets fill with devices (traffic lights that cycle, phone booths, vending machines, mailboxes, hydrants, bus stops, benches, EV chargers), and modern roofs get dishes, antennas, AC units and drones.
- Chimneys smoke, birds fly over, builds kick up dust and sparkles, and every new era gets a fireworks show.

The web app has the same view: `/?channel=<name>` reads a channel's chat directly, `Q`/`E` (or the on-screen buttons) rotate the view in 90 degree steps, and `?fps=30` caps the frame rate (overlays default to 30).

## Twitch extension overlay

`overlay.html` is the Twitch video-overlay entry point. It loads the Twitch Extension Helper, renders with a transparent background, floats the plot as a small island in a corner of the stream, and shows the score bar in pixel type. Any page also accepts `?overlay=1` to preview overlay mode locally; `&corner=bl|br|center` moves the city and `&zoom=1.5` scales it.

**Only the streamer chooses the look.** `config.html` is the extension's broadcaster configuration page, which Twitch shows only to the channel owner. It sets the civilization, corner, size and backend address in Twitch's configuration service. The overlay reads those settings for every viewer and has no picker of its own, and it reloads if the streamer changes them mid-stream. (The browser extension's popup is only a demo and testing tool.)

For the overlay to work live, the backend acts as the Extension Backend Service:

- Set `TWITCH_EXT_CLIENT_ID`, `TWITCH_EXT_SECRET` (the base64 extension secret), `TWITCH_EXT_OWNER_ID`, and `TWITCH_BROADCASTER_ID`. The backend then signs extension JWTs and broadcasts batched ticks through Extension PubSub (at most one message per second, under 5 KB).
- The backend serves `GET /snapshot` on the WebSocket port, so viewers who join late rebuild the same city. Expose it over HTTPS and put `{"ebsUrl":"https://…"}` in the extension's broadcaster configuration, or pass `?ebs=` while testing.
- `npm run build:web` produces relative-path assets in `dist/` that can be zipped and uploaded as the extension's hosted files. Fonts are bundled locally rather than loaded from a CDN.

## Data and tuning

Live messages are appended to `logs/<channel>-<UTC-date>.jsonl`. Replay accepts raw log rows and normalized `{timestamp,user,text,emotes,isRaid,raidViewerCount}` rows; replay speed `2` runs twice as fast.

Rule keywords, growth and technology milestones, recovery rates, multipliers, support weights, and event thresholds are in `src/config.ts`. `ingest/`, `classify/`, `aggregate/`, and `events/` remain separate modules under `src/`. The browser receives `{type:"tick", aggregate, events, progress, score}`. Event shapes are in `src/types.ts`; advancement events unlock milestones while existing build and effect event shapes remain intact.
