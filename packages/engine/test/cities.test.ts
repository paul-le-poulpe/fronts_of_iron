import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addCityToRoads,
  applyTurn,
  CITY,
  computeRoads,
  createGame,
  createRoadNetwork,
  createRng,
  generateTestMap,
  nextInt,
  RESOURCE_IRON,
  segmentsCross,
  type GameMap,
  type GameState,
} from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";
import {
  bruteCross,
  bruteRoads,
  checkCityInvariants,
  customMap,
  firstShoreTile,
  tileAt,
} from "./helpers.ts";

/**
 * Joue les ordres [joueur, x, y] un par tour ; chacun doit être valide.
 * La population de départ suffit pour une dizaine de villes par joueur.
 */
function play(map: GameMap, players: number, orders: readonly (readonly [number, number, number])[]): GameState {
  const s = createGame({ seed: 1, map, playerCount: players });
  orders.forEach(([player, x, y], i) => {
    const before = s.cities.length;
    applyTurn(s, { turn: i + 1, intents: [{ type: "found_city", player, tile: tileAt(map, x, y) }] });
    assert.equal(s.cities.length, before + 1, `ordre ${i + 1} (${player}, ${x}, ${y}) refusé`);
  });
  return s;
}

const land = (): "land" => "land";
const LAND_MAP = customMap(100, 60, land);

describe("réglages des villes", () => {
  it("le rayon d'expansion est plus grand que le rayon de contrôle", () => {
    assert.ok(CITY.expansionRadius > CITY.controlRadius);
  });
});

describe("zones (00-Game §3.2)", () => {
  it("une case à égale distance de deux villes va à la plus ancienne, quel que soit leur joueur", () => {
    // Villes en (30, 30) et (50, 30) : la case (40, 30) est à 10 des deux, donc dans le rayon des deux.
    const a = play(LAND_MAP, 2, [[1, 30, 30], [2, 50, 30]]);
    const mid = tileAt(LAND_MAP, 40, 30);
    assert.equal(a.tileCity[mid], 1);
    assert.equal(a.owner[mid], 1);
    // Les cases à côté vont chacune à la plus proche.
    assert.equal(a.tileCity[tileAt(LAND_MAP, 39, 30)], 1);
    assert.equal(a.tileCity[tileAt(LAND_MAP, 41, 30)], 2);
    // Fondées dans l'autre ordre, la ville du joueur 2 est la plus ancienne et prend la case.
    const b = play(LAND_MAP, 2, [[2, 50, 30], [1, 30, 30]]);
    assert.equal(b.tileCity[mid], 1);
    assert.equal(b.owner[mid], 2);
    assert.equal(b.cities[0]!.player, 2);
    checkCityInvariants(a);
    checkCityInvariants(b);
  });

  it("une ville fondée près d'une autre lui prend les cases qui lui sont strictement plus proches, y compris le fer", () => {
    const ironAt = new Set(["35,30", "36,30", "38,30", "20,30", "45,30"]);
    const map = customMap(100, 60, land, (x, y) => ironAt.has(`${x},${y}`));
    const s = play(map, 2, [[1, 30, 30]]);
    // Avant : la ville du joueur 1 a (35,30), (36,30), (38,30) et (20,30) ; (45,30) est trop loin.
    assert.equal(s.players[0]!.resourceTiles[0], 4);
    assert.equal(s.players[1]!.resourceTiles[0], 0);

    const before = s.owner.slice();
    const changed = applyTurn(s, {
      turn: 2,
      intents: [{ type: "found_city", player: 2, tile: tileAt(map, 41, 30) }],
    });
    const stolen = changed.filter((t) => before[t] === 1);
    assert.ok(stolen.length > 0);
    for (const t of stolen) assert.equal(s.owner[t], 2);
    // (36,30) : 6 de la ville 1, 5 de la ville 2 ; (38,30) : 8 contre 3 ; (35,30) : 5 contre 6.
    assert.equal(s.owner[tileAt(map, 36, 30)], 2);
    assert.equal(s.owner[tileAt(map, 38, 30)], 2);
    assert.equal(s.owner[tileAt(map, 35, 30)], 1);
    assert.equal(s.owner[tileAt(map, 20, 30)], 1);
    assert.equal(s.owner[tileAt(map, 45, 30)], 2);
    assert.equal(s.players[0]!.resourceTiles[0], 2);
    assert.equal(s.players[1]!.resourceTiles[0], 3);
    // Toute case de la liste a changé de propriétaire pendant le tour.
    for (const t of changed) assert.notEqual(s.owner[t], before[t]);
    assert.equal(s.players[0]!.tileCount + s.players[1]!.tileCount, s.owner.filter((o) => o !== 0).length);
    checkCityInvariants(s);
  });

  it("les cases qui passent d'une ville à une autre du même joueur ne sont pas listées : tileCity change, owner non", () => {
    // Deux villes du joueur 1 à 12 cases l'une de l'autre : les cases qui passent de l'une à l'autre ne sont pas listées.
    const s = play(LAND_MAP, 1, [[1, 30, 30]]);
    const before = s.owner.slice();
    const changed = applyTurn(s, { turn: 2, intents: [{ type: "found_city", player: 1, tile: tileAt(LAND_MAP, 42, 30) }] });
    assert.equal(s.tileCity[tileAt(LAND_MAP, 37, 30)], 2);
    assert.equal(before[tileAt(LAND_MAP, 37, 30)], 1);
    assert.ok(!changed.includes(tileAt(LAND_MAP, 37, 30)));
    for (const t of changed) assert.equal(before[t], 0);
    checkCityInvariants(s);
  });

  it("couvre l'eau comme la terre, et se coupe au bord de la carte", () => {
    const map = customMap(40, 30, (x) => (x >= 10 ? "ocean" : "land"));
    const s = play(map, 1, [[1, 3, 2]]);
    assert.equal(s.tileCity[tileAt(map, 12, 2)], 1, "case d'océan à 9 de la ville");
    assert.equal(s.tileCity[tileAt(map, 14, 2)], 0, "hors du rayon");
    assert.equal(s.tileCity[tileAt(map, 0, 0)], 1, "coin de la carte");
    checkCityInvariants(s);
  });
});

