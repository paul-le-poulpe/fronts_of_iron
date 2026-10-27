// Parties en ligne, côté page, sans DOM : adresse du WebSocket, ce que le navigateur
// garde (nom, jetons), textes des erreurs de la salle, liste du lobby. Testé sous
// Node (`test/online.test.ts`). Docs/Design/03-Client.md §7, 01-Architecture §4 et §6.

import { MAP_IDS, type LobbyEntry, type MapId } from "@fronts-of-iron/shared";

// ---- adresse du WebSocket ----

/**
 * Adresse du WebSocket d'une partie, d'après l'`address` de son entrée du lobby
 * (01-Architecture §6, Client, point 2). Jamais d'adresse écrite en dur :
 * - chemin relatif (`/api/games/:id/ws`, partie Cloudflare) : `wss://` + hôte de la page, ou `ws://` si la page est en `http` ;
 * - `https://…` (tunnel d'un hôte) : `wss://…` ;
 * - `http://…` : `ws://…` (essai direct sans tunnel, `ws://localhost`).
 * Renvoie `null` pour tout autre schéma.
 */
export function wsUrl(address: string, page: { readonly protocol: string; readonly host: string }): string | null {
  if (address.startsWith("/") && !address.startsWith("//")) {
    return `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}${address}`;
  }
  if (address.startsWith("https://")) return `wss://${address.slice("https://".length)}`;
  if (address.startsWith("http://")) return `ws://${address.slice("http://".length)}`;
  return null;
}

// ---- stockage du navigateur ----

/** Ce dont on a besoin de `localStorage` (et que les tests remplacent). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NAME_KEY = "foi.playerName";
const TOKENS_KEY = "foi.tokens";
const PASSWORD_KEY = "foi.createPassword";
/** Nombre de jetons gardés ; les plus anciens sont oubliés. */
const MAX_TOKENS = 20;

/** Toute lecture ou écriture peut lever (stockage bloqué, navigateur en navigation privée) : la page doit marcher sans. */
function read(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Pas de stockage : la valeur sera redemandée la prochaine fois.
  }
}

export function loadPlayerName(store: KeyValueStore | null): string {
  return read(store, NAME_KEY) ?? "";
}

export function savePlayerName(store: KeyValueStore | null, name: string): void {
  write(store, NAME_KEY, name);
}

/** Mot de passe de création des parties Cloudflare, gardé après une création réussie. */
export function loadCreatePassword(store: KeyValueStore | null): string {
  return read(store, PASSWORD_KEY) ?? "";
}

export function saveCreatePassword(store: KeyValueStore | null, password: string): void {
  write(store, PASSWORD_KEY, password);
}

/** Jetons par identifiant de partie. Un contenu illisible est ignoré. */
function readTokens(store: KeyValueStore | null): Record<string, string> {
  const raw = read(store, TOKENS_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed)) if (typeof token === "string") out[id] = token;
    return out;
  } catch {
    return {};
  }
}

export function loadToken(store: KeyValueStore | null, gameId: string): string | undefined {
  return readTokens(store)[gameId];
}

export function saveToken(store: KeyValueStore | null, gameId: string, token: string): void {
  const tokens = readTokens(store);
  delete tokens[gameId]; // réinséré en dernier : c'est le plus récent
  tokens[gameId] = token;
  const kept = Object.entries(tokens).slice(-MAX_TOKENS);
  write(store, TOKENS_KEY, JSON.stringify(Object.fromEntries(kept)));
}

export function forgetToken(store: KeyValueStore | null, gameId: string): void {
  const tokens = readTokens(store);
  if (!(gameId in tokens)) return;
  delete tokens[gameId];
  write(store, TOKENS_KEY, JSON.stringify(tokens));
}

// ---- textes ----

/**
 * Texte d'une réponse d'erreur du Worker (`{ error, message }`, 01-Architecture §4) : le `message`
 * envoyé par le serveur, ou, s'il n'y en a pas (proxy, panne), le code HTTP.
 */
export function httpErrorText(status: number, body: unknown): string {
  const message = typeof body === "object" && body !== null ? (body as { message?: unknown }).message : undefined;
  if (typeof message === "string" && message !== "") return message;
  if (status === 502 || status === 503 || status === 504) return `Serveur injoignable (HTTP ${status}).`;
  return `Erreur du serveur (HTTP ${status}).`;
}

/** Texte d'un `fetch` qui n'a pas reçu de réponse. */
export const NETWORK_ERROR_TEXT = "Serveur injoignable : pas de réponse.";

const MAP_NAMES: Readonly<Record<MapId, string>> = { test: "Carte de test (générée)" };

export function mapName(map: MapId): string {
  return MAP_NAMES[map];
}

/** « Carte de test · graine 12345 », ou sans la graine si l'hôte ne l'a pas donnée. */
export function mapSummary(map: MapId, seed: number | null): string {
  const name = map === "test" ? "Carte de test" : mapName(map);
  return seed === null ? name : `${name} · graine ${seed}`;
}

/** Graine saisie dans le champ de la salle : un entier de 0 à 2³² − 1, sinon `null`. */
export function parseSeedInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n <= 0xffffffff ? n : null;
}

// ---- liste du lobby ----

/** Les entrées valides de la réponse de `GET /api/games` ; les autres sont ignorées. */
export function parseLobbyList(body: unknown): LobbyEntry[] {
  const games = typeof body === "object" && body !== null ? (body as { games?: unknown }).games : undefined;
  if (!Array.isArray(games)) return [];
  const out: LobbyEntry[] = [];
  for (const g of games as unknown[]) {
    if (typeof g !== "object" || g === null) continue;
    const e = g as Record<string, unknown>;
    if (
      typeof e.id !== "string" ||
      typeof e.name !== "string" ||
      typeof e.address !== "string" ||
      typeof e.players !== "number" ||
      typeof e.maxPlayers !== "number"
    ) {
      continue;
    }
    out.push({
      id: e.id,
      name: e.name,
      hostName: typeof e.hostName === "string" ? e.hostName : "",
      mode: e.mode === "cloudflare" ? "cloudflare" : "host",
      address: e.address,
      map: (MAP_IDS as readonly unknown[]).includes(e.map) ? (e.map as MapId) : "test",
      seed: typeof e.seed === "number" ? e.seed : null,
      players: e.players,
      maxPlayers: e.maxPlayers,
      state: e.state === "started" ? "started" : "waiting",
    });
  }
  return out;
}

/** Ce que la liste propose pour une partie. */
export type GameAction = "join" | "resume" | "full" | "closed";

/**
 * Partie en attente : « Rejoindre » (« Pleine » si elle l'est) ; lancée : « Reprendre » si le navigateur a un jeton
 * de cette partie, sinon « Commencée ».
 */
/**
 * Partie à reprendre d'elle-même au chargement de la page (01-Architecture §4) : la première partie
 * lancée de la liste dont le navigateur a le jeton, ou null.
 */
export function gameToResume(entries: readonly LobbyEntry[], hasToken: (gameId: string) => boolean): LobbyEntry | null {
  return entries.find((e) => gameAction(e, hasToken(e.id)) === "resume") ?? null;
}

export function gameAction(entry: LobbyEntry, hasToken: boolean): GameAction {
  if (entry.state === "waiting") return entry.players >= entry.maxPlayers ? "full" : "join";
  return hasToken ? "resume" : "closed";
}
