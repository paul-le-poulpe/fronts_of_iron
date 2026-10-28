// Tracé d'affichage des routes (00-Game §3.5 et §3.6, « Affichage »). Pour le
// moteur, une route est une paire de villes ; ici, chaque route reçoit un chemin
// A* de cases entre ses deux villes, plus cher en altitude, pour que les routes
// passent par les vallées. Sans chemin de terre, la route passe par le port de
// chacune des deux villes, avec un A* sur l'eau entre les deux ports, plus cher
// près des côtes. Rien de ceci n'entre dans l'état de la partie : le calcul est
// en flottants, côté page seulement. Pas d'accès au DOM : testable sous Node.

import type { MirrorCity } from "./mirror.ts";

/** Augmentation du coût d'une case par point d'altitude (00-Game §10, `ROADS.heightCostFactor`). */
export const ROAD_HEIGHT_COST_FACTOR = 1;
/** Part du coût d'une case déjà traversée par une autre route : deux routes vers une même ville finissent ensemble au lieu de longer l'une l'autre. */
export const ROAD_REUSE_COST_FACTOR = 0.5;
/** Distance à la côte, en cases, en dessous de laquelle une case d'eau coûte plus cher pour une route maritime. */
export const SEA_COAST_CLEARANCE = 4;
/** Surcoût d'une case d'eau voisine de la terre, en multiple du coût d'une case ; il décroît linéairement jusqu'à `SEA_COAST_CLEARANCE`. */
export const SEA_COAST_COST = 3;

const LAND = 0x80;
const ALTITUDE = 0x1f;
const SQRT2 = Math.SQRT2;
/** Voisins : dx, dy, et 1 si le pas est diagonal. */
const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1],
];

/** Chemin gardé d'une route. `ports` : −1 pour un chemin de terre (valable quels que soient les ports) ; sinon la paire des cases de port au moment du calcul. */
interface Entry {
  readonly path: Int32Array;
  readonly ports: number;
}

const straight = (a: number, b: number): Int32Array => (a === b ? Int32Array.of(a) : Int32Array.of(a, b));

