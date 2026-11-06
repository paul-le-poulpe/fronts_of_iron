// Activités (Docs/Design/08-Population.md §2, §7, §10) : la table résolue, les limites des machines et des divisions, et
// les ordres du joueur sur ses bonshommes. Le calcul du tour est dans economy.ts. Un bonhomme déposé dans une caserne y
// ajoute une place ; Inactifs et Blessés sont des activités comme les autres, pour l'ordre (`Player.activities`).

import { ACTIVITIES, DIVISIONS, FARMING, FISHING, GOODS, MINING, type ActivityConfig, type ActivityId, type ActivityKind, type DivisionId, type DivisionProductionConfig, type GoodId } from "./config.ts";
import { DIVISION_IDS, DIVISION_DATA, eliteCap, infantryCount } from "./divisions.ts";
import { IRON_INDEX } from "./map.ts";
import type { GameState, Player } from "./state.ts";

/** Une activité d'un joueur (08 §2). Tous ses champs entrent dans le hash. */
export interface Activity {
  /** Indice de l'activité dans `ACTIVITY_IDS`. */
  readonly id: number;
  /** Bonshommes présents. Inactifs et Blessés : leur nombre. Caserne : les places remplies. */
  workers: number;
  /** Machines présentes (agriculteurs, pêcheurs, mineurs seulement : le tracteur, le bateau ou la pompe). */
  machines: number;
  /** Casernes et usines de divisions : places, remplies ou vides (08 §7). La cible du joueur. 0 ailleurs. */
  places: number;
  /**
   * Toutes les boîtes à places : postes barrés, comptés depuis la droite (08 §7 bis). En auto-assignation, ils restent
   * vides, sans ouvrier ni machine. Toujours ≤ `slots`, ou ≤ `places`.
   */
  disabled: number;
  // Résultats du dernier tour (economy.ts).
  /** Agriculteurs, pêcheurs, mineurs, usines de machines : places (08 §2.1). 0 ailleurs. */
  slots: number;
  /**
   * Sortie : blé (agriculteurs), poisson (pêcheurs), fer produit (mineurs) ; unités servies en fer, donc limite du produit
   * (usines et casernes, 08 §4). 0 pour Inactifs et Blessés.
   */
  output: number;
  /** Fer réservé par la sortie (usines et casernes). */
  ironUsed: number;
}

export interface ActivityData {
  readonly id: ActivityId;
  readonly index: number;
  readonly kind: ActivityKind;
  /** Indice de l'activité parente, -1 s'il n'y en a pas. */
  readonly parent: number;
  readonly unlockCost: number;
  /** `unlockCost` compte les ouvriers présents dans le parent (08 §9). */
  readonly unlockByWorkers: boolean;
  /** `unlockCost` compte la population totale du joueur (08 §9). */
  readonly unlockByPopulation: boolean;
  /** Rang au départ parmi les activités ouvertes, -1 si verrouillée. */
  readonly startOrder: number;
  readonly workersPerUnit: number;
  readonly unitsPerWorker: number;
  readonly ironPerUnit: number;
  /** Agriculteurs, pêcheurs, mineurs, usines de machines : un nombre de places calculé (`slotsOf`). */
  readonly hasSlots: boolean;
  /** Casernes et usines de divisions : un nombre de places choisi par le joueur (`Activity.places`). */
  readonly hasPlaces: boolean;
  /** Indice (ordre de `GOODS`) du bien produit ou de la machine reçue, -1 s'il n'y en a pas. */
  readonly good: number;
  /** Indice (ordre de `DIVISIONS`) du type produit, -1 s'il n'y en a pas. */
  readonly division: number;
}

/** Les activités sans unité, puis une boîte par type de division, avec son identifiant. */
export const ACTIVITY_IDS = [...Object.keys(ACTIVITIES), ...Object.keys(DIVISIONS)] as ActivityId[];
export const ACTIVITY_COUNT = ACTIVITY_IDS.length;
export const GOOD_IDS = Object.keys(GOODS) as GoodId[];
export const GOOD_COUNT = GOOD_IDS.length;

