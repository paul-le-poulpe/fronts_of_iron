// Réseau de routes terrestres (Docs/Design/00-Game.md §3.5). Une route est un
// segment entre deux villes ; le réseau est la liste des paires gardées.
// Calcul entièrement en entiers, sans racine : distances au carré, croisements
// par signes de produits vectoriels.

/** Signe du produit vectoriel (b − a) × (c − a) : 1, −1, ou 0 si les trois points sont alignés. */
function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

/**
 * Les segments [a, b] et [c, d] se croisent-ils ? Choix provisoire (02-Engine
 * §7) : seul un croisement franc compte, chaque segment ayant les extrémités de
 * l'autre strictement de part et d'autre de sa droite. Deux segments qui se
 * touchent en une extrémité, ou dont l'un contient une extrémité de l'autre
 * (alignement), ne se croisent pas.
 */
export function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  if (orientation(ax, ay, bx, by, cx, cy) * orientation(ax, ay, bx, by, dx, dy) >= 0) return false;
  return orientation(cx, cy, dx, dy, ax, ay) * orientation(cx, cy, dx, dy, bx, by) < 0;
}

/**
 * Routes gardées entre les villes dont la case est `tiles[i]` (identifiant =
 * i + 1). Candidates : les paires à une distance ≤ `radius`. Elles sont traitées
 * de la plus courte à la plus longue (distance au carré, puis plus petit a, puis
 * plus petit b) ; une candidate est gardée si elle ne croise aucune route déjà
 * gardée. Renvoie les paires [a, b], a < b, dans l'ordre où elles ont été gardées.
 *
 * Deux grilles de pas `radius` évitent de tester toutes les paires : une ville
 * ne regarde que les 9 cellules autour d'elle, et une candidate n'est comparée
 * qu'aux routes gardées dont la boîte englobante touche une des cellules de la
 * sienne (deux segments qui se croisent ont des boîtes qui se recouvrent, donc
 * une cellule commune).
 */
export function computeRoads(
  tiles: readonly number[],
  width: number,
  height: number,
  radius: number,
): [number, number][] {
  const n = tiles.length;
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = tiles[i]! % width;
    xs[i] = x;
    ys[i] = (tiles[i]! - x) / width;
  }
  const r2 = radius * radius;
  const cols = Math.floor((width - 1) / radius) + 1;
  const rows = Math.floor((height - 1) / radius) + 1;
  const newGrid = (): number[][] => Array.from({ length: cols * rows }, () => []);

  // Villes par cellule, dans l'ordre des identifiants.
  const cityCells = newGrid();
  for (let i = 0; i < n; i++) {
    cityCells[Math.floor(ys[i]! / radius) * cols + Math.floor(xs[i]! / radius)]!.push(i);
  }

  // Candidates : chaque paire (a, b), a < b, à distance ≤ radius.
  const ca: number[] = [];
  const cb: number[] = [];
  const cd: number[] = [];
  for (let a = 0; a < n; a++) {
    const gx = Math.floor(xs[a]! / radius);
    const gy = Math.floor(ys[a]! / radius);
    for (let cy = Math.max(0, gy - 1); cy <= Math.min(rows - 1, gy + 1); cy++) {
      for (let cx = Math.max(0, gx - 1); cx <= Math.min(cols - 1, gx + 1); cx++) {
        for (const b of cityCells[cy * cols + cx]!) {
          if (b <= a) continue;
          const dx = xs[b]! - xs[a]!;
          const dy = ys[b]! - ys[a]!;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            ca.push(a);
            cb.push(b);
            cd.push(d2);
          }
        }
      }
    }
  }
  // Ordre total (a et b distinguent deux candidates de même longueur) : le
  // résultat ne dépend pas de l'algorithme de tri.
  const order = Array.from(cd.keys());
  order.sort((i, j) => cd[i]! - cd[j]! || ca[i]! - ca[j]! || cb[i]! - cb[j]!);

  // Routes gardées, rangées dans chaque cellule que couvre leur boîte englobante.
  const ka: number[] = [];
  const kb: number[] = [];
  const roadCells = newGrid();
  for (const k of order) {
    const a = ca[k]!;
    const b = cb[k]!;
    const ax = xs[a]!, ay = ys[a]!, bx = xs[b]!, by = ys[b]!;
    const gx0 = Math.floor(Math.min(ax, bx) / radius);
    const gx1 = Math.floor(Math.max(ax, bx) / radius);
    const gy0 = Math.floor(Math.min(ay, by) / radius);
    const gy1 = Math.floor(Math.max(ay, by) / radius);
    let crossing = false;
    for (let gy = gy0; gy <= gy1 && !crossing; gy++) {
      for (let gx = gx0; gx <= gx1 && !crossing; gx++) {
        for (const r of roadCells[gy * cols + gx]!) {
          const c = ka[r]!;
          const d = kb[r]!;
          // Deux routes qui partagent une ville ne se croisent pas.
          if (c === a || c === b || d === a || d === b) continue;
          if (segmentsCross(ax, ay, bx, by, xs[c]!, ys[c]!, xs[d]!, ys[d]!)) {
            crossing = true;
            break;
          }
        }
      }
    }
    if (crossing) continue;
    const index = ka.length;
    ka.push(a);
    kb.push(b);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) roadCells[gy * cols + gx]!.push(index);
    }
  }
  return ka.map((a, i) => [a + 1, kb[i]! + 1]);
}

