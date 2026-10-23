// La page (interface provisoire) : écran de départ, carte, barre de boutons,
// panneau latéral. Elle ne calcule aucune règle : le moteur tourne dans le Web
// Worker (engine.worker.ts) et la page affiche ce qu'il envoie.

import "./style.css";

import { Mirror, TERRAIN_ALTITUDE, TERRAIN_LAND, TERRAIN_OCEAN, TERRAIN_SHORE } from "./mirror.ts";
import { Painter, playerColor, rgbCss } from "./painter.ts";
import { HUMAN, type FromWorker, type HumanOrder, type InitMessage, type PlayerStats, type TickMessage, type ToWorker } from "./protocol.ts";
import { MapView } from "./render.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} introuvable`);
  return el as T;
};

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);

// ---- écran de départ ----

const startScreen = $("start");
const gameScreen = $("game");
const startForm = $<HTMLFormElement>("start-form");
const playButton = $<HTMLButtonElement>("play");

/** Outil de développement : `?step=20` donne un tour toutes les 20 ms (le jeu réel : 100). */
function stepFromUrl(): number | undefined {
  const raw = new URLSearchParams(location.search).get("step");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : undefined;
}

startForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const bots = Math.min(7, Math.max(1, Math.trunc(Number($<HTMLInputElement>("bots").value) || 3)));
  const seedRaw = Math.trunc(Number($<HTMLInputElement>("seed").value));
  const seed = Number.isFinite(seedRaw) ? Math.min(0xffffffff, Math.max(0, seedRaw)) : 12345;
  $<HTMLInputElement>("bots").value = String(bots);
  $<HTMLInputElement>("seed").value = String(seed);
  playButton.disabled = true;
  playButton.textContent = "Génération de la carte…";
  startGame(seed, bots);
});

// ---- partie en cours ----

interface Session {
  readonly worker: Worker;
  mirror: Mirror | null;
  painter: Painter | null;
  view: MapView | null;
  nextOrderId: number;
  paused: boolean;
  ticks: number;
  perf: { bots: number; apply: number; pack: number; page: number };
}

let session: Session | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function post(msg: ToWorker): void {
  session?.worker.postMessage(msg);
}

function startGame(mapSeed: number, bots: number): void {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const s: Session = {
    worker,
    mirror: null,
    painter: null,
    view: null,
    nextOrderId: 1,
    paused: false,
    ticks: 0,
    perf: { bots: 0, apply: 0, pack: 0, page: 0 },
  };
  session = s;
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    if (session !== s) return;
    const msg = e.data;
    if (msg.type === "init") onInit(s, msg);
    else if (msg.type === "tick") onTick(s, msg);
    else {
      s.paused = msg.paused;
      $("pause").textContent = s.paused ? "Reprendre (outil de développement)" : "Pause (outil de développement)";
    }
  };
  worker.onerror = (e) => {
    toast(`Erreur du moteur : ${e.message}`, 10000);
  };
  const step = stepFromUrl();
  post({ type: "start", mapSeed, bots, ...(step !== undefined ? { stepMs: step } : {}) });
}

function onInit(s: Session, init: InitMessage): void {
  startScreen.hidden = true;
  gameScreen.hidden = false;
  playButton.disabled = false;
  playButton.textContent = "Jouer";

  // Un canvas neuf à chaque partie : les écouteurs de la partie précédente restent sur l'ancien.
  const oldCanvas = $<HTMLCanvasElement>("map");
  const canvas = oldCanvas.cloneNode(false) as HTMLCanvasElement;
  oldCanvas.replaceWith(canvas);
  const mirror = new Mirror(init);
  const painter = new Painter(mirror);
  painter.paintAll();
  s.mirror = mirror;
  s.painter = painter;
  s.view = new MapView(canvas, mirror, painter, {
    onHover: showHover,
    onClick: onMapClick,
  });
  s.view.placementCheck = (tile) => foundingProblem(mirror, tile);
  buildPlayersTable(mirror);
  $("you-swatch").innerHTML = `<span class="sw" style="background:${rgbCss(playerColor(HUMAN))}"></span>`;
  $<HTMLInputElement>("show-iron").checked = true;
  setPlacement(false);
  $("dev-line").textContent = "tour 0";
}

