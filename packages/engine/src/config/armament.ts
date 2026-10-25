// Armement (00-Game §8.3). La production ne s'arrête jamais ; l'excès au-dessus
// du stock cible décline. `maxStockTurns` : 100 évoqué par l'auteur ; `decayRate`,
// `productionPerLine` et `workersPerLine` : valeurs d'essai.
// L'ordre des clés de `types` est l'ordre des cases de `Player.armamentReserve`.

import type { ProductConfig } from "./goods.ts";

export const ARMAMENT = {
  /** Stock cible : ce nombre de tours de production (même valeur pour tous les types). */
  maxStockTurns: 100,
  /** Part de l'excès au-dessus du stock cible supprimée par tour, sur l'échelle S = 10 000 (1 %). */
  decayRate: 100,
  types: {
    //             productionPerLine  workersPerLine  ironPerLine
    rifle:       { productionPerLine: 10, workersPerLine: 200, ironPerLine: 1 },
    machineGun:  { productionPerLine: 4, workersPerLine: 200, ironPerLine: 1 },
    artillery:   { productionPerLine: 2, workersPerLine: 200, ironPerLine: 10 },
    antiAirGun:  { productionPerLine: 1, workersPerLine: 200, ironPerLine: 1 },
    antiTankGun: { productionPerLine: 1, workersPerLine: 200, ironPerLine: 1 },
  },
} as const satisfies { maxStockTurns: number; decayRate: number; types: Record<string, ProductConfig> };

export type ArmamentId = keyof typeof ARMAMENT.types;
