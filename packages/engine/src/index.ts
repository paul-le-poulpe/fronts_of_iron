export {
  CITY,
  MAX_CITIES,
  MAX_PLAYERS,
  POPULATION,
  RESOURCES,
  SEA_ZONES,
  TEST_MAP,
  type ResourcePresenceConfig,
  type SeaZonesConfig,
  type TestMapConfig,
} from "./config.ts";
export {
  altitude,
  forEachNeighbor,
  isLand,
  RESOURCE_COUNT,
  RESOURCE_IRON,
  TERRAIN_ALTITUDE,
  TERRAIN_LAND,
  TERRAIN_OCEAN,
  TERRAIN_SHORE,
  type GameMap,
} from "./map.ts";
export { generateTestMap } from "./mapgen.ts";
export { generateResourcePresence, presenceThreshold, resourceNoise } from "./resources.ts";
export {
  computeSeaZones,
  generateSeaZones,
  landMask,
  type SeaZones,
  type SeaZonesStep,
} from "./seazones.ts";
export { createRng, nextInt, nextU32, type Rng } from "./rng.ts";
export { foundCity } from "./cities.ts";
export { addCityToRoads, computeRoads, createRoadNetwork, segmentsCross, type RoadNetwork } from "./roads.ts";
export {
  createGame,
  isPlayerId,
  setOwner,
  type City,
  type GameSetup,
  type GameState,
  type Player,
} from "./state.ts";
export { applyIntent, type FoundCityIntent, type Intent } from "./intents.ts";
export { applyTurn, type Turn } from "./turn.ts";
export { hashMap, hashState } from "./hash.ts";
