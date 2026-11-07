// Panneaux de survol (05-Fronts §11.7) : le panneau d'un type de division (menu « + ») et le panneau d'un pion
// (fenêtre d'un front, onglet des forces). Un seul panneau est affiché à la fois, posé sur `document.body`
// (position fixe : aucun conteneur à défilement ne le coupe). La page n'applique aucune règle : elle écrit ce que le
// moteur envoie (`DivisionTypeInfo`, `DivisionView`). Une division n'a plus d'équipement (08 §5) : une barre de vie.

import { currentAttacks, maxAttacks, statePercent, statusLabel, typeOf } from "./divisions.ts";
import { unitIconUrl } from "./uniticons.ts";
import { nicheName, strengthOf, unitName } from "./names.ts";
import { type DivisionTypeInfo, type DivisionView, type MilitaryCatalog } from "./protocol.ts";
import { num } from "./format.ts";

const fmt = new Intl.NumberFormat("fr-FR");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
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

/** Icône de 16 × 16 px de la largeur de front ; `className` change la mise en forme (`ip-misc` : dans une ligne de panneau). */
export function frontWidthIcon(className = "ip-misc"): HTMLImageElement {
  const img = el("img", className);
  img.src = "icons/miscellaneous/icon-front-width.png";
  img.alt = "Largeur de front";
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
  p.append(line(frontWidthIcon(), "Largeur de front", `${type.frontWidth} liaison${type.frontWidth > 1 ? "s" : ""}`));
  if (type.breakthroughWidth > 0) p.append(line(frontWidthIcon(), "Largeur de front en percée", `${type.breakthroughWidth} liaison${type.breakthroughWidth > 1 ? "s" : ""}`));
  if (type.attackMultiplier !== 100) {
    const row = stat("Multiplicateur en attaque", ratio(type.attackMultiplier));
    // Un multiplicateur inférieur à × 1 affaiblit l'attaque (valeur en rouge), supérieur à × 1 la renforce (en vert).
    row.classList.add(type.attackMultiplier < 100 ? "ip-low" : "ip-high");
    p.append(row);
  }
  if (type.hitPoints > 0 && type.defenseHitPointsMultiplier !== 100) {
    const row = stat("Multiplicateur de PV en défense", ratio(type.defenseHitPointsMultiplier));
    row.classList.add(type.defenseHitPointsMultiplier < 100 ? "ip-low" : "ip-high");
    p.append(row);
  }
  p.append(line(motorIcon(type.motorized), "Déplacement", type.motorized ? "Motorisé" : "À pied"));
}

/** Effectif d'une division (08 §8 bis), juste après la description. */
function strengthLine(type: DivisionTypeInfo): HTMLElement {
  const s = strengthOf(type.id, type.niche, 1);
  return el("div", "ip-desc", `${num(s.count)} ${s.name}`);
}

/** Panneau d'un type de division : description, effectif, attaques d'une division pleine, statistiques non nulles. */
export function typePanel(type: DivisionTypeInfo): HTMLElement {
  const p = el("div", "ip");
  p.append(head(type));
  if (type.description !== "") p.append(el("div", "ip-desc", type.description));
  p.append(strengthLine(type));
  p.append(el("div", "ip-sep"));
  const a = maxAttacks(type);
  if (a.soft > 0) p.append(stat("Attaque anti-infanterie", num(a.soft)));
  if (a.hard > 0) p.append(stat("Attaque antiblindée", num(a.hard)));
  if (a.air > 0) p.append(stat("Attaque antiaérienne", num(a.air)));
  typeStats(p, type);
  return p;
}

/** Panneau d'un pion : icône et rang, nom et niche, description, effectif, état, attaques actuelles / maximales, puis les statistiques du type. */
export function pawnPanel(military: MilitaryCatalog, d: DivisionView): HTMLElement {
  const type = typeOf(military, d);
  const p = el("div", "ip");
  // Ligne optionnelle au-dessus du nom : ce que veut dire l'icône de statut du pion.
  const status = statusLabel(d);
  if (status !== null) p.append(el("div", "ip-status", status));
  // Icône du type, puis rang : le rang n'existe pas encore dans les règles (05-Fronts §16), donc 0 ; l'icône de 8 × 10 est agrandie ×2 (16 × 20).
  const icon = el("img", "ip-icon");
  icon.src = unitIconUrl(type.icon, d.owner);
  icon.alt = "";
  const rank = el("img", "ip-rank");
  rank.src = "icons/ranks/icon-rank-0.png";
  rank.alt = "";
  p.append(head(type, icon, rank));
  if (type.description !== "") p.append(el("div", "ip-desc", type.description));
  p.append(strengthLine(type));
  p.append(el("div", "ip-sep"));
  p.append(stat("État", `${statePercent(military, d)} %`));
  const now = currentAttacks(type, d, military.stateScale);
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
