// Tests du client sans navigateur : la partie solo (bots, ordres humains) et la
// copie locale de la page (mirror.ts, painter.ts) font tourner le même code que
// le Worker et la page, sur des messages réels.

import assert from "node:assert/strict";
import { test } from "node:test";

import { hashState } from "@fronts-of-iron/engine";

import { farmShareTarget } from "../src/bots.ts";
import { Mirror } from "../src/mirror.ts";
import { Painter } from "../src/painter.ts";
import { HUMAN, type TickMessage } from "../src/protocol.ts";
import { SoloGame } from "../src/solo.ts";

function setup(mapSeed: number, bots: number) {
  const game = new SoloGame({ mapSeed, bots });
  const mirror = new Mirror(game.init());
  const painter = new Painter(mirror);
  painter.paintAll();
  const apply = (msg: TickMessage): void => painter.paintTiles(mirror.applyTick(msg));
  return { game, mirror, painter, apply };
}

test("les bots jouent : ils fondent des villes et leur population évolue", () => {
  const { game, mirror, apply } = setup(12345, 3);
  for (let i = 0; i < 1500; i++) apply(game.step([]));
  for (const p of mirror.stats.slice(1)) {
    assert.ok(p.cities >= 2, `bot ${p.id} a ${p.cities} ville(s)`);
    assert.ok(p.capital > 0);
  }
  assert.equal(mirror.stats[0]!.cities, 0, "l'humain n'a rien fait");
});

test("deux parties avec les mêmes réglages donnent le même état", () => {
  const run = (): number => {
    const game = new SoloGame({ mapSeed: 7, bots: 2 });
    for (let i = 0; i < 600; i++) game.step([]);
    return hashState(game.state);
  };
  assert.equal(run(), run());
});

test("la copie de la page suit le moteur : villes, cases, seuils, pixels", () => {
  const { game, mirror, painter, apply } = setup(12345, 4);
  for (let i = 1; i <= 1200; i++) {
    apply(game.step([]));
    if (i % 100 !== 0) continue;
    assert.deepEqual(mirror.tileCity, game.state.tileCity, `tileCity au tour ${i}`);
    assert.equal(mirror.cities.length, game.state.cities.length);
    assert.equal(mirror.roads.length / 2, game.state.roads.length);
    const ref = mirror.referenceThresholds();
    assert.deepEqual([...mirror.farmThreshold], ref.farm, `seuils des champs au tour ${i}`);
    assert.deepEqual([...mirror.seaThreshold], ref.sea, `seuils de pêche au tour ${i}`);
    // Peinture incrémentale = peinture complète.
    const full = new Painter(mirror);
    full.paintAll();
    assert.ok(Buffer.from(full.buffer).equals(Buffer.from(painter.buffer)), `pixels au tour ${i}`);
  }
});

test("ordre humain : fondation appliquée ou refusée, signalée dans les résultats", () => {
  const { game, mirror, apply } = setup(12345, 1);
  const { map } = game.state;
  // Une case de terre fertile libre, et une case d'eau (refusée par le moteur).
  let land = -1;
  let water = -1;
  for (let t = 0; t < map.terrain.length && (land < 0 || water < 0); t++) {
    if (land < 0 && map.fertility[t]! > 0 && (t % map.width) > 300) land = t;
    if (water < 0 && (map.terrain[t]! & 0x80) === 0) water = t;
  }
  const msg = game.step([
    { id: 1, order: { type: "found_city", tile: water } },
    { id: 2, order: { type: "found_city", tile: land } },
    { id: 3, order: { type: "set_farm_share", percent: 40 } },
    { id: 4, order: { type: "set_farm_share", percent: 140 } },
  ]);
  apply(msg);
  assert.deepEqual(
    msg.results.map((r) => [r.id, r.applied]),
    [[1, false], [2, true], [3, true], [4, false]],
  );
  assert.equal(mirror.stats[HUMAN - 1]!.cities, 1);
  assert.equal(mirror.stats[HUMAN - 1]!.farmPercent, 40);
  assert.equal(mirror.cities.find((c) => c.player === HUMAN)!.tile, land);
});

test("un ordre humain ne peut pas parler au nom d'un autre joueur", () => {
  const { game, apply } = setup(12345, 2);
  const forged = { type: "found_city", tile: 1000, player: 2 } as unknown as { type: "found_city"; tile: number };
  const msg = game.step([{ id: 1, order: forged }]);
  apply(msg);
  assert.ok(game.state.cities.every((c) => c.player !== 2 || c.tile !== 1000));
});

test("part de fermiers des bots", () => {
  assert.equal(farmShareTarget(1000, 317, 0), 100, "sans eau");
  assert.equal(farmShareTarget(1000, 0, 50), 0, "sans terre fertile");
  assert.equal(farmShareTarget(1000, 150, 50), 50, "500 fermiers requis sur 1000");
  assert.equal(farmShareTarget(1000, 317, 50), 100, "1057 fermiers requis > population");
});

test("mesure du coût d'un tour (affiché, pas vérifié)", () => {
  const { game, apply } = setup(12345, 7);
  let apply_ = 0, bots = 0, pack = 0, max = 0;
  const n = 3000;
  for (let i = 0; i < n; i++) {
    const msg = game.step([]);
    apply_ += msg.perf.apply;
    bots += msg.perf.bots;
    pack += msg.perf.pack;
    max = Math.max(max, msg.perf.apply + msg.perf.bots + msg.perf.pack);
    apply(msg);
  }
  console.log(
    `# ${n} tours, 8 joueurs, ${game.state.cities.length} villes : bots ${(bots / n).toFixed(3)} ms, ` +
      `moteur ${(apply_ / n).toFixed(3)} ms, message ${(pack / n).toFixed(3)} ms par tour (max ${max.toFixed(1)} ms)`,
  );
});
