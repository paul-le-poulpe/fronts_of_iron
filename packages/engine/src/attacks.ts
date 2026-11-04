// Ordres d'attaque (Docs/Design/06-Combat-Simplifie.md §1) : l'attaque sur tout le front
// est un ordre ponctuel. Le combat est résolu `FRONTS.attackDelayTurns` tours après
// l'ordre, en un seul tour (combat.ts). Seulement sur un front actif.

import { FRONTS } from "./config.ts";
import { currentTurn } from "./divisions.ts";
import { frontById, isActive, sideIndex } from "./fronts.ts";
import type { GameState } from "./state.ts";

function mine(state: GameState, player: number, frontId: unknown) {
  if (!Number.isInteger(frontId)) return undefined;
  const front = frontById(state, frontId as number);
  if (front === undefined || !isActive(state, front)) return undefined;
  const i = sideIndex(front, player);
  return i < 0 ? undefined : { front, i, side: front.sides[i]! };
}

/** `start_front_attack` : invalide (sans effet) si une attaque attend déjà son combat. */
export function startFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || m.side.attackAt !== 0) return false;
  m.side.attackAt = currentTurn(state) + FRONTS.attackDelayTurns;
  return true;
}

/** `stop_front_attack` : annule une attaque qui attend son combat. */
export function stopFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || m.side.attackAt === 0) return false;
  m.side.attackAt = 0;
  return true;
}
