// Combat des fronts (Docs/Design/05-Fronts.md §6, §7) : un round tous les
// `FRONTS.combatTurns` tours, sur chaque front actif où un camp attaque sur tout le
// front ou lance une percée. Les choix des forces d'une percée et ses vérifications de
// fin de round sont dans breakthroughs.ts.
//
// Les dégâts des deux camps sont calculés sur les divisions du début du round,
// puis appliqués ensemble (provisoire, 05-Fronts §6). Tout est en entiers.
// Ordre des parcours : fronts par identifiant, camps 0 puis 1, divisions par
// identifiant, composants dans l'ordre de `components` (règle 2 du CLAUDE.md).

import {
  assignCounterForces,
  breakthroughFlight,
  checkBreakthrough,
  endDelays,
  forceOf,
  removeEmptyBoxes,
  type Arrival,
} from "./breakthroughs.ts";
import { FRONTS } from "./config.ts";
import { captureCity } from "./conquest.ts";
import {
  INFANTRY_NICHE,
  LINE_FIRST,
  LOSS_SCALE,
  MULT_SCALE,
  WIDTH_SCALE,
  applyLoss,
  attackOf,
  countSoldiers,
  dataOf,
  type Division,
} from "./divisions.ts";
import { ROUTE, endOf, frontWidth, hasRound, isActive, isBreakthroughCombat, type Front } from "./fronts.ts";
import { applyFlight, applySwaps, arrangeSide, removeDestroyed, sideDivisions, trimAll } from "./placement.ts";
import type { GameState } from "./state.ts";

/**
 * Avancée d'une attaque sur tout le front en un round, en millièmes de route
 * (05-Fronts §7). `a`, `d` : largeur d'infanterie engagée de l'attaquant et du
 * défenseur (millièmes de liaison) ; `v` : vitesse maximale (`frontSpeed`, toutes niches).
 * Défenseur sans infanterie : vitesse maximale ; attaquant sans infanterie : aucune avancée.
 */
export function frontAdvance(a: number, d: number, v: number): number {
  if (a === 0) return 0;
  if (d === 0) return v;
  const A = FRONTS.advanceThresholdA;
  const span = (FRONTS.advanceThresholdB - A) * d;
  const x = Math.min(span, Math.max(0, a - A * d));
  return Math.floor((2 * x * v + span) / (2 * span));
}

export { endOf };

/** Divisions engagées en première ligne d'un camp. */
const engagedOf = (divs: readonly Division[]): Division[] => divs.filter((d) => d.line === LINE_FIRST && d.engaged > 0);

/** Largeur engagée en première ligne (05-Fronts §7), toutes niches, en millièmes de liaison. */
function engagedWidth(divs: readonly Division[]): number {
  let w = 0;
  for (const d of divs) w += d.engaged;
  return w;
}

/** Largeur d'infanterie engagée (05-Fronts §7), en millièmes de liaison : seule l'infanterie fait avancer le front. */
function infantryWidth(divs: readonly Division[]): number {
  let w = 0;
  for (const d of divs) if (dataOf(d).niche === INFANTRY_NICHE) w += d.engaged;
  return w;
}

/**
 * Vitesse maximale de l'attaquant, progressive (05-Fronts §7) : de `footSpeedPermille` (aucune division motorisée) à
 * `motorizedSpeedPermille` (toutes), au prorata de la largeur engagée des divisions motorisées, toutes niches.
 */
export function frontSpeed(divs: readonly Division[]): number {
  const total = engagedWidth(divs);
  if (total === 0) return FRONTS.footSpeedPermille;
  let motor = 0;
  for (const d of divs) if (dataOf(d).motorized) motor += d.engaged;
  return FRONTS.footSpeedPermille + Math.floor(((FRONTS.motorizedSpeedPermille - FRONTS.footSpeedPermille) * motor) / total);
}

/** Un combat : deux forces, leurs largeurs engagées, multiplicateurs d'attaque et de PV (échelle 100). */
interface Fight {
  readonly a: readonly Division[];
  readonly b: readonly Division[];
  /** Largeur du front dans ce combat, en millièmes de liaison : celle du front, ou une liaison en percée (05-Fronts §6.3). */
  readonly frontWidth: number;
  readonly width: (d: Division) => number;
  /** Largeur pleine de la division dans ce combat : la part engagée est `width / fullWidth` (05-Fronts §4.2, §7.2). */
  readonly fullWidth: (d: Division) => number;
  readonly attackMult: (d: Division) => number;
  readonly hpMult: (d: Division) => number;
}

/**
 * Dégâts infligés par `from` à `to` (05-Fronts §6.1 à §6.3), ajoutés à `losses` (fraction de chaque division de `to`,
 * échelle `LOSS_SCALE`). Les attaques de chaque division sont prises sur sa largeur engagée dans ce combat.
 * - Niche principale : la part de la division est sa largeur engagée sur la largeur engagée totale des niches principales.
 * - Appui-feu : `mixte × part engagée / (F + largeur engagée des chars)`, `F` la largeur du front ; l'infanterie compte
 *   comme si elle occupait tout le front, donc en avoir moins ne protège pas l'appui-feu, en avoir plus de chars, si.
 */
