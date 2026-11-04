// Combats résolus en un tour par le moteur (Docs/Design/06-Combat-Simplifie.md §2) :
// - `CombatIcons` : une icône par combat récent du joueur local, posée sur la carte au
//   milieu de la connexion du combat, retirée après `ICON_TURNS` tours ou au clic ;
// - `CombatReplay` : le panneau qui rejoue un rapport (`CombatView`) round par round.
//   Les deux camps sont en deux colonnes face à face, une carte par groupe de divisions
//   du même type (×N), avec leurs attaques et leurs PV ; en haut, le rapport de force.
//   À chaque round, les barres de vie baissent de la perte, la perte s'affiche, une
//   division détruite quitte son groupe, une division en fuite passe dans une carte en
//   retrait, avec le drapeau blanc. À la fin : les pertes en hommes et en matériel.
// Le rapport vient du moteur : rien ici ne recalcule un combat. Les statistiques des
// cartes sont estimées sur l'état des divisions (le rapport ne garde pas les exemplaires).

import { num } from "./format.ts";
import { icon32Path, productIcon } from "./icons.ts";
import { equipmentName, playerName, unitName } from "./names.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";

/** Durée de vie d'une icône de combat sur la carte, en tours (300 = 30 s ; provisoire, 06-Combat-Simplifie §2). */
const ICON_TURNS = 300;
/** Durée d'un round dans le replay, en ms (provisoire, 06-Combat-Simplifie §2) : 50 rounds en 15 s au plus. */
const ROUND_MS = 300;
/** Durée de l'approche des deux colonnes avant le premier round, en ms. */
const APPROACH_MS = 700;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Une ligne d'historique : « tour, attaquant, résultat » (fenêtre d'un front, 06-Combat-Simplifie §2). */
export function combatSummary(c: CombatView, me: number): string {
  const seconds = Math.floor(c.tick / 10);
  const who = c.attacker === me ? `Vous attaquez ${playerName(c.defender)}` : `${playerName(c.attacker)} vous attaque`;
  const advance = c.rounds.reduce((s, r) => s + r.advance, 0);
  const result = c.captured !== 0 ? `ville n° ${c.captured} prise` : advance > 0 ? `avancée ${Math.round(advance / 10)} %` : "pas d'avancée";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} — ${who} — ${result}`;
}

/** Icône (16 × 16, `public/icons/miscellaneous/`) de chaque statistique, comme dans la fenêtre d'un front. */
const STAT_ICON = {
  soft: "icons/miscellaneous/icon-soft-attack.png",
  hard: "icons/miscellaneous/icon-hard-attack.png",
  hp: "icons/miscellaneous/icon-health.png",
} as const;
const STAT_LABEL = { soft: "Attaque anti-infanterie (soft)", hard: "Attaque anti-blindé (hard)", hp: "PV" } as const;
type Stat = keyof typeof STAT_ICON;
const STATS: readonly Stat[] = ["soft", "hard", "hp"];
type Stats = Record<Stat, number>;
const noStats = (): Stats => ({ soft: 0, hard: 0, hp: 0 });

/** Au-delà de ce nombre de divisions, une carte n'en montre qu'une icône avec le nombre (×N) (provisoire, 06-Combat-Simplifie §2). */
const MAX_SIDE_BY_SIDE = 4;

/** Une carte du replay : les divisions d'un camp, d'un même type, en ligne ou en fuite. */
interface Group {
  readonly key: string;
  readonly side: 0 | 1;
  readonly type: number;
  readonly fled: boolean;
  readonly card: HTMLElement;
  /** Les icônes des divisions, côte à côte, ou une seule avec ×N. */
  readonly pawns: HTMLElement;
  readonly dmg: HTMLElement;
  readonly stats: Record<Stat, HTMLElement>;
}

function statIcon(kind: Stat): HTMLImageElement {
  const img = el("img", "cr-stat-icon");
  img.src = STAT_ICON[kind];
  img.alt = "";
  img.title = STAT_LABEL[kind];
  return img;
}

export class CombatReplay {
  private readonly root: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly armamentIds: readonly string[];
  private readonly me: () => number;
  private readonly panel: HTMLElement;
  private timers: number[] = [];

  constructor(root: HTMLElement, military: MilitaryCatalog, armamentIds: readonly string[], me: () => number) {
    this.root = root;
    this.military = military;
    this.armamentIds = armamentIds;
    this.me = me;
    this.panel = el("div", "cr themed");
    this.panel.hidden = true;
    this.root.append(this.panel);
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  open(c: CombatView): void {
    this.close();
    const m = this.military;
    const me = this.me();
    const scale = m.stateScale;
    const other = me === c.attacker ? c.defender : c.attacker;
    // Le joueur local à gauche (camp 0), l'adversaire à droite (camp 1).
    const sideOf = (owner: number): 0 | 1 => (owner === me ? 0 : 1);
    const attackerSide = sideOf(c.attacker);

    const head = el("div", "cr-head");
    head.append(el("strong", undefined, c.attacker === me ? `Votre attaque contre ${playerName(c.defender)}` : `Attaque de ${playerName(c.attacker)}`));
    const skip = el("button", "fw-btn", "Passer");
    skip.type = "button";
    const closeBtn = el("button", "fw-btn", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => this.close());
    head.append(el("div", "fw-spacer"), skip, closeBtn);

    // Rapport de force : une barre par statistique, la part de chaque camp (gauche : le joueur local).
    const balance = el("div", "cr-balance");
    const names = el("div", "cr-names");
    names.append(el("span", "cr-me", playerName(me)), el("span", "cr-them", playerName(other)));
    balance.append(names);
    const bars = STATS.map((kind) => {
      const row = el("div", "cr-bal-row");
      const a = el("span", "cr-bal-num");
      const b = el("span", "cr-bal-num right");
      const track = el("div", "cr-bal-track");
      const fill = el("div", "cr-bal-fill");
      track.append(fill);
      row.append(a, statIcon(kind), track, b);
      balance.append(row);
      return { a, b, fill };
    });

    const round = el("div", "cr-round", "");
    const field = el("div", "cr-field");
    const cols = [el("div", "cr-col cr-left"), el("div", "cr-col cr-right")] as const;
    field.append(cols[0], cols[1]);
    const result = el("div", "cr-result");

    // État de chaque division au fil du replay.
    const hp = c.units.map((u) => u.start);
    const fled = c.units.map(() => false);
    const dead = c.units.map(() => false);

    const groups = new Map<string, Group>();
    const groupOf = (i: number): Group => {
      const u = c.units[i]!;
      const side = sideOf(u.owner);
      const isFled = fled[i]!;
      const key = `${side}:${u.type}:${isFled ? 1 : 0}`;
      const found = groups.get(key);
      if (found !== undefined) return found;
      const info = m.divisions[u.type];
      const card = el("div", isFled ? "cr-unit fled" : "cr-unit");
      const pawns = el("div", "cr-pawns");
      const body = el("div", "cr-body");
      const statsEl = el("div", "cr-stats");
      const stats = {} as Record<Stat, HTMLElement>;
      for (const kind of STATS) {
        const v = el("span", "cr-stat-v");
        const one = el("span", "cr-stat");
        one.append(statIcon(kind), v);
        statsEl.append(one);
        stats[kind] = v;
      }
      body.append(el("div", "cr-name", info === undefined ? "" : unitName(info.id)), statsEl);
      const dmg = el("div", "cr-dmg");
      card.append(dmg, pawns, body);
      const g: Group = { key, side, type: u.type, fled: isFled, card, pawns, dmg, stats };
      groups.set(key, g);
      // Ordre des cartes : par type, les cartes en fuite en dernier.
      const col = cols[side];
      const later = [...groups.values()].filter((x) => x.side === side && x !== g && (Number(x.fled) > Number(isFled) || (x.fled === isFled && x.type > u.type)));
      const before = [...col.children].find((e) => later.some((x) => x.card === e));
      if (before !== undefined) col.insertBefore(card, before);
      else col.append(card);
      return g;
    };

    /** Statistiques d'une division d'après son état ; attaques × `attackMultiplier` pour l'attaquant (05-Fronts §6.1). */
    const statsOf = (i: number): Stats => {
      const u = c.units[i]!;
      const type = m.divisions[u.type]!;
      const k = hp[i]! / scale;
      const mult = sideOf(u.owner) === attackerSide ? type.attackMultiplier / 100 : 1;
      let soft = 0;
      let hard = 0;
      for (const comp of type.components) {
        soft += comp.softAttack;
        hard += comp.hardAttack;
      }
      return { soft: soft * k * mult, hard: hard * k * mult, hp: type.hitPoints * k };
    };

    /** Une icône de division avec sa barre de vie (`state` sur `scale`), le drapeau blanc en fuite, et ×N si `n` > 1. */
    const pawn = (type: number, isFled: boolean, state: number, n: number): HTMLElement => {
      const info = m.divisions[type];
      const p = el("div", "cr-pawn");
      const box = el("div", "cr-iconbox");
      const img = el("img", "cr-icon");
      img.src = info === undefined ? "" : `icons/${icon32Path(info.icon)}`;
      img.alt = "";
      box.append(img);
      if (isFled) {
        const flag = el("img", "cr-flag");
        flag.src = "icons/miscellaneous/icon-white-flag.png";
        flag.alt = "";
        flag.title = "En fuite";
        box.append(flag);
      }
      if (n > 1) box.append(el("span", "cr-count", `×${n}`));
      const bar = el("div", "cr-bar");
      const fill = el("div", "cr-fill");
      fill.style.width = `${(100 * state) / scale}%`;
      bar.append(fill);
      p.append(box, bar);
      return p;
    };

    const redraw = (lossByGroup: ReadonlyMap<string, number>): void => {
      const totals = [noStats(), noStats()];
      const perGroup = new Map<string, { alive: number[]; stats: Stats }>();
      c.units.forEach((u, i) => {
        const g = groupOf(i);
        const e = perGroup.get(g.key) ?? { alive: [], stats: noStats() };
        perGroup.set(g.key, e);
        if (dead[i]) return;
        const st = statsOf(i);
        e.alive.push(i);
        for (const kind of STATS) e.stats[kind] += st[kind];
        // Le rapport de force ne compte que les divisions en ligne.
        if (!fled[i]) for (const kind of STATS) totals[sideOf(u.owner)]![kind] += st[kind];
      });
      for (const g of groups.values()) {
        const e = perGroup.get(g.key) ?? { alive: [], stats: noStats() };
        const n = e.alive.length;
        g.card.classList.toggle("dead", n === 0);
        // Peu de divisions : côte à côte, chacune avec sa barre ; trop : une icône ×N et l'état moyen.
        if (n <= MAX_SIDE_BY_SIDE) g.pawns.replaceChildren(...e.alive.map((i) => pawn(g.type, g.fled, hp[i]!, 1)));
        else g.pawns.replaceChildren(pawn(g.type, g.fled, e.alive.reduce((s, i) => s + hp[i]!, 0) / n, n));
        for (const kind of STATS) g.stats[kind].textContent = String(Math.round(e.stats[kind]));
        const loss = lossByGroup.get(g.key) ?? 0;
        g.dmg.textContent = loss > 0 ? `−${Math.max(1, Math.round((100 * loss) / scale))} %` : "";
        if (loss > 0) {
          g.card.classList.remove("hit");
          void g.card.offsetWidth;
          g.card.classList.add("hit");
        }
      }
      STATS.forEach((kind, k) => {
        const a = totals[0]![kind];
        const b = totals[1]![kind];
        bars[k]!.a.textContent = String(Math.round(a));
        bars[k]!.b.textContent = String(Math.round(b));
        bars[k]!.fill.style.width = a + b > 0 ? `${(100 * a) / (a + b)}%` : "50%";
      });
    };

    this.panel.replaceChildren(head, balance, round, field, result);
    this.panel.hidden = false;
    redraw(new Map());

    let next = 0;
    const showRound = (): void => {
      const r = next++;
      const rd = c.rounds[r]!;
      round.textContent = `Round ${r + 1} / ${c.rounds.length}`;
      // Les pertes sont rangées dans le groupe où la division était pendant le round.
      const lossByGroup = new Map<string, number>();
      for (const [i, loss] of rd.hits) {
        const key = groupOf(i).key;
        lossByGroup.set(key, (lossByGroup.get(key) ?? 0) + loss);
        hp[i] = Math.max(0, hp[i]! - loss);
      }
      for (const i of rd.destroyed) dead[i] = true;
      for (const i of rd.fled) fled[i] = true;
      redraw(lossByGroup);
    };
    const finish = (): void => {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      while (next < c.rounds.length) showRound();
      redraw(new Map());
      round.textContent = `${c.rounds.length} round${c.rounds.length > 1 ? "s" : ""}`;
      const advance = c.rounds.reduce((s, r) => s + r.advance, 0);
      const losses = (side: 0 | 1): HTMLElement => {
        const l = c.losses[side === attackerSide ? 0 : 1];
        const box = el("div", side === 0 ? "cr-loss" : "cr-loss right");
        box.append(el("strong", undefined, side === 0 ? "Vos pertes" : `Pertes de ${playerName(other)}`));
        const men = el("div", "cr-loss-row");
        men.append(el("span", "cr-loss-n", num(l.men)), el("span", undefined, "hommes"));
        box.append(men);
        l.equipment.forEach((n, k) => {
          if (n === 0) return;
          const id = this.armamentIds[k]!;
          const row = el("div", "cr-loss-row");
          row.append(el("span", "cr-loss-n", num(n)), productIcon(id), el("span", undefined, equipmentName(id)));
          box.append(row);
        });
        return box;
      };
      const summary = el(
        "div",
        "cr-summary",
        c.captured !== 0 ? `Ville n° ${c.captured} prise.` : advance > 0 ? `Le front avance de ${Math.round(advance / 10)} %.` : "Le front ne bouge pas.",
      );
      const lossCols = el("div", "cr-losses");
      lossCols.append(losses(0), losses(1));
      result.replaceChildren(summary, lossCols);
      skip.disabled = true;
    };
    skip.addEventListener("click", finish);

    field.classList.add("apart");
    this.timers.push(window.setTimeout(() => field.classList.remove("apart"), 30));
    c.rounds.forEach((_, r) => this.timers.push(window.setTimeout(showRound, APPROACH_MS + r * ROUND_MS)));
    this.timers.push(window.setTimeout(finish, APPROACH_MS + c.rounds.length * ROUND_MS));
  }
}

/** Ce que les icônes lisent de la carte : la case de chaque ville et la position à l'écran d'une case. */
export interface CombatIconHost {
  cityTile(city: number): number | undefined;
  /** Coordonnées CSS (dans `#stage`) du centre d'une case, ou `null` si la vue n'est pas prête. */
  tileToCss(x: number, y: number): { x: number; y: number } | null;
  readonly width: number;
}

