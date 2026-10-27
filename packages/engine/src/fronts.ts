// Fronts terrestres (Docs/Design/05-Fronts.md) : état, détection à partir des
// routes, guerre et paix, ordres de réglage. Les troupes sont dans troops.ts, le
// combat dans combat.ts, la prise d'une ville dans conquest.ts.
//
// Un front est l'ensemble des connexions (routes entre deux villes de joueurs
// différents) entre un groupe d'un joueur et un groupe d'un autre joueur. Il est
// symétrique : les deux joueurs voient le même front. Les deux camps sont rangés
// dans l'ordre des joueurs du front, `players[0] < players[1]`.

import { FRONTS, ARMAMENT } from "./config.ts";
import { STATUS_WAR, statusOf } from "./diplomacy.ts";
import type { GameState } from "./state.ts";
import {
  LINE_BALANCED,
  LINE_FIRST,
  LINE_SECOND,
  UNIT_COUNT,
  UNIT_DATA,
  isUnitId,
  roundDiv,
  unitIndex,
  zeros,
} from "./units.ts";
import { currentTurn, trimSide } from "./troops.ts";

/** Une route dont les deux villes sont à deux joueurs différents. */
export interface FrontConnection {
  /** Ville de `players[0]`. */
  readonly city1: number;
  /** Ville de `players[1]`. */
  readonly city2: number;
  /** Position du front, en millièmes de la route depuis `city1`, 0 à 1 000. Fronts actifs seulement ; 0 en paix. */
  position: number;
}

/** Un mouvement d'unités entre la réserve du pays et un front (05-Fronts §4.5). */
export interface Transfer {
  /** Indice du type d'unité (ordre des clés de `UNITS`). */
  readonly unit: number;
  count: number;
  /** Vrai : de la réserve vers le front ; faux : du front vers la réserve. */
  readonly toFront: boolean;
  /** Ligne visée : 0 première, 1 seconde (sans objet vers la réserve). */
  readonly line: number;
  /** Numéro du tour où il est appliqué. */
  readonly arrival: number;
}

/** Une percée en cours (05-Fronts §7.2). Elle appartient à la `FrontSide` de l'attaquant. */
export interface Breakthrough {
  readonly id: number;
  /** Axe : la connexion sur laquelle on perce. */
  readonly city1: number;
  readonly city2: number;
  /** Numéro du tour de l'ordre. La percée commence `breakthroughDelayTurns` tours plus tard. */
  readonly startTick: number;
  /** 0 attente, 1 contre la première ligne, 2 contre la seconde ligne. */
  phase: number;
  /** Unités de l'attaquant engagées (sous-ensemble de sa seconde ligne), par type. */
  attackers: number[];
  /** Tranche engagée de la première ligne du défenseur (sous-ensemble de sa première ligne), par type. */
  defenders1: number[];
  /** Force de contre-attaque du défenseur (sous-ensemble de sa seconde ligne), par type ; recalculée à chaque round. */
  defenders2: number[];
  /** PV (infanterie et blindés) des unités engagées par l'attaquant au début de la percée. */
  startHp: number;
}

