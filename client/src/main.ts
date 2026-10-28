// La page (interface provisoire) : écran de départ, carte, barre de boutons,
// panneau latéral. Elle ne calcule aucune règle : le moteur tourne dans le Web
// Worker (engine.worker.ts) et la page affiche ce qu'il envoie.

import "./style.css";
// Accueil et salle d'attente des parties en ligne ; le mode solo ci-dessous s'ouvre depuis l'accueil,
// et une partie en ligne lancée par le relais est confiée à `startOnline` ci-dessous.
import { setGameLauncher, showHome } from "./lobby.ts";

import { Mirror, RESOURCE_ALUMINIUM, RESOURCE_IRON, TERRAIN_ALTITUDE, TERRAIN_LAND, TERRAIN_OCEAN, TERRAIN_SHORE } from "./mirror.ts";
import { Painter, playerColor, rgbCss } from "./painter.ts";
import { type EndedMessage, type FrontView, type FromWorker, type HumanOrder, type InitMessage, type PlayerStats, type TickMessage, type ToWorker } from "./protocol.ts";
import { productIcon, productIconPath, setProductIcons } from "./icons.ts";
import { factoryName, localPlayer, playerName, productSymbol, setRoster } from "./names.ts";
import { Diplomacy } from "./diplomacy.ts";
import { clearNotifications, installNotifications, notify, updateNotifications } from "./notifications.ts";
import { FrontPanel } from "./frontpanel.ts";
import { InfoBar, MAP_OPTIONS, type MapOption } from "./infobar.ts";
import { ProductionPanel } from "./production.ts";
import { MapView, RESOURCE_LEGEND } from "./render.ts";
import { attachFactoryTreeTip, setGoodTipEconomy, setGoodTipStats } from "./goodtips.ts";
import { applyBlinkPeriod } from "./blink.ts";
import { installTooltips, refreshTip } from "./tooltip.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} introuvable`);
  return el as T;
};

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);

installTooltips();
applyBlinkPeriod();
installNotifications($("notifs"));
/** Menu de diplomatie et notifications des événements diplomatiques (00-Game §1). */
const diplomacy = new Diplomacy((order) => sendOrder(order));

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
  /** Partie en ligne (source de tours WebSocket) ou solo (relais local). */
  readonly online: boolean;
  /** Seul l'hôte met en pause en ligne ; en solo le joueur est l'hôte. */
  host: boolean;
  mirror: Mirror | null;
  painter: Painter | null;
  view: MapView | null;
  production: ProductionPanel | null;
  infobar: InfoBar | null;
  frontPanel: FrontPanel | null;
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

/** Crée le Web Worker du moteur et la session qui l'écoute ; l'appelant lui envoie `start` (solo) ou `online`. */
function openSession(online: boolean): Session {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  const s: Session = {
    worker,
    online,
    host: true,
    mirror: null,
    painter: null,
    view: null,
    production: null,
    infobar: null,
    frontPanel: null,
    nextOrderId: 1,
    paused: false,
    ticks: 0,
    perf: { bots: 0, apply: 0, pack: 0, page: 0 },
  };
  session = s;
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    if (session !== s) return;
    const msg = e.data;
    switch (msg.type) {
      case "init":
        onInit(s, msg);
        break;
      case "tick":
        onTick(s, msg);
        break;
      case "paused":
        onPaused(s, msg.paused);
        break;
      case "notice":
        toast(msg.text, 6000);
        break;
      case "ended":
        onEnded(msg);
        break;
    }
  };
  worker.onerror = (e) => {
    toast(`Erreur du moteur : ${e.message}`, 10000);
  };
  return s;
}

function startGame(mapSeed: number, bots: number): void {
  const s = openSession(false);
  const step = stepFromUrl();
  s.worker.postMessage({ type: "start", mapSeed, bots, ...(step !== undefined ? { stepMs: step } : {}) } satisfies ToWorker);
}

/** Partie en ligne lancée par le relais : le Worker ouvre son propre WebSocket et rejoue la partie depuis le message de départ. */
function startOnline(launch: { readonly url: string; readonly name: string; readonly token: string }): void {
  endSession();
  const s = openSession(true);
  s.worker.postMessage({ type: "online", url: launch.url, name: launch.name, token: launch.token } satisfies ToWorker);
}

setGameLauncher({ start: startOnline, cancel: endSession });

