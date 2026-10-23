// Bruit de valeur en entiers, partagé par le relief (mapgen.ts) et la présence
// des ressources (resources.ts).

import { fmix32 } from "./bits.ts";

/** Échelle des fractions dans [0, 1] : 1024 représente 1. */
export const ONE = 1024;

/**
 * Bruit de valeur : une valeur pseudo-aléatoire 0 à 65 535 à chaque nœud d'une
 * grille de pas `cell`, interpolée entre les 4 nœuds qui entourent (x, y).
 */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const ix = Math.floor(x / cell);
  const iy = Math.floor(y / cell);
  const tx = smoothstep(Math.floor(((x - ix * cell) * ONE) / cell));
  const ty = smoothstep(Math.floor(((y - iy * cell) * ONE) / cell));
  const v00 = lattice(ix, iy, seed);
  const v10 = lattice(ix + 1, iy, seed);
  const v01 = lattice(ix, iy + 1, seed);
  const v11 = lattice(ix + 1, iy + 1, seed);
  // Écarts < 2¹⁶, facteurs ≤ 2¹⁰ : les produits tiennent dans 32 bits et >> 10 divise par ONE.
  const a = v00 + (((v10 - v00) * tx) >> 10);
  const b = v01 + (((v11 - v01) * tx) >> 10);
  return a + (((b - a) * ty) >> 10);
}

function lattice(ix: number, iy: number, seed: number): number {
  return fmix32(seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1)) >>> 16;
}

/** 3t² − 2t³ pour t dans [0, ONE] : courbe en S qui supprime les angles de la grille. */
function smoothstep(t: number): number {
  return Math.floor((t * t * (3 * ONE - 2 * t)) / (ONE * ONE));
}
