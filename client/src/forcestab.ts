// Onglet des forces (05-Fronts §11.2) : le détail de la sixième section de la barre d'informations. Barre du haut
// (bouton « + » à gauche, corbeille à droite pendant un glisser), réserve nationale détaillée (de vrais pions, un
// groupe par type), puis une section par front (fronts en guerre active, puis en paix, du plus long au plus court :
// statut diplomatique, et par niche une icône et le nombre de divisions). Menu « + » : une ligne par niche, les types
// côte à côte avec « actuel / supportable », un clic crée une division.
//
// La page n'applique aucune règle : elle affiche ce que le moteur envoie (`DivisionView`, `PlayerStats`,
// `HumanDetail`) et envoie des ordres (`create_division`, `delete_division`, `move_division`). La sélection est
// simple (un clic, §11.4) : l'interrupteur « Sélection avancée » est dans la fenêtre d'un front.

import "./forces.css";
import { countTag } from "./counttag.ts";
import { creatable, divisionsAt, opponentOf, sortedFronts, supportable, typeOf } from "./divisions.ts";
import { Dnd, type DndHost } from "./dnd.ts";
import { hidePanel, showTypePanel, typePanel } from "./infopanels.ts";
import { icon32Path } from "./icons.ts";
import { localPlayer, nicheLetters, nicheName } from "./names.ts";
import { playerColor, rgbCss } from "./painter.ts";
import { type DivisionView, type FactoryCatalog, type FrontView, type HumanDetail, type HumanOrder, type MilitaryCatalog, type PlayerStats } from "./protocol.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class ForcesTab implements DndHost {
  readonly military: MilitaryCatalog;
  /** Contenu du détail (la barre d'informations le pose dans son volet). */
  readonly content: HTMLElement;
  private readonly armamentIds: readonly string[];
  private readonly send: (order: HumanOrder) => void;
  private readonly openFront: (id: number) => void;
  private readonly dnd: Dnd;
  private readonly plus: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly reserveZone: HTMLElement;
  private readonly fronts: HTMLElement;
  private readonly entries: { readonly index: number; readonly root: HTMLElement; readonly count: HTMLElement; readonly row: HTMLElement }[] = [];
  private frontViews: readonly FrontView[] = [];
  private divisions: readonly DivisionView[] = [];
  private byId = new Map<number, DivisionView>();
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;
  private reserveKey = "";
  private frontsKey = "";

  constructor(military: MilitaryCatalog, catalog: FactoryCatalog, send: (order: HumanOrder) => void, openFront: (id: number) => void) {
    this.military = military;
    this.armamentIds = catalog.armamentIds;
    this.send = send;
    this.openFront = openFront;
    this.dnd = new Dnd(this);

    this.content = el("div", "fx themed");
    const bar = el("div", "fx-bar");
    const left = el("div", "fx-half");
    this.plus = el("button", "fx-plus");
    this.plus.type = "button";
    this.plus.title = "Créer une division";
    this.plus.setAttribute("aria-expanded", "false");
    const plusImg = el("img", "fx-plus-icon");
    plusImg.src = "icons/miscellaneous/misc-plus-lighter.png";
    plusImg.alt = "Créer une division";
    this.plus.append(plusImg);
    this.plus.addEventListener("click", () => (this.menu.hidden ? this.openMenu() : this.closeMenu()));
    left.append(this.plus);
    const right = el("div", "fx-half");
    const trash = el("div", "fx-trash");
    trash.dataset.drop = "trash";
    trash.title = "Supprimer les divisions de la réserve nationale déposées ici";
    trash.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
    right.append(trash);
    bar.append(left, right);

    this.menu = el("div", "fx-menu");
    this.menu.hidden = true;
    this.buildMenu();

    const reserve = el("div", "fx-sec fx-res");
    reserve.dataset.drop = "reserve";
    reserve.append(el("div", "fx-dip spacer"));
    this.reserveZone = el("div", "fx-zone");
    reserve.append(this.reserveZone);
    this.fronts = el("div", "fx-fronts");
    this.content.append(bar, this.menu, reserve, this.fronts);

    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && e.target instanceof Node && !this.menu.contains(e.target) && !this.plus.contains(e.target)) this.closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeMenu();
    });
  }

  // ---- DndHost ----

  advanced(): boolean {
    return false;
  }

  division(id: number): DivisionView | undefined {
    return this.byId.get(id);
  }

  dragging(on: boolean): void {
    this.content.classList.toggle("dragging", on);
  }

  /** Dépose sur la corbeille (`trash`) ou sur la section d'un front (`front:id`) : seconde ligne (05-Fronts §4.1). */
  drop(target: string, ids: readonly number[]): void {
    const [kind, id] = target.split(":");
    if (kind === "trash") {
      // Seulement les divisions de la réserve nationale, ni en formation ni en déplacement (05-Fronts §3.5).
      for (const x of ids) {
        const d = this.byId.get(x);
        if (d !== undefined && d.front === 0 && d.status !== "formation" && d.status !== "moving") this.send({ type: "delete_division", id: x });
      }
    } else if (kind === "front") {
      const front = Number(id);
      const list = ids.filter((x) => {
        const d = this.byId.get(x);
        return d !== undefined && !(d.front === front && d.status !== "moving");
      });
      if (list.length > 0) this.send({ type: "move_division", ids: list, front });
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

  /** Le détail est replié : le menu se ferme et la sélection est abandonnée. */
  collapsed(): void {
    this.closeMenu();
    this.dnd.cancel();
    hidePanel();
  }

  /** Mise à jour du détail ouvert (à chaque tour) : réserve, sections de front, menu. */
  body(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    this.drawReserve();
    this.drawFronts();
    if (!this.menu.hidden) this.updateMenu();
  }

  // ---- réserve nationale ----

  private drawReserve(): void {
    const me = localPlayer();
    const mine = divisionsAt(this.divisions, 0, me);
    const key = mine.map((d) => `${d.id}:${d.state}:${d.status}`).join(",") + `|${this.reserveZone.clientWidth}`;
    if (key === this.reserveKey) return;
    this.reserveKey = key;
    this.dnd.zone("res").set([{ el: this.reserveZone, divisions: mine }]);
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
        section.style.background = rgbCss(playerColor(opponentOf(f, me)));
        section.append(el("div", `fx-dip ${f.active ? "war" : "peace"}`));
        section.title = f.active ? "Front en guerre : cliquez pour l'ouvrir." : "Front en paix : cliquez pour l'ouvrir.";
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

  // ---- menu « + » ----

  private buildMenu(): void {
    for (const niche of this.military.niches) {
      const row = el("div", `fx-mrow n-${niche.id}`);
      const types = el("div", "fx-types");
      for (const id of niche.types) {
        const type = this.military.divisions.find((t) => t.id === id)!;
        const root = el("div", "fx-ment");
        const img = el("img", "fx-ment-icon");
        img.src = `icons/${icon32Path(type.icon)}`;
        img.alt = nicheName(niche.id);
        img.draggable = false;
        const count = el("span", "fx-cnt");
        root.append(img, count);
        root.addEventListener("click", () => this.create(type.index));
        root.addEventListener("pointerenter", () => showTypePanel(typePanel(type), this.menu.getBoundingClientRect(), row.getBoundingClientRect()));
        root.addEventListener("pointerleave", hidePanel);
        types.append(root);
        this.entries.push({ index: type.index, root, count, row });
      }
      row.append(types, el("div", "fx-mlab", nicheLetters(niche.id)));
      this.menu.append(row);
    }
  }

  private openMenu(): void {
    this.menu.hidden = false;
    // Le menu est posé sur le détail : sans assez de contenu dessous, le volet défilerait.
    this.content.classList.add("menu-open");
    this.plus.setAttribute("aria-expanded", "true");
    this.updateMenu();
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.content.classList.remove("menu-open");
    this.plus.setAttribute("aria-expanded", "false");
    hidePanel();
  }

  /** « actuel / supportable » de chaque type ; à 50 % de transparence si l'on ne peut pas en créer un (05-Fronts §3.5). */
  private updateMenu(): void {
    if (this.last === null) return;
    const { detail, stats } = this.last;
    const me = localPlayer();
    for (const e of this.entries) {
      const type = this.military.divisions[e.index]!;
      const have = this.divisions.reduce((n, d) => n + (d.owner === me && d.type === e.index ? 1 : 0), 0);
      const can = supportable(type, stats, detail, this.armamentIds);
      e.count.replaceChildren();
      const now = el("span", have > can ? "red" : undefined, String(have));
      e.count.append(now, document.createTextNode(`/${can}`));
      e.root.classList.toggle("unavailable", !creatable(type, stats, detail, this.armamentIds));
    }
  }

  /** Un clic sur un type crée une division s'il le peut (05-Fronts §3.5) ; sans effet sinon. */
  private create(index: number): void {
    if (this.last === null) return;
    const type = this.military.divisions[index]!;
    if (!creatable(type, this.last.stats, this.last.detail, this.armamentIds)) return;
    this.send({ type: "create_division", division: type.id });
  }
}
