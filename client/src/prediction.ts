// Estimation d'un combat, pour le panneau de prédiction de la fenêtre d'un front (Docs/Design/05-Fronts.md §11.4). Pas de DOM,
// aucune règle : la page rejoue les formules du moteur (`strike`, `concentrate`, `frontAdvance` dans `packages/engine/src/combat.ts`),
// en flottants. Les combats sont joués cycle par cycle (Docs/Design/10-Combat-Phases.md) : cinq phases (chars, infanterie,
// antichar, antiaérien, artillerie), la niche du défenseur avant celle de l'attaquant, pertes concentrées sur la division la
// plus abîmée de chaque type, fuite à `fleeStatePercent` ; attaques figées au début du cycle, tuées et fuyardes retirées à la fin, reste des pertes d'une niche aux renforts. Une attaque sur tout le front ajoute avancée, renforts et replis en
// fin de cycle ; un combat de percée, sans renfort, s'arrête quand une infanterie a quitté la ligne. Sans tirage : à état égal,
// l'ordre des divisions décide. Une estimation, jamais utilisée par le moteur.

import { type DivisionView, type MilitaryCatalog } from "./protocol.ts";

/** Millièmes de liaison dans une liaison (`WIDTH_SCALE` du moteur). */
const WIDTH_SCALE = 1000;

/** Rapport de pertes à partir duquel une position est dominante ou perdante (05-Fronts §11.4, provisoire). */
export const POSITION_RATIO = 2;

export type Verdict = "dominant" | "balanced" | "losing";
export type BreakthroughVerdict = "likely" | "uncertain" | "unlikely";

/** Groupes de niches d'une ligne du panneau. */
export const LOSS_GROUPS = ["infantry", "armor", "support"] as const;
export type LossGroup = (typeof LOSS_GROUPS)[number];

/** Ce qu'un camp perd, en % de ses divisions engagées ; `null` : aucune division de ce groupe. */
export interface SideEstimate {
  readonly total: number;
  readonly groups: Readonly<Record<LossGroup, number | null>>;
  /** Divisions qui atteignent leur seuil de fuite. */
  readonly routs: number;
}

export interface FightEstimate {
  readonly attacker: SideEstimate;
  readonly defender: SideEstimate;
  /** Camp dont l'infanterie cède la première ; `null` : aucune avant la fin du combat. */
  readonly cedes: "attacker" | "defender" | null;
}

export interface FrontEstimate extends FightEstimate {
  /** Cycles de combat joués. */
  readonly cycles: number;
  /** Avancée de l'attaquant, en % de la route. */
  readonly advance: number;
  readonly verdict: Verdict;
}

export interface BreakthroughEstimate {
  readonly first: FightEstimate;
  /** Contre-attaque ; `null` si le combat 1 est perdu. */
  readonly second: FightEstimate | null;
  readonly verdict: BreakthroughVerdict;
}

/** Une division dans un combat : largeurs en millièmes de liaison, multiplicateurs à l'échelle 100, état de 0 à 1. */
interface Fighter {
  readonly d: DivisionView;
  width: number;
  readonly full: number;
  readonly attackMult: number;
  readonly hpMult: number;
  state: number;
}

/** Ordre de tir d'un cycle (10-Combat-Phases §1) : les identifiants des niches. */
const PHASES = ["tanks", "infantry", "antiTank", "antiAir", "artillery"] as const;

/** Un camp dans un combat : ses divisions en ligne, ce qu'elles ont perdu, les fuites. */
interface Side {
  /** En ligne : tirent et reçoivent. */
  fighters: Fighter[];
  /** Toutes les divisions qui ont pris part au combat, et ce que chacune a perdu (fraction de barre). */
  readonly lost: Map<Fighter, number>;
  routs: number;
  /** Divisions de seconde ligne prêtes à monter, les meilleures d'abord ; vide en percée (pas de renfort). */
  readonly reserve: DivisionView[];
  /** Crée le combattant d'une division qui monte en première ligne (largeur donnée en fin de cycle). */
  readonly mount: ((d: DivisionView) => Fighter) | null;
  /** Première ligne au début du cycle : elle tire et reçoit sa part jusqu'à la fin du cycle. */
  start: Fighter[];
  /** Renforts montés pendant le cycle, par niche, dans leur ordre d'arrivée. */
  up: Map<string, Fighter[]>;
}

const newSide = (fighters: Fighter[], reserve: DivisionView[] = [], mount: Side["mount"] = null): Side => ({
  fighters,
  lost: new Map(fighters.map((f) => [f, 0])),
  routs: 0,
  reserve,
  mount,
  start: [],
  up: new Map(),
});

