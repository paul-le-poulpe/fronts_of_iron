// Partie scriptée pour les tests et la mesure : des joueurs simulés envoient des
// ordres `found_city` tirés au hasard (dont beaucoup sont invalides), de temps en
// temps un ordre sur leurs activités (08 §10), et un ordre malformé par tour. Les
// villes sont payées en bonshommes. Les ordres ne dépendent que de `botSeed` et de
// l'état, donc deux exécutions avec les mêmes options envoient exactement les mêmes ordres.

import {
  ACTIVITY_DATA,
  ACTIVITY_IDS,
  activityOf,
  activityUnlocked,
  applyTurn,
  CITY,
  createGame,
  createRng,
  DIVISION_IDS,
  generateTestMap,
  GOOD_IDS,
  hashState,
  isActive,
  nextInt,
  type ActivityId,
  type Front,
  type GameMap,
  type GameState,
  type Intent,
  type Player,
  type Rng,
} from "../src/index.ts";

export interface ScenarioOptions {
  mapSeed: number;
  gameSeed: number;
  botSeed: number;
  players: number;
  turns: number;
  /** Nombre d'ordres `found_city` envoyés par chaque joueur à chaque tour. */
  ordersPerPlayer: number;
  /**
   * Un joueur qui a déjà une ville n'envoie d'ordre `found_city` que si sa
   * population atteint ce nombre de bonshommes : sans cela, il dépense chaque
   * bonhomme dès qu'il arrive et sa population reste au niveau du coût. 0 : il en
   * envoie toujours.
   */
  foundMinPopulation: number;
  /** Un hash est relevé tous les `checkpointEvery` tours. */
  checkpointEvery: number;
  /**
   * Les joueurs simulés n'envoient d'ordres de guerre et de front qu'à partir de ce tour : sans cela, les soldats et les
   * blessés freinent la croissance de la population et donc les fondations de villes, que d'autres tests mesurent.
   */
  warsFromTurn: number;
  /** Carte déjà générée, pour ne pas la refaire à chaque partie. */
  map?: GameMap;
  /** Appelé après chaque tour, avec la liste des cases modifiées. Peut modifier l'état (outil de visualisation). */
  onTurn?: (state: GameState, turn: number, changed: number[]) => void;
}

export interface ScenarioResult {
  state: GameState;
  finalHash: number;
  checkpoints: number[];
  /** Nombre total de cases dont le propriétaire a changé, tous tours confondus (une case compte à chaque changement). */
  changedTiles: number;
  /** Nombre de villes à la fin. */
  cities: number;
  /** Nombre de couples (joueur, tour) où la population dépasse la capacité : des bonshommes sont en sursis (08 §6). */
  starvingPlayerTurns: number;
  /** Population de tous les joueurs à la fin. */
  totalPopulation: number;
  /** Nombre de couples (joueur, tour) où une usine ou une caserne a une sortie servie en fer : la production est jouée. */
  producingPlayerTurns: number;
  /** Nombre de couples (joueur, tour) où une caserne a des bonshommes : les troupes sont jouées. */
  soldierPlayerTurns: number;
  /** Nombre de tours où au moins un combat est résolu : le combat est joué. */
  fightingTurns: number;
  /** Nombre de villes prises. */
  captures: number;
  /** Nombre de divisions créées. */
  divisions: number;
  /** Temps total passé dans applyTurn, en ms. */
  applyMs: number;
}

