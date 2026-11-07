// Étape de l'économie d'un joueur (Docs/Design/08-Population.md §2.1 à §6, §8) : places, capacité de population, fer,
// limites, apparitions et disparitions, soin des blessés. Les valeurs attendues sont calculées à la main d'après le
// document. Les ordres sur les activités sont dans activities.test.ts.
//
// `stepEconomy` appelée seule ne fait pas avancer `state.tick` : les compteurs ne se terminent pas. Les tests des délais
// passent par `applyTurn` (`play`). `withCity` éteint l'auto-assignation : les bonshommes restent là où le test les met.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVITY_DATA,
  ACTIVITY_IDS,
  applyIntent,
  applyTurn,
  CITY,
  createGame,
  DIVISION_DATA,
  DIVISION_TIMING,
  divisionLimit,
  ELITE_TROOPS_RATIO,
  eliteCap,
  FARMING,
  FERTILITY,
  FISHING,
  FOOD,
  FRONTS,
  GOOD_IDS,
  GOODS_TIMING,
  hurtPawns,
  idlePawns,
  inFormation,
  IRON_INDEX,
  machineCount,
  machineLimit,
  MINING,
  POPULATION,
  RESOURCES,
  slotsOf,
  STATE_SCALE,
  stepEconomy,
  TERRAIN_LAND,
  type ActivityId,
  type GameMap,
  type GameState,
  type Intent,
  type Player,
} from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";
import { box, checkCityInvariants, customMap, openBox, tileAt } from "./helpers.ts";
import { D, attack, duel, play, put, war } from "./war-helpers.ts";

const R = CITY.controlRadius;

/** Position de la première ville des tests. Cartes de 10 R × 6 R, R = rayon de contrôle. */
const CX = 5 * R;
const CY = 3 * R;
/** Terre partout, fertilité par défaut. */
const LAND_MAP = customMap(10 * R, 6 * R, () => "land");
/** Terre à gauche, océan à droite, à R / 2 de (CX, CY) : une ville en (CX, CY) a des cases d'eau dans sa zone. */
const SEA_MAP = customMap(10 * R, 6 * R, (x) => (x >= CX + Math.floor(R / 2) ? "ocean" : "land"));
/** Fertilités variées de 0 à 10 (un neuvième à peu près de cases à 0). */
const VARIED_MAP = customMap(10 * R, 6 * R, () => "land", () => false, (x, y) => (x * 7 + y * 3) % 11);
/** Fer sur une case sur dix. */
const IRON_MAP = customMap(10 * R, 6 * R, () => "land", (x, y) => (x + y) % 10 === 0);

const TRACTOR = GOOD_IDS.indexOf("tractor");

const found = (map: GameMap, player: number, x: number, y: number): Intent => ({
  type: "found_city",
  player,
  tile: tileAt(map, x, y),
});

/** Partie dont le joueur 1 a fondé sa première ville en (CX, CY), hors tour, auto-assignation éteinte : un inactif, aucune étape jouée. */
function withCity(map: GameMap, players = 1): GameState {
  const s = createGame({ seed: 1, map, playerCount: players });
  assert.ok(applyIntent(s, found(map, 1, CX, CY), []));
  s.players[0]!.autoAssign = false;
  return s;
}

const slots = (p: Player, id: ActivityId): number => slotsOf(p, ACTIVITY_DATA[ACTIVITY_IDS.indexOf(id)]!);

/** Met `workers` bonshommes dans ces activités (Inactifs compris), par écriture directe, et accorde la population. */
function assign(s: GameState, workers: Partial<Record<ActivityId, number>>): void {
  const p = s.players[0]!;
  for (const a of p.activities) a.workers = 0;
  for (const [id, n] of Object.entries(workers)) {
    const a = box(p, id as ActivityId);
    a.workers = n;
    if (ACTIVITY_DATA[a.id]!.hasPlaces) a.places = n;
  }
  p.population = p.activities.reduce((sum, a) => sum + a.workers, 0);
}

