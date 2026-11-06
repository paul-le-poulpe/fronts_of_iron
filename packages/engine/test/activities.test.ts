// Activités (Docs/Design/08-Population.md §2, §7, §9, §10) : ordres du joueur, casernes, auto-assignation, production
// visée, déblocage, fondation payée en bonshommes. Les valeurs attendues viennent du document. Le calcul de l'étape
// (capacité, fer, délais) est dans economy.test.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVITIES,
  ACTIVITY_DATA,
  ACTIVITY_IDS,
  activityUnlocked,
  applyIntent,
  CITY,
  createGame,
  DIVISIONS,
  FARMING,
  foundingCostPawns,
  GOOD_IDS,
  hashState,
  hurtPawns,
  idlePawns,
  IRON_INDEX,
  isActivityId,
  isGoodId,
  stepEconomy,
  UNLOCK,
  type ActivityId,
  type GameState,
  type Intent,
  type Player,
} from "../src/index.ts";
import { box, customMap, openBox, tileAt } from "./helpers.ts";
import { play, turn } from "./war-helpers.ts";

const R = CITY.controlRadius;
const CX = 5 * R;
const CY = 3 * R;
const MAP = customMap(10 * R, 6 * R, () => "land", (x, y) => (x + y) % 10 === 0);
const TRACTOR = GOOD_IDS.indexOf("tractor");
const U = UNLOCK.turns;

const found = (x: number, y: number): Intent => ({ type: "found_city", player: 1, tile: tileAt(MAP, x, y) });
const send = (s: GameState, intent: Record<string, unknown>): boolean => applyIntent(s, { player: 1, ...intent } as unknown as Intent, []);
const pawns = (from: ActivityId, to: ActivityId, count = 1): Record<string, unknown> => ({ type: "move_pawn", from, to, kind: "worker", count });
const machines = (from: ActivityId, to: ActivityId, count = 1): Record<string, unknown> => ({ type: "move_pawn", from, to, kind: "machine", good: "tractor", count });
const order = (p: Player): string[] => p.activities.map((a) => ACTIVITY_IDS[a.id]!);

/** Joueur 1 avec une ville, `idle` inactifs, auto-assignation éteinte ou allumée. Aucune étape jouée. */
function withCity(idle: number, autoAssign = false): GameState {
  const s = createGame({ seed: 1, map: MAP, playerCount: 2 });
  assert.ok(applyIntent(s, found(CX, CY), []));
  const p = s.players[0]!;
  p.autoAssign = autoAssign;
  box(p, "idle").workers = idle;
  p.population = idle;
  return s;
}

describe("activités au départ (08 §2, §9)", () => {
  it("ouvertes : Inactifs, Blessés, Agriculteurs, Pêcheurs, Mineurs ; auto-assignation allumée", () => {
    const s = createGame({ seed: 1, map: MAP, playerCount: 1 });
    assert.deepEqual(order(s.players[0]!), ["idle", "hurt", "farmers", "fishers", "miners"]);
    assert.equal(s.players[0]!.autoAssign, true);
  });

  it("une activité par type de division, avec la boîte de sa définition ; une machine a une usine et une boîte d'accueil", () => {
    for (const [id, d] of Object.entries(DIVISIONS)) {
      const a = ACTIVITY_DATA[ACTIVITY_IDS.indexOf(id as ActivityId)]!;
      assert.equal(a.kind, d.production.building, id);
      assert.deepEqual([a.workersPerUnit, a.ironPerUnit, a.unlockCost, a.hasPlaces], [d.production.workersPerUnit, d.production.ironPerUnit, d.production.unlockCost, true], id);
    }
    assert.deepEqual(GOOD_IDS.map((g) => ACTIVITY_DATA.filter((a) => a.good === GOOD_IDS.indexOf(g)).map((a) => a.kind)), [
      ["farming", "factory"],
      ["fishing", "factory"],
      ["mining", "factory"],
    ]);
  });

  it("arbre de déblocage du §9", () => {
    const tree: Record<string, [string, number]> = {
      militia: ["idle", 10],
      regulars: ["militia", U],
      artillery: ["regulars", U / 2],
      antiTank: ["artillery", U],
      armoredAntiTank: ["antiTank", U],
      selfPropelledArtillery: ["artillery", U],
      antiAir: ["regulars", U],
      selfPropelledAntiAir: ["antiAir", U],
      elite: ["regulars", U],
      miningMachine: ["miners", 4],
      tractor: ["miningMachine", U],
      tankette: ["tractor", U],
      infantryTank: ["tankette", U],
      cruiserTank: ["tankette", U],
      mediumTank: ["cruiserTank", U],
      fishingBoat: ["fishers", 6],
    };
    const actual = ACTIVITY_DATA.filter((a) => a.parent >= 0).map((a) => [a.id, ACTIVITY_IDS[a.parent], a.unlockCost]);
    assert.deepEqual(actual.sort(), Object.entries(tree).map(([id, [parent, cost]]) => [id, parent, cost]).sort());
    assert.ok(Object.keys(ACTIVITIES).every((id) => isActivityId(id)));
  });
});

