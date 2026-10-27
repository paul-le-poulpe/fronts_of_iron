// Accueil, salle d'attente et lancement des parties en ligne (Docs/Design/03-Client.md §7,
// 01-Architecture §4). Interface provisoire : la page ne contient aucune règle de jeu ;
// elle affiche ce que le relais envoie (état de la salle, message de départ) et lui envoie
// les choix de l'hôte. Le mode solo reste dans main.ts : ce module montre et cache #lobby et #app.

import "./lobby.css";

import {
  MAP_IDS,
  MAX_ONLINE_PLAYERS,
  cloudflareGamePath,
  normalizeGameName,
  normalizePlayerName,
  type ClientMessage,
  type LobbyEntry,
  type MapId,
  type RoomPlayer,
  type ServerMessage,
  type StartPlayer,
} from "@fronts-of-iron/shared";

import {
  forgetToken,
  gameAction,
  loadCreatePassword,
  loadPlayerName,
  loadToken,
  mapName,
  mapSummary,
  parseLobbyList,
  parseSeedInput,
  roomErrorText,
  saveCreatePassword,
  saveToken,
  savePlayerName,
  wsUrl,
  type KeyValueStore,
} from "./online.ts";
import { playerColor, rgbCss } from "./painter.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} introuvable`);
  return el as T;
};

/** `localStorage`, ou `null` si même y accéder lève (stockage bloqué). Les lectures et écritures ont leur propre try/catch (online.ts). */
function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const store = browserStore();

const SCREENS = ["lb-home", "lb-join", "lb-create", "lb-room", "lb-started"] as const;
type ScreenId = (typeof SCREENS)[number];

function show(screen: ScreenId): void {
  for (const id of SCREENS) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

/** Crée un élément avec une classe et un texte (jamais de HTML : les noms viennent des joueurs). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const num = (n: number): string => new Intl.NumberFormat("fr-FR").format(n);

// ---- accueil : liste des parties ----

/** Ce que l'accueil connaît d'une partie, d'après `GET /api/games`. */
let games: LobbyEntry[] = [];

const gamesBody = $("lb-games");
const status = $("lb-status");

/** Message sous le titre de la liste (`error` : en rouge). */
function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle("lb-error", error);
}

/**
 * Recharge la liste. Seulement au chargement de la page et au clic sur « Actualiser » : chaque liste
 * coûte une requête Worker et une requête Durable Object sur le quota gratuit (01-Architecture §4).
 */
async function refresh(): Promise<void> {
  const button = $<HTMLButtonElement>("lb-refresh");
  button.disabled = true;
  setStatus("Chargement…");
  try {
    const response = await fetch("/api/games");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    games = parseLobbyList(await response.json());
    renderGames();
    setStatus(games.length === 0 ? "Aucune partie ouverte." : "");
  } catch (error) {
    games = [];
    renderGames();
    setStatus(`Liste indisponible (${error instanceof Error ? error.message : "erreur"}).`, true);
  } finally {
    button.disabled = false;
  }
}

function renderGames(): void {
  gamesBody.replaceChildren(...games.map(gameRow));
}

function gameRow(game: LobbyEntry): HTMLTableRowElement {
  const row = el("tr");

  const name = el("td");
  name.append(el("div", "lb-game-name", game.name));
  if (game.hostName !== "") name.append(el("div", "lb-game-host", `Hôte : ${game.hostName}`));

  const mode = el("td");
  mode.append(
    game.mode === "cloudflare"
      ? el("span", "lb-badge lb-badge-cloudflare", "Cloudflare")
      : el("span", "lb-badge lb-badge-host", "PC de l'hôte"),
  );

  const act = el("td", "lb-act");
  const action = gameAction(game, loadToken(store, game.id) !== undefined);
  if (action === "join") {
    const b = el("button", "lb-btn lb-btn-primary", "Rejoindre");
    b.type = "button";
    b.addEventListener("click", () => openJoin(game));
    act.append(b);
  } else if (action === "resume") {
    const b = el("button", "lb-btn lb-btn-resume", "Reprendre");
    b.type = "button";
    b.addEventListener("click", () => resume(game));
    act.append(b);
  } else {
    act.append(el("span", "lb-closed", action === "full" ? "Pleine" : "Commencée"));
  }

  row.append(
    name,
    mode,
    el("td", undefined, mapSummary(game.map, game.seed)),
    el("td", "lb-num", `${num(game.players)} / ${num(game.maxPlayers)}`),
    el("td", undefined, game.state === "waiting" ? "En attente" : "En cours"),
    act,
  );
  return row;
}