describe("places (08 §2.1)", () => {
  it("places = floor(cases / cases par travailleur) ; le reste des cases ne sert pas", () => {
    const p = withCity(LAND_MAP).players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker - 1;
    p.seaTiles = 3 * FISHING.tilesPerWorker;
    p.resourceTiles[IRON_INDEX] = 2 * MINING.tilesPerWorker + 50;
    assert.deepEqual([slots(p, "farmers"), slots(p, "fishers"), slots(p, "miners")], [2, 3, 2]);
  });

  it("usine de machines : ceil(places de l'activité × ouvriers par unité / unités par ouvrier) ; 8 places, 2 tracteurs par ouvrier : 4", () => {
    const p = withCity(LAND_MAP).players[0]!;
    p.farmTiles = 8 * FARMING.tilesPerWorker;
    assert.equal(slots(p, "tractor"), 4);
    p.farmTiles = 7 * FARMING.tilesPerWorker;
    assert.equal(slots(p, "tractor"), 4);
  });

  it("une boîte qui perd des places renvoie son trop-plein dans Inactifs : les bonshommes d'abord, puis les machines", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { farmers: 1 });
    box(p, "farmers").machines = 3;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").workers, box(p, "farmers").machines, idlePawns(p), p.idleMachines[TRACTOR]], [0, 2, 1, 1]);
    assert.equal(p.population, 1, "personne ne disparaît");
  });
});

describe("capacité de population (08 §3)", () => {
  const base = FOOD.base + FOOD.perCity;

  it("sans travailleur : base + une ville, 1 500, soit 2 bonshommes ; chaque ville ajoute 500", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    stepEconomy(s);
    assert.deepEqual([p.food, p.capacity, p.wheat, p.fish, p.cultivated, p.fished], [base, 2, 0, 0, 0, 0]);
    p.cityIds.push(99);
    stepEconomy(s);
    assert.deepEqual([p.food, p.capacity], [base + FOOD.perCity, 2]);
  });

  it("un agriculteur sur une terre de fertilité 5 donne 1,5 ; un tracteur vaut un agriculteur", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assert.equal(p.fertilitySum, FERTILITY.land * p.farmTiles);
    assign(s, { farmers: 1 });
    stepEconomy(s);
    assert.deepEqual([p.cultivated, p.wheat, p.food, p.capacity, box(p, "farmers").output], [FARMING.tilesPerWorker, 1500, base + 1500, 3, 1500]);
    box(p, "farmers").machines = 1;
    stepEconomy(s);
    assert.deepEqual([p.cultivated, p.wheat, p.food, p.capacity], [2 * FARMING.tilesPerWorker, 3000, base + 3000, 5]);
  });

  it("blé = fertilité_totale × surface / farmTiles, multiplié avant d'être divisé : il suit les fertilités de la zone, pas le nombre de cases", () => {
    const s = withCity(VARIED_MAP);
    const p = s.players[0]!;
    assign(s, { farmers: 2 });
    stepEconomy(s);
    assert.equal(p.cultivated, 600);
    assert.equal(p.wheat, Math.floor((p.fertilitySum * 600) / p.farmTiles));
    assert.ok(p.fertilitySum !== p.farmTiles * FERTILITY.land);
  });

  it("la surface s'arrête à farmTiles ; sans terre : pas de blé, sans division par zéro", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { farmers: 1 });
    p.farmTiles = 100;
    p.fertilitySum = 500;
    stepEconomy(s);
    assert.deepEqual([p.cultivated, p.wheat], [0, 0], "plus de place : l'agriculteur retourne dans Inactifs");
    box(p, "farmers").workers = 0;
    box(p, "farmers").machines = 0;
    p.farmTiles = 0;
    p.fertilitySum = 0;
    stepEconomy(s);
    assert.equal(p.wheat, 0);
  });

  it("un pêcheur plein donne 1 ; une surface incomplète donne sa part, arrondie vers le bas", () => {
    const s = withCity(SEA_MAP);
    const p = s.players[0]!;
    assert.ok(p.seaTiles >= FISHING.tilesPerWorker);
    assign(s, { fishers: 1 });
    stepEconomy(s);
    assert.deepEqual([p.fished, p.fish, p.food, p.capacity, box(p, "fishers").output], [300, 1000, base + 1000, 3, 1000]);
  });

  it("capacité = ceil(nourriture / 1 000) : 2 000 donnent 2, 2 001 donnent 3", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { farmers: 1 });
    // Avec une fertilité totale réglée à la main : blé = fertilitySum × 300 / farmTiles.
    p.farmTiles = 300;
    p.fertilitySum = 500;
    stepEconomy(s);
    assert.deepEqual([p.food, p.capacity], [2000, 2]);
    p.fertilitySum = 501;
    stepEconomy(s);
    assert.deepEqual([p.food, p.capacity], [2001, 3]);
  });
});

