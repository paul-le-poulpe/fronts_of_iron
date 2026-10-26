// Partie scriptée pour les tests et la mesure : des joueurs simulés envoient des
// ordres `found_city` tirés au hasard (dont beaucoup sont invalides), de temps en
// temps un ordre `set_farm_share`, et un ordre malformé par tour. Les villes sont
// payées par la croissance de la population (economy.ts). Les ordres ne dépendent
// que de `botSeed` et de l'état, donc deux exécutions avec les mêmes options
// envoient exactement les mêmes ordres.

import {
  applyTurn,
  CITY,
  createGame,
  createRng,
  FACTORY_TYPE_IDS,
  generateTestMap,
  hashState,
  nextInt,
  POPULATION,
  UNIT_IDS,
  PRODUCT_IDS,
  type GameMap,
  type GameState,
  type Intent,
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
   * population atteint ce nombre : sans cela, il dépense toute sa croissance
   * dès qu'elle dépasse le coût d'une ville et sa population reste au niveau
   * du coût. 0 : il en envoie toujours. Le scénario par défaut attend 6 000 :
   * les joueurs fondent alors des villes à population plus grande, souvent
   * proche du maximum que permet leur nourriture, et les cases prises à un
   * voisin font baisser sa population (surplus négatif, testé par
   * determinism.test.ts ; 02-Engine §6).
   */
  foundMinPopulation: number;
  /** Un hash est relevé tous les `checkpointEvery` tours. */
  checkpointEvery: number;
  /**
   * Les joueurs simulés n'envoient d'ordres de guerre et de front qu'à partir de ce tour : sans cela, les soldats et les
   * pertes freinent la croissance de la population et donc les fondations de villes, que d'autres tests mesurent.
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
  /**
   * Nombre de couples (joueur, tour) où la nourriture produite est inférieure à
   * la consommation de la population en fin de tour : la population baisse
   * (surplus négatif, 00-Game §4.1).
   */
  starvingPlayerTurns: number;
  /** Population de tous les joueurs à la fin. */
  totalPopulation: number;
  /** Nombre de couples (joueur, tour) où au moins une ligne de production était remplie : les usines sont jouées. */
  filledLinePlayerTurns: number;
  /** Nombre de couples (joueur, tour) où le joueur a des soldats : les troupes sont jouées. */
  soldierPlayerTurns: number;
  /** Nombre de tours où au moins un front a une attaque ou une percée en cours : le combat est joué. */
  fightingTurns: number;
  /** Nombre de villes prises. */
  captures: number;
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
  { type: "set_farm_share" },
  { type: "set_farm_share", player: 1 },
  { type: "set_farm_share", player: 0, percent: 50 },
  { type: "set_farm_share", player: 1, percent: -1 },
  { type: "set_farm_share", player: 1, percent: 101 },
  { type: "set_farm_share", player: 1, percent: 50.5 },
  { type: "set_farm_share", player: 1, percent: "50" },
  { type: "set_farm_share", player: 1, percent: NaN },
  { type: "set_farm_share", player: "1", percent: 50 },
];

/** Un ordre d'usine tiré au hasard sur l'une des villes `mine` du joueur `player` ; beaucoup sont invalides (ville sans usine, bien verrouillé…). */
function factoryOrder(bot: Rng, player: number, mine: readonly number[]): Intent {
  const city = mine[nextInt(bot, mine.length)]!;
  const good = PRODUCT_IDS[nextInt(bot, PRODUCT_IDS.length)]!;
  switch (nextInt(bot, 5)) {
    case 0:
      return { type: "build_factory", player, city, factoryType: FACTORY_TYPE_IDS[nextInt(bot, FACTORY_TYPE_IDS.length)]! };
    case 1:
    case 2:
      return { type: "create_line", player, city, good };
    case 3:
      return { type: "set_active_lines", player, city, good, count: nextInt(bot, 4) };
    default:
      return nextInt(bot, 2) === 0
        ? { type: "set_city_priority", player, city, position: nextInt(bot, 3) }
        : { type: "set_line_priority", player, city, good, position: nextInt(bot, 3) };
  }
}

/**
 * Un ordre de guerre ou de front tiré au hasard pour le joueur `player` : déclarer la guerre,
 * proposer ou accepter la paix, régler un front, lancer ou arrêter une attaque ou une percée. Beaucoup sont
 * invalides (front inconnu, joueur étranger au front, pas en guerre).
 */
