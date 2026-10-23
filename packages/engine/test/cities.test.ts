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
  foundingCost,
  generateTestMap,
  nextInt,
  POPULATION,
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
 * Positions des tests écrites à partir des rayons, pour rester valides quand
 * leurs valeurs changent : R = rayon de contrôle, E = rayon d'expansion = 2 R
 * (00-Game §3.1).
 */
const R = CITY.controlRadius;
const E = CITY.expansionRadius;

/**
 * Joue les ordres [joueur, x, y] un par tour ; chacun doit être valide.
 * Avant chaque ordre, la population du joueur est portée au moins au coût de
 * sa prochaine ville (00-Game §3.3) : ces tests vérifient la géométrie, pas le coût.
 */
function play(map: GameMap, players: number, orders: readonly (readonly [number, number, number])[]): GameState {
  const s = createGame({ seed: 1, map, playerCount: players });
  orders.forEach(([player, x, y], i) => {
    const p = s.players[player - 1]!;
    if (p.capital !== 0) p.population = Math.max(p.population, foundingCost(p.cityIds.length));
    const before = s.cities.length;
    applyTurn(s, { turn: i + 1, intents: [{ type: "found_city", player, tile: tileAt(map, x, y) }] });
    assert.equal(s.cities.length, before + 1, `ordre ${i + 1} (${player}, ${x}, ${y}) refusé`);
  });
  return s;
}

const land = (): "land" => "land";
/** Terre partout, 8 R × 5 R. */
const LAND_MAP = customMap(8 * R, 5 * R, land);
/** Ligne des tests sur LAND_MAP. */
const Y = 2 * R;

describe("réglages des villes", () => {
  it("le rayon de contrôle est la moitié du rayon d'expansion (00-Game §3.1)", () => {
    assert.ok(Number.isInteger(R) && R > 5, `R = ${R}`);
    assert.equal(E, 2 * R);
  });

  it("chaque ville possédée ajoute foundingCostIncreasePercent % du coût de base, arrondi vers le bas", () => {
    const base = CITY.foundingCostPopulation;
    for (let n = 0; n < 50; n++) {
      assert.equal(foundingCost(n), Math.floor((base * (100 + n * CITY.foundingCostIncreasePercent)) / 100), `n = ${n}`);
    }
    assert.equal(foundingCost(0), base);
  });
});

