import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeSeaZones, generateSeaZones, generateTestMap, landMask, SEA_ZONES } from "../src/index.ts";

const MAP = generateTestMap(12345);
const LAND = landMask(MAP);
const W = MAP.width;
const H = MAP.height;
const POINTS = generateSeaZones(W, H, LAND);

/** Bassins (eau reliée par 4 voisins), recalculés ici sans passer par le module. */
function basins(width: number, height: number, land: Uint8Array): { id: Int32Array; area: number[] } {
  const id = new Int32Array(land.length).fill(-1);
  const area: number[] = [];
  for (let s = 0; s < land.length; s++) {
    if (land[s] || id[s] !== -1) continue;
    const stack = [s];
    id[s] = area.length;
    let n = 0;
    while (stack.length > 0) {
      const t = stack.pop()!;
      n++;
      const x = t % width;
      for (const m of [x > 0 ? t - 1 : -1, x < width - 1 ? t + 1 : -1, t - width, t + width]) {
        if (m < 0 || m >= width * height || land[m] || id[m] !== -1) continue;
        id[m] = area.length;
        stack.push(m);
      }
    }
    area.push(n);
  }
  return { id, area };
}

describe("zones maritimes", () => {
  it("donnent les mêmes points pour la même carte", () => {
    assert.deepEqual(generateSeaZones(W, H, landMask(generateTestMap(12345))), POINTS);
  });

  it("posent chaque point sur l'eau, sur une case distincte", () => {
    for (const p of POINTS) assert.equal(LAND[p], 0, `point sur la terre : ${p}`);
    assert.equal(new Set(POINTS).size, POINTS.length);
  });

  it("respectent le nombre de points visé par bassin, et couvrent l'eau des bassins assez grands", () => {
    const { id, area } = basins(W, H, LAND);
    const s2 = SEA_ZONES.spacing * SEA_ZONES.spacing;
    const count = area.map(() => 0);
    for (const p of POINTS) count[id[p]!]!++;
    for (let b = 0; b < area.length; b++) {
      const want = area[b]! < SEA_ZONES.minBasinArea ? 0 : Math.max(1, Math.floor((area[b]! + (s2 >> 1)) / s2));
      assert.equal(count[b], want, `bassin ${b} (${area[b]} cases)`);
    }
    const { zone } = computeSeaZones(W, H, LAND, POINTS);
    for (let t = 0; t < LAND.length; t++) {
      if (LAND[t]) assert.equal(zone[t], -1);
      else assert.equal(zone[t]! >= 0, area[id[t]!]! >= SEA_ZONES.minBasinArea, `case ${t}`);
    }
  });

  it("ne traversent pas la terre : deux mers séparées par une bande de terre ne partagent aucune zone", () => {
    // 30 × 10 : eau, colonne de terre en x = 15, eau. Un seul point, à gauche.
    const w = 30;
    const h = 10;
    const land = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) land[y * w + 15] = 1;
    const { zone } = computeSeaZones(w, h, land, [5 * w + 2]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) assert.equal(zone[y * w + x], x < 15 ? 0 : -1, `(${x}, ${y})`);
    }
  });

  it("ne passent pas entre deux cases de terre qui se touchent par un coin", () => {
    // 2 × 2 : eau en haut à gauche et en bas à droite, terre sur l'autre diagonale.
    const { zone } = computeSeaZones(2, 2, new Uint8Array([0, 1, 1, 0]), [0]);
    assert.equal(zone[3], -1);
  });

  it("donnent une case à égalité de distance au point de plus petit indice", () => {
    // 3 × 1 : points aux deux bouts, la case du milieu est à égale distance.
    const { zone } = computeSeaZones(3, 1, new Uint8Array(3), [2, 0]);
    assert.deepEqual(Array.from(zone), [1, 0, 0]);
  });
});