describe("move_pawn (08 §2.1, §10)", () => {
  it("déplace des bonshommes entre deux boîtes, jamais vers ou depuis Blessés, ni dans une boîte pleine", () => {
    const s = withCity(5);
    const p = s.players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker;
    box(p, "hurt").workers = 1;
    assert.ok(send(s, pawns("idle", "farmers", 2)));
    assert.deepEqual([idlePawns(p), box(p, "farmers").workers], [3, 2]);
    assert.ok(!send(s, pawns("idle", "farmers", 2)), "une seule place libre");
    assert.ok(send(s, pawns("idle", "farmers", 1)));
    assert.ok(!send(s, pawns("idle", "farmers", 1)), "boîte pleine");
    assert.ok(!send(s, pawns("idle", "hurt")));
    assert.ok(!send(s, pawns("hurt", "idle")));
    assert.ok(!send(s, pawns("idle", "idle")));
    assert.ok(!send(s, pawns("idle", "militia")), "boîte verrouillée");
    assert.ok(!send(s, pawns("idle", "fishers", 3)), "pas assez d'inactifs ni de places");
    assert.ok(!send(s, pawns("fishers", "idle")), "personne au départ");
  });

  it("champs refusés, sans rien changer", () => {
    const s = withCity(5);
    const p = s.players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker;
    const before = hashState(s);
    for (const bad of [
      { type: "move_pawn" },
      { ...pawns("idle", "farmers"), count: 0 },
      { ...pawns("idle", "farmers"), count: -1 },
      { ...pawns("idle", "farmers"), count: 1.5 },
      { ...pawns("idle", "farmers"), count: "1" },
      { ...pawns("idle", "farmers"), count: NaN },
      { ...pawns("idle", "farmers"), count: 2_000_000 },
      { ...pawns("idle", "farmers"), kind: "pion" },
      { ...pawns("idle", "farmers"), from: "bois" },
      { ...pawns("idle", "farmers"), to: 3 },
      { ...machines("idle", "farmers"), good: "bois" },
      { ...machines("idle", "farmers"), good: undefined },
    ]) {
      assert.ok(!send(s, bad), JSON.stringify(bad));
    }
    assert.equal(hashState(s), before);
  });

  it("une machine va seulement entre Inactifs et sa boîte", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker;
    p.seaTiles = 3000;
    p.idleMachines[TRACTOR] = 2;
    assert.ok(!send(s, machines("idle", "fishers")));
    assert.ok(!send(s, machines("idle", "farmers", 3)), "trois tracteurs, il y en a deux");
    assert.ok(send(s, machines("idle", "farmers")));
    assert.deepEqual([p.idleMachines[TRACTOR], box(p, "farmers").machines], [1, 1]);
    assert.ok(!send(s, machines("farmers", "fishers")));
    assert.ok(send(s, machines("farmers", "idle")));
    assert.deepEqual([p.idleMachines[TRACTOR], box(p, "farmers").machines], [2, 0]);
  });

  it("une machine prend la place d'un bonhomme, qui retourne dans Inactifs ; refusée si les machines occupent tout", () => {
    const s = withCity(2);
    const p = s.players[0]!;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    p.idleMachines[TRACTOR] = 3;
    assert.ok(send(s, pawns("idle", "farmers", 2)));
    assert.ok(send(s, machines("idle", "farmers")));
    assert.deepEqual([box(p, "farmers").workers, box(p, "farmers").machines, idlePawns(p)], [1, 1, 1]);
    assert.ok(send(s, machines("idle", "farmers")));
    assert.deepEqual([box(p, "farmers").workers, box(p, "farmers").machines, idlePawns(p)], [0, 2, 2]);
    assert.ok(!send(s, machines("idle", "farmers")), "les machines occupent toutes les places");
  });
});

