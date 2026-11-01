// Divisions hors du combat (Docs/Design/05-Fronts.md §3.5, §4, §5.3, §5.4) :
// création, suppression, déplacement, renfort, arrivées, rangement des lignes,
// échange et fuite. Tout est en entiers ; divisions parcourues par identifiant,
// fronts par identifiant, niches dans l'ordre de `NICHES` (règle 2 du CLAUDE.md).

import { FRONTS } from "./config.ts";
import {
  DIVISION_DATA,
  DIVISION_IDS,
  INFANTRY_NICHE,
  LINE_BOX,
  LINE_FIRST,
  LINE_RAPID,
  LINE_SECOND,
  MEN,
  NICHE_TYPES,
  STATE_SCALE,
  byChoice,
  countSoldiers,
  currentTurn,
  dataOf,
  eliteAllowed,
  emptyDivision,
  inFormation,
  isDivisionId,
  isEmpty,
  isFleeing,
  isMoving,
  nicheCounts,
  stateOf,
  trimExcess,
  type Division,
} from "./divisions.ts";
import { frontById, frontWidth, inCombat, sideIndex, type Front } from "./fronts.ts";
import type { GameState, Player } from "./state.ts";

/** Délai d'un déplacement, en tours (05-Fronts §4.4). */
const transferTurns = (): number => FRONTS.transferRounds * FRONTS.combatTurns;

// ---- ordres (05-Fronts §3.5, §5.2) ----

/**
 * `create_division` (05-Fronts §3.5) : valide seulement si le stock d'armement et
 * les inactifs suffisent à remplir ses composants requis. Les composants optionnels
 * partent de 0 et arrivent par le renfort (§4.3). Les hommes ne sont pris que parmi
 * les inactifs, même en mobilisation forcée (provisoire). La division apparaît
 * aussitôt dans la réserve nationale, en formation.
 */
export function createDivision(state: GameState, player: number, type: unknown): boolean {
  if (!isDivisionId(type)) return false;
  const p = state.players[player - 1]!;
  const data = DIVISION_DATA[DIVISION_IDS.indexOf(type)]!;
  const { elites, total } = nicheCounts(state, player, data);
  if (!eliteAllowed(data, elites, total)) return false;
  const required = data.components.filter((c) => c.required);
  for (const c of required) {
    const has = c.resource === MEN ? p.idle : p.armamentReserve[c.resource]!;
    if (has < c.count) return false;
  }
  for (const c of required) {
    if (c.resource === MEN) p.idle -= c.count;
    else p.armamentReserve[c.resource] = p.armamentReserve[c.resource]! - c.count;
  }
  const turn = currentTurn(state);
  state.divisions.push({
    id: state.nextDivisionId++,
    owner: player,
    type: data.index,
    counts: data.components.map((c) => (c.required ? c.count : 0)),
    front: 0,
    line: LINE_SECOND,
    box: 0,
    breakthrough: 0,
    btEngaged: 0,
    engaged: 0,
    arrivalTick: 0,
    formedTick: turn + data.formationTurns,
    fleeUntilTick: 0,
  });
  p.soldiers += data.menComponent < 0 ? 0 : data.components[data.menComponent]!.count;
  return true;
}

function ownDivision(state: GameState, player: number, id: unknown): Division | undefined {
  if (!Number.isInteger(id)) return undefined;
  const d = state.divisions.find((x) => x.id === id);
  return d !== undefined && d.owner === player ? d : undefined;
}

/**
 * `delete_division` (05-Fronts §3.5) : une division de la réserve nationale, ni en
 * déplacement ni en formation (provisoire). Hommes et équipement rendus sans délai.
 */
export function deleteDivision(state: GameState, player: number, id: unknown): boolean {
  const d = ownDivision(state, player, id);
  if (d === undefined || d.front !== 0 || isMoving(d) || inFormation(state, d)) return false;
  const p = state.players[player - 1]!;
  p.soldiers -= dataOf(d).menComponent < 0 ? 0 : d.counts[dataOf(d).menComponent]!;
  emptyDivision(p, d);
  state.divisions = state.divisions.filter((x) => x !== d);
  return true;
}