/**
 * Réseau tenu à jour ville par ville : donne, après chaque ajout, exactement le
 * résultat de computeRoads sur toutes les villes, sans retraiter les routes que
 * la nouvelle ville ne touche pas. Garde toutes les candidates (gardées ou non),
 * rangées dans une grille par boîte englobante. Entièrement déduit des villes :
 * n'entre pas dans le hash (les routes gardées, elles, y entrent).
 */
export interface RoadNetwork {
  readonly width: number;
  readonly radius: number;
  readonly cols: number;
  readonly rows: number;
  /** Coordonnées des villes ; indice = identifiant − 1. */
  readonly xs: number[];
  readonly ys: number[];
  /** Villes par cellule, dans l'ordre des identifiants. */
  readonly cityCells: number[][];
  /** Candidate k : villes ca[k] < cb[k] (indices), longueur au carré cd[k], kept[k] = 1 si gardée. */
  readonly ca: number[];
  readonly cb: number[];
  readonly cd: number[];
  readonly kept: number[];
  /** Candidates par cellule couverte par leur boîte englobante. */
  readonly candCells: number[][];
}

export function createRoadNetwork(width: number, height: number, radius: number): RoadNetwork {
  const cols = Math.floor((width - 1) / radius) + 1;
  const rows = Math.floor((height - 1) / radius) + 1;
  const grid = (): number[][] => Array.from({ length: cols * rows }, () => []);
  return {
    width, radius, cols, rows,
    xs: [], ys: [], cityCells: grid(),
    ca: [], cb: [], cd: [], kept: [], candCells: grid(),
  };
}

/** Ordre de traitement de computeRoads : longueur au carré, puis a, puis b. */
function compareCandidates(net: RoadNetwork, i: number, j: number): number {
  return net.cd[i]! - net.cd[j]! || net.ca[i]! - net.ca[j]! || net.cb[i]! - net.cb[j]!;
}

/** Appelle `visit` pour chaque candidate rangée dans une cellule de la boîte de k (une candidate peut revenir plusieurs fois). */
function forEachNearCandidate(net: RoadNetwork, k: number, visit: (c: number) => void): void {
  const a = net.ca[k]!;
  const b = net.cb[k]!;
  const gx0 = Math.floor(Math.min(net.xs[a]!, net.xs[b]!) / net.radius);
  const gx1 = Math.floor(Math.max(net.xs[a]!, net.xs[b]!) / net.radius);
  const gy0 = Math.floor(Math.min(net.ys[a]!, net.ys[b]!) / net.radius);
  const gy1 = Math.floor(Math.max(net.ys[a]!, net.ys[b]!) / net.radius);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      for (const c of net.candCells[gy * net.cols + gx]!) visit(c);
    }
  }
}

/** Les candidates j et k se croisent-elles ? Deux routes qui partagent une ville ne se croisent pas. */
function candidatesCross(net: RoadNetwork, j: number, k: number): boolean {
  const a = net.ca[k]!, b = net.cb[k]!, c = net.ca[j]!, d = net.cb[j]!;
  if (c === a || c === b || d === a || d === b) return false;
  const { xs, ys } = net;
  return segmentsCross(xs[a]!, ys[a]!, xs[b]!, ys[b]!, xs[c]!, ys[c]!, xs[d]!, ys[d]!);
}

