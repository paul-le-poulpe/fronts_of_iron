// La salle d'attente (Docs/Design/01-Architecture.md §4) : une règle par test, sous Node, sans réseau.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_MAP, DEFAULT_SEED, MAX_ONLINE_PLAYERS, type ServerMessage } from "@fronts-of-iron/shared";

import { Room, type Outgoing, type RoomEnv } from "../src/index.ts";

/** Enveloppe de test : jetons numérotés, graine « au hasard » fixée. */
function makeEnv(seeds: number[] = [987654321]): RoomEnv {
  let tokens = 0;
  let draws = 0;
  return {
    newToken: () => `tok-${++tokens}`,
    randomSeed: () => seeds[Math.min(draws++, seeds.length - 1)]!,
  };
}

/** Ce que reçoit une connexion dans une liste de sorties. */
function to(out: Outgoing[], conn: string): ServerMessage[] {
  return out.filter((o) => o.to === conn).map((o) => o.message);
}

function last(out: Outgoing[], conn: string): ServerMessage {
  const messages = to(out, conn);
  assert.ok(messages.length > 0, `aucun message pour ${conn}`);
  return messages[messages.length - 1]!;
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

/** Une salle dont l'hôte (connexion « h ») est entré. */
function hostedRoom(env = makeEnv()): Room {
  const room = new Room(env);
  room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
  return room;
}

describe("salle d'attente : arrivée", () => {
  it("le jeton d'hôte désigne le joueur 1, hôte", () => {
    const room = new Room(makeEnv());
    const out = room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.deepEqual(to(out, "h")[0], { type: "welcome", token: room.hostToken });
    assert.deepEqual(last(out, "h"), {
      type: "room",
      you: 1,
      players: [{ id: 1, name: "Marc", host: true }],
      map: DEFAULT_MAP,
      seed: DEFAULT_SEED,
    });
  });

  it("le jeton d'hôte est créé avec la salle, et un jeton fourni est repris", () => {
    const env = makeEnv();
    assert.equal(new Room(env).hostToken, "tok-1");
    assert.equal(new Room(env, "mon-jeton").hostToken, "mon-jeton");
  });

  it("sans jeton d'hôte, on est un joueur ordinaire, avec son propre jeton", () => {
    const room = hostedRoom();
    const out = room.handle("a", { type: "join", name: "Léa" });
    assert.notEqual(tokenOf(out, "a"), room.hostToken);
    const view = last(out, "a");
    assert.equal(view.type === "room" && view.you, 2);
    assert.equal(view.type === "room" && view.players[1]!.host, false);
  });

  it("un joueur qui n'a pas le jeton d'hôte ne peut pas prendre sa place", () => {
    const room = new Room(makeEnv());
    const out = room.handle("a", { type: "join", name: "Léa", token: "faux" });
    const view = last(out, "a");
    assert.equal(view.type === "room" && view.players[0]!.host, false);
  });

  it("l'état de la salle est renvoyé à tous à chaque arrivée, avec le « you » de chacun", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    const out = room.handle("b", { type: "join", name: "Sam" });
    for (const [conn, you] of [["h", 1], ["a", 2], ["b", 3]] as const) {
      const view = last(out, conn);
      assert.equal(view.type, "room");
      assert.equal(view.type === "room" && view.you, you);
      assert.deepEqual(view.type === "room" && view.players.map((p) => p.name), ["Marc", "Léa", "Sam"]);
    }
  });

  it("le nom est coupé aux espaces et fait de 1 à 24 caractères", () => {
    const room = hostedRoom();
    assert.equal(errorOf(room.handle("a", { type: "join", name: "" }), "a"), "invalid_name");
    assert.equal(errorOf(room.handle("a", { type: "join", name: "   " }), "a"), "invalid_name");
    assert.equal(errorOf(room.handle("a", { type: "join", name: "x".repeat(25) }), "a"), "invalid_name");
    assert.equal(errorOf(room.handle("a", { type: "join", name: 12 }), "a"), "invalid_name");
    assert.equal(errorOf(room.handle("a", { type: "join", name: "a\nb" }), "a"), "invalid_name");
    assert.equal(errorOf(room.handle("a", { type: "join" }), "a"), "invalid_name");
    // 24 caractères passent, y compris hors du plan de base (un point de code compte pour un).
    assert.equal(errorOf(room.handle("a", { type: "join", name: "😀".repeat(24) }), "a"), undefined);
    const out = room.handle("b", { type: "join", name: "  Sam  " });
    const view = last(out, "b");
    assert.equal(view.type === "room" && view.players[2]!.name, "Sam");
  });

  it("un joueur refusé n'entre pas dans la salle", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "" });
    assert.equal(room.summary().players, 1);
  });

  it("une même connexion ne rejoint pas deux fois", () => {
    const room = hostedRoom();
    assert.equal(errorOf(room.handle("h", { type: "join", name: "Marc" }), "h"), "already_joined");
    assert.equal(room.summary().players, 1);
  });

  it("jusqu'à 100 joueurs, le 101e est refusé : partie pleine", () => {
    const room = hostedRoom();
    for (let i = 2; i <= MAX_ONLINE_PLAYERS; i++) {
      assert.equal(errorOf(room.handle(`c${i}`, { type: "join", name: `J${i}` }), `c${i}`), undefined, `joueur ${i}`);
    }
    assert.equal(room.summary().players, MAX_ONLINE_PLAYERS);
    assert.equal(errorOf(room.handle("trop", { type: "join", name: "Trop" }), "trop"), "game_full");
    assert.equal(room.summary().players, MAX_ONLINE_PLAYERS);
  });

  it("la place de l'hôte absent est réservée", () => {
    const room = new Room(makeEnv());
    for (let i = 1; i <= MAX_ONLINE_PLAYERS - 1; i++) room.handle(`c${i}`, { type: "join", name: `J${i}` });
    assert.equal(errorOf(room.handle("trop", { type: "join", name: "Trop" }), "trop"), "game_full");
    const out = room.handle("h", { type: "join", name: "Marc", token: room.hostToken });
    assert.equal(errorOf(out, "h"), undefined);
    assert.equal(room.summary().players, MAX_ONLINE_PLAYERS);
    // L'hôte est premier, donc joueur 1, même arrivé en dernier.
    const view = last(out, "h");
    assert.equal(view.type === "room" && view.you, 1);
  });
});

