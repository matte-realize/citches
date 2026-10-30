# Chat City

A Twitch chat driven isometric civilization. The city begins around a shared founding hall on a small plot, then expands outward as the community builds a lasting, positive, expressive stream together. Live chat and JSONL replay use the same message-source interface and WebSocket event protocol.

## Run

```sh
npm install
npm run live -- <channel>
# or
npm run replay -- <path-to-jsonl> [speed]
```

In another terminal, run `npm run dev:web` and open the printed Vite URL. Streamers can choose a civilization theme from the on-screen selector: Ancient Empire, Mythic Realm, Solarpunk Haven, or Neon Megacity. The selection is saved in the view URL (`?theme=...`), so it can be kept as a stream layout; changing it reconnects and rebuilds the current city from the backend's recent event history. The browser connects to port `8787` by default; `?wsPort=8790` selects another local port. For the backend, configure the socket with `WS_PORT`.

`AGGREGATE_WINDOW_MS` sets the rolling count window (default 5 seconds); `AGGREGATE_TICK_MS` sets the UI refresh cadence (default 250 ms). Live mode also accepts `TWITCH_CHANNEL`.

## Community growth

Ordinary short messages add a small amount of progress. Longer, more varied and positive comments add more. Progress also grows gradually over a sustained session, and is emitted in paced construction pulses rather than building one structure per message. Questions grow landmarks. Raids create a construction burst; spam/emote surges create fireworks; hate events can cause a fire or meteor.

Twitch Bits/cheers, subscriptions, resubs, and gifted subscriptions add shared support progress. Emotes are normalized by occurrence, not just unique emote type. External cash donation alerts (such as Streamlabs or StreamElements) are not available through anonymous Twitch IRC; they need a separate authorized integration.

The renderer starts as a small founding village of thatch huts and shared fires. It lays footpaths from home to home as each hut is built; community technology milestones upgrade those trails into stone streets and later paved roads while opening new rings of land. Milestones are earned from thoughtful, positive chat over time and fan support, not just raw message count. Livestock appears around the early village, wagons arrive with bronze and masonry, cars unlock in the industrial city, and blimps follow in the age of airships. The streamer’s selected theme stays in the hosted view URL; the rendering class and event protocol remain separate from chat transport so an extension adapter can replace the local WebSocket later.

## Data and tuning

Live messages are appended to `logs/<channel>-<UTC-date>.jsonl`. Replay accepts raw log rows and normalized `{timestamp,user,text,emotes,isRaid,raidViewerCount}` rows; replay speed `2` runs twice as fast.

Rule keywords, growth and technology milestones, multipliers, support weights, and event thresholds are in `src/config.ts`. `ingest/`, `classify/`, `aggregate/`, and `events/` remain separate modules under `src/`. The browser receives `{type:"tick", aggregate, events}`. Event shapes are in `src/types.ts`; new advancement events add milestone unlocks while leaving existing build and effect events intact.