describe("fer (08 §4)", () => {
  /** Une ville sur la carte du fer, un mineur (1 000 de fer), des boîtes à ouvrir et leurs ouvriers, dans cet ordre. */
  function factories(...boxes: [ActivityId, number][]): GameState {
    const s = withCity(IRON_MAP);
    for (const [id] of boxes) openBox(s, 1, id);
    assign(s, { miners: 1, ...Object.fromEntries(boxes) });
    return s;
  }

  it("fer produit = min(cases de fer, travailleurs × 100) × capacité par case, pompes comprises", () => {
    const s = withCity(IRON_MAP);
    const p = s.players[0]!;
    assign(s, { miners: 2 });
    p.resourceTiles[IRON_INDEX] = 350;
    stepEconomy(s);
    assert.deepEqual([p.minedTiles, p.ironProduced, box(p, "miners").output], [200, 200 * RESOURCES.iron.capacityPerTile, 2000]);
    box(p, "miners").machines = 1;
    stepEconomy(s);
    assert.equal(p.minedTiles, 300);
    box(p, "miners").machines = 0;
    assign(s, { miners: 3 });
    p.resourceTiles[IRON_INDEX] = 299;
    stepEconomy(s);
    assert.equal(p.minedTiles, 200, "2 places : le trop-plein retourne dans Inactifs");
  });

  it("assez de fer : chaque boîte a ses unités, et réserve son fer", () => {
    const s = factories(["regulars", 4], ["militia", 3]);
    const p = s.players[0]!;
    stepEconomy(s);
    assert.deepEqual([box(p, "regulars").output, box(p, "regulars").ironUsed, box(p, "militia").output, box(p, "militia").ironUsed], [4, 200, 3, 0]);
    assert.deepEqual([p.ironWanted, p.ironReserved], [200, 200]);
  });

  it("manque de fer : même part pour toutes les boîtes, puis le fer que l'arrondi laisse va aux boîtes du haut", () => {
    // 10 réguliers (500) et 5 chenillettes (1 000) demandent 1 500 pour 1 000 : 6 et 3 unités, 900 de fer. Il reste 100 :
    // la boîte du haut prend 2 réguliers.
    const s = factories(["regulars", 10], ["tankette", 5]);
    const p = s.players[0]!;
    stepEconomy(s);
    assert.deepEqual([box(p, "regulars").output, box(p, "tankette").output], [8, 3]);
    assert.deepEqual([p.ironWanted, p.ironProduced, p.ironReserved], [1500, 1000, 1000]);
  });

  it("une boîte d'une seule unité n'est pas à zéro si elle est assez haute : l'ordre décide", () => {
    // Artillerie 1 (100), chenillettes 6 (1 200) : 1 300 pour 1 000. Part : 0 et 4 unités (800), il reste 200.
    const high = factories(["artillery", 1], ["tankette", 6]);
    stepEconomy(high);
    assert.deepEqual([box(high.players[0]!, "artillery").output, box(high.players[0]!, "tankette").output], [1, 4]);
    const low = factories(["tankette", 6], ["artillery", 1]);
    stepEconomy(low);
    assert.deepEqual([box(low.players[0]!, "artillery").output, box(low.players[0]!, "tankette").output], [0, 5]);
  });

  it("une boîte sans fer en entrée n'a pas de malus : la milice se forme sans mine", () => {
    const s = factories(["militia", 3], ["regulars", 2]);
    assign(s, { militia: 3, regulars: 2 });
    stepEconomy(s);
    const p = s.players[0]!;
    assert.deepEqual([box(p, "militia").output, box(p, "regulars").output, p.ironProduced, p.ironWanted], [3, 0, 0, 100]);
  });
});

