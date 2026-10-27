import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cloudflareGamePath, isMapId, isSeed, normalizeGameName, normalizePlayerName } from "../src/index.ts";

describe("noms", () => {
  it("joueur : 1 à 24 caractères après trim", () => {
    assert.equal(normalizePlayerName("  Marc "), "Marc");
    assert.equal(normalizePlayerName(""), null);
    assert.equal(normalizePlayerName("   "), null);
    assert.equal(normalizePlayerName("a".repeat(24)), "a".repeat(24));
    assert.equal(normalizePlayerName("a".repeat(25)), null);
    assert.equal(normalizePlayerName(42), null);
    assert.equal(normalizePlayerName("a\tb"), null);
  });

  it("partie : 1 à 40 caractères après trim", () => {
    assert.equal(normalizeGameName(" Soirée du jeudi "), "Soirée du jeudi");
    assert.equal(normalizeGameName("a".repeat(40)), "a".repeat(40));
    assert.equal(normalizeGameName("a".repeat(41)), null);
    assert.equal(normalizeGameName(undefined), null);
  });
});

describe("valeurs", () => {
  it("cartes et graines", () => {
    assert.equal(isMapId("test"), true);
    assert.equal(isMapId("autre"), false);
    assert.equal(isSeed(0), true);
    assert.equal(isSeed(4294967295), true);
    assert.equal(isSeed(4294967296), false);
    assert.equal(isSeed(-1), false);
    assert.equal(isSeed(1.5), false);
  });

  it("chemin WebSocket d'une partie Cloudflare", () => {
    assert.equal(cloudflareGamePath("abc-123"), "/api/games/abc-123/ws");
  });
});