/** Un camp d'un front. */
export interface FrontSide {
  /** Unités en première ligne, par type. */
  firstLine: number[];
  secondLine: number[];
  /** Mouvements en cours, dans l'ordre de leur création. */
  transfers: Transfer[];
  /** Indice dans `FRONTS.priorityPercent`. */
  priorityIndex: number;
  /** « Autoriser la réassignation à d'autres fronts ». */
  reassign: boolean;
  /** Interrupteur à trois positions de chaque type (`LINE_FIRST`, `LINE_BALANCED`, `LINE_SECOND`). */
  lineMode: number[];
  /** Case à cocher de chaque type : le type est-il autorisé sur ce front ? Un type refusé n'y reçoit rien et en repart. */
  allowed: boolean[];
  /** Interrupteur « Motorisé seulement » des percées. */
  motorizedOnly: boolean;
  /** Attaque sur tout le front en cours. */
  frontAttack: boolean;
  /** Unités perdues par type au dernier round de combat de ce front, par ligne (affichage ; 0 hors combat). */
  lostFirst: number[];
  lostSecond: number[];
  /** Percées lancées par ce camp, par identifiant. */
  breakthroughs: Breakthrough[];
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

export function newSide(): FrontSide {
  return {
    firstLine: zeros(),
    secondLine: zeros(),
    transfers: [],
    priorityIndex: 0,
    reassign: false,
    lineMode: new Array<number>(UNIT_COUNT).fill(LINE_FIRST),
    allowed: new Array<boolean>(UNIT_COUNT).fill(true),
    motorizedOnly: true,
    frontAttack: false,
    lostFirst: zeros(),
    lostSecond: zeros(),
    breakthroughs: [],
  };
}

/** Largeur du front en mètres : connexions × `metersPerConnection`. Jamais stockée. */
export const frontWidth = (front: Front): number => front.connections.length * FRONTS.metersPerConnection;

/** Largeur de la seconde ligne, en mètres de percée : `FRONTS.maxSecondLineOvercrowding` fois la largeur du front (05-Fronts §4.2). */
export const secondLineWidth = (front: Front): number => frontWidth(front) * FRONTS.maxSecondLineOvercrowding;

/** Les deux joueurs du front sont-ils en guerre ? (front actif) */
export const isActive = (state: GameState, front: Front): boolean => statusOf(state, front.players[0], front.players[1]) === STATUS_WAR;

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

/** Pourcentage de la priorité d'un camp. */
export const priorityPercent = (side: FrontSide): number => FRONTS.priorityPercent[side.priorityIndex]!;

/** Joueur du camp `i` de `front`. */
export const playerOf = (front: Front, i: number): number => front.players[i]!;

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
 * gardées ; les identifiants et les réglages suivent la règle de §2.5 ; les troupes
 * des anciens fronts sont réparties entre les nouveaux au prorata des connexions
 * gardées (fusion : mises ensemble ; coupure : partagées).
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

  // 3. Identifiants et réglages (05-Fronts §2.5) : l'ancien front qui partage le plus de connexions
  // avec le nouveau, à égalité le plus petit identifiant ; un ancien identifiant n'est repris qu'une fois.
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

