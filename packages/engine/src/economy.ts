// Population, fer, limites, déblocage, apparitions et disparitions, soin (Docs/Design/08-Population.md) : une étape par
// tour et par joueur, après les ordres, joueurs dans l'ordre des identifiants. Tout est en entiers (règle 2 du
// CLAUDE.md) : multiplications avant les divisions.
//
// Ordre de l'étape d'un joueur (08 §13) : places et trop-plein, capacité, service du fer de haut en bas, remplissage des
// places de caserne, déblocage, compteurs de population, de machines et de divisions, soin d'un blessé, soin des
// divisions abîmées. Avec `economyFrozen`, seul le soin continue.

import { COMBAT, DIVISION_TIMING, FARMING, FISHING, FOOD, GOODS_TIMING, MINING, POPULATION, RESOURCES } from "./config.ts";
import {
  ACTIVITY_DATA,
  FARMERS,
  FISHERS,
  GOOD_COUNT,
  HURT,
  IDLE,
  MACHINE_HOST,
  MINERS,
  activityOf,
  divisionLimit,
  eliteLimit,
  machineCount,
  machineLimit,
  slotsOf,
  takePawn,
  unitsOf,
  type Activity,
} from "./activities.ts";
import { removeEmptyBoxes } from "./breakthroughs.ts";
import {
  DIVISION_DATA,
  STATE_SCALE,
  addDivision,
  currentTurn,
  divisionCount,
  inFormation,
  type Division,
} from "./divisions.ts";
import { inCombat } from "./fronts.ts";
import { IRON_INDEX } from "./map.ts";
import type { GameState, Player } from "./state.ts";

/** Étape de tous les joueurs, dans l'ordre des identifiants. Appelée par `applyTurn` après les ordres. */
export function stepEconomy(state: GameState): void {
  const turn = currentTurn(state);
  for (const p of state.players) {
    // Sans ville (avant la fondation, ou éliminé) : aucun bonhomme n'arrive, aucune division n'est produite (provisoire).
    if (p.cityIds.length === 0) continue;
    if (state.economyFrozen) {
      // Partie de test : le bilan est calculé sans limite de fer, pour que les limites couvrent les divisions placées.
      balance(p, true);
    } else {
      fixOverflow(p);
      balance(p, false);
      fillPlaces(p);
      progressUnlock(p);
      stepPopulation(p, turn);
      stepMachines(p, turn);
      stepDivisions(state, p, turn);
    }
    healHurt(p);
    healDivisions(state, p);
  }
}

// ---- places et trop-plein (08 §2.1) ----

/**
 * Places des activités de cases, recalculées ; le trop-plein retourne dans Inactifs, les bonshommes d'abord, puis les
 * machines, chacun sur sa ligne (provisoire : 08 §2.1 ne dit pas lesquels partent en premier).
 */
function fixOverflow(p: Player): void {
  for (const a of p.activities) {
    const data = ACTIVITY_DATA[a.id]!;
    a.slots = slotsOf(p, data);
    if (!data.hasSlots) continue;
    let excess = a.workers + a.machines - a.slots;
    if (excess <= 0) continue;
    const workers = Math.min(a.workers, excess);
    a.workers -= workers;
    activityOf(p, IDLE)!.workers += workers;
    excess -= workers;
    a.machines -= excess;
    p.idleMachines[data.good] = p.idleMachines[data.good]! + excess;
  }
}

// ---- capacité et fer (08 §3, §4) ----

/**
 * Bilan statique du joueur : surface agricole, blé, poisson, capacité de population, fer produit, puis le partage du fer
 * (sortie de chaque usine et caserne). Ne change aucun compteur. `unlimitedIron` : partie de test, chaque
 * boîte est servie comme s'il y avait assez de fer.
 */
