import { LiveSource } from "./ingest/live.js";
import { run } from "./runtime.js";
const channel = process.argv[2] ?? process.env.TWITCH_CHANNEL;
if (!channel) throw new Error("Usage: npm run live -- <channel> (or set TWITCH_CHANNEL)");
await run(new LiveSource(channel));
