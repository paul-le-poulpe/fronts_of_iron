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
import { setProductIcons } from "./icons.ts";
import { localPlayer, playerName, setRoster } from "./names.ts";
import { Diplomacy } from "./diplomacy.ts";
import { DiplomacyTab } from "./diplomacytab.ts";
import { CombatIcons, CombatReplay, onCombatViewed, resetViewed } from "./combatreplay.ts";
import { clearNotifications, installNotifications, notify, updateNotifications } from "./notifications.ts";
import { ForcesTab } from "./forcestab.ts";
import { FrontWindow } from "./frontwindow.ts";
import { InfoBar, MAP_OPTIONS, type MapOption } from "./infobar.ts";
import { ProductionPanel } from "./production.ts";
import { MapView, RESOURCE_LEGEND } from "./render.ts";
import { setGoodTipCatalog, setGoodTipStats } from "./goodtips.ts";
import { applyBlinkPeriod } from "./blink.ts";
import { currentTheme, toggleTheme } from "./theme.ts";
import { installTooltips, refreshTip } from "./tooltip.ts";
import { installTutorial, resetTutorial, skipTutorial } from "./tutorial.ts";
import { num } from "./format.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} introuvable`);
  return el as T;
};


installTooltips();
installTutorial();
applyBlinkPeriod();
installNotifications($("notifs"));
/** Menu de diplomatie et notifications des événements diplomatiques (00-Game §1). */
const diplomacy = new Diplomacy((order) => sendOrder(order));

// ---- écran de départ ----

const startScreen = $("start");
const gameScreen = $("game");
const startForm = $<HTMLFormElement>("start-form");
const playButton = $<HTMLButtonElement>("play");
const testButton = $<HTMLButtonElement>("play-test");
// Partie de test : outil de développement, absent d'une version compilée pour le déploiement (03-Client §3).
testButton.hidden = !import.meta.env.DEV;

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

// Le bouton « Partie de test » montre ou cache le choix du scénario ; un clic sur un scénario lance la partie.
const testChoices = $("test-choices");
testButton.addEventListener("click", () => {
  testChoices.hidden = !testChoices.hidden;
});
for (const choice of testChoices.querySelectorAll<HTMLButtonElement>("button[data-scenario]")) {
  choice.addEventListener("click", () => {
    const seedRaw = Math.trunc(Number($<HTMLInputElement>("seed").value));
    const seed = Number.isFinite(seedRaw) ? Math.min(0xffffffff, Math.max(0, seedRaw)) : 12345;
    playButton.disabled = true;
    testButton.disabled = true;
    testChoices.hidden = true;
    testButton.textContent = "Génération de la carte…";
    startGame(seed, 1, choice.dataset["scenario"]);
  });
}

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
  frontPanel: FrontWindow | null;
  forces: ForcesTab | null;
  /** Onglet Diplomatie de la barre d'informations : la liste des joueurs. */
  players: DiplomacyTab | null;
  /** Icônes des combats sur la carte et panneau du replay (06-Combat-Simplifie §2). */
  combatIcons: CombatIcons | null;
  replay: CombatReplay | null;
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
    combatIcons: null,
    replay: null,
    forces: null,
    players: null,
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
        try {
          onInit(s, msg);
        } catch (error) {
          failBeforeGame(s, `Impossible d'afficher la partie : ${error instanceof Error ? error.message : String(error)}`);
        }
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
    const text = `Erreur du moteur : ${e.message === "" ? "le Web Worker n'a pas pu se charger" : e.message}`;
    if (s.online && s.mirror === null) failBeforeGame(s, text);
    else toast(text, 10000);
  };
  return s;
}

/**
 * Une partie en ligne échoue avant son premier `init` : la page affiche encore l'écran « Partie lancée », et
 * `#toast` est caché avec `#app`. La session est fermée et l'accueil affiche le texte.
 */
function failBeforeGame(s: Session, text: string): void {
  if (session !== s) return;
  endSession();
  showHome(text, true);
}