export class CombatIcons {
  private readonly layer: HTMLElement;
  private readonly host: CombatIconHost;
  private readonly onOpen: (c: CombatView) => void;
  private readonly icons = new Map<number, { readonly combat: CombatView; readonly el: HTMLElement }>();
  /** Combats déjà vus : une icône retirée ne revient pas quand la liste est renvoyée. */
  private readonly seen = new Set<number>();

  constructor(root: HTMLElement, host: CombatIconHost, onOpen: (c: CombatView) => void) {
    this.layer = el("div", "cr-icons");
    root.append(this.layer);
    this.host = host;
    this.onOpen = onOpen;
  }

  clear(): void {
    this.icons.clear();
    this.seen.clear();
    this.layer.replaceChildren();
  }

  /** Nouvelle liste des combats du joueur local : une icône pour chaque combat récent pas encore vu. */
  setCombats(combats: readonly CombatView[], tick: number): void {
    for (const c of combats) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      if (tick - c.tick > ICON_TURNS) continue;
      const b = el("button", "cr-mapicon", "⚔");
      b.type = "button";
      b.title = "Voir le combat";
      b.addEventListener("click", () => {
        this.remove(c.id);
        this.onOpen(c);
      });
      this.layer.append(b);
      this.icons.set(c.id, { combat: c, el: b });
    }
    this.place();
  }

  private remove(id: number): void {
    this.icons.get(id)?.el.remove();
    this.icons.delete(id);
  }

  /** Retire les icônes trop anciennes ; à appeler à chaque tour. */
  expire(tick: number): void {
    for (const [id, i] of [...this.icons]) if (tick - i.combat.tick > ICON_TURNS) this.remove(id);
  }

  /** Replace les icônes ; à appeler après chaque dessin de la carte (déplacement, zoom). */
  place(): void {
    const w = this.host.width;
    for (const { combat, el: b } of this.icons.values()) {
      const t1 = this.host.cityTile(combat.city1);
      const t2 = this.host.cityTile(combat.city2);
      if (t1 === undefined || t2 === undefined) continue;
      const p = this.host.tileToCss(((t1 % w) + (t2 % w)) / 2, (Math.floor(t1 / w) + Math.floor(t2 / w)) / 2);
      if (p === null) continue;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
    }
  }
}