function balance(p: Player, unlimitedIron: boolean): void {
  for (const a of p.activities) {
    a.output = 0;
    a.ironUsed = 0;
    a.slots = slotsOf(p, ACTIVITY_DATA[a.id]!);
  }
  const farm = activityOf(p, FARMERS)!;
  const sea = activityOf(p, FISHERS)!;
  const mine = activityOf(p, MINERS)!;
  p.cultivated = Math.min(p.farmTiles, (farm.workers + farm.machines) * FARMING.tilesPerWorker);
  p.wheat = p.farmTiles === 0 ? 0 : Math.floor((p.fertilitySum * p.cultivated) / p.farmTiles);
  p.fished = Math.min(p.seaTiles, (sea.workers + sea.machines) * FISHING.tilesPerWorker);
  p.fish = Math.floor((p.fished * FISHING.foodPerWorker) / FISHING.tilesPerWorker);
  p.food = FOOD.base + FOOD.perCity * p.cityIds.length + p.wheat + p.fish;
  p.capacity = Math.floor((p.food + POPULATION.foodPerPawn - 1) / POPULATION.foodPerPawn);
  farm.output = p.wheat;
  sea.output = p.fish;

  p.minedTiles = Math.min(p.resourceTiles[IRON_INDEX]!, (mine.workers + mine.machines) * MINING.tilesPerWorker);
  p.ironProduced = p.minedTiles * RESOURCES.iron.capacityPerTile;
  mine.output = p.ironProduced;

  // Malus proportionnel au manque de fer (08 §4) : chaque boîte garde la même part de ses unités, arrondie vers le bas.
  const makers = p.activities.filter((a) => ACTIVITY_DATA[a.id]!.kind === "factory" || ACTIVITY_DATA[a.id]!.kind === "barracks");
  let wanted = 0;
  for (const a of makers) wanted += unitsOf(ACTIVITY_DATA[a.id]!, a.workers) * ACTIVITY_DATA[a.id]!.ironPerUnit;
  p.ironWanted = wanted;
  const short = !unlimitedIron && wanted > p.ironProduced;
  let reserved = 0;
  for (const a of makers) {
    const data = ACTIVITY_DATA[a.id]!;
    const units = unitsOf(data, a.workers);
    a.output = short && data.ironPerUnit > 0 ? Math.floor((units * p.ironProduced) / wanted) : units;
    a.ironUsed = a.output * data.ironPerUnit;
    reserved += a.ironUsed;
  }
  // Ce que l'arrondi laisse va aux boîtes du haut, unité par unité : sinon une boîte d'une seule unité n'aurait rien.
  if (short) {
    for (const a of makers) {
      const data = ACTIVITY_DATA[a.id]!;
      if (data.ironPerUnit === 0) continue;
      const more = Math.min(unitsOf(data, a.workers) - a.output, Math.floor((p.ironProduced - reserved) / data.ironPerUnit));
      a.output += more;
      a.ironUsed += more * data.ironPerUnit;
      reserved += more * data.ironPerUnit;
    }
  }
  p.ironReserved = reserved;
}

// ---- casernes et auto-assignation (08 §7, §7 bis) ----

/**
 * Deux passes, de haut en bas. D'abord chaque boîte rend ce qu'elle a en trop : les ouvriers au-delà des places choisies ;
 * avec l'auto-assignation, les machines d'Inactifs entrent sur les postes non barrés et les ouvriers en trop sortent. Puis
 * les inactifs remplissent les places vides, et avec l'auto-assignation les postes non barrés. Un ouvrier sorti d'une boîte
 * peut donc rejoindre une boîte plus haute ou plus basse. Enfin, avec l'auto-assignation, une boîte qui a encore de la
 * place prend les ouvriers des boîtes plus basses, la plus basse d'abord (08 §7 bis).
 */
