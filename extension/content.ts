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
  // Twitch renames classes now and then: fall back to the biggest video on the page.
  const video = Array.from(document.querySelectorAll<HTMLVideoElement>("video"))
    .filter(element => element.offsetWidth > 200)
    .sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
  return video?.parentElement ?? undefined;
}

/** One console line per change of state, so "I see nothing" is easy to diagnose. */
let lastStatus = "";
function status(message: string) {
  if (message === lastStatus) return;
  lastStatus = message;
  console.info(`[Chat City] ${message}`);
}

function overlayUrl(channel: string, current: ChatCitySettings) {
  const params = new URLSearchParams({ channel, overlay: "1", player: "1", theme: current.theme, corner: current.corner, size: current.size, area: current.area, fullscreen: document.fullscreenElement ? "1" : "0" });
  return chromeApi().runtime.getURL(`overlay.html?${params}`);
}

/** Where the overlay lives: the whole page (or the fullscreen element), or the video player. */
function findHost(current: ChatCitySettings): HTMLElement | undefined {
  if (current.area === "player") return findPlayer();
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}

function sync() {
  const existing = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
  const channel = channelFromUrl(location.href);
  const host = settings ? findHost(settings) : undefined;
  if (!settings?.enabled || !channel || !host) {
    status(!settings?.enabled ? "turned off in the popup" : !channel ? "not a channel page" : `waiting for the video player on ${channel}`);
    existing?.remove(); document.getElementById(CONTROLS_ID)?.remove(); return;
  }
  const src = overlayUrl(channel, settings);
  if (existing && existing.parentElement === host && existing.dataset.src === src) return;
  existing?.remove();
  const page = settings.area === "page";
  if (!page && getComputedStyle(host).position === "static") host.style.position = "relative";
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.dataset.src = src;
  frame.src = src;
  frame.title = "Chat City";
  frame.setAttribute("allowtransparency", "true");
  // Clicks pass straight through to Twitch underneath; only the city itself takes the mouse (see addControls).
  Object.assign(frame.style, page
    ? { position: "fixed", inset: "0", width: "100vw", height: "100vh", border: "0", background: "transparent", pointerEvents: "none", zIndex: "2147483000", colorScheme: "normal" }
    : { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", background: "transparent", pointerEvents: "none", zIndex: "3", colorScheme: "normal" });
  host.appendChild(frame);
  frame.addEventListener("load", () => status(`overlay loaded on ${channel}`), { once: true });
  status(`overlay added on ${channel} (${page ? "whole page" : `${host.offsetWidth}x${host.offsetHeight} player`}, corner ${settings.corner})`);
  addControls(host, frame, settings);
}

/**
 * The overlay frame lets every click through to the player, so the page lays an invisible hit box
 * exactly over the city (the frame reports where it is). Over the city: wheel zooms, drag pans,
 * double-click dives in. A toolbar above it (on hover) has a grip to move the whole widget, plus
 * zoom, follow, reset and rotate. Everywhere else the Twitch player works as normal.
 */
const PLACE_KEY = "chat-city:placement";
let placement = { fx: 0, fy: 0 };
let lastRect: { left: number; top: number; width: number; height: number } | undefined;
let stopListening: (() => void) | undefined;
/** Full testing reset (new city from a campfire, widget back in its corner); set once the overlay exists. */
let resetCity: () => void = () => undefined;

async function loadPlacement() {
  try {
    const saved = (await chromeApi().storage.local.get(PLACE_KEY))[PLACE_KEY] as { fx?: number; fy?: number } | undefined;
    if (saved && Number.isFinite(saved.fx) && Number.isFinite(saved.fy)) placement = { fx: saved.fx!, fy: saved.fy! };
  } catch { /* no storage: the widget starts in its corner */ }
}
function savePlacement() { try { void chromeApi().storage.local.set({ [PLACE_KEY]: placement }); } catch { /* not remembered */ } }

function addControls(player: HTMLElement, frame: HTMLIFrameElement, current: ChatCitySettings) {
  document.getElementById(CONTROLS_ID)?.remove();
  stopListening?.();
  const origin = new URL(chromeApi().runtime.getURL("")).origin;
  const send = (message: Record<string, unknown>) => frame.contentWindow?.postMessage(message, origin);
  const local = (event: { clientX: number; clientY: number }) => {
    const box = frame.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const hitbox = document.createElement("div");
  hitbox.id = CONTROLS_ID;
  const page = current.area === "page";
  Object.assign(hitbox.style, { position: page ? "fixed" : "absolute", zIndex: page ? "2147483001" : "4", cursor: "grab", touchAction: "none", display: "none" });
  // Keep Twitch from pausing, seeking or going fullscreen when the city is clicked.
  for (const type of ["click", "mousedown", "mouseup", "pointerup"]) hitbox.addEventListener(type, event => event.stopPropagation());
  hitbox.addEventListener("wheel", event => {
    event.preventDefault(); event.stopPropagation();
    const at = local(event);
    send({ type: "chat-city:wheel", x: at.x, y: at.y, delta: event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY });
  }, { passive: false });
  hitbox.addEventListener("dblclick", event => { event.preventDefault(); event.stopPropagation(); const at = local(event); send({ type: "chat-city:dive", x: at.x, y: at.y }); });
  let panFrom: { x: number; y: number } | undefined;
  hitbox.addEventListener("pointerdown", event => {
    if ((event.target as HTMLElement).closest("button, [data-grip]")) return;
    event.stopPropagation();
    hitbox.setPointerCapture(event.pointerId);
    panFrom = local(event);
    hitbox.style.cursor = "grabbing";
  });
  hitbox.addEventListener("pointermove", event => {
    if (!panFrom) return;
    const to = local(event);
    send({ type: "chat-city:drag", x: panFrom.x, y: panFrom.y, x2: to.x, y2: to.y });
    panFrom = to;
  });
  const endPan = () => { panFrom = undefined; hitbox.style.cursor = "grab"; };
  hitbox.addEventListener("pointerup", endPan);
  hitbox.addEventListener("pointercancel", endPan);

  // Toolbar: one slim pixel strip centred under the city's bar, always visible.
  // [move] | [zoom - +] | [follow] [rotate L R]. Reset is keyboard-only: Alt+Shift+R.
  const toolbar = document.createElement("div");
  Object.assign(toolbar.style, {
    position: "absolute", left: "50%", top: "100%", marginTop: "5px", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "1px",
    padding: "2px", background: "#1b2433", boxShadow: "0 0 0 2px #10141c, 3px 3px 0 rgba(0,0,0,.35)", cursor: "default"
  });
  const pixel = (path: string) => `<svg viewBox="0 0 8 8" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
  const IDLE = "transparent", HOVER = "#2a3850", PRESS = "#121925";
  const styleButton = (button: HTMLElement, color = "#f4ecd8") => {
    Object.assign(button.style, { display: "grid", placeItems: "center", width: "20px", height: "20px", padding: "0", color, background: IDLE, border: "0", cursor: "pointer", transition: "background .12s, transform .08s" });
    button.addEventListener("mouseenter", () => { if (button.dataset.on !== "1") button.style.background = HOVER; });
    button.addEventListener("mouseleave", () => { if (button.dataset.on !== "1") button.style.background = IDLE; button.style.transform = ""; });
    button.addEventListener("pointerdown", () => { button.style.transform = "translateY(1px)"; });
    button.addEventListener("pointerup", () => { button.style.transform = ""; });
  };
  const divider = () => { const line = document.createElement("span"); Object.assign(line.style, { width: "1px", height: "14px", margin: "0 2px", background: "#34425c" }); return line; };

  const grip = document.createElement("div");
  grip.dataset.grip = "1";
  grip.title = "Drag to move the city · double-click to put it back";
  grip.innerHTML = pixel("M1 1h2v2H1zm4 0h2v2H5zM1 5h2v2H1zm4 0h2v2H5z");
  styleButton(grip, "#9aa7bd");
  grip.style.cursor = "move";
  let moveFrom: { x: number; y: number; fx: number; fy: number } | undefined;
  grip.addEventListener("pointerdown", event => {
    event.stopPropagation(); event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    moveFrom = { x: event.clientX, y: event.clientY, fx: placement.fx, fy: placement.fy };
  });
  grip.addEventListener("pointermove", event => {
    if (!moveFrom || !lastRect) return;
    const width = page ? innerWidth : player.offsetWidth, height = page ? innerHeight : player.offsetHeight;
    // Keep the whole widget (and the toolbar under it) on screen.
    const startLeft = lastRect.left - (placement.fx - moveFrom.fx) * width, startTop = lastRect.top - (placement.fy - moveFrom.fy) * height;
    const dx = Math.max(-startLeft, Math.min(width - lastRect.width - startLeft, event.clientX - moveFrom.x));
    const dy = Math.max(-startTop, Math.min(height - lastRect.height - 32 - startTop, event.clientY - moveFrom.y));
    placement = { fx: moveFrom.fx + dx / width, fy: moveFrom.fy + dy / height };
    send({ type: "chat-city:place", ...placement });
  });
  grip.addEventListener("pointerup", () => { if (moveFrom) savePlacement(); moveFrom = undefined; });
  grip.addEventListener("pointercancel", () => { moveFrom = undefined; });
  grip.addEventListener("dblclick", event => { event.stopPropagation(); placement = { fx: 0, fy: 0 }; send({ type: "chat-city:place", ...placement }); savePlacement(); });

  const button = (icon: string, title: string, onClick: () => void, color?: string) => {
    const element = document.createElement("button");
    element.type = "button";
    element.innerHTML = icon;
    element.title = title;
    styleButton(element, color);
    element.addEventListener("click", event => { event.stopPropagation(); onClick(); });
    return element;
  };
  const followButton = button(pixel("M3 0h2v1h1v1h1v4H6v1H5v1H3V7H2V6H1V2h1V1h1zm0 3v2h2V3z"), "Follow the action", () => {
    send({ type: "chat-city:follow" });
    const on = followButton.dataset.on !== "1";
    followButton.dataset.on = on ? "1" : "";
    followButton.style.background = on ? "#3b5a2e" : IDLE;
  });
  resetCity = () => {
    placement = { fx: 0, fy: 0 }; savePlacement(); send({ type: "chat-city:place", ...placement });
    followButton.dataset.on = ""; followButton.style.background = IDLE;
    send({ type: "chat-city:wipe" });
    status("reset: starting a new city");
  };
  toolbar.append(
    grip, divider(),
    button(pixel("M1 3h6v2H1z"), "Zoom out (or scroll on the city)", () => send({ type: "chat-city:zoom", factor: 1 / 1.5 })),
    button(pixel("M3 1h2v2h2v2H5v2H3V5H1V3h2z"), "Zoom in (or scroll on the city)", () => send({ type: "chat-city:zoom", factor: 1.5 })),
    divider(),
    followButton,
    button(pixel("M3 1h1v1h3v1H4v1H3V3H2V2h1zM1 3h1v3h4V5h1v2H1z"), "Rotate left", () => send({ type: "chat-city:rotate", steps: -1 })),
    button(pixel("M4 1h1v1h1v1H5v1H4V3H1V2h3zM1 5h1v1h4V3h1v4H1z"), "Rotate right", () => send({ type: "chat-city:rotate", steps: 1 }))
  );
  hitbox.appendChild(toolbar);
  player.appendChild(hitbox);

  // The frame says where the city is; the hit box follows it.
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { type?: string; left?: number; top?: number; width?: number; height?: number } | undefined;
    // Wiped: drop the frame and build a fresh one.
    if (data?.type === "chat-city:wiped") { document.getElementById(FRAME_ID)?.remove(); sync(); return; }
    if (data?.type !== "chat-city:rect" || ![data.left, data.top, data.width, data.height].every(Number.isFinite)) return;
    lastRect = { left: data.left!, top: data.top!, width: data.width!, height: data.height! };
    if (page) checkOverStream();
    Object.assign(hitbox.style, { display: "block", left: `${lastRect.left}px`, top: `${lastRect.top}px`, width: `${lastRect.width}px`, height: `${lastRect.height}px` });
  };
  /**
   * Is the video behind the widget? Checks a fixed point (the widget's column, at the bottom of the
   * window), not the widget's own height, so rising can't flip the answer back. Simple on/off.
   */
  let overStream: boolean | undefined;
  const checkOverStream = () => {
    if (!lastRect) return;
    const box = findPlayer()?.getBoundingClientRect();
    const x = lastRect.left + lastRect.width / 2, y = innerHeight - 12;
    const on = Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom + 4);
    if (on === overStream) return;
    overStream = on;
    send({ type: "chat-city:overstream", on });
  };
  addEventListener("message", onMessage);
  // The popup's reset button asks the overlay to wipe itself (so it can't save the old city back).
  const onRuntime = (message: unknown) => {
    if ((message as { type?: string } | undefined)?.type !== "chat-city:wipe") return;
    resetCity();
  };
  try { chromeApi().runtime.onMessage.addListener(onRuntime); } catch { /* popup reset unavailable */ }
  stopListening = () => { removeEventListener("message", onMessage); try { chromeApi().runtime.onMessage.removeListener(onRuntime); } catch { /* ignore */ } };
  frame.addEventListener("load", () => send({ type: "chat-city:place", ...placement }));
}

/**
 * Is the channel live? Twitch marks offline channels on the player and shows a viewer count only
 * when live. The overlay also falls back to chat going quiet, so this only has to be roughly right.
 */
function streamIsLive() {
  if (document.querySelector(".channel-root__player--offline, [data-a-target='player-overlay-content-gate'] .offline")) return false;
  if (document.querySelector("[data-a-target='animated-channel-viewers-count'], .live-indicator-container, [data-a-target='live-indicator']")) return true;
  const video = document.querySelector<HTMLVideoElement>(".video-player__container video");
  return Boolean(video && video.readyState >= 2);
}

function reportLive() {
  const frame = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
  frame?.contentWindow?.postMessage({ type: "chat-city:stream", live: streamIsLive() }, new URL(chromeApi().runtime.getURL("")).origin);
}

async function start() {
  status("content script running");
  setInterval(reportLive, 5000);
  settings = await loadSettings();
  await loadPlacement();
  sync();
  setInterval(sync, 1000);
  // Alt+Shift+R (Option+Shift+R on a Mac): reset the city without touching the mouse, e.g. while recording.
  addEventListener("keydown", event => {
    if (!(event.altKey && event.shiftKey && event.code === "KeyR")) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault(); event.stopPropagation();
    resetCity();
  }, true);
  // Fullscreen video hides the rest of the page, so the city moves into the fullscreen element.
  document.addEventListener("fullscreenchange", () => sync());
  new MutationObserver(() => sync()).observe(document.body, { childList: true, subtree: true });
  try {
    chromeApi().storage.onChanged.addListener(async (changes, area) => {
      if (area === "sync" && changes.settings) { settings = await loadSettings(); sync(); }
    });
  } catch { /* no storage: settings stay at their defaults */ }
}
void start();
