// Unités militaires des fronts terrestres (Docs/Design/05-Fronts.md §12). Pas
// encore lues par le moteur : les fronts ne sont pas implémentés.
//
// Valeurs données par l'auteur, justes entre elles ; à ajuster plus tard dans
// le jeu.
//
// ÉCHELLE : une unité est un paquet, pas un soldat ni un véhicule. Une unité
// d'infanterie = 10 personnes, 10 fusils, 10 mètres de front. Choisie pour que
// les attaques et les PV restent des entiers : seul leur rapport compte
// (unités détruites = floor(dégâts / PV)).
//
// Tous les attributs sont des entiers, sauf les multiplicateurs.
// MULTIPLICATEURS : écrits en décimal, DEUX DÉCIMALES AU PLUS (0.5, 1.2, 0.75).
// Le moteur les convertit une fois en entiers à l'échelle 100 au chargement
// (Math.round(x × 100) : 0.5 → 50), puis ne calcule qu'en entiers
// (dégâts × multiplicateur / 100, division entière à la fin). Une troisième
// décimale serait arrondie : un test le refuse.
//
// PERTES : une unité d'infanterie ou blindée a des PV (`hitPoints`). Une unité
// de type « équipement » (canons, mitrailleuses) n'en a pas : elle perd le
// même pourcentage de ses unités que l'infanterie du front. En nombre, c'est
// donc proportionnel à la largeur : 10 % de pertes = 1 artillerie (100 m) pour
// 10 infanteries (10 m). Hommes et matériel sont toujours perdus ensemble.
//
// MULTIPLICATEUR DE PERTES (`lossMultiplier`, équipement seulement, optionnel,
// 1 par défaut) : sert à rendre un équipement plus résistant ou plus fragile
// que l'infanterie qu'il accompagne. Pourcentage perdu = pourcentage perdu par
// l'infanterie × lossMultiplier. 0.5 : plus résistant, il perd deux fois moins
// (un canon blindé, par exemple) ; 2 : plus fragile, deux fois plus. À 1, il
// suit l'infanterie, et la proportion en nombre vient de la largeur seule.
//
// DÉPLOIEMENT : les équipements sont plafonnés par l'infanterie. Si la niche
// infanterie est remplie à 50 %, chaque niche d'équipement l'est au plus à
// 50 %. L'équipement en trop pour la première ligne va en seconde ligne, encore
// plafonné par l'infanterie de la seconde ligne ; le reste reste en stock.
//
// VALEURS PAR DÉFAUT : une clé absente prend une autre valeur de l'unité.
// `breakthroughWidth` absent = `frontWidth` ; `breakthroughMultiplier` et
// `counterAttackMultiplier` absents = `attackMultiplier` ; `description` absente
// = description de l'équipement ; `lossMultiplier` absent = 1.
//
// ICÔNE PROVISOIRE : `miscellaneous/misc-dev-icon.png` (toute rouge) marque une
// unité dont l'icône reste à dessiner.

import type { ArmamentId } from "./armament.ts";

interface UnitBase {
  /** Équipement requis : un seul type par unité, en général du même nom que l'unité (infanterie : `rifle`). */
  readonly equipment: ArmamentId;
  /** Nombre d'équipements de ce type par unité (infanterie : 10 fusils pour 10 personnes). */
  readonly equipmentCount: number;
  /** Icône : chemin sous `client/public/icons/`. En général celle de l'équipement, parfois différente (infanterie). */
  readonly icon: string;
  /** Description affichée au survol de l'unité. Absente : celle de l'équipement (`ARMAMENT.types[equipment].description`). Sans effet sur la simulation. */
  readonly description?: string;
  /** Population nécessaire pour opérer l'équipement (char : équipage et soutien). */
  readonly population: number;
  /** Attaque anti-infanterie (soft attack). */
  readonly softAttack: number;
  /** Attaque antiblindée (hard attack). */
  readonly hardAttack: number;
  /** Attaque antiaérienne. L'aérien n'est pas encore implémenté : valeur abstraite pour l'instant, lue par rien. */
  readonly airAttack: number;
  /** Largeur de front en première ligne, en mètres par unité. */
  readonly frontWidth: number;
  /** Largeur de percée, en mètres par unité : en seconde ligne, pour percer ou repousser une percée. Absente : `frontWidth`. */
  readonly breakthroughWidth?: number;
  /** Déplacement. Un véhicule très lent compte à pied. */
  readonly movement: "foot" | "motorized";
  /** Multiplicateur d'attaque (décimal, 2 décimales au plus) : quand l'unité attaque ; aucun en défense. */
  readonly attackMultiplier: number;
  /** Multiplicateur de percée (décimal, 2 décimales au plus) : seconde ligne qui attaque la première ligne adverse. Absent : `attackMultiplier`. */
  readonly breakthroughMultiplier?: number;
  /** Multiplicateur de contre-attaque (décimal, 2 décimales au plus) : pour repousser une percée. Absent : `attackMultiplier`. */
  readonly counterAttackMultiplier?: number;
}

