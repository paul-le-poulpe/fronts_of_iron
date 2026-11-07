// Unités dessinées sur la carte à chaque connexion d'un front (Docs/Design/05-Fronts.md §11.1) : toute la première ligne,
// répartie le long du front. Pas d'accès au DOM. Rien ici n'est une règle de combat.

import { pawnOrder } from "./pawn.ts";
import type { DivisionView, MilitaryCatalog } from "./protocol.ts";

/** Ce qu'un camp montre sur une connexion. */
export interface LinkUnits {
  readonly infantry: DivisionView | null;
  /** Chars et appui-feu. */
  readonly others: readonly DivisionView[];
}

const INFANTRY = "infantry";

/**
 * Unités du camp `owner` sur le front `front`, par indice de connexion. `order` : les connexions le long du front.
 * L'infanterie prend les connexions dans l'ordre, tant qu'il en reste. Chaque autre niche est espacée régulièrement le long
 * du front, à partir d'un point de départ propre à la niche : une connexion reçoit d'abord une niche qu'elle n'a pas, puis
 * reste celle qui a le moins d'unités, puis la plus proche de la place visée.
 */
export function linkUnits(divisions: readonly DivisionView[], military: MilitaryCatalog, front: number, owner: number, order: readonly number[]): LinkUnits[] {
  const nicheOf = (d: DivisionView): string => military.divisions[d.type]?.niche ?? "";
  // Une division en route n'est pas encore sur le front.
  const line = pawnOrder(
    divisions.filter((d) => d.front === front && d.owner === owner && d.line === "first" && d.status !== "moving"),
    military,
  );
  const n = order.length;
  const others: DivisionView[][] = order.map(() => []);
  const niches = military.niches.filter((niche) => niche.id !== INFANTRY);
  niches.forEach((niche, rank) => {
    const units = line.filter((d) => nicheOf(d) === niche.id);
    const start = (rank * n) / niches.length;
    units.forEach((d, k) => {
      const wanted = (start + (k * n) / units.length) % n;
      const distance = (i: number): number => Math.min(Math.abs(i - wanted), n - Math.abs(i - wanted));
      const hasNiche = (i: number): number => (others[i]!.some((u) => nicheOf(u) === niche.id) ? 1 : 0);
      let best = 0;
      for (let i = 1; i < n; i++) {
        if ((hasNiche(i) - hasNiche(best) || others[i]!.length - others[best]!.length || distance(i) - distance(best)) < 0) best = i;
      }
      others[best]!.push(d);
    });
  });
  const infantry = line.filter((d) => nicheOf(d) === INFANTRY);
  const out: LinkUnits[] = [];
  order.forEach((connection, i) => (out[connection] = { infantry: infantry[i] ?? null, others: others[i]! }));
  return out;
}
