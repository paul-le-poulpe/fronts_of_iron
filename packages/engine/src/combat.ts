// Combat des fronts (Docs/Design/05-Fronts.md §6, §7 ; 06-Combat-Simplifie.md §1 ; 10-Combat-Phases.md).
// - Attaque sur tout le front : résolue en un seul tour : jusqu'à `FRONTS.combatCycles`
//   cycles de 5 phases, une par niche ; chaque tir est écrit dans un rapport
//   (`CombatRecord`) que le client rejoue.
// - Percée : ses délais se terminent tous les `FRONTS.combatTurns` tours ; chacun de ses
//   deux combats (contre la tranche de première ligne, puis contre la réaction rapide) est
//   résolu en un seul tour de la même façon, avec son propre rapport. Les choix des forces
//   d'une percée et ses vérifications de fin de round sont dans breakthroughs.ts.
//
// Dans une phase, la niche du défenseur tire, ses pertes sont appliquées (morts et fuites
// compris), puis celle de l'attaquant tire avec ce qui lui reste (10-Combat-Phases §1).
// Les pertes d'un tir sont concentrées sur la division la plus abîmée de chaque type (§2).
// Tout est en entiers.
// Ordre des parcours : fronts par identifiant, camps 0 puis 1, percées et divisions par
// identifiant (règle 2 du CLAUDE.md).

import { woundMen } from "./activities.ts";
import {
  assignCounterForces,
  breakthroughFlight,
  checkBreakthrough,
  endDelays,
  failBreakthroughCombat,
  forceOf,
  removeEmptyBoxes,
  type Arrival,
  type Breakthrough,
} from "./breakthroughs.ts";
import { FRONTS } from "./config.ts";
import { captureCity } from "./conquest.ts";
import {
  INFANTRY_NICHE,
  LINE_FIRST,
  LINE_SECOND,
  LOSS_SCALE,
  MULT_SCALE,
  NICHE_IDS,
  STATE_SCALE,
  WIDTH_SCALE,
  applyLoss,
  attackOf,
  byChoice,
  currentTurn,
  dataOf,
  isEmpty,
  isFleeing,
  stateOf,
  type Division,
} from "./divisions.ts";
import { ROUTE, endOf, frontWidth, hasRound, isActive, isBreakthroughCombat, type Front } from "./fronts.ts";
import { applyFlight, arrangeSide, removeDestroyed, sideDivisions } from "./placement.ts";
import { nextInt } from "./rng.ts";
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

