// Combat des fronts (Docs/Design/05-Fronts.md §6, §7) : un round tous les
// `FRONTS.combatTurns` tours, sur chaque front actif où au moins un camp attaque.
//
// Les dégâts des deux camps sont calculés sur les divisions du début du round,
// puis appliqués ensemble (provisoire, 05-Fronts §6). Tout est en entiers.
// Ordre des parcours : fronts par identifiant, camps 0 puis 1, divisions par
// identifiant, composants dans l'ordre de `components` (règle 2 du CLAUDE.md).

import { FRONTS } from "./config.ts";
import { captureCity } from "./conquest.ts";
import {
  INFANTRY_NICHE,
  LINE_FIRST,
  LOSS_SCALE,
  MULT_SCALE,
  applyLoss,
  attackOf,
  countSoldiers,
  dataOf,
  type Division,
} from "./divisions.ts";
import { ROUTE, inCombat, isActive, type Front } from "./fronts.ts";
import { applyFlight, applySwaps, arrangeSide, removeDestroyed, sideDivisions, trimAll } from "./placement.ts";
import type { GameState } from "./state.ts";

/**
 * Avancée d'une attaque sur tout le front en un round, en millièmes de route
 * (05-Fronts §7). `a`, `d` : largeur d'infanterie engagée de l'attaquant et du
 * défenseur (millièmes de liaison) ; `v` : vitesse. Défenseur sans infanterie :
 * vitesse maximale ; attaquant sans infanterie : aucune avancée.
 */
export function frontAdvance(a: number, d: number, v: number): number {
  if (a === 0) return 0;
  if (d === 0) return v;
  const A = FRONTS.advanceThresholdA;
  const span = (FRONTS.advanceThresholdB - A) * d;
  const x = Math.min(span, Math.max(0, a - A * d));
  return Math.floor((2 * x * v + span) / (2 * span));
}

/** Position d'arrivée du camp `x` : 1 000 pour `players[0]` (il avance vers la ville 2), 0 pour `players[1]`. */
export const endOf = (x: number): number => (x === 0 ? ROUTE : 0);

/** Divisions engagées en première ligne d'un camp. */
const engagedOf = (divs: readonly Division[]): Division[] => divs.filter((d) => d.line === LINE_FIRST && d.engaged > 0);

/** Largeur d'infanterie engagée (05-Fronts §7), en millièmes de liaison. */
function infantryWidth(divs: readonly Division[]): number {
  let w = 0;
  for (const d of divs) if (dataOf(d).niche === INFANTRY_NICHE) w += d.engaged;
  return w;
}

/** Vitesse de l'attaquant : motorisée seulement si toute l'infanterie engagée l'est (provisoire, 05-Fronts §7). */
function speedOf(divs: readonly Division[]): number {
  const infantry = divs.filter((d) => dataOf(d).niche === INFANTRY_NICHE);
  return infantry.length > 0 && infantry.every((d) => dataOf(d).motorized) ? FRONTS.motorizedSpeedPermille : FRONTS.footSpeedPermille;
}

/**
 * Dégâts infligés par `from` à `to` (05-Fronts §6.1, §6.2), ajoutés à `losses`
 * (fraction de chaque division de `to`, échelle `LOSS_SCALE`). `attacking` : le
 * camp `from` est l'attaquant de ce combat (`attackMultiplier`) ; sinon `to` est
 * l'attaquant et `from` défend (PV de `to` sans multiplicateur de défense).
 */
function strike(from: readonly Division[], to: readonly Division[], attacking: boolean, losses: Map<Division, number>): void {
  let soft = 0;
  let hard = 0;
  for (const d of from) {
    const a = attackOf(d, attacking ? dataOf(d).attackMultiplier : MULT_SCALE);
    soft += a.soft;
    hard += a.hard;
  }
  if (soft === 0 && hard === 0) return;
  // Partage entre les lignes d'infanterie et de chars au prorata de leur remplissage, puis dans une ligne au
  // prorata de la largeur engagée : la part d'une division est sa largeur engagée sur la largeur engagée totale.
  const targets = to.filter((d) => !dataOf(d).support);
  let total = 0;
  for (const d of targets) total += d.engaged;
  if (total === 0) return;
  for (const d of targets) {
    const data = dataOf(d);
    const mixed = data.armorPercent * hard + (100 - data.armorPercent) * soft;
    const received = Math.floor((mixed * d.engaged) / (100 * total));
    // f = dégâts / PV ; dégâts en millièmes, PV × multiplicateur de défense quand `d` défend.
    const hpMult = attacking ? data.defenseHitPointsMultiplier : MULT_SCALE;
    const den = data.hitPoints * hpMult;
    if (den === 0) continue;
    const f = Math.floor((received * (LOSS_SCALE / 1000) * MULT_SCALE) / den);
    losses.set(d, (losses.get(d) ?? 0) + f);
  }
}

