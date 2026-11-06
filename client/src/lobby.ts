// Accueil, salle d'attente et lancement des parties en ligne (Docs/Design/03-Client.md §7,
// 01-Architecture §4). Interface provisoire : la page ne contient aucune règle de jeu ;
// elle affiche ce que le relais envoie (état de la salle) et lui envoie les choix de l'hôte.
// Le mode solo et la partie lancée sont dans main.ts : ce module montre et cache #lobby et #app,
// et confie la partie lancée à main.ts (`setGameLauncher`), dont le Web Worker rouvre sa propre
// connexion avec le jeton.

import "./lobby.css";

import {
  MAP_IDS,
  MAX_ONLINE_PLAYERS,
  PLAYER_COLOR_COUNT,
  ROOM_ERROR_TEXT,
  cloudflareGamePath,
  normalizeGameName,
  normalizePlayerName,
  pickPlayerColor,
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
  gameToResume,
  loadCreatePassword,
  loadPlayerColor,
  loadPlayerName,
  loadToken,
  mapName,
  mapSummary,
  parseLobbyList,
  parseSeedInput,
  httpErrorText,
  NETWORK_ERROR_TEXT,
  saveCreatePassword,
  saveToken,
  savePlayerColor,
  savePlayerName,
  wsUrl,
  type KeyValueStore,
} from "./online.ts";
import { mapColor, PLAYER_COLORS, rgbCss } from "./playercolors.ts";
import { colorIconUrl, preloadUnitIcons } from "./uniticons.ts";
import { num } from "./format.ts";

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


// ---- couleur du joueur (09-Couleurs §5) ----

/** Icône de l'aperçu : un char aux tons d'unité de la couleur choisie. */
const COLOR_PREVIEW = "armament/icon-armament-medium-tank-32.png";

let color = loadPlayerColor(store);

/** Garde `index` comme dernière couleur choisie : demandée au relais en entrant dans une salle, proposée en solo. */
function chooseColor(index: number): void {
  color = index;
  savePlayerColor(store, color);
}

// Solo : pas de salle d'attente, l'écran de départ donne une ligne au joueur et une à chaque bot.

const botsInput = $<HTMLInputElement>("bots");
const soloRows = $("solo-colors");
/** Couleur de chaque joueur du solo : le joueur, puis les bots. */
let soloList: number[] = [color];

/** Couleurs du formulaire du solo (`ToWorker`) ; le bot d'indice `i` est le joueur `i + 1`. */
export const soloColors = (): readonly number[] => soloList;

/** Pseudo du formulaire de connexion, gardé par la page ; `null` si aucun pseudo valide n'est gardé. */
export const soloName = (): string | null => normalizePlayerName(loadPlayerName(store));

function soloColorRow(index: number): HTMLLabelElement {
  const row = el("label", "solo-color");
  const swatch = el("span", "sw");
  swatch.style.background = rgbCss(mapColor(soloList[index]!));
  const select = el("select");
  select.append(
    ...PLAYER_COLORS.map((entry, i) => {
      const option = el("option", undefined, entry.name);
      option.value = String(i);
      option.disabled = soloList.some((c, other) => other !== index && c === i);
      return option;
    }),
  );
  select.value = String(soloList[index]);
  select.addEventListener("change", () => {
    soloList[index] = Number(select.value);
    if (index === 0) chooseColor(soloList[0]!);
    renderSoloColors();
  });
  row.append(el("span", undefined, index === 0 ? "Vous" : `Bot ${index}`), swatch, select);
  return row;
}

/** Une ligne par joueur : les bots ajoutés reçoivent une couleur libre, écartée de celle du bot précédent. */
function renderSoloColors(): void {
  const bots = Math.min(Number(botsInput.max), Math.max(1, Math.trunc(Number(botsInput.value)) || 1));
  soloList.length = Math.min(soloList.length, 1 + bots);
  for (let id = soloList.length + 1; id <= 1 + bots; id++) soloList.push(pickPlayerColor((id * 3) % PLAYER_COLOR_COUNT, soloList));
  soloRows.replaceChildren(...soloList.map((_, i) => soloColorRow(i)));
}

botsInput.addEventListener("input", renderSoloColors);
renderSoloColors();

const colorButton = $<HTMLButtonElement>("lb-color");
const colorList = $("lb-color-list");
/** Couleur du joueur dans la salle, attribuée par le relais. */
let roomColor = color;

