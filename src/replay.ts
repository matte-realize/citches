import { ReplaySource } from "./ingest/replay.js";
import { run } from "./runtime.js";
const file = process.argv[2];
const speed = Number(process.argv[3] ?? 1);
if (!file || !Number.isFinite(speed) || speed <= 0) throw new Error("Usage: npm run replay -- <logfile> [speed]");
await run(new ReplaySource(file, speed));
