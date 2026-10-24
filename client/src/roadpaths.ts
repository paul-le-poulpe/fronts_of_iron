// Tracé d'affichage des routes terrestres (00-Game §3.5, « Affichage »). Pour le
// moteur, une route est une paire de villes ; ici, chaque route reçoit un chemin
// A* de cases entre ses deux villes, plus cher en altitude, pour que les routes
// passent par les vallées. Rien de ceci n'entre dans l'état de la partie : le
// calcul est en flottants, côté page seulement. Pas d'accès au DOM : testable
// sous Node.

import type { MirrorCity } from "./mirror.ts";

/** Augmentation du coût d'une case par point d'altitude (00-Game §10, `ROADS.heightCostFactor`). */
export const ROAD_HEIGHT_COST_FACTOR = 1;
/** Part du coût d'une case déjà traversée par une autre route : deux routes vers une même ville finissent ensemble au lieu de longer l'une l'autre. */
export const ROAD_REUSE_COST_FACTOR = 0.5;

const LAND = 0x80;
const ALTITUDE = 0x1f;
const SQRT2 = Math.SQRT2;
/** Voisins : dx, dy, et 1 si le pas est diagonal. */
const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1],
];

export class RoadPaths {
  /** Chemin de chaque paire de cases de villes, par clé `min × taille + max`. Remplacé à chaque `sync`. */
  private cache = new Map<number, Int32Array>();
  // Tableaux de travail de l'A*, réutilisés d'une route à l'autre : `stamp[t] === run` dit que `cost[t]` et `from[t]` sont ceux du calcul en cours.
  private readonly cost: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private run = 0;
  /** 1 sur les cases que traverse le chemin d'une route de la liste en cours (remis à zéro à chaque `sync`). */
  private readonly used: Uint8Array;
  private heapTile: Int32Array = new Int32Array(1024);
  private heapKey: Float32Array = new Float32Array(1024);
  private heapSize = 0;

  private readonly width: number;
  private readonly height: number;
  private readonly terrain: Uint8Array;
  private readonly margin: number;
  private readonly heightCostFactor: number;

  /** `margin` : cases autour du rectangle des deux villes où le chemin peut passer. */
  constructor(width: number, height: number, terrain: Uint8Array, margin: number, heightCostFactor = ROAD_HEIGHT_COST_FACTOR) {
    this.width = width;
    this.height = height;
    this.terrain = terrain;
    this.margin = margin;
    this.heightCostFactor = heightCostFactor;
    const size = width * height;
    this.cost = new Float32Array(size);
    this.from = new Int32Array(size);
    this.stamp = new Uint32Array(size);
    this.used = new Uint8Array(size);
  }

  /**
   * Chemins des routes `roads` (paires d'identifiants de villes), dans le même
   * ordre : `result[i]` est la suite des cases de la route `roads[2i]`–`roads[2i+1]`.
   * Un chemin déjà calculé pour les mêmes deux cases est repris ; les autres sont
   * calculés ; ceux des routes qui ne sont plus dans la liste sont oubliés.
   * Sans chemin de terre, le chemin est les deux cases de villes seules (segment droit).
   */
  sync(cities: readonly MirrorCity[], roads: Uint16Array): Int32Array[] {
    const size = this.width * this.height;
    const next = new Map<number, Int32Array>();
    const keys: number[] = [];
    // Cases portant déjà une route : on repart des chemins conservés, les nouveaux s'y ajoutent à mesure.
    this.used.fill(0);
    for (let i = 0; i < roads.length; i += 2) {
      const a = cities[roads[i]! - 1]!.tile;
      const b = cities[roads[i + 1]! - 1]!.tile;
      const key = a < b ? a * size + b : b * size + a;
      keys.push(key);
      const kept = this.cache.get(key);
      if (kept !== undefined && !next.has(key)) {
        next.set(key, kept);
        for (const t of kept) this.used[t] = 1;
      }
    }
    const out: Int32Array[] = [];
    for (let i = 0; i < roads.length; i += 2) {
      const key = keys[i / 2]!;
      let path = next.get(key);
      if (path === undefined) {
        const a = cities[roads[i]! - 1]!.tile;
        const b = cities[roads[i + 1]! - 1]!.tile;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        path = this.search(lo, hi) ?? Int32Array.of(lo, hi);
        next.set(key, path);
        for (const t of path) this.used[t] = 1;
      }
      out.push(path);
    }
    this.cache = next;
    return out;
  }

