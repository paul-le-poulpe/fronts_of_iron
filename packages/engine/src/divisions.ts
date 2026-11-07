// Divisions, en entiers (Docs/Design/05-Fronts.md §3, 08-Population.md §5, §13). `config/divisions.ts`
// donne les valeurs de l'auteur, avec des multiplicateurs décimaux (deux décimales
// au plus) ; ce fichier les convertit une fois en entiers à l'échelle 100, et
// fournit les calculs d'une division : état, attaques, pertes, création.
// Aucun calcul en virgule flottante après la conversion (règle 2 du CLAUDE.md).

import { DIVISIONS, DIVISION_TIMING, ELITE_TROOPS_RATIO, NICHES, type DivisionConfig, type DivisionId, type NicheId } from "./config.ts";
import type { GameState } from "./state.ts";

/** Échelle des multiplicateurs : 0,5 s'écrit 50. */
export const MULT_SCALE = 100;
/** Largeurs en millièmes de liaison : une division de largeur 1 occupe 1 000. */
export const WIDTH_SCALE = 1000;
/** Échelle de l'état d'une division : 10 000 = 100 %. */
export const STATE_SCALE = 10000;
/** Échelle des fractions de pertes (`f`, 05-Fronts §6.2) : 1 000 000 = toute la barre de vie. */
export const LOSS_SCALE = 1000000;

/** Où est une division sur un front (05-Fronts §4.1, §4.6), valeurs de `Division.line`. */
export const LINE_FIRST = 0;
export const LINE_SECOND = 1;
/** Réaction rapide (05-Fronts §4.6). */
export const LINE_RAPID = 2;
/** Boîte de percée `Division.box` (05-Fronts §4.6). */
export const LINE_BOX = 3;

/** Une division (05-Fronts §3, 08 §13). Tous ses champs entrent dans le hash. */
export interface Division {
  readonly id: number;
  readonly owner: number;
  /** Indice du type (ordre des clés de `DIVISIONS`). */
  readonly type: number;
  /** Barre de vie, de 0 à `STATE_SCALE` (08 §5). À 0, la division est détruite. */
  state: number;
  /** Front où elle est, ou vers lequel elle va ; 0 : réserve nationale. */
  front: number;
  /** `LINE_FIRST`, `LINE_SECOND`, `LINE_RAPID` ou `LINE_BOX` ; `LINE_SECOND` dans la réserve. En déplacement : la ligne demandée. */
  line: number;
  /** Boîte de percée (`LINE_BOX`) ; 0 sinon. */
  box: number;
  /**
   * Percée où la division est engagée (05-Fronts §7.2) : force qui perce, tranche de première ligne ou force de
   * contre-attaque ; 0 sinon.
   */
  breakthrough: number;
  /** Largeur engagée dans cette percée, en millièmes de liaison ; 0 hors percée. */
  btEngaged: number;
  /** Largeur engagée en première ligne, en millièmes de liaison (05-Fronts §4.2) ; 0 hors de la première ligne. */
  engaged: number;
  /** En déplacement : tour d'arrivée (`front` est la destination) ; 0 sinon. */
  arrivalTick: number;
  /** Tour de fin de formation (08 §6) : la division existe dès sa création, mais ne peut pas être déplacée avant. */
  readonly formedTick: number;
  /** En fuite jusqu'à ce tour exclu (05-Fronts §5.4) ; 0 si elle n'a jamais fui. */
  fleeUntilTick: number;
  /** Division en trop (08 §6) : tour où elle disparaît ; 0 si elle n'est pas en sursis. Elle clignote jusque-là. */
  leaveTick: number;
}

/** Un type de division, en entiers. */
export interface DivisionData {
  readonly id: DivisionId;
  readonly index: number;
  /** Indice de la niche (ordre des clés de `NICHES`). */
  readonly niche: number;
  /** Rang dans sa niche : 0 est le meilleur type. */
  readonly rank: number;
  readonly support: boolean;
  /** Somme des attaques de tous les composants d'une division pleine (08 §5), millièmes de point. */
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly airAttack: number;
  /** Largeur de première ligne, en millièmes de liaison. */
  readonly width: number;
  readonly breakthroughWidth: number;
  /** Tours de formation d'une division produite. */
  readonly productionTurns: number;
  /** Limité par `ELITE_TROOPS_RATIO` (08 §5). */
  readonly elite: boolean;
  readonly hitPoints: number;
  /** Échelle 100. */
  readonly defenseHitPointsMultiplier: number;
  readonly attackMultiplier: number;
  readonly breakthroughMultiplier: number;
  readonly counterAttackMultiplier: number;
  readonly armorPercent: number;
  readonly motorized: boolean;
}

/** Multiplicateur décimal (deux décimales au plus) converti en entier à l'échelle 100. */
export function toScale100(x: number): number {
  return Math.floor(x * MULT_SCALE + 0.5);
}

export const DIVISION_IDS = Object.keys(DIVISIONS) as DivisionId[];
export const NICHE_IDS = Object.keys(NICHES) as NicheId[];

/** Types de chaque niche, par indice, du meilleur au moins bon. */
export const NICHE_TYPES: readonly (readonly number[])[] = NICHE_IDS.map((n) => NICHES[n].types.map((t) => DIVISION_IDS.indexOf(t)));
/** Niche d'infanterie : celle qui tient le front pour l'appui-feu et l'avancée (05-Fronts §4.2, §7). */
export const INFANTRY_NICHE = NICHE_IDS.indexOf("infantry");

