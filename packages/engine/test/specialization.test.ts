// Spécialisation des lignes et croissance proportionnelle (00-Game §8.1, §8.2) :
// ouvriers d'une ligne selon son rang dans le groupe, remplissage tout ou rien
// avec ces coûts, jauge de croissance qui avance du nombre de lignes du groupe.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  CITY,
  createGame,
  FACTORY,
  GOOD_IDS,
  minersFor,
  PRODUCT_IDS,
  productConfig,
  stepEconomy,
  workersForLines,
  workersForRank,
  type GameMap,
  type GameState,
} from "../src/index.ts";
import { customMap, tileAt } from "./helpers.ts";

const R = CITY.controlRadius;
const CX = 5 * R;
const CY = 3 * R;
const FISHING_BOAT = GOOD_IDS.indexOf("fishingBoat");

/** Fer sur une case sur dix : plus que ce que les lignes des tests consomment. */
const LAND_MAP = customMap(10 * R, 6 * R, () => "land", (x, y) => (x + y) % 10 === 0);
/**
 * Une bande de terre de trois cases dans l'océan : la zone de chaque ville est presque toute de la mer, donc une grande
 * demande de bateaux de pêche (deux villes : environ 3 700 cases d'eau, une demande de plusieurs centaines).
 */
const SEA_MAP = customMap(10 * R, 6 * R, (x) => (x >= CX - 1 && x <= CX + 1 ? "land" : "ocean"), (x, y) => (x + y) % 10 === 0);

/** Joueur 1 avec une ville en (CX, CY) et une usine du type donné (née avec une ligne de son bien de base). */
function withFactory(map: GameMap, type: string, secondCity = false): GameState {
  const s = createGame({ seed: 1, map, playerCount: 2 });
  assert.ok(applyIntent(s, { type: "found_city", player: 1, tile: tileAt(map, CX, CY) }, []));
  if (secondCity) {
    s.players[0]!.population = 1_000_000;
    assert.ok(applyIntent(s, { type: "found_city", player: 1, tile: tileAt(map, CX, CY + Math.floor(1.6 * R)) }, []));
  }
  assert.ok(applyIntent(s, { type: "build_factory", player: 1, city: 1, factoryType: type }, []));
  return s;
}

describe("ouvriers d'une ligne selon son rang (00-Game §8.1)", () => {
  const { decayPercent, floorPercent } = FACTORY.specialization;

  it("rang 1 : le coût du bien ; rang 2 : decayPercent % de moins", () => {
    for (const good of PRODUCT_IDS) {
      const w = productConfig(good).workersPerLine;
      assert.equal(workersForRank(good, 1), w, good);
      assert.equal(workersForRank(good, 2), Math.floor((w * (100 - decayPercent)) / 100), good);
    }
  });

  it("jamais croissant, jamais sous le plancher, et tend vers lui", () => {
    for (const good of PRODUCT_IDS) {
      const floor = Math.floor((productConfig(good).workersPerLine * floorPercent) / 100);
      let previous = Infinity;
      for (let rank = 1; rank <= 2000; rank++) {
        const w = workersForRank(good, rank);
        assert.ok(w <= previous, `${good} : le rang ${rank} coûte plus que le précédent`);
        assert.ok(w >= floor, `${good} : le rang ${rank} coûte ${w}, sous le plancher ${floor}`);
        previous = w;
      }
      assert.equal(workersForRank(good, 100_000), floor, `${good} : le coût tend vers le plancher`);
    }
  });

  it("workersForLines somme les rangs 1 à n", () => {
    assert.equal(workersForLines("rifle", 0), 0);
    assert.equal(workersForLines("rifle", 1), workersForRank("rifle", 1));
    let sum = 0;
    for (let rank = 1; rank <= 40; rank++) {
      sum += workersForRank("rifle", rank);
      assert.equal(workersForLines("rifle", rank), sum);
    }
    assert.ok(sum < 40 * productConfig("rifle").workersPerLine);
  });
});