describe("set_activity_order (08 §2, §10)", () => {
  it("change l'ordre ; Inactifs reste tout en haut ; Blessés se déplace comme les autres ; boîte fermée refusée", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    assert.ok(send(s, { type: "set_activity_order", activity: "miners", position: 1 }));
    assert.deepEqual(order(p), ["idle", "miners", "hurt", "farmers", "fishers"]);
    assert.ok(send(s, { type: "set_activity_order", activity: "hurt", position: 4 }));
    assert.deepEqual(order(p), ["idle", "miners", "farmers", "fishers", "hurt"]);
    for (const bad of [
      { activity: "idle", position: 1 },
      { activity: "miners", position: 0 },
      { activity: "miners", position: 5 },
      { activity: "miners", position: 1.5 },
      { activity: "militia", position: 1 },
      { activity: "bois", position: 1 },
    ]) {
      assert.ok(!send(s, { type: "set_activity_order", ...bad }), JSON.stringify(bad));
    }
    assert.deepEqual(order(p), ["idle", "miners", "farmers", "fishers", "hurt"]);
  });
});

describe("casernes (08 §7)", () => {
  it("un bonhomme déposé ajoute une place, sorti il la retire ; une place vide ne donne aucune limite", () => {
    const s = withCity(3);
    const p = s.players[0]!;
    const militia = openBox(s, 1, "militia");
    assert.ok(send(s, pawns("idle", "militia", 2)));
    assert.deepEqual([militia.workers, militia.places], [2, 2]);
    assert.ok(send(s, pawns("militia", "idle")));
    assert.deepEqual([militia.workers, militia.places, idlePawns(p)], [1, 1, 2]);
    militia.places = 5;
    militia.workers = 0;
    box(p, "idle").workers = 0;
    stepEconomy(s);
    assert.equal(militia.output, 0);
  });

  it("une place vide se remplit toute seule dès qu'un inactif est là, casernes du haut d'abord, dans les deux modes", () => {
    for (const auto of [false, true]) {
      const s = withCity(3, auto);
      const p = s.players[0]!;
      p.farmTiles = 0;
      p.seaTiles = 0;
      p.resourceTiles[IRON_INDEX] = 0;
      const militia = openBox(s, 1, "militia");
      const regulars = openBox(s, 1, "regulars");
      militia.places = 2;
      regulars.places = 2;
      stepEconomy(s);
      assert.deepEqual([militia.workers, regulars.workers, idlePawns(p)], [2, 1, 0], `auto-assignation ${auto}`);
    }
  });
});

describe("production visée (08 §7 ter)", () => {
  it("les places suivent production visée × ouvriers par unité ; pas sous 0 ; les ouvriers en trop retournent dans Inactifs", () => {
    const s = withCity(4);
    const p = s.players[0]!;
    const tank = openBox(s, 1, "infantryTank"); // 2 ouvriers par unité
    assert.ok(send(s, { type: "change_production_target", activity: "infantryTank", delta: 2 }));
    assert.equal(tank.places, 4);
    stepEconomy(s);
    assert.deepEqual([tank.workers, idlePawns(p)], [4, 0]);
    assert.ok(send(s, { type: "change_production_target", activity: "infantryTank", delta: -1 }));
    assert.equal(tank.places, 2);
    stepEconomy(s);
    assert.deepEqual([tank.workers, idlePawns(p)], [2, 2]);
    assert.ok(send(s, { type: "change_production_target", activity: "infantryTank", delta: -10 }));
    assert.equal(tank.places, 0);
  });

  it("refusée sur une boîte sans production visée ou fermée, ou avec un écart nul ou non entier", () => {
    const s = withCity(0);
    openBox(s, 1, "militia");
    for (const bad of [
      { activity: "farmers", delta: 1 },
      { activity: "idle", delta: 1 },
      { activity: "tractor", delta: 1 },
      { activity: "regulars", delta: 1 },
      { activity: "militia", delta: 0 },
      { activity: "militia", delta: 1.5 },
      { activity: "militia", delta: "1" },
      { activity: "militia", delta: 1001 },
    ]) {
      assert.ok(!send(s, { type: "change_production_target", ...bad }), JSON.stringify(bad));
    }
  });

  it("la flèche vers le bas retire d'abord les places barrées", () => {
    const s = withCity(0);
    const militia = openBox(s, 1, "militia");
    militia.places = 5;
    assert.ok(send(s, { type: "set_disabled_slots", activity: "militia", count: 3 }));
    assert.ok(send(s, { type: "change_production_target", activity: "militia", delta: -2 }));
    assert.deepEqual([militia.places, militia.disabled], [3, 1]);
  });
});

