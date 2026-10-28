// Partie en ligne vue du client (`online-game.ts`), sous Node : plusieurs clients branchés sur un vrai relais
// (`packages/relay`) par un transport en mémoire. Ni WebSocket ni navigateur ; le moteur, la copie de la page et
// le relais sont ceux du jeu. Docs/Design/01-Architecture.md §3, 03-Client.md §8.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateTestMap, hashState } from "@fronts-of-iron/engine";
import { Room, type Outgoing } from "@fronts-of-iron/relay";
import { HASH_EVERY_TURNS, ROOM_ERROR_TEXT, type ClientMessage } from "@fronts-of-iron/shared";

import { Mirror } from "../src/mirror.ts";
import { OnlineGame, type Connect, type TransportHandlers } from "../src/online-game.ts";
import type { FromWorker } from "../src/protocol.ts";

const SEED = 12345;

/** Le « réseau » : un relais, et pour chaque client une connexion qui lui parle directement. */
class Net {
  readonly room: Room;
  readonly handlers = new Map<string, TransportHandlers>();
  /** Messages envoyés au relais, par connexion. */
  readonly sent = new Map<string, ClientMessage[]>();

  constructor() {
    let tokens = 0;
    this.room = new Room({ newToken: () => `tok-${++tokens}`, randomSeed: () => 1 });
  }

  connectFor(conn: string): Connect {
    return (_url, handlers) => {
      this.handlers.set(conn, handlers);
      this.sent.set(conn, []);
      // Comme un vrai WebSocket : `open` arrive après le retour de `connect`.
      queueMicrotask(() => handlers.open());
      return {
        send: (text) => {
          const message = JSON.parse(text) as ClientMessage;
          this.sent.get(conn)!.push(message);
          this.deliver(this.room.handle(conn, message));
        },
        // Fermée par le client : le relais le sait, le client n'est pas prévenu (il l'a voulu).
        close: () => {
          if (this.handlers.delete(conn)) this.deliver(this.room.disconnect(conn));
        },
      };
    };
  }

  deliver(out: readonly Outgoing[]): void {
    for (const { to, message } of out) this.handlers.get(to)?.message(JSON.stringify(message));
  }

