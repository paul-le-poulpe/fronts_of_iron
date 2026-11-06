// Infobulles construites des machines (tooltip.ts, `setTip`) : à quoi sert la machine, ses réglages, et son effet
// pour le joueur au dernier tour. Les trois machines (tracteur, bateau de pêche, pompe à vapeur) en ont une, de la
// même forme ; les autres biens gardent leur `title`. Feuille de route : Docs/Design/04-Tooltips.md.
//
// La page n'applique aucune règle : les nombres viennent du catalogue (envoyé une fois, `setGoodTipCatalog`) et des
// statistiques du dernier tour (`setGoodTipStats`, à chaque tour). Une machine vaut un travailleur (08 §3) : même
// place, même sortie, uniquement dans sa boîte ; son gain est le bonhomme qu'elle libère.

import type { ActivityCatalog, PlayerStats } from "./protocol.ts";
import { productIcon } from "./icons.ts";
import { activityName } from "./names.ts";
import { setTip } from "./tooltip.ts";
import { num } from "./format.ts";

let catalog: ActivityCatalog | null = null;
let stats: PlayerStats | null = null;

/** Réglages du catalogue, une fois par partie. */
export function setGoodTipCatalog(c: ActivityCatalog): void {
  catalog = c;
  stats = null;
}

/** Statistiques du joueur humain, à chaque tour (avant `refreshTip`). */
export function setGoodTipStats(s: PlayerStats): void {
  stats = s;
}

/** Ce qui change d'une machine à l'autre dans l'infobulle. */
interface MachineTip {
  readonly title: string;
  readonly text: string;
  /** Travailleurs au singulier : « fermier ». */
  readonly worker: string;
  /** Travailleurs au pluriel : « fermiers ». */
  readonly workers: string;
  /** Libellé de la barre de surface : « Surface cultivée ». */
  readonly doneLabel: string;
  /** Travailleurs, puis ce qu'ils travaillent sur le total possible (cases). */
  readonly read: (s: PlayerStats) => { readonly working: number; readonly done: number; readonly total: number };
  readonly color: string;
}

const MACHINE_TIPS: Readonly<Record<string, MachineTip>> = {
  tractor: {
    title: "Tracteur",
    text: "Remplace un agriculteur.",
    worker: "agriculteur",
    workers: "agriculteurs",
    doneLabel: "Surface cultivée",
    read: (s) => ({ working: s.farmers, done: s.cultivated, total: s.farmTiles }),
    color: "var(--occ-farm)",
  },
  fishingBoat: {
    title: "Bateau de pêche",
    text: "Remplace un pêcheur.",
    worker: "pêcheur",
    workers: "pêcheurs",
    doneLabel: "Surface pêchée",
    read: (s) => ({ working: s.fishers, done: s.fished, total: s.seaTiles }),
    color: "var(--occ-fish)",
  },
  miningMachine: {
    title: "Pompe à vapeur",
    text: "Remplace un mineur.",
    worker: "mineur",
    workers: "mineurs",
    doneLabel: "Cases exploitées",
    read: (s) => ({ working: s.miners, done: s.minedTiles, total: s.ironTiles }),
    color: "var(--occ-mine)",
  },
};

/** Donne à `el` l'infobulle construite du bien `good`, s'il en a une. Renvoie faux sinon. */
export function attachGoodTip(el: Element, good: string): boolean {
  const spec = MACHINE_TIPS[good];
  if (spec === undefined) return false;
  setTip(el, () => machineTip(good, spec));
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

function machineTip(good: string, spec: MachineTip): Node {
  const root = el("div");
  const heading = el("h4", "tip-head");
  heading.append(productIcon(good), spec.title);
  root.append(heading, el("p", undefined, spec.text));
  if (catalog === null) return root;
  const host = catalog.activities.find((a) => a.good === good && (a.kind === "farming" || a.kind === "fishing" || a.kind === "mining"));
  const factory = catalog.activities.find((a) => a.good === good && a.kind === "factory");
  const rules = el("div", "tip-sec");
  rules.append(
    el("div", "tip-lbl", "Règles"),
    pairs([
      ["Cases par travailleur ou machine", num(host?.tilesPerWorker ?? 0)],
      ["Ligne qui la reçoit", host === undefined ? "—" : activityName(host.id)],
      ["Usine", factory === undefined ? "—" : `${activityName(factory.id)} (${num(factory.ironPerUnit)} fer par machine)`],
    ]),
  );
  root.append(rules);
  if (stats === null) return root;

  const index = catalog.goodIds.indexOf(good);
  const { working, done, total } = spec.read(stats);
  const bars = el("div", "tip-bars");
  const bar = el("div", "ib-track");
  fill(bar, done, total, spec.color);
  bars.append(el("span", undefined, spec.doneLabel), bar, el("span", undefined, `${num(done)} / ${num(total)}`));
  const nation = el("div", "tip-sec");
  nation.append(
    el("div", "tip-lbl", `Votre nation · ${num(working)} ${working > 1 ? spec.workers : spec.worker} · ${num(stats.machines[index] ?? 0)} / ${num(stats.machineLimits[index] ?? 0)} machines`),
    bars,
  );
  root.append(nation);
  return root;
}
