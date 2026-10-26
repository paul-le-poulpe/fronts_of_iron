// Combat des fronts (Docs/Design/05-Fronts.md §5, §6, §7) : attaques, rounds,
// pertes, avancée du front, percées. Un round tous les `FRONTS.combatTurns` tours.
//
// Les dégâts des deux camps sont calculés sur les effectifs du début du round,
// puis appliqués ensemble (05-Fronts §6, provisoire). Tout est en entiers.
// Ordre des parcours : fronts par identifiant, camps 0 puis 1, percées par
// identifiant, types dans l'ordre des clés de `UNITS` (règle 2 du CLAUDE.md).

import { FRONTS } from "./config.ts";
import { captureCity } from "./conquest.ts";
import { ROUTE, clipBreakthroughs, isActive, type Breakthrough, type Front, type FrontSide } from "./fronts.ts";
import { currentTurn, loseUnits } from "./troops.ts";
import type { GameState } from "./state.ts";
import {
  UNIT_COUNT,
  damageOf,
  fillWidth,
  hitPointsOf,
  infantryCount,
  lossesFrom,
  motorization,
  roundDiv,
  zeros,
} from "./units.ts";

/** Largeur d'une percée : la largeur du front divisée par ses connexions, soit une connexion (05-Fronts §7.2). */
const BREAKTHROUGH_METERS = FRONTS.metersPerConnection;

const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

/** Retire `lost` de `counts` (jamais sous 0) et renvoie ce qui a vraiment été retiré. */
function remove(counts: number[], lost: readonly number[]): number[] {
  const done = zeros();
  for (let t = 0; t < UNIT_COUNT; t++) {
    done[t] = Math.min(counts[t]!, lost[t]!);
    counts[t] = counts[t]! - done[t]!;
  }
  return done;
}

function add(into: number[], more: readonly number[]): void {
  for (let t = 0; t < UNIT_COUNT; t++) into[t] = into[t]! + more[t]!;
}

/** Facteur de réaction de la seconde ligne du défenseur, à l'échelle 100 (05-Fronts §7.2, point 6). */
export function reactionFactor100(motor: number, total: number): number {
  const slow = FRONTS.slowReactionFactor * 100;
  if (total === 0) return slow;
  if (motor >= total) return 100;
  if (motor * 2 < total) return slow;
  return slow - Math.floor(((slow - 100) * (2 * motor - total)) / total);
}

/** Vitesse d'une force, en millièmes de route par round : motorisée seulement si elle l'est à 100 % (05-Fronts §7.1, §7.3). */
export function forceSpeed(counts: readonly number[], second: boolean): number {
  const { motor, total } = motorization(counts, second);
  return total > 0 && motor === total ? FRONTS.motorizedSpeedPermille : FRONTS.footSpeedPermille;
}

/**
 * Avancée d'une attaque sur tout le front en un round, en millièmes de route
 * (05-Fronts §7.1). `a`, `d` : unités d'infanterie en première ligne de l'attaquant
 * et du défenseur ; `v` : vitesse de l'armée. Défenseur sans infanterie : vitesse
 * maximale ; attaquant sans infanterie : aucune avancée.
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

/** Avance de `by` millièmes la connexion vers la ville adverse du camp `x`, bornée à la route. */
function push(c: { position: number }, x: number, by: number): void {
  c.position = Math.min(ROUTE, Math.max(0, c.position + (x === 0 ? by : -by)));
}

// ---- percées ----

/** Unités de la seconde ligne que les percées lancées par `side` engagent (elles ne sont plus disponibles). */
function engagedAttackers(side: FrontSide, except?: Breakthrough): number[] {
  const out = zeros();
  for (const b of side.breakthroughs) if (b !== except && b.phase >= 1) add(out, b.attackers);
  return out;
}

/** Début d'une percée, à la fin du délai (05-Fronts §7.2, points 3 et 4). Faux : aucune force, la percée échoue. */
function beginBreakthrough(front: Front, x: number, bt: Breakthrough): boolean {
  const mine = front.sides[x]!;
  const other = front.sides[1 - x]!;
  const engaged = engagedAttackers(mine, bt);
  const force = fillWidth(mine.secondLine.map((n, t) => n - engaged[t]!), BREAKTHROUGH_METERS, true, mine.motorizedOnly ? "only" : "first");
  if (sum(force) === 0) return false;
  const taken = zeros();
  for (const b of mine.breakthroughs) if (b !== bt && b.phase >= 1) add(taken, b.defenders1);
  const slice = fillWidth(other.firstLine.map((n, t) => n - taken[t]!), BREAKTHROUGH_METERS, false, "all");
  bt.attackers = force;
  bt.defenders1 = slice;
  bt.defenders2 = zeros();
  bt.startHp = hitPointsOf(force);
  bt.phase = 1;
  return true;
}