function strike(fight: Fight, from: readonly Division[], to: readonly Division[], losses: Map<Division, number>): void {
  let soft = 0;
  let hard = 0;
  for (const d of from) {
    const a = attackOf(d, fight.attackMult(d), fight.width(d), fight.fullWidth(d));
    soft += a.soft;
    hard += a.hard;
  }
  if (soft === 0 && hard === 0) return;
  let total = 0;
  let tanks = 0;
  for (const d of to) {
    const data = dataOf(d);
    if (data.support) continue;
    total += fight.width(d);
    if (data.niche !== INFANTRY_NICHE) tanks += fight.width(d);
  }
  for (const d of to) {
    const data = dataOf(d);
    const mixed = data.armorPercent * hard + (100 - data.armorPercent) * soft;
    // Dégâts en millièmes de point. Appui-feu : une division d'une liaison pleine sous une infanterie qui remplit le front.
    const received = data.support
      ? Math.floor((mixed * fight.width(d) * WIDTH_SCALE) / (100 * fight.fullWidth(d) * (fight.frontWidth + tanks)))
      : total === 0
        ? 0
        : Math.floor((mixed * fight.width(d)) / (100 * total));
    // f = dégâts / PV ; PV × multiplicateur (de défense pour le défenseur).
    const den = data.hitPoints * fight.hpMult(d);
    if (den === 0) continue;
    const f = Math.floor((received * (LOSS_SCALE / 1000) * MULT_SCALE) / den);
    losses.set(d, (losses.get(d) ?? 0) + f);
  }
}

/** Pertes d'un combat (05-Fronts §6.2, §6.3) : les deux forces se frappent. Ajoutées à `total`. */
function fightLosses(fight: Fight, total: Map<Division, number>): void {
  strike(fight, fight.a, fight.b, total);
  strike(fight, fight.b, fight.a, total);
}

/** Un round de combat sur un front (05-Fronts §6, §7). Renvoie les connexions arrivées au bout de leur route. */
function fightFront(state: GameState, front: Front): Arrival[] {
  const arrivals: Arrival[] = [];
  // Percées : fin des délais (combat 1, combat 2, chute de la ville), puis forces de contre-attaque du combat 2, recalculées à chaque round.
  endDelays(state, front, arrivals);
  assignCounterForces(state, front);

  // Dégâts, calculés sur les divisions du début du round, puis appliqués ensemble.
  const losses = new Map<Division, number>();
  const sides = [0, 1].map((x) => engagedOf(sideDivisions(state, front, front.players[x]!)));
  for (let x = 0; x < 2; x++) {
    if (!front.sides[x]!.frontAttack) continue;
    // Attaque sur tout le front : l'attaquant avec `attackMultiplier`, le défenseur sans multiplicateur, avec ses PV de défense.
    const attacker = sides[x]!;
    fightLosses(
      {
        a: attacker,
        b: sides[1 - x]!,
        frontWidth: frontWidth(front),
        width: (d) => d.engaged,
        fullWidth: (d) => dataOf(d).width,
        attackMult: (d) => (attacker.includes(d) ? dataOf(d).attackMultiplier : MULT_SCALE),
        hpMult: (d) => (attacker.includes(d) ? MULT_SCALE : dataOf(d).defenseHitPointsMultiplier),
      },
      losses,
    );
  }
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && isBreakthroughCombat(b.phase))) {
    // Percée : la force qui perce avec `breakthroughMultiplier` ; la tranche de première ligne sans multiplicateur, la
    // force de contre-attaque avec `counterAttackMultiplier` ; le défenseur avec ses PV de défense (05-Fronts §7.2).
    const force = forceOf(state, bt, true);
    const defense = forceOf(state, bt, false);
    fightLosses(
      {
        a: force,
        b: defense,
        // Une percée se bat sur une liaison, tranche de première ligne comprise.
        frontWidth: WIDTH_SCALE,
        width: (d) => d.btEngaged,
        // Force qui perce et force de contre-attaque : `breakthroughWidth` ; tranche de première ligne : `frontWidth`.
        fullWidth: (d) => (d.owner !== bt.owner && bt.phase === 1 ? dataOf(d).width : dataOf(d).breakthroughWidth),
        attackMult: (d) => (d.owner === bt.owner ? dataOf(d).breakthroughMultiplier : bt.phase === 3 ? dataOf(d).counterAttackMultiplier : MULT_SCALE),
        hpMult: (d) => (d.owner === bt.owner ? MULT_SCALE : dataOf(d).defenseHitPointsMultiplier),
      },
      losses,
    );
  }

  // Application, divisions par identifiant (pertes tirées, 05-Fronts §1).
  const hit = [...losses.keys()].sort((a, b) => a.id - b.id);
  for (const d of hit) applyLoss(state, d, Math.min(LOSS_SCALE, losses.get(d)!));
  trimAll(state);
  removeDestroyed(state);
  applyFlight(state, front);
  breakthroughFlight(state, front);
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && b.phase > 0).sort((a, b) => a.id - b.id)) {
    // Vérifications de fin de round, aussi pendant un délai (axe disparu, force détruite ou épuisée).
    checkBreakthrough(state, front, bt);
  }
  applySwaps(state, front);
  for (const p of front.players) arrangeSide(state, front, p);

  // Avancée (05-Fronts §7.1) : la même sur toutes les routes du front, dans le sens de l'attaquant ;
  // quand les deux camps poussent, les avancées s'appliquent en sens contraire.
  const after = [0, 1].map((x) => engagedOf(sideDivisions(state, front, front.players[x]!)));
  let net = 0;
  for (let x = 0; x < 2; x++) {
    if (!front.sides[x]!.frontAttack) continue;
    const by = frontAdvance(infantryWidth(after[x]!), infantryWidth(after[1 - x]!), frontSpeed(after[x]!));
    net += x === 0 ? by : -by;
  }
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
    if (hasRound(state, front)) pending.push(...fightFront(state, front));
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
  removeEmptyBoxes(state);
  countSoldiers(state);
}
