// Divisions hors du combat (Docs/Design/05-Fronts.md §4, §5.3, §5.4 ; 08-Population.md §8) :
// déplacement, arrivées, rangement des lignes, échange, fuite, divisions détruites. Tout est en entiers ; divisions
// parcourues par identifiant, fronts par identifiant, niches dans l'ordre de `NICHES` (règle 2 du CLAUDE.md).

import { FRONTS } from "./config.ts";
import { woundPawn } from "./activities.ts";
import {
  DIVISION_DATA,
  INFANTRY_NICHE,
  LINE_BOX,
  LINE_FIRST,
  LINE_RAPID,
  LINE_SECOND,
  NICHE_TYPES,
  STATE_SCALE,
  byChoice,
  currentTurn,
  dataOf,
  inFormation,
  isEmpty,
  isFleeing,
  isMoving,
  stateOf,
  type Division,
} from "./divisions.ts";
import { frontById, frontWidth, inCombat, sideIndex, type Front } from "./fronts.ts";
import type { GameState } from "./state.ts";

/** Délai d'un déplacement, en tours (05-Fronts §4.4). */
const transferTurns = (): number => FRONTS.transferRounds * FRONTS.combatTurns;

// ---- ordres (05-Fronts §5.2) ----

function ownDivision(state: GameState, player: number, id: unknown): Division | undefined {
  if (!Number.isInteger(id)) return undefined;
  const d = state.divisions.find((x) => x.id === id);
  return d !== undefined && d.owner === player ? d : undefined;
}

const LINES: Readonly<Record<string, number>> = { first: LINE_FIRST, second: LINE_SECOND, rapid: LINE_RAPID, box: LINE_BOX };

/**
 * `move_division` (05-Fronts §4.4, §4.6, §5.2) : destination réserve nationale (`front` 0), ou front + ligne
 * (`"first"`, `"second"`, `"rapid"`, `"box"` ; absente : seconde ligne). Pour `"box"`, `box` est une boîte du joueur
 * sur ce front, ou 0 (ou absent) pour une nouvelle boîte, créée seulement si une division y va. Chaque division doit
 * être au joueur, hors formation et hors percée ; le joueur doit être un camp du front. Provisoire : les divisions
 * invalides de la liste sont ignorées, les autres déplacées. Sur le même front (ou vers la destination d'un
 * déplacement en cours) ou vers la réserve, sans délai ; sinon `transferRounds` rounds. Valide si au moins une division est déplacée.
 */
export function moveDivisions(state: GameState, player: number, ids: unknown, frontId: unknown, line: unknown, box?: unknown): boolean {
  if (!Array.isArray(ids) || !Number.isInteger(frontId)) return false;
  if (line !== undefined && (typeof line !== "string" || !(line in LINES))) return false;
  const dest = frontId as number;
  if (dest !== 0) {
    const front = frontById(state, dest);
    if (front === undefined || sideIndex(front, player) < 0) return false;
  }
  const toLine = dest === 0 || line === undefined ? LINE_SECOND : LINES[line as string]!;
  let boxId = 0;
  if (toLine === LINE_BOX && box !== undefined && box !== 0) {
    if (!Number.isInteger(box)) return false;
    const b = state.boxes.find((x) => x.id === box);
    if (b === undefined || b.owner !== player || b.front !== dest) return false;
    boxId = b.id;
  }
  const turn = currentTurn(state);
  let moved = false;
  const seen = new Set<number>();
  for (const id of ids) {
    const d = ownDivision(state, player, id);
    if (d === undefined || seen.has(d.id) || inFormation(state, d) || d.breakthrough !== 0) continue;
    seen.add(d.id);
    const sameFront = d.front === dest;
    if (sameFront && dest === 0) continue;
    if (toLine === LINE_BOX && boxId === 0) {
      boxId = state.nextBoxId++;
      state.boxes.push({ id: boxId, front: dest, owner: player });
    }
    if (!sameFront) {
      d.front = dest;
      // Retour à la réserve : sans délai (le délai est payé à la réaffectation vers un front).
      d.arrivalTick = dest === 0 ? 0 : turn + transferTurns();
    }
    // Sur le même front, ou vers la destination d'un déplacement en cours : sans nouveau délai (provisoire) ; le
    // rangement des lignes décide de la place en première et seconde ligne.
    d.line = toLine;
    d.box = toLine === LINE_BOX ? boxId : 0;
    if (toLine !== LINE_FIRST) d.engaged = 0;
    moved = true;
  }
  return moved;
}