  /** A* de la case `from` à la case `to`, sur la terre, dans le rectangle des deux cases agrandi de la marge. Null si aucun chemin. */
  private search(from: number, to: number): Int32Array | null {
    const w = this.width;
    const tx = to % w;
    const ty = (to - tx) / w;
    const fx = from % w;
    const fy = (from - fx) / w;
    const x0 = Math.max(0, Math.min(fx, tx) - this.margin);
    const x1 = Math.min(w - 1, Math.max(fx, tx) + this.margin);
    const y0 = Math.max(0, Math.min(fy, ty) - this.margin);
    const y1 = Math.min(this.height - 1, Math.max(fy, ty) + this.margin);
    const run = ++this.run;
    const { cost, stamp, terrain } = this;
    const heuristic = (x: number, y: number): number => {
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      return ROAD_REUSE_COST_FACTOR * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
    };

    this.heapSize = 0;
    stamp[from] = run;
    cost[from] = 0;
    this.from[from] = -1;
    this.push(from, heuristic(fx, fy));
    while (this.heapSize > 0) {
      const t = this.pop();
      if (t === to) return this.rebuild(to);
      const x = t % w;
      const y = (t - x) / w;
      const base = cost[t]!;
      for (const [dx, dy, diagonal] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const n = ny * w + nx;
        const b = terrain[n]!;
        if ((b & LAND) === 0) continue;
        const step = (1 + this.heightCostFactor * (b & ALTITUDE)) * (this.used[n] === 1 ? ROAD_REUSE_COST_FACTOR : 1) * (diagonal === 1 ? SQRT2 : 1);
        const c = base + step;
        if (stamp[n] === run && c >= cost[n]!) continue;
        stamp[n] = run;
        cost[n] = c;
        this.from[n] = t;
        this.push(n, c + heuristic(nx, ny));
      }
    }
    return null;
  }

  private rebuild(to: number): Int32Array {
    const tiles: number[] = [];
    for (let t = to; t !== -1; t = this.from[t]!) tiles.push(t);
    return Int32Array.from(tiles.reverse());
  }

  // Tas binaire minimal sur (case, clé) ; une case peut y figurer plusieurs fois, la plus basse clé sort la première (les autres sont rejouées sans effet : leur coût n'améliore rien).
  private push(tile: number, key: number): void {
    if (this.heapSize === this.heapTile.length) {
      const grownTile = new Int32Array(this.heapSize * 2);
      const grownKey = new Float32Array(this.heapSize * 2);
      grownTile.set(this.heapTile);
      grownKey.set(this.heapKey);
      this.heapTile = grownTile;
      this.heapKey = grownKey;
    }
    const { heapTile, heapKey } = this;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= key) break;
      heapTile[i] = heapTile[p]!;
      heapKey[i] = heapKey[p]!;
      i = p;
    }
    heapTile[i] = tile;
    heapKey[i] = key;
  }

  private pop(): number {
    const { heapTile, heapKey } = this;
    const top = heapTile[0]!;
    const n = --this.heapSize;
    const tile = heapTile[n]!;
    const key = heapKey[n]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && heapKey[c + 1]! < heapKey[c]!) c++;
      if (heapKey[c]! >= key) break;
      heapTile[i] = heapTile[c]!;
      heapKey[i] = heapKey[c]!;
      i = c;
    }
    heapTile[i] = tile;
    heapKey[i] = key;
    return top;
  }
}