function onTick(s: Session, msg: TickMessage): void {
  const { mirror, painter, view } = s;
  if (mirror === null || painter === null || view === null) return;
  const t0 = performance.now();
  const repaint = mirror.applyTick(msg);
  painter.paintTiles(repaint);
  view.upload(repaint);
  if (msg.cities !== null) view.refresh();
  s.ticks++;
  s.perf = {
    bots: lerp(s.perf.bots, msg.perf.bots),
    apply: lerp(s.perf.apply, msg.perf.apply),
    pack: lerp(s.perf.pack, msg.perf.pack),
    page: lerp(s.perf.page, performance.now() - t0),
  };

  updatePanel(msg.players);
  for (const r of msg.results) {
    if (!r.applied) {
      const what = r.order.type === "found_city" ? "Ville non fondée" : "Réglage non appliqué";
      toast(`${what} : le moteur a refusé l'ordre (tour ${msg.tick}).`);
    }
  }
  if (s.ticks % 5 === 0) {
    $("dev-line").textContent =
      `tour ${msg.tick} · moteur ${s.perf.apply.toFixed(2)} ms · bots ${s.perf.bots.toFixed(2)} ms · ` +
      `message ${s.perf.pack.toFixed(2)} ms · page ${s.perf.page.toFixed(2)} ms · ` +
      `dessin ${view.lastDrawMs.toFixed(2)} ms`;
  }
}

const lerp = (avg: number, x: number): number => (avg === 0 ? x : avg * 0.9 + x * 0.1);

// ---- panneau latéral ----

function updatePanel(players: readonly PlayerStats[]): void {
  const me = players[HUMAN - 1]!;
  $("s-pop").textContent = num(me.population);
  $("s-farmers").textContent = num(me.farmers);
  $("s-fishers").textContent = num(me.fishers);
  $("s-idle").textContent = num(me.idle);
  $("s-food").textContent = num(me.food);
  $("s-cities").textContent = num(me.cities);
  $("s-cultivated").textContent = `${num(me.cultivated)} / ${num(me.farmTiles)}`;
  $("s-fished").textContent = `${num(me.fished)} / ${num(me.seaTiles)}`;
  const slider = $<HTMLInputElement>("farm");
  if (!sliderActive) {
    slider.value = String(me.farmPercent);
    $("farm-value").textContent = `${me.farmPercent} %`;
  }
  $("farm-note").textContent =
    `Pêcheurs : ${100 - me.farmPercent} %` + (me.seaTiles === 0 ? " (aucune case d'eau dans vos zones : inactifs)" : "");

  const rows = $("players").querySelectorAll("tbody tr");
  players.forEach((p, i) => {
    const cells = rows[i]!.children;
    cells[2]!.textContent = num(p.population);
    cells[3]!.textContent = num(p.cities);
  });
  // Le coût d'une fondation dépend de la population : la case survolée peut changer de couleur.
  if (placement) session?.view?.requestDraw();
}

function buildPlayersTable(mirror: Mirror): void {
  const body = $("players").querySelector("tbody")!;
  body.innerHTML = "";
  for (let id = 1; id <= mirror.playerCount; id++) {
    const tr = document.createElement("tr");
    if (id === HUMAN) tr.className = "me";
    tr.innerHTML =
      `<td><span class="sw" style="background:${rgbCss(playerColor(id))}"></span></td>` +
      `<td>${id === HUMAN ? "Vous" : `Bot ${id - 1}`}</td><td>0</td><td>0</td>`;
    body.appendChild(tr);
  }
}

let sliderActive = false;
const farmSlider = $<HTMLInputElement>("farm");
farmSlider.addEventListener("pointerdown", () => (sliderActive = true));
farmSlider.addEventListener("input", () => {
  sliderActive = true;
  $("farm-value").textContent = `${farmSlider.value} %`;
});
// L'ordre part au relâchement (événement `change`), pas à chaque mouvement du curseur.
farmSlider.addEventListener("change", () => {
  sliderActive = false;
  sendOrder({ type: "set_farm_share", percent: Number(farmSlider.value) });
});

$("show-iron").addEventListener("change", (e) => {
  const s = session;
  if (s?.painter == null || s.view === null) return;
  s.painter.showIron = (e.target as HTMLInputElement).checked;
  s.painter.paintAll();
  s.view.uploadAll();
});

$("pause").addEventListener("click", () => {
  if (session !== null) post({ type: "pause", paused: !session.paused });
});

$("quit").addEventListener("click", () => {
  const s = session;
  if (s === null) return;
  s.worker.terminate();
  session = null;
  setPlacementFlag(false);
  gameScreen.hidden = true;
  startScreen.hidden = false;
});

