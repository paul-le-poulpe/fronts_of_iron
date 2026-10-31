// Boîtes de percée et percées (Docs/Design/05-Fronts.md §4.6, §7.2) : état, ordres
// `start_breakthrough` et `cancel_breakthrough`, choix des forces (force qui perce,
// tranche de première ligne, force de contre-attaque), vérifications de fin de round
// (première ligne percée, saut, seconde ligne percée, essoufflement), nettoyage après un
// changement de front. Les dégâts eux-mêmes sont calculés par combat.ts.
//
// Tout est en entiers. Ordre des parcours : percées par identifiant, divisions par
// identifiant ou dans l'ordre de choix, niches dans l'ordre de `NICHES` (règle 2).

import { FRONTS } from "./config.ts";
import {
  DIVISION_DATA,
  INFANTRY_NICHE,
  LINE_BOX,
  LINE_FIRST,
  LINE_RAPID,
  LINE_SECOND,
  NICHE_TYPES,
  STATE_SCALE,
  WIDTH_SCALE,
  byChoice,
  currentTurn,
  dataOf,
  isFleeing,
  isMoving,
  stateOf,
  type Division,
} from "./divisions.ts";
import { ROUTE, endOf, frontById, isActive, sideIndex, type Front } from "./fronts.ts";
import type { GameState } from "./state.ts";

/** Une boîte de percée d'un camp d'un front (05-Fronts §4.6). Ses divisions ont `line = LINE_BOX` et `box = id`. */
export interface Box {
  readonly id: number;
  readonly front: number;
  readonly owner: number;
}

/** Une percée lancée (05-Fronts §7.2). Ses divisions engagées ont `breakthrough = id`. */
export interface Breakthrough {
  readonly id: number;
  /** Front de l'axe ; suit l'identifiant du front quand il change (05-Fronts §2.5). */
  front: number;
  /** Joueur qui perce. */
  readonly owner: number;
  /** Boîte d'où vient la force ; ses divisions y retournent à la fin. */
  readonly box: number;
  /** Axe : la connexion du front. */
  readonly city1: number;
  readonly city2: number;
  /** Tour du lancement ; le combat 1 commence `breakthroughDelayTurns` tours plus tard. */
  readonly launchTick: number;
  /** 0 attente, 1 contre la première ligne, 2 contre la réaction rapide. */
  phase: number;
  /** État moyen de la force au début du combat 1, pondéré par la largeur engagée (échelle `STATE_SCALE`). */
  startState: number;
}

/** Largeur d'une percée : une liaison (05-Fronts §7.2). */
const BREAKTHROUGH_WIDTH = WIDTH_SCALE;

export const isBreakthroughAttacker = (bt: Breakthrough, d: Division): boolean => d.breakthrough === bt.id && d.owner === bt.owner;
export const isBreakthroughDefender = (bt: Breakthrough, d: Division): boolean => d.breakthrough === bt.id && d.owner !== bt.owner;

/** Divisions engagées dans une percée, d'un camp, par identifiant. */
export function forceOf(state: GameState, bt: Breakthrough, attacker: boolean): Division[] {
  return state.divisions.filter((d) => (attacker ? isBreakthroughAttacker(bt, d) : isBreakthroughDefender(bt, d)));
}

/** Camp du joueur qui perce dans le front (0 ou 1). */
export const attackerSide = (front: Front, bt: Breakthrough): number => sideIndex(front, bt.owner);

/**
 * Remplit une largeur d'une liaison par niche avec des divisions (05-Fronts §7.2) : niche par niche, dans l'ordre
 * donné (déjà rangé), la dernière engagée en partie. `width` : largeur d'une division dans ce combat. Appui-feu sans
 * infanterie engagée : pas engagé (provisoire). Écrit `breakthrough` et `btEngaged`.
 */
function fill(btId: number, candidates: readonly (readonly Division[])[], width: (d: Division) => number): void {
  let infantry = 0;
  NICHE_TYPES.forEach((types, n) => {
    const support = DIVISION_DATA[types[0]!]!.support;
    if (support && infantry === 0) return;
    let room = BREAKTHROUGH_WIDTH;
    for (const d of candidates[n]!) {
      if (room <= 0) break;
      const take = Math.min(room, width(d));
      d.breakthrough = btId;
      d.btEngaged = take;
      room -= take;
      if (n === INFANTRY_NICHE) infantry += take;
    }
  });
}

/** Les candidats d'une liste de divisions, rangés par niche dans l'ordre de choix. */
function byNiche(divs: readonly Division[]): Division[][] {
  return NICHE_TYPES.map((types) => divs.filter((d) => types.includes(d.type)).sort(byChoice));
}

