// Zones maritimes (Docs/Design/00-Game.md §2.1) : des points posés sur l'eau,
// chacun centre d'une zone. Le module ne lit qu'un masque terre / eau, pour
// rester valable si le générateur de carte change. Calcul entièrement en entiers.

import { SEA_ZONES, type SeaZonesConfig } from "./config.ts";
import { TERRAIN_LAND, type GameMap } from "./map.ts";

/**
 * Coût d'un pas orthogonal et d'un pas en diagonale : 7 / 5 ≈ √2, pour des zones
 * proches de celles mesurées à vol d'oiseau. Choix provisoire (00-Game §13).
 */
const STEP_STRAIGHT = 5;
const STEP_DIAGONAL = 7;
/** Coût du plus grand pas + 1 : nombre de files du parcours (algorithme de Dial). */
const BUCKETS = STEP_DIAGONAL + 1;
const FAR = 0x7fffffff;

export interface SeaZones {
  /** Par case : indice du point de sa zone ; −1 = terre, ou eau qu'aucun point n'atteint. */
  readonly zone: Int32Array;
  /** Par case d'une zone : distance au point, le long de l'eau (pas de 5 ou 7). */
  readonly dist: Int32Array;
}

/** Étape de la génération, transmise à `onStep` (visualisation). */
export interface SeaZonesStep {
  readonly label: string;
  /** "grid" : points de la grille, sur terre ou sur eau ; "zones" : points sur l'eau. */
  readonly kind: "grid" | "zones";
  /** Cases des points, dans leur ordre. */
  readonly points: readonly number[];
}

/** Masque terre / eau d'une carte du moteur : 1 = terre, 0 = eau. */
export function landMask(map: GameMap): Uint8Array {
  const land = new Uint8Array(map.terrain.length);
  for (let t = 0; t < land.length; t++) land[t] = (map.terrain[t]! & TERRAIN_LAND) !== 0 ? 1 : 0;
  return land;
}

/**
 * Génère les points des zones maritimes (00-Game §2.1, étapes 1 à 5). Renvoie
 * la case de chaque point. `land` : 1 = terre, 0 = eau, une valeur par case.
 */
export function generateSeaZones(
  width: number,
  height: number,
  land: Uint8Array,
  cfg: SeaZonesConfig = SEA_ZONES,
  onStep?: (step: SeaZonesStep) => void,
): number[] {
  // 1. Grille, et 2. suppression des points dont le carré a trop de terre.
  const s = cfg.spacing;
  const half = s >> 1;
  const grid: number[] = [];
  let points: number[] = [];
  for (let y0 = 0; y0 + half < height; y0 += s) {
    for (let x0 = 0; x0 + half < width; x0 += s) {
      const x1 = Math.min(x0 + s, width);
      const y1 = Math.min(y0 + s, height);
      const p = (y0 + half) * width + x0 + half;
      grid.push(p);
      let landCount = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) landCount += land[y * width + x]!;
      if (landCount * 100 > cfg.maxLandPercent * (x1 - x0) * (y1 - y0)) continue;
      // Point sur la terre dans un carré gardé : il va sur l'eau du carré la plus proche. Choix provisoire.
      points.push(land[p] === 0 ? p : nearestWaterInRect(width, land, x0, y0, x1, y1, x0 + half, y0 + half));
    }
  }
  onStep?.({ label: "1. Grille", kind: "grid", points: grid });
  onStep?.({ label: "2. Suppression", kind: "grid", points: points.slice() });

  // 3. Itérations zones → barycentre.
  for (let i = 1; i <= cfg.iterations; i++) {
    points = moveToCentroids(width, height, land, points);
    onStep?.({ label: `3. Itération ${i}`, kind: "zones", points: points.slice() });
  }

  // 4. Correction par bassin.
  const basins = labelBasins(width, height, land);
  const target = basins.area.map((a) =>
    a < cfg.minBasinArea ? 0 : Math.max(1, Math.floor((a + ((s * s) >> 1)) / (s * s))),
  );
  for (let round = 1; ; round++) {
    const next = correctOnce(width, height, land, points, basins, target);
    if (next === null) break;
    points = next;
    onStep?.({ label: `4. Correction ${round}`, kind: "zones", points: points.slice() });
  }

  // 5. Itérations finales.
  for (let i = 1; i <= cfg.finalIterations; i++) {
    points = moveToCentroids(width, height, land, points);
    onStep?.({ label: `5. Itération finale ${i}`, kind: "zones", points: points.slice() });
  }
  return points;
}