describe("limites (08 §5)", () => {
  it("usine de machines : 2 unités par ouvrier ; caserne : une division par bonhomme ; 2 ouvriers par unité pour les chars", () => {
    const s = withCity(IRON_MAP);
    const p = s.players[0]!;
    for (const id of ["tractor", "militia", "infantryTank"] as const) openBox(s, 1, id);
    assign(s, { miners: 2, tractor: 1, militia: 3, infantryTank: 3 });
    stepEconomy(s);
    assert.equal(machineLimit(p, TRACTOR), 2);
    assert.equal(divisionLimit(s, p, D.militia), 3);
    assert.equal(divisionLimit(s, p, D.infantryTank), 1, "3 ouvriers, 2 par char");
  });

  it("une boîte verrouillée ou fermée ne donne aucune limite", () => {
    const s = withCity(IRON_MAP);
    const p = s.players[0]!;
    assert.equal(machineLimit(p, TRACTOR), 0);
    assert.equal(divisionLimit(s, p, D.regulars), 0);
  });

  it("élites : plafonnées à floor(divisions d'infanterie / ELITE_TROOPS_RATIO), élites comprises, places comprises", () => {
    assert.deepEqual([eliteCap(ELITE_TROOPS_RATIO - 1), eliteCap(ELITE_TROOPS_RATIO), eliteCap(2 * ELITE_TROOPS_RATIO + 1)], [0, 1, 2]);
    const s = duel(false);
    const p = s.players[0]!;
    p.autoAssign = false;
    openBox(s, 1, "elite");
    openBox(s, 1, "militia");
    assign(s, { miners: 0, elite: 3, militia: ELITE_TROOPS_RATIO - 1 });
    for (let i = 0; i < ELITE_TROOPS_RATIO - 1; i++) put(s, 1, "militia");
    play(s, 1);
    assert.deepEqual([box(p, "elite").places, box(p, "elite").workers, idlePawns(p)], [0, 0, 3], "9 infanteries : aucune place, ouvriers dans Inactifs");
    put(s, 1, "militia");
    assert.equal(divisionLimit(s, p, D.elite), 0, "la sortie est nulle tant qu'aucun ouvrier n'est revenu");
    box(p, "elite").output = 2;
    assert.equal(divisionLimit(s, p, D.elite), 1, "10 infanteries : plafond 1, même avec une sortie de 2");
  });
});

