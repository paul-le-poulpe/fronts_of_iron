// Diplomatie entre joueurs (Docs/Design/00-Game.md §1, §9) : le statut de chaque
// paire de joueurs, les propositions en attente, et les cinq ordres qui les
// changent. Le statut est un seul nombre par paire, le même vu des deux côtés :
// neutre (au départ), pacte de non-agression, guerre.
//
// Les fronts lisent le statut (Docs/Design/05-Fronts.md §2.3) : un front est actif entre
// deux joueurs en guerre. `intents.ts` appelle `startWar` et `endWar` (fronts.ts)
// après `declareWar` et après une paix acceptée ; ce fichier n'importe pas fronts.ts
// (fronts.ts lit `statusOf` : l'inverse ferait un cycle). Le statut est dans l'état
// et dans le hash, pour que tous les clients le calculent de la même façon.
//
// Les événements (`state.events`) disent à l'affichage ce qui s'est passé pendant
// le tour. Aucune règle ne les lit, et ils ne sont pas dans le hash (02-Engine §4, §6).

import { DIPLOMACY } from "./config.ts";
import { isPlayerId, type GameState } from "./state.ts";

export const STATUS_NEUTRAL = 0;
export const STATUS_PACT = 1;
export const STATUS_WAR = 2;
/** Valeur d'une case de `GameState.diplomacy`. */
export type DiplomaticStatus = typeof STATUS_NEUTRAL | typeof STATUS_PACT | typeof STATUS_WAR;

/** Ce qu'une proposition demande : un pacte de non-agression (depuis neutre) ou la paix (depuis guerre). */
export type ProposalKind = "pact" | "peace";

/** Proposition en attente de réponse de `to`. */
export interface Proposal {
  readonly from: number;
  readonly to: number;
  readonly kind: ProposalKind;
  /** Numéro du tour où l'ordre a été appliqué. */
  readonly createdTick: number;
}

/**
 * Ce qui s'est passé pendant le tour. `from` est le joueur qui a agi ou envoyé
 * la proposition, `to` l'autre joueur. Pour `proposal_accepted`, `proposal_refused`
 * et `proposal_expired`, `from` est l'auteur de la proposition et `to` celui qui
 * devait répondre. `turn` est le numéro du tour.
 */
export type DiplomacyEvent =
  | {
      readonly type: "proposal_sent" | "proposal_accepted" | "proposal_refused" | "proposal_expired";
      readonly from: number;
      readonly to: number;
      readonly kind: ProposalKind;
      readonly turn: number;
    }
  | {
      readonly type: "war_declared" | "pact_broken";
      readonly from: number;
      readonly to: number;
      readonly turn: number;
    }
  | {
      /** Une ville change de main à la suite d'un combat (05-Fronts §10). `from` l'a prise à `to`. */
      readonly type: "city_captured";
      readonly from: number;
      readonly to: number;
      readonly city: number;
      readonly turn: number;
    };

/** Case de `GameState.diplomacy` pour la paire (a, b). a et b valides. */
const cell = (state: GameState, a: number, b: number): number => (a - 1) * state.players.length + (b - 1);

/** Statut de la paire (a, b), identique pour (b, a). a et b sont des identifiants de joueurs. */
export function statusOf(state: GameState, a: number, b: number): DiplomaticStatus {
  return state.diplomacy[cell(state, a, b)] as DiplomaticStatus;
}

/** Écrit le statut des deux côtés, supprime les propositions de la paire (un changement de statut les annule). */
function setStatus(state: GameState, a: number, b: number, status: DiplomaticStatus): void {
  state.diplomacy[cell(state, a, b)] = status;
  state.diplomacy[cell(state, b, a)] = status;
  state.proposals = state.proposals.filter((p) => !isPair(p, a, b));
}

const isPair = (p: Proposal, a: number, b: number): boolean => (p.from === a && p.to === b) || (p.from === b && p.to === a);

/** Proposition en attente entre a et b, dans un sens ou dans l'autre. */
export function pendingProposal(state: GameState, a: number, b: number): Proposal | undefined {
  return state.proposals.find((p) => isPair(p, a, b));
}

