// Visualisation des fronts (Docs/Design/05-Fronts.md §13.5) : les routes, les connexions
// en couleur de leur front, le point du front de chaque connexion, les fronts de chaque
// joueur (île, adversaire, connexions) et les chaînes du §11.4 (l'ordre des connexions le
// long du front, tel que la page de jeu le calcule : `client/src/frontgeom.ts`). Une partie
// scriptée (même scénario que les tests, avec ses guerres et ses attaques) est jouée ; la
// page montre l'état tous les `every` tours, avec un curseur. Écrit out/fronts.html : une
// page autonome, à ouvrir dans un navigateur.
//
// Usage (dans packages/engine) :
//   npm run viz:fronts
//   npm run viz:fronts -- --seed=7 --players=10 --turns=5000 --every=250

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { frontChains, type GeomWorld } from "../../../client/src/frontgeom.ts";
import type { FrontView } from "../../../client/src/protocol.ts";
import { CITY, generateTestMap, isActive, type GameState } from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";

const args = new Map(
  process.argv
    .slice(2)
    .map((a) => /^--(\w+)=(-?\d+)$/.exec(a))
    .filter((m) => m !== null)
    .map((m) => [m[1]!, Number(m[2])] as const),
);
const seed = args.get("seed") ?? 12345;
const players = args.get("players") ?? 8;
const turns = args.get("turns") ?? 4000;
const every = Math.max(1, args.get("every") ?? 200);

const map = generateTestMap(seed);

interface Step {
  turn: number;
  stats: string;
  cities: [number, number, number][];
  roads: [number, number][];
  fronts: { id: number; players: [number, number]; groups: [number, number]; active: boolean; connections: [number, number, number][]; chains: number[][]; soldiers: [number, number] }[];
}

const steps: Step[] = [];

function snapshot(state: GameState, turn: number): void {
  const world: GeomWorld = {
    width: map.width,
    height: map.height,
    cityTile: state.cities.map((c) => c.tile),
    roads: state.roads.flat(),
    controlRadius: CITY.controlRadius,
  };
  const fronts = state.fronts.map((f) => {
    const view = {
      id: f.id,
      players: [f.players[0], f.players[1]],
      groups: [f.groups[0], f.groups[1]],
      active: isActive(state, f),
      connections: f.connections.map((c) => ({ city1: c.city1, city2: c.city2, position: c.position })),
      sides: [],
    } as unknown as FrontView;
    const soldiers = f.sides.map((s) => s.firstLine.reduce((a, b) => a + b, 0) + s.secondLine.reduce((a, b) => a + b, 0)) as [number, number];
    return {
      id: f.id,
      players: [f.players[0], f.players[1]] as [number, number],
      groups: [f.groups[0], f.groups[1]] as [number, number],
      active: view.active,
      connections: f.connections.map((c) => [c.city1, c.city2, view.active ? c.position : 500] as [number, number, number]),
      chains: frontChains(world, view).map((c) => c.order),
      soldiers,
    };
  });
  steps.push({
    turn,
    stats: `tour ${turn} · ${state.cities.length} villes · ${fronts.length} fronts dont ${fronts.filter((f) => f.active).length} actifs`,
    cities: state.cities.map((c) => [c.tile % map.width, Math.floor(c.tile / map.width), c.player]),
    roads: state.roads.map(([a, b]) => [a, b]),
    fronts,
  });
}

runScenario({
  ...DEFAULT_SCENARIO,
  map,
  mapSeed: seed,
  players,
  turns,
  onTurn: (s, turn) => {
    if (turn % every === 0) snapshot(s, turn);
  },
});

