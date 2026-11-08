// Outils des tests des fronts (05-Fronts §13.7, 06-Combat-Simplifie §1) : une petite carte de terre sans relief où les
// villes sont posées à des distances exactes, des divisions posées à la main, des ordres envoyés par `applyTurn`.
//
// `duel` et `game` gèlent l'économie par défaut (`GameSetup.freezeEconomy`) : sans usine ni caserne, chaque division posée
// à la main serait en trop et disparaîtrait au bout de `DIVISION_TIMING.leaveTurns` tours (08 §6). Avec l'économie gelée,
// les villes passent par `settle`, car l'ordre `found_city` est refusé.

import assert from "node:assert/strict";

import {
  applyTurn,
  CITY,
  createGame,
  DIVISION_DATA,
  DIVISION_IDS,
  foundCity,
  LINE_SECOND,
  STATE_SCALE,
  type CombatRecord,
  type CombatShot,
  type Division,
  type DivisionId,
  type Front,
  type GameMap,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { customMap, tileAt } from "./helpers.ts";

/** Rayon de contrôle ; deux villes à 1,5 R l'une de l'autre sont reliées par une route (rayon d'expansion = 2 R) sans que leurs zones se recouvrent. */
export const R = CITY.controlRadius;
export const MAP: GameMap = customMap(14 * R, 10 * R, () => "land");

/** Case de la ville posée en (x, y), en unités de R / 2 (pour éviter les fractions). */
export const at = (halfR: number, halfRY: number): number => tileAt(MAP, Math.floor((halfR * R) / 2), Math.floor((halfRY * R) / 2));

/** Envoie les ordres au tour suivant. */
export function turn(s: GameState, ...intents: Intent[]): void {
  applyTurn(s, { turn: s.tick + 1, intents });
}

/** Joue `n` tours sans ordre. */
export function play(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) turn(s);
}

export const found = (player: number, tile: number): Intent => ({ type: "found_city", player, tile });

/** Une partie vide, sur `MAP`, économie gelée par défaut. */
export function game(playerCount: number, freezeEconomy = true): GameState {
  return createGame({ seed: 1, map: MAP, playerCount, freezeEconomy });
}

/** Fonde des villes hors tour, sans passer par l'ordre : [joueur, case], dans l'ordre. */
export function settle(s: GameState, ...cities: [number, number][]): void {
  for (const [player, tile] of cities) assert.ok(foundCity(s, player, tile, []), `ville du joueur ${player} sur la case ${tile}`);
  s.changedMark.fill(0);
}

/** Deux joueurs, une ville chacun, reliées par une route : un front entre eux. Joueur 1 à gauche. */
export function duel(freezeEconomy = true): GameState {
  const s = game(2, freezeEconomy);
  settle(s, [1, at(8, 10)], [2, at(11, 10)]);
  assert.equal(s.fronts.length, 1);
  return s;
}

/** Le front n° `i` de l'état. */
export const front = (s: GameState, i = 0): Front => s.fronts[i]!;

/** Indice d'un type de division. */
export const D = Object.fromEntries(DIVISION_IDS.map((id, i) => [id, i])) as Record<DivisionId, number>;

/** Pose directement une division formée, sur place (sans ordre, sans délai) : `front` 0 pour la réserve nationale. */
export function put(s: GameState, player: number, type: DivisionId, front = 0, state = STATE_SCALE): Division {
  const d: Division = {
    id: s.nextDivisionId++,
    owner: player,
    type: DIVISION_DATA[D[type]]!.index,
    state,
    front,
    line: LINE_SECOND,
    box: 0,
    breakthrough: 0,
    btEngaged: 0,
    engaged: 0,
    arrivalTick: 0,
    formedTick: 0,
    fleeUntilTick: 0,
    leaveTick: 0,
  };
  s.divisions.push(d);
  return d;
}

/** `n` divisions pleines de ce type sur le front 1, pour le joueur `player`. Renvoie leurs identifiants. */
export function putMany(s: GameState, player: number, type: DivisionId, n: number, frontId = 1): number[] {
  return Array.from({ length: n }, () => put(s, player, type, frontId).id);
}

/** Guerre entre les joueurs 1 et 2 sur le front du duel. */
export function war(s: GameState): void {
  turn(s, { type: "declare_war", player: 1, target: 2 });
}

/**
 * Les joueurs de `attackers` lancent chacun une attaque sur tout le front, résolue dans ce tour (06-Combat-Simplifie §1).
 * Renvoie le dernier rapport, s'il y en a un.
 */
export function attack(s: GameState, ...attackers: number[]): CombatRecord | undefined {
  turn(s, ...attackers.map((player): Intent => ({ type: "start_front_attack", player, front: front(s).id })));
  return s.combats.at(-1);
}

/**
 * État perdu par chaque division pendant un cycle d'un rapport (somme de ses tirs), ou pendant un seul tir (`shot`, indice
 * dans `cycles[cycle].shots`), par identifiant de division (échelle `STATE_SCALE`).
 */
export function hitsOf(record: CombatRecord, cycle = 0, shot?: number): Map<number, number> {
  const shots = shot === undefined ? record.cycles[cycle]!.shots : [record.cycles[cycle]!.shots[shot]!];
  const out = new Map<number, number>();
  for (const sh of shots) for (const [unit, lost] of sh.hits) out.set(record.units[unit]!.division, (out.get(record.units[unit]!.division) ?? 0) + lost);
  return out;
}

/** Tous les tirs d'un rapport, dans l'ordre. */
export const shotsOf = (record: CombatRecord): CombatShot[] => record.cycles.flatMap((c) => [...c.shots]);

/** Indices d'unités d'un rapport (`fled`, `destroyed`, `arrived`) convertis en identifiants de divisions. */
export const divisionsOf = (record: CombatRecord, units: readonly number[]): number[] => units.map((u) => record.units[u]!.division);

/**
 * Élargit le front de `s` à `width` liaisons en ajoutant des copies de sa première connexion (le front du duel n'en a
 * qu'une). Pour les tests qui ont besoin d'une largeur précise sans bâtir de villes : les copies disparaîtraient au
 * prochain `updateFronts`, donc pas de prise de ville avec.
 */
export function widen(s: GameState, width: number): void {
  const f = front(s);
  const c = f.connections[0]!;
  while (f.connections.length < width) f.connections.push({ city1: c.city1, city2: c.city2, position: c.position });
}

/** Pertes d'un tir dans l'ordre où elles ont été prises : [identifiant de division, état perdu]. */
export function hitList(record: CombatRecord, cycle: number, shot: number): [number, number][] {
  return record.cycles[cycle]!.shots[shot]!.hits.map(([unit, lost]) => [record.units[unit]!.division, lost]);
}