describe("zones (00-Game §3.2)", () => {
  it("une case à égale distance de deux villes va à la plus ancienne, quel que soit leur joueur", () => {
    // Villes à 2 R l'une de l'autre : la case du milieu est à R des deux, donc dans le rayon des deux.
    const a = play(LAND_MAP, 2, [[1, 2 * R, Y], [2, 4 * R, Y]]);
    const mid = tileAt(LAND_MAP, 3 * R, Y);
    assert.equal(a.tileCity[mid], 1);
    assert.equal(a.owner[mid], 1);
    // Les cases à côté vont chacune à la plus proche.
    assert.equal(a.tileCity[mid - 1], 1);
    assert.equal(a.tileCity[mid + 1], 2);
    // Fondées dans l'autre ordre, la ville du joueur 2 est la plus ancienne et prend la case.
    const b = play(LAND_MAP, 2, [[2, 4 * R, Y], [1, 2 * R, Y]]);
    assert.equal(b.tileCity[mid], 1);
    assert.equal(b.owner[mid], 2);
    assert.equal(b.cities[0]!.player, 2);
    checkCityInvariants(a);
    checkCityInvariants(b);
  });

  it("une ville fondée près d'une autre lui prend les cases qui lui sont strictement plus proches, y compris le fer", () => {
    // Ville 1 en x = A, ville 2 (joueur 2) en A + R + 1, juste hors du rayon de la ville 1.
    // Fer, écarts à A : +2 (2 de la ville 1, R − 1 de la ville 2 : reste) ; −R (R contre 2R + 1 : reste) ;
    // R − 2 (contre 3 : pris) ; R (contre 1 : pris) ; R + 5 (hors du rayon de la ville 1, à 4 de la ville 2).
    const A = 3 * R;
    const iron = [A + 2, A - R, A + R - 2, A + R, A + R + 5];
    const map = customMap(8 * R, 5 * R, land, (x, y) => y === Y && iron.includes(x));
    const s = play(map, 2, [[1, A, Y]]);
    assert.equal(s.players[0]!.resourceTiles[0], 4);
    assert.equal(s.players[1]!.resourceTiles[0], 0);

    const before = s.owner.slice();
    const changed = applyTurn(s, {
      turn: 2,
      intents: [{ type: "found_city", player: 2, tile: tileAt(map, A + R + 1, Y) }],
    });
    const stolen = changed.filter((t) => before[t] === 1);
    assert.ok(stolen.length > 0);
    for (const t of stolen) assert.equal(s.owner[t], 2);
    assert.deepEqual(iron.map((x) => s.owner[tileAt(map, x, Y)]), [1, 1, 2, 2, 2]);
    assert.equal(s.players[0]!.resourceTiles[0], 2);
    assert.equal(s.players[1]!.resourceTiles[0], 3);
    // Toute case de la liste a changé de propriétaire pendant le tour.
    for (const t of changed) assert.notEqual(s.owner[t], before[t]);
    assert.equal(s.players[0]!.tileCount + s.players[1]!.tileCount, s.owner.filter((o) => o !== 0).length);
    checkCityInvariants(s);
  });

  it("les cases qui passent d'une ville à une autre du même joueur ne sont pas listées : tileCity change, owner non", () => {
    // Deux villes du joueur 1 à R + 2 cases l'une de l'autre. La case à R − 3 de la première est à 5 de la seconde.
    const A = 2 * R;
    const s = play(LAND_MAP, 1, [[1, A, Y]]);
    const before = s.owner.slice();
    const changed = applyTurn(s, { turn: 2, intents: [{ type: "found_city", player: 1, tile: tileAt(LAND_MAP, A + R + 2, Y) }] });
    const moved = tileAt(LAND_MAP, A + R - 3, Y);
    assert.equal(s.tileCity[moved], 2);
    assert.equal(before[moved], 1);
    assert.ok(!changed.includes(moved));
    for (const t of changed) assert.equal(before[t], 0);
    checkCityInvariants(s);
  });

  it("couvre l'eau comme la terre, et se coupe au bord de la carte", () => {
    const map = customMap(4 * R, 3 * R, (x) => (x >= R ? "ocean" : "land"));
    const s = play(map, 1, [[1, 3, 2]]);
    assert.equal(s.tileCity[tileAt(map, R + 2, 2)], 1, "case d'océan à R − 1 de la ville");
    assert.equal(s.tileCity[tileAt(map, R + 4, 2)], 0, "hors du rayon");
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
    // A et B à 2 R = E l'une de l'autre (reliées) ; M1 et M2 à R − 2 au-dessus et au-dessous du milieu.
    const cx = 4 * R;
    const cy = Y;
    const d = R - 2;
    const s = play(LAND_MAP, 2, [
      [1, cx - R, cy],
      [1, cx + R, cy],
    ]);
    assert.deepEqual(s.roads, [[1, 2]]);
    // Le joueur 2 pose deux villes de part et d'autre, plus proches l'une de l'autre que les deux premières.
    applyTurn(s, { turn: 3, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy - d) }] });
    assert.deepEqual(s.roads, [[1, 3], [2, 3], [1, 2]]);
    applyTurn(s, { turn: 4, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy + d) }] });
    assert.deepEqual(s.roads, [[1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
    checkCityInvariants(s);
  });

  it("deux villes à plus que le rayon d'expansion ne sont pas reliées ; à exactement le rayon, elles le sont", () => {
    const r = CITY.expansionRadius;
    const s = play(LAND_MAP, 1, [[1, 20, Y], [1, 20 + r, Y]]);
    assert.deepEqual(s.roads, [[1, 2]]);
    const t = play(LAND_MAP, 1, [[1, 20, Y], [1, 20 + r - 1, Y], [1, 20 + 2 * r - 2, Y]]);
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
    const inland = play(LAND_MAP, 1, [[1, 4 * R, Y]]);
    assert.equal(inland.cities[0]!.port, false);
    const sea = 4 * R;
    const map = customMap(8 * R, 5 * R, (x) => (x >= sea ? "ocean" : "land"));
    // À 4 cases de l'eau : port. À R (la case d'eau est à R : dans le rayon) : port ; à R + 1 : non.
    assert.equal(play(map, 1, [[1, sea - 4, Y]]).cities[0]!.port, true);
    assert.equal(play(map, 1, [[1, sea - R, Y]]).cities[0]!.port, true);
    assert.equal(play(map, 1, [[1, sea - R - 1, Y]]).cities[0]!.port, false);
  });

  it("un lac compte comme de l'eau (choix provisoire, 02-Engine §7)", () => {
    const map = customMap(8 * R, 5 * R, (x, y) => (x === 4 * R + 5 && y === Y ? "lake" : "land"));
    assert.equal(play(map, 1, [[1, 4 * R, Y]]).cities[0]!.port, true);
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
    // Une seule colonne d'eau, d'une case de large, à R de la ville : sa case (col, Y) est la seule case d'eau de la zone.
    const col = 2 * R;
    const map = customMap(4 * R, 4 * R, (x) => (x === col ? "ocean" : "land"));
    const s = play(map, 2, [[1, col - R, Y]]);
    assert.equal(s.cities[0]!.port, true);
    assert.equal(s.tileCity[tileAt(map, col, Y)], 1);
    // Une ville à 3 de la colonne d'eau, de l'autre côté : (col, Y) lui devient plus proche.
    applyTurn(s, { turn: 2, intents: [{ type: "found_city", player: 2, tile: tileAt(map, col + 3, Y) }] });
    assert.equal(s.tileCity[tileAt(map, col, Y)], 2);
    assert.equal(s.cities[0]!.port, false);
    assert.equal(s.cities[1]!.port, true);
    checkCityInvariants(s);
  });
});

