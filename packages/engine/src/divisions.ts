// Divisions, en entiers (Docs/Design/05-Fronts.md §3). `config/divisions.ts`
// donne les valeurs de l'auteur, avec des multiplicateurs décimaux (deux décimales
// au plus) ; ce fichier les convertit une fois en entiers à l'échelle 100, et
// fournit les calculs d'une division : taux, état, excédent, attaques, pertes.
// Aucun calcul en virgule flottante après la conversion (règle 2 du CLAUDE.md).

import { ARMAMENT, DIVISIONS, NICHES, type DivisionConfig, type DivisionId, type NicheId } from "./config.ts";
import { nextInt } from "./rng.ts";
import type { GameState, Player } from "./state.ts";

/** Échelle des multiplicateurs : 0,5 s'écrit 50. */
export const MULT_SCALE = 100;
/** Largeurs en millièmes de liaison : une division de largeur 1 occupe 1 000. */
export const WIDTH_SCALE = 1000;
/** Échelle de l'état d'une division : 10 000 = 100 %. */
export const STATE_SCALE = 10000;
/** Échelle des fractions de pertes (`f`, 05-Fronts §6.2) : 1 000 000 = toute la division. */
export const LOSS_SCALE = 1000000;

/** Ressource d'un composant : les hommes. Les autres valeurs sont des indices de `ARMAMENT.types`. */
export const MEN = -1;

/** Où est une division sur un front (05-Fronts §4.1, §4.6), valeurs de `Division.line`. */
export const LINE_FIRST = 0;
export const LINE_SECOND = 1;
/** Réaction rapide (05-Fronts §4.6). */
export const LINE_RAPID = 2;
/** Boîte de percée `Division.box` (05-Fronts §4.6). */
export const LINE_BOX = 3;

/** Une division (05-Fronts §3, §13.1). Tous ses champs entrent dans le hash. */
export interface Division {
  readonly id: number;
  readonly owner: number;
  /** Indice du type (ordre des clés de `DIVISIONS`). */
  readonly type: number;
  /** Exemplaires présents par composant, dans l'ordre de `components`. */
  readonly counts: number[];
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
  /** Tour de fin de formation (05-Fronts §3.5). */
  readonly formedTick: number;
  /** En fuite jusqu'à ce tour exclu (05-Fronts §5.4) ; 0 si elle n'a jamais fui. */
  fleeUntilTick: number;
}

