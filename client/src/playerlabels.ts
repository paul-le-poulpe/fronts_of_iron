// Noms des joueurs sur la carte dézoomée (Docs/Design/03-Client.md §6) : où poser le nom de chaque joueur. Le nom va
// dans le plus grand territoire contigu du joueur, sans recouvrir une case d'un autre joueur. Pas d'accès au DOM.

/** Ce que le placement lit de la carte (`Mirror`). */
export interface LabelMap {
  readonly width: number;
  readonly height: number;
  isLand(tile: number): boolean;
  ownerOf(tile: number): number;
}

/** Centre d'un nom, en cases. */
export interface LabelSpot {
  readonly player: number;
  readonly x: number;
  readonly y: number;
}

/** Pas de la recherche d'une position, en cases. */
const SEARCH_STEP = 2;

/** Propriétaire de chaque case de terre, 0 ailleurs. */
function landOwners(map: LabelMap): Uint16Array {
  const owners = new Uint16Array(map.width * map.height);
  for (let t = 0; t < owners.length; t++) if (map.isLand(t)) owners[t] = map.ownerOf(t);
  return owners;
}

/** Cases du plus grand territoire contigu de chaque joueur, reliées par les quatre côtés. */
export function largestTerritories(owners: Uint16Array, width: number): Map<number, Int32Array> {
  const seen = new Uint8Array(owners.length);
  const stack = new Int32Array(owners.length);
  const out = new Map<number, Int32Array>();
  for (let start = 0; start < owners.length; start++) {
    const player = owners[start]!;
    if (player === 0 || seen[start] === 1) continue;
    let top = 0;
    let size = 0;
    const tiles: number[] = [];
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const t = stack[--top]!;
      tiles.push(t);
      size++;
      const x = t % width;
      const visit = (q: number): void => {
        if (owners[q] === player && seen[q] === 0) {
          seen[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(t - 1);
      if (x < width - 1) visit(t + 1);
      if (t >= width) visit(t - width);
      if (t + width < owners.length) visit(t + width);
    }
    if (size > (out.get(player)?.length ?? 0)) out.set(player, Int32Array.from(tiles));
  }
  return out;
}

/** Somme de `value` sur chaque rectangle de cases de `[x0, x1[ × [y0, y1[` : tableau de `(x1 - x0 + 1) × (y1 - y0 + 1)` cases. */
function integral(x0: number, y0: number, x1: number, y1: number, width: number, value: (t: number) => number): Int32Array {
  const w = x1 - x0 + 1;
  const sums = new Int32Array(w * (y1 - y0 + 1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y - y0 + 1) * w + (x - x0 + 1);
      sums[o] = value(y * width + x) + sums[o - 1]! + sums[o - w]! - sums[o - w - 1]!;
    }
  }
  return sums;
}

/**
 * Position d'un nom de `boxW` × `boxH` cases : aucune case d'un autre joueur sous le rectangle, le plus de cases de
 * `tiles`, puis le plus près de leur centre. `null` si aucune position ne convient.
 */
export function placeLabel(owners: Uint16Array, width: number, player: number, tiles: Int32Array, boxW: number, boxH: number): { x: number; y: number } | null {
  const height = owners.length / width;
  if (boxW > width || boxH > height) return null;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let sumX = 0;
  let sumY = 0;
  for (const t of tiles) {
    const x = t % width;
    const y = (t - x) / width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  // Centre d'une case : son coin + 0,5.
  const centerX = sumX / tiles.length + 0.5;
  const centerY = sumY / tiles.length + 0.5;
  // Zone de recherche : toutes les positions qui touchent le territoire.
  const x0 = Math.max(0, minX - boxW + 1);
  const y0 = Math.max(0, minY - boxH + 1);
  const x1 = Math.min(width, maxX + boxW);
  const y1 = Math.min(height, maxY + boxH);
  const inTerritory = new Uint8Array(owners.length);
  for (const t of tiles) inTerritory[t] = 1;
  const own = integral(x0, y0, x1, y1, width, (t) => inTerritory[t]!);
  const others = integral(x0, y0, x1, y1, width, (t) => (owners[t] !== 0 && owners[t] !== player ? 1 : 0));
  const w = x1 - x0 + 1;
  const count = (sums: Int32Array, x: number, y: number): number => {
    const a = (y - y0) * w + (x - x0);
    const b = (y - y0 + boxH) * w + (x - x0);
    return sums[b + boxW]! - sums[b]! - sums[a + boxW]! + sums[a]!;
  };
  let best: { x: number; y: number } | null = null;
  let bestOwn = 0;
  let bestDistance = 0;
  for (let y = y0; y + boxH <= y1; y += SEARCH_STEP) {
    for (let x = x0; x + boxW <= x1; x += SEARCH_STEP) {
      if (count(others, x, y) > 0) continue;
      const n = count(own, x, y);
      if (n === 0 || n < bestOwn) continue;
      const cx = x + boxW / 2;
      const cy = y + boxH / 2;
      const distance = (cx - centerX) ** 2 + (cy - centerY) ** 2;
      if (n > bestOwn || distance < bestDistance) {
        best = { x: cx, y: cy };
        bestOwn = n;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** Garde les territoires entre deux images : ils ne sont refaits que si un propriétaire de case a changé. */
export class PlayerLabels {
  private readonly map: LabelMap;
  private owners: Uint16Array | null = null;
  private territories = new Map<number, Int32Array>();
  private checked = false;

  constructor(map: LabelMap) {
    this.map = map;
  }

  /** Des cases ont changé. */
  invalidate(): void {
    this.checked = false;
  }

  /** Noms des joueurs : `measure(player)` donne la taille du nom en cases. Un joueur sans position possible n'a pas de nom. */
  spots(measure: (player: number) => { readonly w: number; readonly h: number }): LabelSpot[] {
    if (!this.checked) {
      this.checked = true;
      const owners = landOwners(this.map);
      if (this.owners === null || owners.some((p, t) => p !== this.owners![t])) {
        this.owners = owners;
        this.territories = largestTerritories(owners, this.map.width);
      }
    }
    const out: LabelSpot[] = [];
    for (const [player, tiles] of this.territories) {
      const box = measure(player);
      const spot = placeLabel(this.owners!, this.map.width, player, tiles, box.w, box.h);
      if (spot !== null) out.push({ player, ...spot });
    }
    return out;
  }
}