/** Indice d'un bien dans `Player.idleMachines`, -1 si ce n'est pas un bien. */
export const goodIndex = (id: unknown): number => (typeof id === "string" ? GOOD_IDS.indexOf(id as GoodId) : -1);
/** Indice d'une activité dans `ACTIVITY_IDS`, -1 si inconnue. */
export const activityIndex = (id: unknown): number => (typeof id === "string" ? ACTIVITY_IDS.indexOf(id as ActivityId) : -1);
export const isActivityId = (v: unknown): v is ActivityId => activityIndex(v) >= 0;
export const isGoodId = (v: unknown): v is GoodId => goodIndex(v) >= 0;

export const ACTIVITY_DATA: readonly ActivityData[] = ACTIVITY_IDS.map((id, index) => {
  const unit: DivisionProductionConfig | undefined = id in DIVISIONS ? DIVISIONS[id as DivisionId].production : undefined;
  const c: ActivityConfig =
    unit === undefined
      ? ACTIVITIES[id as keyof typeof ACTIVITIES]
      : { kind: unit.building, parent: unit.parent, unlockCost: unit.unlockCost, unlockByPopulation: unit.unlockByPopulation === true, startOrder: null, workersPerUnit: unit.workersPerUnit, ironPerUnit: unit.ironPerUnit };
  const parent = c.parent === null ? -1 : ACTIVITY_IDS.indexOf(c.parent as ActivityId);
  if (c.parent !== null && parent < 0) throw new Error(`activité ${id} : parent inconnu ${c.parent}`);
  return {
    id,
    index,
    kind: c.kind,
    parent,
    unlockCost: c.unlockCost,
    unlockByWorkers: c.unlockByWorkers === true,
    unlockByPopulation: c.unlockByPopulation === true,
    startOrder: c.startOrder ?? -1,
    workersPerUnit: c.workersPerUnit,
    unitsPerWorker: c.unitsPerWorker ?? 1,
    hasSlots: c.kind === "farming" || c.kind === "fishing" || c.kind === "mining" || (c.kind === "factory" && c.good !== undefined),
    hasPlaces: unit !== undefined,
    ironPerUnit: c.ironPerUnit,
    good: c.good === undefined ? -1 : GOOD_IDS.indexOf(c.good),
    division: unit === undefined ? -1 : DIVISION_IDS.indexOf(id as DivisionId),
  };
});

export const IDLE = ACTIVITY_IDS.indexOf("idle");
export const HURT = ACTIVITY_IDS.indexOf("hurt");
export const FARMERS = ACTIVITY_IDS.indexOf("farmers");
export const FISHERS = ACTIVITY_IDS.indexOf("fishers");
export const MINERS = ACTIVITY_IDS.indexOf("miners");

/** Activité qui reçoit la machine du bien (tracteur : agriculteurs, bateau : pêcheurs, pompe : mineurs). */
export const MACHINE_HOST: readonly number[] = GOOD_IDS.map((_, g) => ACTIVITY_DATA.findIndex((a) => a.good === g && (a.kind === "farming" || a.kind === "fishing" || a.kind === "mining")));
/** Usine qui produit le bien : sa sortie est le nombre maximal de machines de ce type. */
export const GOOD_FACTORY: readonly number[] = GOOD_IDS.map((_, g) => ACTIVITY_DATA.findIndex((a) => a.good === g && a.kind === "factory"));
/** Usine ou caserne qui produit le type de division : sa sortie est la limite de ce type. */
export const DIVISION_ACTIVITY: readonly number[] = DIVISION_IDS.map((_, t) => ACTIVITY_DATA.findIndex((a) => a.division === t));

const newActivity = (id: number): Activity => ({ id, workers: 0, machines: 0, places: 0, disabled: 0, slots: 0, output: 0, ironUsed: 0 });