  // 4. Nouveaux fronts : connexions avec leur position, réglages de l'ancien front repris.
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
    const sides: [FrontSide, FrontSide] = [newSide(), newSide()];
    if (before !== undefined) {
      for (let i = 0; i < 2; i++) {
        const o = before.sides[i]!;
        const s = sides[i]!;
        s.priorityIndex = o.priorityIndex;
        s.reassign = o.reassign;
        s.lineMode = o.lineMode.slice();
        s.allowed = o.allowed.slice();
        s.motorizedOnly = o.motorizedOnly;
        s.frontAttack = o.frontAttack;
        s.lostFirst = o.lostFirst.slice();
        s.lostSecond = o.lostSecond.slice();
      }
    }
    return { id: b.id, players: [b.p1, b.p2], groups: [b.g1, b.g2], connections, sides };
  });
  next.sort((x, y) => x.id - y.id);
  const byId = new Map<number, Front>(next.map((f) => [f.id, f]));
  const sameConnections = (f: Front, g: Front): boolean =>
    f.connections.length === g.connections.length && f.connections.every((c, i) => c.city1 === g.connections[i]!.city1 && c.city2 === g.connections[i]!.city2);

  // 5. Troupes : chaque ancien front distribue ses unités, ses mouvements et ses percées aux nouveaux
  // fronts qui contiennent ses connexions gardées, au prorata de leur nombre (05-Fronts §2.5).
  const changed = new Set<number>();
  for (const f of next) if (!matched.has(f.id) || !sameConnections(matched.get(f.id)!, f)) changed.add(f.id);
  const incoming = new Map<number, number>();
  for (const o of old) {
    const weights = new Map<number, number>();
    let kept = 0;
    for (const c of o.connections) {
      const target = fresh.find((b) => b.p1 === o.players[0] && b.p2 === o.players[1] && b.conns.some((x) => x.city1 === c.city1 && x.city2 === c.city2));
      if (target === undefined || !byId.has(target.id)) continue;
      weights.set(target.id, (weights.get(target.id) ?? 0) + 1);
      kept++;
    }
    if (kept === 0) {
      dissolveFront(state, o);
      continue;
    }
    const ids = [...weights.keys()].sort((x, y) => x - y);
    for (const id of ids) incoming.set(id, (incoming.get(id) ?? 0) + 1);
    for (let i = 0; i < 2; i++) distributeSide(o.sides[i]!, ids, weights, kept, byId, i);
    // Les percées suivent leur axe, si la connexion existe encore dans un nouveau front.
    for (let i = 0; i < 2; i++) {
      for (const bt of o.sides[i]!.breakthroughs) {
        const dest = next.find((f) => f.players[0] === o.players[0] && f.players[1] === o.players[1] && f.connections.some((c) => c.city1 === bt.city1 && c.city2 === bt.city2));
        if (dest !== undefined) dest.sides[i]!.breakthroughs.push(bt);
      }
    }
  }
  for (const [id, n] of incoming) if (n > 1) changed.add(id);
  for (const f of next) {
    for (const s of f.sides) s.breakthroughs.sort((x, y) => x.id - y.id);
    clipBreakthroughs(f);
  }
  state.fronts = next;
  // « Ensuite, dans tous les cas le front se recale sur son besoin » (05-Fronts §2.5) : seulement
  // si sa taille ou sa composition a changé.
  for (const f of next) {
    if (!changed.has(f.id)) continue;
    for (let i = 0; i < 2; i++) trimSide(state, f, i);
  }
}

/** Les unités engagées d'une percée ne dépassent pas les lignes dont elles font partie. */
export function clipBreakthroughs(front: Front): void {
  for (let i = 0; i < 2; i++) {
    const mine = front.sides[i]!;
    const other = front.sides[1 - i]!;
    for (const bt of mine.breakthroughs) {
      for (let t = 0; t < UNIT_COUNT; t++) {
        bt.attackers[t] = Math.min(bt.attackers[t]!, mine.secondLine[t]!);
        bt.defenders1[t] = Math.min(bt.defenders1[t]!, other.firstLine[t]!);
        bt.defenders2[t] = Math.min(bt.defenders2[t]!, other.secondLine[t]!);
      }
    }
  }
}

/**
 * Répartit les unités d'un ancien camp entre les nouveaux fronts `ids` au prorata de
 * leurs poids (05-Fronts §2.5, coupure) : arrondi au plus proche, le reste au front de
 * plus petit identifiant.
 */
function distributeSide(
  o: FrontSide,
  ids: readonly number[],
  weights: ReadonlyMap<number, number>,
  total: number,
  dest: ReadonlyMap<number, Front>,
  sideI: number,
): void {
  const give = (count: number): number[] => {
    const parts = ids.map((id, j) => (j === 0 ? 0 : roundDiv(count * weights.get(id)!, total)));
    let rest = count;
    for (let j = 1; j < parts.length; j++) {
      parts[j] = Math.min(parts[j]!, rest);
      rest -= parts[j]!;
    }
    parts[0] = rest;
    return parts;
  };
  for (let t = 0; t < UNIT_COUNT; t++) {
    const f = give(o.firstLine[t]!);
    const s = give(o.secondLine[t]!);
    ids.forEach((id, j) => {
      const side = dest.get(id)!.sides[sideI]!;
      side.firstLine[t] = side.firstLine[t]! + f[j]!;
      side.secondLine[t] = side.secondLine[t]! + s[j]!;
    });
  }
  for (const tr of o.transfers) {
    const parts = give(tr.count);
    ids.forEach((id, j) => {
      if (parts[j]! > 0) dest.get(id)!.sides[sideI]!.transfers.push({ ...tr, count: parts[j]! });
    });
  }
}

