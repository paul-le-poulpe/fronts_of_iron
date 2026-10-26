// Application d'un tour envoyé par le serveur.

import { expireProposals } from "./diplomacy.ts";
import { combatRound } from "./combat.ts";
import { FRONTS } from "./config.ts";
import { stepEconomy } from "./economy.ts";
import { applyIntent, type Intent } from "./intents.ts";
import type { GameState } from "./state.ts";
import { applyTransfers, recruitAfterEconomy, recruitBeforeEconomy } from "./troops.ts";

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
  // Ordre du tour (05-Fronts §13.2) : ordres, mobilisation forcée, économie (population, nourriture,
  // croissance, pour chaque joueur dans l'ordre des identifiants), recrutement parmi les inactifs,
  // mouvements arrivés, round de combat et prises de villes.
  recruitBeforeEconomy(state);
  stepEconomy(state);
  recruitAfterEconomy(state);
  applyTransfers(state);
  if (turn.turn % FRONTS.combatTurns === 0) combatRound(state, changed);
  for (const t of changed) state.changedMark[t] = 0;
  state.tick = turn.turn;
  return changed;
}