describe("apparition et disparition (08 §6)", () => {
  it("population : un compteur par bonhomme manquant ; il arrive dans Inactifs après arrivalTurns tours", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    play(s, 1);
    assert.deepEqual([p.capacity, p.popArrivals], [2, [1 + POPULATION.arrivalTurns]]);
    play(s, POPULATION.arrivalTurns - 1);
    assert.deepEqual([p.population, idlePawns(p)], [1, 1]);
    play(s, 1);
    assert.deepEqual([p.population, idlePawns(p)], [2, 2]);
    assert.deepEqual(p.popArrivals, []);
  });

  it("un écart qui se referme annule le compteur le plus récent : le plus ancien continue", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { farmers: 1 });
    play(s, 1);
    play(s, 1);
    assert.equal(p.capacity, 3);
    assert.deepEqual(p.popArrivals, [1 + POPULATION.arrivalTurns, 1 + POPULATION.arrivalTurns]);
    applyTurn(s, { turn: s.tick + 1, intents: [{ type: "move_pawn", player: 1, from: "farmers", to: "idle", kind: "worker", count: 1 }] });
    play(s, 1);
    assert.equal(p.capacity, 2);
    assert.deepEqual(p.popArrivals, [1 + POPULATION.arrivalTurns]);
  });

  it("population en trop : un compteur par bonhomme, leaveTurns tours, puis il disparaît ; annulé si la capacité revient", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { idle: 4 });
    play(s, 1);
    assert.deepEqual(p.popLeaves, [1 + POPULATION.leaveTurns, 1 + POPULATION.leaveTurns]);
    play(s, POPULATION.leaveTurns - 1);
    assert.equal(p.population, 4);
    play(s, 1);
    assert.deepEqual([p.population, idlePawns(p), p.popLeaves], [2, 2, []]);

    const t = withCity(LAND_MAP);
    const q = t.players[0]!;
    assign(t, { idle: 3 });
    play(t, 1);
    assert.equal(q.popLeaves.length, 1);
    box(q, "farmers").workers = 1;
    box(q, "idle").workers = 2;
    play(t, 2);
    assert.deepEqual(q.popLeaves, []);
    play(t, POPULATION.leaveTurns);
    assert.equal(q.population, 3, "personne n'est parti");
  });

  it("qui part : Inactifs d'abord, puis la boîte la plus basse (une caserne perd sa place), Blessés tout à la fin", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    openBox(s, 1, "militia");
    assign(s, { idle: 1, hurt: 1, militia: 2 });
    play(s, 1 + POPULATION.leaveTurns);
    assert.deepEqual([idlePawns(p), box(p, "militia").workers, box(p, "militia").places, hurtPawns(p), p.population], [0, 1, 1, 1, 2]);
    const t = withCity(LAND_MAP);
    assign(t, { idle: 0, hurt: 3 });
    play(t, 1 + POPULATION.leaveTurns);
    assert.deepEqual([hurtPawns(t.players[0]!), t.players[0]!.population], [2, 2]);
  });

  it("machines : arrivalTurns tours après la limite, sur leur ligne d'Inactifs ; en trop : Inactifs d'abord, puis la boîte", () => {
    const s = withCity(IRON_MAP);
    const p = s.players[0]!;
    openBox(s, 1, "tractor");
    assign(s, { miners: 1, tractor: 1 });
    play(s, GOODS_TIMING.arrivalTurns);
    assert.equal(p.idleMachines[TRACTOR], 0);
    play(s, 1);
    assert.deepEqual([p.idleMachines[TRACTOR], machineCount(p, TRACTOR)], [2, 2]);

    box(p, "farmers").machines = 1;
    p.idleMachines[TRACTOR] = 1;
    box(p, "tractor").workers = 0;
    play(s, 1);
    assert.deepEqual(p.machineLeaves[TRACTOR], [s.tick + GOODS_TIMING.leaveTurns, s.tick + GOODS_TIMING.leaveTurns]);
    play(s, GOODS_TIMING.leaveTurns);
    assert.deepEqual([p.idleMachines[TRACTOR], box(p, "farmers").machines], [0, 0]);
  });

  it("divisions : créées tout de suite dans la réserve, en formation pendant productionTurns ; la milice est quasi instantanée", () => {
    const s = withCity(IRON_MAP);
    const p = s.players[0]!;
    for (const id of ["militia", "regulars"] as const) openBox(s, 1, id);
    assign(s, { miners: 1, militia: 1, regulars: 1 });
    play(s, 1);
    assert.deepEqual(s.divisions.map((d) => [d.type, d.front, d.state, d.formedTick]), [
      [D.regulars, 0, STATE_SCALE, 1 + DIVISION_DATA[D.regulars]!.productionTurns],
      [D.militia, 0, STATE_SCALE, 1 + 1],
    ]);
    assert.ok(inFormation(s, s.divisions[0]!));
    assert.equal(s.divisions.length, divisionLimit(s, p, D.regulars) + divisionLimit(s, p, D.militia));
    play(s, 20);
    assert.equal(s.divisions.length, 2, "la limite est atteinte");
  });

  it("divisions en trop : en formation d'abord, puis les plus abîmées, puis le plus grand identifiant ; sursis de leaveTurns tours", () => {
    const s = withCity(LAND_MAP);
    openBox(s, 1, "militia");
    assign(s, { militia: 1 });
    const healthy = put(s, 1, "militia");
    const same = put(s, 1, "militia");
    const worn = put(s, 1, "militia", 0, 5000);
    const forming = put(s, 1, "militia");
    (forming as { formedTick: number }).formedTick = 1000;
    play(s, 1);
    assert.deepEqual([forming, worn, same, healthy].map((d) => d.leaveTick !== 0), [true, true, true, false]);
    play(s, DIVISION_TIMING.leaveTurns);
    assert.deepEqual(s.divisions.map((d) => d.id), [healthy.id]);
  });

  it("une limite qui remonte annule le sursis le plus récent", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    openBox(s, 1, "militia");
    assign(s, { militia: 2 });
    const [a, b] = [put(s, 1, "militia"), put(s, 1, "militia")];
    assign(s, { militia: 1 });
    play(s, 1);
    assert.deepEqual([a.leaveTick !== 0, b.leaveTick !== 0], [false, true]);
    assign(s, { militia: 2 });
    play(s, 1);
    assert.deepEqual([a.leaveTick, b.leaveTick], [0, 0]);
    assert.equal(p.population, 2);
  });

  it("soin hors combat, 2 % par seconde, tant qu'il y a une limite ; une division en trop ne se soigne pas", () => {
    const s = withCity(LAND_MAP);
    openBox(s, 1, "militia");
    assign(s, { militia: 1 });
    const worn = put(s, 1, "militia", 0, 5000);
    const excess = put(s, 1, "militia", 0, 4000);
    play(s, 10);
    assert.equal(worn.state, 5000 + 200, "20 par tour, 200 en une seconde");
    assert.equal(excess.leaveTick !== 0, true);
    assert.equal(excess.state, 4000);
  });

  it("sans limite pour son type, une division abîmée ne se soigne pas", () => {
    const s = duel();
    const d = put(s, 1, "regulars", 0, 5000);
    play(s, 10);
    assert.equal(d.state, 5000);
  });
});

