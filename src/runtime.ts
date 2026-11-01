import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Aggregator } from "./aggregate/aggregator.js";
import { config } from "./config.js";
import { EventMapper } from "./events/mapper.js";
import { ExtensionPublisher } from "./twitch/extension.js";
import type { Aggregate, ChatMessage, CommunityProgress, MessageSource, ScoreSnapshot, SimEvent } from "./types.js";

type Tick = { type: "tick"; aggregate: Aggregate; events: SimEvent[]; progress: CommunityProgress; score: ScoreSnapshot };

export async function run(source: MessageSource) {
  const history: Tick[] = [];
  let latest: Tick | undefined;
  // HTTP serves /snapshot so a late-joining extension viewer can rebuild the current city.
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url?.startsWith("/snapshot")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ history: history.map(tick => ({ events: tick.events })), latest }));
      return;
    }
    response.writeHead(request.url === "/health" ? 200 : 404, { "Content-Type": "text/plain" }).end(request.url === "/health" ? "ok" : "not found");
  });
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();
  wss.on("connection", socket => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    for (const tick of history) socket.send(JSON.stringify({ ...tick, replay: true }));
  });
  const broadcast = (data: unknown) => {
    const json = JSON.stringify(data);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(json);
  };
  const publisher = ExtensionPublisher.fromEnv();
  publisher?.start();
  const eventMapper = new EventMapper();
  const aggregator = new Aggregator((aggregate: Aggregate, deltaCounts, deltaRaidViewers, growthSignals) => {
    const events = eventMapper.map(aggregate, deltaCounts, deltaRaidViewers, growthSignals, aggregate.timestamp);
    const score = eventMapper.score;
    if (events.length || score.pops.length) console.log(`score ${score.total.toFixed(1)} threat ${(score.threatRatio * 100).toFixed(0)}%`, score.pops.map(pop => `${pop.points > 0 ? "+" : ""}${pop.points} ${pop.label}`).join(" "));
    for (const event of events) console.log("sim event", JSON.stringify(event));
    const tick: Tick = { type: "tick", aggregate, events, progress: eventMapper.progress, score };
    latest = tick;
    if (events.length) {
      history.push(tick);
      if (history.length > config.websocketHistoryLimit) history.splice(0, history.length - config.websocketHistoryLimit);
    }
    broadcast(tick);
    publisher?.push(tick);
  });
  source.onMessage((message: ChatMessage) => aggregator.add(message));
  server.listen(config.websocketPort, () => console.log(`WebSocket + snapshot listening on :${config.websocketPort}${publisher ? " · Twitch extension publishing on" : ""}`));
  aggregator.start();
  await source.connect();
  const stop = async () => { aggregator.stop(); publisher?.stop(); await source.close(); wss.close(); server.close(); process.exit(0); };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
