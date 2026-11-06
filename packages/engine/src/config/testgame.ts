// Partie de test (outil de développement, Docs/Design/01-Architecture.md §9 bis) : état de départ construit par
// `setupTestGame`. Ce ne sont pas des règles du jeu. Toutes les valeurs sont PROVISOIRES.

import type { DivisionId } from "./divisions.ts";

/** Divisions de chaque joueur PAR FRONT, dans l'ordre de placement : la même composition pour les deux joueurs. */
type Composition = readonly { readonly division: DivisionId; readonly count: number }[];

/** Scénarios de la partie de test (provisoire) : ce qui est placé sur les fronts au départ. La réserve nationale est la même partout. */
export const TEST_SCENARIOS = {
  /** Infanterie seule sur le front. */
  infantry: [{ division: "regulars", count: 10 }],
  /** Infanterie et appui-feu (antichar, artillerie, antiaérien), sans chars. */
  support: [
    { division: "regulars", count: 10 },
    { division: "antiTank", count: 2 },
    { division: "artillery", count: 2 },
    { division: "antiAir", count: 1 },
  ],
  /** Infanterie, chars et appui-feu. */
  full: [
    { division: "regulars", count: 10 },
    { division: "infantryTank", count: 4 },
    { division: "antiTank", count: 2 },
    { division: "artillery", count: 2 },
    { division: "antiAir", count: 1 },
  ],
} as const satisfies Record<string, Composition>;

export type TestScenarioId = keyof typeof TEST_SCENARIOS;

export const TEST_GAME = {
  /** Distance horizontale, en cases, entre les deux ancres de départ (provisoire). */
  startDistance: 100,
  /** Villes que chaque joueur a au moins, pour faire tourner une économie (provisoire). */
  minCities: 12,
  /** Connexions entre les deux joueurs à atteindre avant de s'arrêter (provisoire). */
  minConnections: 4,
  /** Villes par joueur au-delà desquelles la construction échoue : les territoires ne se touchent pas (provisoire). */
  maxCities: 80,
  /** Divisions de chaque type dans la réserve nationale de chaque joueur, au départ (provisoire). Élites : au plus ce que `ELITE_TROOPS_RATIO` permet. */
  reservePerType: 10,
} as const;