describe("salle d'attente : réglages de l'hôte", () => {
  it("l'hôte change la carte et la graine, et tout le monde reçoit l'état", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    const out = room.handle("h", { type: "set_map", map: "test", seed: 777 });
    for (const conn of ["h", "a"]) {
      const view = last(out, conn);
      assert.equal(view.type === "room" && view.seed, 777);
      assert.equal(view.type === "room" && view.map, "test");
    }
    assert.equal(room.summary().seed, 777);
  });

  it("la graine accepte 0 et 2³² − 1, refuse le reste", () => {
    const room = hostedRoom();
    for (const ok of [0, 4294967295]) assert.equal(errorOf(room.handle("h", { type: "set_map", seed: ok }), "h"), undefined);
    for (const bad of [-1, 4294967296, 1.5, "12", null, NaN]) {
      assert.equal(errorOf(room.handle("h", { type: "set_map", seed: bad }), "h"), "invalid_seed", String(bad));
    }
    assert.equal(room.summary().seed, 4294967295);
  });

  it("une carte inconnue est refusée, et la graine envoyée dans le même message n'est pas appliquée", () => {
    const room = hostedRoom();
    assert.equal(errorOf(room.handle("h", { type: "set_map", map: "inconnue", seed: 5 }), "h"), "invalid_map");
    assert.equal(room.summary().seed, DEFAULT_SEED);
  });

  it("un set_map sans carte ni graine est un message invalide", () => {
    const room = hostedRoom();
    assert.equal(errorOf(room.handle("h", { type: "set_map" }), "h"), "invalid_message");
  });

  it("« au hasard » : la graine vient de la fonction de l'enveloppe", () => {
    const room = hostedRoom(makeEnv([4000000000, 42]));
    const first = last(room.handle("h", { type: "set_map", seed: "random" }), "h");
    assert.equal(first.type === "room" && first.seed, 4000000000);
    const second = last(room.handle("h", { type: "set_map", seed: "random" }), "h");
    assert.equal(second.type === "room" && second.seed, 42);
  });

  it("un joueur qui n'est pas l'hôte ne change ni la carte ni la graine, et ne lance pas", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    assert.equal(errorOf(room.handle("a", { type: "set_map", seed: 5 }), "a"), "not_host");
    assert.equal(errorOf(room.handle("a", { type: "start" }), "a"), "not_host");
    assert.equal(room.summary().seed, DEFAULT_SEED);
    assert.equal(room.summary().state, "waiting");
  });

  it("un message avant d'être entré, ou mal formé, est refusé", () => {
    const room = hostedRoom();
    assert.equal(errorOf(room.handle("x", { type: "set_map", seed: 5 }), "x"), "not_joined");
    assert.equal(errorOf(room.handle("x", { type: "start" }), "x"), "not_joined");
    for (const bad of [null, 3, "join", [], {}, { type: "inconnu" }, { type: "join", name: "A", token: 4 }]) {
      assert.equal(errorOf(room.handle("x", bad), "x"), "invalid_message", JSON.stringify(bad));
    }
  });
});

