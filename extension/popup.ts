import "@fontsource/pixelify-sans/400.css";
import "@fontsource/press-start-2p/400.css";
import "./popup.css";
import { channelFromUrl, chromeApi, loadSettings, saveSettings } from "./settings.js";

const root = document.querySelector<HTMLElement>(".popup")!;
const settings = await loadSettings();
const tabs = await chromeApi().tabs?.query({ active: true, currentWindow: true });
const channel = tabs?.[0]?.url ? channelFromUrl(tabs[0].url) : undefined;

root.innerHTML = `
  <h1>CHAT CITY</h1>
  <p class="where">${channel ? `Building on <b>#${channel}</b>` : "Open a Twitch channel to start building"}</p>
  <label class="row toggle"><span>Show city</span><input type="checkbox" name="enabled"></label>
  <label class="row"><span>Civilization</span><select name="theme">
    <option value="egypt">Nile Kingdom</option><option value="rome">Roman Republic</option>
    <option value="norse">Norse Settlement</option><option value="japan">Imperial Japan</option></select></label>
  <label class="row"><span>Corner</span><select name="corner"><option value="br">Bottom right</option><option value="bl">Bottom left</option></select></label>
  <label class="row"><span>Size</span><select name="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
  ${channel ? `<button class="reset" type="button">Reset #${channel} city</button>` : ""}
  <p class="hint">Kind, thoughtful chat builds. Spam, caps and toxicity knock buildings down.</p>`;

const field = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[name="${name}"]`)!;
field<HTMLInputElement>("enabled").checked = settings.enabled;
for (const name of ["theme", "corner", "size"] as const) field<HTMLSelectElement>(name).value = settings[name];
root.addEventListener("change", () => {
  void saveSettings({
    enabled: field<HTMLInputElement>("enabled").checked,
    theme: field<HTMLSelectElement>("theme").value,
    corner: field<HTMLSelectElement>("corner").value as "br" | "bl",
    size: field<HTMLSelectElement>("size").value as "small" | "medium" | "large"
  });
});
root.querySelector(".reset")?.addEventListener("click", async () => {
  if (!channel || !confirm(`Start #${channel}'s city over from a campfire?`)) return;
  await chromeApi().storage.local.remove(`city:${channel}`);
  // Nudge the overlay to reload with a fresh city.
  await saveSettings({ ...(await loadSettings()), enabled: false });
  await saveSettings({ ...(await loadSettings()), enabled: true });
});