/** Un combat : largeurs engagées, multiplicateurs d'attaque et de PV (échelle 100). */
interface Fight {
  /** Largeur du front dans ce combat, en millièmes de liaison : celle du front, ou une liaison en percée (05-Fronts §6.3). */
  readonly frontWidth: number;
  readonly width: (d: Division) => number;
  /** Largeur pleine de la division dans ce combat : la part engagée est `width / fullWidth` (05-Fronts §4.2, §7.2). */
  readonly fullWidth: (d: Division) => number;
  readonly attackMult: (d: Division) => number;
  readonly hpMult: (d: Division) => number;
  /** Attaques d'une division, figées au début du cycle (10-Combat-Phases §1). */
  readonly attack: (d: Division) => { readonly soft: number; readonly hard: number };
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
    const a = fight.attack(d);
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

/** Niches dans l'ordre de tir d'un cycle (10-Combat-Phases §1) : chars, infanterie, antichar, antiaérien, artillerie. */
const PHASE_NICHES: readonly number[] = (["tanks", "infantry", "antiTank", "antiAir", "artillery"] as const).map((n) => NICHE_IDS.indexOf(n));

/** État de fuite (`fleeStatePercent`), échelle `STATE_SCALE`. */
const FLEE_STATE = Math.floor((FRONTS.fleeStatePercent * STATE_SCALE) / 100);

/** Pertes (échelle `LOSS_SCALE`) pour un état (échelle `STATE_SCALE`). */
const LOSS_PER_STATE = LOSS_SCALE / STATE_SCALE;

/** Ce qui vaut pour tout un cycle (10-Combat-Phases §1). */
interface CycleState {
  /** Attaques de chaque division engagée au début du cycle (`attackOf` : selon son état d'alors). */
  readonly attack: Map<Division, { readonly soft: number; readonly hard: number }>;
  /** Divisions tuées ou en fuite pendant le cycle : elles ne reçoivent plus de dégâts, mais tirent jusqu'à sa fin. */
  readonly out: Set<Division>;
  /** Renforts montés pendant le cycle, par joueur et niche (clé `joueur:niche`), dans leur ordre d'arrivée. */
  readonly reinforced: Map<string, Division[]>;
  /** Seconde ligne d'un joueur pour une niche, dans l'ordre de choix ; `null` : pas de renfort (percée). */
  readonly reserves: ((owner: number, niche: number) => Division[]) | null;
}

/** Un cycle neuf : attaques figées des divisions de `fighters`, prises avec les multiplicateurs de `fight`. */
function newCycle(fight: Omit<Fight, "attack">, fighters: readonly Division[], reserves: CycleState["reserves"]): CycleState {
  const attack = new Map<Division, { soft: number; hard: number }>();
  for (const d of fighters) attack.set(d, attackOf(d, fight.attackMult(d), fight.width(d), fight.fullWidth(d)));
  return { attack, out: new Set(), reinforced: new Map(), reserves };
}

const NO_ATTACK = { soft: 0, hard: 0 } as const;

/**
 * Une division prend des pertes d'un reste `left` (10-Combat-Phases §2) : si elles suffisent à la tuer, elle les prend
 * jusqu'à 0 ; sinon, jusqu'à l'état de fuite ; sinon, tout. Tuée ou en fuite, elle sort du cycle (`cycle.out`).
 * Ajoute ses pertes à `out` et renvoie le reste.
 */
function absorb(d: Division, left: number, out: Map<Division, number>, cycle: CycleState): number {
  const kill = stateOf(d) * LOSS_PER_STATE;
  if (left >= kill) {
    out.set(d, (out.get(d) ?? 0) + kill);
    cycle.out.add(d);
    return left - kill;
  }
  const toFlee = Math.max(0, stateOf(d) - FLEE_STATE) * LOSS_PER_STATE;
  if (toFlee > 0 && left >= toFlee) {
    out.set(d, (out.get(d) ?? 0) + toFlee);
    cycle.out.add(d);
    return left - toFlee;
  }
  out.set(d, (out.get(d) ?? 0) + left);
  return 0;
}

/**
 * Concentration des pertes d'un tir (10-Combat-Phases §2). `spread` : pertes de chaque division calculées par `strike`
 * (part de sa largeur engagée, tuées et fuyardes du cycle comprises), multipliées par `roundsPerCycle` et par
 * `devDamageMultiplier` (temporaire). Leur somme par type de division est reportée sur les divisions de ce type encore
 * dans le cycle, la plus abîmée d'abord (égalité : tirage du générateur de la partie), avec `absorb`. Ce qui reste quand
 * il n'y en a plus va aux renforts de la niche (`cycle.reserves`) : d'abord ceux déjà montés pendant le cycle, puis la
 * seconde ligne dans l'ordre de choix ; chaque division prise monte en première ligne. Ce qui dépasse est perdu.
 * Types dans l'ordre de leur première division par identifiant, niches par indice. Renvoie les pertes, dans l'ordre où
 * elles sont prises, et les renforts montés par ce tir.
 */
function concentrate(state: GameState, spread: ReadonlyMap<Division, number>, cycle: CycleState): { losses: Map<Division, number>; arrived: Division[] } {
  const pools = new Map<number, { pool: number; divs: Division[] }>();
  for (const d of [...spread.keys()].sort((a, b) => a.id - b.id)) {
    const g = pools.get(d.type) ?? { pool: 0, divs: [] };
    g.pool += spread.get(d)! * FRONTS.roundsPerCycle * FRONTS.devDamageMultiplier;
    g.divs.push(d);
    pools.set(d.type, g);
  }
  const losses = new Map<Division, number>();
  const overflow = new Map<number, { owner: number; left: number }>();
  for (const { pool, divs } of pools.values()) {
    if (pool <= 0) continue;
    let left = pool;
    for (const d of byDamage(state, divs.filter((x) => !cycle.out.has(x)))) {
      if (left <= 0) break;
      left = absorb(d, left, losses, cycle);
    }
    if (left <= 0) continue;
    const niche = dataOf(divs[0]!).niche;
    const o = overflow.get(niche) ?? { owner: divs[0]!.owner, left: 0 };
    o.left += left;
    overflow.set(niche, o);
  }
  const arrived: Division[] = [];
  if (cycle.reserves === null) return { losses, arrived };
  for (const [niche, { owner, left }] of [...overflow].sort((a, b) => a[0] - b[0])) {
    const key = `${owner}:${niche}`;
    const up = cycle.reinforced.get(key) ?? [];
    cycle.reinforced.set(key, up);
    let rest = left;
    for (const d of up) {
      if (rest <= 0) break;
      if (!cycle.out.has(d)) rest = absorb(d, rest, losses, cycle);
    }
    for (const d of cycle.reserves(owner, niche)) {
      if (rest <= 0) break;
      // Renfort : il monte en première ligne ; le rangement de fin de cycle lui donne sa largeur.
      d.line = LINE_FIRST;
      up.push(d);
      arrived.push(d);
      rest = absorb(d, rest, losses, cycle);
    }
  }
  return { losses, arrived };
}

/** Divisions de la plus abîmée à la moins abîmée ; à état égal, ordre tiré par le générateur de la partie (mélange de Fisher-Yates). */
function byDamage(state: GameState, divs: readonly Division[]): Division[] {
  const sorted = [...divs].sort((a, b) => stateOf(a) - stateOf(b) || a.id - b.id);
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && stateOf(sorted[j]!) === stateOf(sorted[i]!)) j++;
    for (let k = j - 1; k > i; k--) {
      const r = i + nextInt(state.rng, k - i + 1);
      [sorted[k], sorted[r]] = [sorted[r]!, sorted[k]!];
    }
    i = j;
  }
  return sorted;
}

