// L'état complet d'une partie. Tout ce qui est ici entre dans le hash (hash.ts),
// sauf `changedMark`, remis à zéro à la fin de chaque tour, `roadNetwork`,
// entièrement déduit des villes, et `events` et `combats`, que rien ne lit dans le moteur.

import { isUint32 } from "./bits.ts";
import { ACTIVITY_COUNT, ACTIVITY_DATA, createActivities, GOOD_COUNT, type Activity } from "./activities.ts";
import { CITY, MAX_PLAYERS } from "./config.ts";
import type { DiplomacyEvent, Proposal } from "./diplomacy.ts";
import type { Box, Breakthrough } from "./breakthroughs.ts";
import type { CombatRecord } from "./combat.ts";
import type { Division } from "./divisions.ts";
import type { Front } from "./fronts.ts";
import { hashMap } from "./hash.ts";
import { RESOURCE_COUNT, TERRAIN_LAND, type GameMap } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
import { createRoadNetwork, type RoadNetwork } from "./roads.ts";

export type { Activity } from "./activities.ts";

export interface Player {
  /** 1 à MAX_PLAYERS ; c'est la valeur écrite dans `owner`. */
  readonly id: number;
  /** Nombre de cases dont `owner` vaut `id`. Tenu à jour par `setOwner`. */
  tileCount: number;
  /**
   * Population totale du joueur, en bonshommes (08 §1) : la somme des bonshommes de toutes les activités, Inactifs et
   * Blessés compris. 0 au départ.
   */
  population: number;
  /** Identifiant de la capitale, 0 = pas encore de ville (00-Game §3.4). */
  capital: number;
  /** Identifiants des villes du joueur, dans l'ordre de fondation. */
  readonly cityIds: number[];
  /** Pour chaque ressource (ordre de RESOURCES) : nombre de cases du joueur qui la portent. Tenu à jour par `setOwner`. */
  readonly resourceTiles: number[];
  /** Nombre de cases de fertilité > 0 que possède le joueur. Tenu à jour par `setOwner`. */
  farmTiles: number;
  /** Somme des fertilités des cases du joueur. Tenu à jour par `setOwner`. */
  fertilitySum: number;
  /** Nombre de cases d'eau (mer et lacs) que possède le joueur : la surface de pêche maximale. Tenu à jour par `setOwner`. */
  seaTiles: number;
  /**
   * Activités ouvertes (08 §2), de haut en bas : l'ordre est la priorité du fer et des disparitions. Inactifs est
   * toujours la première, Blessés y figure aussi. Une activité débloquée est ajoutée à la fin.
   */
  readonly activities: Activity[];
  /** Progression de déblocage de chaque activité (indice de `ACTIVITY_IDS`), en tours d'ouvrier servi, plafonnée au coût (08 §9). */
  readonly unlock: number[];
  /** 1 pour une activité déjà ouverte une fois dans la partie, par indice (08 §9). Sinon, débloquée, elle attend un clic. */
  readonly everOpened: number[];
  /** Machines disponibles dans Inactifs, par bien (ordre de `GOODS`). */
  readonly idleMachines: number[];
  /** Tours de fin des bonshommes à venir, triés (08 §6). */
  readonly popArrivals: number[];
  /** Tours de fin des bonshommes en sursis, triés. */
  readonly popLeaves: number[];
  /** Tours de fin des machines à venir, par bien, triés. */
  readonly machineArrivals: number[][];
  /** Tours de fin des machines en sursis, par bien, triés. */
  readonly machineLeaves: number[][];
  /** Fin du soin du blessé en cours, 0 si aucun (08 §8). */
  hurtHealEnd: number;
  /** Auto-assignation (08 §7 bis) : bonshommes et machines se placent seuls, de haut en bas. Allumée au départ. */
  autoAssign: boolean;
  // Résultats du dernier tour (economy.ts). 0 avant le premier tour.
  /** Capacité de population : ceil(nourriture / foodPerPawn) (08 §3). */
  capacity: number;
  /** Nourriture : `FOOD.base` + `FOOD.perCity` × villes + blé + poisson (08 §3). */
  food: number;
  wheat: number;
  fish: number;
  /** Surface cultivée, en cases. */
  cultivated: number;
  /** Surface pêchée, en cases. */
  fished: number;
  /** Cases de fer exploitées. */
  minedTiles: number;
  /** Fer produit par les mineurs (08 §4). */
  ironProduced: number;
  /** Fer réservé par les usines et les casernes servies. */
  ironReserved: number;
  /** Fer que demandent les usines et les casernes (08 §4) : au-delà du fer produit, le malus s'applique. */
  ironWanted: number;
  /**
   * Éliminé (05-Fronts §10.3) : sa dernière ville a été prise. Il n'a plus de division, et le moteur ignore ses ordres et
   * les ordres diplomatiques qui le visent. Ne revient jamais à `false`.
   */
  defeated: boolean;
}

