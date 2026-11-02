import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/press-start-2p/400.css";
import { ChatCity, themeFromSearch } from "./city.js";
import { CityHud } from "./hud.js";
import { pixelSelect, themeOptions } from "./dropdown.js";
import "./dropdown.css";
import { TwitchChatFeed } from "./chat.js";
import { DemoFeed, TwitchExtensionFeed, WebSocketFeed, readBroadcasterConfig, waitForBroadcasterConfig } from "./transport.js";
import type { CityFeed, CityTick } from "./transport.js";
import "./style.css";

const params = new URLSearchParams(location.search);
const extension = TwitchExtensionFeed.available();
// On Twitch the streamer chooses the theme on the extension's configuration page; viewers cannot.
const broadcaster = extension ? await waitForBroadcasterConfig() : {};
if (extension) {
  if (broadcaster.theme) params.set("theme", broadcaster.theme);
  if (broadcaster.corner) params.set("corner", broadcaster.corner);
  if (broadcaster.size) params.set("size", broadcaster.size);
  // If the streamer changes the look mid-stream, rebuild with it.
  window.Twitch!.ext.configuration.onChanged(() => {
    const next = readBroadcasterConfig();
    if (next.theme !== broadcaster.theme || next.corner !== broadcaster.corner || next.size !== broadcaster.size) location.reload();
  });
}
// Overlay mode: transparent canvas, the city floats in a corner over the stream.
// ?channel=<name> reads that channel's chat directly in the browser (used by the browser extension).
const chatChannel = params.get("channel")?.toLowerCase().replace(/[^a-z0-9_]/g, "");
const overlay = extension || params.has("overlay");
document.documentElement.classList.toggle("overlay", overlay);
document.documentElement.classList.toggle("in-player", params.has("player"));
// ?scene: the full-screen stream scene for OBS - city, progress bar and Hall of Fame, no controls.
document.documentElement.classList.toggle("scene", !overlay && params.has("scene"));
// ?clean: no panels or buttons at all, just the city (for cinematic shots).
document.documentElement.classList.toggle("clean", params.has("clean"));
// Demo and idle pages are for recording: hide the mouse pointer everywhere on the page.
document.documentElement.classList.toggle("no-cursor", params.has("demo") || params.has("idle"));
document.documentElement.dataset.corner = params.get("corner") ?? "br";
document.documentElement.dataset.area = params.get("area") === "page" ? "page" : "player";
document.documentElement.dataset.fullscreen = params.get("fullscreen") === "1" ? "1" : "0";
document.documentElement.dataset.size = params.get("size") ?? "medium";

const host = document.querySelector<HTMLDivElement>("#app")!;
const city = new ChatCity(host, themeFromSearch(`?${params}`), {
  transparent: overlay,
  zoom: Number(params.get("zoom")) || (overlay ? 1.25 : 1),
  pixelSize: Number(params.get("pixel")) || 1.5,
  maxFps: Number(params.get("fps")) || (overlay ? 30 : 60),
  // Day and night follow the viewer's own clock unless a zone is given (the streamer can pin theirs).
  timeZone: params.get("tz") ?? broadcaster.timeZone ?? undefined,
  hour: params.has("hour") ? Number(params.get("hour")) : undefined
});
city.onUpkeep = (kind, at) => hud.upkeepPop(kind, city.screenPoint(at));
city.onNotice = notice => {
  hud.notice(notice.kind, notice.user, notice.at ? city.screenPoint(notice.at) : undefined, { level: notice.level, cost: notice.cost, title: notice.title });
};
// A stand-in stream background when the overlay is opened on its own for a demo (?demo or ?preview).
if (overlay && !extension && (params.has("demo") || params.has("preview"))) document.documentElement.classList.add("preview");

if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { chatCity: ChatCity }).chatCity = city;
const hud = new CityHud({
  overlay,
  screenPoint: () => city.screenPoint(city.focus),
  speakerPoint: () => city.speakerPoint(),
  scatterPoint: () => city.scatterPoint(),
  featuredHome: () => city.featuredHome(),
  capitolName: stage => city.capitolName(stage),
  cityName: chatChannel ? `${chatChannel} city` : params.get("name") ?? undefined
});