/**
 * Un tir (10-Combat-Phases §1, §2) : `shooters`, une niche d'un camp telle qu'au début du cycle, frappent `targets`,
 * les divisions engagées de l'autre camp au début du cycle, avec les attaques figées du cycle. Pertes réparties entre
 * niches comme au 05-Fronts §6.2 et §6.3, concentrées (`concentrate`, renforts compris) et appliquées tout de suite ;
 * les divisions tuées et en fuite restent jusqu'à la fin du cycle (`endCycle`). Renvoie le tir pour le rapport.
 */
function shoot(
  state: GameState,
  front: Front,
  fight: Fight,
  cycle: CycleState,
  record: CombatRecord,
  niche: number,
  shooters: readonly Division[],
  targets: readonly Division[],
  firstLine: (d: Division) => boolean,
): CombatShot {
  const spread = new Map<Division, number>();
  strike(fight, shooters, targets, spread);
  const { losses, arrived } = concentrate(state, spread, cycle);
  const shotBy = snapshot(record, shooters).index;
  const reinforced = snapshot(record, arrived).index;
  const hitDivs = [...losses.keys()].filter((d) => losses.get(d)! > 0);
  const { before, index } = snapshot(record, hitDivs);
  applyLosses(state, front, record, losses, firstLine);
  const destroyed: number[] = [];
  const fled: number[] = [];
  const hits = hitDivs.map((d, k): [number, number] => {
    if (isEmpty(d)) destroyed.push(index[k]!);
    else if (stateOf(d) <= FLEE_STATE) fled.push(index[k]!);
    return [index[k]!, Math.max(0, before[k]! - stateOf(d))];
  });
  return { owner: shooters[0]!.owner, niche, shooters: shotBy, reinforced, hits, destroyed, fled };
}

/** Fin d'un cycle (10-Combat-Phases §1) : les divisions tuées pendant le cycle sont retirées, puis les fuites (`flee`). */
function endCycle(state: GameState, front: Front, flee: () => void): void {
  removeDestroyed(
    state,
    state.divisions.filter((d) => d.front === front.id),
  );
  flee();
}

/**
 * Les percées d'un front, tous les `combatTurns` tours (05-Fronts §7.2) : fin des délais, puis chaque combat qui vient de
 * commencer (contre la première ligne, ou contre la réaction rapide) est résolu en entier dans ce tour
 * (06-Combat-Simplifie §1). Renvoie les connexions arrivées au bout de leur route (chute d'une ville).
 */
