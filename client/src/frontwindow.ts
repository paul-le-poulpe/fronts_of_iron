// Fenêtre d'un front (05-Fronts §11.4), posée sur la carte. Bandeau (titre, interrupteur « Sélection avancée »,
// boutons d'attaque, fermeture et retour), forces de percée et réaction rapide du joueur, capsule du joueur (seconde
// ligne, première ligne), barre verticale, capsule de l'adversaire (première ligne de la même largeur, seconde ligne
// comprimée), sa réaction rapide et sa percée comprimées, zone des avions réservée.
// Les deux camps sont visibles (pas de brouillard de guerre). La page n'applique aucune règle : elle affiche ce que
// le moteur envoie (`FrontView`, `DivisionView`) et envoie des ordres. Colonnes de réaction rapide et de percée :
// V2, dessinées vides (aucune règle ne les remplit encore).
//
// Le DOM est construit une fois. `draw` ne remplace que le contenu des rangées de pions et des textes : un bouton
// survit entre `pointerdown` et `click`.

import "./forces.css";
import { countTag } from "./counttag.ts";
import { coveragePercent, divisionsAt, opponentOf, typeOf } from "./divisions.ts";
import { Dnd, type DndHost, type ZoneView } from "./dnd.ts";
import { attachPawnPanels, hidePanel } from "./infopanels.ts";
import { localPlayer, nicheLetters, playerName } from "./names.ts";
import { pawnOrder, renderZone } from "./pawn.ts";
import { type DivisionView, type FrontView, type HumanOrder, type MilitaryCatalog } from "./protocol.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Une rangée d'une colonne : le fond de sa niche, ses lettres, son pourcentage (première ligne), son contenu. */
interface RowRefs {
  readonly niche: string;
  readonly zone: HTMLElement;
  readonly pct: HTMLElement | null;
  /** Rectangle élargi au survol d'une rangée comprimée. */
  readonly pop: HTMLElement | null;
}

interface Column {
  readonly col: HTMLElement;
  readonly rows: RowRefs[];
}

/** Largeur d'un rectangle élargi (zone comprimée de l'adversaire, §11.4), et pions par ligne qui y tiennent côte à côte. */
const POP_WIDTH = 240;
const POP_PER_LINE = 5;

export class FrontWindow implements DndHost {
  readonly military: MilitaryCatalog;
  private readonly root: HTMLElement;
  private readonly send: (order: HumanOrder) => void;
  private readonly onBack: () => void;
  private readonly dnd: Dnd;
  private readonly win: HTMLElement;
  private readonly title: HTMLElement;
  private readonly advancedBox: HTMLInputElement;
  private readonly attackButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly columns: { readonly o2: Column; readonly o1: Column; readonly t1: Column; readonly t2: Column };
  private frontId = 0;
  private fronts: readonly FrontView[] = [];
  private divisions: readonly DivisionView[] = [];
  private byId = new Map<number, DivisionView>();

  constructor(root: HTMLElement, military: MilitaryCatalog, send: (order: HumanOrder) => void, onBack: () => void) {
    this.root = root;
    this.military = military;
    this.send = send;
    this.onBack = onBack;
    this.dnd = new Dnd(this);

    this.win = el("div", "fw themed");
    this.title = el("div", "fw-title");

    // Bandeau : moitié du joueur (titre, interrupteur, attaque) | moitié adverse (retour, fermeture).
    const head = el("div", "fw-head");
    const hl = el("div", "fw-hl");
    const sw = el("label", "fw-sw");
    this.advancedBox = el("input");
    this.advancedBox.type = "checkbox";
    this.advancedBox.addEventListener("change", () => this.dnd.modeChanged());
    sw.append(this.advancedBox, el("span", "fw-switch"), el("span", undefined, "Sélection avancée"));
    this.attackButton = el("button", "fw-btn", "Attaque sur tout le front");
    this.attackButton.type = "button";
    this.attackButton.addEventListener("click", () => this.toggleAttack());
    const barrage = el("button", "fw-btn", "Barrage d'artillerie");
    barrage.type = "button";
    barrage.disabled = true;
    barrage.title = "Hors périmètre : sans effet.";
    hl.append(this.title, sw, el("div", "fw-spacer"), this.attackButton, barrage);
    const hr = el("div", "fw-hr");
    this.backButton = el("button", "fw-btn", "← Retour");
    this.backButton.type = "button";
    this.backButton.hidden = true;
    this.backButton.addEventListener("click", () => {
      this.close();
      this.onBack();
    });
    const close = el("button", "fw-btn fw-close", "✕");
    close.type = "button";
    close.addEventListener("click", () => this.close());
    hr.append(this.backButton, close);
    head.append(hl, hr);

    // Corps : côté du joueur | barre | côté adverse. Les colonnes de la V2 (percée, réaction rapide) sont dessinées vides.
    const main = el("div", "fw-main");
    const ours = el("div", "fw-side ours");
    const theirs = el("div", "fw-side theirs");
    const pierce = el("div", "fw-col fw-pierce");
    const plus = el("div", "fw-pplus", "+");
    plus.title = "Forces de percée : version 2.";
    const retour = el("div", "fw-retour", "Retour à la réserve nationale");
    retour.dataset.drop = "reserve";
    pierce.append(el("div", "fw-lab", "Forces de percée"), el("div", "fw-plist"), plus, retour);
    const rapid = this.column("Réaction rapide", false, false);
    rapid.col.classList.add("fw-rapid");
    const o2 = this.column("Seconde ligne", false, false);
    const o1 = this.column("Première ligne", true, false);
    const t1 = this.column("Première ligne", true, false);
    const t2 = this.column("Seconde ligne", false, true);
    this.columns = { o2, o1, t1, t2 };
    const capsuleOurs = el("div", "fw-capsule");
    capsuleOurs.append(o2.col, o1.col);
    const capsuleTheirs = el("div", "fw-capsule");
    capsuleTheirs.append(t1.col, t2.col);
    ours.append(pierce, rapid.col, capsuleOurs);
    const rapidTheirs = this.column("Réaction rapide", false, true);
    const pierceTheirs = el("div", "fw-col comp fw-pierce-c");
    pierceTheirs.append(el("div", "fw-lab", "Percée"), el("div", "fw-plist"));
    theirs.append(capsuleTheirs, rapidTheirs.col, pierceTheirs);
    main.append(ours, theirs);

    const air = el("div", "fw-air", "ZONE DES AVIONS (RÉSERVÉE)");
    this.win.append(head, main, air);
    root.replaceChildren(this.win);

    // Les rangées gardent leur largeur : elles sont redessinées si la fenêtre change de taille.
    new ResizeObserver(() => {
      if (this.isOpen) this.draw();
    }).observe(this.win);
  }

