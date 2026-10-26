// Fronts côté page (Docs/Design/05-Fronts.md §11, §13.4) : géométrie (chaînes, courbe de
// Catmull-Rom, zones), message des fronts, double ligne rouge, copie de la page après une
// prise de ville. Sous Node, sans navigateur.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CITY, FRONTS } from "@fronts-of-iron/engine";

import { catmullRom, computeFrontZones, connectionPoint, frontChains, type GeomWorld } from "../src/frontgeom.ts";
import { Mirror } from "../src/mirror.ts";
import { Painter } from "../src/painter.ts";
import { HUMAN, type FrontView, type TickMessage } from "../src/protocol.ts";
import { SoloGame } from "../src/solo.ts";

const R = CITY.controlRadius;

/** Une ville par case (x, y) dans un monde de 200 × 200 cases. */
function world(cities: [number, number][], roads: [number, number][]): GeomWorld {
  return {
    width: 200,
    height: 200,
    cityTile: cities.map(([x, y]) => y * 200 + x),
    roads: roads.flat(),
    controlRadius: R,
  };
}

/** Un front à la main, en paix ou en guerre. */
function view(connections: [number, number, number][], active: boolean, id = 1): FrontView {
  const empty = { first: [], second: [], transit: [], priority: 0, reassign: false, lineMode: [], motorizedOnly: true, frontAttack: false, breakthroughs: [] };
  return {
    id,
    players: [1, 2],
    groups: [1, 2],
    active,
    connections: connections.map(([city1, city2, position]) => ({ city1, city2, position })),
    sides: [empty, empty],
  };
}

test("point du front : city1 + (city2 − city1) × position / 1000, 500 en paix", () => {
  const w = world([[10, 10], [50, 10]], [[1, 2]]);
  assert.deepEqual(connectionPoint(w, view([[1, 2, 250]], true), 0), { x: 20.5, y: 10.5 });
  assert.deepEqual(connectionPoint(w, view([[1, 2, 250]], false), 0), { x: 30.5, y: 10.5 }, "en paix, le milieu de la route");
});

test("chaînes : les connexions consécutives autour d'une ville, dans l'ordre le long du front", () => {
  // Villes du joueur 1 en haut (1, 2), du joueur 2 en bas (3, 4, 5) : un front en zigzag, routes 1-3, 1-4, 2-4, 2-5.
  const w = world([[40, 40], [80, 40], [30, 70], [60, 70], [90, 70]], [[1, 2], [3, 4], [4, 5], [1, 3], [1, 4], [2, 4], [2, 5]]);
  const f = view([[1, 3, 500], [1, 4, 500], [2, 4, 500], [2, 5, 500]], true);
  const chains = frontChains(w, f);
  assert.equal(chains.length, 1);
  const order = chains[0]!.order;
  // Un bout à l'autre : 1-3, 1-4, 2-4, 2-5 (ou l'inverse).
  const forward = [0, 1, 2, 3];
  assert.ok(JSON.stringify(order) === JSON.stringify(forward) || JSON.stringify(order) === JSON.stringify([...forward].reverse()), `ordre ${order}`);
  assert.equal(chains[0]!.closed, false);
});

test("courbe de Catmull-Rom centripète : passe par les points, point du bout répété", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 8 }];
  const curve = catmullRom(pts)!;
  assert.deepEqual(curve.start, pts[0]);
  assert.deepEqual(curve.segments.map((s) => s.to), pts.slice(1));
  // Aux bouts, P0 = P1 : d1 = 0, donc B1 = P1.
  assert.deepEqual(curve.segments[0]!.c1, pts[0]);
  assert.deepEqual(curve.segments[curve.segments.length - 1]!.c2, pts[3]);
  // Une courbe sur des points alignés reste sur la droite.
  const straight = catmullRom([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }])!;
  for (const s of straight.segments) for (const c of [s.c1, s.c2]) assert.ok(Math.abs(c.x - c.y) < 1e-9);
  assert.equal(catmullRom([]), null);
  assert.deepEqual(catmullRom([{ x: 3, y: 4 }])!.segments, []);
});

test("zones de front : cases de terre à moins d'un rayon de contrôle de la ligne, le plus proche gagne", () => {
  const w = world([[40, 100], [100, 100], [40, 160], [100, 160]], [[1, 2], [3, 4]]);
  const a = view([[1, 2, 500]], false, 1); // point en (70, 100)
  const b = view([[3, 4, 500]], false, 2); // point en (70, 160)
  const zones = computeFrontZones(w, [a, b], () => true);
  assert.equal(zones[100 * 200 + 70], 1);
  assert.equal(zones[100 * 200 + 70 + R], 1, "à la limite du rayon");
  assert.equal(zones[100 * 200 + 70 + R + 2], 0, "au-delà du rayon");
  assert.equal(zones[160 * 200 + 70], 2);
  assert.equal(zones[115 * 200 + 70], 1, "plus près du premier");
  // À égalité de distance, le plus petit identifiant : deux fronts à 30 cases l'un de l'autre, case à mi-chemin.
  const close = computeFrontZones(world([[40, 100], [100, 100], [40, 130], [100, 130]], [[1, 2], [3, 4]]), [a, b], () => true);
  assert.equal(close[115 * 200 + 70], 1, "à égalité de distance, le plus petit identifiant");
  const noWater = computeFrontZones(w, [a], (t) => t % 200 < 70);
  assert.equal(noWater[100 * 200 + 75], 0, "terre seulement");
  assert.equal(noWater[100 * 200 + 65], 1);
});

