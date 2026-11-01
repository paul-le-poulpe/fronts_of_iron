// Ce que l'interface des fronts lit des divisions (05-Fronts §3, §11) : états affichés, équipement
// actuel et requis, attaques, nombre de divisions « supportable » du menu « + », couverture d'un front,
// rangement des fronts. Pas de DOM, aucune règle : la page affiche ce que le moteur envoie
// (`DivisionView`, `MilitaryCatalog`, `PlayerStats`, `HumanDetail`) et en tire des rapports.

import { type DivisionTypeInfo, type DivisionView, type FrontView, type HumanDetail, type MilitaryCatalog, type PlayerStats } from "./protocol.ts";

/** Le type d'une division. */
export const typeOf = (military: MilitaryCatalog, d: DivisionView): DivisionTypeInfo => military.divisions[d.type]!;

/** Une division que le joueur peut saisir : ni en formation ni en déplacement (05-Fronts §3.5, §4.4, §11.4). */
export const movable = (d: DivisionView): boolean => d.status === "ready" || d.status === "fleeing";

/** État affiché, en pourcent entier. */
export const statePercent = (military: MilitaryCatalog, d: DivisionView): number => Math.round((100 * d.state) / military.stateScale);

/** Taux de chaque composant (exemplaires présents / exemplaires d'une division complète), de 0 à 1. */
const rate = (type: DivisionTypeInfo, d: DivisionView, i: number): number => (type.components[i]!.count > 0 ? Math.min(1, d.counts[i]! / type.components[i]!.count) : 0);

export interface Attacks {
  readonly soft: number;
  readonly hard: number;
  readonly air: number;
}

/** Attaques d'une division complète : somme des apports des composants complets (05-Fronts §3.2), sans multiplicateur. */
export function maxAttacks(type: DivisionTypeInfo): Attacks {
  let soft = 0;
  let hard = 0;
  let air = 0;
  for (const c of type.components) {
    soft += c.softAttack;
    hard += c.hardAttack;
    air += c.airAttack;
  }
  return { soft, hard, air };
}

/** Attaques actuelles d'une division : l'apport de chaque composant est sa stat × son taux (05-Fronts §3.2). */
export function currentAttacks(type: DivisionTypeInfo, d: DivisionView): Attacks {
  let soft = 0;
  let hard = 0;
  let air = 0;
  type.components.forEach((c, i) => {
    const r = rate(type, d, i);
    soft += c.softAttack * r;
    hard += c.hardAttack * r;
    air += c.airAttack * r;
  });
  return { soft: Math.round(soft), hard: Math.round(hard), air: Math.round(air) };
}

/**
 * Nombre de divisions complètes du type que le pays peut équiper avec ce qu'il a (05-Fronts §11.2) : pour chaque
 * composant requis, ce qui est dans les divisions plus ce qui est en stock (hommes : soldats plus inactifs),
 * divisé par la quantité d'une division ; le composant le plus limitant fixe le nombre.
 */
export function supportable(type: DivisionTypeInfo, stats: PlayerStats, detail: HumanDetail, armamentIds: readonly string[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const c of type.components) {
    if (!c.required || c.count <= 0) continue;
    let have = 0;
    if (c.resource === "men") have = stats.soldiers + stats.idle;
    else {
      const i = armamentIds.indexOf(c.resource);
      if (i >= 0) have = (detail.reserve[i] ?? 0) + (stats.divisionEquipment[i] ?? 0);
    }
    best = Math.min(best, Math.floor(have / c.count));
  }
  return Number.isFinite(best) ? best : 0;
}

/** Peut-on créer une division du type maintenant ? Copie de la condition du moteur (05-Fronts §3.5) : les inactifs et le stock remplissent ses composants requis. */
export function creatable(type: DivisionTypeInfo, stats: PlayerStats, detail: HumanDetail, armamentIds: readonly string[]): boolean {
  for (const c of type.components) {
    if (!c.required) continue;
    const has = c.resource === "men" ? stats.idle : (detail.reserve[armamentIds.indexOf(c.resource)] ?? 0);
    if (has < c.count) return false;
  }
  return true;
}

/**
 * Le joueur peut-il créer une division de ce type, vu ses élites ? Copie de la condition du moteur (05-Fronts §3.5) :
 * `eliteTroopsRatio × (élites + 1) ≤ divisions de la niche + 1`, en formation ou non. Toujours oui hors des élites.
 */
export function eliteAllowed(military: MilitaryCatalog, type: DivisionTypeInfo, divisions: readonly DivisionView[], me: number): boolean {
  if (!type.elite) return true;
  let elites = 0;
  let total = 0;
  for (const d of divisions) {
    if (d.owner !== me) continue;
    const t = military.divisions[d.type]!;
    if (t.niche !== type.niche) continue;
    total++;
    if (t.elite) elites++;
  }
  return military.eliteTroopsRatio * (elites + 1) <= total + 1;
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
