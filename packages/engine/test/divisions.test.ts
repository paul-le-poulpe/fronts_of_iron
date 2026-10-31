// Divisions hors du combat (Docs/Design/05-Fronts.md §3, §4, §13.7) : état, création, suppression, déplacement,
// renfort, excédent, rangement des lignes. Les valeurs attendues sont calculées à la main d'après 05-Fronts §3.4
// (config/divisions.ts) ; le combat est dans combat.test.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  ARMAMENT_IDS,
  FRONTS,
  inFormation,
  isMoving,
  LINE_FIRST,
  LINE_SECOND,
  shareEqually,
  stateOf,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { reinforceAfterEconomy } from "../src/placement.ts";
import { duel, front, play, put, stock, turn, war, widen } from "./war-helpers.ts";

const RIFLE = ARMAMENT_IDS.indexOf("rifle");
const MACHINE_GUN = ARMAMENT_IDS.indexOf("machineGun");

const create = (player: number, division: string): Intent => ({ type: "create_division", player, division }) as Intent;
const move = (player: number, ids: number[], frontId: number, line?: "first" | "second"): Intent =>
  ({ type: "move_division", player, ids, front: frontId, ...(line === undefined ? {} : { line }) }) as Intent;
const remove = (player: number, id: number): Intent => ({ type: "delete_division", player, id }) as Intent;
const order = (s: GameState, intent: Intent): boolean => applyIntent(s, intent, []);

describe("état d'une division (05-Fronts §3.3)", () => {
  it("somme des taux pondérés par les poids : infantrie poids 2, 2, 1 ; chenillette poids 1, 1", () => {
    const d = put(duel(), 1, "infantry");
    const cases: [number[], number][] = [
      [[1000, 1000, 100], 10000],
      [[900, 900, 90], 9000],
      // hommes 100 %, fusils 50 %, mitrailleuses 100 % : (2 + 1 + 1) / 5
      [[1000, 500, 100], 8000],
      // tous les fusils et tous les hommes, aucune mitrailleuse : (2 + 2 + 0) / 5 = 80 %
      [[1000, 1000, 0], 8000],
      [[0, 0, 0], 0],
    ];
    for (const [counts, expected] of cases) {
      d.counts.splice(0, 3, ...counts);
      assert.equal(stateOf(d), expected, counts.join(","));
    }
    const t = put(duel(), 1, "tankette");
    t.counts.splice(0, 2, 250, 25); // hommes 50 %, chars 50 %
    assert.equal(stateOf(t), 5000);
  });

  it("une division à 0 % est détruite : elle disparaît de l'état", () => {
    const s = duel();
    const dead = put(s, 1, "infantry");
    const alive = put(s, 1, "infantry");
    dead.counts.fill(0);
    turn(s);
    assert.deepEqual(s.divisions.map((d) => d.id), [alive.id]);
  });
});

