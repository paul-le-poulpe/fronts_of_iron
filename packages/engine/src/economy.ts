// Population, lignes de production, extraction du fer, agriculture et pêche
// (Docs/Design/00-Game.md §4, §6, §7, §8) : une étape par tour et par joueur,
// après les ordres. Tout est en entiers (règle 2 du
// CLAUDE.md) : divisions par Math.floor, multiplications avant les divisions.
//
// Unités : la population est un nombre de personnes ; une surface est un nombre
// de cases ; la mécanisation M est en millièmes de case par travailleur ; les
// machines sont comptées pour 1 000 travailleurs (choix provisoires, 02-Engine §7).

import {
  ARMAMENT,
  FACTORY,
  FACTORY_TYPES,
  FARMING,
  FISHING,
  FOOD,
  MINING,
  POPULATION,
  RESOURCES,
  type MechanizationConfig,
} from "./config.ts";
import { ARMAMENT_IDS, armamentIndex, armamentReserveMax, goodIndex, productConfig } from "./factories.ts";
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
  extra = 0,
): Harvest {
  const M = mechanization(cfg, available, machines);
  const required = Math.ceil((surfaceMax * MILLI) / M);
  // `extra` : travailleurs en trop de l'autre activité (report, 00-Game §4). Ils
  // ne changent pas M, calculé une fois avec les disponibles (00-Game §6.2).
  const workers = Math.min(available + extra, required);
  const area = Math.min(surfaceMax, Math.floor((workers * M) / MILLI));
  const output = surfaceMax === 0 ? 0 : Math.floor((fertilitySum * area) / surfaceMax);
  return { workers, area, yield: output };
}

/** Travailleurs requis pour couvrir `surfaceMax` cases (00-Game §6.2), arrondi vers le haut. */
export function requiredWorkers(cfg: MechanizationConfig, available: number, machines: number, surfaceMax: number): number {
  return Math.ceil((surfaceMax * MILLI) / mechanization(cfg, available, machines));
}

/** Rang du fer dans `Player.resourceTiles` (ordre des clés de RESOURCES). */
const IRON = Object.keys(RESOURCES).indexOf("iron");
const TRACTOR = goodIndex("tractor");
const FISHING_BOAT = goodIndex("fishingBoat");
const MINING_MACHINE = goodIndex("miningMachine");

/** Cases de fer à exploiter pour extraire `demand` fer par tour (00-Game §7, `cases_exploitées`). */
export function ironTilesFor(demand: number): number {
  return Math.ceil(demand / RESOURCES.iron.capacityPerTile);
}

/**
 * Mineurs pour extraire `demand` fer par tour avec `machines` engins miniers (00-Game
 * §7). Engins par mineur : rapportés aux mineurs qu'il faudrait sans engin, à
 * `MINING.mechanizationBase` (choix provisoire, 02-Engine §7). Ne baisse jamais
 * quand `demand` monte.
 */
export function minersFor(demand: number, machines: number): number {
  const tiles = ironTilesFor(demand);
  if (tiles === 0) return 0;
  const withoutMachines = Math.ceil((tiles * MILLI) / MINING.mechanizationBase);
  return Math.ceil((tiles * MILLI) / mechanization(MINING, withoutMachines, machines));
}

interface LineFill {
  readonly workers: number;
  readonly miners: number;
  /** Fer demandé = extrait : celui des lignes remplies. */
  readonly iron: number;
}

/**
 * Remplissage des lignes (00-Game §4, étape 1) : usines dans l'ordre de priorité,
 * groupes dans l'ordre de leur usine, lignes actives une par une. Une ligne reçoit
 * `workersPerLine` ouvriers et les mineurs du fer qu'elle ajoute, en entier ou
 * pas du tout ; la première ligne qui ne peut pas être remplie arrête tout le
 * remplissage. Écrit `filled` dans les groupes.
 */
function fillLines(p: Player, machines: number): LineFill {
  let workers = 0;
  let miners = 0;
  let iron = 0;
  for (const f of p.factories) for (const g of f.groups) g.filled = 0;
  const capacity = p.resourceTiles[IRON]! * RESOURCES.iron.capacityPerTile;
  scan: for (const f of p.factories) {
    for (const g of f.groups) {
      const ironPerLine = productConfig(g.good).ironPerLine;
      for (let j = 0; j < g.active; j++) {
        const demand = iron + ironPerLine;
        if (demand > capacity) break scan;
        const needed = minersFor(demand, machines);
        if (workers + FACTORY.workersPerLine + needed > p.population) break scan;
        workers += FACTORY.workersPerLine;
        miners = needed;
        iron = demand;
        g.filled++;
      }
    }
  }
  return { workers, miners, iron };
}

