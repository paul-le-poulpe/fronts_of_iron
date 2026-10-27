// Formats échangés entre les clients, le relais d'une partie (`packages/relay`) et
// le lobby (`worker/`). Docs/Design/01-Architecture.md §1 et §4.
//
// Tout est du JSON. Ce module n'a aucune dépendance et n'appelle aucune API de
// plateforme : le client, le serveur Node et le Worker l'importent tel quel.

// ---- réglages communs ----

/** Nombre maximal de joueurs d'une partie en ligne, hôte compris (00-Game §1.1). */
export const MAX_ONLINE_PLAYERS = 100;
/** Longueur maximale du nom d'un joueur, en caractères, après `trim`. */
export const PLAYER_NAME_MAX = 24;
/** Longueur maximale du nom d'une partie, en caractères, après `trim`. */
export const GAME_NAME_MAX = 40;

/** Cartes qu'un hôte peut choisir. Une seule pour l'instant : la carte de test, `generateTestMap(seed)` du moteur. */
export const MAP_IDS = ["test"] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP: MapId = "test";

/** Plus grande graine (le moteur accepte un entier de 0 à 2³² − 1). */
export const MAX_SEED = 0xffffffff;
/** Graine d'une salle neuve (la valeur par défaut de l'écran de départ solo). Provisoire. */
export const DEFAULT_SEED = 12345;

export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);
}

export function isSeed(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SEED;
}

/** Caractères de contrôle (U+0000 à U+001F, U+007F à U+009F) : refusés dans les noms. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function normalizeName(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length === 0 || CONTROL.test(name)) return null;
  // Longueur en caractères (points de code), pas en unités UTF-16.
  return Array.from(name).length <= max ? name : null;
}

/** Nom d'un joueur : 1 à 24 caractères après `trim`, sans caractère de contrôle. `null` si invalide. */
export function normalizePlayerName(raw: unknown): string | null {
  return normalizeName(raw, PLAYER_NAME_MAX);
}

/** Nom d'une partie : 1 à 40 caractères après `trim`, sans caractère de contrôle. `null` si invalide. */
export function normalizeGameName(raw: unknown): string | null {
  return normalizeName(raw, GAME_NAME_MAX);
}

// ---- entrée du lobby (GET /api/games) ----

/** Qui crée les tours : un Durable Object du Worker, ou le serveur Node d'un joueur (01-Architecture §1). */
export type GameMode = "cloudflare" | "host";

/** `waiting` : salle d'attente, on peut rejoindre. `started` : lancée, on ne peut que reprendre avec un jeton. */
export type RoomState = "waiting" | "started";

export interface LobbyEntry {
  readonly id: string;
  readonly name: string;
  /** Nom de l'hôte ; vide tant que l'hôte n'est pas entré dans la salle (ou si le serveur ne l'a pas donné). */
  readonly hostName: string;
  readonly mode: GameMode;
  /** `https://…` (tunnel d'un hôte) ou chemin relatif `/api/games/:id/ws` (partie Cloudflare). */
  readonly address: string;
  readonly map: MapId;
  /** `null` si l'hôte n'a pas indiqué la graine. */
  readonly seed: number | null;
  readonly players: number;
  readonly maxPlayers: number;
  readonly state: RoomState;
}

/** Chemin WebSocket d'une partie hébergée par Cloudflare ; c'est l'`address` de son entrée du lobby. */
export function cloudflareGamePath(id: string): string {
  return `/api/games/${encodeURIComponent(id)}/ws`;
}

// ---- salle d'attente : client → relais ----

export type ClientMessage =
  /**
   * Entrer dans la salle. `token` : jeton d'hôte (première entrée de l'hôte) ou jeton de joueur reçu à
   * l'arrivée (reconnexion). Avec un jeton connu, `name` est ignoré.
   */
  | { readonly type: "join"; readonly name: string; readonly token?: string }
  /** Hôte seulement, avant le lancement. `seed: "random"` : le relais tire une graine. */
  | { readonly type: "set_map"; readonly map?: MapId; readonly seed?: number | "random" }
  /** Hôte seulement : lance la partie. */
  | { readonly type: "start" };

// ---- salle d'attente : relais → client ----

export interface RoomPlayer {
  /** Rang dans la salle, de 1 à n sans trou (l'hôte est 1). Change quand un joueur part. */
  readonly id: number;
  readonly name: string;
  readonly host: boolean;
}

export interface StartPlayer {
  readonly id: number;
  readonly name: string;
}

export type RoomErrorCode =
  /** Message qui n'est pas du JSON de la forme attendue. */
  | "invalid_message"
  /** Message autre que `join` avant d'être entré dans la salle. */
  | "not_joined"
  | "already_joined"
  | "game_full"
  /** Partie lancée : seule la reconnexion par jeton est possible. */
  | "game_started"
  | "invalid_name"
  | "not_host"
  | "invalid_map"
  | "invalid_seed"
  /** Le même jeton vient d'être utilisé par une autre connexion, qui remplace celle-ci. */
  | "replaced";

/**
 * Texte de chaque erreur de la salle, envoyé par le relais avec le code (`message`) : la page
 * l'affiche tel quel. La page s'en sert aussi pour une vérification faite avant l'envoi (graine).
 */
export const ROOM_ERROR_TEXT: Readonly<Record<RoomErrorCode, string>> = {
  invalid_message: "Message refusé par le serveur : forme inattendue.",
  not_joined: "Message refusé par le serveur : vous n'êtes pas encore dans la salle.",
  already_joined: "Message refusé par le serveur : vous êtes déjà dans la salle.",
  game_full: "La partie est pleine (100 joueurs).",
  game_started: "La partie est déjà lancée : on ne peut plus la rejoindre.",
  invalid_name: "Nom invalide : 1 à 24 caractères, sans caractère de contrôle.",
  not_host: "Seul l'hôte peut faire cela.",
  invalid_map: "Carte inconnue.",
  invalid_seed: "Graine invalide : un entier de 0 à 4 294 967 295.",
  replaced: "Vous êtes connecté à cette partie depuis un autre onglet ou un autre appareil.",
};

export type ServerMessage =
  /** Seulement à l'arrivée d'un nouveau joueur : le jeton à garder pour revenir. */
  | { readonly type: "welcome"; readonly token: string }
  /** État de la salle, renvoyé à chaque changement tant que la partie n'est pas lancée. `you` : l'`id` du destinataire. */
  | {
      readonly type: "room";
      readonly you: number;
      readonly players: readonly RoomPlayer[];
      readonly map: MapId;
      readonly seed: number;
    }
  /**
   * Message de départ : envoyé à chaque joueur au lancement, puis à chaque reconnexion après le lancement.
   * Chaque client crée sa partie avec ces valeurs (01-Architecture §4).
   */
  | {
      readonly type: "start";
      readonly you: number;
      readonly map: MapId;
      readonly seed: number;
      readonly players: readonly StartPlayer[];
    }
  /** `message` : le texte à afficher (`ROOM_ERROR_TEXT`). */
  | { readonly type: "error"; readonly code: RoomErrorCode; readonly message: string };
