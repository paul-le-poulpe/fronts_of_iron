import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  applyTurn,
  CITY,
  createGame,
  createRng,
  CURVE_SCALE,
  FARMING,
  FERTILITY,
  FISHING,
  FOOD,
  GROWTH_SCALE,
  harvest,
  hashState,
  machineCurve,
  mechanization,
  mechanizationCurve,
  nextInt,
  POPULATION,
  stepEconomy,
  TERRAIN_LAND,
  waterYieldMilli,
  type GameMap,
  type GameState,
  type Intent,
  type MechanizationConfig,
} from "../src/index.ts";
import { DEFAULT_SCENARIO, runScenario } from "./scenario.ts";
import { bruteHarvest, checkCityInvariants, customMap, tileAt } from "./helpers.ts";

const S = CURVE_SCALE;
const R = CITY.controlRadius;

/** Terre partout, fertilité par défaut. */
const LAND_MAP = customMap(100, 60, () => "land");
/** Terre à gauche, océan à droite (x ≥ 55) : une ville en (50, 30) a des cases d'eau dans sa zone. */
const SEA_MAP = customMap(100, 60, (x) => (x >= 55 ? "ocean" : "land"));
/** Fertilités variées de 0 à 10 (un neuvième à peu près de cases à 0). */
const VARIED_MAP = customMap(100, 60, () => "land", () => false, (x, y) => (x * 7 + y * 3) % 11);

const found = (map: GameMap, player: number, x: number, y: number): Intent => ({
  type: "found_city",
  player,
  tile: tileAt(map, x, y),
});

/** Partie dont le joueur 1 a fondé sa première ville en (50, 30), hors tour : population = POPULATION.initial, aucune étape de nourriture jouée. */
function withCity(map: GameMap, players = 1): GameState {
  const s = createGame({ seed: 1, map, playerCount: players });
  assert.ok(applyIntent(s, found(map, 1, 50, 30), []));
  return s;
}

/** Totaux du disque de contrôle d'une ville seule en (cx, cy), comptés case par case. */
function disc(map: GameMap, cx: number, cy: number): { tiles: number; farm: number; fertility: number; water: number } {
  const out = { tiles: 0, farm: 0, fertility: 0, water: 0 };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const t = tileAt(map, cx + dx, cy + dy);
      out.tiles++;
      if (map.fertility[t]! > 0) out.farm++;
      out.fertility += map.fertility[t]!;
      if ((map.terrain[t]! & TERRAIN_LAND) === 0) out.water++;
    }
  }
  return out;
}

describe("courbe de mécanisation (00-Game §6.3)", () => {
  it("vaut 0 en 0 et S en S, pour tout exposant", () => {
    for (let n = 1; n <= 6; n++) {
      assert.equal(mechanizationCurve(0, n), 0, `n = ${n}`);
      assert.equal(mechanizationCurve(S, n), S, `n = ${n}`);
    }
  });

  it("n = 1 est une droite : f(X) = X", () => {
    for (const X of [0, 1, 1234, 5000, 9999, S]) assert.equal(mechanizationCurve(X, 1), X);
  });

  it("valeurs calculées à la main", () => {
    // n = 2, X = S/2 : p = 10000 → 5000 → 2500, f = 7500.
    assert.equal(mechanizationCurve(S / 2, 2), 7500);
    // n = 3, X = S/2 : p = 10000 → 5000 → 2500 → 1250, f = 8750.
    assert.equal(mechanizationCurve(S / 2, 3), 8750);
    // n = 2, X = 3333 : p = 10000 → 6667 → floor(6667 × 6667 / 10000) = floor(4444,8889) = 4444, f = 5556.
    assert.equal(mechanizationCurve(3333, 2), 5556);
  });

  it("est croissante et reste dans 0…S", () => {
    for (let n = 1; n <= 4; n++) {
      let previous = 0;
      for (let X = 0; X <= S; X++) {
        const f = mechanizationCurve(X, n);
        assert.ok(f >= previous && f <= S, `n = ${n}, X = ${X}`);
        previous = f;
      }
    }
  });
});