/** Texte du bouton de pause : outil de développement en solo, bouton de l'hôte en ligne (00-Game §1.1). */
function pauseLabel(s: Session): string {
  if (s.online) return s.paused ? "Reprendre la partie" : "Mettre en pause";
  return s.paused ? "Reprendre (outil de développement)" : "Pause (outil de développement)";
}

function onPaused(s: Session, paused: boolean): void {
  const changed = s.paused !== paused;
  s.paused = paused;
  $("pause").textContent = pauseLabel(s);
  // En ligne, tous les joueurs voient la pause, pas seulement l'hôte qui l'a demandée.
  if (s.online && changed) toast(paused ? "La partie est en pause." : "La partie reprend.");
}

/** La source de tours en ligne s'est arrêtée. Une connexion perdue laisse la partie affichée ; le reste ramène à l'accueil avec le texte. */
function onEnded(msg: EndedMessage): void {
  if (msg.reason === "lost") {
    toast(msg.message, 600000);
    return;
  }
  endSession();
  showHome(msg.message, true);
}

function onInit(s: Session, init: InitMessage): void {
  setRoster(init.you, init.playerNames);
  s.host = !s.online || init.you === 1;
  $("lobby").hidden = true;
  $("app").hidden = false;
  startScreen.hidden = true;
  gameScreen.hidden = false;
  playButton.disabled = false;
  playButton.textContent = "Jouer";
  // Barre de debug : solo seulement (en ligne l'état ne change que par les tours, règle 3). Pause : l'hôte seulement en ligne.
  $("debug-bar").hidden = s.online;
  $("pause").hidden = !s.host;
  $("pause").textContent = pauseLabel(s);
  $("mode-label").textContent = s.online ? "partie en ligne" : "mode solo contre des bots";

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
  s.view.factoryCheck = (tile) => factoryTarget(mirror, tile);
  setGoodTipEconomy(init.catalog.economy);
  setProductIcons(init.catalog.icons);
  s.production = new ProductionPanel($("prod"), init.catalog, sendOrder, (city) => s.view?.highlightCity(city));
  // Le painter et la vue neufs ont les réglages de début de partie : les cases du menu « Carte » repartent de `initial`.
  for (const o of MAP_OPTIONS) mapChecked[o.id] = o.initial;
  s.frontPanel = new FrontPanel($("front-panel"), init.military, { send: sendOrder, chooseAxis: startAxisMode });
  axisFront = 0;
  s.infobar = new InfoBar(
    $("infobar"),
    init.catalog,
    setMapOption,
    (percent) => sendOrder({ type: "set_farm_share", percent }),
    (enabled) => sendOrder({ type: "set_forced_mobilization", enabled }),
    openFront,
  );
  buildFactoryMenu(init.catalog);
  $("prod").hidden = true;
  $("production").setAttribute("aria-pressed", "false");
  setFactoryArmed(null);
  buildPlayersTable(mirror);
  $("you-swatch").innerHTML = `<span class="sw" style="background:${rgbCss(playerColor(localPlayer()))}"></span>`;
  setPlacement(false);
  clearNotifications();
  diplomacy.reset();
  $("dev-line").textContent = "tour 0";
}

