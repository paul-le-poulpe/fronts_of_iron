// Usines (00-Game §8) : réglages des lignes et arbres de production.

import type { ArmamentId } from "./armament.ts";
import type { GoodId } from "./goods.ts";

/** Ce qu'une ligne produit : un bien ou un type d'armement. */
export type ProductId = GoodId | ArmamentId;

/** `unlockTurns` et `maxTypesPerCity` : valeurs données par l'auteur. */
export const FACTORY = {
  /**
   * Tours-lignes de production du parent avant de pouvoir créer une ligne de l'enfant
   * (00-Game §8.2) : chaque tour ajoute le nombre de lignes du parent remplies. Une ligne :
   * `unlockTurns` tours ; vingt lignes : vingt fois moins.
   */
  unlockTurns: 500,
  /**
   * Tours-lignes où toutes les lignes d'un groupe de biens produisent, avant qu'il
   * gagne une ligne automatiquement (00-Game §8.2) : chaque tour ajoute le nombre de
   * lignes du groupe. Valeur d'essai, pas une valeur fixée.
   */
  growthTurns: 500,
  /**
   * Spécialisation (00-Game §8.1), décision de l'auteur du 24 octobre 2026 : les
   * ouvriers d'une ligne baissent avec son rang dans le groupe (même bien, même
   * usine). `decayPercent` : baisse de la 2e ligne par rapport à la 1re, en % du
   * coût initial ; `floorPercent` : coût minimal d'une ligne, en % du coût initial.
   * `decayPercent + floorPercent` doit rester sous 100.
   */
  specialization: { decayPercent: 5, floorPercent: 10 },
  /** Types d'usines différents par ville (00-Game §8). */
  maxTypesPerCity: 1,
} as const;

/** Un nœud de l'arbre de production d'un type d'usine : le parent doit fonctionner pour débloquer le bien. */
export interface FactoryNode {
  readonly good: ProductId;
  readonly parent: ProductId | null;
}

export interface FactoryTypeConfig {
  /** Racine en premier, chaque parent avant ses enfants. L'indice d'un nœud est sa case dans `Factory.progress`. */
  readonly tree: readonly FactoryNode[];
}

/** Types d'usine de base et leur arbre (00-Game §8.4). */
export const FACTORY_TYPES = {
  infantryArmament: {
    tree: [
      { good: "rifle", parent: null },
      { good: "machineGun", parent: "rifle" },
      { good: "antiAirGun", parent: "machineGun" },
      { good: "artillery", parent: "rifle" },
      { good: "antiTankGun", parent: "artillery" },
    ],
  },
  fishingBoats: { tree: [{ good: "fishingBoat", parent: null }] },
  miningMachines: {
    tree: [
      { good: "miningMachine", parent: null },
      { good: "tractor", parent: "miningMachine" },
    ],
  },
} as const satisfies Record<string, FactoryTypeConfig>;

export type FactoryTypeId = keyof typeof FACTORY_TYPES;