function renderColor(): void {
  colorButton.style.background = rgbCss(mapColor(roomColor));
  colorButton.title = PLAYER_COLORS[roomColor]!.name;
  $("lb-color-name").textContent = PLAYER_COLORS[roomColor]!.name;
  $<HTMLImageElement>("lb-color-preview").src = colorIconUrl(COLOR_PREVIEW, roomColor);
  for (const [i, node] of [...colorList.children].entries()) node.classList.toggle("lb-color-on", i === roomColor);
}

function openColors(open: boolean): void {
  colorList.hidden = !open;
  colorButton.setAttribute("aria-expanded", String(open));
}

colorList.append(
  ...PLAYER_COLORS.map((entry, i) => {
    const b = el("button", "lb-color-pick");
    b.type = "button";
    b.title = entry.name;
    b.setAttribute("aria-label", entry.name);
    b.style.background = rgbCss(mapColor(i));
    b.addEventListener("click", () => {
      chooseColor(i);
      send({ type: "set_color", color: i });
      openColors(false);
      colorButton.focus();
    });
    return b;
  }),
);

colorButton.addEventListener("click", () => openColors(colorList.hidden === true));
document.addEventListener("click", (e) => {
  const target = e.target as Node;
  if (!colorList.hidden && !colorList.contains(target) && !colorButton.contains(target)) openColors(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !colorList.hidden) openColors(false);
});

renderColor();
// L'aperçu reste vert tant que les PNG ne sont pas lus.
void preloadUnitIcons().then(renderColor);

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
    let response: Response;
    try {
      response = await fetch("/api/games");
    } catch {
      throw new Error(NETWORK_ERROR_TEXT);
    }
    if (!response.ok) throw new Error(httpErrorText(response.status, await response.json().catch(() => null)));
    games = parseLobbyList(await response.json());
    renderGames();
    setStatus(games.length === 0 ? "Aucune partie ouverte." : "");
  } catch (error) {
    games = [];
    renderGames();
    setStatus(`Liste indisponible. ${error instanceof Error ? error.message : ""}`, true);
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

/**
 * Montre l'accueil. `text` : un message sous le titre de la liste (`error` : en rouge), par exemple la raison
 * pour laquelle une partie en ligne s'est arrêtée ; sans texte, le message actuel reste. La liste n'est pas
 * rechargée (quota, 01-Architecture §4).
 */
export function showHome(text = "", error = false): void {
  disconnect();
  $("app").hidden = true;
  $("lobby").hidden = false;
  show("lb-home");
  if (text !== "") setStatus(text, error);
}

$("lb-solo").addEventListener("click", () => {
  // La couleur a pu changer dans une salle d'attente.
  soloList = [color];
  renderSoloColors();
  $("lobby").hidden = true;
  $("app").hidden = false;
});
$("solo-back").addEventListener("click", () => showHome());

/** Ce que main.ts fait d'une partie lancée : l'ouvrir (Web Worker + WebSocket), ou l'abandonner avant son chargement. */
interface GameLauncher {
  start(launch: { readonly url: string; readonly name: string; readonly token: string }): void;
  cancel(): void;
}
let launcher: GameLauncher | null = null;

export function setGameLauncher(value: GameLauncher): void {
  launcher = value;
}

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
    ws.send(JSON.stringify({ type: "join", name: playerName, color, ...(token !== undefined ? { token } : {}) } satisfies ClientMessage));
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
      launch(c, message);
      return;
    case "error":
      onRoomError(c, message);
      return;
  }
}

/**
 * Le relais a lancé la partie (ou la reprend). La page ferme son WebSocket de salle et confie la partie au Web
 * Worker, qui se connecte avec le même jeton : le relais le reconnaît, lui renvoie le message de départ et tous
 * les tours créés jusque-là. L'écran « Partie lancée » reste affiché jusqu'à ce que le Worker ait créé la partie.
 */
function launch(c: Connection, start: StartMessage): void {
  const url = wsUrl(c.target.address, window.location);
  const token = loadToken(store, c.target.id);
  if (url === null || token === undefined || launcher === null) {
    c.failed = true;
    failBeforeJoin(c.origin, "Impossible d'ouvrir la partie lancée.");
    disconnect();
    return;
  }
  setBusy(c.origin, false);
  renderStarted(c, start);
  show("lb-started");
  disconnect();
  launcher.start({ url, name: c.playerName, token });
}

