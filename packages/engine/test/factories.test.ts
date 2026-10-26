// Usines, lignes de production, extraction du fer, armement (00-Game §4, §7,
// §8). Peu de tests, un par règle : remplissage tout ou rien dans l'ordre de
// priorité, capacité de fer, machines du tour précédent, déblocage, réserve
// d'armement, ordres, hash.
//
// Une usine naît avec une ligne active de son bien de base (00-Game §8) : les tests le
// supposent. Un bien (machine) n'est rempli que sous sa demande du tour précédent
// (00-Game §8.2) : le premier tour fixe la demande, il ne remplit rien.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARMAMENT,
  applyIntent,
  armamentReserveMax,
  CITY,
  createGame,
  FACTORY,
  GOODS,
  hashState,
  ironTilesFor,
  minersFor,
  MINING,
  stepEconomy,
  type GameMap,
  type GameState,
} from "../src/index.ts";
import { customMap, tileAt } from "./helpers.ts";

const R = CITY.controlRadius;
const CX = 5 * R;
const CY = 3 * R;
const W = ARMAMENT.types.rifle.workersPerLine;
const IRON_RANK = 0;

/** Fer sur une case sur dix : beaucoup plus que ce que les lignes des tests consomment. */
const RICH_MAP = customMap(10 * R, 6 * R, () => "land", (x, y) => (x + y) % 10 === 0);
/** Trois cases de fer seulement, près de la ville. */
const POOR_MAP = customMap(10 * R, 6 * R, () => "land", (x, y) => y === CY && (x === CX + 1 || x === CX + 2 || x === CX + 3));

const send = (s: GameState, intent: Record<string, unknown>): boolean => applyIntent(s, intent as never, []);

/** Joueur 1 avec une ville en (CX, CY) et une usine du type donné ; population fixée à la main, aucune étape jouée. */
function withFactory(map: GameMap, type = "infantryArmament", population = 100_000): GameState {
  const s = createGame({ seed: 1, map, playerCount: 2 });
  assert.ok(applyIntent(s, { type: "found_city", player: 1, tile: tileAt(map, CX, CY) }, []));
  assert.ok(send(s, { type: "build_factory", player: 1, city: 1, factoryType: type }));
  s.players[0]!.population = population;
  return s;
}

/** Le même, avec une deuxième ville (n° 2) qui a aussi une usine de fusils, après la première dans l'ordre de priorité. */
function withTwoFactories(): GameState {
  const s = withFactory(RICH_MAP);
  s.players[0]!.population = 1_000_000;
  assert.ok(applyIntent(s, { type: "found_city", player: 1, tile: tileAt(RICH_MAP, CX + 2 * R, CY) }, []));
  assert.ok(send(s, { type: "build_factory", player: 1, city: 2, factoryType: "infantryArmament" }));
  s.players[0]!.population = 100_000;
  return s;
}

const line = (s: GameState, city: number, good: string): boolean => send(s, { type: "create_line", player: 1, city, good });
const filled = (s: GameState, city: number, good: string): number =>
  s.players[0]!.factories.find((f) => f.city === city)!.groups.find((g) => g.good === good)!.filled;

