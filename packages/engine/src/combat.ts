// Combat des fronts (Docs/Design/05-Fronts.md §6, §7 ; 06-Combat-Simplifie.md §1).
// - Attaque sur tout le front : résolue en un seul tour, `FRONTS.attackDelayTurns` après
//   l'ordre : jusqu'à `FRONTS.combatMaxRounds` rounds enchaînés, chacun écrit dans un
//   rapport (`CombatRecord`) que le client rejoue.
// - Percée : un round tous les `FRONTS.combatTurns` tours. Les choix des forces d'une
//   percée et ses vérifications de fin de round sont dans breakthroughs.ts.
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
import { ARMAMENT, FRONTS } from "./config.ts";
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
  currentTurn,
  MEN,
  dataOf,
  isFleeing,
  stateOf,
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

/** Un round des percées d'un front (05-Fronts §6, §7.2). Renvoie les connexions arrivées au bout de leur route. */
function fightFront(state: GameState, front: Front): Arrival[] {
  const arrivals: Arrival[] = [];
  // Percées : fin des délais (combat 1, combat 2, chute de la ville), puis forces de contre-attaque du combat 2, recalculées à chaque round.
  endDelays(state, front, arrivals);
  assignCounterForces(state, front);

  // Dégâts, calculés sur les divisions du début du round, puis appliqués ensemble.
  const losses = new Map<Division, number>();
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
  // Hommes perdus par la première ligne de chaque camp (05-Fronts §11.4), percées comprises (tranche de première ligne).
  for (const d of hit) {
    const men = applyLoss(state, d, Math.min(LOSS_SCALE, losses.get(d)!));
    if (d.line === LINE_FIRST && d.front === front.id) {
      const byNiche = front.sides[front.players.indexOf(d.owner)]!.lastLossByNiche;
      byNiche[dataOf(d).niche] = byNiche[dataOf(d).niche]! + men;
    }
  }
  trimAll(state);
  removeDestroyed(state, hit);
  applyFlight(state, front);
  breakthroughFlight(state, front);
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && b.phase > 0).sort((a, b) => a.id - b.id)) {
    // Vérifications de fin de round, aussi pendant un délai (axe disparu, force détruite ou épuisée).
    checkBreakthrough(state, front, bt);
  }
  applySwaps(state, front);
  for (const p of front.players) arrangeSide(state, front, p);
  return arrivals;
}

/** Une division d'un rapport de combat, telle qu'au début du combat. */
export interface CombatUnit {
  readonly division: number;
  readonly owner: number;
  /** Indice du type (ordre des clés de `DIVISIONS`). */
  readonly type: number;
  /** État au début du combat, échelle `STATE_SCALE`. */
  readonly start: number;
}

/** Un round d'un rapport de combat. */
export interface CombatRound {
  /** Divisions engagées pendant ce round : [indice dans `units`, perte d'état (échelle `STATE_SCALE`)], par identifiant. */
  readonly hits: readonly (readonly [number, number])[];
  /** Divisions détruites à la fin du round (indices dans `units`). */
  readonly destroyed: readonly number[];
  /** Divisions en fuite à la fin du round (indices dans `units`, 05-Fronts §5.4). */
  readonly fled: readonly number[];
  /** Avancée de l'attaquant pendant ce round, en millièmes de route. */
  readonly advance: number;
}

/** Pertes d'un camp sur tout un combat : hommes, et exemplaires de chaque type d'armement (ordre de `ARMAMENT.types`). */
export interface CombatLosses {
  men: number;
  readonly equipment: number[];
}

/** Rapport d'un combat (06-Combat-Simplifie §1), pour le replay. Le moteur ne le relit pas. */
export interface CombatRecord {
  readonly id: number;
  readonly front: number;
  /** Tour où le combat a été résolu. */
  readonly tick: number;
  readonly attacker: number;
  readonly defender: number;
  /** Connexion au milieu de laquelle le client place l'icône du combat : la première du front. */
  readonly city1: number;
  readonly city2: number;
  readonly units: CombatUnit[];
  readonly rounds: CombatRound[];
  /** Pertes de l'attaquant puis du défenseur (pertes tirées, 05-Fronts §6.2), sans les excédents rendus au stock. */
  readonly losses: readonly [CombatLosses, CombatLosses];
  /** Ville prise à la fin du combat, 0 sinon. */
  captured: number;
}