/** Les activités ouvertes au départ, dans leur ordre de départ (08 §9). */
export function createActivities(): Activity[] {
  return ACTIVITY_DATA.filter((a) => a.startOrder >= 0)
    .sort((a, b) => a.startOrder - b.startOrder)
    .map((a) => newActivity(a.index));
}

/** L'activité ouverte, ou undefined si elle est verrouillée. */
export const activityOf = (p: Player, index: number): Activity | undefined => p.activities.find((a) => a.id === index);

/** Ouvre une activité : elle rejoint le bas des activités ouvertes, vide (08 §9). Sans effet si elle est déjà ouverte. */
export function openActivity(p: Player, index: number): Activity {
  const found = activityOf(p, index);
  if (found !== undefined) return found;
  const a = newActivity(index);
  p.activities.push(a);
  p.everOpened[index] = 1;
  return a;
}

/**
 * Retire un bonhomme de la population (08 §6, §10) : Inactifs d'abord, puis de l'activité la plus basse vers le haut, jamais
 * Blessés. Sa place de caserne ou d'usine reste. Renvoie l'activité touchée, ou undefined s'il n'y a personne à prendre.
 */
export function takePawn(p: Player): Activity | undefined {
  const idle = activityOf(p, IDLE)!;
  for (const a of [idle, ...[...p.activities].reverse()]) {
    if (a.id === HURT || a.workers === 0) continue;
    a.workers--;
    p.population--;
    return a;
  }
  return undefined;
}

/** Bonshommes d'Inactifs. */
export const idlePawns = (p: Player): number => activityOf(p, IDLE)!.workers;
/** Bonshommes de Blessés. */
export const hurtPawns = (p: Player): number => activityOf(p, HURT)!.workers;

/** Unités produites par `workers` ouvriers d'une usine ou d'une caserne (08 §4). */
export const unitsOf = (data: ActivityData, workers: number): number => Math.floor((workers * data.unitsPerWorker) / data.workersPerUnit);

/**
 * Places d'une activité à places calculées (08 §2.1) : `floor(cases / cases_par_travailleur)` pour l'agriculture, la pêche
 * et les mines, le reste des cases ne sert pas ; pour une usine de machines, les ouvriers qu'il faut pour produire une machine par place de l'activité qui
 * les reçoit. 0 pour les autres.
 */
export function slotsOf(p: Player, data: ActivityData): number {
  if (data.kind === "farming") return Math.floor(p.farmTiles / FARMING.tilesPerWorker);
  if (data.kind === "fishing") return Math.floor(p.seaTiles / FISHING.tilesPerWorker);
  if (data.kind === "mining") return Math.floor(p.resourceTiles[IRON_INDEX]! / MINING.tilesPerWorker);
  if (!data.hasSlots) return 0;
  return Math.ceil((slotsOf(p, ACTIVITY_DATA[MACHINE_HOST[data.good]!]!) * data.workersPerUnit) / data.unitsPerWorker);
}

/** Machines du bien que possède le joueur : dans Inactifs et dans l'activité qui les reçoit. */
export function machineCount(p: Player, good: number): number {
  const host = activityOf(p, MACHINE_HOST[good]!);
  return p.idleMachines[good]! + (host === undefined ? 0 : host.machines);
}

/** Limite d'un bien (08 §5) : la sortie de son usine, 0 si elle est verrouillée. */
export function machineLimit(p: Player, good: number): number {
  return activityOf(p, GOOD_FACTORY[good]!)?.output ?? 0;
}

/**
 * Limite d'un type de division (08 §5) : la sortie de son usine ou de sa caserne, 0 si elle est verrouillée. Les élites
 * sont aussi plafonnées à `eliteCap` des divisions d'infanterie du joueur, élites comprises.
 */