describe("mécanisation et récolte (00-Game §6.2, §6.4, §6.5)", () => {
  it("sans machine : M_base ; à m_max machines pour 1 000 travailleurs ou plus : M_max", () => {
    for (const cfg of [FARMING, FISHING]) {
      assert.equal(mechanization(cfg, 5000, 0), cfg.mechanizationBase);
      const full = (5000 * cfg.maxMachinesPer1000) / 1000;
      assert.equal(mechanization(cfg, 5000, full), cfg.mechanizationMax);
      assert.equal(mechanization(cfg, 5000, full * 10), cfg.mechanizationMax);
      // Aucun travailleur disponible : pas de division par zéro, M_base.
      assert.equal(mechanization(cfg, 0, 0), cfg.mechanizationBase);
      assert.equal(mechanization(cfg, 0, 100), cfg.mechanizationBase);
    }
  });

  it("à mi-chemin de m_max : M_base + (M_max − M_base) × f(S/2) / S", () => {
    const cfg: MechanizationConfig = { mechanizationBase: 300, mechanizationMax: 1500, maxMachinesPer1000: 100, curveExponent: 2 };
    // 2 000 travailleurs, 100 machines = 50 pour 1 000 = la moitié de m_max : f = 7500, M = 300 + 1200 × 0,75 = 1200.
    assert.equal(mechanization(cfg, 2000, 100), 1200);
    // n = 1 : 300 + 1200 × 0,5 = 900.
    assert.equal(mechanization({ ...cfg, curveExponent: 1 }, 2000, 100), 900);
  });

  it("travailleurs requis : arrondi vers le haut, pour couvrir toute la surface", () => {
    const M = FARMING.mechanizationBase;
    // Prémisse : 1 000 cases à M milli-cases par travailleur ne tombe pas juste, donc arrondir vers le bas laisserait des cases.
    assert.notEqual(1_000_000 % M, 0);
    const down = Math.floor(1_000_000 / M);
    assert.ok(Math.floor((down * M) / 1000) < 1000, "avec l'arrondi vers le bas, la surface ne serait pas couverte");
    const h = harvest(FARMING, 1_000_000, 0, 1000, 5000);
    assert.equal(h.workers, down + 1);
    assert.equal(h.area, 1000);
    assert.equal(h.yield, 5000);
    // Quand la division tombe juste, pas de travailleur de plus : surface = M cases → 1 000 travailleurs.
    assert.equal(harvest(FARMING, 1_000_000, 0, M, M * 5).workers, 1000);
  });

  it("les travailleurs en trop restent inactifs ; trop peu de travailleurs : toute la population travaille", () => {
    const rich = harvest(FARMING, 100_000, 0, 200, 1000);
    assert.ok(rich.workers < 100_000 && rich.area === 200);
    const poor = harvest(FARMING, 10, 0, 200, 1000);
    assert.equal(poor.workers, 10);
    assert.equal(poor.area, Math.floor((10 * FARMING.mechanizationBase) / 1000));
    assert.ok(poor.area < 200);
  });

  it("blé = fertilité_totale × surface cultivée / surface_max, multiplié avant d'être divisé", () => {
    // 10 travailleurs à M_base = 300 cultivent 3 cases sur 7.
    const h = harvest(FARMING, 10, 0, 7, 33);
    assert.equal(h.area, 3);
    assert.equal(h.yield, 14); // floor(33 × 3 / 7) ; diviser d'abord donnerait floor(33 / 7) × 3 = 12
    // Toute la surface cultivée : toute la fertilité.
    assert.equal(harvest(FARMING, 1_000_000, 0, 7, 33).yield, 33);
  });

  it("sans surface : rien à cultiver, tous les travailleurs disponibles sont inactifs", () => {
    assert.deepEqual(harvest(FARMING, 500, 0, 0, 0), { workers: 0, area: 0, yield: 0 });
    assert.deepEqual(harvest(FISHING, 500, 0, 0, 0), { workers: 0, area: 0, yield: 0 });
  });

  it("donne les mêmes résultats que le calcul de référence en rationnels exacts (BigInt), sur des milliers de cas", () => {
    const rng = createRng(2024);
    for (let i = 0; i < 4000; i++) {
      const cfg = i % 2 === 0 ? FARMING : FISHING;
      const available = i % 17 === 0 ? 0 : nextInt(rng, 2_000_000);
      const machines = nextInt(rng, available + 1);
      const surface = i % 13 === 0 ? 0 : nextInt(rng, 1_000_000);
      const fertility = surface === 0 ? 0 : nextInt(rng, surface * 10 + 1);
      const got = harvest(cfg, available, machines, surface, fertility);
      const want = bruteHarvest(cfg, available, machines, surface, fertility);
      assert.deepEqual(
        { workers: got.workers, area: got.area, yield: got.yield },
        want,
        `cas ${i} : ${available} disponibles, ${machines} machines, surface ${surface}, fertilité ${fertility}`,
      );
      assert.ok(got.area <= surface, "surface cultivée ≤ surface_max");
      assert.ok(got.workers <= available);
      assert.ok(got.yield <= fertility);
    }
  });
});