/**
 * Un round de l'attaque sur tout le front de `front.players[x]` (05-Fronts §6, §7.1), ajouté à `record`. Renvoie les
 * connexions arrivées au bout de leur route, ou `undefined` si l'attaquant n'a plus d'infanterie engagée (fin du combat,
 * 06-Combat-Simplifie §1). Un défenseur sans infanterie engagée ne combat plus : le round n'est qu'une avancée.
 */
function frontAttackRound(state: GameState, front: Front, x: number, record: CombatRecord): Arrival[] | undefined {
  const sides = [0, 1].map((i) => engagedOf(sideDivisions(state, front, front.players[i]!)));
  const attacker = sides[x]!;
  if (infantryWidth(attacker) === 0) return undefined;
  // Le défenseur n'a plus d'infanterie engagée (détruite ou en fuite) : l'attaquant avance sans combat pendant les
  // rounds qui restent, à sa vitesse maximale (06-Combat-Simplifie §1).
  if (infantryWidth(sides[1 - x]!) === 0) return advanceRound(front, x, frontSpeed(attacker), record, { hits: [], destroyed: [], fled: [] });
  const losses = new Map<Division, number>();
  // L'attaquant avec `attackMultiplier`, le défenseur sans multiplicateur, avec ses PV de défense.
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
  const engaged = [...sides[0]!, ...sides[1]!].sort((a, b) => a.id - b.id);
  const before = engaged.map((d) => stateOf(d));
  const index = engaged.map((d) => {
    let i = record.units.findIndex((u) => u.division === d.id);
    if (i < 0) {
      i = record.units.length;
      record.units.push({ division: d.id, owner: d.owner, type: d.type, start: stateOf(d) });
    }
    return i;
  });
  const hit = [...losses.keys()].sort((a, b) => a.id - b.id);
  for (const d of hit) {
    const counts = d.counts.slice();
    const men = applyLoss(state, d, Math.min(LOSS_SCALE, losses.get(d)!));
    const byNiche = front.sides[front.players.indexOf(d.owner)]!.lastLossByNiche;
    byNiche[dataOf(d).niche] = byNiche[dataOf(d).niche]! + men;
    const lost = record.losses[d.owner === record.attacker ? 0 : 1];
    dataOf(d).components.forEach((c, i) => {
      const n = counts[i]! - d.counts[i]!;
      if (c.resource === MEN) lost.men += n;
      else lost.equipment[c.resource] = lost.equipment[c.resource]! + n;
    });
  }
  trimAll(state);
  removeDestroyed(state, hit);
  const alive = new Set(state.divisions.map((d) => d.id));
  applyFlight(state, front);
  // Règle d'échange du combat (05-Fronts §5.3) : sans `false`, la règle hors combat remplacerait chaque division touchée.
  applySwaps(state, front, false);
  for (const p of front.players) arrangeSide(state, front, p);

  const destroyed: number[] = [];
  const fled: number[] = [];
  const hits = engaged.map((d, k): [number, number] => {
    if (!alive.has(d.id)) {
      destroyed.push(index[k]!);
      return [index[k]!, before[k]!];
    }
    if (isFleeing(state, d)) fled.push(index[k]!);
    return [index[k]!, Math.max(0, before[k]! - stateOf(d))];
  });

  // Avancée (05-Fronts §7.1) : la même sur toutes les routes du front, dans le sens de l'attaquant.
  const after = [0, 1].map((i) => engagedOf(sideDivisions(state, front, front.players[i]!)));
  const by = frontAdvance(infantryWidth(after[x]!), infantryWidth(after[1 - x]!), frontSpeed(after[x]!));
  return advanceRound(front, x, by, record, { hits, destroyed, fled });
}

/** Écrit le round dans `record` et avance le front de `by` millièmes dans le sens de `front.players[x]`. Renvoie les connexions arrivées au bout. */
function advanceRound(front: Front, x: number, by: number, record: CombatRecord, round: Omit<CombatRound, "advance">): Arrival[] {
  record.rounds.push({ ...round, advance: by });
  const arrivals: Arrival[] = [];
  if (by === 0) return arrivals;
  const net = x === 0 ? by : -by;
  for (const c of front.connections) {
    c.position = Math.min(ROUTE, Math.max(0, c.position + net));
    if (c.position === ROUTE) arrivals.push({ x: 0, city1: c.city1, city2: c.city2 });
    else if (c.position === 0) arrivals.push({ x: 1, city1: c.city1, city2: c.city2 });
  }
  return arrivals;
}

const noCombatLosses = (): CombatLosses => ({ men: 0, equipment: new Array<number>(Object.keys(ARMAMENT.types).length).fill(0) });

