// Panneaux de survol (05-Fronts §11.7) : le panneau d'un type de division (menu « + ») et le panneau d'un pion
// (fenêtre d'un front, onglet des forces). Un seul panneau est affiché à la fois, posé sur `document.body`
// (position fixe : aucun conteneur à défilement ne le coupe). La page n'applique aucune règle : elle écrit ce que le
// moteur envoie (`DivisionTypeInfo`, `DivisionView`).

import { currentAttacks, maxAttacks, statePercent, typeOf } from "./divisions.ts";
import { icon32Path, productIconPath } from "./icons.ts";
import { equipmentName, nicheName, unitName } from "./names.ts";
import { type DivisionTypeInfo, type DivisionView, type MilitaryCatalog } from "./protocol.ts";

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Symbole de 32 × 32 px d'un composant : les hommes ou un type d'armement (version 32 × 32 si elle existe, sinon la 16 × 16 agrandie). */
function equipmentIcon(resource: string): HTMLElement {
  const path = resource === "men" ? "population/pop-soldier.png" : productIconPath(resource);
  if (path === undefined) return el("span", "ip-sq");
  const img = el("img", "ip-icon");
  img.src = `icons/${icon32Path(path)}`;
  img.alt = "";
  return img;
}

/** Une ligne : symbole, libellé, valeur à droite. */
function line(symbol: HTMLElement, label: string, value: string): HTMLElement {
  const r = el("div", "ip-row");
  r.append(symbol, el("span", "ip-label", label), el("b", undefined, value));
  return r;
}

/** Icône de 16 × 16 px de la motorisation : camion (motorisé) ou pieds (à pied). */
export function motorIcon(motorized: boolean): HTMLImageElement {
  const img = el("img", "ip-misc");
  img.src = `icons/miscellaneous/${motorized ? "icon-motorized" : "icon-on-foot"}.png`;
  img.alt = motorized ? "Motorisé" : "À pied";
  img.draggable = false;
  return img;
}

/** Une statistique : petite icône (provisoire : un carré de 16 × 16 px), libellé, valeur. */
const stat = (label: string, value: string): HTMLElement => line(el("span", "ip-sq"), label, value);

/** En-tête : le nom du type en gras à gauche (précédé de `before`), la niche en gris à droite. */
function head(type: DivisionTypeInfo, ...before: HTMLElement[]): HTMLElement {
  const h = el("h4", "ip-head");
  const left = el("span", "ip-name");
  left.append(...before);
  left.append(el("b", undefined, unitName(type.id)));
  h.append(left, el("span", "ip-niche", nicheName(type.niche)));
  return h;
}

const ratio = (scale100: number): string => `× ${fmt.format(scale100 / 100)}`;

/**
 * Statistiques du type communes au panneau d'un type et à celui d'un pion : PV, blindage, largeurs, multiplicateurs
 * (seulement ceux qui diffèrent de × 1) et déplacement.
 */
function typeStats(p: HTMLElement, type: DivisionTypeInfo): void {
  if (type.hitPoints > 0) p.append(stat("PV", num(type.hitPoints)));
  if (type.armorPercent > 0) p.append(stat("Blindage", `${type.armorPercent} %`));
  p.append(stat("Largeur de front", `${type.frontWidth} liaison${type.frontWidth > 1 ? "s" : ""}`));
  if (type.breakthroughWidth > 0) p.append(stat("Largeur de front en percée", `${type.breakthroughWidth} liaison${type.breakthroughWidth > 1 ? "s" : ""}`));
  if (type.attackMultiplier !== 100) p.append(stat("Multiplicateur en attaque", ratio(type.attackMultiplier)));
  if (type.hitPoints > 0 && type.defenseHitPointsMultiplier !== 100) p.append(stat("Multiplicateur de PV en défense", ratio(type.defenseHitPointsMultiplier)));
  p.append(line(motorIcon(type.motorized), "Déplacement", type.motorized ? "Motorisé" : "À pied"));
}

/** Panneau d'un type (menu « + ») : description, équipement requis, statistiques non nulles. */
export function typePanel(type: DivisionTypeInfo): HTMLElement {
  const p = el("div", "ip");
  p.append(head(type));
  if (type.description !== "") p.append(el("div", "ip-desc", type.description));
  p.append(el("div", "ip-sep"));
  for (const c of type.components) p.append(line(equipmentIcon(c.resource), equipmentName(c.resource), num(c.count)));
  p.append(el("div", "ip-sep"));
  const a = maxAttacks(type);
  if (a.soft > 0) p.append(stat("Attaque anti-infanterie", num(a.soft)));
  if (a.hard > 0) p.append(stat("Attaque antiblindée", num(a.hard)));
  if (a.air > 0) p.append(stat("Attaque antiaérienne", num(a.air)));
  typeStats(p, type);
  return p;
}

