// Outils des tests de villes : placement sur la carte et calculs de référence
// écrits sans passer par le code du moteur (parcours de toutes les paires, de
// toutes les cases). Lents, mais assez simples pour être relus d'un coup d'œil.

import assert from "node:assert/strict";

import {
  CITY,
  FERTILITY,
  isLand,
  RESOURCE_COUNT,
  RESOURCE_IRON,
  TERRAIN_LAND,
  type GameMap,
  type GameState,
} from "../src/index.ts";

export const tileAt = (map: GameMap, x: number, y: number): number => y * map.width + x;
export const xOf = (map: GameMap, tile: number): number => tile % map.width;
export const yOf = (map: GameMap, tile: number): number => Math.floor(tile / map.width);

/** Toutes les cases du disque de rayon `r` autour de (x, y) sont de la terre. */
export function isLandDisc(map: GameMap, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= map.width || py >= map.height) return false;
      if (!isLand(map, tileAt(map, px, py))) return false;
    }
  }
  return true;
}

/** Une case d'eau (la première dans l'ordre des adresses). */
export function firstWaterTile(map: GameMap): number {
  return map.terrain.findIndex((b) => (b & 0x80) === 0);
}

/** La première case de terre qui touche l'eau (bit de côte), dans l'ordre des adresses. */
export function firstShoreTile(map: GameMap): number {
  return map.terrain.findIndex((b) => (b & 0x80) !== 0 && (b & 0x40) !== 0);
}

const dist2 = (map: GameMap, a: number, b: number): number => {
  const dx = xOf(map, a) - xOf(map, b);
  const dy = yOf(map, a) - yOf(map, b);
  return dx * dx + dy * dy;
};

/** Ville propriétaire de chaque case, par la définition de 00-Game §3.2 : toutes les villes pour chaque case. */
export function bruteTileCity(state: GameState): Uint16Array {
  const { map, cities } = state;
  const r2 = CITY.controlRadius * CITY.controlRadius;
  const out = new Uint16Array(map.terrain.length);
  // Les cases hors de la boîte des villes (élargie du rayon) n'ont forcément aucune ville.
  const xs = cities.map((c) => xOf(map, c.tile));
  const ys = cities.map((c) => yOf(map, c.tile));
  const r = CITY.controlRadius;
  const x0 = Math.min(...xs) - r, x1 = Math.max(...xs) + r;
  const y0 = Math.min(...ys) - r, y1 = Math.max(...ys) + r;
  for (let t = 0; t < out.length; t++) {
    const x = xOf(map, t);
    const y = yOf(map, t);
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    let best = 0;
    let bestD2 = 0;
    for (const c of cities) {
      const d2 = dist2(map, t, c.tile);
      if (d2 > r2) continue;
      if (best === 0 || d2 < bestD2) {
        best = c.id;
        bestD2 = d2;
      }
    }
    out[t] = best;
  }
  return out;
}

/** Croisement franc de deux segments, écrit autrement que dans src/roads.ts (comparaisons de signes, pas de produit). */
export function bruteCross(
  p: readonly [number, number], q: readonly [number, number],
  r: readonly [number, number], s: readonly [number, number],
): boolean {
  const side = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = side(p, q, r);
  const d2 = side(p, q, s);
  const d3 = side(r, s, p);
  const d4 = side(r, s, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Réseau de routes par la définition de 00-Game §3.5 : toutes les paires, toutes les routes déjà gardées. */
export function bruteRoads(tiles: readonly number[], width: number, radius: number): [number, number][] {
  const pos = tiles.map((t) => [t % width, Math.floor(t / width)] as const);
  const candidates: { a: number; b: number; d2: number }[] = [];
  for (let a = 0; a < tiles.length; a++) {
    for (let b = a + 1; b < tiles.length; b++) {
      const dx = pos[a]![0] - pos[b]![0];
      const dy = pos[a]![1] - pos[b]![1];
      if (dx * dx + dy * dy <= radius * radius) candidates.push({ a, b, d2: dx * dx + dy * dy });
    }
  }
  candidates.sort((u, v) => u.d2 - v.d2 || u.a - v.a || u.b - v.b);
  const kept: { a: number; b: number }[] = [];
  for (const c of candidates) {
    const crosses = kept.some(
      (k) =>
        k.a !== c.a && k.a !== c.b && k.b !== c.a && k.b !== c.b &&
        bruteCross(pos[c.a]!, pos[c.b]!, pos[k.a]!, pos[k.b]!),
    );
    if (!crosses) kept.push(c);
  }
  return kept.map((k) => [k.a + 1, k.b + 1]);
}

/** Groupe de chaque ville (indice = id − 1) : plus petit identifiant de la composante, par parcours en largeur. */
export function bruteGroups(state: GameState): number[] {
  const n = state.cities.length;
  const group = new Array<number>(n).fill(0);
  for (let start = 1; start <= n; start++) {
    if (group[start - 1] !== 0) continue;
    // `start` est le plus petit identifiant non encore rangé : c'est le plus petit de sa composante.
    const queue = [start];
    group[start - 1] = start;
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head]!;
      for (const [a, b] of state.roads) {
        const other = a === c ? b : b === c ? a : 0;
        if (other === 0 || group[other - 1] !== 0) continue;
        if (state.cities[other - 1]!.player !== state.cities[c - 1]!.player) continue;
        group[other - 1] = start;
        queue.push(other);
      }
    }
  }
  return group;
}

