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
    /**
     * Capacité d'extraction d'une case de fer, en fer par tour (00-Game §7). Valeur
     * d'essai : une case nourrit une ligne à 1 fer par tour (fusil, par exemple).
     */
    capacityPerTile: 1,
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

/** Rayon d'expansion, en cases. Pair : le rayon de contrôle en est la moitié. */
const EXPANSION_RADIUS = 50;

/**
 * Villes (Docs/Design/00-Game.md §3). Rayons en cases, distances à vol d'oiseau.
 * Valeurs d'essai, pas des valeurs fixées. Règle (00-Game §3.1) : le rayon de
 * contrôle est la moitié du rayon d'expansion.
 */
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

/**
 * Extraction (00-Game §7) : engins miniers. Les mineurs travaillent des cases de
 * gisement ; mécanisation en millièmes de case par mineur. Valeurs d'essai, pas
 * des valeurs fixées. Sans engin, un mineur exploite 0,1 case (10 mineurs par
 * case) ; à pleine mécanisation, 0,5 case.
 */
export const MINING: MechanizationConfig = {
  mechanizationBase: 100,
  mechanizationMax: 500,
  maxMachinesPer1000: 100,
  curveExponent: 2,
};

/** Réglages communs à un bien ou à un type d'armement (00-Game §8, §8.3). */
export interface ProductConfig {
  /** Quantité produite par tour par une ligne remplie. */
  readonly productionPerLine: number;
  /** Ouvriers employés par une ligne remplie : 200 pour commencer (4 × 50, décision de l'auteur, 24 octobre 2026), quel que soit le bien (00-Game §8, §13). */
  readonly workersPerLine: number;
  /** Fer consommé par tour par une ligne remplie : 1 par défaut ; tracteur 5, bateau de pêche 3, artillerie 10 (00-Game §8). */
  readonly ironPerLine: number;
}

/**
 * Biens : des machines, un flux consommé dans le tour suivant (00-Game §5, §12).
 * L'ordre des clés est l'ordre des cases de `Player.goods`. Valeurs d'essai :
 * 30 machines par tour et par ligne (à 1 000 fermiers, `FARMING.maxMachinesPer1000`
 * = 100 demande 100 tracteurs pour la pleine mécanisation).
 */
export const GOODS = {
  tractor: { productionPerLine: 30, workersPerLine: 200, ironPerLine: 5 },
  fishingBoat: { productionPerLine: 30, workersPerLine: 200, ironPerLine: 3 },
  miningMachine: { productionPerLine: 30, workersPerLine: 200, ironPerLine: 1 },
} as const satisfies Record<string, ProductConfig>;

/**
 * Armement (00-Game §8.3). La production ne s'arrête jamais ; l'excès au-dessus du
 * stock cible décline. `maxStockTurns` : 100 évoqué par l'auteur ; `decayRate` :
 * valeur d'essai.
 * L'ordre des clés de `types` est l'ordre des cases de `Player.armamentReserve`.
 * `productionPerLine` et `workersPerLine` : valeurs d'essai.
 */
export const ARMAMENT = {
  /** Stock cible : ce nombre de tours de production (même valeur pour tous les types). */
  maxStockTurns: 100,
  /** Part de l'excès au-dessus du stock cible supprimée par tour, sur l'échelle S = 10 000 (1 %). */
  decayRate: 100,
  types: {
    rifle: { productionPerLine: 10, workersPerLine: 200, ironPerLine: 1 },
    machineGun: { productionPerLine: 4, workersPerLine: 200, ironPerLine: 1 },
    artillery: { productionPerLine: 2, workersPerLine: 200, ironPerLine: 10 },
    antiAirGun: { productionPerLine: 1, workersPerLine: 200, ironPerLine: 1 },
    antiTankGun: { productionPerLine: 1, workersPerLine: 200, ironPerLine: 1 },
  },
} as const satisfies { maxStockTurns: number; decayRate: number; types: Record<string, ProductConfig> };

export type GoodId = keyof typeof GOODS;
export type ArmamentId = keyof typeof ARMAMENT.types;
/** Ce qu'une ligne produit : un bien ou un type d'armement. */
export type ProductId = GoodId | ArmamentId;

/** Usines (00-Game §8). `unlockTurns` et `maxTypesPerCity` : valeurs données par l'auteur. */
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