/**
 * Forces de contre-attaque des percées en phase 2 lancées par le camp `x` (05-Fronts
 * §7.2, point 7) : la seconde ligne du défenseur qui ne mène pas sa propre percée,
 * partagée équitablement entre ces percées (le reste aux identifiants les plus
 * petits), dans la largeur d'une percée, motorisées d'abord.
 */
function assignCounterForces(front: Front, x: number): void {
  const mine = front.sides[x]!;
  const defender = front.sides[1 - x]!;
  const phase2 = mine.breakthroughs.filter((b) => b.phase === 2);
  if (phase2.length === 0) return;
  const engaged = engagedAttackers(defender);
  const free = defender.secondLine.map((n, t) => n - engaged[t]!);
  phase2.forEach((b, j) => {
    const share = free.map((n) => Math.floor(n / phase2.length) + (j < n % phase2.length ? 1 : 0));
    b.defenders2 = fillWidth(share, BREAKTHROUGH_METERS, true, "first");
  });
}

/** Une connexion arrivée au bout de sa route : le camp `x` tient la ville de l'autre bout. */
export interface Arrival {
  readonly x: number;
  readonly city1: number;
  readonly city2: number;
}

/**
 * Un round de combat sur un front actif (05-Fronts §6, §7). Renvoie les connexions
 * arrivées au bout de leur route pendant ce round.
 */
