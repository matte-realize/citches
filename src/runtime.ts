import { WebSocketServer, type WebSocket } from "ws";
import { Aggregator } from "./aggregate/aggregator.js";
import { config } from "./config.js";
import { EventMapper } from "./events/mapper.js";
import type { Aggregate, ChatMessage, CommunityProgress, MessageSource, SimEvent } from "./types.js";

export async function run(source: MessageSource) {
  const wss = new WebSocketServer({ port: config.websocketPort });
  const clients = new Set<WebSocket>();
  const history: Array<{ type: "tick"; aggregate: Aggregate; events: SimEvent[]; progress: CommunityProgress }> = [];
  wss.on("connection", socket => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    for (const tick of history) socket.send(JSON.stringify({ ...tick, replay: true }));
  });
  const broadcast = (data: unknown) => {
    const json = JSON.stringify(data);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(json);
  };
  const eventMapper = new EventMapper();
  const aggregator = new Aggregator((aggregate: Aggregate, deltaCounts, deltaRaidViewers, growthSignals) => {
    console.log("counts", aggregate.counts, `messages/sec=${aggregate.messagesPerSecond.toFixed(2)}`);
    const events = eventMapper.map(aggregate, deltaCounts, deltaRaidViewers, growthSignals);
    for (const event of events) console.log("sim event", JSON.stringify(event));
    const tick = { type: "tick" as const, aggregate, events, progress: eventMapper.progress };
    if (events.length) {
      history.push(tick);
      if (history.length > config.websocketHistoryLimit) history.splice(0, history.length - config.websocketHistoryLimit);
    }
    broadcast(tick);
  });
  source.onMessage((message: ChatMessage) => aggregator.add(message));
  wss.on("listening", () => console.log(`WebSocket listening on :${config.websocketPort}`));
  aggregator.start();
  await source.connect();
  const stop = async () => { aggregator.stop(); await source.close(); wss.close(); process.exit(0); };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
