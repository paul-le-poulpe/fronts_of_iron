// Unités militaires, en entiers (Docs/Design/05-Fronts.md §3, §4.2, §6.1, §7.3).
// `config/units.ts` donne les valeurs de l'auteur, avec des multiplicateurs décimaux
// (deux décimales au plus) ; ce fichier les convertit une fois en entiers à
// l'échelle 100 et fournit les calculs de groupes d'unités : remplissage d'une
// largeur, dégâts reçus, motorisation. Aucun calcul en virgule flottante après la
// conversion (règle 2 du CLAUDE.md). Un groupe d'unités est un tableau de nombres,
// un par type, dans l'ordre des clés de `UNITS`.

import { ARMAMENT, NICHES, UNITS, type UnitId } from "./config.ts";

/** Échelle des multiplicateurs : 0,5 s'écrit 50. */
export const MULT_SCALE = 100;

export const UNIT_IDS = Object.keys(UNITS) as UnitId[];
export const NICHE_IDS = Object.keys(NICHES) as (keyof typeof NICHES)[];
export const UNIT_COUNT = UNIT_IDS.length;

/** Comment une unité est perdue (`damageType` de config/units.ts). */
export const KIND_INFANTRY = 0;
export const KIND_ARMOR = 1;
export const KIND_EQUIPMENT = 2;

/** Multiplicateur décimal (deux décimales au plus) converti en entier à l'échelle 100. */
export function toScale100(x: number): number {
  return Math.floor(x * MULT_SCALE + 0.5);
}

/** Une unité, en entiers. */
export interface UnitData {
  readonly id: UnitId;
  readonly index: number;
  /** Indice de la niche (ordre des clés de `NICHES`). */
  readonly niche: number;
  /** Indice du type d'armement de l'équipement (ordre des clés de `ARMAMENT.types`). */
  readonly equipment: number;
  readonly equipmentCount: number;
  readonly population: number;
  /** Priorité de retrait, 1 à 10 : 10 est retirée en premier (05-Fronts §4.7). */
  readonly releasePriority: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly frontWidth: number;
  readonly breakthroughWidth: number;
  readonly kind: typeof KIND_INFANTRY | typeof KIND_ARMOR | typeof KIND_EQUIPMENT;
  /** PV d'une unité d'infanterie ou blindée ; 0 pour l'équipement. */
  readonly hitPoints: number;
  /** Multiplicateur de pertes de l'équipement, échelle 100 (100 pour les autres). */
  readonly lossMultiplier: number;
  readonly motorized: boolean;
  /** Multiplicateurs à l'échelle 100, avec les valeurs par défaut de config/units.ts. */
  readonly attackMultiplier: number;
  readonly breakthroughMultiplier: number;
  readonly counterAttackMultiplier: number;
}

const ARMAMENT_KEYS: readonly string[] = Object.keys(ARMAMENT.types);

type LooseUnit = {
  readonly releasePriority: number;
  readonly equipment: string;
  readonly equipmentCount: number;
  readonly population: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly frontWidth: number;
  readonly breakthroughWidth?: number;
  readonly movement: "foot" | "motorized";
  readonly attackMultiplier: number;
  readonly breakthroughMultiplier?: number;
  readonly counterAttackMultiplier?: number;
  readonly damageType: "infantry" | "armor" | "equipment";
  readonly hitPoints?: number;
  readonly lossMultiplier?: number;
};

export const NICHE_UNITS: readonly (readonly number[])[] = NICHE_IDS.map((n) => NICHES[n].map((u) => UNIT_IDS.indexOf(u)));