/**
 * Un ancien front sans aucune connexion gardée : ses unités et celles en route
 * reviennent à la réserve du pays sans délai (choix provisoire, 05-Fronts §15).
 */
function dissolveFront(state: GameState, front: Front): void {
  for (let i = 0; i < 2; i++) {
    const side = front.sides[i]!;
    const player = state.players[front.players[i]! - 1]!;
    for (let t = 0; t < UNIT_COUNT; t++) giveBack(player, t, side.firstLine[t]! + side.secondLine[t]!);
    for (const tr of side.transfers) giveBack(player, tr.unit, tr.count);
  }
}

/** Dissout `count` unités de type `t` : équipement à la réserve, population rendue au pays. */
export function giveBack(player: { armamentReserve: number[]; soldiers: number }, t: number, count: number): void {
  if (count <= 0) return;
  const u = UNIT_DATA[t]!;
  player.armamentReserve[u.equipment] = player.armamentReserve[u.equipment]! + count * u.equipmentCount;
  player.soldiers -= count * u.population;
}

// ---- guerre et paix (05-Fronts §2.3) ----

/** Déclaration de guerre : chaque connexion de chaque front entre les deux joueurs reçoit la position 500. */
export function startWar(state: GameState, a: number, b: number): void {
  for (const f of state.fronts) {
    if (!isPair(f, a, b)) continue;
    for (const c of f.connections) c.position = MIDDLE;
  }
}

/** Paix : positions, attaques et percées supprimées ; les troupes restent. */
export function endWar(state: GameState, a: number, b: number): void {
  for (const f of state.fronts) {
    if (!isPair(f, a, b)) continue;
    for (const c of f.connections) c.position = 0;
    for (const s of f.sides) {
      s.frontAttack = false;
      s.breakthroughs = [];
    }
  }
}

const isPair = (f: Front, a: number, b: number): boolean =>
  (f.players[0] === a && f.players[1] === b) || (f.players[0] === b && f.players[1] === a);

// ---- ordres de réglage (05-Fronts §5) ----

/** Le front et le camp de `player`, ou undefined si l'ordre est invalide (front inconnu, joueur étranger au front). */
function mySide(state: GameState, player: number, frontId: unknown): { front: Front; i: number; side: FrontSide } | undefined {
  if (!Number.isInteger(frontId)) return undefined;
  const front = frontById(state, frontId as number);
  if (front === undefined) return undefined;
  const i = sideIndex(front, player);
  return i < 0 ? undefined : { front, i, side: front.sides[i]! };
}

export function setFrontPriority(state: GameState, player: number, frontId: unknown, index: unknown): boolean {
  const m = mySide(state, player, frontId);
  if (m === undefined || !Number.isInteger(index)) return false;
  const level = index as number;
  if (level < 0 || level >= FRONTS.priorityPercent.length) return false;
  m.side.priorityIndex = level;
  return true;
}

export function setFrontReassign(state: GameState, player: number, frontId: unknown, enabled: unknown): boolean {
  const m = mySide(state, player, frontId);
  if (m === undefined || typeof enabled !== "boolean") return false;
  m.side.reassign = enabled;
  return true;
}

export const LINE_MODE_NAMES = ["first", "balanced", "second"] as const;

/** Change l'interrupteur d'un type d'unité. Les unités du type sur ce front changent de ligne sans délai (choix provisoire, 05-Fronts §4.5). */
export function setUnitLineMode(state: GameState, player: number, frontId: unknown, unit: unknown, mode: unknown): boolean {
  const m = mySide(state, player, frontId);
  if (m === undefined || !isUnitId(unit)) return false;
  const k = (LINE_MODE_NAMES as readonly unknown[]).indexOf(mode);
  if (k < 0) return false;
  m.side.lineMode[unitIndex(unit)] = k === 0 ? LINE_FIRST : k === 1 ? LINE_BALANCED : LINE_SECOND;
  trimSide(state, m.front, m.i);
  return true;
}

