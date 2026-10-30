# Chat City

A Twitch chat driven isometric civilization. The city begins around a shared founding hall on a small plot, then expands outward as the community builds a lasting, positive, expressive stream together. Live chat and JSONL replay use the same message-source interface and WebSocket event protocol.

## Run

```sh
npm install
npm run live -- <channel>
# or
npm run replay -- <path-to-jsonl> [speed]
```

In another terminal, run `npm run dev:web` and open the printed Vite URL. Streamers can choose a civilization theme from the on-screen selector: Nile Kingdom, Roman Republic, Norse Settlement, or Imperial Japan. Each theme changes the palette and the architecture as the settlement grows. The selection is saved in the view URL (`?theme=...`), so it can be kept as a stream layout; changing it reconnects and rebuilds the current city from the backend's recent event history. The browser connects to port `8787` by default; `?wsPort=8790` selects another local port. For the backend, configure the socket with `WS_PORT`.

`AGGREGATE_WINDOW_MS` sets the rolling count window (default 5 seconds); `AGGREGATE_TICK_MS` sets the UI refresh cadence (default 250 ms). Live mode also accepts `TWITCH_CHANNEL`.

## Community growth

Ordinary short messages add a small amount of progress. Longer, more varied and positive comments add more. Progress also grows gradually over a sustained session, and is emitted in paced construction pulses rather than building one structure per message. Questions grow landmarks. Raids create a construction burst; spam/emote surges create fireworks; hate events can cause a fire or meteor.

Twitch Bits/cheers, subscriptions, resubs, and gifted subscriptions add shared support progress. Emotes are normalized by occurrence, not just unique emote type. External cash donation alerts (such as Streamlabs or StreamElements) are not available through anonymous Twitch IRC; they need a separate authorized integration.

The renderer begins with people gathered around one shared campfire, then grows from huts to homes and a city. Each building faces a connected pedestrian path; placement routes around occupied plots and reserves clear space for residents and livestock. The first technology milestone expands the plot, and each later milestone opens another ring. The bottom progress panel names the next milestone and shows exact community points earned against the target, alongside the percentage fill. Industrial milestones add a separate vehicle road beside the footpaths. Wagons follow established paths, cars use the later road network, and blimps arrive in the aviation era. Strong chat and fan support unlock technology; at the industrial milestone, a cluster of small buildings is cleared and rebuilt as a skyscraper. Disasters can destroy a concentrated district; rebuilding enters a temporary lower-era housing phase until positive chat and fan support refill the recovery meter. Rendering stays separate from chat transport so an extension adapter can replace the local WebSocket.

## Data and tuning

Live messages are appended to `logs/<channel>-<UTC-date>.jsonl`. Replay accepts raw log rows and normalized `{timestamp,user,text,emotes,isRaid,raidViewerCount}` rows; replay speed `2` runs twice as fast.

Rule keywords, growth and technology milestones, recovery rates, multipliers, support weights, and event thresholds are in `src/config.ts`. `ingest/`, `classify/`, `aggregate/`, and `events/` remain separate modules under `src/`. The browser receives `{type:"tick", aggregate, events, progress}`. Event shapes are in `src/types.ts`; advancement events unlock milestones while existing build and effect event shapes remain intact.