function fightFront(state: GameState, front: Front): Arrival[] {
  const arrivals: Arrival[] = [];
  endDelays(state, front, arrivals);
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && isBreakthroughCombat(b.phase)).sort((a, b) => a.id - b.id)) {
    resolveBreakthroughCombat(state, front, bt);
  }
  // Pendant un délai : l'axe a pu disparaître.
  for (const bt of state.breakthroughs.filter((b) => b.front === front.id && b.phase > 0).sort((a, b) => a.id - b.id)) checkBreakthrough(state, front, bt);
  return arrivals;
}

/**
 * Combat d'une percée, résolu en entier dans ce tour (06-Combat-Simplifie §1, 10-Combat-Phases §1) : jusqu'à
 * `FRONTS.combatCycles` cycles. Dans chaque phase, la niche du défenseur tire, puis celle de la percée. La force qui perce
 * a `breakthroughMultiplier` ; la tranche de première ligne n'a pas de multiplicateur, la force de contre-attaque
 * `counterAttackMultiplier` ; le défenseur a ses PV de défense. En fin de cycle, vérifications de la percée
 * (`checkBreakthrough` : première ligne percée, réaction rapide battue, force détruite ou essoufflée). La force de
 * contre-attaque est choisie au début : ni renfort ni remplacement. Sans issue au bout des cycles : échec (provisoire).
 * Le rapport est gardé s'il y avait des divisions des deux camps.
 */
function resolveBreakthroughCombat(state: GameState, front: Front, bt: Breakthrough): void {
  const defender = front.players.find((p) => p !== bt.owner)!;
  const phase = bt.phase;
  const record = newRecord(state, front, phase === 1 ? "breakthrough" : "counter", bt.owner, defender, bt.city1, bt.city2);
  for (const s of front.sides) s.lastLossByNiche.fill(0);
  if (phase === 3) assignCounterForces(state, front);
  snapshot(record, [...forceOf(state, bt, true), ...forceOf(state, bt, false)].sort((a, b) => a.id - b.id));
  const fight: Omit<Fight, "attack"> = {
    // Une percée se bat sur une liaison, tranche de première ligne comprise.
    frontWidth: WIDTH_SCALE,
    width: (d) => d.btEngaged,
    // Force qui perce et force de contre-attaque : `breakthroughWidth` ; tranche de première ligne : `frontWidth`.
    fullWidth: (d) => (d.owner !== bt.owner && phase === 1 ? dataOf(d).width : dataOf(d).breakthroughWidth),
    attackMult: (d) => (d.owner === bt.owner ? dataOf(d).breakthroughMultiplier : phase === 3 ? dataOf(d).counterAttackMultiplier : MULT_SCALE),
    hpMult: (d) => (d.owner === bt.owner ? MULT_SCALE : dataOf(d).defenseHitPointsMultiplier),
  };
  // État perdu par la première ligne de chaque camp (05-Fronts §11.4) : la tranche de première ligne.
  const firstLine = (d: Division): boolean => d.line === LINE_FIRST && d.front === front.id;
  const flee = (): void => {
    applyFlight(state, front);
    breakthroughFlight(state, front);
  };
  let going = true;
  for (let c = 0; c < FRONTS.combatCycles && going; c++) {
    // Forces du début du cycle : elles tirent toutes jusqu'à sa fin ; ni renfort ni remplacement.
    const sides = [forceOf(state, bt, false), forceOf(state, bt, true)] as const;
    const cycle = newCycle(fight, [...sides[0], ...sides[1]], null);
    const cycleFight: Fight = { ...fight, attack: (d) => cycle.attack.get(d) ?? NO_ATTACK };
    const shots: CombatShot[] = [];
    for (const niche of PHASE_NICHES) {
      for (const k of [0, 1] as const) {
        const shooters = sides[k].filter((d) => dataOf(d).niche === niche);
        const targets = sides[1 - k]!;
        if (shooters.length === 0 || targets.length === 0) continue;
        shots.push(shoot(state, front, cycleFight, cycle, record, niche, shooters, targets, firstLine));
      }
    }
    endCycle(state, front, flee);
    const advance = bt.advance;
    checkBreakthrough(state, front, bt);
    // Avancée du cycle : le saut, quand la première ligne est percée.
    record.cycles.push({ shots, arrived: [], fled: [], withdrawn: [], advance: bt.advance - advance });
    going = state.breakthroughs.includes(bt) && bt.phase === phase;
  }
  if (going) failBreakthroughCombat(state, front, bt);
  // Première ligne percée : délai avant le combat 2 ; réaction rapide battue : délai avant la chute de la ville.
  record.success = state.breakthroughs.includes(bt) && (bt.phase === 2 || bt.phase === 4);
  removeEmptyBoxes(state);
  if (record.units.some((u) => u.owner === bt.owner) && record.units.some((u) => u.owner === defender)) {
    state.combats.push(record);
    trimCombats(state);
  }
}

