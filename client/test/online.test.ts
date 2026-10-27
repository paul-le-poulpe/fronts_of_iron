// Parties en ligne côté page, sans DOM (src/online.ts) : adresse du WebSocket, nom et jetons gardés dans le
// navigateur, liste du lobby. Sous Node.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LobbyEntry } from "@fronts-of-iron/shared";

import {
  forgetToken,
  gameAction,
  gameToResume,
  httpErrorText,
  loadPlayerName,
  loadToken,
  parseLobbyList,
  parseSeedInput,
  saveToken,
  savePlayerName,
  wsUrl,
  type KeyValueStore,
} from "../src/online.ts";

/** Stockage en mémoire. */
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** Stockage qui lève à chaque appel (navigateur qui bloque le stockage). */
const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("adresse du WebSocket", () => {
  test("chemin relatif : wss:// + hôte de la page si la page est en https, ws:// si elle est en http", () => {
    assert.equal(wsUrl("/api/games/abc/ws", { protocol: "https:", host: "fronts-of-iron.paul-raynaud.workers.dev" }), "wss://fronts-of-iron.paul-raynaud.workers.dev/api/games/abc/ws");
    assert.equal(wsUrl("/api/games/abc/ws", { protocol: "http:", host: "localhost:5173" }), "ws://localhost:5173/api/games/abc/ws");
  });

  test("adresse https:// d'un tunnel : wss://", () => {
    assert.equal(wsUrl("https://a-b.trycloudflare.com", { protocol: "http:", host: "localhost:5173" }), "wss://a-b.trycloudflare.com");
    assert.equal(wsUrl("https://a-b.trycloudflare.com/ws", { protocol: "https:", host: "x" }), "wss://a-b.trycloudflare.com/ws");
  });

  test("http:// (essai direct sans tunnel) : ws://", () => {
    assert.equal(wsUrl("http://localhost:8080", { protocol: "http:", host: "localhost:5173" }), "ws://localhost:8080");
  });

  test("autres formes refusées, dont //hôte (qui changerait d'hôte)", () => {
    for (const bad of ["", "ftp://x", "//evil.example/ws", "javascript:alert(1)", "api/games"]) {
      assert.equal(wsUrl(bad, { protocol: "https:", host: "x" }), null, bad);
    }
  });
});

describe("nom et jetons gardés dans le navigateur", () => {
  test("le nom est gardé", () => {
    const store = memoryStore();
    assert.equal(loadPlayerName(store), "");
    savePlayerName(store, "Marc");
    assert.equal(loadPlayerName(store), "Marc");
  });

  test("un jeton par partie, oublié à la demande", () => {
    const store = memoryStore();
    saveToken(store, "g1", "t1");
    saveToken(store, "g2", "t2");
    assert.equal(loadToken(store, "g1"), "t1");
    assert.equal(loadToken(store, "g2"), "t2");
    assert.equal(loadToken(store, "g3"), undefined);
    forgetToken(store, "g1");
    assert.equal(loadToken(store, "g1"), undefined);
    assert.equal(loadToken(store, "g2"), "t2");
  });

  test("seuls les 20 jetons les plus récents sont gardés", () => {
    const store = memoryStore();
    for (let i = 0; i < 25; i++) saveToken(store, `g${i}`, `t${i}`);
    assert.equal(loadToken(store, "g4"), undefined);
    assert.equal(loadToken(store, "g5"), "t5");
    assert.equal(loadToken(store, "g24"), "t24");
    // Un jeton réécrit redevient le plus récent.
    saveToken(store, "g5", "nouveau");
    saveToken(store, "g25", "t25");
    assert.equal(loadToken(store, "g5"), "nouveau");
    assert.equal(loadToken(store, "g6"), undefined);
  });

  test("un contenu illisible est ignoré", () => {
    for (const raw of ["pas du json", "[1,2]", "null", '{"g":42}']) {
      const store = memoryStore();
      store.data.set("foi.tokens", raw);
      assert.equal(loadToken(store, "g"), undefined, raw);
      saveToken(store, "g", "t");
      assert.equal(loadToken(store, "g"), "t", raw);
    }
  });

  test("un stockage qui lève, ou absent, ne casse rien", () => {
    for (const store of [brokenStore, null]) {
      assert.equal(loadPlayerName(store), "");
      assert.equal(loadToken(store, "g"), undefined);
      savePlayerName(store, "Marc");
      saveToken(store, "g", "t");
      forgetToken(store, "g");
    }
  });
});