describe("auto-assignation (08 §7 bis)", () => {
  it("allumée : de haut en bas, les inactifs remplissent Agriculteurs, Pêcheurs, Mineurs et les usines de machines", () => {
    const s = withCity(7, true);
    const p = s.players[0]!;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    p.seaTiles = 300;
    p.resourceTiles[IRON_INDEX] = 200;
    openBox(s, 1, "miningMachine");
    stepEconomy(s);
    // 2, 1, 2, puis l'usine de pompes : ceil(2 × 1 / 2) = 1 place. Reste un inactif.
    assert.deepEqual(["farmers", "fishers", "miners", "miningMachine"].map((id) => box(p, id as ActivityId).workers), [2, 1, 2, 1]);
    assert.equal(idlePawns(p), 1);
  });

  it("éteinte : personne ne bouge seul, les casernes mises à part ; les croix restent mémorisées", () => {
    const s = withCity(3);
    const p = s.players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker;
    assert.ok(send(s, { type: "set_disabled_slots", activity: "farmers", count: 2 }));
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").workers, idlePawns(p), box(p, "farmers").disabled], [0, 3, 2]);
    assert.ok(send(s, pawns("idle", "farmers", 3)), "éteinte, les croix ne réagissent pas");
    assert.equal(box(p, "farmers").workers, 3);
  });

  it("une machine d'Inactifs entre seule, et remplace un ouvrier si la boîte est pleine", () => {
    const s = withCity(2, true);
    const p = s.players[0]!;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    p.seaTiles = 0;
    p.resourceTiles[IRON_INDEX] = 0;
    stepEconomy(s);
    assert.equal(box(p, "farmers").workers, 2);
    p.idleMachines[TRACTOR] = 1;
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").machines, box(p, "farmers").workers, idlePawns(p), p.idleMachines[TRACTOR]], [1, 1, 1, 0]);
  });

  it("une croix : l'ouvrier barré quitte la ligne ; une machine barrée retourne sur sa ligne d'Inactifs ; retirée, le poste se remplit", () => {
    const s = withCity(3, true);
    const p = s.players[0]!;
    p.farmTiles = 3 * FARMING.tilesPerWorker;
    p.seaTiles = 0;
    p.resourceTiles[IRON_INDEX] = 0;
    stepEconomy(s);
    assert.equal(box(p, "farmers").workers, 3);
    assert.ok(send(s, { type: "set_disabled_slots", activity: "farmers", count: 1 }));
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").workers, idlePawns(p)], [2, 1]);
    box(p, "farmers").workers = 0;
    box(p, "idle").workers = 0;
    box(p, "farmers").machines = 3;
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").machines, p.idleMachines[TRACTOR]], [2, 1]);
    assert.ok(send(s, { type: "set_disabled_slots", activity: "farmers", count: 0 }));
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").machines, p.idleMachines[TRACTOR]], [3, 0]);
  });

  it("priorité : une ligne qui a de la place prend les ouvriers des lignes plus basses, la plus basse d'abord ; les machines ne sont pas prises", () => {
    const s = withCity(0, true);
    const p = s.players[0]!;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    p.seaTiles = 300;
    p.resourceTiles[IRON_INDEX] = 300;
    box(p, "fishers").workers = 1;
    box(p, "miners").workers = 2;
    box(p, "miners").machines = 1;
    p.population = 3;
    stepEconomy(s);
    assert.deepEqual([box(p, "farmers").workers, box(p, "fishers").workers, box(p, "miners").workers, box(p, "miners").machines], [2, 1, 0, 1]);
  });

  it("set_disabled_slots : boîte à places seulement, au plus ses places ; set_auto_assign : un booléen", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    p.farmTiles = 2 * FARMING.tilesPerWorker;
    assert.ok(send(s, { type: "set_disabled_slots", activity: "farmers", count: 2 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "farmers", count: 3 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "farmers", count: -1 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "farmers", count: 1.5 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "idle", count: 0 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "hurt", count: 0 }));
    assert.ok(!send(s, { type: "set_disabled_slots", activity: "tractor", count: 0 }), "fermée");
    assert.ok(send(s, { type: "set_auto_assign", enabled: true }));
    assert.equal(p.autoAssign, true);
    for (const enabled of [1, "true", null, undefined]) assert.ok(!send(s, { type: "set_auto_assign", enabled }), String(enabled));
    assert.equal(p.autoAssign, true);
  });
});