describe("remplissage des lignes (00-Game §4, §7, §8)", () => {
  it("une ligne reçoit ses ouvriers et les mineurs de son fer, produit, et le reste va aux champs", () => {
    const s = withFactory(RICH_MAP);
    const p = s.players[0]!;
    assert.ok(p.resourceTiles[IRON_RANK]! > 100);
    const pop = p.population;
    stepEconomy(s);
    const miners = Math.ceil(1000 / MINING.mechanizationBase); // 1 fer = 1 case = 1 000 millièmes, sans pompe
    assert.equal(minersFor(1, 0), miners);
    assert.deepEqual([filled(s, 1, "rifle"), p.factoryWorkers, p.miners, p.ironExtracted, p.minedTiles], [1, W, miners, 1, ironTilesFor(1)]);
    assert.equal(p.armamentReserve[0], ARMAMENT.types.rifle.productionPerLine);
    assert.equal(p.farmers + p.fishers + p.idle + p.factoryWorkers + p.miners + p.soldiers, pop, "toute la population est affectée");
    // Seul le reste de la population est réparti entre fermiers, pêcheurs et inactifs.
    assert.equal(p.farmers + p.fishers + p.idle, pop - W - miners);
  });

  it("tout ou rien, et la première ligne qui échoue arrête le remplissage", () => {
    const s = withTwoFactories();
    const p = s.players[0]!;
    assert.ok(line(s, 1, "rifle")); // ville 1 : deux lignes de fusils ; ville 2 : une
    // Population pour une ligne et demie : une seule ligne est remplie, la suivante ne reçoit personne (pas de ligne partielle).
    p.population = W + minersFor(1, 0) + 10;
    stepEconomy(s);
    assert.deepEqual([filled(s, 1, "rifle"), filled(s, 2, "rifle"), p.factoryWorkers], [1, 0, W]);
    // Population insuffisante pour une seule ligne : personne n'est affecté.
    p.population = W + minersFor(1, 0) - 1;
    stepEconomy(s);
    assert.deepEqual([filled(s, 1, "rifle"), p.factoryWorkers, p.miners, p.ironExtracted], [0, 0, 0, 0]);
    // La priorité des villes décide : la ville 2 d'abord, elle prend la seule ligne que la population permet.
    assert.ok(send(s, { type: "set_city_priority", player: 1, city: 2, position: 0 }));
    p.population = W + minersFor(1, 0) + 10;
    stepEconomy(s);
    assert.deepEqual([filled(s, 1, "rifle"), filled(s, 2, "rifle")], [0, 1]);
    // La production d'armement ne s'arrête jamais (00-Game §8.3) : une réserve au maximum ne suspend pas les lignes.
    assert.ok(send(s, { type: "set_city_priority", player: 1, city: 1, position: 0 }));
    p.population = 100_000;
    p.armamentReserve[0] = armamentReserveMax(p, "rifle");
    stepEconomy(s);
    assert.deepEqual([filled(s, 1, "rifle"), filled(s, 2, "rifle")], [2, 1]);
  });

  it("la capacité de fer limite les lignes, même avec une population énorme", () => {
    const s = withFactory(POOR_MAP, "infantryArmament", 1_000_000);
    const p = s.players[0]!;
    assert.equal(p.resourceTiles[IRON_RANK], 3);
    for (let i = 0; i < 4; i++) assert.ok(line(s, 1, "rifle")); // 5 lignes avec celle de la naissance
    stepEconomy(s);
    assert.deepEqual([filled(s, 1, "rifle"), p.ironExtracted, p.minedTiles], [3, 3, 3]);
  });

  it("les machines utilisées sont celles du tour précédent : les pompes à vapeur réduisent les mineurs au tour suivant", () => {
    const s = withFactory(RICH_MAP, "miningMachines");
    const p = s.players[0]!;
    // Le premier tour fixe la demande de pompes (le remplissage d'un bien se limite à la demande du tour précédent).
    stepEconomy(s);
    assert.ok(p.goodsDemand[2]! > 0);
    stepEconomy(s);
    assert.equal(p.miners, minersFor(1, 0), "premier tour rempli : aucune pompe encore");
    assert.equal(p.goods[2], GOODS.miningMachine.productionPerLine);
    stepEconomy(s);
    assert.equal(p.miners, minersFor(1, GOODS.miningMachine.productionPerLine));
    assert.ok(p.miners < minersFor(1, 0));
  });
});

describe("déblocage et réserve d'armement (00-Game §8.2, §8.3)", () => {
  it("un enfant se débloque après unlockTurns tours remplis du parent ; la pause ne perd rien", () => {
    const s = withFactory(RICH_MAP, "miningMachines");
    const f = s.players[0]!.factories[0]!;
    assert.ok(!line(s, 1, "tractor"), "verrouillé au départ");
    const play = (n: number): void => {
      for (let i = 0; i < n; i++) {
        s.players[0]!.population = 100_000;
        stepEconomy(s);
      }
    };
    play(1); // le premier tour fixe la demande de pompes : aucune ligne remplie
    assert.equal(f.progress[0], 0);
    play(FACTORY.unlockTurns - 2);
    assert.equal(f.progress[0], FACTORY.unlockTurns - 2, "une ligne remplie : un tour-ligne par tour");
    send(s, { type: "set_active_lines", player: 1, city: 1, good: "miningMachine", count: 0 });
    play(50);
    assert.equal(f.progress[0], FACTORY.unlockTurns - 2, "en pause : la progression s'arrête et reste");
    send(s, { type: "set_active_lines", player: 1, city: 1, good: "miningMachine", count: 1 });
    play(1); // la demande de pompes était nulle pendant la pause : ce tour la fixe de nouveau, sans rien remplir
    assert.equal(f.progress[0], FACTORY.unlockTurns - 2);
    play(1);
    assert.ok(!line(s, 1, "tractor"), `${f.progress[0]} tours`);
    play(1);
    assert.equal(f.progress[0], FACTORY.unlockTurns);
    assert.ok(line(s, 1, "tractor"));
  });

  it("la production ne s'arrête jamais ; seul l'excès au-dessus du stock cible décline, avec son reste", () => {
    const s = withFactory(RICH_MAP);
    const p = s.players[0]!;
    assert.ok(line(s, 1, "rifle"));
    // Une usine naît avec une ligne de fusils, plus celle créée ici : deux lignes.
    const perTick = 2 * ARMAMENT.types.rifle.productionPerLine;
    const max = armamentReserveMax(p, "rifle");
    assert.equal(max, perTick * ARMAMENT.maxStockTurns);
    // À la réserve maximale : les lignes produisent encore.
    p.armamentReserve[0] = max;
    stepEconomy(s);
    assert.equal(filled(s, 1, "rifle"), 2);
    assert.equal(p.armamentReserve[0]! >= max, true);
    // Excès de 1 après la production : le reste le garde d'un tour à l'autre.
    const t = withFactory(RICH_MAP);
    const q = t.players[0]!;
    assert.ok(line(t, 1, "rifle"));
    q.armamentReserve[0] = max + 1 - perTick;
    stepEconomy(t);
    assert.deepEqual([q.armamentReserve[0], q.armamentRemainder[0]], [max + 1, ARMAMENT.decayRate]);
    // La baisse ne touche que l'excès : jamais sous la limite quand la production est coupée (lignes désactivées).
    assert.ok(send(t, { type: "set_active_lines", player: 1, city: 1, good: "rifle", count: 0 }));
    for (let i = 0; i < 10_000 / ARMAMENT.decayRate + 50; i++) stepEconomy(t);
    assert.equal(q.armamentReserve[0], max);
    assert.equal(q.armamentRemainder[0], 0);
  });
});

