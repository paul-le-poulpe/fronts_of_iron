// Onglet des forces (05-Fronts §11.2) : le détail de la cinquième section de la barre d'informations. Réserve
// nationale en deux sections, formation puis réserve (de vrais pions, un groupe par type), puis une section par front
// (fronts en guerre active, puis en paix, du plus long au plus court : statut diplomatique, et par niche une icône et
// le nombre de divisions). Les divisions ne se créent ni ne se suppriment par ordre : elles suivent les limites des
// usines et des casernes (08 §6) ; une division en formation montre l'horloge, une division en trop clignote.
//
// La page n'applique aucune règle : elle affiche ce que le moteur envoie (`DivisionView`, `PlayerStats`,
// `HumanDetail`) et envoie des ordres (`move_division`). La sélection est simple (un clic, §11.4) :
// l'interrupteur « Sélection avancée » est dans la fenêtre d'un front.

import "./forces.css";
import { countTag } from "./counttag.ts";
import { divisionsAt, opponentOf, sortedFronts, typeOf } from "./divisions.ts";
import { Dnd, type DndHost } from "./dnd.ts";
import { frontWidthIcon, hidePanel } from "./infopanels.ts";
import { localPlayer, playerName } from "./names.ts";
import { playerBorder, playerOnLand, rgbCss } from "./playercolors.ts";
import { type DivisionView, type FrontView, type HumanDetail, type HumanOrder, type MilitaryCatalog, type PlayerStats } from "./protocol.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** La fenêtre d'un front, cible des glissers partis de l'onglet : elle reçoit les déposes sur ses lignes et ses boîtes. */
export interface DropWindow {
  drop(target: string, ids: readonly number[]): void;
  /** Un glisser parti de l'onglet commence ou se termine : ses zones de dépose s'affichent. */
  externalDrag(on: boolean): void;
}

export class ForcesTab implements DndHost {
  readonly military: MilitaryCatalog;
  /** Contenu du détail (la barre d'informations le pose dans son volet). */
  readonly content: HTMLElement;
  private readonly send: (order: HumanOrder) => void;
  private readonly openFront: (id: number) => void;
  private readonly highlightOnMap: (id: number) => void;
  private readonly dnd: Dnd;
  private readonly formationZone: HTMLElement;
  private readonly reserveZone: HTMLElement;
  private readonly fronts: HTMLElement;
  private readonly frontWindow: DropWindow;
  private frontViews: readonly FrontView[] = [];
  private divisions: readonly DivisionView[] = [];
  private byId = new Map<number, DivisionView>();
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;
  private reserveKey = "";
  private frontsKey = "";
  /** Front mis en évidence (survolé sur la carte ou dans la liste), 0 : aucun. */
  private highlighted = 0;

  /**
   * `highlightOnMap` : met en évidence la zone d'un front sur la carte (0 : retire), au survol de sa section.
   * `frontWindow` : reçoit les déposes sur la fenêtre d'un front ouverte en même temps que l'onglet.
   */
  constructor(
    military: MilitaryCatalog,
    send: (order: HumanOrder) => void,
    openFront: (id: number) => void,
    highlightOnMap: (id: number) => void,
    frontWindow: DropWindow,
  ) {
    this.frontWindow = frontWindow;
    this.military = military;
    this.send = send;
    this.openFront = openFront;
    this.highlightOnMap = highlightOnMap;
    this.dnd = new Dnd(this);

    this.content = el("div", "fx themed");
    // Formation en haut, réserve en bas : deux sections séparées comme les fronts. Seule la réserve reçoit une dépose.
    const formation = this.resSection("FORMATION");
    this.formationZone = formation.zone;
    const reserve = this.resSection("RÉSERVE");
    this.reserveZone = reserve.zone;
    reserve.root.dataset.drop = "reserve";
    this.fronts = el("div", "fx-fronts");
    this.content.append(formation.root, reserve.root, this.fronts);
  }

  // ---- DndHost ----

  advanced(): boolean {
    return false;
  }

  division(id: number): DivisionView | undefined {
    return this.byId.get(id);
  }

  /** Vrai pendant un glisser commencé dans l'onglet : la barre d'informations ne le replie pas encore. */
  isDragging = false;

  dragging(on: boolean): void {
    this.isDragging = on;
    this.content.classList.toggle("dragging", on);
    this.frontWindow.externalDrag(on);
  }

  /**
   * Dépose sur la section d'un front (`front:id`) : seconde ligne (05-Fronts §4.1), ou sur une ligne ou une boîte de la
   * fenêtre d'un front ouverte (`line:…`, `box:…`), que la fenêtre traite.
   */
  drop(target: string, ids: readonly number[]): void {
    const [kind, id] = target.split(":");
    if (kind === "front") {
      const front = Number(id);
      const list = ids.filter((x) => {
        const d = this.byId.get(x);
        return d !== undefined && !(d.front === front && d.status !== "moving");
      });
      if (list.length > 0) this.send({ type: "move_division", ids: list, front });
    } else if (kind === "line" || kind === "box") {
      this.frontWindow.drop(target, ids);
    }
  }