describe("salle d'attente : départ d'un joueur avant le lancement", () => {
  it("sa place est libérée et les identifiants sont renumérotés 1..n sans trou", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    room.handle("b", { type: "join", name: "Sam" });
    room.handle("c", { type: "join", name: "Noé" });
    const out = room.disconnect("a");
    assert.deepEqual(to(out, "a"), []);
    const view = last(out, "c");
    assert.equal(view.type === "room" && view.you, 3);
    assert.deepEqual(view.type === "room" && view.players.map((p) => [p.id, p.name]), [[1, "Marc"], [2, "Sam"], [3, "Noé"]]);
    assert.equal(room.summary().players, 3);
  });

  it("la place libérée peut être reprise par un autre", () => {
    const room = hostedRoom();
    for (let i = 2; i <= MAX_ONLINE_PLAYERS; i++) room.handle(`c${i}`, { type: "join", name: `J${i}` });
    room.disconnect("c50");
    assert.equal(errorOf(room.handle("neuf", { type: "join", name: "Neuf" }), "neuf"), undefined);
  });

  it("l'ancien jeton d'un joueur parti ne le ramène pas à sa place : il arrive comme un nouveau joueur", () => {
    const room = hostedRoom();
    const first = room.handle("a", { type: "join", name: "Léa" });
    const token = tokenOf(first, "a");
    room.handle("b", { type: "join", name: "Sam" });
    room.disconnect("a");
    const back = room.handle("a2", { type: "join", name: "Léa", token });
    const view = last(back, "a2");
    assert.equal(view.type === "room" && view.you, 3);
  });

  it("l'hôte qui part garde son jeton : il revient en premier", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    const out = room.disconnect("h");
    const view = last(out, "a");
    assert.equal(view.type === "room" && view.you, 1);
    assert.equal(view.type === "room" && view.players[0]!.host, false);
    assert.equal(room.summary().hostName, "");
    const back = room.handle("h2", { type: "join", name: "Marc", token: room.hostToken });
    const hostView = last(back, "h2");
    assert.equal(hostView.type === "room" && hostView.you, 1);
    assert.equal(hostView.type === "room" && hostView.players[0]!.name, "Marc");
    assert.equal(hostView.type === "room" && hostView.players[1]!.name, "Léa");
    assert.equal(room.summary().hostName, "Marc");
  });

  it("une connexion inconnue qui se ferme ne change rien", () => {
    const room = hostedRoom();
    assert.deepEqual(room.disconnect("inconnue"), []);
    assert.equal(room.summary().players, 1);
  });
});

