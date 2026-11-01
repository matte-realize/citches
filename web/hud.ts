import type { CommunityProgress, ScoreSnapshot, SimEvent } from "../src/types.js";

const ERA_NAMES = ["CAMPFIRE", "HUTS", "HOMES", "STONE CITY", "INDUSTRIAL", "AIRSHIPS", "EMPIRE"];
const ATTACK_VERB: Record<string, string> = { meteor: "METEOR", storm: "STORM", swarm: "SWARM", fire: "FIRE" };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** Splits text into letters that bounce in a wave. */
function wavy(text: string, className: string) {
  const node = el("div", className);
  [...text].forEach((char, index) => {
    const letter = el("span", "wave-letter", char === " " ? " " : char);
    letter.style.animationDelay = `${index * 45}ms`;
    node.appendChild(letter);
  });
  return node;
}

export interface HudOptions {
  overlay: boolean;
  screenPoint: () => { x: number; y: number };
  /** Screen point above a random villager, for speech bubbles. */
  speakerPoint?: () => { x: number; y: number } | undefined;
  /** Name shown on the scoreboard, e.g. "XQC CITY". */
  cityName?: string;
}

/**
 * Playful pixel HUD: a bouncing city-points counter, a danger meter that fills with minuses,
 * floating +/- pops and big wavy banners for attacks and new eras.
 */
export class CityHud {
  readonly root = el("div", "hud");
  private total = el("div", "score-total", "0");
  private delta = el("div", "score-delta");
  private eraLabel = el("div", "era-label", "CAMPFIRE");
  private eraFill = el("div", "meter-fill era-fill");
  private eraValue = el("div", "meter-value");
  private dangerFill = el("div", "meter-fill danger-fill");
  private dangerMeter = el("div", "meter danger-meter");
  private recovery = el("div", "recovery-row");
  private leaders = el("div", "leaders-row");
  private lastBubbleAt = 0;
  private popLayer = el("div", "pop-layer");
  private bannerLayer = el("div", "banner-layer");
  private shownTotal = 0;
  private targetTotal = 0;
  private popQueue: Array<{ label: string; points: number; unit?: string; credit?: boolean }> = [];
  private lastPopAt = 0;
  private live = 0;

  constructor(private options: HudOptions) {
    const board = el("section", "scoreboard");
    const scoreRow = el("div", "score-row");
    scoreRow.append(el("div", "score-caption", options.cityName ? options.cityName.toUpperCase() : "CITY POINTS"), this.total, this.delta);
    const eraRow = el("div", "meter-row");
    const eraMeter = el("div", "meter era-meter");
    eraMeter.append(this.eraFill);
    eraRow.append(this.eraLabel, eraMeter, this.eraValue);
    const dangerRow = el("div", "meter-row");
    this.dangerMeter.append(this.dangerFill);
    dangerRow.append(el("div", "danger-label", "DANGER"), this.dangerMeter);
    this.recovery.hidden = true;
    this.leaders.hidden = true;
    board.append(scoreRow, eraRow, dangerRow, this.leaders, this.recovery);
    this.root.append(this.popLayer, this.bannerLayer, board);
    document.body.appendChild(this.root);
    requestAnimationFrame(this.tick);
  }

  private tick = () => {
    // Odometer-style count toward the real total.
    const diff = this.targetTotal - this.shownTotal;
    if (Math.abs(diff) > 0.05) {
      this.shownTotal += diff * 0.12;
      this.total.textContent = Math.round(this.shownTotal).toLocaleString();
    }
    const now = performance.now();
    if (this.popQueue.length && now - this.lastPopAt > 170 && this.live < 7) {
      this.lastPopAt = now;
      this.spawnPop(this.popQueue.shift()!);
    }
    requestAnimationFrame(this.tick);
  };

  setScore(score: ScoreSnapshot, replay = false) {
    if (score.total !== this.targetTotal) {
      const gained = score.total > this.targetTotal;
      this.targetTotal = score.total;
      if (replay) { this.shownTotal = score.total; this.total.textContent = Math.round(score.total).toLocaleString(); }
      this.total.classList.remove("bump-up", "bump-down");
      void this.total.offsetWidth;
      this.total.classList.add(gained ? "bump-up" : "bump-down");
    }
    const net = Math.round((score.gained + score.lost) * 10) / 10;
    if (Math.abs(net) >= 0.5) {
      this.delta.textContent = `${net > 0 ? "+" : ""}${net}`;
      this.delta.className = `score-delta ${net > 0 ? "up" : "down"}`;
    }
    this.dangerFill.style.width = `${Math.round(score.threatRatio * 100)}%`;
    this.dangerMeter.classList.toggle("hot", score.threatRatio > 0.7);
    if (!replay) for (const pop of score.pops) {
      if (this.popQueue.length < 14) this.popQueue.push(pop);
    }
    if (score.topBuilders?.length) {
      this.leaders.hidden = false;
      this.leaders.replaceChildren(el("span", "leaders-caption", "TOP BUILDERS"), ...score.topBuilders.map((leader, index) => {
        const chip = el("span", `leader leader-${index}`);
        chip.append(el("span", "leader-name", leader.name), el("span", "leader-points", String(leader.points)));
        return chip;
      }));
    }
    if (!replay && score.highlight) this.say(score.highlight.user, score.highlight.text);
  }

