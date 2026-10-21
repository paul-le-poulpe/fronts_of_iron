// Générateur pseudo-aléatoire xoshiro128** (Blackman et Vigna, domaine public),
// réécrit ici. Son état est 4 mots de 32 bits, stockés dans l'état de la partie
// et inclus dans le hash : deux clients qui tirent les mêmes nombres ont le même état.

import { isUint32, rotl } from "./bits.ts";

/** État du générateur : 4 mots de 32 bits, jamais tous nuls. */
export type Rng = Uint32Array;

/** Remplit l'état à partir d'une graine 32 bits, par splitmix32. */
export function createRng(seed: number): Rng {
  if (!isUint32(seed)) throw new Error(`graine invalide : ${seed}`);
  const s = new Uint32Array(4);
  let x = seed | 0;
  for (let i = 0; i < 4; i++) {
    x = (x + 0x9e3779b9) | 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    s[i] = z ^ (z >>> 16);
  }
  // xoshiro ne sort jamais de l'état tout à zéro ; splitmix32 ne le produit pas
  // en pratique, mais la garde ne coûte rien.
  if ((s[0]! | s[1]! | s[2]! | s[3]!) === 0) s[0] = 1;
  return s;
}

/** Entier uniforme dans [0, 2³²). Avance l'état. */
export function nextU32(s: Rng): number {
  const s0 = s[0]!, s1 = s[1]!, s2 = s[2]!, s3 = s[3]!;
  const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  let n2 = s2 ^ s0;
  let n3 = s3 ^ s1;
  const n1 = s1 ^ n2;
  const n0 = s0 ^ n3;
  n2 ^= t;
  n3 = rotl(n3, 11);
  s[0] = n0;
  s[1] = n1;
  s[2] = n2;
  s[3] = n3;
  return result;
}

/**
 * Entier uniforme dans [0, n), 1 ≤ n ≤ 2³². Les tirages au-delà du plus grand
 * multiple de n sont rejetés et refaits, pour que chaque valeur ait la même
 * probabilité. Les calculs restent sous 2⁵³ : exacts en double.
 */
export function nextInt(s: Rng, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new Error(`borne invalide : ${n}`);
  const limit = 0x100000000 - (0x100000000 % n);
  for (;;) {
    const r = nextU32(s);
    if (r < limit) return r % n;
  }
}
