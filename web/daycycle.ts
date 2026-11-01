import { Color } from "three";

/** One lighting mood at a given hour of the day. Values blend between neighbouring keys. */
interface Mood { hour: number; sun: number; sunIntensity: number; sky: number; ground: number; hemi: number; fill: number; fillIntensity: number; background: number; exposure: number; glow: number }

// Night is the moonlit look the city was designed around; day is bright and warm.
const MOODS: Mood[] = [
  { hour: 0, sun: 0x9fb8e0, sunIntensity: 2.4, sky: 0xa8c4dc, ground: 0x263a33, hemi: 2.2, fill: 0xffba78, fillIntensity: 0.5, background: 0x14202c, exposure: 1.2, glow: 1 },
  { hour: 5, sun: 0xa8bce0, sunIntensity: 2.4, sky: 0xb0c8dc, ground: 0x2a3d36, hemi: 2.3, fill: 0xffba78, fillIntensity: 0.5, background: 0x18253a, exposure: 1.22, glow: 1 },
  { hour: 6.5, sun: 0xffb08a, sunIntensity: 2.8, sky: 0xf0c8c8, ground: 0x4a5a48, hemi: 2.6, fill: 0xb8c8ff, fillIntensity: 0.6, background: 0x6a5a78, exposure: 1.25, glow: 0.6 },
  { hour: 8, sun: 0xfff0d8, sunIntensity: 3.6, sky: 0xd8ecf8, ground: 0x5a6a50, hemi: 2.9, fill: 0xbcd4ff, fillIntensity: 0.55, background: 0x7aaed0, exposure: 1.18, glow: 0.18 },
  { hour: 13, sun: 0xfff8ea, sunIntensity: 3.9, sky: 0xe0f0fa, ground: 0x5e6e52, hemi: 3.0, fill: 0xbcd4ff, fillIntensity: 0.5, background: 0x86bcdc, exposure: 1.15, glow: 0.12 },
  { hour: 17, sun: 0xffe0b0, sunIntensity: 3.5, sky: 0xf0e0d0, ground: 0x5a6248, hemi: 2.8, fill: 0xb0c0ff, fillIntensity: 0.55, background: 0x8aa8c8, exposure: 1.18, glow: 0.25 },
  { hour: 18.75, sun: 0xff8a50, sunIntensity: 2.9, sky: 0xf0b8a0, ground: 0x4a4a40, hemi: 2.5, fill: 0x9aa8ff, fillIntensity: 0.6, background: 0x6a4a6a, exposure: 1.25, glow: 0.7 },
  { hour: 20.5, sun: 0x9fb8e0, sunIntensity: 2.5, sky: 0xa8c4dc, ground: 0x2a3d36, hemi: 2.3, fill: 0xffba78, fillIntensity: 0.5, background: 0x182434, exposure: 1.22, glow: 1 },
  { hour: 24, sun: 0x9fb8e0, sunIntensity: 2.4, sky: 0xa8c4dc, ground: 0x263a33, hemi: 2.2, fill: 0xffba78, fillIntensity: 0.5, background: 0x14202c, exposure: 1.2, glow: 1 }
];

export interface Lighting {
  hour: number; daylight: number;
  sun: Color; sunIntensity: number; sunDirection: [number, number, number];
  sky: Color; ground: Color; hemi: number;
  fill: Color; fillIntensity: number;
  background: Color; exposure: number;
  /** 0 in full daylight, 1 at night: how strongly windows, lamps and neon glow. */
  glow: number;
}

/** Local hour (0-24, fractional) in a time zone, or the viewer's own zone when none is given. */
export function localHour(timeZone?: string, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
    return get("hour") + get("minute") / 60 + get("second") / 3600;
  } catch {
    return now.getHours() + now.getMinutes() / 60;
  }
}

const mix = (a: number, b: number, t: number) => new Color(a).lerp(new Color(b), t);

export function lightingAt(hour: number): Lighting {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < MOODS.length - 2 && MOODS[i + 1].hour <= h) i++;
  const a = MOODS[i], b = MOODS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.hour) / (b.hour - a.hour || 1)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  // The sun rises in the east (+x), arcs overhead and sets in the west; at night the moon takes
  // over from a fixed high angle so the city keeps readable moon shadows.
  const dayProgress = (h - 6) / 13;
  const isDay = dayProgress > 0 && dayProgress < 1;
  const arc = Math.PI * Math.min(1, Math.max(0, dayProgress));
  const sunDirection: [number, number, number] = isDay
    ? [Math.cos(arc) * 28, 10 + Math.sin(arc) * 26, 12 - Math.sin(arc) * 6]
    : [-18, 32, 13];
  const glow = lerp(a.glow, b.glow);
  return {
    hour: h, daylight: 1 - glow,
    sun: mix(a.sun, b.sun, t), sunIntensity: lerp(a.sunIntensity, b.sunIntensity), sunDirection,
    sky: mix(a.sky, b.sky, t), ground: mix(a.ground, b.ground, t), hemi: lerp(a.hemi, b.hemi),
    fill: mix(a.fill, b.fill, t), fillIntensity: lerp(a.fillIntensity, b.fillIntensity),
    background: mix(a.background, b.background, t), exposure: lerp(a.exposure, b.exposure), glow
  };
}