  // ---- DndHost ----

  advanced(): boolean {
    return this.advancedBox.checked;
  }

  division(id: number): DivisionView | undefined {
    return this.byId.get(id);
  }

  dragging(on: boolean): void {
    this.win.classList.toggle("dragging", on);
  }

  /** Dépose sur une ligne du joueur (`line:front:ligne`) ou sur la zone de retour (`reserve`). */
  drop(target: string, ids: readonly number[]): void {
    const [kind, front, line] = target.split(":");
    if (kind === "line") {
      const f = Number(front);
      const l = line === "first" ? "first" : "second";
      const list = ids.filter((id) => {
        const d = this.byId.get(id);
        return d !== undefined && !(d.front === f && d.line === l && d.status !== "moving");
      });
      if (list.length > 0) this.send({ type: "move_division", ids: list, front: f, line: l });
    } else if (kind === "reserve") {
      const list = ids.filter((id) => this.byId.get(id)?.front !== 0);
      if (list.length > 0) this.send({ type: "move_division", ids: list, front: 0 });
    }
  }

  // ---- ouverture ----

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get openFront(): number {
    return this.isOpen ? this.frontId : 0;
  }

  /** `fromTab` : ouverte depuis l'onglet des forces, donc avec le bouton « ← Retour ». */
  open(front: FrontView, fromTab: boolean): void {
    this.frontId = front.id;
    this.backButton.hidden = !fromTab;
    this.root.hidden = false;
    this.advancedBox.checked = false;
    this.dnd.cancel();
    this.draw();
  }

  close(): void {
    this.dnd.cancel();
    hidePanel();
    this.root.hidden = true;
    this.frontId = 0;
  }

  /** À appeler à chaque tour. */
  refresh(fronts: readonly FrontView[], divisions: readonly DivisionView[]): void {
    const changed = fronts !== this.fronts || divisions !== this.divisions;
    this.fronts = fronts;
    if (divisions !== this.divisions) {
      this.divisions = divisions;
      this.byId = new Map(divisions.map((d) => [d.id, d]));
    }
    if (!this.isOpen) return;
    if (!fronts.some((f) => f.id === this.frontId)) {
      this.close();
      return;
    }
    if (changed) {
      this.dnd.prune();
      this.draw();
    }
  }

  // ---- construction ----

  /** Une colonne de cinq rangées, une par niche. `coverage` : première ligne, avec le pourcentage de couverture ; `compressed` : zone comprimée. */
  private column(label: string, coverage: boolean, compressed: boolean): Column {
    const col = el("div", `fw-col${compressed ? " comp" : ""}`);
    col.append(el("div", "fw-lab", label));
    const rows: RowRefs[] = [];
    const box = el("div", "fw-rows");
    for (const niche of this.military.niches) {
      const row = el("div", `fw-row n-${niche.id}${coverage ? " cov" : ""}${compressed ? " comp" : ""}`);
      const clip = el("div", "fw-clip");
      const big = el("div", "fw-big");
      big.append(el("span", "fw-letters", nicheLetters(niche.id)));
      const pct = coverage ? el("span", "fw-pct", "0 %") : null;
      if (pct !== null) big.append(pct);
      clip.append(big);
      const zone = el("div", "fw-zone");
      row.append(clip, zone);
      let pop: HTMLElement | null = null;
      if (compressed) {
        pop = el("div", "fw-pop");
        row.append(pop);
        attachPawnPanels(pop, this.military, (id) => this.byId.get(id));
      }
      rows.push({ niche: niche.id, zone, pct, pop });
      box.append(row);
    }
    col.append(box);
    return { col, rows };
  }

