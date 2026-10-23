import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateResourcePresence,
  generateTestMap,
  presenceThreshold,
  RESOURCES,
  resourceNoise,
  TERRAIN_ALTITUDE,
  TERRAIN_LAND,
} from "../src/index.ts";

const CFG = RESOURCES.iron.presence;
const MAP = generateTestMap(12345);
const IRON = generateResourcePresence(MAP, 12345, CFG);

describe("présence du fer", () => {
  it("est la même pour la même graine", () => {
    assert.deepEqual(generateResourcePresence(generateTestMap(12345), 12345, CFG), IRON);
  });

  it("n'est jamais sur l'eau, et suit la comparaison bruit / seuil", () => {
    const noise = resourceNoise(MAP, 12345, CFG);
    for (let t = 0; t < IRON.length; t++) {
      const b = MAP.terrain[t]!;
      if ((b & TERRAIN_LAND) === 0) assert.equal(IRON[t], 0);
      else assert.equal(IRON[t], noise[t]! > presenceThreshold(b & TERRAIN_ALTITUDE, CFG) ? 1 : 0);
    }
  });

  it("est plus fréquente en montagne qu'ailleurs", () => {
    let plain = 0, plainIron = 0, mountain = 0, mountainIron = 0;
    for (let t = 0; t < IRON.length; t++) {
      const b = MAP.terrain[t]!;
      if ((b & TERRAIN_LAND) === 0) continue;
      if ((b & TERRAIN_ALTITUDE) >= CFG.mountainAltitude) {
        mountain++;
        mountainIron += IRON[t]!;
      } else {
        plain++;
        plainIron += IRON[t]!;
      }
    }
    assert.ok(mountainIron * plain > plainIron * mountain);
  });
});
