// Sélection et glisser-déposer des pions (05-Fronts §11.4), commun à la fenêtre d'un front et à l'onglet des
// forces. Le dessin des pions et des rectangles de sélection est celui de `pawn.ts` (`renderZone`) ; ici : quelles
// divisions sont sélectionnées (survol, clic, deux clics en mode avancé), le glisser avec le pion fantôme, la dépose
// sur un élément `data-drop`, et le panneau de survol d'un pion. La page n'applique aucune règle : la dépose appelle
// `DndHost.drop`, qui envoie des ordres au moteur.
//
// Vocabulaire : une **rangée** est un conteneur passé à `renderZone` (une niche d'une ligne, ou toute la réserve) ;
// une **zone** (`ZoneView`) est un ensemble de rangées dont la sélection ne sort jamais (une ligne d'un front, la
// réserve nationale). Le pion sous la souris est lu dans le DOM (`.pz-pawn[data-id]`) : le navigateur connaît déjà
// l'ordre d'empilement des piles.

import { movable } from "./divisions.ts";
import { hidePanel, pawnPanel, showPawnPanel } from "./infopanels.ts";
import { FIRST_PAWN_CENTER, pawnOrder, renderZone, type ZoneLayout } from "./pawn.ts";
import { type DivisionView, type MilitaryCatalog } from "./protocol.ts";

/** Ce que `Dnd` demande à la fenêtre ou à l'onglet qui le porte. */
export interface DndHost {
  readonly military: MilitaryCatalog;
  /** L'interrupteur « Sélection avancée » est-il allumé ? */
  advanced(): boolean;
  /** Une division, par identifiant (sa dernière version reçue), ou `undefined` si elle n'existe plus. */
  division(id: number): DivisionView | undefined;
  /** Dépose sur l'élément `data-drop` `target` : envoie les ordres. */
  drop(target: string, ids: readonly number[]): void;
  /** Un glisser commence ou se termine (zone de retour, corbeille). */
  dragging(on: boolean): void;
}

interface RowState {
  readonly el: HTMLElement;
  divisions: readonly DivisionView[];
  layout: ZoneLayout | null;
}

export interface RowInput {
  readonly el: HTMLElement;
  readonly divisions: readonly DivisionView[];
}

/** Le pion sous un événement : son identifiant et son élément, ou `null`. */
function pawnAt(e: Event): { readonly id: number; readonly el: HTMLElement } | null {
  const el = (e.target as Element).closest<HTMLElement>(".pz-pawn");
  if (el === null) return null;
  const id = Number(el.dataset.id);
  return Number.isInteger(id) ? { id, el } : null;
}

/** Ensemble de rangées de la même zone de sélection. */
export class ZoneView {
  readonly key: string;
  private readonly dnd: Dnd;
  private readonly interactive: boolean;
  private rows: RowState[] = [];
  private readonly wired = new WeakSet<HTMLElement>();

  private readonly wrap: boolean;

  constructor(key: string, dnd: Dnd, interactive: boolean, wrap: boolean) {
    this.key = key;
    this.dnd = dnd;
    this.interactive = interactive;
    this.wrap = wrap;
  }

  /** Remplace les rangées (les mêmes éléments gardent leurs écouteurs) et les dessine. */
  set(rows: readonly RowInput[]): void {
    this.rows = rows.map((r) => ({ el: r.el, divisions: r.divisions, layout: null }));
    if (this.interactive) for (const r of this.rows) this.wire(r.el);
    this.render();
  }

  /** Dessine chaque rangée avec la sélection et l'aperçu courants. */
  render(): void {
    const { selected, preview } = this.dnd.sets();
    for (const row of this.rows) {
      if (row.divisions.length === 0) {
        row.el.replaceChildren();
        row.layout = null;
        continue;
      }
      const width = row.el.clientWidth;
      if (width === 0) continue;
      row.layout = renderZone(row.el, row.divisions, this.dnd.military, { width, selected, preview, wrap: this.wrap });
    }
  }

  /** Les identifiants de la zone, rangée après rangée, pions de gauche à droite dans l'ordre de la pile. */
  flat(): number[] {
    return this.rows.flatMap((r) => (r.layout === null ? [] : r.layout.groups.flat()));
  }

  /** Le groupe (type) de la division, dans l'ordre de la pile. */
  groupOf(id: number): readonly number[] | null {
    for (const r of this.rows) for (const g of r.layout?.groups ?? []) if (g.includes(id)) return g;
    return null;
  }

  /** L'élément du pion `id` actuellement dans le DOM (la rangée est redessinée à chaque changement de sélection). */
  pawnEl(id: number): HTMLElement | null {
    for (const r of this.rows) {
      const all = r.el.querySelectorAll<HTMLElement>(`.pz-pawn[data-id="${id}"]`);
      if (all.length > 0) return all[all.length - 1]!;
    }
    return null;
  }

