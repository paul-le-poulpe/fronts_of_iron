// État de départ de la partie de test (outil de développement, Docs/Design/01-Architecture.md §9 bis). Appelée une fois
// juste après `createGame` avec `freezeEconomy` : fonde les villes des deux joueurs, ouvre toutes les activités et remplit
// les casernes et les usines par écriture directe pour que leurs limites couvrent les divisions, crée les divisions
// directement, puis les place par les ordres de déplacement. Ce ne sont pas des règles du jeu.
//
// Déterministe (règle 2) : aucun hasard, cases parcourues dans un ordre fixé.

import { ACTIVITY_DATA, DIVISION_ACTIVITY, IDLE, activityOf, openActivity } from "./activities.ts";
import { CITY, TEST_GAME, TEST_SCENARIOS, type TestScenarioId } from "./config.ts";
import { foundCity, foundingCostPawns } from "./cities.ts";
import { WIDTH_SCALE, DIVISION_DATA, DIVISION_IDS, addDivision, eliteCap, type Division } from "./divisions.ts";
import { applyIntent } from "./intents.ts";
import { isLand } from "./map.ts";
import { computeRoads } from "./roads.ts";
import type { GameState } from "./state.ts";

export interface TestGameSummary {
  /** Villes de chaque joueur, `cities[id - 1]`. */
  readonly cities: readonly number[];
  readonly fronts: number;
  /** Divisions placées sur les fronts par joueur, `divisions[id - 1]`. */
  readonly divisions: readonly number[];
  /** Divisions restées dans la réserve nationale par joueur. */
  readonly reserve: readonly number[];
  /** Connexions entre les deux joueurs. */
  readonly connections: number;
}

/** Décalages (dx, dy) dont la distance au carré est dans ]rayon de contrôle², rayon d'expansion²], du plus proche au plus loin. */
function candidateOffsets(): [number, number][] {
  const lo = CITY.controlRadius * CITY.controlRadius;
  const hi = CITY.expansionRadius * CITY.expansionRadius;
  const out: [number, number][] = [];
  for (let dy = -CITY.expansionRadius; dy <= CITY.expansionRadius; dy++) {
    for (let dx = -CITY.expansionRadius; dx <= CITY.expansionRadius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > lo && d2 <= hi) out.push([dx, dy]);
    }
  }
  out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  return out;
}

/** La case de terre la plus proche de (x, y), en anneaux carrés croissants, dans l'ordre haut→bas, gauche→droite ; -1 s'il n'y en a pas. */
function nearestLand(state: GameState, x: number, y: number): number {
  const { width: w, height: h } = state.map;
  let best = -1;
  let bestD2 = Infinity;
  for (let ring = 0; ring <= Math.max(w, h); ring++) {
    if (best >= 0 && ring * ring > bestD2) break;
    for (let ty = y - ring; ty <= y + ring; ty++) {
      for (let tx = x - ring; tx <= x + ring; tx++) {
        if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) !== ring) continue;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const t = ty * w + tx;
        const d2 = (tx - x) * (tx - x) + (ty - y) * (ty - y);
        if (d2 < bestD2 && isLand(state.map, t)) {
          best = t;
          bestD2 = d2;
        }
      }
    }
  }
  return best;
}

/**
 * Plan des villes : cases de chaque joueur dans l'ordre de fondation. Départ : deux cases de terre à `startDistance`
 * l'une de l'autre sur la ligne médiane ; chaque joueur ajoute à son tour la case valide la plus proche de ses villes
 * (terre, hors de toute zone existante, dans le rayon d'expansion d'une de ses villes), jusqu'à `minCities` villes chacun
 * et `minConnections` routes entre les deux joueurs.
 */
