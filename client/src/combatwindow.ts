// Fenêtre de combat détaillée (Docs/Design/10-Combat-Phases.md §3) : rejoue un rapport (`CombatView`) tir par tir.
// Le joueur local à gauche, l'adversaire à droite, en miroir. En haut, la bande des avions (vide) ; aux bords, les
// renforts (seconde ligne) en haut et les pertes en bas ; au milieu, une colonne par niche, du centre vers l'extérieur :
// chars, infanterie, antichar, antiaérien, artillerie. Chaque division est une icône de 32 px avec la barre de vie des
// pions. Chaque tir : la niche qui tire est surlignée, ses unités jouent l'animation de tir avec un petit retard
// aléatoire, autant d'impacts tombent en face (d'abord sur les divisions réellement touchées), puis la barre de vie de
// chaque division touchée baisse ; les tuées et les fuyardes deviennent pâles mais restent à leur place, et tirent
// jusqu'à la fin du cycle. Quand des renforts ont pris des pertes, ils arrivent de leur colonne par vagues et l'attaque
// est rejouée sur eux. En fin de cycle, tuées et fuyardes partent dans les pertes. Toutes les unités sont posées en absolu dans le corps de la fenêtre : un changement de place
// est une transition CSS.
// Rien ici ne recalcule un combat : tout vient des tirs du rapport.

import "./combat.css";
import { COMBAT_KIND, PHASE_NICHES, lossPercent } from "./combatdata.ts";
import { playerName } from "./names.ts";
import type { CombatShotView, CombatView, MilitaryCatalog } from "./protocol.ts";
import { attachTextPanel, hidePanel, unitPanel } from "./infopanels.ts";
import { unitIconUrl } from "./uniticons.ts";

/**
 * Animations de `icons/animations/` et leur durée, en ms. Au chargement de la page (`loadAnimations`), chaque GIF est lu
 * une fois : sa durée est relue dans le fichier (un GIF retouché garde toutes ses images), et `bytes` garde le fichier
 * sans sa boucle. `ms` ci-dessous ne sert qu'avant cette lecture.
 */
const ANIM: Record<"cannon" | "rifle" | "explosion" | "incoming", { readonly url: string; ms: number; bytes?: Uint8Array }> = {
  cannon: { url: "icons/animations/canon%20fire.gif", ms: 1040 },
  rifle: { url: "icons/animations/automatic%20rifle%20fire.gif", ms: 640 },
  explosion: { url: "icons/animations/explosion%201.gif", ms: 960 },
  incoming: { url: "icons/animations/incoming%20rifle%20fire.gif", ms: 480 },
};
type Anim = keyof typeof ANIM;

/**
 * Durée d'un GIF, en ms : somme des délais de ses images (blocs « Graphic Control Extension », 0x21 0xF9 0x04, délai en
 * centièmes de seconde). `null` si aucun délai n'est trouvé.
 */
function gifDuration(bytes: Uint8Array): number | null {
  let total = 0;
  let frames = 0;
  for (let i = 0; i + 5 < bytes.length; i++) {
    if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xf9 || bytes[i + 2] !== 0x04) continue;
    total += (bytes[i + 4]! | (bytes[i + 5]! << 8)) * 10;
    frames++;
    i += 7;
  }
  return frames === 0 ? null : total;
}

/**
 * Le GIF sans son bloc de boucle (extension d'application « NETSCAPE2.0 », 19 octets) : il se joue une seule fois et
 * s'arrête sur sa dernière image.
 */
function withoutLoop(bytes: Uint8Array): Uint8Array {
  const tag = [0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (ch) => ch.charCodeAt(0))];
  for (let i = 0; i + 19 <= bytes.length; i++) {
    if (tag.every((b, k) => bytes[i + k] === b)) return new Uint8Array([...bytes.subarray(0, i), ...bytes.subarray(i + 19)]);
  }
  return bytes;
}

let animationsLoaded = false;
/** Charge les GIF une fois, relit leur durée et garde chaque fichier sans sa boucle. */
function loadAnimations(): void {
  if (animationsLoaded) return;
  animationsLoaded = true;
  for (const a of Object.values(ANIM)) {
    void fetch(a.url)
      .then((r) => r.arrayBuffer())
      .then((b) => {
        const bytes = new Uint8Array(b);
        const ms = gifDuration(bytes);
        if (ms !== null && ms > 0) a.ms = ms;
        a.bytes = withoutLoop(bytes);
      })
      .catch(() => undefined);
  }
}