describe("création d'une division (05-Fronts §3.5)", () => {
  it("refusée sans armement requis ou sans inactifs ; les mitrailleuses (optionnelles) ne sont pas demandées", () => {
    const s = duel();
    const p = s.players[0]!;
    p.idle = 5000;
    p.armamentReserve[RIFLE] = 999;
    assert.ok(!order(s, create(1, "infantry")), "999 fusils sur 1 000");
    p.armamentReserve[RIFLE] = 1000;
    p.idle = 999;
    assert.ok(!order(s, create(1, "infantry")), "999 inactifs sur 1 000");
    assert.equal(s.divisions.length, 0);
    assert.equal(s.nextDivisionId, 1);
    // Les hommes ne sont pris que parmi les inactifs, même en mobilisation forcée (provisoire).
    p.idle = 999;
    p.population = 5_000_000;
    p.forcedMobilization = true;
    assert.ok(!order(s, create(1, "infantry")));
    // Composants requis seulement : sans aucune mitrailleuse, la création est valide.
    p.idle = 1000;
    p.forcedMobilization = false;
    p.armamentReserve[MACHINE_GUN] = 0;
    assert.ok(order(s, create(1, "infantry")));
  });

  it("une division naît dans la réserve nationale, en formation, avec ses composants requis ; les optionnels partent de 0", () => {
    const s = duel();
    stock(s, 1, { infantry: 1 });
    const p = s.players[0]!;
    const [idle, rifles, guns, soldiers] = [p.idle, p.armamentReserve[RIFLE]!, p.armamentReserve[MACHINE_GUN]!, p.soldiers];
    assert.ok(order(s, create(1, "infantry")));
    const d = s.divisions[0]!;
    assert.deepEqual([d.id, d.owner, d.type, d.front, d.line, d.engaged, d.arrivalTick], [1, 1, 0, 0, LINE_SECOND, 0, 0]);
    assert.deepEqual(d.counts, [1000, 1000, 0]);
    assert.equal(d.formedTick, s.tick + 1 + FRONTS.formationTurns);
    assert.ok(inFormation(s, d));
    assert.deepEqual([p.idle, p.armamentReserve[RIFLE], p.armamentReserve[MACHINE_GUN], p.soldiers], [idle - 1000, rifles - 1000, guns, soldiers + 1000]);
  });

  it("en formation pendant formationTurns tours : ni déplacement ni suppression, puis les deux", () => {
    const s = duel();
    stock(s, 1, { infantry: 1 });
    turn(s, create(1, "infantry"));
    const d = s.divisions[0]!;
    play(s, FRONTS.formationTurns - 2);
    assert.ok(inFormation(s, d));
    assert.ok(!order(s, move(1, [d.id], front(s).id)), "déplacement refusé en formation");
    assert.ok(!order(s, remove(1, d.id)), "suppression refusée en formation");
    play(s, 1);
    assert.ok(!inFormation(s, d));
    assert.ok(order(s, move(1, [d.id], front(s).id)));
  });
});

describe("suppression d'une division (05-Fronts §3.5)", () => {
  it("dans la réserve : les hommes ne sont plus soldats, l'armement revient au stock, sans délai", () => {
    const s = duel();
    stock(s, 1, { infantry: 1 });
    turn(s, create(1, "infantry"));
    const p = s.players[0]!;
    play(s, FRONTS.formationTurns);
    // Les mitrailleuses sont arrivées par le renfort (le stock a décliné d'une au premier tour, avant le renfort).
    const guns = s.divisions[0]!.counts[2]!;
    assert.ok(guns > 0);
    assert.deepEqual([p.armamentReserve[RIFLE], p.armamentReserve[MACHINE_GUN], p.soldiers], [0, 0, 1000]);
    assert.ok(order(s, remove(1, 1)));
    assert.equal(s.divisions.length, 0);
    assert.deepEqual([p.armamentReserve[RIFLE], p.armamentReserve[MACHINE_GUN], p.soldiers], [1000, guns, 0]);
  });

  it("refusée sur un front, ou en déplacement, ou pour la division d'un autre joueur", () => {
    const s = duel();
    const onFront = put(s, 1, "infantry", front(s).id);
    const travelling = put(s, 1, "infantry");
    const theirs = put(s, 2, "infantry");
    turn(s, move(1, [travelling.id], front(s).id));
    turn(s, move(1, [travelling.id], 0));
    assert.ok(isMoving(travelling) && travelling.front === 0);
    assert.ok(!order(s, remove(1, onFront.id)));
    assert.ok(!order(s, remove(1, travelling.id)));
    assert.ok(!order(s, remove(1, theirs.id)));
    assert.equal(s.divisions.length, 3);
  });
});