const LINES: Readonly<Record<string, number>> = { first: LINE_FIRST, second: LINE_SECOND, rapid: LINE_RAPID, box: LINE_BOX };

/**
 * `move_division` (05-Fronts §4.4, §4.6, §5.2) : destination réserve nationale (`front` 0), ou front + ligne
 * (`"first"`, `"second"`, `"rapid"`, `"box"` ; absente : seconde ligne). Pour `"box"`, `box` est une boîte du joueur
 * sur ce front, ou 0 (ou absent) pour une nouvelle boîte, créée seulement si une division y va. Chaque division doit
 * être au joueur, hors formation et hors percée ; le joueur doit être un camp du front. Provisoire : les divisions
 * invalides de la liste sont ignorées, les autres déplacées. Sur le même front (ou vers la destination d'un
 * déplacement en cours), sans délai ; sinon `transferRounds` rounds. Valide si au moins une division est déplacée.
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
      d.arrivalTick = turn + transferTurns();
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

export function setForcedMobilization(state: GameState, player: number, enabled: unknown): boolean {
  if (typeof enabled !== "boolean") return false;
  state.players[player - 1]!.forcedMobilization = enabled;
  return true;
}

// ---- renfort (05-Fronts §4.3) ----

/**
 * Partage `stock` entre des besoins (05-Fronts §4.3, provisoire) : part égale
 * plafonnée au besoin de chacun, le surplus repartagé entre ceux qui en manquent
 * encore ; parties entières, une unité de plus aux premiers de la liste (plus
 * petits identifiants) pour le reste. Renvoie ce que chacun reçoit.
 */
export function shareEqually(stock: number, needs: readonly number[]): number[] {
  const out = needs.map(() => 0);
  let left = stock;
  let open = needs.map((_, i) => i).filter((i) => needs[i]! > 0);
  while (left > 0 && open.length > 0) {
    const share = Math.floor(left / open.length);
    if (share === 0) {
      for (let k = 0; k < left; k++) out[open[k]!] = out[open[k]!]! + 1;
      break;
    }
    for (const i of open) {
      const give = Math.min(share, needs[i]! - out[i]!);
      out[i] = out[i]! + give;
      left -= give;
    }
    open = open.filter((i) => out[i]! < needs[i]!);
  }
  return out;
}

/**
 * Une division peut-elle recevoir du renfort ? Ni en déplacement, ni en fuite, ni engagée dans une percée, ni en
 * première ligne d'un front en combat (05-Fronts §4.3, §4.6).
 */
function reinforceable(state: GameState, d: Division, fighting: ReadonlySet<number>): boolean {
  if (isMoving(d) || isFleeing(state, d) || d.breakthrough !== 0) return false;
  return !(d.front !== 0 && d.line === LINE_FIRST && fighting.has(d.front));
}

/**
 * Renfort des divisions de `player` (05-Fronts §4.3) : ressource par ressource,
 * le stock est partagé à parts égales entre les divisions qui en ont besoin. Les
 * hommes viennent de `men` (inactifs, ou toute la population hors soldats en
 * mobilisation forcée). L'excédent créé retourne au stock (§3.2). Renvoie les
 * hommes ajoutés aux divisions, net de l'excédent rendu.
 */