// ---- case survolée ----

function showHover(tile: number): void {
  const m = session?.mirror;
  if (!m) return;
  if (tile < 0) {
    for (const id of ["h-tile", "h-terrain", "h-fertility", "h-iron", "h-owner", "h-city"]) $(id).textContent = "—";
  } else {
    const w = m.width;
    const b = m.terrain[tile]!;
    $("h-tile").textContent = `${tile % w}, ${Math.floor(tile / w)}`;
    $("h-terrain").textContent =
      (b & TERRAIN_LAND) !== 0
        ? `Terre${(b & TERRAIN_SHORE) !== 0 ? " (côte)" : ""}, altitude ${b & TERRAIN_ALTITUDE}`
        : (b & TERRAIN_OCEAN) !== 0
          ? "Océan"
          : "Lac";
    $("h-fertility").textContent = String(m.fertility[tile]!);
    $("h-iron").textContent = (m.resources[tile]! & 1) !== 0 ? "oui" : "non";
    const owner = m.ownerOf(tile);
    $("h-owner").textContent = owner === 0 ? "personne" : owner === HUMAN ? "Vous" : `Bot ${owner - 1}`;
    const id = m.tileCity[tile]!;
    $("h-city").textContent =
      id === 0
        ? "aucune zone"
        : `n° ${id}${m.cities[id - 1]!.tile === tile ? " (ici)" : ""}${m.stats[m.cities[id - 1]!.player - 1]?.capital === id ? ", capitale" : ""}`;
  }
  if (placement && tile >= 0) {
    const problem = foundingProblem(m, tile);
    const fertile = m.fertileTilesFor(tile);
    $("bar-hint").textContent =
      (problem === null ? "Cliquez pour fonder une ville ici." : problem) +
      ` Cases cultivables libres dans son rayon de contrôle : ${num(fertile)}.`;
  }
}

// ---- barre de boutons : Créer une ville ----

let placement = false;
const foundButton = $<HTMLButtonElement>("found");

function setPlacementFlag(on: boolean): void {
  placement = on;
  foundButton.setAttribute("aria-pressed", String(on));
}

function setPlacement(on: boolean): void {
  setPlacementFlag(on);
  const view = session?.view;
  if (view) {
    view.placement = on;
    view.refresh();
  }
  const m = session?.mirror;
  $("bar-hint").textContent = on
    ? m && m.stats[HUMAN - 1]?.capital
      ? `Placement : dans le rayon d'expansion d'une de vos villes (${m.expansionRadius} cases), en dehors de toute zone, coût ${num(m.foundingCost)} habitants.`
      : "Placement de votre première ville : n'importe quelle case de terre libre, gratuit."
    : "";
}

foundButton.addEventListener("click", () => setPlacement(!placement));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && placement) setPlacement(false);
});

/**
 * Raison pour laquelle une fondation sur cette case serait refusée, ou null.
 * Copie des conditions de 00-Game §3.3, pour colorer la case ; le moteur reste
 * l'autorité et vérifie à nouveau.
 */
function foundingProblem(m: Mirror, tile: number): string | null {
  if (!m.isLand(tile)) return "Une ville se fonde sur la terre.";
  if (m.tileCity[tile] !== 0) return "Cette case est déjà dans la zone d'une ville.";
  const me = m.stats[HUMAN - 1];
  const mine = m.cityIds[HUMAN - 1]!;
  if (mine.length === 0) return null;
  if (me && me.population < m.foundingCost) return `Population insuffisante (${num(m.foundingCost)} habitants nécessaires).`;
  const w = m.width;
  const x = tile % w;
  const y = Math.floor(tile / w);
  const r2 = m.expansionRadius * m.expansionRadius;
  for (const id of mine) {
    const t = m.cities[id - 1]!.tile;
    const dx = (t % w) - x;
    const dy = Math.floor(t / w) - y;
    if (dx * dx + dy * dy <= r2) return null;
  }
  return "Hors du rayon d'expansion de vos villes.";
}

function onMapClick(tile: number): void {
  const m = session?.mirror;
  if (!placement || !m) return;
  const problem = foundingProblem(m, tile);
  if (problem !== null) {
    toast(problem);
    return;
  }
  sendOrder({ type: "found_city", tile });
}

function sendOrder(order: HumanOrder): void {
  const s = session;
  if (s === null) return;
  post({ type: "order", id: s.nextOrderId++, order });
}

// ---- message court ----

function toast(text: string, ms = 4000): void {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
