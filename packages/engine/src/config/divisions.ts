// Types de division et niches des fronts terrestres (Docs/Design/05-Fronts.md §3, 08-Population.md §5).
// Valeurs de l'auteur, validées le 31 octobre 2026 (05-Fronts §3.4).
//
// UNE DIVISION n'a pas d'équipement : une barre de vie (`Division.state`, 0 à `STATE_SCALE`). Chaque entrée de `DIVISIONS`
// est la seule définition de son unité :
// - `softAttack`, `hardAttack`, `airAttack` : attaques d'une division pleine, multipliées par son état (08 §5) ;
// - `production` : sa boîte d'activités, usine ou caserne. Le moteur en déduit la boîte (`src/activities.ts`).
//
// LARGEURS en liaisons (une liaison = une connexion d'un front).
// MULTIPLICATEURS : écrits en décimal, DEUX DÉCIMALES AU PLUS. Le moteur les
// convertit une fois en entiers à l'échelle 100 (`src/divisions.ts`).
// APPUI-FEU (antichar, antiaérien, artillerie) : reçoit des dégâts directs, selon sa
// largeur engagée (05-Fronts §6.3) ; `hitPoints`, `defenseHitPointsMultiplier` et
// `armorPercent` y sont lus comme pour les niches principales.
// DESCRIPTION absente : le client n'affiche rien.
// Le NOM affiché de chaque type est dans le client (`client/src/names.ts`).

import { UNLOCK } from "./activities.ts";

const U = UNLOCK.turns;

/** La boîte d'activités d'une unité (08 §2, §4, §9). Fer et ouvriers : valeurs d'essai, à fixer avec l'auteur. */
export interface DivisionProductionConfig {
  /** `barracks` : infanterie, ses bonshommes en sont les soldats et deviennent des blessés. `factory` : le reste. */
  readonly building: "factory" | "barracks";
  /** Activité parente : sa production servie en fer débloque celle-ci. `null` : pas de parent. */
  readonly parent: string | null;
  /** Coût de déblocage, en tours d'un ouvrier servi du parent ; 0 : débloquée dès le départ, le joueur l'ouvre d'un clic. */
  readonly unlockCost: number;
  /** `unlockCost` est une population totale, et non du temps : atteinte une fois, elle reste acquise (08 §9). Le parent est alors Inactifs. */
  readonly unlockByPopulation?: boolean;
  /** Ouvriers par division. */
  readonly workersPerUnit: number;
  /** Fer réservé par division. */
  readonly ironPerUnit: number;
}

export interface DivisionConfig {
  /** Attaques d'une division pleine. */
  readonly softAttack: number;
  readonly hardAttack: number;
  /** L'aérien n'existe pas encore : lue par rien. */
  readonly airAttack: number;
  readonly production: DivisionProductionConfig;
  /** Icône : chemin sous `client/public/icons/`. */
  readonly icon: string;
  readonly description?: string;
  /** Largeur tenue en première ligne, en liaisons. */
  readonly frontWidth: number;
  /** Largeur de percée, en liaisons (V2 ; sans effet en V1). */
  readonly breakthroughWidth: number;
  /** Tours de formation d'une division produite (100 = 10 s) ; absent : `DIVISION_TIMING.defaultProductionTurns` (08 §6). */
  readonly productionTurns?: number;
  /** Type limité par `ELITE_TROOPS_RATIO` : absent = non (08 §5). */
  readonly elite?: boolean;
  /** PV d'une division complète : perte = dégâts / PV (05-Fronts §6.2). */
  readonly hitPoints: number;
  /** Multiplie les PV quand la division défend. */
  readonly defenseHitPointsMultiplier: number;
  /** Multiplie les attaques de la division quand son camp attaque. */
  readonly attackMultiplier: number;
  /** V2 ; sans effet en V1. */
  readonly breakthroughMultiplier: number;
  /** V2 ; sans effet en V1. */
  readonly counterAttackMultiplier: number;
  /** 0 à 100 : part des dégâts antiblindés reçus, le reste en anti-infanterie (05-Fronts §6.2). */
  readonly armorPercent: number;
  readonly movement: "foot" | "motorized";
}