describe("déblocage (08 §9)", () => {
  it("milice : dès que la population atteint 10, et le seuil reste acquis", () => {
    const s = withCity(9);
    const p = s.players[0]!;
    const militia = ACTIVITY_IDS.indexOf("militia");
    stepEconomy(s);
    assert.equal(activityUnlocked(p, militia), false);
    box(p, "idle").workers = 10;
    p.population = 10;
    stepEconomy(s);
    assert.equal(activityUnlocked(p, militia), true);
    box(p, "idle").workers = 3;
    p.population = 3;
    stepEconomy(s);
    assert.equal(activityUnlocked(p, militia), true);
  });

  it("pompes : 4 mineurs ; bateaux : 6 pêcheurs ; la progression montre les ouvriers présents, et le seuil reste acquis", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    const pump = ACTIVITY_IDS.indexOf("miningMachine");
    const boat = ACTIVITY_IDS.indexOf("fishingBoat");
    p.seaTiles = 3000;
    p.resourceTiles[IRON_INDEX] = 1000;
    box(p, "miners").workers = 3;
    box(p, "fishers").workers = 5;
    stepEconomy(s);
    assert.deepEqual([p.unlock[pump], p.unlock[boat]], [3, 5]);
    box(p, "miners").workers = 4;
    box(p, "fishers").workers = 6;
    stepEconomy(s);
    assert.ok(activityUnlocked(p, pump) && activityUnlocked(p, boat));
    box(p, "miners").workers = 0;
    box(p, "fishers").workers = 0;
    stepEconomy(s);
    assert.ok(activityUnlocked(p, pump) && activityUnlocked(p, boat));
  });

  it("par la boîte parente : le compteur gagne chaque tour les ouvriers servis en fer ; deux ouvriers mettent deux fois moins de temps", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    const regulars = ACTIVITY_IDS.indexOf("regulars");
    const militia = openBox(s, 1, "militia");
    militia.workers = 2;
    militia.places = 2;
    p.population = 2;
    for (let i = 0; i < 3; i++) stepEconomy(s);
    assert.equal(p.unlock[regulars], 6);
    for (let i = 0; i < U; i++) stepEconomy(s);
    assert.equal(p.unlock[regulars], U, "plafonnée au coût");
    assert.ok(activityUnlocked(p, regulars));
  });

  it("sans fer, le parent ne fait pas avancer ses enfants ; la progression n'est pas perdue quand il s'arrête", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    const artillery = ACTIVITY_IDS.indexOf("artillery");
    const regulars = openBox(s, 1, "regulars");
    regulars.workers = 3;
    regulars.places = 3;
    p.population = 3;
    stepEconomy(s);
    assert.equal(p.unlock[artillery], 0, "aucun fer produit");
    box(p, "miners").workers = 1;
    p.population = 4;
    stepEconomy(s);
    assert.equal(p.unlock[artillery], 3);
    box(p, "miners").workers = 0;
    stepEconomy(s);
    assert.equal(p.unlock[artillery], 3);
  });

  it("une usine de machines compte ses ouvriers servis, pas ses unités", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    const tractor = ACTIVITY_IDS.indexOf("tractor");
    const pumps = openBox(s, 1, "miningMachine");
    box(p, "miners").workers = 1;
    pumps.workers = 1; // 2 pompes pour un ouvrier
    p.population = 2;
    stepEconomy(s);
    assert.equal(p.unlock[tractor], 1);
  });

  it("open_activity : débloquée seulement, au bas des boîtes ouvertes ; close_activity : ouvriers dans Inactifs, boîte rouvrable, vide", () => {
    const s = withCity(2);
    const p = s.players[0]!;
    assert.ok(!send(s, { type: "open_activity", activity: "militia" }), "pas débloquée");
    assert.ok(!send(s, { type: "open_activity", activity: "farmers" }), "déjà ouverte");
    assert.ok(!send(s, { type: "open_activity", activity: "bois" }));
    const militia = openBox(s, 1, "militia");
    assert.equal(order(p).at(-1), "militia");
    assert.ok(!send(s, { type: "open_activity", activity: "militia" }), "déjà ouverte");
    assert.ok(send(s, pawns("idle", "militia", 2)));
    assert.equal(militia.places, 2);

    for (const id of ["farmers", "fishers", "miners", "idle", "hurt", "regulars", "bois"]) {
      assert.ok(!send(s, { type: "close_activity", activity: id }), id);
    }
    assert.ok(send(s, { type: "close_activity", activity: "militia" }));
    assert.deepEqual([order(p).includes("militia"), idlePawns(p), p.population], [false, 2, 2]);
    assert.ok(send(s, { type: "open_activity", activity: "militia" }));
    assert.deepEqual([box(p, "militia").workers, box(p, "militia").places], [0, 0]);
  });

  it("une boîte supprimée : ses divisions deviennent en trop", () => {
    const s = withCity(2);
    const p = s.players[0]!;
    openBox(s, 1, "militia");
    assert.ok(send(s, pawns("idle", "militia", 2)));
    play(s, 1);
    assert.equal(s.divisions.length, 2);
    turn(s, { type: "close_activity", player: 1, activity: "militia" });
    assert.deepEqual(s.divisions.map((d) => d.leaveTick !== 0), [true, true]);
    assert.equal(idlePawns(p), 2);
  });

  it("identifiants d'activités et de biens", () => {
    assert.deepEqual([isActivityId("militia"), isActivityId("bois"), isActivityId(3), isGoodId("tractor"), isGoodId("militia")], [true, false, false, true, false]);
  });
});