$("lb-refresh").addEventListener("click", () => void refresh());

// ---- mode solo (débogage) : main.ts gère la partie, ce module n'affiche que #lobby ou #app ----

function showLobby(): void {
  $("app").hidden = true;
  $("lobby").hidden = false;
  show("lb-home");
}

$("lb-solo").addEventListener("click", () => {
  $("lobby").hidden = true;
  $("app").hidden = false;
});
$("solo-back").addEventListener("click", showLobby);

// ---- connexion à une partie ----

/** Ce qu'il faut savoir d'une partie pour s'y connecter. */
interface Target {
  readonly id: string;
  readonly name: string;
  readonly mode: LobbyEntry["mode"];
  readonly address: string;
  readonly hostName: string;
}

/** D'où l'on vient : l'écran où afficher une erreur survenue avant d'être entré dans la salle. */
type Origin = "lb-home" | "lb-join" | "lb-create";

interface Connection {
  readonly ws: WebSocket;
  readonly target: Target;
  readonly playerName: string;
  readonly origin: Origin;
  /** Reprise d'une partie lancée : un `welcome` (nouveau joueur) au lieu de `start` veut dire que la partie n'existe plus. */
  readonly resuming: boolean;
  /** Vrai dès que le relais a répondu `welcome`, `room` ou `start`. */
  joined: boolean;
  /** Une erreur a déjà été affichée pour cette connexion. */
  failed: boolean;
}

let current: Connection | null = null;

function targetOf(entry: LobbyEntry): Target {
  return { id: entry.id, name: entry.name, mode: entry.mode, address: entry.address, hostName: entry.hostName };
}

function send(message: ClientMessage): void {
  if (current !== null && current.ws.readyState === WebSocket.OPEN) current.ws.send(JSON.stringify(message));
}

function disconnect(): void {
  const c = current;
  current = null;
  c?.ws.close(1000);
}

/** Ouvre le WebSocket de la partie et envoie `join` (nom, et jeton s'il y en a un). */
function connect(target: Target, playerName: string, token: string | undefined, origin: Origin, resuming = false): void {
  disconnect();
  const url = wsUrl(target.address, window.location);
  if (url === null) {
    failBeforeJoin(origin, "Adresse de la partie invalide.");
    return;
  }
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    failBeforeJoin(origin, "Connexion impossible.");
    return;
  }
  const c: Connection = { ws, target, playerName, origin, resuming, joined: false, failed: false };
  current = c;
  setBusy(origin, true);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", name: playerName, ...(token !== undefined ? { token } : {}) } satisfies ClientMessage));
  });
  ws.addEventListener("message", (event) => {
    if (current !== c || typeof event.data !== "string") return;
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    onMessage(c, message);
  });
  ws.addEventListener("close", () => {
    if (current === c) onClosed(c);
  });
}

function onMessage(c: Connection, message: ServerMessage): void {
  switch (message.type) {
    case "welcome":
      if (c.resuming) {
        // On croyait reprendre une partie lancée ; le serveur nous a pris pour un nouveau joueur : elle n'existe plus.
        forgetToken(store, c.target.id);
        failBeforeJoin(c.origin, "Cette partie n'existe plus.");
        c.failed = true;
        disconnect();
        return;
      }
      c.joined = true;
      saveToken(store, c.target.id, message.token);
      return;
    case "room":
      c.joined = true;
      setBusy(c.origin, false);
      renderRoom(c, message);
      hideNotice();
      show("lb-room");
      return;
    case "start":
      c.joined = true;
      setBusy(c.origin, false);
      renderStarted(c, message);
      hideNotice();
      show("lb-started");
      return;
    case "error":
      onRoomError(c, message.code);
      return;
  }
}

