// Les ordres (intents) et leur validation. Un ordre arrive du réseau : son
// contenu peut être n'importe quoi. Chaque champ est vérifié avant usage ; un
// ordre invalide est ignoré, donc ignoré par tous les clients de la même façon.
//
// Les règles viennent de Docs/Design/00-Game.md. Ordres pour l'instant : fonder
// une ville (§3.3) et régler la part fermiers / pêcheurs (§4, §9). Les autres
// actions du joueur n'ont pas encore de règle écrite et n'ont donc pas d'ordre.

import { foundCity } from "./cities.ts";
import { isPlayerId, type GameState } from "./state.ts";

/** Fonder une ville du joueur sur la case `tile` (00-Game §3.3). */
export interface FoundCityIntent {
  readonly type: "found_city";
  /** Écrit par le serveur : l'identifiant de la connexion qui a envoyé l'ordre. */
  readonly player: number;
  readonly tile: number;
}

/**
 * Régler la part de la population (hors usines) qui devient fermiers ; le reste
 * devient pêcheurs (00-Game §4, §9). Format provisoire : le format du réglage
 * n'est pas décidé (00-Game §13).
 */
export interface SetFarmShareIntent {
  readonly type: "set_farm_share";
  /** Écrit par le serveur. */
  readonly player: number;
  /** Entier 0 à 100 : pourcentage de fermiers. */
  readonly percent: number;
}

export type Intent = FoundCityIntent | SetFarmShareIntent;

/** Applique un ordre s'il est valide. Renvoie false, sans rien modifier, sinon. */
export function applyIntent(state: GameState, intent: unknown, changed: number[]): boolean {
  if (typeof intent !== "object" || intent === null) return false;
  const fields = intent as Record<string, unknown>;
  const player = fields["player"];
  if (!isPlayerId(state, player)) return false;
  switch (fields["type"]) {
    case "found_city":
      return applyFoundCity(state, player, fields["tile"], changed);
    case "set_farm_share":
      return applySetFarmShare(state, player, fields["percent"]);
    default:
      return false;
  }
}

function applyFoundCity(state: GameState, player: number, tile: unknown, changed: number[]): boolean {
  if (!Number.isInteger(tile)) return false;
  const t = tile as number;
  if (t < 0 || t >= state.owner.length) return false;
  return foundCity(state, player, t, changed);
}

function applySetFarmShare(state: GameState, player: number, percent: unknown): boolean {
  if (!Number.isInteger(percent)) return false;
  const p = percent as number;
  if (p < 0 || p > 100) return false;
  state.players[player - 1]!.farmPercent = p;
  return true;
}