/**
 * Zone de chaque case d'eau : le point le plus proche le long de l'eau. À
 * égalité de distance, le point de plus petit indice. Un pas en diagonale n'est
 * permis que si les deux cases qu'il longe sont de l'eau : une zone ne passe pas
 * entre deux cases de terre qui se touchent par un coin.
 */
export function computeSeaZones(width: number, height: number, land: Uint8Array, points: readonly number[]): SeaZones {
  const size = width * height;
  const zone = new Int32Array(size).fill(-1);
  const dist = new Int32Array(size).fill(FAR);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  let pending = 0;

  const relax = (n: number, nd: number, z: number): void => {
    if (land[n] !== 0) return;
    if (nd < dist[n]! || (nd === dist[n]! && z < zone[n]!)) {
      dist[n] = nd;
      zone[n] = z;
      buckets[nd % BUCKETS]!.push(n);
      pending++;
    }
  };

  for (let i = 0; i < points.length; i++) relax(points[i]!, 0, i);

  // Les distances en attente sont toutes dans [d, d + STEP_DIAGONAL] : la file
  // d % BUCKETS ne contient que des cases à distance d, ou des entrées périmées.
  for (let d = 0; pending > 0; d++) {
    const bucket = buckets[d % BUCKETS]!;
    for (let k = 0; k < bucket.length; k++) {
      const t = bucket[k]!;
      if (dist[t] !== d) continue;
      const z = zone[t]!;
      const x = t % width;
      const left = x > 0;
      const right = x < width - 1;
      const up = t >= width;
      const down = t < size - width;
      if (left) relax(t - 1, d + STEP_STRAIGHT, z);
      if (right) relax(t + 1, d + STEP_STRAIGHT, z);
      if (up) relax(t - width, d + STEP_STRAIGHT, z);
      if (down) relax(t + width, d + STEP_STRAIGHT, z);
      if (up && left && land[t - 1] === 0 && land[t - width] === 0) relax(t - width - 1, d + STEP_DIAGONAL, z);
      if (up && right && land[t + 1] === 0 && land[t - width] === 0) relax(t - width + 1, d + STEP_DIAGONAL, z);
      if (down && left && land[t - 1] === 0 && land[t + width] === 0) relax(t + width - 1, d + STEP_DIAGONAL, z);
      if (down && right && land[t + 1] === 0 && land[t + width] === 0) relax(t + width + 1, d + STEP_DIAGONAL, z);
    }
    pending -= bucket.length;
    bucket.length = 0;
  }
  return { zone, dist };
}

/** Une itération : calcule les zones, puis place chaque point au barycentre de sa zone. */
function moveToCentroids(width: number, height: number, land: Uint8Array, points: readonly number[]): number[] {
  const { zone } = computeSeaZones(width, height, land, points);
  const tiles = centroidTiles(width, zone, points.length);
  // Une zone vide (deux points sur la même case) perd son point.
  return Array.from(tiles).filter((t) => t >= 0);
}

/**
 * Pour chaque étiquette 0…count−1 : la case du barycentre de ses cases (moyenne
 * entière des x et des y) si elle porte cette étiquette, sinon la case de cette
 * étiquette la plus proche du barycentre (à égalité, la plus petite case).
 * −1 si l'étiquette n'a aucune case.
 */
function centroidTiles(width: number, label: Int32Array, count: number): Int32Array {
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const n = new Float64Array(count);
  for (let t = 0; t < label.length; t++) {
    const l = label[t]!;
    if (l < 0) continue;
    const x = t % width;
    sx[l]! += x;
    sy[l]! += (t - x) / width;
    n[l]!++;
  }
  const cx = new Int32Array(count);
  const cy = new Int32Array(count);
  const result = new Int32Array(count).fill(-1);
  let misses = 0;
  for (let l = 0; l < count; l++) {
    if (n[l] === 0) continue;
    cx[l] = Math.floor(sx[l]! / n[l]!);
    cy[l] = Math.floor(sy[l]! / n[l]!);
    const c = cy[l]! * width + cx[l]!;
    if (label[c] === l) result[l] = c;
    else misses++;
  }
  if (misses === 0) return result;

  // Barycentre hors de sa zone (zone en forme de C) : case de la zone la plus proche. Choix provisoire.
  const best = new Float64Array(count).fill(Infinity);
  for (let t = 0; t < label.length; t++) {
    const l = label[t]!;
    if (l < 0 || n[l] === 0 || label[cy[l]! * width + cx[l]!] === l) continue;
    const x = t % width;
    const dx = x - cx[l]!;
    const dy = (t - x) / width - cy[l]!;
    const d2 = dx * dx + dy * dy;
    if (d2 < best[l]!) {
      best[l] = d2;
      result[l] = t;
    }
  }
  return result;
}

