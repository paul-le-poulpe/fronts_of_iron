// Les ordres (intents) et leur validation. Un ordre arrive du réseau : son
// contenu peut être n'importe quoi. Chaque champ est vérifié avant usage ; un
// ordre invalide est ignoré, donc ignoré par tous les clients de la même façon.
//
// Les règles viennent de Docs/Design/00-Game.md. Ordres pour l'instant : fonder
// une ville (§3.3), régler la part fermiers / pêcheurs (§4, §9), et les ordres des
// usines (§8, §9) : construire une usine, créer une ligne, régler les lignes
// actives, changer les priorités. Les autres actions du joueur n'ont pas encore
// de règle écrite et n'ont donc pas d'ordre.

import type { FactoryTypeId, ProductId } from "./config.ts";
import { foundCity } from "./cities.ts";
import {
  buildFactory,
  createLine,
  isFactoryTypeId,
  isProductId,
  setActiveLines,
  setCityPriority,
  setLinePriority,
} from "./factories.ts";
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

/** Construire l'usine d'un type dans une ville du joueur (00-Game §8, §9). */
export interface BuildFactoryIntent {
  readonly type: "build_factory";
  /** Écrit par le serveur. */
  readonly player: number;
  /** Identifiant de la ville. */
  readonly city: number;
  readonly factoryType: FactoryTypeId;
}

/** Créer une ligne d'un bien dans l'usine d'une ville (00-Game §8.2, §9). */
export interface CreateLineIntent {
  readonly type: "create_line";
  readonly player: number;
  readonly city: number;
  readonly good: ProductId;
}

/** Régler le nombre de lignes actives d'un bien dans l'usine d'une ville (00-Game §8.1, §9). */
export interface SetActiveLinesIntent {
  readonly type: "set_active_lines";
  readonly player: number;
  readonly city: number;
  readonly good: ProductId;
  /** Entier de 0 au nombre de lignes de ce bien. */
  readonly count: number;
}

/** Changer la priorité d'une ville avec son usine : `position` 0 = remplie en premier (00-Game §8.1). */
export interface SetCityPriorityIntent {
  readonly type: "set_city_priority";
  readonly player: number;
  readonly city: number;
  readonly position: number;
}

/** Changer la priorité d'un groupe de lignes au sein de l'usine de sa ville (00-Game §8.1). */
export interface SetLinePriorityIntent {
  readonly type: "set_line_priority";
  readonly player: number;
  readonly city: number;
  readonly good: ProductId;
  readonly position: number;
}

export type Intent =
  | FoundCityIntent
  | SetFarmShareIntent
  | BuildFactoryIntent
  | CreateLineIntent
  | SetActiveLinesIntent
  | SetCityPriorityIntent
  | SetLinePriorityIntent;

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
    case "build_factory": {
      const { city, factoryType } = fields;
      return Number.isInteger(city) && isFactoryTypeId(factoryType) && buildFactory(state, player, city as number, factoryType);
    }
    case "create_line": {
      const { city, good } = fields;
      return Number.isInteger(city) && isProductId(good) && createLine(state, player, city as number, good);
    }
    case "set_active_lines": {
      const { city, good, count } = fields;
      return (
        Number.isInteger(city) && isProductId(good) && Number.isInteger(count) &&
        setActiveLines(state, player, city as number, good, count as number)
      );
    }
    case "set_city_priority": {
      const { city, position } = fields;
      return Number.isInteger(city) && Number.isInteger(position) && setCityPriority(state, player, city as number, position as number);
    }
    case "set_line_priority": {
      const { city, good, position } = fields;
      return (
        Number.isInteger(city) && isProductId(good) && Number.isInteger(position) &&
        setLinePriority(state, player, city as number, good, position as number)
      );
    }
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
