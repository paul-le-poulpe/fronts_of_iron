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
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 10,
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
    // Chars de l'usine mécanique, après la tankette (factories.ts). Les divisions
    // de chars reprennent ces descriptions et ces icônes (32 × 32 seulement).
    infantryTank: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 20,
      icon: "armament/icon-armament-infantry-tank-32.png",
      description: "Fortement blindé, avec un obusier monté dans le châssis. Ce char est conçu pour avancer avec l'infanterie, lui procurant protection et puissance de feu. En contrepartie, il n'avance pas plus vite qu'un fantassin à pied.",
    },
    cruiserTank: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 10,
      icon: "armament/icon-armament-cruiser-tank-32.png",
      description: "Conçu pour la vitesse, ce char permet des percées en profondeur. Cependant, des compromis ont été faits sur son armure, qui ne tiendra pas face à une force antichar bien équipée.",
    },
    mediumTank: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 20,
      icon: "armament/icon-armament-medium-tank-32.png",
      description: "Les évolutions en matière de motorisation ont permis de créer un char équilibré, avec une bonne vitesse de pointe et un puissant canon capable de s'opposer aux autres blindés.",
    },
    // Appui-feu sur châssis blindé et chenillé (usine d'équipement d'infanterie, débloqué par l'appui-feu à pied
    // associé, factories.ts). Valeurs de l'auteur
    // (1er novembre 2026), sauf les descriptions (provisoires).
    selfPropelledArtilleryGun: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 20,
      icon: "armament/icon-armament-armored-SPART-32.png",
      description: "Une pièce d'artillerie montée sur un châssis chenillé. Elle suit les blindés dans leur avancée au lieu de les attendre en position.",
    },
    armoredAntiTankGun: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 15,
      icon: "armament/icon-armament-armored-AT-32.png",
      description: "Un canon antichar monté sur un châssis blindé. Il accompagne l'infanterie et ses chars, et répond aux blindés adverses sans avoir à se mettre en position.",
    },
    selfPropelledAntiAirGun: {
      productionPerLine: 1, workersPerLine: 200, ironPerLine: 10,
      icon: "armament/icon-armament-SPAA-32.png",
      description: "Un canon anti-aérien sur chenilles, qui protège une colonne de blindés en marche. Peut occasionnellement être pointé vers le sol.",
    },
  },
} as const satisfies { maxStockTurns: number; decayRate: number; types: Record<string, ProductConfig> };

export type ArmamentId = keyof typeof ARMAMENT.types;
