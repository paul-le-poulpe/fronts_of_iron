// Diplomatie (Docs/Design/00-Game.md §1, §10). Une seule valeur pour l'instant.

export const DIPLOMACY = {
  /**
   * Durée de vie d'une proposition (pacte de non-agression, paix), en tours :
   * sans réponse après ce nombre de tours, elle expire et le statut ne change pas.
   * Valeur provisoire, à fixer par l'auteur. 300 tours = 30 s à 100 ms par tour.
   */
  proposalTurns: 300,
} as const;
