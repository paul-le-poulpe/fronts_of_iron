// Pion d'une division et disposition d'une zone : espacé, piles, « trop de pions »
// (Docs/Design/05-Fronts.md §11.3). Ce module ne choisit pas la sélection, ne gère ni le
// glisser-déposer ni les panneaux de survol : il dessine ce qu'on lui donne et rend les
// positions. Chaque pion porte `data-id` (identifiant de la division). Une division en trop
// (`leaveTick`, 08 §6) clignote jusqu'à sa disparition.

import "./pawn.css";
import { defendsBreakthrough } from "./divisions.ts";
import type { DivisionView, MilitaryCatalog } from "./protocol.ts";
import { unitIconUrl } from "./uniticons.ts";

export interface ZoneOptions {
  /** Largeur disponible, px. */
  width: number;
  /** Ids sélectionnés : rectangle(s) de sélection (§11.3). */
  selected: ReadonlySet<number>;
  /** Ids du rectangle de survol (sélection pas encore faite). */
  preview?: ReadonlySet<number>;
  /**
   * Sans assez de place sur une ligne : piles posées sur plusieurs lignes (un type n'est jamais coupé) au lieu du mode
   * « trop de pions ». La zone grandit alors vers le bas (`ZoneLayout.height`). Réserve nationale de l'onglet des forces.
   */
  wrap?: boolean;
  /**
   * Mode « trop de pions » : les types (icône et nombre) qui ne tiennent pas sur une ligne passent à la ligne suivante, au lieu de
   * dépasser à droite ; la zone grandit alors vers le bas (`ZoneLayout.height`). Boîtes de percée de la fenêtre d'un front.
   */
  multiline?: boolean;
}