/** Ce qui vaut pour tout un cycle : attaques figées au début, divisions tuées ou en fuite (elles tirent quand même jusqu'à la fin). */
interface Cycle {
  readonly attack: Map<Fighter, { readonly soft: number; readonly hard: number }>;
  readonly out: Set<Fighter>;
}

const groupOf = (military: MilitaryCatalog, d: DivisionView): LossGroup => {
  const niche = military.divisions[d.type]!.niche;
  return niche === "infantry" ? "infantry" : niche === "tanks" ? "armor" : "support";
};

const infantryOf = (military: MilitaryCatalog, side: readonly Fighter[]): Fighter[] => side.filter((f) => groupOf(military, f.d) === "infantry");

/** Début d'un cycle : première ligne et attaques de chaque camp figées (`newCycle` du moteur). */
function startCycle(military: MilitaryCatalog, sides: readonly Side[]): Cycle {
  const attack = new Map<Fighter, { soft: number; hard: number }>();
  for (const side of sides) {
    side.start = [...side.fighters];
    side.up = new Map();
    for (const f of side.start) {
      const type = military.divisions[f.d.type]!;
      const k = (f.width / f.full) * f.state * (f.attackMult / 100);
      attack.set(f, { soft: type.softAttack * k, hard: type.hardAttack * k });
    }
  }
  return { attack, out: new Set() };
}

/** Part de barre reçue par chaque division de `to` sous le tir de `from`, pour un ancien round : `strike` du moteur, sans arrondi. */
function strike(military: MilitaryCatalog, cycle: Cycle, from: readonly Fighter[], to: readonly Fighter[], frontWidth: number): Map<Fighter, number> {
  const rates = new Map<Fighter, number>();
  let soft = 0;
  let hard = 0;
  for (const f of from) {
    soft += cycle.attack.get(f)!.soft;
    hard += cycle.attack.get(f)!.hard;
  }
  if (soft === 0 && hard === 0) return rates;
  let total = 0;
  let tanks = 0;
  for (const f of to) {
    const type = military.divisions[f.d.type]!;
    if (type.support) continue;
    total += f.width;
    if (type.niche !== "infantry") tanks += f.width;
  }
  for (const f of to) {
    const type = military.divisions[f.d.type]!;
    const mixed = (type.armorPercent * hard + (100 - type.armorPercent) * soft) / 100;
    const received = type.support ? (mixed * f.width * WIDTH_SCALE) / (f.full * (frontWidth + tanks)) : total === 0 ? 0 : (mixed * f.width) / total;
    rates.set(f, received / ((type.hitPoints * f.hpMult) / 100));
  }
  return rates;
}

/**
 * Une division prend des pertes d'un reste `left` : `absorb` du moteur. Tuée si elles suffisent, sinon amenée au seuil de
 * fuite si elles suffisent, sinon elle prend tout. Tuée ou en fuite, elle sort du cycle. Renvoie le reste.
 */
function absorb(military: MilitaryCatalog, side: Side, cycle: Cycle, f: Fighter, left: number): number {
  const flee = military.fleeStatePercent / 100;
  const toFlee = Math.max(0, f.state - flee);
  const gone = left >= f.state;
  const hit = gone ? f.state : toFlee > 0 && left >= toFlee ? toFlee : left;
  f.state -= hit;
  side.lost.set(f, side.lost.get(f)! + hit);
  if (gone || (toFlee > 0 && left >= toFlee)) {
    cycle.out.add(f);
    return left - hit;
  }
  return 0;
}

/**
 * Un tir : les divisions de `niche` de la première ligne de `shooter` (au début du cycle) frappent la première ligne de
 * `target`. Les pertes de chaque type de division (×`roundsPerCycle`) vont à la plus abîmée de ses divisions encore dans le
 * cycle, la suivante prenant le reste. Ce qui reste d'une niche va aux renforts : ceux déjà montés, puis la seconde ligne
 * de la niche, qui monte (`concentrate` du moteur). Sans tirage : à état égal, l'ordre des divisions.
 */
