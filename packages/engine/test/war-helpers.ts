// Outils des tests des fronts (05-Fronts §13.7) : une petite carte de terre sans relief où les
// villes sont posées à des distances exactes, des joueurs avec population et armement, des
// ordres envoyés par `applyTurn`.

import assert from "node:assert/strict";

import {
  applyTurn,
  assignTroops,
  CITY,
  createGame,
  FRONTS,
  type Front,
  type GameMap,
  type GameState,
  type Intent,
  UNIT_DATA,
  UNIT_IDS,
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

/** Joue jusqu'à ce que `s.tick` soit un multiple de `combatTurns` (juste après un round de combat). */
export function playToRound(s: GameState): void {
  do turn(s);
  while (s.tick % FRONTS.combatTurns !== 0);
}

export const found = (player: number, tile: number): Intent => ({ type: "found_city", player, tile });

/** Deux joueurs, une ville chacun, reliées par une route : un front entre eux. Joueur 1 à gauche. */
export function duel(map: GameMap = MAP): GameState {
  const s = createGame({ seed: 1, map, playerCount: 2 });
  turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
  assert.equal(s.fronts.length, 1);
  return s;
}

/** Le front n° `i` de l'état. */
export const front = (s: GameState, i = 0): Front => s.fronts[i]!;

/** Indice d'un type d'unité. */
export const U = Object.fromEntries(UNIT_IDS.map((id, i) => [id, i])) as Record<(typeof UNIT_IDS)[number], number>;

/** Donne au joueur une réserve d'armement de quoi former ces unités, et de la population. Ne forme rien. */
export function stock(s: GameState, player: number, units: Partial<Record<(typeof UNIT_IDS)[number], number>>, population = 5_000_000): void {
  const p = s.players[player - 1]!;
  p.population = population;
  for (const [id, n] of Object.entries(units)) {
    const u = UNIT_DATA[U[id as (typeof UNIT_IDS)[number]]]!;
    p.armamentReserve[u.equipment] = p.armamentReserve[u.equipment]! + n * u.equipmentCount;
  }
}

/**
 * Comme `stock`, puis forme tout de suite les unités (recrutement normal, sans attendre l'étape du tour : la
 * réserve inutilisée décline à chaque tour, ce qui fausserait les nombres) : elles partent vers les fronts et arrivent
 * `transferTurns` tours plus tard.
 */
export function arm(s: GameState, player: number, units: Partial<Record<(typeof UNIT_IDS)[number], number>>, population = 5_000_000): void {
  stock(s, player, units, population);
  const p = s.players[player - 1]!;
  assignTroops(s, p, population, false);
}

/** Une carte où une case sur dix porte du fer, pour les tests qui ont besoin d'une usine. */
export const IRON_MAP: GameMap = customMap(14 * R, 10 * R, () => "land", (x, y) => (x + y) % 10 === 0);
