// L'état complet d'une partie. Tout ce qui est ici entre dans le hash (hash.ts),
// sauf `changedMark`, remis à zéro à la fin de chaque tour, et `roadNetwork`,
// entièrement déduit des villes.

import { isUint32 } from "./bits.ts";
import { ARMAMENT, CITY, GOODS, MAX_PLAYERS, type FactoryTypeId, type ProductId } from "./config.ts";
import { hashMap } from "./hash.ts";
import { RESOURCE_COUNT, TERRAIN_LAND, type GameMap } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
import { createRoadNetwork, type RoadNetwork } from "./roads.ts";

/** Les lignes d'un même bien dans une usine, réglées ensemble (00-Game §8.1). */
export interface LineGroup {
  readonly good: ProductId;
  /** Nombre de lignes de ce bien dans l'usine (≥ 1). */
  lines: number;
  /** Lignes activées par le joueur, 0 à `lines`. Les premières du groupe sont les actives. */
  active: number;
  /** Lignes remplies au dernier tour (ouvriers et mineurs reçus), 0 à `active`. */
  filled: number;
}

/** L'usine d'une ville (00-Game §8). Une seule par ville : voir 02-Engine §7. */
export interface Factory {
  readonly city: number;
  readonly type: FactoryTypeId;
  /** Groupes de lignes, dans l'ordre de priorité du joueur au sein de la ville (00-Game §8.1). */
  readonly groups: LineGroup[];
  /**
   * Un compteur par nœud de l'arbre du type d'usine (même indice) : tours où au moins
   * une ligne de ce bien a été remplie dans cette usine, plafonné à `FACTORY.unlockTurns`
   * (00-Game §8.2).
   */
  readonly progress: number[];
}

export interface Player {
  /** 1 à MAX_PLAYERS ; c'est la valeur écrite dans `owner`. */
  readonly id: number;
  /** Nombre de cases dont `owner` vaut `id`. Tenu à jour par `setOwner`. */
  tileCount: number;
  /** Population totale du joueur, en personnes (00-Game §4). 0 au départ. */
  population: number;
  /** Fraction de personne gagnée ou perdue, en millionièmes de personne, de signe quelconque ; |reste| < 1 000 000 en fin de tour (00-Game §4.1). */
  growthRemainder: number;
  /** Part de la population (hors usines) qui va aux fermiers, entier 0 à 100 ; le reste va aux pêcheurs (00-Game §4). 100 au départ. */
  farmPercent: number;
  /** Identifiant de la capitale, 0 = pas encore de ville (00-Game §3.4). */
  capital: number;
  /** Identifiants des villes du joueur, dans l'ordre de fondation. */
  readonly cityIds: number[];
  /** Pour chaque ressource (ordre de RESOURCES) : nombre de cases du joueur qui la portent. Tenu à jour par `setOwner`. */
  readonly resourceTiles: number[];
  /** `surface_max` (00-Game §6.1) : nombre de cases de fertilité > 0 que possède le joueur. Tenu à jour par `setOwner`. */
  farmTiles: number;
  /** `fertilité_totale` (00-Game §6.1) : somme des fertilités des cases du joueur. Tenu à jour par `setOwner`. */
  fertilitySum: number;
  /** Nombre de cases d'eau (mer et lacs) que possède le joueur : la surface de pêche maximale (00-Game §6.4). Tenu à jour par `setOwner`. */
  seaTiles: number;
  // Résultats du dernier tour (economy.ts), calculés sur la population du début de l'étape. 0 avant le premier tour.
  /** Fermiers qui travaillent (≤ fermiers disponibles). */
  farmers: number;
  /** Pêcheurs qui travaillent (≤ pêcheurs disponibles). */
  fishers: number;
  /** Population inactive : fermiers et pêcheurs disponibles sans surface à travailler. */
  idle: number;
  /** Surface cultivée, en cases (≤ farmTiles). */
  cultivated: number;
  /** Surface pêchée, en cases (≤ seaTiles). */
  fished: number;
  wheat: number;
  fish: number;
  /** Nourriture du tour : max(blé + poisson, FOOD.minimum). */
  food: number;
  /**
   * Usines du joueur, une par ville. L'ordre du tableau est l'ordre de priorité des
   * villes pour le remplissage des lignes (00-Game §4, §8.1).
   */
  readonly factories: Factory[];
  /** Biens produits au dernier tour, dans l'ordre des clés de `GOODS` : les machines du tour suivant (00-Game §12). */
  readonly goods: number[];
  /** Réserve de chaque type d'armement, dans l'ordre des clés de `ARMAMENT.types` (00-Game §8.3). */
  readonly armamentReserve: number[];
  /** Reste de la baisse de l'excès de chaque réserve, sur l'échelle `CURVE_SCALE` (0 si pas d'excès). */
  readonly armamentRemainder: number[];
  /** Ouvriers des lignes remplies au dernier tour. */
  factoryWorkers: number;
  /** Mineurs de fer au dernier tour. */
  miners: number;
  /** Cases de fer exploitées au dernier tour (00-Game §7, `cases_exploitées`). */
  minedTiles: number;
  /** Fer extrait au dernier tour : celui des lignes remplies. */
  ironExtracted: number;
}

export interface City {
  /** 1, 2, 3… dans l'ordre de fondation ; la ville est `state.cities[id - 1]`. Plus petit = plus ancienne. */
  readonly id: number;
  readonly player: number;
  /** Case où la ville est fondée. */
  readonly tile: number;
  /** Port : la zone de la ville contient au moins une case non terrestre (00-Game §3.6). */
  port: boolean;
  /** Groupe (00-Game §3.5) : plus petit identifiant de ville de la composante reliée par les routes du joueur. */
  group: number;
}

