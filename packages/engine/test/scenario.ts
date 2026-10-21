// Partie scriptée pour les tests et la mesure : des joueurs simulés envoient des
// ordres `demo_claim` tirés au hasard (dont beaucoup sont invalides) et un ordre
// malformé par tour. Les ordres ne dépendent que de `botSeed` et de l'état, donc
// deux exécutions avec les mêmes options envoient exactement les mêmes ordres.

import {
  applyTurn,
  createGame,
  createRng,
  generateTestMap,
  hashState,
  nextInt,
  type GameMap,
  type GameState,
  type Intent,
} from "../src/index.ts";

export interface ScenarioOptions {
  mapSeed: number;
  gameSeed: number;
  botSeed: number;
  players: number;
  turns: number;
  claimsPerPlayer: number;
  /** Un hash est relevé tous les `checkpointEvery` tours. */
  checkpointEvery: number;
  /** Carte déjà générée, pour ne pas la refaire à chaque partie. */
  map?: GameMap;
}

export interface ScenarioResult {
  state: GameState;
  finalHash: number;
  checkpoints: number[];
  validIntents: number;
  /** Temps total passé dans applyTurn, en ms. */
  applyMs: number;
}

/** Ordres malformés envoyés à chaque tour, tour à tour. */
const GARBAGE: readonly unknown[] = [
  null,
  "demo_claim",
  42,
  [],
  {},
  { type: "demo_claim" },
  { type: "demo_claim", player: 0, tile: 0 },
  { type: "demo_claim", player: 1, tile: -1 },
  { type: "demo_claim", player: 1, tile: 1.5 },
  { type: "demo_claim", player: "1", tile: 0 },
  { type: "demo_claim", player: 1, tile: "0" },
  { type: "unknown", player: 1, tile: 0 },
];

export const DEFAULT_SCENARIO: Omit<ScenarioOptions, "turns"> = {
  mapSeed: 12345,
  gameSeed: 777,
  botSeed: 4242,
  players: 8,
  claimsPerPlayer: 4,
  checkpointEvery: 100,
};

export function runScenario(opts: ScenarioOptions, now: () => number = () => 0): ScenarioResult {
  const map = opts.map ?? generateTestMap(opts.mapSeed);
  const state = createGame({ seed: opts.gameSeed, map, playerCount: opts.players });
  const bot = createRng(opts.botSeed);
  const size = map.width * map.height;
  const owned: number[][] = [];
  for (let p = 0; p < opts.players; p++) owned.push([]);
  const checkpoints: number[] = [];
  let validIntents = 0;
  let applyMs = 0;

  for (let turn = 1; turn <= opts.turns; turn++) {
    const intents: Intent[] = [];
    for (let p = 1; p <= opts.players; p++) {
      const mine = owned[p - 1]!;
      for (let k = 0; k < opts.claimsPerPlayer; k++) {
        let tile: number;
        if (mine.length === 0) {
          tile = nextInt(bot, size);
        } else {
          const from = mine[nextInt(bot, mine.length)]!;
          const dir = nextInt(bot, 4);
          tile = dir === 0 ? from - 1 : dir === 1 ? from + 1 : dir === 2 ? from - map.width : from + map.width;
        }
        intents.push({ type: "demo_claim", player: p, tile });
      }
    }
    intents.push(GARBAGE[turn % GARBAGE.length] as Intent);

    const t0 = now();
    const changed = applyTurn(state, { turn, intents });
    applyMs += now() - t0;

    validIntents += changed.length;
    for (const t of changed) {
      const o = state.owner[t]!;
      if (o !== 0) owned[o - 1]!.push(t);
    }
    if (turn % opts.checkpointEvery === 0) checkpoints.push(hashState(state));
  }
  return { state, finalHash: hashState(state), checkpoints, validIntents, applyMs };
}
