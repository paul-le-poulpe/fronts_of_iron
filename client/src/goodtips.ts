// Infobulles construites des biens (tooltip.ts, `setTip`) : à quoi sert le bien,
// ses réglages, et son effet pour le joueur au dernier tour. Les trois machines
// (tracteur, bateau de pêche, pompe à vapeur) en ont une, de la même forme ; les
// autres biens gardent leur `title`. Les choix du menu « Inaugurer une usine »
// ont l'arbre de progression de leur type d'usine. Feuille de route :
// Docs/Design/04-Tooltips.md.
//
// La page n'applique aucune règle : les nombres viennent du catalogue (envoyé une
// fois) et des statistiques du dernier tour (`setGoodTipStats`, à chaque tour).

import type { EconomyInfo, PlayerStats } from "./protocol.ts";
import { productIcon, productIconPath } from "./icons.ts";
import { factoryName, productName } from "./names.ts";
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

/** Ce qui change d'une machine à l'autre dans l'infobulle. */
interface MachineTip {
  readonly title: string;
  readonly text: string;
  /** Machine au singulier et au pluriel : « tracteur », « tracteurs ». */
  readonly one: string;
  readonly many: string;
  /** Travailleurs au singulier et au pluriel : « fermier », « fermiers ». */
  readonly worker: string;
  readonly workers: string;
  /** Titre des règles : « Surface par fermier ». */
  readonly rulesLabel: string;
  /** Ligne sans machine : « Sans tracteur ». */
  readonly none: string;
  /** Règles en plus (rendement d'une case d'eau pour les bateaux). */
  readonly extraRules?: (e: EconomyInfo, ratio: string) => HTMLElement;
  /** Travailleurs, puis ce qu'ils travaillent sur le total possible (cases). */
  readonly read: (s: PlayerStats) => { readonly working: number; readonly done: number; readonly total: number };
  /** Libellé et couleur de la barre : celle du métier dans le détail Population. */
  readonly doneLabel: string;
  readonly color: string;
}

const MACHINE_TIPS: Readonly<Record<string, MachineTip>> = {
  tractor: {
    title: "Tracteur",
    text: "Machine agricole. Les tracteurs augmentent la surface que cultive chaque fermier : il faut moins de fermiers pour la même surface.",
    one: "tracteur",
    many: "tracteurs",
    worker: "fermier",
    workers: "fermiers",
    rulesLabel: "Surface par fermier",
    none: "Sans tracteur",
    read: (s) => ({ working: s.farmers, done: s.cultivated, total: s.farmTiles }),
    doneLabel: "Surface cultivée",
    color: "var(--occ-farm)",
  },
  fishingBoat: {
    title: "Bateau de pêche",
    text: "Machine de pêche. Les bateaux augmentent la surface que pêche chaque pêcheur et ce que rapporte chaque case d'eau : il faut moins de pêcheurs pour la même surface.",
    one: "bateau",
    many: "bateaux",
    worker: "pêcheur",
    workers: "pêcheurs",
    rulesLabel: "Surface par pêcheur",
    none: "Sans bateau",
    extraRules: (e, ratio) => {
      const sec = el("div", "tip-sec");
      sec.append(
        el("div", "tip-lbl", "Rendement d'une case d'eau"),
        pairs([
          ["Sans bateau", num(e.waterYield.base)],
          [ratio, num(e.waterYield.max)],
        ]),
      );
      return sec;
    },
    read: (s) => ({ working: s.fishers, done: s.fished, total: s.seaTiles }),
    doneLabel: "Surface pêchée",
    color: "var(--occ-fish)",
  },
  miningMachine: {
    title: "Pompe à vapeur",
    text: "Machine d'extraction, commune à tous les minerais (fer, aluminium…). Les pompes augmentent le nombre de cases qu'exploite chaque mineur : il faut moins de mineurs pour la même quantité de minerai. Elles sont réparties entre les minerais proportionnellement à leurs mineurs : avec 100 mineurs sur le fer et 50 sur l'aluminium, 2/3 des pompes vont au fer.",
    one: "pompe",
    many: "pompes",
    worker: "mineur",
    workers: "mineurs",
    rulesLabel: "Cases de minerai par mineur",
    none: "Sans pompe",
    read: (s) => ({ working: s.miners, done: s.minedTiles, total: s.ironTiles }),
    doneLabel: "Cases exploitées",
    color: "var(--occ-mine)",
  },
};

/** Un type d'usine du catalogue : son arbre, racine en premier, chaque parent avant ses enfants. */
interface FactoryTypeInfo {
  readonly id: string;
  readonly tree: readonly { readonly good: string; readonly parent: string | null }[];
}