const html = `<!doctype html>
<meta charset="utf-8">
<title>Fronts — visualisation</title>
<style>
  body { font: 13px system-ui, sans-serif; margin: 12px; }
  canvas { border: 1px solid #aaa; background: #e8eef4; max-width: 100%; height: auto; }
  #bar { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
  #bar input { width: 520px; }
  table { border-collapse: collapse; margin-top: 8px; }
  td, th { border: 1px solid #ccc; padding: 2px 8px; text-align: right; }
  .sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; }
</style>
<div id="bar"><input id="step" type="range" min="0" max="${steps.length - 1}" value="${steps.length - 1}"><span id="stats"></span></div>
<canvas id="map" width="${map.width * 2}" height="${map.height * 2}"></canvas>
<table id="table"></table>
<script>
const W = ${map.width}, H = ${map.height}, Z = 2;
const steps = ${JSON.stringify(steps)};
const land = ${JSON.stringify(Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => ((map.terrain[y * map.width + x]! & 0x80) !== 0 ? 1 : 0)).join("")))};
const hue = (n) => "hsl(" + ((n * 137.508) % 360) + ",65%,45%)";
const cv = document.getElementById("map"), ctx = cv.getContext("2d");
function draw(i) {
  const s = steps[i];
  document.getElementById("stats").textContent = s.stats;
  ctx.fillStyle = "#cfe0f0"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#d9d2b6";
  for (let y = 0; y < H; y++) { const row = land[y]; for (let x = 0; x < W; x++) if (row[x] === "1") ctx.fillRect(x * Z, y * Z, Z, Z); }
  const c = (id) => s.cities[id - 1];
  ctx.lineWidth = 1; ctx.strokeStyle = "#7774";
  for (const [a, b] of s.roads) { ctx.beginPath(); ctx.moveTo(c(a)[0] * Z, c(a)[1] * Z); ctx.lineTo(c(b)[0] * Z, c(b)[1] * Z); ctx.stroke(); }
  for (const f of s.fronts) {
    const col = f.active ? "#d11" : hue(f.id);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
    const pts = f.connections.map(([a, b, p]) => [(c(a)[0] + (c(b)[0] - c(a)[0]) * p / 1000) * Z, (c(a)[1] + (c(b)[1] - c(a)[1]) * p / 1000) * Z]);
    f.connections.forEach(([a, b], k) => { ctx.beginPath(); ctx.moveTo(c(a)[0] * Z, c(a)[1] * Z); ctx.lineTo(c(b)[0] * Z, c(b)[1] * Z); ctx.stroke(); });
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#000";
    for (const chain of f.chains) { ctx.beginPath(); chain.forEach((k, j) => { const p = pts[k]; j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke(); }
    for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fillStyle = "#000"; ctx.fill(); }
  }
  for (const [x, y, p] of s.cities) { ctx.beginPath(); ctx.arc(x * Z, y * Z, 3.5, 0, 7); ctx.fillStyle = hue(p + 40); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); }
  const rows = ["<tr><th>Front</th><th>Joueur</th><th>Île</th><th>Adversaire</th><th>Île adverse</th><th>Connexions</th><th>État</th><th>Unités (eux / adversaire)</th><th>Chaînes</th></tr>"];
  for (const f of s.fronts) for (const k of [0, 1]) rows.push("<tr><td>" + f.id + "</td><td><span class=sw style='background:" + hue(f.players[k]) + "'></span>" + f.players[k] + "</td><td>" + f.groups[k] + "</td><td>" + f.players[1 - k] + "</td><td>" + f.groups[1 - k] + "</td><td>" + f.connections.length + "</td><td>" + (f.active ? "guerre" : "paix") + "</td><td>" + f.soldiers[k] + " / " + f.soldiers[1 - k] + "</td><td>" + f.chains.map((ch) => ch.join("→")).join(" | ") + "</td></tr>");
  document.getElementById("table").innerHTML = rows.join("");
}
const slider = document.getElementById("step");
slider.addEventListener("input", () => draw(+slider.value));
draw(steps.length - 1);
</script>
`;

const out = join(import.meta.dirname, "..", "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "fronts.html"), html);
console.log(`out/fronts.html écrit : ${steps.length} étapes, graine ${seed}, ${players} joueurs.`);
