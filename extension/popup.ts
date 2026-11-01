import "@fontsource/pixelify-sans/400.css";
import "@fontsource/press-start-2p/400.css";
import "./popup.css";
import "../web/dropdown.css";
import { pixelSelect, themeOptions } from "../web/dropdown.js";
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
      meta.textContent = `Day ${entry.day}${entry.hero ? ` · hero: ${entry.hero}` : ""}`;
      item.append(head, meta);
      return item;
    }));
  }
}
root.querySelector(".reset")?.addEventListener("click", async () => {
  if (!channel || !confirm(`Start #${channel}'s city over from a campfire?`)) return;
  await chromeApi().storage.local.remove(`city:${channel}`);
  // Nudge the overlay to reload with a fresh city.
  await saveSettings({ ...(await loadSettings()), enabled: false });
  await saveSettings({ ...(await loadSettings()), enabled: true });
});