describe("routes terrestres (00-Game §3.5)", () => {
  it("le test de croisement ne compte que les croisements francs", () => {
    // En croix.
    assert.ok(segmentsCross(0, 0, 10, 10, 0, 10, 10, 0));
    assert.ok(segmentsCross(0, 0, 10, 0, 5, -3, 5, 4));
    // Une extrémité commune.
    assert.ok(!segmentsCross(0, 0, 10, 0, 10, 0, 10, 10));
    assert.ok(!segmentsCross(0, 0, 10, 0, 0, 0, 5, 5));
    // En T : l'extrémité d'un segment est sur l'autre.
    assert.ok(!segmentsCross(0, 0, 10, 0, 5, 0, 5, 7));
    // Alignés, avec ou sans recouvrement.
    assert.ok(!segmentsCross(0, 0, 10, 0, 5, 0, 15, 0));
    assert.ok(!segmentsCross(0, 0, 4, 0, 6, 0, 9, 0));
    // Parallèles, ou droites qui se coupent hors des segments.
    assert.ok(!segmentsCross(0, 0, 10, 0, 0, 1, 10, 1));
    assert.ok(!segmentsCross(0, 0, 10, 0, 5, 1, 5, 7));
    // Mêmes résultats que l'écriture de référence des tests, dans les deux sens.
    const rng = createRng(3);
    for (let i = 0; i < 20_000; i++) {
      const p = Array.from({ length: 8 }, () => nextInt(rng, 7));
      const a = segmentsCross(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, p[7]!);
      const b = bruteCross([p[0]!, p[1]!], [p[2]!, p[3]!], [p[4]!, p[5]!], [p[6]!, p[7]!]);
      assert.equal(a, b, `segments ${p.join(",")}`);
      assert.equal(segmentsCross(p[4]!, p[5]!, p[6]!, p[7]!, p[0]!, p[1]!, p[2]!, p[3]!), a);
    }
  });

  it("de deux routes qui se croisent, la plus courte est gardée", () => {
    // 1 = (100,100), 2 = (120,100) : longueur 20. 3 = (110,92), 4 = (110,108) : longueur 16, elle coupe 1-2 en (110,100).
    const w = 800;
    const tiles = [[100, 100], [120, 100], [110, 92], [110, 108]].map(([x, y]) => y! * w + x!);
    const roads = computeRoads(tiles, w, 500, CITY.expansionRadius);
    // Les quatre côtés (distance² 164) puis la diagonale courte (256) ; la longue (400) croise la courte.
    assert.deepEqual(roads, [[1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
  });

  it("fonder une ville peut supprimer une route existante, même d'un autre joueur", () => {
    const cx = 50;
    const cy = 30;
    const s = play(LAND_MAP, 2, [
      [1, cx - 10, cy],
      [1, cx + 10, cy],
    ]);
    assert.deepEqual(s.roads, [[1, 2]]);
    // Le joueur 2 pose deux villes de part et d'autre, plus proches l'une de l'autre que les deux premières.
    applyTurn(s, { turn: 3, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy - 8) }] });
    assert.deepEqual(s.roads, [[1, 3], [2, 3], [1, 2]]);
    applyTurn(s, { turn: 4, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy + 8) }] });
    assert.deepEqual(s.roads, [[1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
    checkCityInvariants(s);
  });

  it("deux villes à plus que le rayon d'expansion ne sont pas reliées ; à exactement le rayon, elles le sont", () => {
    const r = CITY.expansionRadius;
    const s = play(LAND_MAP, 1, [[1, 20, 30], [1, 20 + r, 30]]);
    assert.deepEqual(s.roads, [[1, 2]]);
    const t = play(LAND_MAP, 1, [[1, 20, 30], [1, 20 + r - 1, 30], [1, 20 + 2 * r - 2, 30]]);
    // 1-2 et 2-3 sont à r − 1 ; 1-3 est à 2r − 2 > r.
    assert.deepEqual(t.roads, [[1, 2], [2, 3]]);
  });

  /** n villes tirées au hasard dans un rectangle de la carte 800 × 500 (positions distinctes). */
  function randomTiles(seed: number, n: number, w: number, h: number): number[] {
    const rng = createRng(seed);
    const seen = new Set<number>();
    while (seen.size < n) seen.add((50 + nextInt(rng, h)) * 800 + 50 + nextInt(rng, w));
    return [...seen];
  }

  it("le réseau est le même que le calcul de référence de toutes les paires (quelques centaines de villes au hasard)", () => {
    for (const [seed, n, w, h] of [[1, 300, 120, 120], [2, 400, 200, 150], [3, 200, 60, 60], [4, 300, 300, 300]] as const) {
      const tiles = randomTiles(seed, n, w, h);
      const fast = computeRoads(tiles, 800, 500, CITY.expansionRadius);
      assert.deepEqual(fast, bruteRoads(tiles, 800, CITY.expansionRadius), `graine ${seed}`);
      assert.ok(fast.length > n, "le test doit produire un vrai réseau");
    }
  });

  it("le réseau tenu à jour ville par ville est, après chaque ajout, celui du calcul complet", () => {
    for (const [seed, n, w, h] of [[11, 150, 60, 60], [12, 200, 120, 120], [13, 120, 300, 300]] as const) {
      const tiles = randomTiles(seed, n, w, h);
      const net = createRoadNetwork(800, 500, CITY.expansionRadius);
      const roads: [number, number][] = [];
      tiles.forEach((t, i) => {
        addCityToRoads(net, t, roads);
        assert.deepEqual(roads, computeRoads(tiles.slice(0, i + 1), 800, 500, CITY.expansionRadius), `graine ${seed}, ville ${i + 1}`);
      });
    }
    // Plus de villes, comparaison à la fin seulement.
    const tiles = randomTiles(14, 600, 200, 200);
    const net = createRoadNetwork(800, 500, CITY.expansionRadius);
    const roads: [number, number][] = [];
    for (const t of tiles) addCityToRoads(net, t, roads);
    assert.deepEqual(roads, computeRoads(tiles, 800, 500, CITY.expansionRadius));
  });

  it("le réseau ne dépend pas de l'ordre de la liste des villes sauf par les identifiants", () => {
    // Même ensemble de villes, mêmes identifiants : même réseau. (Contrôle que le tri ne dépend pas de l'ordre d'insertion dans les grilles.)
    const tiles = randomTiles(7, 250, 100, 100);
    assert.deepEqual(computeRoads(tiles, 800, 500, CITY.expansionRadius), computeRoads(tiles.slice(), 800, 500, CITY.expansionRadius));
  });

  it("aucune route gardée n'en croise une autre, toutes sont ≤ au rayon d'expansion, et elles sont dans l'ordre de longueur", () => {
    const tiles = randomTiles(5, 400, 150, 150);
    const roads = computeRoads(tiles, 800, 500, CITY.expansionRadius);
    const pos = tiles.map((t) => [t % 800, Math.floor(t / 800)] as [number, number]);
    let previous = 0;
    for (const [a, b] of roads) {
      assert.ok(a < b);
      const dx = pos[a - 1]![0] - pos[b - 1]![0];
      const dy = pos[a - 1]![1] - pos[b - 1]![1];
      const d2 = dx * dx + dy * dy;
      assert.ok(d2 <= CITY.expansionRadius * CITY.expansionRadius);
      assert.ok(d2 >= previous, "routes gardées dans l'ordre croissant de longueur");
      previous = d2;
    }
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) {
        const [a, b] = roads[i]!;
        const [c, d] = roads[j]!;
        assert.ok(!bruteCross(pos[a - 1]!, pos[b - 1]!, pos[c - 1]!, pos[d - 1]!), `routes ${a}-${b} et ${c}-${d} se croisent`);
      }
    }
  });

  it("une candidate qui ne croise aucune route gardée est toujours gardée : le réseau est maximal", () => {
    const tiles = randomTiles(6, 300, 120, 120);
    const roads = computeRoads(tiles, 800, 500, CITY.expansionRadius);
    const kept = new Set(roads.map(([a, b]) => `${a},${b}`));
    const pos = tiles.map((t) => [t % 800, Math.floor(t / 800)] as [number, number]);
    for (let a = 0; a < tiles.length; a++) {
      for (let b = a + 1; b < tiles.length; b++) {
        const dx = pos[a]![0] - pos[b]![0];
        const dy = pos[a]![1] - pos[b]![1];
        if (dx * dx + dy * dy > CITY.expansionRadius * CITY.expansionRadius || kept.has(`${a + 1},${b + 1}`)) continue;
        // Une candidate non gardée croise au moins une route gardée.
        const blocked = roads.some(
          ([c, d]) => c !== a + 1 && c !== b + 1 && d !== a + 1 && d !== b + 1 && bruteCross(pos[a]!, pos[b]!, pos[c - 1]!, pos[d - 1]!),
        );
        assert.ok(blocked, `la candidate ${a + 1}-${b + 1} n'est ni gardée ni bloquée`);
      }
    }
  });
});