// ---- arrivées, divisions détruites, lignes (05-Fronts §4.2, §4.4) ----

/** Divisions arrivées à destination à ce tour. */
export function applyArrivals(state: GameState): void {
  const turn = currentTurn(state);
  for (const d of state.divisions) if (d.arrivalTick !== 0 && d.arrivalTick <= turn) d.arrivalTick = 0;
}

/**
 * Divisions détruites (barre de vie à 0, 08 §5, provisoire) retirées de l'état. Seules les divisions de `hit`, celles qui
 * viennent de subir des pertes, peuvent l'être. Une division d'infanterie détruite fait passer un bonhomme de sa caserne
 * à Blessés, et un inactif remplit la place s'il y en a un (08 §8) ; chars et appui-feu : aucun blessé, la division se
 * reforme tant que la limite le permet.
 */
export function removeDestroyed(state: GameState, hit: readonly Division[]): void {
  const dead = hit.filter(isEmpty);
  if (dead.length === 0) return;
  const gone = new Set(dead.map((d) => d.id));
  state.divisions = state.divisions.filter((d) => !gone.has(d.id));
  for (const d of dead) {
    if (DIVISION_DATA[d.type]!.niche === INFANTRY_NICHE) woundPawn(state.players[d.owner - 1]!, d.type);
  }
}

/** Divisions d'un camp d'un front, sur place (pas en déplacement), par identifiant croissant. */
export function sideDivisions(state: GameState, front: Front, player: number): Division[] {
  return state.divisions.filter((d) => d.front === front.id && d.owner === player && !isMoving(d));
}

/**
 * Rangement des lignes d'un camp (05-Fronts §4.2), niche par niche, chaque niche
 * avec une première ligne de la largeur du front :
 * 1. les divisions déjà en première ligne gardent leur place, dans l'ordre de choix,
 *    tant qu'il reste de la largeur ; la dernière peut n'être engagée qu'en partie ;
 * 2. la place restante est remplie par les divisions disponibles de la seconde
 *    ligne (ni en fuite, ni en déplacement), dans l'ordre de choix ;
 * 3. appui-feu sans infanterie engagée : il repasse en seconde ligne.
 * Une division abîmée tient toute sa largeur.
 */
export function arrangeSide(state: GameState, front: Front, player: number): void {
  const width = frontWidth(front);
  // Seulement les deux lignes : la réaction rapide et les boîtes de percée n'en font pas partie (05-Fronts §4.6).
  const divs = sideDivisions(state, front, player).filter((d) => d.line === LINE_FIRST || d.line === LINE_SECOND);
  let infantry = 0;
  NICHE_TYPES.forEach((types, n) => {
    const niche = divs.filter((d) => types.includes(d.type));
    for (const d of niche) {
      if (d.line === LINE_FIRST && isFleeing(state, d)) d.line = LINE_SECOND;
      if (d.line === LINE_SECOND) d.engaged = 0;
    }
    if (niche.length === 0) return;
    if (DIVISION_DATA[types[0]!]!.support && infantry === 0) {
      for (const d of niche) {
        d.line = LINE_SECOND;
        d.engaged = 0;
      }
      return;
    }
    let room = width;
    const place = (d: Division): void => {
      const take = Math.min(room, dataOf(d).width);
      if (take <= 0) {
        d.line = LINE_SECOND;
        d.engaged = 0;
        return;
      }
      d.line = LINE_FIRST;
      d.engaged = take;
      room -= take;
    };
    for (const d of niche.filter((x) => x.line === LINE_FIRST).sort(byChoice)) place(d);
    // Une division de seconde ligne engagée dans une force de contre-attaque (05-Fronts §7.2) n'y est pas prise.
    for (const d of niche.filter((x) => x.line === LINE_SECOND && !isFleeing(state, x) && x.breakthrough === 0).sort(byChoice)) {
      if (room <= 0) break;
      place(d);
    }
    if (n === INFANTRY_NICHE) for (const d of niche) infantry += d.engaged;
  });
}