describe("déplacement (05-Fronts §4.4, §5.2)", () => {
  it("réserve → front : transferRounds × combatTurns tours de trajet, sans combattre, puis en première ligne", () => {
    const s = duel();
    const d = put(s, 1, "infantry");
    turn(s, move(1, [d.id], front(s).id, "first"));
    const sent = s.tick;
    const travel = FRONTS.transferRounds * FRONTS.combatTurns;
    assert.equal(travel, 100);
    assert.deepEqual([d.front, d.arrivalTick], [front(s).id, sent + travel]);
    play(s, travel - 1);
    assert.ok(isMoving(d), "toujours en route au tour qui précède l'arrivée");
    assert.equal(d.engaged, 0, "en route, elle ne compte pas pour le remplissage");
    play(s, 1);
    assert.ok(!isMoving(d));
    assert.deepEqual([d.arrivalTick, d.line, d.engaged], [0, LINE_FIRST, 1000]);
  });

  it("front → réserve : le même délai", () => {
    const s = duel();
    const d = put(s, 1, "infantry", front(s).id);
    turn(s, move(1, [d.id], 0));
    assert.deepEqual([d.front, d.line, d.engaged, d.arrivalTick], [0, LINE_SECOND, 0, s.tick + 100]);
  });

  it("entre les deux lignes d'un même front : sans délai, la ligne demandée est prise tout de suite", () => {
    const s = duel();
    const a = put(s, 1, "infantry", front(s).id);
    const b = put(s, 1, "infantry", front(s).id);
    turn(s);
    assert.deepEqual([a.line, b.line], [LINE_FIRST, LINE_SECOND], "ex æquo : le plus petit identifiant tient la largeur");
    assert.ok(order(s, move(1, [a.id], front(s).id, "second")));
    assert.ok(order(s, move(1, [b.id], front(s).id, "first")));
    assert.deepEqual([a.arrivalTick, b.arrivalTick, a.front, b.front], [0, 0, front(s).id, front(s).id]);
    assert.deepEqual([a.line, b.line], [LINE_SECOND, LINE_FIRST]);
    turn(s);
    assert.deepEqual([a.line, b.line, a.engaged, b.engaged], [LINE_SECOND, LINE_FIRST, 0, 1000], "la division déjà en première ligne garde sa place");
  });

  it("les divisions invalides de la liste sont ignorées, les autres déplacées", () => {
    const s = duel();
    const mine = put(s, 1, "infantry");
    const theirs = put(s, 2, "infantry");
    assert.ok(order(s, move(1, [theirs.id, mine.id, mine.id, 99], front(s).id)));
    assert.equal(mine.front, front(s).id);
    assert.equal(theirs.front, 0);
    assert.ok(!order(s, move(1, [theirs.id], front(s).id)), "aucune division valide : sans effet");
  });
});

