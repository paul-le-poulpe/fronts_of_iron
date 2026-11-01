// Fronts terrestres (Docs/Design/05-Fronts.md) : état, détection à partir des
// routes, guerre et paix. Les divisions et leur placement sont dans divisions.ts
// et placement.ts, le combat dans combat.ts, la prise d'une ville dans conquest.ts.
//
// Un front est l'ensemble des connexions (routes entre deux villes de joueurs
// différents) entre un groupe d'un joueur et un groupe d'un autre joueur. Il est
// symétrique : les deux joueurs voient le même front. Les deux camps sont rangés
// dans l'ordre des joueurs du front, `players[0] < players[1]`.

import { afterFrontsChanged, endBreakthroughsBetween } from "./breakthroughs.ts";
import { FRONTS } from "./config.ts";
import { STATUS_WAR, statusOf } from "./diplomacy.ts";
import { LINE_SECOND, WIDTH_SCALE, type Division } from "./divisions.ts";
import type { GameState } from "./state.ts";

/** Une route dont les deux villes sont à deux joueurs différents. */
export interface FrontConnection {
  /** Ville de `players[0]`. */
  readonly city1: number;
  /** Ville de `players[1]`. */
  readonly city2: number;
  /** Position du front, en millièmes de la route depuis `city1`, 0 à 1 000. Fronts actifs seulement ; 0 en paix. */
  position: number;
}

/** Un camp d'un front. Ses divisions sont dans `state.divisions` (`Division.front`). */
export interface FrontSide {
  /** Attaque sur tout le front en cours (05-Fronts §5.1). */
  frontAttack: boolean;
  /** Hommes perdus par sa première ligne au dernier round de combat (05-Fronts §11.4) ; remis à 0 à chaque round. */
  lastLoss: number;
}

export interface Front {
  readonly id: number;
  /** `players[0] < players[1]`. */
  readonly players: readonly [number, number];
  /** Groupes (identifiants de ville) des deux camps. */
  readonly groups: readonly [number, number];
  /** Rangées par (city1, city2). */
  connections: FrontConnection[];
  /** Un par camp, dans l'ordre de `players`. */
  sides: [FrontSide, FrontSide];
}

/** Position du front à la déclaration de guerre, et sur une connexion créée en guerre par une fondation (05-Fronts §2.3, §2.4). */
export const MIDDLE = 500;
/** Longueur d'une route en millièmes. */
export const ROUTE = 1000;

/** Position d'arrivée du camp `x` : 1 000 pour `players[0]` (il avance vers la ville 2), 0 pour `players[1]`. */
export const endOf = (x: number): number => (x === 0 ? ROUTE : 0);

/** Largeur du front en millièmes de liaison : une liaison par connexion (05-Fronts §1). Jamais stockée. */
export const frontWidth = (front: Front): number => front.connections.length * WIDTH_SCALE;

/** Les deux joueurs du front sont-ils en guerre ? (front actif) */
export const isActive = (state: GameState, front: Front): boolean => statusOf(state, front.players[0], front.players[1]) === STATUS_WAR;

/**
 * Phases d'une percée où l'on combat (05-Fronts §7.2) : 1 contre la première ligne, 3 contre la réaction rapide. Les phases
 * 0, 2 et 4 sont des délais (avant le combat 1, entre les deux combats, avant la chute de la ville).
 */
export const isBreakthroughCombat = (phase: number): boolean => phase === 1 || phase === 3;

/** Un front est en combat quand il est actif et qu'un camp attaque sur tout le front, ou qu'une percée y combat (05-Fronts §4.3, §6, §7.2). */
export const inCombat = (state: GameState, front: Front): boolean =>
  isActive(state, front) && (front.sides.some((s) => s.frontAttack) || state.breakthroughs.some((b) => b.front === front.id && isBreakthroughCombat(b.phase)));

/** Un round est joué sur ce front : il est en combat, ou une percée y attend la fin d'un de ses délais. */
export const hasRound = (state: GameState, front: Front): boolean => inCombat(state, front) || (isActive(state, front) && state.breakthroughs.some((b) => b.front === front.id));

