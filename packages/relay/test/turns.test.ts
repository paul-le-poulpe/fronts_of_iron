// La partie lancée : tours, ordres, hashes, pause (Docs/Design/01-Architecture.md §3). Une règle par test, sous Node, sans réseau.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HASH_EVERY_TURNS, MAX_ORDERS_PER_TURN, type ServerMessage } from "@fronts-of-iron/shared";

import { Room, type Outgoing, type RoomEnv } from "../src/index.ts";

function makeEnv(): RoomEnv {
  let tokens = 0;
  return { newToken: () => `tok-${++tokens}`, randomSeed: () => 1 };
}

function to(out: Outgoing[], conn: string): ServerMessage[] {
  return out.filter((o) => o.to === conn).map((o) => o.message);
}

function errorOf(out: Outgoing[], conn: string): string | undefined {
  const m = to(out, conn).find((x) => x.type === "error");
  return m?.type === "error" ? m.code : undefined;
}

function tokenOf(out: Outgoing[], conn: string): string {
  const m = to(out, conn)[0]!;
  assert.equal(m.type, "welcome");
  return (m as { token: string }).token;
}

/** Une partie lancée : Marc (hôte, connexion « h », joueur 1), Léa (« a », 2) et Sam (« b », 3). */
function launched() {
  const room = new Room(makeEnv());
  room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
  const lea = room.handle("a", { type: "join", name: "Léa" });
  const sam = room.handle("b", { type: "join", name: "Sam" });
  room.handle("h", { type: "start" });
  return { room, leaToken: tokenOf(lea, "a"), samToken: tokenOf(sam, "b") };
}

const order = (type: string, extra: Record<string, unknown> = {}) => ({ type: "order", order: { type, ...extra } });

/** Crée `n` tours sans ordre et renvoie le dernier. */
function steps(room: Room, n: number): Outgoing[] {
  let out: Outgoing[] = [];
  for (let i = 0; i < n; i++) out = room.step();
  return out;
}

describe("tours", () => {
  it("aucun tour avant le lancement", () => {
    const room = new Room(makeEnv());
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.deepEqual(room.step(), []);
    assert.equal(room.turnCount, 0);
  });

  it("un tour numéroté à partir de 1, sans trou, envoyé à chaque joueur connecté", () => {
    const { room } = launched();
    const first = room.step();
    const second = room.step();
    for (const conn of ["h", "a", "b"]) {
      assert.deepEqual(to(first, conn), [{ type: "turn", turn: 1, orders: [] }]);
      assert.deepEqual(to(second, conn), [{ type: "turn", turn: 2, orders: [] }]);
    }
    assert.equal(first.length, 3);
    assert.equal(room.turnCount, 2);
  });

  it("le même objet message part à tous les destinataires (une seule sérialisation possible)", () => {
    const { room } = launched();
    const out = room.step();
    assert.equal(out[0]!.message, out[1]!.message);
    assert.equal(out[1]!.message, out[2]!.message);
  });

  it("les ordres entrent dans le tour dans l'ordre d'arrivée", () => {
    const { room } = launched();
    room.handle("b", order("c", { n: 1 }));
    room.handle("h", order("a", { n: 2 }));
    room.handle("b", order("b", { n: 3 }));
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders.map((o) => [o.type, o.player, o.n]), [["c", 3, 1], ["a", 1, 2], ["b", 3, 3]]);
  });

  it("le champ « player » vient de la connexion : celui du client est écrasé", () => {
    const { room } = launched();
    room.handle("a", order("found_city", { tile: 5, player: 1 }));
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders, [{ type: "found_city", tile: 5, player: 2 }]);
  });

  it("le relais ne lit pas le contenu d'un ordre : il le transmet tel quel", () => {
    const { room } = launched();
    const body = { type: "ordre_inconnu", nested: { liste: [1, "deux", null] }, tile: -3 };
    room.handle("a", { type: "order", order: body });
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders, [{ ...body, player: 2 }]);
  });

  it("la file est vidée à chaque tour : un ordre n'entre que dans un tour", () => {
    const { room } = launched();
    room.handle("a", order("x"));
    room.step();
    const next = to(room.step(), "h")[0]!;
    assert.deepEqual(next.type === "turn" && next.orders, []);
  });

  it("un ordre sans type chaîne, ou qui n'est pas un objet, est refusé", () => {
    const { room } = launched();
    for (const bad of [{ type: "order" }, { type: "order", order: null }, { type: "order", order: [] }, { type: "order", order: "found_city" }, { type: "order", order: { type: 3 } }, { type: "order", order: {} }]) {
      assert.equal(errorOf(room.handle("a", bad), "a"), "invalid_message", JSON.stringify(bad));
    }
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders, []);
  });

  it("un ordre avant le lancement, ou d'une connexion qui n'est pas dans la salle, est refusé", () => {
    const room = new Room(makeEnv());
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.equal(errorOf(room.handle("h", order("x")), "h"), "not_started");
    assert.equal(errorOf(room.handle("inconnue", order("x")), "inconnue"), "not_joined");
  });

  it(`au plus ${MAX_ORDERS_PER_TURN} ordres par joueur et par tour, la borne revient au tour suivant`, () => {
    const { room } = launched();
    for (let i = 0; i < MAX_ORDERS_PER_TURN; i++) assert.equal(errorOf(room.handle("a", order("x", { i })), "a"), undefined);
    assert.equal(errorOf(room.handle("a", order("x")), "a"), "too_many_orders");
    // Les autres joueurs ne sont pas touchés.
    assert.equal(errorOf(room.handle("b", order("x")), "b"), undefined);
    const turn = to(room.step(), "h")[0]!;
    assert.equal(turn.type === "turn" && turn.orders.length, MAX_ORDERS_PER_TURN + 1);
    assert.equal(errorOf(room.handle("a", order("x")), "a"), undefined);
  });
});

