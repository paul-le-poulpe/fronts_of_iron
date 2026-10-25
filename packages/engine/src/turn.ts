// Application d'un tour envoyé par le serveur.

import { expireProposals } from "./diplomacy.ts";
import { stepEconomy } from "./economy.ts";
import { applyIntent, type Intent } from "./intents.ts";
import type { GameState } from "./state.ts";

export interface Turn {
  /** Doit valoir state.tick + 1. */
  readonly turn: number;
  /** Appliqués dans l'ordre du tableau, qui est l'ordre fixé par le serveur. */
  readonly intents: readonly Intent[];
}

/**
 * Applique les ordres du tour dans l'ordre, ignore les ordres invalides, calcule
 * l'étape de population et de nourriture de chaque joueur (economy.ts), puis
 * passe `state.tick` au numéro du tour. Renvoie les cases dont le propriétaire
 * a été écrit pendant le tour, chacune une fois, dans l'ordre de leur première
 * modification. Vide `state.events` au début, et le remplit des événements du tour
 * (diplomatie) ; les propositions arrivées à terme sont supprimées après les ordres.
 *
 * Lève une erreur, sans rien modifier, si le numéro n'est pas state.tick + 1 :
 * un tour sauté ou rejoué ferait diverger ce client des autres.
 */
export function applyTurn(state: GameState, turn: Turn): number[] {
  if (turn.turn !== state.tick + 1) {
    throw new Error(`tour ${turn.turn} reçu, tour ${state.tick + 1} attendu`);
  }
  state.events.length = 0;
  const changed: number[] = [];
  const intents: readonly unknown[] = Array.isArray(turn.intents) ? turn.intents : [];
  for (const intent of intents) applyIntent(state, intent, changed);
  expireProposals(state);
  // Population, nourriture, croissance : après tous les ordres du tour, pour chaque joueur dans l'ordre des identifiants.
  stepEconomy(state);
  for (const t of changed) state.changedMark[t] = 0;
  state.tick = turn.turn;
  return changed;
}