function planCities(state: GameState): { seq: { player: number; tile: number }[]; connections: number } {
  const { width: w, height: h } = state.map;
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const a = nearestLand(state, midX - Math.floor(TEST_GAME.startDistance / 2), midY);
  const b = nearestLand(state, midX + Math.floor(TEST_GAME.startDistance / 2), midY);
  if (a < 0 || b < 0 || a === b) throw new Error("partie de test : pas de case de départ sur la carte");
  // Villes dans l'ordre de fondation : l'identifiant d'une ville est son indice + 1.
  const seq = [
    { player: 0, tile: a },
    { player: 1, tile: b },
  ];
  const offsets = candidateOffsets();
  const control2 = CITY.controlRadius * CITY.controlRadius;
  const xy = (t: number): [number, number] => [t % w, Math.floor(t / w)];
  const count = (player: number): number => seq.filter((c) => c.player === player).length;

  const nextTile = (player: number): number => {
    const own = seq.filter((c) => c.player === player).map((c) => xy(c.tile));
    const all = seq.map((c) => xy(c.tile));
    for (const [dx, dy] of offsets) {
      for (const [cx, cy] of own) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || !isLand(state.map, y * w + x)) continue;
        if (all.some(([ox, oy]) => (ox - x) * (ox - x) + (oy - y) * (oy - y) <= control2)) continue;
        return y * w + x;
      }
    }
    return -1;
  };

  const crossRoads = (): number =>
    computeRoads(seq.map((c) => c.tile), w, h, CITY.expansionRadius).filter(([x, y]) => seq[x - 1]!.player !== seq[y - 1]!.player).length;

  for (let turn = 0; ; turn++) {
    if (count(0) >= TEST_GAME.minCities && count(1) >= TEST_GAME.minCities) {
      const connections = crossRoads();
      if (connections >= TEST_GAME.minConnections) return { seq, connections };
    }
    const player = turn % 2;
    if (count(player) >= TEST_GAME.maxCities) {
      throw new Error(`partie de test : les deux territoires ne se touchent pas après ${TEST_GAME.maxCities} villes par joueur`);
    }
    const t = nextTile(player);
    if (t < 0) throw new Error(`partie de test : le joueur ${player + 1} ne peut plus fonder de ville (carte trop morcelée)`);
    seq.push({ player, tile: t });
  }
}

function order(state: GameState, intent: unknown, what: string): void {
  if (!applyIntent(state, intent, [])) throw new Error(`partie de test : ordre refusé (${what})`);
}

/**
 * Construit l'état de départ de la partie de test : deux joueurs en paix, des villes, des fronts, des divisions
 * placées et des stocks de renfort. À appeler une seule fois, juste après `createGame` avec `freezeEconomy`.
 * Lève une erreur si l'état n'est pas celui d'une partie neuve, si un ordre est refusé ou si une division manque.
 */