function fillPlaces(p: Player): void {
  const idle = activityOf(p, IDLE)!;
  for (const a of p.activities) {
    const data = ACTIVITY_DATA[a.id]!;
    if (data.hasPlaces) {
      // Élites : au plus une division pour `ELITE_TROOPS_RATIO` bonshommes de la caserne de réguliers (08 §5).
      if (DIVISION_DATA[data.division]!.elite) a.places = Math.min(a.places, eliteLimit(p, data.division) * data.workersPerUnit);
      a.disabled = Math.min(a.disabled, a.places);
      const allowed = a.places - (p.autoAssign ? a.disabled : 0);
      if (a.workers > allowed) {
        idle.workers += a.workers - allowed;
        a.workers = allowed;
      }
    }
    if (!data.hasSlots) continue;
    a.disabled = Math.min(a.disabled, a.slots);
    if (!p.autoAssign) continue;
    const usable = a.slots - a.disabled;
    if (data.kind !== "factory" && p.idleMachines[data.good]! > 0) {
      const moved = Math.max(0, Math.min(p.idleMachines[data.good]!, usable - a.machines));
      p.idleMachines[data.good] = p.idleMachines[data.good]! - moved;
      a.machines += moved;
    }
    if (data.kind !== "factory" && a.machines > usable) {
      p.idleMachines[data.good] = p.idleMachines[data.good]! + a.machines - usable;
      a.machines = usable;
    }
    const excess = Math.min(a.workers, Math.max(0, a.workers + a.machines - usable));
    a.workers -= excess;
    idle.workers += excess;
  }
  const roomIn = (a: Activity): number => {
    const data = ACTIVITY_DATA[a.id]!;
    if (data.hasPlaces) return a.places - (p.autoAssign ? a.disabled : 0) - a.workers;
    return data.hasSlots && p.autoAssign ? a.slots - a.disabled - a.workers - a.machines : 0;
  };
  for (const a of p.activities) {
    const moved = Math.min(roomIn(a), idle.workers);
    if (moved <= 0) continue;
    a.workers += moved;
    idle.workers -= moved;
  }
  if (!p.autoAssign) return;
  const list = p.activities;
  let bottom = list.length - 1;
  for (let i = 0; i < bottom; i++) {
    let room = roomIn(list[i]!);
    while (room > 0 && bottom > i) {
      const from = list[bottom]!;
      const data = ACTIVITY_DATA[from.id]!;
      if (from.workers === 0 || (!data.hasSlots && !data.hasPlaces)) {
        bottom--;
        continue;
      }
      const moved = Math.min(room, from.workers);
      from.workers -= moved;
      list[i]!.workers += moved;
      room -= moved;
    }
  }
}

// ---- déblocage (08 §9) ----

/**
 * Chaque activité verrouillée gagne, par tour, les ouvriers de son parent dont la production est servie en fer
 * (sortie × ouvriers par unité), jusqu'à son coût. Le joueur l'ouvre ensuite (`open_activity`, 08 §9). Parcours dans l'ordre de la table.
 */
function progressUnlock(p: Player): void {
  for (const data of ACTIVITY_DATA) {
    if (data.parent < 0 || p.unlock[data.index]! >= data.unlockCost) continue;
    const parent = activityOf(p, data.parent);
    if (parent === undefined) continue;
    if (data.unlockByPopulation) {
      p.unlock[data.index] = Math.min(data.unlockCost, Math.max(p.unlock[data.index]!, p.population));
      continue;
    }
    if (data.unlockByWorkers) {
      p.unlock[data.index] = Math.min(data.unlockCost, Math.max(p.unlock[data.index]!, parent.workers));
      continue;
    }
    const from = ACTIVITY_DATA[data.parent]!;
    const served = Math.ceil((parent.output * from.workersPerUnit) / from.unitsPerWorker);
    p.unlock[data.index] = Math.min(data.unlockCost, p.unlock[data.index]! + served);
  }
}

// ---- apparitions et disparitions (08 §6) ----

/**
 * Compteurs d'un type d'unité pour `existing` unités et la limite `limit` : les unités en trop ont chacune un compteur de
 * disparition, les unités manquantes chacune un compteur d'apparition. Quand l'écart se referme, le compteur le plus
 * récent (la dernière valeur des tableaux triés) est annulé (provisoire). Les deux tableaux restent triés : un compteur
 * ajouté finit toujours après les autres.
 */
