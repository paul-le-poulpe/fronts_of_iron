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
    assert.equal(a.cities, b.cities);
    assert.deepEqual(b.checkpoints, a.checkpoints);
    assert.equal(b.finalHash, a.finalHash);
    // Le même scénario dans ce processus-ci donne aussi le même résultat.
    const c = runScenario({ ...DEFAULT_SCENARIO, turns: TURNS });
    assert.equal(c.finalHash, a.finalHash);
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