/** Une partie solo où le joueur a fondé une ville à portée de route de la première ville du bot. */
function duelGame(): { game: SoloGame; mirror: Mirror; painter: Painter; apply: (msg: TickMessage) => void; botCity: number; humanCity: number } {
  const game = new SoloGame({ mapSeed: 12345, bots: 1 });
  const mirror = new Mirror(game.init());
  const painter = new Painter(mirror);
  painter.paintAll();
  const apply = (msg: TickMessage): void => painter.paintTiles(mirror.applyTick(msg));
  for (let i = 0; i < 600 && game.state.cities.length === 0; i++) apply(game.step([]));
  assert.ok(game.state.cities.length > 0, "le bot a fondé sa première ville");
  const bot = game.state.cities[0]!;
  const { map } = game.state;
  const bx = bot.tile % map.width;
  const by = Math.floor(bot.tile / map.width);
  // Une case de terre libre à 1,5 R de la ville du bot, hors de portée de sa zone.
  let tile = -1;
  for (let a = 0; a < 360 && tile < 0; a += 10) {
    const x = Math.round(bx + 1.5 * R * Math.cos((a * Math.PI) / 180));
    const y = Math.round(by + 1.5 * R * Math.sin((a * Math.PI) / 180));
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const t = y * map.width + x;
    if ((map.terrain[t]! & 0x80) !== 0 && game.state.tileCity[t] === 0) tile = t;
  }
  assert.ok(tile >= 0);
  const msg = game.step([{ id: 1, order: { type: "found_city", tile } }]);
  apply(msg);
  assert.equal(msg.results[0]!.applied, true);
  return { game, mirror, painter, apply, botCity: bot.id, humanCity: game.state.cities.find((c) => c.player === HUMAN)!.id };
}

test("message des fronts : envoyé quand quelque chose change, null sinon ; guerre et double ligne rouge", () => {
  const { game, mirror, painter, apply } = duelGame();
  assert.equal(mirror.fronts.length, 1);
  assert.equal(mirror.fronts[0]!.active, false);
  assert.equal(mirror.fronts[0]!.connections.length, 1);
  // Entre deux rounds, sans ordre : rien à renvoyer.
  let nulls = 0;
  for (let i = 0; i < 25; i++) {
    const msg = game.step([]);
    if (msg.tick % FRONTS.combatTurns !== 0 && msg.fronts === null) nulls++;
    apply(msg);
  }
  assert.ok(nulls > 10, `${nulls} messages sans fronts`);
  // Guerre : le front devient actif, ses connexions sont au milieu, la double ligne rouge est peinte.
  const redBefore = countRed(painter);
  assert.equal(redBefore, 0);
  const msg = game.step([{ id: 2, order: { type: "declare_war", target: 2 } }]);
  apply(msg);
  assert.equal(msg.results[0]!.applied, true);
  assert.ok(msg.fronts !== null && msg.fronts[0]!.active);
  assert.equal(msg.fronts[0]!.connections[0]!.position, 500);
  const [a, b] = [mirror.fronts[0]!.connections[0]!.city1, mirror.fronts[0]!.connections[0]!.city2];
  assert.ok(mirror.isFrontPair(a, b));
  assert.ok(countRed(painter) > 10, "des cases rouges de chaque côté de la limite");
  // Peinture incrémentale = peinture complète.
  const full = new Painter(mirror);
  full.paintAll();
  assert.ok(Buffer.from(full.buffer).equals(Buffer.from(painter.buffer)));
  // Les zones de front contiennent le milieu de la route.
  const zones = mirror.frontZones();
  const w = mirror.world();
  const p = connectionPoint(w, mirror.fronts[0]!, 0);
  assert.equal(zones[Math.floor(p.y) * mirror.width + Math.floor(p.x)], mirror.fronts[0]!.id);
});

/** Nombre de pixels de la couleur de la ligne de front dans le tampon du painter. */
function countRed(painter: Painter): number {
  const red = ((255 << 24) | (30 << 16) | (30 << 8) | 200) >>> 0;
  let n = 0;
  for (let t = 0; t < painter.buffer.byteLength / 4; t++) if (painter.pixel(t) === red) n++;
  return n;
}

test("prise d'une ville : la copie de la page suit le moteur (villes, cases, seuils, pixels)", () => {
  const { game, mirror, painter, apply, botCity } = duelGame();
  apply(game.step([{ id: 2, order: { type: "declare_war", target: 2 } }]));
  const front = game.state.fronts[0]!;
  // Des troupes posées à la main : l'attaquant (joueur 1) écrase le défenseur.
  front.sides[0]!.firstLine[0] = 500;
  front.sides[1]!.firstLine[0] = 100;
  for (const p of game.state.players) p.soldiers = p.id === 1 ? 5000 : 1000;
  apply(game.step([{ id: 3, order: { type: "start_front_attack", front: front.id } }]));
  let captured = false;
  for (let i = 0; i < 3000 && !captured; i++) {
    const msg = game.step([]);
    apply(msg);
    captured = msg.captured.some((c) => c.city === botCity);
  }
  assert.ok(captured, "la ville du bot est prise");
  assert.equal(game.state.cities[botCity - 1]!.player, HUMAN);
  assert.equal(mirror.cities[botCity - 1]!.player, HUMAN);
  assert.deepEqual(mirror.tileCity, game.state.tileCity);
  const ref = mirror.referenceThresholds();
  assert.deepEqual([...mirror.farmThreshold], ref.farm);
  assert.deepEqual([...mirror.seaThreshold], ref.sea);
  assert.deepEqual([...mirror.ironThreshold], ref.iron);
  const full = new Painter(mirror);
  full.paintAll();
  assert.ok(Buffer.from(full.buffer).equals(Buffer.from(painter.buffer)), "pixels après la prise");
  // Plus de front entre les joueurs 1 et 2 si le bot n'a plus d'autre ville reliée.
  assert.ok(mirror.fronts.every((f) => f.connections.length > 0));
});
