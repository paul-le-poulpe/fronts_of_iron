// Tracé des routes (roadpaths.ts) sur une petite carte écrite à la main.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MirrorCity } from "../src/mirror.ts";
import { RoadPaths } from "../src/roadpaths.ts";

const W = 21;
const H = 9;
const LAND = 0x80;

/** Terre plate, avec une crête d'altitude 20 en x = 10 sauf un col en y = 8. */
function ridgeMap(): Uint8Array {
  const t = new Uint8Array(W * H).fill(LAND);
  for (let y = 0; y < H - 1; y++) t[y * W + 10] = LAND | 20;
  return t;
}

const city = (id: number, x: number, y: number): MirrorCity => ({ id, player: 1, tile: y * W + x, port: false, group: 1 });

test("la route passe par le col plutôt que par la crête", () => {
  const rp = new RoadPaths(W, H, ridgeMap(), 5);
  const cities = [city(1, 2, 4), city(2, 18, 4)];
  const [path] = rp.sync(cities, Uint16Array.of(1, 2));
  assert.equal(path![0], cities[0]!.tile);
  assert.equal(path![path!.length - 1], cities[1]!.tile);
  assert.ok(path!.some((t) => t === 8 * W + 10), "passe par le col");
});

test("le cache reprend les chemins connus et oublie ceux qui disparaissent", () => {
  const rp = new RoadPaths(W, H, ridgeMap(), 5);
  const cities = [city(1, 2, 4), city(2, 18, 4), city(3, 2, 1)];
  const [first] = rp.sync(cities, Uint16Array.of(1, 2));
  const [again, other] = rp.sync(cities, Uint16Array.of(1, 2, 1, 3));
  assert.equal(again, first, "même objet : pas de recalcul");
  rp.sync(cities, Uint16Array.of(1, 3));
  const [recomputed] = rp.sync(cities, Uint16Array.of(1, 2));
  assert.notEqual(recomputed, first, "route disparue puis revenue : recalculée");
  assert.deepEqual([...recomputed!], [...first!]);
  assert.ok(other!.length > 0);
});

test("sans chemin de terre ni port, la route n'a pas de tracé", () => {
  const t = ridgeMap();
  for (let y = 0; y < H; y++) t[y * W + 10] = 0x20; // un bras de mer coupe la carte
  const rp = new RoadPaths(W, H, t, 5);
  const cities = [city(1, 2, 4), city(2, 18, 4)];
  const [path] = rp.sync(cities, Uint16Array.of(1, 2));
  assert.equal(path!.length, 0);
});

test("deux routes vers une même ville finissent sur les mêmes cases", () => {
  const rp = new RoadPaths(W, H, new Uint8Array(W * H).fill(LAND), 5);
  const cities = [city(1, 2, 1), city(2, 2, 7), city(3, 18, 4)];
  const [a, b] = rp.sync(cities, Uint16Array.of(1, 3, 2, 3));
  const onA = new Set(a);
  const shared = [...b!].filter((t) => onA.has(t));
  assert.ok(shared.length > 6, `${shared.length} cases communes`);
  // Un chemin va de la case de ville la plus petite à la plus grande : celui de B part de C, celui de A y arrive.
  assert.deepEqual([...b!.slice(0, 4)], [...a!.slice(-4)].reverse(), "les quatre cases voisines de C sont les mêmes");
});

/** Terre plate coupée par une mer large de cinq colonnes (x = 8 à 12). */
function seaMap(): Uint8Array {
  const t = new Uint8Array(W * H).fill(LAND);
  for (let y = 0; y < H; y++) for (let x = 8; x <= 12; x++) t[y * W + x] = 0x20;
  return t;
}

test("sans chemin de terre, la route passe par les deux ports et traverse l'eau", () => {
  const rp = new RoadPaths(W, H, seaMap(), 5);
  const cities = [city(1, 2, 4), city(2, 18, 4)];
  const ports = new Map([[1, 4 * W + 7], [2, 4 * W + 13]]);
  const [path] = rp.sync(cities, Uint16Array.of(1, 2), ports);
  assert.equal(path![0], cities[0]!.tile);
  assert.equal(path![path!.length - 1], cities[1]!.tile);
  const span = rp.seaSpan(path!);
  assert.ok(span !== null, "partie en mer connue");
  assert.equal(path![span![0]], 4 * W + 7, "le premier port ouvre la partie en mer");
  assert.equal(path![span![1]], 4 * W + 13, "le second port la ferme");
  for (let k = span![0] + 1; k < span![1]; k++) assert.equal(path![k]! % W >= 8 && path![k]! % W <= 12, true, "entre les ports, que de l'eau");
});

test("la route maritime est recalculée quand un port change ou disparaît", () => {
  const rp = new RoadPaths(W, H, seaMap(), 5);
  const cities = [city(1, 2, 4), city(2, 18, 4)];
  const [first] = rp.sync(cities, Uint16Array.of(1, 2), new Map([[1, 4 * W + 7], [2, 4 * W + 13]]));
  const [same] = rp.sync(cities, Uint16Array.of(1, 2), new Map([[1, 4 * W + 7], [2, 4 * W + 13]]));
  assert.equal(same, first, "ports inchangés : même objet");
  const [moved] = rp.sync(cities, Uint16Array.of(1, 2), new Map([[1, 2 * W + 7], [2, 4 * W + 13]]));
  assert.notEqual(moved, first, "port déplacé : recalculé");
  assert.equal(moved![moved!.length - 1], cities[1]!.tile);
  const [none] = rp.sync(cities, Uint16Array.of(1, 2), new Map([[2, 4 * W + 13]]));
  assert.equal(none!.length, 0, "un port supprimé : plus de tracé");
  assert.equal(rp.seaSpan(none!), null);
});