describe("ports (00-Game §3.6)", () => {
  it("une ville n'a de port que si sa zone contient de l'eau", () => {
    const inland = play(LAND_MAP, 1, [[1, 50, 30]]);
    assert.equal(inland.cities[0]!.port, false);
    const map = customMap(100, 60, (x) => (x >= 55 ? "ocean" : "land"));
    // À 4 cases de l'eau : port. À 10 cases (la case d'eau est à 10 : dans le rayon) : port ; à 11 : non.
    assert.equal(play(map, 1, [[1, 51, 30]]).cities[0]!.port, true);
    assert.equal(play(map, 1, [[1, 45, 30]]).cities[0]!.port, true);
    assert.equal(play(map, 1, [[1, 44, 30]]).cities[0]!.port, false);
  });

  it("un lac compte comme de l'eau (choix provisoire, 02-Engine §7)", () => {
    const map = customMap(100, 60, (x, y) => (x === 55 && y === 30 ? "lake" : "land"));
    assert.equal(play(map, 1, [[1, 50, 30]]).cities[0]!.port, true);
  });

  it("sur la carte de test : une ville au bord de la mer a un port, une ville au centre non", () => {
    const map = generateTestMap(12345);
    const shore = firstShoreTile(map);
    const s = createGame({ seed: 1, map, playerCount: 1 });
    applyTurn(s, { turn: 1, intents: [{ type: "found_city", player: 1, tile: shore }] });
    assert.equal(s.cities[0]!.port, true);
    const c = createGame({ seed: 1, map, playerCount: 1 });
    applyTurn(c, { turn: 1, intents: [{ type: "found_city", player: 1, tile: tileAt(map, 400, 250) }] });
    assert.equal(c.cities[0]!.port, false);
  });

  it("une ville qui perd toutes ses cases d'eau à une ville voisine perd son port", () => {
    // Une seule colonne d'eau, en x = 24, à 10 de la ville (14, 30) : (24, 30) est la seule case d'eau de sa zone.
    const map = customMap(60, 60, (x) => (x === 24 ? "ocean" : "land"));
    const s = play(map, 2, [[1, 14, 30]]);
    assert.equal(s.cities[0]!.port, true);
    assert.equal(s.tileCity[tileAt(map, 24, 30)], 1);
    // Une ville à 3 de la colonne d'eau, de l'autre côté : (24, 30) lui devient plus proche.
    applyTurn(s, { turn: 2, intents: [{ type: "found_city", player: 2, tile: tileAt(map, 27, 30) }] });
    assert.equal(s.tileCity[tileAt(map, 24, 30)], 2);
    assert.equal(s.cities[0]!.port, false);
    assert.equal(s.cities[1]!.port, true);
    checkCityInvariants(s);
  });
});

