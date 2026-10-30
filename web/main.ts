import { ChatCity, themeFromSearch } from "./city.js";
import "./style.css";

const host = document.querySelector<HTMLDivElement>("#app")!;
const city = new ChatCity(host, themeFromSearch());
const overlay = document.createElement("div");
overlay.className = "debug";
overlay.innerHTML = '<div class="debug-title"><span class="live-dot"></span>FANDOM CITY <span class="debug-subtitle">COMMUNITY BUILT</span></div><div class="debug-stage"></div><label class="theme-picker">CITY THEME <select aria-label="Choose civilization theme"><option value="ancient">Ancient Empire</option><option value="fantasy">Mythic Realm</option><option value="solarpunk">Solarpunk Haven</option><option value="cyberpunk">Neon Megacity</option></select></label><div class="debug-rate">Connecting…</div><div class="debug-counts"></div>';
document.body.appendChild(overlay);
const themePicker = overlay.querySelector<HTMLSelectElement>(".theme-picker select")!;
themePicker.value = city.selectedThemeId;
themePicker.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("theme", themePicker.value);
  location.assign(url);
});
const rate = overlay.querySelector<HTMLDivElement>(".debug-rate")!;
const stage = overlay.querySelector<HTMLDivElement>(".debug-stage")!;
const countsView = overlay.querySelector<HTMLDivElement>(".debug-counts")!;
const updateStage = () => { stage.textContent = `${city.stage} · ${city.themeName} · ${city.landArea} TILE PLOT`; };
updateStage();

const hostName = location.hostname || "localhost";
const wsPortParam = Number(new URLSearchParams(location.search).get("wsPort") ?? 8787);
const wsPort = Number.isFinite(wsPortParam) && wsPortParam > 0 ? wsPortParam : 8787;
const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${socketProtocol}://${hostName}:${wsPort}`);
socket.onopen = () => { rate.textContent = "Connected · waiting for chat"; };
socket.onmessage = message => {
  const data = JSON.parse(message.data);
  if (data.type !== "tick") return;
  const { counts, messagesPerSecond, supportPoints = 0 } = data.aggregate;
  rate.textContent = `${messagesPerSecond.toFixed(1)} messages / sec`;
  countsView.innerHTML = `
    <span><i class="swatch comment"></i>BUILDERS <b>${counts.COMMENT}</b></span>
    <span><i class="swatch question"></i>IDEAS <b>${counts.QUESTION}</b></span>
    <span><i class="swatch support"></i>FAN SUPPORT <b>${supportPoints.toFixed(1)}</b></span>
    <span><i class="swatch spam"></i>SPAM <b>${counts.SPAM}</b></span>
    <span><i class="swatch raid"></i>RAIDS <b>${counts.RAID}</b></span>
    <span><i class="swatch hate"></i>HATE <b>${counts.HATE}</b></span>`;
  for (const event of data.events) city.apply(event, Boolean(data.replay));
  updateStage();
};
socket.onclose = () => { rate.textContent = "Backend disconnected"; };
window.addEventListener("beforeunload", () => { socket.close(); city.destroy(); });
