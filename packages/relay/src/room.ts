// La salle d'attente d'une partie en ligne (Docs/Design/01-Architecture.md §4).
//
// Une `Room` ne connaît ni horloge, ni réseau, ni hasard : l'enveloppe (Durable
// Object, serveur Node) lui donne les connexions comme des identifiants de
// chaîne, lui passe chaque message reçu, et envoie ce qu'elle renvoie. Le
// jeton et la graine « au hasard » viennent de `RoomEnv`, fourni par l'enveloppe.

import {
  DEFAULT_MAP,
  DEFAULT_SEED,
  MAX_ONLINE_PLAYERS,
  ROOM_ERROR_TEXT,
  isMapId,
  isSeed,
  normalizePlayerName,
  type ClientMessage,
  type MapId,
  type RoomErrorCode,
  type RoomPlayer,
  type RoomState,
  type ServerMessage,
} from "@fronts-of-iron/shared";

/** Ce que la salle demande à l'enveloppe. */
export interface RoomEnv {
  /** Un jeton difficile à deviner (jeton d'hôte, jeton de joueur). Deux appels ne donnent jamais la même valeur. */
  newToken(): string;
  /** Une graine tirée au hasard, entier de 0 à 2³² − 1. */
  randomSeed(): number;
}

/** Un message à envoyer à la connexion `to`. */
export interface Outgoing {
  readonly to: string;
  readonly message: ServerMessage;
}

/** Ce que l'enveloppe signale au lobby. */
export interface RoomSummary {
  readonly state: RoomState;
  /** Joueurs dans la salle ; après le lancement, joueurs de la partie (connectés ou non). */
  readonly players: number;
  /** Nom de l'hôte ; vide tant qu'il n'est pas entré. */
  readonly hostName: string;
  readonly map: MapId;
  readonly seed: number;
}

interface Member {
  readonly token: string;
  readonly name: string;
  readonly host: boolean;
  /** Rang de 1 à n. Recalculé à chaque changement avant le lancement, figé ensuite. */
  id: number;
  /** Connexion actuelle ; `null` pour un joueur déconnecté après le lancement. */
  conn: string | null;
}

export class Room {
  /** Jeton de l'hôte, créé avec la salle. Il désigne le joueur 1 ; l'enveloppe le remet au créateur de la partie. */
  readonly hostToken: string;
  readonly #env: RoomEnv;
  /** L'hôte en premier s'il est présent, puis les autres dans l'ordre d'arrivée. */
  readonly #members: Member[] = [];
  readonly #byConn = new Map<string, Member>();
  #state: RoomState = "waiting";
  #map: MapId = DEFAULT_MAP;
  #seed = DEFAULT_SEED;

  /** `hostToken` : un jeton déjà créé (salle reconstruite par l'enveloppe) ; sinon la salle en crée un. */
  constructor(env: RoomEnv, hostToken?: string) {
    this.#env = env;
    this.hostToken = hostToken ?? env.newToken();
  }

  /** Un message reçu de la connexion `conn` (déjà décodé du JSON ; `unknown` : il vient d'un client). */
  handle(conn: string, raw: unknown): Outgoing[] {
    const msg = parseClientMessage(raw);
    if (msg === null) return [error(conn, "invalid_message")];
    if (msg.type === "join") return this.#join(conn, msg);
    const member = this.#byConn.get(conn);
    if (member === undefined) return [error(conn, "not_joined")];
    if (msg.type === "set_map") return this.#setMap(conn, member, msg);
    return this.#start(conn, member);
  }

  /** La connexion `conn` s'est fermée. */
  disconnect(conn: string): Outgoing[] {
    const member = this.#byConn.get(conn);
    if (member === undefined) return [];
    this.#byConn.delete(conn);
    if (this.#state === "started") {
      // Il garde sa place et son jeton : il peut revenir.
      member.conn = null;
      return [];
    }
    // Avant le lancement, sa place est libérée. Le jeton de l'hôte reste valable : l'hôte reprend sa place en revenant.
    this.#members.splice(this.#members.indexOf(member), 1);
    this.#renumber();
    return this.#broadcastRoom();
  }

  summary(): RoomSummary {
    return {
      state: this.#state,
      players: this.#members.length,
      hostName: this.#members.find((m) => m.host)?.name ?? "",
      map: this.#map,
      seed: this.#seed,
    };
  }

