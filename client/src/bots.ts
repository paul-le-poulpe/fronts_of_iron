// Bots du mode solo. Ce ne sont pas des règles du jeu : ce code lit l'état et
// produit des ordres `found_city` et `move_pawn`, comme le ferait un joueur, et
// le moteur les valide comme les autres. Ils ne servent qu'à donner un
// adversaire pour tester le client (stratégie minimale, pour le débogage) :
// les inactifs vont d'abord aux Agriculteurs, puis aux Mineurs, puis à la
// caserne de milice ; la ville suivante est fondée quand les inactifs en
// paient le coût.
//
// Déterministes : le hasard vient de `createRng` / `nextInt` du moteur, graine =
// graine des bots mélangée à l'identifiant du joueur. Même graine, même état,
// mêmes ordres (un rejeu de partie reste possible).

import {
  activityOf,
  ACTIVITY_DATA,
  ACTIVITY_IDS,
  CITY,
  createRng,
  foundingCostPawns,
  idlePawns,
  isLand,
  nextInt,
  slotsOf,
  type GameState,
  type Intent,
  type Player,
  type Rng,
} from "@fronts-of-iron/engine";

/** Tours entre deux tentatives d'expansion, plus un délai tiré entre 0 et `EXPAND_JITTER` − 1. */
export const EXPAND_EVERY_TURNS = 15;
export const EXPAND_JITTER = 10;
/** Tours entre deux affectations des inactifs. */
export const ASSIGN_EVERY_TURNS = 10;
/** Délai maximal avant la première ville, en tours : les bots ne jouent pas tous au tour 1. */
export const FIRST_CITY_MAX_DELAY = 30;
/** Cases candidates comparées pour choisir une ville. */
const CANDIDATES = 5;
/** Tirages au plus pour trouver les candidates. */
const MAX_DRAWS = 400;

export interface Bot {
  readonly player: number;
  /** Ajoute à `out` les ordres de ce bot pour le tour `state.tick + 1`. Ne modifie pas l'état. */
  step(state: GameState, out: Intent[]): void;
}

/** Places libres d'une activité à places calculées ; infini pour une caserne. */
function roomOf(p: Player, id: string): number {
  const index = ACTIVITY_IDS.indexOf(id as (typeof ACTIVITY_IDS)[number]);
  const a = activityOf(p, index);
  if (a === undefined) return 0;
  const data = ACTIVITY_DATA[index]!;
  return data.hasPlaces ? Infinity : slotsOf(p, data) - a.workers - a.machines;
}

export function createBot(player: number, botSeed: number): Bot {
  const rng = createRng(((botSeed >>> 0) ^ Math.imul(player, 0x9e3779b1)) >>> 0);
  let nextFirstCityTurn = 1 + nextInt(rng, FIRST_CITY_MAX_DELAY);
  let nextExpandTurn = 0;
  let nextAssignTurn = ASSIGN_EVERY_TURNS;

  return {
    player,
    step(state, out) {
      const turn = state.tick + 1;
      const me = state.players[player - 1]!;
      if (me.defeated) return;

      if (me.capital === 0) {
        if (turn < nextFirstCityTurn) return;
        const tile = bestCandidate(state, rng, null);
        if (tile >= 0) out.push({ type: "found_city", player, tile });
        else nextFirstCityTurn = turn + 1;
        return;
      }

      if (turn < nextAssignTurn) return;
      nextAssignTurn = turn + ASSIGN_EVERY_TURNS;
      if (activityOf(me, ACTIVITY_IDS.indexOf("militia")) === undefined) out.push({ type: "open_activity", player, activity: "militia" });
      let idle = idlePawns(me);
      const send = (to: "farmers" | "miners" | "militia"): void => {
        const n = Math.min(idle, roomOf(me, to));
        if (n < 1) return;
        out.push({ type: "move_pawn", player, from: "idle", to, kind: "worker", count: n });
        idle -= n;
      };
      // Agriculture d'abord ; la ville suivante quand la moitié de la surface cultivable est cultivée et que les inactifs
      // en paient le coût ; puis les mines et la milice.
      send("farmers");
      const cost = foundingCostPawns(me.cityIds.length);
      if (turn >= nextExpandTurn && 2 * me.cultivated >= me.farmTiles && idle >= cost) {
        nextExpandTurn = turn + EXPAND_EVERY_TURNS + nextInt(rng, EXPAND_JITTER);
        const tile = bestCandidate(state, rng, me.cityIds);
        if (tile >= 0) {
          out.push({ type: "found_city", player, tile });
          idle -= cost;
        }
      }
      send("miners");
      send("militia");
    },
  };
}

/**
 * Tire des cases valides pour `found_city` (terre, fertilité > 0, aucune ville
 * ne la possède) et renvoie celle qui a le plus de cases fertiles libres dans
 * son rayon de contrôle, ou -1 si aucune n'est trouvée.
 * Sans `cityIds` (première ville) : n'importe où sur la carte. Sinon : dans le
 * rayon d'expansion d'une des villes, choisie au hasard à chaque tirage.
 */
function bestCandidate(state: GameState, rng: Rng, cityIds: readonly number[] | null): number {
  const { width, height } = state.map;
  const reach = CITY.expansionRadius;
  const reach2 = reach * reach;
  let best = -1;
  let bestScore = -1;
  let found = 0;
  for (let draw = 0; draw < MAX_DRAWS && found < CANDIDATES; draw++) {
    let x: number;
    let y: number;
    if (cityIds === null) {
      x = nextInt(rng, width);
      y = nextInt(rng, height);
    } else {
      const from = state.cities[cityIds[nextInt(rng, cityIds.length)]! - 1]!.tile;
      const fx = from % width;
      const fy = (from - fx) / width;
      const dx = nextInt(rng, 2 * reach + 1) - reach;
      const dy = nextInt(rng, 2 * reach + 1) - reach;
      if (dx * dx + dy * dy > reach2) continue;
      x = fx + dx;
      y = fy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
    }
    const tile = y * width + x;
    if (!isLand(state.map, tile) || state.map.fertility[tile] === 0 || state.tileCity[tile] !== 0) continue;
    found++;
    const score = freeFertileTiles(state, x, y);
    if (score > bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

/** Cases fertiles sans ville dans le rayon de contrôle autour de (cx, cy). */
function freeFertileTiles(state: GameState, cx: number, cy: number): number {
  const { width, height, fertility } = state.map;
  const r = CITY.controlRadius;
  let n = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const t = y * width + x;
      if (fertility[t]! > 0 && state.tileCity[t] === 0) n++;
    }
  }
  return n;
}
