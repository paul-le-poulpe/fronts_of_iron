// Types de division et niches des fronts terrestres (Docs/Design/05-Fronts.md §3).
// Valeurs de l'auteur, validées le 31 octobre 2026 (05-Fronts §3.4).
//
// UNE DIVISION est un stock d'hommes et d'armement, créé par le joueur. Son type
// est une liste de COMPOSANTS : les hommes (`"men"`), ou un type d'armement de
// `armament.ts`, chacun en `count` exemplaires dans une division complète.
// - `required` : le taux de soldats de la division est le plus petit taux de ses
//   composants requis ; aucun composant ne dépasse ce taux (l'excédent retourne
//   au stock national, 05-Fronts §3.2).
// - `weight` : poids dans l'état de la division (05-Fronts §3.3). La somme des
//   poids n'a pas à valoir 100.
// - `softAttack`, `hardAttack`, `airAttack` : apport du composant complet aux
//   attaques de la division ; à moitié présent, la moitié.
// - `lossMultiplier` : part des pertes de la division que subit ce composant
//   (05-Fronts §6.2) ; absent = 1.
//
// LARGEURS en liaisons (une liaison = une connexion d'un front).
// MULTIPLICATEURS : écrits en décimal, DEUX DÉCIMALES AU PLUS. Le moteur les
// convertit une fois en entiers à l'échelle 100 (`src/divisions.ts`).
// APPUI-FEU (antichar, antiaérien, artillerie) : reçoit des dégâts directs, selon sa
// largeur engagée (05-Fronts §6.3) ; `hitPoints`, `defenseHitPointsMultiplier` et
// `armorPercent` y sont lus comme pour les niches principales.
// DESCRIPTION absente : celle de l'armement du premier composant d'armement.
// Le NOM affiché de chaque type est dans le client (`client/src/names.ts`).

import type { ArmamentId } from "./armament.ts";

export interface DivisionComponentConfig {
  /** Les hommes (population), ou un type d'armement. */
  readonly resource: "men" | ArmamentId;
  /** Exemplaires dans une division complète. */
  readonly count: number;
  readonly required: boolean;
  readonly weight: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  /** L'aérien n'existe pas encore : lue par rien. */
  readonly airAttack: number;
  /** Décimal, deux décimales au plus. Absent : 1. */
  readonly lossMultiplier?: number;
}