export function divisionLimit(state: GameState, p: Player, type: number): number {
  const limit = activityOf(p, DIVISION_ACTIVITY[type]!)?.output ?? 0;
  return DIVISION_DATA[type]!.elite ? Math.min(limit, eliteCap(infantryCount(state, p.id))) : limit;
}

// ---- blessés (08 §8) ----

/**
 * Un bonhomme de la caserne du type passe aux Blessés (08 §8) : la division d'infanterie de ce type vient d'être
 * détruite. Sa place reste ; un inactif la remplit aussitôt s'il y en a un, sinon elle reste vide. Sans bonhomme dans la
 * caserne, rien ne se passe.
 */
export function woundPawn(p: Player, type: number): void {
  const barracks = activityOf(p, DIVISION_ACTIVITY[type]!);
  if (barracks === undefined || barracks.workers === 0) return;
  const idle = activityOf(p, IDLE)!;
  barracks.workers--;
  activityOf(p, HURT)!.workers++;
  if (idle.workers > 0) {
    idle.workers--;
    barracks.workers++;
  }
}

// ---- ordres (08 §10) ----

const MAX_COUNT = 1_000_000;

/**
 * `move_pawn` (08 §10) : déplace `count` bonshommes (`kind` `"worker"`) ou machines de `good` (`"machine"`) de l'activité
 * `from` à l'activité `to`. Valide si les deux sont ouvertes et différentes, ni l'une ni l'autre n'est Blessés, le départ
 * en a assez, l'arrivée a assez de places, et une machine va seulement entre Inactifs et l'activité qui la reçoit.
 * Une machine déposée dans une activité pleine renvoie autant de bonshommes de cette activité dans Inactifs (08 §2.1).
 * Casernes : le bonhomme qui arrive ajoute une place, celui qui part retire la sienne (08 §7).
 */
export function movePawn(state: GameState, playerId: number, from: unknown, to: unknown, kind: unknown, good: unknown, count: unknown): boolean {
  const fromIndex = activityIndex(from);
  const toIndex = activityIndex(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || fromIndex === HURT || toIndex === HURT) return false;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_COUNT) return false;
  const n = count as number;
  const p = state.players[playerId - 1]!;
  const a = activityOf(p, fromIndex);
  const b = activityOf(p, toIndex);
  if (a === undefined || b === undefined) return false;
  const bData = ACTIVITY_DATA[toIndex]!;
  const roomLeft = (): number => slotsOf(p, bData) - b.workers - b.machines;
  if (kind === "worker") {
    if (a.workers < n) return false;
    if (bData.hasSlots && n > roomLeft()) return false;
    a.workers -= n;
    b.workers += n;
    if (ACTIVITY_DATA[fromIndex]!.hasPlaces) a.places -= n;
    if (bData.hasPlaces) b.places += n;
    return true;
  }
  if (kind === "machine") {
    const g = goodIndex(good);
    if (g < 0) return false;
    const host = MACHINE_HOST[g]!;
    if ((fromIndex !== IDLE && fromIndex !== host) || (toIndex !== IDLE && toIndex !== host)) return false;
    const have = fromIndex === IDLE ? p.idleMachines[g]! : a.machines;
    if (have < n) return false;
    if (toIndex === host) {
      const displaced = Math.max(0, n - roomLeft());
      if (displaced > b.workers) return false;
      b.workers -= displaced;
      activityOf(p, IDLE)!.workers += displaced;
    }
    if (fromIndex === IDLE) p.idleMachines[g] = p.idleMachines[g]! - n;
    else a.machines -= n;
    if (toIndex === IDLE) p.idleMachines[g] = p.idleMachines[g]! + n;
    else b.machines += n;
    return true;
  }
  return false;
}

/**
 * `set_activity_order` (08 §2, §10) : l'activité prend la position `position` (indice final dans `Player.activities`).
 * Valide si elle est ouverte et n'est pas Inactifs, qui reste tout en haut (provisoire) : la position est entre 1 et le
 * nombre d'activités ouvertes moins 1.
 */