/** Délais des divisions (08 §6). Valeurs d'essai, à fixer. */
export const DIVISION_TIMING = {
  /** Tours de formation d'une division dont le type n'a pas de `productionTurns`. */
  defaultProductionTurns: 300,
  /** Tours avant qu'une division en trop disparaisse. */
  leaveTurns: 100,
} as const;

/** Soin des divisions (06-Combat-Simplifie §3.6, 08 §5). */
export const COMBAT = {
  /** Part de la barre de vie regagnée par seconde, hors combat, toutes les divisions en même temps (provisoire). */
  healPercentPerSecond: 2,
  /** Tours par seconde, pour convertir `healPercentPerSecond` en gain par tour. */
  turnsPerSecond: 10,
} as const;

/**
 * Elite Troops Ratio : la limite de la caserne d'élites est aussi plafonnée à
 * `floor(bonshommes de la caserne de réguliers / ratio)` (08 §5). 10 : une élite pour 10 bonshommes.
 */
export const ELITE_TROOPS_RATIO = 10;

export const DIVISIONS = {
  regulars: {
    softAttack: 1500, hardAttack: 100, airAttack: 0,
    production: { building: "barracks", parent: "militia", unlockCost: U, workersPerUnit: 1, ironPerUnit: 50 },
    icon: "armament/icon-inf-regulars.png",
    description: "La base de toutes vos armées. Elle aura besoin d'appui-feu pour être vraiment efficace : artillerie, canons antichars, etc.",
    frontWidth: 1,
    breakthroughWidth: 1,
    hitPoints: 60000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.5,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  tankette: {
    softAttack: 2500, hardAttack: 500, airAttack: 0,
    production: { building: "factory", parent: "tractor", unlockCost: U, workersPerUnit: 1, ironPerUnit: 200 },
    icon: "armament/armament-tankette.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    hitPoints: 20000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "foot",
  },
  antiTank: {
    softAttack: 0, hardAttack: 5000, airAttack: 0,
    production: { building: "factory", parent: "artillery", unlockCost: U, workersPerUnit: 1, ironPerUnit: 80 },
    icon: "armament/armament-AT-gun.png",
    frontWidth: 3,
    breakthroughWidth: 5,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  antiAir: {
    softAttack: 500, hardAttack: 0, airAttack: 5000,
    production: { building: "factory", parent: "regulars", unlockCost: U, workersPerUnit: 1, ironPerUnit: 80 },
    icon: "armament/armament-AA-gun.png",
    frontWidth: 3,
    breakthroughWidth: 5,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  artillery: {
    softAttack: 2500, hardAttack: 250, airAttack: 0,
    production: { building: "factory", parent: "regulars", unlockCost: U / 2, workersPerUnit: 1, ironPerUnit: 100 },
    icon: "armament/armament-artillery.png",
    frontWidth: 3,
    breakthroughWidth: 5,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 0,
    movement: "foot",
  },
  militia: {
    softAttack: 800, hardAttack: 20, airAttack: 0,
    production: { building: "barracks", parent: "idle", unlockCost: 10, unlockByPopulation: true, workersPerUnit: 1, ironPerUnit: 0 },
    icon: "armament/icon-inf-milicia.png",
    description: "Des hommes avec quelques fusils. Mieux que rien.",
    frontWidth: 1,
    breakthroughWidth: 1,
    productionTurns: 1,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.3,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  elite: {
    softAttack: 2000, hardAttack: 200, airAttack: 0,
    production: { building: "barracks", parent: "regulars", unlockCost: U, workersPerUnit: 1, ironPerUnit: 100 },
    icon: "armament/icon-inf-elite.png",
    description: `La crème de la crème. Limités à ${Math.floor((200 + ELITE_TROOPS_RATIO) / (2 * ELITE_TROOPS_RATIO))} % des bonshommes de votre caserne de réguliers.`,
    frontWidth: 1,
    breakthroughWidth: 1,
    productionTurns: 600,
    elite: true,
    hitPoints: 80000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.8,
    breakthroughMultiplier: 0.6,
    counterAttackMultiplier: 0.8,
    armorPercent: 0,
    movement: "foot",
  },
  // Chars (valeurs de l'auteur, 1er novembre 2026) : 10 hommes par char, comme la tankette.
  // Description absente : celle de l'armement.
  infantryTank: {
    softAttack: 4000, hardAttack: 1500, airAttack: 0,
    production: { building: "factory", parent: "tankette", unlockCost: U, workersPerUnit: 2, ironPerUnit: 400 },
    icon: "armament/icon-armament-infantry-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    hitPoints: 100000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 0.8,
    counterAttackMultiplier: 0.8,
    armorPercent: 100,
    movement: "foot",
  },
  cruiserTank: {
    softAttack: 3000, hardAttack: 1000, airAttack: 0,
    production: { building: "factory", parent: "tankette", unlockCost: U, workersPerUnit: 2, ironPerUnit: 300 },
    icon: "armament/icon-armament-cruiser-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    hitPoints: 40000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "motorized",
  },
  mediumTank: {
    softAttack: 3000, hardAttack: 1750, airAttack: 0,
    production: { building: "factory", parent: "cruiserTank", unlockCost: U, workersPerUnit: 2, ironPerUnit: 400 },
    icon: "armament/icon-armament-medium-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    hitPoints: 80000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1.2,
    counterAttackMultiplier: 1.2,
    armorPercent: 100,
    movement: "motorized",
  },
  // Appui-feu sur châssis blindé et chenillé (valeurs de l'auteur, 1er novembre 2026) : mêmes effectifs que les
  // variantes à pied. Largeur en première ligne 5, largeur de percée 1. Description absente : celle de l'armement.
  selfPropelledArtillery: {
    softAttack: 3000, hardAttack: 0, airAttack: 0,
    production: { building: "factory", parent: "artillery", unlockCost: U, workersPerUnit: 2, ironPerUnit: 200 },
    icon: "armament/icon-armament-armored-SPART-32.png",
    frontWidth: 3,
    breakthroughWidth: 1,
    hitPoints: 40000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1.2,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "motorized",
  },
  armoredAntiTank: {
    softAttack: 0, hardAttack: 10000, airAttack: 0,
    production: { building: "factory", parent: "antiTank", unlockCost: U, workersPerUnit: 2, ironPerUnit: 200 },
    icon: "armament/icon-armament-armored-AT-32.png",
    frontWidth: 3,
    breakthroughWidth: 1,
    hitPoints: 80000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 0.8,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1.2,
    armorPercent: 100,
    movement: "motorized",
  },
  selfPropelledAntiAir: {
    softAttack: 1000, hardAttack: 0, airAttack: 10000,
    production: { building: "factory", parent: "antiAir", unlockCost: U, workersPerUnit: 2, ironPerUnit: 150 },
    icon: "armament/icon-armament-SPAA-32.png",
    frontWidth: 3,
    breakthroughWidth: 1,
    hitPoints: 40000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 0.8,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "motorized",
  },
} as const satisfies Record<string, DivisionConfig>;

export type DivisionId = keyof typeof DIVISIONS;

/**
 * Niches (05-Fronts §3.1), dans l'ordre d'affichage et de rangement : d'abord les
 * niches principales (elles tiennent le front et reçoivent les dégâts), puis
 * l'appui-feu. Chaque niche range ses types du meilleur au moins bon ; un type
 * est dans une seule niche.
 */
export const NICHES = {
  infantry: { support: false, types: ["elite", "regulars", "militia"] },
  tanks: { support: false, types: ["infantryTank", "mediumTank", "cruiserTank", "tankette"] },
  antiTank: { support: true, types: ["armoredAntiTank", "antiTank"] },
  antiAir: { support: true, types: ["selfPropelledAntiAir", "antiAir"] },
  artillery: { support: true, types: ["selfPropelledArtillery", "artillery"] },
} as const satisfies Record<string, { readonly support: boolean; readonly types: readonly DivisionId[] }>;

export type NicheId = keyof typeof NICHES;
