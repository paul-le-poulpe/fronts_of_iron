// L'état complet d'une partie. Tout ce qui est ici entre dans le hash (hash.ts),
// sauf `changedMark`, remis à zéro à la fin de chaque tour, et `roadNetwork`,
// entièrement déduit des villes.

import { isUint32 } from "./bits.ts";
import { CITY, MAX_PLAYERS } from "./config.ts";
import { hashMap } from "./hash.ts";
import { RESOURCE_COUNT, type GameMap } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
import { createRoadNetwork, type RoadNetwork } from "./roads.ts";

export interface Player {
  /** 1 à MAX_PLAYERS ; c'est la valeur écrite dans `owner`. */
  readonly id: number;
  /** Nombre de cases dont `owner` vaut `id`. Tenu à jour par `setOwner`. */
  tileCount: number;
  /** Population totale du joueur (00-Game §4). 0 au départ. */
  population: number;
  /** Identifiant de la capitale, 0 = pas encore de ville (00-Game §3.4). */
  capital: number;
  /** Identifiants des villes du joueur, dans l'ordre de fondation. */
  readonly cityIds: number[];
  /** Pour chaque ressource (ordre de RESOURCES) : nombre de cases du joueur qui la portent. Tenu à jour par `setOwner`. */
  readonly resourceTiles: number[];
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
  const players: Player[] = [];
  for (let id = 1; id <= playerCount; id++) {
    players.push({
      id,
      tileCount: 0,
      population: 0,
      capital: 0,
      cityIds: [],
      resourceTiles: new Array<number>(RESOURCE_COUNT).fill(0),
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
 * compteurs de cases et de ressources des joueurs, et ajoute la case à
 * `changed` la première fois qu'elle change dans le tour.
 */
export function setOwner(state: GameState, tile: number, newOwner: number, changed: number[]): void {
  const prev = state.owner[tile]!;
  if (prev === newOwner) return;
  if (prev !== 0) state.players[prev - 1]!.tileCount--;
  if (newOwner !== 0) state.players[newOwner - 1]!.tileCount++;
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
