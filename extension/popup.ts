import "@fontsource/pixelify-sans/400.css";
import "@fontsource/press-start-2p/400.css";
import "./popup.css";
import "../web/dropdown.css";
import { pixelSelect, themeOptions } from "../web/dropdown.js";
import { displayName } from "../src/moderation/censor.js";
import { channelFromUrl, chromeApi, loadSettings, saveSettings } from "./settings.js";

const root = document.querySelector<HTMLElement>(".popup")!;
const settings = await loadSettings();
const tabs = await chromeApi().tabs?.query({ active: true, currentWindow: true });
const channel = tabs?.[0]?.url ? channelFromUrl(tabs[0].url) : undefined;

root.innerHTML = `
  <h1>CHAT CITY</h1>
  <p class="where">${channel ? `Building on <b>#${channel}</b>` : "Open a Twitch channel to start building"}</p>
  <label class="row toggle"><span>Show city</span><input type="checkbox" name="enabled"></label>
  <div class="field"><span>Civilization</span><div data-field="theme"></div></div>
  <div class="row"><span>Show on</span><div data-field="area"></div></div>
  <div class="row"><span>Corner</span><div data-field="corner"></div></div>
  <div class="row"><span>Size</span><div data-field="size"></div></div>
  ${channel ? `<section class="chronicle"><h2>THE STORY SO FAR</h2><ol class="chapters"><li class="empty">The first chapter is still being written…</li></ol></section>` : ""}
  ${channel ? `<button class="reset" type="button">Reset #${channel} city</button>` : ""}
  <p class="hint">Kind, thoughtful chat builds. Spam, caps and toxicity knock buildings down.</p>`;

const current = { ...settings };
const save = () => void saveSettings({ ...current });
const enabled = root.querySelector<HTMLInputElement>('[name="enabled"]')!;
enabled.checked = settings.enabled;
enabled.addEventListener("change", () => { current.enabled = enabled.checked; save(); });
const mount = (name: string, element: HTMLElement) => root.querySelector(`[data-field="${name}"]`)!.replaceWith(element);
mount("theme", pixelSelect(themeOptions(), settings.theme, value => { current.theme = value; save(); }, "Civilization"));
mount("area", pixelSelect([{ value: "page", label: "Whole page" }, { value: "player", label: "Video player" }], settings.area, value => { current.area = value as "page" | "player"; save(); }, "Show on"));
mount("corner", pixelSelect([{ value: "br", label: "Bottom right" }, { value: "bl", label: "Bottom left" }], settings.corner, value => { current.corner = value as "br" | "bl"; save(); }, "Corner"));
mount("size", pixelSelect([{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }], settings.size, value => { current.size = value as "small" | "medium" | "large"; save(); }, "Size"));
// The chronicle comes from the saved city for this channel.
if (channel) {
  const saved = (await chromeApi().storage.local.get(`city:${channel}`))[`city:${channel}`] as { mapper?: { chronicle?: Array<{ number: number; title: string; day: number; hero?: string }>; foundedAt?: number } } | undefined;
  const chapters = saved?.mapper?.chronicle ?? [];
  const list = root.querySelector(".chapters");
  if (list && chapters.length) {
    list.replaceChildren(...chapters.slice(-6).reverse().map(entry => {
      const item = document.createElement("li");
      const head = document.createElement("b");
      head.textContent = `Ch.${entry.number} · ${entry.title}`;
      const meta = document.createElement("small");
      meta.textContent = `Day ${entry.day}${entry.hero ? ` · hero: ${displayName(entry.hero)}` : ""}`;
      item.append(head, meta);
      return item;
    }));
  }
}
// Firefox can't show confirm() dialogs from a toolbar popup (they appear but can't be clicked),
// so the button asks for a second click instead.
let armed: ReturnType<typeof setTimeout> | undefined;
root.querySelector<HTMLButtonElement>(".reset")?.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement;
  if (!channel) return;
  if (!armed) {
    button.textContent = `Click again to wipe #${channel}`;
    armed = setTimeout(() => { armed = undefined; button.textContent = `Reset #${channel} city`; }, 3000);
    return;
  }
  clearTimeout(armed); armed = undefined;
  button.textContent = "Wiped · starting over";
  // The overlay wipes itself, so it can't save the old city back as it closes.
  const tabId = tabs?.[0]?.id;
  try { if (tabId !== undefined) await chromeApi().tabs?.sendMessage(tabId, { type: "chat-city:wipe" }); }
  catch { await chromeApi().storage.local.remove(`city:${channel}`); }
});
