import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyTurn,
  createGame,
  createRng,
  forEachNeighbor,
  generateTestMap,
  hashMap,
  hashState,
  nextInt,
  nextU32,
  TERRAIN_ALTITUDE,
  TERRAIN_LAND,
  TERRAIN_OCEAN,
  TERRAIN_SHORE,
  type GameState,
  type Intent,
} from "../src/index.ts";

const MAP = generateTestMap(12345);

function firstLandTile(state: GameState): number {
  return state.map.terrain.findIndex((b) => (b & TERRAIN_LAND) !== 0);
}

function firstWaterTile(state: GameState): number {
  return state.map.terrain.findIndex((b) => (b & TERRAIN_LAND) === 0);
}

/** Une case de terre libre dont aucun voisin n'appartient au joueur 1. */
function farFreeLand(state: GameState): number {
  for (let t = state.owner.length - 1; t >= 0; t--) {
    if ((state.map.terrain[t]! & TERRAIN_LAND) === 0 || state.owner[t] !== 0) continue;
    let near = false;
    forEachNeighbor(state.map, t, (n) => {
      if (state.owner[n] === 1) near = true;
    });
    if (!near) return t;
  }
  throw new Error("aucune case trouvée");
}

describe("générateur aléatoire", () => {
  it("suit xoshiro128** (valeurs de référence calculées à la main pour l'état [1,2,3,4])", () => {
    const r = new Uint32Array([1, 2, 3, 4]);
    assert.deepEqual([nextU32(r), nextU32(r), nextU32(r)], [11520, 0, 5927040]);
  });

  it("produit toujours la même suite pour la graine 1", () => {
    const r = createRng(1);
    const got = Array.from({ length: 6 }, () => nextU32(r));
    assert.deepEqual(got, [0x9190299e, 0xc1017b27, 0xe3af522f, 0x7d71fb05, 0x787816c2, 0xfbbe0c00]);
  });

  it("nextInt reste dans [0, n)", () => {
    const r = createRng(9);
    for (const n of [1, 2, 3, 7, 1000, 0x100000000]) {
      for (let i = 0; i < 1000; i++) {
        const v = nextInt(r, n);
        assert.ok(Number.isInteger(v) && v >= 0 && v < n);
      }
    }
  });

  it("refuse une graine qui n'est pas un entier 32 bits", () => {
    for (const s of [-1, 1.5, 2 ** 32, NaN]) assert.throws(() => createRng(s));
  });
});

describe("carte de test", () => {
  it("a quelques centaines de milliers de cases", () => {
    assert.equal(MAP.terrain.length, MAP.width * MAP.height);
    assert.ok(MAP.terrain.length >= 200_000);
  });

  it("est identique pour la même graine et différente pour une autre", () => {
    assert.equal(hashMap(generateTestMap(12345)), hashMap(MAP));
    assert.notEqual(hashMap(generateTestMap(12346)), hashMap(MAP));
  });

  it("a des bits de terrain cohérents", () => {
    let land = 0;
    const w = MAP.width;
    for (let t = 0; t < MAP.terrain.length; t++) {
      const b = MAP.terrain[t]!;
      const x = t % w;
      const y = (t - x) / w;
      if (b & TERRAIN_LAND) {
        land++;
        assert.equal(b & TERRAIN_OCEAN, 0, `case ${t} : terre et océan`);
        let waterNeighbor = false;
        forEachNeighbor(MAP, t, (n) => {
          if ((MAP.terrain[n]! & TERRAIN_LAND) === 0) waterNeighbor = true;
        });
        assert.equal((b & TERRAIN_SHORE) !== 0, waterNeighbor, `case ${t} : bit côte`);
      } else {
        assert.equal(b & (TERRAIN_SHORE | TERRAIN_ALTITUDE), 0, `case ${t} : eau avec côte ou altitude`);
      }
      if (x === 0 || y === 0 || x === w - 1 || y === MAP.height - 1) {
        assert.ok(b & TERRAIN_OCEAN, `case ${t} : le bord de la carte doit être de l'océan`);
      }
    }
    const ratio = land / MAP.terrain.length;
    assert.ok(ratio > 0.2 && ratio < 0.7, `part de terre ${ratio}`);
  });
});

