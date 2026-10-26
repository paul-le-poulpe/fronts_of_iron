import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyIntent,
  applyTurn,
  CITY,
  createGame,
  createRng,
  FERTILITY,
  FOOD,
  forEachNeighbor,
  foundingCost,
  generateResourcePresence,
  generateTestMap,
  hashMap,
  hashState,
  nextInt,
  nextU32,
  POPULATION,
  RESOURCE_COUNT,
  RESOURCE_IRON,
  RESOURCES,
  TERRAIN_ALTITUDE,
  TERRAIN_LAND,
  TERRAIN_OCEAN,
  TERRAIN_SHORE,
  TEST_MAP,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { checkCityInvariants, firstWaterTile, isLandDisc, tileAt } from "./helpers.ts";

const MAP = generateTestMap(12345);

/**
 * Centre de la carte de test : un grand disque de terre, où les distances sont
 * exactes. Les écarts à ce centre sont écrits à partir des rayons : R =
 * contrôle, E = expansion.
 */
const CX = 400;
const CY = 250;
const R = CITY.controlRadius;
const E = CITY.expansionRadius;
/** Écart à une ville : hors de son rayon de contrôle, dans son rayon d'expansion. */
const NEAR = R + 5;
const found = (player: number, x: number, y: number): Intent => ({
  type: "found_city",
  player,
  tile: tileAt(MAP, x, y),
});

/**
 * Un ordre appliqué seul, hors tour : pas d'étape de nourriture, donc la
 * population reste celle que l'ordre vient de fixer. Sert à vérifier le coût
 * exact des fondations.
 */
const direct = (s: GameState, intent: Intent): boolean => applyIntent(s, intent, []);

/**
 * Partie à 3 joueurs où le joueur 1 a fondé sa première ville au centre de la
 * carte (une montagne : pas de terre cultivable, la population y baisse vers la
 * nourriture minimale).
 */
function setup(): GameState {
  const s = createGame({ seed: 5, map: MAP, playerCount: 3 });
  applyTurn(s, { turn: 1, intents: [found(1, CX, CY)] });
  return s;
}

