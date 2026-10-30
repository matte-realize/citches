# Chat City

A small Twitch chat driven isometric city demo. Live ingestion and JSONL replay share the same message source interface and WebSocket pipeline.

## Run

```sh
npm install
npm run live -- <channel>
# or
npm run replay -- <path-to-jsonl> [speed]
```

In another terminal, run `npm run dev:web` and open the printed Vite URL. Backend defaults to WebSocket port `8787`; configure with `WS_PORT`. `AGGREGATE_WINDOW_MS` sets the default 5 second aggregation window. Live mode also accepts `TWITCH_CHANNEL`.

Live chat rows are appended to `logs/<channel>-<UTC-date>.jsonl`. Replay accepts both those raw log rows and normalized `{timestamp,user,text,emotes,isRaid,raidViewerCount}` rows. Replay speed `2` runs twice as fast.

## Pipeline

`ingest/` emits normalized messages; `classify/` applies rules and a placeholder hate keyword list; `aggregate/` emits per-window counts and rate; `events/` maps counts into the stable JSON event union in `src/types.ts`. The browser receives `{type:"tick", aggregate, events}` over WebSocket. Tune spam rules in `src/config.ts` and event thresholds/multipliers in `config.events`.
