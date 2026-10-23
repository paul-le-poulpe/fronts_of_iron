// Mesure : génération de la carte, temps moyen d'un tour, temps d'un hash, et
// coût d'une fondation de ville quand il y en a déjà beaucoup.
// Usage : npm run bench (dans packages/engine).

import { performance } from "node:perf_hooks";

import {
  applyTurn,
  CITY,
  computeRoads,
  createGame,
  generateTestMap,
  hashState,
  TEST_MAP,
  type GameMap,
  type TestMapConfig,
} from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";

const TURNS = 10_000;

let t0 = performance.now();
const map = generateTestMap(DEFAULT_SCENARIO.mapSeed);
const mapMs = performance.now() - t0;

const r = runScenario({ ...DEFAULT_SCENARIO, map, turns: TURNS }, () => performance.now());

const HASHES = 200;
for (let i = 0; i < 20; i++) hashState(r.state); // échauffement du JIT
t0 = performance.now();
for (let i = 0; i < HASHES; i++) hashState(r.state);
const hashMs = (performance.now() - t0) / HASHES;

const intentsPerTurn = DEFAULT_SCENARIO.players * DEFAULT_SCENARIO.ordersPerPlayer + 1;
console.log(`carte ${map.width}×${map.height} = ${map.width * map.height} cases, générée en ${mapMs.toFixed(1)} ms`);
console.log(`${TURNS} tours, ${intentsPerTurn} ordres par tour, ${r.cities} villes fondées, ${r.changedTiles} changements de propriétaire`);
console.log(`temps moyen d'un tour (applyTurn) : ${((r.applyMs / TURNS) * 1000).toFixed(2)} µs`);
console.log(`temps d'un hash de l'état complet : ${hashMs.toFixed(2)} ms`);

/**
 * Remplit la carte de villes au plus serré qu'une grille régulière le permet
 * (lignes tous les 9 cases, villes tous les 11, une ligne sur deux décalée de 5 :
 * toutes à plus du rayon de contrôle l'une de l'autre), en fondant chacune par un
 * ordre `found_city`, un ordre par tour. Les joueurs ont une population illimitée
 * et se partagent la carte en bandes verticales. S'arrête à `target` villes ;
 * relève le temps de chaque fondation.
 */
function fillWithCities(m: GameMap, target: number, players: number): { cities: number; roads: number; roadsMs: number; times: number[] } {
  const state = createGame({ seed: 1, map: m, playerCount: players });
  for (const p of state.players) p.population = 1_000_000_000;
  const times: number[] = [];
  let turn = 0;
  for (let y = 0, row = 0; y < m.height && state.cities.length < target; y += 9, row++) {
    for (let x = (row % 2) * 5; x < m.width && state.cities.length < target; x += 11) {
      const tile = y * m.width + x;
      if ((m.terrain[tile]! & 0x80) === 0) continue;
      const player = 1 + Math.floor((x * players) / m.width);
      const before = state.cities.length;
      const start = performance.now();
      applyTurn(state, { turn: ++turn, intents: [{ type: "found_city", player, tile }] });
      if (state.cities.length > before) times.push(performance.now() - start);
    }
  }
  // Calcul complet du réseau (computeRoads), que la fondation ne fait plus : pour comparaison.
  const tiles = state.cities.map((c) => c.tile);
  const R = 20;
  const start = performance.now();
  for (let i = 0; i < R; i++) computeRoads(tiles, m.width, m.height, CITY.expansionRadius);
  const roadsMs = (performance.now() - start) / R;
  return { cities: state.cities.length, roads: state.roads.length, roadsMs, times };
}

function report(label: string, m: GameMap, target: number): void {
  const { cities, roads, roadsMs, times } = fillWithCities(m, target, 20);
  const last = times.slice(-50);
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  console.log(`${label} : ${cities} villes (${roads} routes), ${times.length} fondations`);
  console.log(`  dernières 50 fondations : moyenne ${mean.toFixed(2)} ms, maximum ${Math.max(...last).toFixed(2)} ms`);
  for (const n of [100, 500, 1000, 2000]) {
    if (times.length >= n) {
      const w = times.slice(n - 20, n);
      console.log(`  fondation n° ${n - 19} à ${n} : moyenne ${(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2)} ms`);
    }
  }
  console.log(`  pour comparaison, calcul complet du réseau (computeRoads, toutes les villes) : ${roadsMs.toFixed(2)} ms`);
}

report("carte de test", map, 3000);
t0 = performance.now();
const big = generateTestMap(DEFAULT_SCENARIO.mapSeed, { ...TEST_MAP, width: 1600, height: 1000 } as unknown as TestMapConfig);
console.log(`carte ${big.width}×${big.height}, générée en ${(performance.now() - t0).toFixed(0)} ms`);
report("grande carte", big, 2100);
