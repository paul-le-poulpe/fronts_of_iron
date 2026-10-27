// Le Worker (routes du lobby, table des parties, Durable Object d'une partie Cloudflare) sous Node, sans
// `wrangler dev` : le module `cloudflare:workers` est remplacé par une classe vide, SQLite par `node:sqlite`,
// les WebSocket par des paires qui se renvoient les messages, la minuterie et l'heure par celles de `node:test`.
// Les vrais Durable Objects ne sont pas exécutés ici (Docs/Design/01-Architecture.md §4, essai en local).

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

// ---- remplaçants des API de Cloudflare ----

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      const stub = "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Json = Record<string, any>;

/** Une extrémité d'un WebSocket de test : ce qu'elle envoie arrive à l'autre, tout de suite. */
class FakeSocket {
  peer!: FakeSocket;
  closed = false;
  readonly #listeners = new Map<string, ((event: any) => void)[]>();
  accept(): void {}
  addEventListener(type: string, listener: (event: any) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    if (this.closed) throw new Error("WebSocket fermé");
    this.peer.#emit("message", { data });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.closed = true;
    this.peer.#emit("close", {});
  }
  #emit(type: string, event: any): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

(globalThis as any).WebSocketPair = class {
  0: FakeSocket;
  1: FakeSocket;
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
    this[0].peer = this[1];
    this[1].peer = this[0];
  }
};

// `Response` de Node refuse le statut 101 et ne connaît pas `webSocket`.
const NativeResponse = globalThis.Response;
(globalThis as any).Response = class extends NativeResponse {
  override webSocket: any = null;
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: FakeSocket }) {
    if (init?.status === 101) {
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, "status", { value: 101 });
      this.webSocket = init.webSocket;
    } else {
      super(body, init);
    }
  }
};

// Comparaison de secrets propre à Cloudflare.
Object.defineProperty(crypto.subtle, "timingSafeEqual", {
  configurable: true,
  value: (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]),
});

const { default: worker, Game, Lobby } = await import("../src/index.ts");

// ---- Durable Objects de test ----

/** `ctx.storage.sql` d'un Durable Object SQLite, sur `node:sqlite`. */
function sqlOf(db: DatabaseSync) {
  return {
    exec(query: string, ...params: any[]) {
      const statement = db.prepare(query);
      if (/^\s*(SELECT|PRAGMA)/i.test(query)) {
        const rows = statement.all(...params);
        return { toArray: () => rows, rowsWritten: 0 };
      }
      const result = statement.run(...params);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  };
}

interface TestEnv {
  LOBBY_SECRET: string;
  LOBBY: { getByName(name: string): any };
  GAME: { getByName(name: string): any };
  db: DatabaseSync;
  /** Stockage (`ctx.storage`) de chaque partie, par identifiant : survit à un « redémarrage » du Durable Object. */
  storages: Map<string, Map<string, unknown>>;
  /** Redémarre le Durable Object d'une partie : instance neuve, même stockage. */
  evict(id: string): void;
}

function makeEnv(db = new DatabaseSync(":memory:")): TestEnv {
  const games = new Map<string, any>();
  const storages = new Map<string, Map<string, unknown>>();
  const env: TestEnv = {
    LOBBY_SECRET: "s3cret",
    db,
    storages,
    LOBBY: { getByName: () => lobby },
    GAME: {
      getByName(id: string) {
        let stub = games.get(id);
        if (stub === undefined) {
          const storage = storages.get(id) ?? new Map<string, unknown>();
          storages.set(id, storage);
          let ready: Promise<void> = Promise.resolve();
          const ctx = {
            storage: { get: async (key: string) => storage.get(key), put: async (key: string, value: unknown) => void storage.set(key, value) },
            blockConcurrencyWhile: (fn: () => Promise<void>) => (ready = fn()),
          };
          const game = new Game(ctx as any, env as any);
          // Un vrai Durable Object ne reçoit rien avant la fin de son constructeur asynchrone.
          stub = {
            create: async (...args: any[]) => (await ready, (game as any).create(...args)),
            fetch: async (request: Request) => (await ready, game.fetch(request)),
          };
          games.set(id, stub);
        }
        return stub;
      },
    },
    evict: (id) => void games.delete(id),
  };
  const lobby = new Lobby({ storage: { sql: sqlOf(db) } } as any, env as any);
  return env;
}

// ---- requêtes ----

const BASE = "http://localhost";
const AUTH = { Authorization: "Bearer s3cret" };

async function call(env: TestEnv, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const response = await worker.fetch(new Request(BASE + path, init), env as any);
  const text = await response.text();
  let json: Json | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // pas du JSON
  }
  return { status: response.status, json, text };
}

