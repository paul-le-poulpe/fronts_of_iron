// Visualisation de la présence du fer sur la carte de test (00-Game §2).
// Écrit out/iron.html : une page autonome, à ouvrir dans un navigateur. Les
// curseurs refont la comparaison bruit / seuil dans la page, avec la même
// formule que presenceThreshold (src/resources.ts) ; le bruit lui-même est
// calculé ici par le moteur.
//
// Usage (dans packages/engine) :
//   npm run viz:iron
//   npm run viz:iron -- --seed=7

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { generateTestMap, RESOURCES, resourceNoise } from "../src/index.ts";

const args = new Map(
  process.argv
    .slice(2)
    .map((a) => /^--(\w+)=(-?\d+)$/.exec(a))
    .filter((m) => m !== null)
    .map((m) => [m[1]!, Number(m[2])] as const),
);
const seed = args.get("seed") ?? 12345;
const cfg = RESOURCES.iron.presence;

const map = generateTestMap(seed);
const { width: W, height: H } = map;
const noise = resourceNoise(map, seed, cfg);

const pack = (bytes: Uint8Array): string => deflateSync(bytes).toString("base64");

const payload = {
  W,
  H,
  seed,
  cfg: {
    threshold: cfg.threshold,
    perAltitude: cfg.perAltitude,
    mountainAltitude: cfg.mountainAltitude,
    mountainBonus: cfg.mountainBonus,
  },
  octaves: cfg.octaves,
  terrain: pack(map.terrain),
  noise: pack(new Uint8Array(noise.buffer)),
};

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gisements de fer</title>
<style>
  :root { --bg: #f4f3ef; --fg: #1d232b; --muted: #5d6670; --line: #d5d2ca; --iron: #8b1e1e; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: var(--muted); }
  .layout { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; margin-top: 12px; }
  .panel { flex: 0 1 320px; min-width: 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .panel label { display: block; margin: 10px 0 2px; font-weight: 600; }
  .panel input[type=range] { width: 100%; }
  .value { float: right; font-variant-numeric: tabular-nums; font-weight: 400; }
  .help { font-size: 12px; color: var(--muted); }
  .checks { margin-top: 12px; }
  .checks label { font-weight: 400; display: flex; gap: 6px; align-items: center; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-variant-numeric: tabular-nums; }
  td, th { text-align: left; padding: 2px 4px; border-bottom: 1px solid var(--line); }
  td:last-child, th:last-child { text-align: right; }
  pre { background: #f4f3ef; padding: 8px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; margin: 12px 0 0; }
  button { font: inherit; padding: 4px 12px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; margin-top: 8px; }
  .mapwrap { flex: 1 1 600px; min-width: 0; }
  canvas { display: block; width: 100%; max-width: ${W * 2}px; height: auto; border: 1px solid var(--line); background: #fff; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-size: 12px; color: var(--muted); }
  .sw { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; margin-right: 4px; border: 1px solid #0003; }
</style>
</head>
<body>
<h1>Gisements de fer — proposition</h1>
<div class="muted" id="params"></div>
<div class="layout">
  <div class="panel">
    <div class="help">Une case de terre porte du fer si son bruit (0 à 65 535) dépasse son seuil :
    seuil = base − altitude × baisse par niveau − (bonus si montagne).</div>
    <label>Seuil de base <span class="value" id="v-threshold"></span></label>
    <input type="range" id="threshold" min="30000" max="65535" step="250">
    <div class="help">Plus haut : moins de fer partout.</div>
    <label>Baisse par niveau d'altitude <span class="value" id="v-perAltitude"></span></label>
    <input type="range" id="perAltitude" min="0" max="2000" step="25">
    <div class="help">0 : l'altitude ne compte pas, sauf en montagne.</div>
    <label>Altitude d'une montagne <span class="value" id="v-mountainAltitude"></span></label>
    <input type="range" id="mountainAltitude" min="0" max="31" step="1">
    <div class="help">Altitude de 0 à 31 ; sur cette carte, la terre va de 0 à environ 19.</div>
    <label>Bonus en montagne <span class="value" id="v-mountainBonus"></span></label>
    <input type="range" id="mountainBonus" min="0" max="20000" step="250">
    <div class="help">0 : pas de saut au passage en montagne.</div>
    <div class="checks">
      <label><input type="checkbox" id="showMountains" checked> montrer les montagnes</label>
      <label><input type="checkbox" id="fade"> estomper le relief</label>
    </div>
    <table>
      <thead><tr><th></th><th>cases</th><th>avec fer</th></tr></thead>
      <tbody id="stats"></tbody>
    </table>
    <pre id="config"></pre>
    <button id="reset">Valeurs de config/resources.ts</button>
  </div>
  <div class="mapwrap">
    <canvas id="map"></canvas>
    <div class="legend">
      <span><span class="sw" style="background:#8b1e1e"></span>fer</span>
      <span><span class="sw" style="background:#96b070"></span>plaine</span>
      <span><span class="sw" style="background:#b5a076"></span>colline</span>
      <span><span class="sw" style="background:#d9cfbf;outline:2px solid #6b5b45;outline-offset:-2px"></span>montagne</span>
      <span><span class="sw" style="background:#6f9ccc"></span>eau</span>
    </div>
  </div>
</div>
<script>
const P = ${JSON.stringify(payload).replace(/</g, "\\u003c")};
const SCALE = 2;
const KEYS = ["threshold", "perAltitude", "mountainAltitude", "mountainBonus"];

async function unpack(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function landColor(alt) {
  const t = Math.min(1, alt / 19);
  const lo = [150, 176, 112], mid = [181, 160, 118], hi = [236, 232, 224];
  const [a, b, u] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, (t - 0.5) * 2];
  return a.map((v, i) => Math.round(v + (b[i] - v) * u));
}

// Même formule que presenceThreshold dans src/resources.ts.
const threshold = (alt, c) => c.threshold - alt * c.perAltitude - (alt >= c.mountainAltitude ? c.mountainBonus : 0);

const canvas = document.getElementById("map");
canvas.width = P.W * SCALE;
canvas.height = P.H * SCALE;
const ctx = canvas.getContext("2d");
const off = document.createElement("canvas");
off.width = P.W;
off.height = P.H;
const offCtx = off.getContext("2d");
const inputs = Object.fromEntries(KEYS.map((k) => [k, document.getElementById(k)]));
const showMountains = document.getElementById("showMountains");
const fade = document.getElementById("fade");
let terrain, noise;

function current() {
  return Object.fromEntries(KEYS.map((k) => [k, Number(inputs[k].value)]));
}

function draw() {
  const c = current();
  for (const k of KEYS) document.getElementById("v-" + k).textContent = c[k].toLocaleString("fr-FR");
  const img = new ImageData(P.W, P.H);
  const d = img.data;
  const count = { plain: 0, plainIron: 0, mountain: 0, mountainIron: 0 };
  for (let t = 0; t < terrain.length; t++) {
    const b = terrain[t];
    let col;
    if (!(b & 0x80)) col = [111, 156, 204];
    else {
      const alt = b & 0x1f;
      const mountain = alt >= c.mountainAltitude;
      const iron = noise[t] > threshold(alt, c);
      if (mountain) { count.mountain++; if (iron) count.mountainIron++; }
      else { count.plain++; if (iron) count.plainIron++; }
      col = landColor(alt);
      if (fade.checked) col = col.map((v) => Math.round(v + (255 - v) * 0.6));
      if (mountain && showMountains.checked) {
        const x = t % P.W;
        const edge = (n) => n < 0 || n >= terrain.length || !(terrain[n] & 0x80) || (terrain[n] & 0x1f) < c.mountainAltitude;
        if ((x > 0 && edge(t - 1)) || (x < P.W - 1 && edge(t + 1)) || edge(t - P.W) || edge(t + P.W)) col = [107, 91, 69];
      }
      if (iron) col = [139, 30, 30];
    }
    d[t * 4] = col[0]; d[t * 4 + 1] = col[1]; d[t * 4 + 2] = col[2]; d[t * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  const pct = (a, n) => (n ? ((a * 100) / n).toFixed(1) : "0.0") + " %";
  const land = count.plain + count.mountain;
  const iron = count.plainIron + count.mountainIron;
  document.getElementById("stats").innerHTML =
    "<tr><td>hors montagne</td><td>" + count.plain + "</td><td>" + pct(count.plainIron, count.plain) + "</td></tr>" +
    "<tr><td>montagne</td><td>" + count.mountain + "</td><td>" + pct(count.mountainIron, count.mountain) + "</td></tr>" +
    "<tr><th>toute la terre</th><th>" + land + "</th><th>" + pct(iron, land) + " (" + iron + ")</th></tr>";
  document.getElementById("config").textContent =
    "threshold: " + c.threshold + ",\\nperAltitude: " + c.perAltitude +
    ",\\nmountainBonus: " + c.mountainBonus + ",\\n// à recopier dans TEST_MAP (partagé avec la fertilité) :\\nmountainAltitude: " +
    c.mountainAltitude + ",";
}

function reset() {
  for (const k of KEYS) inputs[k].value = P.cfg[k];
  draw();
}

for (const k of KEYS) inputs[k].oninput = draw;
showMountains.onchange = draw;
fade.onchange = draw;
document.getElementById("reset").onclick = reset;
document.getElementById("params").textContent =
  "Carte de test " + P.W + " × " + P.H + ", graine " + P.seed + " · bruit du fer : octaves " +
  P.octaves.map((o) => "cellule " + o.cell + " × " + o.weight).join(", ") +
  " · valeurs de départ = valeurs d'essai de config/resources.ts, pas des valeurs fixées.";

Promise.all([unpack(P.terrain), unpack(P.noise)]).then(([t, n]) => {
  terrain = t;
  noise = new Uint16Array(n.buffer);
  reset();
});
</script>
</body>
</html>
`;

const outDir = join(import.meta.dirname, "..", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "iron.html");
writeFileSync(outFile, html);
console.log(`→ ${outFile} (${Math.round(html.length / 1024)} Ko)`);
