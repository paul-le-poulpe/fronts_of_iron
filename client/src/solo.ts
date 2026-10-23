// Partie solo : le moteur, les bots, et la fabrication des messages vers la page.
// Aucun accès au DOM ni à `self` ici : engine.worker.ts le fait tourner dans un
// Web Worker, et les tests (client/test) le font tourner dans Node.
//
// Une horloge extérieure appelle `step` une fois par tour (100 ms). Le serveur
// d'une partie en ligne ferait la même chose : rassembler les ordres du tour
// avec l'identifiant de l'expéditeur écrit par lui (règle 4 du CLAUDE.md), puis
// appeler `applyTurn`.

import {
  applyTurn,
  ARMAMENT,
  ARMAMENT_IDS,
  armamentReserveMax,
  CITY,
  createGame,
  FACTORY,
  FACTORY_TYPE_IDS,
  FACTORY_TYPES,
  factoryLevel,
  factoryOf,
  FARMING,
  FISHING,
  FOOD,
  foundingCost,
  generateTestMap,
  GOOD_IDS,
  MINING,
  POPULATION,
  PRODUCT_IDS,
  productConfig,
  RESOURCES,
  type GameState,
  type Intent,
} from "@fronts-of-iron/engine";

import { createBot, type Bot } from "./bots.ts";
import {
  HUMAN,
  type FactoryCatalog,
  type HumanDetail,
  type HumanOrder,
  type InitMessage,
  type OrderResult,
  type PlayerStats,
  type TickMessage,
} from "./protocol.ts";

export interface SoloOptions {
  readonly mapSeed: number;
  /** Nombre de bots, 1 à 7. */
  readonly bots: number;
  readonly stepMs?: number;
}

export interface PendingOrder {
  readonly id: number;
  readonly order: HumanOrder;
}

/** La configuration des usines que la page affiche (00-Game §8.4) : tout vient du moteur, rien n'est écrit en double. */
export function factoryCatalog(): FactoryCatalog {
  return {
    factoryTypes: FACTORY_TYPE_IDS.map((id) => ({
      id,
      tree: FACTORY_TYPES[id].tree.map((n) => ({ good: n.good, parent: n.parent })),
    })),
    unlockTurns: FACTORY.unlockTurns,
    workersPerLine: FACTORY.workersPerLine,
    goodIds: GOOD_IDS,
    armamentIds: ARMAMENT_IDS,
    productionPerLine: Object.fromEntries(PRODUCT_IDS.map((id) => [id, productConfig(id).productionPerLine])),
    economy: {
      foodPerHead: POPULATION.foodPerHead,
      foodMinimum: FOOD.minimum,
      machinesPer1000: {
        tractor: FARMING.maxMachinesPer1000,
        fishingBoat: FISHING.maxMachinesPer1000,
        miningMachine: MINING.maxMachinesPer1000,
      },
      armamentDecayPercent: ARMAMENT.decayRate / 100,
    },
  };
}

export const DEFAULT_STEP_MS = 100;
export const MAX_BOTS = 7;

/** Graine de la partie, tirée de celle de la carte (pas de réglage séparé en solo). */
export function gameSeedFor(mapSeed: number): number {
  return (mapSeed ^ 0x5eed5eed) >>> 0;
}

export class SoloGame {
  readonly state: GameState;
  readonly stepMs: number;
  private readonly bots: Bot[] = [];
  /** `tileCity` tel qu'envoyé à la page : sert à trouver les cases qui ont changé. */
  private readonly sentTileCity: Uint16Array;
  /** Les usines telles qu'envoyées à la page (`factoryMarks`), pour n'envoyer que les changements. */
  private sentMarks = "";

  private readonly options: SoloOptions;

