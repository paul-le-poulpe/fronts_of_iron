// La carte : un octet de terrain et un octet de ressources par case, adresse =
// y × largeur + x.
// La fertilité est un octet par case aussi, 0 à 10.
// Le propriétaire de chaque case est dans l'état de la partie (state.ts), pas ici :
// la carte ne change pas pendant une partie.

import { RESOURCES } from "./config.ts";

/** Bit 7 : terre. */
export const TERRAIN_LAND = 0x80;
/** Bit 6 : côte = case de terre dont au moins un des 4 voisins est de l'eau. */
export const TERRAIN_SHORE = 0x40;
/** Bit 5 : océan = eau reliée au bord de la carte. Une eau sans ce bit est un lac. */
export const TERRAIN_OCEAN = 0x20;
/** Bits 0 à 4 : altitude 0 à 31 (toujours 0 sur l'eau). */
export const TERRAIN_ALTITUDE = 0x1f;

/** Nombre de ressources naturelles : le bit i de `resources` est la i-ème clé de RESOURCES. */
export const RESOURCE_COUNT = Object.keys(RESOURCES).length;
/** Bit 0 de `resources` : fer (première clé de RESOURCES). */
export const RESOURCE_IRON = 0x01;
/** Bit 1 de `resources` : aluminium (deuxième clé de RESOURCES). */
export const RESOURCE_ALUMINIUM = 0x02;

export interface GameMap {
  readonly width: number;
  readonly height: number;
  /** width × height octets ; voir les constantes TERRAIN_*. */
  readonly terrain: Uint8Array;
  /** width × height octets ; un bit par ressource (RESOURCE_*), 1 = présente sur la case. */
  readonly resources: Uint8Array;
  /** width × height octets ; fertilité 0 à 10 (00-Game §2). 0 sur l'eau et les montagnes. */
  readonly fertility: Uint8Array;
}

export function isLand(map: GameMap, tile: number): boolean {
  return (map.terrain[tile]! & TERRAIN_LAND) !== 0;
}

export function altitude(map: GameMap, tile: number): number {
  return map.terrain[tile]! & TERRAIN_ALTITUDE;
}

/**
 * Appelle `visit` pour chacun des 4 voisins de `tile` qui est dans la carte,
 * dans l'ordre fixe : gauche, droite, haut, bas. Pas de passage d'un bord à l'autre.
 */
export function forEachNeighbor(map: GameMap, tile: number, visit: (neighbor: number) => void): void {
  const w = map.width;
  const x = tile % w;
  if (x > 0) visit(tile - 1);
  if (x < w - 1) visit(tile + 1);
  if (tile >= w) visit(tile - w);
  if (tile < w * (map.height - 1)) visit(tile + w);
}