/** Un rapport de combat vide, avec le prochain identifiant. */
function newRecord(state: GameState, front: Front, kind: CombatKind, attacker: number, defender: number, city1: number, city2: number): CombatRecord {
  return {
    id: state.nextCombatId++,
    kind,
    front: front.id,
    tick: currentTurn(state),
    attacker,
    defender,
    city1,
    city2,
    units: [],
    cycles: [],
    losses: [noCombatLosses(), noCombatLosses()],
    captured: 0,
    success: false,
  };
}

/**
 * Indices dans `record.units` des divisions (ajoutées à leur première apparition, `reserve` : en seconde ligne au début
 * du combat), et leur état avant le tir.
 */
function snapshot(record: CombatRecord, divs: readonly Division[], reserve = false): { before: number[]; index: number[] } {
  const before = divs.map((d) => stateOf(d));
  const index = divs.map((d) => {
    let i = record.units.findIndex((u) => u.division === d.id);
    if (i < 0) {
      i = record.units.length;
      record.units.push({ division: d.id, owner: d.owner, type: d.type, start: stateOf(d), reserve });
    }
    return i;
  });
  return { before, index };
}

/**
 * Applique des pertes, divisions par identifiant, et les ajoute aux pertes du rapport (état perdu, divisions
 * détruites) et aux blessés (08 §8). `firstLine(d)` : l'état perdu par `d` compte dans `lastLossByNiche` (05-Fronts §11.4). Renvoie les divisions
 * touchées.
 */
function applyLosses(state: GameState, front: Front, record: CombatRecord, losses: ReadonlyMap<Division, number>, firstLine: (d: Division) => boolean): Division[] {
  const hit = [...losses.keys()].sort((a, b) => a.id - b.id);
  for (const d of hit) {
    const lostState = applyLoss(d, Math.min(LOSS_SCALE, losses.get(d)!));
    const wounded = woundMen(state.players[d.owner - 1]!, d.type, lostState);
    if (firstLine(d)) {
      const byNiche = front.sides[front.players.indexOf(d.owner)]!.lastLossByNiche;
      byNiche[dataOf(d).niche] = byNiche[dataOf(d).niche]! + lostState;
    }
    const lost = record.losses[d.owner === record.attacker ? 0 : 1];
    lost.state += lostState;
    lost.wounded += wounded;
    if (isEmpty(d)) lost.divisions++;
  }
  return hit;
}

/**
 * Repli faute d'infanterie (06-Combat-Simplifie §1), en fin de cycle : un camp sans infanterie engagée en première ligne
 * replie toutes ses autres divisions de première ligne en seconde ligne, en fuite jusqu'à la fin du combat. Renvoie les
 * indices (dans `record.units`) des divisions repliées et les camps concernés.
 */
function withdrawWithoutInfantry(state: GameState, front: Front, record: CombatRecord): { fled: number[]; withdrawn: number[] } {
  const fled: number[] = [];
  const withdrawn: number[] = [];
  const until = currentTurn(state) + FRONTS.combatCycles * FRONTS.roundsPerCycle * FRONTS.combatTurns;
  for (const p of front.players) {
    const inLine = engagedOf(sideDivisions(state, front, p));
    if (inLine.length === 0 || infantryWidth(inLine) > 0) continue;
    for (const d of inLine) {
      fled.push(snapshot(record, [d]).index[0]!);
      d.line = LINE_SECOND;
      d.engaged = 0;
      d.breakthrough = 0;
      d.btEngaged = 0;
      d.fleeUntilTick = until;
    }
    withdrawn.push(p);
  }
  return { fled, withdrawn };
}

