// Infobulles construites des biens (tooltip.ts, `setTip`) : à quoi sert le bien,
// ses réglages, et son effet pour le joueur au dernier tour. Seul le tracteur en
// a une pour l'instant ; les autres biens gardent leur `title`.
//
// La page n'applique aucune règle : les nombres viennent du catalogue (envoyé une
// fois) et des statistiques du dernier tour (`setGoodTipStats`, à chaque tour).

import type { EconomyInfo, PlayerStats } from "./protocol.ts";
import { setTip } from "./tooltip.ts";

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);
/** Millièmes de case → cases, deux décimales au plus. */
const tiles = (milli: number): string => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(milli / 1000);

let economy: EconomyInfo | null = null;
let stats: PlayerStats | null = null;

/** Réglages du catalogue, une fois par partie. */
export function setGoodTipEconomy(info: EconomyInfo): void {
  economy = info;
  stats = null;
}

/** Statistiques du joueur humain, à chaque tour (avant `refreshTip`). */
export function setGoodTipStats(s: PlayerStats): void {
  stats = s;
}

/** Donne à `el` l'infobulle construite du bien `good`, s'il en a une. Renvoie faux sinon. */
export function attachGoodTip(el: Element, good: string): boolean {
  if (good !== "tractor") return false;
  setTip(el, tractorTip);
  return true;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Grille de paires libellé / valeur. */
function pairs(rows: readonly (readonly [string, string])[]): HTMLElement {
  const g = el("div", "tip-kv");
  for (const [k, v] of rows) g.append(el("span", undefined, k), el("span", undefined, v));
  return g;
}

/** Barre remplie à `part` sur `whole`, 0…100 %. */
function fill(track: HTMLElement, part: number, whole: number, color?: string): HTMLElement {
  const i = el("i", "ib-fill");
  i.style.width = `${whole > 0 ? Math.min(100, Math.max(0, (100 * part) / whole)) : 0}%`;
  if (color) i.style.background = color;
  track.append(i);
  return i;
}

/** « 1 tracteur pour 10 fermiers » si le rapport tombe juste, « 100 tracteurs pour 1 000 fermiers » sinon. */
function fullRatio(per1000: number): string {
  return per1000 > 0 && 1000 % per1000 === 0
    ? `1 tracteur pour ${num(1000 / per1000)} fermiers`
    : `${num(per1000)} tracteurs pour 1 000 fermiers`;
}

function tractorTip(): Node {
  const root = el("div");
  root.append(
    el("h4", undefined, "Tracteur"),
    el("p", undefined, "Machine agricole. Les tracteurs augmentent la surface que cultive chaque fermier : il faut moins de fermiers pour la même surface."),
  );
  if (economy === null) return root;
  const base = economy.farmMechanizationBase;
  const max = economy.farmMechanizationMax;

  const rules = el("div", "tip-sec");
  rules.append(
    el("div", "tip-lbl", "Surface par fermier"),
    pairs([
      ["Sans tracteur", `${tiles(base)} case`],
      [fullRatio(economy.machinesPer1000["tractor"] ?? 0), `${tiles(max)} case`],
    ]),
  );
  root.append(rules);
  if (stats === null) return root;

  // Jauge : de la surface par fermier sans tracteur (0 %) à celle d'une mécanisation totale (100 %).
  const m = Math.max(base, stats.farmMechanization);
  const nation = el("div", "tip-sec");
  const gauge = el("div", "ib-track tip-gauge");
  const at = fill(gauge, m - base, max - base);
  const value = el("span", "tip-gauge-val", tiles(m));
  value.style.left = at.style.width;
  gauge.append(value);
  const scale = el("div", "tip-scale");
  scale.append(el("span", undefined, `${tiles(base)} case / fermier`), el("span", undefined, tiles(max)));

  const surface = el("div", "tip-row");
  const bar = el("div", "ib-track");
  fill(bar, stats.cultivated, stats.farmTiles, "var(--occ-farm)");
  surface.append(el("span", undefined, "Surface cultivée"), bar, el("span", undefined, `${num(stats.cultivated)} / ${num(stats.farmTiles)}`));

  nation.append(
    el("div", "tip-lbl", `Votre nation · ${num(stats.farmers)} fermiers · ${num(stats.tractorsUsed)} / ${num(stats.fullMachines["tractor"] ?? 0)} tracteurs`),
    gauge,
    scale,
    surface,
  );
  root.append(nation);
  return root;
}