export interface ComponentData {
  /** `MEN` ou indice de `ARMAMENT.types`. */
  readonly resource: number;
  readonly count: number;
  readonly required: boolean;
  readonly weight: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly airAttack: number;
  /** Échelle 100. */
  readonly lossMultiplier: number;
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
  readonly components: readonly ComponentData[];
  readonly weightSum: number;
  /** Indice du composant des hommes, -1 s'il n'y en a pas. */
  readonly menComponent: number;
  /** Largeur de première ligne, en millièmes de liaison. */
  readonly width: number;
  readonly breakthroughWidth: number;
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
const ARMAMENT_KEYS: readonly string[] = Object.keys(ARMAMENT.types);

/** Types de chaque niche, par indice, du meilleur au moins bon. */
export const NICHE_TYPES: readonly (readonly number[])[] = NICHE_IDS.map((n) => NICHES[n].types.map((t) => DIVISION_IDS.indexOf(t)));
/** Niche d'infanterie : celle qui tient le front pour l'appui-feu et l'avancée (05-Fronts §4.2, §7). */
export const INFANTRY_NICHE = NICHE_IDS.indexOf("infantry");

export const DIVISION_DATA: readonly DivisionData[] = DIVISION_IDS.map((id, index) => {
  const d: DivisionConfig = DIVISIONS[id];
  const niche = NICHE_TYPES.findIndex((types) => types.includes(index));
  const components: ComponentData[] = d.components.map((c) => ({
    resource: c.resource === "men" ? MEN : ARMAMENT_KEYS.indexOf(c.resource),
    count: c.count,
    required: c.required,
    weight: c.weight,
    softAttack: c.softAttack,
    hardAttack: c.hardAttack,
    airAttack: c.airAttack,
    lossMultiplier: toScale100(c.lossMultiplier ?? 1),
  }));
  return {
    id,
    index,
    niche,
    rank: NICHE_TYPES[niche]!.indexOf(index),
    support: NICHES[NICHE_IDS[niche]!].support,
    components,
    weightSum: components.reduce((s, c) => s + c.weight, 0),
    menComponent: components.findIndex((c) => c.resource === MEN),
    width: d.frontWidth * WIDTH_SCALE,
    breakthroughWidth: d.breakthroughWidth * WIDTH_SCALE,
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

/** Numéro du tour en cours de calcul (`state.tick` n'avance qu'à la fin d'`applyTurn`). */
export const currentTurn = (state: GameState): number => state.tick + 1;

export const inFormation = (state: GameState, d: Division): boolean => currentTurn(state) < d.formedTick;
export const isMoving = (d: Division): boolean => d.arrivalTick !== 0;
export const isFleeing = (state: GameState, d: Division): boolean => currentTurn(state) < d.fleeUntilTick;

/** Hommes de la division. */
export function menOf(d: Division): number {
  const k = dataOf(d).menComponent;
  return k < 0 ? 0 : d.counts[k]!;
}

/**
 * État de la division (05-Fronts §3.3), de 0 à `STATE_SCALE` :
 * Σ (weight × présents / count) / Σ weight, chaque terme arrondi vers le bas.
 */
export function stateOf(d: Division): number {
  const data = dataOf(d);
  if (data.weightSum === 0) return 0;
  let num = 0;
  data.components.forEach((c, i) => {
    num += Math.floor((c.weight * d.counts[i]! * STATE_SCALE) / c.count);
  });
  return Math.floor(num / data.weightSum);
}

/** Une division à 0 % est détruite (05-Fronts §3.3) : aucun composant de poids non nul n'a d'exemplaire. */
export function isEmpty(d: Division): boolean {
  const data = dataOf(d);
  return data.components.every((c, i) => c.weight === 0 || d.counts[i] === 0);
}

/** Ajoute `n` exemplaires de la ressource `resource` au stock du joueur (hommes : rien à faire, ils ne sont plus soldats). */
function giveToStock(player: Player, resource: number, n: number): void {
  if (n <= 0 || resource === MEN) return;
  player.armamentReserve[resource] = player.armamentReserve[resource]! + n;
}

/**
 * Pas d'excédent (05-Fronts §3.2) : aucun composant ne dépasse le taux de soldats,
 * le plus petit taux des composants requis. Ce qui dépasse retourne au stock
 * national (hommes : à la population, `Player.soldiers` est recompté par
 * `countSoldiers`). Le plafond d'un composant est `floor(p_j × count / c_j)`, `j`
 * le composant requis le plus limitant ; refait jusqu'à ce que rien ne change, un
 * arrondi pouvant faire passer un autre composant requis sous le taux.
 */
export function trimExcess(player: Player, d: Division): void {
  const data = dataOf(d);
  for (;;) {
    let j = -1;
    data.components.forEach((c, i) => {
      if (!c.required) return;
      if (j < 0 || d.counts[i]! * data.components[j]!.count < d.counts[j]! * c.count) j = i;
    });
    if (j < 0) return;
    const pj = d.counts[j]!;
    const cj = data.components[j]!.count;
    let changed = false;
    data.components.forEach((c, i) => {
      const cap = Math.floor((pj * c.count) / cj);
      if (d.counts[i]! > cap) {
        giveToStock(player, c.resource, d.counts[i]! - cap);
        d.counts[i] = cap;
        changed = true;
      }
    });
    if (!changed) return;
  }
}

/** Rend tout le contenu d'une division au stock national (suppression, 05-Fronts §3.5). */
export function emptyDivision(player: Player, d: Division): void {
  dataOf(d).components.forEach((c, i) => {
    giveToStock(player, c.resource, d.counts[i]!);
    d.counts[i] = 0;
  });
}

/**
 * Attaques d'une division engagée (05-Fronts §6.1), en millièmes de point :
 * part engagée × Σ (attaque du composant × taux) × multiplicateur. `mult` à
 * l'échelle 100 (100 : aucun multiplicateur). `engaged` : largeur engagée dans ce
 * combat (première ligne par défaut ; dans une percée, `btEngaged`), rapportée à la
 * largeur de première ligne de la division.
 */
export function attackOf(d: Division, mult: number, engaged: number = d.engaged): { soft: number; hard: number } {
  const data = dataOf(d);
  let soft = 0;
  let hard = 0;
  data.components.forEach((c, i) => {
    const p = d.counts[i]!;
    if (p === 0) return;
    // e / largeur × attaque × p / count × mult / 100, en millièmes : × 1 000 / 100 = × 10.
    const den = data.width * c.count;
    soft += Math.floor((engaged * c.softAttack * p * mult * 10) / den);
    hard += Math.floor((engaged * c.hardAttack * p * mult * 10) / den);
  });
  return { soft, hard };
}

/**
 * Pertes de la division pour une fraction `f` de la division complète, à l'échelle
 * `LOSS_SCALE` (05-Fronts §6.2, point 5) : chaque composant perd
 * `f × lossMultiplier × count` exemplaires, en pertes tirées (05-Fronts §1) :
 * partie entière toujours perdue, un exemplaire de plus si `nextInt(rng, q) < reste`.
 * Composants dans l'ordre de `components`. Les hommes perdus ne sont plus soldats ;
 * l'équipement perdu disparaît.
 */
export function applyLoss(state: GameState, d: Division, f: number): void {
  if (f <= 0) return;
  const q = LOSS_SCALE * MULT_SCALE;
  dataOf(d).components.forEach((c, i) => {
    const has = d.counts[i]!;
    if (has === 0) return;
    const p = f * c.lossMultiplier * c.count;
    let lost = Math.floor(p / q);
    const r = p % q;
    if (r > 0 && nextInt(state.rng, q) < r) lost++;
    d.counts[i] = has - Math.min(has, lost);
  });
}

/** Ordre de choix d'une ligne (05-Fronts §4.2) : meilleur état, puis meilleur type de la niche, puis plus petit identifiant. */
export function byChoice(a: Division, b: Division): number {
  return stateOf(b) - stateOf(a) || dataOf(a).rank - dataOf(b).rank || a.id - b.id;
}

/** Soldats : hommes de toutes les divisions du joueur (00-Game §4, point 5), recomptés pour chaque joueur. */
export function countSoldiers(state: GameState): void {
  for (const p of state.players) p.soldiers = 0;
  for (const d of state.divisions) state.players[d.owner - 1]!.soldiers += menOf(d);
}

/** Armement dans les divisions du joueur, par type d'armement (ordre des clés de `ARMAMENT.types`). Compte dans le stock qui décline (05-Fronts §4.5). */
export function divisionEquipment(state: GameState, playerId: number): number[] {
  const out = new Array<number>(ARMAMENT_KEYS.length).fill(0);
  for (const d of state.divisions) {
    if (d.owner !== playerId) continue;
    dataOf(d).components.forEach((c, i) => {
      if (c.resource !== MEN) out[c.resource] = out[c.resource]! + d.counts[i]!;
    });
  }
  return out;
}
