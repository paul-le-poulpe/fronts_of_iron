// Divisions hors du combat (Docs/Design/05-Fronts.md §3, §4 ; 08-Population.md §5, §6) : barre de vie, formation,
// déplacement, rangement des lignes. Les limites et les apparitions sont dans economy.test.ts, le combat dans
// combat.test.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  attackOf,
  DIVISION_DATA,
  FRONTS,
  inFormation,
  IRON_INDEX,
  isMoving,
  LINE_FIRST,
  LINE_SECOND,
  stateOf,
  STATE_SCALE,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { box, openBox } from "./helpers.ts";
import { D, duel, front, play, put, turn, widen } from "./war-helpers.ts";

const move = (player: number, ids: number[], frontId: number, line?: "first" | "second"): Intent =>
  ({ type: "move_division", player, ids, front: frontId, ...(line === undefined ? {} : { line }) }) as Intent;
const order = (s: GameState, intent: Intent): boolean => applyIntent(s, intent, []);

describe("barre de vie d'une division (08 §5)", () => {
  it("l'état est la barre de vie ; une division posée est pleine", () => {
    const d = put(duel(), 1, "regulars");
    assert.equal(stateOf(d), STATE_SCALE);
    d.state = 2500;
    assert.equal(stateOf(d), 2500);
  });

  it("attaques : celles de sa définition × son état × la part engagée × le multiplicateur, en millièmes de point", () => {
    const d = put(duel(), 1, "regulars");
    d.engaged = 1000;
    assert.deepEqual(attackOf(d, 100), { soft: 1_500_000, hard: 100_000 });
    assert.deepEqual(attackOf(d, 50), { soft: 750_000, hard: 50_000 });
    d.state = 5000;
    assert.deepEqual(attackOf(d, 100), { soft: 750_000, hard: 50_000 });
    d.state = 0;
    assert.deepEqual(attackOf(d, 100), { soft: 0, hard: 0 });
  });
});

describe("formation (08 §6)", () => {
  it("en formation pendant productionTurns tours : pas de déplacement, puis oui", () => {
    const s = duel(false);
    const p = s.players[0]!;
    p.autoAssign = false;
    const regulars = openBox(s, 1, "regulars");
    regulars.workers = 1;
    regulars.places = 1;
    box(p, "miners").workers = 1;
    p.resourceTiles[IRON_INDEX] = 100;
    p.population = 2;
    turn(s);
    const d = s.divisions[0]!;
    assert.deepEqual([d.owner, d.type, d.front, d.line, d.engaged, d.arrivalTick, d.state], [1, D.regulars, 0, LINE_SECOND, 0, 0, STATE_SCALE]);
    assert.equal(d.formedTick, s.tick + DIVISION_DATA[D.regulars]!.productionTurns);
    play(s, DIVISION_DATA[D.regulars]!.productionTurns - 2);
    assert.ok(inFormation(s, d));
    assert.ok(!order(s, move(1, [d.id], front(s).id)), "déplacement refusé en formation");
    play(s, 1);
    assert.ok(!inFormation(s, d));
    assert.ok(order(s, move(1, [d.id], front(s).id)));
  });
});

describe("déplacement (05-Fronts §4.4, §5.2)", () => {
  it("réserve → front : transferRounds × combatTurns tours de trajet, sans combattre, puis en première ligne", () => {
    const s = duel();
    const d = put(s, 1, "regulars");
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

  it("front → réserve : sans délai ; le délai est payé à la réaffectation vers un front", () => {
    const s = duel();
    const d = put(s, 1, "regulars", front(s).id);
    turn(s, move(1, [d.id], 0));
    assert.deepEqual([d.front, d.line, d.engaged, d.arrivalTick], [0, LINE_SECOND, 0, 0]);
    turn(s, move(1, [d.id], front(s).id, "first"));
    assert.deepEqual([d.front, d.arrivalTick], [front(s).id, s.tick + 100]);
  });

  it("en route vers un front puis rappelée à la réserve : sans délai", () => {
    const s = duel();
    const d = put(s, 1, "regulars");
    turn(s, move(1, [d.id], front(s).id, "first"));
    assert.ok(isMoving(d));
    turn(s, move(1, [d.id], 0));
    assert.deepEqual([d.front, d.arrivalTick], [0, 0]);
  });

  it("entre les deux lignes d'un même front : sans délai, la ligne demandée est prise tout de suite", () => {
    const s = duel();
    const a = put(s, 1, "regulars", front(s).id);
    const b = put(s, 1, "regulars", front(s).id);
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
    const mine = put(s, 1, "regulars");
    const theirs = put(s, 2, "regulars");
    assert.ok(order(s, move(1, [theirs.id, mine.id, mine.id, 99], front(s).id)));
    assert.equal(mine.front, front(s).id);
    assert.equal(theirs.front, 0);
    assert.ok(!order(s, move(1, [theirs.id], front(s).id)), "aucune division valide : sans effet");
  });
});

describe("rangement des lignes (05-Fronts §4.2)", () => {
  it("chaque niche a sa première ligne ; une division plus large que la place n'est engagée qu'en partie ; le reste attend", () => {
    const s = duel(); // front d'une liaison : 1 000
    const infantry = put(s, 1, "regulars", front(s).id);
    const spareInfantry = put(s, 1, "regulars", front(s).id);
    const artillery = put(s, 1, "artillery", front(s).id); // largeur 3 : engagée à 1 000 / 3 000
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
    const divs = [1, 2, 3].map(() => put(s, 1, "regulars", f.id));
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
    const infantry = put(s, 1, "regulars", front(s).id);
    turn(s);
    assert.deepEqual([infantry.line, artillery.line, artillery.engaged], [LINE_FIRST, LINE_FIRST, 1000]);
    // l'infanterie repart : l'artillerie repasse en seconde ligne
    infantry.arrivalTick = s.tick + 50;
    turn(s);
    assert.deepEqual([artillery.line, artillery.engaged], [LINE_SECOND, 0]);
  });

  it("ordre de choix : meilleur état d'abord ; une division abîmée tient toute sa largeur", () => {
    const s = duel();
    const worn = put(s, 1, "regulars", front(s).id, 9000);
    const fresh = put(s, 1, "regulars", front(s).id);
    turn(s);
    assert.deepEqual([worn.line, fresh.line], [LINE_SECOND, LINE_FIRST]);
    s.divisions = [worn];
    worn.state = 3000;
    turn(s);
    assert.deepEqual([worn.line, worn.engaged], [LINE_FIRST, 1000]);
  });

  it("une division en fuite ne revient pas en première ligne avant la fin de sa fuite", () => {
    const s = duel();
    const d = put(s, 1, "regulars", front(s).id);
    const until = s.tick + 4;
    d.fleeUntilTick = until; // en fuite aux tours `until - 3`, `until - 2` et `until - 1`
    turn(s);
    play(s, 2);
    assert.deepEqual([d.line, d.engaged], [LINE_SECOND, 0]);
    turn(s);
    assert.deepEqual([d.line, d.engaged], [LINE_FIRST, 1000]);
  });
});