// Quarter-turn camera: Q / E or the on-screen buttons; the browser extension sends messages instead.
const rotate = (steps: number) => city.rotateView(steps);
// Look around: wheel / pinch zoom toward the cursor, drag to pan, double-click to dive in,
// WASD or arrows to move, + / - to zoom, F to follow the action, 0 or Home to reset.
const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1],
  a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0]
};
const held = new Set<string>();
addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === "q" || key === "[") rotate(-1);
  else if (key === "e" || key === "]") rotate(1);
  else if (key === "+" || key === "=") city.zoomBy(1.35);
  else if (key === "-" || key === "_") city.zoomBy(1 / 1.35);
  else if (key === "0" || key === "home") { city.resetView(); syncFollow(); }
  else if (key === "f") { city.toggleFollow(); syncFollow(); }
  else if (PAN_KEYS[key]) { held.add(key); event.preventDefault(); }
});
addEventListener("keyup", event => held.delete(event.key.toLowerCase()));
addEventListener("blur", () => held.clear());
let panFrame = 0;
let lastPanFrame = 0;
const panLoop = (now: number) => {
  panFrame = 0;
  const dt = Math.min(0.05, (now - lastPanFrame) / 1000);
  lastPanFrame = now;
  let right = 0, up = 0;
  for (const key of held) { right += PAN_KEYS[key][0]; up += PAN_KEYS[key][1]; }
  if (right || up) { city.panBy(right * dt * 1.6, up * dt * 1.6); syncFollow(); }
  schedulePan();
};
const schedulePan = () => {
  if (held.size && !panFrame) {
    lastPanFrame = performance.now();
    panFrame = requestAnimationFrame(panLoop);
  }
};
const stopPan = () => { if (!held.size && panFrame) { cancelAnimationFrame(panFrame); panFrame = 0; } };
addEventListener("keydown", schedulePan);
addEventListener("keyup", stopPan);
addEventListener("blur", stopPan);

if (!overlay) {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  host.style.touchAction = "none";
  host.addEventListener("wheel", event => {
    event.preventDefault();
    // Trackpads send many small deltas, mouse wheels a few large ones; both feel even this way.
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    city.zoomBy(Math.exp(-delta * 0.0025), event.clientX, event.clientY);
    syncFollow();
  }, { passive: false });
  host.addEventListener("pointerdown", event => {
    host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    host.classList.add("dragging");
  });
  host.addEventListener("pointermove", event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) city.dragPan(previous.x, previous.y, next.x, next.y);
    pointers.set(event.pointerId, next);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) city.zoomBy(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = distance;
    }
    syncFollow();
  });
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!pointers.size) host.classList.remove("dragging");
  };
  host.addEventListener("pointerup", release);
  host.addEventListener("pointercancel", release);
  host.addEventListener("dblclick", event => { city.lookAt(event.clientX, event.clientY, event.shiftKey ? 0.5 : 2); syncFollow(); });
  host.addEventListener("contextmenu", event => event.preventDefault());
}

// ---------- overlay on Twitch: the page forwards wheel / drag / move from a hit box over the city ----------
if (overlay && window.parent !== window) {
  /** Tell the page where the city and its bar are, so its hit box can sit exactly on top. */
  const reportRect = () => {
    const board = document.querySelector(".scoreboard")?.getBoundingClientRect();
    const city = host.getBoundingClientRect();
    const top = city.top, left = Math.min(city.left, board?.left ?? city.left);
    const right = Math.max(city.right, board?.right ?? city.right), bottom = Math.max(city.bottom, board?.bottom ?? city.bottom);
    window.parent.postMessage({ type: "chat-city:rect", left, top, width: right - left, height: bottom - top, cityHeight: city.height }, "*");
  };
  addEventListener("resize", reportRect);
  setInterval(reportRect, 1000);
  setTimeout(reportRect, 100);
  addEventListener("message", event => {
    const data = event.data as { type?: string; x?: number; y?: number; x2?: number; y2?: number; delta?: number; fx?: number; fy?: number } | undefined;
    const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
    if (data?.type === "chat-city:wheel" && num(data.x) && num(data.y) && num(data.delta)) { city.zoomBy(Math.exp(-Math.max(-400, Math.min(400, data.delta)) * 0.0025), data.x, data.y); syncFollow(); }
    if (data?.type === "chat-city:drag" && num(data.x) && num(data.y) && num(data.x2) && num(data.y2)) { city.dragPan(data.x, data.y, data.x2, data.y2); syncFollow(); }
    if (data?.type === "chat-city:dive" && num(data.x) && num(data.y)) { city.lookAt(data.x, data.y, 2); syncFollow(); }
    // Testing reset: wipe the saved city and start over from a campfire.
    // The page then rebuilds this frame (a reload from inside the frame can trip browser prompts).
    if (data?.type === "chat-city:wipe") void (async () => {
      if (feed instanceof TwitchChatFeed) await feed.wipe();
      window.parent.postMessage({ type: "chat-city:wiped" }, "*");
    })();
    // The page says whether the video sits behind the widget (theater mode etc.): rise above its controls.
    if (data?.type === "chat-city:overstream") { document.documentElement.dataset.overstream = (data as { on?: boolean }).on ? "1" : "0"; requestAnimationFrame(reportRect); }
    // Where the viewer dragged the widget, as a fraction of the player, from its home corner.
    if (data?.type === "chat-city:place" && num(data.fx) && num(data.fy)) {
      document.documentElement.style.setProperty("--dx", `${Math.max(-1, Math.min(1, data.fx)) * 100}vw`);
      document.documentElement.style.setProperty("--dy", `${Math.max(-1, Math.min(1, data.fy)) * 100}vh`);
      requestAnimationFrame(reportRect);
    }
  });
}