/** Le texte vient du relais (`message`) ; le code ne sert qu'à décider quoi faire. */
function onRoomError(c: Connection, error: Extract<ServerMessage, { type: "error" }>): void {
  const text = typeof error.message === "string" && error.message !== "" ? error.message : `Erreur du serveur (${error.code}).`;
  if (!c.joined) {
    // Refus à l'arrivée : partie pleine, déjà lancée, nom invalide. On retourne à l'écran d'où l'on vient.
    if (c.resuming) forgetToken(store, c.target.id);
    c.failed = true;
    failBeforeJoin(c.origin, c.resuming ? `Impossible de reprendre cette partie : ${text}` : text);
    disconnect();
    return;
  }
  if (error.code === "replaced") {
    // Un autre onglet a repris notre place : ne pas se reconnecter, on le chasserait à son tour.
    c.failed = true;
    showNotice(text, false);
    return;
  }
  // Erreur sur un message de l'hôte (graine invalide, lancement refusé…) : affichée dans la salle.
  startButton.disabled = false;
  showNotice(text, false);
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

/** Bandeau de la salle : erreur ou connexion perdue (avec « Se reconnecter »). */
function showNotice(text: string, canReconnect: boolean): void {
  $("lb-room-notice-text").textContent = text;
  $("lb-room-reconnect").hidden = !canReconnect;
  $("lb-room-notice").hidden = false;
}

function hideNotice(): void {
  $("lb-room-notice").hidden = true;
}

function reconnect(): void {
  const c = current;
  if (c === null) return;
  // Une erreur est affichée sur l'accueil ; si la partie a été lancée entre-temps, la réponse est le message de départ.
  connect(c.target, c.playerName, loadToken(store, c.target.id), "lb-home");
}

$("lb-room-reconnect").addEventListener("click", reconnect);

function leave(): void {
  openColors(false);
  disconnect();
  hideNotice();
  launcher?.cancel();
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

/** `POST /api/games/cloudflare`, puis connexion avec le jeton d'hôte reçu. Un refus affiche le `message` du serveur. */
async function createGame(gameName: string, playerName: string, password: string): Promise<void> {
  setBusy("lb-create", true);
  try {
    let response: Response;
    try {
      response = await fetch("/api/games/cloudflare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: gameName, password }),
      });
    } catch {
      throw new Error(NETWORK_ERROR_TEXT);
    }
    if (!response.ok) throw new Error(httpErrorText(response.status, await response.json().catch(() => null)));
    const body = (await response.json()) as { id?: unknown; hostToken?: unknown };
    if (typeof body.id !== "string" || typeof body.hostToken !== "string") throw new Error("Réponse inattendue du serveur.");
    // Le mot de passe n'est gardé qu'une fois accepté par le serveur.
    saveCreatePassword(store, password);
    saveToken(store, body.id, body.hostToken);
    const target: Target = { id: body.id, name: gameName, mode: "cloudflare", address: cloudflareGamePath(body.id), hostName: playerName };
    connect(target, playerName, body.hostToken, "lb-create");
  } catch (error) {
    setBusy("lb-create", false);
    showError("lb-create-error", `Création impossible. ${error instanceof Error ? error.message : ""}`);
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
  swatch.style.background = rgbCss(mapColor(player.color));
  const who = el("span", "lb-who");
  who.append(swatch, el("strong", undefined, player.name));
  li.append(who, el("span", "lb-tag", tag));
  return li;
}

/** Couleur du joueur, et couleurs prises par les autres : grisées, avec le nom du joueur au survol. */
function renderRoomColors(room: RoomMessage, mine: number | undefined): void {
  roomColor = mine ?? roomColor;
  renderColor();
  for (const [i, node] of [...colorList.children].entries()) {
    const other = room.players.find((p) => p.id !== room.you && p.color === i);
    (node as HTMLButtonElement).disabled = other !== undefined;
    (node as HTMLButtonElement).title = other === undefined ? PLAYER_COLORS[i]!.name : `${PLAYER_COLORS[i]!.name} : ${other.name}`;
  }
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

  renderRoomColors(room, me?.color);
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
    showNotice(ROOM_ERROR_TEXT.invalid_seed, false);
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

// Reprise automatique (01-Architecture §4) : une partie lancée dont le navigateur a le jeton est
// reprise dès le chargement, sans passer par le bouton « Reprendre ».
void refresh().then(() => {
  const game = gameToResume(games, (id) => loadToken(store, id) !== undefined);
  if (game !== null) resume(game);
});