  // ---- données ----

  /** Fronts et divisions du dernier message : à appeler avant `InfoBar.update`. */
  setData(fronts: readonly FrontView[], divisions: readonly DivisionView[]): void {
    this.frontViews = fronts;
    if (divisions !== this.divisions) {
      this.divisions = divisions;
      this.byId = new Map(divisions.map((d) => [d.id, d]));
      this.dnd.prune();
    }
  }

  /** Nombre de divisions du joueur (texte du bouton de la barre). */
  get divisionCount(): number {
    const me = localPlayer();
    return this.divisions.reduce((n, d) => n + (d.owner === me ? 1 : 0), 0);
  }

  /** Le détail est replié : la sélection est abandonnée. */
  collapsed(): void {
    this.dnd.cancel();
    hidePanel();
    this.highlightOnMap(0);
  }

  /** Mise à jour du détail ouvert (à chaque tour) : réserve, sections de front. */
  body(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    this.drawReserve();
    this.drawFronts();
  }

  // ---- formation et réserve ----

  /** Section de la réserve nationale : le libellé en gris derrière (premier enfant, donc sous la zone des pions), puis la zone. */
  private resSection(label: string): { readonly root: HTMLElement; readonly zone: HTMLElement } {
    const root = el("div", "fx-sec fx-res");
    const zone = el("div", "fx-zone");
    root.append(el("div", "fx-mlab", label), el("div", "fx-dip spacer"), zone);
    return { root, zone };
  }

  /** Les divisions de la réserve nationale : en formation d'un côté, tout le reste (prêtes, en route vers la réserve) de l'autre. */
  private drawReserve(): void {
    const me = localPlayer();
    const mine = divisionsAt(this.divisions, 0, me);
    const key = mine.map((d) => `${d.id}:${d.state}:${d.status}:${d.leaveTick}`).join(",") + `|${this.reserveZone.clientWidth}`;
    if (key === this.reserveKey) return;
    this.reserveKey = key;
    this.dnd.zone("form", true, true).set([{ el: this.formationZone, divisions: mine.filter((d) => d.status === "formation") }]);
    this.dnd.zone("res", true, true).set([{ el: this.reserveZone, divisions: mine.filter((d) => d.status !== "formation") }]);
  }

  // ---- fronts ----

  private drawFronts(): void {
    const me = localPlayer();
    const list = sortedFronts(this.frontViews, me);
    const nicheOf = (d: DivisionView): string => typeOf(this.military, d).niche;
    const key = list
      .map((f) => {
        const here = divisionsAt(this.divisions, f.id, me);
        return `${f.id}:${f.active ? 1 : 0}:${f.connections.length}:${here.map((d) => `${d.type}`).sort().join("")}`;
      })
      .join("|");
    if (key === this.frontsKey) return;
    this.frontsKey = key;
    this.fronts.replaceChildren(
      ...list.map((f) => {
        const section = el("button", "fx-sec fx-front");
        section.type = "button";
        section.dataset.drop = `front:${f.id}`;
        section.dataset.front = String(f.id);
        const rival = opponentOf(f, me);
        section.style.background = rgbCss(playerOnLand(rival));
        section.style.border = `3px solid ${rgbCss(playerBorder(rival))}`;
        section.append(el("div", `fx-dip ${f.active ? "war" : "peace"}`));
        // Largeur du front (nombre de connexions, 05-Fronts §2) : l'icône de largeur de front, puis le nombre.
        const width = el("div", "fx-width");
        width.title = "Largeur du front, en liaisons";
        width.append(frontWidthIcon("fx-width-icon"), el("span", "fx-width-num", String(f.connections.length)));
        section.append(width);
        const opponent = playerName(opponentOf(f, me));
        section.title = `${f.active ? "Front en guerre" : "Front en paix"} contre ${opponent} : cliquez pour l'ouvrir.`;
        section.classList.toggle("hl", f.id === this.highlighted);
        section.addEventListener("pointerenter", () => this.highlightOnMap(f.id));
        section.addEventListener("pointerleave", () => this.highlightOnMap(0));
        const here = divisionsAt(this.divisions, f.id, me);
        const tags = el("div", "fx-tags");
        for (const niche of this.military.niches) {
          const inNiche = here.filter((d) => nicheOf(d) === niche.id);
          if (inNiche.length > 0) tags.append(countTag(this.military, inNiche, "most"));
        }
        section.append(tags);
        section.addEventListener("click", () => this.openFront(f.id));
        return section;
      }),
    );
  }

  /** Front survolé sur la carte (0 : aucun) : sa section de la liste prend la classe `hl`, comme au survol de la souris. */
  setHighlight(front: number): void {
    this.highlighted = front;
    for (const section of this.fronts.children) {
      if (section instanceof HTMLElement) section.classList.toggle("hl", section.dataset.front === String(front));
    }
  }

}