  constructor(options: SoloOptions) {
    this.options = options;
    if (!Number.isInteger(options.bots) || options.bots < 1 || options.bots > MAX_BOTS) {
      throw new Error(`nombre de bots invalide : ${options.bots}`);
    }
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    const map = generateTestMap(options.mapSeed);
    this.state = createGame({
      seed: gameSeedFor(options.mapSeed),
      map,
      playerCount: 1 + options.bots,
    });
    this.sentTileCity = new Uint16Array(this.state.tileCity.length);
    for (let id = HUMAN + 1; id <= 1 + options.bots; id++) this.bots.push(createBot(id, options.mapSeed));
  }

  /** Copies de la carte (le moteur garde ses tableaux) : la page peut les recevoir par transfert. */
  init(): InitMessage {
    const { map } = this.state;
    return {
      type: "init",
      width: map.width,
      height: map.height,
      terrain: map.terrain.slice(),
      resources: map.resources.slice(),
      fertility: map.fertility.slice(),
      mapSeed: this.options.mapSeed,
      playerCount: this.state.players.length,
      expansionRadius: CITY.expansionRadius,
      controlRadius: CITY.controlRadius,
      stepMs: this.stepMs,
      catalog: factoryCatalog(),
    };
  }

  /**
   * Un tour : les ordres de l'humain (joueur 1, champ `player` écrit ici), puis
   * ceux des bots dans l'ordre de leurs identifiants, puis `applyTurn`.
   */
  step(human: readonly PendingOrder[], paused = false): TickMessage {
    const state = this.state;
    const t0 = performance.now();
    const intents: Intent[] = [];
    // Les chaînes du message (type d'usine, bien) ne sont pas typées côté page : le moteur les vérifie comme un ordre venu du réseau.
    for (const { order } of human) intents.push({ ...order, player: HUMAN } as Intent);
    for (const bot of this.bots) bot.step(state, intents);
    const t1 = performance.now();

    const citiesBefore = state.cities.length;
    // Pour reconnaître une usine ou une ligne créée par ce tour : l'état avant les ordres.
    const linesBefore = human.length > 0 ? this.lineCounts() : null;
    applyTurn(state, { turn: state.tick + 1, intents });
    const t2 = performance.now();

    const results: OrderResult[] = human.map(({ id, order }) => ({
      id,
      order,
      applied: this.wasApplied(order, citiesBefore, linesBefore),
    }));

    // `tileCity` ne change que quand une ville est fondée : sinon, rien à comparer.
    // `applyTurn` ne renvoie pas les cases qui passent d'une ville à une autre
    // du même joueur ; la comparaison avec ce qui a été envoyé les trouve.
    let tiles: Uint32Array;
    let cities: Uint32Array | null = null;
    let roads: Uint16Array | null = null;
    if (state.cities.length !== citiesBefore) {
      const list: number[] = [];
      const now = state.tileCity;
      const sent = this.sentTileCity;
      for (let t = 0; t < now.length; t++) {
        if (now[t] !== sent[t]) {
          list.push(t, now[t]!);
          sent[t] = now[t]!;
        }
      }
      tiles = Uint32Array.from(list);
      cities = new Uint32Array(state.cities.length * 4);
      state.cities.forEach((c, i) => {
        cities![4 * i] = c.player;
        cities![4 * i + 1] = c.tile;
        cities![4 * i + 2] = c.port ? 1 : 0;
        cities![4 * i + 3] = c.group;
      });
      roads = new Uint16Array(state.roads.length * 2);
      state.roads.forEach(([a, b], i) => {
        roads![2 * i] = a;
        roads![2 * i + 1] = b;
      });
    } else {
      tiles = new Uint32Array(0);
    }

    // Usines de tous les joueurs (marqueurs de la carte) : envoyées seulement quand elles changent.
    const marks: number[] = [];
    for (const p of state.players) {
      for (const f of p.factories) marks.push(f.city, FACTORY_TYPE_IDS.indexOf(f.type), factoryLevel(f));
    }
    const marksKey = marks.join(",");
    const factoryMarks = marksKey !== this.sentMarks ? Uint32Array.from(marks) : null;
    this.sentMarks = marksKey;

    const players: PlayerStats[] = state.players.map((p) => ({
      id: p.id,
      population: p.population,
      farmers: p.farmers,
      fishers: p.fishers,
      idle: p.idle,
      food: p.food,
      wheat: p.wheat,
      fish: p.fish,
      cultivated: p.cultivated,
      farmTiles: p.farmTiles,
      fished: p.fished,
      seaTiles: p.seaTiles,
      farmPercent: p.farmPercent,
      capital: p.capital,
      cities: p.cityIds.length,
      foundingCost: foundingCost(p.cityIds.length),
      factoryWorkers: p.factoryWorkers,
      miners: p.miners,
      minedTiles: p.minedTiles,
      ironExtracted: p.ironExtracted,
    }));
    const t3 = performance.now();

    return {
      type: "tick",
      tick: state.tick,
      tiles,
      cities,
      roads,
      factoryMarks,
      human: this.humanDetail(),
      players,
      results,
      paused,
      perf: { bots: t1 - t0, apply: t2 - t1, pack: t3 - t2 },
    };
  }