function onTick(s: Session, msg: TickMessage): void {
  const { mirror, painter, view } = s;
  if (mirror === null || painter === null || view === null) return;
  const t0 = performance.now();
  const repaint = mirror.applyTick(msg);
  painter.paintTiles(repaint);
  view.upload(repaint);
  if (msg.cities !== null || msg.factoryMarks !== null) view.refresh();
  if (msg.fronts !== null) {
    view.frontsChanged();
    s.infobar?.setFronts(msg.fronts);
  }
  s.frontPanel?.refresh(mirror.fronts, msg.tick);
  if (msg.failedBreakthroughs > 0) {
    toast("Percée arrêtée : aucune unité à engager (seconde ligne vide, ou « Motorisé seulement » sans unité motorisée).", 6000);
  }
  for (const c of msg.captured) {
    if (c.from === localPlayer() || c.to === localPlayer()) {
      const other = c.from === localPlayer() ? c.to : c.from;
      notify({
        text: c.from === localPlayer() ? `Vous avez pris la ville n° ${c.city} à ${playerName(other)}.` : `${playerName(other)} vous a pris la ville n° ${c.city}.`,
        color: rgbCss(playerColor(other)),
      });
    }
  }
  for (const c of msg.encircled) {
    if (c.from === localPlayer() || c.to === localPlayer()) {
      const other = c.from === localPlayer() ? c.to : c.from;
      notify({
        text:
          c.from === localPlayer()
            ? `Encerclement : vos troupes ont coupé la retraite de ${playerName(other)} à la ville n° ${c.city} (${num(c.lost)} unités perdues).`
            : `Encerclement : vos troupes sont coupées de leur arrière par la perte de la ville n° ${c.city} (${num(c.lost)} unités perdues).`,
        color: rgbCss(playerColor(other)),
      });
    }
  }
  s.ticks++;
  s.perf = {
    bots: lerp(s.perf.bots, msg.perf.bots),
    apply: lerp(s.perf.apply, msg.perf.apply),
    pack: lerp(s.perf.pack, msg.perf.pack),
    page: lerp(s.perf.page, performance.now() - t0),
  };

  updatePanel(msg.players);
  s.production?.update(msg.human, msg.players[localPlayer() - 1]!);
  s.infobar?.update(msg.human, msg.players[localPlayer() - 1]!);
  setGoodTipStats(msg.players[localPlayer() - 1]!);
  refreshTip();
  // Les barres de temps restant d'abord, puis les cartes créées par ce tour (elles lisent le tour courant).
  updateNotifications(msg.tick);
  diplomacy.update(msg.diplomacy);
  for (const r of msg.results) {
    if (!r.applied) {
      const what =
        r.order.type === "found_city"
          ? "Ville non fondée"
          : DIPLOMATIC_ORDERS.includes(r.order.type)
            ? "Action diplomatique sans effet"
            : "Réglage non appliqué";
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

const DIPLOMATIC_ORDERS: readonly HumanOrder["type"][] = ["declare_war", "propose_pact", "break_pact", "propose_peace", "answer_proposal"];

const lerp = (avg: number, x: number): number => (avg === 0 ? x : avg * 0.9 + x * 0.1);

// ---- panneau latéral ----

function updatePanel(players: readonly PlayerStats[]): void {
  const me = players[localPlayer() - 1]!;
  $("s-pop").textContent = num(me.population);
  $("s-farmers").textContent = num(me.farmers);
  $("s-fishers").textContent = num(me.fishers);
  $("s-idle").textContent = num(me.idle);
  $("s-food").textContent = num(me.food);
  $("s-cities").textContent = num(me.cities);
  $("s-cultivated").textContent = `${num(me.cultivated)} / ${num(me.farmTiles)}`;
  $("s-fished").textContent = `${num(me.fished)} / ${num(me.seaTiles)}`;

  const rows = $("players").querySelectorAll("tbody tr");
  players.forEach((p, i) => {
    const cells = rows[i]!.children;
    cells[2]!.textContent = num(p.population);
    cells[3]!.textContent = num(p.cities);
  });
  // Coût de la prochaine ville, en habitants ; la première (sans capitale) est gratuite.
  const cost = $("found-cost");
  cost.hidden = me.capital === 0;
  cost.lastElementChild!.textContent = num(me.foundingCost);
  // Le coût d'une fondation dépend de la population : la case survolée peut changer de couleur.
  if (placement) session?.view?.requestDraw();
}

function buildPlayersTable(mirror: Mirror): void {
  const body = $("players").querySelector("tbody")!;
  body.innerHTML = "";
  for (let id = 1; id <= mirror.playerCount; id++) {
    const tr = document.createElement("tr");
    if (id === localPlayer()) tr.className = "me";
    const swatch = document.createElement("span");
    swatch.className = "sw";
    swatch.style.background = rgbCss(playerColor(id));
    // Les noms viennent des autres joueurs : textContent, jamais innerHTML.
    const cells = [document.createElement("td"), document.createElement("td"), document.createElement("td"), document.createElement("td")];
    cells[0]!.append(swatch);
    cells[1]!.textContent = playerName(id);
    cells[2]!.textContent = "0";
    cells[3]!.textContent = "0";
    tr.append(...cells);
    body.appendChild(tr);
  }
}

/** Cases du menu « Carte » telles que le joueur les a laissées. */
const mapChecked: Record<MapOption, boolean> = { iron: false, playerColor: true, fertility: false, factories: true, frontZones: true };
/** Vues de la carte affichées d'office pendant le mode placement, sans toucher aux cases (00-Game §11). */
const PLACEMENT_MAP_OPTIONS: readonly MapOption[] = ["iron", "playerColor", "fertility"];

/** Case du menu « Carte » (barre d'informations) cochée ou décochée. */
function setMapOption(option: MapOption, checked: boolean): void {
  mapChecked[option] = checked;
  applyMapOptions();
}

/**
 * Règle le painter et la vue : une vue est affichée si sa case est cochée, ou si
 * le mode placement est actif et qu'elle est dans PLACEMENT_MAP_OPTIONS. Les
 * hachures de fertilité et de fer sont dessinées à chaque image ; la couleur des
 * joueurs est dans le tampon, repeint en entier seulement si elle change.
 */
function applyMapOptions(): void {
  const s = session;
  if (s?.painter == null || s.view === null) return;
  const shown = (o: MapOption): boolean => mapChecked[o] || (placement && PLACEMENT_MAP_OPTIONS.includes(o));
  const fertility = shown("fertility");
  const iron = shown("iron");
  $("map-legend").hidden = !iron;
  // Les icônes d'usine ne font pas partie des vues du placement : seule leur case compte.
  const factories = mapChecked.factories;
  const frontZones = mapChecked.frontZones;
  if (s.view.showFertility !== fertility || s.view.showIron !== iron || s.view.showFactoryLogos !== factories || s.view.showFrontZones !== frontZones) {
    s.view.showFertility = fertility;
    s.view.showIron = iron;
    s.view.showFactoryLogos = factories;
    s.view.showFrontZones = frontZones;
    s.view.requestDraw();
  }
  const playerColor = shown("playerColor");
  if (s.painter.showPlayerColor === playerColor) return;
  s.painter.showPlayerColor = playerColor;
  s.painter.paintAll();
  s.view.uploadAll();
}

// Légende de la vue « Ressources naturelles » : icône, couleur des hachures, nom.
for (const r of Object.values(RESOURCE_LEGEND)) {
  const item = document.createElement("div");
  item.className = "legend-item";
  const img = document.createElement("img");
  img.className = "ib-img";
  img.src = `icons/${r.icon}`;
  img.alt = "";
  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  const [red, green, blue] = r.rgba;
  swatch.style.setProperty("--hatch", `rgb(${red} ${green} ${blue})`);
  item.append(img, swatch, r.name);
  $("map-legend").append(item);
}

// Le menu « Carte » se ferme au clic en dehors de lui.
document.addEventListener("pointerdown", (e) => {
  const bar = session?.infobar;
  if (bar && !bar.inMenu(e.target)) bar.closeMenu();
});

$("pause").addEventListener("click", () => {
  if (session !== null) post({ type: "pause", paused: !session.paused });
});

// Barre de debug (outils de développement, 03-Client) : hors des règles du jeu.
$("dbg-pop").addEventListener("click", () => {
  if (session !== null) post({ type: "debug", action: "addPopulation", amount: 1000 });
});

$("dbg-arm").addEventListener("click", () => {
  if (session !== null) post({ type: "debug", action: "addArmament", amount: 1 });
});
$("dbg-bots").addEventListener("click", () => {
  if (session !== null) post({ type: "debug", action: "armBots", amount: 3 });
});

/** Ferme la session en cours (Worker compris, donc le WebSocket d'une partie en ligne) et remet l'écran de départ du solo. */
function endSession(): void {
  const s = session;
  if (s === null) return;
  s.worker.terminate();
  s.frontPanel?.close();
  axisFront = 0;
  session = null;
  clearNotifications();
  diplomacy.reset();
  setPlacementFlag(false);
  setFactoryArmed(null);
  gameScreen.hidden = true;
  startScreen.hidden = false;
  playButton.disabled = false;
  playButton.textContent = "Jouer";
}

$("quit").addEventListener("click", () => {
  const online = session?.online === true;
  endSession();
  // Une partie en ligne se quitte vers l'accueil du lobby ; le solo, vers son écran de départ.
  if (online) showHome();
});

// ---- case survolée ----

function showHover(tile: number): void {
  const m = session?.mirror;
  if (!m) return;
  if (tile < 0) {
    for (const id of ["h-tile", "h-terrain", "h-fertility", "h-iron", "h-aluminium", "h-owner", "h-city"]) $(id).textContent = "—";
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
    $("h-iron").textContent = (m.resources[tile]! & RESOURCE_IRON) !== 0 ? "oui" : "non";
    $("h-aluminium").textContent = (m.resources[tile]! & RESOURCE_ALUMINIUM) !== 0 ? "oui" : "non";
    const owner = m.ownerOf(tile);
    $("h-owner").textContent = owner === 0 ? "personne" : playerName(owner);
    const id = m.tileCity[tile]!;
    $("h-city").textContent =
      id === 0
        ? "aucune zone"
        : `n° ${id}${m.cities[id - 1]!.tile === tile ? " (ici)" : ""}${m.stats[m.cities[id - 1]!.player - 1]?.capital === id ? ", capitale" : ""}`;
  }
  if (axisFront !== 0 && session?.view) {
    session.view.axisHover = tile >= 0 ? nearestConnection(m, axisFront, tile) : null;
    session.view.requestDraw();
  }
  if (factoryArmed !== null && tile >= 0) {
    const target = factoryTarget(m, tile);
    $("bar-hint").textContent = target.problem ?? `Cliquez pour inaugurer : ${factoryName(factoryArmed)}, dans la ville n° ${target.city}.`;
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
  if (on) setFactoryArmed(null);
  setPlacementFlag(on);
  applyMapOptions();
  const view = session?.view;
  if (view) {
    view.placement = on;
    view.refresh();
  }
  const m = session?.mirror;
  const me = m?.stats[localPlayer() - 1];
  $("bar-hint").textContent = on
    ? m && me?.capital
      ? `Placement : dans le rayon d'expansion d'une de vos villes (${m.expansionRadius} cases), en dehors de toute zone, coût ${num(me.foundingCost)} habitants.`
      : "Placement de votre première ville : n'importe quelle case de terre libre, gratuit."
    : "";
}

foundButton.addEventListener("click", () => setPlacement(!placement));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  session?.infobar?.closeMenu();
  if (placement) setPlacement(false);
  if (factoryArmed !== null || !factoryMenu.hidden) setFactoryArmed(null);
  if (axisFront !== 0) stopAxisMode();
});

/**
 * Raison pour laquelle une fondation sur cette case serait refusée, ou null.
 * Copie des conditions de 00-Game §3.3, pour colorer la case ; le moteur reste
 * l'autorité et vérifie à nouveau.
 */
function foundingProblem(m: Mirror, tile: number): string | null {
  if (!m.isLand(tile)) return "Une ville se fonde sur la terre.";
  if (m.tileCity[tile] !== 0) return "Cette case est déjà dans la zone d'une ville.";
  const me = m.stats[localPlayer() - 1];
  const mine = m.cityIds[localPlayer() - 1]!;
  if (mine.length === 0) return null;
  if (me && me.population < me.foundingCost) return `Population insuffisante (${num(me.foundingCost)} habitants nécessaires).`;
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
  if (m && axisFront !== 0) {
    // Mode choix d'axe : le clic lance une percée sur la connexion du front la plus proche (05-Fronts §11.1), et le mode se
    // désactive : pour en lancer une seconde, on rouvre le panneau du front.
    const axis = nearestConnection(m, axisFront, tile);
    if (axis !== null) {
      sendOrder({ type: "start_breakthrough", front: axisFront, city1: axis.city1, city2: axis.city2 });
      stopAxisMode();
    }
    return;
  }
  if (m && factoryArmed !== null) {
    const target = factoryTarget(m, tile);
    if (target.problem !== null) {
      toast(target.problem);
      return;
    }
    sendOrder({ type: "build_factory", city: target.city, factoryType: factoryArmed });
    setFactoryArmed(null);
    return;
  }
  if (m && !placement) {
    // Aucun outil armé : un clic dans une zone de front, affichée ou non, ouvre le panneau de ce front (05-Fronts §11.1) ;
    // sinon un clic sur le territoire d'un autre joueur ouvre le menu de diplomatie, ailleurs il le ferme.
    const front = session?.view?.frontAt(tile);
    if (front !== undefined) {
      diplomacy.openFor(0);
      session?.frontPanel?.open(front);
      return;
    }
    diplomacy.openFor(m.ownerOf(tile));
    return;
  }
  if (!placement || !m) return;
  const problem = foundingProblem(m, tile);
  if (problem !== null) {
    toast(problem);
    return;
  }
  sendOrder({ type: "found_city", tile });
}

// ---- barre de boutons : Inaugurer une usine, Production (00-Game §1, §8.1) ----

let factoryArmed: string | null = null;
const factoryButton = $<HTMLButtonElement>("factory");
const factoryMenu = $("factory-menu");

/** Remplit le menu déplié vers le haut : un choix par type d'usine, avec l'icône de sa racine et son arbre de progression au survol. */
function buildFactoryMenu(catalog: InitMessage["catalog"]): void {
  factoryMenu.innerHTML = "";
  for (const type of catalog.factoryTypes) {
    const b = document.createElement("button");
    b.type = "button";
    const root = type.tree[0]!.good;
    if (productIconPath(root) === undefined) b.textContent = `${productSymbol(root)} ${factoryName(type.id)}`;
    else b.append(productIcon(root), ` ${factoryName(type.id)}`);
    attachFactoryTreeTip(b, type, factoryMenu);
    b.addEventListener("click", () => setFactoryArmed(type.id));
    factoryMenu.appendChild(b);
  }
}

/** Arme le bouton avec un type d'usine (ou le désarme : null). Le menu se ferme au choix. */
function setFactoryArmed(type: string | null): void {
  factoryArmed = type;
  factoryMenu.hidden = true;
  factoryButton.setAttribute("aria-pressed", String(type !== null));
  if (type !== null) setPlacement(false);
  const view = session?.view;
  if (view) {
    view.factoryMode = type !== null;
    view.refresh();
  }
  $("bar-hint").textContent =
    type === null ? "" : `${factoryName(type)} : cliquez sur la zone d'une de vos villes qui n'a pas d'usine (Échap : annuler).`;
}

factoryButton.addEventListener("click", () => {
  if (factoryArmed !== null) setFactoryArmed(null);
  else {
    factoryMenu.hidden = !factoryMenu.hidden;
    if (!factoryMenu.hidden) setPlacement(false);
  }
});

const productionButton = $<HTMLButtonElement>("production");
productionButton.addEventListener("click", () => {
  const panel = $("prod");
  panel.hidden = !panel.hidden;
  productionButton.setAttribute("aria-pressed", String(!panel.hidden));
  session?.production?.refresh();
});

/**
 * Ville dont la zone contient la case, et ce qui empêche d'y inaugurer une usine (null : possible).
 * Copie des conditions de 00-Game §8 pour colorer la zone ; le moteur reste l'autorité.
 */
function factoryTarget(m: Mirror, tile: number): { city: number; ok: boolean; problem: string | null } {
  const city = m.tileCity[tile]!;
  let problem: string | null = null;
  if (city === 0) problem = "Cette case n'est dans la zone d'aucune ville.";
  else if (m.cities[city - 1]!.player !== localPlayer()) problem = "Cette zone appartient à un autre joueur.";
  else if (m.factoryMarks.has(city)) problem = `La ville n° ${city} a déjà une usine.`;
  return { city, ok: problem === null, problem };
}

// ---- fronts : panneau, mode choix d'axe (05-Fronts §11) ----

/** Front dont le joueur choisit l'axe d'une percée (0 : hors du mode). */
let axisFront = 0;

function openFront(id: number): void {
  const s = session;
  const front = s?.mirror?.fronts.find((f) => f.id === id);
  if (s === null || front === undefined) return;
  s.infobar?.closeAll();
  s.frontPanel?.open(front);
}

/** « Percée » : le panneau se ferme et la carte passe en mode choix d'axe. */
function startAxisMode(frontId: number): void {
  const s = session;
  if (s === null) return;
  s.frontPanel?.close();
  setPlacement(false);
  setFactoryArmed(null);
  axisFront = frontId;
  s.view?.setAxisMode(frontId);
  $("bar-hint").textContent = "Percée : cliquez sur une route du front pour lancer la percée. Échap : annuler.";
}

function stopAxisMode(): void {
  axisFront = 0;
  session?.view?.setAxisMode(0);
  $("bar-hint").textContent = "";
}

/** Connexion du front la plus proche de la case cliquée (choix provisoire, 05-Fronts §11.1). */
function nearestConnection(m: Mirror, frontId: number, tile: number): { city1: number; city2: number } | null {
  const front = m.fronts.find((f) => f.id === frontId);
  if (front === undefined) return null;
  const w = m.width;
  const px = (tile % w) + 0.5;
  const py = Math.floor(tile / w) + 0.5;
  let best: { city1: number; city2: number } | null = null;
  let bestD = Infinity;
  for (const c of front.connections) {
    const a = m.cities[c.city1 - 1]!.tile;
    const b = m.cities[c.city2 - 1]!.tile;
    const ax = (a % w) + 0.5;
    const ay = Math.floor(a / w) + 0.5;
    const dx = (b % w) + 0.5 - ax;
    const dy = Math.floor(b / w) + 0.5 - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = (ax + dx * k - px) ** 2 + (ay + dy * k - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { city1: c.city1, city2: c.city2 };
    }
  }
  return best;
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