/** Les cases dont le propriétaire diffère entre deux copies de `owner`. */
function diffOwner(before: Uint16Array, after: Uint16Array): number[] {
  const diff: number[] = [];
  for (let t = 0; t < after.length; t++) if (after[t] !== before[t]) diff.push(t);
  return diff;
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
    assert.equal(MAP.resources.length, MAP.terrain.length);
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

  it("porte la présence du fer dans le bit 0 de resources et celle de l'aluminium dans le bit 1 ; une case ne porte qu'une ressource", () => {
    assert.equal(RESOURCE_COUNT, Object.keys(RESOURCES).length);
    assert.equal(RESOURCE_IRON, 1);
    const iron = generateResourcePresence(MAP, 12345, RESOURCES.iron.presence);
    const aluminium = generateResourcePresence(MAP, 12345, RESOURCES.aluminium.presence);
    let count = 0;
    for (let t = 0; t < iron.length; t++) {
      // L'aluminium, plus rare et plus loin dans la liste, remplace le fer quand les deux sont présents (00-Game §2).
      const expected = aluminium[t] === 1 ? 2 : iron[t] === 1 ? RESOURCE_IRON : 0;
      assert.equal(MAP.resources[t], expected, `case ${t}`);
      count += expected === RESOURCE_IRON ? 1 : 0;
    }
    assert.ok(count > 1000, "le fer doit être présent sur la carte de test");
  });

  it("a de la fertilité : 0 sur l'eau, en montagne et sur le fer, FERTILITY.land sur le reste de la terre", () => {
    assert.equal(MAP.fertility.length, MAP.terrain.length);
    assert.equal(RESOURCES.iron.presence.mountainAltitude, TEST_MAP.mountainAltitude, "une seule définition de « montagne »");
    let mountains = 0, plains = 0, ironPlains = 0;
    for (let t = 0; t < MAP.terrain.length; t++) {
      const b = MAP.terrain[t]!;
      if ((b & TERRAIN_LAND) === 0) assert.equal(MAP.fertility[t], 0, `eau ${t}`);
      else if ((b & TERRAIN_ALTITUDE) >= TEST_MAP.mountainAltitude) {
        assert.equal(MAP.fertility[t], 0, `montagne ${t}`);
        mountains++;
      } else if (MAP.resources[t] !== 0) {
        assert.equal(MAP.fertility[t], 0, `ressource ${t} (00-Game §2 : une case de fer ou d'aluminium n'est pas cultivable)`);
        ironPlains++;
      } else {
        assert.equal(MAP.fertility[t], FERTILITY.land, `terre ${t}`);
        plains++;
      }
    }
    assert.ok(mountains > 1000 && plains > 1000 && ironPlains > 100, "la carte de test doit avoir les trois");
    assert.ok(FERTILITY.land >= 1 && FERTILITY.land <= 10);
  });

  it("change de hash quand une seule case de fertilité change", () => {
    const copy = { ...MAP, fertility: MAP.fertility.slice() };
    assert.equal(hashMap(copy), hashMap(MAP));
    copy.fertility[copy.fertility.length - 1] ^= 1;
    assert.notEqual(hashMap(copy), hashMap(MAP));
    copy.fertility[copy.fertility.length - 1] ^= 1;
    copy.fertility[1] ^= 1;
    assert.notEqual(hashMap(copy), hashMap(MAP));
  });

  it("change de hash quand une seule case de ressources change", () => {
    const copy = { ...MAP, resources: MAP.resources.slice() };
    assert.equal(hashMap(copy), hashMap(MAP));
    copy.resources[copy.resources.length - 1] ^= RESOURCE_IRON;
    assert.notEqual(hashMap(copy), hashMap(MAP));
    copy.resources[copy.resources.length - 1] ^= RESOURCE_IRON;
    copy.resources[1] ^= RESOURCE_IRON;
    assert.notEqual(hashMap(copy), hashMap(MAP));
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

  it("la carte de test a de la terre sur un grand disque autour de (400, 250)", () => {
    assert.ok(isLandDisc(MAP, CX, CY, 2 * E));
  });

  it("found_city : la première ville est gratuite, donne la population de départ et devient la capitale", () => {
    const s = createGame({ seed: 1, map: MAP, playerCount: 2 });
    const before = s.owner.slice();
    const start = tileAt(MAP, CX, CY);
    const changed = applyTurn(s, { turn: 1, intents: [found(1, CX, CY)] });

    // Le disque de contrôle : toutes les cases à une distance ≤ rayon, comptées à la main.
    const disc: number[] = [];
    for (let y = CY - CITY.controlRadius; y <= CY + CITY.controlRadius; y++) {
      for (let x = CX - CITY.controlRadius; x <= CX + CITY.controlRadius; x++) {
        const dx = x - CX;
        const dy = y - CY;
        if (dx * dx + dy * dy <= CITY.controlRadius * CITY.controlRadius) disc.push(tileAt(MAP, x, y));
      }
    }
    assert.deepEqual(changed, disc);
    assert.deepEqual(changed, diffOwner(before, s.owner));
    for (const t of disc) {
      assert.equal(s.owner[t], 1);
      assert.equal(s.tileCity[t], 1);
    }
    const p = s.players[0]!;
    assert.equal(p.tileCount, disc.length);
    assert.equal(p.capital, 1);
    assert.deepEqual(p.cityIds, [1]);
    assert.deepEqual(s.cities, [{ id: 1, player: 1, tile: start, port: false, group: 1 }]);
    assert.deepEqual(s.roads, []);
    assert.equal(s.players[1]!.capital, 0);
    // Un joueur sans ville croît quand même (nomades, 00-Game §4) : après un tour, la partie entière du premier gain.
    assert.equal(s.players[1]!.population, Math.trunc((FOOD.minimum * POPULATION.growthPerMillion) / 1_000_000));
    assert.equal(s.changedMark.indexOf(1), -1, "marqueurs remis à zéro");
    checkCityInvariants(s);
    // Juste après la fondation, avant l'étape de nourriture du tour : la population de départ.
    const alone = createGame({ seed: 1, map: MAP, playerCount: 2 });
    assert.ok(direct(alone, found(1, CX, CY)));
    assert.equal(alone.players[0]!.population, POPULATION.initial);
    assert.equal(alone.players[1]!.population, 0);
  });

  it("found_city : la deuxième ville coûte la population de fondation, dans le rayon d'expansion seulement", () => {
    const s = setup();
    // À r cases (= rayon d'expansion) : permis. À r + 1 : refusé, sans rien changer.
    const r = CITY.expansionRadius;
    assert.deepEqual(applyTurn(s, { turn: 2, intents: [found(1, CX + r + 1, CY)] }), []);
    assert.equal(s.cities.length, 1);

    const changed = applyTurn(s, { turn: 3, intents: [found(1, CX + r, CY)] });
    assert.ok(changed.length > 0);
    assert.equal(s.cities.length, 2);
    assert.equal(s.players[0]!.capital, 1, "la capitale reste la première ville");
    assert.deepEqual(s.players[0]!.cityIds, [1, 2]);
    assert.deepEqual(s.roads, [[1, 2]]);
    assert.deepEqual([s.cities[0]!.group, s.cities[1]!.group], [1, 1]);
    checkCityInvariants(s);

    // Le coût exact, hors étape de nourriture : refusé sans rien retirer, puis retiré une fois.
    const d = createGame({ seed: 5, map: MAP, playerCount: 3 });
    assert.ok(direct(d, found(1, CX, CY)));
    assert.ok(!direct(d, found(1, CX + r + 1, CY)));
    assert.equal(d.players[0]!.population, POPULATION.initial);
    assert.ok(direct(d, found(1, CX + r, CY)));
    assert.equal(d.players[0]!.population, POPULATION.initial - foundingCost(1));
  });

  it("found_city : le rayon d'expansion d'une ville d'un autre joueur ne compte pas", () => {
    const s = setup();
    applyTurn(s, { turn: 2, intents: [found(2, CX - 2 * E, CY)] });
    // À NEAR de la ville du joueur 1, à 2 E + NEAR de la sienne.
    assert.deepEqual(applyTurn(s, { turn: 3, intents: [found(2, CX + NEAR, CY)] }), []);
    assert.equal(s.cities.length, 2);
    // Même case pour le joueur 1 : permis.
    s.players[0]!.population = foundingCost(1);
    assert.ok(applyTurn(s, { turn: 4, intents: [found(1, CX + NEAR, CY)] }).length > 0);
    assert.equal(s.cities.length, 3);
  });

  it("found_city : deux ordres sur des cases en conflit dans le même tour, le premier gagne", () => {
    const s = createGame({ seed: 1, map: MAP, playerCount: 2 });
    const before = s.owner.slice();
    const changed = applyTurn(s, {
      turn: 1,
      intents: [
        found(1, CX, CY),
        found(2, CX + Math.floor(R / 2), CY), // dans le rayon de contrôle de la ville 1
        found(1, CX, CY), // même case
        found(2, CX + R + 1, CY), // hors rayon : valide, et vole des cases à la ville 1
      ],
    });
    assert.deepEqual(s.cities.map((c) => [c.player, c.tile]), [
      [1, tileAt(MAP, CX, CY)],
      [2, tileAt(MAP, CX + R + 1, CY)],
    ]);
    // Les cases sont listées dans l'ordre de leur première modification, pas par adresse.
    assert.deepEqual(
      changed.toSorted((x, y) => x - y),
      diffOwner(before, s.owner),
      "liste des cases = écart réel, chaque case une fois",
    );
    assert.equal(new Set(changed).size, changed.length);
    checkCityInvariants(s);

    // Même case, joueurs différents : le premier ordre gagne.
    const t = createGame({ seed: 1, map: MAP, playerCount: 2 });
    applyTurn(t, { turn: 1, intents: [found(2, CX, CY), found(1, CX, CY)] });
    assert.deepEqual(t.cities.map((c) => c.player), [2]);
    assert.equal(t.players[0]!.capital, 0);

    // Chaque joueur a reçu la population de départ de sa première ville, une seule fois.
    const u = createGame({ seed: 1, map: MAP, playerCount: 2 });
    for (const intent of [found(1, CX, CY), found(2, CX + Math.floor(R / 2), CY), found(1, CX, CY), found(2, CX + R + 1, CY)]) direct(u, intent);
    assert.deepEqual(u.players.map((p) => p.population), [POPULATION.initial, POPULATION.initial]);
  });

  it("ignore chaque ordre invalide : même hash qu'un tour vide, aucune case modifiée", () => {
    const owned = tileAt(MAP, CX, CY);
    // Écart en diagonale : chaque coordonnée est dans le rayon d'expansion, la distance non.
    const DIAG = Math.ceil((3 * E) / 4);
    assert.ok(DIAG <= E && 2 * DIAG * DIAG > E * E);
    const invalid: unknown[] = [
      null,
      undefined,
      7,
      "found_city",
      [],
      {},
      { type: "found_city" },
      { type: "autre", player: 2, tile: owned + 20 },
      { type: "found_city", player: 0, tile: owned + 20 },
      { type: "found_city", player: 4, tile: owned + 20 }, // joueur inconnu
      { type: "found_city", player: 1.5, tile: owned + 20 },
      { type: "found_city", player: "1", tile: owned + 20 },
      { type: "found_city", player: 2, tile: "1" },
      { type: "found_city", player: 2 },
      { type: "found_city", player: 2, tile: -1 },
      { type: "found_city", player: 2, tile: MAP.terrain.length },
      { type: "found_city", player: 2, tile: 2.5 },
      { type: "found_city", player: 2, tile: NaN },
      { type: "found_city", player: 2, tile: Infinity },
      { type: "set_farm_share" },
      { type: "set_farm_share", player: 1 },
      { type: "set_farm_share", player: 1, percent: -1 },
      { type: "set_farm_share", player: 1, percent: 101 },
      { type: "set_farm_share", player: 1, percent: 50.5 },
      { type: "set_farm_share", player: 1, percent: "50" },
      { type: "set_farm_share", player: 1, percent: null },
      { type: "set_farm_share", player: 1, percent: NaN },
      { type: "set_farm_share", player: 1, percent: Infinity },
      { type: "set_farm_share", player: 0, percent: 50 },
      { type: "set_farm_share", player: 4, percent: 50 },
      { type: "set_farm_share", player: 1.5, percent: 50 },
      { type: "set_farm_share", player: "1", percent: 50 },
      { type: "found_city", player: 2, tile: firstWaterTile(MAP) }, // eau
      { type: "found_city", player: 2, tile: owned }, // dans le rayon de contrôle d'un autre joueur
      { type: "found_city", player: 1, tile: owned }, // sur sa propre ville
      { type: "found_city", player: 1, tile: owned + CITY.controlRadius }, // exactement sur le rayon : dedans
      { type: "found_city", player: 1, tile: owned + CITY.expansionRadius + 1 }, // hors du rayon d'expansion
      { type: "found_city", player: 1, tile: tileAt(MAP, CX + DIAG, CY + DIAG) }, // 2 DIAG² > E² : hors du rayon d'expansion
    ];
    for (const intent of invalid) {
      const a = setup();
      const b = setup();
      applyTurn(a, { turn: 2, intents: [] });
      const changed = applyTurn(b, { turn: 2, intents: [intent as Intent] });
      assert.deepEqual(changed, [], `ordre ${JSON.stringify(intent)}`);
      assert.equal(hashState(b), hashState(a), `ordre ${JSON.stringify(intent)}`);
    }
    // Population insuffisante : une personne de moins que le coût de la deuxième ville, sur une case autrement valide.
    const cost = foundingCost(1);
    assert.ok(cost > CITY.foundingCostPopulation, "le coût de la deuxième ville dépasse le coût de base");
    const poor = setup();
    poor.players[0]!.population = cost - 1;
    const reference = setup();
    reference.players[0]!.population = cost - 1;
    applyTurn(reference, { turn: 2, intents: [] });
    assert.deepEqual(applyTurn(poor, { turn: 2, intents: [found(1, CX + NEAR, CY)] }), []);
    assert.equal(hashState(poor), hashState(reference));
    // Avec exactement le coût, le même ordre est valide (hors étape de nourriture : la population tombe à 0).
    poor.players[0]!.population = cost;
    assert.ok(direct(poor, found(1, CX + NEAR, CY)));
    assert.equal(poor.players[0]!.population, 0);
    // Un tour dont `intents` n'est pas un tableau ne fait rien non plus.
    const a = setup();
    const b = setup();
    applyTurn(a, { turn: 2, intents: [] });
    applyTurn(b, { turn: 2, intents: "x" as unknown as Intent[] });
    assert.equal(hashState(b), hashState(a));
  });

  it("change le hash quand une seule ville est fondée", () => {
    const a = createGame({ seed: 1, map: MAP, playerCount: 1 });
    const b = createGame({ seed: 1, map: MAP, playerCount: 1 });
    applyTurn(a, { turn: 1, intents: [] });
    applyTurn(b, { turn: 1, intents: [found(1, CX, CY)] });
    assert.notEqual(hashState(a), hashState(b));
  });

  it("hashState couvre chaque champ de l'état des villes et de l'économie", () => {
    const base = (): GameState => {
      const s = setup();
      s.players[0]!.population = 100_000;
      applyTurn(s, { turn: 2, intents: [found(1, CX + NEAR, CY), found(1, CX, CY + NEAR), found(2, CX - 2 * E, CY)] });
      return s;
    };
    const reference = hashState(base());
    assert.equal(hashState(base()), reference);
    const mutations: [string, (s: GameState) => void][] = [
      ["population", (s) => void s.players[0]!.population++],
      ["growthRemainder", (s) => void s.players[0]!.growthRemainder++],
      ["farmPercent", (s) => void s.players[0]!.farmPercent--],
      ["farmTiles", (s) => void s.players[0]!.farmTiles++],
      ["fertilitySum", (s) => void s.players[0]!.fertilitySum++],
      ["seaTiles", (s) => void s.players[0]!.seaTiles++],
      ["farmers", (s) => void s.players[0]!.farmers++],
      ["fishers", (s) => void s.players[0]!.fishers++],
      ["idle", (s) => void s.players[0]!.idle++],
      ["cultivated", (s) => void s.players[0]!.cultivated++],
      ["fished", (s) => void s.players[0]!.fished++],
      ["wheat", (s) => void s.players[0]!.wheat++],
      ["fish", (s) => void s.players[0]!.fish++],
      ["food", (s) => void s.players[0]!.food++],
      ["résultats du joueur 2", (s) => void s.players[1]!.idle++],
      ["capital", (s) => void s.players[0]!.capital++],
      ["cityIds", (s) => void s.players[0]!.cityIds.reverse()],
      ["resourceTiles", (s) => void (s.players[0]!.resourceTiles[0] = s.players[0]!.resourceTiles[0]! + 1)],
      ["tileCount", (s) => void s.players[0]!.tileCount++],
      ["port", (s) => void (s.cities[0]!.port = !s.cities[0]!.port)],
      ["group", (s) => void s.cities[1]!.group++],
      ["roads", (s) => void s.roads.pop()],
      ["roads (ordre)", (s) => void s.roads.push(s.roads.shift()!)],
      ["tileCity", (s) => void (s.tileCity[s.tileCity.length - 1] = 1)],
      ["owner", (s) => void (s.owner[s.owner.length - 1] = 1)],
      ["cities", (s) => void s.cities.pop()],
    ];
    for (const [name, mutate] of mutations) {
      const s = base();
      mutate(s);
      assert.notEqual(hashState(s), reference, `le champ « ${name} » n'est pas dans le hash`);
    }
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
  for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"))) {
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