/** Divisions d'une boîte disponibles pour une percée : ni engagées, ni en déplacement, ni en fuite. */
function boxAvailable(state: GameState, box: Box): Division[] {
  return state.divisions.filter(
    (d) => d.front === box.front && d.owner === box.owner && d.line === LINE_BOX && d.box === box.id && d.breakthrough === 0 && !isMoving(d) && !isFleeing(state, d),
  );
}

// ---- ordres (05-Fronts §5.2) ----

/**
 * `start_breakthrough` : la boîte est au joueur sur un front actif, l'axe est une connexion de ce front, et la boîte a
 * au moins une division disponible. La force est prise au lancement : une liaison par niche, en `breakthroughWidth`,
 * dans l'ordre de choix ; le reste reste dans la boîte. Provisoire : une percée par axe et par camp à la fois.
 */
export function startBreakthrough(state: GameState, player: number, boxId: unknown, city1: unknown, city2: unknown): boolean {
  if (!Number.isInteger(boxId) || !Number.isInteger(city1) || !Number.isInteger(city2)) return false;
  const box = state.boxes.find((b) => b.id === boxId);
  if (box === undefined || box.owner !== player) return false;
  const front = frontById(state, box.front);
  if (front === undefined || !isActive(state, front)) return false;
  if (!front.connections.some((c) => c.city1 === city1 && c.city2 === city2)) return false;
  if (state.breakthroughs.some((b) => b.owner === player && b.city1 === city1 && b.city2 === city2)) return false;
  const available = boxAvailable(state, box);
  if (available.length === 0) return false;
  const bt: Breakthrough = {
    id: state.nextBreakthroughId,
    front: front.id,
    owner: player,
    box: box.id,
    city1: city1 as number,
    city2: city2 as number,
    launchTick: currentTurn(state),
    phase: 0,
    startState: 0,
  };
  fill(bt.id, byNiche(available), (d) => dataOf(d).breakthroughWidth);
  if (!state.divisions.some((d) => isBreakthroughAttacker(bt, d))) return false;
  state.nextBreakthroughId++;
  state.breakthroughs.push(bt);
  return true;
}

/** `cancel_breakthrough` (provisoire) : la percée est au joueur. Sa force retourne dans sa boîte. */
export function cancelBreakthrough(state: GameState, player: number, id: unknown): boolean {
  const bt = state.breakthroughs.find((b) => b.id === id);
  if (bt === undefined || bt.owner !== player) return false;
  endBreakthrough(state, bt);
  return true;
}

/** Fin d'une percée (05-Fronts §7.2, point 13) : les divisions engagées sont libérées ; celles de la force sont toujours dans leur boîte. */
export function endBreakthrough(state: GameState, bt: Breakthrough): void {
  state.breakthroughs = state.breakthroughs.filter((b) => b !== bt);
  for (const d of state.divisions) {
    if (d.breakthrough !== bt.id) continue;
    d.breakthrough = 0;
    d.btEngaged = 0;
  }
}

// ---- forces des combats (05-Fronts §7.2, points 5 et 8) ----

/** État moyen d'une force, pondéré par la largeur engagée dans la percée (échelle `STATE_SCALE`). */
export function forceState(divs: readonly Division[]): number {
  let num = 0;
  let den = 0;
  for (const d of divs) {
    num += stateOf(d) * d.btEngaged;
    den += d.btEngaged;
  }
  return den === 0 ? 0 : Math.floor(num / den);
}

/** Largeur d'infanterie engagée dans une percée. */
export function infantryOf(divs: readonly Division[]): number {
  let w = 0;
  for (const d of divs) if (dataOf(d).niche === INFANTRY_NICHE) w += d.btEngaged;
  return w;
}

/**
 * Début du combat 1 : tranche de la première ligne du défenseur, une liaison par niche en `frontWidth`, prise parmi
 * ses divisions engagées en première ligne qui ne sont pas déjà dans une autre percée, dans l'ordre de choix
 * (provisoire). Renvoie false si la force qui perce n'a plus de division.
 */
export function beginCombat1(state: GameState, front: Front, bt: Breakthrough): boolean {
  const force = forceOf(state, bt, true);
  if (force.length === 0) return false;
  bt.phase = 1;
  bt.startState = forceState(force);
  const defender = front.players[1 - attackerSide(front, bt)]!;
  const firstLine = state.divisions.filter(
    (d) => d.front === front.id && d.owner === defender && d.line === LINE_FIRST && d.engaged > 0 && d.breakthrough === 0 && !isMoving(d),
  );
  fill(bt.id, byNiche(firstLine), (d) => dataOf(d).width);
  return true;
}

