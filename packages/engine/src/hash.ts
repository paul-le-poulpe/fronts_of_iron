// Hash 32 bits de l'état complet, comparé entre clients pour détecter une
// désynchronisation (01-Architecture.md §3). Construit avec les étapes de
// MurmurHash3 sur des mots de 32 bits assemblés à la main : ne pas lire les
// tableaux par une vue Uint32Array, dont l'ordre des octets dépend de la machine.

import { fmix32, mixWord } from "./bits.ts";
import { factoryTypeIndex, productIndex } from "./factories.ts";
import type { GameMap } from "./map.ts";
import type { GameState } from "./state.ts";

/** Ajoute les octets de `bytes` à `h`, quatre par mot (poids faible en premier). */
function mixBytes(h: number, bytes: Uint8Array): number {
  let i = 0;
  for (; i + 3 < bytes.length; i += 4) {
    h = mixWord(h, bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24));
  }
  for (; i < bytes.length; i++) h = mixWord(h, bytes[i]!);
  return h;
}

export function hashMap(map: GameMap): number {
  let h = mixWord(0x46524f4e, map.width);
  h = mixWord(h, map.height);
  h = mixBytes(h, map.terrain);
  h = mixBytes(h, map.resources);
  h = mixBytes(h, map.fertility);
  return fmix32(h ^ map.terrain.length);
}

/**
 * Couvre : carte (par mapHash), numéro de tour, générateur aléatoire, joueurs
 * (cases, population, capitale, villes, cases de ressources, reste de
 * croissance, répartition fermiers / pêcheurs, totaux de fertilité, résultats
 * du dernier tour, usines avec leurs groupes de lignes et leurs compteurs de
 * déblocage, biens produits, réserves d'armement), villes (joueur, case, port, groupe), routes, propriétaires,
 * ville de chaque case.
 */
export function hashState(state: GameState): number {
  let h = mixWord(state.mapHash, state.tick);
  const r = state.rng;
  h = mixWord(h, r[0]!);
  h = mixWord(h, r[1]!);
  h = mixWord(h, r[2]!);
  h = mixWord(h, r[3]!);
  h = mixWord(h, state.players.length);
  for (const p of state.players) {
    h = mixWord(h, p.id);
    h = mixWord(h, p.tileCount);
    h = mixWord(h, p.population);
    h = mixWord(h, p.capital);
    h = mixWord(h, p.resourceTiles.length);
    for (const n of p.resourceTiles) h = mixWord(h, n);
    h = mixWord(h, p.cityIds.length);
    for (const id of p.cityIds) h = mixWord(h, id);
    h = mixWord(h, p.growthRemainder);
    h = mixWord(h, p.farmPercent);
    h = mixWord(h, p.farmTiles);
    h = mixWord(h, p.fertilitySum);
    h = mixWord(h, p.seaTiles);
    h = mixWord(h, p.farmers);
    h = mixWord(h, p.fishers);
    h = mixWord(h, p.idle);
    h = mixWord(h, p.cultivated);
    h = mixWord(h, p.farmMechanization);
    h = mixWord(h, p.fished);
    h = mixWord(h, p.fishMechanization);
    h = mixWord(h, p.wheat);
    h = mixWord(h, p.fish);
    h = mixWord(h, p.food);
    h = mixWord(h, p.factoryWorkers);
    h = mixWord(h, p.miners);
    h = mixWord(h, p.minedTiles);
    h = mixWord(h, p.mineMechanization);
    h = mixWord(h, p.ironExtracted);
    h = mixWord(h, p.goods.length);
    for (const n of p.goods) h = mixWord(h, n);
    for (const n of p.goodsDemand) h = mixWord(h, n);
    h = mixWord(h, p.armamentReserve.length);
    for (let a = 0; a < p.armamentReserve.length; a++) {
      h = mixWord(h, p.armamentReserve[a]!);
      h = mixWord(h, p.armamentRemainder[a]!);
    }
    // Usines dans l'ordre de priorité, groupes dans l'ordre de leur usine.
    h = mixWord(h, p.factories.length);
    for (const f of p.factories) {
      h = mixWord(h, f.city);
      h = mixWord(h, factoryTypeIndex(f.type));
      h = mixWord(h, f.progress.length);
      for (const n of f.progress) h = mixWord(h, n);
      h = mixWord(h, f.groups.length);
      for (const g of f.groups) {
        h = mixWord(h, productIndex(g.good));
        h = mixWord(h, g.lines);
        h = mixWord(h, g.active);
        h = mixWord(h, g.filled);
        h = mixWord(h, g.growth);
      }
    }
  }
  h = mixWord(h, state.cities.length);
  for (const c of state.cities) {
    h = mixWord(h, c.id);
    h = mixWord(h, c.player);
    h = mixWord(h, c.tile);
    h = mixWord(h, c.port ? 1 : 0);
    h = mixWord(h, c.group);
  }
  h = mixWord(h, state.roads.length);
  for (const road of state.roads) {
    h = mixWord(h, road[0]);
    h = mixWord(h, road[1]);
  }
  // Deux cases par mot (poids faible en premier). Boucles écrites ici et non dans
  // une fonction commune : mesuré sous Node 24, 0,9 ms ainsi contre 5 ms avec
  // une fonction commune aux deux tableaux.
  const o = state.owner;
  let i = 0;
  for (; i + 1 < o.length; i += 2) h = mixWord(h, o[i]! | (o[i + 1]! << 16));
  if (i < o.length) h = mixWord(h, o[i]!);
  const c = state.tileCity;
  i = 0;
  for (; i + 1 < c.length; i += 2) h = mixWord(h, c[i]! | (c[i + 1]! << 16));
  if (i < c.length) h = mixWord(h, c[i]!);
  return fmix32(h ^ state.owner.length);
}