  // ---- dessin ----

  private toggleAttack(): void {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined) return;
    const me = front.players.indexOf(localPlayer());
    if (me < 0 || !front.active) return;
    this.send({ type: front.sides[me]!.frontAttack ? "stop_front_attack" : "start_front_attack", front: front.id });
  }

  private draw(): void {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined) return;
    const me = front.players.indexOf(localPlayer());
    if (me < 0) {
      this.close();
      return;
    }
    const player = localPlayer();
    const other = opponentOf(front, player);
    const m = this.military;
    const nicheOf = (d: DivisionView): string => typeOf(m, d).niche;

    this.title.replaceChildren(
      el("strong", undefined, `Front contre ${playerName(other)}`),
      el("span", "fw-muted", ` · ${front.connections.length} liaison${front.connections.length > 1 ? "s" : ""} · ${front.active ? "guerre" : "paix"}`),
    );
    const attacking = front.sides[me]!.frontAttack;
    this.attackButton.classList.toggle("on", attacking);
    this.attackButton.disabled = !front.active;
    this.attackButton.setAttribute("aria-pressed", String(attacking));
    this.attackButton.title = front.active ? "Interrupteur : un clic lance l'attaque, un second l'arrête." : "Seulement sur un front actif.";

    // La première ligne adverse a la largeur de celle du joueur (§11.4) ; le reste de son côté est comprimé.
    const lineWidth = this.columns.o1.col.getBoundingClientRect().width;
    if (lineWidth > 0) {
      this.columns.t1.col.style.flex = "none";
      this.columns.t1.col.style.width = `${lineWidth}px`;
    }

    const mine = divisionsAt(this.divisions, front.id, player);
    const theirs = divisionsAt(this.divisions, front.id, other);

    // Cibles de dépose : les deux lignes du joueur.
    this.columns.o2.col.dataset.drop = `line:${front.id}:second`;
    this.columns.o1.col.dataset.drop = `line:${front.id}:first`;

    const fill = (column: Column, zone: ZoneView | null, source: readonly DivisionView[], line: "first" | "second"): void => {
      const rows = column.rows.map((r) => {
        const here = source.filter((d) => d.line === line && nicheOf(d) === r.niche);
        if (r.pct !== null) r.pct.textContent = `${coveragePercent(front, here.reduce((s, d) => s + d.engaged, 0))} %`;
        return { el: r.zone, divisions: here };
      });
      if (zone !== null) zone.set(rows);
      else for (const r of rows) this.plain(r.el, r.divisions);
    };
    fill(this.columns.o2, this.dnd.zone("o2"), mine, "second");
    fill(this.columns.o1, this.dnd.zone("o1"), mine, "first");
    fill(this.columns.t1, null, theirs, "first");
    this.compressed(this.columns.t2, theirs.filter((d) => d.line === "second"), nicheOf);
  }

  /** Rangée sans sélection (première ligne de l'adversaire) : les pions, et leur panneau de survol. */
  private plain(zone: HTMLElement, divisions: readonly DivisionView[]): void {
    if (divisions.length === 0) {
      zone.replaceChildren();
      return;
    }
    const width = zone.clientWidth;
    if (width === 0) return;
    renderZone(zone, divisions, this.military, { width, selected: new Set() });
    if (zone.dataset.panels === undefined) {
      zone.dataset.panels = "1";
      attachPawnPanels(zone, this.military, (id) => this.byId.get(id));
    }
  }

  /** Seconde ligne de l'adversaire : par niche, une icône et le nombre de divisions ; au survol, toutes les divisions, une ligne par type. */
  private compressed(column: Column, divisions: readonly DivisionView[], nicheOf: (d: DivisionView) => string): void {
    for (const r of column.rows) {
      const here = divisions.filter((d) => nicheOf(d) === r.niche);
      r.zone.replaceChildren();
      r.pop?.replaceChildren();
      if (here.length === 0) continue;
      r.zone.append(countTag(this.military, here, "first"));
      const ordered = pawnOrder(here, this.military);
      const byType = new Map<number, DivisionView[]>();
      for (const d of ordered) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
      for (const group of byType.values()) {
        for (let i = 0; i < group.length; i += POP_PER_LINE) {
          const line = el("div", "fw-popline");
          line.style.width = `${POP_WIDTH - 16}px`;
          r.pop?.append(line);
          renderZone(line, group.slice(i, i + POP_PER_LINE), this.military, { width: POP_WIDTH - 16, selected: new Set() });
        }
      }
    }
  }
}
