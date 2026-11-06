// Ce que l'interface des fronts lit des divisions (05-Fronts §3, §11) : états affichés, attaques, couverture
// d'un front, rangement des fronts. Pas de DOM, aucune règle : la page affiche ce que le moteur envoie
// (`DivisionView`, `MilitaryCatalog`) et en tire des rapports.

import { type DivisionTypeInfo, type DivisionView, type FrontView, type MilitaryCatalog } from "./protocol.ts";

/** Le type d'une division. */
export const typeOf = (military: MilitaryCatalog, d: DivisionView): DivisionTypeInfo => military.divisions[d.type]!;

/** Une division que le joueur peut saisir : ni en formation ni en déplacement (05-Fronts §4.4, §11.4, 08 §6). */
export const movable = (d: DivisionView): boolean => d.status === "ready" || d.status === "fleeing";

/**
 * La division défend une percée adverse (tranche de première ligne, force de contre-attaque) : engagée dans une percée
 * sans être dans une boîte. La force qui perce a toujours `line = "box"` (05-Fronts §11.4).
 */
export const defendsBreakthrough = (d: DivisionView): boolean => d.breakthrough !== 0 && d.line !== "box";

/**
 * Ce que le statut d'un pion signifie (05-Fronts §11.3, §11.7), ou `null` si rien de particulier. Formation, déplacement
 * et fuite excluent une percée : une division en déplacement ou en fuite n'y est pas engagée.
 */
export function statusLabel(d: DivisionView): string | null {
  if (d.status === "formation") return "En entraînement";
  if (d.status === "moving") return d.front === 0 ? "En route vers la réserve" : "En route vers le front";
  if (d.status === "fleeing") return "En repli";
  return defendsBreakthrough(d) ? "Défend une percée" : null;
}

/** État affiché, en pourcent entier. */
export const statePercent = (military: MilitaryCatalog, d: DivisionView): number => Math.round((100 * d.state) / military.stateScale);

export interface Attacks {
  readonly soft: number;
  readonly hard: number;
  readonly air: number;
}

/** Attaques d'une division pleine : somme de tous ses composants (08 §5), sans multiplicateur. */
export function maxAttacks(type: DivisionTypeInfo): Attacks {
  return { soft: type.softAttack, hard: type.hardAttack, air: type.airAttack };
}

/** Attaques actuelles d'une division : celles d'une division pleine × son état (08 §5). */
export function currentAttacks(type: DivisionTypeInfo, d: DivisionView, stateScale: number): Attacks {
  const r = d.state / stateScale;
  return { soft: Math.round(type.softAttack * r), hard: Math.round(type.hardAttack * r), air: Math.round(type.airAttack * r) };
}

/** Longueur d'un front : son nombre de connexions (05-Fronts §2.2). */
export const frontLength = (f: FrontView): number => f.connections.length;

/** Les fronts d'un joueur, rangés (05-Fronts §11.2) : les fronts en guerre active d'abord, puis ceux en paix, chaque groupe du plus long au plus court. */
export function sortedFronts(fronts: readonly FrontView[], me: number): FrontView[] {
  return fronts
    .filter((f) => f.players.includes(me))
    .sort((a, b) => Number(b.active) - Number(a.active) || frontLength(b) - frontLength(a) || a.id - b.id);
}

/** L'autre joueur d'un front. */
export const opponentOf = (f: FrontView, me: number): number => (f.players[0] === me ? f.players[1] : f.players[0]);

/**
 * Couverture d'une niche en première ligne d'un camp, en pourcent entier (05-Fronts §11.4) : somme des largeurs
 * engagées (millièmes de liaison) / (connexions × 1 000), de 0 à 100.
 */
export function coveragePercent(front: FrontView, engaged: number): number {
  const total = frontLength(front) * 1000;
  return total > 0 ? Math.min(100, Math.round((100 * engaged) / total)) : 0;
}

/** Les divisions d'un camp d'un front, tous statuts confondus (une division en déplacement est comptée à sa destination). */
export const divisionsAt = (divisions: readonly DivisionView[], front: number, owner: number): DivisionView[] =>
  divisions.filter((d) => d.front === front && d.owner === owner);
