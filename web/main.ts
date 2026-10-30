import { ChatCity, themeFromSearch } from "./city.js";
import "./style.css";

const host = document.querySelector<HTMLDivElement>("#app")!;
const city = new ChatCity(host, themeFromSearch());
const overlay = document.createElement("div");
overlay.className = "debug";
overlay.innerHTML = '<div class="debug-title"><span class="live-dot"></span>FANDOM CITY <span class="debug-subtitle">COMMUNITY BUILT</span></div><div class="debug-stage"></div><label class="theme-picker">CITY THEME <select aria-label="Choose civilization theme"><option value="ancient">Ancient Empire</option><option value="fantasy">Mythic Realm</option><option value="solarpunk">Solarpunk Haven</option><option value="cyberpunk">Neon Megacity</option></select></label><div class="debug-rate">Connecting…</div><div class="debug-counts"></div>';
document.body.appendChild(overlay);
const progressPanel = document.createElement("section");
progressPanel.className = "progress-panel";
progressPanel.innerHTML = '<div class="progress-heading"><span class="progress-title">NEXT CIVILIZATION MILESTONE</span><span class="progress-value">Waiting for chat</span></div><div class="progress-track" role="progressbar" aria-label="Technology milestone progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill"></div></div><div class="progress-caption">Thoughtful chat, time, and fan support advance the city.</div><div class="recovery-meter" hidden><div class="progress-heading"><span class="recovery-title">COMMUNITY RECOVERY</span><span class="recovery-value"></span></div><div class="progress-track recovery-track" role="progressbar" aria-label="Community recovery progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill recovery-fill"></div></div><div class="recovery-caption">Homes remain modest until the community can rebuild.</div></div>';
document.body.appendChild(progressPanel);
const technologyTrack = progressPanel.querySelector<HTMLDivElement>(".progress-track")!;
const technologyFill = progressPanel.querySelector<HTMLDivElement>(".progress-fill")!;
const technologyValue = progressPanel.querySelector<HTMLSpanElement>(".progress-value")!;
const technologyCaption = progressPanel.querySelector<HTMLDivElement>(".progress-caption")!;
const recoveryMeter = progressPanel.querySelector<HTMLDivElement>(".recovery-meter")!;
const recoveryTrack = progressPanel.querySelector<HTMLDivElement>(".recovery-track")!;
const recoveryFill = progressPanel.querySelector<HTMLDivElement>(".recovery-fill")!;
const recoveryValue = progressPanel.querySelector<HTMLSpanElement>(".recovery-value")!;
const recoveryCaption = progressPanel.querySelector<HTMLDivElement>(".recovery-caption")!;
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
  if (data.progress) {
    const tech = data.progress.technology;
    const techPercent = Math.max(0, Math.min(100, Math.round(tech.ratio * 100)));
    technologyFill.style.width = `${techPercent}%`;
    technologyTrack.setAttribute("aria-valuenow", String(techPercent));
    technologyValue.textContent = tech.ratio >= 1 ? "READY" : `${techPercent}%`;
    technologyCaption.textContent = tech.ratio >= 1
      ? `${tech.name} reached · community is ready for the next step.`
      : `${tech.name} · ${tech.current.toFixed(0)} / ${tech.goal.toFixed(0)} community points`;
    const recovery = data.progress.recovery;
    city.setCommunityProgress(recovery);
    recoveryMeter.hidden = !recovery.active;
    if (recovery.active) {
      const recoveryPercent = Math.max(0, Math.min(100, Math.round(recovery.ratio * 100)));
      recoveryFill.style.width = `${recoveryPercent}%`;
      recoveryTrack.setAttribute("aria-valuenow", String(recoveryPercent));
      recoveryValue.textContent = `${recoveryPercent}%`;
      recoveryCaption.textContent = `${recovery.current.toFixed(0)} / ${recovery.goal.toFixed(0)} recovery points · rebuilding at ${["camp", "hut", "home", "stone city", "industrial", "airship", "empire"][recovery.era]} level`;
    }
  }
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
