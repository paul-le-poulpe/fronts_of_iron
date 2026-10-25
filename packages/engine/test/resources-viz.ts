// Visualisation de la présence du fer et de l'aluminium sur la carte de test
// (00-Game §2). Écrit out/resources.html : une page autonome, à ouvrir dans un
// navigateur. Les curseurs refont la comparaison bruit / seuil dans la page,
// avec la même formule que presenceThreshold (src/resources.ts) et la même
// règle de conflit que mapgen.ts (l'aluminium prend la case) ; les bruits
// eux-mêmes sont calculés ici par le moteur.
//
// Usage (dans packages/engine) :
//   npm run viz:resources
//   npm run viz:resources -- --seed=7

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
const iron = RESOURCES.iron.presence;
const aluminium = RESOURCES.aluminium.presence;

const map = generateTestMap(seed);
const { width: W, height: H } = map;

const pack = (bytes: Uint8Array): string => deflateSync(bytes).toString("base64");

const payload = {
  W,
  H,
  seed,
  perAltitude: { iron: iron.perAltitude, aluminium: aluminium.perAltitude },
  mountainAltitude: iron.mountainAltitude,
  start: {
    ironThreshold: iron.threshold,
    ironBonus: iron.mountainBonus,
    alThreshold: aluminium.threshold,
    alBonus: aluminium.mountainBonus,
  },
  terrain: pack(map.terrain),
  noiseIron: pack(new Uint8Array(resourceNoise(map, seed, iron).buffer)),
  noiseAl: pack(new Uint8Array(resourceNoise(map, seed, aluminium).buffer)),
};

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fer et aluminium</title>
<style>
  :root { --bg:#f4f3ef; --fg:#1d232b; --muted:#5d6670; --line:#d5d2ca; --card:#fff; --iron:#8b1e1e; --al:#1f3fa8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16191d; --fg:#e8e6e1; --muted:#9aa3ad; --line:#333a42; --card:#1f242a; --iron:#e0605a; --al:#7da0ff; } }
  *{box-sizing:border-box} body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:14px 0 2px} .muted{color:var(--muted)}
  .layout{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin-top:12px}
  .panel{flex:0 1 330px;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
  .panel label{display:block;margin:8px 0 2px;font-weight:600} .panel input[type=range]{width:100%}
  .value{float:right;font-variant-numeric:tabular-nums;font-weight:400} .help{font-size:12px;color:var(--muted)}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  .tabs button{font:inherit;padding:5px 12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}
  .tabs button[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
  table{border-collapse:collapse;width:100%;margin-top:10px;font-variant-numeric:tabular-nums}
  td,th{text-align:right;padding:2px 4px;border-bottom:1px solid var(--line)} td:first-child,th:first-child{text-align:left}
  .mapwrap{flex:1 1 600px;min-width:0} canvas{display:block;width:100%;max-width:1600px;height:auto;border:1px solid var(--line)}
  .legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:8px;font-size:12px;color:var(--muted)}
  .sw{display:inline-block;width:12px;height:12px;vertical-align:-2px;margin-right:4px;border:1px solid #0003}
  pre{background:var(--bg);padding:8px;border-radius:6px;font-size:12px;white-space:pre-wrap;margin:10px 0 0}
  button.reset{font:inherit;padding:4px 12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer;margin-top:8px}
</style></head><body>
<h1>Fer et aluminium</h1>
<div class="muted" id="params"></div>
<div class="layout">
 <div class="panel">
  <div class="tabs" id="tabs">
   <button data-v="result" aria-pressed="true">Résultat</button>
   <button data-v="conflict" aria-pressed="false">Conflits</button>
  </div>
  <h2 style="color:var(--iron)">Fer</h2>
  <label>Seuil de base <span class="value" id="v-it"></span></label><input type="range" id="it" min="45000" max="65535" step="250">
  <div class="help">Plus haut : moins de fer partout. Pour ne baisser que hors montagne, monter aussi le bonus en montagne du même nombre.</div>
  <label>Bonus en montagne <span class="value" id="v-ib"></span></label><input type="range" id="ib" min="0" max="20000" step="250">
  <h2 style="color:var(--al)">Aluminium</h2>
  <label>Seuil de base <span class="value" id="v-at"></span></label><input type="range" id="at" min="50000" max="65535" step="250">
  <div class="help">Plus haut : moins d'aluminium. Même bruit que le fer avec une autre graine, donc d'autres taches.</div>
  <label>Bonus en montagne <span class="value" id="v-ab"></span></label><input type="range" id="ab" min="0" max="20000" step="250">
  <div class="help">Baisse par niveau d'altitude (fixée dans config/resources.ts) : fer ${iron.perAltitude}, aluminium ${aluminium.perAltitude}.</div>
  <table><thead><tr><th></th><th>cases</th><th>fer</th><th>alu.</th></tr></thead><tbody id="stats"></tbody></table>
  <pre id="ratio"></pre>
  <pre id="config"></pre>
  <button class="reset" id="reset">Valeurs de config/resources.ts</button>
 </div>
 <div class="mapwrap"><canvas id="map"></canvas>
  <div class="legend" id="legend"></div></div>
</div>
<script>
const P=${JSON.stringify(payload).replace(/</g, "\\u003c")};
const SCALE=2;
async function unpack(b64){const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const s=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));return new Uint8Array(await new Response(s).arrayBuffer());}
function landColor(alt){const t=Math.min(1,alt/19);const lo=[150,176,112],mid=[181,160,118],hi=[236,232,224];const [a,b,u]=t<0.5?[lo,mid,t*2]:[mid,hi,(t-0.5)*2];return a.map((v,i)=>Math.round(v+(b[i]-v)*u));}
// Même formule que presenceThreshold dans src/resources.ts.
const thr=(alt,t,b,per)=>t-alt*per-(alt>=P.mountainAltitude?b:0);
const ids=["it","ib","at","ab"];const el=Object.fromEntries(ids.map(k=>[k,document.getElementById(k)]));
const canvas=document.getElementById("map");canvas.width=P.W*SCALE;canvas.height=P.H*SCALE;const ctx=canvas.getContext("2d");
const off=document.createElement("canvas");off.width=P.W;off.height=P.H;const offCtx=off.getContext("2d");
let terrain,nI,nA,view="result";
const C_IRON=[139,30,30],C_AL=[31,63,168],C_LOST=[240,150,40];
const LEG={result:[["fer",C_IRON],["aluminium",C_AL]],conflict:[["fer",C_IRON],["aluminium",C_AL],["aluminium à la place du fer",C_LOST]]};
function draw(){
 const v=Object.fromEntries(ids.map(k=>[k,Number(el[k].value)]));
 for(const k of ids)document.getElementById("v-"+k).textContent=v[k].toLocaleString("fr-FR");
 const img=new ImageData(P.W,P.H),d=img.data;
 const s={pl:0,mt:0,ironPl:0,ironMt:0,alPl:0,alMt:0,conflict:0};
 for(let t=0;t<terrain.length;t++){
  const b=terrain[t];let col;
  if(!(b&0x80))col=[111,156,204];
  else{
   const alt=b&0x1f,mt=alt>=P.mountainAltitude;
   const ironHere=nI[t]>thr(alt,v.it,v.ib,P.perAltitude.iron);
   const al=nA[t]>thr(alt,v.at,v.ab,P.perAltitude.aluminium);
   if(mt)s.mt++;else s.pl++;
   if(ironHere&&al)s.conflict++;
   const finalIron=ironHere&&!al;
   if(finalIron){if(mt)s.ironMt++;else s.ironPl++;}
   if(al){if(mt)s.alMt++;else s.alPl++;}
   col=landColor(alt).map(x=>Math.round(x+(255-x)*0.35));
   if(finalIron)col=C_IRON;else if(al)col=(view==="conflict"&&ironHere)?C_LOST:C_AL;
  }
  d[t*4]=col[0];d[t*4+1]=col[1];d[t*4+2]=col[2];d[t*4+3]=255;
 }
 offCtx.putImageData(img,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,0,0,canvas.width,canvas.height);
 const pct=(a,n)=>(n?(a*100/n).toFixed(1):"0.0")+" %";
 const row=(n,c,i,a)=>"<tr><td>"+n+"</td><td>"+c+"</td><td>"+i+"</td><td>"+a+"</td></tr>";
 document.getElementById("stats").innerHTML=
  row("hors montagne",s.pl,pct(s.ironPl,s.pl),pct(s.alPl,s.pl))+
  row("montagne",s.mt,pct(s.ironMt,s.mt),pct(s.alMt,s.mt))+
  "<tr><th>toute la terre</th><th>"+(s.pl+s.mt)+"</th><th>"+(s.ironPl+s.ironMt)+"</th><th>"+(s.alPl+s.alMt)+"</th></tr>";
 const ironTot=s.ironPl+s.ironMt,alTot=s.alPl+s.alMt;
 document.getElementById("ratio").textContent=
  "fer / aluminium : "+(alTot?(ironTot/alTot).toFixed(2):"-")+"\\ncases où l'aluminium a pris la place du fer : "+s.conflict;
 document.getElementById("config").textContent=
  "iron.presence\\n  threshold: "+v.it+",  mountainBonus: "+v.ib+"\\naluminium.presence\\n  threshold: "+v.at+",  mountainBonus: "+v.ab+"\\n// mountainAltitude : TEST_MAP (config/map.ts)";
 document.getElementById("legend").innerHTML=LEG[view].map(([n,c])=>'<span><span class="sw" style="background:rgb('+c+')"></span>'+n+'</span>').join("")+
  '<span><span class="sw" style="background:#a9bd8e"></span>terre</span><span><span class="sw" style="background:#6f9ccc"></span>eau</span>';
}
function reset(){el.it.value=P.start.ironThreshold;el.ib.value=P.start.ironBonus;el.at.value=P.start.alThreshold;el.ab.value=P.start.alBonus;draw();}
for(const k of ids)el[k].oninput=draw;
document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>{view=b.dataset.v;document.querySelectorAll("#tabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));draw();});
document.getElementById("reset").onclick=reset;
document.getElementById("params").textContent="Carte de test "+P.W+" × "+P.H+", graine "+P.seed+". Quand fer et aluminium sont tous deux présents sur une case, l'aluminium la prend. Valeurs de départ = valeurs d'essai de config/resources.ts.";
Promise.all([unpack(P.terrain),unpack(P.noiseIron),unpack(P.noiseAl)]).then(([t,a,b])=>{terrain=t;nI=new Uint16Array(a.buffer);nA=new Uint16Array(b.buffer);reset();});
</script></body></html>`;

const outDir = join(import.meta.dirname, "..", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "resources.html");
writeFileSync(outFile, html);
console.log(`→ ${outFile} (${Math.round(html.length / 1024)} Ko)`);
