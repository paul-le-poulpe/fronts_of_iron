// Hash 32 bits de l'état complet, comparé entre clients pour détecter une
// désynchronisation (01-Architecture.md §3). Construit avec les étapes de
// MurmurHash3 sur des mots de 32 bits assemblés à la main : ne pas lire les
// tableaux par une vue Uint32Array, dont l'ordre des octets dépend de la machine.

import { fmix32, mixWord } from "./bits.ts";
import { factoryTypeIndex, productIndex } from "./factories.ts";
import type { Front } from "./fronts.ts";
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

function mixList(h: number, list: readonly number[]): number {
  h = mixWord(h, list.length);
  for (const n of list) h = mixWord(h, n);
  return h;
}

/** Un front : joueurs, groupes, connexions avec leurs positions, puis chaque camp avec tous ses champs (05-Fronts §13.3). */
function hashFront(h: number, f: Front): number {
  h = mixWord(h, f.id);
  h = mixWord(h, f.players[0]);
  h = mixWord(h, f.players[1]);
  h = mixWord(h, f.groups[0]);
  h = mixWord(h, f.groups[1]);
  h = mixWord(h, f.connections.length);
  for (const c of f.connections) {
    h = mixWord(h, c.city1);
    h = mixWord(h, c.city2);
    h = mixWord(h, c.position);
  }
  for (const s of f.sides) {
    h = mixList(h, s.firstLine);
    h = mixList(h, s.secondLine);
    h = mixWord(h, s.transfers.length);
    for (const t of s.transfers) {
      h = mixWord(h, t.unit);
      h = mixWord(h, t.count);
      h = mixWord(h, t.toFront ? 1 : 0);
      h = mixWord(h, t.line);
      h = mixWord(h, t.arrival);
    }
    h = mixWord(h, s.priorityIndex);
    h = mixWord(h, s.reassign ? 1 : 0);
    h = mixList(h, s.lineMode);
    for (const a of s.allowed) h = mixWord(h, a ? 1 : 0);
    h = mixWord(h, s.motorizedOnly ? 1 : 0);
    h = mixWord(h, s.frontAttack ? 1 : 0);
    h = mixList(h, s.lostFirst);
    h = mixList(h, s.lostSecond);
    h = mixWord(h, s.breakthroughs.length);
    for (const b of s.breakthroughs) {
      h = mixWord(h, b.id);
      h = mixWord(h, b.city1);
      h = mixWord(h, b.city2);
      h = mixWord(h, b.startTick);
      h = mixWord(h, b.phase);
      h = mixList(h, b.attackers);
      h = mixList(h, b.defenders1);
      h = mixList(h, b.defenders2);
      h = mixWord(h, b.startHp);
    }
  }
  return h;
}

/**
 * Couvre : carte (par mapHash), numéro de tour, générateur aléatoire, joueurs
 * (cases, population, capitale, villes, cases de ressources, reste de
 * croissance, répartition fermiers / pêcheurs, totaux de fertilité, résultats
 * du dernier tour, usines avec leurs groupes de lignes et leurs compteurs de
 * déblocage, biens produits, réserves d'armement, mobilisation forcée, soldats), villes (joueur, case, port, groupe), routes,
 * fronts (troupes, mouvements, réglages, attaques, percées), statuts diplomatiques, propositions en attente, propriétaires, ville de chaque case.
 * Pas `state.events` (liste du dernier tour, jamais lue par les règles).
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
    h = mixWord(h, p.forcedMobilization ? 1 : 0);
    h = mixWord(h, p.soldiers);
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
  // Fronts (05-Fronts §13.3) : compteurs d'identifiants, puis chaque front dans l'ordre des identifiants.
  h = mixWord(h, state.nextFrontId);
  h = mixWord(h, state.nextBreakthroughId);
  h = mixWord(h, state.fronts.length);
  for (const f of state.fronts) h = hashFront(h, f);
  // Diplomatie : les statuts (les deux cases de chaque paire), puis les propositions dans l'ordre de création.
  // `state.events` n'y est pas : rien ne le lit dans les règles.
  h = mixBytes(h, state.diplomacy);
  h = mixWord(h, state.proposals.length);
  for (const p of state.proposals) {
    h = mixWord(h, p.from);
    h = mixWord(h, p.to);
    h = mixWord(h, p.kind === "pact" ? 0 : 1);
    h = mixWord(h, p.createdTick);
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