export class RoadPaths {
  /** Chemin de chaque paire de cases de villes, par clé `min × taille + max`. Remplacé à chaque `sync`. */
  private cache = new Map<number, Entry>();
  /** Partie en mer des chemins qui passent par deux ports : indices du premier et du dernier port dans le chemin. */
  private readonly seaSpans = new WeakMap<Int32Array, readonly [number, number]>();
  /** Distance de chaque case d'eau à la terre, en cases, jusqu'à `SEA_COAST_CLEARANCE` ; 255 au-delà. Calculée à la première route maritime. */
  private coast: Uint8Array | null = null;
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
   *
   * `ports` donne la case de port de chaque ville à port (identifiant de ville →
   * case). Sans chemin de terre entre les deux villes, la route va de chaque
   * ville à son port par la terre, et d'un port à l'autre par l'eau (`seaSpan`
   * donne la partie en mer). Si l'une des villes n'a pas de port, ou si l'eau
   * ne relie pas les deux ports, la route n'a pas de tracé : le chemin est vide
   * et rien n'est dessiné (le trajet passe par les villes voisines). Un chemin qui n'est pas de terre est recalculé quand un
   * des deux ports change ou disparaît (nouvelle ville voisine).
   */
  sync(cities: readonly MirrorCity[], roads: Uint16Array, ports: ReadonlyMap<number, number> = new Map()): Int32Array[] {
    const size = this.width * this.height;
    const next = new Map<number, Entry>();
    const keys: number[] = [];
    const portKeys: number[] = [];
    // Cases portant déjà une route : on repart des chemins conservés, les nouveaux s'y ajoutent à mesure.
    this.used.fill(0);
    for (let i = 0; i < roads.length; i += 2) {
      const a = cities[roads[i]! - 1]!;
      const b = cities[roads[i + 1]! - 1]!;
      const [lo, hi] = a.tile < b.tile ? [a, b] : [b, a];
      const key = lo.tile * size + hi.tile;
      const portKey = ((ports.get(lo.id) ?? -1) + 1) * (size + 1) + (ports.get(hi.id) ?? -1) + 1;
      keys.push(key);
      portKeys.push(portKey);
      const kept = this.cache.get(key);
      if (kept !== undefined && (kept.ports === -1 || kept.ports === portKey) && !next.has(key)) {
        next.set(key, kept);
        for (const t of kept.path) this.used[t] = 1;
      }
    }
    const out: Int32Array[] = [];
    for (let i = 0; i < roads.length; i += 2) {
      const key = keys[i / 2]!;
      let entry = next.get(key);
      if (entry === undefined) {
        const a = cities[roads[i]! - 1]!;
        const b = cities[roads[i + 1]! - 1]!;
        const [lo, hi] = a.tile < b.tile ? [a, b] : [b, a];
        entry = this.route(lo.tile, hi.tile, ports.get(lo.id) ?? -1, ports.get(hi.id) ?? -1, portKeys[i / 2]!);
        next.set(key, entry);
        for (const t of entry.path) this.used[t] = 1;
      }
      out.push(entry.path);
    }
    this.cache = next;
    return out;
  }

  /** Indices, dans `path`, du port de départ et du port d'arrivée si le chemin traverse la mer ; null sinon. `path` vient du dernier `sync`. */
  seaSpan(path: Int32Array): readonly [number, number] | null {
    return this.seaSpans.get(path) ?? null;
  }

  /** Chemin de la route entre les villes de cases `lo` < `hi` ; `portLo` et `portHi` : leurs cases de port, −1 sans port. Vide sans chemin de terre ni de mer. */
  private route(lo: number, hi: number, portLo: number, portHi: number, portKey: number): Entry {
    const land = this.search(lo, hi);
    if (land !== null) return { path: land, ports: -1 };
    if (portLo >= 0 && portHi >= 0) {
      const sea = this.search(portLo, portHi, true);
      if (sea !== null) {
        const head = this.search(lo, portLo) ?? straight(lo, portLo);
        const tail = this.search(hi, portHi) ?? straight(hi, portHi);
        const path = new Int32Array(head.length + sea.length - 2 + tail.length);
        path.set(head);
        path.set(sea.subarray(1, sea.length - 1), head.length);
        for (let k = 0; k < tail.length; k++) path[path.length - 1 - k] = tail[k]!;
        this.seaSpans.set(path, [head.length - 1, head.length + sea.length - 2]);
        return { path, ports: portKey };
      }
    }
    return { path: new Int32Array(0), ports: portKey };
  }

  /** Distance à la terre de chaque case d'eau (parcours en largeur parti de toute la terre, 8 voisins), plafonnée à `SEA_COAST_CLEARANCE`. */
  private coastDistance(): Uint8Array {
    if (this.coast !== null) return this.coast;
    const w = this.width;
    const h = this.height;
    const size = w * h;
    const dist = new Uint8Array(size).fill(255);
    const queue = new Int32Array(size);
    let tail = 0;
    for (let t = 0; t < size; t++) {
      if ((this.terrain[t]! & LAND) !== 0) {
        dist[t] = 0;
        queue[tail++] = t;
      }
    }
    for (let head = 0; head < tail; head++) {
      const t = queue[head]!;
      const d = dist[t]!;
      if (d >= SEA_COAST_CLEARANCE) continue;
      const x = t % w;
      const y = (t - x) / w;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] !== 255) continue;
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
    this.coast = dist;
    return dist;
  }

  /**
   * A* de la case `from` à la case `to`. Sur la terre (défaut), dans le rectangle
   * des deux cases agrandi de la marge ; null si aucun chemin. En mer (`sea`),
   * sur toute la carte : `from` et `to` sont des cases de port (de la terre), les
   * seules cases de terre permises, et le chemin ne passe que par l'eau entre
   * elles. Une case d'eau proche de la côte coûte plus cher (`SEA_COAST_COST`).
   */
  private search(from: number, to: number, sea = false): Int32Array | null {
    const w = this.width;
    const tx = to % w;
    const ty = (to - tx) / w;
    const fx = from % w;
    const fy = (from - fx) / w;
    const x0 = sea ? 0 : Math.max(0, Math.min(fx, tx) - this.margin);
    const x1 = sea ? w - 1 : Math.min(w - 1, Math.max(fx, tx) + this.margin);
    const y0 = sea ? 0 : Math.max(0, Math.min(fy, ty) - this.margin);
    const y1 = sea ? this.height - 1 : Math.min(this.height - 1, Math.max(fy, ty) + this.margin);
    const coast = sea ? this.coastDistance() : null;
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
        let factor: number;
        if (coast !== null) {
          const isLand = (b & LAND) !== 0;
          if (isLand && n !== to) continue;
          // Un pas en diagonale ne passe pas entre deux cases de terre.
          if (diagonal === 1 && t !== from && n !== to) {
            if ((terrain[y * w + nx]! & LAND) !== 0 && (terrain[ny * w + x]! & LAND) !== 0) continue;
          }
          const d = coast[n]!;
          factor = isLand || d > SEA_COAST_CLEARANCE ? 1 : 1 + (SEA_COAST_COST * (SEA_COAST_CLEARANCE + 1 - d)) / SEA_COAST_CLEARANCE;
        } else {
          if ((b & LAND) === 0) continue;
          factor = 1 + this.heightCostFactor * (b & ALTITUDE);
        }
        const step = factor * (this.used[n] === 1 ? ROAD_REUSE_COST_FACTOR : 1) * (diagonal === 1 ? SQRT2 : 1);
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
