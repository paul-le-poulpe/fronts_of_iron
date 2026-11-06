// Boîtes d'activités (Docs/Design/08-Population.md §2, §4, §9). Dans le code, une boîte de 08 est une ACTIVITÉ :
// `Box` et `state.boxes` désignent déjà les boîtes de percée.
//
// Une activité reçoit des bonshommes (et des machines pour l'agriculture, la pêche et les mines). Les activités de
// production ont une entrée en fer (`ironPerUnit` par unité) et une sortie : la limite d'un bien (usine de machines)
// ou d'un type de division (usine ou caserne).
//
// `ACTIVITIES` ne contient que ce qui n'est pas une unité. La boîte d'une division se règle dans sa définition
// (`production`, `divisions.ts`), et `src/activities.ts` assemble les deux.
//
// Les valeurs de `workersPerUnit` et `ironPerUnit` sont des valeurs d'essai, À FIXER avec l'auteur (08 §12).
// Le coût de déblocage est en tours d'un ouvrier servi en fer : avec N ouvriers, N fois plus vite (08 §9).

import type { DivisionId } from "./divisions.ts";
import type { GoodId } from "./goods.ts";

/** Déblocage (08 §9). */
export const UNLOCK = {
  /** `U` : tours d'un ouvrier servi dans la boîte parente pour débloquer une boîte enfant de coût `U`. */
  turns: 500,
} as const;

const U = UNLOCK.turns;

/**
 * Genre d'une activité : `idle` (Inactifs), `hurt` (Blessés), `farming`, `fishing`, `mining` (capacité de population ou
 * fer), `factory` (limite d'un bien, ou d'un type de division hors infanterie), `barracks` (limite d'un type
 * d'infanterie ; ses bonshommes y occupent des places).
 */
export type ActivityKind = "idle" | "hurt" | "farming" | "fishing" | "mining" | "factory" | "barracks";

export interface ActivityConfig {
  readonly kind: ActivityKind;
  /** Activité parente : sa production servie en fer débloque celle-ci. `null` : pas de parent. */
  readonly parent: string | null;
  /** Coût de déblocage, en tours d'un ouvrier servi du parent ; 0 : débloquée dès le départ (08 §9). */
  readonly unlockCost: number;
  /** `unlockCost` est un nombre d'ouvriers présents dans le parent, et non du temps : atteint une fois, il reste acquis (08 §9). */
  readonly unlockByWorkers?: boolean;
  /** `unlockCost` est une population totale, et non du temps : atteinte une fois, elle reste acquise (08 §9). Le parent est alors Inactifs. */
  readonly unlockByPopulation?: boolean;
  /** Rang au départ parmi les activités ouvertes ; `null` : verrouillée au départ. */
  readonly startOrder: number | null;
  /** Ouvriers par unité produite (usine, caserne). */
  readonly workersPerUnit: number;
  /** Unités produites par groupe de `workersPerUnit` ouvriers. Absent : 1. Usines de machines : 2, l'exemple de l'auteur, à fixer. */
  readonly unitsPerWorker?: number;
  /** Fer réservé par unité produite, par tour ; 0 : aucun fer en entrée. */
  readonly ironPerUnit: number;
  /** Bien produit par une usine de machines, ou machine que reçoit l'agriculture, la pêche ou les mines. */
  readonly good?: GoodId;
}

const locked = (parent: string, unlockCost: number, ironPerUnit: number, product: { good: GoodId; unitsPerWorker: number }): ActivityConfig => ({
  kind: "factory",
  parent,
  unlockCost,
  startOrder: null,
  workersPerUnit: 1,
  ironPerUnit,
  ...product,
});

/** Activités, dans l'ordre de leur indice (`ACTIVITY_IDS`). L'indice entre dans le hash : ne pas réordonner sans raison. */
export const ACTIVITIES = {
  idle: { kind: "idle", parent: null, unlockCost: 0, startOrder: 0, workersPerUnit: 0, ironPerUnit: 0 },
  hurt: { kind: "hurt", parent: null, unlockCost: 0, startOrder: 1, workersPerUnit: 0, ironPerUnit: 0 },
  farmers: { kind: "farming", parent: null, unlockCost: 0, startOrder: 2, workersPerUnit: 0, ironPerUnit: 0, good: "tractor" },
  fishers: { kind: "fishing", parent: null, unlockCost: 0, startOrder: 3, workersPerUnit: 0, ironPerUnit: 0, good: "fishingBoat" },
  miners: { kind: "mining", parent: null, unlockCost: 0, startOrder: 4, workersPerUnit: 0, ironPerUnit: 0, good: "miningMachine" },
  // Machines. À FIXER : fer par machine.
  miningMachine: { kind: "factory", parent: "miners", unlockCost: 4, unlockByWorkers: true, startOrder: null, workersPerUnit: 1, unitsPerWorker: 2, ironPerUnit: 20, good: "miningMachine" },
  tractor: locked("miningMachine", U, 50, { good: "tractor", unitsPerWorker: 2 }),
  fishingBoat: { kind: "factory", parent: "fishers", unlockCost: 6, unlockByWorkers: true, startOrder: null, workersPerUnit: 1, unitsPerWorker: 2, ironPerUnit: 60, good: "fishingBoat" },
} as const satisfies Record<string, ActivityConfig>;

/** Une activité sans unité, ou un type de division : sa boîte porte le même identifiant. */
export type ActivityId = keyof typeof ACTIVITIES | DivisionId;
