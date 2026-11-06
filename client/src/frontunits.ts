// Unités dessinées sur la carte à chaque connexion d'un front (Docs/Design/05-Fronts.md §11.1) : au plus une infanterie
// et une autre unité par camp, prises dans la première ligne. Pas d'accès au DOM. Rien ici n'est une règle de combat.

import { pawnOrder } from "./pawn.ts";
import type { DivisionView, MilitaryCatalog } from "./protocol.ts";

/** Ce qu'un camp montre sur une connexion. */
export interface LinkUnits {
  readonly infantry: DivisionView | null;
  readonly other: DivisionView | null;
}

const INFANTRY = "infantry";

/**
 * Unités du camp `owner` sur le front `front`, par indice de connexion. `order` : les connexions le long du front.
 * L'infanterie prend les connexions dans l'ordre, tant qu'il en reste. Les autres niches donnent une unité chacune à tour
 * de rôle, et ces unités sont espacées régulièrement le long du front. Ce qui dépasse une unité par connexion n'est pas montré.
 */
export function linkUnits(divisions: readonly DivisionView[], military: MilitaryCatalog, front: number, owner: number, order: readonly number[]): LinkUnits[] {
  const nicheOf = (d: DivisionView): string => military.divisions[d.type]?.niche ?? "";
  // Une division en route n'est pas encore sur le front.
  const line = pawnOrder(
    divisions.filter((d) => d.front === front && d.owner === owner && d.line === "first" && d.status !== "moving"),
    military,
  );
  const infantry = line.filter((d) => nicheOf(d) === INFANTRY);
  const pools = military.niches.filter((n) => n.id !== INFANTRY).map((n) => line.filter((d) => nicheOf(d) === n.id));
  const others: DivisionView[] = [];
  for (let round = 0; others.length < order.length && pools.some((p) => round < p.length); round++) {
    for (const pool of pools) if (round < pool.length) others.push(pool[round]!);
  }
  const shown = others.slice(0, order.length);
  const out = order.map((): { infantry: DivisionView | null; other: DivisionView | null } => ({ infantry: null, other: null }));
  order.forEach((connection, i) => (out[connection]!.infantry = infantry[i] ?? null));
  shown.forEach((d, i) => (out[order[Math.floor((i * order.length) / shown.length)]!]!.other = d));
  return out;
}
