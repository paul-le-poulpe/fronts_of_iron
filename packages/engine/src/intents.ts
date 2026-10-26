// Les ordres (intents) et leur validation. Un ordre arrive du réseau : son
// contenu peut être n'importe quoi. Chaque champ est vérifié avant usage ; un
// ordre invalide est ignoré, donc ignoré par tous les clients de la même façon.
//
// Les règles viennent de Docs/Design/00-Game.md. Ordres pour l'instant : fonder
// une ville (§3.3), régler la part fermiers / pêcheurs (§4, §9), et les ordres des
// usines (§8, §9) : construire une usine, créer une ligne, régler les lignes
// actives, changer les priorités, et les ordres de diplomatie (§1, §9) : déclarer
// la guerre, proposer un pacte, rompre un pacte, proposer la paix, répondre à une
// proposition. Les autres actions du joueur n'ont pas encore de règle écrite et
// n'ont donc pas d'ordre.

import type { FactoryTypeId, ProductId } from "./config.ts";
import { foundCity } from "./cities.ts";
import { STATUS_NEUTRAL, STATUS_WAR, answerProposal, breakPact, declareWar, propose, statusOf } from "./diplomacy.ts";
import {
  endWar,
  setBreakthroughMotorizedOnly,
  setForcedMobilization,
  setFrontPriority,
  setFrontReassign,
  setUnitLineMode,
  startWar,
} from "./fronts.ts";
import { cancelBreakthrough, startBreakthrough, startFrontAttack, stopFrontAttack } from "./attacks.ts";
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

/** Déclarer la guerre à un joueur avec qui le statut est neutre (00-Game §1). */
export interface DeclareWarIntent {
  readonly type: "declare_war";
  /** Écrit par le serveur. */
  readonly player: number;
  /** Identifiant du joueur visé : un autre joueur. */
  readonly target: number;
}

/** Proposer un pacte de non-agression à un joueur avec qui le statut est neutre (00-Game §1). */
export interface ProposePactIntent {
  readonly type: "propose_pact";
  readonly player: number;
  readonly target: number;
}

/** Rompre le pacte de non-agression avec un joueur : le statut redevient neutre (00-Game §1). */
export interface BreakPactIntent {
  readonly type: "break_pact";
  readonly player: number;
  readonly target: number;
}

/** Proposer la paix à un joueur avec qui on est en guerre (00-Game §1). */
export interface ProposePeaceIntent {
  readonly type: "propose_peace";
  readonly player: number;
  readonly target: number;
}

/** Répondre à la proposition en attente que `from` a envoyée à `player` (00-Game §1). */
export interface AnswerProposalIntent {
  readonly type: "answer_proposal";
  readonly player: number;
  /** Identifiant de l'auteur de la proposition. */
  readonly from: number;
  readonly accept: boolean;
}

/** Priorité d'un front (05-Fronts §4.3, §5) : `priority` est un indice dans `FRONTS.priorityPercent`. */
export interface SetFrontPriorityIntent {
  readonly type: "set_front_priority";
  readonly player: number;
  readonly front: number;
  readonly priority: number;
}

/** « Autoriser la réassignation à d'autres fronts » (05-Fronts §4.4). */
export interface SetFrontReassignIntent {
  readonly type: "set_front_reassign";
  readonly player: number;
  readonly front: number;
  readonly enabled: boolean;
}

/** Interrupteur à trois positions d'un type d'unité sur un front (05-Fronts §4.2) : `first`, `balanced` ou `second`. */
export interface SetUnitLineModeIntent {
  readonly type: "set_unit_line_mode";
  readonly player: number;
  readonly front: number;
  readonly unit: string;
  readonly mode: "first" | "balanced" | "second";
}

/** Interrupteur « Motorisé seulement » des percées d'un front (05-Fronts §7.2). */
export interface SetBreakthroughMotorizedOnlyIntent {
  readonly type: "set_breakthrough_motorized_only";
  readonly player: number;
  readonly front: number;
  readonly enabled: boolean;
}

/** Mobilisation forcée du joueur (05-Fronts §4.1). */
export interface SetForcedMobilizationIntent {
  readonly type: "set_forced_mobilization";
  readonly player: number;
  readonly enabled: boolean;
}

/** Lancer ou arrêter l'attaque sur tout le front (05-Fronts §5). */
export interface FrontAttackIntent {
  readonly type: "start_front_attack" | "stop_front_attack";
  readonly player: number;
  readonly front: number;
}

/** Lancer une percée sur la connexion (`city1`, `city2`) d'un front actif (05-Fronts §5, §7.2). */
export interface StartBreakthroughIntent {
  readonly type: "start_breakthrough";
  readonly player: number;
  readonly front: number;
  readonly city1: number;
  readonly city2: number;
}

/** Annuler une percée du joueur (05-Fronts §5). */
export interface CancelBreakthroughIntent {
  readonly type: "cancel_breakthrough";
  readonly player: number;
  readonly id: number;
}

export type Intent =
  | SetFrontPriorityIntent
  | SetFrontReassignIntent
  | SetUnitLineModeIntent
  | SetBreakthroughMotorizedOnlyIntent
  | SetForcedMobilizationIntent
  | FrontAttackIntent
  | StartBreakthroughIntent
  | CancelBreakthroughIntent
  | FoundCityIntent
  | SetFarmShareIntent
  | BuildFactoryIntent
  | CreateLineIntent
  | SetActiveLinesIntent
  | SetCityPriorityIntent
  | SetLinePriorityIntent
  | DeclareWarIntent
  | ProposePactIntent
  | BreakPactIntent
  | ProposePeaceIntent
  | AnswerProposalIntent;

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
    case "declare_war": {
      const ok = declareWar(state, player, fields["target"]);
      if (ok) startWar(state, player, fields["target"] as number);
      return ok;
    }
    case "propose_pact":
      return propose(state, player, fields["target"], "pact");
    case "break_pact":
      return breakPact(state, player, fields["target"]);
    case "propose_peace":
      return propose(state, player, fields["target"], "peace");
    case "answer_proposal": {
      // Une paix acceptée met fin à la guerre : positions, attaques et percées supprimées (05-Fronts §2.3).
      const from = fields["from"];
      const wasWar = isPlayerId(state, from) && from !== player && statusOf(state, player, from) === STATUS_WAR;
      const ok = answerProposal(state, player, from, fields["accept"]);
      if (ok && wasWar && statusOf(state, player, from as number) === STATUS_NEUTRAL) endWar(state, player, from as number);
      return ok;
    }
    case "set_front_priority":
      return setFrontPriority(state, player, fields["front"], fields["priority"]);
    case "set_front_reassign":
      return setFrontReassign(state, player, fields["front"], fields["enabled"]);
    case "set_unit_line_mode":
      return setUnitLineMode(state, player, fields["front"], fields["unit"], fields["mode"]);
    case "set_breakthrough_motorized_only":
      return setBreakthroughMotorizedOnly(state, player, fields["front"], fields["enabled"]);
    case "set_forced_mobilization":
      return setForcedMobilization(state, player, fields["enabled"]);
    case "start_front_attack":
      return startFrontAttack(state, player, fields["front"]);
    case "stop_front_attack":
      return stopFrontAttack(state, player, fields["front"]);
    case "start_breakthrough":
      return startBreakthrough(state, player, fields["front"], fields["city1"], fields["city2"]);
    case "cancel_breakthrough":
      return cancelBreakthrough(state, player, fields["id"]);
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
