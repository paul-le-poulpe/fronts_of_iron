// La partie (Docs/Design/03-Client.md §8) : le moteur d'un client et la fabrication des messages
// vers la page. Elle applique les tours que lui donne une source de tours — locale (`solo.ts`)
// ou WebSocket (`online-game.ts`) — et ne sait pas laquelle. Aucun accès au DOM ni à `self` ici :
// engine.worker.ts la fait tourner dans un Web Worker, et les tests (client/test) dans Node.
//
// Le joueur local est `you` : l'humain du solo (HUMAN) ou le joueur du message de départ en ligne.

import {
  ACTIVITY_DATA,
  ACTIVITY_IDS,
  activityOf,
  applyTurn as applyEngineTurn,
  CITY,
  createGame,
  DIVISION_DATA,
  DIVISION_IDS,
  DIVISIONS,
  DIVISION_TIMING,
  divisionCount,
  divisionLimit,
  DIPLOMACY,
  ELITE_TROOPS_RATIO,
  FARMING,
  FISHING,
  FOOD,
  FRONTS,
  foundingCostPawns,
  generateTestMap,
  setupTestGame,
  TEST_SCENARIOS,
  type TestScenarioId,
  GOOD_IDS,
  GOODS,
  GOODS_TIMING,
  HURT,
  hurtHealTurnsLeft,
  IDLE,
  idlePawns,
  inFormation,
  LINE_BOX,
  LINE_FIRST,
  LINE_RAPID,
  isActive,
  isFleeing,
  machineCount,
  machineLimit,
  MINING,
  NICHES,
  POPULATION,
  STATE_SCALE,
  stateOf,
  RESOURCES,
  STATUS_PACT,
  STATUS_WAR,
  statusOf,
  advanceOf,
  type Breakthrough,
  type Division,
  type Front,
  type GameState,
  type Intent,
} from "@fronts-of-iron/engine";

/** Rang du fer dans `Player.resourceTiles` (ordre des clés de RESOURCES). */
const IRON = Object.keys(RESOURCES).indexOf("iron");

import { isMapId, type MapId, type TurnData } from "@fronts-of-iron/shared";

import {
  type DiplomacyView,
  FORMATION_STEPS,
  type ActivityCatalog,
  type ActivityView,
  type CombatView,
  type DivisionView,
  type FrontView,
  type HumanDetail,
  type MilitaryCatalog,
  type HumanOrder,
  type InitMessage,
  type OrderResult,
  type PlayerStats,
  type TickMessage,
} from "./protocol.ts";

/** Ce qu'il faut pour créer la partie : identique chez tous les joueurs (message de départ, 01-Architecture §4). */
export interface GameOptions {
  /** Graine de la carte ; la graine de la partie s'en déduit (`gameSeedFor`). */
  readonly mapSeed: number;
  readonly map?: MapId;
  /** Les joueurs, identifiants 1 à n sans trou, avec leur nom. */
  readonly players: readonly { readonly id: number; readonly name: string; readonly color: number }[];
  /** Le joueur de ce client. */
  readonly you: number;
  /** Durée d'un tour en ms, envoyée à la page pour son affichage seulement. */
  readonly stepMs: number;
  /** Partie de test (solo, développement) : économie gelée et état de départ de `setupTestGame`, pour ce scénario de `TEST_SCENARIOS`. */
  readonly testGame?: string;
}

/** Ce que `applyTurn` ajoute au message de la page, selon la source de tours. */
export interface TurnContext {
  /** Identifiants que la page a donnés aux ordres du joueur local de ce tour, dans l'ordre ; 0 si inconnus. */
  readonly ids?: readonly number[];
  /** Durée mesurée des bots (solo), en ms. */
  readonly botsMs?: number;
  /**
   * Premier message après un rejeu de la partie (reprise) : la page repart de rien, donc il porte tout ce
   * que les messages précédents auraient apporté (toutes les cases, les villes, les fronts) et aucun
   * événement du tour (prises de villes, diplomatie, résultats des ordres), qui appartiennent au passé.
   */
  readonly full?: boolean;
}

export interface PendingOrder {
  readonly id: number;
  readonly order: HumanOrder;
}

