import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";

import { generateTestMap } from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";

const TURNS = 10_000;

interface RunOutput {
  finalHash: number;
  checkpoints: number[];
  changedTiles: number;
  cities: number;
  starvingPlayerTurns: number;
  filledLinePlayerTurns: number;
  soldierPlayerTurns: number;
  fightingTurns: number;
  captures: number;
  totalPopulation: number;
}

/** Joue le scénario par défaut dans un processus Node séparé. */
function runInChildProcess(turns: number): RunOutput {
  const script = join(import.meta.dirname, "run-scenario.ts");
  const out = execFileSync(process.execPath, [script, String(turns)], { encoding: "utf8" });
  return JSON.parse(out) as RunOutput;
}

describe("déterminisme", () => {
  it(`deux processus séparés, même graine et mêmes ordres, ${TURNS} tours : mêmes hashes`, () => {
    const a = runInChildProcess(TURNS);
    const b = runInChildProcess(TURNS);
    assert.equal(a.checkpoints.length, TURNS / DEFAULT_SCENARIO.checkpointEvery);
    assert.ok(a.cities >= 50, `seulement ${a.cities} villes fondées : le scénario ne teste rien`);
    assert.ok(a.changedTiles > 10_000, `seulement ${a.changedTiles} cases modifiées : le scénario ne teste rien`);
    // La croissance et la baisse de population (surplus négatif) sont jouées, pas seulement des fondations.
    assert.ok(a.totalPopulation > 0, "aucune population à la fin : la croissance n'est pas testée");
    assert.ok(a.starvingPlayerTurns > 1000, `seulement ${a.starvingPlayerTurns} tours-joueurs de baisse : le surplus négatif n'est pas testé`);
    // Les usines sont jouées : des lignes remplies, donc des ouvriers, des mineurs et du fer.
    assert.ok(a.filledLinePlayerTurns > 1000, `seulement ${a.filledLinePlayerTurns} tours-joueurs avec une ligne remplie : les usines ne sont pas testées`);
    assert.equal(b.filledLinePlayerTurns, a.filledLinePlayerTurns);
    // Les fronts sont joués : des soldats, des attaques et des percées en cours, des villes prises (05-Fronts §13.7).
    assert.ok(a.soldierPlayerTurns > 1000, `seulement ${a.soldierPlayerTurns} tours-joueurs avec des soldats : les troupes ne sont pas testées`);
    assert.ok(a.fightingTurns > 100, `seulement ${a.fightingTurns} tours de combat : le combat n'est pas testé`);
    assert.ok(a.captures >= 1, "aucune ville prise : la prise et l'encerclement ne sont pas testés");
    assert.deepEqual([b.soldierPlayerTurns, b.fightingTurns, b.captures], [a.soldierPlayerTurns, a.fightingTurns, a.captures]);
    assert.equal(a.cities, b.cities);
    assert.equal(b.starvingPlayerTurns, a.starvingPlayerTurns);
    assert.equal(b.totalPopulation, a.totalPopulation);
    assert.deepEqual(b.checkpoints, a.checkpoints);
    assert.equal(b.finalHash, a.finalHash);
    // Le même scénario dans ce processus-ci donne aussi le même résultat.
    const c = runScenario({ ...DEFAULT_SCENARIO, turns: TURNS });
    assert.equal(c.finalHash, a.finalHash);
    assert.equal(c.totalPopulation, a.totalPopulation);
  });

  it("une graine de partie différente donne un hash différent (même carte, mêmes ordres)", () => {
    const map = generateTestMap(DEFAULT_SCENARIO.mapSeed);
    const a = runScenario({ ...DEFAULT_SCENARIO, map, turns: 200 });
    const b = runScenario({ ...DEFAULT_SCENARIO, map, turns: 200, gameSeed: DEFAULT_SCENARIO.gameSeed + 1 });
    assert.notEqual(b.finalHash, a.finalHash);
  });

  it("une graine de carte différente donne un hash différent", () => {
    const a = runScenario({ ...DEFAULT_SCENARIO, turns: 200 });
    const b = runScenario({ ...DEFAULT_SCENARIO, turns: 200, mapSeed: DEFAULT_SCENARIO.mapSeed + 1 });
    assert.notEqual(b.finalHash, a.finalHash);
  });
});