describe("tour et ordres", () => {
  it("refuse un numéro de tour qui n'est pas le suivant, sans rien modifier", () => {
    const s = createGame({ seed: 1, map: MAP, playerCount: 2 });
    const before = hashState(s);
    assert.throws(() => applyTurn(s, { turn: 2, intents: [] }));
    assert.throws(() => applyTurn(s, { turn: 0, intents: [] }));
    assert.equal(hashState(s), before);
    applyTurn(s, { turn: 1, intents: [] });
    assert.throws(() => applyTurn(s, { turn: 1, intents: [] }));
  });

  it("applique un ordre valide et renvoie exactement les cases modifiées", () => {
    const s = createGame({ seed: 1, map: MAP, playerCount: 2 });
    const start = firstLandTile(s);
    let changed = applyTurn(s, { turn: 1, intents: [{ type: "demo_claim", player: 1, tile: start }] });
    assert.deepEqual(changed, [start]);
    assert.equal(s.owner[start], 1);
    assert.equal(s.players[0]!.tileCount, 1);

    // Deux ordres sur la même case dans un tour : le premier gagne, la case est listée une fois.
    const next = start + 1;
    assert.ok(s.map.terrain[next]! & TERRAIN_LAND);
    const before = s.owner.slice();
    changed = applyTurn(s, {
      turn: 2,
      intents: [
        { type: "demo_claim", player: 1, tile: next },
        { type: "demo_claim", player: 1, tile: next },
        { type: "demo_claim", player: 2, tile: next },
      ],
    });
    const diff: number[] = [];
    for (let t = 0; t < s.owner.length; t++) if (s.owner[t] !== before[t]) diff.push(t);
    assert.deepEqual(changed, diff);
    assert.deepEqual(changed, [next]);
    assert.equal(s.changedMark.indexOf(1), -1, "marqueurs remis à zéro");
  });

  it("ignore chaque ordre invalide : même hash qu'un tour vide, aucune case modifiée", () => {
    const setup = (): GameState => {
      const s = createGame({ seed: 5, map: MAP, playerCount: 3 });
      applyTurn(s, { turn: 1, intents: [{ type: "demo_claim", player: 1, tile: firstLandTile(s) }] });
      return s;
    };
    const probe = setup();
    const owned = firstLandTile(probe);
    const invalid: unknown[] = [
      null,
      undefined,
      7,
      "demo_claim",
      [],
      {},
      { type: "demo_claim" },
      { type: "autre", player: 2, tile: owned + 1 },
      { type: "demo_claim", player: 0, tile: owned + 1 },
      { type: "demo_claim", player: 4, tile: owned + 1 },
      { type: "demo_claim", player: 1.5, tile: owned + 1 },
      { type: "demo_claim", player: "1", tile: owned + 1 },
      { type: "demo_claim", player: 1, tile: "1" },
      { type: "demo_claim", player: 1, tile: -1 },
      { type: "demo_claim", player: 1, tile: probe.owner.length },
      { type: "demo_claim", player: 1, tile: 2.5 },
      { type: "demo_claim", player: 1, tile: NaN },
      { type: "demo_claim", player: 1, tile: firstWaterTile(probe) },
      { type: "demo_claim", player: 2, tile: owned }, // déjà à quelqu'un
      { type: "demo_claim", player: 1, tile: owned }, // déjà à lui
      { type: "demo_claim", player: 1, tile: farFreeLand(probe) }, // pas adjacente
    ];
    for (const intent of invalid) {
      const a = setup();
      const b = setup();
      applyTurn(a, { turn: 2, intents: [] });
      const changed = applyTurn(b, { turn: 2, intents: [intent as Intent] });
      assert.deepEqual(changed, [], `ordre ${JSON.stringify(intent)}`);
      assert.equal(hashState(b), hashState(a), `ordre ${JSON.stringify(intent)}`);
    }
    // Un tour dont `intents` n'est pas un tableau ne fait rien non plus.
    const a = setup();
    const b = setup();
    applyTurn(a, { turn: 2, intents: [] });
    applyTurn(b, { turn: 2, intents: "x" as unknown as Intent[] });
    assert.equal(hashState(b), hashState(a));
  });

  it("change le hash quand une seule case change de propriétaire", () => {
    const a = createGame({ seed: 1, map: MAP, playerCount: 1 });
    const b = createGame({ seed: 1, map: MAP, playerCount: 1 });
    applyTurn(a, { turn: 1, intents: [] });
    applyTurn(b, { turn: 1, intents: [{ type: "demo_claim", player: 1, tile: firstLandTile(b) }] });
    assert.notEqual(hashState(a), hashState(b));
  });
});

describe("sources du moteur (règle 2 du CLAUDE.md)", () => {
  // Math.* autorisés : résultat exact fixé par la spécification ECMAScript.
  const ALLOWED_MATH = new Set(["imul", "floor", "ceil", "trunc", "abs", "min", "max", "sign", "clz32"]);
  const FORBIDDEN: [RegExp, string][] = [
    [/\bDate\b/, "Date"],
    [/\bperformance\b/, "performance"],
    [/\bset(Timeout|Interval|Immediate)\b/, "minuterie"],
    [/\brequestAnimationFrame\b/, "requestAnimationFrame"],
    [/\bcrypto\b/, "crypto"],
    [/\*\*/, "opérateur ** (même statut que Math.pow)"],
    [/\b(window|document|globalThis|self|fetch|WebSocket|XMLHttpRequest|localStorage|process|require)\b/, "accès hors du moteur"],
    [/\bfrom\s+["'](?!\.\/)/, "import d'un module extérieur"],
    [/\bimport\s*\(/, "import dynamique"],
  ];

  const dir = join(import.meta.dirname, "..", "src");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    it(`${file} n'utilise aucune fonction interdite`, () => {
      // Les commentaires peuvent nommer ces fonctions ; seul le code compte.
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/\bMath\.(\w+)/g)) {
        assert.ok(ALLOWED_MATH.has(m[1]!), `${file} : Math.${m[1]} interdit`);
      }
      for (const [re, what] of FORBIDDEN) assert.doesNotMatch(code, re, `${file} : ${what}`);
    });
  }
});