/** Panneau d'un pion : icône et rang, nom et niche, description, équipement actuel / requis, état, attaques actuelles / maximales, puis les statistiques du type. */
export function pawnPanel(military: MilitaryCatalog, d: DivisionView): HTMLElement {
  const type = typeOf(military, d);
  const p = el("div", "ip");
  // Icône du type, puis rang : le rang n'existe pas encore dans les règles (05-Fronts §16), donc 0 ; l'icône de 8 × 10 est agrandie ×2 (16 × 20).
  const icon = el("img", "ip-icon");
  icon.src = `icons/${icon32Path(type.icon)}`;
  icon.alt = "";
  const rank = el("img", "ip-rank");
  rank.src = "icons/ranks/icon-rank-0.png";
  rank.alt = "";
  p.append(head(type, icon, rank));
  if (type.description !== "") p.append(el("div", "ip-desc", type.description));
  p.append(el("div", "ip-sep"));
  type.components.forEach((c, i) => p.append(line(equipmentIcon(c.resource), equipmentName(c.resource), `${num(d.counts[i]!)} / ${num(c.count)}`)));
  p.append(el("div", "ip-sep"));
  p.append(stat("État", `${statePercent(military, d)} %`));
  const now = currentAttacks(type, d);
  const max = maxAttacks(type);
  if (max.soft > 0) p.append(stat("Attaque anti-infanterie", `${num(now.soft)} / ${num(max.soft)}`));
  if (max.hard > 0) p.append(stat("Attaque antiblindée", `${num(now.hard)} / ${num(max.hard)}`));
  if (max.air > 0) p.append(stat("Attaque antiaérienne", `${num(now.air)} / ${num(max.air)}`));
  typeStats(p, type);
  return p;
}

// ---- affichage ----

/** Écart entre le pion et son panneau, en px (05-Fronts §11.7). */
const GAP = 14;

let current: HTMLElement | null = null;

/** Retire le panneau affiché. */
export function hidePanel(): void {
  current?.remove();
  current = null;
}

function mount(panel: HTMLElement): void {
  hidePanel();
  panel.style.visibility = "hidden";
  document.body.append(panel);
  current = panel;
}

/** Panneau d'un pion : 14 px au-dessus du pion (au-dessous s'il n'y a pas la place), jamais collé à la souris. */
export function showPawnPanel(panel: HTMLElement, pawn: DOMRect): void {
  mount(panel);
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const left = Math.max(4, Math.min(pawn.left - 20, window.innerWidth - w - 4));
  const above = pawn.top - GAP - h;
  panel.style.left = `${left}px`;
  panel.style.top = `${above >= 4 ? above : Math.min(pawn.bottom + GAP, Math.max(4, window.innerHeight - h - 4))}px`;
  panel.style.visibility = "";
}

/** Panneau d'un type : à droite de `anchor` (le menu), à la hauteur de la ligne survolée. */
export function showTypePanel(panel: HTMLElement, anchor: DOMRect, row: DOMRect): void {
  mount(panel);
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  panel.style.left = `${Math.max(4, Math.min(anchor.right + 8, window.innerWidth - w - 4))}px`;
  panel.style.top = `${Math.max(4, Math.min(row.top, window.innerHeight - h - 4))}px`;
  panel.style.visibility = "";
}

/** Panneau explicatif : un titre en gras et un texte. */
export function textPanel(title: string, text: string, icon?: HTMLElement): HTMLElement {
  const p = el("div", "ip");
  const h = el("h4", "ip-head");
  const name = el("span", "ip-name");
  if (icon) name.append(icon);
  name.append(el("b", undefined, title));
  h.append(name);
  p.append(h, el("div", "ip-desc", text));
  return p;
}

/** Affiche `make()` au-dessus de `target` tant que la souris est dessus ; `make` peut renvoyer `null` (rien à montrer). */
export function attachTextPanel(target: HTMLElement, make: () => HTMLElement | null): void {
  target.addEventListener("pointerenter", () => {
    const panel = make();
    if (panel !== null) showPawnPanel(panel, target.getBoundingClientRect());
  });
  target.addEventListener("pointerleave", hidePanel);
}

/**
 * Panneau de survol des pions d'un conteneur sans sélection (pions de l'adversaire, rectangle élargi d'une zone
 * comprimée) : même panneau, 14 px au-dessus du pion ; `lookup` retrouve la division d'un pion.
 */
export function attachPawnPanels(root: HTMLElement, military: MilitaryCatalog, lookup: (id: number) => DivisionView | undefined): void {
  let timer = 0;
  let current: number | null = null;
  const stop = (): void => {
    window.clearTimeout(timer);
    current = null;
    hidePanel();
  };
  root.addEventListener("pointermove", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".pz-pawn");
    const id = el === null ? null : Number(el.dataset.id);
    if (id === current) return;
    stop();
    if (el === null || id === null) return;
    current = id;
    timer = window.setTimeout(() => {
      const d = lookup(id);
      if (d !== undefined && el.isConnected) showPawnPanel(pawnPanel(military, d), el.getBoundingClientRect());
    }, 120);
  });
  root.addEventListener("pointerleave", stop);
  root.addEventListener("pointerdown", stop);
}
