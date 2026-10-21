// L'état complet d'une partie. Tout ce qui est ici entre dans le hash (hash.ts),
// sauf `changedMark`, remis à zéro à la fin de chaque tour.

import { isUint32 } from "./bits.ts";
import { MAX_PLAYERS } from "./config.ts";
import { hashMap } from "./hash.ts";
import type { GameMap } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";

export interface Player {
  /** 1 à MAX_PLAYERS ; c'est la valeur écrite dans `owner`. */
  readonly id: number;
  /** Nombre de cases dont `owner` vaut `id`. Tenu à jour par `setOwner`. */
  tileCount: number;
}

export interface GameState {
  readonly map: GameMap;
  /** Hash du terrain et des dimensions, calculé une fois à la création. */
  readonly mapHash: number;
  /** Propriétaire de chaque case, 0 = personne. Même adressage que `map.terrain`. */
  readonly owner: Uint16Array;
  /** `players[id - 1]` est le joueur `id`. */
  readonly players: readonly Player[];
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
  const players: Player[] = [];
  for (let id = 1; id <= playerCount; id++) players.push({ id, tileCount: 0 });
  return {
    map,
    mapHash: hashMap(map),
    owner: new Uint16Array(size),
    players,
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
 * compteurs de cases des joueurs, et ajoute la case à `changed` la première
 * fois qu'elle change dans le tour.
 */
export function setOwner(state: GameState, tile: number, newOwner: number, changed: number[]): void {
  const prev = state.owner[tile]!;
  if (prev === newOwner) return;
  if (prev !== 0) state.players[prev - 1]!.tileCount--;
  if (newOwner !== 0) state.players[newOwner - 1]!.tileCount++;
  state.owner[tile] = newOwner;
  if (state.changedMark[tile] === 0) {
    state.changedMark[tile] = 1;
    changed.push(tile);
  }
}
