// Visualisation d'une partie scriptée : villes, zones, routes, ports, groupes
// (00-Game §3), population, surface cultivée et pêchée (00-Game §4, §6). Des
// joueurs simulés fondent des villes (même scénario que les tests, payées par la
// croissance de la population) ; la page montre l'état après chaque série de
// fondations et tous les `every` tours, avec un curseur. Écrit out/cities.html :
// une page autonome, à ouvrir dans un navigateur.
//
// Usage (dans packages/engine) :
//   npm run viz:cities
//   npm run viz:cities -- --seed=7 --players=12 --cities=400 --stride=4
// Réglages : seed (carte), players, cities (nombre de villes visé), stride (villes
// fondées entre deux étapes), every (tours entre deux étapes, 0 = jamais), turns
// (tours joués au plus), orders (ordres de chaque joueur par tour), minPop
// (population qu'un bot veut avoir avant de fonder une ville), botSeed.
//
// Le rayon d'exploitation (00-Game §6.6) est calculé ici, dans la page : le
// moteur ne le calcule pas. Les champs et la zone de pêche sont de l'affichage.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { CITY, generateTestMap, RESOURCE_IRON, type GameState } from "../src/index.ts";
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
const target = args.get("cities") ?? 250;
const stride = Math.max(1, args.get("stride") ?? 4);
const orders = args.get("orders") ?? 1;
const every = Math.max(0, args.get("every") ?? 100);
const maxTurns = args.get("turns") ?? 6000;
const minPop = args.get("minPop") ?? DEFAULT_SCENARIO.foundMinPopulation;
const botSeed = args.get("botSeed") ?? DEFAULT_SCENARIO.botSeed;

const map = generateTestMap(seed);
const { width: W, height: H } = map;
const pack = (bytes: Uint8Array): string => deflateSync(bytes).toString("base64");

interface Step {
  turn: number;
  /** Villes existantes à cette étape : les n premières de la liste finale. */
  n: number;
  stats: string;
  /** tileCity en XOR avec l'étape précédente (Uint16, deflate, base64). */
  tc: string;
  /** Uint16 : [n, groupes (n), ports (n), nombre de routes, a, b, a, b…]. */
  st: string;
  /**
   * Par joueur : [population, fermiers, pêcheurs, inactifs, nourriture, villes,
   * surface cultivée, surface max, surface pêchée, cases d'eau, % de fermiers].
   */
  pl: number[][];
}

// Étape 0 : aucune ville.
const steps: Step[] = [
  {
    turn: 0,
    n: 0,
    stats: "tour 0 · aucune ville",
    tc: pack(new Uint8Array(W * H * 2)),
    st: pack(new Uint8Array(new Uint16Array([0, 0]).buffer)),
    pl: Array.from({ length: players }, () => new Array<number>(11).fill(0)),
  },
];
let previous = new Uint16Array(W * H);
let lastCount = 0;

function snapshot(state: GameState, turn: number): void {
  const n = state.cities.length;
  const delta = new Uint16Array(state.tileCity);
  for (let t = 0; t < delta.length; t++) delta[t]! ^= previous[t]!;
  previous = state.tileCity.slice();

  const st = new Uint16Array(2 + 2 * n + 2 * state.roads.length);
  st[0] = n;
  state.cities.forEach((c, i) => {
    st[1 + i] = c.group;
    st[1 + n + i] = c.port ? 1 : 0;
  });
  st[1 + 2 * n] = state.roads.length;
  state.roads.forEach(([a, b], i) => {
    st[2 + 2 * n + 2 * i] = a;
    st[3 + 2 * n + 2 * i] = b;
  });

  let ports = 0;
  let detached = 0;
  for (const c of state.cities) {
    if (c.port) ports++;
    if (c.group !== state.cities[state.players[c.player - 1]!.capital - 1]!.group) detached++;
  }
  const stats =
    `tour ${turn} · ${n} villes · ${state.roads.length} routes · ${ports} ports · ` +
    `${detached} villes hors du groupe de leur capitale`;
  steps.push({
    turn,
    n,
    stats,
    tc: pack(new Uint8Array(delta.buffer)),
    st: pack(new Uint8Array(st.buffer)),
    pl: state.players.map((p) => [
      p.population, p.farmers, p.fishers, p.idle, p.food, p.cityIds.length,
      p.cultivated, p.farmTiles, p.fished, p.seaTiles, p.farmPercent,
    ]),
  });
  lastCount = n;
}

