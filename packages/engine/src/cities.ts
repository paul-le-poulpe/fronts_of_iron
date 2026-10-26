// Villes (Docs/Design/00-Game.md §3) : fondation, zones, ports, groupes. Les
// routes sont dans roads.ts. Tout est en entiers : distances au carré, sans racine.

import { CITY, MAX_CITIES, POPULATION } from "./config.ts";
import { isLand } from "./map.ts";
import { activeFrontCities, updateFronts } from "./fronts.ts";
import { addCityToRoads } from "./roads.ts";
import { setOwner, type City, type GameState } from "./state.ts";

/**
 * Ordre `found_city` (00-Game §3.3), après vérification des champs par
 * intents.ts. Fonde la ville du joueur sur `tile` si c'est permis ; renvoie
 * false, sans rien modifier, sinon.
 */
export function foundCity(state: GameState, playerId: number, tile: number, changed: number[]): boolean {
  if (!isLand(state.map, tile)) return false;
  // `tileCity[tile] === 0` équivaut à « la case est dans le rayon de contrôle
  // d'aucune ville » : si une ville est à distance ≤ rayon, la plus proche
  // l'est aussi, donc possède la case (zones, §3.2) ; et une case possédée est à
  // portée de sa ville.
  if (state.tileCity[tile] !== 0) return false;
  if (state.cities.length >= MAX_CITIES) return false;

  const player = state.players[playerId - 1]!;
  const first = player.capital === 0;
  if (!first) {
    if (player.population < foundingCost(player.cityIds.length)) return false;
    if (!inExpansionRadius(state, player.cityIds, tile)) return false;
  }

  // Tout est valide : les effets, dans l'ordre de 00-Game §3.3.
  if (first) player.population += POPULATION.initial;
  else player.population -= foundingCost(player.cityIds.length);
  const id = state.cities.length + 1;
  const city: City = { id, player: playerId, tile, port: false, group: id };
  state.cities.push(city);
  player.cityIds.push(id);
  if (first) player.capital = id;

  const losers = updateZones(state, city, changed);
  addCityToRoads(state.roadNetwork, tile, state.roads);
  city.port = zoneHasWater(state, city);
  for (const loser of losers) {
    const c = state.cities[loser - 1]!;
    c.port = zoneHasWater(state, c);
  }
  computeGroups(state);
  updateFronts(state);
  return true;
}

/**
 * Coût en population d'une ville pour un joueur qui en possède déjà
 * `cityCount` (00-Game §3.3) : le coût de base plus
 * `foundingCostIncreasePercent` % de ce coût par ville possédée, arrondi vers
 * le bas. Ne s'applique pas à la première ville, gratuite.
 */
export function foundingCost(cityCount: number): number {
  return Math.floor((CITY.foundingCostPopulation * (100 + cityCount * CITY.foundingCostIncreasePercent)) / 100);
}

/**
 * Une des villes `cityIds` est-elle à une distance ≤ rayon d'expansion de `tile` ?
 * Le rayon d'expansion d'une ville qui a une connexion dans un front actif ne
 * compte pas (05-Fronts §8).
 */
function inExpansionRadius(state: GameState, cityIds: readonly number[], tile: number): boolean {
  const w = state.map.width;
  const x = tile % w;
  const y = (tile - x) / w;
  const r2 = CITY.expansionRadius * CITY.expansionRadius;
  const atWar = activeFrontCities(state);
  for (const id of cityIds) {
    if (atWar.has(id)) continue;
    const t = state.cities[id - 1]!.tile;
    const dx = (t % w) - x;
    const dy = Math.floor(t / w) - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/**
 * Zones (00-Game §3.2), mises à jour pour la ville `city`, qui vient d'être
 * ajoutée. Une case appartient à la ville la plus proche si celle-ci est dans le
 * rayon de contrôle, la plus ancienne à égalité. Seules les cases du rayon de
 * contrôle de `city` peuvent changer : on parcourt la boîte englobante de ce
 * disque. `city` a le plus grand identifiant, donc elle prend une case qui a
 * déjà une ville seulement si elle en est strictement plus proche.
 * Renvoie les identifiants des villes qui ont perdu des cases.
 */
function updateZones(state: GameState, city: City, changed: number[]): number[] {
  const { width: w, height: h } = state.map;
  const radius = CITY.controlRadius;
  const r2 = radius * radius;
  const cx = city.tile % w;
  const cy = (city.tile - cx) / w;
  const losers: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    const dy = y - cy;
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = y * w + x;
      const current = state.tileCity[t]!;
      if (current !== 0) {
        const other = state.cities[current - 1]!.tile;
        const ox = (other % w) - x;
        const oy = Math.floor(other / w) - y;
        if (d2 >= ox * ox + oy * oy) continue;
        if (!losers.includes(current)) losers.push(current);
      }
      state.tileCity[t] = city.id;
      setOwner(state, t, city.player, changed);
    }
  }
  return losers;
}

/** Port (00-Game §3.6) : la zone de `city` contient-elle une case qui n'est pas de la terre ? */
function zoneHasWater(state: GameState, city: City): boolean {
  const { width: w, height: h } = state.map;
  const radius = CITY.controlRadius;
  const cx = city.tile % w;
  const cy = (city.tile - cx) / w;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const t = y * w + x;
      if (state.tileCity[t] === city.id && !isLand(state.map, t)) return true;
    }
  }
  return false;
}

/**
 * Groupes (00-Game §3.5, points 4 et 5), pour tous les joueurs. Deux villes sont
 * dans le même groupe si une suite de routes les relie en ne passant que par des
 * villes du même joueur : une route vers la ville d'un autre joueur n'est pas
 * utilisée. Le groupe d'une ville est le plus petit identifiant de ville de sa
 * composante : en rattachant toujours la racine la plus grande à la plus petite,
 * la racine d'une composante est son plus petit identifiant.
 */
export function computeGroups(state: GameState): void {
  const parent = new Int32Array(state.cities.length + 1);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (const [a, b] of state.roads) {
    if (state.cities[a - 1]!.player !== state.cities[b - 1]!.player) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  }
  for (const c of state.cities) c.group = find(c.id);
}