function onRoomError(c: Connection, code: Extract<ServerMessage, { type: "error" }>["code"]): void {
  if (!c.joined) {
    // Refus à l'arrivée : partie pleine, déjà lancée, nom invalide. On retourne à l'écran d'où l'on vient.
    if (c.resuming) forgetToken(store, c.target.id);
    c.failed = true;
    failBeforeJoin(c.origin, c.resuming ? "Impossible de reprendre cette partie." : roomErrorText(code));
    disconnect();
    return;
  }
  if (code === "replaced") {
    // Un autre onglet a repris notre place : ne pas se reconnecter, on le chasserait à son tour.
    c.failed = true;
    showNotice(roomErrorText(code), false);
    return;
  }
  // Erreur sur un message de l'hôte (graine invalide, lancement refusé…) : affichée dans la salle.
  startButton.disabled = false;
  showNotice(roomErrorText(code), false);
}

function onClosed(c: Connection): void {
  setBusy(c.origin, false);
  if (!c.joined) {
    if (!c.failed) failBeforeJoin(c.origin, "Connexion impossible.");
    current = null;
    return;
  }
  if (c.failed) return;
  showNotice("Connexion perdue.", true);
}

/** Remet l'écran d'origine avec le message d'erreur. */
function failBeforeJoin(origin: Origin, text: string): void {
  setBusy(origin, false);
  if (origin === "lb-join") {
    show("lb-join");
    showError("lb-join-error", text);
  } else if (origin === "lb-create") {
    show("lb-create");
    showError("lb-create-error", text);
  } else {
    show("lb-home");
    setStatus(text, true);
    renderGames();
  }
}

/** Désactive le bouton d'envoi du formulaire pendant la connexion. */
function setBusy(origin: Origin, busy: boolean): void {
  if (origin === "lb-join") {
    $<HTMLButtonElement>("lb-join-submit").disabled = busy;
    $("lb-join-submit").textContent = busy ? "Connexion…" : "Rejoindre";
  } else if (origin === "lb-create") {
    $<HTMLButtonElement>("lb-create-submit").disabled = busy;
    $("lb-create-submit").textContent = busy ? "Création…" : "Créer la partie";
  }
}

function showError(id: string, text: string): void {
  const p = $(id);
  p.textContent = text;
  p.hidden = false;
}

function clearError(id: string): void {
  $(id).hidden = true;
}

/** Bandeau de la salle et de l'écran de lancement : erreur ou connexion perdue (avec « Se reconnecter »). */
function showNotice(text: string, canReconnect: boolean): void {
  for (const prefix of ["lb-room", "lb-started"]) {
    $(`${prefix}-notice-text`).textContent = text;
    $(`${prefix}-reconnect`).hidden = !canReconnect;
    $(`${prefix}-notice`).hidden = false;
  }
}

function hideNotice(): void {
  for (const prefix of ["lb-room", "lb-started"]) $(`${prefix}-notice`).hidden = true;
}

function reconnect(): void {
  const c = current;
  if (c === null) return;
  const token = loadToken(store, c.target.id);
  // Depuis l'écran de lancement, on reprend une partie lancée ; une erreur est affichée sur l'accueil.
  connect(c.target, c.playerName, token, "lb-home", token !== undefined && !$("lb-started").hidden);
}

for (const id of ["lb-room-reconnect", "lb-started-reconnect"]) $(id).addEventListener("click", reconnect);

function leave(): void {
  disconnect();
  hideNotice();
  show("lb-home");
}
$("lb-room-leave").addEventListener("click", leave);
$("lb-started-home").addEventListener("click", leave);

// ---- rejoindre ----

let joining: LobbyEntry | null = null;
const joinName = $<HTMLInputElement>("lb-join-name");