export interface GameState {
  readonly map: GameMap;
  /** Hash du terrain et des dimensions, calculé une fois à la création. */
  readonly mapHash: number;
  /** Propriétaire de chaque case, 0 = personne. Même adressage que `map.terrain`. */
  readonly owner: Uint16Array;
  /** `players[id - 1]` est le joueur `id`. */
  readonly players: readonly Player[];
  /** `cities[id - 1]` est la ville `id`. Les villes ne disparaissent pas encore. */
  readonly cities: City[];
  /** Identifiant de la ville dont la zone contient la case (terre et eau), 0 = aucune (00-Game §3.2). */
  readonly tileCity: Uint16Array;
  /** Routes terrestres gardées (00-Game §3.5) : paires d'identifiants [a, b], a < b, triées par longueur au carré, puis a, puis b. Mises à jour à chaque fondation par `roadNetwork`. */
  readonly roads: [number, number][];
  /** Toutes les routes candidates et leur grille (roads.ts). Déduit des villes : hors du hash, comme `changedMark`. */
  readonly roadNetwork: RoadNetwork;
  readonly rng: Rng;
  /** Numéro du dernier tour appliqué ; 0 avant le premier. */
  tick: number;
  /** 1 sur les cases déjà listées comme modifiées pendant le tour en cours. */
  readonly changedMark: Uint8Array;
}

export interface GameSetup {
  /** Graine du générateur aléatoire de la partie, entier 0 à 2³² − 1. */
  readonly seed: number;
  readonly map: GameMap;
  /** Les joueurs reçoivent les identifiants 1 à playerCount. */
  readonly playerCount: number;
}

/** Lève une erreur si la configuration est invalide : elle vient du serveur, pas d'un joueur. */
export function createGame(setup: GameSetup): GameState {
  if (!isUint32(setup.seed)) throw new Error(`graine invalide : ${setup.seed}`);
  const { playerCount, map } = setup;
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) {
    throw new Error(`nombre de joueurs invalide : ${playerCount}`);
  }
  const size = map.width * map.height;
  if (map.terrain.length !== size) throw new Error("terrain de taille incorrecte");
  if (map.resources.length !== size) throw new Error("ressources de taille incorrecte");
  if (map.fertility.length !== size) throw new Error("fertilité de taille incorrecte");
  const players: Player[] = [];
  for (let id = 1; id <= playerCount; id++) {
    players.push({
      id,
      tileCount: 0,
      population: 0,
      growthRemainder: 0,
      farmPercent: 100,
      capital: 0,
      cityIds: [],
      resourceTiles: new Array<number>(RESOURCE_COUNT).fill(0),
      farmTiles: 0,
      fertilitySum: 0,
      seaTiles: 0,
      farmers: 0,
      fishers: 0,
      idle: 0,
      cultivated: 0,
      fished: 0,
      wheat: 0,
      fish: 0,
      food: 0,
      factories: [],
      goods: new Array<number>(Object.keys(GOODS).length).fill(0),
      armamentReserve: new Array<number>(Object.keys(ARMAMENT.types).length).fill(0),
      armamentRemainder: new Array<number>(Object.keys(ARMAMENT.types).length).fill(0),
      factoryWorkers: 0,
      miners: 0,
      minedTiles: 0,
      ironExtracted: 0,
    });
  }
  return {
    map,
    mapHash: hashMap(map),
    owner: new Uint16Array(size),
    players,
    cities: [],
    tileCity: new Uint16Array(size),
    roads: [],
    roadNetwork: createRoadNetwork(map.width, map.height, CITY.expansionRadius),
    rng: createRng(setup.seed),
    tick: 0,
    changedMark: new Uint8Array(size),
  };
}

export function isPlayerId(state: GameState, v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= state.players.length;
}

/**
 * Seule façon de changer le propriétaire d'une case : met à jour `owner`, les
 * compteurs de cases, de ressources, de cases fertiles, de fertilité et de cases
 * d'eau des joueurs, et ajoute la case à `changed` la première fois qu'elle
 * change dans le tour.
 */
export function setOwner(state: GameState, tile: number, newOwner: number, changed: number[]): void {
  const prev = state.owner[tile]!;
  if (prev === newOwner) return;
  const fertility = state.map.fertility[tile]!;
  const water = (state.map.terrain[tile]! & TERRAIN_LAND) === 0;
  if (prev !== 0) {
    const p = state.players[prev - 1]!;
    p.tileCount--;
    if (fertility > 0) p.farmTiles--;
    p.fertilitySum -= fertility;
    if (water) p.seaTiles--;
  }
  if (newOwner !== 0) {
    const p = state.players[newOwner - 1]!;
    p.tileCount++;
    if (fertility > 0) p.farmTiles++;
    p.fertilitySum += fertility;
    if (water) p.seaTiles++;
  }
  const res = state.map.resources[tile]!;
  if (res !== 0) {
    for (let i = 0; i < RESOURCE_COUNT; i++) {
      if (((res >> i) & 1) === 0) continue;
      if (prev !== 0) {
        const rt = state.players[prev - 1]!.resourceTiles;
        rt[i] = rt[i]! - 1;
      }
      if (newOwner !== 0) {
        const rt = state.players[newOwner - 1]!.resourceTiles;
        rt[i] = rt[i]! + 1;
      }
    }
  }
  state.owner[tile] = newOwner;
  if (state.changedMark[tile] === 0) {
    state.changedMark[tile] = 1;
    changed.push(tile);
  }
}