/**
 * Forces de contre-attaque des percées en combat 2 d'un front (05-Fronts §7.2, point 8), recalculées à chaque round :
 * pour chaque défenseur, sa réaction rapide puis sa seconde ligne (ni en fuite, ni en déplacement, ni dans une autre
 * percée), niche par niche, chacune dans l'ordre de choix, données à tour de rôle aux percées (par identifiant)
 * jusqu'à une liaison chacune, en `breakthroughWidth`. Partage équitable entre plusieurs percées.
 */
export function assignCounterForces(state: GameState, front: Front): void {
  const active = state.breakthroughs.filter((b) => b.front === front.id && b.phase === 2).sort((a, b) => a.id - b.id);
  for (const bt of active) {
    for (const d of state.divisions) {
      if (!isBreakthroughDefender(bt, d)) continue;
      d.breakthrough = 0;
      d.btEngaged = 0;
    }
  }
  for (const defender of front.players) {
    const mine = active.filter((b) => b.owner !== defender);
    if (mine.length === 0) continue;
    const pool = (line: number): Division[] =>
      state.divisions.filter((d) => d.front === front.id && d.owner === defender && d.line === line && d.breakthrough === 0 && !isMoving(d) && !isFleeing(state, d));
    const rapid = byNiche(pool(LINE_RAPID));
    const second = byNiche(pool(LINE_SECOND));
    const infantry = new Map<number, number>(mine.map((b) => [b.id, 0]));
    NICHE_TYPES.forEach((types, n) => {
      const support = DIVISION_DATA[types[0]!]!.support;
      const queue = [...rapid[n]!, ...second[n]!];
      const room = new Map<number, number>(mine.map((b) => [b.id, support && infantry.get(b.id) === 0 ? 0 : BREAKTHROUGH_WIDTH]));
      let k = 0;
      for (const d of queue) {
        const open = mine.filter((b) => room.get(b.id)! > 0);
        if (open.length === 0) break;
        const bt = open[k % open.length]!;
        k++;
        const take = Math.min(room.get(bt.id)!, dataOf(d).breakthroughWidth);
        d.breakthrough = bt.id;
        d.btEngaged = take;
        room.set(bt.id, room.get(bt.id)! - take);
        if (n === INFANTRY_NICHE) infantry.set(bt.id, infantry.get(bt.id)! + take);
      }
    });
  }
}

/**
 * Facteur de réaction à l'échelle 100 (05-Fronts §7.2, point 7), selon la motorisation de la force de contre-attaque :
 * largeur motorisée / largeur de toutes ses divisions des niches principales. 100 % : 100 ; moins de 50 % :
 * `slowReactionFactor` × 100 ; entre les deux, linéaire.
 */
export function reactionFactor100(motor: number, total: number): number {
  const slow = FRONTS.slowReactionFactor * 100;
  if (total === 0) return slow;
  if (motor >= total) return 100;
  if (motor * 2 < total) return slow;
  return slow - Math.floor(((slow - 100) * (2 * motor - total)) / total);
}

/** Motorisation d'une force : largeur engagée des divisions motorisées et de toutes, niches principales seulement (provisoire). */
function motorization(divs: readonly Division[]): { motor: number; total: number } {
  let motor = 0;
  let total = 0;
  for (const d of divs) {
    if (dataOf(d).support) continue;
    total += d.btEngaged;
    if (dataOf(d).motorized) motor += d.btEngaged;
  }
  return { motor, total };
}

/** Vitesse de la force qui perce : motorisée seulement si toute son infanterie l'est (05-Fronts §7.1). */
function speedOf(divs: readonly Division[]): number {
  const infantry = divs.filter((d) => dataOf(d).niche === INFANTRY_NICHE);
  return infantry.length > 0 && infantry.every((d) => dataOf(d).motorized) ? FRONTS.motorizedSpeedPermille : FRONTS.footSpeedPermille;
}

/** Une connexion arrivée au bout de sa route : le camp `x` tient la ville de l'autre bout. */
export interface Arrival {
  readonly x: number;
  readonly city1: number;
  readonly city2: number;
}

/**
 * Fin de round d'une percée en combat (05-Fronts §7.2, points 6, 9, 12) : force vide ou essoufflée, première ligne
 * percée (saut, combat 2), seconde ligne percée (la ville tombe). Ajoute à `arrivals` les connexions arrivées au bout.
 */
