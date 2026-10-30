import { WebSocketServer, type WebSocket } from "ws";
import { Aggregator } from "./aggregate/aggregator.js";
import { config } from "./config.js";
import { mapEvents } from "./events/mapper.js";
import type { Aggregate, ChatMessage, MessageSource } from "./types.js";

export async function run(source: MessageSource) {
  const wss = new WebSocketServer({ port: config.websocketPort });
  const clients = new Set<WebSocket>();
  wss.on("connection", socket => { clients.add(socket); socket.on("close", () => clients.delete(socket)); });
  const broadcast = (data: unknown) => {
    const json = JSON.stringify(data);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(json);
  };
  const aggregator = new Aggregator((aggregate: Aggregate) => {
    console.log("counts", aggregate.counts, `messages/sec=${aggregate.messagesPerSecond.toFixed(2)}`);
    const events = mapEvents(aggregate);
    for (const event of events) console.log("sim event", JSON.stringify(event));
    broadcast({ type: "tick", aggregate, events });
  });
  source.onMessage((message: ChatMessage) => aggregator.add(message));
  wss.on("listening", () => console.log(`WebSocket listening on :${config.websocketPort}`));
  aggregator.start();
  await source.connect();
  const stop = async () => { aggregator.stop(); await source.close(); wss.close(); process.exit(0); };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