function startGame(mapSeed: number, bots: number, testGame?: string): void {
  const s = openSession(false);
  const step = stepFromUrl();
  s.worker.postMessage({ type: "start", mapSeed, bots, ...(step !== undefined ? { stepMs: step } : {}), ...(testGame !== undefined ? { testGame } : {}) } satisfies ToWorker);
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
  testButton.disabled = false;
  testButton.textContent = "Partie de test";
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
    onHoverFront: (id) => s.forces?.setHighlight(id),
  });
  s.view.placementCheck = (tile) => foundingProblem(mirror, tile);
  setGoodTipCatalog(init.catalog);
  setProductIcons(init.catalog.icons);
  s.production = new ProductionPanel($("prod"), init.catalog, init.military, sendOrder, (tab) => s.infobar?.openTab(tab));
  // Le painter et la vue neufs ont les réglages de début de partie : les cases du menu « Carte » repartent de `initial`.
  for (const o of MAP_OPTIONS) mapChecked[o.id] = o.initial;
  // Fenêtre d'un front (05-Fronts §11.4) et onglet des forces (§11.2) : « ← Retour » ramène de l'une à l'autre.
  s.frontPanel = new FrontWindow($("front-panel"), init.military, sendOrder, () => s.infobar?.openForces(), startAxisMode);
  // Combats (06-Combat-Simplifie §2) : icônes par-dessus le canvas, replacées à chaque dessin ; replay dans `#stage`.
  for (const old of document.querySelectorAll(".cr-icons, .cr")) old.remove();
  s.replay = new CombatReplay($("stage"), init.military, localPlayer);
  s.combatIcons = new CombatIcons(
    $("stage"),
    { cityTile: (id) => mirror.cities[id - 1]?.tile, tileToCss: (x, y) => s.view?.tileToCss(x, y) ?? null, width: mirror.width },
    init.military,
    localPlayer,
    (c) => s.replay?.open(c),
  );
  s.view.onDrawn = () => s.combatIcons?.place();
  s.frontPanel.onReplay = (c) => s.replay?.open(c);
  // Un combat visionné, depuis la carte ou depuis la fenêtre d'un front, quitte la carte et n'est plus en évidence dans l'historique.
  resetViewed();
  onCombatViewed((id) => {
    s.combatIcons?.remove(id);
    s.frontPanel?.redrawHistory();
  });
  s.forces = new ForcesTab(init.military, sendOrder, openFront, (id) => s.view?.highlightFront(id), s.frontPanel);
  // Onglet Diplomatie : un clic sur un joueur ouvre le même menu qu'un clic sur son territoire ; un spectateur n'en a pas.
  s.players = new DiplomacyTab(
    mirror.playerCount,
    (id) => {
      if (!spectator) diplomacy.openFor(id);
    },
    (id) => s.view?.highlightPlayer(id),
  );
  s.infobar = new InfoBar(
    $("infobar"),
    init.catalog,
    setMapOption,
    s.forces,
    s.players,
    s.production.options,
  );
  s.production.onIconsShrunk = () => s.infobar?.showOptionsHint();
  // Un détail de la barre d'informations ou le menu « Carte » qui s'ouvre désarme « Créer une ville ».
  s.infobar.onOpen = () => {
    if (placement) setPlacement(false);
  };
  // Le panneau de production est ouvert au début de chaque partie ; le bouton « Production » le ferme.
  $("prod").hidden = false;
  $("production").setAttribute("aria-pressed", "true");
  $("you-swatch").innerHTML = `<span class="sw" style="background:${rgbCss(playerColor(localPlayer()))}"></span>`;
  setPlacement(false);
  clearNotifications();
  diplomacy.reset();
  setSpectator(false);
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
  if (msg.fronts !== null) view.frontsChanged();
  s.frontPanel?.refresh(mirror.fronts, mirror.divisions, msg.tick);
  if (msg.combats !== null) {
    s.combatIcons?.setCombats(msg.combats);
    s.frontPanel?.setCombats(msg.combats);
  }
  s.forces?.setData(mirror.fronts, mirror.divisions);
  if (msg.failedBreakthroughs > 0) toast("Percée arrêtée : plus aucune division à engager dans la force qui perce.", 6000);
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
            ? `Encerclement : vos troupes ont coupé la retraite de ${playerName(other)} à la ville n° ${c.city} (${num(c.divisions)} divisions touchées).`
            : `Encerclement : vos divisions sont coupées de leur arrière par la perte de la ville n° ${c.city} (${num(c.divisions)} divisions touchées).`,
        color: rgbCss(playerColor(other)),
      });
    }
  }
  for (const e of msg.eliminated) {
    // Le joueur éliminé a sa fenêtre de défaite ; tous les autres reçoivent une carte (05-Fronts §10.3).
    if (e.player === localPlayer()) {
      $("defeat-text").textContent = `${playerName(e.by)} a pris votre dernière ville. Vos troupes ont disparu.`;
      $("defeat").hidden = false;
    } else {
      notify({
        text:
          `${playerName(e.player)} est éliminé : ${e.by === localPlayer() ? "vous avez pris" : `${playerName(e.by)} a pris`} sa dernière ville et ses troupes ont disparu. ` +
          "Un mode résistance arrivera bientôt dans le jeu ; il n'est pas encore implémenté.",
        color: rgbCss(playerColor(e.player)),
        durationMs: 60_000,
      });
    }
  }
  setSpectator(msg.players[localPlayer() - 1]!.defeated);
  s.ticks++;
  s.perf = {
    bots: lerp(s.perf.bots, msg.perf.bots),
    apply: lerp(s.perf.apply, msg.perf.apply),
    pack: lerp(s.perf.pack, msg.perf.pack),
    page: lerp(s.perf.page, performance.now() - t0),
  };

  updatePanel(msg.players);
  s.players?.update(msg.players);
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