export function setActivityOrder(state: GameState, playerId: number, activity: unknown, position: unknown): boolean {
  const index = activityIndex(activity);
  if (index < 0 || index === IDLE || !Number.isInteger(position)) return false;
  const list = state.players[playerId - 1]!.activities;
  const from = list.findIndex((a) => a.id === index);
  const to = position as number;
  if (from < 0 || to < 1 || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  return true;
}

/** Le déblocage de l'activité est fini (08 §9) : elle peut être ouverte, ou l'a déjà été. */
export const activityUnlocked = (p: Player, index: number): boolean => p.unlock[index]! >= ACTIVITY_DATA[index]!.unlockCost;

/** `open_activity` (08 §9) : une boîte débloquée ou supprimée rejoint le bas des boîtes ouvertes, vide. */
export function openActivityOrder(state: GameState, playerId: number, activity: unknown): boolean {
  const index = activityIndex(activity);
  if (index < 0) return false;
  const p = state.players[playerId - 1]!;
  if (activityOf(p, index) !== undefined || !activityUnlocked(p, index)) return false;
  openActivity(p, index);
  return true;
}

/** `close_activity` (08 §9) : une usine ou une caserne quitte les boîtes ouvertes ; ses ouvriers retournent dans Inactifs. */
export function closeActivity(state: GameState, playerId: number, activity: unknown): boolean {
  const index = activityIndex(activity);
  if (index < 0) return false;
  const kind = ACTIVITY_DATA[index]!.kind;
  if (kind !== "factory" && kind !== "barracks") return false;
  const p = state.players[playerId - 1]!;
  const a = activityOf(p, index);
  if (a === undefined) return false;
  activityOf(p, IDLE)!.workers += a.workers;
  p.activities.splice(p.activities.indexOf(a), 1);
  return true;
}

/** `set_auto_assign` (08 §7 bis) : allume ou éteint l'auto-assignation du joueur. */
export function setAutoAssign(state: GameState, playerId: number, enabled: unknown): boolean {
  if (typeof enabled !== "boolean") return false;
  state.players[playerId - 1]!.autoAssign = enabled;
  return true;
}

/** `set_disabled_slots` (08 §7 bis) : les `count` derniers postes de l'activité sont barrés, ouvriers et machines compris. */
export function setDisabledSlots(state: GameState, playerId: number, activity: unknown, count: unknown): boolean {
  const index = activityIndex(activity);
  if (index < 0 || !Number.isInteger(count) || (count as number) < 0) return false;
  const data = ACTIVITY_DATA[index]!;
  if (!data.hasSlots && !data.hasPlaces) return false;
  const p = state.players[playerId - 1]!;
  const a = activityOf(p, index);
  if (a === undefined || (count as number) > (data.hasPlaces ? a.places : slotsOf(p, data))) return false;
  a.disabled = count as number;
  return true;
}

const MAX_TARGET_STEP = 1000;

/**
 * `change_production_target` (08 §7 ter) : la production visée d'une caserne ou d'une usine de divisions change de `delta`
 * unités, sans passer sous 0. Les places suivent ; les ouvriers en trop retournent dans Inactifs (economy.ts).
 */
export function changeProductionTarget(state: GameState, playerId: number, activity: unknown, delta: unknown): boolean {
  const index = activityIndex(activity);
  if (index < 0 || !ACTIVITY_DATA[index]!.hasPlaces || !Number.isInteger(delta)) return false;
  const step = delta as number;
  if (step === 0 || Math.abs(step) > MAX_TARGET_STEP) return false;
  const a = activityOf(state.players[playerId - 1]!, index);
  if (a === undefined) return false;
  const places = Math.max(0, a.places + step * ACTIVITY_DATA[index]!.workersPerUnit);
  // Les places barrées, à droite, partent les premières (08 §7 bis).
  a.disabled = Math.max(0, a.disabled - Math.max(0, a.places - places));
  a.places = places;
  return true;
}