describe("lancement", () => {
  /** Hôte, puis Léa et Sam ; Léa part ; Noé arrive. Ids au lancement : Marc 1, Sam 2, Noé 3. */
  function launched() {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    const sam = room.handle("b", { type: "join", name: "Sam" });
    room.disconnect("a");
    const noe = room.handle("c", { type: "join", name: "Noé" });
    room.handle("h", { type: "set_map", seed: 4242 });
    const out = room.handle("h", { type: "start" });
    return { room, out, samToken: tokenOf(sam, "b"), noeToken: tokenOf(noe, "c") };
  }

  const PLAYERS = [{ id: 1, name: "Marc" }, { id: 2, name: "Sam" }, { id: 3, name: "Noé" }];

  it("envoie à chacun le message de départ : graine, carte, joueurs 1..n, identifiant du destinataire", () => {
    const { room, out } = launched();
    assert.equal(room.summary().state, "started");
    for (const [conn, you] of [["h", 1], ["b", 2], ["c", 3]] as const) {
      assert.deepEqual(to(out, conn), [{ type: "start", you, map: "test", seed: 4242, players: PLAYERS }]);
    }
    assert.equal(out.length, 3);
  });

  it("n'accepte plus d'arrivée, de réglage, ni de second lancement", () => {
    const { room } = launched();
    assert.equal(errorOf(room.handle("n", { type: "join", name: "Nouveau" }), "n"), "game_started");
    assert.equal(errorOf(room.handle("n", { type: "join", name: "Nouveau", token: "faux" }), "n"), "game_started");
    assert.equal(errorOf(room.handle("h", { type: "set_map", seed: 1 }), "h"), "game_started");
    assert.equal(errorOf(room.handle("h", { type: "start" }), "h"), "game_started");
    assert.equal(room.summary().seed, 4242);
  });

  it("un joueur qui se déconnecte après le lancement garde sa place", () => {
    const { room } = launched();
    assert.deepEqual(room.disconnect("b"), []);
    assert.equal(room.summary().players, 3);
  });

  it("reconnexion par jeton après le lancement : le message de départ est renvoyé, avec le même identifiant", () => {
    const { room, samToken, noeToken } = launched();
    room.disconnect("b");
    const out = room.handle("b2", { type: "join", name: "peu importe", token: samToken });
    assert.deepEqual(to(out, "b2"), [{ type: "start", you: 2, map: "test", seed: 4242, players: PLAYERS }]);
    const noe = last(room.handle("c2", { type: "join", name: "", token: noeToken }), "c2");
    assert.equal(noe.type === "start" && noe.you, 3);
  });

  it("l'hôte revient par son jeton d'hôte", () => {
    const { room } = launched();
    room.disconnect("h");
    const out = room.handle("h2", { type: "join", name: "x", token: room.hostToken });
    const m = last(out, "h2");
    assert.equal(m.type === "start" && m.you, 1);
  });

  it("le même jeton sur une deuxième connexion remplace la première", () => {
    const { room, samToken } = launched();
    const out = room.handle("b2", { type: "join", name: "x", token: samToken });
    assert.equal(errorOf(out, "b"), "replaced");
    assert.equal(last(out, "b2").type, "start");
    // L'ancienne connexion n'est plus rattachée : ses messages sont refusés et sa fermeture ne libère rien.
    assert.equal(errorOf(room.handle("b", { type: "start" }), "b"), "not_joined");
    assert.deepEqual(room.disconnect("b"), []);
    assert.equal(room.summary().players, 3);
  });

  it("l'hôte peut lancer seul", () => {
    const room = hostedRoom();
    const out = room.handle("h", { type: "start" });
    assert.deepEqual(last(out, "h"), { type: "start", you: 1, map: "test", seed: DEFAULT_SEED, players: [{ id: 1, name: "Marc" }] });
  });
});

describe("résumé pour le lobby", () => {
  it("nom de l'hôte, nombre de joueurs, état, carte et graine", () => {
    const room = hostedRoom();
    room.handle("a", { type: "join", name: "Léa" });
    room.handle("h", { type: "set_map", seed: 9 });
    assert.deepEqual(room.summary(), { state: "waiting", players: 2, hostName: "Marc", map: "test", seed: 9 });
    room.handle("h", { type: "start" });
    assert.deepEqual(room.summary(), { state: "started", players: 2, hostName: "Marc", map: "test", seed: 9 });
  });
});

describe("indépendance de la plateforme", () => {
  it("le code du relais ne lit ni horloge, ni hasard, ni minuterie, ni API de plateforme", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(import.meta.dirname, "../src");
    for (const file of readdirSync(dir)) {
      // On retire les commentaires : ils expliquent ces interdits.
      const code = readFileSync(join(dir, file), "utf8").replace(/\/\/.*$/gm, "");
      for (const forbidden of [/Math\.random/, /Date\.now/, /performance\./, /setInterval/, /setTimeout/, /process\./, /crypto\./, /WebSocket/, /document\./, /window\./, /cloudflare:/, /node:/]) {
        assert.doesNotMatch(code, forbidden, `${file} : ${String(forbidden)}`);
      }
    }
  });
});
