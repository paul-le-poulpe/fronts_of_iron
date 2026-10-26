// Géométrie des fronts, côté page seulement (Docs/Design/05-Fronts.md §11.1, §11.4) :
// point du front de chaque connexion, voisinage des connexions et chaînes, courbe de
// Catmull-Rom centripète, zones de front. Calculs en flottants : ils ne touchent jamais
// l'état de la partie. Pas d'accès au DOM (testable sous Node, utilisé aussi par
// `npm run viz:fronts` du moteur).

import type { FrontView } from "./protocol.ts";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Ce que la géométrie lit de la partie : les villes (case de chacune) et les routes. */
export interface GeomWorld {
  readonly width: number;
  readonly height: number;
  /** Case de la ville `id` : `cityTile[id - 1]`. */
  readonly cityTile: readonly number[];
  /** Paires d'identifiants de villes : `roads[2i]`, `roads[2i + 1]`. */
  readonly roads: ArrayLike<number>;
  /** Rayon de contrôle d'une ville, en cases. */
  readonly controlRadius: number;
}

/** Centre de la case d'une ville, en cases. */
export function cityPoint(world: GeomWorld, city: number): Pt {
  const t = world.cityTile[city - 1]!;
  return { x: (t % world.width) + 0.5, y: Math.floor(t / world.width) + 0.5 };
}

/**
 * Point du front d'une connexion (05-Fronts §11.4) : `city1 + (city2 − city1) × position / 1000`.
 * En paix, la position vaut 500 (le milieu de la route).
 */
export function connectionPoint(world: GeomWorld, f: FrontView, index: number): Pt {
  const c = f.connections[index]!;
  const a = cityPoint(world, c.city1);
  const b = cityPoint(world, c.city2);
  const k = (f.active ? c.position : 500) / 1000;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export function frontPoints(world: GeomWorld, f: FrontView): Pt[] {
  return f.connections.map((_, i) => connectionPoint(world, f, i));
}

/**
 * Chaînes de connexions d'un front (05-Fronts §11.4). Deux connexions du même front sont
 * voisines si elles partent de la même ville et sont consécutives dans l'ordre angulaire
 * de toutes les routes de cette ville, avec un angle inférieur à 180°. Les voisinages
 * forment des chaînes ou des boucles. Renvoie les indices des connexions de chaque
 * chaîne, dans l'ordre le long du front ; `closed` pour une boucle.
 */
export function frontChains(world: GeomWorld, f: FrontView): { readonly order: number[]; readonly closed: boolean }[] {
  const n = f.connections.length;
  const byRoad = new Map<string, number>();
  f.connections.forEach((c, i) => byRoad.set(`${c.city1},${c.city2}`, i));
  const roadKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  // Routes de chaque ville du front, avec l'angle de départ.
  const cities = new Set<number>();
  for (const c of f.connections) {
    cities.add(c.city1);
    cities.add(c.city2);
  }
  const adjacent: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const city of [...cities].sort((a, b) => a - b)) {
    const from = cityPoint(world, city);
    const around: { angle: number; conn: number }[] = [];
    for (let i = 0; i < world.roads.length; i += 2) {
      const a = world.roads[i]!;
      const b = world.roads[i + 1]!;
      if (a !== city && b !== city) continue;
      const other = cityPoint(world, a === city ? b : a);
      around.push({ angle: Math.atan2(other.y - from.y, other.x - from.x), conn: byRoad.get(roadKey(a, b)) ?? -1 });
    }
    around.sort((p, q) => p.angle - q.angle);
    for (let k = 0; k < around.length; k++) {
      const p = around[k]!;
      const q = around[(k + 1) % around.length]!;
      if (around.length < 2 || p.conn < 0 || q.conn < 0 || p.conn === q.conn) continue;
      let gap = q.angle - p.angle;
      if (gap <= 0) gap += 2 * Math.PI;
      if (gap < Math.PI) {
        adjacent[p.conn]!.add(q.conn);
        adjacent[q.conn]!.add(p.conn);
      }
    }
  }
  const seen = new Array<boolean>(n).fill(false);
  const chains: { order: number[]; closed: boolean }[] = [];
  const walk = (start: number): void => {
    const order = [start];
    seen[start] = true;
    for (let cur = start; ; ) {
      const next = [...adjacent[cur]!].filter((m) => !seen[m]).sort((a, b) => a - b)[0];
      if (next === undefined) break;
      seen[next] = true;
      order.push(next);
      cur = next;
    }
    chains.push({ order, closed: order.length > 2 && adjacent[order[order.length - 1]!]!.has(order[0]!) });
  };
  // Extrémités d'abord (une seule voisine), puis ce qui reste (boucles).
  for (let i = 0; i < n; i++) if (!seen[i] && adjacent[i]!.size <= 1) walk(i);
  for (let i = 0; i < n; i++) if (!seen[i]) walk(i);
  return chains;
}

