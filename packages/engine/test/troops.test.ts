// Affectation des troupes (Docs/Design/05-Fronts.md §4, §13.7) : recrutement, niches, plafond
// de l'infanterie, interrupteur à trois positions, priorités et paliers, seconde ligne,
// délai de transfert, unités en route, réassignation, mobilisation forcée, déclin du stock.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  assignTroops,
  countSoldiers,
  createGame,
  FRONTS,
  splitProportional,
  stepEconomy,
  workersNeeded,
  type GameState,
} from "../src/index.ts";
import { customMap, tileAt } from "./helpers.ts";
import { arm, at, duel, found, front, IRON_MAP, MAP, play, R, stock, turn, U } from "./war-helpers.ts";

const order = (s: GameState, intent: Record<string, unknown>): boolean => applyIntent(s, intent as never, []);

/** Premier camp du front 0 : [première ligne, seconde ligne] d'un type. */
const lines = (s: GameState, unit: keyof typeof U, side = 0, i = 0): [number, number] => [
  front(s, i).sides[side]!.firstLine[U[unit]]!,
  front(s, i).sides[side]!.secondLine[U[unit]]!,
];

/** Joue assez de tours pour que tout mouvement soit arrivé. */
const settle = (s: GameState): void => play(s, FRONTS.transferTurns + 5);

describe("répartition de parts entières", () => {
  it("partie entière, puis une unité de plus aux plus grands restes, à égalité au plus petit indice", () => {
    assert.deepEqual(splitProportional(10, [1, 1, 1]), [4, 3, 3]);
    assert.deepEqual(splitProportional(5, [2, 1]), [3, 2]);
    assert.deepEqual(splitProportional(7, [0, 3, 0, 4]), [0, 3, 0, 4]);
    assert.deepEqual(splitProportional(4, [0, 0]), [0, 0]);
    assert.deepEqual(splitProportional(0, [3, 4]), [0, 0]);
  });
});