// ---- joueur éliminé : spectateur (05-Fronts §10.3) ----

/** Le joueur local est éliminé : il suit la partie sans pouvoir donner d'ordre (le moteur les ignore). */
let spectator = false;

/** Affiche ou retire l'état de spectateur : bandeau, bouton de fondation, outil armé. Appelée à chaque tour. */
function setSpectator(on: boolean): void {
  if (on === spectator) return;
  spectator = on;
  $("spectator-badge").hidden = !on;
  foundButton.disabled = on;
  if (on) {
    setPlacement(false);
    diplomacy.openFor(0);
  } else {
    $("defeat").hidden = true;
  }
}

$("defeat-watch").addEventListener("click", () => ($("defeat").hidden = true));
$("defeat-quit").addEventListener("click", () => $("quit").click());

const DIPLOMATIC_ORDERS: readonly HumanOrder["type"][] = ["declare_war", "propose_pact", "break_pact", "propose_peace", "answer_proposal"];

const lerp = (avg: number, x: number): number => (avg === 0 ? x : avg * 0.9 + x * 0.1);

// ---- panneau de debug ----

const debugToggle = $<HTMLButtonElement>("debug-toggle");
debugToggle.addEventListener("click", () => {
  const panel = $("panel");
  panel.hidden = !panel.hidden;
  debugToggle.setAttribute("aria-pressed", String(!panel.hidden));
  session?.infobar?.place();
});

function updatePanel(players: readonly PlayerStats[]): void {
  const me = players[localPlayer() - 1]!;
  $("s-pop").textContent = `${num(me.population)} / ${num(me.capacity)}`;
  $("s-farmers").textContent = num(me.farmers);
  $("s-fishers").textContent = num(me.fishers);
  $("s-idle").textContent = num(me.idle);
  $("s-hurt").textContent = num(me.hurt);
  $("s-food").textContent = num(me.food);
  $("s-cities").textContent = num(me.cities);
  $("s-cultivated").textContent = `${num(me.cultivated)} / ${num(me.farmTiles)}`;
  $("s-fished").textContent = `${num(me.fished)} / ${num(me.seaTiles)}`;
  // Coût de la prochaine ville, en bonshommes ; la première (sans capitale) est gratuite.
  const cost = $("found-cost");
  cost.hidden = me.capital === 0;
  cost.querySelector("span")!.textContent = num(me.foundingCost);
  // Le coût d'une fondation dépend des villes et des inactifs : la case survolée peut changer de couleur.
  if (placement) session?.view?.requestDraw();
}