export function setupTestGame(state: GameState, scenario: TestScenarioId = "full"): TestGameSummary {
  const composition = TEST_SCENARIOS[scenario] as readonly { readonly division: string; readonly count: number }[] | undefined;
  if (composition === undefined) throw new Error(`partie de test : scénario inconnu : ${String(scenario)}`);
  if (!state.economyFrozen) throw new Error("partie de test : l'économie doit être gelée");
  if (state.players.length !== 2) throw new Error("partie de test : deux joueurs exactement");
  if (state.cities.length !== 0 || state.divisions.length !== 0 || state.tick !== 0) {
    throw new Error("partie de test : la partie n'est pas neuve");
  }

  // 1. Villes, dans l'ordre du plan (les identifiants réels sont ceux du plan).
  const plan = planCities(state);
  const changed: number[] = [];
  for (const { player, tile } of plan.seq) {
    const p = state.players[player]!;
    // Les villes se paient en bonshommes inactifs : les effectifs sont refaits plus bas.
    const idle = activityOf(p, IDLE)!;
    idle.workers = Math.max(idle.workers, foundingCostPawns(p.cityIds.length));
    p.population = idle.workers;
    if (!foundCity(state, p.id, tile, changed)) throw new Error(`partie de test : ville refusée en ${tile} (joueur ${p.id})`);
  }
  if (state.fronts.length === 0) throw new Error("partie de test : aucun front entre les deux joueurs");

  // 2. Ce que chaque joueur reçoit : la composition de chaque front, puis `reservePerType` divisions de chaque type dans la
  // réserve nationale (les élites seulement jusqu'à ce que `ELITE_TROOPS_RATIO` permet).
  const frontCount = state.fronts.length;
  const typeIndex = (id: string): number => DIVISION_IDS.indexOf(id as (typeof DIVISION_IDS)[number]);
  const frontPart = composition.map((e) => ({ division: e.division, count: e.count * frontCount }));
  const reservePart: { division: string; count: number }[] = [];
  // Une place de caserne par division : autant de bonshommes dans la caserne de réguliers que de divisions de réguliers.
  let regulars: number = TEST_GAME.reservePerType;
  for (const e of frontPart) if (e.division === "regulars") regulars += e.count;
  for (const id of DIVISION_IDS) {
    const data = DIVISION_DATA[typeIndex(id)]!;
    const count = data.elite ? Math.min(TEST_GAME.reservePerType, eliteCap(regulars)) : TEST_GAME.reservePerType;
    reservePart.push({ division: id, count });
  }
  const wanted = [...frontPart, ...reservePart];

  // Activités : toutes ouvertes, casernes et usines remplies pour que leur limite couvre les divisions voulues de leur type
  // (l'économie gelée sert chaque boîte sans limite de fer).
  const perType = new Array<number>(DIVISION_IDS.length).fill(0);
  for (const e of wanted) perType[typeIndex(e.division)] = perType[typeIndex(e.division)]! + e.count;
  for (const p of state.players) {
    for (const data of ACTIVITY_DATA) {
      openActivity(p, data.index);
      p.unlock[data.index] = data.unlockCost;
    }
    perType.forEach((count, t) => {
      const a = activityOf(p, DIVISION_ACTIVITY[t]!)!;
      a.workers = count * ACTIVITY_DATA[a.id]!.workersPerUnit;
      if (ACTIVITY_DATA[a.id]!.hasPlaces) a.places = a.workers;
    });
    activityOf(p, IDLE)!.workers = 0;
  }

  // 3. Divisions : créées directement, joueur par joueur, celles des fronts d'abord. Sans formation : un ordre de
  // déplacement serait refusé pendant la formation.
  const made: Division[][] = [[], []];
  for (const p of state.players) {
    for (const e of wanted) {
      for (let k = 0; k < e.count; k++) made[p.id - 1]!.push(addDivision(state, p.id, typeIndex(e.division), 0));
    }
  }

  // 4. Placement : sur chaque front, chaque type en première ligne jusqu'à la largeur du front, le reste en seconde ligne.
  const used = new Set<Division>();
  for (const front of state.fronts) {
    for (const player of front.players) {
      for (const e of composition) {
        const data = DIVISION_DATA[typeIndex(e.division)]!;
        const mine = made[player - 1]!.filter((d) => d.type === data.index && !used.has(d)).slice(0, e.count);
        for (const d of mine) used.add(d);
        const firstLine = Math.min(mine.length, Math.max(1, Math.ceil((front.connections.length * WIDTH_SCALE) / data.width)));
        const lines: [readonly Division[], "first" | "second"][] = [
          [mine.slice(0, firstLine), "first"],
          [mine.slice(firstLine), "second"],
        ];
        for (const [group, line] of lines) {
          if (group.length === 0) continue;
          order(
            state,
            { type: "move_division", player, ids: group.map((d) => d.id), front: front.id, line },
            `placement ${e.division}, joueur ${player}, front ${front.id}`,
          );
        }
      }
    }
  }

  // 5. Déplacements terminés d'emblée : les divisions sont en place dès le premier tour.
  for (const d of state.divisions) d.arrivalTick = 0;
  for (const [i, list] of made.entries()) {
    for (const d of list) {
      if (!state.divisions.includes(d) || (used.has(d) && d.front === 0)) throw new Error(`partie de test : division ${d.id} du joueur ${i + 1} absente ou sans front`);
    }
  }

  // 6. Population : les bonshommes des casernes et des usines, sans surplus de fondation.
  for (const p of state.players) {
    p.population = 0;
    for (const a of p.activities) p.population += a.workers;
  }

  return {
    cities: state.players.map((p) => p.cityIds.length),
    fronts: state.fronts.length,
    divisions: made.map((l) => l.filter((d) => used.has(d)).length),
    reserve: made.map((l) => l.filter((d) => !used.has(d)).length),
    connections: state.fronts.reduce((n, f) => n + f.connections.length, 0),
  };
}