/** La configuration des activités que la page affiche (08 §2, §9) : tout vient du moteur, rien n'est écrit en double. */
export function activityCatalog(): ActivityCatalog {
  const tiles = (kind: string): number => (kind === "farming" ? FARMING.tilesPerWorker : kind === "fishing" ? FISHING.tilesPerWorker : kind === "mining" ? MINING.tilesPerWorker : 0);
  return {
    activities: ACTIVITY_DATA.map((d) => ({
      id: d.id,
      index: d.index,
      kind: d.kind,
      parent: d.parent < 0 ? null : ACTIVITY_IDS[d.parent]!,
      unlockCost: d.unlockCost,
      unlockByWorkers: d.unlockByWorkers,
      unlockByPopulation: d.unlockByPopulation,
      workersPerUnit: d.workersPerUnit,
      unitsPerWorker: d.unitsPerWorker,
      hasSlots: d.hasSlots,
      hasPlaces: d.hasPlaces,
      ironPerUnit: d.ironPerUnit,
      good: d.good < 0 ? null : GOOD_IDS[d.good]!,
      division: d.division < 0 ? null : DIVISION_IDS[d.division]!,
      tilesPerWorker: tiles(d.kind),
    })),
    goodIds: GOOD_IDS,
    icons: Object.fromEntries(GOOD_IDS.map((id) => [id, GOODS[id].icon])),
    popArrivalTurns: POPULATION.arrivalTurns,
    popLeaveTurns: POPULATION.leaveTurns,
    machineArrivalTurns: GOODS_TIMING.arrivalTurns,
    machineLeaveTurns: GOODS_TIMING.leaveTurns,
    divisionLeaveTurns: DIVISION_TIMING.leaveTurns,
    foodPerPawn: POPULATION.foodPerPawn,
    foodBase: FOOD.base,
    foodPerCity: FOOD.perCity,
    ironPerTile: RESOURCES.iron.capacityPerTile,
    fishYield: FISHING.foodPerWorker / FISHING.tilesPerWorker,
  };
}

/** Types de division, niches et réglages des fronts que la page affiche (05-Fronts §3, §12) : tout vient du moteur. */
export function militaryCatalog(): MilitaryCatalog {
  return {
    divisions: DIVISION_DATA.map((d) => {
      const config = DIVISIONS[d.id] as { readonly icon: string; readonly description?: string };
      return {
        id: d.id,
        index: d.index,
        niche: Object.keys(NICHES)[d.niche]!,
        rank: d.rank,
        support: d.support,
        softAttack: d.softAttack,
        hardAttack: d.hardAttack,
        airAttack: d.airAttack,
        icon: config.icon,
        description: config.description ?? "",
        frontWidth: d.width / 1000,
        breakthroughWidth: d.breakthroughWidth / 1000,
        productionTurns: d.productionTurns,
        elite: d.elite,
        hitPoints: d.hitPoints,
        defenseHitPointsMultiplier: d.defenseHitPointsMultiplier,
        attackMultiplier: d.attackMultiplier,
        breakthroughMultiplier: d.breakthroughMultiplier,
        counterAttackMultiplier: d.counterAttackMultiplier,
        armorPercent: d.armorPercent,
        motorized: d.motorized,
      };
    }),
    niches: Object.entries(NICHES).map(([id, n]) => ({ id, support: n.support, types: [...n.types] })),
    combatTurns: FRONTS.combatTurns,
    eliteTroopsRatio: ELITE_TROOPS_RATIO,
    transferTurns: FRONTS.transferRounds * FRONTS.combatTurns,
    stateScale: STATE_SCALE,
    breakthroughDelayTurns: FRONTS.breakthroughDelayTurns,
    attackCooldownTurns: FRONTS.attackCooldownTurns,
    combatMaxRounds: FRONTS.combatMaxRounds,
    reinforceRounds: FRONTS.reinforceRounds,
    fleeStatePercent: FRONTS.fleeStatePercent,
    advanceThresholdA: FRONTS.advanceThresholdA,
    advanceThresholdB: FRONTS.advanceThresholdB,
    footSpeedPermille: FRONTS.footSpeedPermille,
    motorizedSpeedPermille: FRONTS.motorizedSpeedPermille,
  };
}

/** Tour où prend fin le délai d'une percée (toutes les phases sauf les deux combats, 1 et 3) ; 0 pendant un combat (05-Fronts §7.2). */
function delayEnd(b: Breakthrough): number {
  return b.phase === 1 || b.phase === 3 ? 0 : b.phaseTick + FRONTS.breakthroughDelayTurns;
}