/** Ordres malformés envoyés à chaque tour, tour à tour. */
const GARBAGE: readonly unknown[] = [
  null,
  "found_city",
  42,
  [],
  {},
  { type: "found_city" },
  { type: "found_city", player: 0, tile: 0 },
  { type: "found_city", player: 1, tile: -1 },
  { type: "found_city", player: 1, tile: 1.5 },
  { type: "found_city", player: "1", tile: 0 },
  { type: "found_city", player: 1, tile: "0" },
  { type: "unknown", player: 1, tile: 0 },
  // Ordres qui n'existent plus (08 §10).
  { type: "set_farm_share", player: 1, percent: 50 },
  { type: "build_factory", player: 1, city: 1, factoryType: "infantryArmament" },
  { type: "create_division", player: 1, division: "regulars" },
  { type: "delete_division", player: 1, id: 1 },
  { type: "move_pawn" },
  { type: "move_pawn", player: 1, from: "idle", to: "hurt", kind: "worker", count: 1 },
  { type: "move_pawn", player: 1, from: "hurt", to: "idle", kind: "worker", count: 1 },
  { type: "move_pawn", player: 1, from: "idle", to: "farmers", kind: "worker", count: 0 },
  { type: "move_pawn", player: 1, from: "idle", to: "farmers", kind: "worker", count: 1.5 },
  { type: "move_pawn", player: 1, from: "idle", to: "farmers", kind: "machine", good: "bois", count: 1 },
  { type: "move_pawn", player: "1", from: "idle", to: "farmers", kind: "worker", count: 1 },
  { type: "set_activity_order", player: 1, activity: "idle", position: 1 },
  { type: "set_activity_order", player: 1, activity: "farmers", position: 0 },
  { type: "set_auto_assign", player: 1, enabled: 1 },
  { type: "set_disabled_slots", player: 1, activity: "idle", count: 1 },
  { type: "change_production_target", player: 1, activity: "farmers", delta: 1 },
  { type: "open_activity", player: 1, activity: "farmers" },
  { type: "close_activity", player: 1, activity: "farmers" },
];

const randomActivity = (bot: Rng): ActivityId => ACTIVITY_IDS[nextInt(bot, ACTIVITY_IDS.length)]!;

/** Un ordre sur les activités, tiré au hasard (08 §10) ; beaucoup sont invalides (activité verrouillée, trop peu de bonshommes, pas de places…). */
function activityOrder(bot: Rng, player: number, me: Player): Intent {
  const activity = randomActivity(bot);
  switch (nextInt(bot, 7)) {
    case 0:
      return { type: "move_pawn", player, from: randomActivity(bot), to: randomActivity(bot), kind: "worker", count: 1 + nextInt(bot, 3) };
    case 1:
      return { type: "move_pawn", player, from: randomActivity(bot), to: randomActivity(bot), kind: "machine", good: GOOD_IDS[nextInt(bot, GOOD_IDS.length)]!, count: 1 };
    case 2:
      return { type: "set_activity_order", player, activity, position: nextInt(bot, me.activities.length + 1) };
    case 3:
      return { type: "set_disabled_slots", player, activity, count: nextInt(bot, 4) };
    case 4:
      return { type: "open_activity", player, activity };
    case 5:
      return { type: "close_activity", player, activity };
    default:
      return { type: "change_production_target", player, activity, delta: nextInt(bot, 7) - 3 };
  }
}

/** Ouvre une caserne débloquée et la met juste sous Inactifs : ses places se remplissent avant celles des champs. */
function openBarracks(player: number, activity: ActivityId): Intent[] {
  return [
    { type: "open_activity", player, activity },
    { type: "set_activity_order", player, activity, position: 1 },
  ];
}

/** Fronts du joueur, par identifiant croissant. */
const frontsOf = (state: GameState, player: number): Front[] => state.fronts.filter((f) => f.players[0] === player || f.players[1] === player);

/**
 * Un ordre d'armée pour le joueur `player`, pour que les fronts voient des divisions : d'abord les casernes (milice, puis
 * réguliers) et leur production visée. Un `move_division` envoie une de ses divisions vers un de ses fronts, parfois en
 * première ligne, et une attaque est lancée sur un front actif.
 */
