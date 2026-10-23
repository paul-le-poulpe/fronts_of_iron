// Population, agriculture et pêche (Docs/Design/00-Game.md §4, §6) : une étape par
// tour et par joueur, après les ordres. Tout est en entiers (règle 2 du
// CLAUDE.md) : divisions par Math.floor, multiplications avant les divisions.
//
// Unités : la population est un nombre de personnes ; une surface est un nombre
// de cases ; la mécanisation M est en millièmes de case par travailleur ; les
// machines sont comptées pour 1 000 travailleurs (choix provisoires, 02-Engine §7).

import { FARMING, FISHING, FOOD, POPULATION, type MechanizationConfig } from "./config.ts";
import type { GameState, Player } from "./state.ts";

/** Échelle de la courbe de mécanisation (00-Game §6.3) : x = 1 s'écrit S. */
export const CURVE_SCALE = 10_000;
/** Un millième : unité de M (millièmes de case par travailleur). */
const MILLI = 1000;
/** Échelle du reste de croissance : millionièmes de personne. */
export const GROWTH_SCALE = 1_000_000;

/**
 * f(x) = 1 − (1 − x)ⁿ (00-Game §6.3), en entiers sur 0…S : `X` est x ramené sur
 * 0…S (0 ≤ X ≤ S), `n` entier ≥ 1. f(0) = 0, f(S) = S. Plus grand intermédiaire :
 * S × S = 10⁸.
 */
export function mechanizationCurve(X: number, n: number): number {
  const S = CURVE_SCALE;
  let p = S;
  for (let i = 0; i < n; i++) p = Math.floor((p * (S - X)) / S);
  return S - p;
}

/**
 * Mécanisation M, en millièmes de case par travailleur (00-Game §6.2) :
 * `available` travailleurs disponibles, `machines` machines (tracteurs ou
 * bateaux). La part de machines est calculée une fois, avec les travailleurs
 * disponibles et non ceux qui travaillent réellement.
 */
export function mechanization(cfg: MechanizationConfig, available: number, machines: number): number {
  const f = machineCurve(cfg, available, machines);
  return cfg.mechanizationBase + Math.floor(((cfg.mechanizationMax - cfg.mechanizationBase) * f) / CURVE_SCALE);
}

/** f(x) sur 0…S pour `machines` machines et `available` travailleurs disponibles (00-Game §6.2, §6.3). */
export function machineCurve(cfg: MechanizationConfig, available: number, machines: number): number {
  const S = CURVE_SCALE;
  const X =
    available === 0
      ? 0
      : Math.min(S, Math.floor((machines * MILLI * S) / (available * cfg.maxMachinesPer1000)));
  return mechanizationCurve(X, cfg.curveExponent);
}

/**
 * Rendement d'une case d'eau, en millièmes (00-Game §6.4) : de `tileYield` sans
 * bateau à `tileYieldMax` avec le maximum, selon la même courbe que la
 * mécanisation de la pêche.
 */
export function waterYieldMilli(available: number, boats: number): number {
  const f = machineCurve(FISHING, available, boats);
  return FISHING.tileYield * MILLI + Math.floor(((FISHING.tileYieldMax - FISHING.tileYield) * MILLI * f) / CURVE_SCALE);
}

export interface Harvest {
  /** Travailleurs qui travaillent : min(disponibles, requis). */
  readonly workers: number;
  /** Surface travaillée, en cases : min(surface_max, travailleurs × M / 1000). */
  readonly area: number;
  /** Production : fertilité_totale × surface travaillée / surface_max (00-Game §6.5). */
  readonly yield: number;
}

/**
 * Agriculture (00-Game §6.2) ou pêche (§6.4) d'un joueur. `surfaceMax` : nombre
 * de cases ; `fertilitySum` : somme de leurs fertilités. `required` est arrondi
 * vers le haut (00-Game §13 le laisse ouvert) : assez de travailleurs pour
 * couvrir toute la surface.
 */
export function harvest(
  cfg: MechanizationConfig,
  available: number,
  machines: number,
  surfaceMax: number,
  fertilitySum: number,
): Harvest {
  const M = mechanization(cfg, available, machines);
  const required = Math.ceil((surfaceMax * MILLI) / M);
  const workers = Math.min(available, required);
  const area = Math.min(surfaceMax, Math.floor((workers * M) / MILLI));
  const output = surfaceMax === 0 ? 0 : Math.floor((fertilitySum * area) / surfaceMax);
  return { workers, area, yield: output };
}

/**
 * Étape de nourriture et de population d'un joueur (00-Game §4, §4.1, §6) :
 * répartition, récolte, nourriture, croissance avec reste. Les résultats sont
 * calculés sur la population du début de l'étape, puis la croissance la change.
 */
function stepPlayer(p: Player): void {
  // Il n'y a pas encore de ligne de production : toute la population passe à
  // l'étape 2 du §4, fermiers et pêcheurs selon le réglage du joueur.
  const availableFarmers = Math.floor((p.population * p.farmPercent) / 100);
  const availableFishers = p.population - availableFarmers;
  // Pas encore d'usine : ni tracteur ni bateau de pêche. Les usines fourniront ces nombres.
  const tractors = 0;
  const fishingBoats = 0;
  const farm = harvest(FARMING, availableFarmers, tractors, p.farmTiles, p.fertilitySum);
  // Rendement total de l'eau = cases × rendement d'une case (millièmes), arrondi à l'unité.
  const seaYield = Math.floor((p.seaTiles * waterYieldMilli(availableFishers, fishingBoats)) / MILLI);
  const sea = harvest(FISHING, availableFishers, fishingBoats, p.seaTiles, seaYield);

  p.farmers = farm.workers;
  p.fishers = sea.workers;
  p.idle = availableFarmers - farm.workers + (availableFishers - sea.workers);
  p.cultivated = farm.area;
  p.fished = sea.area;
  p.wheat = farm.yield;
  p.fish = sea.yield;
  p.food = Math.max(p.wheat + p.fish, FOOD.minimum);

  // Croissance (00-Game §4.1) : le reste, en millionièmes de personne, garde la
  // fraction d'un tour à l'autre. Les négatifs sont arrondis vers zéro (Math.trunc).
  const surplus = p.food - p.population * POPULATION.foodPerHead;
  p.growthRemainder += surplus * POPULATION.growthPerMillion;
  const delta = Math.trunc(p.growthRemainder / GROWTH_SCALE);
  p.population += delta;
  p.growthRemainder -= delta * GROWTH_SCALE;
  if (p.population < 0) {
    p.population = 0;
    p.growthRemainder = 0;
  }
}

/** Étape de tous les joueurs, dans l'ordre des identifiants. Appelée par `applyTurn` après les ordres. */
export function stepEconomy(state: GameState): void {
  for (const p of state.players) stepPlayer(p);
}