  #join(conn: string, msg: Extract<ClientMessage, { type: "join" }>): Outgoing[] {
    if (this.#byConn.has(conn)) return [error(conn, "already_joined")];

    // Un jeton connu : reconnexion (ou deuxième onglet). Le nom envoyé est ignoré.
    const known = msg.token === undefined ? undefined : this.#members.find((m) => m.token === msg.token);
    if (known !== undefined) return this.#rebind(conn, known);

    if (this.#state === "started") return [error(conn, "game_started")];
    const name = normalizePlayerName(msg.name);
    if (name === null) return [error(conn, "invalid_name")];

    // Le jeton d'hôte inconnu des membres : l'hôte entre (ou revient après avoir quitté la salle).
    const asHost = msg.token !== undefined && msg.token === this.hostToken;
    // La place de l'hôte absent est réservée : elle ne compte pas parmi celles des autres.
    const hostAbsent = !this.#members.some((m) => m.host);
    if (!asHost && this.#members.length >= MAX_ONLINE_PLAYERS - (hostAbsent ? 1 : 0)) return [error(conn, "game_full")];

    const member: Member = { token: asHost ? this.hostToken : this.#env.newToken(), name, host: asHost, id: 0, conn };
    if (asHost) this.#members.unshift(member);
    else this.#members.push(member);
    this.#byConn.set(conn, member);
    this.#renumber();
    return [{ to: conn, message: { type: "welcome", token: member.token } }, ...this.#broadcastRoom()];
  }

  /** Rattache le joueur à une nouvelle connexion ; l'ancienne, s'il y en a une, est remplacée. */
  #rebind(conn: string, member: Member): Outgoing[] {
    const out: Outgoing[] = [];
    if (member.conn !== null && member.conn !== conn) {
      this.#byConn.delete(member.conn);
      out.push(error(member.conn, "replaced"));
    }
    member.conn = conn;
    this.#byConn.set(conn, member);
    if (this.#state === "started") out.push(this.#startMessage(member, conn));
    else out.push({ to: conn, message: { type: "welcome", token: member.token } }, ...this.#broadcastRoom());
    return out;
  }

  #setMap(conn: string, member: Member, msg: Extract<ClientMessage, { type: "set_map" }>): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    if (msg.map === undefined && msg.seed === undefined) return [error(conn, "invalid_message")];
    // Tout est vérifié avant d'appliquer quoi que ce soit.
    if (msg.map !== undefined && !isMapId(msg.map)) return [error(conn, "invalid_map")];
    let seed: number | undefined;
    if (msg.seed === "random") seed = this.#env.randomSeed() >>> 0;
    else if (msg.seed !== undefined) {
      if (!isSeed(msg.seed)) return [error(conn, "invalid_seed")];
      seed = msg.seed;
    }
    if (msg.map !== undefined) this.#map = msg.map;
    if (seed !== undefined) this.#seed = seed;
    return this.#broadcastRoom();
  }

  #start(conn: string, member: Member): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    // Les identifiants sont déjà `1..n` sans trou (#renumber) : on les fige en changeant d'état.
    this.#state = "started";
    const out: Outgoing[] = [];
    for (const m of this.#members) if (m.conn !== null) out.push(this.#startMessage(m, m.conn));
    return out;
  }

  #startMessage(member: Member, conn: string): Outgoing {
    return {
      to: conn,
      message: {
        type: "start",
        you: member.id,
        map: this.#map,
        seed: this.#seed,
        players: this.#members.map((m) => ({ id: m.id, name: m.name })),
      },
    };
  }

  #renumber(): void {
    this.#members.forEach((m, i) => (m.id = i + 1));
  }

  /** L'état de la salle à chaque joueur connecté, avec son propre `you`. */
  #broadcastRoom(): Outgoing[] {
    const players: RoomPlayer[] = this.#members.map((m) => ({ id: m.id, name: m.name, host: m.host }));
    const out: Outgoing[] = [];
    for (const m of this.#members) {
      if (m.conn === null) continue;
      out.push({ to: m.conn, message: { type: "room", you: m.id, players, map: this.#map, seed: this.#seed } });
    }
    return out;
  }
}

function error(to: string, code: RoomErrorCode): Outgoing {
  return { to, message: { type: "error", code, message: ROOM_ERROR_TEXT[code] } };
}

/** Vérifie la forme d'un message ; les valeurs (nom, graine, carte) sont vérifiées par la salle, qui répond par un code précis. */
function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "join":
      if (m.token !== undefined && typeof m.token !== "string") return null;
      return { type: "join", name: m.name as string, ...(m.token !== undefined ? { token: m.token as string } : {}) };
    case "set_map":
      return { type: "set_map", map: m.map as MapId | undefined, seed: m.seed as number | "random" | undefined };
    case "start":
      return { type: "start" };
    default:
      return null;
  }
}