/** Garde au plus `FRONTS.combatHistoryPerPlayer` rapports par joueur : un rapport part quand ses deux joueurs en ont trop. */
function trimCombats(state: GameState): void {
  const count = new Map<number, number>();
  const keep = new Array<boolean>(state.combats.length).fill(true);
  for (let i = state.combats.length - 1; i >= 0; i--) {
    const c = state.combats[i]!;
    const a = (count.get(c.attacker) ?? 0) + 1;
    const d = (count.get(c.defender) ?? 0) + 1;
    count.set(c.attacker, a);
    count.set(c.defender, d);
    if (a > FRONTS.combatHistoryPerPlayer && d > FRONTS.combatHistoryPerPlayer) keep[i] = false;
  }
  state.combats = state.combats.filter((_, i) => keep[i]);
}

/**
 * Prises de villes des connexions arrivées au bout de leur route. Une prise recalcule les fronts : chaque arrivée est
 * revérifiée sur l'état d'alors. Renvoie la dernière ville prise, 0 sinon.
 */
function captureArrivals(state: GameState, pending: readonly Arrival[], changed: number[]): number {
  let captured = 0;
  for (const a of pending) {
    for (const front of state.fronts) {
      const c = front.connections.find((k) => k.city1 === a.city1 && k.city2 === a.city2);
      if (c === undefined || c.position !== endOf(a.x) || !isActive(state, front)) continue;
      const city = a.x === 0 ? a.city2 : a.city1;
      captureCity(state, front.players[a.x]!, front.players[1 - a.x]!, city, { city1: a.city1, city2: a.city2 }, changed);
      captured = city;
      break;
    }
  }
  return captured;
}

/**
 * Attaques sur tout le front arrivées à leur tour (06-Combat-Simplifie §1), fronts par identifiant, camps 0 puis 1 :
 * chacune est résolue en entier dans ce tour, jusqu'à `FRONTS.combatMaxRounds` rounds, jusqu'à ce que l'attaquant
 * n'ait plus d'infanterie engagée, ou jusqu'à une prise de ville. Quand le défenseur n'en a plus, les rounds restants
 * ne sont que des avancées. Appelée par `applyTurn` à chaque tour.
 */
export function resolveFrontAttacks(state: GameState, changed: number[]): void {
  const now = currentTurn(state);
  const due: { front: number; x: number }[] = [];
  for (const front of state.fronts) {
    for (let x = 0; x < 2; x++) {
      const s = front.sides[x]!;
      if (s.attackAt === 0 || s.attackAt > now) continue;
      s.attackAt = 0;
      if (isActive(state, front)) due.push({ front: front.id, x });
    }
  }
  for (const { front: id, x } of due) {
    // Une prise d'un combat précédent a pu recalculer les fronts.
    const front = state.fronts.find((f) => f.id === id);
    if (front === undefined || !isActive(state, front)) continue;
    for (const s of front.sides) s.lastLossByNiche.fill(0);
    const first = front.connections[0]!;
    const record: CombatRecord = {
      id: state.nextCombatId++,
      front: front.id,
      tick: now,
      attacker: front.players[x]!,
      defender: front.players[1 - x]!,
      city1: first.city1,
      city2: first.city2,
      units: [],
      rounds: [],
      losses: [noCombatLosses(), noCombatLosses()],
      captured: 0,
    };
    let arrivals: Arrival[] = [];
    for (let r = 0; r < FRONTS.combatMaxRounds; r++) {
      const got = frontAttackRound(state, front, x, record);
      if (got === undefined) break;
      if (got.length > 0) {
        arrivals = got;
        break;
      }
    }
    record.captured = captureArrivals(state, arrivals, changed);
    removeEmptyBoxes(state);
    countSoldiers(state);
    if (record.rounds.length > 0) state.combats.push(record);
  }
  if (due.length > 0) trimCombats(state);
}

/**
 * Round des percées de tous les fronts, puis les prises de villes (05-Fronts §13.2).
 * Appelée par `applyTurn` quand le numéro du tour est un multiple de `combatTurns`.
 */
export function combatRound(state: GameState, changed: number[]): void {
  const pending: Arrival[] = [];
  for (const front of state.fronts) for (const s of front.sides) s.lastLossByNiche.fill(0);
  for (const front of state.fronts) {
    if (hasRound(state, front)) pending.push(...fightFront(state, front));
  }
  captureArrivals(state, pending, changed);
  removeEmptyBoxes(state);
  countSoldiers(state);
}