function openJoin(game: LobbyEntry): void {
  joining = game;
  $("lb-join-title").textContent = game.name;
  const parts = [
    ...(game.hostName !== "" ? [`Hôte : ${game.hostName}`] : []),
    game.mode === "cloudflare" ? "Cloudflare" : "PC de l'hôte",
    `${num(game.players)} / ${num(game.maxPlayers)} joueurs`,
  ];
  $("lb-join-info").textContent = parts.join(" · ");
  joinName.value = loadPlayerName(store);
  clearError("lb-join-error");
  setBusy("lb-join", false);
  show("lb-join");
  joinName.focus();
}

$("lb-join-cancel").addEventListener("click", () => {
  disconnect();
  show("lb-home");
});

$<HTMLFormElement>("lb-join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (joining === null) return;
  const name = normalizePlayerName(joinName.value);
  if (name === null) {
    showError("lb-join-error", "Le nom doit faire de 1 à 24 caractères.");
    return;
  }
  clearError("lb-join-error");
  savePlayerName(store, name);
  // Un jeton gardé pour cette partie (l'hôte qui revient, par exemple) est renvoyé avec le nom.
  connect(targetOf(joining), name, loadToken(store, joining.id), "lb-join");
});

function resume(game: LobbyEntry): void {
  setStatus("Connexion…");
  connect(targetOf(game), loadPlayerName(store), loadToken(store, game.id), "lb-home", true);
}

// ---- créer une partie Cloudflare ----

const createGameName = $<HTMLInputElement>("lb-create-game");
const createName = $<HTMLInputElement>("lb-create-name");
const createPassword = $<HTMLInputElement>("lb-create-password");

$("lb-create-open").addEventListener("click", () => {
  createName.value = loadPlayerName(store);
  createPassword.value = loadCreatePassword(store);
  clearError("lb-create-error");
  setBusy("lb-create", false);
  show("lb-create");
  createGameName.focus();
});

$("lb-create-cancel").addEventListener("click", () => show("lb-home"));

$<HTMLFormElement>("lb-create-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const gameName = normalizeGameName(createGameName.value);
  const name = normalizePlayerName(createName.value);
  if (gameName === null) {
    showError("lb-create-error", "Le nom de la partie doit faire de 1 à 40 caractères.");
    return;
  }
  if (name === null) {
    showError("lb-create-error", "Votre nom doit faire de 1 à 24 caractères.");
    return;
  }
  clearError("lb-create-error");
  savePlayerName(store, name);
  void createGame(gameName, name, createPassword.value);
});

/** Texte affiché pour un refus de `POST /api/games/cloudflare`, selon son code HTTP. */
const CREATE_ERRORS: Readonly<Record<number, string>> = {
  400: "Nom de partie refusé par le serveur.",
  401: "Mot de passe de création incorrect.",
  503: "La création de parties n'est pas configurée sur ce serveur (mot de passe absent).",
};

/** `POST /api/games/cloudflare`, puis connexion avec le jeton d'hôte reçu. */
async function createGame(gameName: string, playerName: string, password: string): Promise<void> {
  setBusy("lb-create", true);
  try {
    const response = await fetch("/api/games/cloudflare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gameName, password }),
    });
    if (!response.ok) throw new Error(CREATE_ERRORS[response.status] ?? "Création impossible.");
    const body = (await response.json()) as { id?: unknown; hostToken?: unknown };
    if (typeof body.id !== "string" || typeof body.hostToken !== "string") throw new Error("Création impossible.");
    // Le mot de passe n'est gardé qu'une fois accepté par le serveur.
    saveCreatePassword(store, password);
    saveToken(store, body.id, body.hostToken);
    const target: Target = { id: body.id, name: gameName, mode: "cloudflare", address: cloudflareGamePath(body.id), hostName: playerName };
    connect(target, playerName, body.hostToken, "lb-create");
  } catch (error) {
    setBusy("lb-create", false);
    showError("lb-create-error", error instanceof Error && Object.values(CREATE_ERRORS).includes(error.message) ? error.message : "Création impossible.");
  }
}

// ---- salle d'attente ----

type RoomMessage = Extract<ServerMessage, { type: "room" }>;
type StartMessage = Extract<ServerMessage, { type: "start" }>;

