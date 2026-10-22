// Visualisation pas à pas de la génération des zones maritimes (00-Game §2.1).
// Écrit out/sea-zones.html : une page autonome, à ouvrir dans un navigateur.
//
// Usage (dans packages/engine) :
//   npm run viz:sea
//   npm run viz:sea -- --seed=7 --spacing=50 --iterations=20
// Réglages acceptés : seed et chaque champ de SEA_ZONES.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import {
  computeSeaZones,
  generateSeaZones,
  generateTestMap,
  landMask,
  SEA_ZONES,
  type SeaZonesConfig,
  type SeaZonesStep,
} from "../src/index.ts";

const args = new Map(
  process.argv
    .slice(2)
    .map((a) => /^--(\w+)=(-?\d+)$/.exec(a))
    .filter((m) => m !== null)
    .map((m) => [m[1]!, Number(m[2])] as const),
);
const seed = args.get("seed") ?? 12345;
const cfg: SeaZonesConfig = {
  spacing: args.get("spacing") ?? SEA_ZONES.spacing,
  maxLandPercent: args.get("maxLandPercent") ?? SEA_ZONES.maxLandPercent,
  iterations: args.get("iterations") ?? SEA_ZONES.iterations,
  minBasinArea: args.get("minBasinArea") ?? SEA_ZONES.minBasinArea,
  finalIterations: args.get("finalIterations") ?? SEA_ZONES.finalIterations,
};

const map = generateTestMap(seed);
const { width: W, height: H } = map;
const land = landMask(map);
const steps: SeaZonesStep[] = [];
const t0 = performance.now();
generateSeaZones(W, H, land, cfg, (s) => steps.push(s));
const ms = performance.now() - t0;

const pack = (bytes: Uint8Array): string => deflateSync(bytes).toString("base64");

// Carrés de la grille : pourcentage de terre, et supprimé ou non.
const squares: { x0: number; y0: number; x1: number; y1: number; pct: number; removed: boolean }[] = [];
const s = cfg.spacing;
for (let y0 = 0; y0 + (s >> 1) < H; y0 += s) {
  for (let x0 = 0; x0 + (s >> 1) < W; x0 += s) {
    const x1 = Math.min(x0 + s, W);
    const y1 = Math.min(y0 + s, H);
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += land[y * W + x]!;
    const area = (x1 - x0) * (y1 - y0);
    squares.push({ x0, y0, x1, y1, pct: Math.round((n * 100) / area), removed: n * 100 > cfg.maxLandPercent * area });
  }
}

let water = 0;
for (let t = 0; t < land.length; t++) if (land[t] === 0) water++;

// Zones de chaque étape : la première en entier, les suivantes en XOR avec la
// précédente (peu de cases changent d'une itération à l'autre : le XOR est
// presque nul et se compresse bien).
let previous: Uint16Array | null = null;
const data = steps.map((step) => {
  const base = { label: step.label, kind: step.kind, points: step.points };
  if (step.kind === "grid") return { ...base, stats: `${step.points.length} points` };
  const { zone } = computeSeaZones(W, H, land, step.points);
  const ids = new Uint16Array(zone.length);
  const area = new Array<number>(step.points.length).fill(0);
  let none = 0;
  for (let t = 0; t < zone.length; t++) {
    const z = zone[t]!;
    ids[t] = z + 1;
    if (z >= 0) area[z]!++;
    else if (land[t] === 0) none++;
  }
  area.sort((a, b) => a - b);
  const stats =
    `${step.points.length} points · surface des zones : min ${area[0]}, médiane ${area[area.length >> 1]}, ` +
    `max ${area[area.length - 1]} (visée ${s * s}) · eau hors zone : ${none} cases`;
  const delta = new Uint16Array(ids);
  if (previous) for (let t = 0; t < delta.length; t++) delta[t]! ^= previous[t]!;
  previous = ids;
  return { ...base, stats, zones: pack(new Uint8Array(delta.buffer)) };
});