describe("blessés (08 §8)", () => {
  const killed = (type: "militia" | "tankette"): GameState => {
    const s = duel();
    const p = s.players[0]!;
    openBox(s, 1, "militia");
    box(p, "militia").workers = 2;
    box(p, "militia").places = 2;
    box(p, "idle").workers = 1;
    p.population = 3;
    war(s);
    put(s, 2, "regulars", 1);
    if (type === "tankette") put(s, 1, "militia", 1);
    // Posée juste avant l'attaque, dans le même tour : avant, sa caserne la soignerait.
    put(s, 1, type, 1, type === "tankette" ? 5 : 30);
    attack(s, 2);
    return s;
  };

  it("une division d'infanterie détruite : un bonhomme de sa caserne passe à Blessés, et un inactif reprend sa place", () => {
    const s = killed("militia");
    const p = s.players[0]!;
    assert.equal(s.divisions.some((d) => d.owner === 1), false);
    assert.deepEqual([hurtPawns(p), box(p, "militia").workers, box(p, "militia").places, idlePawns(p), p.population], [1, 2, 2, 0, 3]);
  });

  it("sans inactif, la place reste vide", () => {
    const s = duel();
    const p = s.players[0]!;
    openBox(s, 1, "militia");
    box(p, "militia").workers = 1;
    box(p, "militia").places = 1;
    box(p, "idle").workers = 0;
    p.population = 1;
    war(s);
    put(s, 2, "regulars", 1);
    put(s, 1, "militia", 1, 30);
    attack(s, 2);
    assert.deepEqual([hurtPawns(p), box(p, "militia").workers, box(p, "militia").places], [1, 0, 1]);
  });

  it("une division de chars détruite ne fait aucun blessé", () => {
    const s = killed("tankette");
    assert.equal(s.divisions.some((d) => d.type === D.tankette), false);
    assert.equal(hurtPawns(s.players[0]!), 0);
  });

  it("soin : min(hurtHealMaxTurns, floor(hurtHealTurnsTimesPop / population)) tours, calculés au démarrage", () => {
    for (const [population, turns] of [[25, 4000], [10, 4000], [100, 1000], [1000, 100], [200_000, 1]] as const) {
      const s = withCity(LAND_MAP);
      const p = s.players[0]!;
      assign(s, { hurt: 1 });
      p.population = population;
      stepEconomy(s);
      assert.equal(p.hurtHealEnd, 1 + turns, `${population} bonshommes`);
    }
  });

  it("fin du soin : le bonhomme passe dans Inactifs, puis le soin suivant démarre", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    assign(s, { idle: 98, hurt: 2 });
    play(s, 1);
    assert.equal(p.hurtHealEnd, 1 + 1000);
    play(s, 999);
    assert.equal(hurtPawns(p), 2);
    play(s, 1);
    assert.equal(hurtPawns(p), 1);
    assert.ok(p.hurtHealEnd > s.tick);
  });
});