/** Villes qui ont au moins une connexion dans un front actif (05-Fronts §8) : leur rayon d'expansion ne compte pas pour fonder. */
export function activeFrontCities(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const f of state.fronts) {
    if (!isActive(state, f)) continue;
    for (const c of f.connections) {
      out.add(c.city1);
      out.add(c.city2);
    }
  }
  return out;
}

/** Indice du camp de `player` dans le front (0 ou 1), -1 s'il n'en est pas un. */
export const sideIndex = (front: Front, player: number): number => (front.players[0] === player ? 0 : front.players[1] === player ? 1 : -1);

export function frontById(state: GameState, id: number): Front | undefined {
  return state.fronts.find((f) => f.id === id);
}

/**
 * Parts entières de `amount` proportionnelles à `weights` (05-Fronts §2.5,
 * coupure) : partie entière, puis une unité de plus aux plus grands restes, à
 * égalité au plus petit indice. Aucune part n'est donnée à un poids nul.
 */
export function splitProportional(amount: number, weights: readonly number[]): number[] {
  const out = weights.map(() => 0);
  let total = 0;
  for (const w of weights) total += w;
  if (amount <= 0 || total <= 0) return out;
  const remainder = weights.map(() => 0);
  let given = 0;
  weights.forEach((w, i) => {
    const part = amount * w;
    out[i] = Math.floor(part / total);
    remainder[i] = part % total;
    given += out[i]!;
  });
  const order = weights.map((_, i) => i).filter((i) => weights[i]! > 0);
  order.sort((a, b) => remainder[b]! - remainder[a]! || a - b);
  for (let k = 0; given < amount; k++, given++) out[order[k % order.length]!] = out[order[k % order.length]!]! + 1;
  return out;
}

// ---- détection (05-Fronts §2) ----

interface Bucket {
  readonly p1: number;
  readonly p2: number;
  readonly g1: number;
  readonly g2: number;
  /** Connexions de cette clé, triées par (city1, city2). */
  readonly conns: { readonly city1: number; readonly city2: number }[];
  id: number;
}

const connKey = (p1: number, p2: number, c1: number, c2: number): string => `${p1},${p2},${c1},${c2}`;

/** Prise d'une ville : ses nouvelles connexions entre l'attaquant et le défenseur reçoivent `capturePercent` (05-Fronts §10.1). */
export interface CaptureInfo {
  readonly city: number;
  readonly attacker: number;
  readonly defender: number;
}

/**
 * Recalcule la table des fronts à partir de `state.roads` et des propriétaires des
 * villes (05-Fronts §2.4). À appeler quand les routes ou le propriétaire d'une
 * ville changent : fondation, prise. Les positions des connexions retrouvées sont
 * gardées ; les identifiants et l'état d'attaque suivent la règle du §2.5 ; les
 * divisions des anciens fronts suivent leurs connexions (§2.5) : fusion, mises
 * ensemble ; coupure, réparties au prorata des connexions ; front disparu, divisions
 * au front le plus proche, sinon retour à la réserve sans délai.
 */