const payload = {
  W,
  H,
  seed,
  cfg,
  ms: Math.round(ms),
  water,
  terrain: pack(map.terrain),
  squares,
  steps: data,
};

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zones maritimes</title>
<style>
  :root { --bg: #f4f3ef; --fg: #1d232b; --muted: #5d6670; --line: #d5d2ca; --accent: #c2410c; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: var(--muted); }
  .bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 12px 0; }
  button { font: inherit; padding: 4px 12px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; }
  input[type=range] { flex: 1 1 240px; }
  #label { font-weight: 600; font-size: 16px; min-width: 200px; }
  #stats { font-variant-numeric: tabular-nums; }
  canvas { display: block; width: 100%; max-width: ${W * 2}px; height: auto; border: 1px solid var(--line); background: #fff; }
  label { white-space: nowrap; }
</style>
</head>
<body>
<h1>Zones maritimes — génération pas à pas</h1>
<div class="muted" id="params"></div>
<div class="bar">
  <button id="prev">←</button>
  <input type="range" id="slider" min="0" value="0">
  <button id="next">→</button>
  <span id="label"></span>
</div>
<div class="bar">
  <label><input type="checkbox" id="fill" checked> couleurs des zones</label>
  <label><input type="checkbox" id="edges" checked> limites</label>
  <label><input type="checkbox" id="moves" checked> déplacements depuis l'étape précédente</label>
</div>
<div id="stats" class="muted"></div>
<canvas id="map"></canvas>
<p class="muted">Flèches gauche / droite du clavier : étape précédente / suivante.
Gris foncé : eau qui n'est dans aucune zone. Rouge sur la grille : carré supprimé (plus de ${cfg.maxLandPercent} % de terre).
Correction : point orange = ajouté, croix rouge = retiré.</p>
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
let terrain;

// Zones de l'étape i : la première étape "zones" est complète, les suivantes
// sont en XOR avec la précédente. On repart de la dernière étape reconstruite
// si elle est avant i, sinon du début.
const firstZones = P.steps.findIndex((s) => s.kind === "zones");
let known = { index: -1, ids: null };
async function zonesAt(i) {
  if (known.index > i || known.index < firstZones) {
    known = { index: firstZones, ids: new Uint16Array((await unpack(P.steps[firstZones].zones)).buffer) };
  }
  while (known.index < i) {
    const delta = new Uint16Array((await unpack(P.steps[known.index + 1].zones)).buffer);
    const ids = new Uint16Array(known.ids);
    for (let t = 0; t < ids.length; t++) ids[t] ^= delta[t];
    known = { index: known.index + 1, ids };
  }
  return known.ids;
}

async function imageFor(i, fill, edges) {
  const step = P.steps[i];
  const img = new ImageData(P.W, P.H);
  const d = img.data;
  const zones = step.kind === "zones" ? await zonesAt(i) : null;
  for (let t = 0; t < terrain.length; t++) {
    const b = terrain[t];
    let c;
    if (b & 0x80) c = landColor(b & 0x1f);
    else if (!zones) c = [111, 156, 204];
    else {
      const z = zones[t];
      if (z === 0) c = [59, 74, 90];
      else if (!fill) c = [111, 156, 204];
      else c = hsl((z * 137.508) % 360, 0.5, 0.68);
      if (edges && z !== 0) {
        const x = t % P.W;
        const r = x < P.W - 1 ? zones[t + 1] : z;
        const dn = t + P.W < terrain.length ? zones[t + P.W] : z;
        if ((r !== z && r !== 0) || (dn !== z && dn !== 0)) c = [29, 43, 58];
      }
    }
    d[t * 4] = c[0]; d[t * 4 + 1] = c[1]; d[t * 4 + 2] = c[2]; d[t * 4 + 3] = 255;
  }
  return img;
}

const slider = document.getElementById("slider");
slider.max = P.steps.length - 1;
const fillBox = document.getElementById("fill");
const edgesBox = document.getElementById("edges");
const movesBox = document.getElementById("moves");
const cx = (t) => ((t % P.W) + 0.5) * SCALE;
const cy = (t) => (Math.floor(t / P.W) + 0.5) * SCALE;

async function draw() {
  const i = Number(slider.value);
  const step = P.steps[i];
  document.getElementById("label").textContent = step.label + "  (" + (i + 1) + " / " + P.steps.length + ")";
  document.getElementById("stats").textContent = step.stats;
  offCtx.putImageData(await imageFor(i, fillBox.checked, edgesBox.checked), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  if (step.kind === "grid") {
    ctx.lineWidth = 1;
    for (const q of P.squares) {
      if (q.removed && i > 0) {
        ctx.fillStyle = "rgba(220, 38, 38, 0.35)";
        ctx.fillRect(q.x0 * SCALE, q.y0 * SCALE, (q.x1 - q.x0) * SCALE, (q.y1 - q.y0) * SCALE);
      }
      ctx.strokeStyle = "rgba(29, 43, 58, 0.45)";
      ctx.strokeRect(q.x0 * SCALE + 0.5, q.y0 * SCALE + 0.5, (q.x1 - q.x0) * SCALE, (q.y1 - q.y0) * SCALE);
      if (i === 0) {
        ctx.fillStyle = "rgba(29, 43, 58, 0.8)";
        ctx.font = "11px system-ui";
        ctx.fillText(q.pct + "%", q.x0 * SCALE + 4, q.y0 * SCALE + 13);
      }
    }
  }

  const prev = i > 0 ? P.steps[i - 1] : null;
  if (movesBox.checked && prev && prev.kind === "zones" && step.kind === "zones" && prev.points.length === step.points.length) {
    ctx.strokeStyle = "#c2410c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    step.points.forEach((p, k) => { ctx.moveTo(cx(prev.points[k]), cy(prev.points[k])); ctx.lineTo(cx(p), cy(p)); });
    ctx.stroke();
  }

  const before = prev ? new Set(prev.points) : new Set();
  if (step.kind === "zones" && prev && prev.kind === "zones" && prev.points.length !== step.points.length) {
    const now = new Set(step.points);
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const p of prev.points) {
      if (now.has(p)) continue;
      ctx.moveTo(cx(p) - 7, cy(p) - 7); ctx.lineTo(cx(p) + 7, cy(p) + 7);
      ctx.moveTo(cx(p) + 7, cy(p) - 7); ctx.lineTo(cx(p) - 7, cy(p) + 7);
    }
    ctx.stroke();
  }
  for (const p of step.points) {
    const fresh = step.kind === "zones" && prev && prev.points.length !== step.points.length && !before.has(p);
    ctx.beginPath();
    ctx.arc(cx(p), cy(p), fresh ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = fresh ? "#c2410c" : "#111";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

const go = (i) => { slider.value = Math.max(0, Math.min(P.steps.length - 1, i)); draw(); };
document.getElementById("prev").onclick = () => go(Number(slider.value) - 1);
document.getElementById("next").onclick = () => go(Number(slider.value) + 1);
slider.oninput = draw;
for (const b of [fillBox, edgesBox, movesBox]) b.onchange = draw;
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") go(Number(slider.value) - 1);
  if (e.key === "ArrowRight") go(Number(slider.value) + 1);
});

document.getElementById("params").textContent =
  "Carte de test " + P.W + " × " + P.H + ", graine " + P.seed + " · " + P.water + " cases d'eau · " +
  "spacing " + P.cfg.spacing + ", maxLandPercent " + P.cfg.maxLandPercent + ", iterations " + P.cfg.iterations +
  ", minBasinArea " + P.cfg.minBasinArea + ", finalIterations " + P.cfg.finalIterations +
  " (valeurs d'essai, sauf maxLandPercent) · génération : " + P.ms + " ms";

unpack(P.terrain).then((t) => { terrain = t; draw(); });
</script>
</body>
</html>
`;

const outDir = join(import.meta.dirname, "..", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "sea-zones.html");
writeFileSync(outFile, html);
console.log(`${steps.length} étapes, génération en ${Math.round(ms)} ms → ${outFile} (${Math.round(html.length / 1024)} Ko)`);
