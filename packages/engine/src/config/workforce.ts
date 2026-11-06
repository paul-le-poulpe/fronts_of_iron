// Population en bonshommes, nourriture, agriculture, pêche, extraction (Docs/Design/08-Population.md §1 à §8).
// Valeurs d'essai, pas des valeurs fixées, sauf mention contraire.

export const POPULATION = {
  /** Bonshommes donnés au joueur par la fondation de sa première ville (08 §10). */
  initial: 1,
  /** Habitants de l'ancienne échelle qu'un bonhomme représente : sert à convertir le coût d'une ville (08 §10). */
  inhabitantsPerPawn: 1000,
  /** Nourriture consommée par un bonhomme : capacité = ceil(nourriture / foodPerPawn) (08 §3). */
  foodPerPawn: 1000,
  /** Tours avant qu'un bonhomme apparaisse dans Inactifs, quand la capacité dépasse la population (08 §6). À fixer. */
  arrivalTurns: 50,
  /** Tours avant qu'un bonhomme en trop disparaisse (08 §6). À fixer. */
  leaveTurns: 100,
  /** `hurtHealTurnsTimesPop` : tours de soin d'un blessé = min(hurtHealMaxTurns, floor(hurtHealTurnsTimesPop / population)) (08 §8). */
  hurtHealTurnsTimesPop: 100_000,
  /** Durée maximale de soin d'un blessé, en tours (08 §8). */
  hurtHealMaxTurns: 4000,
} as const;

/** Délais des machines (tracteurs, bateaux de pêche, pompes), beaucoup plus courts que ceux des divisions (08 §6). À fixer. */
export const GOODS_TIMING = {
  /** Tours avant qu'une machine apparaisse dans sa ligne d'Inactifs. */
  arrivalTurns: 10,
  /** Tours avant qu'une machine en trop disparaisse. */
  leaveTurns: 20,
} as const;

/** Nourriture (08 §3). */
export const FOOD = {
  /** Production de base d'un joueur, quelles que soient ses villes : 1 000, valeur de l'auteur. */
  base: 1000,
  /** Production de chaque ville : 500, valeur de l'auteur. Une seule ville donne donc 1 500 au total. */
  perCity: 500,
} as const;

/** Fertilité sur la carte (00-Game §2), de 0 à 10. */
export const FERTILITY = {
  /** Fertilité d'une case de terre qui n'est pas une montagne. Montagne et eau : 0. */
  land: 5,
} as const;

/** Agriculture (08 §2.1, §3) : cases cultivées par travailleur (bonhomme ou tracteur). */
export const FARMING = {
  /** 0,3 case par personne de l'ancienne échelle. */
  tilesPerWorker: 300,
} as const;

/** Pêche (08 §2.1, §3) : cases pêchées par travailleur (bonhomme ou bateau). */
export const FISHING = {
  tilesPerWorker: 300,
  /** Nourriture d'un travailleur plein : 1 000, soit +1 de capacité (auteur). */
  foodPerWorker: 1000,
} as const;

/** Extraction (08 §2.1, §4) : cases de fer exploitées par travailleur (bonhomme ou pompe à vapeur). */
export const MINING = {
  /** 0,1 case par personne de l'ancienne échelle. */
  tilesPerWorker: 100,
} as const;
