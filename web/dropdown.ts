import { CITY_THEMES } from "./theme.js";
import type { CityThemeId } from "./theme.js";

export interface PixelOption { value: string; label: string; hint?: string; swatches?: number[] }

/** One-line flavour for each civilization, shown in theme pickers. */
export const THEME_HINTS: Record<CityThemeId, string> = {
  egypt: "Sandstone, palms and golden pyramids",
  rome: "Terracotta roofs, columns and domes",
  norse: "Timber halls, turf roofs and runes",
  japan: "Tiled eaves, torii gates and lanterns"
};

export const themeOptions = (): PixelOption[] => (Object.keys(CITY_THEMES) as CityThemeId[]).map(id => {
  const theme = CITY_THEMES[id];
  return { value: id, label: theme.label, hint: THEME_HINTS[id], swatches: [theme.house[1], theme.roof[0], theme.stone, theme.accent, theme.foliage[1]] };
});

let uid = 0;
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/**
 * A pixel-styled dropdown (ARIA listbox) with colour swatches and hints. Arrow keys, Home/End,
 * Enter, Escape and type-ahead all work; clicking outside closes it.
 */
export function pixelSelect(options: PixelOption[], value: string, onChange: (value: string) => void, label: string) {
  const id = `pixel-select-${++uid}`;
  const root = document.createElement("div");
  root.className = "pixel-select";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pixel-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);
  const list = document.createElement("ul");
  list.className = "pixel-select-list";
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  list.tabIndex = -1;
  list.hidden = true;
  button.setAttribute("aria-controls", id);
  let current = options.find(option => option.value === value) ?? options[0];
  let active = options.indexOf(current);

  const swatchStrip = (option: PixelOption) => {
    const strip = document.createElement("span");
    strip.className = "pixel-swatches";
    for (const color of option.swatches ?? []) {
      const chip = document.createElement("i");
      chip.style.background = hex(color);
      strip.appendChild(chip);
    }
    return strip;
  };
  const renderButton = () => {
    button.replaceChildren();
    if (current.swatches) button.appendChild(swatchStrip(current));
    const text = document.createElement("span");
    text.className = "pixel-select-label";
    text.textContent = current.label;
    const caret = document.createElement("span");
    caret.className = "pixel-select-caret";
    caret.setAttribute("aria-hidden", "true");
    button.append(text, caret);
  };
  const items = options.map((option, index) => {
    const item = document.createElement("li");
    item.id = `${id}-${index}`;
    item.setAttribute("role", "option");
    item.className = "pixel-option";
    if (option.swatches) item.appendChild(swatchStrip(option));
    const text = document.createElement("span");
    text.className = "pixel-option-text";
    const name = document.createElement("b");
    name.textContent = option.label;
    text.appendChild(name);
    if (option.hint) { const hint = document.createElement("small"); hint.textContent = option.hint; text.appendChild(hint); }
    item.appendChild(text);
    item.addEventListener("mousemove", () => highlight(index));
    item.addEventListener("click", () => choose(index));
    list.appendChild(item);
    return item;
  });
  const highlight = (index: number) => {
    active = (index + options.length) % options.length;
    items.forEach((item, i) => item.classList.toggle("active", i === active));
    list.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };
  const open = () => {
    list.hidden = false;
    root.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    items.forEach((item, i) => item.setAttribute("aria-selected", String(options[i] === current)));
    highlight(options.indexOf(current));
    list.focus();
  };
  const close = (refocus = true) => {
    if (list.hidden) return;
    list.hidden = true;
    root.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    close();
    if (option === current) return;
    current = option;
    renderButton();
    onChange(option.value);
  };
  let typed = "", typedAt = 0;
  button.addEventListener("click", () => (list.hidden ? open() : close()));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(); }
  });
  list.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") highlight(active + 1);
    else if (event.key === "ArrowUp") highlight(active - 1);
    else if (event.key === "Home") highlight(0);
    else if (event.key === "End") highlight(options.length - 1);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape") close();
    else if (event.key === "Tab") close(false);
    else if (event.key.length === 1) {
      const now = performance.now();
      typed = now - typedAt > 700 ? event.key.toLowerCase() : typed + event.key.toLowerCase();
      typedAt = now;
      const match = options.findIndex(option => option.label.toLowerCase().startsWith(typed));
      if (match >= 0) highlight(match);
    } else return;
    event.preventDefault();
  });
  document.addEventListener("pointerdown", event => { if (!root.contains(event.target as Node)) close(false); });
  renderButton();
  root.append(button, list);
  return root;
}