/** Rangement des lignes de tous les fronts (05-Fronts §4.2, provisoire : à chaque tour). Divisions de la réserve : seconde ligne ; en déplacement : rien d'engagé. */
export function arrangeAll(state: GameState): void {
  for (const d of state.divisions) {
    // En déplacement, la ligne demandée est gardée pour l'arrivée ; rien n'est engagé.
    if (d.front === 0) {
      d.line = LINE_SECOND;
      d.box = 0;
    }
    if (d.front === 0 || isMoving(d)) d.engaged = 0;
  }
  for (const f of state.fronts) for (const p of f.players) arrangeSide(state, f, p);
}

/**
 * Échange hors combat (05-Fronts §5.3) : à chaque tour, sur les fronts qui ne sont pas en combat (ceux qui le sont
 * échangent à la fin de chaque round, `applySwaps`), puis rangement des lignes.
 */
export function swapAtRest(state: GameState): void {
  for (const front of state.fronts) {
    if (inCombat(state, front)) continue;
    applySwaps(state, front);
    for (const p of front.players) arrangeSide(state, front, p);
  }
}

/**
 * Fuite (05-Fronts §5.4) : une division de première ligne dont l'état tombe à
 * `fleeStatePercent` ou moins repasse en seconde ligne, et ne peut pas revenir en
 * première ligne pendant `fleeRounds` rounds.
 */
export function applyFlight(state: GameState, front: Front): void {
  const until = currentTurn(state) + FRONTS.fleeRounds * FRONTS.combatTurns;
  for (const d of state.divisions) {
    if (d.front !== front.id || d.line !== LINE_FIRST || isMoving(d)) continue;
    if (stateOf(d) * 100 > FRONTS.fleeStatePercent * STATE_SCALE) continue;
    d.line = LINE_SECOND;
    d.engaged = 0;
    // Une division de la tranche d'une percée la quitte (05-Fronts §7.2).
    d.breakthrough = 0;
    d.btEngaged = 0;
    d.fleeUntilTick = until;
  }
}

/**
 * Échange avec la seconde ligne (05-Fronts §5.3) : une division de première ligne
 * dont l'état est inférieur à `swapStatePercent` % de celui d'une division
 * disponible de la seconde ligne de la même niche échange sa place avec la
 * meilleure d'entre elles (ordre de choix). Divisions de première ligne par
 * identifiant ; chaque division de seconde ligne n'est prise qu'une fois.
 * Hors combat (front qui n'est pas `inCombat`), d'abord : une division de première
 * ligne est remplacée par la division de seconde ligne de plus grand état parmi
 * celles du même type ou d'un type prioritaire (rang de la niche, `byChoice`) dont
 * l'état est supérieur au sien ; sinon la règle des `swapStatePercent` s'applique.
 */
export function applySwaps(state: GameState, front: Front): void {
  const rest = !inCombat(state, front);
  for (const player of front.players) {
    const divs = sideDivisions(state, front, player);
    for (const types of NICHE_TYPES) {
      const niche = divs.filter((d) => types.includes(d.type));
      // Les divisions engagées dans une percée n'échangent pas (provisoire).
      const reserve = niche.filter((d) => d.line === LINE_SECOND && !isFleeing(state, d) && d.breakthrough === 0).sort(byChoice);
      for (const d of niche) {
        if (d.line !== LINE_FIRST || d.breakthrough !== 0 || reserve.length === 0) continue;
        // `reserve` est triée par état décroissant : le premier qui convient est celui de plus grand état.
        let k = rest ? reserve.findIndex((x) => dataOf(x).rank <= dataOf(d).rank && stateOf(x) > stateOf(d)) : -1;
        if (k < 0) {
          if (stateOf(d) * 100 >= FRONTS.swapStatePercent * stateOf(reserve[0]!)) continue;
          k = 0;
        }
        const best = reserve.splice(k, 1)[0]!;
        best.line = LINE_FIRST;
        best.engaged = d.engaged;
        d.line = LINE_SECOND;
        d.engaged = 0;
      }
    }
  }
}