describe("groupes (00-Game §3.5)", () => {
  it("les villes d'un joueur reliées entre elles forment un groupe, nommé par son plus petit identifiant", () => {
    // Trois villes du joueur 1 à 3 R / 2 les unes des autres (dans le rayon d'expansion), une du joueur 2 à 3 R.
    const step = Math.floor((3 * R) / 2);
    const s = play(LAND_MAP, 2, [[1, 4 * R, Y], [1, 4 * R + step, Y], [1, 4 * R, Y + step], [2, R, Y]]);
    assert.deepEqual(s.cities.map((c) => c.group), [1, 1, 1, 4]);
    assert.equal(s.players[0]!.cityIds.length, 3);
  });

  it("les villes d'un joueur séparées par la route d'un autre joueur forment deux groupes", () => {
    // A et B à 2 R = E l'une de l'autre (reliées) ; M1 et M2 à R − 2 au-dessus et au-dessous du milieu.
    const cx = 4 * R;
    const cy = Y;
    const d = R - 2;
    const s = play(LAND_MAP, 2, [
      [1, cx - R, cy],
      [1, cx + R, cy],
    ]);
    assert.deepEqual(s.cities.map((c) => c.group), [1, 1]);
    // Le joueur 2 pose M1 et M2 de part et d'autre de la route 1-2, plus près l'une de l'autre que A et B.
    applyTurn(s, { turn: 3, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy - d) }] });
    applyTurn(s, { turn: 4, intents: [{ type: "found_city", player: 2, tile: tileAt(LAND_MAP, cx, cy + d) }] });
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
    // Villes espacées de E : 1 et 3 sont à 2 E l'une de l'autre, hors de portée ; seule la ville 2, au milieu, les relie.
    const s = play(LAND_MAP, 1, [[1, R, Y], [1, R + E, Y], [1, R + 2 * E, Y]]);
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
    // La population grossit avec la nourriture : au moins un joueur a plus de villes que la population de départ n'en paie.
    let paid = 1;
    for (let left = POPULATION.initial; left >= foundingCost(paid); paid++) left -= foundingCost(paid);
    assert.ok(r.state.players.some((p) => p.cityIds.length > paid), `${paid} villes payées au départ`);
    for (const p of r.state.players) assert.ok(p.population >= 0, `joueur ${p.id}`);
  });

  it("garde les invariants avec plus de 140 villes, carte presque pleine (population rechargée à chaque tour)", () => {
    const r = runScenario({
      ...DEFAULT_SCENARIO,
      players: 6,
      turns: 200,
      foundMinPopulation: 0,
      onTurn: (state) => {
        for (const p of state.players) if (p.capital !== 0) p.population = Math.max(p.population, foundingCost(p.cityIds.length));
      },
    });
    assert.ok(r.cities >= 140, `${r.cities} villes`);
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