function armyOrders(bot: Rng, state: GameState, player: number): Intent[] {
  const me = state.players[player - 1]!;
  const mine = state.divisions.filter((d) => d.owner === player);
  const fronts = frontsOf(state, player);
  const active = fronts.filter((f) => isActive(state, f));
  const opened = (id: ActivityId): boolean => activityOf(me, ACTIVITY_IDS.indexOf(id)) !== undefined;
  const unlocked = (id: ActivityId): boolean => activityUnlocked(me, ACTIVITY_IDS.indexOf(id));
  switch (nextInt(bot, 8)) {
    case 0:
    case 1: {
      for (const id of ["militia", "regulars"] as const) {
        if (!opened(id) && unlocked(id)) return openBarracks(player, id);
      }
      const makers = DIVISION_IDS.filter((id) => opened(id));
      if (makers.length === 0) return [];
      return [{ type: "change_production_target", player, activity: makers[nextInt(bot, makers.length)]!, delta: 1 + nextInt(bot, 2) }];
    }
    case 2:
    case 3:
    case 4: {
      if (mine.length === 0 || fronts.length === 0) return [];
      // Trois fois sur quatre vers un front actif, quand il y en a un ; les divisions de la réserve d'abord.
      const pool = active.length > 0 && nextInt(bot, 4) > 0 ? active : fronts;
      const f = pool[nextInt(bot, pool.length)]!;
      // Une division en déplacement repart de zéro quand on la déplace : on ne déplace que celles qui sont arrivées.
      const reserve = mine.filter((x) => x.front === 0 && x.arrivalTick === 0);
      const pick = reserve.length > 0 && nextInt(bot, 8) > 0 ? reserve : mine.filter((x) => x.arrivalTick === 0);
      const ids = pick.slice(0, 1 + nextInt(bot, 3)).map((x) => x.id);
      return [{ type: "move_division", player, ids, front: f.id, ...(nextInt(bot, 2) === 0 ? { line: "first" as const } : {}) }];
    }
    case 5: {
      if (active.length === 0) return [];
      return [{ type: "start_front_attack", player, front: active[nextInt(bot, active.length)]!.id }];
    }
    case 6: {
      // Un front voisin, en paix : déclarer la guerre à son adversaire.
      const peace = fronts.filter((f) => !isActive(state, f));
      if (peace.length === 0) return [];
      const f = peace[nextInt(bot, peace.length)]!;
      return [{ type: "declare_war", player, target: f.players[0] === player ? f.players[1] : f.players[0] }];
    }
    default: {
      // Une boîte supprimée : ses divisions deviennent en trop (08 §9).
      const closable = DIVISION_IDS.filter((id) => opened(id));
      return nextInt(bot, 40) === 0 && closable.length > 0 ? [{ type: "close_activity", player, activity: closable[nextInt(bot, closable.length)]! }] : [];
    }
  }
}

/**
 * Un ordre de guerre ou de front tiré au hasard pour le joueur `player` : déclarer la guerre,
 * proposer ou accepter la paix, changer une production visée, déplacer une division, lancer ou arrêter une attaque.
 * Beaucoup sont invalides (front inconnu, joueur étranger au front, pas en guerre, boîte fermée).
 */
function frontOrder(bot: Rng, state: GameState, player: number): Intent {
  const front = 1 + nextInt(bot, Math.max(1, state.nextFrontId));
  const other = 1 + nextInt(bot, state.players.length);
  const division = 1 + nextInt(bot, Math.max(1, state.nextDivisionId));
  switch (nextInt(bot, 14)) {
    case 0:
    case 1:
      return { type: "declare_war", player, target: other };
    case 2:
      return { type: "propose_peace", player, target: other };
    case 3:
      return { type: "answer_proposal", player, from: other, accept: nextInt(bot, 2) === 0 };
    case 4:
    case 5:
      return { type: "change_production_target", player, activity: DIVISION_IDS[nextInt(bot, DIVISION_IDS.length)]!, delta: nextInt(bot, 5) - 2 };
    case 6:
      return { type: "set_auto_assign", player, enabled: nextInt(bot, 8) !== 0 };
    case 7:
    case 12:
      return { type: "move_division", player, ids: [division, division + 1], front: nextInt(bot, 3) === 0 ? 0 : front, ...(nextInt(bot, 2) === 0 ? { line: "first" as const } : {}) };
    case 8:
    case 9:
    case 10:
      return { type: "start_front_attack", player, front };
    default:
      return { type: "move_division", player, ids: [division], front };
  }
}

export const DEFAULT_SCENARIO: Omit<ScenarioOptions, "turns"> = {
  mapSeed: 12345,
  gameSeed: 777,
  botSeed: 4242,
  players: 8,
  ordersPerPlayer: 4,
  foundMinPopulation: 4,
  checkpointEvery: 100,
  warsFromTurn: 1500,
};