  setProgress(progress: CommunityProgress) {
    const tech = progress.technology;
    const percent = Math.max(0, Math.min(100, Math.round(tech.ratio * 100)));
    this.eraFill.style.width = `${percent}%`;
    this.eraLabel.textContent = tech.ratio >= 1 && tech.era >= 6 ? "EMPIRE!" : `▶ ${tech.name}`;
    this.eraValue.textContent = `${percent}%`;
    const recovery = progress.recovery;
    this.recovery.hidden = !recovery.active;
    if (recovery.active) this.recovery.textContent = `REBUILDING ${Math.round(recovery.ratio * 100)}% · ${ERA_NAMES[recovery.era] ?? ""} HOMES`;
  }

  /** A villager repeats a wholesome chat message in a pixel speech bubble. */
  private say(user: string, text: string) {
    const now = performance.now();
    if (now - this.lastBubbleAt < 3200) return;
    const at = this.options.speakerPoint?.();
    if (!at) return;
    this.lastBubbleAt = now;
    const bubble = el("div", "speech");
    bubble.append(el("span", "speech-user", user), el("span", "speech-text", text.length > 64 ? `${text.slice(0, 62)}…` : text));
    bubble.style.left = `${Math.max(120, Math.min(innerWidth - 120, at.x))}px`;
    bubble.style.top = `${Math.max(70, Math.min(innerHeight - 170, at.y))}px`;
    this.popLayer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 4200);
  }

  event(event: SimEvent) {
    if (event.type === "build" && event.builders?.length) {
      const what = event.kind === "landmark" ? "LANDMARK" : event.count > 1 ? `${event.count} HOMES` : "HOME";
      this.popQueue.unshift({ label: `by ${event.builders.join(" & ")}`, points: event.count, unit: what, credit: true });
      return;
    }
    if (event.type === "disaster") {
      // Small destruction pulses pop out of the city like build points; only big hits get a banner.
      const lost = event.damageCount ?? 1;
      this.popQueue.unshift({ label: `${ATTACK_VERB[event.kind] ?? "ATTACK"} · ${event.reason ?? ""}`.trim(), points: -lost, unit: lost === 1 ? "HOME" : "HOMES" });
      if (lost >= 3 || event.reason === "HATE") {
        this.banner(`!! ${event.reason ?? ATTACK_VERB[event.kind] ?? "ATTACK"} !!`, "attack");
        document.body.classList.remove("quake"); void document.body.offsetWidth; document.body.classList.add("quake");
      }
    } else if (event.type === "advancement") this.banner(`NEW ERA · ${event.name}`, "era");
    else if (event.type === "boom") this.banner(`RAID! +${event.viewers} BUILDERS`, "raid");
  }

  private banner(text: string, kind: string) {
    const banner = wavy(text, `banner banner-${kind}`);
    this.bannerLayer.appendChild(banner);
    setTimeout(() => banner.remove(), 3400);
  }

  private spawnPop(pop: { label: string; points: number; unit?: string; credit?: boolean }) {
    const anchor = this.options.screenPoint();
    const node = el("div", `pop ${pop.points >= 0 ? "pop-plus" : "pop-minus"}${pop.unit ? " pop-wreck" : ""}${pop.credit ? " pop-credit" : ""}`);
    node.append(el("span", "pop-points", `${pop.points >= 0 ? "+" : ""}${pop.points}${pop.unit ? ` ${pop.unit}` : ""}`), el("span", "pop-label", pop.label));
    const spread = this.options.overlay ? 70 : 120;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    node.style.left = `${clamp(anchor.x + (Math.random() - 0.5) * spread * 2, 90, innerWidth - 90)}px`;
    node.style.top = `${clamp(anchor.y + (Math.random() - 0.5) * spread * 0.6, 60, innerHeight - 160)}px`;
    node.style.setProperty("--tilt", `${(Math.random() - 0.5) * 16}deg`);
    this.popLayer.appendChild(node);
    this.live++;
    setTimeout(() => { node.remove(); this.live--; }, 1900);
  }
}
