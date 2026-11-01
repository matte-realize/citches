import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/press-start-2p/400.css";
import "./dropdown.css";
import "./config.css";
import { pixelSelect, themeOptions } from "./dropdown.js";
import { waitForBroadcasterConfig } from "./transport.js";
import type { BroadcasterConfig } from "./transport.js";

/**
 * Broadcaster configuration page for the Twitch extension. Twitch only shows this page to the
 * channel owner, so the city's look is the streamer's choice; viewers just watch.
 */
const root = document.querySelector<HTMLElement>(".config")!;
const saved = await waitForBroadcasterConfig();
const config: BroadcasterConfig = { theme: "egypt", corner: "br", size: "medium", ...saved };

root.innerHTML = `
  <h1>CHAT CITY</h1>
  <p class="lead">Your chat builds this city over your stream. Pick how it looks for your viewers.</p>
  <div class="field"><span>Civilization</span><div data-field="theme"></div></div>
  <div class="field-row">
    <div class="field"><span>Corner</span><div data-field="corner"></div></div>
    <div class="field"><span>Size</span><div data-field="size"></div></div>
  </div>
  <div class="field"><span>Day and night follow</span><div data-field="timeZone"></div></div>
  <label class="field"><span>Backend address <small>(so viewers who join late see the same city)</small></span>
    <input name="ebsUrl" type="url" placeholder="https://your-backend.example.com" spellcheck="false"></label>
  <button class="save" type="button">Save</button>
  <p class="status" role="status" aria-live="polite"></p>`;

const mount = (name: string, element: HTMLElement) => root.querySelector(`[data-field="${name}"]`)!.replaceWith(element);
mount("theme", pixelSelect(themeOptions(), config.theme!, value => { config.theme = value; }, "Civilization"));
mount("corner", pixelSelect([{ value: "br", label: "Bottom right" }, { value: "bl", label: "Bottom left" }], config.corner!, value => { config.corner = value as "br" | "bl"; }, "Corner"));
mount("size", pixelSelect([{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }], config.size!, value => { config.size = value as BroadcasterConfig["size"]; }, "Size"));
// Either every viewer sees their own local time of day, or everyone sees the streamer's.
const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
mount("timeZone", pixelSelect([
  { value: "viewer", label: "Each viewer's own time", hint: "Night falls when it is night for them" },
  { value: myZone, label: `My time (${myZone.replace(/_/g, " ")})`, hint: "Everyone shares your sunrise and sunset" }
], config.timeZone ?? "viewer", value => { config.timeZone = value === "viewer" ? undefined : value; }, "Day and night"));
const ebsInput = root.querySelector<HTMLInputElement>('[name="ebsUrl"]')!;
ebsInput.value = config.ebsUrl ?? "";
const status = root.querySelector<HTMLElement>(".status")!;

root.querySelector(".save")!.addEventListener("click", () => {
  const ebsUrl = ebsInput.value.trim();
  if (ebsUrl && !/^https:\/\//i.test(ebsUrl)) { status.textContent = "The backend address must start with https://"; status.className = "status error"; return; }
  const next: BroadcasterConfig = { ...config, ebsUrl: ebsUrl || undefined };
  const ext = window.Twitch?.ext;
  if (!ext) { status.textContent = "Open this page from your Twitch extension settings to save."; status.className = "status error"; return; }
  ext.configuration.set("broadcaster", "1", JSON.stringify(next));
  status.textContent = "Saved! Your viewers' cities update right away.";
  status.className = "status ok";
});

