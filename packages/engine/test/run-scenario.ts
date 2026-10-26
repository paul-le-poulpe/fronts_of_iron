// Lancé dans un processus séparé par determinism.test.ts.
// Usage : node test/run-scenario.ts <tours>
// Écrit sur la sortie standard le JSON { finalHash, checkpoints, changedTiles, cities, starvingPlayerTurns, filledLinePlayerTurns, soldierPlayerTurns, fightingTurns, captures, totalPopulation }.

import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";

const turns = Number(process.argv[2]);
const r = runScenario({ ...DEFAULT_SCENARIO, turns });
process.stdout.write(
  JSON.stringify({
    finalHash: r.finalHash,
    checkpoints: r.checkpoints,
    changedTiles: r.changedTiles,
    cities: r.cities,
    starvingPlayerTurns: r.starvingPlayerTurns,
    filledLinePlayerTurns: r.filledLinePlayerTurns,
    soldierPlayerTurns: r.soldierPlayerTurns,
    fightingTurns: r.fightingTurns,
    captures: r.captures,
    totalPopulation: r.totalPopulation,
  }),
);
