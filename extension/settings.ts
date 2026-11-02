/** `area`: float over the whole Twitch page (default) or sit inside the video player. */
export interface ChatCitySettings { enabled: boolean; theme: string; corner: "br" | "bl"; size: "small" | "medium" | "large"; area: "page" | "player" }
export const DEFAULT_SETTINGS: ChatCitySettings = { enabled: true, theme: "egypt", corner: "bl", size: "medium", area: "page" };

type Sync = { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
type Chrome = { storage: { sync: Sync; local: Sync & { remove(key: string): Promise<void> }; onChanged: { addListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void } }; runtime: { getURL(path: string): string; onMessage: { addListener(fn: (message: unknown) => void): void; removeListener(fn: (message: unknown) => void): void } }; tabs?: { query(q: object): Promise<Array<{ id?: number; url?: string }>>; sendMessage(tabId: number, message: unknown): Promise<unknown> } };
export const chromeApi = () => (globalThis as unknown as { chrome: Chrome }).chrome;

export async function loadSettings(): Promise<ChatCitySettings> {
  // Storage can be unavailable (e.g. a Firefox add-on without an ID): the city still shows, with defaults.
  try {
    const stored = (await chromeApi().storage.sync.get("settings")).settings as Partial<ChatCitySettings> | undefined;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch (error) {
    console.warn("[Chat City] settings unavailable, using defaults", error);
    return { ...DEFAULT_SETTINGS };
  }
}
export const saveSettings = (settings: ChatCitySettings) => chromeApi().storage.sync.set({ settings });

const RESERVED = new Set(["directory", "videos", "settings", "search", "downloads", "jobs", "turbo", "subscriptions", "inventory", "drops", "wallet", "friends", "messages", "following", "p", "store", "prime", "broadcast", "u", "privacy", "legal", "team"]);
/** The channel a twitch.tv URL is showing, or undefined for non-channel pages. */
export function channelFromUrl(url: string): string | undefined {
  let path: string[];
  try { path = new URL(url).pathname.split("/").filter(Boolean); } catch { return undefined; }
  let name = path[0];
  if (name === "popout" || name === "moderator" || name === "embed") name = path[1];
  if (!name || RESERVED.has(name.toLowerCase())) return undefined;
  return /^[a-z0-9_]{2,25}$/i.test(name) ? name.toLowerCase() : undefined;
}
