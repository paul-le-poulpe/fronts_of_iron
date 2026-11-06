// Statistiques de combat d'une première ligne, affichées dans la fenêtre d'un front (05-Fronts §11.4) : par niche et au
// total, l'attaque anti-infanterie, l'attaque anti-armure et les PV. Pas de DOM, aucune règle : la page recalcule avec les
// formules du moteur (`attackOf` dans `packages/engine/src/divisions.ts`) à partir du catalogue et de `DivisionView`.

import { type DivisionView, type MilitaryCatalog } from "./protocol.ts";
import { compact } from "./format.ts";

/** Millièmes de liaison dans une liaison (`WIDTH_SCALE` du moteur) : `DivisionView.engaged` est en millièmes, `frontWidth` en liaisons. */
const WIDTH_SCALE = 1000;

/** Les trois statistiques, dans l'ordre d'affichage. */
export const STAT_KINDS = ["soft", "hard", "hp"] as const;
export type StatKind = (typeof STAT_KINDS)[number];

export type Stats = Record<StatKind, number>;

export interface FirstLineStats {
  /** Une entrée par niche, dans l'ordre de `MilitaryCatalog.niches`. */
  readonly rows: readonly Stats[];
  /** Attaques de toutes les rangées, PV des niches principales seulement. */
  readonly total: Stats;
}

/**
 * Statistiques des divisions engagées en première ligne d'un camp (celles que le moteur fait combattre : première ligne,
 * largeur engagée > 0, pas en déplacement).
 * - Attaques : ce qui tombe réellement sur l'adversaire, comme `attackOf` : part engagée de la division
 *   (`engaged` / largeur de première ligne) × attaque × état (08 §5), en points. `attacking` : ce camp a lancé
 *   l'attaque sur tout le front, donc `attackMultiplier` du type s'applique ; sinon l'attaque est celle par défaut.
 * - PV : `hitPoints` du type × état de la division, sans multiplicateur de défense, et seulement pour les niches principales
 *   (les niches d'appui-feu n'ont pas de PV affichés).
 */
export function firstLineStats(military: MilitaryCatalog, divisions: readonly DivisionView[], attacking: boolean): FirstLineStats {
  // Millièmes de point (comme le moteur) pour les attaques, points pour les PV.
  const soft = military.niches.map(() => 0);
  const hard = military.niches.map(() => 0);
  const hp = military.niches.map(() => 0);
  const nicheIndex = new Map(military.niches.map((n, i) => [n.id, i]));
  for (const d of divisions) {
    if (d.line !== "first" || d.engaged <= 0 || d.status === "moving") continue;
    const type = military.divisions[d.type]!;
    const i = nicheIndex.get(type.niche);
    if (i === undefined) continue;
    const mult = attacking ? type.attackMultiplier : 100;
    const width = type.frontWidth * WIDTH_SCALE;
    if (d.state > 0 && width > 0) {
      const den = width * military.stateScale;
      soft[i]! += Math.floor((d.engaged * type.softAttack * d.state * mult * 10) / den);
      hard[i]! += Math.floor((d.engaged * type.hardAttack * d.state * mult * 10) / den);
    }
    if (!type.support) hp[i]! += (type.hitPoints * d.state) / military.stateScale;
  }
  const rows: Stats[] = military.niches.map((_, i) => ({ soft: Math.round(soft[i]! / 1000), hard: Math.round(hard[i]! / 1000), hp: Math.round(hp[i]!) }));
  const total: Stats = { soft: 0, hard: 0, hp: 0 };
  for (const r of rows) for (const k of STAT_KINDS) total[k] += r[k];
  return { rows, total };
}

/** Nombre court : exact sous 1 000, puis « 4,5K », « 135K », « 2,5M » (la colonne de statistiques est étroite). */
export function formatStat(n: number): string {
  return compact(n, 1000);
}