const seedInput = $<HTMLInputElement>("lb-seed-input");
const mapSelect = $<HTMLSelectElement>("lb-map-select");
const startButton = $<HTMLButtonElement>("lb-start");

for (const id of MAP_IDS) {
  const option = el("option", undefined, mapName(id));
  option.value = id;
  mapSelect.append(option);
}

function playerRow(player: RoomPlayer | StartPlayer, tag: string): HTMLLIElement {
  const li = el("li");
  const swatch = el("span", "lb-swatch");
  swatch.style.background = rgbCss(playerColor(player.id));
  const who = el("span", "lb-who");
  who.append(swatch, el("strong", undefined, player.name));
  li.append(who, el("span", "lb-tag", tag));
  return li;
}

function renderRoom(c: Connection, room: RoomMessage): void {
  const me = room.players.find((p) => p.id === room.you);
  const isHost = me?.host === true;
  const host = room.players.find((p) => p.host);

  $("lb-room-title").textContent = c.target.name;
  const mode = $("lb-room-mode");
  mode.textContent = c.target.mode === "cloudflare" ? "Cloudflare" : "PC de l'hôte";
  mode.className = c.target.mode === "cloudflare" ? "lb-badge lb-badge-cloudflare" : "lb-badge lb-badge-host";
  $("lb-room-you-host").hidden = !isHost;
  $("lb-room-host").textContent = !isHost && host !== undefined ? `Hôte : ${host.name}` : "";

  $("lb-room-count").textContent = `${num(room.players.length)} / ${MAX_ONLINE_PLAYERS}`;
  $("lb-room-players").replaceChildren(
    ...room.players.map((p) => playerRow(p, p.host ? (p.id === room.you ? "Hôte · vous" : "Hôte") : p.id === room.you ? "vous" : "")),
  );

  for (const node of document.querySelectorAll<HTMLElement>("#lb-room-map .lb-host-only")) node.hidden = !isHost;
  for (const node of document.querySelectorAll<HTMLElement>("#lb-room-map .lb-player-only")) node.hidden = isHost;
  $("lb-room-map").classList.toggle("lb-is-player", !isHost);

  $("lb-room-map-name").textContent = mapName(room.map);
  $("lb-room-seed").textContent = String(room.seed);
  mapSelect.value = room.map;
  // Ne pas écraser une graine que l'hôte est en train de taper.
  if (document.activeElement !== seedInput) seedInput.value = String(room.seed);
  startButton.disabled = false;
}

function renderStarted(c: Connection, start: StartMessage): void {
  $("lb-started-game").textContent = c.target.name;
  $("lb-started-map").textContent = mapName(start.map);
  $("lb-started-seed").textContent = String(start.seed);
  const me = start.players.find((p) => p.id === start.you);
  $("lb-started-you").textContent = me === undefined ? `joueur ${start.you}` : `joueur ${me.id}, ${me.name}`;
  $("lb-started-count").textContent = `${num(start.players.length)}`;
  $("lb-started-players").replaceChildren(...start.players.map((p) => playerRow(p, p.id === start.you ? "vous" : "")));
}

mapSelect.addEventListener("change", () => {
  if ((MAP_IDS as readonly string[]).includes(mapSelect.value)) send({ type: "set_map", map: mapSelect.value as MapId });
});

/** La graine saisie est envoyée à la validation du champ (Entrée), pas à chaque frappe. */
$<HTMLFormElement>("lb-seed-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const seed = parseSeedInput(seedInput.value);
  if (seed === null) {
    showNotice(roomErrorText("invalid_seed"), false);
    return;
  }
  hideNotice();
  send({ type: "set_map", seed });
});
seedInput.addEventListener("change", () => $<HTMLFormElement>("lb-seed-form").requestSubmit());

$("lb-seed-random").addEventListener("click", () => send({ type: "set_map", seed: "random" }));

startButton.addEventListener("click", () => {
  startButton.disabled = true;
  send({ type: "start" });
});

// ---- démarrage ----

void refresh();