/** Un morceau de la courbe : de P1 (point précédent) à `to`, avec les points de contrôle `c1` et `c2`. */
export interface BezierSegment {
  readonly c1: Pt;
  readonly c2: Pt;
  readonly to: Pt;
}

/**
 * Spline de Catmull-Rom centripète (α = 0,5) qui passe par chaque point (05-Fronts §11.4), en
 * courbes de Bézier. Aux bouts d'une chaîne, le point du bout est répété ; une boucle
 * (`closed`) est refermée. Renvoie le premier point et les morceaux.
 */
export function catmullRom(points: readonly Pt[], closed = false): { start: Pt; segments: BezierSegment[] } | null {
  if (points.length === 0) return null;
  const at = (i: number): Pt => (closed ? points[(i + points.length) % points.length]! : points[Math.min(points.length - 1, Math.max(0, i))]!);
  const segments: BezierSegment[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const d3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
    if (d2 === 0) continue;
    const [a1, a2, a3] = [Math.sqrt(d1), Math.sqrt(d2), Math.sqrt(d3)];
    const [b1, b2, b3] = [d1, d2, d3];
    const c1: Pt =
      d1 === 0
        ? p1
        : {
            x: (b1 * p2.x - b2 * p0.x + (2 * b1 + 3 * a1 * a2 + b2) * p1.x) / (3 * a1 * (a1 + a2)),
            y: (b1 * p2.y - b2 * p0.y + (2 * b1 + 3 * a1 * a2 + b2) * p1.y) / (3 * a1 * (a1 + a2)),
          };
    const c2: Pt =
      d3 === 0
        ? p2
        : {
            x: (b3 * p1.x - b2 * p3.x + (2 * b3 + 3 * a3 * a2 + b2) * p2.x) / (3 * a3 * (a3 + a2)),
            y: (b3 * p1.y - b2 * p3.y + (2 * b3 + 3 * a3 * a2 + b2) * p2.y) / (3 * a3 * (a3 + a2)),
          };
    segments.push({ c1, c2, to: p2 });
  }
  return { start: points[0]!, segments };
}

/** Distance au carré du point (x, y) au segment [a, b]. */
function dist2ToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2));
  const px = a.x + dx * t - x;
  const py = a.y + dy * t - y;
  return px * px + py * py;
}

/**
 * Zones de front (05-Fronts §11.1) : une case de terre est dans la zone d'un front si sa
 * distance à la ligne du front (la suite des points de ses chaînes) est ≤ le rayon de
 * contrôle d'une ville ; à plusieurs fronts, celui dont la ligne est la plus proche
 * (à égalité, le plus petit identifiant). Renvoie l'identifiant du front de chaque case, 0 = aucun.
 */
export function computeFrontZones(
  world: GeomWorld,
  fronts: readonly FrontView[],
  isLand: (tile: number) => boolean,
): Uint16Array {
  const { width, height } = world;
  const zone = new Uint16Array(width * height);
  const best = new Float32Array(width * height).fill(Infinity);
  const r = world.controlRadius;
  const r2 = r * r;
  for (const f of [...fronts].sort((a, b) => a.id - b.id)) {
    const points = frontPoints(world, f);
    const lines: [Pt, Pt][] = [];
    for (const chain of frontChains(world, f)) {
      const p = chain.order.map((i) => points[i]!);
      if (p.length === 1) lines.push([p[0]!, p[0]!]);
      for (let i = 0; i + 1 < p.length; i++) lines.push([p[i]!, p[i + 1]!]);
      if (chain.closed) lines.push([p[p.length - 1]!, p[0]!]);
    }
    if (lines.length === 0) continue;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (const p of points) {
      x0 = Math.min(x0, Math.floor(p.x - r));
      y0 = Math.min(y0, Math.floor(p.y - r));
      x1 = Math.max(x1, Math.ceil(p.x + r));
      y1 = Math.max(y1, Math.ceil(p.y + r));
    }
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
        const t = y * width + x;
        if (!isLand(t)) continue;
        let d2 = Infinity;
        for (const [a, b] of lines) d2 = Math.min(d2, dist2ToSegment(x + 0.5, y + 0.5, a, b));
        if (d2 > r2 || d2 >= best[t]!) continue;
        best[t] = d2;
        zone[t] = f.id;
      }
    }
  }
  return zone;
}