/** Animation de tir, sa position, et l'impact qu'elle provoque en face, par niche (10-Combat-Phases §3). */
const FIRE: Readonly<Record<string, { readonly fire: Anim; readonly up: boolean; readonly impact: Anim }>> = {
  tanks: { fire: "cannon", up: false, impact: "explosion" },
  infantry: { fire: "rifle", up: false, impact: "incoming" },
  antiTank: { fire: "cannon", up: false, impact: "explosion" },
  antiAir: { fire: "rifle", up: true, impact: "incoming" },
  artillery: { fire: "cannon", up: true, impact: "explosion" },
};

/** Tempo, en ms (*provisoire*, 10-Combat-Phases §6) : retard aléatoire des tirs, puis des impacts, pause, déplacement. */
const FIRE_JITTER_MS = 250;
const IMPACT_AFTER_MS = 100;
const IMPACT_JITTER_MS = 120;
/**
 * Descente d'une barre de vie touchée, en deux temps (transitions de combat.css) : la barre descend et laisse la part
 * perdue en blanc, puis le blanc descend à son tour.
 */
const DROP_MS = 700;
/** Pause après les impacts : la descente des barres, et un peu de marge. */
const SETTLE_MS = DROP_MS + 300;
const MOVE_MS = 360;
const BETWEEN_SHOTS_MS = 300;

/** Taille d'une icône, dans les niches puis dans les colonnes des bords. */
const ICON = 32;
const SMALL = 24;
/** Écart vertical entre deux rangées d'une niche, quand elles tiennent sans se serrer. */
const ROW_STEP = ICON + 14;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Nombre pseudo-aléatoire stable dans [0, 1) pour une division : son décalage reste le même d'une mise en page à l'autre. */
function jitter(i: number, salt: number): number {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x ^= x >>> 13;
  return (x >>> 0) / 0x100000000;
}

/** Où est une division dans la fenêtre. */
type Place = "line" | "reserve" | "lost";

/** Une division affichée. */
interface Unit {
  readonly i: number;
  readonly side: 0 | 1;
  readonly niche: string;
  readonly root: HTMLElement;
  readonly flip: HTMLElement;
  readonly fill: HTMLElement;
  /** Part perdue, en blanc, sous la barre : elle suit la barre avec un temps de retard. */
  readonly lost: HTMLElement;
  hp: number;
  place: Place;
  dead: boolean;
  fled: boolean;
}

