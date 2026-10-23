// Tous les nombres réglables du moteur. Aucun autre fichier de src/ ne contient
// de constante de réglage. Voir Docs/Design/02-Engine.md.

/** `owner` est un Uint16Array et 0 veut dire « personne » : 65 535 joueurs au plus. */
export const MAX_PLAYERS = 0xffff;

/** Carte de test générée par `generateTestMap`. */
export const TEST_MAP = {
  width: 800,
  height: 500,
  /**
   * Bruit de valeur : une grille de valeurs aléatoires tous les `cell` pixels,
   * interpolée entre les nœuds. Les octaves sont additionnées avec leur poids.
   */
  octaves: [
    { cell: 128, weight: 16 },
    { cell: 64, weight: 8 },
    { cell: 32, weight: 4 },
    { cell: 16, weight: 2 },
    { cell: 8, weight: 1 },
  ],
  /** Demi-axes de l'ellipse du continent, en pourcentage de la demi-largeur et de la demi-hauteur. */
  continentRadiusPercent: 84,
  /** Ajouté à l'élévation au centre de l'ellipse (élévation du bruit : 0 à 65 535). */
  centerBoost: 26000,
  /** Retiré à l'élévation sur le bord de l'ellipse ; croît comme le carré de la distance au centre. */
  edgeDrop: 40000,
  /** Élévation au-dessus de laquelle une case est de la terre. */
  seaLevel: 32768,
  /** Altitude (0 à 31) = (élévation − seaLevel) >> altitudeShift, plafonnée à 31. */
  altitudeShift: 11,
  /**
   * Altitude à partir de laquelle une case de terre est une montagne : fertilité 0
   * (00-Game §2) et seuil du fer modifié (RESOURCES.iron.presence). Une seule
   * définition de « montagne » pour toute la carte.
   */
  mountainAltitude: 14,
} as const;

export type TestMapConfig = typeof TEST_MAP;

/**
 * Ressources naturelles (Docs/Design/00-Game.md §2). Présence sur une case :
 * un bruit de valeur (0 à 65 535) au-dessus d'un seuil qui baisse avec
 * l'altitude. Valeurs d'essai pour la visualisation (`npm run viz:iron`), pas
 * des valeurs fixées.
 */
export const RESOURCES = {
  iron: {
    presence: {
      /** Mélangé à la graine de la carte : le bruit du fer est indépendant de celui du relief. */
      salt: 0x1f0e,
      /** Octaves du bruit, comme TEST_MAP.octaves ; des cellules petites donnent des gisements en taches. */
      octaves: [
        { cell: 24, weight: 2 },
        { cell: 8, weight: 1 },
      ],
      /** Seuil du bruit à l'altitude 0. */
      threshold: 50000,
      /** Baisse du seuil par niveau d'altitude (0 à 31). */
      perAltitude: 300,
      /** Altitude à partir de laquelle une case est une montagne : la même valeur que pour la fertilité (TEST_MAP). */
      mountainAltitude: TEST_MAP.mountainAltitude,
      /** Baisse supplémentaire du seuil sur une montagne. */
      mountainBonus: 5000,
    },
  },
} as const;

export interface ResourcePresenceConfig {
  readonly salt: number;
  readonly octaves: readonly { readonly cell: number; readonly weight: number }[];
  readonly threshold: number;
  readonly perAltitude: number;
  readonly mountainAltitude: number;
  readonly mountainBonus: number;
}

/**
 * Zones maritimes (Docs/Design/00-Game.md §2.1). `maxLandPercent`, `iterations`
 * et `finalIterations` viennent de l'auteur ; `spacing` et `minBasinArea` sont
 * des valeurs d'essai pour la visualisation, pas des valeurs fixées.
 */
export const SEA_ZONES = {
  /** Écart entre les points de la grille de départ, en cases ; taille visée d'une zone = spacing². */
  spacing: 40,
  /** Un point de la grille dont le carré a plus de ce pourcentage de terre est supprimé. */
  maxLandPercent: 80,
  /** Itérations zones → barycentre avant la correction. */
  iterations: 50,
  /** Bassin (eau reliée) de moins de cette surface, en cases : aucune zone. */
  minBasinArea: 200,
  /** Itérations zones → barycentre après la correction. */
  finalIterations: 50,
} as const;

export interface SeaZonesConfig {
  readonly spacing: number;
  readonly maxLandPercent: number;
  readonly iterations: number;
  readonly minBasinArea: number;
  readonly finalIterations: number;
}

/** `tileCity` est un Uint16Array et 0 veut dire « aucune ville » : 65 535 villes au plus. */
export const MAX_CITIES = 0xffff;

/**
 * Villes (Docs/Design/00-Game.md §3). Rayons en cases, distances à vol d'oiseau.
 * Valeurs d'essai, pas des valeurs fixées. Contrainte des règles :
 * `expansionRadius` > `controlRadius`.
 */
export const CITY = {
  /** Rayon d'expansion : le joueur peut fonder une ville dans ce rayon autour d'une de ses villes ; les routes terrestres relient les villes à cette portée. */
  expansionRadius: 25,
  /** Rayon de contrôle : zone maximale d'une ville. */
  controlRadius: 10,
  /** Population retirée au joueur pour fonder une ville, sauf la première (gratuite). */
  foundingCostPopulation: 100,
} as const;

/**
 * Population (Docs/Design/00-Game.md §4, §4.1). Valeurs d'essai, pas des valeurs
 * fixées.
 */
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

/** Fertilité sur la carte (00-Game §2), de 0 à 10. Valeur d'essai, pas une valeur fixée. */
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

/** Agriculture (00-Game §6.2) : tracteurs. Valeurs d'essai, pas des valeurs fixées. */
export const FARMING: MechanizationConfig = {
  mechanizationBase: 300,
  mechanizationMax: 1500,
  maxMachinesPer1000: 100,
  curveExponent: 2,
};

/**
 * Pêche (00-Game §6.4) : bateaux de pêche. Les bateaux réduisent les pêcheurs
 * requis (mécanisation) et augmentent le rendement d'une case d'eau, avec la
 * même courbe f(x). Valeurs d'essai, sauf le rapport 3 pour 5 de `tileYield`
 * (donné par l'auteur) et le doublement de `tileYieldMax` (ordre de grandeur
 * donné par l'auteur).
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