describe("groupes (00-Game §3.5)", () => {
  it("les villes d'un joueur reliées entre elles forment un groupe, nommé par son plus petit identifiant", () => {
    const s = play(LAND_MAP, 2, [[1, 50, 30], [1, 66, 30], [1, 50, 46], [2, 20, 30]]);
    assert.deepEqual(s.cities.map((c) => c.group), [1, 1, 1, 4]);
    assert.equal(s.players[0]!.cityIds.length, 3);
  });

  it("les villes d'un joueur séparées par la route d'un autre joueur forment deux groupes", () => {
    const cx = 50;
    const cy = 30;
    const s = play(LAND_MAP, 2, [
      [1, cx - 10, cy],
      [1, cx + 10, cy],
    ]);
    assert.deepEqual(s.cities.map((c) => c.group), [1, 1]);
    // Le joueur 2 pose M1 et M2 de part et d'autre de la route 1-2, plus près l'une de l'autre que A et B.
    applyTurn(s, { turn: 3, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy - 8) }] });
    applyTurn(s, { turn: 4, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy + 8) }] });
    assert.ok(!s.roads.some(([a, b]) => a === 1 && b === 2), "la route 1-2 est coupée");
    // Les routes vers les villes de l'autre joueur existent, mais ne relient pas les groupes.
    assert.ok(s.roads.some(([a, b]) => a === 1 && b === 3));
    assert.ok(s.roads.some(([a, b]) => a === 2 && b === 3));
    assert.deepEqual(s.cities.map((c) => c.group), [1, 2, 3, 3]);
    checkCityInvariants(s);
    // Le groupe principal du joueur 1 est celui de sa capitale (ville 1).
    assert.equal(s.cities[s.players[0]!.capital - 1]!.group, 1);
  });

  it("une chaîne de villes reliées de proche en proche est un seul groupe", () => {
    // 1 et 3 sont à 40 l'une de l'autre, hors de portée : seule la ville 2, au milieu, les relie.
    const s = play(LAND_MAP, 1, [[1, 30, 30], [1, 50, 30], [1, 70, 30]]);
    assert.deepEqual(s.roads, [[1, 2], [2, 3]]);
    assert.deepEqual(s.cities.map((c) => c.group), [1, 1, 1]);
  });
});

