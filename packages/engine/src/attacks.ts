// Ordres d'attaque (Docs/Design/05-Fronts.md §5) : attaque sur tout le front et
// percées. Seulement sur un front actif. Le combat lui-même est dans combat.ts.

import { frontById, isActive, sideIndex } from "./fronts.ts";
import type { GameState } from "./state.ts";
import { currentTurn } from "./troops.ts";
import { zeros } from "./units.ts";

function mine(state: GameState, player: number, frontId: unknown) {
  if (!Number.isInteger(frontId)) return undefined;
  const front = frontById(state, frontId as number);
  if (front === undefined || !isActive(state, front)) return undefined;
  const i = sideIndex(front, player);
  return i < 0 ? undefined : { front, i, side: front.sides[i]! };
}

/** `start_front_attack` : invalide (sans effet) si l'attaque est déjà en cours. */
export function startFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || m.side.frontAttack) return false;
  m.side.frontAttack = true;
  return true;
}

export function stopFrontAttack(state: GameState, player: number, frontId: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || !m.side.frontAttack) return false;
  m.side.frontAttack = false;
  return true;
}

/** `start_breakthrough` : au plus une percée par axe et par camp (choix provisoire, 05-Fronts §5). */
export function startBreakthrough(state: GameState, player: number, frontId: unknown, city1: unknown, city2: unknown): boolean {
  const m = mine(state, player, frontId);
  if (m === undefined || !Number.isInteger(city1) || !Number.isInteger(city2)) return false;
  if (!m.front.connections.some((c) => c.city1 === city1 && c.city2 === city2)) return false;
  if (m.side.breakthroughs.some((b) => b.city1 === city1 && b.city2 === city2)) return false;
  m.side.breakthroughs.push({
    id: state.nextBreakthroughId++,
    city1: city1 as number,
    city2: city2 as number,
    startTick: currentTurn(state),
    phase: 0,
    attackers: zeros(),
    defenders1: zeros(),
    defenders2: zeros(),
    startHp: 0,
  });
  return true;
}

/** `cancel_breakthrough` : la percée est au joueur. Les unités engagées restent où elles sont. */
export function cancelBreakthrough(state: GameState, player: number, id: unknown): boolean {
  if (!Number.isInteger(id)) return false;
  for (const f of state.fronts) {
    const i = sideIndex(f, player);
    if (i < 0) continue;
    const side = f.sides[i]!;
    const k = side.breakthroughs.findIndex((b) => b.id === id);
    if (k < 0) continue;
    side.breakthroughs.splice(k, 1);
    return true;
  }
  return false;
}
