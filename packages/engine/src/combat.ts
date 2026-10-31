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
  beginCombat1,
  breakthroughFlight,
  checkBreakthrough,
  endBreakthrough,
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
  applyLoss,
  attackOf,
  countSoldiers,
  currentTurn,
  dataOf,
  type Division,
} from "./divisions.ts";
import { ROUTE, endOf, hasRound, isActive, type Front } from "./fronts.ts";
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

export { endOf };

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

/** Un combat : deux forces, leurs largeurs engagées, multiplicateurs d'attaque et de PV (échelle 100). */
interface Fight {
  readonly a: readonly Division[];
  readonly b: readonly Division[];
  readonly width: (d: Division) => number;
  /** Largeur pleine de la division dans ce combat : la part engagée est `width / fullWidth` (05-Fronts §4.2, §7.2). */
  readonly fullWidth: (d: Division) => number;
  readonly attackMult: (d: Division) => number;
  readonly hpMult: (d: Division) => number;
}

/**
 * Dégâts infligés par `from` à `to` (05-Fronts §6.1, §6.2), ajoutés à `losses` (fraction de chaque division de `to`,
 * échelle `LOSS_SCALE`). Les attaques de chaque division sont prises sur sa largeur engagée dans ce combat ; la part
 * de chaque cible est sa largeur engagée sur la largeur engagée totale des niches principales.
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
  const targets = to.filter((d) => !dataOf(d).support);
  let total = 0;
  for (const d of targets) total += fight.width(d);
  if (total === 0) return;
  for (const d of targets) {
    const data = dataOf(d);
    const mixed = data.armorPercent * hard + (100 - data.armorPercent) * soft;
    const received = Math.floor((mixed * fight.width(d)) / (100 * total));
    // f = dégâts / PV ; dégâts en millièmes de point, PV × multiplicateur (de défense pour le défenseur).
    const den = data.hitPoints * fight.hpMult(d);
    if (den === 0) continue;
    const f = Math.floor((received * (LOSS_SCALE / 1000) * MULT_SCALE) / den);
    losses.set(d, (losses.get(d) ?? 0) + f);
  }
}

/**
 * Pertes d'un combat (05-Fronts §6.2, §6.3) : les deux forces se frappent, puis l'appui-feu de chaque force perd la
 * moyenne des pertes de son infanterie, pondérée par la largeur engagée, × sa part engagée. Ajoutées à `total`.
 */
function fightLosses(fight: Fight, total: Map<Division, number>): void {
  const losses = new Map<Division, number>();
  strike(fight, fight.a, fight.b, losses);
  strike(fight, fight.b, fight.a, losses);
  for (const divs of [fight.a, fight.b]) {
    let num = 0;
    let den = 0;
    for (const d of divs) {
      if (dataOf(d).niche !== INFANTRY_NICHE) continue;
      num += Math.min(LOSS_SCALE, losses.get(d) ?? 0) * fight.width(d);
      den += fight.width(d);
    }
    if (den === 0 || num === 0) continue;
    const fInf = Math.floor(num / den);
    for (const d of divs) if (dataOf(d).support) losses.set(d, Math.floor((fInf * fight.width(d)) / fight.fullWidth(d)));
  }
  for (const [d, f] of losses) total.set(d, (total.get(d) ?? 0) + f);
}

/** Un round de combat sur un front (05-Fronts §6, §7). Renvoie les connexions arrivées au bout de leur route. */
function fightFront(state: GameState, front: Front): Arrival[] {
  const turn = currentTurn(state);
  const arrivals: Arrival[] = [];
  // Percées : fin du délai (combat 1), puis forces de contre-attaque du combat 2, recalculées à chaque round.
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && b.phase === 0)) {
    if (turn < bt.launchTick + FRONTS.breakthroughDelayTurns) continue;
    if (!beginCombat1(state, front, bt)) {
      endBreakthrough(state, bt);
      state.events.push({ type: "breakthrough_failed", from: bt.owner, to: front.players.find((p) => p !== bt.owner)!, turn });
    }
  }
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
        width: (d) => d.engaged,
        fullWidth: (d) => dataOf(d).width,
        attackMult: (d) => (attacker.includes(d) ? dataOf(d).attackMultiplier : MULT_SCALE),
        hpMult: (d) => (attacker.includes(d) ? MULT_SCALE : dataOf(d).defenseHitPointsMultiplier),
      },
      losses,
    );
  }
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && b.phase > 0)) {
    // Percée : la force qui perce avec `breakthroughMultiplier` ; la tranche de première ligne sans multiplicateur, la
    // force de contre-attaque avec `counterAttackMultiplier` ; le défenseur avec ses PV de défense (05-Fronts §7.2).
    const force = forceOf(state, bt, true);
    const defense = forceOf(state, bt, false);
    fightLosses(
      {
        a: force,
        b: defense,
        width: (d) => d.btEngaged,
        // Force qui perce et force de contre-attaque : `breakthroughWidth` ; tranche de première ligne : `frontWidth`.
        fullWidth: (d) => (d.owner !== bt.owner && bt.phase === 1 ? dataOf(d).width : dataOf(d).breakthroughWidth),
        attackMult: (d) => (d.owner === bt.owner ? dataOf(d).breakthroughMultiplier : bt.phase === 2 ? dataOf(d).counterAttackMultiplier : MULT_SCALE),
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
    checkBreakthrough(state, front, bt, arrivals);
  }
  applySwaps(state, front);
  for (const p of front.players) arrangeSide(state, front, p);

  // Avancée (05-Fronts §7.1) : la même sur toutes les routes du front, dans le sens de l'attaquant ;
  // quand les deux camps poussent, les avancées s'appliquent en sens contraire.
  const after = [0, 1].map((x) => engagedOf(sideDivisions(state, front, front.players[x]!)));
  let net = 0;
  for (let x = 0; x < 2; x++) {
    if (!front.sides[x]!.frontAttack) continue;
    const by = frontAdvance(infantryWidth(after[x]!), infantryWidth(after[1 - x]!), speedOf(after[x]!));
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
