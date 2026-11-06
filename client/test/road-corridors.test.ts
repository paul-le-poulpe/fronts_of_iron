// Couloirs de routes (Docs/Design/03-Client.md §6) : la copie de la page les calcule, la peinture y retire les champs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Mirror, ROAD_CORRIDOR_RADIUS, TERRAIN_LAND } from "../src/mirror.ts";
import { Painter } from "../src/painter.ts";
import { SoloGame } from "../src/solo.ts";

function played() {
  const game = new SoloGame({ mapSeed: 12345, bots: 3 });
  const mirror = new Mirror(game.init());
  const painter = new Painter(mirror);
  painter.paintAll();
  for (let i = 0; i < 2500; i++) painter.paintTiles(mirror.applyTick(game.step([])));
  return { mirror, painter };
}

describe("couloirs de routes", () => {
  it("les cases à moins du rayon d'une route sont dans le couloir, et seulement elles", () => {
    const { mirror } = played();
    const w = mirror.width;
    assert.ok(mirror.roadTiles.length > 0);
    const near = new Uint8Array(mirror.roadCorridor.length);
    const r = ROAD_CORRIDOR_RADIUS;
    for (const path of mirror.roadTiles) {
      for (const t of path) {
        const x = t % w;
        const y = (t - x) / w;
        for (let v = Math.max(0, y - r); v <= Math.min(mirror.height - 1, y + r); v++) {
          for (let u = Math.max(0, x - r); u <= Math.min(w - 1, x + r); u++) {
            if ((u - x) ** 2 + (v - y) ** 2 <= r * r) near[v * w + u] = 1;
          }
        }
      }
    }
    assert.deepEqual(mirror.roadCorridor, near);
  });

  it("une case cultivable d'un joueur perd sa teinte verte dans le couloir, une terre libre la garde", () => {
    const { mirror, painter } = played();
    const fertile = (t: number): boolean => (mirror.terrain[t]! & TERRAIN_LAND) !== 0 && mirror.fertility[t] !== 0 && (mirror.resources[t]! & 1) === 0;
    const owned = mirror.roadCorridor.findIndex((c, t) => c === 1 && fertile(t) && mirror.tileCity[t] !== 0);
    const free = mirror.tileCity.findIndex((id, t) => id === 0 && fertile(t));
    assert.ok(owned >= 0 && free >= 0);
    const inside = painter.colorOf(owned);
    const freeColor = painter.colorOf(free);
    mirror.roadCorridor[owned] = 0;
    assert.notEqual(painter.colorOf(owned), inside);
    mirror.roadCorridor[free] = 1;
    assert.equal(painter.colorOf(free), freeColor);
  });
});