/** Un seul numéro de tour pour tous les événements du tour : `state.tick` n'est avancé qu'à la fin d'`applyTurn`. */
const currentTurn = (state: GameState): number => state.tick + 1;

/** `target` est un autre joueur que `player`. */
const isOther = (state: GameState, player: number, target: unknown): target is number => isPlayerId(state, target) && target !== player;

/** Déclarer la guerre : valide depuis neutre seulement. Supprime la proposition en attente de la paire. */
export function declareWar(state: GameState, player: number, target: unknown): boolean {
  if (!isOther(state, player, target) || statusOf(state, player, target) !== STATUS_NEUTRAL) return false;
  setStatus(state, player, target, STATUS_WAR);
  state.events.push({ type: "war_declared", from: player, to: target, turn: currentTurn(state) });
  return true;
}

/** Rompre un pacte : valide depuis pacte seulement. Le statut redevient neutre. */
export function breakPact(state: GameState, player: number, target: unknown): boolean {
  if (!isOther(state, player, target) || statusOf(state, player, target) !== STATUS_PACT) return false;
  setStatus(state, player, target, STATUS_NEUTRAL);
  state.events.push({ type: "pact_broken", from: player, to: target, turn: currentTurn(state) });
  return true;
}

/** Proposer un pacte (depuis neutre) ou la paix (depuis guerre) : invalide si une proposition est déjà en attente pour la paire. */
export function propose(state: GameState, player: number, target: unknown, kind: ProposalKind): boolean {
  if (!isOther(state, player, target)) return false;
  if (statusOf(state, player, target) !== (kind === "pact" ? STATUS_NEUTRAL : STATUS_WAR)) return false;
  if (pendingProposal(state, player, target) !== undefined) return false;
  const turn = currentTurn(state);
  state.proposals.push({ from: player, to: target, kind, createdTick: turn });
  state.events.push({ type: "proposal_sent", from: player, to: target, kind, turn });
  return true;
}

/**
 * Répondre à la proposition de `from` : seule sa cible peut le faire. Accepter
 * demande que le statut soit encore celui que la proposition change (neutre pour un
 * pacte, guerre pour la paix). Dans les deux cas la proposition disparaît.
 */
export function answerProposal(state: GameState, player: number, from: unknown, accept: unknown): boolean {
  if (!isOther(state, player, from) || typeof accept !== "boolean") return false;
  const proposal = state.proposals.find((p) => p.from === from && p.to === player);
  if (proposal === undefined) return false;
  const turn = currentTurn(state);
  if (!accept) {
    state.proposals = state.proposals.filter((p) => p !== proposal);
    state.events.push({ type: "proposal_refused", from: proposal.from, to: player, kind: proposal.kind, turn });
    return true;
  }
  const required = proposal.kind === "pact" ? STATUS_NEUTRAL : STATUS_WAR;
  if (statusOf(state, player, proposal.from) !== required) return false;
  setStatus(state, player, proposal.from, proposal.kind === "pact" ? STATUS_PACT : STATUS_NEUTRAL);
  state.events.push({ type: "proposal_accepted", from: proposal.from, to: player, kind: proposal.kind, turn });
  return true;
}

/**
 * Supprime les propositions qui ont atteint `DIPLOMACY.proposalTurns` tours, dans
 * l'ordre de leur création, et ajoute un événement `proposal_expired` pour chacune.
 * Appelée par `applyTurn` après tous les ordres : une réponse du dernier tour est
 * donc prise en compte avant l'expiration.
 */
export function expireProposals(state: GameState): void {
  const turn = currentTurn(state);
  const kept = [];
  for (const p of state.proposals) {
    if (turn - p.createdTick >= DIPLOMACY.proposalTurns) {
      state.events.push({ type: "proposal_expired", from: p.from, to: p.to, kind: p.kind, turn });
    } else {
      kept.push(p);
    }
  }
  state.proposals = kept;
}