export interface DivisionConfig {
  readonly components: readonly DivisionComponentConfig[];
  /** Icône : chemin sous `client/public/icons/`. */
  readonly icon: string;
  readonly description?: string;
  /** Largeur tenue en première ligne, en liaisons. */
  readonly frontWidth: number;
  /** Largeur de percée, en liaisons (V2 ; sans effet en V1). */
  readonly breakthroughWidth: number;
  /** Durée de formation d'une division créée, en tours (100 = 10 s) ; 0 : aucune formation (05-Fronts §3.5). */
  readonly formationTurns: number;
  /** Type limité par `ELITE_TROOPS_RATIO` : absent = non (05-Fronts §3.5). */
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

const men = (count: number, weight: number, lossMultiplier?: number): DivisionComponentConfig => ({
  resource: "men",
  count,
  required: true,
  weight,
  softAttack: 0,
  hardAttack: 0,
  airAttack: 0,
  ...(lossMultiplier === undefined ? {} : { lossMultiplier }),
});

/**
 * Elite Troops Ratio : une division d'élite ne peut être créée que si le nombre
 * de divisions d'infanterie après sa création (élites comprises) est au moins ce
 * multiple du nombre d'élites après sa création, soit `ratio × (élites + 1) ≤
 * infanterie + 1`. 10 : les élites sont au plus 10 % de l'infanterie. Ne vérifié
 * qu'à la création (05-Fronts §3.5).
 */
export const ELITE_TROOPS_RATIO = 10;

export const DIVISIONS = {
  regulars: {
    components: [
      men(1000, 2),
      { resource: "rifle", count: 1000, required: true, weight: 2, softAttack: 1000, hardAttack: 100, airAttack: 0 },
      // Servies par les 1 000 hommes de la division, sans homme de plus.
      { resource: "machineGun", count: 100, required: false, weight: 1, softAttack: 500, hardAttack: 0, airAttack: 0 },
    ],
    icon: "armament/icon-inf-regulars.png",
    description: "La base de toutes vos armées. Elle devra recevoir de l'équipement supplémentaire pour être vraiment efficace : canons, mitrailleuses, etc.",
    frontWidth: 1,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.5,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  tankette: {
    // 10 hommes par char : 5 à bord, 5 à l'entretien.
    components: [
      men(500, 1, 0.5),
      { resource: "tankette", count: 50, required: true, weight: 1, softAttack: 2500, hardAttack: 500, airAttack: 0 },
    ],
    icon: "armament/armament-tankette.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "foot",
  },
  antiTank: {
    components: [
      men(500, 1),
      { resource: "antiTankGun", count: 100, required: true, weight: 1, softAttack: 0, hardAttack: 5000, airAttack: 0 },
    ],
    icon: "armament/armament-AT-gun.png",
    frontWidth: 5,
    breakthroughWidth: 5,
    formationTurns: 100,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  antiAir: {
    components: [
      men(500, 1),
      { resource: "antiAirGun", count: 100, required: true, weight: 1, softAttack: 1000, hardAttack: 0, airAttack: 5000 },
    ],
    icon: "armament/armament-AA-gun.png",
    frontWidth: 5,
    breakthroughWidth: 5,
    formationTurns: 100,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  artillery: {
    components: [
      men(500, 1),
      { resource: "artillery", count: 50, required: true, weight: 1, softAttack: 2500, hardAttack: 250, airAttack: 0 },
    ],
    icon: "armament/armament-artillery.png",
    frontWidth: 5,
    breakthroughWidth: 5,
    formationTurns: 100,
    hitPoints: 50000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 0,
    movement: "foot",
  },
  militia: {
    // Moitié moins de fusils, pas de mitrailleuse.
    components: [
      men(1000, 2),
      { resource: "rifle", count: 500, required: true, weight: 2, softAttack: 600, hardAttack: 20, airAttack: 0 },
    ],
    icon: "armament/icon-inf-milicia.png",
    description: "Des hommes avec quelques fusils. Mieux que rien.",
    frontWidth: 1,
    breakthroughWidth: 1,
    formationTurns: 0,
    hitPoints: 40000,
    defenseHitPointsMultiplier: 2,
    attackMultiplier: 0.3,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  elite: {
    components: [
      men(1000, 2),
      { resource: "rifle", count: 1500, required: true, weight: 2, softAttack: 1000, hardAttack: 200, airAttack: 0 },
      // Servies par les 1 000 hommes de la division, sans homme de plus.
      { resource: "machineGun", count: 300, required: false, weight: 1, softAttack: 1000, hardAttack: 0, airAttack: 0 },
    ],
    icon: "armament/icon-inf-elite.png",
    description: `La crème de la crème. Limités à ${Math.floor((200 + ELITE_TROOPS_RATIO) / (2 * ELITE_TROOPS_RATIO))} % de votre infanterie totale.`,
    frontWidth: 1,
    breakthroughWidth: 1,
    formationTurns: 200,
    elite: true,
    hitPoints: 70000,
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
    components: [
      men(400, 1, 0.5),
      { resource: "infantryTank", count: 40, required: true, weight: 1, softAttack: 4000, hardAttack: 1500, airAttack: 0 },
    ],
    icon: "armament/icon-armament-infantry-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 250000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 0.8,
    counterAttackMultiplier: 0.8,
    armorPercent: 100,
    movement: "foot",
  },
  cruiserTank: {
    components: [
      men(500, 1, 0.5),
      { resource: "cruiserTank", count: 50, required: true, weight: 1, softAttack: 3000, hardAttack: 1000, airAttack: 0 },
    ],
    icon: "armament/icon-armament-cruiser-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 100000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "motorized",
  },
  mediumTank: {
    components: [
      men(400, 1, 0.5),
      { resource: "mediumTank", count: 40, required: true, weight: 1, softAttack: 3000, hardAttack: 1750, airAttack: 0 },
    ],
    icon: "armament/icon-armament-medium-tank-32.png",
    frontWidth: 2,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 200000,
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
    components: [
      men(500, 1),
      { resource: "selfPropelledArtilleryGun", count: 50, required: true, weight: 1, softAttack: 3000, hardAttack: 0, airAttack: 0 },
    ],
    icon: "armament/icon-armament-armored-SPART-32.png",
    frontWidth: 5,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 100000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1.2,
    counterAttackMultiplier: 1,
    armorPercent: 100,
    movement: "motorized",
  },
  armoredAntiTank: {
    components: [
      men(500, 1),
      { resource: "armoredAntiTankGun", count: 100, required: true, weight: 1, softAttack: 0, hardAttack: 10000, airAttack: 0 },
    ],
    icon: "armament/icon-armament-armored-AT-32.png",
    frontWidth: 5,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 200000,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 0.8,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1.2,
    armorPercent: 100,
    movement: "motorized",
  },
  selfPropelledAntiAir: {
    components: [
      men(500, 1),
      { resource: "selfPropelledAntiAirGun", count: 100, required: true, weight: 1, softAttack: 2000, hardAttack: 0, airAttack: 10000 },
    ],
    icon: "armament/icon-armament-SPAA-32.png",
    frontWidth: 5,
    breakthroughWidth: 1,
    formationTurns: 100,
    hitPoints: 100000,
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
  tanks: { support: false, types: ["mediumTank", "infantryTank", "cruiserTank", "tankette"] },
  antiTank: { support: true, types: ["armoredAntiTank", "antiTank"] },
  antiAir: { support: true, types: ["selfPropelledAntiAir", "antiAir"] },
  artillery: { support: true, types: ["selfPropelledArtillery", "artillery"] },
} as const satisfies Record<string, { readonly support: boolean; readonly types: readonly DivisionId[] }>;

export type NicheId = keyof typeof NICHES;
