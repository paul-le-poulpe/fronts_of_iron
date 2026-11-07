// Combats résolus en un tour par le moteur (Docs/Design/06-Combat-Simplifie.md §2) :
// - `CombatIcons` : une icône par combat du joueur local pas encore visionné, posée sur la
//   carte au milieu de la connexion du combat, bleue si le joueur local a gagné, rouge
//   sinon (`localWon`), qui clignote ; retirée dès que le replay est ouvert (`onCombatViewed`) ;
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

import { compactInt } from "./format.ts";
import type { Stats } from "./frontstats.ts";
import { unitIconUrl } from "./uniticons.ts";
import { playerName, unitName } from "./names.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";
import { STAT_TITLE, drawTotals, statIcon, statTotals } from "./stattotals.ts";

const percentFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

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
export function combatSummary(c: CombatView): string {
  const seconds = Math.floor(c.tick / 10);
  const advance = c.rounds.reduce((s, r) => s + r.advance, 0);
  const result = c.captured !== 0 ? `ville n° ${c.captured} prise` : advance > 0 ? `avancée ${Math.round(advance / 10)} %` : "pas d'avancée";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} — ${COMBAT_KIND[c.kind]} — ${result}`;
}

/** Nom de chaque type de combat (06-Combat-Simplifie §2), affiché en tête du replay et dans l'historique. */
export const COMBAT_KIND: Readonly<Record<CombatView["kind"], string>> = {
  front: "Attaque sur tout le front",
  breakthrough: "Percée : première ligne",
  counter: "Percée : contre-attaque du défenseur",
};

/**
 * Vainqueur d'un combat (06-Combat-Simplifie §2) : le camp qui a perdu le moins d'infanterie, en état de division
 * (somme des pertes des divisions de la niche d'infanterie). Égalité : le défenseur (provisoire).
 */
export function localWon(c: CombatView, military: MilitaryCatalog, me: number): boolean {
  const lost = new Map<number, number>();
  for (const r of c.rounds) {
    for (const [i, loss] of r.hits) {
      const u = c.units[i]!;
      if (military.divisions[u.type]?.niche !== "infantry") continue;
      lost.set(u.owner, (lost.get(u.owner) ?? 0) + loss);
    }
  }
  const other = me === c.attacker ? c.defender : c.attacker;
  const mine = lost.get(me) ?? 0;
  const theirs = lost.get(other) ?? 0;
  return mine === theirs ? me === c.defender : mine < theirs;
}

/** Combats visionnés pendant cette partie (replay ouvert, depuis la carte ou la fenêtre d'un front). */
const viewed = new Set<number>();
const viewedListeners: ((id: number) => void)[] = [];
export const isViewed = (id: number): boolean => viewed.has(id);
/** `fn` est appelée à chaque combat visionné pour la première fois. */
export function onCombatViewed(fn: (id: number) => void): void {
  viewedListeners.push(fn);
}
/** Nouvelle partie : plus aucun combat visionné ni retiré, plus aucun abonné. */
export function resetViewed(): void {
  viewed.clear();
  dismissed.clear();
  viewedListeners.length = 0;
}

/** Combats retirés de l'historique par leur croix (fenêtre d'un front) : retirés aussi de la carte, comme visionnés. */
const dismissed = new Set<number>();
export const isDismissed = (id: number): boolean => dismissed.has(id);
export function dismissCombat(id: number): void {
  dismissed.add(id);
  if (viewed.has(id)) for (const fn of viewedListeners) fn(id);
  else markViewed(id);
}
function markViewed(id: number): void {
  if (viewed.has(id)) return;
  viewed.add(id);
  for (const fn of viewedListeners) fn(id);
}

const noStats = (): Stats => ({ soft: 0, hard: 0, hp: 0 });

/**
 * Les trois cartes possibles d'un type de division d'un camp : en ligne ; renforts en retrait, pas encore en ligne
 * (attaque sur tout le front) ; en fuite. Leur rang dans la colonne, après le type.
 */
type Variant = "main" | "arriving" | "fled";
const VARIANT_RANK: Readonly<Record<Variant, number>> = { main: 0, arriving: 1, fled: 2 };

/** Une carte du replay : les divisions d'un type d'un camp qui sont dans cet état (`cardOf`). */
interface Card {
  /** Toutes les divisions du type et du camp, vues jusqu'ici ; tableau partagé par les trois cartes du type. */
  readonly units: number[];
  readonly variant: Variant;
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
  private readonly me: () => number;
  private readonly panel: HTMLElement;
  private timers: number[] = [];

  constructor(root: HTMLElement, military: MilitaryCatalog, me: () => number) {
    this.root = root;
    this.military = military;
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
    markViewed(c.id);
    const m = this.military;
    const me = this.me();
    const scale = m.stateScale;
    const other = me === c.attacker ? c.defender : c.attacker;
    // Le joueur local à gauche (camp 0), l'adversaire à droite (camp 1).
    const sideOf = (owner: number): 0 | 1 => (owner === me ? 0 : 1);
    const attackerSide = sideOf(c.attacker);

    const head = el("div", "cr-head");
    // Type du combat, puis qui attaque (06-Combat-Simplifie §2).
    head.append(
      el("strong", "cr-kind", COMBAT_KIND[c.kind]),
      el("span", undefined, c.attacker === me ? `— vous attaquez ${playerName(c.defender)}` : `— ${playerName(c.attacker)} vous attaque`),
    );
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
    // Au milieu, une flèche de l'attaquant vers le défenseur : vers la droite quand le joueur local attaque.
    const arrow = el("div", attackerSide === 0 ? "cr-arrow" : "cr-arrow back", "➜");
    arrow.title = attackerSide === 0 ? "Vous attaquez" : `${playerName(c.attacker)} attaque`;
    field.append(cols[0], arrow, cols[1]);
    const result = el("div", "cr-result");

    // État de chaque division au fil du replay.
    const hp = c.units.map((u) => u.start);
    const fled = c.units.map(() => false);
    const dead = c.units.map(() => false);
    const arriving = c.units.map(() => false);

    const makeCard = (units: number[], variant: Variant): Card => {
      const u = c.units[units[0]!]!;
      const info = m.divisions[u.type];
      const root = el("div", variant === "main" ? "cr-unit" : `cr-unit ${variant}`);
      root.dataset.rank = String(u.type * 3 + VARIANT_RANK[variant]);
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
      return { units, variant, root, stack, icon: info === undefined ? "" : unitIconUrl(info.icon, u.owner), name: info === undefined ? "" : unitName(info.id), fill, dmg, soft, hard };
    };

    // Cartes : une par type, par camp et par état (en ligne, renforts en retrait, en fuite), créées à la première
    // division qui y entre, rangées par type puis par état ; elles ne changent plus d'ordre.
    const cards: Card[] = [];
    const cardOf: (Card | undefined)[] = [];
    const typeUnits = new Map<string, number[]>();
    const byKey = new Map<string, Card>();
    /** Met la division `i` dans la carte de son type dans l'état `variant`. */
    const put = (i: number, variant: Variant): void => {
      const u = c.units[i]!;
      const side = sideOf(u.owner);
      const typeKey = `${side}:${u.type}`;
      let units = typeUnits.get(typeKey);
      if (units === undefined) {
        units = [];
        typeUnits.set(typeKey, units);
      }
      if (!units.includes(i)) units.push(i);
      const key = `${typeKey}:${variant}`;
      let card = byKey.get(key);
      if (card === undefined) {
        card = makeCard(units, variant);
        byKey.set(key, card);
        cards.push(card);
        const rank = Number(card.root.dataset.rank);
        const before = [...cols[side].children].find((e) => Number((e as HTMLElement).dataset.rank) > rank);
        if (before !== undefined) cols[side].insertBefore(card.root, before);
        else cols[side].append(card.root);
      }
      cardOf[i] = card;
    };
    // Au départ, toutes les divisions sauf les renforts qui arriveront pendant le combat.
    const late = new Set(c.rounds.flatMap((r) => r.arrived));
    c.units.forEach((_, i) => {
      if (!late.has(i)) put(i, "main");
    });
    /** Une division qui fuit passe dans la carte des fuyards de son type, juste après celle du type. */
    const flee = (i: number): void => {
      fled[i] = true;
      put(i, "fled");
    };

    /** Attaques d'une division d'après son état, × `attackMultiplier` pour l'attaquant (05-Fronts §6.1) ; PV des niches principales. */
    const statsOf = (i: number): Stats => {
      const u = c.units[i]!;
      const type = m.divisions[u.type]!;
      const k = hp[i]! / scale;
      const mult = sideOf(u.owner) === attackerSide ? type.attackMultiplier / 100 : 1;
      return { soft: type.softAttack * k * mult, hard: type.hardAttack * k * mult, hp: type.support ? 0 : type.hitPoints * k };
    };

    /** Message d'un repli faute d'infanterie (06-Combat-Simplifie §1). */
    const withdrawnText = (owners: readonly number[]): string => {
      const who = owners.map((p) => (p === me ? "vos troupes se sont repliées" : `les troupes de ${playerName(p)} se sont repliées`));
      return `${who.join(" ; ")} : plus d'infanterie`;
    };

    /**
     * Message d'un round sans division touchée (06-Combat-Simplifie §1) : sans avancée, l'attaquant attend ses renforts
     * d'infanterie ; avec, le défenseur n'a plus d'infanterie et l'attaquant avance. `total` : avancée depuis le début, en %.
     */
    const quietRoundText = (advance: number, total: number): string => {
      const attacking = c.attacker === me;
      if (advance === 0) {
        return attacking ? "Plus d'infanterie en ligne : en attente des renforts d'infanterie" : `${playerName(c.attacker)} n'a plus d'infanterie en ligne : en attente de ses renforts`;
      }
      const moved = `${percentFormat.format(total)} %`;
      return attacking ? `Plus d'infanterie en face : avancée ${moved}` : `Plus d'infanterie en ligne : ${playerName(c.attacker)} avance de ${moved}`;
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
          // Les totaux du haut ne comptent que les divisions en ligne : ni en fuite, ni renforts en retrait.
          if (!fled[i] && !arriving[i]) for (const kind of ["soft", "hard", "hp"] as const) totals[sideOf(c.units[i]!.owner)][kind] += s[kind];
        }
        const n = here.length;
        card.root.classList.toggle("dead", n === 0);
        // Une carte sans aucune division (toutes passées dans une autre carte du type) disparaît ; celle dont les
        // divisions sont toutes détruites reste, effacée.
        card.root.hidden = n === 0 && !card.units.some((i) => cardOf[i] === card);
        // Une icône par division, empilées, au plus `MAX_STACK` ; la carte vidée garde une icône, effacée.
        const shown = Math.max(1, Math.min(n, MAX_STACK));
        if (card.stack.childElementCount !== shown + 2) {
          const icons = Array.from({ length: shown }, (_, k) => {
            const img = el("img", "cr-icon");
            img.src = card.icon;
            img.alt = "";
            img.style.left = `${k * STACK_STEP_PX}px`;
            return img;
          });
          // Drapeau blanc (en fuite) ou plus bleu (renfort), selon la carte (CSS).
          const flag = el("img", "cr-flag");
          flag.src = "icons/miscellaneous/icon-white-flag.png";
          flag.alt = "";
          const plus = el("span", "cr-plus", "+");
          plus.title = "Renfort : rejoint la première ligne dans quelques rounds";
          card.stack.replaceChildren(...icons, flag, plus);
          card.stack.style.width = `${32 + (shown - 1) * STACK_STEP_PX}px`;
        }
        card.root.title = n > 1 ? `${card.name} : ${n} divisions` : card.name;
        card.fill.style.width = n === 0 ? "0" : `${(100 * state) / (n * scale)}%`;
        card.soft.textContent = compactInt(st.soft);
        card.hard.textContent = compactInt(st.hard);
        const loss = lossByCard.get(card) ?? 0;
        card.dmg.textContent = loss > 0 ? `−${Math.max(1, Math.round((100 * loss) / (Math.max(1, n) * scale)))} %` : "";
        if (loss > 0) {
          card.root.classList.remove("hit");
          void card.root.offsetWidth;
          card.root.classList.add("hit");
        }
      }
      drawTotals(tots[0], totals[0], totals[1], compactInt);
      drawTotals(tots[1], totals[1], totals[0], compactInt);
    };

    this.panel.replaceChildren(head, top, round, field, result);
    this.panel.hidden = false;
    redraw(new Map());

    let next = 0;
    const showRound = (): void => {
      const r = next++;
      const rd = c.rounds[r]!;
      const total = c.rounds.slice(0, r + 1).reduce((s, x) => s + x.advance, 0) / 10;
      const label = `Round ${r + 1} / ${c.rounds.length}`;
      round.textContent = rd.hits.length === 0 ? `${label} — ${quietRoundText(rd.advance, total)}` : label;
      if (rd.withdrawn.length > 0) round.textContent += ` — ${withdrawnText(rd.withdrawn)}`;
      // Renforts qui rejoignent la première ligne au début du round.
      for (const i of rd.joined) {
        arriving[i] = false;
        put(i, "main");
      }
      // La perte est rangée dans la carte où la division était pendant le round.
      const lossByCard = new Map<Card, number>();
      for (const [i, loss] of rd.hits) {
        const card = cardOf[i]!;
        lossByCard.set(card, (lossByCard.get(card) ?? 0) + loss);
        hp[i] = Math.max(0, hp[i]! - loss);
      }
      for (const i of rd.destroyed) dead[i] = true;
      for (const i of rd.fled) {
        if (fled[i]) continue;
        arriving[i] = false;
        flee(i);
      }
      // Renforts montés de la seconde ligne à la fin du round : carte du type en retrait, avec le plus bleu.
      for (const i of rd.arrived) {
        arriving[i] = true;
        put(i, "arriving");
      }
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
        // Pertes en divisions détruites et en état (08 §11), sans décimale : l'état perdu est la somme des barres de vie, en pourcent d'une division.
        const destroyed = el("div", "cr-loss-row");
        destroyed.append(el("span", "cr-loss-n", compactInt(l.divisions, 10_000)), el("span", undefined, l.divisions > 1 ? "divisions détruites" : "division détruite"));
        const state = el("div", "cr-loss-row");
        state.append(el("span", "cr-loss-n", compactInt(Math.round((l.state * 100) / this.military.stateScale), 10_000)), el("span", undefined, "% d'état perdu"));
        state.title = "Somme des barres de vie perdues par les divisions de ce camp : 100 % valent une division entière.";
        box.append(destroyed, state);
        return box;
      };
      const pct = Math.round(advance / 10);
      const issue =
        c.kind === "breakthrough"
          ? c.success
            ? `Première ligne percée : le front saute de ${pct} % sur l'axe.`
            : "Percée arrêtée par la première ligne."
          : c.kind === "counter"
            ? c.success
              ? "Contre-attaque repoussée : la ville au bout de l'axe tombe après le délai."
              : "Percée arrêtée par la contre-attaque."
            : c.captured !== 0
              ? `Ville n° ${c.captured} prise.`
              : advance > 0
                ? `Le front avance de ${pct} %.`
                : "Le front ne bouge pas.";
      const retreats = [...new Set(c.rounds.flatMap((r) => r.withdrawn))];
      const summary = el("div", "cr-summary", retreats.length > 0 ? `${issue} ${withdrawnText(retreats)[0]!.toUpperCase()}${withdrawnText(retreats).slice(1)}.` : issue);
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
  private readonly military: MilitaryCatalog;
  private readonly me: () => number;
  private readonly onOpen: (c: CombatView) => void;
  private readonly icons = new Map<number, { readonly combat: CombatView; readonly el: HTMLElement }>();

  constructor(root: HTMLElement, host: CombatIconHost, military: MilitaryCatalog, me: () => number, onOpen: (c: CombatView) => void) {
    this.layer = el("div", "cr-icons");
    root.append(this.layer);
    this.host = host;
    this.military = military;
    this.me = me;
    this.onOpen = onOpen;
  }

  clear(): void {
    this.icons.clear();
    this.layer.replaceChildren();
  }

  /**
   * Nouvelle liste des combats du joueur local : une icône pour chaque combat pas encore visionné, bleue si le joueur
   * local a gagné, rouge sinon (`localWon`) ; celles des combats sortis de la liste sont retirées.
   */
  setCombats(combats: readonly CombatView[]): void {
    const ids = new Set(combats.map((c) => c.id));
    for (const id of [...this.icons.keys()]) if (!ids.has(id)) this.remove(id);
    for (const c of combats) {
      if (this.icons.has(c.id) || isViewed(c.id)) continue;
      const b = el("button", `cr-mapicon ${localWon(c, this.military, this.me()) ? "win" : "lose"}`, "⚔");
      b.type = "button";
      b.title = "Voir le combat";
      b.addEventListener("click", () => this.onOpen(c));
      // Empilées au même endroit, la plus ancienne reste dessus : le dernier enfant est dessiné par-dessus les autres.
      this.layer.prepend(b);
      this.icons.set(c.id, { combat: c, el: b });
    }
    this.place();
  }

  /** Retire l'icône d'un combat (visionné). */
  remove(id: number): void {
    this.icons.get(id)?.el.remove();
    this.icons.delete(id);
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