export const DIVISION_DATA: readonly DivisionData[] = DIVISION_IDS.map((id, index) => {
  const d: DivisionConfig = DIVISIONS[id];
  const niche = NICHE_TYPES.findIndex((types) => types.includes(index));
  return {
    id,
    index,
    niche,
    rank: NICHE_TYPES[niche]!.indexOf(index),
    support: NICHES[NICHE_IDS[niche]!].support,
    softAttack: d.softAttack,
    hardAttack: d.hardAttack,
    airAttack: d.airAttack,
    width: d.frontWidth * WIDTH_SCALE,
    breakthroughWidth: d.breakthroughWidth * WIDTH_SCALE,
    productionTurns: d.productionTurns ?? DIVISION_TIMING.defaultProductionTurns,
    elite: d.elite === true,
    hitPoints: d.hitPoints,
    defenseHitPointsMultiplier: toScale100(d.defenseHitPointsMultiplier),
    attackMultiplier: toScale100(d.attackMultiplier),
    breakthroughMultiplier: toScale100(d.breakthroughMultiplier),
    counterAttackMultiplier: toScale100(d.counterAttackMultiplier),
    armorPercent: d.armorPercent,
    motorized: d.movement === "motorized",
  };
});

export function isDivisionId(v: unknown): v is DivisionId {
  return typeof v === "string" && (DIVISION_IDS as readonly string[]).includes(v);
}

export const dataOf = (d: Division): DivisionData => DIVISION_DATA[d.type]!;

/** Divisions du joueur d'un type, en formation, en sursis ou non. */
export function divisionCount(state: GameState, player: number, type: number): number {
  let n = 0;
  for (const d of state.divisions) if (d.owner === player && d.type === type) n++;
  return n;
}

/** Plafond de la limite des élites (08 §5) : `floor(bonshommes de la caserne de réguliers / ELITE_TROOPS_RATIO)`. */
export const eliteCap = (regularWorkers: number): number => Math.floor(regularWorkers / ELITE_TROOPS_RATIO);

/** Numéro du tour en cours de calcul (`state.tick` n'avance qu'à la fin d'`applyTurn`). */
export const currentTurn = (state: GameState): number => state.tick + 1;

export const inFormation = (state: GameState, d: Division): boolean => currentTurn(state) < d.formedTick;
export const isMoving = (d: Division): boolean => d.arrivalTick !== 0;
export const isFleeing = (state: GameState, d: Division): boolean => currentTurn(state) < d.fleeUntilTick;

/** État de la division (08 §5), de 0 à `STATE_SCALE` : sa barre de vie. */
export const stateOf = (d: Division): number => d.state;

/** Une division à 0 % est détruite (08 §5, provisoire). */
export const isEmpty = (d: Division): boolean => d.state <= 0;

/** Crée une division pleine dans la réserve nationale, en formation jusqu'à `formedTick`. Renvoie la division. */
export function addDivision(state: GameState, owner: number, type: number, formedTick: number): Division {
  const d: Division = {
    id: state.nextDivisionId++,
    owner,
    type,
    state: STATE_SCALE,
    front: 0,
    line: LINE_SECOND,
    box: 0,
    breakthrough: 0,
    btEngaged: 0,
    engaged: 0,
    arrivalTick: 0,
    formedTick,
    fleeUntilTick: 0,
    leaveTick: 0,
  };
  state.divisions.push(d);
  return d;
}

/**
 * Attaques d'une division engagée (05-Fronts §6.1, 08 §5), en millièmes de point :
 * part engagée × (somme des attaques de ses composants) × état × multiplicateur. `mult` à
 * l'échelle 100 (100 : aucun multiplicateur). `engaged` : largeur engagée dans ce
 * combat (première ligne par défaut ; dans une percée, `btEngaged`), rapportée à la
 * largeur de la division dans ce combat (`width`, sa largeur de première ligne par défaut ;
 * `breakthroughWidth` pour la force qui perce et la force de contre-attaque, 05-Fronts §7.2).
 */
export function attackOf(d: Division, mult: number, engaged: number = d.engaged, width: number = dataOf(d).width): { soft: number; hard: number } {
  if (d.state <= 0) return { soft: 0, hard: 0 };
  const data = dataOf(d);
  // e / largeur × attaque × état / STATE_SCALE × mult / 100, en millièmes : × 1 000 / 100 = × 10.
  const den = width * STATE_SCALE;
  return {
    soft: Math.floor((engaged * data.softAttack * d.state * mult * 10) / den),
    hard: Math.floor((engaged * data.hardAttack * d.state * mult * 10) / den),
  };
}

/**
 * Pertes de la division pour une fraction `f` de sa barre de vie, à l'échelle `LOSS_SCALE` (05-Fronts §6.2, 08 §13) :
 * `state` perd `f × STATE_SCALE / LOSS_SCALE`, arrondi vers le bas, sans tirage. Renvoie l'état perdu.
 */
export function applyLoss(d: Division, f: number): number {
  if (f <= 0 || d.state <= 0) return 0;
  const lost = Math.min(d.state, Math.floor((f * STATE_SCALE) / LOSS_SCALE));
  d.state -= lost;
  return lost;
}

/** Ordre de choix d'une ligne (05-Fronts §4.2) : meilleur état, puis meilleur type de la niche, puis plus petit identifiant. */
export function byChoice(a: Division, b: Division): number {
  return stateOf(b) - stateOf(a) || dataOf(a).rank - dataOf(b).rank || a.id - b.id;
}