export function updateFronts(state: GameState, capture?: CaptureInfo): void {
  const old = state.fronts;
  // 1. Anciennes connexions, indexées par (p1, p2, city1, city2) : les joueurs font partie de la clé (05-Fronts §13.6).
  const oldPosition = new Map<string, number>();
  const oldFrontOf = new Map<string, Front>();
  for (const f of old) {
    for (const c of f.connections) {
      const k = connKey(f.players[0], f.players[1], c.city1, c.city2);
      oldPosition.set(k, c.position);
      oldFrontOf.set(k, f);
    }
  }

  // 2. Nouvelles connexions : paires de joueurs différents, orientées, rangées par clé (g1, g2).
  const buckets = new Map<string, Bucket>();
  for (const [a, b] of state.roads) {
    const ca = state.cities[a - 1]!;
    const cb = state.cities[b - 1]!;
    if (ca.player === cb.player) continue;
    const [c1, c2] = ca.player < cb.player ? [ca, cb] : [cb, ca];
    const key = `${c1.group}:${c2.group}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { p1: c1.player, p2: c2.player, g1: c1.group, g2: c2.group, conns: [], id: 0 };
      buckets.set(key, bucket);
    }
    bucket.conns.push({ city1: c1.id, city2: c2.id });
  }
  const fresh = [...buckets.values()];
  for (const b of fresh) b.conns.sort((x, y) => x.city1 - y.city1 || x.city2 - y.city2);
  fresh.sort((x, y) => x.conns[0]!.city1 - y.conns[0]!.city1 || x.conns[0]!.city2 - y.conns[0]!.city2);

  // 3. Identifiants (05-Fronts §2.5) : l'ancien front qui partage le plus de connexions avec le
  // nouveau, à égalité le plus petit identifiant ; un ancien identifiant n'est repris qu'une fois.
  const pairs: { overlap: number; oldId: number; index: number }[] = [];
  fresh.forEach((b, index) => {
    const overlaps = new Map<number, number>();
    for (const c of b.conns) {
      const f = oldFrontOf.get(connKey(b.p1, b.p2, c.city1, c.city2));
      if (f !== undefined) overlaps.set(f.id, (overlaps.get(f.id) ?? 0) + 1);
    }
    for (const [oldId, overlap] of overlaps) pairs.push({ overlap, oldId, index });
  });
  pairs.sort((x, y) => y.overlap - x.overlap || x.oldId - y.oldId || x.index - y.index);
  const matched = new Map<number, Front>();
  const usedOld = new Set<number>();
  for (const p of pairs) {
    if (fresh[p.index]!.id !== 0 || usedOld.has(p.oldId)) continue;
    fresh[p.index]!.id = p.oldId;
    usedOld.add(p.oldId);
    matched.set(p.oldId, old.find((f) => f.id === p.oldId)!);
  }
  for (const b of fresh) if (b.id === 0) b.id = state.nextFrontId++;

  // 4. Nouveaux fronts : connexions avec leur position, état d'attaque de l'ancien front repris.
  const next: Front[] = fresh.map((b) => {
    const war = statusOf(state, b.p1, b.p2) === STATUS_WAR;
    const connections = b.conns.map((c) => {
      let position = 0;
      if (war) {
        const kept = oldPosition.get(connKey(b.p1, b.p2, c.city1, c.city2));
        if (kept !== undefined) position = kept;
        else if (capture !== undefined && (c.city1 === capture.city || c.city2 === capture.city) && b.p1 + b.p2 === capture.attacker + capture.defender) {
          // 05-Fronts §10.1 : l'attaquant tient `capturePercent` % de la route côté ville prise.
          const permille = FRONTS.capturePercent * 10;
          position = c.city1 === capture.city ? permille : ROUTE - permille;
        } else position = MIDDLE;
      }
      return { city1: c.city1, city2: c.city2, position } satisfies FrontConnection;
    });
    const before = matched.get(b.id);
    const sides: [FrontSide, FrontSide] = [
      { frontAttack: before?.sides[0].frontAttack ?? false, lastLoss: before?.sides[0].lastLoss ?? 0 },
      { frontAttack: before?.sides[1].frontAttack ?? false, lastLoss: before?.sides[1].lastLoss ?? 0 },
    ];
    return { id: b.id, players: [b.p1, b.p2], groups: [b.g1, b.g2], connections, sides };
  });
  next.sort((x, y) => x.id - y.id);
  const byId = new Set<number>(next.map((f) => f.id));

  // 5. Divisions : chaque ancien front donne ses divisions (sur place et en route vers lui) aux nouveaux
  // fronts qui contiennent ses connexions gardées, au prorata de leur nombre (05-Fronts §2.5).
  const target = new Map<number, { ids: number[]; weights: number[] }>();
  for (const o of old) {
    const weights = new Map<number, number>();
    for (const c of o.connections) {
      const t = fresh.find((b) => b.p1 === o.players[0] && b.p2 === o.players[1] && b.conns.some((x) => x.city1 === c.city1 && x.city2 === c.city2));
      if (t === undefined || !byId.has(t.id)) continue;
      weights.set(t.id, (weights.get(t.id) ?? 0) + 1);
    }
    const ids = [...weights.keys()].sort((x, y) => x - y);
    if (ids.length === 0) {
      // Aucune connexion gardée (ville prise, fusion avec un autre front) : le successeur est le front des mêmes joueurs le plus
      // proche, à zéro ou une route d'une ville de l'ancien ; à égalité de distance le plus petit identifiant (05-Fronts §2.5).
      const cities = new Set<number>();
      for (const c of o.connections) {
        cities.add(c.city1);
        cities.add(c.city2);
      }
      const hop = (city: number): number => {
        if (cities.has(city)) return 0;
        for (const [a, b] of state.roads) if ((a === city && cities.has(b)) || (b === city && cities.has(a))) return 1;
        return 2;
      };
      let best = 0;
      let bestDist = 2;
      for (const b of fresh) {
        if (b.p1 !== o.players[0] || b.p2 !== o.players[1]) continue;
        let dist = 2;
        for (const c of b.conns) dist = Math.min(dist, hop(c.city1), hop(c.city2));
        if (dist < bestDist || (dist === bestDist && best !== 0 && b.id < best)) {
          best = b.id;
          bestDist = dist;
        }
      }
      if (best !== 0) {
        target.set(o.id, { ids: [best], weights: [1] });
        continue;
      }
    }
    target.set(o.id, { ids, weights: ids.map((id) => weights.get(id)!) });
  }
  const groups = new Map<string, Division[]>();
  for (const d of state.divisions) {
    if (d.front === 0) continue;
    const k = `${d.front}:${d.owner}`;
    let g = groups.get(k);
    if (g === undefined) groups.set(k, (g = []));
    g.push(d);
  }
  for (const o of old) {
    const t = target.get(o.id)!;
    for (const player of o.players) {
      const divs = groups.get(`${o.id}:${player}`);
      if (divs === undefined) continue;
      if (t.ids.length === 0) {
        // Front disparu sans successeur (05-Fronts §2.5) : retour à la réserve, sans délai.
        for (const d of divs) {
          d.front = 0;
          d.line = LINE_SECOND;
          d.box = 0;
          d.engaged = 0;
          d.arrivalTick = 0;
        }
        continue;
      }
      // Divisions par identifiant croissant, données aux morceaux par identifiant croissant (sans délai).
      const parts = splitProportional(divs.length, t.weights);
      let k = 0;
      t.ids.forEach((id, j) => {
        for (let n = 0; n < parts[j]!; n++) divs[k++]!.front = id;
      });
    }
  }
  state.fronts = next;
  afterFrontsChanged(state);
}

// ---- guerre et paix (05-Fronts §2.3) ----

/** Déclaration de guerre : chaque connexion de chaque front entre les deux joueurs reçoit la position 500. */
export function startWar(state: GameState, a: number, b: number): void {
  for (const f of state.fronts) {
    if (!isPair(f, a, b)) continue;
    for (const c of f.connections) c.position = MIDDLE;
  }
}

/** Paix : positions, attaques et percées supprimées ; les divisions restent. */
export function endWar(state: GameState, a: number, b: number): void {
  endBreakthroughsBetween(state, a, b);
  for (const f of state.fronts) {
    if (!isPair(f, a, b)) continue;
    for (const c of f.connections) c.position = 0;
    for (const s of f.sides) s.frontAttack = false;
  }
}

const isPair = (f: Front, a: number, b: number): boolean =>
  (f.players[0] === a && f.players[1] === b) || (f.players[0] === b && f.players[1] === a);

/** Les fronts de chaque joueur, `result[id - 1]`, dans l'ordre des identifiants de front (un seul parcours pour tous les joueurs). */
export function frontsByPlayer(state: GameState): Front[][] {
  const out: Front[][] = state.players.map(() => []);
  for (const f of state.fronts) {
    out[f.players[0] - 1]!.push(f);
    out[f.players[1] - 1]!.push(f);
  }
  return out;
}
