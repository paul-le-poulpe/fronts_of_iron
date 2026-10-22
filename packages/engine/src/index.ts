export { MAX_PLAYERS, SEA_ZONES, TEST_MAP, type SeaZonesConfig, type TestMapConfig } from "./config.ts";
export {
  altitude,
  forEachNeighbor,
  isLand,
  TERRAIN_ALTITUDE,
  TERRAIN_LAND,
  TERRAIN_OCEAN,
  TERRAIN_SHORE,
  type GameMap,
} from "./map.ts";
export { generateTestMap } from "./mapgen.ts";
export {
  computeSeaZones,
  generateSeaZones,
  landMask,
  type SeaZones,
  type SeaZonesStep,
} from "./seazones.ts";
export { createRng, nextInt, nextU32, type Rng } from "./rng.ts";
export { createGame, isPlayerId, setOwner, type GameSetup, type GameState, type Player } from "./state.ts";
export { applyIntent, type DemoClaimIntent, type Intent } from "./intents.ts";
export { applyTurn, type Turn } from "./turn.ts";
export { hashMap, hashState } from "./hash.ts";