describe("remplissage d'un front (05-Fronts §4.2)", () => {
  it("l'équipement est plafonné par l'infanterie, niche par niche ; le reste reste en stock", () => {
    const s = duel();
    // 300 infanteries = 3 000 m sur 5 000 m ; mitrailleuses (10 m) : au plus 300 ; artillerie (100 m) : au plus 30.
    arm(s, 1, { infantry: 300, machineGun: 400, artillery: 10 });
    settle(s);
    assert.deepEqual(lines(s, "infantry"), [300, 0]);
    assert.deepEqual(lines(s, "machineGun"), [300, 0], "plafond : autant de mètres que l'infanterie");
    assert.deepEqual(lines(s, "artillery"), [10, 0]);
    // 100 mitrailleuses n'ont pas de place : seconde ligne plafonnée par l'infanterie de la seconde ligne (aucune), donc en stock
    // (où elles déclinent : l'équipement déployé compte dans le stock, l'excès est grand).
    assert.ok(s.players[0]!.armamentReserve[1]! <= 100);
    assert.equal(countSoldiers(s, 1), s.players[0]!.soldiers);
  });

  it("l'infanterie en trop passe en seconde ligne, sans limite de nombre", () => {
    const s = duel();
    arm(s, 1, { infantry: 700, machineGun: 400 });
    settle(s);
    assert.deepEqual(lines(s, "infantry"), [500, 200], "500 × 10 m = la largeur du front, le reste en seconde ligne");
    assert.deepEqual(lines(s, "machineGun"), [400, 0]);
  });

  it("interrupteur : priorité seconde ligne, équilibré", () => {
    const s = duel();
    const id = front(s).id;
    assert.ok(order(s, { type: "set_unit_line_mode", player: 1, front: id, unit: "infantry", mode: "second" }));
    arm(s, 1, { infantry: 300, machineGun: 400 });
    settle(s);
    assert.deepEqual(lines(s, "infantry"), [0, 300]);
    // Plus d'infanterie en première ligne : aucun équipement en première ligne ; seconde ligne plafonnée par 300 × 10 m.
    assert.deepEqual(lines(s, "machineGun"), [0, 300]);
    // Équilibré : a = floor(u × w2 / (w1 + w2)) = 150 dans chaque ligne (largeurs de front et de percée égales à 10 m).
    assert.ok(order(s, { type: "set_unit_line_mode", player: 1, front: id, unit: "infantry", mode: "balanced" }));
    assert.deepEqual(lines(s, "infantry"), [150, 150], "changement d'interrupteur sans délai");
    // Le camp est recalé : l'infanterie de la première ligne plafonne maintenant l'équipement (150 × 10 m).
    assert.deepEqual(lines(s, "machineGun"), [150, 150]);
  });

  it("une unité en route compte déjà comme présente ; elle arrive après transferTurns tours", () => {
    const s = duel();
    arm(s, 1, { infantry: 100 });
    const f = front(s);
    const sent = (): number => f.sides[0]!.transfers.reduce((n, t) => n + t.count, 0);
    assert.equal(sent(), 100);
    assert.equal(f.sides[0]!.firstLine[U.infantry], 0, "rien n'est arrivé");
    // Sans cela, la répartition renverrait le même manque à chaque tour : jamais plus que le matériel donné.
    play(s, FRONTS.transferTurns - 1);
    assert.equal(sent(), 100, "aucune unité de plus n'est partie");
    assert.equal(f.sides[0]!.firstLine[U.infantry], 0, "avant le délai");
    play(s, 2);
    assert.equal(f.sides[0]!.firstLine[U.infantry]! + f.sides[0]!.secondLine[U.infantry]!, 100, "tout est arrivé");
    assert.equal(f.sides[0]!.transfers.length, 0);
    assert.equal(s.players[0]!.soldiers, countSoldiers(s, 1));
  });

  it("les soldats comptent dans la population mais ne travaillent pas", () => {
    const s = duel();
    arm(s, 1, { infantry: 100 }, 20_000);
    play(s, FRONTS.transferTurns + 4);
    const p = s.players[0]!;
    assert.equal(p.soldiers, 1000);
    const population = p.population;
    turn(s);
    // Les rôles du dernier tour, soldats compris, sont la population du début de l'étape.
    assert.equal(p.farmers + p.fishers + p.idle + p.factoryWorkers + p.miners + p.soldiers, population);
    assert.ok(p.farmers + p.fishers + p.idle + p.factoryWorkers + p.miners <= population - 1000, "le travail se répartit sur la population moins les soldats");
  });
});

describe("priorités et paliers (05-Fronts §4.3)", () => {
  /** Joueur 1 au centre, relié à trois adversaires : trois fronts d'une connexion chacun. */
  function star(): GameState {
    const s = createGame({ seed: 2, map: MAP, playerCount: 4 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(14, 10)), found(2, at(11, 10)), found(3, at(17, 10)), found(4, at(14, 13.4)));
    assert.equal(s.fronts.length, 3);
    return s;
  }

  it("un palier : chaque front reçoit au prorata de son manque (100 % : 500, 50 % : 250 → 2/3, 1/3)", () => {
    const s = star();
    assert.ok(order(s, { type: "set_front_priority", player: 1, front: s.fronts[1]!.id, priority: 1 }));
    arm(s, 1, { infantry: 600 });
    settle(s);
    const own = s.fronts.map((f) => f.sides[f.players[0] === 1 ? 0 : 1]!.firstLine[U.infantry]! + f.sides[f.players[0] === 1 ? 0 : 1]!.secondLine[U.infantry]!);
    // Fronts 1, 2, 3 : priorités 100 %, 50 %, 100 % : besoins visés 500, 250, 500 au premier palier ; 600 à répartir.
    assert.equal(own.reduce((a, b) => a + b, 0), 600);
    assert.ok(own[1]! < own[0]! && own[1]! < own[2]!, `le front à 50 % reçoit moins : ${own}`);
    assert.ok(Math.abs(own[0]! - own[2]!) <= 1, "les fronts de même priorité reçoivent la même chose");
  });

  it("seconde ligne : cible proportionnelle à pourcentage × largeur (150 chenillettes, 100 %, 50 %, 0 % → 100, 50, 0)", () => {
    const s = star();
    const ids = s.fronts.map((f) => f.id);
    ids.forEach((id, k) => {
      assert.ok(order(s, { type: "set_front_priority", player: 1, front: id, priority: k }));
      assert.ok(order(s, { type: "set_unit_line_mode", player: 1, front: id, unit: "tankette", mode: "second" }));
    });
    arm(s, 1, { tankette: 150 });
    settle(s);
    const second = s.fronts.map((f) => f.sides[f.players[0] === 1 ? 0 : 1]!.secondLine[U.tankette]!);
    assert.deepEqual(second, [100, 50, 0]);
  });

  it("tous les fronts à 0 % : partage égal", () => {
    const s = star();
    s.fronts.forEach((f) => {
      assert.ok(order(s, { type: "set_front_priority", player: 1, front: f.id, priority: 2 }));
      assert.ok(order(s, { type: "set_unit_line_mode", player: 1, front: f.id, unit: "tankette", mode: "second" }));
    });
    arm(s, 1, { tankette: 150 });
    settle(s);
    assert.deepEqual(s.fronts.map((f) => f.sides[f.players[0] === 1 ? 0 : 1]!.secondLine[U.tankette]!), [50, 50, 50]);
  });
});