addEventListener("message", event => {
  const data = event.data as { type?: string; steps?: number; factor?: number; right?: number; up?: number } | undefined;
  if (data?.type === "chat-city:rotate" && (data.steps === 1 || data.steps === -1)) rotate(data.steps);
  if (data?.type === "chat-city:zoom" && typeof data.factor === "number" && data.factor > 0.2 && data.factor < 5) city.zoomBy(data.factor);
  if (data?.type === "chat-city:pan" && typeof data.right === "number" && typeof data.up === "number") city.panBy(Math.max(-1, Math.min(1, data.right)), Math.max(-1, Math.min(1, data.up)));
  if (data?.type === "chat-city:reset") city.resetView();
  if (data?.type === "chat-city:follow") city.toggleFollow();
  syncFollow();
});
let followButton: HTMLButtonElement | null = null;
function syncFollow() { followButton?.classList.toggle("on", city.following); }
if (!overlay) {
  const controls = document.createElement("div");
  controls.className = "view-controls";
  controls.innerHTML = '<button type="button" data-steps="-1" aria-label="Rotate view left" title="Rotate left (Q)"><svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h1v1h3v1H4v1H3V3H2V2h1zM1 3h1v3h4V5h1v2H1z"/></svg></button><button type="button" data-steps="1" aria-label="Rotate view right" title="Rotate right (E)"><svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 1h1v1h1v1H5v1H4V3H1V2h3zM1 5h1v1h4V3h1v4H1z"/></svg></button>';
  controls.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest("button");
    const steps = Number(button?.dataset.steps);
    if (steps) rotate(steps);
    const action = button?.dataset.view;
    if (action === "in") city.zoomBy(1.5);
    if (action === "out") city.zoomBy(1 / 1.5);
    if (action === "reset") city.resetView();
    if (action === "follow") city.toggleFollow();
    syncFollow();
  });
  const pixel = (path: string) => `<svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
  controls.insertAdjacentHTML("afterbegin",
    `<button type="button" data-view="out" aria-label="Zoom out" title="Zoom out (-, wheel)">${pixel("M1 3h6v2H1z")}</button>` +
    `<button type="button" data-view="in" aria-label="Zoom in" title="Zoom in (+, wheel, double-click)">${pixel("M3 1h2v2h2v2H5v2H3V5H1V3h2z")}</button>` +
    `<button type="button" data-view="follow" aria-label="Follow the action" title="Follow the action (F)">${pixel("M3 0h2v1h1v1h1v4H6v1H5v1H3V7H2V6H1V2h1V1h1zm0 3v2h2V3z")}</button>` +
    `<button type="button" data-view="reset" aria-label="Reset view" title="Reset view (0)">${pixel("M1 1h3v1H2v2H1zm3 0h3v3H6V2H4zM1 4h1v2h2v1H1zm5 0h1v3H4V6h2z")}</button>`);
  followButton = controls.querySelector('[data-view="follow"]');
  document.body.appendChild(controls);
}

const status = document.createElement("div");
status.className = "status-chip";
document.body.appendChild(status);

if (!overlay) {
  const panel = document.createElement("div");
  panel.className = "debug";
  panel.innerHTML = '<div class="debug-title"><span class="live-dot"></span>CHAT CITY</div><div class="debug-stage"></div><div class="theme-picker"><span>CIV</span></div><div class="debug-rate">…</div><div class="debug-counts"></div>';
  document.body.appendChild(panel);
  panel.querySelector(".theme-picker")!.appendChild(pixelSelect(themeOptions(), city.selectedThemeId, theme => {
    const url = new URL(location.href);
    url.searchParams.set("theme", theme);
    location.assign(url);
  }, "Choose civilization theme"));
}
const stage = document.querySelector<HTMLDivElement>(".debug-stage");
const rate = document.querySelector<HTMLDivElement>(".debug-rate");
const counts = document.querySelector<HTMLDivElement>(".debug-counts");
const updateStage = () => { if (stage) stage.textContent = `${city.stage} · ${city.themeName} · ${city.landArea} TILES`; };
updateStage();

// ---------- bedtime ----------
// The city sleeps when the stream is offline: the backend disconnects, the Twitch page says the
// channel is offline (browser extension), or chat has been silent for a while.
const sleepAfterMs = params.has("idle") ? Infinity : (Number(params.get("sleepAfter")) || 240) * 1000;
let lastChatAt = performance.now();
let feedOffline = false;
let pageOffline = false;
const forceSleep = params.get("sleep") === "1";
const updateSleep = () => {
  const silent = performance.now() - lastChatAt > sleepAfterMs;
  const asleep = forceSleep || feedOffline || pageOffline || silent;
  city.setAsleep(asleep);
  hud.setSleeping(asleep, () => city.sleepyPoints());
};
setInterval(updateSleep, 2000);
addEventListener("message", event => {
  const data = event.data as { type?: string; live?: boolean } | undefined;
  if (data?.type === "chat-city:stream" && typeof data.live === "boolean") { pageOffline = !data.live; updateSleep(); }
});

// ---------- catching up ----------
// A late joiner (a new OBS source, a viewer opening the extension) receives the city's whole past
// at once. It is rebuilt in short slices with rendering paused, so the page never locks up and
// the finished city appears in one go instead of crawling in over minutes.
const pending: CityTick[] = [];
let draining = false;
const loader = document.createElement("div");
loader.className = "catch-up";
loader.hidden = true;
document.body.appendChild(loader);
/** One broken event must never stall an on-stream overlay: log it and move on. */
const safely = (work: () => void) => { try { work(); } catch (error) { console.error("chat city: skipped event", error); } };
const drain = () => {
  const started = performance.now();
  while (pending.length && performance.now() - started < 6) {
    const tick = pending[0];
    if (tick.replay && tick.events.length > 40) {
      const done = (tick as CityTick & { applied?: number }).applied ?? 0;
      if (done === 0) { city.setCatchingUp(true); loader.hidden = false; }
      let index = done;
      while (index < tick.events.length && performance.now() - started < 6) safely(() => city.apply(tick.events[index++], true));
      (tick as CityTick & { applied?: number }).applied = index;
      loader.textContent = `REBUILDING CITY · ${Math.round((index / tick.events.length) * 100)}%`;
      if (index < tick.events.length) break;
      pending.shift();
      safely(() => applyTick({ ...tick, events: [] }));
      city.setCatchingUp(false);
      loader.hidden = true;
      continue;
    }
    pending.shift();
    safely(() => applyTick(tick));
  }
  if (pending.length) requestAnimationFrame(drain); else draining = false;
};
const onTick = (tick: CityTick) => {
  const previous = pending[pending.length - 1];
  // If the renderer falls behind, retain every event but collapse stale score-only ticks into
  // the newest snapshot. This bounds queue growth during a burst without losing city changes.
  if (previous && !tick.replay && !previous.replay) {
    previous.events.push(...tick.events);
    previous.aggregate = tick.aggregate;
    previous.progress = tick.progress;
    previous.score = tick.score;
  } else pending.push(tick);
  if (!draining) { draining = true; drain(); }
};

const applyTick = (tick: CityTick) => {
  const replay = Boolean(tick.replay);
  if (!replay && tick.aggregate && tick.aggregate.messagesPerSecond > 0) {
    const wasSilent = performance.now() - lastChatAt > sleepAfterMs;
    lastChatAt = performance.now();
    if (wasSilent) updateSleep();
  }
  if (tick.progress) {
    hud.setProgress(tick.progress);
    city.setCommunityProgress(tick.progress.recovery);
  }
  if (tick.score) hud.setScore(tick.score, replay);
  for (const event of tick.events) {
    city.apply(event, replay);
    if (replay) continue;
    hud.event(event);
  }
  // Running totals since the city was founded, not a per-second rate.
  const activity = tick.score?.activity;
  if (activity && rate && counts) {
    const c = activity.counts;
    rate.textContent = `${activity.messages.toLocaleString()} MESSAGES`;
    counts.innerHTML = `<span>CHAT <b>${c.COMMENT.toLocaleString()}</b></span><span>IDEAS <b>${c.QUESTION.toLocaleString()}</b></span><span>SPAM <b>${c.SPAM.toLocaleString()}</b></span><span>RAIDS <b>${c.RAID.toLocaleString()}</b></span>`;
  }
  updateStage();
};

const wsPortParam = Number(params.get("wsPort") ?? 8787);
const wsPort = Number.isFinite(wsPortParam) && wsPortParam > 0 ? wsPortParam : 8787;
const feed: CityFeed = extension ? new TwitchExtensionFeed(params.get("ebs") ?? undefined)
  : chatChannel ? new TwitchChatFeed(chatChannel)
  // ?idle: no chat at all - just the founding campfire (for an opening shot). It never falls asleep.
  : params.has("idle") ? { start: (_tick: (tick: CityTick) => void, onStatus: (status: string) => void) => onStatus("QUIET"), stop: () => {} }
  // ?levelup=<n>: demo eras come n times faster, to show level-ups in a short recording.
  : params.has("demo") ? new DemoFeed(Number(params.get("demo")) || 1, Math.max(1, Number(params.get("levelup")) || 1))
  : new WebSocketFeed(`${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname || "localhost"}:${wsPort}`);
const startFeed = () => feed.start(onTick, text => {
  status.textContent = text;
  feedOffline = /OFFLINE|DISCONNECTED/i.test(text);
  if (!feedOffline) lastChatAt = performance.now();
  updateSleep();
});
// ?delay=<seconds>: hold the chat back for a while (a quiet campfire first, e.g. when recording).
const delaySeconds = Number(params.get("delay")) || 0;

// ---------- ?intro: the opening shot ----------
// Fade up from black on a close-up of the lone campfire, hold, then pull the camera slowly back
// to reveal the empty plot. Chat only starts once the shot is done (or after ?delay, if longer).
const INTRO = { fade: 1.2, hold: 3.3, zoomOut: 6.5, settle: 1, closeUp: 7 };
const introSeconds = INTRO.fade + INTRO.hold + INTRO.zoomOut + INTRO.settle;
if (params.has("intro")) {
  const curtain = document.createElement("div");
  curtain.className = "intro-curtain";
  document.body.appendChild(curtain);
  city.resetView();
  let begin = performance.now();
  // Under the black curtain: once the camera has rendered a frame, centre on the campfire and cut in close.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fire = city.screenPoint(city.focus);
    const box = host.getBoundingClientRect();
    if (Number.isFinite(fire.x) && Number.isFinite(fire.y)) city.lookAt(box.left + fire.x, box.top + fire.y, 1);
    city.zoomBy(INTRO.closeUp);
    begin = performance.now();
    requestAnimationFrame(step);
  }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const step = (now: number) => {
    const seconds = (now - begin) / 1000;
    curtain.style.opacity = String(Math.max(0, 1 - seconds / INTRO.fade));
    const t = Math.min(1, Math.max(0, (seconds - INTRO.fade - INTRO.hold) / INTRO.zoomOut));
    // Zoom on a log scale so the pull-back feels even all the way out.
    const wanted = Math.exp(Math.log(INTRO.closeUp) * (1 - smooth(t)));
    city.zoomBy(wanted / city.viewerZoom);
    if (t < 1) requestAnimationFrame(step); else curtain.remove();
  };
}
const startAfter = Math.max(delaySeconds, params.has("intro") ? introSeconds : 0);
if (startAfter > 0) setTimeout(startFeed, startAfter * 1000); else startFeed();
updateSleep();
window.addEventListener("beforeunload", () => { feed.stop(); city.destroy(); });
