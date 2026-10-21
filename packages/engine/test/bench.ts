// Mesure : génération de la carte, temps moyen d'un tour, temps d'un hash.
// Usage : npm run bench (dans packages/engine).

import { performance } from "node:perf_hooks";

import { generateTestMap, hashState } from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";

const TURNS = 10_000;

let t0 = performance.now();
const map = generateTestMap(DEFAULT_SCENARIO.mapSeed);
const mapMs = performance.now() - t0;

const r = runScenario({ ...DEFAULT_SCENARIO, map, turns: TURNS }, () => performance.now());

const HASHES = 200;
t0 = performance.now();
for (let i = 0; i < HASHES; i++) hashState(r.state);
const hashMs = (performance.now() - t0) / HASHES;

const intentsPerTurn = DEFAULT_SCENARIO.players * DEFAULT_SCENARIO.claimsPerPlayer + 1;
console.log(`carte ${map.width}×${map.height} = ${map.width * map.height} cases, générée en ${mapMs.toFixed(1)} ms`);
console.log(`${TURNS} tours, ${intentsPerTurn} ordres par tour, ${r.validIntents} cases prises`);
console.log(`temps moyen d'un tour (applyTurn) : ${((r.applyMs / TURNS) * 1000).toFixed(2)} µs`);
console.log(`temps d'un hash de l'état complet : ${hashMs.toFixed(2)} ms`);
