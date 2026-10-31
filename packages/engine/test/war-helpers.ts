// Outils des tests des fronts (05-Fronts §13.7) : une petite carte de terre sans relief où les
// villes sont posées à des distances exactes, des joueurs avec population et armement, des
// ordres envoyés par `applyTurn`.

import assert from "node:assert/strict";

import {
  applyTurn,
  CITY,
  createGame,
  DIVISION_DATA,
  DIVISION_IDS,
  DIVISIONS,
  FRONTS,
  LINE_SECOND,
  MEN,
  nextInt,
  type Division,
  type DivisionComponentConfig,
  type DivisionId,
  type Front,
  type GameMap,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { customMap, tileAt } from "./helpers.ts";

/** Rayon de contrôle ; deux villes à 1,5 R l'une de l'autre sont reliées par une route (rayon d'expansion = 2 R) sans que leurs zones se recouvrent. */
export const R = CITY.controlRadius;
export const MAP: GameMap = customMap(14 * R, 10 * R, () => "land");

/** Case de la ville posée en (x, y), en unités de R / 2 (pour éviter les fractions). */
export const at = (halfR: number, halfRY: number): number => tileAt(MAP, Math.floor((halfR * R) / 2), Math.floor((halfRY * R) / 2));

/** Envoie les ordres au tour suivant. */
export function turn(s: GameState, ...intents: Intent[]): void {
  applyTurn(s, { turn: s.tick + 1, intents });
}

/** Joue `n` tours sans ordre. */
export function play(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) turn(s);
}

/** Joue jusqu'à ce que `s.tick` soit un multiple de `combatTurns` (juste après un round de combat). */
export function playToRound(s: GameState): void {
  do turn(s);
  while (s.tick % FRONTS.combatTurns !== 0);
}

export const found = (player: number, tile: number): Intent => ({ type: "found_city", player, tile });

/** Deux joueurs, une ville chacun, reliées par une route : un front entre eux. Joueur 1 à gauche. */
export function duel(map: GameMap = MAP): GameState {
  const s = createGame({ seed: 1, map, playerCount: 2 });
  turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
  assert.equal(s.fronts.length, 1);
  return s;
}

/** Le front n° `i` de l'état. */
export const front = (s: GameState, i = 0): Front => s.fronts[i]!;

/** Indice d'un type de division. */
export const D = Object.fromEntries(DIVISION_IDS.map((id, i) => [id, i])) as Record<DivisionId, number>;

/** Donne au joueur l'armement et les inactifs de quoi créer ces divisions, et de la population. Ne crée rien. */
export function stock(s: GameState, player: number, divisions: Partial<Record<DivisionId, number>>, population = 5_000_000): void {
  const p = s.players[player - 1]!;
  p.population = population;
  for (const [id, n] of Object.entries(divisions)) {
    for (const c of DIVISION_DATA[D[id as DivisionId]]!.components) {
      if (c.resource === MEN) p.idle += (n ?? 0) * c.count;
      else p.armamentReserve[c.resource] = p.armamentReserve[c.resource]! + (n ?? 0) * c.count;
    }
  }
}

/**
 * Pose directement une division complète, formée, sur place (sans ordre, sans délai) : `front` 0 pour la réserve
 * nationale. Les soldats du joueur sont recomptés au tour suivant.
 */
export function put(s: GameState, player: number, type: DivisionId, front = 0): Division {
  const data = DIVISION_DATA[D[type]]!;
  const d: Division = {
    id: s.nextDivisionId++,
    owner: player,
    type: data.index,
    counts: data.components.map((c) => c.count),
    front,
    line: LINE_SECOND,
    box: 0,
    breakthrough: 0,
    btEngaged: 0,
    engaged: 0,
    arrivalTick: 0,
    formedTick: 0,
    fleeUntilTick: 0,
  };
  s.divisions.push(d);
  return d;
}

/** Une carte où une case sur dix porte du fer, pour les tests qui ont besoin d'une usine. */
export const IRON_MAP: GameMap = customMap(14 * R, 10 * R, () => "land", (x, y) => (x + y) % 10 === 0);

// ---- modèle de référence des pertes (05-Fronts §1, §3.2), écrit d'après les règles et pas d'après src/ ----

/** Dénominateur des pertes tirées : 10⁶ (fraction de la division) × 100 (échelle du lossMultiplier). */
const LOSS_Q = 100_000_000;

/**
 * Pertes d'une division pour une fraction `f` (sur 10⁶) de la division complète, §6.2 point 5 et §1 : chaque composant
 * perd `f × lossMultiplier × count / 10⁶` exemplaires ; la partie entière est perdue, et un exemplaire de plus si
 * `nextInt(rng, q) < reste`, seulement quand le reste est positif. Composants dans l'ordre de `components`. Un composant
 * vide ne tire pas (la règle ne le dit pas : les tests évitent ce cas). Avance `rng`.
 */