describe("renfort (05-Fronts §4.3)", () => {
  it("le surplus du stock est partagé à parts égales ; le reste va aux plus petits identifiants", () => {
    assert.deepEqual(shareEqually(301, [500, 500]), [151, 150]);
    assert.deepEqual(shareEqually(10, [5, 5, 5]), [4, 3, 3]);
    assert.deepEqual(shareEqually(2, [5, 5, 5]), [1, 1, 0]);
    // plafonné au besoin de chacun, le surplus est repartagé entre ceux qui en manquent encore
    assert.deepEqual(shareEqually(400, [500, 100]), [300, 100]);
    assert.deepEqual(shareEqually(1000, [3, 0, 4]), [3, 0, 4]);
    assert.deepEqual(shareEqually(0, [5, 5]), [0, 0]);
  });

  it("deux divisions de la réserve manquent de 500 fusils chacune, 301 en stock : 151 et 150, et les hommes en trop sont rendus", () => {
    const s = duel();
    const a = put(s, 1, "infantry");
    const b = put(s, 1, "infantry");
    for (const d of [a, b]) d.counts.splice(0, 3, 500, 500, 50);
    const p = s.players[0]!;
    p.idle = 100_000;
    p.armamentReserve[RIFLE] = 301;
    reinforceAfterEconomy(s);
    // hommes +500 chacun, puis ramenés au taux de soldats ; les mitrailleuses (50 ≤ 65) restent à 50
    assert.deepEqual(a.counts, [651, 651, 50]);
    assert.deepEqual(b.counts, [650, 650, 50]);
    assert.equal(p.armamentReserve[RIFLE], 0);
    assert.equal(p.soldiers, 1301);
  });

  it("l'armement d'une division presque pleine est plafonné à son besoin, le reste va aux autres", () => {
    const s = duel();
    const a = put(s, 1, "infantry");
    const b = put(s, 1, "infantry");
    a.counts.splice(0, 3, 500, 500, 50); // manque 500 fusils
    b.counts.splice(0, 3, 900, 900, 90); // manque 100 fusils
    const p = s.players[0]!;
    p.idle = 100_000;
    p.armamentReserve[RIFLE] = 400; // 200 chacun, plafonné à 100 pour b : a reçoit 300
    reinforceAfterEconomy(s);
    assert.deepEqual(a.counts, [800, 800, 50]);
    assert.deepEqual(b.counts, [1000, 1000, 90]);
  });

  it("pas de renfort en première ligne pendant un combat, mais la seconde ligne en reçoit", () => {
    const s = duel();
    war(s, 1);
    const first = put(s, 1, "infantry", front(s).id);
    const second = put(s, 1, "infantry", front(s).id);
    for (const d of [first, second]) d.counts.splice(0, 3, 900, 900, 90);
    first.line = LINE_FIRST;
    first.engaged = 1000;
    const p = s.players[0]!;
    p.idle = 100_000;
    p.armamentReserve[RIFLE] = 100;
    p.armamentReserve[MACHINE_GUN] = 10;
    reinforceAfterEconomy(s);
    assert.deepEqual(first.counts, [900, 900, 90]);
    assert.deepEqual(second.counts, [1000, 1000, 100]);
  });

  it("sans combat (aucune attaque), la première ligne se renforce aussi", () => {
    const s = duel();
    war(s);
    const first = put(s, 1, "infantry", front(s).id);
    const second = put(s, 1, "infantry", front(s).id);
    for (const d of [first, second]) d.counts.splice(0, 3, 900, 900, 90);
    first.line = LINE_FIRST;
    first.engaged = 1000;
    const p = s.players[0]!;
    p.idle = 100_000;
    p.armamentReserve[RIFLE] = 100; // 50 chacune
    p.armamentReserve[MACHINE_GUN] = 10; // 5 chacune
    reinforceAfterEconomy(s);
    assert.deepEqual(first.counts, [950, 950, 95]);
    assert.deepEqual(second.counts, [950, 950, 95]);
  });

  it("pas de renfort pour une division en déplacement ni en fuite", () => {
    const s = duel();
    const travelling = put(s, 1, "infantry");
    const fleeing = put(s, 1, "infantry");
    for (const d of [travelling, fleeing]) d.counts.splice(0, 3, 900, 900, 90);
    travelling.arrivalTick = s.tick + 50;
    fleeing.fleeUntilTick = s.tick + 50;
    const p = s.players[0]!;
    p.idle = 100_000;
    p.armamentReserve[RIFLE] = 100;
    reinforceAfterEconomy(s);
    assert.deepEqual(travelling.counts, [900, 900, 90]);
    assert.deepEqual(fleeing.counts, [900, 900, 90]);
    assert.equal(p.armamentReserve[RIFLE], 100);
  });
});

describe("pas d'excédent (05-Fronts §3.2)", () => {
  it("ce qui dépasse le taux de soldats retourne au stock (équipement) ou à la population (hommes), à chaque tour", () => {
    const s = duel();
    const d = put(s, 1, "infantry");
    d.counts.splice(0, 3, 1000, 500, 100); // fusils à 50 % : 500 soldats
    const p = s.players[0]!;
    p.armamentReserve[MACHINE_GUN] = 0;
    turn(s);
    assert.deepEqual(d.counts, [500, 500, 50]);
    assert.equal(p.armamentReserve[MACHINE_GUN], 50);
    assert.equal(p.soldiers, 500);
  });
});