describe("totaux de fertilité tenus à jour (setOwner)", () => {
  it("farmTiles, fertilitySum et seaTiles sont ceux d'un recomptage, après chaque fondation (zones qui se volent des cases, eau, fertilités variées)", () => {
    for (const map of [SEA_MAP, VARIED_MAP]) {
      const s = createGame({ seed: 1, map, playerCount: 2 });
      for (const p of s.players) p.population = 1_000_000;
      // Deux joueurs aux zones qui se recouvrent, du bord de mer vers l'intérieur. Positions en dixièmes de R
      // (paires : exactes pour R multiple de 5), chaque ville à plus de 10 de toutes les autres et à 20 au plus
      // (rayon d'expansion) d'une ville de son joueur, sauf (60, 30) : à 10 de la première, refusée.
      const u = (v: number): number => Math.round((v * R) / 10);
      const orders: [number, number, number][] = [
        [1, 50, 30], [2, 50, 42], [1, 60, 30], [2, 38, 40], [1, 40, 20], [2, 52, 54], [1, 54, 18], [2, 30, 30],
        [1, 28, 14], [2, 40, 52], [1, 46, 8],
      ];
      orders.forEach(([player, x, y], i) => {
        const before = s.cities.length;
        applyTurn(s, { turn: i + 1, intents: [found(map, player, u(x), u(y))] });
        checkCityInvariants(s);
        assert.ok(s.cities.length <= before + 1);
      });
      assert.equal(s.cities.length, orders.length - 1, `${s.cities.length} villes`);
      assert.ok(s.players.some((p) => p.seaTiles > 0) || map !== SEA_MAP);
    }
  });

  it("une case perdue au profit d'un autre joueur sort des totaux de l'ancien propriétaire", () => {
    const s = withCity(LAND_MAP, 2);
    const a = s.players[0]!;
    const before = [a.farmTiles, a.fertilitySum];
    assert.ok(applyIntent(s, found(LAND_MAP, 2, CX + R + 1, CY), []));
    assert.ok(a.farmTiles < before[0]! && a.fertilitySum < before[1]!);
    assert.equal(a.fertilitySum, a.farmTiles * FERTILITY.land);
    assert.equal(s.players[1]!.fertilitySum, s.players[1]!.farmTiles * FERTILITY.land);
    checkCityInvariants(s);
  });

  it("le disque d'une ville seule : les totaux du joueur sont ceux des cases de sa zone", () => {
    const s = withCity(SEA_MAP);
    const p = s.players[0]!;
    const out = { tiles: 0, farm: 0, fertility: 0, water: 0 };
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const t = tileAt(SEA_MAP, CX + dx, CY + dy);
        out.tiles++;
        if (SEA_MAP.fertility[t]! > 0) out.farm++;
        out.fertility += SEA_MAP.fertility[t]!;
        if ((SEA_MAP.terrain[t]! & TERRAIN_LAND) === 0) out.water++;
      }
    }
    assert.deepEqual([p.tileCount, p.farmTiles, p.fertilitySum, p.seaTiles], [out.tiles, out.farm, out.fertility, out.water]);
  });
});