const list = async (env: TestEnv): Promise<Json[]> => (await call(env, "GET", "/api/games")).json!.games;

/** Laisse les signaux asynchrones du Durable Object se terminer. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Le côté client d'un WebSocket de partie. */
class Client {
  readonly messages: Json[] = [];
  readonly socket: FakeSocket;
  constructor(socket: FakeSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.messages.push(JSON.parse(event.data)));
  }
  send(message: unknown): void {
    this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
  }
  /** Les messages d'un type reçus jusqu'ici. */
  of(type: string): Json[] {
    return this.messages.filter((m) => m.type === type);
  }
  last(type: string): Json {
    const found = this.of(type);
    assert.ok(found.length > 0, `aucun message « ${type} » : ${JSON.stringify(this.messages)}`);
    return found[found.length - 1]!;
  }
}

async function connect(env: TestEnv, id: string): Promise<Client> {
  const response = await worker.fetch(new Request(`${BASE}/api/games/${id}/ws`, { headers: { Upgrade: "websocket" } }), env as any);
  assert.equal(response.status, 101, "WebSocket accepté");
  return new Client((response as any).webSocket);
}

async function createCloudflareGame(env: TestEnv, name = "Soirée du jeudi") {
  const created = await call(env, "POST", "/api/games/cloudflare", { name });
  assert.equal(created.status, 201);
  return created.json as { id: string; hostToken: string };
}

// ---- tests ----

describe("lobby : parties d'hôte (requêtes d'avant la salle d'attente)", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  it("une inscription et un signal à l'ancien format restent valides ; l'entrée a des valeurs par défaut", async () => {
    const env = makeEnv();
    const posted = await call(env, "POST", "/api/games", { name: "Essai", address: "https://a.trycloudflare.com", players: 1, maxPlayers: 8 }, AUTH);
    assert.equal(posted.status, 201);
    const id = posted.json!.id as string;
    assert.deepEqual(await list(env), [
      { id, name: "Essai", hostName: "", mode: "host", address: "https://a.trycloudflare.com", map: "test", seed: null, players: 1, maxPlayers: 8, state: "waiting" },
    ]);
    const beat = await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 3 }, AUTH);
    assert.equal(beat.status, 200);
    assert.equal((await list(env))[0]!.players, 3);
  });

  it("le signal accepte un état, un hôte, une carte et une graine", async () => {
    const env = makeEnv();
    const { json } = await call(env, "POST", "/api/games", { name: "Essai", address: "https://a.trycloudflare.com", players: 1, maxPlayers: 8, hostName: "Léa" }, AUTH);
    const id = json!.id as string;
    assert.equal((await list(env))[0]!.hostName, "Léa");
    const beat = await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 2, state: "started", map: "test", seed: 4242 }, AUTH);
    assert.equal(beat.status, 200);
    const [entry] = await list(env);
    assert.equal(entry!.state, "started");
    assert.equal(entry!.seed, 4242);
    assert.equal(entry!.hostName, "Léa");
  });

  it("refuse un secret absent ou faux, un état ou une graine invalides, une partie inconnue", async () => {
    const env = makeEnv();
    const { json } = await call(env, "POST", "/api/games", { name: "Essai", address: "https://a.trycloudflare.com", players: 1, maxPlayers: 8 }, AUTH);
    const id = json!.id as string;
    assert.equal((await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 1 })).status, 401);
    assert.equal((await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 1 }, { Authorization: "Bearer faux" })).status, 401);
    assert.equal((await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 1, state: "fini" }, AUTH)).status, 400);
    assert.equal((await call(env, "POST", `/api/games/${id}/heartbeat`, { players: 1, seed: -1 }, AUTH)).status, 400);
    assert.equal((await call(env, "POST", `/api/games/${id}/heartbeat`, { players: "x" }, AUTH)).status, 400);
    assert.equal((await call(env, "POST", "/api/games/inconnue/heartbeat", { players: 1 }, AUTH)).status, 404);
    assert.equal((await call(env, "POST", "/api/games", { name: "", address: "https://a.b", players: 1, maxPlayers: 8 }, AUTH)).status, 400);
    assert.equal((await call(env, "POST", "/api/games", { name: "x", address: "http://a.b", players: 1, maxPlayers: 8 }, AUTH)).status, 400);
  });

  it("une partie sans signal depuis plus de 90 s n'est plus listée", async () => {
    const env = makeEnv();
    await call(env, "POST", "/api/games", { name: "Essai", address: "https://a.trycloudflare.com", players: 1, maxPlayers: 8 }, AUTH);
    assert.equal((await list(env)).length, 1);
    mock.timers.tick(89_000);
    assert.equal((await list(env)).length, 1);
    mock.timers.tick(2_000);
    assert.deepEqual(await list(env), []);
  });
});