function shoot(military: MilitaryCatalog, niche: string, cycle: Cycle, shooter: Side, target: Side, frontWidth: number): void {
  const shooters = shooter.start.filter((f) => military.divisions[f.d.type]!.niche === niche);
  if (shooters.length === 0 || target.start.length === 0) return;
  const spread = strike(military, cycle, shooters, target.start, frontWidth);
  const pools = new Map<number, { pool: number; fighters: Fighter[] }>();
  for (const f of [...spread.keys()].sort((a, b) => a.d.id - b.d.id)) {
    const g = pools.get(f.d.type) ?? { pool: 0, fighters: [] };
    g.pool += spread.get(f)! * military.roundsPerCycle;
    g.fighters.push(f);
    pools.set(f.d.type, g);
  }
  const overflow = new Map<string, number>();
  for (const { pool, fighters } of pools.values()) {
    if (pool <= 0) continue;
    let left = pool;
    for (const f of [...fighters].filter((x) => !cycle.out.has(x)).sort((a, b) => a.state - b.state || a.d.id - b.d.id)) {
      if (left <= 0) break;
      left = absorb(military, target, cycle, f, left);
    }
    if (left <= 0) continue;
    const key = military.divisions[fighters[0]!.d.type]!.niche;
    overflow.set(key, (overflow.get(key) ?? 0) + left);
  }
  if (target.mount === null) return;
  for (const [key, left] of overflow) {
    const up = target.up.get(key) ?? [];
    target.up.set(key, up);
    let rest = left;
    for (const f of up) {
      if (rest <= 0) break;
      if (!cycle.out.has(f)) rest = absorb(military, target, cycle, f, rest);
    }
    for (const d of target.reserve.filter((x) => military.divisions[x.type]!.niche === key)) {
      if (rest <= 0) break;
      target.reserve.splice(target.reserve.indexOf(d), 1);
      const f = target.mount(d);
      target.lost.set(f, 0);
      up.push(f);
      rest = absorb(military, target, cycle, f, rest);
    }
  }
}

/** Les cinq phases d'un cycle : dans chacune, la niche du défenseur tire, puis celle de l'attaquant. */
function playPhases(military: MilitaryCatalog, cycle: Cycle, attacker: Side, defender: Side, frontWidth: number): void {
  for (const niche of PHASES) {
    shoot(military, niche, cycle, defender, attacker, frontWidth);
    shoot(military, niche, cycle, attacker, defender, frontWidth);
  }
}

/**
 * Fin de cycle, première partie (`endCycle` du moteur) : les tuées et les fuyardes sortent de la ligne ; les renforts montés
 * pendant le cycle y entrent, avec la largeur que les places libres de leur niche leur laissent (`connections` : largeur du
 * front, `null` en percée, sans renfort).
 */
function endCycle(military: MilitaryCatalog, cycle: Cycle, side: Side, connections: number | null): void {
  const ups = [...side.up.values()].flat();
  for (const f of [...side.fighters, ...ups]) if (cycle.out.has(f)) side.routs++;
  side.fighters = side.fighters.filter((f) => !cycle.out.has(f));
  if (connections === null) return;
  for (const [niche, list] of side.up) {
    let room = connections * WIDTH_SCALE - side.fighters.filter((f) => military.divisions[f.d.type]!.niche === niche).reduce((sum, f) => sum + f.width, 0);
    for (const f of list) {
      if (cycle.out.has(f)) continue;
      f.width = Math.max(0, Math.min(room, f.full));
      room -= f.width;
      if (f.width > 0) side.fighters.push(f);
    }
  }
}

function sideEstimate(military: MilitaryCatalog, side: Side): SideEstimate {
  const everyone = [...side.lost.keys()];
  const groups = { infantry: null, armor: null, support: null } as Record<LossGroup, number | null>;
  for (const name of LOSS_GROUPS) {
    const here = everyone.filter((f) => groupOf(military, f.d) === name);
    if (here.length > 0) groups[name] = (100 * here.reduce((sum, f) => sum + side.lost.get(f)!, 0)) / here.length;
  }
  const total = everyone.reduce((sum, f) => sum + side.lost.get(f)!, 0);
  return { total: everyone.length === 0 ? 0 : (100 * total) / everyone.length, groups, routs: side.routs };
}

/** Combat de percée : cycles joués jusqu'à ce qu'une infanterie ait quitté la ligne, ou `combatCycles`. Les divisions données ne sont pas modifiées. */
function fight(military: MilitaryCatalog, attacker: readonly Fighter[], defender: readonly Fighter[], frontWidth: number): FightEstimate {
  const a = newSide(attacker.map((f) => ({ ...f })));
  const d = newSide(defender.map((f) => ({ ...f })));
  let cedes: FightEstimate["cedes"] = null;
  for (let c = 0; c < military.combatCycles && cedes === null; c++) {
    const cycle = startCycle(military, [a, d]);
    playPhases(military, cycle, a, d, frontWidth);
    endCycle(military, cycle, a, null);
    endCycle(military, cycle, d, null);
    if (infantryOf(military, a.fighters).length === 0) cedes = "attacker";
    else if (infantryOf(military, d.fighters).length === 0) cedes = "defender";
  }
  return { attacker: sideEstimate(military, a), defender: sideEstimate(military, d), cedes };
}

