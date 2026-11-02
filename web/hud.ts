import type { CommunityProgress, ScoreSnapshot, SimEvent } from "../src/types.js";
import { displayName, moderate } from "../src/moderation/censor.js";

const ERA_NAMES = ["CAMPFIRE", "HUTS", "HOMES", "STONE CITY", "INDUSTRIAL", "AIRSHIPS", "EMPIRE", "TYPE I", "TYPE II", "TYPE III"];
const ATTACK_VERB: Record<string, string> = {
  meteor: "METEOR", storm: "STORM", swarm: "SWARM", fire: "FIRE",
  quake: "QUAKE", flood: "FLOOD", tornado: "TORNADO",
  flare: "SOLAR FLARE", asteroid: "ASTEROID", drones: "ROGUE AI", gamma: "GAMMA BURST", blackhole: "BLACK HOLE"
};

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
  /** A random spot in the city (a building, a villager) so chat pops land all over town. */
  scatterPoint?: () => { x: number; y: number } | undefined;
  /** Screen point above a random villager, for speech bubbles. */
  speakerPoint?: () => { x: number; y: number } | undefined;
  /** Name shown on the scoreboard, e.g. "XQC CITY". */
  cityName?: string;
  /** Theme name of a capitol stage. */
  capitolName?: (stage: number) => string;
  /** A random owned home, for rotating name tags. */
  featuredHome?: () => { owner: string; at: { x: number; y: number }; level: number; monument?: boolean } | undefined;
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
  private dangerLabel = el("div", "danger-label", "DANGER");
  /** performance.now() when a massing attack will strike, while the meter is full. */
  private incomingAt?: number;
  private recovery = el("div", "recovery-row");
  private repairRow = el("div", "recovery-row repair-row");
  private leaders = el("div", "leaders-row");
  private upkeepLine = el("div", "upkeep-line");
  private hint = el("div", "command-hint");
  private caption = el("div", "score-caption");
  private storyLine = el("div", "story-line");
  private capitolRow = el("div", "meter-row capitol-row");
  private capitolLabel = el("div", "capitol-label", "⌂ CAPITOL");
  private capitolFill = el("div", "meter-fill capitol-fill");
  private capitolValue = el("div", "meter-value capitol-value");
  private lastBubbleAt = 0;
  /** Side banner: who built the city, who backed the stream, who funded the capitol. */
  private hall = el("aside", "hall");
  private hallLists = {
    builders: el("ol", "hall-list"),
    supporters: el("ol", "hall-list"),
    patrons: el("ol", "hall-list")
  };
  private hallTotals = el("div", "hall-totals");
  private sleepSign = el("div", "sleep-sign");
  private zTimer?: ReturnType<typeof setInterval>;
  private popLayer = el("div", "pop-layer");
  private bannerLayer = el("div", "banner-layer");
  private shownTotal = 0;
  private targetTotal = 0;
  private popQueue: Array<{ label: string; points: number; unit?: string; credit?: boolean }> = [];
  private lastPopAt = 0;
  private live = 0;
  private slot = 0;

  constructor(private options: HudOptions) {
    const board = el("section", "scoreboard");
    const scoreRow = el("div", "score-row");
    scoreRow.append(this.caption, this.total, this.delta);
    this.caption.textContent = options.cityName ? options.cityName.toUpperCase() : "CITY POINTS";
    const eraRow = el("div", "meter-row");
    const eraMeter = el("div", "meter era-meter");
    eraMeter.append(this.eraFill);
    eraRow.append(this.eraLabel, eraMeter, this.eraValue);
    const dangerRow = el("div", "meter-row");
    this.dangerMeter.append(this.dangerFill);
    dangerRow.append(this.dangerLabel, this.dangerMeter);
    this.recovery.hidden = true;
    this.repairRow.hidden = true;
    this.leaders.hidden = true;
    const capitolMeter = el("div", "meter capitol-meter");
    capitolMeter.append(this.capitolFill);
    this.capitolRow.append(this.capitolLabel, capitolMeter, this.capitolValue);
    this.capitolRow.hidden = true;
    dangerRow.after(this.capitolRow);
    this.upkeepLine.hidden = true;
    this.hint.innerHTML = "SPEND POINTS: <b>!plant</b> <b>!repair</b> <b>!cheer</b> <b>!donate</b> <b>!home</b>";
    this.storyLine.hidden = true;
    board.append(scoreRow, this.storyLine, eraRow, dangerRow, this.upkeepLine, this.leaders, this.repairRow, this.recovery, this.hint);
    if (options.featuredHome) setInterval(() => {
      const home = options.featuredHome?.();
      if (home && !document.body.classList.contains("city-asleep")) this.nameTag(home.owner, home.at, home.level, home.monument);
    }, 14_000);
    this.sleepSign.hidden = true;
    this.sleepSign.append(el("span", "sleep-moon", "☾"), el("span", "sleep-text", "STREAM OFFLINE · THE CITY IS SLEEPING"));
    board.prepend(this.sleepSign);
    const section = (title: string, icon: string, list: HTMLOListElement, empty: string) => {
      const block = el("div", "hall-section");
      const heading = el("div", "hall-heading");
      heading.append(el("span", "hall-icon", icon), el("span", "", title));
      list.dataset.empty = empty;
      block.append(heading, list);
      return block;
    };
    const hallTitle = el("div", "hall-title");
    hallTitle.append(el("span", "hall-crown", "♛"), el("span", "", "HALL OF FAME"));
    this.hall.append(
      hallTitle,
      section("TOP BUILDERS", "▲", this.hallLists.builders, "CHAT TO BUILD"),
      section("SPONSORS", "♥", this.hallLists.supporters, "BITS · SUBS · GIFTS"),
      section("CAPITOL PATRONS", "⌂", this.hallLists.patrons, "!DONATE TO THE CAPITOL"),
      this.hallTotals
    );
    this.root.append(this.popLayer, this.bannerLayer, this.hall, board);
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
    if (this.incomingAt !== undefined) {
      const seconds = Math.max(0, Math.ceil((this.incomingAt - now) / 1000));
      const text = seconds > 0 ? `⚠ ATTACK ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "⚠ STRIKING!";
      if (this.dangerLabel.textContent !== text) this.dangerLabel.textContent = text;
    }
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
    const massing = score.incomingMs !== undefined && !replay;
    this.dangerMeter.classList.toggle("hot", score.threatRatio > 0.7 && !massing);
    this.dangerMeter.classList.toggle("massing", massing);
    document.body.classList.toggle("attack-incoming", massing);
    if (massing && this.incomingAt === undefined) this.banner("⚠ ATTACK INCOMING · KIND CHAT CAN BREAK IT UP", "attack");
    this.incomingAt = massing ? performance.now() + score.incomingMs! : undefined;
    if (!massing) this.dangerLabel.textContent = "DANGER";
    if (!replay) for (const pop of score.pops) {
      if (this.popQueue.length < 14) this.popQueue.push(pop);
    }
    const leaderOrder = (score.topBuilders ?? []).map(leader => leader.name).join("\n");
    if (score.topBuilders?.length && leaderOrder !== this.leaders.dataset.order) {
      this.leaders.dataset.order = leaderOrder;
      this.leaders.hidden = false;
      this.leaders.replaceChildren(el("span", "leaders-caption", "TOP BUILDERS"), ...score.topBuilders.map((leader, index) => {
        const chip = el("span", `leader leader-${index}`);
        chip.append(el("span", "leader-name", displayName(leader.name)), el("span", "leader-points", String(leader.points)));
        return chip;
      }));
    } else if (score.topBuilders?.length) {
      score.topBuilders.forEach((leader, index) => {
        const points = this.leaders.querySelectorAll(".leader-points")[index];
        if (points) points.textContent = String(leader.points);
      });
    }
    this.updateHall(score);
    if (!replay && score.highlight) this.say(score.highlight.user, score.highlight.text);
    if (score.story) {
      const story = score.story;
      const base = this.options.cityName ? this.options.cityName.toUpperCase() : "CITY POINTS";
      this.caption.textContent = `${base} · DAY ${story.day}`;
      this.storyLine.hidden = false;
      const community = score.community;
      this.storyLine.textContent = `CH.${story.chapter + 1} ${Math.round(Math.min(1, story.next / Math.max(1, story.goal)) * 100)}%${story.title ? ` · LAST: ${story.title.toUpperCase()}` : ""}${community ? ` · ${community.chatters} BUILDERS ×${community.multiplier.toFixed(1)}${community.tired ? " · TIRED" : ""}` : ""}`;
    }
    if (score.capitol) {
      const capitol = score.capitol;
      const name = (stage: number) => this.options.capitolName?.(stage) ?? `STAGE ${stage}`;
      const done = capitol.stage >= 5;
      this.capitolRow.hidden = false;
      this.capitolLabel.textContent = done ? `★ ${name(5)}` : `⌂ ${name(capitol.stage + 1)}`;
      this.capitolFill.style.width = `${done ? 100 : Math.round(Math.min(1, capitol.current / capitol.goal) * 100)}%`;
      this.capitolValue.textContent = done ? "DONE" : capitol.lockedUntilEra !== undefined && capitol.current >= capitol.goal ? `ERA ${capitol.lockedUntilEra + 1}` : `${Math.round(Math.min(capitol.current, capitol.goal))}/${capitol.goal}`;
      this.capitolRow.classList.toggle("locked", capitol.lockedUntilEra !== undefined && capitol.current >= capitol.goal);
    }
    const upkeep = score.upkeep ?? "steady";
    this.upkeepLine.hidden = upkeep === "steady" || document.body.classList.contains("city-asleep");
    this.upkeepLine.className = `upkeep-line ${upkeep}`;
    this.upkeepLine.textContent = upkeep === "decaying" ? "QUIET CHAT · THE CITY IS WEARING DOWN" : "CHAT IS REPAIRING THE CITY";
  }

  private updateHall(score: ScoreSnapshot) {
    // Rows only rebuild (and hop) when the ranking itself changes; points update quietly in place.
    const fill = (list: HTMLOListElement, entries: Array<{ name: string; points: number }> | undefined, unit: string) => {
      const top = (entries ?? []).slice(0, 3);
      const order = top.map(entry => entry.name).join("\n");
      if (list.dataset.order === order && list.children.length) {
        top.forEach((entry, index) => {
          const points = list.children[index]?.querySelector(".hall-points");
          const text = `${entry.points.toLocaleString()}${unit}`;
          if (points && points.textContent !== text) points.textContent = text;
        });
        return;
      }
      const previous = (list.dataset.order ?? "").split("\n");
      list.dataset.order = order;
      const rows = top.map((entry, index) => {
        const moved = previous[index] !== entry.name;
        const row = el("li", `hall-row hall-rank-${index}${moved ? " hall-moved" : ""}`);
        row.append(el("span", "hall-rank", String(index + 1)), el("span", "hall-name", displayName(entry.name)), el("span", "hall-points", `${entry.points.toLocaleString()}${unit}`));
        return row;
      });
      if (!rows.length) rows.push(el("li", "hall-empty", list.dataset.empty ?? ""));
      list.replaceChildren(...rows);
    };
    fill(this.hallLists.builders, score.topBuilders, "");
    fill(this.hallLists.supporters, score.topSupporters, "♥");
    fill(this.hallLists.patrons, score.topPatrons, "");
    const activity = score.activity;
    const days = score.story?.day ?? 1;
    const stat = (value: string, label: string) => {
      const node = el("span", "hall-stat");
      node.append(el("b", "", value), el("span", "", label));
      return node;
    };
    this.hallTotals.replaceChildren(
      stat((activity?.messages ?? 0).toLocaleString(), "MESSAGES"),
      stat((activity?.chatters ?? 0).toLocaleString(), "CHATTERS"),
      stat(String(days), days === 1 ? "DAY ACTIVE" : "DAYS ACTIVE")
    );
  }

  setProgress(progress: CommunityProgress) {
    const tech = progress.technology;
    const percent = Math.max(0, Math.min(100, Math.round(tech.ratio * 100)));
    this.eraFill.style.width = `${percent}%`;
    this.eraLabel.textContent = tech.ratio >= 1 && tech.era >= 9 ? "TYPE III!" : `▶ ${tech.name}`;
    this.eraValue.textContent = tech.ratio >= 1 && tech.era >= 9 ? "MAX" : `${Math.floor(tech.current)}/${Math.round(tech.goal)}`;
    this.eraValue.title = `${percent}%`;
    const repair = progress.repair;
    this.repairRow.hidden = !repair || repair.ruins <= 0;
    if (repair && repair.ruins > 0) this.repairRow.textContent = `REPAIRING ${repair.ruins} RUIN${repair.ruins === 1 ? "" : "S"} · GROWTH PAUSED · CHAT TO FIX!`;
    const recovery = progress.recovery;
    this.recovery.hidden = !recovery.active;
    if (recovery.active) this.recovery.textContent = `REBUILDING ${Math.round(recovery.ratio * 100)}% · ${ERA_NAMES[recovery.era] ?? ""} HOMES`;
  }

  /** Lights-out: show the sleeping sign and let Z's drift up from homes until the city wakes. */
  setSleeping(sleeping: boolean, points: () => Array<{ x: number; y: number }>) {
    if (sleeping === !this.sleepSign.hidden) return;
    this.sleepSign.hidden = !sleeping;
    document.body.classList.toggle("city-asleep", sleeping);
    if (this.zTimer) clearInterval(this.zTimer);
    this.zTimer = undefined;
    if (sleeping) {
      this.zTimer = setInterval(() => {
        for (const point of points()) {
          const z = el("div", "zzz", Math.random() < 0.5 ? "z" : "Z");
          z.style.left = `${point.x + (Math.random() - 0.5) * 20}px`;
          z.style.top = `${point.y}px`;
          z.style.setProperty("--drift", `${(Math.random() - 0.3) * 40}px`);
          this.popLayer.appendChild(z);
          setTimeout(() => z.remove(), 3000);
        }
      }, 1400);
    } else this.banner("GOOD MORNING!", "era");
  }

  /** Name tag floating over a chatter's home. */
  nameTag(owner: string, at: { x: number; y: number }, level = 1, monument = false) {
    if (!monument) owner = displayName(owner);
    const tag = el("div", `name-tag${monument ? " monument-tag" : ""}`);
    tag.append(el("span", "name-tag-icon", monument ? "♜" : level >= 3 ? "★" : "⌂"), el("span", "name-tag-name", monument ? owner : `${owner}'s home`));
    tag.style.left = `${Math.max(90, Math.min(innerWidth - 90, at.x))}px`;
    tag.style.top = `${Math.max(60, Math.min(innerHeight - 160, at.y))}px`;
    this.popLayer.appendChild(tag);
    setTimeout(() => tag.remove(), 4500);
  }

  /** What a chat command did, credited to whoever typed it. */
  notice(kind: string, user: string, at?: { x: number; y: number }, extra: { level?: number; cost?: number; title?: string } = {}) {
    user = user ? displayName(user) : user;
    if (kind === "chapter") { this.banner(`CHAPTER ${extra.level ?? ""}: ${(extra.title ?? "").toUpperCase()}`, "era"); if (user) this.say("THE CHRONICLE", `${user} is the hero of chapter ${extra.level}!`); return; }
    if (kind === "welcome") { this.banner("WELCOME BACK! REPAIRS HALF PRICE", "raid"); return; }
    const text: Record<string, string> = {
      plant: `${user} planted a tree`,
      repair: `${user} repaired a building`,
      cheer: `${user} threw a party!`,
      nohome: `${user} has no home yet. Chat kindly to build one!`,
      broke: `${user} needs ${extra.cost ?? "more"} pts`,
      fine: `${user}: the city is in good shape!`,
      moveOut: "A family moved out…",
      moveIn: "A family moved back home!",
      upgrade: `${user}'s home grew to level ${extra.level ?? 1}!`,
      donate: `${user} donated ${extra.cost ?? ""} to the capitol!`
    };
    if (kind === "home" && at) { this.nameTag(user, at, extra.level); return; }
    if (kind === "capitol") { this.banner(`THE ${(this.options.capitolName?.(extra.level ?? 1) ?? "CAPITOL").toUpperCase()} IS COMPLETE!`, "era"); return; }
    const message = text[kind];
    if (!message) return;
    const node = el("div", `notice notice-${kind}`, message);
    if (extra.cost && kind !== "broke" && kind !== "fine") node.append(el("span", "notice-cost", ` -${extra.cost}`));
    const anchor = at ?? this.options.screenPoint();
    node.style.left = `${Math.max(140, Math.min(innerWidth - 140, anchor.x))}px`;
    node.style.top = `${Math.max(60, Math.min(innerHeight - 170, anchor.y - 30))}px`;
    this.popLayer.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  /** A building fixed up by chat, or one that crumbled after being neglected. */
  upkeepPop(kind: "collapse" | "repair", at: { x: number; y: number }) {
    const node = el("div", `pop ${kind === "repair" ? "pop-plus pop-repair" : "pop-minus pop-ruin"}`);
    node.append(el("span", "pop-points", kind === "repair" ? "FIXED!" : "-1 HOME"), el("span", "pop-label", kind === "repair" ? "repaired" : "fell into ruin"));
    node.style.left = `${Math.max(90, Math.min(innerWidth - 90, at.x))}px`;
    node.style.top = `${Math.max(60, Math.min(innerHeight - 160, at.y))}px`;
    node.style.setProperty("--tilt", `${(Math.random() - 0.5) * 10}deg`);
    this.popLayer.appendChild(node);
    setTimeout(() => node.remove(), 2400);
  }

  /** A villager repeats a wholesome chat message in a pixel speech bubble. */
  private say(user: string, text: string) {
    // Second line of defence (the backend already filters): never show anything that needed masking.
    const clean = moderate(text);
    if (user !== "THE CHRONICLE" && (clean.blocked || clean.masked || displayName(user) !== user)) return;
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
      this.popQueue.unshift({ label: `by ${event.builders.map(name => displayName(name)).join(" & ")}`, points: event.count, unit: what, credit: true });
      return;
    }
    if (event.type === "disaster") {
      // Small destruction pulses pop out of the city like build points; only big hits get a banner.
      const lost = event.damageCount ?? 1;
      this.popQueue.unshift({ label: `${ATTACK_VERB[event.kind] ?? "ATTACK"} · ${event.reason ?? ""}`.trim(), points: -lost, unit: lost === 1 ? "HOME" : "HOMES" });
      if (lost >= 3 || event.reason === "HATE" || event.natural) {
        this.banner(event.natural ? `!! ${event.reason ?? "DISASTER"} · NO WARNING !!` : `!! ${event.reason ?? ATTACK_VERB[event.kind] ?? "ATTACK"} !!`, "attack");
        document.body.classList.remove("quake"); void document.body.offsetWidth; document.body.classList.add("quake");
      }
    } else if (event.type === "advancement") this.banner(`NEW ERA · ${event.name}`, "era");
    else if (event.type === "regression") {
      this.banner(`ERA LOST · BACK TO ${event.name}`, "attack");
      document.body.classList.remove("quake"); void document.body.offsetWidth; document.body.classList.add("quake");
    }
    else if (event.type === "boom") this.banner(`RAID! +${event.viewers} BUILDERS`, "raid");
  }

  private banner(text: string, kind: string) {
    // No alert banners anywhere: the city itself shows what happened (eras, attacks, raids).
    void text; void kind;
  }

  private spawnPop(pop: { label: string; points: number; unit?: string; credit?: boolean }) {
    // Chat points sparkle up all over town; build credits and wrecks stay where it happened.
    const scattered = !pop.credit && !pop.unit ? this.options.scatterPoint?.() : undefined;
    const anchor = scattered ?? this.options.screenPoint();
    const node = el("div", `pop ${pop.points >= 0 ? "pop-plus" : "pop-minus"}${pop.unit ? " pop-wreck" : ""}${pop.credit ? " pop-credit" : ""}`);
    node.append(el("span", "pop-points", `${pop.points >= 0 ? "+" : ""}${pop.points}${pop.unit ? ` ${pop.unit}` : ""}`), el("span", "pop-label", pop.label));
    // Fan pops out into six slots around the anchor so bursts never stack on top of each other.
    const spread = scattered ? 24 : this.options.overlay ? 60 : 110;
    const slot = this.slot++ % 6;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const dx = (slot % 3 - 1) * spread * 1.1 + (Math.random() - 0.5) * spread * 0.3;
    const dy = (slot < 3 ? -1 : 1) * spread * 0.32 + (Math.random() - 0.5) * 10;
    node.style.left = `${clamp(anchor.x + dx, 90, innerWidth - 90)}px`;
    node.style.top = `${clamp(anchor.y + dy, 60, innerHeight - 160)}px`;
    node.style.setProperty("--tilt", `${(Math.random() - 0.5) * 16}deg`);
    this.popLayer.appendChild(node);
    this.live++;
    setTimeout(() => { node.remove(); this.live--; }, 1900);
  }
}