/** Levée par onTurn pour arrêter la partie une fois le nombre de villes visé atteint. */
const STOP = new Error("fin de la partie scriptée");
let state!: GameState;
let lastTurn = 0;
const t0 = performance.now();
try {
  runScenario({
    ...DEFAULT_SCENARIO,
    map,
    mapSeed: seed,
    players,
    botSeed,
    ordersPerPlayer: orders,
    foundMinPopulation: minPop,
    turns: maxTurns,
    onTurn: (s, turn) => {
      state = s;
      lastTurn = turn;
      const n = s.cities.length;
      if (n >= target) {
        snapshot(s, turn);
        throw STOP;
      }
      if (n - lastCount >= stride || (every > 0 && turn % every === 0)) snapshot(s, turn);
    },
  });
} catch (e) {
  if (e !== STOP) throw e;
}
const ms = performance.now() - t0;
if (steps[steps.length - 1]!.turn < lastTurn) snapshot(state, lastTurn);
const final = steps[steps.length - 1]!;
const cityList = state.cities.map((c) => [c.tile, c.player] as const);

const payload = {
  W,
  H,
  seed,
  players,
  expansionRadius: CITY.expansionRadius,
  controlRadius: CITY.controlRadius,
  capitals: state.players.map((p) => p.capital),
  cities: cityList,
  ms: Math.round(ms),
  terrain: pack(map.terrain),
  iron: pack(Uint8Array.from(map.resources, (b) => b & RESOURCE_IRON)),
  fertility: pack(map.fertility),
  steps,
};

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Villes, zones et routes</title>
<style>
  :root { --bg: #f4f3ef; --fg: #1d232b; --muted: #5d6670; --line: #d5d2ca; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: var(--muted); }
  .bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 12px 0; }
  button { font: inherit; padding: 4px 12px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; }
  input[type=range] { flex: 1 1 240px; }
  #stats { font-weight: 600; font-variant-numeric: tabular-nums; min-width: 260px; }
  canvas { display: block; width: 100%; max-width: ${W * 2}px; height: auto; border: 1px solid var(--line); background: #fff; }
  label { white-space: nowrap; }
  table { border-collapse: collapse; margin: 8px 0 12px; font-variant-numeric: tabular-nums; font-size: 13px; }
  th, td { padding: 2px 10px; text-align: right; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 600; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-size: 12px; color: var(--muted); }
  .sw { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; margin-right: 4px; border: 1px solid #0003; }
</style>
</head>
<body>
<h1>Villes, zones et routes — partie scriptée</h1>
<div class="muted" id="params"></div>
<div class="bar">
  <button id="prev">←</button>
  <input type="range" id="slider" min="0" value="0">
  <button id="next">→</button>
  <span id="stats"></span>
</div>
<div class="bar">
  <label><input type="checkbox" id="zones" checked> zones des joueurs</label>
  <label><input type="checkbox" id="edges" checked> limites des zones</label>
  <label><input type="checkbox" id="iron" checked> fer</label>
  <label><input type="checkbox" id="roads" checked> routes</label>
  <label><input type="checkbox" id="cities" checked> villes</label>
  <label><input type="checkbox" id="fields" checked> surface cultivée</label>
  <label><input type="checkbox" id="fishing" checked> surface pêchée</label>
</div>
<table>
  <thead><tr>
    <th>joueur</th><th>population</th><th>fermiers</th><th>pêcheurs</th><th>inactifs</th><th>nourriture</th>
    <th>villes</th><th>cultivé / max</th><th>pêché / max</th><th>% fermiers</th>
  </tr></thead>
  <tbody id="table"></tbody>
</table>
<canvas id="map"></canvas>
<div class="legend">
  <span><span class="sw" style="background:#c0392b"></span>case de fer</span>
  <span>● ville ; ★ capitale ; <span class="sw" style="background:#1d6fd8"></span>port</span>
  <span>trait plein : route entre deux villes du même joueur ; pointillé gris : route vers la ville d'un autre joueur</span>
  <span>trait blanc fin : limite entre deux villes du même joueur ; trait sombre : limite entre deux joueurs</span>
  <span><span class="sw" style="background:repeating-linear-gradient(#609834 0 2px, #80be48 2px 4px)"></span>champs : cases fertiles à moins de r d'une ville, r commun à toutes les villes du joueur, tel que leur nombre ≈ surface cultivée</span>
  <span><span class="sw" style="background:radial-gradient(#e1f0fa 25%, #8ab8e0 30%) 0 0/4px 4px"></span>pêche : cases d'eau de la zone à moins de r d'une ville, calculé de même avec la surface pêchée</span>
</div>
<p class="muted">Flèches gauche / droite du clavier : étape précédente / suivante. Chaque étape est
l'état après une série de fondations, ou après un nombre fixe de tours. Les villes sont payées par la
croissance de la population (00-Game §4.1) ; le tableau donne les résultats du dernier tour de l'étape.
Les rayons d'exploitation (champs, pêche) sont calculés par cette page, pas par le moteur (00-Game §6.6).</p>
<script>
const P = ${JSON.stringify(payload).replace(/</g, "\\u003c")};
const SCALE = 2;

async function unpack(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const css = (c) => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
const playerColor = (p) => hsl((p * 137.508) % 360, 0.6, 0.55);
const playerDark = (p) => hsl((p * 137.508) % 360, 0.65, 0.3);

function landColor(alt) {
  const t = alt / 31;
  const lo = [150, 176, 112], mid = [181, 160, 118], hi = [236, 232, 224];
  const [a, b, u] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, (t - 0.5) * 2];
  return a.map((v, i) => Math.round(v + (b[i] - v) * u));
}

const canvas = document.getElementById("map");
canvas.width = P.W * SCALE;
canvas.height = P.H * SCALE;
const ctx = canvas.getContext("2d");
const off = document.createElement("canvas");
off.width = P.W;
off.height = P.H;
const offCtx = off.getContext("2d");
let terrain, iron, fertility;

// tileCity de l'étape i : étapes en XOR avec la précédente ; on repart de la
// dernière étape reconstruite si elle est avant i, sinon du début.
let known = { index: -1, ids: new Uint16Array(P.W * P.H) };
async function tileCityAt(i) {
  if (known.index > i) known = { index: -1, ids: new Uint16Array(P.W * P.H) };
  while (known.index < i) {
    const delta = new Uint16Array((await unpack(P.steps[known.index + 1].tc)).buffer);
    const ids = new Uint16Array(known.ids);
    for (let t = 0; t < ids.length; t++) ids[t] ^= delta[t];
    known = { index: known.index + 1, ids };
  }
  return known.ids;
}

const slider = document.getElementById("slider");
slider.max = P.steps.length - 1;
const boxes = Object.fromEntries(["zones", "edges", "iron", "roads", "cities", "fields", "fishing"].map((k) => [k, document.getElementById(k)]));
const cx = (t) => ((t % P.W) + 0.5) * SCALE;
const cy = (t) => (Math.floor(t / P.W) + 0.5) * SCALE;

function star(x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.45;
    if (k === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
}

// Rayon d'exploitation (00-Game §6.6), affichage seulement. Pour chaque joueur,
// un seuil de distance au carré commun à toutes ses villes, tel que le nombre de
// cases de ses zones à moins de ce seuil de leur ville soit le plus proche
// possible de la surface cultivée (cases de terre fertiles) ou pêchée (cases
// d'eau). À égalité, le plus petit seuil ; -1 : aucune case.
function exploitationThresholds(ids, pl) {
  const R2 = P.controlRadius * P.controlRadius;
  const farm = Array.from({ length: P.players }, () => new Int32Array(R2 + 1));
  const sea = Array.from({ length: P.players }, () => new Int32Array(R2 + 1));
  for (let t = 0; t < ids.length; t++) {
    if (ids[t] === 0) continue;
    const land = (terrain[t] & 0x80) !== 0;
    if (land && fertility[t] === 0) continue;
    const [ct, p] = P.cities[ids[t] - 1];
    const dx = (t % P.W) - (ct % P.W), dy = Math.floor(t / P.W) - Math.floor(ct / P.W);
    (land ? farm : sea)[p - 1][dx * dx + dy * dy]++;
  }
  const pick = (hist, target) => {
    let best = -1, bestDiff = target, cum = 0;
    for (let d2 = 0; d2 < hist.length; d2++) {
      cum += hist[d2];
      const diff = Math.abs(cum - target);
      if (diff < bestDiff) { best = d2; bestDiff = diff; }
    }
    return best;
  };
  return { farm: pl.map((row, k) => pick(farm[k], row[6])), sea: pl.map((row, k) => pick(sea[k], row[8])) };
}

function fillTable(pl) {
  document.getElementById("table").innerHTML = pl.map((r, k) => {
    const sw = '<span class="sw" style="background:' + css(playerColor(k + 1)) + '"></span>';
    return "<tr><td>" + sw + (k + 1) + "</td><td>" + r[0] + "</td><td>" + r[1] + "</td><td>" + r[2] + "</td><td>" + r[3] +
      "</td><td>" + r[4] + "</td><td>" + r[5] + "</td><td>" + r[6] + " / " + r[7] + "</td><td>" + r[8] + " / " + r[9] +
      "</td><td>" + r[10] + "</td></tr>";
  }).join("");
}

let drawing = false, again = false;
async function draw() {
  if (drawing) { again = true; return; }
  drawing = true;
  do {
    again = false;
    await drawOnce();
  } while (again);
  drawing = false;
}

async function drawOnce() {
  const i = Number(slider.value);
  const step = P.steps[i];
  const ids = await tileCityAt(i);
  const st = new Uint16Array((await unpack(step.st)).buffer);
  const n = st[0];
  const groups = st.subarray(1, 1 + n);
  const ports = st.subarray(1 + n, 1 + 2 * n);
  const nRoads = st[1 + 2 * n];
  const roads = st.subarray(2 + 2 * n, 2 + 2 * n + 2 * nRoads);
  document.getElementById("stats").textContent = step.stats + "  (" + (i + 1) + " / " + P.steps.length + ")";
  fillTable(step.pl);
  const thr = exploitationThresholds(ids, step.pl);

  const img = new ImageData(P.W, P.H);
  const d = img.data;
  const owner = (t) => (ids[t] === 0 ? 0 : P.cities[ids[t] - 1][1]);
  for (let t = 0; t < terrain.length; t++) {
    const b = terrain[t];
    let c = b & 0x80 ? landColor(b & 0x1f) : [111, 156, 204];
    if (boxes.iron.checked && iron[t]) c = [192, 57, 43];
    // Le territoire n'est dessiné que sur la terre (00-Game §11) : la zone
    // d'une ville couvre aussi l'eau dans le moteur, mais pas à l'affichage.
    const onLand = (b & 0x80) !== 0;
    if (boxes.zones.checked && onLand && ids[t] !== 0) {
      const pc = playerColor(owner(t));
      c = c.map((v, k) => Math.round(v * 0.55 + pc[k] * 0.45));
    }
    // Champs (terre fertile) et zone de pêche (eau), à moins du rayon d'exploitation du joueur.
    // Texture propre à chacun, qui ne reprend pas la couleur du joueur (00-Game §11).
    if (ids[t] !== 0 && (onLand ? fertility[t] !== 0 && boxes.fields.checked : boxes.fishing.checked)) {
      const [ct, p] = P.cities[ids[t] - 1];
      const dx = (t % P.W) - (ct % P.W), dy = Math.floor(t / P.W) - Math.floor(ct / P.W);
      if (dx * dx + dy * dy <= (onLand ? thr.farm : thr.sea)[p - 1]) {
        const x = t % P.W, y = Math.floor(t / P.W);
        if (onLand) c = y % 2 === 0 ? [96, 152, 52] : [128, 190, 72];
        else c = (x + 2 * y) % 4 === 0 ? [225, 240, 250] : [138, 184, 224];
      }
    }
    if (boxes.edges.checked && onLand && ids[t] !== 0) {
      const x = t % P.W;
      for (const u of [x < P.W - 1 ? t + 1 : -1, t + P.W < terrain.length ? t + P.W : -1]) {
        if (u < 0 || !(terrain[u] & 0x80) || ids[u] === 0 || ids[u] === ids[t]) continue;
        c = owner(u) === owner(t) ? [255, 255, 255] : [29, 35, 43];
        break;
      }
    }
    d[t * 4] = c[0]; d[t * 4 + 1] = c[1]; d[t * 4 + 2] = c[2]; d[t * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  if (boxes.roads.checked) {
    for (let r = 0; r < nRoads; r++) {
      const a = P.cities[roads[2 * r] - 1], b = P.cities[roads[2 * r + 1] - 1];
      const same = a[1] === b[1];
      ctx.beginPath();
      ctx.setLineDash(same ? [] : [4, 3]);
      ctx.strokeStyle = same ? css(playerDark(a[1])) : "rgba(60, 60, 60, 0.8)";
      ctx.lineWidth = same ? 2 : 1.5;
      ctx.moveTo(cx(a[0]), cy(a[0]));
      ctx.lineTo(cx(b[0]), cy(b[0]));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (boxes.cities.checked) {
    for (let k = 0; k < n; k++) {
      const [tile, p] = P.cities[k];
      const capital = P.capitals[p - 1] === k + 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = css(playerDark(p));
      if (capital) star(cx(tile), cy(tile), 8);
      else { ctx.beginPath(); ctx.arc(cx(tile), cy(tile), 4, 0, Math.PI * 2); }
      ctx.fill();
      ctx.stroke();
      if (ports[k]) {
        ctx.fillStyle = "#1d6fd8";
        ctx.fillRect(cx(tile) + 4, cy(tile) - 10, 6, 6);
        ctx.strokeRect(cx(tile) + 4, cy(tile) - 10, 6, 6);
      }
    }
  }
}

const go = (i) => { slider.value = Math.max(0, Math.min(P.steps.length - 1, i)); draw(); };
document.getElementById("prev").onclick = () => go(Number(slider.value) - 1);
document.getElementById("next").onclick = () => go(Number(slider.value) + 1);
slider.oninput = draw;
for (const b of Object.values(boxes)) b.onchange = draw;
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") go(Number(slider.value) - 1);
  if (e.key === "ArrowRight") go(Number(slider.value) + 1);
});

document.getElementById("params").textContent =
  "Carte de test " + P.W + " × " + P.H + ", graine " + P.seed + " · " + P.players + " joueurs · " +
  "rayon de contrôle " + P.controlRadius + ", rayon d'expansion " + P.expansionRadius +
  " (valeurs d'essai) · partie jouée en " + P.ms + " ms";

Promise.all([unpack(P.terrain), unpack(P.iron), unpack(P.fertility)]).then(([t, f, fe]) => { terrain = t; iron = f; fertility = fe; slider.value = P.steps.length - 1; draw(); });
</script>
</body>
</html>
`;

const outDir = join(import.meta.dirname, "..", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "cities.html");
writeFileSync(outFile, html);
console.log(
  `${steps.length} étapes, ${final.n} villes, ${lastTurn} tours joués en ${Math.round(ms)} ms → ` +
    `${outFile} (${Math.round(html.length / 1024)} Ko)`,
);