describe("réassignation et mobilisation forcée (05-Fronts §4.1, §4.4)", () => {
  it("la réassignation renvoie le surplus d'un front vers la réserve, qui le donne à un front qui en manque", () => {
    const s = createGame({ seed: 2, map: MAP, playerCount: 3 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(14, 10)), found(2, at(11, 10)), found(3, at(17, 10)));
    const [a, b] = s.fronts.map((f) => f.id) as [number, number];
    assert.ok(order(s, { type: "set_front_priority", player: 1, front: a, priority: 0 }));
    assert.ok(order(s, { type: "set_front_priority", player: 1, front: b, priority: 2 }));
    arm(s, 1, { infantry: 100 });
    settle(s);
    const mine = (id: number): number => {
      const f = s.fronts.find((x) => x.id === id)!;
      const side = f.sides[f.players[0] === 1 ? 0 : 1]!;
      return side.firstLine[U.infantry]! + side.secondLine[U.infantry]!;
    };
    assert.deepEqual([mine(a), mine(b)], [100, 0], "le front prioritaire reçoit tout");
    // Les priorités s'inversent : sans réassignation, rien ne bouge.
    assert.ok(order(s, { type: "set_front_priority", player: 1, front: a, priority: 2 }));
    assert.ok(order(s, { type: "set_front_priority", player: 1, front: b, priority: 0 }));
    play(s, 300);
    assert.deepEqual([mine(a), mine(b)], [100, 0]);
    // Avec la réassignation, les unités passent par la réserve (retour, puis départ : deux délais de transfert).
    assert.ok(order(s, { type: "set_front_reassign", player: 1, front: a, enabled: true }));
    play(s, 300);
    assert.ok(mine(b) > 0, `le front prioritaire reçoit des unités (${mine(b)})`);
    assert.ok(mine(a) < 100);
    assert.equal(s.players[0]!.soldiers, countSoldiers(s, 1));
  });

  it("mobilisation forcée : recrutement avant l'économie, premier palier de la première ligne seulement", () => {
    const s = duel();
    stock(s, 1, { infantry: 700 });
    const p = s.players[0]!;
    assert.equal(assignTroops(s, p, 10_000, true), 5000, "500 infanteries (première ligne à 100 %), pas de seconde ligne");
    assert.equal(p.soldiers, 5000);
    assert.equal(p.armamentReserve[0], 2000, "200 infanteries restent en stock");
    // Le recrutement normal prend le reste, seconde ligne comprise.
    assert.equal(assignTroops(s, p, 10_000, false), 2000);
    assert.equal(p.armamentReserve[0], 0);
  });

  it("l'ordre set_forced_mobilization change l'interrupteur du joueur", () => {
    const s = duel();
    assert.equal(s.players[0]!.forcedMobilization, false);
    assert.ok(order(s, { type: "set_forced_mobilization", player: 1, enabled: true }));
    assert.equal(s.players[0]!.forcedMobilization, true);
    stock(s, 1, { infantry: 100 }, 2000);
    turn(s);
    assert.ok(s.players[0]!.soldiers > 0, "les soldats sont recrutés dès le premier tour");
    assert.ok(R > 0);
  });
});