/** Un pion visible et cliquable, en px dans le conteneur. */
export interface PawnBox {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoneLayout {
  /** Un tableau d'ids par type (ordre des types de la configuration), dans l'ordre de la pile (§11.3). */
  groups: number[][];
  /**
   * Pions visibles et cliquables, dans l'ordre de `groups` aplati. Dans une pile, la boîte d'un
   * pion en dessous est la partie qui dépasse (sans tenir compte de la sélection, qui remonte
   * les pions sélectionnés). En mode « trop de pions » : seulement le pion du dessus de chaque type.
   */
  boxes: PawnBox[];
  /** Hauteur de la zone au repos, px (plusieurs lignes avec `ZoneOptions.wrap`). */
  height: number;
  /** Mode retenu. */
  mode: "spaced" | "stacked" | "collapsed";
  /** Décalage des piles (px) en mode `stacked`, sinon 0. */
  offset: number;
  /**
   * Mode « trop de pions » seulement : le rectangle élargi qui apparaît au survol (même origine
   * que le conteneur, pions côte à côte, une ligne ou plus par type). Ses `boxes` sont celles
   * des pions affichés alors.
   */
  expanded?: { width: number; height: number; boxes: PawnBox[] };
}

// Dimensions (§11.3), en px.
const PAWN = 32;
const BAR_GAP = 1;
const BAR_W = 4;
const BAR_FILL = 30;
const GAP_PAWN = 3;
const GAP_TYPE = 16;
const NUM_GAP = 4;
const NUM_DIGIT = 12; // largeur réservée par chiffre du nombre (police de 20 px)
/** Place du « + » qui suit une pile tronquée (même police que le nombre). */
const PLUS_W = NUM_GAP + NUM_DIGIT;
const OFFSETS = [20, 16, 12, 8];
const SEL_MARGIN = 3;
const SEL_HEIGHT = 48;
const ROW_H = SEL_HEIGHT + 2; // le rectangle ne touche pas le bord de la rangée
const PAWN_Y = (ROW_H - PAWN) / 2;
/** Marge à gauche et à droite : le rectangle de sélection dépasse du premier / dernier pion de 3 px. */
const INSET = SEL_MARGIN + 1;
/** Largeur du rectangle élargi au survol, en multiple de la largeur de la zone. */
const EXPAND = 1.5;

/** Rang du pion : pas encore dans les règles (§16), donc 0 : rien n'est dessiné. */
const rankOf = (_d: DivisionView): number => 0;

const isGrey = (d: DivisionView): boolean => d.status !== "ready";

const typeKey = (d: DivisionView, military: MilitaryCatalog): number =>
  military.divisions[d.type]?.index ?? d.type;

/**
 * Ordre des pions : par type (ordre de la configuration), puis dans la pile (§11.3) : les
 * divisions sans horloge ni drapeau par état décroissant, puis celles avec, par état décroissant.
 */
export function pawnOrder(divisions: readonly DivisionView[], military: MilitaryCatalog): DivisionView[] {
  return divisions
    .slice()
    .sort(
      (a, b) =>
        typeKey(a, military) - typeKey(b, military) ||
        Number(isGrey(a)) - Number(isGrey(b)) ||
        b.state - a.state ||
        a.id - b.id,
    );
}

interface Placed {
  d: DivisionView;
  w: number;
  x: number;
  line: number;
  /** Hauteur dans la pile : le dessus a la plus grande. */
  depth: number;
}

interface Run {
  l: number;
  r: number;
  line: number;
}

const widthOf = (d: DivisionView, scale: number): number => PAWN + (d.state < scale ? BAR_GAP + BAR_W : 0);

const sum = (a: readonly number[]): number => {
  let s = 0;
  for (const v of a) s += v;
  return s;
};
const total = (parts: readonly number[]): number => sum(parts) + GAP_TYPE * Math.max(0, parts.length - 1);
const stackExtent = (ws: readonly number[], offset: number): number => {
  let m = 0;
  for (let k = 0; k < ws.length; k++) m = Math.max(m, k * offset + ws[k]!);
  return m;
};
const numWidth = (n: number): number => String(n).length * NUM_DIGIT;

/** Rectangles de sélection : une suite de pions en surbrillance, contigus dans l'ordre, sur une même ligne. */
function runsOf(placed: readonly Placed[], hl: ReadonlySet<number>, breakEach: boolean): Run[] {
  const out: Run[] = [];
  let cur: Run | null = null;
  for (const p of placed) {
    if (hl.has(p.d.id)) {
      if (cur !== null && cur.line === p.line && !breakEach) {
        cur.l = Math.min(cur.l, p.x);
        cur.r = Math.max(cur.r, p.x + p.w);
      } else {
        if (cur !== null) out.push(cur);
        cur = { l: p.x, r: p.x + p.w, line: p.line };
      }
    } else if (cur !== null) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

function pawnHtml(p: Placed, scale: number, lifted: boolean, military: MilitaryCatalog): string {
  const d = p.d;
  const info = military.divisions[d.type];
  const src = info === undefined ? "" : unitIconUrl(info.icon, d.owner);
  const y = PAWN_Y + p.line * ROW_H;
  const z = (lifted ? 1000 : 10) + p.depth;
  let h =
    `<div class="pz-pawn${isGrey(d) ? " pz-grey" : ""}${d.leaveTick !== 0 ? " pz-leaving" : ""}" data-id="${d.id}" ` +
    `style="left:${p.x}px;top:${y}px;width:${p.w}px;z-index:${z}">` +
    `<img class="pz-icon" src="${src}" alt="" draggable="false">`;
  const rank = rankOf(d);
  if (rank > 0) h += `<img class="pz-rank" src="icons/ranks/icon-rank-${rank}.png" alt="" draggable="false">`;
  if (d.status === "formation" || d.status === "moving") {
    h += `<img class="pz-status" src="icons/miscellaneous/icon-clock.png" alt="" draggable="false">`;
  } else if (d.status === "fleeing") {
    h += `<img class="pz-status" src="icons/miscellaneous/icon-white-flag.png" alt="" draggable="false">`;
  } else if (defendsBreakthrough(d)) {
    h += `<img class="pz-status" src="icons/miscellaneous/icon-shield.png" alt="" draggable="false">`;
  }
  if (d.state < scale) {
    const state = Math.max(0, d.state);
    const fill = Math.round((BAR_FILL * state) / scale);
    const hue = Math.round((120 * state) / scale);
    h += `<div class="pz-bar"><div class="pz-fill" style="height:${fill}px;background:hsl(${hue},75%,45%)"></div></div>`;
  }
  return h + "</div>";
}

function selHtml(runs: readonly Run[]): string {
  let h = "";
  for (const r of runs) {
    h +=
      `<div class="pz-sel" style="left:${r.l - SEL_MARGIN}px;top:${r.line * ROW_H + 1}px;` +
      `width:${r.r - r.l + 2 * SEL_MARGIN}px;height:${SEL_HEIGHT}px"></div>`;
  }
  return h;
}

function boxOf(p: Placed, x: number, width: number): PawnBox {
  return { id: p.d.id, x, y: PAWN_Y + p.line * ROW_H, width, height: PAWN };
}

/**
 * Remplace le contenu de `container` par les pions de `divisions` (d'une même zone), dans le mode
 * qui rentre dans `options.width` : espacé, puis piles (décalage 20, 16, 12 ou 8 px), puis une
 * icône par type avec le nombre (le rectangle s'élargit alors au survol, grâce à `:hover`).
 */
export function renderZone(
  container: HTMLElement,
  divisions: readonly DivisionView[],
  military: MilitaryCatalog,
  options: ZoneOptions,
): ZoneLayout {
  const scale = military.stateScale;
  const wrapOn = options.wrap === true;
  const nicheOfType = (d: DivisionView): string => military.divisions[d.type]?.niche ?? "";
  const ordered = pawnOrder(divisions, military);
  // Réserve : les types d'une même niche se suivent (tri stable : l'ordre des types est gardé dans une niche).
  if (wrapOn) {
    const nicheRank = (d: DivisionView): number => military.niches.findIndex((n) => n.id === nicheOfType(d));
    ordered.sort((a, b) => nicheRank(a) - nicheRank(b));
  }
  const groupsD: DivisionView[][] = [];
  for (const d of ordered) {
    const last = groupsD[groupsD.length - 1];
    if (last !== undefined && last[0]!.type === d.type) last.push(d);
    else groupsD.push([d]);
  }
  const widths = groupsD.map((g) => g.map((d) => widthOf(d, scale)));
  const usable = options.width - 2 * INSET;

  const hl = new Set<number>(options.selected);
  if (options.preview !== undefined) for (const id of options.preview) hl.add(id);

  const spacedW = total(widths.map((ws) => sum(ws) + GAP_PAWN * (ws.length - 1)));
  // Avec `wrap` : les groupes d'une même niche forment un bloc, posé sur une seule ligne si possible.
  const units: number[][] = [];
  if (wrapOn) {
    groupsD.forEach((g, gi) => {
      const last = units[units.length - 1];
      if (last !== undefined && nicheOfType(groupsD[last[0]!]![0]!) === nicheOfType(g[0]!)) last.push(gi);
      else units.push([gi]);
    });
  }
  const unitExtent = (u: readonly number[], o: number): number => total(u.map((gi) => stackExtent(widths[gi]!, o)));
  const wrapped = wrapOn && spacedW > usable;
  let mode: ZoneLayout["mode"] = "spaced";
  let offset = 0;
  if (wrapped) {
    mode = "stacked";
    // Le plus grand décalage qui fait tenir chaque niche sur une ligne ; sinon le plus petit.
    offset = OFFSETS.find((o) => units.every((u) => unitExtent(u, o) <= usable)) ?? OFFSETS[OFFSETS.length - 1]!;
  } else if (spacedW > usable) {
    mode = "collapsed";
    for (const o of OFFSETS) {
      if (total(widths.map((ws) => stackExtent(ws, o))) <= usable) {
        mode = "stacked";
        offset = o;
        break;
      }
    }
  }

  // Positions au repos.
  let line = 0;
  const placed: Placed[] = [];
  const boxes: PawnBox[] = [];
  const restHtmlParts: string[] = [];
  const tags: { x: number; line: number; text: string }[] = [];
  let x = INSET;
  /** Pose les `n` premiers pions du groupe en pile à partir de `x`, sur la ligne courante ; rend l'étendue de la pile. */
  const placeStack = (g: readonly DivisionView[], ws: readonly number[], n: number): number => {
    let covered = 0; // bord droit le plus à droite des pions au-dessus
    for (let k = 0; k < n; k++) {
      const px = x + k * offset;
      const p: Placed = { d: g[k]!, w: ws[k]!, x: px, line, depth: g.length - k };
      placed.push(p);
      const from = Math.max(px, covered);
      if (px + p.w > from) boxes.push(boxOf(p, from, px + p.w - from));
      covered = Math.max(covered, px + p.w);
    }
    return stackExtent(ws.slice(0, n), offset);
  };
  if (wrapped) {
    const right = options.width - INSET;
    for (const u of units) {
      if (x > INSET && x + unitExtent(u, offset) > right) {
        line++;
        x = INSET;
      }
      for (const gi of u) {
        const g = groupsD[gi]!;
        const ws = widths[gi]!;
        // Niche trop large pour une ligne : ses types passent à la ligne, un type n'est jamais coupé...
        if (x > INSET && x + stackExtent(ws, offset) > right) {
          line++;
          x = INSET;
        }
        // ... sauf s'il ne tient pas seul : les premiers pions, puis un « + ».
        let n = g.length;
        if (stackExtent(ws, offset) > right - x) {
          n = 1;
          while (n < g.length && stackExtent(ws.slice(0, n + 1), offset) + PLUS_W <= right - x) n++;
        }
        const extent = placeStack(g, ws, n);
        x += extent;
        if (n < g.length) {
          tags.push({ x: x + NUM_GAP, line, text: "+" });
          x += PLUS_W;
        }
        x += GAP_TYPE;
      }
    }
  } else {
    groupsD.forEach((g, gi) => {
      const ws = widths[gi]!;
      if (mode === "spaced") {
        g.forEach((d, k) => {
          placed.push({ d, w: ws[k]!, x, line: 0, depth: g.length - k });
          x += ws[k]! + GAP_PAWN;
        });
        x += GAP_TYPE - GAP_PAWN;
      } else if (mode === "stacked") {
        x += placeStack(g, ws, g.length) + GAP_TYPE;
      } else {
        if (options.multiline === true && x > INSET && x + ws[0]! + NUM_GAP + numWidth(g.length) > options.width - INSET) {
          line++;
          x = INSET;
        }
        const p: Placed = { d: g[0]!, w: ws[0]!, x, line, depth: 1 };
        placed.push(p);
        tags.push({ x: x + p.w + NUM_GAP, line, text: String(g.length) });
        x += p.w + NUM_GAP + numWidth(g.length) + GAP_TYPE;
      }
    });
  }
  const restWidth = Math.max(0, x - GAP_TYPE) + INSET;
  if (mode !== "stacked") for (const p of placed) boxes.push(boxOf(p, p.x, p.w));

  const lifted = (p: Placed): boolean => hl.has(p.d.id);
  restHtmlParts.push(selHtml(runsOf(placed, hl, mode === "collapsed")));
  for (const p of placed) restHtmlParts.push(pawnHtml(p, scale, lifted(p), military));
  tags.forEach((t) => restHtmlParts.push(`<div class="pz-num" style="left:${t.x}px;top:${PAWN_Y + t.line * ROW_H}px">${t.text}</div>`));

  const layout: ZoneLayout = {
    groups: groupsD.map((g) => g.map((d) => d.id)),
    boxes,
    height: (line + 1) * ROW_H,
    mode,
    offset,
  };
  const rest = restHtmlParts.join("");

  let inner: string;
  if (mode === "collapsed") {
    // Rectangle élargi : un type par ligne, à la ligne quand il n'y a plus de place.
    const expW = Math.max(Math.round(options.width * EXPAND), restWidth);
    const lineW = expW - 2 * INSET;
    const open: Placed[] = [];
    const obox: PawnBox[] = [];
    let line = 0;
    groupsD.forEach((g, gi) => {
      let px = INSET;
      g.forEach((d, k) => {
        const w = widths[gi]![k]!;
        if (px > INSET && px - INSET + w > lineW) {
          line++;
          px = INSET;
        }
        const p: Placed = { d, w, x: px, line, depth: g.length - k };
        open.push(p);
        obox.push(boxOf(p, px, w));
        px += w + GAP_PAWN;
      });
      line++;
    });
    const expH = Math.max(1, line) * ROW_H;
    layout.expanded = { width: expW, height: expH, boxes: obox };
    inner =
      `<div class="pz-rest">${rest}</div>` +
      `<div class="pz-open" style="width:${expW}px;height:${expH}px">${selHtml(runsOf(open, hl, false))}` +
      open.map((p) => pawnHtml(p, scale, lifted(p), military)).join("") +
      `</div>`;
  } else {
    inner = rest;
  }

  // Le rectangle élargi n'est ouvert que par `:hover`, et le redessin (survol d'un autre pion, tour suivant) remplace le DOM sous la
  // souris : hors du rectangle de base, le nouveau DOM n'est plus survolé et le rectangle se refermait. `pz-keep` le garde ouvert
  // jusqu'à ce que la souris quitte le conteneur (rectangle élargi compris).
  const keep = mode === "collapsed" && container.querySelector(".pz-collapsed:hover, .pz-collapsed.pz-keep") !== null;
  container.innerHTML =
    `<div class="pz-root pz-${mode}${keep ? " pz-keep" : ""}" style="width:${options.width}px;height:${layout.height}px">${inner}</div>`;
  if (container.dataset.pzLeave === undefined) {
    container.dataset.pzLeave = "1";
    container.addEventListener("pointerleave", () => container.querySelector(".pz-keep")?.classList.remove("pz-keep"));
  }
  return layout;
}