/** Avancée d'un round : `frontAdvance` du moteur. */
function frontAdvance(military: MilitaryCatalog, a: number, d: number, speed: number): number {
  if (a === 0) return 0;
  if (d === 0) return speed;
  const A = military.advanceThresholdA;
  const span = (military.advanceThresholdB - A) * d;
  return (Math.min(span, Math.max(0, a - A * d)) * speed) / span;
}

/** Vitesse de l'attaquant : `frontSpeed` du moteur. */
function frontSpeed(military: MilitaryCatalog, side: readonly Fighter[]): number {
  const total = side.reduce((sum, f) => sum + f.width, 0);
  if (total === 0) return military.footSpeedPermille;
  const motor = side.reduce((sum, f) => sum + (military.divisions[f.d.type]!.motorized ? f.width : 0), 0);
  return military.footSpeedPermille + ((military.motorizedSpeedPermille - military.footSpeedPermille) * motor) / total;
}

const stateOf = (military: MilitaryCatalog, d: DivisionView): number => d.state / military.stateScale;

/** Un combattant de première ligne dans une attaque sur tout le front. */
function lineFighter(military: MilitaryCatalog, d: DivisionView, attacking: boolean, width: number): Fighter {
  const type = military.divisions[d.type]!;
  return {
    d,
    width,
    full: type.frontWidth * WIDTH_SCALE,
    attackMult: attacking ? type.attackMultiplier : 100,
    hpMult: attacking ? 100 : type.defenseHitPointsMultiplier,
    state: stateOf(military, d),
  };
}

/** Un camp pendant une attaque sur tout le front. */
function lineSide(military: MilitaryCatalog, divisions: readonly DivisionView[], attacking: boolean): Side {
  const fighters = divisions.filter((d) => d.line === "first" && d.engaged > 0 && d.status !== "moving").map((d) => lineFighter(military, d, attacking, d.engaged));
  const reserve = divisions.filter((d) => d.line === "second" && d.status === "ready").sort((a, b) => b.state - a.state || a.id - b.id);
  return newSide(fighters, reserve, (d) => lineFighter(military, d, attacking, 0));
}

/** Rangement de fin de cycle : la seconde ligne reprend les places encore libres, niche par niche, et combat au cycle suivant (`arrangeSide` du moteur). */
function fillRooms(military: MilitaryCatalog, side: Side, connections: number): void {
  for (const niche of military.niches) {
    const here = (d: DivisionView): boolean => military.divisions[d.type]!.niche === niche.id;
    let room = connections * WIDTH_SCALE - side.fighters.filter((f) => here(f.d)).reduce((sum, f) => sum + f.width, 0);
    for (const d of side.reserve.filter(here)) {
      if (room <= 0) break;
      const f = side.mount!(d);
      f.width = Math.min(room, f.full);
      room -= f.width;
      side.fighters.push(f);
      side.lost.set(f, 0);
      side.reserve.splice(side.reserve.indexOf(d), 1);
    }
  }
}

/** Repli faute d'infanterie : sans infanterie en ligne, les autres divisions quittent la ligne. */
function withdraw(military: MilitaryCatalog, side: Side): void {
  if (side.fighters.length === 0 || side.fighters.some((f) => groupOf(military, f.d) === "infantry")) return;
  side.routs += side.fighters.length;
  side.fighters = [];
}