/** Un front tel que la page le lit (05-Fronts §13.4). */
export function frontView(state: GameState, f: Front): FrontView {
  return {
    id: f.id,
    players: [f.players[0], f.players[1]],
    groups: [f.groups[0], f.groups[1]],
    active: isActive(state, f),
    connections: f.connections.map((c) => ({ city1: c.city1, city2: c.city2, position: c.position })),
    sides: [
      { attackReadyAt: f.sides[0].attackReadyAt, lastLossByNiche: f.sides[0].lastLossByNiche.slice() },
      { attackReadyAt: f.sides[1].attackReadyAt, lastLossByNiche: f.sides[1].lastLossByNiche.slice() },
    ],
    boxes: state.boxes.filter((b) => b.front === f.id).map((b) => ({ id: b.id, owner: b.owner })),
    breakthroughs: state.breakthroughs
      .filter((b) => b.front === f.id)
      .map((b) => ({ id: b.id, owner: b.owner, box: b.box, city1: b.city1, city2: b.city2, phase: b.phase, until: delayEnd(b), advance: advanceOf(f, b) })),
  };
}

/** Une division telle que la page la lit (05-Fronts §13.4). Statut : formation, puis déplacement, puis fuite. */
export function divisionView(state: GameState, d: Division): DivisionView {
  const status = inFormation(state, d) ? "formation" : d.arrivalTick !== 0 ? "moving" : isFleeing(state, d) ? "fleeing" : "ready";
  return {
    id: d.id,
    owner: d.owner,
    type: d.type,
    front: d.front,
    line: d.line === LINE_FIRST ? "first" : d.line === LINE_RAPID ? "rapid" : d.line === LINE_BOX ? "box" : "second",
    box: d.box,
    breakthrough: d.breakthrough,
    btEngaged: d.btEngaged,
    engaged: d.engaged,
    state: stateOf(d),
    status,
    until: status === "formation" ? d.formedTick : status === "moving" ? d.arrivalTick : status === "fleeing" ? d.fleeUntilTick : 0,
    formed: status === "formation" ? formedSteps(state, d) : 0,
    leaveTick: d.leaveTick,
  };
}

/** Part écoulée de la formation : elle a commencé `productionTurns` tours avant `formedTick`. */
function formedSteps(state: GameState, d: Division): number {
  const total = DIVISION_DATA[d.type]!.productionTurns;
  return Math.max(0, Math.floor((FORMATION_STEPS * (total - (d.formedTick - (state.tick + 1)))) / total));
}

export const DEFAULT_STEP_MS = 100;

/** Graine de la partie, tirée de celle de la carte (pas de réglage séparé : le message de départ ne donne qu'une graine). */
export function gameSeedFor(mapSeed: number): number {
  return (mapSeed ^ 0x5eed5eed) >>> 0;
}

/** Vrai si les joueurs sont numérotés de 1 à n sans trou et que `you` en fait partie. */
export function validRoster(players: readonly { readonly id: number }[], you: number): boolean {
  return players.length >= 1 && players.every((p, i) => p.id === i + 1) && you >= 1 && you <= players.length;
}

export class Game {
  readonly state: GameState;
  readonly stepMs: number;
  /** Le joueur de ce client. */
  readonly you: number;
  /** `tileCity` tel qu'envoyé à la page : sert à trouver les cases qui ont changé. */
  private readonly sentTileCity: Uint16Array;
  private readonly sentTileFisher: Uint16Array;
  /** Les fronts tels qu'envoyés à la page (JSON), pour n'envoyer que les changements. */
  private sentFronts = "";
  /** Les divisions telles qu'envoyées à la page (JSON), pour n'envoyer que les changements. */
  private sentDivisions = "";
  private sentCombats = "";
  /** Le premier tour a été envoyé (partie de test : il porte les villes de départ). */
  private initialSent = false;

  private readonly options: GameOptions;

