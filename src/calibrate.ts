import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Aggregator } from "./aggregate/aggregator.js";
import { config } from "./config.js";
import { EventMapper } from "./events/mapper.js";
import { normalizeLogRow } from "./ingest/replay.js";
import type { ChatMessage, SimEvent } from "./types.js";

/**
 * Replays chat logs through the real scoring pipeline on message time (hours of chat in seconds)
 * and reports how the danger system behaves against the targets in `config.calibration`.
 *
 *   npm run calibrate                # every log in logs/
 *   npm run calibrate -- logs/a.jsonl logs/b.jsonl
 */
interface Report { chatLost: number; natural: number; naturalLost: number; capitol: number; wear: number; repairs: number; file: string; messages: number; minutes: number; built: number; lost: number; attacks: number; firstAttackMin?: number; longestQuietMin: number; worstMinute: number; finalScore: number; threshold: number; kinds: Record<string, number>; eras: Array<{ name: string; minute: number }> }

function simulate(file: string): Report | undefined {
  const messages: ChatMessage[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const message = normalizeLogRow(JSON.parse(line)); if (message.text || message.isRaid || message.supportPoints) messages.push(message); } catch { /* skip bad rows */ }
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  if (messages.length < 50) return undefined;
  const mapper = new EventMapper();
  const events: Array<{ at: number; event: SimEvent }> = [];
  const aggregator = new Aggregator((aggregate, delta, raid, signals) => {
    for (const event of mapper.map(aggregate, delta, raid, signals, aggregate.timestamp)) events.push({ at: aggregate.timestamp, event });
  });
  const tick = config.aggregateTickMs;
  const start = messages[0].timestamp;
  let clock = start;
  for (const message of messages) {
    // Close every tick up to this message; long silences are skipped in one step.
    if (message.timestamp - clock > 120_000) { aggregator.flush(clock + tick); clock = message.timestamp - tick; }
    while (clock + tick <= message.timestamp) { clock += tick; aggregator.flush(clock); }
    aggregator.add(message, message.timestamp);
  }
  for (let i = 0; i < 40; i++) { clock += tick; aggregator.flush(clock); }

  const end = clock;
  const minutes = Math.max(1, (end - start) / 60_000);
  let built = 0, lost = 0, chatLost = 0, natural = 0, naturalLost = 0, attacks = 0, wear = 0, repairs = 0;
  const kinds: Record<string, number> = {};
  const eras: Array<{ name: string; minute: number }> = [];
  const attackTimes: number[] = [];
  const lostByMinute = new Map<number, number>();
  for (const { at, event } of events) {
    if (event.type === "advancement") eras.push({ name: event.name, minute: (at - start) / 60_000 });
    if (event.type === "regression") eras.push({ name: `LOST→${event.name}`, minute: (at - start) / 60_000 });
    if (event.type === "build") built += event.count;
    if (event.type === "rebuild") built += event.count;
    if (event.type === "decay") wear += event.count;
    if (event.type === "repair") repairs += event.count;
    if (event.type === "boom") built += Math.min(24, Math.max(2, Math.ceil(event.viewers / 5)));
    if (event.type === "disaster" && event.natural) {
      // Natural disasters are random by design; reported, but not judged against chat targets.
      natural++; naturalLost += event.damageCount ?? 1; lost += event.damageCount ?? 1;
      kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
    } else if (event.type === "disaster") {
      const count = event.damageCount ?? 1;
      // Danger escalates by design (era and chapter), so size is judged at the base difficulty.
      lost += count; chatLost += count / (event.severity ?? 1); attacks++; attackTimes.push(at);
      kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
      const minute = Math.floor((at - start) / 60_000);
      if (event.reason !== "HATE") lostByMinute.set(minute, (lostByMinute.get(minute) ?? 0) + count);
    }
  }
  let longestQuiet = 0, previous = start;
  for (const at of [...attackTimes, end]) { longestQuiet = Math.max(longestQuiet, at - previous); previous = at; }
  return {
    capitol: mapper.capitol.stage, wear, repairs, chatLost, natural, naturalLost, file: file.split("/").pop()!, messages: messages.length, minutes, built, lost, attacks,
    firstAttackMin: attackTimes.length ? (attackTimes[0] - start) / 60_000 : undefined,
    longestQuietMin: longestQuiet / 60_000,
    worstMinute: Math.max(0, ...lostByMinute.values()),
    finalScore: mapper.score.total, threshold: mapper.destroyThreshold, kinds, eras
  };
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync("logs").filter(name => name.endsWith(".jsonl")).map(name => join("logs", name));
const targets = config.calibration;
const within = (value: number, [low, high]: [number, number]) => value >= low && value <= high;
const mark = (ok: boolean) => ok ? "ok " : "!! ";
let failures = 0;
for (const file of files) {
  const report = simulate(file);
  if (!report) { console.log(`${file}: too few messages, skipped`); continue; }
  const ratio = report.built ? report.lost / report.built : 0;
  const gap = report.attacks ? report.minutes / report.attacks : Infinity;
  const ratioOk = within(ratio, targets.lostPerBuilt);
  // Spacing needs a few attacks to mean anything; short logs are reported but not judged.
  const enoughTime = report.minutes >= 15;
  const gapOk = !enoughTime || within(gap, targets.minutesBetweenAttacks);
  // Attacks scale with chat pace (see speedScale in the mapper), so size targets scale with it too.
  const speed = Math.min(config.threat.maxSpeedScale, Math.max(1, Math.sqrt(report.messages / report.minutes / config.threat.speedReferencePerMinute)));
  const worstOk = report.worstMinute <= targets.maxLostPerMinute * speed;
  const perAttack = report.attacks ? report.chatLost / report.attacks : 0;
  const sizeOk = !report.attacks || within(perAttack / speed, targets.lostPerAttack);
  const growing = report.built > report.lost;
  failures += [ratioOk, gapOk, worstOk, growing, sizeOk].filter(ok => !ok).length;
  console.log(`\n${report.file}  ·  ${report.messages} messages over ${report.minutes.toFixed(0)} min  ·  ${(report.messages / report.minutes).toFixed(1)} msg/min`);
  console.log(`  ${mark(ratioOk)}lost per built     ${ratio.toFixed(2)}   (target ${targets.lostPerBuilt.join("-")}; ${report.lost} lost / ${report.built} built)`);
  console.log(`  ${enoughTime ? mark(gapOk) : "-- "}minutes per attack ${Number.isFinite(gap) ? gap.toFixed(1) : "none"}${enoughTime ? "" : " (log under 15 min, not judged)"}   (target ${targets.minutesBetweenAttacks.join("-")}; ${report.attacks} attacks, first at ${report.firstAttackMin?.toFixed(1) ?? "-"} min, longest quiet ${report.longestQuietMin.toFixed(1)} min)`);
  console.log(`  ${mark(sizeOk)}lost per attack    ${perAttack.toFixed(1)}   (target ${targets.lostPerAttack.map(value => (value * speed).toFixed(0)).join("-")} at this pace)`);
  console.log(`  ${mark(worstOk)}worst minute       ${report.worstMinute} lost   (max ${(targets.maxLostPerMinute * speed).toFixed(0)} at this pace)`);
  console.log(`  -- natural disasters ${report.natural} (${report.naturalLost} lost, ${report.natural ? (report.minutes / report.natural).toFixed(1) : "-"} min apart)`);
  console.log(`  -- eras              ${report.eras.length ? report.eras.map(era => `${era.name} @${era.minute.toFixed(0)}m`).join(" → ") : "none"}`);
  console.log(`  -- capitol           reached stage ${report.capitol} of 5`);
  console.log(`  -- upkeep            ${(report.wear / report.minutes * 60).toFixed(0)} wear steps/h, ${(report.repairs / report.minutes * 60).toFixed(0)} repairs/h (net ${report.wear - report.repairs})`);
  console.log(`  ${mark(growing)}city keeps growing ${growing ? "yes" : "no"}   · final score ${report.finalScore.toFixed(0)} · threshold now ${report.threshold.toFixed(1)} · attacks ${JSON.stringify(report.kinds)}`);
}
console.log(failures ? `\n${failures} target(s) missed. Tune config.threat and run again.` : "\nAll targets met.");