function frontOrder(bot: Rng, state: GameState, player: number): Intent {
  const front = 1 + nextInt(bot, Math.max(1, state.nextFrontId));
  const other = 1 + nextInt(bot, state.players.length);
  const connection = state.fronts.find((f) => f.id === front)?.connections[0];
  switch (nextInt(bot, 14)) {
    case 0:
    case 1:
      return { type: "declare_war", player, target: other };
    case 2:
      return { type: "propose_peace", player, target: other };
    case 3:
      return { type: "answer_proposal", player, from: other, accept: nextInt(bot, 2) === 0 };
    case 4:
      return { type: "set_front_priority", player, front, priority: nextInt(bot, 4) };
    case 5:
      return { type: "set_front_reassign", player, front, enabled: nextInt(bot, 2) === 0 };
    case 6:
      return { type: "set_unit_line_mode", player, front, unit: UNIT_IDS[nextInt(bot, UNIT_IDS.length)]!, mode: (["first", "balanced", "second"] as const)[nextInt(bot, 3)]! };
    case 7:
      return { type: "set_breakthrough_motorized_only", player, front, enabled: nextInt(bot, 2) === 0 };
    case 8:
      return { type: "set_forced_mobilization", player, enabled: nextInt(bot, 2) === 0 };
    case 9:
    case 10:
      return { type: "start_front_attack", player, front };
    case 11:
      return { type: "stop_front_attack", player, front };
    case 12:
      return { type: "start_breakthrough", player, front, city1: connection?.city1 ?? 0, city2: connection?.city2 ?? 0 };
    default:
      return { type: "cancel_breakthrough", player, id: 1 + nextInt(bot, Math.max(1, state.nextBreakthroughId)) };
  }
}

export const DEFAULT_SCENARIO: Omit<ScenarioOptions, "turns"> = {
  mapSeed: 12345,
  gameSeed: 777,
  botSeed: 4242,
  players: 8,
  ordersPerPlayer: 4,
  foundMinPopulation: 6000,
  checkpointEvery: 100,
  warsFromTurn: 1500,
};

/** Un joueur sur `FARM_SHARE_ONE_IN` envoie un `set_farm_share` à chaque tour, en moyenne. */
const FARM_SHARE_ONE_IN = 150;
/** Un joueur qui a une ville envoie un ordre de guerre ou de front à un tour sur `FRONT_ORDER_ONE_IN`. */
const FRONT_ORDER_ONE_IN = 60;
/** Un joueur qui a une ville envoie un ordre d'usine (construire, créer, régler, priorité) à un tour sur `FACTORY_ORDER_ONE_IN`. */
const FACTORY_ORDER_ONE_IN = 25;

export function runScenario(opts: ScenarioOptions, now: () => number = () => 0): ScenarioResult {
  const map = opts.map ?? generateTestMap(opts.mapSeed);
  const state = createGame({ seed: opts.gameSeed, map, playerCount: opts.players });
  const bot = createRng(opts.botSeed);
  const { width, height } = map;
  const checkpoints: number[] = [];
  let changedTiles = 0;
  let applyMs = 0;
  let starvingPlayerTurns = 0;
  let filledLinePlayerTurns = 0;
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
      if (nextInt(bot, FARM_SHARE_ONE_IN) === 0) {
        intents.push({ type: "set_farm_share", player: p, percent: 50 + nextInt(bot, 51) });
      }
      if (mine.length > 0 && nextInt(bot, FACTORY_ORDER_ONE_IN) === 0) {
        intents.push(factoryOrder(bot, p, mine));
      }
      if (mine.length > 0 && turn >= opts.warsFromTurn && nextInt(bot, FRONT_ORDER_ONE_IN) === 0) {
        intents.push(frontOrder(bot, state, p));
      }
    }
    intents.push(GARBAGE[turn % GARBAGE.length] as Intent);

    const t0 = now();
    const changed = applyTurn(state, { turn, intents });
    applyMs += now() - t0;

    changedTiles += changed.length;
    for (const p of state.players) {
      if (p.food < p.population * POPULATION.foodPerHead) starvingPlayerTurns++;
      if (p.factories.some((f) => f.groups.some((g) => g.filled > 0))) filledLinePlayerTurns++;
      if (p.soldiers > 0) soldierPlayerTurns++;
    }
    if (state.fronts.some((f) => f.sides.some((x) => x.frontAttack || x.breakthroughs.length > 0))) fightingTurns++;
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
    filledLinePlayerTurns,
    soldierPlayerTurns,
    fightingTurns,
    captures,
    totalPopulation: state.players.reduce((sum, p) => sum + p.population, 0),
    applyMs,
  };
}
