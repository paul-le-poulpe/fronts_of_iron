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
  DIPLOMACY,
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
  STATUS_PACT,
  STATUS_WAR,
  statusOf,
  waterYieldMilli,
  workersForLines,
  machineReference,
  type GameState,
  type ProductId,
  type Intent,
} from "@fronts-of-iron/engine";

/** Case de `Player.goods` des bateaux de pêche. */
const FISHING_BOAT = GOOD_IDS.indexOf("fishingBoat");
/** Rang du fer dans `Player.resourceTiles` (ordre des clés de RESOURCES). */
const IRON = Object.keys(RESOURCES).indexOf("iron");

import { createBot, type Bot } from "./bots.ts";
import { dominantGood } from "./names.ts";
import {
  HUMAN,
  type DiplomacyView,
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
    growthTurns: FACTORY.growthTurns,
    goodIds: GOOD_IDS,
    armamentIds: ARMAMENT_IDS,
    productionPerLine: Object.fromEntries(PRODUCT_IDS.map((id) => [id, productConfig(id).productionPerLine])),
    workersPerLine: Object.fromEntries(PRODUCT_IDS.map((id) => [id, productConfig(id).workersPerLine])),
    workersFloor: Object.fromEntries(
      PRODUCT_IDS.map((id) => [id, Math.floor((productConfig(id).workersPerLine * FACTORY.specialization.floorPercent) / 100)]),
    ),
    ironPerLine: Object.fromEntries(PRODUCT_IDS.map((id) => [id, productConfig(id).ironPerLine])),
    icons: Object.fromEntries(PRODUCT_IDS.flatMap((id) => {
      const icon = productConfig(id).icon;
      return icon === undefined ? [] : [[id, icon]];
    })),
    economy: {
      foodPerHead: POPULATION.foodPerHead,
      foodMinimum: FOOD.minimum,
      machinesPer1000: {
        tractor: FARMING.maxMachinesPer1000,
        fishingBoat: FISHING.maxMachinesPer1000,
        miningMachine: MINING.maxMachinesPer1000,
      },
      armamentDecayPercent: ARMAMENT.decayRate / 100,
      mechanization: {
        tractor: { base: FARMING.mechanizationBase, max: FARMING.mechanizationMax },
        fishingBoat: { base: FISHING.mechanizationBase, max: FISHING.mechanizationMax },
        miningMachine: { base: MINING.mechanizationBase, max: MINING.mechanizationMax },
      },
      waterYield: { base: FISHING.tileYield, max: FISHING.tileYieldMax },
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
    // Les machines que l'étape va utiliser : celles produites au tour d'avant, remplacées par `applyTurn`.
    const machinesUsed = state.players.map((p) => Object.fromEntries(GOOD_IDS.map((id, i) => [id, p.goods[i]!])));
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
      for (const f of p.factories) {
        const tree = FACTORY_TYPES[f.type].tree;
        const good = dominantGood(tree, f.groups);
        marks.push(f.city, FACTORY_TYPE_IDS.indexOf(f.type), factoryLevel(f), tree.findIndex((n) => n.good === good));
      }
    }
    const marksKey = marks.join(",");
    const factoryMarks = marksKey !== this.sentMarks ? Uint32Array.from(marks) : null;
    this.sentMarks = marksKey;

    const players: PlayerStats[] = state.players.map((p) => {
      // Référence des bateaux pour le rendement de l'eau (00-Game §6.2) : tous les
      // travailleurs hors usines et mines pourraient pêcher, plafonnés par la mer.
      const fishRef = machineReference(FISHING, p.farmers + p.fishers + p.idle, p.seaTiles);
      const fishMax = Math.floor((p.seaTiles * waterYieldMilli(fishRef, p.goods[FISHING_BOAT]!)) / 1000);
      return {
      id: p.id,
      population: p.population,
      farmers: p.farmers,
      fishers: p.fishers,
      idle: p.idle,
      food: p.food,
      wheat: p.wheat,
      fish: p.fish,
      cultivated: p.cultivated,
      mechanization: { tractor: p.farmMechanization, fishingBoat: p.fishMechanization, miningMachine: p.mineMechanization },
      machinesUsed: machinesUsed[p.id - 1]!,
      ironTiles: p.resourceTiles[IRON]!,
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
      // Nourriture si toutes les cases fertiles et toutes les cases d'eau étaient travaillées,
      // avec le rendement de l'eau des bateaux actuels (00-Game §6.4, §6.5).
      foodPotential: Math.max(FOOD.minimum, p.fertilitySum + fishMax),
      wheatMax: p.fertilitySum,
      fishMax,
      // Demande calculée par le moteur (goodsDemand) : la même que celle qui arrête la croissance des lignes.
      fullMachines: Object.fromEntries(GOOD_IDS.map((id, i) => [id, p.goodsDemand[i]!])),
      };
    });
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
      diplomacy: this.diplomacyView(),
      paused,
      perf: { bots: t1 - t0, apply: t2 - t1, pack: t3 - t2 },
    };
  }

  /**
   * Outils de développement (barre de debug, 03-Client) : modifient l'état du joueur
   * humain directement, entre deux tours, hors des règles et sans ordre. N'existent
   * qu'en solo : en multijoueur, l'état ne se modifie que par les tours (règle 3).
   */
  debug(action: "addPopulation", amount: number): void {
    if (action === "addPopulation" && Number.isInteger(amount)) {
      const p = this.state.players[HUMAN - 1]!;
      p.population = Math.max(0, p.population + amount);
    }
  }

  /**
   * Statuts du joueur humain envers chaque joueur, propositions et événements du
   * dernier tour qui le concernent. Envoyé à chaque tour : une dizaine de valeurs.
   */
  diplomacyView(): DiplomacyView {
    const state = this.state;
    const mine = (a: number, b: number): boolean => a === HUMAN || b === HUMAN;
    return {
      status: state.players.map((p) => {
        if (p.id === HUMAN) return "neutral";
        const s = statusOf(state, HUMAN, p.id);
        return s === STATUS_WAR ? "war" : s === STATUS_PACT ? "pact" : "neutral";
      }),
      proposals: state.proposals
        .filter((p) => mine(p.from, p.to))
        .map((p) => ({ from: p.from, to: p.to, kind: p.kind, startTick: p.createdTick, endTick: p.createdTick + DIPLOMACY.proposalTurns })),
      events: state.events.filter((e) => mine(e.from, e.to)),
    };
  }

  /** Le détail des usines du joueur humain (panneau de production). */
  humanDetail(): HumanDetail {
    const p = this.state.players[HUMAN - 1]!;
    // Lignes utiles de chaque groupe de biens (00-Game §8.2) : dans l'ordre de
    // remplissage du moteur, celles dont la production reste sous la demande.
    const before = new Array<number>(GOOD_IDS.length).fill(0);
    const useful = (good: string, lines: number, active: number): number => {
      const b = GOOD_IDS.indexOf(good as (typeof GOOD_IDS)[number]);
      if (b < 0) return lines;
      const per = productConfig(good as (typeof GOOD_IDS)[number]).productionPerLine;
      const n = Math.min(lines, Math.ceil(Math.max(0, p.goodsDemand[b]! - before[b]!) / per));
      before[b] = before[b]! + Math.min(active, n) * per;
      return n;
    };
    const factories = p.factories.map((f) => ({
        city: f.city,
        type: f.type,
        level: factoryLevel(f),
        groups: f.groups.map((g) => {
          const b = GOOD_IDS.indexOf(g.good as (typeof GOOD_IDS)[number]);
          const usefulLines = useful(g.good, g.lines, g.active);
          // Capacité du joueur pour ce bien : toutes ses lignes, toutes usines (00-Game §8.2).
          let capacity = 0;
          for (const o of p.factories) for (const h of o.groups) if (h.good === g.good) capacity += h.lines * productConfig(h.good).productionPerLine;
          return {
            good: g.good,
            lines: g.lines,
            active: g.active,
            filled: g.filled,
            workers: workersForLines(g.good as ProductId, g.filled),
            growth: g.growth,
            demandMet: b < 0 || capacity >= p.goodsDemand[b]!,
            usefulLines,
          };
        }),
        progress: f.progress.slice(),
      }));
    return {
      factories,
      goods: p.goods.slice(),
      reserve: p.armamentReserve.slice(),
      reserveMax: ARMAMENT_IDS.map((id) => armamentReserveMax(p, id)),
      ironCapacity: p.resourceTiles[Object.keys(RESOURCES).indexOf("iron")]! * RESOURCES.iron.capacityPerTile,
      // Fer requis : celui des lignes en service (réglage du joueur ramené aux lignes
      // utiles, 00-Game §8.2). Les lignes arrêtées parce que la demande est atteinte
      // ne demandent pas de fer : le rouge de la barre ne montre qu'un vrai manque.
      ironRequired: factories.reduce(
        (sum, f) =>
          sum + f.groups.reduce((s, g) => s + Math.min(g.active, g.usefulLines) * productConfig(g.good as ProductId).ironPerLine, 0),
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
      // Diplomatie : `applyTurn` vide les événements au début du tour, donc ceux de `state.events` sont de ce tour.
      case "declare_war":
        return state.events.some((e) => e.type === "war_declared" && e.from === HUMAN && e.to === order.target);
      case "break_pact":
        return state.events.some((e) => e.type === "pact_broken" && e.from === HUMAN && e.to === order.target);
      case "propose_pact":
        return state.events.some((e) => e.type === "proposal_sent" && e.kind === "pact" && e.from === HUMAN && e.to === order.target);
      case "propose_peace":
        return state.events.some((e) => e.type === "proposal_sent" && e.kind === "peace" && e.from === HUMAN && e.to === order.target);
      case "answer_proposal": {
        const answer = order.accept ? "proposal_accepted" : "proposal_refused";
        return state.events.some((e) => e.type === answer && e.from === order.from && e.to === HUMAN);
      }
    }
  }
}
