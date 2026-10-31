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
// APPUI-FEU (antichar, antiaérien, artillerie) : pas de dégâts directs
// (05-Fronts §6.3), donc `hitPoints`, `defenseHitPointsMultiplier` et
// `armorPercent` n'y sont jamais lus (0, 1 et 0).
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

export const DIVISIONS = {
  infantry: {
    components: [
      men(1000, 2),
      { resource: "rifle", count: 1000, required: true, weight: 2, softAttack: 1000, hardAttack: 100, airAttack: 0 },
      // Servies par les 1 000 hommes de la division, sans homme de plus.
      { resource: "machineGun", count: 100, required: false, weight: 1, softAttack: 500, hardAttack: 0, airAttack: 100 },
    ],
    icon: "population/pop-soldier.png",
    description: "La base de toutes vos armées. Elle devra recevoir de l'équipement supplémentaire pour être vraiment efficace : canons, mitrailleuses, etc.",
    frontWidth: 1,
    breakthroughWidth: 1,
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
    hitPoints: 0,
    defenseHitPointsMultiplier: 1,
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
    hitPoints: 0,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
    armorPercent: 0,
    movement: "foot",
  },
  artillery: {
    components: [
      men(500, 1, 0.5),
      { resource: "artillery", count: 50, required: true, weight: 1, softAttack: 2500, hardAttack: 250, airAttack: 0, lossMultiplier: 0.5 },
    ],
    icon: "armament/armament-artillery.png",
    frontWidth: 5,
    breakthroughWidth: 5,
    hitPoints: 0,
    defenseHitPointsMultiplier: 1,
    attackMultiplier: 1,
    breakthroughMultiplier: 1,
    counterAttackMultiplier: 1,
    armorPercent: 0,
    movement: "foot",
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
  infantry: { support: false, types: ["infantry"] },
  // D'autres types de chars viendront.
  tanks: { support: false, types: ["tankette"] },
  antiTank: { support: true, types: ["antiTank"] },
  antiAir: { support: true, types: ["antiAir"] },
  artillery: { support: true, types: ["artillery"] },
} as const satisfies Record<string, { readonly support: boolean; readonly types: readonly DivisionId[] }>;

export type NicheId = keyof typeof NICHES;