describe("liste du lobby", () => {
  const valid = {
    id: "a", name: "Soirée", hostName: "Marc", mode: "cloudflare", address: "/api/games/a/ws",
    map: "test", seed: 12345, players: 4, maxPlayers: 100, state: "waiting",
  };

  test("garde les entrées valides, ignore les autres", () => {
    const list = parseLobbyList({ games: [valid, null, 3, { id: "x" }, { ...valid, id: "b", state: "started" }] });
    assert.deepEqual(list.map((g) => [g.id, g.state]), [["a", "waiting"], ["b", "started"]]);
    assert.deepEqual(list[0], valid);
    assert.deepEqual(parseLobbyList(null), []);
    assert.deepEqual(parseLobbyList({ games: "non" }), []);
  });

  test("une entrée d'avant la salle d'attente (sans hôte, carte, graine, état) reste lisible", () => {
    const old = { id: "h", name: "Vieux", address: "https://a.trycloudflare.com", players: 1, maxPlayers: 8 };
    assert.deepEqual(parseLobbyList({ games: [old] })[0], {
      id: "h", name: "Vieux", hostName: "", mode: "host", address: "https://a.trycloudflare.com",
      map: "test", seed: null, players: 1, maxPlayers: 8, state: "waiting",
    });
  });

  test("action proposée : rejoindre, reprendre avec un jeton, partie pleine, commencée", () => {
    const entry = (patch: Partial<LobbyEntry>): LobbyEntry => ({ ...parseLobbyList({ games: [valid] })[0]!, ...patch });
    assert.equal(gameAction(entry({}), false), "join");
    assert.equal(gameAction(entry({}), true), "join");
    assert.equal(gameAction(entry({ players: 100 }), false), "full");
    assert.equal(gameAction(entry({ state: "started" }), true), "resume");
    assert.equal(gameAction(entry({ state: "started" }), false), "closed");
  });

  test("reprise automatique : la première partie lancée dont le navigateur a le jeton", () => {
    const entry = (patch: Partial<LobbyEntry>): LobbyEntry => ({ ...parseLobbyList({ games: [valid] })[0]!, ...patch });
    const games = [entry({ id: "a" }), entry({ id: "b", state: "started" }), entry({ id: "c", state: "started" }), entry({ id: "d", state: "started" })];
    const tokens = new Set(["a", "c", "d"]);
    assert.equal(gameToResume(games, (id) => tokens.has(id))?.id, "c", "a : en attente ; b : pas de jeton");
    assert.equal(gameToResume(games, () => false), null);
  });
});

describe("graine saisie", () => {
  test("entier de 0 à 2³² − 1", () => {
    assert.equal(parseSeedInput(" 12345 "), 12345);
    assert.equal(parseSeedInput("0"), 0);
    assert.equal(parseSeedInput("4294967295"), 4294967295);
    for (const bad of ["", "-1", "1.5", "4294967296", "abc", "99999999999"]) assert.equal(parseSeedInput(bad), null, bad);
  });
});

describe("texte d'une erreur du Worker", () => {
  test("le message envoyé par le serveur est affiché tel quel", () => {
    assert.equal(httpErrorText(401, { error: "wrong_password", message: "Mot de passe de création incorrect." }), "Mot de passe de création incorrect.");
  });

  test("sans message (proxy, panne) : le code HTTP", () => {
    assert.equal(httpErrorText(502, null), "Serveur injoignable (HTTP 502).");
    assert.equal(httpErrorText(500, { error: "x" }), "Erreur du serveur (HTTP 500).");
    assert.equal(httpErrorText(500, { message: "" }), "Erreur du serveur (HTTP 500).");
  });
});