/**
 * Production des lignes remplies (00-Game §8, §8.3) : les biens vont dans
 * `p.goods` (les machines du tour suivant), l'armement dans les réserves ; puis
 * progression du déblocage (00-Game §8.2) ; puis déclin de l'excès au-dessus du
 * stock cible, avec son reste. La production ne s'arrête jamais (00-Game §8.3).
 */
function produce(p: Player): void {
  p.goods.fill(0);
  for (const f of p.factories) {
    for (const g of f.groups) {
      if (g.filled === 0) continue;
      const quantity = g.filled * productConfig(g.good).productionPerLine;
      const a = armamentIndex(g.good);
      if (a >= 0) p.armamentReserve[a] = p.armamentReserve[a]! + quantity;
      else p.goods[goodIndex(g.good)] = p.goods[goodIndex(g.good)]! + quantity;
    }
    const tree = FACTORY_TYPES[f.type].tree;
    for (let i = 0; i < tree.length; i++) {
      if (f.groups.some((g) => g.good === tree[i]!.good && g.filled > 0)) {
        f.progress[i] = Math.min(FACTORY.unlockTurns, f.progress[i]! + 1);
      }
    }
  }
  for (let a = 0; a < ARMAMENT_IDS.length; a++) {
    const excess = Math.max(0, p.armamentReserve[a]! - armamentReserveMax(p, ARMAMENT_IDS[a]!));
    if (excess === 0) {
      p.armamentRemainder[a] = 0;
      continue;
    }
    const total = p.armamentRemainder[a]! + excess * ARMAMENT.decayRate;
    const lost = Math.floor(total / CURVE_SCALE);
    p.armamentRemainder[a] = total - lost * CURVE_SCALE;
    p.armamentReserve[a] = p.armamentReserve[a]! - lost;
  }
}

/**
 * Étape d'un joueur (00-Game §4, §4.1, §6, §7, §8) : remplissage des lignes, répartition du reste en fermiers et pêcheurs, récolte,
 * production, nourriture, croissance avec reste. Les résultats sont calculés sur
 * la population du début de l'étape, puis la croissance la change. Les machines
 * utilisées sont celles produites au tour précédent (00-Game §12).
 */
function stepPlayer(p: Player): void {
  const tractors = p.goods[TRACTOR]!;
  const fishingBoats = p.goods[FISHING_BOAT]!;
  const lines = fillLines(p, p.goods[MINING_MACHINE]!);
  // Ce qui reste après les ouvriers et les mineurs passe à l'étape 2 du §4, fermiers et pêcheurs selon le réglage du joueur.
  const remaining = p.population - lines.workers - lines.miners;
  const availableFarmers = Math.floor((remaining * p.farmPercent) / 100);
  const availableFishers = remaining - availableFarmers;
  // Report (00-Game §4, étape 3) : les disponibles en trop d'un côté vont à l'autre,
  // jusqu'à ce qu'il soit plein. Le réglage ne joue que si la population manque.
  const spareFarmers = Math.max(0, availableFarmers - requiredWorkers(FARMING, availableFarmers, tractors, p.farmTiles));
  const spareFishers = Math.max(0, availableFishers - requiredWorkers(FISHING, availableFishers, fishingBoats, p.seaTiles));
  const farm = harvest(FARMING, availableFarmers, tractors, p.farmTiles, p.fertilitySum, spareFishers);
  // Rendement total de l'eau = cases × rendement d'une case (millièmes), arrondi à l'unité.
  const seaYield = Math.floor((p.seaTiles * waterYieldMilli(availableFishers, fishingBoats)) / MILLI);
  const sea = harvest(FISHING, availableFishers, fishingBoats, p.seaTiles, seaYield, spareFarmers);

  p.farmers = farm.workers;
  p.fishers = sea.workers;
  p.idle = remaining - farm.workers - sea.workers;
  p.cultivated = farm.area;
  p.fished = sea.area;
  p.wheat = farm.yield;
  p.fish = sea.yield;
  p.food = Math.max(p.wheat + p.fish, FOOD.minimum);
  p.factoryWorkers = lines.workers;
  p.miners = lines.miners;
  p.minedTiles = ironTilesFor(lines.iron);
  p.ironExtracted = lines.iron;
  produce(p);

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