/** Une connexion arrivée au bout de sa route : le camp `x` tient la ville de l'autre bout. */
interface Arrival {
  readonly x: number;
  readonly city1: number;
  readonly city2: number;
}

/** Un round de combat sur un front en combat (05-Fronts §6, §7). Renvoie les connexions arrivées au bout de leur route. */
function fightFront(state: GameState, front: Front): Arrival[] {
  const sides = [0, 1].map((x) => engagedOf(sideDivisions(state, front, front.players[x]!)));
  const losses = new Map<Division, number>();
  for (let x = 0; x < 2; x++) {
    if (!front.sides[x]!.frontAttack) continue;
    // Un combat par attaque : l'attaquant avec `attackMultiplier`, le défenseur sans multiplicateur, avec ses PV de défense.
    strike(sides[x]!, sides[1 - x]!, true, losses);
    strike(sides[1 - x]!, sides[x]!, false, losses);
  }
  // Pertes de l'appui-feu (05-Fronts §6.3) : moyenne des pertes de l'infanterie engagée, pondérée par la largeur engagée,
  // × part engagée de la division d'appui-feu.
  for (const divs of sides) {
    let num = 0;
    let den = 0;
    for (const d of divs) {
      if (dataOf(d).niche !== INFANTRY_NICHE) continue;
      num += Math.min(LOSS_SCALE, losses.get(d) ?? 0) * d.engaged;
      den += d.engaged;
    }
    if (den === 0 || num === 0) continue;
    const fInf = Math.floor(num / den);
    for (const d of divs) if (dataOf(d).support) losses.set(d, Math.floor((fInf * d.engaged) / dataOf(d).width));
  }
  // Application, divisions par identifiant (pertes tirées, 05-Fronts §1).
  const hit = [...losses.keys()].sort((a, b) => a.id - b.id);
  for (const d of hit) applyLoss(state, d, Math.min(LOSS_SCALE, losses.get(d)!));
  trimAll(state);
  removeDestroyed(state);
  applyFlight(state, front);
  applySwaps(state, front);
  for (const p of front.players) arrangeSide(state, front, p);

  // Avancée (05-Fronts §7) : la même sur toutes les routes du front, dans le sens de l'attaquant ;
  // quand les deux camps poussent, les avancées s'appliquent en sens contraire.
  const after = [0, 1].map((x) => engagedOf(sideDivisions(state, front, front.players[x]!)));
  let net = 0;
  for (let x = 0; x < 2; x++) {
    if (!front.sides[x]!.frontAttack) continue;
    const by = frontAdvance(infantryWidth(after[x]!), infantryWidth(after[1 - x]!), speedOf(after[x]!));
    net += x === 0 ? by : -by;
  }
  const arrivals: Arrival[] = [];
  if (net === 0) return arrivals;
  for (const c of front.connections) {
    c.position = Math.min(ROUTE, Math.max(0, c.position + net));
    if (c.position === ROUTE) arrivals.push({ x: 0, city1: c.city1, city2: c.city2 });
    else if (c.position === 0) arrivals.push({ x: 1, city1: c.city1, city2: c.city2 });
  }
  return arrivals;
}

/**
 * Round de combat de tous les fronts en combat, puis les prises de villes (05-Fronts §13.2).
 * Appelée par `applyTurn` quand le numéro du tour est un multiple de `combatTurns`.
 */
export function combatRound(state: GameState, changed: number[]): void {
  const pending: Arrival[] = [];
  for (const front of state.fronts) {
    if (inCombat(state, front)) pending.push(...fightFront(state, front));
  }
  // Une prise recalcule les fronts : chaque arrivée est revérifiée sur l'état d'alors.
  for (const a of pending) {
    for (const front of state.fronts) {
      const c = front.connections.find((k) => k.city1 === a.city1 && k.city2 === a.city2);
      if (c === undefined || c.position !== endOf(a.x) || !isActive(state, front)) continue;
      const attacker = front.players[a.x]!;
      const defender = front.players[1 - a.x]!;
      captureCity(state, attacker, defender, a.x === 0 ? a.city2 : a.city1, { city1: a.city1, city2: a.city2 }, changed);
      break;
    }
  }
  countSoldiers(state);
}