/** Type de dégâts reçus, et ce qui fixe les pertes. Tous les blindés sont équivalents (un seul niveau de blindage). */
type UnitDamage =
  | {
      readonly damageType: "infantry" | "armor";
      /** Résistance (PV) : unités détruites = floor(dégâts / PV), le reste est perdu. */
      readonly hitPoints: number;
    }
  | {
      readonly damageType: "equipment";
      /** Multiplicateur de pertes (décimal, 2 décimales au plus) : rend l'équipement plus résistant (< 1) ou plus fragile (> 1) que l'infanterie qu'il accompagne. Pourcentage perdu = pourcentage perdu par l'infanterie du front × lossMultiplier. Absent : 1. */
      readonly lossMultiplier?: number;
    };

export type UnitConfig = UnitBase & UnitDamage;

export const UNITS = {
  infantry: {
    equipment: "rifle",
    equipmentCount: 10,
    icon: "population/pop-soldier.png",
    description: "La base de toutes vos armées. Elle devra recevoir de l'équipement supplémentaire pour être vraiment efficace : canons, mitrailleuses, etc.",
    population: 10,
    softAttack: 10,
    hardAttack: 1,
    airAttack: 0,
    frontWidth: 10,
    breakthroughWidth: 10,
    damageType: "infantry",
    movement: "foot",
    hitPoints: 500,
    attackMultiplier: 0.5,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
  },
  machineGun: {
    equipment: "machineGun",
    equipmentCount: 1,
    icon: "armament/armament-machine-gun.png",
    population: 1,
    softAttack: 5,
    hardAttack: 0,
    airAttack: 1,
    frontWidth: 10,
    damageType: "equipment",
    movement: "foot",
    attackMultiplier: 0.2,
    breakthroughMultiplier: 0.2,
    counterAttackMultiplier: 0.5,
  },
  artillery: {
    equipment: "artillery",
    equipmentCount: 1,
    icon: "armament/armament-artillery.png",
    population: 10,
    softAttack: 50,
    hardAttack: 5,
    airAttack: 0,
    frontWidth: 100,
    damageType: "equipment",
    movement: "foot",
    attackMultiplier: 1,
  },
  antiTankGun: {
    equipment: "antiTankGun",
    equipmentCount: 1,
    icon: "armament/armament-AT-gun.png",
    population: 5,
    softAttack: 0,
    hardAttack: 50,
    airAttack: 0,
    frontWidth: 50,
    damageType: "equipment",
    movement: "foot",
    attackMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
  },
  // Comme le canon antichar, mais contre l'aérien (et un peu contre l'infanterie). L'aérien n'est pas encore
  // implémenté : son attaque antiaérienne est une valeur abstraite pour l'instant.
  antiAirGun: {
    equipment: "antiAirGun",
    equipmentCount: 1,
    icon: "armament/armament-AA-gun.png",
    population: 5,
    softAttack: 10,
    hardAttack: 0,
    airAttack: 50,
    frontWidth: 50,
    damageType: "equipment",
    movement: "foot",
    attackMultiplier: 0.2,
    counterAttackMultiplier: 0.7,
  },
  tankette: {
    equipment: "tankette",
    equipmentCount: 1,
    icon: "miscellaneous/misc-dev-icon.png",
    population: 10,
    softAttack: 50,
    hardAttack: 10,
    airAttack: 0,
    frontWidth: 100,
    damageType: "armor",
    movement: "foot",
    hitPoints: 1000,
    attackMultiplier: 1,
  },
} as const satisfies Record<string, UnitConfig>;

export type UnitId = keyof typeof UNITS;

/**
 * Niches (05-Fronts §12) : un rôle sur le front, rempli par un ou plusieurs types
 * d'unités. Chaque niche couvre toute la largeur du front, en mètres. Unités
 * rangées de la meilleure à la moins bonne : on couvre le plus de largeur
 * possible avec la première, puis on passe à la suivante. Chaque unité est dans
 * une seule niche.
 */
export const NICHES = {
  infantry: ["infantry"],
  machineGun: ["machineGun"],
  artillery: ["artillery"],
  antiTank: ["antiTankGun"],
  antiAir: ["antiAirGun"],
  assaultTank: ["tankette"],
} as const satisfies Record<string, readonly UnitId[]>;

export type NicheId = keyof typeof NICHES;