describe("rendement d'une case d'eau (00-Game §6.4)", () => {
  it("va de tileYield sans bateau à tileYieldMax avec le maximum de bateaux, en croissant", () => {
    const fishers = 1000;
    assert.equal(waterYieldMilli(fishers, 0), FISHING.tileYield * 1000);
    const full = Math.ceil((fishers * FISHING.maxMachinesPer1000) / 1000);
    assert.equal(waterYieldMilli(fishers, full), FISHING.tileYieldMax * 1000);
    assert.equal(waterYieldMilli(fishers, full * 10), FISHING.tileYieldMax * 1000, "au-delà du maximum, plus rien ne change");
    let previous = 0;
    for (let boats = 0; boats <= full; boats++) {
      const y = waterYieldMilli(fishers, boats);
      assert.ok(y >= previous);
      previous = y;
    }
    assert.equal(waterYieldMilli(0, 50), FISHING.tileYield * 1000, "sans pêcheur, pas de bateau par pêcheur");
    // Même courbe que la mécanisation : à mi-chemin des bateaux, f vaut la même chose pour les deux.
    const half = Math.floor(full / 2);
    const f = machineCurve(FISHING, fishers, half);
    assert.equal(
      waterYieldMilli(fishers, half),
      FISHING.tileYield * 1000 + Math.floor(((FISHING.tileYieldMax - FISHING.tileYield) * 1000 * f) / CURVE_SCALE),
    );
  });
});

