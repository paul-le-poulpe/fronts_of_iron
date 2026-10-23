// Carte de test générée par le code : un continent entouré d'océan, avec du
// relief et parfois des lacs ou des îles, puis présence des ressources et
// fertilité. Calcul entièrement en entiers.

import { fmix32 } from "./bits.ts";
import { FERTILITY, RESOURCES, TEST_MAP, type TestMapConfig } from "./config.ts";
import { RESOURCE_IRON, TERRAIN_ALTITUDE, TERRAIN_LAND, TERRAIN_OCEAN, TERRAIN_SHORE, type GameMap } from "./map.ts";
import { ONE, valueNoise } from "./noise.ts";
import { generateResourcePresence } from "./resources.ts";

export function generateTestMap(seed: number, cfg: TestMapConfig = TEST_MAP): GameMap {
  const { width, height } = cfg;
  const size = width * height;
  const elevation = new Int32Array(size);

  const weightSum = cfg.octaves.reduce((sum, o) => sum + o.weight, 0);
  const octaveSeeds = cfg.octaves.map((_, i) => fmix32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0));
  const cx = width >> 1;
  const cy = height >> 1;
  const rx = Math.floor((width * cfg.continentRadiusPercent) / 200);
  const ry = Math.floor((height * cfg.continentRadiusPercent) / 200);

  for (let y = 0; y < height; y++) {
    const uy = Math.floor(((y - cy) * ONE) / ry);
    for (let x = 0; x < width; x++) {
      let noise = 0;
      for (let i = 0; i < cfg.octaves.length; i++) {
        const o = cfg.octaves[i]!;
        noise += valueNoise(x, y, o.cell, octaveSeeds[i]!) * o.weight;
      }
      noise = Math.floor(noise / weightSum);
      const ux = Math.floor(((x - cx) * ONE) / rx);
      // d2 = (distance au centre / rayon de l'ellipse)², 1 sur le bord valant ONE².
      const d2 = ux * ux + uy * uy;
      elevation[y * width + x] = noise + cfg.centerBoost - Math.floor((d2 * cfg.edgeDrop) / (ONE * ONE));
    }
  }

  const terrain = new Uint8Array(size);
  for (let t = 0; t < size; t++) {
    const above = elevation[t]! - cfg.seaLevel;
    if (above > 0) terrain[t] = TERRAIN_LAND | Math.min(31, above >> cfg.altitudeShift);
  }

  markOcean(terrain, width, height);
  markShore(terrain, width, height);

  // Ressources : le bit i de `resources` est la i-ème clé de RESOURCES. La
  // présence se calcule sur le terrain fini, qui ne change plus ensuite.
  const resources = new Uint8Array(size);
  // Fertilité (00-Game §2) : la terre hors montagne a FERTILITY.land, la montagne, l'eau et le fer 0.
  const fertility = new Uint8Array(size);
  for (let t = 0; t < size; t++) {
    const b = terrain[t]!;
    if ((b & TERRAIN_LAND) !== 0 && (b & TERRAIN_ALTITUDE) < cfg.mountainAltitude) fertility[t] = FERTILITY.land;
  }
  const map: GameMap = { width, height, terrain, resources, fertility };
  Object.values(RESOURCES).forEach((resource, i) => {
    const present = generateResourcePresence(map, seed, resource.presence);
    for (let t = 0; t < size; t++) if (present[t] !== 0) resources[t] = resources[t]! | (1 << i);
  });
  // Une case qui porte du fer n'est pas cultivable (00-Game §2, §7).
  for (let t = 0; t < size; t++) if ((resources[t]! & RESOURCE_IRON) !== 0) fertility[t] = 0;
  return map;
}

/** Marque TERRAIN_OCEAN sur l'eau reliée au bord de la carte (parcours en largeur). */
function markOcean(terrain: Uint8Array, width: number, height: number): void {
  const size = width * height;
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const push = (t: number): void => {
    if ((terrain[t]! & (TERRAIN_LAND | TERRAIN_OCEAN)) === 0) {
      terrain[t] = terrain[t]! | TERRAIN_OCEAN;
      queue[tail++] = t;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const t = queue[head++]!;
    const x = t % width;
    if (x > 0) push(t - 1);
    if (x < width - 1) push(t + 1);
    if (t >= width) push(t - width);
    if (t < size - width) push(t + width);
  }
}

/** Marque TERRAIN_SHORE sur la terre dont un des 4 voisins est de l'eau. */
function markShore(terrain: Uint8Array, width: number, height: number): void {
  const size = width * height;
  const isWater = (t: number): boolean => (terrain[t]! & TERRAIN_LAND) === 0;
  for (let t = 0; t < size; t++) {
    if ((terrain[t]! & TERRAIN_LAND) === 0) continue;
    const x = t % width;
    if (
      (x > 0 && isWater(t - 1)) ||
      (x < width - 1 && isWater(t + 1)) ||
      (t >= width && isWater(t - width)) ||
      (t < size - width && isWater(t + width))
    ) {
      terrain[t] = terrain[t]! | TERRAIN_SHORE;
    }
  }
}
