import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/press-start-2p/400.css";
import { ChatCity, themeFromSearch } from "./city.js";
import { CityHud } from "./hud.js";
import { DemoFeed, TwitchExtensionFeed, WebSocketFeed } from "./transport.js";
import type { CityFeed, CityTick } from "./transport.js";
import "./style.css";

const params = new URLSearchParams(location.search);
const extension = TwitchExtensionFeed.available();
// Overlay mode: transparent canvas, the city floats in a corner over the stream.
const overlay = extension || params.has("overlay");
document.documentElement.classList.toggle("overlay", overlay);
document.documentElement.dataset.corner = params.get("corner") ?? "br";

const host = document.querySelector<HTMLDivElement>("#app")!;
const city = new ChatCity(host, themeFromSearch(), {
  transparent: overlay,
  zoom: Number(params.get("zoom")) || (overlay ? 1.25 : 1),
  pixelSize: Number(params.get("pixel")) || 1
});
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { chatCity: ChatCity }).chatCity = city;
const hud = new CityHud({ overlay, screenPoint: () => city.screenPoint(city.focus) });

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
  : params.has("demo") ? new DemoFeed(Number(params.get("demo")) || 1)
  : new WebSocketFeed(`${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname || "localhost"}:${wsPort}`);
feed.start(onTick, text => { status.textContent = text; });
window.addEventListener("beforeunload", () => { feed.stop(); city.destroy(); });
