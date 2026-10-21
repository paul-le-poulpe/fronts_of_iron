// Opérations entières sur 32 bits. Math.imul et les opérateurs de bits ont un
// résultat fixé par la spécification ECMAScript : identique dans tous les navigateurs.

export function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** Mélange final de MurmurHash3 : chaque bit d'entrée modifie environ la moitié des bits de sortie. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Ajoute le mot de 32 bits `k` à l'accumulateur `h` (étape de MurmurHash3). */
export function mixWord(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = rotl(k, 15);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

export function isUint32(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
}