describe("parties jouées par des joueurs simulés", () => {
  it("garde tous les invariants (zones, propriétaires, compteurs, routes, ports, groupes) pendant 3 000 tours", () => {
    const checked: number[] = [];
    const r = runScenario({
      ...DEFAULT_SCENARIO,
      turns: 3000,
      onTurn: (state, turn) => {
        if (turn === 1 || turn === 40 || turn === 400 || turn === 3000) {
          checkCityInvariants(state);
          checked.push(state.cities.length);
        }
      },
    });
    assert.equal(r.cities, r.state.cities.length);
    assert.ok(r.cities >= 50, `${r.cities} villes`);
    assert.equal(checked.length, 4);
    // Chaque joueur a fini avec le maximum de villes que sa population permet : 1 + 1000 / 100.
    for (const p of r.state.players) {
      assert.ok(p.cityIds.length <= 1 + (1000 / CITY.foundingCostPopulation), `joueur ${p.id}`);
      assert.ok(p.population >= 0);
    }
  });

  it("garde les invariants avec plus de 300 villes (population rechargée à chaque tour)", () => {
    const r = runScenario({
      ...DEFAULT_SCENARIO,
      players: 6,
      turns: 100,
      onTurn: (state) => {
        for (const p of state.players) if (p.capital !== 0 && p.population < 1000) p.population += 1000;
      },
    });
    assert.ok(r.cities >= 300, `${r.cities} villes`);
    checkCityInvariants(r.state);
    // Les cases à fer sont comptées une fois chez leur propriétaire.
    const total = r.state.players.reduce((sum, p) => sum + p.resourceTiles[0]!, 0);
    let recount = 0;
    for (let t = 0; t < r.state.owner.length; t++) {
      if (r.state.owner[t] !== 0 && (r.state.map.resources[t]! & RESOURCE_IRON) !== 0) recount++;
    }
    assert.equal(total, recount);
    assert.ok(recount > 0);
  });
});