function adjustCounters(arrivals: number[], leaves: number[], existing: number, limit: number, turn: number, arrivalTurns: number, leaveTurns: number): void {
  const excess = Math.max(0, existing - limit);
  while (leaves.length > excess) leaves.pop();
  while (leaves.length < excess) leaves.push(turn + leaveTurns);
  const missing = Math.max(0, limit - existing);
  while (arrivals.length > missing) arrivals.pop();
  while (arrivals.length < missing) arrivals.push(turn + arrivalTurns);
}

/** Retire un bonhomme (08 §6) : Inactifs d'abord, puis de l'activité la plus basse vers le haut, Blessés tout à la fin. Une caserne perd aussi sa place. */
function removePawn(p: Player): void {
  const a = takePawn(p);
  if (a !== undefined) {
    if (ACTIVITY_DATA[a.id]!.hasPlaces) a.places--;
    return;
  }
  const hurt = activityOf(p, HURT)!;
  if (hurt.workers === 0) return;
  hurt.workers--;
  p.population--;
}

function stepPopulation(p: Player, turn: number): void {
  while (p.popArrivals.length > 0 && p.popArrivals[0]! <= turn) {
    p.popArrivals.shift();
    if (p.population < p.capacity) {
      p.population++;
      activityOf(p, IDLE)!.workers++;
    }
  }
  while (p.popLeaves.length > 0 && p.popLeaves[0]! <= turn) {
    p.popLeaves.shift();
    if (p.population > p.capacity) removePawn(p);
  }
  adjustCounters(p.popArrivals, p.popLeaves, p.population, p.capacity, turn, POPULATION.arrivalTurns, POPULATION.leaveTurns);
}

/** Machines, bien par bien : une machine en trop part de sa ligne d'Inactifs, puis de son activité ; une nouvelle arrive dans Inactifs. */
function stepMachines(p: Player, turn: number): void {
  for (let g = 0; g < GOOD_COUNT; g++) {
    const arrivals = p.machineArrivals[g]!;
    const leaves = p.machineLeaves[g]!;
    const limit = machineLimit(p, g);
    while (arrivals.length > 0 && arrivals[0]! <= turn) {
      arrivals.shift();
      if (machineCount(p, g) < limit) p.idleMachines[g] = p.idleMachines[g]! + 1;
    }
    while (leaves.length > 0 && leaves[0]! <= turn) {
      leaves.shift();
      if (machineCount(p, g) > limit) {
        const host = activityOf(p, MACHINE_HOST[g]!);
        if (p.idleMachines[g]! > 0) p.idleMachines[g] = p.idleMachines[g]! - 1;
        else if (host !== undefined && host.machines > 0) host.machines--;
      }
    }
    adjustCounters(arrivals, leaves, machineCount(p, g), limit, turn, GOODS_TIMING.arrivalTurns, GOODS_TIMING.leaveTurns);
  }
}

/**
 * Ordre dans lequel les divisions en trop sont choisies (08 §6, provisoire) : d'abord celles en formation, puis les plus
 * abîmées, puis le plus grand identifiant.
 */
function leaveOrder(state: GameState): (a: Division, b: Division) => number {
  return (a, b) => Number(inFormation(state, b)) - Number(inFormation(state, a)) || a.state - b.state || b.id - a.id;
}