export interface City {
  /** 1, 2, 3… dans l'ordre de fondation ; la ville est `state.cities[id - 1]`. Plus petit = plus ancienne. */
  readonly id: number;
  /** Propriétaire. Change à la prise de la ville par un front (05-Fronts §10), nulle part ailleurs. */
  player: number;
  /** Case où la ville est fondée. */
  readonly tile: number;
  /** Port : la zone de la ville contient au moins une case non terrestre (00-Game §3.6). */
  port: boolean;
  /** Groupe (00-Game §3.5) : plus petit identifiant de ville de la composante reliée par les routes du joueur. */
  group: number;
}

export interface GameState {
  readonly map: GameMap;
  /** Hash du terrain et des dimensions, calculé une fois à la création. */
  readonly mapHash: number;
  /** Propriétaire de chaque case, 0 = personne. Même adressage que `map.terrain`. */
  readonly owner: Uint16Array;
  /** `players[id - 1]` est le joueur `id`. */
  readonly players: readonly Player[];
  /** `cities[id - 1]` est la ville `id`. Les villes ne disparaissent pas encore. */
  readonly cities: City[];
  /** Identifiant de la ville dont la zone contient la case (terre et eau), 0 = aucune (00-Game §3.2). */
  readonly tileCity: Uint16Array;
  /** Routes terrestres gardées (00-Game §3.5) : paires d'identifiants [a, b], a < b, triées par longueur au carré, puis a, puis b. Mises à jour à chaque fondation par `roadNetwork`. */
  readonly roads: [number, number][];
  /** Toutes les routes candidates et leur grille (roads.ts). Déduit des villes : hors du hash, comme `changedMark`. */
  readonly roadNetwork: RoadNetwork;
  /**
   * Fronts terrestres (05-Fronts §2), par identifiant croissant. Recalculés quand les
   * routes ou le propriétaire d'une ville changent (`updateFronts`), jamais à chaque tour.
   */
  fronts: Front[];
  /** Prochain identifiant de front (1, 2, 3…). */
  nextFrontId: number;
  /** Divisions de tous les joueurs (05-Fronts §3), par identifiant croissant. Réassigné à chaque suppression. */
  divisions: Division[];
  /** Prochain identifiant de division (1, 2, 3…). */
  nextDivisionId: number;
  /** Boîtes de percée (05-Fronts §4.6), par identifiant croissant. */
  boxes: Box[];
  nextBoxId: number;
  /** Percées lancées (05-Fronts §7.2), par identifiant croissant. */
  breakthroughs: Breakthrough[];
  nextBreakthroughId: number;
  /**
   * Rapports des derniers combats (06-Combat-Simplifie §1), par identifiant croissant, pour l'affichage du replay.
   * Hors du hash, comme `events` : aucune règle ne les lit. Réassigné à chaque suppression.
   */
  combats: CombatRecord[];
  nextCombatId: number;
  readonly rng: Rng;
  /**
   * Statut diplomatique de chaque paire de joueurs (diplomacy.ts) : `players.length`²
   * octets, la paire (a, b) est à `(a - 1) × n + (b - 1)` et aussi à `(b - 1) × n + (a - 1)`,
   * les deux écrites ensemble. 0 neutre (au départ), 1 pacte, 2 guerre.
   */
  readonly diplomacy: Uint8Array;
  /** Propositions en attente de réponse, dans l'ordre de création. Réassigné à chaque suppression. */
  proposals: Proposal[];
  /**
   * Ce que le dernier tour a produit, pour l'affichage : vidé au début d'`applyTurn`,
   * rempli pendant le tour. Hors du hash, et aucune règle ne le lit : un client qui
   * l'ignore calcule le même état (02-Engine §4, §6).
   */
  readonly events: DiplomacyEvent[];
  /**
   * Économie gelée (partie de test, 01-Architecture §9 bis) : `applyTurn` saute les compteurs de population, de machines et
   * de divisions, le déblocage et la fondation de villes ; seul le soin continue (08 §8, §5). Fixé à la création par
   * `GameSetup.freezeEconomy`, jamais changé.
   */
  readonly economyFrozen: boolean;
  /** Numéro du dernier tour appliqué ; 0 avant le premier. */
  tick: number;
  /** 1 sur les cases déjà listées comme modifiées pendant le tour en cours. */
  readonly changedMark: Uint8Array;
}