  /** Un pas du relais : le tour part à tous les clients connectés. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.deliver(this.room.step());
  }

  /** Les hashes envoyés par une connexion. */
  hashes(conn: string): { turn: number; hash: number }[] {
    return this.sent.get(conn)!.flatMap((m) => (m.type === "hash" ? [{ turn: m.turn, hash: m.hash }] : []));
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Client {
  readonly name: string;
  readonly conn: string;
  readonly token: string;
  readonly game: OnlineGame;
  readonly out: FromWorker[];
  /** Le dernier message d'un type. */
  last<T extends FromWorker["type"]>(type: T): Extract<FromWorker, { type: T }>;
  of<T extends FromWorker["type"]>(type: T): Extract<FromWorker, { type: T }>[];
}

function makeClient(net: Net, name: string, conn: string, token: string): Client {
  const out: FromWorker[] = [];
  const game = new OnlineGame({ url: "ws://essai", name, token, connect: net.connectFor(conn), post: (m) => out.push(m) });
  const of = <T extends FromWorker["type"]>(type: T) => out.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
  return {
    name,
    conn,
    token,
    game,
    out,
    of,
    last: (type) => {
      const found = of(type);
      assert.ok(found.length > 0, `aucun message « ${type} » : ${JSON.stringify(out.map((m) => m.type))}`);
      return found[found.length - 1]!;
    },
  };
}

/**
 * Une partie lancée à trois (Marc l'hôte, Léa, Sam), comme sur le site : la salle d'attente passe par des
 * connexions de page, puis chaque joueur se reconnecte avec son jeton (c'est le Web Worker qui le fait).
 */
async function launched(names = ["Marc", "Léa", "Sam"]) {
  const net = new Net();
  const room = net.room;
  const tokens: string[] = [];
  names.forEach((name, i) => {
    const out = room.handle(`page-${i}`, { type: "join", name, ...(i === 0 ? { token: room.hostToken } : {}) });
    const welcome = out.find((o) => o.message.type === "welcome")!.message;
    tokens.push((welcome as { token: string }).token);
  });
  room.handle("page-0", { type: "start" });
  names.forEach((_, i) => room.disconnect(`page-${i}`));
  const clients = names.map((name, i) => makeClient(net, name, `g-${i}`, tokens[i]!));
  for (const c of clients) c.game.start();
  await settle();
  return { net, clients, tokens };
}

/** Une case de terre fertile libre, comme les tests du solo. */
function fertileLand(): number {
  const map = generateTestMap(SEED);
  for (let t = 0; t < map.terrain.length; t++) if (map.fertility[t]! > 0 && t % map.width > 300) return t;
  throw new Error("aucune case fertile");
}

const stateHash = (c: Client): number => hashState(c.game.game!.state);

describe("démarrage", () => {
  it("chaque client crée la partie avec le message de départ : même carte, mêmes joueurs, et son propre joueur", async () => {
    const { clients } = await launched();
    const inits = clients.map((c) => c.last("init"));
    assert.deepEqual(inits.map((i) => i.you), [1, 2, 3]);
    for (const init of inits) {
      assert.deepEqual(init.playerNames, ["Marc", "Léa", "Sam"]);
      assert.equal(init.playerCount, 3);
      assert.equal(init.mapSeed, SEED);
    }
    assert.deepEqual(new Set(clients.map(stateHash)).size, 1, "même état de départ");
    for (const c of clients) assert.deepEqual(c.out.map((m) => m.type), ["init"], "pas encore de tour");
  });

  it("une salle qui ne connaît pas le jeton (partie perdue au déploiement) : retour à l'accueil, « n'existe plus »", async () => {
    const net = new Net();
    const c = makeClient(net, "Marc", "g", "jeton-inconnu");
    c.game.start();
    await settle();
    assert.deepEqual(c.out, [{ type: "ended", reason: "refused", message: "Cette partie n'existe plus." }]);
  });

  it("une partie lancée qui refuse le jeton : le texte du relais est affiché", async () => {
    const { net } = await launched();
    const c = makeClient(net, "Intrus", "g-x", "faux-jeton");
    c.game.start();
    await settle();
    assert.deepEqual(c.out, [{ type: "ended", reason: "refused", message: ROOM_ERROR_TEXT.game_started }]);
  });
});

describe("tours", () => {
  it("tous les clients reçoivent les mêmes tours, calculent le même état et envoient les mêmes hashes", async () => {
    const { net, clients } = await launched();
    const [a, b, c] = clients as [Client, Client, Client];
    // Un ordre de chaque joueur, dont deux dans le même tour : l'ordre d'arrivée au relais fait foi.
    const tile = fertileLand();
    a.game.order(1, { type: "found_city", tile });
    b.game.order(1, { type: "set_farm_share", percent: 40 });
    net.step(3 * HASH_EVERY_TURNS);
    for (const client of clients) {
      assert.equal(client.of("tick").length, 3 * HASH_EVERY_TURNS, client.name);
      assert.deepEqual(client.of("tick").map((t) => t.tick), Array.from({ length: 30 }, (_, i) => i + 1));
      assert.equal(client.of("ended").length, 0);
    }
    assert.equal(new Set(clients.map(stateHash)).size, 1, "même état d'arrivée");
    // La ville de Marc existe chez tous les clients, avec son identifiant de joueur écrit par le relais.
    for (const client of clients) assert.equal(client.game.game!.state.cities.find((x) => x.tile === tile)?.player, 1);
    assert.equal(a.game.game!.state.players[1]!.farmPercent, 40);
    // Un hash tous les N tours, identique chez les trois.
    const expected = [10, 20, 30];
    for (const client of clients) assert.deepEqual(net.hashes(client.conn).map((h) => h.turn), expected);
    assert.deepEqual(net.hashes(a.conn), net.hashes(b.conn));
    assert.deepEqual(net.hashes(a.conn), net.hashes(c.conn));
    assert.equal(net.hashes(a.conn)[2]!.hash, stateHash(a));
  });

  it("le résultat d'un ordre revient à son auteur seul, avec l'identifiant que la page lui avait donné", async () => {
    const { net, clients } = await launched();
    const [a, b] = clients as [Client, Client];
    a.game.order(7, { type: "found_city", tile: fertileLand() });
    a.game.order(8, { type: "set_farm_share", percent: 140 });
    net.step();
    assert.deepEqual(a.last("tick").results.map((r) => [r.id, r.applied]), [[7, true], [8, false]]);
    assert.deepEqual(b.last("tick").results, []);
  });

  it("le message d'un ordre ne porte pas de champ « player » : c'est le relais qui l'écrit", async () => {
    const { net, clients } = await launched();
    clients[1]!.game.order(1, { type: "set_farm_share", percent: 50 });
    const sent = net.sent.get(clients[1]!.conn)!.find((m) => m.type === "order")!;
    assert.deepEqual(sent, { type: "order", order: { type: "set_farm_share", percent: 50 } });
  });

  it("un tour déjà appliqué est ignoré ; un tour manquant arrête la partie", async () => {
    const { net, clients } = await launched();
    const a = clients[0]!;
    net.step(2);
    net.handlers.get(a.conn)!.message(JSON.stringify({ type: "turn", turn: 2, orders: [] }));
    assert.equal(a.of("tick").length, 2);
    net.handlers.get(a.conn)!.message(JSON.stringify({ type: "turn", turn: 5, orders: [] }));
    const ended = a.last("ended");
    assert.equal(ended.reason, "error");
    assert.match(ended.message, /tour 5 reçu, tour 3 attendu/);
  });
});

describe("reprise : rejouer tous les tours", () => {
  it("la partie est rejouée depuis le début, la page reçoit un seul tick, et l'état est celui des autres", async () => {
    const { net, clients, tokens } = await launched();
    const [a, b] = clients as [Client, Client];
    a.game.order(1, { type: "found_city", tile: fertileLand() });
    net.step(25);
    // Marc recharge sa page : son Web Worker disparaît, un autre se connecte avec le même jeton.
    a.game.stop();
    const a2 = makeClient(net, "Marc", "g-0b", tokens[0]!);
    a2.game.start();
    await settle();
    assert.deepEqual(a2.out.map((m) => m.type), ["init", "tick"], "ni redessin de chaque tour, ni 25 messages");
    const tick = a2.last("tick");
    assert.equal(tick.tick, 25);
    assert.equal(a2.last("init").you, 1);
    assert.equal(hashState(a2.game.game!.state), stateHash(b));
    // Le rejeu n'envoie qu'un hash : celui du dernier multiple de N.
    assert.deepEqual(net.hashes("g-0b").map((h) => h.turn), [20]);
    assert.equal(net.hashes("g-0b")[0]!.hash, net.hashes(b.conn)[1]!.hash);
    assert.equal(a2.of("ended").length, 0);
    // La copie de la page est celle d'un client qui a tout reçu en direct.
    const live = new Mirror(b.last("init"));
    for (const t of b.of("tick")) live.applyTick(t);
    const replayed = new Mirror(a2.last("init"));
    replayed.applyTick(tick);
    assert.deepEqual(replayed.tileCity, live.tileCity);
    assert.deepEqual(replayed.cities, live.cities);
    assert.deepEqual(replayed.stats, live.stats);
    assert.ok(tick.tiles.length > 0 && tick.cities !== null && tick.roads !== null);
    assert.deepEqual(tick.results, [], "les ordres du passé n'ont pas de résultat");
    // Puis les tours suivants arrivent en direct, comme pour les autres.
    net.step(5);
    assert.equal(a2.of("tick").length, 6);
    assert.equal(hashState(a2.game.game!.state), stateHash(b));
  });

  it("un rejeu qui s'arrête exactement sur un multiple de N envoie son hash", async () => {
    const { net, clients, tokens } = await launched();
    net.step(HASH_EVERY_TURNS);
    clients[2]!.game.stop();
    const again = makeClient(net, "Sam", "g-2b", tokens[2]!);
    again.game.start();
    await settle();
    assert.deepEqual(net.hashes("g-2b"), [{ turn: HASH_EVERY_TURNS, hash: stateHash(again) }]);
    assert.equal(net.hashes("g-2b")[0]!.hash, net.hashes(clients[0]!.conn)[0]!.hash);
  });
});

describe("désynchronisation", () => {
  it("le client dont l'état a divergé est renvoyé à l'accueil, les autres continuent", async () => {
    const { net, clients } = await launched();
    const [a, b, c] = clients as [Client, Client, Client];
    // Sam applique un état qui n'est plus celui des autres (ce qu'un appel non déterministe ferait).
    c.game.game!.state.players[0]!.population += 1;
    net.step(HASH_EVERY_TURNS - 1);
    assert.equal(c.of("ended").length, 0, "pas détecté avant le premier hash");
    net.step();
    const ended = c.last("ended");
    assert.equal(ended.reason, "desync");
    assert.match(ended.message, /tour 10/);
    assert.equal(net.handlers.has(c.conn), false, "sa connexion est fermée");
    net.step(5);
    for (const ok of [a, b]) {
      assert.equal(ok.of("ended").length, 0);
      assert.equal(ok.of("tick").length, HASH_EVERY_TURNS + 5);
    }
    assert.equal(c.of("tick").length, HASH_EVERY_TURNS, "plus de tour après la désynchronisation");
    // Il n'est pas retiré de la partie : avec son jeton il peut la rejouer depuis le début (« Reprendre »).
    assert.equal(net.room.summary().players, 3);
  });
});

describe("pause", () => {
  it("l'hôte met en pause : tous le savent et plus aucun tour n'arrive ; la reprise relance les tours", async () => {
    const { net, clients } = await launched();
    const [a, b] = clients as [Client, Client];
    net.step(2);
    a.game.setPaused(true);
    for (const client of clients) assert.deepEqual(client.last("paused"), { type: "paused", paused: true });
    net.step(3);
    for (const client of clients) assert.equal(client.of("tick").length, 2);
    a.game.setPaused(false);
    for (const client of clients) assert.deepEqual(client.last("paused"), { type: "paused", paused: false });
    net.step();
    assert.equal(b.of("tick").length, 3);
  });

  it("un autre joueur que l'hôte ne peut pas mettre en pause : le texte du relais est affiché, rien ne change", async () => {
    const { net, clients } = await launched();
    const [a, b] = clients as [Client, Client];
    b.game.setPaused(true);
    assert.deepEqual(b.last("notice"), { type: "notice", text: ROOM_ERROR_TEXT.not_host });
    assert.equal(a.of("paused").length, 0);
    net.step();
    assert.equal(a.of("tick").length, 1);
  });
});

describe("connexion", () => {
  it("une connexion fermée par le serveur : « perdue », la page garde la partie affichée", async () => {
    const { net, clients } = await launched();
    net.handlers.get(clients[0]!.conn)!.close();
    assert.deepEqual(clients[0]!.last("ended"), { type: "ended", reason: "lost", message: "Connexion perdue. Rechargez la page pour reprendre la partie." });
  });

  it("deux onglets avec le même jeton : le premier est remplacé et le dit", async () => {
    const { net, clients, tokens } = await launched();
    const twin = makeClient(net, "Marc", "g-0b", tokens[0]!);
    twin.game.start();
    await settle();
    assert.deepEqual(clients[0]!.last("ended"), { type: "ended", reason: "refused", message: ROOM_ERROR_TEXT.replaced });
  });

  it("après stop(), plus aucun message n'est envoyé ni reçu", async () => {
    const { net, clients } = await launched();
    const a = clients[0]!;
    a.game.stop();
    a.game.order(1, { type: "set_farm_share", percent: 10 });
    a.game.setPaused(true);
    net.step();
    assert.equal(a.of("tick").length, 0);
    assert.equal(net.sent.get(a.conn)!.filter((m) => m.type === "order" || m.type === "pause").length, 0);
  });
});

describe("indépendance de la plateforme", () => {
  it("online-game.ts n'utilise ni WebSocket, ni self, ni DOM : le transport est fourni", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const code = readFileSync(join(import.meta.dirname, "../src/online-game.ts"), "utf8").replace(/\/\/.*$/gm, "");
    for (const forbidden of [/new WebSocket/, /\bself\b/, /document\./, /window\./, /Math\.random/, /Date\.now/]) {
      assert.doesNotMatch(code, forbidden, String(forbidden));
    }
  });
});