describe("déclin du stock d'armement avec l'équipement déployé (05-Fronts §4.6)", () => {
  /** Joueur 1 avec une usine d'une ligne de fusils (stock cible 1 ligne × 10 × 100 = 1 000) et `infantry` unités sur le front. */
  function withFactory(infantry: number, population: number): GameState {
    const s = duel(IRON_MAP);
    assert.ok(applyIntent(s, { type: "build_factory", player: 1, city: 1, factoryType: "infantryArmament" }, []));
    front(s).sides[0]!.firstLine[U.infantry] = infantry;
    s.players[0]!.soldiers = infantry * 10;
    s.players[0]!.population = population;
    s.players[0]!.armamentReserve.fill(0);
    s.players[0]!.armamentReserve[0] = 300;
    return s;
  }

  it("l'équipement des fronts compte dans le stock : l'excès décline, sur l'équipement non déployé", () => {
    const s = withFactory(500, 100_000);
    const p = s.players[0]!;
    stepEconomy(s);
    // 300 + 10 produits = 310 en réserve, 5 000 déployés : excès 5 310 − 1 000 = 4 310 ; 1 % = 43 de perdus, reste 1 000 / 10 000.
    assert.equal(p.armamentReserve[0], 310 - 43);
    assert.equal(p.armamentRemainder[0], 1000);
    assert.equal(front(s).sides[0]!.firstLine[U.infantry], 500, "l'équipement déployé ne décline pas");
  });

  it("si les fronts dépassent à eux seuls le stock cible, le stock non déployé décline vers zéro et la production continue", () => {
    const s = withFactory(50_000, 800_000);
    const p = s.players[0]!;
    stepEconomy(s);
    assert.equal(p.armamentReserve[0], 0);
    assert.equal(p.armamentRemainder[0], 0);
    assert.equal(p.factories[0]!.groups[0]!.filled, 1, "la ligne produit encore");
  });
});

describe("retrait des troupes quand le pays manque de personnes (05-Fronts §4.7)", () => {
  /** Joueur 1 avec 100 infanteries, 100 mitrailleuses et 5 chenillettes sur le front, population saturant ses champs. */
  function army(): GameState {
    const s = duel();
    arm(s, 1, { infantry: 100, machineGun: 100, tankette: 5 }, 20_000);
    play(s, FRONTS.transferTurns + 4);
    assert.equal(s.players[0]!.soldiers, 1000 + 100 + 50);
    return s;
  }

  it("les soldats passent après les champs : on retire d'abord l'infanterie, l'équipement suit, les chars restent", () => {
    const s = army();
    const p = s.players[0]!;
    // La population des champs saturés : au-delà, tout est libre pour les soldats. Un manque de 550 personnes.
    p.population = workersNeeded(p) + 600;
    turn(s);
    const side = front(s).sides[0]!;
    assert.equal(side.firstLine[U.infantry]! + side.secondLine[U.infantry]!, 100 - 55, "55 infanteries retirées");
    assert.equal(side.firstLine[U.machineGun], 45, "l'équipement est recalé sur l'infanterie restante");
    assert.equal(side.firstLine[U.tankette]! + side.secondLine[U.tankette]!, 5, "les chars sont retirés en dernier");
    assert.ok(side.transfers.some((t) => !t.toFront && t.unit === U.infantry), "retour vers la réserve avec le délai");
    assert.equal(p.soldiers, countSoldiers(s, 1));
    // Deux tours de suite ne retirent pas deux fois les mêmes personnes.
    const inTransit = side.transfers.reduce((n, t) => n + t.count, 0);
    turn(s);
    assert.equal(side.transfers.reduce((n, t) => n + t.count, 0), inTransit);
  });

  it("en mobilisation forcée, les soldats passent d'abord : rien n'est retiré", () => {
    const s = army();
    const p = s.players[0]!;
    p.forcedMobilization = true;
    p.population = workersNeeded(p) + 600;
    turn(s);
    assert.equal(p.soldiers, 1150);
  });
});