export const UNIT_DATA: readonly UnitData[] = UNIT_IDS.map((id, index) => {
  const u = UNITS[id] as LooseUnit;
  const attack = toScale100(u.attackMultiplier);
  return {
    id,
    index,
    niche: NICHE_UNITS.findIndex((units) => units.includes(index)),
    equipment: ARMAMENT_KEYS.indexOf(u.equipment),
    equipmentCount: u.equipmentCount,
    population: u.population,
    releasePriority: u.releasePriority,
    softAttack: u.softAttack,
    hardAttack: u.hardAttack,
    frontWidth: u.frontWidth,
    breakthroughWidth: u.breakthroughWidth ?? u.frontWidth,
    kind: u.damageType === "infantry" ? KIND_INFANTRY : u.damageType === "armor" ? KIND_ARMOR : KIND_EQUIPMENT,
    hitPoints: u.hitPoints ?? 0,
    lossMultiplier: toScale100(u.lossMultiplier ?? 1),
    motorized: u.movement === "motorized",
    attackMultiplier: attack,
    breakthroughMultiplier: u.breakthroughMultiplier === undefined ? attack : toScale100(u.breakthroughMultiplier),
    counterAttackMultiplier: u.counterAttackMultiplier === undefined ? attack : toScale100(u.counterAttackMultiplier),
  };
});

export function isUnitId(v: unknown): v is UnitId {
  return typeof v === "string" && (UNIT_IDS as readonly string[]).includes(v);
}

export const unitIndex = (id: UnitId): number => UNIT_IDS.indexOf(id);

/** Arrondi au plus proche, 0,5 vers le haut (05-Fronts §1) : `p / q` pour p ≥ 0, q > 0. */
export function roundDiv(p: number, q: number): number {
  return Math.floor((2 * p + q) / (2 * q));
}

export const zeros = (): number[] => new Array<number>(UNIT_COUNT).fill(0);

/** Largeur de l'unité en mètres selon la ligne : `frontWidth` en première ligne, `breakthroughWidth` en seconde. */
export const widthOf = (u: UnitData, second: boolean): number => (second ? u.breakthroughWidth : u.frontWidth);

/** Comment choisir parmi les unités mobiles (interrupteur « Motorisé seulement », 05-Fronts §7.2). */
export type MotorMode = "all" | "only" | "first";

/**
 * Remplit une largeur de `width` mètres avec les unités de `avail`, par la règle
 * du remplissage d'un front (05-Fronts §4.2) : niche par niche, dans l'ordre des
 * niches, du meilleur type au moins bon, le plus de largeur possible ; les mètres
 * de chaque niche d'équipement ne dépassent pas ceux de l'infanterie de la force.
 * `second` : largeurs de percée au lieu de largeurs de front. `mode` : toutes les
 * unités, les motorisées seulement, ou les motorisées d'abord puis les autres.
 * Renvoie le nombre pris de chaque type.
 */
export function fillWidth(avail: readonly number[], width: number, second: boolean, mode: MotorMode = "all"): number[] {
  const out = zeros();
  const used = new Array<number>(NICHE_UNITS.length).fill(0);
  let infantryMeters = 0;
  const passes: (boolean | null)[] = mode === "all" ? [null] : mode === "only" ? [true] : [true, false];
  for (const pass of passes) {
    for (let n = 0; n < NICHE_UNITS.length; n++) {
      for (const i of NICHE_UNITS[n]!) {
        const u = UNIT_DATA[i]!;
        if (pass !== null && u.motorized !== pass) continue;
        const cap = u.kind === KIND_EQUIPMENT ? Math.min(width, infantryMeters) : width;
        const room = Math.max(0, cap - used[n]!);
        const w = widthOf(u, second);
        const take = Math.min(avail[i]! - out[i]!, Math.floor(room / w));
        if (take <= 0) continue;
        out[i] = out[i]! + take;
        used[n] = used[n]! + take * w;
        if (u.kind === KIND_INFANTRY) infantryMeters += take * w;
      }
    }
  }
  return out;
}

/** Mètres occupés par les unités de `counts` (largeur de front ou de percée). */
export function metersOf(counts: readonly number[], second: boolean): number {
  let m = 0;
  for (let i = 0; i < UNIT_COUNT; i++) m += counts[i]! * widthOf(UNIT_DATA[i]!, second);
  return m;
}