describe("étape de nourriture d'un joueur (00-Game §4, §6)", () => {
  it("une ville de terre cultivable : fermiers, surface, blé, nourriture, croissance", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    const d = disc(LAND_MAP, 50, 30);
    assert.deepEqual([p.farmTiles, p.fertilitySum, p.seaTiles], [d.farm, d.fertility, 0]);
    const pop = p.population;
    stepEconomy(s);
    const want = bruteHarvest(FARMING, pop, 0, d.farm, d.fertility);
    assert.equal(p.farmers, want.workers);
    assert.equal(p.cultivated, want.area);
    assert.equal(p.wheat, want.yield);
    assert.deepEqual([p.fishers, p.fished, p.fish], [0, 0, 0]);
    assert.equal(p.food, Math.max(want.yield, FOOD.minimum));
    assert.equal(p.farmers + p.fishers + p.idle, pop, "toute la population est fermier, pêcheur ou inactive");
    // Croissance : la partie entière du reste est ajoutée, le reste garde le surplus de fraction.
    const rem = (p.food - pop * POPULATION.foodPerHead) * POPULATION.growthPerMillion;
    assert.equal(p.population, pop + Math.trunc(rem / GROWTH_SCALE));
    assert.equal(p.growthRemainder, rem - Math.trunc(rem / GROWTH_SCALE) * GROWTH_SCALE);
  });

  it("fermiers et pêcheurs : la part des fermiers est floor(population × pourcentage / 100), le reste pêche", () => {
    const s = withCity(SEA_MAP);
    const p = s.players[0]!;
    const d = disc(SEA_MAP, 50, 30);
    assert.ok(d.water > 0 && d.farm > 0);
    assert.equal(p.seaTiles, d.water);
    assert.ok(applyIntent(s, { type: "set_farm_share", player: 1, percent: 60 }, []));
    const pop = p.population;
    stepEconomy(s);
    const farmers = Math.floor((pop * 60) / 100);
    const fishers = pop - farmers;
    const farm = bruteHarvest(FARMING, farmers, 0, d.farm, d.fertility);
    const sea = bruteHarvest(FISHING, fishers, 0, d.water, d.water * FISHING.tileYield);
    assert.deepEqual([p.farmers, p.cultivated, p.wheat], [farm.workers, farm.area, farm.yield]);
    assert.deepEqual([p.fishers, p.fished, p.fish], [sea.workers, sea.area, sea.yield]);
    assert.equal(p.fish, FISHING.tileYield * p.fished, "chaque case de mer pêchée vaut FISHING.tileYield");
    assert.equal(p.food, Math.max(farm.yield + sea.yield, FOOD.minimum));
    assert.equal(p.idle, farmers - farm.workers + (fishers - sea.workers));
    assert.equal(p.farmers + p.fishers + p.idle, pop);
    assert.ok(p.fished > 0 && p.fished <= d.water);
  });

  it("sans case de mer, les pêcheurs n'ont rien à travailler : population inactive (choix provisoire, 02-Engine §7)", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    applyIntent(s, { type: "set_farm_share", player: 1, percent: 0 }, []);
    const pop = p.population;
    stepEconomy(s);
    assert.deepEqual([p.farmers, p.fishers, p.idle, p.food], [0, 0, pop, FOOD.minimum]);
    applyIntent(s, { type: "set_farm_share", player: 1, percent: 100 }, []);
    stepEconomy(s);
    assert.equal(p.fishers, 0);
  });

  it("la nourriture minimale est un plancher", () => {
    const s = withCity(LAND_MAP);
    const p = s.players[0]!;
    // 10 fermiers cultivent 3 cases : 3 × fertilité 5 = 15 de blé, sous le minimum.
    p.population = 10;
    stepEconomy(s);
    assert.equal(p.wheat, FERTILITY.land * 3);
    assert.ok(p.wheat + p.fish < FOOD.minimum);
    assert.equal(p.food, FOOD.minimum);
    // Au-dessus du minimum, la nourriture est blé + poisson : toute la zone est
    // cultivée (assez de fermiers), et sa fertilité totale dépasse le minimum.
    p.population = 1_000_000;
    stepEconomy(s);
    assert.equal(p.cultivated, p.farmTiles);
    assert.ok(p.wheat > FOOD.minimum, `${p.wheat} ≤ ${FOOD.minimum} : la carte de test doit être assez fertile`);
    assert.equal(p.food, p.wheat + p.fish);
  });

  it("la fertilité varie : le blé suit la somme des fertilités des cases de la zone, pas leur nombre", () => {
    const s = withCity(VARIED_MAP);
    const p = s.players[0]!;
    const d = disc(VARIED_MAP, 50, 30);
    assert.ok(d.farm < d.tiles, "des cases à fertilité 0 ne comptent pas dans la surface");
    assert.deepEqual([p.farmTiles, p.fertilitySum], [d.farm, d.fertility]);
    const pop = p.population;
    stepEconomy(s);
    assert.equal(p.wheat, bruteHarvest(FARMING, pop, 0, d.farm, d.fertility).yield);
  });

  it("un joueur sans ville (nomades) fait aussi l'étape : pas de terre, tous inactifs, nourriture minimale", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 2 });
    const p = s.players[0]!;
    p.population = 30;
    stepEconomy(s);
    assert.deepEqual([p.farmers, p.fishers, p.idle, p.cultivated, p.fished, p.wheat, p.fish, p.food], [0, 0, 30, 0, 0, 0, 0, FOOD.minimum]);
    // Le joueur 2, à 0, a aussi sa croissance : l'étape tourne pour tous les joueurs.
    const rem = FOOD.minimum * POPULATION.growthPerMillion;
    assert.equal(s.players[1]!.population, Math.trunc(rem / GROWTH_SCALE));
    assert.equal(s.players[1]!.growthRemainder, rem % GROWTH_SCALE);
    assert.equal(s.players[1]!.food, FOOD.minimum);
  });

  it("applyTurn : les ordres d'abord (coût de fondation déduit), puis l'étape sur la population qui reste", () => {
    const s = withCity(LAND_MAP);
    s.players[0]!.population = 150;
    applyTurn(s, { turn: 1, intents: [found(LAND_MAP, 1, 50 + CITY.expansionRadius, 30)] });
    const p = s.players[0]!;
    assert.equal(s.cities.length, 2);
    // Population utilisée par l'étape : 150 − 100 = 50.
    assert.equal(p.farmers + p.fishers + p.idle, 150 - CITY.foundingCostPopulation);
    // Le réglage envoyé dans le tour compte tout de suite.
    const t = withCity(LAND_MAP);
    applyTurn(t, { turn: 1, intents: [{ type: "set_farm_share", player: 1, percent: 40 }] });
    assert.equal(t.players[0]!.farmPercent, 40);
    assert.equal(t.players[0]!.farmers, Math.floor((POPULATION.initial * 40) / 100));
    assert.equal(t.players[0]!.farmers + t.players[0]!.idle, POPULATION.initial);
  });
});