  constructor(options: GameOptions) {
    this.options = options;
    if (!validRoster(options.players, options.you)) throw new Error("liste de joueurs invalide");
    if (options.map !== undefined && !isMapId(options.map)) throw new Error(`carte inconnue : ${String(options.map)}`);
    this.you = options.you;
    this.stepMs = options.stepMs;
    const map = generateTestMap(options.mapSeed);
    this.state = createGame({
      seed: gameSeedFor(options.mapSeed),
      map,
      playerCount: options.players.length,
      ...(options.testGame !== undefined ? { freezeEconomy: true } : {}),
    });
    if (options.testGame !== undefined) {
      if (!(options.testGame in TEST_SCENARIOS)) throw new Error(`scénario de test inconnu : ${options.testGame}`);
      setupTestGame(this.state, options.testGame as TestScenarioId);
    }
    this.sentTileCity = new Uint16Array(this.state.tileCity.length);
    this.sentTileFisher = new Uint16Array(this.state.tileFisher.length);
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
      you: this.you,
      playerNames: this.options.players.map((p) => p.name),
      playerColors: this.options.players.map((p) => p.color),
      expansionRadius: CITY.expansionRadius,
      controlRadius: CITY.controlRadius,
      fishingRadius: CITY.fishingRadius,
      stepMs: this.stepMs,
      catalog: activityCatalog(),
      military: militaryCatalog(),
    };
  }

  /**
   * Applique un tour au moteur, sans fabriquer de message : les tours d'un rejeu, que la page n'a pas à
   * redessiner un par un. Lève une erreur si le numéro n'est pas `state.tick + 1`.
   */
  advance(turn: TurnData): void {
    // Les ordres viennent du relais : le moteur les vérifie comme un ordre venu du réseau.
    applyEngineTurn(this.state, { turn: turn.turn, intents: turn.orders as unknown as readonly Intent[] });
  }

  /**
   * Applique un tour et fabrique le message de la page. Les ordres du joueur local (`player === you`) y
   * reçoivent leur résultat ; ceux des autres joueurs n'ont pas de résultat.
   */
  applyTurn(turn: TurnData, context: TurnContext = {}): TickMessage {
    const state = this.state;
    const you = this.you;
    const full = context.full === true;
    const human: PendingOrder[] = [];
    for (const { player, ...order } of turn.orders) {
      if (player === you) human.push({ id: context.ids?.[human.length] ?? 0, order: order as unknown as HumanOrder });
    }

    const citiesBefore = state.cities.length;
    // Partie de test : les villes existent avant le premier tour, qui doit donc les envoyer (villes, zones, routes, fronts).
    const initial = this.options.testGame !== undefined && !this.initialSent;
    this.initialSent = true;
    // Pour reconnaître l'effet d'un déplacement de pions : l'état avant les ordres.
    const pawnsBefore = human.length > 0 ? this.pawnCounts() : null;
    const t1 = performance.now();
    this.advance(turn);
    const t2 = performance.now();

    const captured = full ? [] : state.events.flatMap((e) => (e.type === "city_captured" ? [{ city: e.city, from: e.from, to: e.to }] : []));
    const results: OrderResult[] = full
      ? []
      : human.map(({ id, order }) => ({
          id,
          order,
          applied: this.wasApplied(order, citiesBefore, pawnsBefore),
        }));

    // `tileCity` ne change que quand une ville est fondée : sinon, rien à comparer.
    // `applyTurn` ne renvoie pas les cases qui passent d'une ville à une autre
    // du même joueur ; la comparaison avec ce qui a été envoyé les trouve.
    let tiles: Uint32Array;
    let fishers: Uint32Array;
    let cities: Uint32Array | null = null;
    let roads: Uint16Array | null = null;
    if (full || initial || state.cities.length !== citiesBefore || captured.length > 0) {
      const list: number[] = [];
      const now = state.tileCity;
      const sent = this.sentTileCity;
      for (let t = 0; t < now.length; t++) {
        if (now[t] !== sent[t]) {
          list.push(t, now[t]!);
          sent[t] = now[t]!;
        }
      }
      // Une ville prise change de joueur sans que `tileCity` change : sa zone est renvoyée pour être repeinte.
      for (const c of captured) {
        const tile = state.cities[c.city - 1]!.tile;
        const r = CITY.controlRadius;
        const w = state.map.width;
        for (let y = Math.max(0, Math.floor(tile / w) - r); y <= Math.min(state.map.height - 1, Math.floor(tile / w) + r); y++) {
          for (let x = Math.max(0, (tile % w) - r); x <= Math.min(w - 1, (tile % w) + r); x++) {
            if (now[y * w + x] === c.city) list.push(y * w + x, c.city);
          }
        }
      }
      tiles = Uint32Array.from(list);
      const fishList: number[] = [];
      const fisherNow = state.tileFisher;
      const fisherSent = this.sentTileFisher;
      const taken = new Set(captured.map((c) => c.city));
      for (let t = 0; t < fisherNow.length; t++) {
        if (fisherNow[t] !== fisherSent[t] || taken.has(fisherNow[t]!)) {
          fishList.push(t, fisherNow[t]!);
          fisherSent[t] = fisherNow[t]!;
        }
      }
      fishers = Uint32Array.from(fishList);
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
      fishers = new Uint32Array(0);
    }

    // Fronts : reconstruits à chaque round, quand le joueur a donné un ordre ou quand les villes changent.
    let fronts: FrontView[] | null = null;
    if (full || initial || state.tick % FRONTS.combatTurns === 0 || human.length > 0 || state.cities.length !== citiesBefore || captured.length > 0) {
      const views = state.fronts.map((f) => frontView(state, f));
      const key = JSON.stringify(views);
      if (full || key !== this.sentFronts) {
        this.sentFronts = key;
        fronts = views;
      }
    }
    // Divisions : renfort, arrivées et pertes les changent à n'importe quel tour.
    let divisions: DivisionView[] | null = null;
    const divisionViews = state.divisions.map((d) => divisionView(state, d));
    const divisionsKey = JSON.stringify(divisionViews);
    if (full || divisionsKey !== this.sentDivisions) {
      this.sentDivisions = divisionsKey;
      divisions = divisionViews;
    }

    // Combats du joueur local (06-Combat-Simplifie §1) : la liste ne change qu'à un nouveau combat ou à une suppression.
    const myCombats = state.combats.filter((c) => c.attacker === you || c.defender === you);
    const combatsKey = myCombats.map((c) => c.id).join(",");
    const combats: CombatView[] | null = full || combatsKey !== this.sentCombats ? myCombats.map((c) => structuredClone(c)) : null;
    this.sentCombats = combatsKey;

    const players: PlayerStats[] = state.players.map((p) => {
      const workers = (kind: string): number => p.activities.filter((a) => ACTIVITY_DATA[a.id]!.kind === kind).reduce((n, a) => n + a.workers, 0);
      return {
        id: p.id,
        population: p.population,
        capacity: p.capacity,
        idle: idlePawns(p),
        hurt: activityOf(p, HURT)!.workers,
        farmers: workers("farming"),
        fishers: workers("fishing"),
        miners: workers("mining"),
        soldiers: workers("barracks"),
        divisions: state.divisions.filter((d) => d.owner === p.id).length,
        food: p.food,
        wheat: p.wheat,
        fish: p.fish,
        cultivated: p.cultivated,
        fished: p.fished,
        minedTiles: p.minedTiles,
        farmTiles: p.farmTiles,
        seaTiles: p.seaTiles,
        ironProduced: p.ironProduced,
        ironReserved: p.ironReserved,
        capital: p.capital,
        cities: p.cityIds.length,
        defeated: p.defeated,
        foundingCost: foundingCostPawns(p.cityIds.length),
      };
    });
    const t3 = performance.now();

    return {
      type: "tick",
      tick: state.tick,
      tiles,
      fishers,
      cities,
      roads,
      human: this.humanDetail(),
      players,
      results,
      diplomacy: this.diplomacyView(full),
      fronts,
      divisions,
      combats,
      failedBreakthroughs: full ? 0 : state.events.filter((e) => e.type === "breakthrough_failed" && e.from === you).length,
      captured,
      encircled: full ? [] : state.events.flatMap((e) => (e.type === "encirclement" ? [{ city: e.city, from: e.from, to: e.to, divisions: e.divisions }] : [])),
      eliminated: full ? [] : state.events.flatMap((e) => (e.type === "player_eliminated" ? [{ player: e.to, by: e.from }] : [])),
      paused: false,
      perf: { bots: context.botsMs ?? 0, apply: t2 - t1, pack: t3 - t2 },
    };
  }

  /**
   * Outils de développement (barre de debug, 03-Client) : modifient l'état du joueur
   * local directement, entre deux tours, hors des règles et sans ordre. N'existent
   * qu'en solo : en ligne, l'état ne se modifie que par les tours (règle 3).
   */
  debug(action: "addPopulation" | "armBots", amount: number): void {
    if (!Number.isInteger(amount)) return;
    const grant = (p: GameState["players"][number], n: number): void => {
      const n2 = Math.max(n, -idlePawns(p));
      activityOf(p, IDLE)!.workers += n2;
      p.population += n2;
    };
    if (action === "addPopulation") grant(this.state.players[this.you - 1]!, amount);
    if (action === "armBots") {
      for (const p of this.state.players) if (p.id !== this.you) grant(p, amount);
    }
  }

  /**
   * Statuts du joueur local envers chaque joueur, propositions et événements du
   * dernier tour qui le concernent. Envoyé à chaque tour : une dizaine de valeurs.
   * `withoutEvents` : après un rejeu, les événements du dernier tour appartiennent au passé.
   */
  diplomacyView(withoutEvents = false): DiplomacyView {
    const state = this.state;
    const mine = (a: number, b: number): boolean => a === this.you || b === this.you;
    return {
      status: state.players.map((p) => {
        if (p.id === this.you) return "neutral";
        const s = statusOf(state, this.you, p.id);
        return s === STATUS_WAR ? "war" : s === STATUS_PACT ? "pact" : "neutral";
      }),
      proposals: state.proposals
        .filter((p) => mine(p.from, p.to))
        .map((p) => ({ from: p.from, to: p.to, kind: p.kind, startTick: p.createdTick, endTick: p.createdTick + DIPLOMACY.proposalTurns })),
      events: withoutEvents ? [] : state.events.flatMap((e) => (e.type !== "city_captured" && e.type !== "encirclement" && e.type !== "player_eliminated" && e.type !== "breakthrough_failed" && mine(e.from, e.to) ? [e] : [])),
    };
  }

  /** Les activités du joueur humain (panneau de production). */
  humanDetail(): HumanDetail {
    const state = this.state;
    const p = state.players[this.you - 1]!;
    const activities: ActivityView[] = p.activities.map((a) => {
      const d = ACTIVITY_DATA[a.id]!;
      const product = d.kind === "factory" || d.kind === "barracks";
      const machine = d.kind === "factory" && d.good >= 0;
      return {
        id: d.id,
        workers: a.workers,
        machines: a.machines,
        places: a.places,
        slots: a.slots,
        surface: d.kind === "farming" ? p.farmTiles : d.kind === "fishing" ? p.seaTiles : d.kind === "mining" ? p.resourceTiles[IRON]! : 0,
        disabled: a.disabled,
        output: a.output,
        ironUsed: a.ironUsed,
        forming: d.division < 0 ? 0 : state.divisions.filter((x) => x.owner === p.id && x.type === d.division && inFormation(state, x)).length,
        existing: !product ? -1 : machine ? machineCount(p, d.good) : divisionCount(state, p.id, d.division),
        limit: !product ? -1 : machine ? machineLimit(p, d.good) : divisionLimit(p, d.division),
      };
    });
    const served = ACTIVITY_DATA.map((d) => {
      const a = activityOf(p, d.index);
      return a === undefined ? 0 : Math.ceil((a.output * d.workersPerUnit) / d.unitsPerWorker);
    });
    return {
      tick: state.tick,
      activities,
      cities: p.cityIds.length,
      wheat: p.wheat,
      fish: p.fish,
      farmPerWorker: p.farmTiles === 0 ? 0 : Math.floor((p.fertilitySum * FARMING.tilesPerWorker) / p.farmTiles),
      fishPerWorker: FISHING.foodPerWorker,
      autoAssign: p.autoAssign,
      unlock: p.unlock.slice(),
      everOpened: p.everOpened.slice(),
      served,
      idleMachines: p.idleMachines.slice(),
      popArrivals: p.popArrivals.slice(),
      popLeaves: p.popLeaves.slice(),
      machineArrivals: p.machineArrivals.map((a) => a.slice()),
      machineLeaves: p.machineLeaves.map((a) => a.slice()),
      hurtHealPercent: Math.floor((p.hurtHeal * 100) / POPULATION.hurtHealTurnsTimesPop),
      hurtHealTurnsLeft: hurtHealTurnsLeft(p),
      capacity: p.capacity,
      ironProduced: p.ironProduced,
      ironReserved: p.ironReserved,
      ironWanted: p.ironWanted,
      ironMax: (activityOf(p, ACTIVITY_DATA.findIndex((d) => d.kind === "mining"))?.slots ?? 0) * MINING.tilesPerWorker * RESOURCES.iron.capacityPerTile,
    };
  }

  /** Pions du joueur humain par « w:activité » (bonshommes), « m:activité » (machines), « p:activité » (places) et « i:bien » (Inactifs). */
  private pawnCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const p = this.state.players[this.you - 1]!;
    for (const a of p.activities) {
      const id = ACTIVITY_IDS[a.id]!;
      counts.set(`w:${id}`, a.workers);
      counts.set(`m:${id}`, a.machines);
      counts.set(`p:${id}`, a.places);
    }
    GOOD_IDS.forEach((id, g) => counts.set(`i:${id}`, p.idleMachines[g]!));
    return counts;
  }

  /** Le camp du joueur humain dans le front, ou undefined. */
  private mySide(frontId: number): Front["sides"][number] | undefined {
    const f = this.state.fronts.find((x) => x.id === frontId);
    const i = f === undefined ? -1 : f.players.indexOf(this.you);
    return f === undefined || i < 0 ? undefined : f.sides[i];
  }

  /** Le moteur a-t-il appliqué cet ordre humain ? (`applyTurn` ne le dit pas : on regarde l'état.) */
  private wasApplied(order: HumanOrder, citiesBefore: number, pawnsBefore: Map<string, number> | null): boolean {
    const state = this.state;
    const me = state.players[this.you - 1]!;
    switch (order.type) {
      case "found_city":
        for (let i = citiesBefore; i < state.cities.length; i++) {
          const c = state.cities[i]!;
          if (c.player === this.you && c.tile === order.tile) return true;
        }
        return false;
      // Pions : le moteur ne le dit pas, on compare avec l'état d'avant les ordres (approximation : plusieurs ordres du même tour se mélangent).
      case "move_pawn": {
        const now = this.pawnCounts();
        const was = (key: string): number => pawnsBefore?.get(key) ?? 0;
        if (order.kind === "worker") return (now.get(`w:${order.to}`) ?? 0) !== was(`w:${order.to}`) || (now.get(`p:${order.to}`) ?? 0) !== was(`p:${order.to}`);
        const gain = (id: string): number => (id === "idle" ? (now.get(`i:${order.good}`) ?? 0) - was(`i:${order.good}`) : (now.get(`m:${id}`) ?? 0) - was(`m:${id}`));
        return gain(order.to) > 0;
      }
      case "set_activity_order":
        return me.activities[order.position]?.id === ACTIVITY_IDS.indexOf(order.activity as (typeof ACTIVITY_IDS)[number]);
      case "open_activity":
        return me.activities.some((a) => a.id === ACTIVITY_IDS.indexOf(order.activity as (typeof ACTIVITY_IDS)[number]));
      case "close_activity":
        return !me.activities.some((a) => a.id === ACTIVITY_IDS.indexOf(order.activity as (typeof ACTIVITY_IDS)[number]));
      case "change_production_target":
        return (this.pawnCounts().get(`p:${order.activity}`) ?? 0) !== (pawnsBefore?.get(`p:${order.activity}`) ?? 0);
      case "set_auto_assign":
        return me.autoAssign === order.enabled;
      case "set_disabled_slots":
        return me.activities.find((a) => a.id === ACTIVITY_IDS.indexOf(order.activity as (typeof ACTIVITY_IDS)[number]))?.disabled === order.count;
      // Diplomatie : `applyTurn` vide les événements au début du tour, donc ceux de `state.events` sont de ce tour.
      case "declare_war":
        return state.events.some((e) => e.type === "war_declared" && e.from === this.you && e.to === order.target);
      case "break_pact":
        return state.events.some((e) => e.type === "pact_broken" && e.from === this.you && e.to === order.target);
      case "propose_pact":
        return state.events.some((e) => e.type === "proposal_sent" && e.kind === "pact" && e.from === this.you && e.to === order.target);
      case "propose_peace":
        return state.events.some((e) => e.type === "proposal_sent" && e.kind === "peace" && e.from === this.you && e.to === order.target);
      case "answer_proposal": {
        const answer = order.accept ? "proposal_accepted" : "proposal_refused";
        return state.events.some((e) => e.type === answer && e.from === order.from && e.to === this.you);
      }
      // Fronts : le réglage demandé est dans l'état.
      case "move_division":
        return order.ids.some((id) => state.divisions.find((d) => d.id === id)?.front === order.front);
      case "start_breakthrough":
        return state.breakthroughs.some((b) => b.owner === this.you && b.box === order.box && b.city1 === order.city1 && b.city2 === order.city2);
      case "cancel_breakthrough":
        return !state.breakthroughs.some((b) => b.id === order.id);
      case "start_front_attack":
        return state.combats.some((c) => c.tick === state.tick && c.kind === "front" && c.front === order.front && c.attacker === this.you);
    }
  }
}
