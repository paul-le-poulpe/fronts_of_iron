// Villes (Docs/Design/00-Game.md §3). Rayons en cases, distances à vol d'oiseau.
// Valeurs d'essai, pas des valeurs fixées. Règle (00-Game §3.1) : le rayon de
// contrôle est la moitié du rayon d'expansion.

/** Rayon d'expansion, en cases. Pair : le rayon de contrôle en est la moitié. */
const EXPANSION_RADIUS = 50;

export const CITY = {
  /** Rayon d'expansion : le joueur peut fonder une ville dans ce rayon autour d'une de ses villes ; les routes terrestres relient les villes à cette portée. */
  expansionRadius: EXPANSION_RADIUS,
  /** Rayon de contrôle : zone maximale d'une ville. Moitié du rayon d'expansion. */
  controlRadius: Math.floor(EXPANSION_RADIUS / 2),
  /** Coût de base, en population, d'une ville autre que la première (gratuite). */
  foundingCostPopulation: 500,
  /** Chaque ville déjà possédée ajoute ce pourcentage du coût de base au coût de la suivante. */
  foundingCostIncreasePercent: 100,
} as const;