/** Vérifie tous les invariants des villes en les recalculant de zéro. */
export function checkCityInvariants(state: GameState): void {
  const { map, cities } = state;
  const brute = bruteTileCity(state);
  assert.deepEqual(state.tileCity, brute, "zones différentes du calcul de référence");

  // owner se déduit de tileCity.
  for (let t = 0; t < brute.length; t++) {
    const expected = brute[t] === 0 ? 0 : cities[brute[t]! - 1]!.player;
    assert.equal(state.owner[t], expected, `propriétaire de la case ${t}`);
  }

  // Compteurs de chaque joueur.
  for (const p of state.players) {
    let tiles = 0;
    let farmTiles = 0;
    let fertilitySum = 0;
    let seaTiles = 0;
    const resources = new Array<number>(RESOURCE_COUNT).fill(0);
    for (let t = 0; t < state.owner.length; t++) {
      if (state.owner[t] !== p.id) continue;
      tiles++;
      for (let i = 0; i < RESOURCE_COUNT; i++) if ((map.resources[t]! >> i) & 1) resources[i]!++;
      if (map.fertility[t]! > 0) farmTiles++;
      fertilitySum += map.fertility[t]!;
      if ((map.terrain[t]! & TERRAIN_LAND) === 0) seaTiles++;
    }
    assert.equal(p.tileCount, tiles, `tileCount du joueur ${p.id}`);
    assert.deepEqual(p.resourceTiles, resources, `resourceTiles du joueur ${p.id}`);
    assert.equal(p.farmTiles, farmTiles, `farmTiles du joueur ${p.id}`);
    assert.equal(p.fertilitySum, fertilitySum, `fertilitySum du joueur ${p.id}`);
    assert.equal(p.seaTiles, seaTiles, `seaTiles du joueur ${p.id}`);
    const ids = cities.filter((c) => c.player === p.id).map((c) => c.id);
    assert.deepEqual(p.cityIds, ids, `cityIds du joueur ${p.id}`);
    assert.equal(p.capital, ids[0] ?? 0, `capitale du joueur ${p.id}`);
  }

  // Identifiants, routes, groupes, ports.
  cities.forEach((c, i) => assert.equal(c.id, i + 1));
  assert.deepEqual(state.roads, bruteRoads(cities.map((c) => c.tile), map.width, CITY.expansionRadius), "routes");
  const groups = bruteGroups(state);
  cities.forEach((c, i) => assert.equal(c.group, groups[i], `groupe de la ville ${c.id}`));
  for (const c of cities) {
    let water = false;
    for (let t = 0; t < brute.length && !water; t++) if (brute[t] === c.id && !isLand(map, t)) water = true;
    assert.equal(c.port, water, `port de la ville ${c.id}`);
  }
}

/**
 * Petite carte fabriquée à la main : `kind` dit, pour chaque case, terre, océan
 * ou lac (eau sans bit océan) ; `iron` place du fer ; `fertility` donne la
 * fertilité d'une case de terre (par défaut FERTILITY.land partout sur la terre,
 * 0 sur l'eau). Permet de poser les villes à des distances exactes, sans
 * dépendre du relief de la carte de test.
 */
export function customMap(
  width: number,
  height: number,
  kind: (x: number, y: number) => "land" | "ocean" | "lake",
  iron: (x: number, y: number) => boolean = () => false,
  fertility: (x: number, y: number) => number = () => FERTILITY.land,
): GameMap {
  const terrain = new Uint8Array(width * height);
  const resources = new Uint8Array(width * height);
  const fertile = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = kind(x, y);
      terrain[y * width + x] = k === "land" ? 0x80 : k === "ocean" ? 0x20 : 0;
      if (iron(x, y)) resources[y * width + x] = RESOURCE_IRON;
      if (k === "land") fertile[y * width + x] = fertility(x, y);
    }
  }
  return { width, height, terrain, resources, fertility: fertile };
}

/**
 * Récolte d'un joueur par la définition de 00-Game §6.2 à §6.5, écrite avec des
 * rationnels exacts (BigInt) et non avec la formule en entiers de src/economy.ts :
 * même résultat attendu. `machines` est un nombre de machines (tracteurs ou bateaux).
 */
export function bruteHarvest(
  cfg: { mechanizationBase: number; mechanizationMax: number; maxMachinesPer1000: number; curveExponent: number },
  available: number,
  machines: number,
  surfaceMax: number,
  fertilitySum: number,
): { workers: number; area: number; yield: number } {
  const S = 10_000n;
  const maxM = BigInt(cfg.maxMachinesPer1000);
  // x = min(machines / disponibles, m_max) / m_max, ramené sur 0…S par division entière.
  // m_max est en machines pour 1 000 travailleurs.
  let X = available === 0 ? 0n : (BigInt(machines) * 1000n * S) / (BigInt(available) * maxM);
  if (X > S) X = S;
  let p = S;
  for (let i = 0; i < cfg.curveExponent; i++) p = (p * (S - X)) / S;
  const f = S - p;
  const base = BigInt(cfg.mechanizationBase);
  const M = base + ((BigInt(cfg.mechanizationMax) - base) * f) / S;
  const surface = BigInt(surfaceMax);
  // fermiers_requis = surface_max / M, arrondi vers le haut (surface en cases, M en millièmes).
  const required = (surface * 1000n + M - 1n) / M;
  const workers = required < BigInt(available) ? required : BigInt(available);
  let area = (workers * M) / 1000n;
  if (area > surface) area = surface;
  const output = surface === 0n ? 0n : (BigInt(fertilitySum) * area) / surface;
  return { workers: Number(workers), area: Number(area), yield: Number(output) };
}