/** Une division d'un rapport de combat, telle qu'au début du combat. */
export interface CombatUnit {
  readonly division: number;
  readonly owner: number;
  /** Indice du type (ordre des clés de `DIVISIONS`). */
  readonly type: number;
  /** État au début du combat, échelle `STATE_SCALE`. */
  readonly start: number;
  /** En seconde ligne au début du combat : renfort possible (attaque sur tout le front, 10-Combat-Phases §3). */
  readonly reserve: boolean;
}

/** Un tir d'un rapport de combat (10-Combat-Phases §1) : une niche d'un camp tire sur l'autre camp. */
export interface CombatShot {
  /** Le joueur qui tire. */
  readonly owner: number;
  /** Indice de la niche qui tire (ordre de `NICHES`). */
  readonly niche: number;
  /** Divisions qui tirent (indices dans `units`). */
  readonly shooters: readonly number[];
  /**
   * Renforts montés de la seconde ligne pendant ce tir, pour prendre les pertes que la première ligne ne pouvait plus
   * prendre (indices dans `units`, dans leur ordre d'arrivée ; 10-Combat-Phases §2). Ils sont aussi dans `hits`.
   */
  readonly reinforced: readonly number[];
  /** Divisions touchées : [indice dans `units`, perte d'état (échelle `STATE_SCALE`)], dans l'ordre où elles prennent les pertes. */
  readonly hits: readonly (readonly [number, number])[];
  /** Divisions tuées par ce tir (indices dans `units`) ; retirées à la fin du cycle. */
  readonly destroyed: readonly number[];
  /** Divisions en fuite après ce tir (indices dans `units`, 10-Combat-Phases §2) ; elles quittent la ligne à la fin du cycle. */
  readonly fled: readonly number[];
}

/** Un cycle d'un rapport de combat : ses tirs dans l'ordre, puis ce qui se passe en fin de cycle. */
export interface CombatCycle {
  readonly shots: readonly CombatShot[];
  /** Renforts montés de la seconde ligne en fin de cycle (attaque sur tout le front) : ils combattent au cycle suivant. */
  readonly arrived: readonly number[];
  /** Divisions repliées en fin de cycle faute d'infanterie (indices dans `units`). */
  readonly fled: readonly number[];
  /** Camps (joueurs) qui se replient en fin de cycle faute d'infanterie : leurs divisions sont dans `fled`. */
  readonly withdrawn: readonly number[];
  /** Avancée de l'attaquant pendant ce cycle, en millièmes de route. */
  readonly advance: number;
}

/**
 * Pertes d'un camp sur tout un combat (08 §11, provisoire) : divisions détruites, état perdu (échelle `STATE_SCALE`,
 * toutes divisions), et bonshommes blessés (08 §8, résumé du combat, 10-Combat-Phases §4).
 */
export interface CombatLosses {
  divisions: number;
  state: number;
  wounded: number;
}

/**
 * Type d'un combat (06-Combat-Simplifie §1) : attaque sur tout le front ; percée, combat contre la tranche de première
 * ligne ; contre-attaque, combat de la percée contre la réaction rapide (05-Fronts §7.2).
 */
export type CombatKind = "front" | "breakthrough" | "counter";

/** Rapport d'un combat (06-Combat-Simplifie §1, 10-Combat-Phases), pour les fenêtres de combat. Le moteur ne le relit pas. */
export interface CombatRecord {
  readonly id: number;
  readonly kind: CombatKind;
  readonly front: number;
  /** Tour où le combat a été résolu. */
  readonly tick: number;
  /** Le joueur qui attaque sur tout le front, ou qui perce (contre-attaque comprise). */
  readonly attacker: number;
  readonly defender: number;
  /** Connexion au milieu de laquelle le client place l'icône du combat : l'axe d'une percée, la première du front sinon. */
  readonly city1: number;
  readonly city2: number;
  readonly units: CombatUnit[];
  readonly cycles: CombatCycle[];
  /** Pertes de l'attaquant puis du défenseur. */
  readonly losses: readonly [CombatLosses, CombatLosses];
  /** Ville prise à la fin du combat, 0 sinon. */
  captured: number;
  /**
   * Issue pour l'attaquant : attaque sur tout le front, le front a avancé ; percée, la première ligne est percée ;
   * contre-attaque, la réaction rapide est battue (la ville tombera après le délai).
   */
  success: boolean;
}