/** Divisions, type par type (08 §6) : sursis ajustés à l'excédent, disparitions échues, création des divisions manquantes. */
function stepDivisions(state: GameState, p: Player, turn: number): void {
  const choose = leaveOrder(state);
  let removed = false;
  for (let t = 0; t < DIVISION_DATA.length; t++) {
    const limit = divisionLimit(p, t);
    const mine = state.divisions.filter((d) => d.owner === p.id && d.type === t);
    const excess = Math.max(0, mine.length - limit);
    const marked = mine.filter((d) => d.leaveTick !== 0);
    if (marked.length > excess) {
      // Le compteur le plus récent est annulé : le plus grand tour de fin, à égalité le dernier dans l'ordre de choix.
      marked.sort((a, b) => b.leaveTick - a.leaveTick || choose(b, a));
      for (const d of marked.slice(0, marked.length - excess)) d.leaveTick = 0;
    } else if (marked.length < excess) {
      const free = mine.filter((d) => d.leaveTick === 0).sort(choose);
      for (const d of free.slice(0, excess - marked.length)) d.leaveTick = turn + DIVISION_TIMING.leaveTurns;
    }
    const gone = mine.filter((d) => d.leaveTick !== 0 && d.leaveTick <= turn);
    if (gone.length > 0) {
      const ids = new Set(gone.map((d) => d.id));
      state.divisions = state.divisions.filter((d) => !ids.has(d.id));
      removed = true;
    }
    // Un joueur éliminé n'arrive pas ici (sans ville) ; les nouvelles divisions naissent pleines, en formation.
    for (let n = divisionCount(state, p.id, t); n < divisionLimit(p, t); n++) {
      addDivision(state, p.id, t, turn + DIVISION_DATA[t]!.productionTurns);
    }
  }
  if (removed) removeEmptyBoxes(state);
}

// ---- soin (08 §5, §8) ----

/**
 * Soin d'un blessé à la fois (08 §8) : le dernier de la boîte gagne chaque tour autant de points que la population, au
 * moins `hurtHealTurnsTimesPop / hurtHealMaxTurns`, sur `hurtHealTurnsTimesPop` points. À la fin, le bonhomme passe dans
 * Inactifs (provisoire) et le suivant repart de 0.
 */
const hurtHealRate = (p: Player): number => Math.max(p.population, Math.ceil(POPULATION.hurtHealTurnsTimesPop / POPULATION.hurtHealMaxTurns));

/** Tours restants avant la fin du soin du dernier blessé, à la population actuelle (08 §8). 0 sans blessé. */
export function hurtHealTurnsLeft(p: Player): number {
  if (activityOf(p, HURT)!.workers === 0) return 0;
  return Math.ceil((POPULATION.hurtHealTurnsTimesPop - p.hurtHeal) / hurtHealRate(p));
}

function healHurt(p: Player): void {
  const hurt = activityOf(p, HURT)!;
  if (hurt.workers === 0) {
    p.hurtHeal = 0;
    return;
  }
  p.hurtHeal += hurtHealRate(p);
  if (p.hurtHeal < POPULATION.hurtHealTurnsTimesPop) return;
  p.hurtHeal = 0;
  hurt.workers--;
  activityOf(p, IDLE)!.workers++;
}

/**
 * Soin des divisions abîmées (08 §5) : hors combat, tant que le joueur a une limite pour leur type, toutes en même temps.
 * Une division en trop (en sursis) ne se soigne pas. Hors combat : ni dans une percée, ni sur un front en combat.
 */
function healDivisions(state: GameState, p: Player): void {
  const gain = Math.floor((COMBAT.healPercentPerSecond * STATE_SCALE) / (100 * COMBAT.turnsPerSecond));
  if (gain <= 0) return;
  const fighting = new Set<number>();
  for (const f of state.fronts) if (inCombat(state, f)) fighting.add(f.id);
  const limits = new Map<number, number>();
  for (const d of state.divisions) {
    if (d.owner !== p.id || d.leaveTick !== 0 || d.state >= STATE_SCALE || d.breakthrough !== 0 || fighting.has(d.front)) continue;
    let limit = limits.get(d.type);
    if (limit === undefined) {
      limit = divisionLimit(p, d.type);
      limits.set(d.type, limit);
    }
    if (limit > 0) d.state = Math.min(STATE_SCALE, d.state + gain);
  }
}