describe("ordres au nom d'un joueur (bots du solo)", () => {
  it("submit ajoute l'ordre au nom du joueur donné, dans l'ordre d'arrivée avec ceux des connexions", () => {
    const { room } = launched();
    room.handle("h", order("humain"));
    assert.equal(room.submit(7, { type: "bot", player: 1 }), true);
    room.handle("a", order("autre"));
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders.map((o) => [o.type, o.player]), [["humain", 1], ["bot", 7], ["autre", 2]]);
  });

  it("submit est refusé avant le lancement, pour un identifiant invalide, et au-delà de la borne", () => {
    const room = new Room(makeEnv());
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.equal(room.submit(2, { type: "x" }), false, "avant le lancement");
    room.handle("h", { type: "start" });
    assert.equal(room.submit(0, { type: "x" }), false);
    assert.equal(room.submit(1.5, { type: "x" }), false);
    for (let i = 0; i < MAX_ORDERS_PER_TURN; i++) assert.equal(room.submit(2, { type: "x" }), true);
    assert.equal(room.submit(2, { type: "x" }), false);
  });
});

describe("reconnexion après le lancement", () => {
  it("le message de départ, puis tous les tours depuis le premier, en un seul message", () => {
    const { room, samToken } = launched();
    room.handle("b", order("x"));
    steps(room, 3);
    room.disconnect("b");
    steps(room, 2);
    const out = room.handle("b2", { type: "join", name: "", token: samToken });
    const messages = to(out, "b2");
    assert.equal(messages[0]!.type, "start");
    const turns = messages[1]!;
    assert.equal(turns.type, "turns");
    assert.deepEqual(turns.type === "turns" && turns.turns.map((t) => t.turn), [1, 2, 3, 4, 5]);
    assert.deepEqual(turns.type === "turns" && turns.turns[0]!.orders, [{ type: "x", player: 3 }]);
    assert.equal(messages.length, 2);
  });

  it("sans tour créé, seul le message de départ est renvoyé", () => {
    const { room, samToken } = launched();
    room.disconnect("b");
    const out = room.handle("b2", { type: "join", name: "", token: samToken });
    assert.deepEqual(to(out, "b2").map((m) => m.type), ["start"]);
  });

  it("un joueur déconnecté ne reçoit pas le tour, mais les ordres qu'il avait envoyés restent dans le tour", () => {
    const { room } = launched();
    room.handle("b", order("x"));
    room.disconnect("b");
    const out = room.step();
    assert.deepEqual(to(out, "b"), []);
    assert.equal(out.length, 2);
    const turn = to(out, "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders, [{ type: "x", player: 3 }]);
  });

  it("la reconnexion pendant une pause renvoie aussi l'état de la pause", () => {
    const { room, samToken } = launched();
    room.handle("h", { type: "pause", paused: true });
    room.disconnect("b");
    const out = room.handle("b2", { type: "join", name: "", token: samToken });
    assert.deepEqual(to(out, "b2"), [
      { type: "start", you: 3, map: "test", seed: 12345, players: [{ id: 1, name: "Marc" }, { id: 2, name: "Léa" }, { id: 3, name: "Sam" }] },
      { type: "paused", paused: true },
    ]);
  });

  it("l'hôte est le joueur 1 au lancement, même arrivé en dernier dans la salle", () => {
    const room = new Room(makeEnv());
    room.handle("a", { type: "join", name: "Léa" });
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    const start = to(room.handle("h", { type: "start" }), "h")[0]!;
    assert.equal(start.type === "start" && start.you, 1);
  });
});

describe("hashes", () => {
  const T = HASH_EVERY_TURNS;
  const hash = (turn: number, value: number) => ({ type: "hash", turn, hash: value });

  it("trois joueurs, un seul diverge : lui seul reçoit « desync », avec le numéro du tour", () => {
    const { room } = launched();
    steps(room, T);
    assert.deepEqual(room.handle("h", hash(T, 111)), []);
    assert.deepEqual(room.handle("a", hash(T, 111)), []);
    const out = room.handle("b", hash(T, 222));
    assert.deepEqual(out, [{ to: "b", message: { type: "desync", turn: T } }]);
  });

  it("le hash majoritaire gagne même s'il arrive en dernier : le premier arrivé est alors averti", () => {
    const { room } = launched();
    steps(room, T);
    room.handle("h", hash(T, 1));
    assert.deepEqual(room.handle("a", hash(T, 2)), [{ to: "a", message: { type: "desync", turn: T } }]);
    // Le troisième donne la majorité à 2 : le premier devient le divergent.
    assert.deepEqual(room.handle("b", hash(T, 2)), [{ to: "h", message: { type: "desync", turn: T } }]);
  });

  it("à égalité, le premier hash arrivé est le hash de référence", () => {
    const { room } = launched();
    steps(room, T);
    assert.deepEqual(room.handle("h", hash(T, 5)), []);
    assert.deepEqual(room.handle("a", hash(T, 6)), [{ to: "a", message: { type: "desync", turn: T } }]);
  });

  it("un joueur n'est averti qu'une fois par tour", () => {
    const { room } = launched();
    steps(room, T);
    room.handle("h", hash(T, 1));
    room.handle("a", hash(T, 1));
    assert.equal(room.handle("b", hash(T, 9)).length, 1);
    // Un autre hash arrivé ensuite ne le prévient pas de nouveau.
    assert.deepEqual(room.handle("h", hash(T, 1)), []);
  });

  it("des hashes identiques ne produisent aucun message, à chaque multiple de N", () => {
    const { room } = launched();
    for (let k = 1; k <= 3; k++) {
      steps(room, T);
      for (const conn of ["h", "a", "b"]) assert.deepEqual(room.handle(conn, hash(k * T, 42)), []);
    }
  });

  it("un client qui rejoue la partie renvoie ses hashes : le nouveau remplace l'ancien, et il peut être averti de nouveau", () => {
    const { room, samToken } = launched();
    steps(room, T);
    room.handle("h", hash(T, 1));
    room.handle("a", hash(T, 1));
    assert.equal(room.handle("b", hash(T, 9)).length, 1);
    room.disconnect("b");
    room.handle("b2", { type: "join", name: "", token: samToken });
    // Après le rejeu il est d'accord avec les autres : plus rien à signaler.
    assert.deepEqual(room.handle("b2", hash(T, 1)), []);
    // Un autre rejeu qui diverge à nouveau est signalé de nouveau.
    assert.deepEqual(room.handle("b2", hash(T, 9)), [{ to: "b2", message: { type: "desync", turn: T } }]);
  });

  it("un joueur déconnecté devenu minoritaire n'est pas averti, mais l'est quand il renvoie son hash à la reconnexion", () => {
    const { room, samToken } = launched();
    steps(room, T);
    room.handle("b", hash(T, 9));
    room.disconnect("b");
    // Égalité : le hash de Sam, arrivé le premier, fait référence, donc Marc est averti.
    assert.deepEqual(room.handle("h", hash(T, 1)), [{ to: "h", message: { type: "desync", turn: T } }]);
    // Léa donne la majorité à 1 : Sam diverge maintenant, mais il est absent, rien n'est envoyé.
    assert.deepEqual(room.handle("a", hash(T, 1)), []);
    room.handle("b2", { type: "join", name: "", token: samToken });
    assert.deepEqual(room.handle("b2", hash(T, 9)), [{ to: "b2", message: { type: "desync", turn: T } }]);
  });

  it("un hash pour un tour qui n'est pas un multiple de N, pas encore créé, ou mal formé est refusé", () => {
    const { room } = launched();
    steps(room, T);
    for (const bad of [hash(T + 1, 1), hash(0, 1), hash(2 * T, 1), hash(-T, 1), hash(T, -1), hash(T, 1.5), hash(T, 4294967296), hash(T, "x" as unknown as number), { type: "hash", turn: T }, { type: "hash", hash: 1 }]) {
      assert.equal(errorOf(room.handle("a", bad), "a"), "invalid_message", JSON.stringify(bad));
    }
  });

  it("un hash avant le lancement est refusé", () => {
    const room = new Room(makeEnv());
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.equal(errorOf(room.handle("h", hash(T, 1)), "h"), "not_started");
  });
});

describe("pause", () => {
  it("seul l'hôte met en pause et reprend ; les autres reçoivent « not_host »", () => {
    const { room } = launched();
    assert.equal(errorOf(room.handle("a", { type: "pause", paused: true }), "a"), "not_host");
    assert.equal(room.paused, false);
    room.handle("h", { type: "pause", paused: true });
    assert.equal(errorOf(room.handle("a", { type: "pause", paused: false }), "a"), "not_host");
    assert.equal(room.paused, true);
  });

  it("tous les joueurs connectés sont informés du changement", () => {
    const { room } = launched();
    const out = room.handle("h", { type: "pause", paused: true });
    for (const conn of ["h", "a", "b"]) assert.deepEqual(to(out, conn), [{ type: "paused", paused: true }]);
    const back = room.handle("h", { type: "pause", paused: false });
    for (const conn of ["h", "a", "b"]) assert.deepEqual(to(back, conn), [{ type: "paused", paused: false }]);
  });

  it("aucun tour n'est créé en pause ; les ordres attendent et entrent dans le premier tour après la reprise", () => {
    const { room } = launched();
    room.step();
    room.handle("h", { type: "pause", paused: true });
    room.handle("a", order("x"));
    assert.deepEqual(room.step(), []);
    assert.deepEqual(room.step(), []);
    assert.equal(room.turnCount, 1);
    room.handle("h", { type: "pause", paused: false });
    const turn = to(room.step(), "h")[0]!;
    assert.equal(turn.type === "turn" && turn.turn, 2, "pas de trou dans la numérotation");
    assert.deepEqual(turn.type === "turn" && turn.orders, [{ type: "x", player: 2 }]);
  });

  it("la pause avant le lancement est refusée ; une valeur qui n'est pas booléenne aussi", () => {
    const room = new Room(makeEnv());
    room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.equal(errorOf(room.handle("h", { type: "pause", paused: true }), "h"), "not_started");
    room.handle("h", { type: "start" });
    assert.equal(errorOf(room.handle("h", { type: "pause", paused: "oui" }), "h"), "invalid_message");
    assert.equal(errorOf(room.handle("h", { type: "pause" }), "h"), "invalid_message");
  });

  it("la pause n'est pas un ordre : elle n'entre dans aucun tour", () => {
    const { room } = launched();
    room.handle("h", { type: "pause", paused: true });
    room.handle("h", { type: "pause", paused: false });
    const turn = to(room.step(), "h")[0]!;
    assert.deepEqual(turn.type === "turn" && turn.orders, []);
  });
});