/** Cases du menu « Carte » telles que le joueur les a laissées. */
const mapChecked: Record<MapOption, boolean> = { iron: false, playerColor: true, fertility: false, frontZones: true };
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
  const frontZones = mapChecked.frontZones;
  if (s.view.showFertility !== fertility || s.view.showIron !== iron || s.view.showFrontZones !== frontZones) {
    s.view.showFertility = fertility;
    s.view.showIron = iron;
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
  if (session !== null) post({ type: "debug", action: "addPopulation", amount: 10 });
});

$("dbg-bots").addEventListener("click", () => {
  if (session !== null) post({ type: "debug", action: "armBots", amount: 3 });
});
// Bouton temporaire (05-Fronts §11.8) : bascule le thème de la fenêtre d'un front et de l'onglet des forces.
const themeButton = $("dbg-theme");
themeButton.textContent = `Thème : ${currentTheme() === "dark" ? "sombre" : "clair"}`;
themeButton.addEventListener("click", () => {
  themeButton.textContent = `Thème : ${toggleTheme() === "dark" ? "sombre" : "clair"}`;
});

/** Ferme la session en cours (Worker compris, donc le WebSocket d'une partie en ligne) et remet l'écran de départ du solo. */
function endSession(): void {
  const s = session;
  if (s === null) return;
  s.worker.terminate();
  s.frontPanel?.close();
  s.replay?.close();
  s.combatIcons?.clear();
  stopAxisMode(false);
  session = null;
  clearNotifications();
  diplomacy.reset();
  setSpectator(false);
  setPlacementFlag(false);
  gameScreen.hidden = true;
  startScreen.hidden = false;
  playButton.disabled = false;
  playButton.textContent = "Jouer";
  testButton.disabled = false;
  testButton.textContent = "Partie de test";
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
  $("hover-box").hidden = tile < 0;
  if (tile >= 0) {
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
      ? `Placement : dans le rayon d'expansion d'une de vos villes (${m.expansionRadius} cases), en dehors de toute zone, coût ${num(me.foundingCost)} bonhomme${me.foundingCost > 1 ? "s" : ""}.`
      : "Placement de votre première ville : n'importe quelle case de terre libre, gratuit."
    : "";
}

foundButton.addEventListener("click", () => setPlacement(!placement));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  session?.infobar?.closeMenu();
  if (axisFront !== 0) stopAxisMode();
  if (placement) setPlacement(false);
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
  // Toute la population paie une ville, sauf les blessés (08 §10).
  if (me && me.population - me.hurt < me.foundingCost) return `Population insuffisante (${num(me.foundingCost)} bonhomme${me.foundingCost > 1 ? "s" : ""} nécessaire${me.foundingCost > 1 ? "s" : ""}).`;
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

$("axis-cancel").addEventListener("click", () => stopAxisMode());

function onMapClick(tile: number): void {
  const m = session?.mirror;
  if (m && axisFront !== 0) {
    // Mode choix d'axe : le clic lance la percée de la boîte sur la connexion du front la plus proche (05-Fronts §11.1), et le mode
    // se termine ; la fenêtre du front reste fermée (on la rouvre pour une autre percée).
    const axis = nearestConnection(m, axisFront, tile);
    if (axis !== null) {
      sendOrder({ type: "start_breakthrough", box: axisBox, city1: axis.city1, city2: axis.city2 });
      stopAxisMode();
    }
    return;
  }
  if (m && !placement) {
    // Aucun outil armé : un clic dans une zone de front, affichée ou non, ouvre le panneau de ce front (05-Fronts §11.1) ;
    // sinon un clic sur le territoire d'un autre joueur ouvre le menu de diplomatie, ailleurs il le ferme.
    const front = session?.view?.frontAt(tile);
    if (front !== undefined) {
      diplomacy.openFor(0);
      session?.frontPanel?.open(front, false);
      return;
    }
    // Un spectateur ne peut plus agir : pas de menu de diplomatie.
    if (!spectator) diplomacy.openFor(m.ownerOf(tile));
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

// ---- barre de boutons : Production (08 §11) ----

const productionButton = $<HTMLButtonElement>("production");
productionButton.addEventListener("click", () => {
  const panel = $("prod");
  panel.hidden = !panel.hidden;
  productionButton.setAttribute("aria-pressed", String(!panel.hidden));
  session?.production?.refresh();
  session?.infobar?.place();
});

// ---- barre de boutons : Tutoriel (07-Tutoriel.md) ----

const tutoButton = $<HTMLButtonElement>("tuto-button");
const tutoMenu = $("tuto-menu");

function setTutoMenu(open: boolean): void {
  tutoMenu.hidden = !open;
  tutoButton.setAttribute("aria-expanded", String(open));
}

tutoButton.addEventListener("click", () => setTutoMenu(tutoMenu.hidden !== false));
$("tuto-reset").addEventListener("click", () => {
  resetTutorial();
  setTutoMenu(false);
});
$("tuto-skip").addEventListener("click", () => {
  skipTutorial();
  setTutoMenu(false);
});
// Un appui en dehors du bouton et du menu, ou Échap, ferme le menu.
document.addEventListener("pointerdown", (e) => {
  if (!(e.target instanceof Node) || !tutoButton.parentElement!.contains(e.target)) setTutoMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setTutoMenu(false);
});

// ---- fronts : fenêtre d'un front (05-Fronts §11.4) ----

/** Front dont le joueur choisit l'axe d'une percée, et la boîte qui perce (0 : hors du mode). */
let axisFront = 0;
let axisBox = 0;
/** La fenêtre était ouverte depuis l'onglet des forces : elle se rouvre telle quelle à la fin du mode. */
let axisFromTab = false;

/** « Lancer » d'une boîte de percée : la fenêtre du front se ferme et la carte passe en mode choix d'axe (05-Fronts §11.1). */
function startAxisMode(frontId: number, boxId: number): void {
  const s = session;
  if (s === null) return;
  axisFromTab = s.frontPanel?.fromTab ?? false;
  s.frontPanel?.close();
  setPlacement(false);
  axisFront = frontId;
  axisBox = boxId;
  s.view?.setAxisMode(frontId);
  $("axis-cancel").hidden = false;
  $("bar-hint").textContent = "Percée : cliquez près d'une liaison du front pour lancer la percée. Échap : annuler.";
}

/** Fin du mode (clic ou Échap) : la fenêtre du front se rouvre, dans l'état d'avant « Lancer » ; `reopen` faux quand la partie se ferme. */
function stopAxisMode(reopen = true): void {
  const frontId = axisFront;
  axisFront = 0;
  axisBox = 0;
  session?.view?.setAxisMode(0);
  $("axis-cancel").hidden = true;
  if (session === null) return;
  $("bar-hint").textContent = "";
  const front = session.mirror?.fronts.find((f) => f.id === frontId);
  if (reopen && front !== undefined) session.frontPanel?.open(front, axisFromTab);
}

/** Connexion du front la plus proche de la case (05-Fronts §11.1, provisoire). */
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

/** Ouvre la fenêtre d'un front depuis l'onglet des forces, donc avec le bouton « ← Retour ». */
function openFront(id: number): void {
  const s = session;
  const front = s?.mirror?.fronts.find((f) => f.id === id);
  if (s === null || front === undefined) return;
  s.infobar?.closeAll();
  s.frontPanel?.open(front, true);
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