  private wire(el: HTMLElement): void {
    if (this.wired.has(el)) return;
    this.wired.add(el);
    el.addEventListener("pointermove", (e) => this.dnd.onMove(this, pawnAt(e)));
    el.addEventListener("pointerleave", () => this.dnd.onLeave(this));
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.dnd.onDown(this, pawnAt(e), e);
    });
  }
}

const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

export class Dnd {
  readonly military: MilitaryCatalog;
  private readonly host: DndHost;
  private readonly zones = new Map<string, ZoneView>();
  private selected: ReadonlySet<number> = new Set();
  private preview: ReadonlySet<number> = new Set();
  /** Mode avancé : la première division cliquée, en attente du second clic. */
  private anchor: { readonly zone: ZoneView; readonly id: number } | null = null;
  private hoverTimer = 0;
  private hovered: { readonly zone: ZoneView; readonly id: number; readonly el: HTMLElement } | null = null;
  private drag: { ids: number[]; ghost: HTMLElement; over: Element | null; moved: boolean; x: number; y: number } | null = null;

  constructor(host: DndHost) {
    this.host = host;
    this.military = host.military;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.cancel();
    });
  }

  sets(): { readonly selected: ReadonlySet<number>; readonly preview: ReadonlySet<number> } {
    return { selected: this.selected, preview: this.preview };
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /**
   * Zone de sélection de clé `key` (créée au premier appel). `interactive` : les pions y réagissent (les siens).
   * `wrap` : sans place sur une ligne, les piles passent sur plusieurs lignes (voir `ZoneOptions.wrap`).
   */
  zone(key: string, interactive = true, wrap = false): ZoneView {
    let z = this.zones.get(key);
    if (z === undefined) {
      z = new ZoneView(key, this, interactive, wrap);
      this.zones.set(key, z);
    }
    return z;
  }

  private renderAll(): void {
    for (const z of this.zones.values()) z.render();
  }

  /** Après un message du moteur : oublie les divisions disparues ou qui ne sont plus déplaçables. */
  prune(): void {
    const keep = (id: number): boolean => {
      const d = this.host.division(id);
      return d !== undefined && movable(d);
    };
    this.selected = new Set([...this.selected].filter(keep));
    this.preview = new Set([...this.preview].filter(keep));
    if (this.anchor !== null && !keep(this.anchor.id)) this.anchor = null;
  }

  /** Abandonne la sélection, le premier clic et le glisser en cours. */
  cancel(): void {
    this.endDrag();
    const had = this.selected.size > 0 || this.preview.size > 0 || this.anchor !== null;
    this.selected = new Set();
    this.preview = new Set();
    this.anchor = null;
    window.clearTimeout(this.hoverTimer);
    hidePanel();
    if (had) this.renderAll();
  }

  /** L'interrupteur « Sélection avancée » a changé : on repart d'une sélection vide. */
  modeChanged(): void {
    this.cancel();
  }

  // ---- sélection ----

  /** Mode simple : les divisions déplaçables du même type, du début du groupe jusqu'à `id` (05-Fronts §11.4). */
  private simpleRange(zone: ZoneView, id: number): Set<number> {
    const group = zone.groupOf(id);
    const out = new Set<number>();
    if (group === null) return out;
    const d = this.host.division(id);
    if (d === undefined || !movable(d)) return out;
    for (const x of group.slice(0, group.indexOf(id) + 1)) {
      const dx = this.host.division(x);
      if (dx !== undefined && movable(dx)) out.add(x);
    }
    return out;
  }

  /** Mode avancé : toutes les divisions déplaçables entre deux divisions de la zone, rangée après rangée. */
  private range(zone: ZoneView, a: number, b: number): Set<number> {
    const flat = zone.flat();
    const i = flat.indexOf(a);
    const j = flat.indexOf(b);
    const out = new Set<number>();
    if (i < 0 || j < 0) return out;
    for (const id of flat.slice(Math.min(i, j), Math.max(i, j) + 1)) {
      const d = this.host.division(id);
      if (d !== undefined && movable(d)) out.add(id);
    }
    return out;
  }

  onMove(zone: ZoneView, pawn: { readonly id: number; readonly el: HTMLElement } | null): void {
    if (this.drag !== null) return;
    const id = pawn?.id ?? null;
    if ((this.hovered?.id ?? null) !== id || this.hovered?.zone !== zone) {
      this.hovered = pawn === null ? null : { zone, id: pawn.id, el: pawn.el };
      this.showPanelSoon();
    }
    let preview = this.preview;
    if (!this.host.advanced()) {
      preview = id === null ? new Set() : this.simpleRange(zone, id);
    } else if (this.anchor !== null && this.anchor.zone === zone && id !== null) {
      preview = this.range(zone, this.anchor.id, id);
    }
    if (!sameSet(preview, this.preview)) {
      this.preview = preview;
      this.renderAll();
    }
  }

  onLeave(zone: ZoneView): void {
    if (this.drag !== null) return;
    if (this.hovered?.zone === zone) {
      this.hovered = null;
      this.showPanelSoon();
    }
    if (!this.host.advanced() && this.preview.size > 0) {
      this.preview = new Set();
      this.renderAll();
    }
  }

  onDown(zone: ZoneView, pawn: { readonly id: number; readonly el: HTMLElement } | null, e: PointerEvent): void {
    if (this.drag !== null) return;
    e.preventDefault();
    window.clearTimeout(this.hoverTimer);
    hidePanel();
    if (pawn === null) {
      if (this.host.advanced()) this.cancel();
      return;
    }
    const id = pawn.id;
    const d = this.host.division(id);
    if (d === undefined || !movable(d)) return;
    if (!this.host.advanced()) {
      const ids = this.simpleRange(zone, id);
      if (ids.size === 0) return;
      this.selected = ids;
      this.preview = new Set();
      this.startDrag(e);
      return;
    }
    if (this.anchor === null && this.selected.has(id)) {
      this.startDrag(e);
      return;
    }
    if (this.anchor !== null && this.anchor.zone === zone) {
      this.selected = this.range(zone, this.anchor.id, id);
      this.preview = new Set();
      this.anchor = null;
    } else {
      // Premier clic (ou premier clic dans une autre zone) : la division est marquée, rectangle sur elle seule.
      this.anchor = { zone, id };
      this.selected = new Set([id]);
      this.preview = new Set([id]);
    }
    this.renderAll();
  }

  // ---- panneau de survol d'un pion (05-Fronts §11.7) ----

  private showPanelSoon(): void {
    window.clearTimeout(this.hoverTimer);
    hidePanel();
    if (this.hovered === null || this.drag !== null) return;
    // Pas de panneau après le premier clic de la sélection avancée, ni pendant un glisser.
    if (this.host.advanced() && this.anchor !== null) return;
    const { id, zone } = this.hovered;
    this.hoverTimer = window.setTimeout(() => {
      if (this.hovered?.id !== id || this.drag !== null || (this.host.advanced() && this.anchor !== null)) return;
      const d = this.host.division(id);
      const el = zone.pawnEl(id);
      if (d !== undefined && el !== null) showPawnPanel(pawnPanel(this.military, d), el.getBoundingClientRect());
    }, 120);
  }

  // ---- glisser ----

  private startDrag(e: PointerEvent): void {
    const ids = [...this.selected].filter((id) => {
      const d = this.host.division(id);
      return d !== undefined && movable(d);
    });
    if (ids.length === 0) return;
    const ghost = document.createElement("div");
    ghost.className = "dnd-ghost";
    ghost.style.width = "360px";
    document.body.append(ghost);
    // Le fantôme remplace le curseur, comme les pions du panneau de production (`production.css`).
    document.body.classList.add("pw-moving");
    const divisions = pawnOrder(
      ids.map((id) => this.host.division(id)!),
      this.military,
    );
    renderZone(ghost, divisions, this.military, { width: 360, selected: new Set() });
    this.drag = { ids, ghost, over: null, moved: false, x: e.clientX, y: e.clientY };
    this.moveGhost(e.clientX, e.clientY);
    this.host.dragging(true);
    this.renderAll();
    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragCancel);
  }

  private moveGhost(x: number, y: number): void {
    if (this.drag === null) return;
    this.drag.ghost.style.left = `${x - FIRST_PAWN_CENTER.x}px`;
    this.drag.ghost.style.top = `${y - FIRST_PAWN_CENTER.y}px`;
  }

  private dropTarget(x: number, y: number): HTMLElement | null {
    for (const e of document.elementsFromPoint(x, y)) {
      const t = e.closest<HTMLElement>("[data-drop]");
      if (t !== null) return t;
    }
    return null;
  }

  private readonly onDragMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (drag === null) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    this.moveGhost(e.clientX, e.clientY);
    const over = this.dropTarget(e.clientX, e.clientY);
    if (over !== drag.over) {
      drag.over?.classList.remove("dnd-over");
      over?.classList.add("dnd-over");
      drag.over = over;
    }
  };

  private readonly onDragEnd = (e: PointerEvent): void => {
    const drag = this.drag;
    if (drag === null) return;
    const target = drag.moved ? this.dropTarget(e.clientX, e.clientY) : null;
    const ids = drag.ids;
    // Sans mouvement en mode avancé, un clic sur la sélection ne la défait pas.
    const keepSelection = !drag.moved && this.host.advanced();
    this.endDrag();
    if (target !== null) this.host.drop(target.dataset.drop!, ids);
    if (!keepSelection) {
      this.selected = new Set();
      this.preview = new Set();
      this.anchor = null;
    }
    this.renderAll();
  };

  private readonly onDragCancel = (): void => {
    this.cancel();
  };

  private endDrag(): void {
    const drag = this.drag;
    if (drag === null) return;
    drag.over?.classList.remove("dnd-over");
    drag.ghost.remove();
    document.body.classList.remove("pw-moving");
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragCancel);
    this.host.dragging(false);
  }
}