describe("ordres des usines (00-Game §9)", () => {
  it("champs vérifiés, ville d'un autre joueur, doublon, bien hors de l'arbre ou verrouillé : refusés sans rien changer", () => {
    const s = withTwoFactories();
    const before = hashState(s);
    const bad: Record<string, unknown>[] = [
      { type: "build_factory", player: 1, city: 3, factoryType: "fishingBoats" },
      { type: "build_factory", player: 1, city: "1", factoryType: "fishingBoats" },
      { type: "build_factory", player: 1, city: 1, factoryType: "fishingBoats" },
      { type: "build_factory", player: 1, city: 1, factoryType: "nope" },
      { type: "build_factory", player: 2, city: 1, factoryType: "fishingBoats" },
      { type: "create_line", player: 1, city: 1, good: "tractor" },
      { type: "create_line", player: 1, city: 1, good: "machineGun" },
      { type: "create_line", player: 1, city: 1, good: 3 },
      { type: "create_line", player: 2, city: 1, good: "rifle" },
      { type: "set_active_lines", player: 1, city: 1, good: "machineGun", count: 0 },
      { type: "set_active_lines", player: 1, city: 1, good: "rifle", count: 2 },
      { type: "set_city_priority", player: 1, city: 1, position: 2 },
      { type: "set_city_priority", player: 1, city: 1, position: -1 },
      { type: "set_city_priority", player: 1, city: 1, position: 0.5 },
      { type: "set_line_priority", player: 1, city: 1, good: "machineGun", position: 0 },
      { type: "set_line_priority", player: 1, city: 1, good: "rifle", position: 1 },
    ];
    for (const intent of bad) assert.ok(!send(s, intent), JSON.stringify(intent));
    assert.equal(hashState(s), before);
    // Valides : la ligne est créée active, le réglage 0..lignes, les priorités déplacent.
    assert.ok(line(s, 1, "rifle") && line(s, 1, "rifle"));
    const group = s.players[0]!.factories[0]!.groups[0]!;
    assert.deepEqual([group.lines, group.active], [3, 3], "la ligne de la naissance et les deux créées");
    assert.ok(send(s, { type: "set_active_lines", player: 1, city: 1, good: "rifle", count: 1 }));
    assert.ok(!send(s, { type: "set_active_lines", player: 1, city: 1, good: "rifle", count: 4 }));
    assert.equal(group.active, 1);
    assert.ok(send(s, { type: "set_city_priority", player: 1, city: 2, position: 0 }));
    assert.deepEqual(s.players[0]!.factories.map((f) => f.city), [2, 1]);
  });
});

describe("hash des usines", () => {
  it("chaque champ des usines, des biens et de l'armement change le hash", () => {
    const base = (): GameState => {
      const s = withTwoFactories();
      line(s, 1, "rifle");
      for (let i = 0; i < 3; i++) stepEconomy(s);
      return s;
    };
    const reference = hashState(base());
    assert.equal(hashState(base()), reference);
    const mutations: [string, (s: GameState) => void][] = [
      ["ordre des usines", (s) => void s.players[0]!.factories.reverse()],
      ["lignes", (s) => void s.players[0]!.factories[0]!.groups[0]!.lines++],
      ["lignes actives", (s) => void s.players[0]!.factories[0]!.groups[0]!.active--],
      ["lignes remplies", (s) => void s.players[0]!.factories[0]!.groups[0]!.filled--],
      ["progression", (s) => void s.players[0]!.factories[0]!.progress[0]!++],
      ["type d'usine", (s) => void ((s.players[0]!.factories[1] as { type: string }).type = "miningMachines")],
      ["biens produits", (s) => void s.players[0]!.goods[1]!++],
      ["réserve d'armement", (s) => void s.players[0]!.armamentReserve[0]!++],
      ["reste de baisse", (s) => void s.players[0]!.armamentRemainder[1]!++],
      ["ouvriers", (s) => void s.players[0]!.factoryWorkers++],
      ["mineurs", (s) => void s.players[0]!.miners++],
      ["cases exploitées", (s) => void s.players[0]!.minedTiles++],
      ["fer extrait", (s) => void s.players[0]!.ironExtracted++],
    ];
    for (const [name, mutate] of mutations) {
      const s = base();
      mutate(s);
      assert.notEqual(hashState(s), reference, `le champ « ${name} » n'est pas dans le hash`);
    }
  });
});