/** Mètres de l'infanterie (types de `damageType` `infantry`) dans `counts`. */
export function infantryMeters(counts: readonly number[], second: boolean): number {
  let m = 0;
  for (let i = 0; i < UNIT_COUNT; i++) if (UNIT_DATA[i]!.kind === KIND_INFANTRY) m += counts[i]! * widthOf(UNIT_DATA[i]!, second);
  return m;
}

/** Nombre d'unités d'infanterie (types de `damageType` `infantry`) dans `counts`. */
export function infantryCount(counts: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < UNIT_COUNT; i++) if (UNIT_DATA[i]!.kind === KIND_INFANTRY) n += counts[i]!;
  return n;
}

/**
 * Motorisation d'une force (05-Fronts §7.3) : mètres des unités motorisées et mètres
 * de toutes les unités comptées. Seulement l'infanterie et les véhicules, pas
 * l'équipement. Poids : `frontWidth` pour une force de première ligne,
 * `breakthroughWidth` pour une force de seconde ligne.
 */
export function motorization(counts: readonly number[], second: boolean): { readonly motor: number; readonly total: number } {
  let motor = 0;
  let total = 0;
  for (let i = 0; i < UNIT_COUNT; i++) {
    const u = UNIT_DATA[i]!;
    if (u.kind === KIND_EQUIPMENT) continue;
    const m = counts[i]! * widthOf(u, second);
    total += m;
    if (u.motorized) motor += m;
  }
  return { motor, total };
}

/** Somme des attaques d'un groupe, multipliées par le multiplicateur choisi à l'échelle 100, non encore divisée. */
export type MultiplierKind = "base" | "attack" | "breakthrough" | "counter";

export interface Damage {
  /** Total anti-infanterie. */
  readonly soft: number;
  /** Total antiblindé. */
  readonly hard: number;
}

/**
 * Dégâts infligés par un groupe (05-Fronts §6) : somme des attaques de ses unités,
 * chacune × le multiplicateur du rôle. Les produits sont additionnés à l'échelle
 * 100 et divisés une seule fois à la fin (division entière).
 */
export function damageOf(counts: readonly number[], kind: MultiplierKind): Damage {
  let soft = 0;
  let hard = 0;
  for (let i = 0; i < UNIT_COUNT; i++) {
    const n = counts[i]!;
    if (n === 0) continue;
    const u = UNIT_DATA[i]!;
    const mult =
      kind === "base"
        ? MULT_SCALE
        : kind === "attack"
          ? u.attackMultiplier
          : kind === "breakthrough"
            ? u.breakthroughMultiplier
            : u.counterAttackMultiplier;
    soft += n * u.softAttack * mult;
    hard += n * u.hardAttack * mult;
  }
  return { soft: Math.floor(soft / MULT_SCALE), hard: Math.floor(hard / MULT_SCALE) };
}

/** PV totaux (infantry et armor : nombre × hitPoints) d'un groupe. */
export function hitPointsOf(counts: readonly number[]): number {
  let hp = 0;
  for (let i = 0; i < UNIT_COUNT; i++) hp += counts[i]! * UNIT_DATA[i]!.hitPoints;
  return hp;
}

/**
 * Pertes d'un groupe qui reçoit `dmg` (05-Fronts §6.1). Renvoie le nombre perdu de
 * chaque type, sans modifier `counts`.
 * - antiblindé sur les types `armor` : un type reçoit la part des dégâts égale à sa
 *   part des PV totaux des blindés, et perd `arrondi(dégâts reçus / PV)` unités, au
 *   plus son nombre. Si `n` unités de PV `h` sont dans un total `T`, la part est
 *   `dégâts × n×h / T`, donc la perte `arrondi(dégâts × n / T)` ;
 * - anti-infanterie sur les types `infantry` : même calcul ;
 * - équipement : chaque type perd le même pourcentage que l'infanterie du groupe,
 *   multiplié par son `lossMultiplier` ; sans infanterie dans le groupe, l'équipement
 *   perd tout dès que le groupe reçoit des dégâts (choix provisoire, 05-Fronts §15) ;
 * - des dégâts sans cible sont perdus.
 */