/**
 * Ajoute la ville de case `tile` (identifiant = nombre de villes + 1) et met à
 * jour `roads`, la liste des routes gardées dans l'ordre de computeRoads.
 *
 * Une candidate est gardée si aucune candidate gardée plus courte (dans l'ordre
 * de compareCandidates) ne la croise. Une candidate ne peut changer d'état que
 * si une candidate plus courte qui la croise vient de changer d'état. On traite
 * donc, de la plus courte à la plus longue : les nouvelles candidates (celles de
 * la nouvelle ville), puis les candidates plus longues que croise une candidate
 * qui vient de changer d'état. Quand une candidate est traitée, toutes les plus
 * courtes ont leur état final : celles qui restent à traiter sont plus longues.
 * Les autres candidates ne sont pas relues.
 */
export function addCityToRoads(net: RoadNetwork, tile: number, roads: [number, number][]): void {
  const n = net.xs.length;
  const x = tile % net.width;
  const y = (tile - x) / net.width;
  net.xs.push(x);
  net.ys.push(y);
  const gx = Math.floor(x / net.radius);
  const gy = Math.floor(y / net.radius);
  net.cityCells[gy * net.cols + gx]!.push(n);

  // Nouvelles candidates : la nouvelle ville et chaque ville à distance ≤ radius.
  const r2 = net.radius * net.radius;
  const queue: number[] = [];
  const seen = new Set<number>();
  for (let cy = Math.max(0, gy - 1); cy <= Math.min(net.rows - 1, gy + 1); cy++) {
    for (let cx = Math.max(0, gx - 1); cx <= Math.min(net.cols - 1, gx + 1); cx++) {
      for (const a of net.cityCells[cy * net.cols + cx]!) {
        if (a === n) continue;
        const dx = x - net.xs[a]!;
        const dy = y - net.ys[a]!;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const k = net.ca.length;
        net.ca.push(a);
        net.cb.push(n);
        net.cd.push(d2);
        net.kept.push(0);
        const gx0 = Math.floor(Math.min(x, net.xs[a]!) / net.radius);
        const gx1 = Math.floor(Math.max(x, net.xs[a]!) / net.radius);
        const gy0 = Math.floor(Math.min(y, net.ys[a]!) / net.radius);
        const gy1 = Math.floor(Math.max(y, net.ys[a]!) / net.radius);
        for (let ry = gy0; ry <= gy1; ry++) {
          for (let rx = gx0; rx <= gx1; rx++) net.candCells[ry * net.cols + rx]!.push(k);
        }
        queue.push(k);
        seen.add(k);
      }
    }
  }

  while (queue.length > 0) {
    // La plus courte de la file (la file reste petite : un parcours suffit).
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (compareCandidates(net, queue[i]!, queue[best]!) < 0) best = i;
    }
    const k = queue[best]!;
    queue[best] = queue[queue.length - 1]!;
    queue.pop();

    let blocked = false;
    forEachNearCandidate(net, k, (c) => {
      if (!blocked && net.kept[c] === 1 && compareCandidates(net, c, k) < 0 && candidatesCross(net, c, k)) blocked = true;
    });
    const keep = blocked ? 0 : 1;
    if (keep === net.kept[k]) continue;
    net.kept[k] = keep;
    updateRoadList(net, k, keep, roads);

    forEachNearCandidate(net, k, (c) => {
      if (!seen.has(c) && compareCandidates(net, c, k) > 0 && candidatesCross(net, c, k)) {
        seen.add(c);
        queue.push(c);
      }
    });
  }
}

/** Insère ou retire la route de la candidate k dans `roads`, triée dans l'ordre de compareCandidates. */
function updateRoadList(net: RoadNetwork, k: number, keep: number, roads: [number, number][]): void {
  const { xs, ys } = net;
  const length2 = ([a, b]: [number, number]): number => {
    const dx = xs[b - 1]! - xs[a - 1]!;
    const dy = ys[b - 1]! - ys[a - 1]!;
    return dx * dx + dy * dy;
  };
  const a = net.ca[k]! + 1;
  const b = net.cb[k]! + 1;
  const d = net.cd[k]!;
  // Première position dont la route vient après (d, a, b) ou lui est égale.
  let lo = 0;
  let hi = roads.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = roads[mid]!;
    if ((length2(r) - d || r[0] - a || r[1] - b) < 0) lo = mid + 1;
    else hi = mid;
  }
  if (keep === 1) roads.splice(lo, 0, [a, b]);
  else roads.splice(lo, 1);
}
