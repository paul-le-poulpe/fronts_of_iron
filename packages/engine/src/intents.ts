// Les ordres (intents) et leur validation. Un ordre arrive du réseau : son
// contenu peut être n'importe quoi. Chaque champ est vérifié avant usage ; un
// ordre invalide est ignoré, donc ignoré par tous les clients de la même façon.
//
// Les règles du jeu ne sont pas encore définies. Le seul ordre ici,
// `demo_claim`, est un exemple jetable qui sert à faire tourner et tester la
// chaîne tour → validation → cases modifiées → hash. Le remplacer quand les
// vraies règles existeront (Docs/Design/02-Engine.md).

import { forEachNeighbor, TERRAIN_LAND } from "./map.ts";
import { isPlayerId, setOwner, type GameState } from "./state.ts";

/**
 * DÉMONSTRATION, pas une règle du jeu. Le joueur prend la case `tile` si elle
 * est de la terre sans propriétaire et, quand il possède déjà au moins une
 * case, si un de ses 4 voisins lui appartient.
 */
export interface DemoClaimIntent {
  readonly type: "demo_claim";
  /** Écrit par le serveur : l'identifiant de la connexion qui a envoyé l'ordre. */
  readonly player: number;
  readonly tile: number;
}

export type Intent = DemoClaimIntent;

/** Applique un ordre s'il est valide. Renvoie false, sans rien modifier, sinon. */
export function applyIntent(state: GameState, intent: unknown, changed: number[]): boolean {
  if (typeof intent !== "object" || intent === null) return false;
  const fields = intent as Record<string, unknown>;
  const player = fields["player"];
  if (!isPlayerId(state, player)) return false;
  switch (fields["type"]) {
    case "demo_claim":
      return applyDemoClaim(state, player, fields["tile"], changed);
    default:
      return false;
  }
}

function applyDemoClaim(state: GameState, player: number, tile: unknown, changed: number[]): boolean {
  if (!Number.isInteger(tile)) return false;
  const t = tile as number;
  if (t < 0 || t >= state.owner.length) return false;
  if ((state.map.terrain[t]! & TERRAIN_LAND) === 0) return false;
  if (state.owner[t] !== 0) return false;
  if (state.players[player - 1]!.tileCount > 0) {
    let touches = false;
    forEachNeighbor(state.map, t, (n) => {
      if (state.owner[n] === player) touches = true;
    });
    if (!touches) return false;
  }
  setOwner(state, t, player, changed);
  return true;
}
