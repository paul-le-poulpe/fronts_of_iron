// Les ordres (intents) et leur validation. Un ordre arrive du réseau : son
// contenu peut être n'importe quoi. Chaque champ est vérifié avant usage ; un
// ordre invalide est ignoré, donc ignoré par tous les clients de la même façon.
//
// Les règles viennent de Docs/Design/00-Game.md et 08-Population.md. Ordres : fonder une ville (00-Game §3.3, 08 §10),
// déplacer des bonshommes ou des machines entre les activités, réordonner les activités, retirer une place vide de
// caserne (08 §10), les ordres de diplomatie (00-Game §1, §9) : déclarer la guerre, proposer un pacte, rompre un
// pacte, proposer la paix, répondre à une proposition, et les ordres des fronts (05-Fronts §5.2) : déplacer une
// division, attaque sur tout le front, percée. Les divisions ne se créent ni ne se suppriment par ordre : elles
// suivent les limites des usines et des casernes (08 §6). Les autres actions du joueur n'ont pas encore de règle écrite
// et n'ont donc pas d'ordre.

import type { ActivityId, GoodId } from "./config.ts";
import { foundCity } from "./cities.ts";
import { STATUS_NEUTRAL, STATUS_WAR, answerProposal, breakPact, declareWar, propose, statusOf } from "./diplomacy.ts";
import { endWar, startWar } from "./fronts.ts";
import { startFrontAttack } from "./attacks.ts";
import { cancelBreakthrough, startBreakthrough } from "./breakthroughs.ts";
import { moveDivisions } from "./placement.ts";
import { changeProductionTarget, closeActivity, movePawn, openActivityOrder, setActivityOrder, setAutoAssign, setDisabledSlots } from "./activities.ts";
import { isPlayerId, type GameState } from "./state.ts";

/** Fonder une ville du joueur sur la case `tile` (00-Game §3.3). */
export interface FoundCityIntent {
  readonly type: "found_city";
  /** Écrit par le serveur : l'identifiant de la connexion qui a envoyé l'ordre. */
  readonly player: number;
  readonly tile: number;
}

/**
 * Déplacer `count` bonshommes (`kind: "worker"`) ou machines de `good` (`kind: "machine"`) de l'activité `from` à l'activité
 * `to` (08 §10).
 */
export interface MovePawnIntent {
  readonly type: "move_pawn";
  /** Écrit par le serveur. */
  readonly player: number;
  readonly from: ActivityId;
  readonly to: ActivityId;
  readonly kind: "worker" | "machine";
  /** Pour une machine. */
  readonly good?: GoodId;
  /** Entier ≥ 1. */
  readonly count: number;
}

/** Réordonner les activités (08 §2) : l'activité prend la position `position` (1 à nombre d'activités ouvertes − 1 ; Inactifs reste en haut). */
export interface SetActivityOrderIntent {
  readonly type: "set_activity_order";
  readonly player: number;
  readonly activity: ActivityId;
  readonly position: number;
}

/** Allumer ou éteindre l'auto-assignation (08 §7 bis). */
export interface SetAutoAssignIntent {
  readonly type: "set_auto_assign";
  readonly player: number;
  readonly enabled: boolean;
}

/** Fixer le nombre de postes vacants désactivés d'une activité, comptés depuis la droite (08 §7 bis). */
export interface SetDisabledSlotsIntent {
  readonly type: "set_disabled_slots";
  readonly player: number;
  readonly activity: ActivityId;
  readonly count: number;
}

/** Changer la production visée d'une caserne ou d'une usine de divisions (08 §7 ter). */
export interface ChangeProductionTargetIntent {
  readonly type: "change_production_target";
  readonly player: number;
  readonly activity: ActivityId;
  /** Entier non nul : unités à ajouter ou à retirer. */
  readonly delta: number;
}

