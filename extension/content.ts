import { channelFromUrl, chromeApi, loadSettings } from "./settings.js";
import type { ChatCitySettings } from "./settings.js";

/**
 * Runs on twitch.tv. Finds the video player and lays a transparent city iframe over it. Twitch is
 * a single-page app, so this re-checks the URL and player as you navigate between channels.
 */
const FRAME_ID = "chat-city-overlay";
const CONTROLS_ID = "chat-city-controls";
const PLAYER_SELECTORS = [".video-player__container", "[data-a-target='video-player']", ".video-player"];
let settings: ChatCitySettings | undefined;

function findPlayer() {
  for (const selector of PLAYER_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && element.offsetWidth > 200) return element;
  }
  return undefined;
}

function overlayUrl(channel: string, current: ChatCitySettings) {
  const params = new URLSearchParams({ channel, overlay: "1", player: "1", theme: current.theme, corner: current.corner, size: current.size });
  return chromeApi().runtime.getURL(`overlay.html?${params}`);
}

function sync() {
  const existing = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
  const channel = channelFromUrl(location.href);
  const player = findPlayer();
  if (!settings?.enabled || !channel || !player) { existing?.remove(); document.getElementById(CONTROLS_ID)?.remove(); return; }
  const src = overlayUrl(channel, settings);
  if (existing && existing.parentElement === player && existing.dataset.src === src) return;
  existing?.remove();
  if (getComputedStyle(player).position === "static") player.style.position = "relative";
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.dataset.src = src;
  frame.src = src;
  frame.title = "Chat City";
  frame.setAttribute("allowtransparency", "true");
  // Clicks pass straight through to the Twitch player underneath.
  Object.assign(frame.style, { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", background: "transparent", pointerEvents: "none", zIndex: "3", colorScheme: "normal" });
  player.appendChild(frame);
  addControls(player, frame, settings);
}

/** Rotate buttons live on the Twitch page (the overlay itself lets every click through). */
function addControls(player: HTMLElement, frame: HTMLIFrameElement, current: ChatCitySettings) {
  document.getElementById(CONTROLS_ID)?.remove();
  const controls = document.createElement("div");
  controls.id = CONTROLS_ID;
  const side = current.corner === "bl" ? { left: "12px" } : { right: "12px" };
  Object.assign(controls.style, { position: "absolute", top: "12px", ...side, zIndex: "4", display: "flex", gap: "6px", opacity: "0", transition: "opacity .2s" });
  for (const [label, steps] of [['<svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h1v1h3v1H4v1H3V3H2V2h1zM1 3h1v3h4V5h1v2H1z"/></svg>', -1], ['<svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 1h1v1h1v1H5v1H4V3H1V2h3zM1 5h1v1h4V3h1v4H1z"/></svg>', 1]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = label;
    button.title = steps < 0 ? "Rotate city left" : "Rotate city right";
    Object.assign(button.style, { display: "grid", placeItems: "center", width: "34px", height: "34px", color: "#f4ecd8", background: "#1b2433", border: "0", cursor: "pointer", boxShadow: "0 0 0 3px #10141c, inset 0 3px 0 #2a3850, inset 0 -3px 0 #121925" });
    button.addEventListener("click", event => {
      event.stopPropagation();
      frame.contentWindow?.postMessage({ type: "chat-city:rotate", steps }, new URL(chromeApi().runtime.getURL("")).origin);
    });
    controls.appendChild(button);
  }
  // Show with the player's own controls: on hover.
  player.addEventListener("mouseenter", () => { controls.style.opacity = "1"; });
  player.addEventListener("mouseleave", () => { controls.style.opacity = "0"; });
  player.appendChild(controls);
}

async function start() {
  settings = await loadSettings();
  sync();
  setInterval(sync, 1000);
  new MutationObserver(() => sync()).observe(document.body, { childList: true, subtree: true });
  chromeApi().storage.onChanged.addListener(async (changes, area) => {
    if (area === "sync" && changes.settings) { settings = await loadSettings(); sync(); }
  });
}
void start();