describe("parties jouées par des joueurs simulés (population, activités)", () => {
  it("garde les invariants de l'économie à chaque tour", () => {
    let maxPopulation = 0;
    const r = runScenario({
      ...DEFAULT_SCENARIO,
      turns: 3000,
      onTurn: (state, turn) => {
        // Une ville prise change les totaux de cases d'un joueur après son étape du tour : ses résultats (cases cultivées,
        // pêchées) ne sont remis d'aplomb qu'au tour suivant (05-Fronts §13.2).
        const captured = state.events.some((e) => e.type === "city_captured");
        for (const p of state.players) {
          const where = `joueur ${p.id}, tour ${turn}`;
          assert.equal(p.activities[0]!.id, ACTIVITY_IDS.indexOf("idle"), where);
          assert.equal(new Set(p.activities.map((a) => a.id)).size, p.activities.length, where);
          assert.equal(p.activities.reduce((sum, a) => sum + a.workers, 0), p.population, `somme des bonshommes, ${where}`);
          for (const a of p.activities) {
            const data = ACTIVITY_DATA[a.id]!;
            assert.ok(a.workers >= 0 && a.machines >= 0 && a.places >= 0 && a.disabled >= 0, where);
            if (data.hasPlaces) assert.ok(a.workers <= a.places, `${data.id}, ${where}`);
            if (data.hasSlots && !captured) assert.ok(a.workers + a.machines <= a.slots, `${data.id}, ${where}`);
          }
          if (p.cityIds.length === 0) continue;
          assert.ok(p.idleMachines.every((n) => n >= 0), where);
          assert.ok(p.ironReserved <= p.ironProduced, where);
          assert.equal(p.capacity, Math.ceil(p.food / POPULATION.foodPerPawn), where);
          assert.ok(captured || (p.cultivated <= p.farmTiles && p.fished <= p.seaTiles), where);
          for (const list of [p.popArrivals, p.popLeaves, ...p.machineArrivals, ...p.machineLeaves]) {
            assert.deepEqual(list, [...list].sort((x, y) => x - y), where);
          }
          ACTIVITY_DATA.forEach((a) => assert.ok(p.unlock[a.index]! <= a.unlockCost, `${a.id}, ${where}`));
          if (p.population > maxPopulation) maxPopulation = p.population;
        }
        for (const d of state.divisions) assert.ok(d.state > 0 && d.state <= STATE_SCALE, `division ${d.id}`);
      },
    });
    assert.ok(r.starvingPlayerTurns > 0, "le scénario doit aussi faire disparaître des bonshommes");
    assert.ok(maxPopulation > 10, `population maximale ${maxPopulation}`);
    assert.ok(r.totalPopulation > 0);
  });
});