/** Un rectangle du corps de la fenêtre, en px. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export class CombatWindow {
  private readonly panel: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly me: () => number;
  private timers: number[] = [];
  private onResize: (() => void) | null = null;
  /** Clic sur « Passer » (ou « Résumé » à la fin) : ouvre le résumé du combat affiché. */
  onSkip: ((c: CombatView) => void) | null = null;

  constructor(root: HTMLElement, military: MilitaryCatalog, me: () => number) {
    this.military = military;
    this.me = me;
    this.panel = el("div", "cw themed");
    this.panel.hidden = true;
    root.append(this.panel);
    loadAnimations();
  }

  close(): void {
    hidePanel();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.onResize !== null) window.removeEventListener("resize", this.onResize);
    this.onResize = null;
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  open(c: CombatView): void {
    this.close();
    const m = this.military;
    const me = this.me();
    const sideOf = (owner: number): 0 | 1 => (owner === me ? 0 : 1);
    const nicheOf = (i: number): string => m.divisions[c.units[i]!.type]?.niche ?? "infantry";

    // ---- squelette ----
    const head = el("div", "cw-head");
    head.append(
      el("strong", undefined, COMBAT_KIND[c.kind]),
      el("span", undefined, c.attacker === me ? `— vous attaquez ${playerName(c.defender)}` : `— ${playerName(c.attacker)} vous attaque`),
    );
    const status = el("span", "cw-status");
    const closeBtn = el("button", "fw-btn", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => this.close());
    head.append(el("div", "fw-spacer"), status, closeBtn);

    const body = el("div", "cw-body");
    const air = el("div", "cw-air", "Réservé : aviation");
    const mid = el("div", "cw-mid");
    const boxes = [0, 1].map((s) => {
      const reserve = el("div", `cw-box cw-reserve s${s}`);
      reserve.append(el("div", "cw-box-title", "Renforts"));
      const lost = el("div", `cw-box cw-lost s${s}`);
      const legend = el("div", "cw-legend");
      legend.append(el("span", "cw-cross small"), el("span", undefined, "mort"), el("img", "cw-flag-icon"), el("span", undefined, "en fuite"));
      (legend.children[2] as HTMLImageElement).src = "icons/miscellaneous/icon-white-flag.png";
      lost.append(el("div", "cw-box-title", "Pertes"), legend);
      return { reserve, lost };
    });
    const niches = [0, 1].map((s) =>
      PHASE_NICHES.map((n) => {
        const box = el("div", `cw-niche s${s} n-${n}`);
        box.append(el("div", "cw-niche-title", nicheTitle(n)));
        return box;
      }),
    );
    const layer = el("div", "cw-layer");
    body.append(air, ...boxes.flatMap((b) => [b.reserve, b.lost]), ...niches.flat(), mid, layer);

    const foot = el("div", "cw-foot");
    const order = el("div", "cw-order");
    const steps = PHASE_NICHES.map((n) => el("span", "cw-step", nicheTitle(n)));
    steps.forEach((s, k) => {
      if (k > 0) order.append(el("span", "cw-arrow", "→"));
      order.append(s);
    });
    const skip = el("button", "cw-skip go", "Passer ▸▸");
    skip.type = "button";
    skip.addEventListener("click", () => {
      this.close();
      this.onSkip?.(c);
    });
    foot.append(order, el("div", "fw-spacer"), skip);
    this.panel.replaceChildren(head, body, foot);
    this.panel.hidden = false;

    // ---- divisions ----
    const units: Unit[] = c.units.map((u, i) => {
      const side = sideOf(u.owner);
      const info = m.divisions[u.type];
      const root = el("div", u.reserve ? "cw-u" : "cw-u line");
      const flip = el("div", side === 1 ? "cw-uf flip" : "cw-uf");
      const icon = el("img", "cw-ic");
      icon.src = info === undefined ? "" : unitIconUrl(info.icon, u.owner);
      icon.alt = "";
      const bar = el("div", "pz-bar");
      const fill = el("div", "pz-fill");
      const lost = el("div", "cw-lostfill");
      bar.append(lost, fill);
      flip.append(icon, bar);
      // Infanterie du défenseur : sacs de sable par-dessus l'icône (plus de PV en défense, 10-Combat-Phases §3), visibles
      // seulement en première ligne pendant qu'elle se bat (CSS) ; dans le cadre retourné, ils regardent vers le centre.
      if (u.owner === c.defender && info?.niche === "infantry") {
        const bags = el("img", "cw-sandbag");
        bags.src = "icons/armament/icon-sandbag.png";
        bags.alt = "";
        flip.append(bags);
      }
      const flag = el("img", "cw-flag");
      flag.src = "icons/miscellaneous/icon-white-flag.png";
      flag.alt = "";
      root.append(flip, el("div", "cw-cross"), flag);
      layer.append(root);
      // Survol : le même panneau que pour un pion, à l'état du moment dans le combat.
      attachTextPanel(root, () => {
        const unit = units[i]!;
        const status = unit.dead ? "Détruite" : unit.fled ? "En repli" : unit.place === "reserve" ? "En seconde ligne" : null;
        return unitPanel(m, { type: u.type, owner: u.owner, state: unit.hp }, status);
      });
      return { i, side, niche: nicheOf(i), root, flip, fill, lost, hp: u.start, place: u.reserve ? "reserve" : "line", dead: false, fled: false };
    });
    /** Barre de vie à l'état de la division ; `lost` : la part blanche aussi (sinon elle reste à l'ancienne hauteur). */
    const drawBar = (u: Unit, lost = true): void => {
      const part = Math.max(0, Math.min(1, u.hp / m.stateScale));
      u.fill.style.height = `${Math.round(30 * part)}px`;
      u.fill.style.background = `hsl(${Math.round(120 * part)},75%,45%)`;
      if (lost) u.lost.style.height = u.fill.style.height;
    };
    units.forEach((u) => drawBar(u));

    // ---- mise en page ----
    const layout = (): void => {
      const W = body.clientWidth;
      const H = body.clientHeight;
      if (W === 0 || H === 0) return;
      const G = 8;
      const airH = Math.round(H * 0.15);
      const SW = Math.max(96, Math.min(150, Math.round(W * 0.1)));
      const CX = W / 2;
      const top = airH + G;
      const bottom = H - G;
      const half = top + (bottom - top) / 2;
      const NW = (CX - SW - 2 * G - 4) / PHASE_NICHES.length;
      const put = (e: HTMLElement, r: Rect): void => {
        e.style.left = `${r.x}px`;
        e.style.top = `${r.y}px`;
        e.style.width = `${r.w}px`;
        e.style.height = `${r.h}px`;
      };
      put(air, { x: G, y: G, w: W - 2 * G, h: airH - G });
      put(mid, { x: CX - 1, y: top, w: 2, h: bottom - top });
      const nicheRect = (s: 0 | 1, k: number): Rect => ({ x: s === 0 ? CX - 4 - (k + 1) * NW : CX + 4 + k * NW, y: top, w: NW, h: bottom - top });
      for (const s of [0, 1] as const) {
        const x0 = s === 0 ? G : W - G - SW;
        put(boxes[s]!.reserve, { x: x0, y: top, w: SW, h: half - top - 4 });
        put(boxes[s]!.lost, { x: x0, y: half + 4, w: SW, h: bottom - half - 4 });
        PHASE_NICHES.forEach((_, k) => {
          const r = nicheRect(s, k);
          put(niches[s]![k]!, { x: r.x + 2, y: r.y, w: r.w - 4, h: r.h });
        });
      }
      // Divisions en ligne : une colonne par niche, groupée en haut, une colonne de plus seulement quand elles ne tiennent
      // plus sur la hauteur ; sur un petit écran, les colonnes se resserrent avant que les icônes ne rapetissent.
      for (const s of [0, 1] as const) {
        PHASE_NICHES.forEach((n, k) => {
          const here = units.filter((u) => u.side === s && u.niche === n && u.place === "line");
          if (here.length === 0) return;
          const r = nicheRect(s, k);
          const y0 = r.y + 30;
          const span = Math.max(0, r.h - 30 - ICON - 16);
          const maxRows = Math.max(1, Math.floor(span / ROW_STEP) + 1);
          const cols = Math.ceil(here.length / maxRows);
          const rows = Math.ceil(here.length / cols);
          const dy = rows > 1 ? Math.min(ROW_STEP, span / (rows - 1)) : 0;
          const colStep = cols > 1 ? Math.min(ICON + 10, (r.w - ICON - 12) / (cols - 1)) : 0;
          const stagger = Math.min(6, colStep / 4 + 2);
          here.forEach((u, j) => {
            const row = j % rows;
            const col = Math.floor(j / rows);
            const cx = r.x + r.w / 2 - (ICON + 5) / 2 + (col - (cols - 1) / 2) * colStep + (row % 2 === 0 ? -stagger : stagger) * (s === 0 ? 1 : -1);
            const x = cx + (jitter(u.i, 1) - 0.5) * 4;
            const y = y0 + row * dy + (jitter(u.i, 2) - 0.5) * Math.min(6, dy / 4);
            move(u, x, y, 1);
          });
        });
        // Colonnes des bords : icônes de 24 px serrées ; la colonne des pertes garde la place de sa légende.
        const x0 = s === 0 ? G : W - G - SW;
        const grid = (list: Unit[], y: number, h: number): void => {
          const cols = Math.max(1, Math.floor((SW - 8) / (SMALL + 4)));
          const rows = Math.ceil(list.length / cols);
          const step = rows > 1 ? Math.min(SMALL + 6, (h - SMALL) / (rows - 1)) : 0;
          list.forEach((u, j) => move(u, x0 + 4 + (j % cols) * (SMALL + 4), y + Math.floor(j / cols) * step, SMALL / ICON));
        };
        grid(units.filter((u) => u.side === s && u.place === "reserve"), top + 24, half - top - 32);
        grid(units.filter((u) => u.side === s && u.place === "lost"), half + 28, bottom - half - 76);
      }
    };
    const move = (u: Unit, x: number, y: number, k: number): void => {
      u.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${k})`;
    };
    // Première mise en page sans transition : les unités ne glissent pas depuis le coin.
    layer.classList.add("still");
    layout();
    void layer.offsetWidth;
    layer.classList.remove("still");
    this.onResize = layout;
    window.addEventListener("resize", layout);

    // ---- effets ----
    const at = (ms: number, fn: () => void): void => {
      this.timers.push(window.setTimeout(fn, ms));
    };
    /** Joue une animation par-dessus une division : un `img` neuf (un GIF ne repart pas du début si on remet sa source). */
    /**
     * Joue une animation une fois par-dessus une division. Chaque fois une URL neuve (`blob:`) du GIF sans boucle : le
     * navigateur fait avancer ensemble toutes les images d'une même URL, une nouvelle partirait donc au milieu de
     * l'animation, ou sur sa dernière image.
     */
    const play = (u: Unit, anim: Anim, cls: string): void => {
      const a = ANIM[anim];
      const img = el("img", cls);
      const url = a.bytes === undefined ? null : URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: "image/gif" }));
      img.src = url ?? a.url;
      img.alt = "";
      u.flip.append(img);
      at(a.ms, () => {
        img.remove();
        if (url !== null) URL.revokeObjectURL(url);
      });
    };
    const setPlace = (u: Unit, place: Place): void => {
      u.place = place;
      u.root.classList.toggle("out", place === "lost");
      u.root.classList.toggle("line", place === "line");
    };

    /**
     * Une vague d'un tir (10-Combat-Phases §3), à partir de `t0` ms : les unités qui tirent jouent leur animation, autant
     * d'impacts tombent en face, d'abord sur `hits` (une par niche du centre vers l'extérieur, puis les autres), puis au
     * hasard sur les chars et l'infanterie ; les barres de `hits` baissent ; les tuées et les fuyardes de la vague
     * deviennent pâles, avec leur croix ou leur drapeau, et restent à leur place jusqu'à la fin du cycle. Renvoie sa durée.
     */
    const playWave = (shot: CombatShotView, hits: readonly (readonly [number, number])[], t0: number): number => {
      const side = sideOf(shot.owner);
      const niche = m.niches[shot.niche]?.id ?? "infantry";
      const fx = FIRE[niche] ?? FIRE.infantry!;
      const hit = hits.filter(([, loss]) => loss > 0).map(([i]) => i);
      const byNiche = PHASE_NICHES.map((n) => hit.filter((i) => units[i]!.niche === n));
      const firstRound = byNiche.flatMap((l) => l.slice(0, 1));
      const ordered = [...firstRound, ...hit.filter((i) => !firstRound.includes(i))];
      const targets: number[] = ordered.slice(0, shot.shooters.length);
      const main = units.filter((u) => u.side !== side && u.place === "line" && !u.dead && !u.fled && (u.niche === "tanks" || u.niche === "infantry")).map((u) => u.i);
      while (targets.length < shot.shooters.length && main.length > 0) targets.push(main[Math.floor(Math.random() * main.length)]!);
      const lastImpact = new Map<number, number>();
      let end = t0;
      shot.shooters.forEach((s, j) => {
        const fireAt = t0 + Math.random() * FIRE_JITTER_MS;
        at(fireAt, () => play(units[s]!, fx.fire, fx.up ? "cw-fx fire-up" : "cw-fx fire-h"));
        const target = targets[j];
        if (target === undefined) return;
        const impactAt = fireAt + IMPACT_AFTER_MS + Math.random() * IMPACT_JITTER_MS;
        at(impactAt, () => play(units[target]!, fx.impact, "cw-fx cw-inc"));
        const done = impactAt + ANIM[fx.impact].ms;
        lastImpact.set(target, Math.max(lastImpact.get(target) ?? 0, done));
        end = Math.max(end, done);
      });
      end = Math.max(end, t0 + FIRE_JITTER_MS + IMPACT_AFTER_MS);
      // Pertes : la barre baisse après le dernier impact sur la division.
      for (const [i, loss] of hits) {
        if (loss <= 0) continue;
        at(lastImpact.get(i) ?? end, () => {
          const u = units[i]!;
          u.hp = Math.max(0, u.hp - loss);
          // La barre descend en continu et laisse la part perdue en blanc, puis le blanc descend à son tour ; les dégâts
          // reçus s'affichent en petit à côté de la barre pendant ce temps.
          const dmg = el("div", "cw-dmg", `−${lossPercent(m, loss)} %`);
          u.root.append(dmg);
          at(SETTLE_MS, () => dmg.remove());
          drawBar(u, false);
          at(DROP_MS / 2, () => drawBar(u));
        });
      }
      const after = end + SETTLE_MS;
      // Tuées : en attendant l'animation de mort de l'auteur, pâles et croix rouge ; en fuite : pâles et drapeau blanc.
      at(after, () => {
        for (const [i] of hits) {
          if (shot.destroyed.includes(i)) {
            units[i]!.dead = true;
            units[i]!.root.classList.add("dead");
          } else if (shot.fled.includes(i)) {
            units[i]!.fled = true;
            units[i]!.root.classList.add("fled");
          }
        }
      });
      return after - t0;
    };

    /**
     * Un tir (10-Combat-Phases §3), à partir de `t0` ms ; renvoie sa durée. Sans renfort, une seule vague. Quand des
     * renforts ont pris les pertes que la première ligne ne pouvait plus prendre : la première vague touche la ligne,
     * puis les renforts arrivent de leur colonne, autant que d'unités sorties à la vague d'avant, et l'attaque est
     * rejouée sur eux, et ainsi de suite jusqu'au dernier renfort.
     */
    const playShot = (shot: CombatShotView, t0: number, label: string): number => {
      const side = sideOf(shot.owner);
      const k = PHASE_NICHES.indexOf((m.niches[shot.niche]?.id ?? "infantry") as (typeof PHASE_NICHES)[number]);
      at(t0, () => {
        status.textContent = label;
        for (const s of [0, 1]) niches[s]!.forEach((e, j) => e.classList.toggle("firing", s === side && j === k));
        steps.forEach((e, j) => e.classList.toggle("on", j === k));
      });
      const late = new Set(shot.reinforced);
      let wave = shot.hits.filter(([i]) => !late.has(i));
      const queue = [...shot.reinforced];
      let t = t0;
      for (;;) {
        t += playWave(shot, wave, t);
        if (queue.length === 0) break;
        const gone = wave.filter(([i]) => shot.destroyed.includes(i) || shot.fled.includes(i)).length;
        const coming = queue.splice(0, Math.max(1, gone));
        at(t, () => {
          for (const i of coming) setPlace(units[i]!, "line");
          layout();
        });
        t += MOVE_MS + BETWEEN_SHOTS_MS;
        wave = shot.hits.filter(([i]) => coming.includes(i));
      }
      return t - t0;
    };

    // ---- déroulé ----
    const sideWord = (owner: number): string => (owner === c.attacker ? "l'attaquant" : "le défenseur");
    let t = 400;
    c.cycles.forEach((cy, ci) => {
      for (const shot of cy.shots) {
        const label = `${nicheTitle(m.niches[shot.niche]?.id ?? "")} : ${sideWord(shot.owner)} (${playerName(shot.owner)}) tire`;
        t += playShot(shot, t, c.cycles.length > 1 ? `Cycle ${ci + 1} / ${c.cycles.length} — ${label}` : label) + BETWEEN_SHOTS_MS;
      }
      // Fin de cycle : les tuées et les fuyardes partent dans les pertes, comme les divisions repliées faute
      // d'infanterie ; les renforts montés au rangement arrivent de leur colonne.
      at(t, () => {
        if (cy.shots.length === 0) status.textContent = "Plus d'infanterie en face : avancée";
        for (const i of cy.fled) {
          units[i]!.fled = true;
          units[i]!.root.classList.add("fled");
        }
        for (const u of units) if (u.place === "line" && (u.dead || u.fled)) setPlace(u, "lost");
        for (const i of cy.arrived) setPlace(units[i]!, "line");
        layout();
      });
      t += MOVE_MS + BETWEEN_SHOTS_MS;
    });
    // Fin du combat : le résumé s'ouvre tout seul.
    at(t, () => {
      this.close();
      this.onSkip?.(c);
    });
  }
}

/** Titre d'une niche dans les fenêtres de combat. */
export function nicheTitle(id: string): string {
  return NICHE_TITLES[id] ?? id;
}
const NICHE_TITLES: Readonly<Record<string, string>> = {
  tanks: "Chars",
  infantry: "Infanterie",
  antiTank: "Antichar",
  antiAir: "Antiaérien",
  artillery: "Artillerie",
};