export function lossesFrom(counts: readonly number[], dmg: Damage): number[] {
  const lost = zeros();
  const spread = (kind: number, damage: number): void => {
    if (damage <= 0) return;
    let total = 0;
    for (let i = 0; i < UNIT_COUNT; i++) if (UNIT_DATA[i]!.kind === kind) total += counts[i]! * UNIT_DATA[i]!.hitPoints;
    if (total === 0) return;
    for (let i = 0; i < UNIT_COUNT; i++) {
      const u = UNIT_DATA[i]!;
      if (u.kind !== kind || counts[i] === 0) continue;
      lost[i] = Math.min(counts[i]!, roundDiv(damage * counts[i]!, total));
    }
  };
  spread(KIND_ARMOR, dmg.hard);
  spread(KIND_INFANTRY, dmg.soft);
  let before = 0;
  let infLost = 0;
  for (let i = 0; i < UNIT_COUNT; i++) {
    if (UNIT_DATA[i]!.kind !== KIND_INFANTRY) continue;
    before += counts[i]!;
    infLost += lost[i]!;
  }
  for (let i = 0; i < UNIT_COUNT; i++) {
    const u = UNIT_DATA[i]!;
    if (u.kind !== KIND_EQUIPMENT || counts[i] === 0) continue;
    if (before === 0) lost[i] = dmg.soft > 0 || dmg.hard > 0 ? counts[i]! : 0;
    else lost[i] = Math.min(counts[i]!, roundDiv(counts[i]! * infLost * u.lossMultiplier, before * MULT_SCALE));
  }
  return lost;
}

/** Types dans l'ordre de remplissage : niche par niche (ordre de `NICHES`), du meilleur type au moins bon. */
export const FILL_ORDER: readonly number[] = NICHE_UNITS.flat();

/** « Pas de limite » : plafond d'un nombre d'unités qui ne dépend pas de l'infanterie. */
export const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Nombre maximal d'unités du type `t` que la ligne peut porter, d'après les unités
 * de `counts` rangées avant lui dans sa niche (05-Fronts §4.2). `width` : mètres de
 * la ligne, `Infinity` en seconde ligne (sans limite de nombre). Les mètres de
 * chaque niche d'équipement ne dépassent pas ceux de l'infanterie de la ligne.
 * Ne dépend pas de `counts[t]` lui-même.
 */
export function lineRoom(t: number, counts: readonly number[], second: boolean, width: number): number {
  const u = UNIT_DATA[t]!;
  const cap = u.kind === KIND_EQUIPMENT ? Math.min(width, infantryMeters(counts, second)) : width;
  let used = 0;
  for (const j of NICHE_UNITS[u.niche]!) {
    if (j === t) break;
    used += counts[j]! * widthOf(UNIT_DATA[j]!, second);
  }
  const room = Math.max(0, cap - used);
  return room === Infinity ? NO_LIMIT : Math.floor(room / widthOf(u, second));
}

/**
 * Répartition de `u` unités d'un type entre les deux lignes d'un front, selon
 * l'interrupteur (05-Fronts §4.2). `space` : place libre en première ligne, en
 * unités. Renvoie [première ligne, seconde ligne]. Équilibré : `a = floor(u × w2 /
 * (w1 + w2))`, le surplus de ce qui ne tient pas passant en seconde ligne.
 */
export function splitLines(mode: number, u: number, space: number, w1: number, w2: number): [number, number] {
  let a: number;
  if (mode === LINE_SECOND) a = 0;
  else if (mode === LINE_BALANCED) a = Math.min(Math.floor((u * w2) / (w1 + w2)), space);
  else a = Math.min(u, space);
  return [a, u - a];
}

/** Interrupteur à trois positions (05-Fronts §4.2) : valeurs stockées dans `FrontSide.lineMode`. */
export const LINE_FIRST = 0;
export const LINE_BALANCED = 1;
export const LINE_SECOND = 2;