/** Avance le front de `by` millièmes dans le sens de `front.players[x]`. Renvoie les connexions arrivées au bout. */
function advanceFront(front: Front, x: number, by: number): Arrival[] {
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

const noCombatLosses = (): CombatLosses => ({ divisions: 0, state: 0, wounded: 0 });

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
 * Un cycle de l'attaque sur tout le front de `front.players[x]` (10-Combat-Phases §1), ajouté à `record`. Renvoie les
 * connexions arrivées au bout de leur route.
 * - Défenseur sans infanterie engagée : il ne combat plus, le cycle n'est qu'une avancée à la vitesse maximale de
 *   l'attaquant (06-Combat-Simplifie §1), après le repli de ce qui lui reste en première ligne.
 * - Sinon, pour chaque niche dans l'ordre de tir : la niche du défenseur tire, puis celle de l'attaquant (l'attaquant
 *   avec `attackMultiplier`, le défenseur avec ses PV de défense). Puis fin de cycle : avancée (05-Fronts §7.1, sans
 *   échange), rangement des lignes (les renforts montent de la seconde ligne et combattent au cycle suivant), repli
 *   faute d'infanterie.
 */
function frontAttackCycle(state: GameState, front: Front, x: number, record: CombatRecord): Arrival[] {
  const att = front.players[x]!;
  const def = front.players[1 - x]!;
  const fighting = (p: number): Division[] => engagedOf(sideDivisions(state, front, p));
  if (infantryWidth(fighting(def)) === 0) {
    const out = withdrawWithoutInfantry(state, front, record);
    const by = FRONTS.roundsPerCycle * frontSpeed(fighting(att));
    record.cycles.push({ shots: [], arrived: [], fled: out.fled, withdrawn: out.withdrawn, advance: by });
    return advanceFront(front, x, by);
  }
  const fight: Omit<Fight, "attack"> = {
    frontWidth: frontWidth(front),
    width: (d) => d.engaged,
    fullWidth: (d) => dataOf(d).width,
    attackMult: (d) => (d.owner === att ? dataOf(d).attackMultiplier : MULT_SCALE),
    hpMult: (d) => (d.owner === att ? MULT_SCALE : dataOf(d).defenseHitPointsMultiplier),
  };
  // Premières lignes du début du cycle : elles tirent et reçoivent leur part des dégâts jusqu'à sa fin.
  const lines = new Map<number, Division[]>([
    [def, fighting(def)],
    [att, fighting(att)],
  ]);
  // Renforts (10-Combat-Phases §2) : la seconde ligne de la niche, disponible, dans l'ordre de choix.
  const reserves = (owner: number, niche: number): Division[] =>
    sideDivisions(state, front, owner)
      .filter((d) => d.line === LINE_SECOND && !isFleeing(state, d) && dataOf(d).niche === niche)
      .sort(byChoice);
  const cycle = newCycle(fight, [...lines.get(def)!, ...lines.get(att)!], reserves);
  const cycleFight: Fight = { ...fight, attack: (d) => cycle.attack.get(d) ?? NO_ATTACK };
  const shots: CombatShot[] = [];
  for (const niche of PHASE_NICHES) {
    for (const p of [def, att]) {
      const shooters = lines.get(p)!.filter((d) => dataOf(d).niche === niche);
      const targets = lines.get(p === att ? def : att)!;
      if (shooters.length === 0 || targets.length === 0) continue;
      shots.push(shoot(state, front, cycleFight, cycle, record, niche, shooters, targets, () => true));
    }
  }
  endCycle(state, front, () => applyFlight(state, front));
  // Rangement des lignes (05-Fronts §4.2, sans échange §5.3) : les renforts montés pendant le cycle prennent leur
  // largeur, et les places encore libres sont reprises par la seconde ligne.
  const before = new Set(state.divisions.filter((d) => d.front === front.id && d.line === LINE_FIRST).map((d) => d.id));
  for (const p of front.players) arrangeSide(state, front, p);
  // Avancée (05-Fronts §7.1, provisoire) : `roundsPerCycle` rounds, sur la première ligne de la fin du cycle, renforts du
  // cycle compris, sans les divisions qui viennent de monter au rangement.
  const advancing = (p: number): Division[] => fighting(p).filter((d) => before.has(d.id));
  const by = FRONTS.roundsPerCycle * frontAdvance(infantryWidth(advancing(att)), infantryWidth(advancing(def)), frontSpeed(advancing(att)));
  const arrived: number[] = [];
  for (const d of state.divisions) {
    if (d.front !== front.id || d.line !== LINE_FIRST || d.engaged === 0 || before.has(d.id)) continue;
    arrived.push(snapshot(record, [d]).index[0]!);
  }
  const out = withdrawWithoutInfantry(state, front, record);
  // Un renfort monté ce cycle puis replié ne compte plus comme renfort.
  const gone = new Set(out.fled);
  record.cycles.push({ shots, arrived: arrived.filter((i) => !gone.has(i)), fled: out.fled, withdrawn: out.withdrawn, advance: by });
  return advanceFront(front, x, by);
}

/**
 * Attaque sur tout le front du camp `x` de `front`, résolue en entier (06-Combat-Simplifie §1, 10-Combat-Phases §1) :
 * jusqu'à `FRONTS.combatCycles` cycles, jusqu'à ce que l'attaquant n'ait plus d'infanterie engagée en fin de cycle, ou
 * jusqu'à une prise de ville. Le camp ne peut pas en relancer une avant `FRONTS.attackCooldownTurns` tours.
 */
function resolveFrontAttack(state: GameState, front: Front, x: number, changed: number[]): void {
  front.sides[x]!.attackReadyAt = currentTurn(state) + FRONTS.attackCooldownTurns;
  for (const s of front.sides) s.lastLossByNiche.fill(0);
  const first = front.connections[0]!;
  const record = newRecord(state, front, "front", front.players[x]!, front.players[1 - x]!, first.city1, first.city2);
  // Divisions du début : premières lignes engagées, puis secondes lignes (renforts possibles).
  for (const p of front.players) snapshot(record, engagedOf(sideDivisions(state, front, p)));
  for (const p of front.players) snapshot(record, sideDivisions(state, front, p).filter((d) => d.line === LINE_SECOND && !isFleeing(state, d)), true);
  let arrivals: Arrival[] = [];
  for (let c = 0; c < FRONTS.combatCycles; c++) {
    if (infantryWidth(engagedOf(sideDivisions(state, front, front.players[x]!))) === 0) break;
    const got = frontAttackCycle(state, front, x, record);
    if (got.length > 0) {
      arrivals = got;
      break;
    }
  }
  record.captured = captureArrivals(state, arrivals, changed);
  record.success = record.captured !== 0 || record.cycles.some((c) => c.advance > 0);
  removeEmptyBoxes(state);
  if (record.cycles.length > 0) state.combats.push(record);
}

/**
 * Attaques sur tout le front ordonnées ce tour (`FrontSide.attackAt` égal au tour courant), fronts par identifiant,
 * camps 0 puis 1 : chacune est résolue en entier dans ce tour (`resolveFrontAttack`). Appelée par `applyTurn` après le
 * rangement des lignes, pour que les divisions placées ce tour combattent.
 */
export function resolveFrontAttacks(state: GameState, changed: number[]): void {
  const now = currentTurn(state);
  const due: { front: number; x: number }[] = [];
  for (const front of state.fronts) {
    for (let x = 0; x < 2; x++) {
      const s = front.sides[x]!;
      if (s.attackAt !== now) continue;
      s.attackAt = 0;
      if (isActive(state, front)) due.push({ front: front.id, x });
    }
  }
  for (const { front: id, x } of due) {
    // Une prise d'un combat précédent a pu recalculer les fronts.
    const front = state.fronts.find((f) => f.id === id);
    if (front === undefined || !isActive(state, front)) continue;
    resolveFrontAttack(state, front, x, changed);
  }
  if (due.length > 0) trimCombats(state);
}

/**
 * Percées de tous les fronts (fin des délais, combats résolus en un tour), puis les prises de villes (05-Fronts §13.2).
 * Appelée par `applyTurn` quand le numéro du tour est un multiple de `combatTurns`. `lastLossByNiche` garde les pertes
 * du dernier combat du front : remis à zéro au début de chaque combat, pas ici.
 */
export function combatRound(state: GameState, changed: number[]): void {
  const pending: Arrival[] = [];
  for (const front of state.fronts) {
    if (hasRound(state, front)) pending.push(...fightFront(state, front));
  }
  captureArrivals(state, pending, changed);
  removeEmptyBoxes(state);
}
