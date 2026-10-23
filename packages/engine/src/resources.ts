// Présence des ressources naturelles sur la carte (Docs/Design/00-Game.md §2) :
// un booléen par case, tiré d'un bruit dont le seuil baisse avec l'altitude.
// Calcul entièrement en entiers.

import { fmix32 } from "./bits.ts";
import type { ResourcePresenceConfig } from "./config.ts";
import { TERRAIN_ALTITUDE, TERRAIN_LAND, type GameMap } from "./map.ts";
import { valueNoise } from "./mapgen.ts";

/** Seuil du bruit sur une case d'altitude `alt` : base, baisse par niveau, baisse en montagne. */
export function presenceThreshold(alt: number, cfg: ResourcePresenceConfig): number {
  return cfg.threshold - alt * cfg.perAltitude - (alt >= cfg.mountainAltitude ? cfg.mountainBonus : 0);
}

/** Bruit de la ressource (0 à 65 535) sur chaque case de terre ; 0 sur l'eau. */
export function resourceNoise(map: GameMap, seed: number, cfg: ResourcePresenceConfig): Uint16Array {
  const { width, height, terrain } = map;
  const noise = new Uint16Array(width * height);
  const weightSum = cfg.octaves.reduce((sum, o) => sum + o.weight, 0);
  const octaveSeeds = cfg.octaves.map((_, i) => fmix32((seed ^ cfg.salt ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if ((terrain[t]! & TERRAIN_LAND) === 0) continue;
      let n = 0;
      for (let i = 0; i < cfg.octaves.length; i++) {
        const o = cfg.octaves[i]!;
        n += valueNoise(x, y, o.cell, octaveSeeds[i]!) * o.weight;
      }
      noise[t] = Math.floor(n / weightSum);
    }
  }
  return noise;
}

/** 1 si la ressource est sur la case, 0 sinon. Jamais sur l'eau. */
export function generateResourcePresence(map: GameMap, seed: number, cfg: ResourcePresenceConfig): Uint8Array {
  const noise = resourceNoise(map, seed, cfg);
  const present = new Uint8Array(noise.length);
  for (let t = 0; t < noise.length; t++) {
    const b = map.terrain[t]!;
    if ((b & TERRAIN_LAND) !== 0 && noise[t]! > presenceThreshold(b & TERRAIN_ALTITUDE, cfg)) present[t] = 1;
  }
  return present;
}
