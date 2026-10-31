// Ordres d'attaque (Docs/Design/05-Fronts.md §5) : attaque sur tout le front,
// interrupteur de chaque camp. Seulement sur un front actif. Le combat lui-même
// est dans combat.ts ; la percée attend la version 2.

import { frontById, isActive, sideIndex } from "./fronts.ts";
import type { GameState } from "./state.ts";

function mine(state: GameState, player: number, frontId: unknown) {
  if (!Number.isInteger(frontId)) return undefined;
  const front = frontById(state, frontId as number);
  if (front === undefined || !isActive(state, front)) return undefined;
  const i = sideIndex(front, player);
  return i < 0 ? undefined : { front, i, side: front.sides[i]! };
}

/** `start_front_attack` : invalide (sans effet) si l'attaque est déjà en cours. */
export function startFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || m.side.frontAttack) return false;
  m.side.frontAttack = true;
  return true;
}

export function stopFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || !m.side.frontAttack) return false;
  m.side.frontAttack = false;
  return true;
}
