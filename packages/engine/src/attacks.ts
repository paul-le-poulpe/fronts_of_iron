// Ordres d'attaque (Docs/Design/06-Combat-Simplifie.md §1) : l'attaque sur tout le front est un
// ordre ponctuel. Elle est résolue en entier dans le tour de l'ordre, après le rangement des lignes
// (combat.ts, `resolveFrontAttacks`). Seulement sur un front actif, et `FRONTS.attackCooldownTurns`
// tours après le combat précédent du camp.

import { currentTurn } from "./divisions.ts";
import { frontById, isActive, sideIndex } from "./fronts.ts";
import type { GameState } from "./state.ts";

/** `start_front_attack` : sans effet si le camp attend encore son délai, si une attaque est déjà ordonnée ce tour, ou si le front n'est pas actif. */
export function startFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  if (!Number.isInteger(frontId)) return false;
  const front = frontById(state, frontId as number);
  if (front === undefined || !isActive(state, front)) return false;
  const i = sideIndex(front, player);
  if (i < 0) return false;
  const side = front.sides[i]!;
  const now = currentTurn(state);
  if (side.attackAt !== 0 || now < side.attackReadyAt) return false;
  side.attackAt = now;
  return true;
}