export function modelLoss(type: DivisionId, counts: readonly number[], f: number, rng: Uint32Array): number[] {
  const comps = DIVISIONS[type].components as readonly DivisionComponentConfig[];
  return counts.map((has, i) => {
    if (has === 0) return 0;
    const p = f * Math.round((comps[i]!.lossMultiplier ?? 1) * 100) * comps[i]!.count;
    let lost = Math.floor(p / LOSS_Q);
    if (p % LOSS_Q > 0 && nextInt(rng, LOSS_Q) < p % LOSS_Q) lost++;
    return has - Math.min(has, lost);
  });
}

/** Pas d'excédent (§3.2) : aucun composant au-dessus du taux de soldats, le plus petit taux parmi les composants requis. */
export function modelTrim(type: DivisionId, counts: readonly number[]): number[] {
  const comps = DIVISIONS[type].components as readonly DivisionComponentConfig[];
  const c = [...counts];
  for (;;) {
    let j = -1;
    comps.forEach((k, i) => {
      if (k.required && (j < 0 || c[i]! * comps[j]!.count < c[j]! * k.count)) j = i;
    });
    let changed = false;
    comps.forEach((k, i) => {
      const cap = Math.floor((c[j]! * k.count) / comps[j]!.count);
      if (c[i]! > cap) {
        c[i] = cap;
        changed = true;
      }
    });
    if (!changed) return c;
  }
}

/** Une perte à appliquer : la division `id` perd la fraction `f` (sur 10⁶). */
export interface ModelHit {
  readonly id: number;
  readonly f: number;
}

/**
 * Compteurs attendus après des phases de pertes (une phase = les divisions touchées, par identifiant croissant, puis
 * l'excédent rendu), à partir des compteurs `before` de chaque division. Les tirages consomment `rng` dans l'ordre.
 */
export function modelRound(before: ReadonlyMap<number, { type: DivisionId; counts: readonly number[] }>, phases: readonly (readonly ModelHit[])[], rng: Uint32Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const [id, d] of before) out.set(id, [...d.counts]);
  for (const phase of phases) {
    for (const hit of phase) {
      const d = before.get(hit.id)!;
      out.set(hit.id, modelLoss(d.type, out.get(hit.id)!, hit.f, rng));
    }
    for (const [id, d] of before) out.set(id, modelTrim(d.type, out.get(id)!));
  }
  return out;
}

/** Les compteurs de toutes les divisions de l'état, par identifiant. */
export function snapshot(s: GameState): Map<number, { type: DivisionId; counts: number[] }> {
  return new Map(s.divisions.map((d) => [d.id, { type: DIVISION_IDS[d.type]!, counts: [...d.counts] }]));
}

/** Joue jusqu'à ce que le prochain tour soit un tour de round de combat (aucun tour si c'est déjà le cas). */
export function playUntilBeforeRound(s: GameState): void {
  while ((s.tick + 1) % FRONTS.combatTurns !== 0) turn(s);
}

/** Joue jusqu'à ce que le prochain tour ne soit pas un tour de round de combat. */
export function playUntilNotRound(s: GameState): void {
  while ((s.tick + 1) % FRONTS.combatTurns === 0) turn(s);
}

/** Guerre entre les joueurs 1 et 2 sur le front du duel ; les joueurs de `attackers` lancent une attaque sur tout le front. */
export function war(s: GameState, ...attackers: number[]): void {
  turn(s, { type: "declare_war", player: 1, target: 2 });
  for (const player of attackers) turn(s, { type: "start_front_attack", player, front: front(s).id });
}

/**
 * Élargit le front de `s` à `width` liaisons en ajoutant des copies de sa première connexion (le front du duel n'en a
 * qu'une). Pour les tests qui ont besoin d'une largeur précise sans bâtir de villes : les copies disparaîtraient au
 * prochain `updateFronts`, donc pas de prise de ville avec.
 */
export function widen(s: GameState, width: number): void {
  const f = front(s);
  const c = f.connections[0]!;
  while (f.connections.length < width) f.connections.push({ city1: c.city1, city2: c.city2, position: c.position });
}

/** `n` divisions complètes de ce type sur le front 1, pour le joueur `player`. Renvoie leurs identifiants. */
export function putMany(s: GameState, player: number, type: DivisionId, n: number, frontId = 1): number[] {
  return Array.from({ length: n }, () => put(s, player, type, frontId).id);
}

/**
 * Compare les compteurs de chaque division de l'état à ceux que prévoit le modèle, et le générateur au générateur
 * `rng` qui a tiré les mêmes pertes dans le même ordre (même nombre de tirages, même ordre).
 */
export function expectModel(s: GameState, before: ReturnType<typeof snapshot>, phases: readonly (readonly ModelHit[])[], rng: Uint32Array): void {
  const want = modelRound(before, phases, rng);
  for (const d of s.divisions) assert.deepEqual(d.counts, want.get(d.id), `division ${d.id}`);
  assert.deepEqual([...s.rng], [...rng], "les tirages de pertes ne sont pas ceux du modèle");
}

/** Joue jusqu'à la veille d'un round, relève les compteurs et le générateur, joue le round. */
export function playRound(s: GameState): { before: ReturnType<typeof snapshot>; rng: Uint32Array } {
  playUntilBeforeRound(s);
  const before = snapshot(s);
  const rng = new Uint32Array(s.rng);
  turn(s);
  return { before, rng };
}
