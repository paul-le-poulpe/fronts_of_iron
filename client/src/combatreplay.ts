// Combats résolus en un tour par le moteur (Docs/Design/06-Combat-Simplifie.md §1, 10-Combat-Phases.md) :
// - `CombatIcons` : une icône par combat du joueur local pas encore visionné, posée sur la
//   carte au milieu de la connexion du combat, bleue si le joueur local a gagné, rouge
//   sinon (`localWon`), qui clignote ; retirée dès que le combat est ouvert (`onCombatViewed`) ;
// - `CombatReplay` : les deux fenêtres d'un combat, la fenêtre détaillée (`CombatWindow`), qui rejoue le rapport tir
//   par tir, et le résumé (`CombatSummary`), ouvert par « Passer » ; « Revoir le combat » rouvre la fenêtre détaillée.
// Le rapport vient du moteur : rien ici ne recalcule un combat.

import { localWon } from "./combatdata.ts";
import { CombatSummary } from "./combatsummary.ts";
import { CombatWindow } from "./combatwindow.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";

export { combatSummary, localWon } from "./combatdata.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
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

export class CombatReplay {
  private readonly detail: CombatWindow;
  private readonly summary: CombatSummary;

  constructor(root: HTMLElement, military: MilitaryCatalog, me: () => number) {
    this.detail = new CombatWindow(root, military, me);
    this.summary = new CombatSummary(root, military, me);
    this.detail.onSkip = (c) => this.summary.open(c);
    this.summary.onReplay = (c) => this.detail.open(c);
  }

  close(): void {
    this.detail.close();
    this.summary.close();
  }

  /** Ouvre la fenêtre détaillée d'un combat, qui le rejoue depuis le début ; le combat est visionné. */
  open(c: CombatView): void {
    this.close();
    markViewed(c.id);
    this.detail.open(c);
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