describe("fondation payée en bonshommes (08 §10)", () => {
  /** Une deuxième case de ville, dans le rayon d'expansion, hors de la zone de la première. */
  const second = found(CX + R + 5, CY);

  it("coût des villes suivantes : 1, 2, 2, 3", () => {
    assert.deepEqual([1, 2, 3, 4].map(foundingCostPawns), [1, 2, 2, 3]);
  });

  it("payé par les inactifs d'abord, puis par les ouvriers, de la plus basse à la plus haute ; une place de caserne reste", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    const militia = openBox(s, 1, "militia");
    militia.workers = 1;
    militia.places = 1;
    box(p, "farmers").workers = 1;
    box(p, "idle").workers = 1;
    p.population = 3;
    assert.ok(applyIntent(s, second, []));
    assert.deepEqual([idlePawns(p), militia.workers, box(p, "farmers").workers, p.population], [0, 1, 1, 2], "1 bonhomme : un inactif");
    assert.ok(applyIntent(s, found(CX - R - 5, CY), []));
    assert.deepEqual([militia.workers, militia.places, box(p, "farmers").workers, p.population], [0, 1, 0, 0], "2 bonshommes : la caserne, puis les champs");
  });

  it("les blessés ne paient pas : refusée si la population sans les blessés ne suffit pas", () => {
    const s = withCity(0);
    const p = s.players[0]!;
    box(p, "hurt").workers = 3;
    p.population = 3;
    assert.ok(!applyIntent(s, second, []));
    assert.deepEqual([p.population, hurtPawns(p), s.cities.length], [3, 3, 1]);
    box(p, "idle").workers = 1;
    p.population = 4;
    assert.ok(applyIntent(s, second, []));
    assert.deepEqual([p.population, hurtPawns(p), idlePawns(p)], [3, 3, 0]);
  });
});