/**
 * Case « autorisé » d'un type sur un front (05-Fronts §4.2). Refusé : les unités du type quittent le front, première et
 * seconde ligne, vers la réserve avec le délai de transfert ; celles qui y étaient en route font demi-tour (même délai).
 */
export function setUnitAllowed(state: GameState, player: number, frontId: unknown, unit: unknown, enabled: unknown): boolean {
  const m = mySide(state, player, frontId);
  if (m === undefined || !isUnitId(unit) || typeof enabled !== "boolean") return false;
  const t = unitIndex(unit);
  m.side.allowed[t] = enabled;
  if (!enabled) {
    m.side.transfers = m.side.transfers.map((tr) =>
      tr.unit === t && tr.toFront ? { ...tr, toFront: false, arrival: currentTurn(state) + FRONTS.transferTurns } : tr,
    );
    trimSide(state, m.front, m.i);
  }
  return true;
}

export function setBreakthroughMotorizedOnly(state: GameState, player: number, frontId: unknown, enabled: unknown): boolean {
  const m = mySide(state, player, frontId);
  if (m === undefined || typeof enabled !== "boolean") return false;
  m.side.motorizedOnly = enabled;
  return true;
}

export function setForcedMobilization(state: GameState, player: number, enabled: unknown): boolean {
  if (typeof enabled !== "boolean") return false;
  state.players[player - 1]!.forcedMobilization = enabled;
  return true;
}

/** Les fronts de chaque joueur, `result[id - 1]`, dans l'ordre des identifiants de front (un seul parcours pour tous les joueurs). */
export function frontsByPlayer(state: GameState): Front[][] {
  const out: Front[][] = state.players.map(() => []);
  for (const f of state.fronts) {
    out[f.players[0] - 1]!.push(f);
    out[f.players[1] - 1]!.push(f);
  }
  return out;
}

/** Équipement de chaque type d'armement qui est dans des unités des fronts du joueur (déployé et en route), dans l'ordre des clés de `ARMAMENT.types`. */
export function deployedEquipment(state: GameState, playerId: number, fronts: readonly Front[] = state.fronts): number[] {
  const out = new Array<number>(Object.keys(ARMAMENT.types).length).fill(0);
  for (const f of fronts) {
    const i = sideIndex(f, playerId);
    if (i < 0) continue;
    const s = f.sides[i]!;
    for (let t = 0; t < UNIT_COUNT; t++) {
      const u = UNIT_DATA[t]!;
      let n = s.firstLine[t]! + s.secondLine[t]!;
      for (const tr of s.transfers) if (tr.unit === t) n += tr.count;
      out[u.equipment] = out[u.equipment]! + n * u.equipmentCount;
    }
  }
  return out;
}

/** Unités du joueur sur ses fronts ou en route, par type. */
export function deployedUnits(state: GameState, playerId: number): number[] {
  const out = zeros();
  for (const f of state.fronts) {
    const i = sideIndex(f, playerId);
    if (i < 0) continue;
    const s = f.sides[i]!;
    for (let t = 0; t < UNIT_COUNT; t++) out[t] = out[t]! + s.firstLine[t]! + s.secondLine[t]!;
    for (const tr of s.transfers) out[tr.unit] = out[tr.unit]! + tr.count;
  }
  return out;
}

/** Population des soldats du joueur par ses fronts : somme des unités × population (pour vérifier `Player.soldiers`). */
export function countSoldiers(state: GameState, playerId: number): number {
  let n = 0;
  const units = deployedUnits(state, playerId);
  for (let t = 0; t < UNIT_COUNT; t++) n += units[t]! * UNIT_DATA[t]!.population;
  return n;
}

export { LINE_BALANCED, LINE_FIRST, LINE_SECOND };