describe("croissance avec reste (00-Game §4.1)", () => {
  it("rejoint exactement la population maximale (nourriture / consommation) sans s'arrêter en dessous", () => {
    // Un joueur seul sans ville : population maximale = FOOD.minimum / foodPerHead.
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    const max = Math.floor(FOOD.minimum / POPULATION.foodPerHead);
    let previous = 0;
    for (let turn = 1; turn <= 10_000; turn++) {
      applyTurn(s, { turn, intents: [] });
      const pop = s.players[0]!.population;
      assert.ok(pop >= previous && pop <= max, `tour ${turn} : ${pop}`);
      previous = pop;
    }
    assert.equal(previous, max);
    // Sans reste, trunc(surplus × taux / 1 000 000) vaut 0 dès que le surplus est
    // sous 1 000 000 / taux : la population s'arrêterait à autant de personnes sous
    // le maximum. Le test ne prouve quelque chose que si cet écart est d'au moins 2.
    assert.ok(GROWTH_SCALE / (POPULATION.growthPerMillion * POPULATION.foodPerHead) >= 2);
  });

  it("avec une ville : rejoint exactement la fertilité totale / consommation, sans s'arrêter en dessous", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    applyTurn(s, { turn: 1, intents: [found(LAND_MAP, 1, 50, 30)] });
    const p = s.players[0]!;
    const d = disc(LAND_MAP, 50, 30);
    // Toute la surface est cultivée dès que les fermiers suffisent : nourriture = fertilité totale.
    const max = Math.floor(d.fertility / POPULATION.foodPerHead);
    let previous = 0;
    for (let turn = 2; turn <= 20_000; turn++) {
      applyTurn(s, { turn, intents: [] });
      assert.ok(p.population >= previous, "la population ne baisse pas avant le maximum");
      assert.ok(p.population <= max, `tour ${turn} : ${p.population} > ${max}`);
      previous = p.population;
    }
    assert.equal(p.population, max);
    // À la limite, les fermiers inutiles sont inactifs.
    assert.equal(p.cultivated, d.farm);
    assert.equal(p.farmers + p.idle, p.population);
    assert.ok(p.idle > 0);
  });

  it("une population au-dessus du maximum baisse, par arrondi vers zéro (Math.trunc) : le premier départ arrive quand le reste atteint −1 000 000", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    const p = s.players[0]!;
    // Nomades, 10 personnes au-dessus du maximum : surplus −10 par tour.
    const start = Math.floor(FOOD.minimum / POPULATION.foodPerHead) + 10;
    p.population = start;
    const perTick = (FOOD.minimum - start * POPULATION.foodPerHead) * POPULATION.growthPerMillion;
    assert.ok(perTick < 0 && -perTick < GROWTH_SCALE);
    const T = Math.ceil(GROWTH_SCALE / -perTick);
    for (let k = 1; k < T; k++) {
      stepEconomy(s);
      assert.equal(p.population, start, `tour ${k} : floor aurait déjà retiré une personne`);
      assert.equal(p.growthRemainder, k * perTick);
    }
    stepEconomy(s);
    assert.equal(p.population, start - 1);
    assert.equal(p.growthRemainder, T * perTick + GROWTH_SCALE, "le reste garde la fraction de personne");
    assert.ok(Math.abs(p.growthRemainder) < GROWTH_SCALE);
  });

  it("la baisse s'arrête sur la population maximale, sans la dépasser par le bas", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    const p = s.players[0]!;
    const max = Math.floor(FOOD.minimum / POPULATION.foodPerHead);
    p.population = max + 500;
    for (let k = 0; k < 20_000; k++) {
      stepEconomy(s);
      assert.ok(p.population >= max, `tour ${k} : ${p.population}`);
    }
    assert.equal(p.population, max);
  });

  it("la hausse est symétrique : la première personne arrive quand le reste atteint +1 000 000", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    const p = s.players[0]!;
    // Nomades, 10 personnes sous le maximum : surplus +10 par tour.
    const start = Math.floor(FOOD.minimum / POPULATION.foodPerHead) - 10;
    p.population = start;
    const perTick = (FOOD.minimum - start * POPULATION.foodPerHead) * POPULATION.growthPerMillion;
    assert.ok(perTick > 0 && perTick < GROWTH_SCALE);
    const T = Math.ceil(GROWTH_SCALE / perTick);
    for (let k = 1; k < T; k++) {
      stepEconomy(s);
      assert.equal(p.population, start);
    }
    stepEconomy(s);
    assert.equal(p.population, start + 1);
  });

  it("la population ne passe jamais sous 0 : le reste est alors remis à 0", () => {
    const s = createGame({ seed: 1, map: LAND_MAP, playerCount: 1 });
    const p = s.players[0]!;
    p.population = 2;
    // État artificiel : un reste négatif plus grand que la population et que la croissance du tour.
    p.growthRemainder = -(FOOD.minimum * POPULATION.growthPerMillion) - 3 * GROWTH_SCALE + 1;
    stepEconomy(s);
    assert.equal(p.population, 0);
    assert.equal(p.growthRemainder, 0);
  });
});

