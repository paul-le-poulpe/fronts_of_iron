// Combats résolus en un tour par le moteur (Docs/Design/06-Combat-Simplifie.md §2) :
// - `CombatIcons` : une icône par combat récent du joueur local, posée sur la carte au
//   milieu de la connexion du combat, retirée après `ICON_TURNS` tours ou au clic ;
// - `CombatReplay` : le panneau qui rejoue un rapport (`CombatView`) round par round.
//   En haut, les totaux des deux camps, les mêmes que dans la fenêtre d'un front
//   (`stattotals.ts`). Dessous, deux colonnes face à face : une carte par type de division
//   et par camp, une icône par division, empilées, avec la barre de vie (état moyen) et les
//   attaques. À chaque round, les barres baissent de la perte, la perte s'affiche, une
//   division détruite quitte la pile, une division en fuite passe dans une carte des
//   fuyards de son type, un peu en retrait et en gris. À la fin : les pertes en hommes et
//   en matériel.
// Le rapport vient du moteur : rien ici ne recalcule un combat. Les statistiques sont
// estimées sur l'état des divisions (le rapport ne garde pas les exemplaires).

import { num } from "./format.ts";
import { formatStat, type Stats } from "./frontstats.ts";
import { icon32Path, productIcon } from "./icons.ts";
import { equipmentName, playerName, unitName } from "./names.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";
import { STAT_TITLE, drawTotals, statIcon, statTotals } from "./stattotals.ts";

/** Durée de vie d'une icône de combat sur la carte, en tours (300 = 30 s ; provisoire, 06-Combat-Simplifie §2). */
const ICON_TURNS = 300;
/** Durée d'un round dans le replay, en ms (provisoire, 06-Combat-Simplifie §2) : 50 rounds en 22,5 s au plus. */
const ROUND_MS = 450;
/** Durée de l'approche des deux colonnes avant le premier round, en ms. */
const APPROACH_MS = 700;
/** Icônes empilées au plus sur une carte, et décalage de chacune sur la précédente, en px (provisoire, 06-Combat-Simplifie §2). */
const MAX_STACK = 8;
const STACK_STEP_PX = 6;

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

const noStats = (): Stats => ({ soft: 0, hard: 0, hp: 0 });

/** Une carte du replay : les divisions d'un type d'un camp (`units`), en ligne, ou celles d'entre elles qui ont fui. */
interface Card {
  readonly units: readonly number[];
  readonly fled: boolean;
  readonly root: HTMLElement;
  /** Les icônes empilées, une par division présente. */
  readonly stack: HTMLElement;
  readonly icon: string;
  readonly name: string;
  readonly fill: HTMLElement;
  readonly dmg: HTMLElement;
  readonly soft: HTMLElement;
  readonly hard: HTMLElement;
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

    // Totaux des deux camps : les barres de la fenêtre d'un front.
    const tots = [statTotals("ours"), statTotals("theirs")] as const;
    const top = el("div", "cr-top");
    const sideHead = (side: 0 | 1): HTMLElement => {
      const box = el("div", side === 0 ? "cr-side ours" : "cr-side theirs");
      box.append(el("div", "cr-side-name", playerName(side === 0 ? me : other)), tots[side].root);
      return box;
    };
    top.append(sideHead(0), sideHead(1));

    const round = el("div", "cr-round", "");
    const field = el("div", "cr-field");
    const cols = [el("div", "cr-col cr-left"), el("div", "cr-col cr-right")] as const;
    field.append(cols[0], cols[1]);
    const result = el("div", "cr-result");

    // État de chaque division au fil du replay.
    const hp = c.units.map((u) => u.start);
    const fled = c.units.map(() => false);
    const dead = c.units.map(() => false);

    const makeCard = (units: readonly number[], isFled: boolean): Card => {
      const u = c.units[units[0]!]!;
      const info = m.divisions[u.type];
      const root = el("div", isFled ? "cr-unit fled" : "cr-unit");
      // Les icônes des divisions de la carte, empilées (remplies par `redraw`), et le drapeau blanc par-dessus.
      const stack = el("div", "cr-stack");
      const body = el("div", "cr-body");
      const bar = el("div", "cr-bar");
      const fill = el("div", "cr-fill");
      bar.append(fill);
      const stats = el("div", "cr-stats");
      const stat = (kind: "soft" | "hard"): HTMLElement => {
        const v = el("span", "cr-stat-v", "0");
        const one = el("span", `cr-stat ${kind}`);
        one.title = STAT_TITLE[kind];
        one.append(statIcon(kind), v);
        stats.append(one);
        return v;
      };
      const soft = stat("soft");
      const hard = stat("hard");
      body.append(bar, stats);
      const dmg = el("div", "cr-dmg");
      root.append(dmg, stack, body);
      return { units, fled: isFled, root, stack, icon: info === undefined ? "" : `icons/${icon32Path(info.icon)}`, name: info === undefined ? "" : unitName(info.id), fill, dmg, soft, hard };
    };

