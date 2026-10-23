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
  CITY,
  createGame,
  generateTestMap,
  type GameState,
  type Intent,
} from "@fronts-of-iron/engine";

import { createBot, type Bot } from "./bots.ts";
import {
  HUMAN,
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
      foundingCost: CITY.foundingCostPopulation,
      stepMs: this.stepMs,
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
    for (const { order } of human) intents.push({ ...order, player: HUMAN });
    for (const bot of this.bots) bot.step(state, intents);
    const t1 = performance.now();

    const citiesBefore = state.cities.length;
    applyTurn(state, { turn: state.tick + 1, intents });
    const t2 = performance.now();

    const results: OrderResult[] = human.map(({ id, order }) => ({
      id,
      order,
      applied: this.wasApplied(order, citiesBefore),
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
    }));
    const t3 = performance.now();

    return {
      type: "tick",
      tick: state.tick,
      tiles,
      cities,
      roads,
      players,
      results,
      paused,
      perf: { bots: t1 - t0, apply: t2 - t1, pack: t3 - t2 },
    };
  }

  /** Le moteur a-t-il appliqué cet ordre humain ? (`applyTurn` ne le dit pas : on regarde l'état.) */
  private wasApplied(order: HumanOrder, citiesBefore: number): boolean {
    const state = this.state;
    if (order.type === "set_farm_share") {
      return Number.isInteger(order.percent) && state.players[HUMAN - 1]!.farmPercent === order.percent;
    }
    for (let i = citiesBefore; i < state.cities.length; i++) {
      const c = state.cities[i]!;
      if (c.player === HUMAN && c.tile === order.tile) return true;
    }
    return false;
  }
}
