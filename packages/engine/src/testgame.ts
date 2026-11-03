// État de départ de la partie de test (outil de développement, Docs/Design/01-Architecture.md §9 bis). Appelée une fois
// juste après `createGame` avec `freezeEconomy` : fonde les villes des deux joueurs, remplit les stocks par écriture
// directe, puis crée et place les divisions par les ordres du moteur. Ce ne sont pas des règles du jeu.
//
// Déterministe (règle 2) : aucun hasard, cases parcourues dans un ordre fixé.

import { ARMAMENT, CITY, ELITE_TROOPS_RATIO, TEST_GAME, TEST_SCENARIOS, type TestScenarioId } from "./config.ts";
import { foundCity, foundingCost } from "./cities.ts";
import { WIDTH_SCALE, DIVISION_DATA, DIVISION_IDS, MEN, countSoldiers, type Division } from "./divisions.ts";
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
    // Les villes se paient en population : le stock est refait plus bas.
    p.population = Math.max(p.population, foundingCost(p.cityIds.length) + p.hurt + 1);
    if (!foundCity(state, p.id, tile, changed)) throw new Error(`partie de test : ville refusée en ${tile} (joueur ${p.id})`);
  }
  if (state.fronts.length === 0) throw new Error("partie de test : aucun front entre les deux joueurs");

  // 2. Ce que chaque joueur reçoit : la composition de chaque front, puis `reservePerType` divisions de chaque type dans la
  // réserve nationale (les élites seulement jusqu'à ce que `ELITE_TROOPS_RATIO` permet).
  const frontCount = state.fronts.length;
  const typeIndex = (id: string): number => DIVISION_IDS.indexOf(id as (typeof DIVISION_IDS)[number]);
  const frontPart = composition.map((e) => ({ division: e.division, count: e.count * frontCount }));
  const reservePart: { division: string; count: number }[] = [];
  let infantry = 0;
  const eliteNiche = DIVISION_DATA.find((d) => d.elite)!.niche;
  for (const e of frontPart) if (DIVISION_DATA[typeIndex(e.division)]!.niche === eliteNiche) infantry += e.count;
  for (const id of DIVISION_IDS) {
    const data = DIVISION_DATA[typeIndex(id)]!;
    if (!data.elite && data.niche === eliteNiche) infantry += TEST_GAME.reservePerType;
  }
  for (const id of DIVISION_IDS) {
    const data = DIVISION_DATA[typeIndex(id)]!;
    let count: number = TEST_GAME.reservePerType;
    if (data.elite) {
      // La k-ième élite est permise si ratio × k ≤ (infanterie + k − 1) + 1 (`eliteAllowed`).
      let k = 0;
      while (k < count && ELITE_TROOPS_RATIO * (k + 1) <= infantry + k + 1) k++;
      count = k;
    }
    reservePart.push({ division: id, count });
  }
  const wanted = [...frontPart, ...reservePart];

  // Stocks (écriture directe) : divisions complètes, composants facultatifs compris, plus la réserve de renfort.
  const factor = (100 + TEST_GAME.reservePercent) / 100;
  for (const p of state.players) {
    let men = 0;
    const armament = new Array<number>(Object.keys(ARMAMENT.types).length).fill(0);
    for (const e of wanted) {
      const data = DIVISION_DATA[typeIndex(e.division)]!;
      for (const c of data.components) {
        if (c.resource === MEN) men += c.count * e.count;
        else armament[c.resource] = armament[c.resource]! + c.count * e.count;
      }
    }
    p.idle = Math.ceil(men * factor);
    armament.forEach((n, i) => (p.armamentReserve[i] = Math.ceil(n * factor)));
  }

  // 3. Divisions : `create_division` par le chemin normal des ordres, joueur par joueur, celles des fronts d'abord.
  const made: Division[][] = [[], []];
  for (const p of state.players) {
    for (const e of wanted) {
      for (let k = 0; k < e.count; k++) {
        order(state, { type: "create_division", player: p.id, division: e.division }, `création ${e.division}, joueur ${p.id}`);
        const d = state.divisions[state.divisions.length - 1]!;
        // Pas de formation : un ordre de déplacement serait refusé pendant la formation.
        (d as { formedTick: number }).formedTick = 0; // en lecture seule pour les règles, écrit ici seulement
        made[p.id - 1]!.push(d);
      }
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

  // 6. Population : les hommes des stocks et des divisions, sans surplus de fondation.
  countSoldiers(state);
  for (const p of state.players) {
    p.hurt = 0;
    p.population = p.idle + p.soldiers;
  }

  return {
    cities: state.players.map((p) => p.cityIds.length),
    fronts: state.fronts.length,
    divisions: made.map((l) => l.filter((d) => used.has(d)).length),
    reserve: made.map((l) => l.filter((d) => !used.has(d)).length),
    connections: state.fronts.reduce((n, f) => n + f.connections.length, 0),
  };
}