export interface GameSetup {
  /** Graine du générateur aléatoire de la partie, entier 0 à 2³² − 1. */
  readonly seed: number;
  readonly map: GameMap;
  /** Les joueurs reçoivent les identifiants 1 à playerCount. */
  readonly playerCount: number;
  /** Gèle l'économie pendant toute la partie (outil de développement : `GameState.economyFrozen`). Absent : non. */
  readonly freezeEconomy?: boolean;
}

/** Lève une erreur si la configuration est invalide : elle vient du serveur, pas d'un joueur. */
export function createGame(setup: GameSetup): GameState {
  if (!isUint32(setup.seed)) throw new Error(`graine invalide : ${setup.seed}`);
  const { playerCount, map } = setup;
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) {
    throw new Error(`nombre de joueurs invalide : ${playerCount}`);
  }
  const size = map.width * map.height;
  if (map.terrain.length !== size) throw new Error("terrain de taille incorrecte");
  if (map.resources.length !== size) throw new Error("ressources de taille incorrecte");
  if (map.fertility.length !== size) throw new Error("fertilité de taille incorrecte");
  const players: Player[] = [];
  for (let id = 1; id <= playerCount; id++) {
    players.push({
      id,
      tileCount: 0,
      population: 0,
      capital: 0,
      cityIds: [],
      resourceTiles: new Array<number>(RESOURCE_COUNT).fill(0),
      farmTiles: 0,
      fertilitySum: 0,
      seaTiles: 0,
      activities: createActivities(),
      unlock: new Array<number>(ACTIVITY_COUNT).fill(0),
      everOpened: ACTIVITY_DATA.map((a) => (a.startOrder >= 0 ? 1 : 0)),
      idleMachines: new Array<number>(GOOD_COUNT).fill(0),
      popArrivals: [],
      popLeaves: [],
      machineArrivals: Array.from({ length: GOOD_COUNT }, () => [] as number[]),
      machineLeaves: Array.from({ length: GOOD_COUNT }, () => [] as number[]),
      hurtHealEnd: 0,
      autoAssign: true,
      capacity: 0,
      food: 0,
      wheat: 0,
      fish: 0,
      cultivated: 0,
      fished: 0,
      minedTiles: 0,
      ironProduced: 0,
      ironReserved: 0,
      ironWanted: 0,
      defeated: false,
    });
  }
  return {
    map,
    mapHash: hashMap(map),
    owner: new Uint16Array(size),
    players,
    cities: [],
    tileCity: new Uint16Array(size),
    roads: [],
    roadNetwork: createRoadNetwork(map.width, map.height, CITY.expansionRadius),
    fronts: [],
    nextFrontId: 1,
    divisions: [],
    nextDivisionId: 1,
    boxes: [],
    nextBoxId: 1,
    breakthroughs: [],
    nextBreakthroughId: 1,
    combats: [],
    nextCombatId: 1,
    rng: createRng(setup.seed),
    diplomacy: new Uint8Array(playerCount * playerCount),
    proposals: [],
    events: [],
    economyFrozen: setup.freezeEconomy === true,
    tick: 0,
    changedMark: new Uint8Array(size),
  };
}

export function isPlayerId(state: GameState, v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= state.players.length;
}

/**
 * Seule façon de changer le propriétaire d'une case : met à jour `owner`, les
 * compteurs de cases, de ressources, de cases fertiles, de fertilité et de cases
 * d'eau des joueurs, et ajoute la case à `changed` la première fois qu'elle
 * change dans le tour.
 */
export function setOwner(state: GameState, tile: number, newOwner: number, changed: number[]): void {
  const prev = state.owner[tile]!;
  if (prev === newOwner) return;
  const fertility = state.map.fertility[tile]!;
  const water = (state.map.terrain[tile]! & TERRAIN_LAND) === 0;
  if (prev !== 0) {
    const p = state.players[prev - 1]!;
    p.tileCount--;
    if (fertility > 0) p.farmTiles--;
    p.fertilitySum -= fertility;
    if (water) p.seaTiles--;
  }
  if (newOwner !== 0) {
    const p = state.players[newOwner - 1]!;
    p.tileCount++;
    if (fertility > 0) p.farmTiles++;
    p.fertilitySum += fertility;
    if (water) p.seaTiles++;
  }
  const res = state.map.resources[tile]!;
  if (res !== 0) {
    for (let i = 0; i < RESOURCE_COUNT; i++) {
      if (((res >> i) & 1) === 0) continue;
      if (prev !== 0) {
        const rt = state.players[prev - 1]!.resourceTiles;
        rt[i] = rt[i]! - 1;
      }
      if (newOwner !== 0) {
        const rt = state.players[newOwner - 1]!.resourceTiles;
        rt[i] = rt[i]! + 1;
      }
    }
  }
  state.owner[tile] = newOwner;
  if (state.changedMark[tile] === 0) {
    state.changedMark[tile] = 1;
    changed.push(tile);
  }
}