function nearestWaterInRect(
  width: number,
  land: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: number,
  py: number,
): number {
  let best = FAR;
  let tile = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = y * width + x;
      if (land[t] !== 0) continue;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < best) {
        best = d2;
        tile = t;
      }
    }
  }
  return tile;
}

interface Basins {
  /** Par case : indice du bassin, −1 = terre. Numérotés dans l'ordre de leur première case. */
  readonly id: Int32Array;
  readonly area: number[];
}

/** Bassins : ensembles de cases d'eau reliées par leurs 4 voisins (les pas en diagonale ne relient rien de plus). */
function labelBasins(width: number, height: number, land: Uint8Array): Basins {
  const size = width * height;
  const id = new Int32Array(size).fill(-1);
  const area: number[] = [];
  const queue = new Int32Array(size);
  for (let start = 0; start < size; start++) {
    if (land[start] !== 0 || id[start] !== -1) continue;
    const b = area.length;
    let head = 0;
    let tail = 0;
    id[start] = b;
    queue[tail++] = start;
    while (head < tail) {
      const t = queue[head++]!;
      const x = t % width;
      const visit = (n: number): void => {
        if (land[n] === 0 && id[n] === -1) {
          id[n] = b;
          queue[tail++] = n;
        }
      };
      if (x > 0) visit(t - 1);
      if (x < width - 1) visit(t + 1);
      if (t >= width) visit(t - width);
      if (t < size - width) visit(t + width);
    }
    area.push(tail);
  }
  return { id, area };
}

/**
 * Un passage de correction (étape 4). Dans chaque bassin, compare le nombre de
 * points au nombre visé, et :
 * - bassin sans point : ajoute un point au barycentre du bassin ;
 * - trop peu : ajoute un point dans chacune des plus grandes zones, sur sa case
 *   la plus éloignée de son point ;
 * - trop : retire les points des plus petites zones.
 * Renvoie null si aucun bassin n'a changé. Règles provisoires (00-Game §13).
 *
 * Termine : dans chaque bassin, le nombre de points va vers le nombre visé à
 * chaque passage, sans jamais le dépasser, et aucun point ne change de bassin.
 */
function correctOnce(
  width: number,
  height: number,
  land: Uint8Array,
  points: readonly number[],
  basins: Basins,
  target: readonly number[],
): number[] | null {
  const { zone, dist } = computeSeaZones(width, height, land, points);
  const zoneArea = new Int32Array(points.length);
  const farTile = new Int32Array(points.length).fill(-1);
  const farDist = new Int32Array(points.length).fill(-1);
  for (let t = 0; t < zone.length; t++) {
    const z = zone[t]!;
    if (z < 0) continue;
    zoneArea[z]!++;
    if (dist[t]! > farDist[z]!) {
      farDist[z] = dist[t]!;
      farTile[z] = t;
    }
  }

  const byBasin: number[][] = basins.area.map(() => []);
  for (let i = 0; i < points.length; i++) byBasin[basins.id[points[i]!]!]!.push(i);

  const removed = new Uint8Array(points.length);
  const added: number[] = [];
  const emptyBasins: number[] = [];
  for (let b = 0; b < byBasin.length; b++) {
    const pts = byBasin[b]!;
    const want = target[b]!;
    if (pts.length === 0 && want > 0) {
      emptyBasins.push(b);
    } else if (pts.length < want) {
      // Plus grandes zones d'abord ; à égalité, le plus petit indice.
      pts.sort((i, j) => zoneArea[j]! - zoneArea[i]! || i - j);
      const k = Math.min(want - pts.length, pts.length);
      // Une zone d'une seule case n'a pas d'autre case où poser un point.
      for (let m = 0; m < k; m++) if (farDist[pts[m]!]! > 0) added.push(farTile[pts[m]!]!);
    } else if (pts.length > want) {
      // Plus petites zones d'abord ; à égalité, le plus grand indice.
      pts.sort((i, j) => zoneArea[i]! - zoneArea[j]! || j - i);
      for (let m = 0; m < pts.length - want; m++) removed[pts[m]!] = 1;
    }
  }
  if (added.length === 0 && emptyBasins.length === 0 && !removed.includes(1)) return null;

  if (emptyBasins.length > 0) {
    const only = new Int32Array(basins.id.length).fill(-1);
    for (let t = 0; t < only.length; t++) {
      const b = basins.id[t]!;
      if (b >= 0 && target[b]! > 0 && byBasin[b]!.length === 0) only[t] = b;
    }
    const centres = centroidTiles(width, only, basins.area.length);
    for (const b of emptyBasins) added.push(centres[b]!);
  }

  const next = points.filter((_, i) => removed[i] === 0);
  for (const t of added) next.push(t);
  return next;
}