function fightFront(state: GameState, front: Front, turn: number): Arrival[] {
  const arrivals: Arrival[] = [];
  const sides = front.sides;

  // Début des percées dont le délai est écoulé ; une percée sans force échoue.
  for (let x = 0; x < 2; x++) {
    const mine = sides[x]!;
    mine.breakthroughs = mine.breakthroughs.filter((bt) => {
      if (bt.phase !== 0 || turn < bt.startTick + FRONTS.breakthroughDelayTurns) return true;
      if (beginBreakthrough(front, x, bt)) return true;
      // Aucune force à engager (seconde ligne vide, ou « Motorisé seulement » sans unité motorisée) : la percée s'arrête, le joueur le voit.
      state.events.push({ type: "breakthrough_failed", from: front.players[x]!, to: front.players[1 - x]!, turn });
      return false;
    });
    assignCounterForces(front, x);
  }
  if (!sides.some((s) => s.frontAttack || s.breakthroughs.length > 0)) return arrivals;

  // Dégâts, calculés sur les effectifs du début du round.
  const first: [number[], number[]] = [zeros(), zeros()];
  const second: [number[], number[]] = [zeros(), zeros()];
  const sliceLoss = new Map<Breakthrough, number[]>();
  const attackerLoss = new Map<Breakthrough, number[]>();
  const counterLoss = new Map<Breakthrough, number[]>();
  for (let x = 0; x < 2; x++) {
    const mine = sides[x]!;
    const other = sides[1 - x]!;
    if (mine.frontAttack) {
      // Première ligne contre première ligne : l'attaquant avec attackMultiplier, le défenseur sans multiplicateur.
      add(first[1 - x]!, lossesFrom(other.firstLine, damageOf(mine.firstLine, "attack")));
      add(first[x]!, lossesFrom(mine.firstLine, damageOf(other.firstLine, "base")));
    }
    for (const bt of mine.breakthroughs) {
      if (bt.phase === 1) {
        // Phase 1 : seconde ligne de l'attaquant (breakthroughMultiplier) contre la tranche engagée de la première ligne du défenseur.
        const onSlice = lossesFrom(bt.defenders1, damageOf(bt.attackers, "breakthrough"));
        const onAttackers = lossesFrom(bt.attackers, damageOf(bt.defenders1, "base"));
        sliceLoss.set(bt, onSlice);
        attackerLoss.set(bt, onAttackers);
        add(first[1 - x]!, onSlice);
        add(second[x]!, onAttackers);
      } else if (bt.phase === 2) {
        // Phase 2 : la même force (attackMultiplier) contre la contre-attaque (counterAttackMultiplier).
        const onCounter = lossesFrom(bt.defenders2, damageOf(bt.attackers, "attack"));
        const onAttackers = lossesFrom(bt.attackers, damageOf(bt.defenders2, "counter"));
        counterLoss.set(bt, onCounter);
        attackerLoss.set(bt, onAttackers);
        add(second[1 - x]!, onCounter);
        add(second[x]!, onAttackers);
      }
    }
  }

  // Application. Une attaque sur tout le front tue d'abord les unités de la première ligne que
  // aucune percée n'engage (choix provisoire, 05-Fronts §15) : les tranches ne sont rognées que par
  // leurs propres pertes, puis ramenées aux lignes.
  for (let x = 0; x < 2; x++) {
    const side = sides[x]!;
    loseUnits(state, front.players[x]!, remove(side.firstLine, first[x]!));
    loseUnits(state, front.players[x]!, remove(side.secondLine, second[x]!));
  }
  for (let x = 0; x < 2; x++) {
    for (const bt of sides[x]!.breakthroughs) {
      const s = sliceLoss.get(bt);
      if (s !== undefined) remove(bt.defenders1, s);
      const a = attackerLoss.get(bt);
      if (a !== undefined) remove(bt.attackers, a);
      const c = counterLoss.get(bt);
      if (c !== undefined) remove(bt.defenders2, c);
    }
  }
  clipBreakthroughs(front);

  // Percées : première ligne percée, seconde ligne percée, essoufflement.
  for (let x = 0; x < 2; x++) {
    const mine = sides[x]!;
    for (const bt of [...mine.breakthroughs]) {
      if (bt.phase === 0) continue; // en attente du délai : rien à vérifier
      const axis = front.connections.find((c) => c.city1 === bt.city1 && c.city2 === bt.city2);
      let over = false;
      if (axis !== undefined && bt.phase === 1 && infantryCount(bt.defenders1) === 0) {
        // Toute l'infanterie de la tranche est éliminée : le front avance d'un coup et la phase 2 commence ;
        // les véhicules et équipements restants de la tranche rejoignent leur ligne (ils n'ont jamais quitté la première ligne).
        bt.defenders1 = zeros();
        bt.phase = 2;
        assignCounterForces(front, x);
        const { motor, total } = motorization(bt.defenders2, true);
        const jump = roundDiv(FRONTS.breakthroughJumpRounds * forceSpeed(bt.attackers, true) * reactionFactor100(motor, total), 100);
        push(axis, x, jump);
        if (axis.position === endOf(x) || infantryCount(bt.defenders2) === 0) {
          // Au bout de la route, ou plus d'infanterie pour contre-attaquer : la ville au bout de l'axe tombe.
          axis.position = endOf(x);
          arrivals.push({ x, city1: bt.city1, city2: bt.city2 });
          over = true;
        }
      } else if (axis !== undefined && bt.phase === 2 && infantryCount(bt.defenders2) === 0) {
        // Seconde ligne percée (ou aucune force de contre-attaque) : le front avance jusqu'à la ville.
        axis.position = endOf(x);
        arrivals.push({ x, city1: bt.city1, city2: bt.city2 });
        over = true;
      }
      // Essoufflement : l'avancée déjà gagnée reste.
      if (!over && (axis === undefined || sum(bt.attackers) === 0 || hitPointsOf(bt.attackers) * 100 < bt.startHp * FRONTS.breakthroughExhaustionPercent)) over = true;
      if (over) mine.breakthroughs = mine.breakthroughs.filter((b) => b !== bt);
    }
  }

  // Attaque sur tout le front : la même avancée sur toutes les routes, dans le sens de l'attaquant ;
  // quand les deux camps poussent, les avancées se retranchent (05-Fronts §7.1).
  if (sides.some((s) => s.frontAttack)) {
    let net = 0;
    for (let x = 0; x < 2; x++) {
      if (!sides[x]!.frontAttack) continue;
      const by = frontAdvance(infantryCount(sides[x]!.firstLine), infantryCount(sides[1 - x]!.firstLine), forceSpeed(sides[x]!.firstLine, false));
      net += x === 0 ? by : -by;
    }
    for (const c of front.connections) {
      if (net === 0) break;
      push(c, 0, net);
      if (c.position === ROUTE) arrivals.push({ x: 0, city1: c.city1, city2: c.city2 });
      else if (c.position === 0) arrivals.push({ x: 1, city1: c.city1, city2: c.city2 });
    }
  }
  return arrivals;
}

/**
 * Round de combat de tous les fronts actifs, puis les prises de villes (05-Fronts §13.2).
 * Appelée par `applyTurn` quand le numéro du tour est un multiple de `combatTurns`.
 */
export function combatRound(state: GameState, changed: number[]): void {
  const turn = currentTurn(state);
  const pending: Arrival[] = [];
  for (const front of state.fronts) {
    if (isActive(state, front)) pending.push(...fightFront(state, front, turn));
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
}