describe("totaux de fertilité tenus à jour (setOwner)", () => {
  it("farmTiles, fertilitySum et seaTiles sont ceux d'un recomptage, après chaque fondation (zones qui se volent des cases, eau, fertilités variées)", () => {
    for (const map of [SEA_MAP, VARIED_MAP]) {
      const s = createGame({ seed: 1, map, playerCount: 2 });
      for (const p of s.players) p.population = 1_000_000;
      // Deux joueurs aux zones qui se recouvrent, du bord de mer vers l'intérieur.
      const orders: [number, number, number][] = [
        [1, 50, 30], [2, 62 - 11, 40], [1, 60, 30], [2, 40, 40], [1, 40, 20], [2, 52, 20], [1, 52, 52 - 10], [2, 30, 30], [1, 30, 45],
        [2, 70, 30], [1, 66, 14], [2, 46, 50],
      ];
      orders.forEach(([player, x, y], i) => {
        const before = s.cities.length;
        applyTurn(s, { turn: i + 1, intents: [found(map, player, x, y)] });
        checkCityInvariants(s);
        assert.ok(s.cities.length <= before + 1);
      });
      assert.ok(s.cities.length >= 8, `${s.cities.length} villes`);
      assert.ok(s.players.some((p) => p.seaTiles > 0) || map !== SEA_MAP);
    }
  });

  it("une case perdue au profit d'un autre joueur sort des totaux de l'ancien propriétaire", () => {
    const s = withCity(LAND_MAP, 2);
    const a = s.players[0]!;
    const before = [a.farmTiles, a.fertilitySum];
    assert.ok(applyIntent(s, found(LAND_MAP, 2, 61, 30), []));
    assert.ok(a.farmTiles < before[0]! && a.fertilitySum < before[1]!);
    assert.equal(a.fertilitySum, a.farmTiles * FERTILITY.land);
    assert.equal(s.players[1]!.fertilitySum, s.players[1]!.farmTiles * FERTILITY.land);
    checkCityInvariants(s);
  });
});