/** Ouvrir une boîte débloquée ou supprimée, ou supprimer une usine ou une caserne (08 §9). */
export interface ActivityOpenIntent {
  readonly type: "open_activity" | "close_activity";
  readonly player: number;
  readonly activity: ActivityId;
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

/**
 * Déplacer des divisions (05-Fronts §4.4, §4.6, §5.2) : `front` 0 pour la réserve
 * nationale ; `line` absente : seconde ligne ; `box` avec `line: "box"` : une boîte
 * de percée existante, ou 0 / absente pour en créer une.
 */
export interface MoveDivisionIntent {
  readonly type: "move_division";
  readonly player: number;
  readonly ids: readonly number[];
  readonly front: number;
  readonly line?: "first" | "second" | "rapid" | "box";
  readonly box?: number;
}

/** Lancer une percée avec une boîte, sur l'axe (`city1`, `city2`) de son front (05-Fronts §7.2). */
export interface StartBreakthroughIntent {
  readonly type: "start_breakthrough";
  readonly player: number;
  readonly box: number;
  readonly city1: number;
  readonly city2: number;
}

/** Annuler une percée du joueur (05-Fronts §7.2, provisoire). */
export interface CancelBreakthroughIntent {
  readonly type: "cancel_breakthrough";
  readonly player: number;
  readonly id: number;
}

/** Lancer l'attaque sur tout le front, résolue dans le tour (05-Fronts §5, 06-Combat-Simplifie §1). */
export interface FrontAttackIntent {
  readonly type: "start_front_attack";
  readonly player: number;
  readonly front: number;
}

export type Intent =
  | MoveDivisionIntent
  | StartBreakthroughIntent
  | CancelBreakthroughIntent
  | FrontAttackIntent
  | FoundCityIntent
  | MovePawnIntent
  | SetActivityOrderIntent
  | SetAutoAssignIntent
  | SetDisabledSlotsIntent
  | ChangeProductionTargetIntent
  | ActivityOpenIntent
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
  // Un joueur éliminé ne donne plus d'ordre (05-Fronts §10.3) : sans cela, il refonderait une première ville gratuite.
  if (state.players[player - 1]!.defeated) return false;
  switch (fields["type"]) {
    case "found_city":
      // Économie gelée : pas de fondation de ville (01-Architecture §9 bis).
      if (state.economyFrozen) return false;
      return applyFoundCity(state, player, fields["tile"], changed);
    case "move_pawn":
      return movePawn(state, player, fields["from"], fields["to"], fields["kind"], fields["good"], fields["count"]);
    case "set_activity_order":
      return setActivityOrder(state, player, fields["activity"], fields["position"]);
    case "set_auto_assign":
      return setAutoAssign(state, player, fields["enabled"]);
    case "set_disabled_slots":
      return setDisabledSlots(state, player, fields["activity"], fields["count"]);
    case "open_activity":
      return openActivityOrder(state, player, fields["activity"]);
    case "close_activity":
      return closeActivity(state, player, fields["activity"]);
    case "change_production_target":
      return changeProductionTarget(state, player, fields["activity"], fields["delta"]);
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
      // Une paix acceptée met fin à la guerre : positions et attaques supprimées (05-Fronts §2.3).
      const from = fields["from"];
      const wasWar = isPlayerId(state, from) && from !== player && statusOf(state, player, from) === STATUS_WAR;
      const ok = answerProposal(state, player, from, fields["accept"]);
      if (ok && wasWar && statusOf(state, player, from as number) === STATUS_NEUTRAL) endWar(state, player, from as number);
      return ok;
    }
    case "move_division":
      return moveDivisions(state, player, fields["ids"], fields["front"], fields["line"], fields["box"]);
    case "start_breakthrough":
      return startBreakthrough(state, player, fields["box"], fields["city1"], fields["city2"]);
    case "cancel_breakthrough":
      return cancelBreakthrough(state, player, fields["id"]);
    case "start_front_attack":
      return startFrontAttack(state, player, fields["front"]);
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