/**
 * Donne à `el` (un choix du menu « Inaugurer une usine ») l'arbre de progression
 * du type d'usine, placé à droite de `menu` (00-Game §8.4).
 */
export function attachFactoryTreeTip(el: Element, type: FactoryTypeInfo, menu: Element): void {
  setTip(el, () => factoryTreeTip(type), menu);
}

function factoryTreeTip(type: FactoryTypeInfo): Node {
  const frag = document.createDocumentFragment();
  frag.append(el("div", "tip-lbl", `${factoryName(type.id)} : arbre de progression`));
  const node = (good: string, parent: string | null): HTMLElement => {
    const li = el("li");
    const row = el("div", "tip-tree-node");
    // Sans icône, un carré en pointillés plutôt que le symbole texte, qui répéterait le nom.
    row.append(productIconPath(good) === undefined ? el("span", "tip-tree-ph") : productIcon(good, 32));
    row.append(el("span", parent === null ? "tip-tree-root" : undefined, productName(good)));
    li.append(row);
    if (parent === null) li.append(el("div", "tip-tree-sub", "production de base"));
    const children = type.tree.filter((n) => n.parent === good);
    if (children.length > 0) {
      const ul = el("ul");
      for (const c of children) ul.append(node(c.good, good));
      li.append(ul);
    }
    return li;
  };
  const root = el("ul", "tip-tree");
  root.append(node(type.tree[0]!.good, null));
  frag.append(root);
  return frag;
}

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

/** « 1 tracteur pour 10 fermiers » si le rapport tombe juste, « 100 tracteurs pour 1 000 fermiers » sinon. */
function fullRatio(spec: MachineTip, per1000: number): string {
  return per1000 > 0 && 1000 % per1000 === 0
    ? `1 ${spec.one} pour ${num(1000 / per1000)} ${spec.workers}`
    : `${num(per1000)} ${spec.many} pour 1 000 ${spec.workers}`;
}

function machineTip(good: string, spec: MachineTip): Node {
  const root = el("div");
  // Icône de la machine à côté du nom : de l'onglet Population, elle dit quelle machine mécanise le métier.
  const heading = el("h4", "tip-head");
  heading.append(productIcon(good), spec.title);
  root.append(heading, el("p", undefined, spec.text));
  const range = economy?.mechanization[good];
  if (economy === null || range === undefined) return root;
  const { base, max } = range;
  const ratio = fullRatio(spec, economy.machinesPer1000[good] ?? 0);

  const rules = el("div", "tip-sec");
  rules.append(
    el("div", "tip-lbl", spec.rulesLabel),
    pairs([
      [spec.none, `${tiles(base)} case`],
      [ratio, `${tiles(max)} case`],
    ]),
  );
  root.append(rules);
  if (spec.extraRules) root.append(spec.extraRules(economy, ratio));
  if (stats === null) return root;

  // Deux barres dans une grille (libellé | barre | valeur), pour que leurs bords gauches
  // s'alignent. La jauge et son échelle n'ont pas de valeur à droite : elles prennent
  // aussi la troisième colonne.
  const bars = el("div", "tip-bars");

  // Jauge : de la mécanisation sans machine (0 %) à la mécanisation totale (100 %).
  const m = Math.max(base, stats.mechanization[good] ?? 0);
  const gaugeLabel = el("span", "tip-gauge-lbl");
  const gear = el("img", "ib-img");
  gear.src = "icons/miscellaneous/misc-gear-stolen.png";
  gear.alt = "";
  gaugeLabel.append(gear, "Mécanisation");
  const gauge = el("div", "ib-track tip-gauge");
  const at = fill(gauge, m - base, max - base);
  const value = el("span", "tip-gauge-val", tiles(m));
  value.style.left = at.style.width;
  gauge.append(value);
  const scale = el("div", "tip-scale");
  scale.append(el("span", undefined, `${tiles(base)} case / ${spec.worker}`), el("span", undefined, tiles(max)));
  bars.append(gaugeLabel, gauge, el("span"), scale);

  const { working, done, total } = spec.read(stats);
  const bar = el("div", "ib-track");
  fill(bar, done, total, spec.color);
  bars.append(el("span", undefined, spec.doneLabel), bar, el("span", undefined, `${num(done)} / ${num(total)}`));

  const used = stats.machinesUsed[good] ?? 0;
  const full = stats.fullMachines[good] ?? 0;
  const nation = el("div", "tip-sec");
  nation.append(el("div", "tip-lbl", `Votre nation · ${num(working)} ${spec.workers} · ${num(used)} / ${num(full)} ${spec.many}`), bars);
  root.append(nation);
  return root;
}