describe("lobby : table créée par une version précédente", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  it("les colonnes manquantes sont ajoutées, les lignes existantes gardées avec des valeurs par défaut", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE games (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
      players INTEGER NOT NULL, max_players INTEGER NOT NULL, last_seen INTEGER NOT NULL)`);
    db.prepare("INSERT INTO games VALUES (?, ?, ?, ?, ?, ?)").run("vieux", "Vieille partie", "https://a.trycloudflare.com", 2, 8, Date.now());
    const env = makeEnv(db);
    assert.deepEqual(await list(env), [
      { id: "vieux", name: "Vieille partie", hostName: "", mode: "host", address: "https://a.trycloudflare.com", map: "test", seed: null, players: 2, maxPlayers: 8, state: "waiting" },
    ]);
    const beat = await call(env, "POST", "/api/games/vieux/heartbeat", { players: 4, state: "started" }, AUTH);
    assert.equal(beat.status, 200);
    assert.equal((await list(env))[0]!.state, "started");
    // Une deuxième instance sur la même base (le Durable Object est reparti) ne casse rien.
    assert.equal((await list(makeEnv(db))).length, 1);
  });
});

describe("création d'une partie Cloudflare", () => {
  it("sans secret : renvoie l'identifiant et le jeton d'hôte", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.match(hostToken, /^[0-9a-f]{32}$/);
    // Pas listée tant que l'hôte n'est pas entré dans la salle.
    assert.deepEqual(await list(env), []);
  });

  it("valide le nom : 1 à 40 caractères après trim", async () => {
    const env = makeEnv();
    for (const bad of [{ name: "" }, { name: "   " }, { name: "x".repeat(41) }, { name: 5 }, {}, "pas du json", "[]"]) {
      assert.equal((await call(env, "POST", "/api/games/cloudflare", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call(env, "POST", "/api/games/cloudflare", { name: "x".repeat(40) })).status, 201);
    assert.equal((await call(env, "GET", "/api/games/cloudflare")).status, 405);
  });
});

describe("partie Cloudflare : WebSocket", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  it("sans en-tête Upgrade : 426 ; partie jamais créée : 404 ; autre méthode : 405", async () => {
    const env = makeEnv();
    const { id } = await createCloudflareGame(env);
    assert.equal((await call(env, "GET", `/api/games/${id}/ws`)).status, 426);
    const unknown = await worker.fetch(new Request(`${BASE}/api/games/jamais-creee/ws`, { headers: { Upgrade: "websocket" } }), env as any);
    assert.equal(unknown.status, 404);
    assert.equal((await call(env, "POST", `/api/games/${id}/ws`, {})).status, 405);
  });

  it("l'hôte entre : la partie est listée tout de suite, avec son nom, la carte et la graine", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    const host = await connect(env, id);
    host.send({ type: "join", name: "Marc", token: hostToken });
    await settle();
    assert.equal(host.last("welcome").token, hostToken);
    assert.deepEqual(host.last("room"), { type: "room", you: 1, players: [{ id: 1, name: "Marc", host: true }], map: "test", seed: 12345 });
    assert.deepEqual(await list(env), [
      { id, name: "Soirée du jeudi", hostName: "Marc", mode: "cloudflare", address: `/api/games/${id}/ws`, map: "test", seed: 12345, players: 1, maxPlayers: 100, state: "waiting" },
    ]);
  });

  it("déroulement : arrivées, réglages de l'hôte, signal toutes les 30 s, lancement, message de départ", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    const host = await connect(env, id);
    host.send({ type: "join", name: "Marc", token: hostToken });
    const lea = await connect(env, id);
    lea.send({ type: "join", name: "Léa" });
    const sam = await connect(env, id);
    sam.send({ type: "join", name: "Sam" });
    await settle();
    for (const [client, you] of [[host, 1], [lea, 2], [sam, 3]] as const) {
      assert.equal(client.last("room").you, you);
      assert.deepEqual(client.last("room").players.map((p: Json) => p.name), ["Marc", "Léa", "Sam"]);
    }
    // Les réglages de l'hôte arrivent à tous ; ceux d'un autre joueur sont refusés.
    lea.send({ type: "set_map", seed: 5 });
    assert.equal(lea.last("error").code, "not_host");
    host.send({ type: "set_map", seed: 777 });
    assert.equal(sam.last("room").seed, 777);
    host.send({ type: "set_map", seed: "random" });
    assert.ok(Number.isInteger(sam.last("room").seed) && sam.last("room").seed >= 0 && sam.last("room").seed <= 4294967295);
    host.send({ type: "set_map", seed: 777 });
    // Le signal régulier apporte au lobby le nombre de joueurs et la graine.
    mock.timers.tick(30_000);
    await settle();
    assert.deepEqual(
      (await list(env)).map((g) => [g.players, g.seed, g.state]),
      [[3, 777, "waiting"]],
    );
    // Un joueur part : sa place est libérée et les identifiants renumérotés.
    lea.socket.close();
    assert.deepEqual(sam.last("room").players.map((p: Json) => [p.id, p.name]), [[1, "Marc"], [2, "Sam"]]);
    assert.equal(sam.last("room").you, 2);
    // Lancement : message de départ à chacun, état « started » listé tout de suite.
    host.send({ type: "start" });
    await settle();
    const players = [{ id: 1, name: "Marc" }, { id: 2, name: "Sam" }];
    assert.deepEqual(host.last("start"), { type: "start", you: 1, map: "test", seed: 777, players });
    assert.deepEqual(sam.last("start"), { type: "start", you: 2, map: "test", seed: 777, players });
    assert.equal((await list(env))[0]!.state, "started");
    // Plus d'arrivée.
    const late = await connect(env, id);
    late.send({ type: "join", name: "Tardif" });
    assert.equal(late.last("error").code, "game_started");
    late.socket.close();
    // Reconnexion de Sam avec son jeton : même identifiant, message de départ renvoyé.
    const samToken = sam.last("welcome").token;
    sam.socket.close();
    const back = await connect(env, id);
    back.send({ type: "join", name: "", token: samToken });
    assert.deepEqual(back.last("start"), { type: "start", you: 2, map: "test", seed: 777, players });
  });

  it("plus de connexion : plus de signal, la partie expire ; à la reconnexion elle est réinscrite", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    const host = await connect(env, id);
    host.send({ type: "join", name: "Marc", token: hostToken });
    await settle();
    assert.equal((await list(env)).length, 1);
    host.socket.close();
    mock.timers.tick(91_000);
    await settle();
    assert.deepEqual(await list(env), [], "plus de signal depuis plus de 90 s");
    const again = await connect(env, id);
    again.send({ type: "join", name: "Marc", token: hostToken });
    await settle();
    assert.equal((await list(env)).length, 1, "réinscrite dès que l'hôte revient");
    assert.equal((await list(env))[0]!.id, id);
  });

  it("le signal régulier réinscrit une partie que le lobby a oubliée", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    const host = await connect(env, id);
    host.send({ type: "join", name: "Marc", token: hostToken });
    await settle();
    env.db.exec("DELETE FROM games");
    assert.deepEqual(await list(env), []);
    mock.timers.tick(30_000);
    await settle();
    assert.equal((await list(env)).length, 1);
  });

  it("le Durable Object redémarré garde le jeton d'hôte ; la salle est vide", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    env.evict(id);
    const host = await connect(env, id);
    host.send({ type: "join", name: "Marc", token: hostToken });
    assert.equal(host.last("room").players[0].host, true);
  });

  it("le même jeton sur une deuxième connexion remplace la première, qui est fermée", async () => {
    const env = makeEnv();
    const { id, hostToken } = await createCloudflareGame(env);
    const first = await connect(env, id);
    first.send({ type: "join", name: "Marc", token: hostToken });
    const second = await connect(env, id);
    second.send({ type: "join", name: "Marc", token: hostToken });
    assert.equal(first.last("error").code, "replaced");
    assert.equal(first.socket.closed, true);
    assert.equal(second.last("room").you, 1);
  });

  it("refuse un message qui n'est pas du JSON, ou trop long", async () => {
    const env = makeEnv();
    const { id } = await createCloudflareGame(env);
    const client = await connect(env, id);
    client.send("pas du json");
    assert.equal(client.last("error").code, "invalid_message");
    client.send(JSON.stringify({ type: "join", name: "x".repeat(5000) }));
    assert.equal(client.messages.filter((m) => m.type === "error").length, 2);
    assert.equal(client.last("error").code, "invalid_message");
  });
});
