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
 * Référence du nombre de machines par travailleur (00-Game §6.2) : les
 * travailleurs disponibles, plafonnés à ceux qu'il faudrait sans machine pour
 * couvrir `surface` cases. Un disponible au-delà n'aurait jamais de travail : il
 * ne dilue pas les machines.
 */
export function machineReference(cfg: MechanizationConfig, available: number, surface: number): number {
  return Math.min(available, Math.ceil((surface * MILLI) / cfg.mechanizationBase));
}

/**
 * Mécanisation M, en millièmes de case par travailleur (00-Game §6.2) :
 * `machines` machines (tracteurs ou bateaux) rapportées à `available`
 * travailleurs (la référence, `machineReference`). Calculée une fois, avec les
 * travailleurs disponibles et non ceux qui travaillent réellement.
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
  // `extra` : travailleurs en trop de l'autre activité (report, 00-Game §4). Ils
  // comptent parmi les disponibles de la référence : à 0 % de fermiers, les
  // pêcheurs reportés aux champs utilisent les tracteurs (00-Game §6.2).
  const M = mechanization(cfg, machineReference(cfg, available + extra, surfaceMax), machines);
  const required = Math.ceil((surfaceMax * MILLI) / M);
  const workers = Math.min(available + extra, required);
  const area = Math.min(surfaceMax, Math.floor((workers * M) / MILLI));
  const output = surfaceMax === 0 ? 0 : Math.floor((fertilitySum * area) / surfaceMax);
  return { workers, area, yield: output };
}

/** Travailleurs requis pour couvrir `surfaceMax` cases (00-Game §6.2), arrondi vers le haut. */
export function requiredWorkers(cfg: MechanizationConfig, available: number, machines: number, surfaceMax: number): number {
  return Math.ceil((surfaceMax * MILLI) / mechanization(cfg, machineReference(cfg, available, surfaceMax), machines));
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
 * remplissage. Une ligne de bien n'est pas remplie quand la production déjà
 * remplie pour ce bien atteint sa demande du tour précédent (`goodsDemand`,
 * 00-Game §8.2) : ses ouvriers vont ailleurs, et le remplissage continue avec les
 * groupes suivants. Écrit `filled` dans les groupes.
 */
function fillLines(p: Player, machines: number): LineFill {
  let workers = 0;
  let miners = 0;
  let iron = 0;
  for (const f of p.factories) for (const g of f.groups) g.filled = 0;
  const capacity = p.resourceTiles[IRON]! * RESOURCES.iron.capacityPerTile;
  const produced = new Array<number>(p.goods.length).fill(0);
  scan: for (const f of p.factories) {
    for (const g of f.groups) {
      const ironPerLine = productConfig(g.good).ironPerLine;
      const b = armamentIndex(g.good) < 0 ? goodIndex(g.good) : -1;
      for (let j = 0; j < g.active; j++) {
        if (b >= 0 && produced[b]! >= p.goodsDemand[b]!) break;
        const demand = iron + ironPerLine;
        if (demand > capacity) break scan;
        const needed = minersFor(demand, machines);
        if (workers + FACTORY.workersPerLine + needed > p.population) break scan;
        workers += FACTORY.workersPerLine;
        miners = needed;
        iron = demand;
        g.filled++;
        if (b >= 0) produced[b] = produced[b]! + productConfig(g.good).productionPerLine;
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
  growLines(p);
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
 * Croissance automatique des lignes de biens (00-Game §8.2) : un groupe dont toutes
 * les lignes ont produit ce tour avance d'un tour ; après `FACTORY.growthTurns`
 * tours, il gagne une ligne active et le compteur repart de 0. Il n'avance pas
 * quand la capacité du joueur pour ce bien (toutes ses lignes × production par
 * ligne) couvre déjà la demande (`goodsDemand`). L'armement ne grandit pas tout
 * seul : sa demande attend les armées.
 */
function growLines(p: Player): void {
  const capacity = new Array<number>(p.goods.length).fill(0);
  for (const f of p.factories) {
    for (const g of f.groups) {
      if (armamentIndex(g.good) < 0) capacity[goodIndex(g.good)] += g.lines * productConfig(g.good).productionPerLine;
    }
  }
  for (const f of p.factories) {
    for (const g of f.groups) {
      if (armamentIndex(g.good) >= 0) continue;
      const b = goodIndex(g.good);
      if (capacity[b]! >= p.goodsDemand[b]! || g.filled < g.lines) continue;
      g.growth++;
      if (g.growth < FACTORY.growthTurns) continue;
      g.growth = 0;
      g.lines++;
      g.active++;
      capacity[b] = capacity[b]! + productConfig(g.good).productionPerLine;
    }
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
  const seaYield = Math.floor((p.seaTiles * waterYieldMilli(machineReference(FISHING, availableFishers + spareFarmers, p.seaTiles), fishingBoats)) / MILLI);
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
  // Demande de machines : celles d'une mécanisation totale (référence × m_max, 00-Game §6.2).
  const full = (ref: number, per1000: number): number => Math.ceil((ref * per1000) / MILLI);
  p.goodsDemand[TRACTOR] = full(machineReference(FARMING, availableFarmers + spareFishers, p.farmTiles), FARMING.maxMachinesPer1000);
  p.goodsDemand[FISHING_BOAT] = full(machineReference(FISHING, availableFishers + spareFarmers, p.seaTiles), FISHING.maxMachinesPer1000);
  // Engins : sur le fer demandé par toutes les lignes actives, pas sur le fer extrait.
  // Sinon une usine d'engins seule, plafonnée à une demande nulle, n'extrairait
  // jamais de fer et sa demande resterait nulle.
  let requiredIron = 0;
  for (const f of p.factories) for (const g of f.groups) requiredIron += g.active * productConfig(g.good).ironPerLine;
  p.goodsDemand[MINING_MACHINE] = full(
    Math.ceil((ironTilesFor(Math.min(requiredIron, p.resourceTiles[IRON]! * RESOURCES.iron.capacityPerTile)) * MILLI) / MINING.mechanizationBase),
    MINING.maxMachinesPer1000,
  );
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