function reinforcePlayer(state: GameState, p: Player, men: number, fighting: ReadonlySet<number>): number {
  const divs = state.divisions.filter((d) => d.owner === p.id && reinforceable(state, d, fighting));
  if (divs.length === 0) return 0;
  let before = 0;
  for (const d of divs) before += menCount(d);
  const resources = new Set<number>();
  for (const d of divs) for (const c of dataOf(d).components) resources.add(c.resource);
  for (const r of [...resources].sort((a, b) => a - b)) {
    const slots: { d: Division; i: number }[] = [];
    const needs: number[] = [];
    for (const d of divs) {
      dataOf(d).components.forEach((c, i) => {
        if (c.resource !== r) return;
        slots.push({ d, i });
        needs.push(c.count - d.counts[i]!);
      });
    }
    const stock = r === MEN ? men : p.armamentReserve[r]!;
    const given = shareEqually(stock, needs);
    let total = 0;
    slots.forEach((s, k) => {
      s.d.counts[s.i] = s.d.counts[s.i]! + given[k]!;
      total += given[k]!;
    });
    if (r !== MEN) p.armamentReserve[r] = p.armamentReserve[r]! - total;
  }
  for (const d of divs) trimExcess(p, d);
  let after = 0;
  for (const d of divs) after += menCount(d);
  return after - before;
}

function menCount(d: Division): number {
  const k = dataOf(d).menComponent;
  return k < 0 ? 0 : d.counts[k]!;
}

function fightingFronts(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const f of state.fronts) if (inCombat(state, f)) out.add(f.id);
  return out;
}

/** Mobilisation forcée (05-Fronts §4.3) : avant l'économie, les hommes des divisions passent avant les emplois. */
export function reinforceBeforeEconomy(state: GameState): void {
  const fighting = fightingFronts(state);
  for (const p of state.players) {
    if (!p.forcedMobilization) continue;
    reinforcePlayer(state, p, Math.max(0, p.population - p.soldiers), fighting);
    countSoldiers(state);
  }
}

/** Après l'économie : les hommes viennent des inactifs (05-Fronts §4.3). */
export function reinforceAfterEconomy(state: GameState): void {
  const fighting = fightingFronts(state);
  for (const p of state.players) {
    if (p.forcedMobilization) continue;
    const used = reinforcePlayer(state, p, p.idle, fighting);
    p.idle -= Math.max(0, used);
  }
  countSoldiers(state);
}

// ---- arrivées, excédent, lignes (05-Fronts §3.2, §4.2, §4.4) ----

/** Divisions arrivées à destination à ce tour. */
export function applyArrivals(state: GameState): void {
  const turn = currentTurn(state);
  for (const d of state.divisions) if (d.arrivalTick !== 0 && d.arrivalTick <= turn) d.arrivalTick = 0;
}

/** Excédent de toutes les divisions rendu au stock (05-Fronts §3.2, provisoire : sans délai, à chaque tour). */
export function trimAll(state: GameState): void {
  for (const d of state.divisions) trimExcess(state.players[d.owner - 1]!, d);
}

/** Divisions détruites (état 0 %, 05-Fronts §3.3) retirées de l'état. Provisoire : ce qui leur reste est perdu. */
export function removeDestroyed(state: GameState): void {
  if (state.divisions.some(isEmpty)) state.divisions = state.divisions.filter((d) => !isEmpty(d));
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
 */
export function applySwaps(state: GameState, front: Front): void {
  for (const player of front.players) {
    const divs = sideDivisions(state, front, player);
    for (const types of NICHE_TYPES) {
      const niche = divs.filter((d) => types.includes(d.type));
      // Les divisions engagées dans une percée n'échangent pas (provisoire).
      const reserve = niche.filter((d) => d.line === LINE_SECOND && !isFleeing(state, d) && d.breakthrough === 0).sort(byChoice);
      for (const d of niche) {
        if (d.line !== LINE_FIRST || d.breakthrough !== 0 || reserve.length === 0) continue;
        const best = reserve[0]!;
        if (stateOf(d) * 100 >= FRONTS.swapStatePercent * stateOf(best)) continue;
        reserve.shift();
        best.line = LINE_FIRST;
        best.engaged = d.engaged;
        d.line = LINE_SECOND;
        d.engaged = 0;
      }
    }
  }
}