export function checkBreakthrough(state: GameState, front: Front, bt: Breakthrough, arrivals: Arrival[]): void {
  const x = attackerSide(front, bt);
  const axis = front.connections.find((c) => c.city1 === bt.city1 && c.city2 === bt.city2);
  const force = forceOf(state, bt, true);
  if (axis === undefined || force.length === 0 || forceState(force) * 100 < FRONTS.breakthroughExhaustionPercent * bt.startState) {
    endBreakthrough(state, bt);
    return;
  }
  const push = (by: number): void => {
    axis.position = Math.min(ROUTE, Math.max(0, axis.position + (x === 0 ? by : -by)));
  };
  if (bt.phase === 1) {
    const slice = forceOf(state, bt, false).filter((d) => d.line === LINE_FIRST);
    if (infantryOf(slice) > 0) return;
    // Première ligne percée : la tranche est libérée, le front saute, le combat 2 commence contre la réaction rapide.
    for (const d of forceOf(state, bt, false)) {
      d.breakthrough = 0;
      d.btEngaged = 0;
    }
    bt.phase = 2;
    assignCounterForces(state, front);
    const counter = forceOf(state, bt, false);
    const { motor, total } = motorization(counter);
    push(Math.floor((2 * FRONTS.breakthroughJumpRounds * speedOf(force) * reactionFactor100(motor, total) + 100) / 200));
    if (axis.position === endOf(x) || infantryOf(counter) === 0) {
      axis.position = endOf(x);
      arrivals.push({ x, city1: bt.city1, city2: bt.city2 });
      endBreakthrough(state, bt);
    }
    return;
  }
  if (bt.phase === 2 && infantryOf(forceOf(state, bt, false)) === 0) {
    axis.position = endOf(x);
    arrivals.push({ x, city1: bt.city1, city2: bt.city2 });
    endBreakthrough(state, bt);
  }
}

/**
 * Fuite dans une percée (05-Fronts §5.4, §7.2 point 11) : une division de la force qui perce ou de la force de
 * contre-attaque qui tombe à `fleeStatePercent` ou moins quitte la percée, en fuite ; celle de la force qui perce reste
 * dans sa boîte. La tranche de première ligne fuit avec la règle de la première ligne (`applyFlight`).
 */
export function breakthroughFlight(state: GameState, front: Front): void {
  const until = currentTurn(state) + FRONTS.fleeRounds * FRONTS.combatTurns;
  for (const d of state.divisions) {
    if (d.front !== front.id || d.breakthrough === 0 || d.line === LINE_FIRST) continue;
    if (stateOf(d) * 100 > FRONTS.fleeStatePercent * STATE_SCALE) continue;
    d.breakthrough = 0;
    d.btEngaged = 0;
    d.fleeUntilTick = until;
  }
}

// ---- boîtes ----

/** Une boîte sans division, ni dans la boîte ni engagée dans une de ses percées, est supprimée (05-Fronts §4.6). */
export function removeEmptyBoxes(state: GameState): void {
  const used = new Set<number>();
  for (const d of state.divisions) if (d.line === LINE_BOX) used.add(d.box);
  for (const bt of state.breakthroughs) used.add(bt.box);
  if (state.boxes.some((b) => !used.has(b.id))) state.boxes = state.boxes.filter((b) => used.has(b.id));
}

/**
 * Après un recalcul des fronts (05-Fronts §2.5, §4.6, provisoire) : une percée suit le front qui contient son axe
 * (mêmes joueurs) et s'arrête si l'axe a disparu ou si sa boîte n'est plus sur ce front ; une boîte dont le front a
 * disparu est supprimée ; une division qui n'est plus sur le front de sa boîte va en seconde ligne ; une division
 * engagée dans une percée d'un autre front est libérée.
 */
export function afterFrontsChanged(state: GameState): void {
  const fronts = new Set(state.fronts.map((f) => f.id));
  state.boxes = state.boxes.filter((b) => fronts.has(b.front));
  for (const bt of [...state.breakthroughs]) {
    const home = state.fronts.find((f) => f.players.includes(bt.owner) && f.connections.some((c) => c.city1 === bt.city1 && c.city2 === bt.city2));
    const box = state.boxes.find((b) => b.id === bt.box);
    if (home === undefined || box === undefined || box.front !== home.id) endBreakthrough(state, bt);
    else bt.front = home.id;
  }
  for (const d of state.divisions) {
    if (d.line === LINE_BOX) {
      const box = state.boxes.find((b) => b.id === d.box);
      if (box === undefined || box.front !== d.front) {
        d.line = LINE_SECOND;
        d.box = 0;
      }
    }
    if (d.breakthrough !== 0) {
      const bt = state.breakthroughs.find((b) => b.id === d.breakthrough);
      if (bt === undefined || bt.front !== d.front) {
        d.breakthrough = 0;
        d.btEngaged = 0;
      }
    }
  }
  removeEmptyBoxes(state);
}

/** Paix (05-Fronts §2.3) : les percées entre les deux joueurs s'arrêtent. */
export function endBreakthroughsBetween(state: GameState, a: number, b: number): void {
  for (const bt of [...state.breakthroughs]) {
    const front = frontById(state, bt.front);
    if (front !== undefined && front.players.includes(a) && front.players.includes(b)) endBreakthrough(state, bt);
  }
}
