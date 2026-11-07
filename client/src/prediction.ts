// Estimation d'un combat, pour le panneau de prédiction de la fenêtre d'un front (Docs/Design/05-Fronts.md §11.4). Pas de DOM,
// aucune règle : la page calcule un seul round avec les formules du moteur (`strike` et `frontAdvance` dans
// `packages/engine/src/combat.ts`), en flottants, puis prolonge ces pertes jusqu'à ce qu'une infanterie cède. Renforts et replis
// ne sont pas suivis : c'est une estimation, jamais utilisée par le moteur.

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
  readonly rounds: number;
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
  readonly width: number;
  readonly full: number;
  readonly attackMult: number;
  readonly hpMult: number;
  state: number;
}

const groupOf = (military: MilitaryCatalog, d: DivisionView): LossGroup => {
  const niche = military.divisions[d.type]!.niche;
  return niche === "infantry" ? "infantry" : niche === "tanks" ? "armor" : "support";
};

const infantryOf = (military: MilitaryCatalog, side: readonly Fighter[]): Fighter[] => side.filter((f) => groupOf(military, f.d) === "infantry");

/** Fraction de barre perdue par chaque division de `to` en un round : `strike` du moteur, sans arrondi. */
function strike(military: MilitaryCatalog, from: readonly Fighter[], to: readonly Fighter[], frontWidth: number, rates: Map<Fighter, number>): void {
  let soft = 0;
  let hard = 0;
  for (const f of from) {
    const type = military.divisions[f.d.type]!;
    const k = (f.width / f.full) * f.state * (f.attackMult / 100);
    soft += type.softAttack * k;
    hard += type.hardAttack * k;
  }
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
}

/** Rounds avant que l'infanterie du camp atteigne son seuil de fuite, en moyenne ; 0 sans infanterie. */
function roundsToFlee(military: MilitaryCatalog, side: readonly Fighter[], rates: ReadonlyMap<Fighter, number>): number {
  const infantry = infantryOf(military, side);
  if (infantry.length === 0) return 0;
  const state = infantry.reduce((sum, f) => sum + f.state, 0) / infantry.length;
  const rate = infantry.reduce((sum, f) => sum + rates.get(f)!, 0) / infantry.length;
  if (rate <= 0) return Infinity;
  return Math.max(0, (state - military.fleeStatePercent / 100) / rate);
}

function sideEstimate(military: MilitaryCatalog, side: readonly Fighter[], rates: ReadonlyMap<Fighter, number>, rounds: number): SideEstimate {
  const flee = military.fleeStatePercent / 100;
  const groups = { infantry: null, armor: null, support: null } as Record<LossGroup, number | null>;
  let total = 0;
  let routs = 0;
  for (const name of LOSS_GROUPS) {
    const here = side.filter((f) => groupOf(military, f.d) === name);
    if (here.length === 0) continue;
    const lost = here.reduce((sum, f) => sum + Math.min(f.state, rates.get(f)! * rounds), 0);
    total += lost;
    groups[name] = (100 * lost) / here.length;
  }
  for (const f of side) if (f.state > flee + 1e-9 && f.state - rates.get(f)! * rounds <= flee + 1e-9) routs++;
  return { total: side.length === 0 ? 0 : (100 * total) / side.length, groups, routs };
}

/** Pertes d'un round, prolongées jusqu'à ce qu'une infanterie cède, sans dépasser le nombre de rounds d'un combat. */
function fight(military: MilitaryCatalog, attacker: readonly Fighter[], defender: readonly Fighter[], frontWidth: number): FightEstimate & { readonly fought: number } {
  const rates = new Map<Fighter, number>();
  strike(military, attacker, defender, frontWidth, rates);
  strike(military, defender, attacker, frontWidth, rates);
  const a = roundsToFlee(military, attacker, rates);
  const d = roundsToFlee(military, defender, rates);
  const fought = Math.min(military.combatMaxRounds, a, d);
  const cedes = fought >= military.combatMaxRounds ? null : a <= d ? "attacker" : "defender";
  return { attacker: sideEstimate(military, attacker, rates, fought), defender: sideEstimate(military, defender, rates, fought), cedes, fought };
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

/** Les divisions de première ligne qui combattent une attaque sur tout le front. */
function lineFighters(military: MilitaryCatalog, divisions: readonly DivisionView[], attacking: boolean): Fighter[] {
  return divisions
    .filter((d) => d.line === "first" && d.engaged > 0 && d.status !== "moving")
    .map((d) => {
      const type = military.divisions[d.type]!;
      return {
        d,
        width: d.engaged,
        full: type.frontWidth * WIDTH_SCALE,
        attackMult: attacking ? type.attackMultiplier : 100,
        hpMult: attacking ? 100 : type.defenseHitPointsMultiplier,
        state: stateOf(military, d),
      };
    });
}

/** Attaque sur tout le front : `mine` attaque `theirs`. `connections` : largeur du front. */
export function estimateFrontAttack(military: MilitaryCatalog, mine: readonly DivisionView[], theirs: readonly DivisionView[], connections: number): FrontEstimate {
  const attacker = lineFighters(military, mine, true);
  const defender = lineFighters(military, theirs, false);
  const result = fight(military, attacker, defender, connections * WIDTH_SCALE);
  const max = military.combatMaxRounds;
  const width = (side: readonly Fighter[]): number => infantryOf(military, side).reduce((sum, f) => sum + f.width, 0);
  const speed = frontSpeed(military, attacker);
  const fighting = frontAdvance(military, width(attacker), width(defender), speed) * result.fought;
  // Défenseur sans infanterie : l'attaquant avance à sa vitesse maximale pendant les rounds qui restent (06-Combat-Simplifie §1).
  const walking = result.cedes === "defender" ? (max - result.fought) * speed : 0;
  const lost = result.attacker.total;
  const dealt = result.defender.total;
  const verdict: Verdict =
    result.cedes === "defender" && dealt >= POSITION_RATIO * lost ? "dominant" : result.cedes === "attacker" && lost >= POSITION_RATIO * dealt ? "losing" : "balanced";
  return {
    attacker: result.attacker,
    defender: result.defender,
    cedes: result.cedes,
    rounds: result.cedes === "attacker" ? Math.ceil(result.fought) : max,
    advance: (fighting + walking) / 10,
    verdict,
  };
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