/** Attaque sur tout le front : `mine` attaque `theirs`, cycle par cycle. `connections` : largeur du front. */
export function estimateFrontAttack(military: MilitaryCatalog, mine: readonly DivisionView[], theirs: readonly DivisionView[], connections: number): FrontEstimate {
  const attacker = lineSide(military, mine, true);
  const defender = lineSide(military, theirs, false);
  const width = (side: readonly Fighter[]): number => infantryOf(military, side).reduce((sum, f) => sum + f.width, 0);
  let advance = 0;
  let cycles = 0;
  let cedes: FightEstimate["cedes"] = null;
  for (let c = 0; c < military.combatCycles; c++) {
    if (width(attacker.fighters) === 0) {
      cedes ??= "attacker";
      break;
    }
    cycles++;
    if (width(defender.fighters) === 0) {
      cedes ??= "defender";
      withdraw(military, defender);
      advance += military.roundsPerCycle * frontSpeed(military, attacker.fighters);
      continue;
    }
    const cycle = startCycle(military, [attacker, defender]);
    playPhases(military, cycle, attacker, defender, connections * WIDTH_SCALE);
    endCycle(military, cycle, attacker, connections);
    endCycle(military, cycle, defender, connections);
    // Avancée : première ligne de la fin du cycle, renforts du cycle compris, sans les divisions qui montent au rangement.
    advance += military.roundsPerCycle * frontAdvance(military, width(attacker.fighters), width(defender.fighters), frontSpeed(military, attacker.fighters));
    fillRooms(military, attacker, connections);
    fillRooms(military, defender, connections);
    withdraw(military, attacker);
    withdraw(military, defender);
  }
  if (cedes === null && width(attacker.fighters) === 0) cedes = "attacker";
  const attackerSide = sideEstimate(military, attacker);
  const defenderSide = sideEstimate(military, defender);
  const lost = attackerSide.total;
  const dealt = defenderSide.total;
  const verdict: Verdict = cedes === "defender" && dealt >= POSITION_RATIO * lost ? "dominant" : cedes === "attacker" && lost >= POSITION_RATIO * dealt ? "losing" : "balanced";
  return { attacker: attackerSide, defender: defenderSide, cedes, cycles, advance: advance / 10, verdict };
}

/** Une liaison par niche, dans l'ordre des niches, les meilleures divisions d'abord : `fill` du moteur. Appui-feu seulement avec de l'infanterie. */
function fillLink(military: MilitaryCatalog, candidates: readonly DivisionView[], make: (d: DivisionView, take: number) => Fighter, widthOf: (d: DivisionView) => number): Fighter[] {
  const out: Fighter[] = [];
  let infantry = 0;
  for (const niche of military.niches) {
    if (niche.support && infantry === 0) continue;
    let room = WIDTH_SCALE;
    const here = candidates.filter((d) => military.divisions[d.type]!.niche === niche.id).sort((a, b) => b.state - a.state || a.id - b.id);
    for (const d of here) {
      if (room <= 0) break;
      const take = Math.min(room, widthOf(d));
      out.push(make(d, take));
      room -= take;
      if (niche.id === "infantry") infantry += take;
    }
  }
  return out;
}

/** Percée de la boîte `box` : combat 1 contre une tranche de la première ligne, puis combat 2 contre la réaction rapide et la seconde ligne. */
export function estimateBreakthrough(military: MilitaryCatalog, box: readonly DivisionView[], theirs: readonly DivisionView[]): BreakthroughEstimate {
  const breakWidth = (d: DivisionView): number => military.divisions[d.type]!.breakthroughWidth * WIDTH_SCALE;
  const lineWidth = (d: DivisionView): number => military.divisions[d.type]!.frontWidth * WIDTH_SCALE;
  const force = fillLink(
    military,
    box.filter((d) => d.status !== "moving" && d.status !== "fleeing"),
    (d, take) => ({ d, width: take, full: breakWidth(d), attackMult: military.divisions[d.type]!.breakthroughMultiplier, hpMult: 100, state: stateOf(military, d) }),
    breakWidth,
  );
  const slice = fillLink(
    military,
    theirs.filter((d) => d.line === "first" && d.engaged > 0 && d.breakthrough === 0 && d.status !== "moving"),
    (d, take) => ({ d, width: take, full: lineWidth(d), attackMult: 100, hpMult: military.divisions[d.type]!.defenseHitPointsMultiplier, state: stateOf(military, d) }),
    lineWidth,
  );
  const first = fight(military, force, slice, WIDTH_SCALE);
  if (first.cedes !== "defender") return { first, second: null, verdict: "unlikely" };
  // La force entre dans le combat 2 avec ce que le combat 1 lui a laissé.
  const left = 1 - first.attacker.total / 100;
  for (const f of force) f.state *= left;
  const counter = fillLink(
    military,
    // La réaction rapide d'abord, puis la seconde ligne (05-Fronts §7.2, point 8).
    theirs.filter((d) => (d.line === "rapid" || d.line === "second") && d.status === "ready"),
    (d, take) => ({ d, width: take, full: breakWidth(d), attackMult: military.divisions[d.type]!.counterAttackMultiplier, hpMult: military.divisions[d.type]!.defenseHitPointsMultiplier, state: stateOf(military, d) }),
    breakWidth,
  );
  const second = fight(military, force, counter, WIDTH_SCALE);
  return { first, second, verdict: second.cedes === "defender" ? "likely" : "uncertain" };
}