describe("remplissage avec les coûts par rang (00-Game §4, §8.1)", () => {
  it("un groupe de 3 lignes prend la somme des rangs ; un ouvrier de moins et la 3e ligne n'est pas remplie", () => {
    const s = withFactory(LAND_MAP, "infantryArmament");
    const p = s.players[0]!;
    const group = p.factories[0]!.groups[0]!;
    assert.equal(group.good, "rifle");
    group.lines = group.active = 3;
    p.population = workersForLines("rifle", 3) + minersFor(3, 0);
    stepEconomy(s);
    assert.deepEqual([group.filled, p.factoryWorkers], [3, workersForLines("rifle", 3)]);
    assert.ok(p.factoryWorkers < 3 * productConfig("rifle").workersPerLine, "moins cher que 3 lignes au prix de la première");

    p.population = workersForLines("rifle", 3) + minersFor(3, 0) - 1;
    stepEconomy(s);
    assert.deepEqual([group.filled, p.factoryWorkers], [2, workersForLines("rifle", 2)]);
  });
});

describe("croissance automatique proportionnelle à la production (00-Game §8.2)", () => {
  const ready = (lines: number): { s: GameState; p: GameState["players"][number]; g: GameState["players"][number]["factories"][number]["groups"][number] } => {
    const s = withFactory(SEA_MAP, "fishingBoats", true);
    const p = s.players[0]!;
    const g = p.factories[0]!.groups[0]!;
    assert.equal(g.good, "fishingBoat");
    g.lines = g.active = lines;
    // Un premier tour fixe la demande du tour suivant : à la demande nulle, aucune ligne n'est remplie.
    p.population = 1_000_000;
    stepEconomy(s);
    // La carte donne une demande de quelques centaines de bateaux : la capacité des lignes reste dessous.
    const capacity = (lines + 1) * productConfig("fishingBoat").productionPerLine;
    assert.ok(p.goodsDemand[FISHING_BOAT]! > capacity, `demande ${p.goodsDemand[FISHING_BOAT]}`);
    g.growth = 0;
    return { s, p, g };
  };
  const play = (s: GameState, n: number): void => {
    for (let i = 0; i < n; i++) {
      s.players[0]!.population = 1_000_000;
      stepEconomy(s);
    }
  };

  it("n lignes qui produisent ajoutent n par tour : quatre lignes gagnent la cinquième en growthTurns / 4 tours", () => {
    const { s, p, g } = ready(4);
    play(s, 1);
    assert.deepEqual([g.filled, g.growth], [4, 4]);
    const turns = FACTORY.growthTurns / 4;
    play(s, turns - 2);
    assert.deepEqual([g.lines, g.growth], [4, 4 * (turns - 1)]);
    play(s, 1);
    assert.deepEqual([g.lines, g.active, g.growth], [5, 5, 0]);
    assert.ok(p.goodsDemand[FISHING_BOAT]! > 0);
  });

  it("une ligne seule met growthTurns tours ; le dépassement reste dans la jauge", () => {
    const one = ready(1);
    play(one.s, FACTORY.growthTurns - 1);
    assert.deepEqual([one.g.lines, one.g.growth], [1, FACTORY.growthTurns - 1]);
    play(one.s, 1);
    assert.deepEqual([one.g.lines, one.g.growth], [2, 0]);

    const four = ready(4);
    four.g.growth = FACTORY.growthTurns - 1;
    play(four.s, 1);
    assert.deepEqual([four.g.lines, four.g.growth], [5, 3]);
  });

  it("un groupe dont une ligne ne produit pas n'avance pas", () => {
    const { s, g } = ready(4);
    play(s, 1);
    assert.equal(g.growth, 4);
    s.players[0]!.population = 1;
    stepEconomy(s);
    assert.deepEqual([g.filled, g.growth], [0, 4]);
  });
});