    // Cartes, dans l'ordre des divisions du rapport (type par type) ; elles ne changent plus d'ordre.
    const cards: Card[] = [];
    const cardOf: Card[] = [];
    /** Types groupés d'un camp : leur carte des divisions en fuite, créée à la première fuite, juste après la carte du type. */
    const fledCards = new Map<string, Card>();
    for (const side of [0, 1] as const) {
      const idx = c.units.map((_, i) => i).filter((i) => sideOf(c.units[i]!.owner) === side);
      const types = [...new Set(idx.map((i) => c.units[i]!.type))].sort((a, b) => a - b);
      for (const t of types) {
        // Une carte par type et par camp, les divisions empilées.
        const ofType = idx.filter((i) => c.units[i]!.type === t);
        const card = makeCard(ofType, false);
        cards.push(card);
        for (const i of ofType) cardOf[i] = card;
        cols[side].append(card.root);
      }
    }
    /** Une division qui fuit passe dans la carte des fuyards de son type, posée juste après celle du type. */
    const flee = (i: number): void => {
      fled[i] = true;
      const card = cardOf[i]!;
      // Carte d'une seule division : elle recule sur place.
      if (card.units.length === 1) {
        card.root.classList.add("fled");
        return;
      }
      const key = `${sideOf(c.units[i]!.owner)}:${c.units[i]!.type}`;
      let f = fledCards.get(key);
      if (f === undefined) {
        f = makeCard(card.units, true);
        fledCards.set(key, f);
        cards.push(f);
        card.root.after(f.root);
      }
      cardOf[i] = f;
    };

    /** Attaques d'une division d'après son état, × `attackMultiplier` pour l'attaquant (05-Fronts §6.1) ; PV des niches principales. */
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
      return { soft: soft * k * mult, hard: hard * k * mult, hp: type.support ? 0 : type.hitPoints * k };
    };

    const redraw = (lossByCard: ReadonlyMap<Card, number>): void => {
      const totals = [noStats(), noStats()] as const;
      for (const card of cards) {
        // Divisions de la carte : celles qui y sont encore (une carte groupée perd ses fuyards au profit de sa carte de fuite).
        const here = card.units.filter((i) => cardOf[i] === card && !dead[i]);
        const st = noStats();
        let state = 0;
        for (const i of here) {
          const s = statsOf(i);
          for (const kind of ["soft", "hard", "hp"] as const) st[kind] += s[kind];
          state += hp[i]!;
          // Les totaux du haut ne comptent que les divisions en ligne.
          if (!fled[i]) for (const kind of ["soft", "hard", "hp"] as const) totals[sideOf(c.units[i]!.owner)][kind] += s[kind];
        }
        const n = here.length;
        card.root.classList.toggle("dead", n === 0);
        // Une icône par division, empilées, au plus `MAX_STACK` ; la carte vidée garde une icône, effacée.
        const shown = Math.max(1, Math.min(n, MAX_STACK));
        if (card.stack.childElementCount !== shown + 1) {
          const icons = Array.from({ length: shown }, (_, k) => {
            const img = el("img", "cr-icon");
            img.src = card.icon;
            img.alt = "";
            img.style.left = `${k * STACK_STEP_PX}px`;
            return img;
          });
          const flag = el("img", "cr-flag");
          flag.src = "icons/miscellaneous/icon-white-flag.png";
          flag.alt = "";
          card.stack.replaceChildren(...icons, flag);
          card.stack.style.width = `${32 + (shown - 1) * STACK_STEP_PX}px`;
        }
        card.root.title = n > 1 ? `${card.name} : ${n} divisions` : card.name;
        card.fill.style.width = n === 0 ? "0" : `${(100 * state) / (n * scale)}%`;
        card.soft.textContent = formatStat(Math.round(st.soft));
        card.hard.textContent = formatStat(Math.round(st.hard));
        const loss = lossByCard.get(card) ?? 0;
        card.dmg.textContent = loss > 0 ? `−${Math.max(1, Math.round((100 * loss) / (Math.max(1, n) * scale)))} %` : "";
        if (loss > 0) {
          card.root.classList.remove("hit");
          void card.root.offsetWidth;
          card.root.classList.add("hit");
        }
      }
      drawTotals(tots[0], totals[0], totals[1]);
      drawTotals(tots[1], totals[1], totals[0]);
    };

    this.panel.replaceChildren(head, top, round, field, result);
    this.panel.hidden = false;
    redraw(new Map());

    let next = 0;
    const showRound = (): void => {
      const r = next++;
      const rd = c.rounds[r]!;
      round.textContent = `Round ${r + 1} / ${c.rounds.length}`;
      // La perte est rangée dans la carte où la division était pendant le round.
      const lossByCard = new Map<Card, number>();
      for (const [i, loss] of rd.hits) {
        const card = cardOf[i]!;
        lossByCard.set(card, (lossByCard.get(card) ?? 0) + loss);
        hp[i] = Math.max(0, hp[i]! - loss);
      }
      for (const i of rd.destroyed) dead[i] = true;
      for (const i of rd.fled) if (!fled[i]) flee(i);
      redraw(lossByCard);
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
        box.append(el("div", "cr-loss-title", side === 0 ? "Vos pertes" : `Pertes de ${playerName(other)}`));
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