  /** Le détail des usines du joueur humain (panneau de production). */
  humanDetail(): HumanDetail {
    const p = this.state.players[HUMAN - 1]!;
    return {
      factories: p.factories.map((f) => ({
        city: f.city,
        type: f.type,
        level: factoryLevel(f),
        groups: f.groups.map((g) => ({ good: g.good, lines: g.lines, active: g.active, filled: g.filled })),
        progress: f.progress.slice(),
      })),
      goods: p.goods.slice(),
      reserve: p.armamentReserve.slice(),
      reserveMax: ARMAMENT_IDS.map((id) => armamentReserveMax(p, id)),
      ironCapacity: p.resourceTiles[Object.keys(RESOURCES).indexOf("iron")]! * RESOURCES.iron.capacityPerTile,
      ironRequired: p.factories.reduce(
        (sum, f) => sum + f.groups.reduce((s, g) => s + g.active * productConfig(g.good).ironPerLine, 0),
        0,
      ),
    };
  }

  /** Lignes du joueur humain par « ville:bien », et « ville: » pour chaque usine. */
  private lineCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const f of this.state.players[HUMAN - 1]!.factories) {
      counts.set(`${f.city}:`, 0);
      for (const g of f.groups) counts.set(`${f.city}:${g.good}`, g.lines);
    }
    return counts;
  }

  /** Le moteur a-t-il appliqué cet ordre humain ? (`applyTurn` ne le dit pas : on regarde l'état.) */
  private wasApplied(order: HumanOrder, citiesBefore: number, linesBefore: Map<string, number> | null): boolean {
    const state = this.state;
    const me = state.players[HUMAN - 1]!;
    switch (order.type) {
      case "set_farm_share":
        return Number.isInteger(order.percent) && me.farmPercent === order.percent;
      case "found_city":
        for (let i = citiesBefore; i < state.cities.length; i++) {
          const c = state.cities[i]!;
          if (c.player === HUMAN && c.tile === order.tile) return true;
        }
        return false;
      case "build_factory":
        return !linesBefore?.has(`${order.city}:`) && factoryOf(me, order.city)?.type === order.factoryType;
      case "create_line": {
        const lines = factoryOf(me, order.city)?.groups.find((g) => g.good === order.good)?.lines ?? 0;
        return lines > (linesBefore?.get(`${order.city}:${order.good}`) ?? 0);
      }
      case "set_active_lines":
        return factoryOf(me, order.city)?.groups.find((g) => g.good === order.good)?.active === order.count;
      case "set_city_priority":
        return me.factories[order.position]?.city === order.city;
      case "set_line_priority":
        return factoryOf(me, order.city)?.groups[order.position]?.good === order.good;
    }
  }
}
