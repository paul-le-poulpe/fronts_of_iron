// Population, nourriture, et les activités qui emploient la population :
// agriculture, pêche, extraction (Docs/Design/00-Game.md §4 à §7). Valeurs
// d'essai, pas des valeurs fixées, sauf mention contraire.

export const POPULATION = {
  /** Population donnée au joueur par la fondation de sa première ville. */
  initial: 1000,
  /** `consommation_par_tête` : nourriture consommée par personne et par tour. */
  foodPerHead: 1,
  /** `taux_de_croissance`, en millionièmes : personnes gagnées par tour = nourriture restante × growthPerMillion / 1 000 000. */
  growthPerMillion: 5000,
} as const;

/** Nourriture (00-Game §6.5). */
export const FOOD = {
  /** Nourriture minimale par tour d'un joueur, même sans fermier ni terre. 1 500 : valeur donnée par l'auteur. */
  minimum: 1500,
} as const;

/** Fertilité sur la carte (00-Game §2), de 0 à 10. */
export const FERTILITY = {
  /** Fertilité d'une case de terre qui n'est pas une montagne. Montagne et eau : 0. */
  land: 5,
} as const;

/**
 * Réglages d'une activité mécanisée (00-Game §6.2, §6.3). Mécanisation en
 * millièmes de case par travailleur ; machines par millier de travailleurs.
 */
export interface MechanizationConfig {
  /** `M_base` : millièmes de case par travailleur sans machine (≥ 1). */
  readonly mechanizationBase: number;
  /** `M_max` : millièmes de case par travailleur à pleine mécanisation (≥ M_base). */
  readonly mechanizationMax: number;
  /** `m_max` : machines pour 1 000 travailleurs au-delà desquelles la mécanisation n'augmente plus (≥ 1). */
  readonly maxMachinesPer1000: number;
  /** `n` de la courbe f(x) = 1 − (1 − x)ⁿ, entier ≥ 1. */
  readonly curveExponent: number;
}

/** Agriculture (00-Game §6.2) : tracteurs. */
export const FARMING: MechanizationConfig = {
  mechanizationBase: 300,
  mechanizationMax: 1500,
  maxMachinesPer1000: 100,
  curveExponent: 2,
};

/**
 * Pêche (00-Game §6.4) : bateaux de pêche. Les bateaux réduisent les pêcheurs
 * requis (mécanisation) et augmentent le rendement d'une case d'eau, avec la
 * même courbe f(x). Le rapport 3 pour 5 de `tileYield` et le doublement de
 * `tileYieldMax` sont des ordres de grandeur donnés par l'auteur.
 */
export const FISHING: MechanizationConfig & { readonly tileYield: number; readonly tileYieldMax: number } = {
  mechanizationBase: 300,
  mechanizationMax: 1500,
  maxMachinesPer1000: 100,
  curveExponent: 2,
  /** Rendement d'une case d'eau sans bateau (fertilité d'une terre : FERTILITY.land). */
  tileYield: 3,
  /** Rendement d'une case d'eau avec le maximum de bateaux (≥ tileYield). */
  tileYieldMax: 6,
};

/**
 * Extraction (00-Game §7) : pompes à vapeur. Les mineurs travaillent des cases de
 * gisement ; mécanisation en millièmes de case par mineur. Sans pompe, un mineur
 * exploite 0,1 case (10 mineurs par case) ; à pleine mécanisation, 0,5 case.
 */
export const MINING: MechanizationConfig = {
  mechanizationBase: 100,
  mechanizationMax: 500,
  maxMachinesPer1000: 100,
  curveExponent: 2,
};