/** Un joueur qui a une ville envoie un ordre de guerre ou de front à un tour sur `FRONT_ORDER_ONE_IN`. */
const FRONT_ORDER_ONE_IN = 60;
/** Un joueur qui a une ville envoie un ordre d'armée (`armyOrders`) à un tour sur `ARMY_ORDER_ONE_IN`, en plus des ordres de `frontOrder`. */
const ARMY_ORDER_ONE_IN = 15;
/** Un joueur qui a une ville envoie un ordre sur ses activités (`activityOrder`) à un tour sur `ACTIVITY_ORDER_ONE_IN`. */
const ACTIVITY_ORDER_ONE_IN = 25;

export function runScenario(opts: ScenarioOptions, now: () => number = () => 0): ScenarioResult {
  const map = opts.map ?? generateTestMap(opts.mapSeed);
  const state = createGame({ seed: opts.gameSeed, map, playerCount: opts.players });
  const bot = createRng(opts.botSeed);
  const { width, height } = map;
  const checkpoints: number[] = [];
  let changedTiles = 0;
  let applyMs = 0;
  let starvingPlayerTurns = 0;
  let producingPlayerTurns = 0;
  let soldierPlayerTurns = 0;
  let fightingTurns = 0;
  let captures = 0;
  // Un joueur sans ville tire une case de toute la carte ; sinon, une case dans
  // un carré autour d'une de ses villes, un peu plus large que le rayon
  // d'expansion : une partie des ordres tombe hors de portée.
  const reach = CITY.expansionRadius + 5;

  for (let turn = 1; turn <= opts.turns; turn++) {
    const intents: Intent[] = [];
    for (let p = 1; p <= opts.players; p++) {
      const mine = state.players[p - 1]!.cityIds;
      const canFound = mine.length === 0 || state.players[p - 1]!.population >= opts.foundMinPopulation;
      for (let k = 0; canFound && k < opts.ordersPerPlayer; k++) {
        let tile: number;
        if (mine.length === 0) {
          tile = nextInt(bot, width * height);
        } else {
          const from = state.cities[mine[nextInt(bot, mine.length)]! - 1]!.tile;
          const fx = from % width;
          const fy = (from - fx) / width;
          const x = Math.min(width - 1, Math.max(0, fx + nextInt(bot, 2 * reach + 1) - reach));
          const y = Math.min(height - 1, Math.max(0, fy + nextInt(bot, 2 * reach + 1) - reach));
          tile = y * width + x;
        }
        intents.push({ type: "found_city", player: p, tile });
      }
      if (mine.length > 0 && nextInt(bot, ACTIVITY_ORDER_ONE_IN) === 0) {
        intents.push(activityOrder(bot, p, state.players[p - 1]!));
      }
      if (mine.length > 0 && turn >= opts.warsFromTurn && nextInt(bot, FRONT_ORDER_ONE_IN) === 0) {
        intents.push(frontOrder(bot, state, p));
      }
      if (mine.length > 0 && turn >= opts.warsFromTurn && nextInt(bot, ARMY_ORDER_ONE_IN) === 0) {
        intents.push(...armyOrders(bot, state, p));
      }
    }
    intents.push(GARBAGE[turn % GARBAGE.length] as Intent);

    const t0 = now();
    const changed = applyTurn(state, { turn, intents });
    applyMs += now() - t0;

    changedTiles += changed.length;
    for (const p of state.players) {
      if (p.population > p.capacity) starvingPlayerTurns++;
      const makers = p.activities.filter((a) => ACTIVITY_DATA[a.id]!.kind === "factory" || ACTIVITY_DATA[a.id]!.kind === "barracks");
      if (makers.some((a) => a.output > 0)) producingPlayerTurns++;
      if (makers.some((a) => ACTIVITY_DATA[a.id]!.kind === "barracks" && a.workers > 0)) soldierPlayerTurns++;
    }
    if (state.combats.some((c) => c.tick === turn)) fightingTurns++;
    captures += state.events.filter((e) => e.type === "city_captured").length;
    opts.onTurn?.(state, turn, changed);
    if (turn % opts.checkpointEvery === 0) checkpoints.push(hashState(state));
  }
  return {
    state,
    finalHash: hashState(state),
    checkpoints,
    changedTiles,
    cities: state.cities.length,
    starvingPlayerTurns,
    producingPlayerTurns,
    soldierPlayerTurns,
    fightingTurns,
    captures,
    divisions: state.nextDivisionId - 1,
    totalPopulation: state.players.reduce((sum, p) => sum + p.population, 0),
    applyMs,
  };
}
