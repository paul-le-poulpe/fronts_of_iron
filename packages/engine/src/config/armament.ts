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
    rifle: {
      productionPerLine: 10, workersPerLine: 200, ironPerLine: 1,
      icon: "armament/armament-gun.png",
      description: "Le strict minimum pour envoyer un soldat sur le front. N'espérez pas qu'ils accomplissent grand-chose armés uniquement de ceci.",
    },
    machineGun: {
      productionPerLine: 4, workersPerLine: 200, ironPerLine: 1,
      icon: "armament/armament-machine-gun.png",
      description: "Indispensable pour vous défendre contre l'infanterie. Moins utile en attaque.",
    },
    artillery: {
      productionPerLine: 2, workersPerLine: 200, ironPerLine: 10,
      icon: "armament/armament-artillery.png",
      description: "Indispensable pour causer du tort à l'échelle industrielle.",
    },
    antiAirGun: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 1,
      icon: "armament/armament-AA-gun.png",
      description: "Utile si vous n'avez pas le contrôle du ciel. Peut occasionnellement être pointé vers le sol.",
    },
    antiTankGun: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 1,
      icon: "armament/armament-AT-gun.png",
      description: "La réponse de base aux blindés adverses.",
    },
    // Produite par l'usine mécanique, débloquée par le tracteur (factories.ts).
    // Mêmes valeurs que la ligne de tracteurs, sauf la production (auteur).
    tankette: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 5,
      icon: "armament/armament-tankette.png",
      description: "Aucune chance face à un char d'assaut. Mais redoutable contre l'infanterie s'il n'y a pas de réponse appropriée.",
    },
  },
} as const satisfies { maxStockTurns: number; decayRate: number; types: Record<string, ProductConfig> };

export type ArmamentId = keyof typeof ARMAMENT.types;
