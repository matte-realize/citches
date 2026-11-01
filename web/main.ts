import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/press-start-2p/400.css";
import { ChatCity, themeFromSearch } from "./city.js";
import { CityHud } from "./hud.js";
import { TwitchChatFeed } from "./chat.js";
import { DemoFeed, TwitchExtensionFeed, WebSocketFeed } from "./transport.js";
import type { CityFeed, CityTick } from "./transport.js";
import "./style.css";

const params = new URLSearchParams(location.search);
const extension = TwitchExtensionFeed.available();
// Overlay mode: transparent canvas, the city floats in a corner over the stream.
// ?channel=<name> reads that channel's chat directly in the browser (used by the browser extension).
const chatChannel = params.get("channel")?.toLowerCase().replace(/[^a-z0-9_]/g, "");
const overlay = extension || params.has("overlay");
document.documentElement.classList.toggle("overlay", overlay);
document.documentElement.classList.toggle("in-player", params.has("player"));
document.documentElement.dataset.corner = params.get("corner") ?? "br";
document.documentElement.dataset.size = params.get("size") ?? "medium";

const host = document.querySelector<HTMLDivElement>("#app")!;
const city = new ChatCity(host, themeFromSearch(), {
  transparent: overlay,
  zoom: Number(params.get("zoom")) || (overlay ? 1.25 : 1),
  pixelSize: Number(params.get("pixel")) || 1.5,
  maxFps: Number(params.get("fps")) || (overlay ? 30 : 60)
});
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { chatCity: ChatCity }).chatCity = city;
const hud = new CityHud({
  overlay,
  screenPoint: () => city.screenPoint(city.focus),
  speakerPoint: () => city.speakerPoint(),
  cityName: chatChannel ? `${chatChannel} city` : params.get("name") ?? undefined
});

// Quarter-turn camera: Q / E or the on-screen buttons; the browser extension sends messages instead.
const rotate = (steps: number) => city.rotateView(steps);
addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "q" || event.key === "Q" || event.key === "[") rotate(-1);
  if (event.key === "e" || event.key === "E" || event.key === "]") rotate(1);
});
addEventListener("message", event => {
  const data = event.data as { type?: string; steps?: number } | undefined;
  if (data?.type === "chat-city:rotate" && (data.steps === 1 || data.steps === -1)) rotate(data.steps);
});
if (!overlay) {
  const controls = document.createElement("div");
  controls.className = "view-controls";
  controls.innerHTML = '<button type="button" data-steps="-1" aria-label="Rotate view left" title="Rotate left (Q)"><svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h1v1h3v1H4v1H3V3H2V2h1zM1 3h1v3h4V5h1v2H1z"/></svg></button><button type="button" data-steps="1" aria-label="Rotate view right" title="Rotate right (E)"><svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 1h1v1h1v1H5v1H4V3H1V2h3zM1 5h1v1h4V3h1v4H1z"/></svg></button>';
  controls.addEventListener("click", event => {
    const steps = Number((event.target as HTMLElement).closest("button")?.dataset.steps);
    if (steps) rotate(steps);
  });
  document.body.appendChild(controls);
}

const status = document.createElement("div");
status.className = "status-chip";
document.body.appendChild(status);

if (!overlay) {
  const panel = document.createElement("div");
  panel.className = "debug";
  panel.innerHTML = '<div class="debug-title"><span class="live-dot"></span>CHAT CITY</div><div class="debug-stage"></div><label class="theme-picker">CIV <select aria-label="Choose civilization theme"><option value="egypt">Nile Kingdom</option><option value="rome">Roman Republic</option><option value="norse">Norse Settlement</option><option value="japan">Imperial Japan</option></select></label><div class="debug-rate">…</div><div class="debug-counts"></div>';
  document.body.appendChild(panel);
  const picker = panel.querySelector<HTMLSelectElement>("select")!;
  picker.value = city.selectedThemeId;
  picker.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("theme", picker.value);
    location.assign(url);
  });
}
const stage = document.querySelector<HTMLDivElement>(".debug-stage");
const rate = document.querySelector<HTMLDivElement>(".debug-rate");
const counts = document.querySelector<HTMLDivElement>(".debug-counts");
const updateStage = () => { if (stage) stage.textContent = `${city.stage} · ${city.themeName} · ${city.landArea} TILES`; };
updateStage();

const onTick = (tick: CityTick) => {
  const replay = Boolean(tick.replay);
  if (tick.progress) {
    hud.setProgress(tick.progress);
    city.setCommunityProgress(tick.progress.recovery);
  }
  if (tick.score) hud.setScore(tick.score, replay);
  for (const event of tick.events) {
    city.apply(event, replay);
    if (!replay) hud.event(event);
  }
  if (tick.aggregate && rate && counts) {
    const c = tick.aggregate.counts;
    rate.textContent = `${tick.aggregate.messagesPerSecond.toFixed(1)} MSG/SEC`;
    counts.innerHTML = `<span>CHAT <b>${c.COMMENT}</b></span><span>IDEAS <b>${c.QUESTION}</b></span><span>SPAM <b>${c.SPAM}</b></span><span>RAIDS <b>${c.RAID}</b></span>`;
  }
  updateStage();
};

const wsPortParam = Number(params.get("wsPort") ?? 8787);
const wsPort = Number.isFinite(wsPortParam) && wsPortParam > 0 ? wsPortParam : 8787;
const feed: CityFeed = extension ? new TwitchExtensionFeed(params.get("ebs") ?? undefined)
  : chatChannel ? new TwitchChatFeed(chatChannel)
  : params.has("demo") ? new DemoFeed(Number(params.get("demo")) || 1)
  : new WebSocketFeed(`${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname || "localhost"}:${wsPort}`);
feed.start(onTick, text => { status.textContent = text; });
window.addEventListener("beforeunload", () => { feed.stop(); city.destroy(); });
