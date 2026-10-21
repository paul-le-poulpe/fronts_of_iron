// Application d'un tour envoyé par le serveur.

import { applyIntent, type Intent } from "./intents.ts";
import type { GameState } from "./state.ts";

export interface Turn {
  /** Doit valoir state.tick + 1. */
  readonly turn: number;
  /** Appliqués dans l'ordre du tableau, qui est l'ordre fixé par le serveur. */
  readonly intents: readonly Intent[];
}

/**
 * Applique les ordres du tour dans l'ordre, ignore les ordres invalides, puis
 * passe `state.tick` au numéro du tour. Renvoie les cases dont le propriétaire
 * a été écrit pendant le tour, chacune une fois, dans l'ordre de leur première
 * modification.
 *
 * Lève une erreur, sans rien modifier, si le numéro n'est pas state.tick + 1 :
 * un tour sauté ou rejoué ferait diverger ce client des autres.
 */
export function applyTurn(state: GameState, turn: Turn): number[] {
  if (turn.turn !== state.tick + 1) {
    throw new Error(`tour ${turn.turn} reçu, tour ${state.tick + 1} attendu`);
  }
  const changed: number[] = [];
  const intents: readonly unknown[] = Array.isArray(turn.intents) ? turn.intents : [];
  for (const intent of intents) applyIntent(state, intent, changed);
  for (const t of changed) state.changedMark[t] = 0;
  state.tick = turn.turn;
  return changed;
}