describe("rangement des lignes (05-Fronts §4.2)", () => {
  it("chaque niche a sa première ligne ; une division plus large que la place n'est engagée qu'en partie ; le reste attend", () => {
    const s = duel(); // front d'une liaison : 1 000
    const infantry = put(s, 1, "infantry", front(s).id);
    const spareInfantry = put(s, 1, "infantry", front(s).id);
    const artillery = put(s, 1, "artillery", front(s).id); // largeur 5 : engagée à 1 000 / 5 000 = 20 %
    const spareArtillery = put(s, 1, "artillery", front(s).id);
    const tankette = put(s, 1, "tankette", front(s).id); // largeur 2 : 1 000 / 2 000
    turn(s);
    const rows = [infantry, spareInfantry, artillery, spareArtillery, tankette].map((d) => [d.line, d.engaged]);
    assert.deepEqual(rows, [
      [LINE_FIRST, 1000],
      [LINE_SECOND, 0],
      [LINE_FIRST, 1000],
      [LINE_SECOND, 0],
      [LINE_FIRST, 1000],
    ]);
  });

  it("une division n'occupe que la largeur qui reste : trois infanteries sur un front de deux liaisons", () => {
    const s = duel();
    widen(s, 2); // un front de deux liaisons
    const f = front(s);
    const divs = [1, 2, 3].map(() => put(s, 1, "infantry", f.id));
    const tank = put(s, 1, "tankette", f.id);
    turn(s);
    assert.deepEqual(divs.map((d) => d.engaged), [1000, 1000, 0]);
    assert.deepEqual(divs.map((d) => d.line), [LINE_FIRST, LINE_FIRST, LINE_SECOND]);
    assert.equal(tank.engaged, 2000, "la chenillette (largeur 2) tient toute la ligne des chars");
  });

  it("appui-feu sans infanterie engagée : seconde ligne ; il remonte aussitôt que l'infanterie arrive", () => {
    const s = duel();
    const artillery = put(s, 1, "artillery", front(s).id);
    turn(s);
    assert.deepEqual([artillery.line, artillery.engaged], [LINE_SECOND, 0]);
    const infantry = put(s, 1, "infantry", front(s).id);
    turn(s);
    assert.deepEqual([infantry.line, artillery.line, artillery.engaged], [LINE_FIRST, LINE_FIRST, 1000]);
    // l'infanterie repart : l'artillerie repasse en seconde ligne
    infantry.arrivalTick = s.tick + 50;
    turn(s);
    assert.deepEqual([artillery.line, artillery.engaged], [LINE_SECOND, 0]);
  });

  it("ordre de choix : meilleur état d'abord ; une division abîmée tient toute sa largeur", () => {
    const s = duel();
    const worn = put(s, 1, "infantry", front(s).id);
    worn.counts.splice(0, 3, 900, 900, 90);
    const fresh = put(s, 1, "infantry", front(s).id);
    turn(s);
    assert.deepEqual([worn.line, fresh.line], [LINE_SECOND, LINE_FIRST]);
    s.divisions = [worn];
    worn.counts.splice(0, 3, 300, 300, 30);
    turn(s);
    assert.deepEqual([worn.line, worn.engaged], [LINE_FIRST, 1000]);
  });

  it("une division en fuite ne revient pas en première ligne avant la fin de sa fuite", () => {
    const s = duel();
    const d = put(s, 1, "infantry", front(s).id);
    const until = s.tick + 4;
    d.fleeUntilTick = until; // en fuite aux tours `until - 3`, `until - 2` et `until - 1`
    turn(s);
    play(s, 2);
    assert.deepEqual([d.line, d.engaged], [LINE_SECOND, 0]);
    turn(s);
    assert.deepEqual([d.line, d.engaged], [LINE_FIRST, 1000]);
  });
});
