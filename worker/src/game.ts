import { DurableObject } from "cloudflare:workers";
import { Room, type Outgoing, type RoomEnv } from "@fronts-of-iron/relay";
import type { RoomState } from "@fronts-of-iron/shared";
import type { Env } from "./env.ts";

/** Intervalle des signaux au lobby, tant qu'au moins une connexion est ouverte (01-Architecture §2). */
export const SIGNAL_INTERVAL_MS = 30_000;

/** Un message client plus long que ceci est refusé : les messages de la salle font moins de 100 caractères. */
const MAX_MESSAGE_CHARS = 1024;

/** Ce que le Durable Object garde dans son stockage : de quoi retrouver la partie s'il quitte la mémoire. */
interface StoredGame {
  readonly id: string;
  readonly name: string;
  readonly hostToken: string;
}

/** Jetons et graines : 128 bits de `crypto.getRandomValues`, qui ne sont pas dans `packages/relay`. */
const roomEnv: RoomEnv = {
  newToken: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },
  randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
};

/**
 * Une partie hébergée par Cloudflare : un Durable Object par partie, nommé par
 * l'identifiant de la partie. Il accepte les WebSocket de `/api/games/:id/ws`,
 * passe chaque message à la salle (`packages/relay`), envoie les réponses, et
 * signale la partie au lobby par appel interne (pas de secret).
 *
 * Pas de tours en ligne pour l'instant : seulement la salle d'attente et le
 * message de départ. La salle est en mémoire ; seuls l'identifiant, le nom et
 * le jeton d'hôte sont dans le stockage. Une partie dont le Durable Object
 * quitte la mémoire (plus aucune connexion) ou qu'un déploiement redémarre
 * perd sa salle, et les joueurs avec elle (01-Architecture §6).
 */
export class Game extends DurableObject<Env> {
  #stored: StoredGame | null = null;
  #room: Room | null = null;
  readonly #sockets = new Map<string, WebSocket>();
  #timer: ReturnType<typeof setInterval> | undefined;
  /** Vrai quand le lobby a accepté un signal ou une inscription de cette partie. */
  #listed = false;
  #lastState: RoomState | undefined;
  #signalling = false;
  #signalAgain = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredGame>("game");
      if (stored !== undefined) {
        this.#stored = stored;
        this.#room = new Room(roomEnv, stored.hostToken);
      }
    });
  }

  /** Appelé par le Worker (RPC) à la création de la partie. Renvoie le jeton d'hôte. */
  async create(id: string, name: string): Promise<string> {
    if (this.#stored !== null) throw new Error("partie déjà créée");
    const room = new Room(roomEnv);
    const stored: StoredGame = { id, name, hostToken: room.hostToken };
    await this.ctx.storage.put("game", stored);
    this.#stored = stored;
    this.#room = room;
    return room.hostToken;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.#room === null) return new Response("Partie inconnue.", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket attendu.", { status: 426 });

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const conn = crypto.randomUUID();
    this.#sockets.set(conn, server);
    server.addEventListener("message", (event) => this.#onMessage(conn, event.data));
    server.addEventListener("close", () => this.#onClose(conn));
    server.addEventListener("error", () => this.#onClose(conn));
    if (this.#timer === undefined) this.#timer = setInterval(() => void this.#signal(), SIGNAL_INTERVAL_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  #onMessage(conn: string, data: unknown): void {
    const room = this.#room;
    if (room === null) return;
    let parsed: unknown;
    if (typeof data === "string" && data.length <= MAX_MESSAGE_CHARS) {
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = undefined;
      }
    }
    // `undefined` n'est pas un message : la salle répond « invalid_message ».
    this.#dispatch(room.handle(conn, parsed));
    this.#afterChange();
  }

  #onClose(conn: string): void {
    if (!this.#sockets.delete(conn)) return;
    if (this.#room !== null) this.#dispatch(this.#room.disconnect(conn));
    if (this.#sockets.size === 0 && this.#timer !== undefined) {
      // Plus de connexion : plus de signal, le lobby retire la partie après GAME_TTL_MS.
      clearInterval(this.#timer);
      this.#timer = undefined;
      // Sans signal, le lobby peut retirer la partie : à la prochaine connexion elle sera réinscrite.
      this.#listed = false;
      return;
    }
    this.#afterChange();
  }

  #dispatch(out: readonly Outgoing[]): void {
    for (const { to, message } of out) {
      const ws = this.#sockets.get(to);
      if (ws === undefined) continue;
      try {
        ws.send(JSON.stringify(message));
        // La connexion remplacée par une autre du même joueur n'a plus de rôle : on la ferme.
        if (message.type === "error" && message.code === "replaced") {
          this.#sockets.delete(to);
          ws.close(1000, "replaced");
        }
      } catch {
        // Connexion déjà fermée : son événement `close` suit.
      }
    }
  }

  /** Signale tout de suite la première salle avec un hôte et le lancement ; le reste attend le signal régulier. */
  #afterChange(): void {
    const summary = this.#room?.summary();
    if (summary === undefined) return;
    if ((!this.#listed && summary.hostName !== "") || (this.#listed && summary.state !== this.#lastState)) void this.#signal();
  }

  /** Un signal à la fois ; un signal demandé pendant un autre est rejoué ensuite avec l'état courant. */
  async #signal(): Promise<void> {
    if (this.#signalling) {
      this.#signalAgain = true;
      return;
    }
    this.#signalling = true;
    try {
      do {
        this.#signalAgain = false;
        await this.#sendSignal();
      } while (this.#signalAgain);
    } finally {
      this.#signalling = false;
    }
  }

  async #sendSignal(): Promise<void> {
    const room = this.#room;
    const stored = this.#stored;
    if (room === null || stored === null) return;
    const s = room.summary();
    // Une partie sans hôte qui n'a jamais été listée ne l'est pas non plus maintenant.
    if (!this.#listed && s.hostName === "") return;
    try {
      const lobby = this.env.LOBBY.getByName("lobby");
      const update = { players: s.players, state: s.state, hostName: s.hostName, map: s.map, seed: s.seed };
      // « Inconnue » : la partie a expiré (plus de signal pendant GAME_TTL_MS). On la réinscrit sous le même identifiant.
      const known = this.#listed && (await lobby.heartbeat(stored.id, update));
      if (!known) await lobby.registerCloudflare({ id: stored.id, name: stored.name, ...update });
      this.#listed = true;
      this.#lastState = s.state;
    } catch (error) {
      // Le lobby est injoignable : le signal suivant réessaie.
      console.error("signal au lobby échoué", error);
    }
  }
}