describe("ordre set_farm_share", () => {
  it("accepte les entiers de 0 à 100 et les écrit, refuse le reste sans rien changer", () => {
    const s = withCity(LAND_MAP, 2);
    const apply = (player: unknown, percent: unknown): boolean =>
      applyIntent(s, { type: "set_farm_share", player, percent }, []);
    assert.equal(s.players[0]!.farmPercent, 100, "100 par défaut");
    for (const v of [0, 1, 37, 99, 100]) {
      assert.ok(apply(1, v));
      assert.equal(s.players[0]!.farmPercent, v);
    }
    assert.equal(s.players[1]!.farmPercent, 100, "l'autre joueur n'est pas touché");
    for (const v of [-1, 101, 50.5, "50", null, undefined, NaN, Infinity, -Infinity, true, [50], {}]) {
      assert.ok(!apply(1, v), `${String(v)}`);
      assert.equal(s.players[0]!.farmPercent, 100);
    }
    for (const player of [0, 3, 1.5, "1", null, undefined]) {
      assert.ok(!apply(player, 50), `joueur ${String(player)}`);
      assert.equal(s.players[0]!.farmPercent, 100);
    }
  });

  it("change le hash quand la valeur change, et pas quand elle est refusée", () => {
    const a = withCity(LAND_MAP);
    const b = withCity(LAND_MAP);
    applyTurn(a, { turn: 1, intents: [] });
    applyTurn(b, { turn: 1, intents: [{ type: "set_farm_share", player: 1, percent: 101 }] });
    assert.equal(hashState(b), hashState(a));
    const c = withCity(LAND_MAP);
    applyTurn(c, { turn: 1, intents: [{ type: "set_farm_share", player: 1, percent: 99 }] });
    assert.notEqual(hashState(c), hashState(a));
  });
});

describe("parties jouées par des joueurs simulés (population, nourriture)", () => {
  it("garde les invariants de l'économie à chaque tour, avec croissance et surplus négatif", () => {
    let maxPopulation = 0;
    const r = runScenario({
      ...DEFAULT_SCENARIO,
      turns: 3000,
      onTurn: (state, turn) => {
        // Avec FOOD.minimum à 1 500, les joueurs simulés restent sous leur
        // nourriture : on force un surplus négatif (état artificiel) pour que la
        // baisse soit aussi exercée.
        if (turn === 1500) for (const p of state.players) p.population += 3 * FOOD.minimum;
        for (const p of state.players) {
          assert.ok(p.population >= 0);
          assert.ok(Math.abs(p.growthRemainder) < GROWTH_SCALE, `reste ${p.growthRemainder}`);
          assert.ok(p.cultivated <= p.farmTiles && p.fished <= p.seaTiles);
          assert.ok(p.wheat <= p.fertilitySum && p.fish <= p.seaTiles * FISHING.tileYield);
          assert.equal(p.fish, p.seaTiles === 0 ? 0 : FISHING.tileYield * p.fished);
          assert.ok(p.food >= FOOD.minimum && p.food === Math.max(p.wheat + p.fish, FOOD.minimum));
          assert.ok(p.farmers >= 0 && p.fishers >= 0 && p.idle >= 0);
          if (p.farmTiles === 0) assert.equal(p.cultivated, 0);
          if (p.population > maxPopulation) maxPopulation = p.population;
        }
      },
    });
    assert.ok(r.starvingPlayerTurns > 0, "le scénario doit aussi faire baisser la population");
    assert.ok(maxPopulation > POPULATION.initial / 2, `population maximale ${maxPopulation}`);
    assert.ok(r.totalPopulation > 0);
  });
});
