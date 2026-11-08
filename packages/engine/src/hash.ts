// Hash 32 bits de l'état complet, comparé entre clients pour détecter une
// désynchronisation (01-Architecture.md §3). Construit avec les étapes de
// MurmurHash3 sur des mots de 32 bits assemblés à la main : ne pas lire les
// tableaux par une vue Uint32Array, dont l'ordre des octets dépend de la machine.

import { fmix32, mixWord } from "./bits.ts";
import type { Division } from "./divisions.ts";
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

/** Un front : joueurs, groupes, connexions avec leurs positions, attaque de chaque camp (05-Fronts §13.3). */
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
    h = mixWord(h, s.attackAt);
    h = mixWord(h, s.attackReadyAt);
    for (const n of s.lastLossByNiche) h = mixWord(h, n);
  }
  return h;
}

/** Une division : tous ses champs (05-Fronts §13.3). */
function hashDivision(h: number, d: Division): number {
  h = mixWord(h, d.id);
  h = mixWord(h, d.owner);
  h = mixWord(h, d.type);
  h = mixWord(h, d.state);
  h = mixWord(h, d.front);
  h = mixWord(h, d.line);
  h = mixWord(h, d.box);
  h = mixWord(h, d.breakthrough);
  h = mixWord(h, d.btEngaged);
  h = mixWord(h, d.engaged);
  h = mixWord(h, d.arrivalTick);
  h = mixWord(h, d.formedTick);
  h = mixWord(h, d.fleeUntilTick);
  h = mixWord(h, d.leaveTick);
  return h;
}

/**
 * Couvre : carte (par mapHash), numéro de tour, générateur aléatoire, joueurs (cases, population, capitale, villes, cases
 * de ressources, totaux de fertilité, activités avec leur ordre, leurs bonshommes, machines, places et résultats,
 * déblocage, machines d'Inactifs, compteurs de population et de machines, soin en cours, résultats du dernier tour,
 * élimination), villes (joueur, case, port, groupe), routes, fronts (connexions, positions, attaques), divisions (tous
 * leurs champs), statuts diplomatiques, propositions en attente, propriétaires, ville de chaque case.
 * Pas `state.events` (liste du dernier tour, jamais lue par les règles).
 */
export function hashState(state: GameState): number {
  let h = mixWord(state.mapHash, state.tick);
  const r = state.rng;
  h = mixWord(h, r[0]!);
  h = mixWord(h, r[1]!);
  h = mixWord(h, r[2]!);
  h = mixWord(h, r[3]!);
  // Seulement pour une partie de test : le hash d'une partie normale ne change pas.
  if (state.economyFrozen) h = mixWord(h, 1);
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
    h = mixWord(h, p.farmTiles);
    h = mixWord(h, p.fertilitySum);
    h = mixWord(h, p.seaTiles);
    h = mixWord(h, p.capacity);
    h = mixWord(h, p.food);
    h = mixWord(h, p.wheat);
    h = mixWord(h, p.fish);
    h = mixWord(h, p.cultivated);
    h = mixWord(h, p.fished);
    h = mixWord(h, p.minedTiles);
    h = mixWord(h, p.ironProduced);
    h = mixWord(h, p.ironReserved);
    h = mixWord(h, p.ironWanted);
    h = mixWord(h, p.hurtHeal);
    h = mixWord(h, p.autoAssign ? 1 : 0);
    h = mixWord(h, p.defeated ? 1 : 0);
    // Activités dans leur ordre (la priorité du joueur).
    h = mixWord(h, p.activities.length);
    for (const a of p.activities) {
      h = mixWord(h, a.id);
      h = mixWord(h, a.workers);
      h = mixWord(h, a.machines);
      h = mixWord(h, a.places);
      h = mixWord(h, a.slots);
      h = mixWord(h, a.disabled);
      h = mixWord(h, a.output);
      h = mixWord(h, a.ironUsed);
    }
    h = mixList(h, p.unlock);
    h = mixList(h, p.everOpened);
    h = mixList(h, p.idleMachines);
    h = mixList(h, p.popArrivals);
    h = mixList(h, p.popLeaves);
    for (const list of p.machineArrivals) h = mixList(h, list);
    for (const list of p.machineLeaves) h = mixList(h, list);
  }
  h = mixWord(h, state.cities.length);
  for (const c of state.cities) {
    h = mixWord(h, c.id);
    h = mixWord(h, c.player);
    h = mixWord(h, c.tile);
    h = mixWord(h, c.port ? 1 : 0);
    h = mixWord(h, c.group);
  }
  h = mixWord(h, state.foundings.length);
  for (const f of state.foundings) {
    h = mixWord(h, f.player);
    h = mixWord(h, f.tile);
    h = mixWord(h, f.startTick);
    h = mixWord(h, f.endTick);
    h = mixWord(h, f.paid);
  }
  h = mixWord(h, state.roads.length);
  for (const road of state.roads) {
    h = mixWord(h, road[0]);
    h = mixWord(h, road[1]);
  }
  // Fronts et divisions (05-Fronts §13.3) : compteurs d'identifiants, puis chacun dans l'ordre des identifiants.
  h = mixWord(h, state.nextFrontId);
  h = mixWord(h, state.fronts.length);
  for (const f of state.fronts) h = hashFront(h, f);
  h = mixWord(h, state.nextDivisionId);
  h = mixWord(h, state.divisions.length);
  for (const d of state.divisions) h = hashDivision(h, d);
  // Boîtes de percée et percées (05-Fronts §4.6, §7.2), par identifiant.
  h = mixWord(h, state.nextBoxId);
  h = mixWord(h, state.boxes.length);
  for (const b of state.boxes) {
    h = mixWord(h, b.id);
    h = mixWord(h, b.front);
    h = mixWord(h, b.owner);
  }
  h = mixWord(h, state.nextBreakthroughId);
  h = mixWord(h, state.breakthroughs.length);
  for (const b of state.breakthroughs) {
    h = mixWord(h, b.id);
    h = mixWord(h, b.front);
    h = mixWord(h, b.owner);
    h = mixWord(h, b.box);
    h = mixWord(h, b.city1);
    h = mixWord(h, b.city2);
    h = mixWord(h, b.phaseTick);
    h = mixWord(h, b.phase);
    h = mixWord(h, b.advance);
    h = mixWord(h, b.motorized ? 1 : 0);
    h = mixWord(h, b.startState);
  }
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
  const f = state.tileFisher;
  i = 0;
  for (; i + 1 < f.length; i += 2) h = mixWord(h, f[i]! | (f[i + 1]! << 16));
  if (i < f.length) h = mixWord(h, f[i]!);
  return fmix32(h ^ state.owner.length);
}
