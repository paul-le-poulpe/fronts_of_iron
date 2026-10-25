// Biens (00-Game §5, §8, §12) : des machines, un flux consommé dans le tour
// suivant. L'ordre des clés de GOODS est l'ordre des cases de `Player.goods`.

/** Réglages communs à un bien ou à un type d'armement (00-Game §8, §8.3). */
export interface ProductConfig {
  /** Quantité produite par tour par une ligne remplie. */
  readonly productionPerLine: number;
  /** Ouvriers employés par une ligne remplie : 200 pour commencer (4 × 50, décision de l'auteur, 24 octobre 2026), quel que soit le bien (00-Game §8, §13). */
  readonly workersPerLine: number;
  /** Fer consommé par tour par une ligne remplie : 1 par défaut ; tracteur 5, bateau de pêche 3, artillerie 10 (00-Game §8). */
  readonly ironPerLine: number;
  /** Icône : chemin sous `client/public/icons/`, par exemple `goods/goods-tractor-outline.png`. Absent : la page affiche un symbole texte. Sans effet sur la simulation. */
  readonly icon?: string;
}

/**
 * Valeurs d'essai : 30 machines par tour et par ligne (à 1 000 fermiers,
 * `FARMING.maxMachinesPer1000` = 100 demande 100 tracteurs pour la pleine
 * mécanisation).
 */
export const GOODS = {
  tractor: {
    productionPerLine: 30, workersPerLine: 200, ironPerLine: 5,
    icon: "goods/goods-tractor-outline.png",
  },
  fishingBoat: {
    productionPerLine: 30, workersPerLine: 200, ironPerLine: 3,
    icon: "goods/goods-fishing-boat.png",
  },
  miningMachine: {
    productionPerLine: 30, workersPerLine: 200, ironPerLine: 1,
    icon: "goods/goods-mining-pump.png",
  },
} as const satisfies Record<string, ProductConfig>;

export type GoodId = keyof typeof GOODS;
