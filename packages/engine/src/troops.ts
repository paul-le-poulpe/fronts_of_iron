// Affectation des troupes aux fronts (Docs/Design/05-Fronts.md §4) : recrutement
// avec la population et l'armement, remplissage des deux lignes, priorités,
// réassignation, délai de transfert, retour à la réserve.
//
// Une unité est un paquet (config/units.ts). Pour la former, le pays prend
// `equipmentCount` équipements dans sa réserve d'armement et `population`
// personnes parmi ses inactifs (ou avant les lignes de production, en
// mobilisation forcée). L'unité part vers un front et y arrive `transferTurns`
// tours plus tard ; en route, elle compte déjà pour la répartition.
//
// Tout est en entiers (règle 2 du CLAUDE.md). Les parcours se font dans l'ordre
// des fronts, des camps et des types (`FILL_ORDER`).

import { FRONTS } from "./config.ts";
import { clipBreakthroughs, frontWidth, frontsByPlayer, secondLineWidth, giveBack, priorityPercent, sideIndex, type Front, type FrontSide, type Transfer } from "./fronts.ts";
import type { GameState, Player } from "./state.ts";
import {
  FILL_ORDER,
  LINE_BALANCED,
  LINE_SECOND,
  NO_LIMIT,
  UNIT_COUNT,
  UNIT_DATA,
  lineRoom,
  splitLines,
  zeros,
} from "./units.ts";

/** Numéro du tour en cours de calcul (`state.tick` n'avance qu'à la fin d'`applyTurn`). */
export const currentTurn = (state: GameState): number => state.tick + 1;

/**
 * Parts entières de `amount` proportionnelles à `weights` (05-Fronts §4.3, arrondi
 * des parts) : partie entière, puis une unité de plus aux plus grands restes, à
 * égalité au plus petit indice (les fronts sont rangés par identifiant). Aucune
 * part n'est donnée à un poids nul.
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
    remainder[i] = part - out[i]! * total;
    given += out[i]!;
  });
  const order = weights.map((_, i) => i).filter((i) => weights[i]! > 0);
  order.sort((a, b) => remainder[b]! - remainder[a]! || a - b);
  for (let k = 0; given < amount && k < order.length; k++, given++) out[order[k]!] = out[order[k]!]! + 1;
  return out;
}

/** Unités perdues en entier : leur population disparaît du pays et des soldats, leur équipement avec elles (05-Fronts §3). */
export function loseUnits(state: GameState, playerId: number, lost: readonly number[]): void {
  const p = state.players[playerId - 1]!;
  let people = 0;
  for (let t = 0; t < UNIT_COUNT; t++) people += lost[t]! * UNIT_DATA[t]!.population;
  p.population = Math.max(0, p.population - people);
  p.soldiers -= people;
}

// ---- retour à la réserve et recalage ----

/** Envoie `count` unités vers la réserve : elles y arrivent `transferTurns` tours plus tard (le front les a déjà perdues). */
function sendOut(state: GameState, side: FrontSide, unit: number, count: number): void {
  if (count <= 0) return;
  side.transfers.push({ unit, count, toFront: false, line: 0, arrival: currentTurn(state) + FRONTS.transferTurns });
}

/**
 * Recale un camp sur ses réglages (05-Fronts §2.5, §4.2) : les unités de chaque type
 * sont rangées entre les deux lignes par l'interrupteur du type et le plafond de
 * l'infanterie, sans délai ; l'équipement qui ne trouve pas de place même en
 * seconde ligne repart vers la réserve avec le délai de transfert.
 */
export function trimSide(state: GameState, front: Front, i: number): void {
  const side = front.sides[i]!;
  const first = zeros();
  const second = zeros();
  const width = frontWidth(front);
  const secondWidth = secondLineWidth(front);
  for (const t of FILL_ORDER) {
    const u = UNIT_DATA[t]!;
    const total = side.firstLine[t]! + side.secondLine[t]!;
    if (!side.allowed[t]) {
      // Type refusé sur ce front : tout repart vers la réserve.
      sendOut(state, side, t, total);
      continue;
    }
    const [a, b] = splitLines(side.lineMode[t]!, total, lineRoom(t, first, false, width), u.frontWidth, u.breakthroughWidth);
    const keep = Math.min(b, lineRoom(t, second, true, secondWidth));
    sendOut(state, side, t, b - keep);
    first[t] = a;
    second[t] = keep;
  }
  side.firstLine = first;
  side.secondLine = second;
  clipBreakthroughs(front);
}

/**
 * Renfort de la première ligne par la seconde, sans délai (05-Fronts §4.2) : pour chaque type dont l'interrupteur est sur
 * « priorité première ligne » ou « équilibré », des unités de la seconde ligne passent en première ligne pour combler les
 * pertes du round, avant que l'affectation (§4.3) demande du matériel à la réserve. Priorité première ligne : jusqu'à la place
 * libre ; équilibré : jusqu'à la part de la première ligne que donne `splitLines` sur le total du type (même pourcentage du
 * front dans les deux lignes). Les unités qu'une percée engage restent en seconde ligne. L'équipement de la seconde ligne que l'infanterie restante ne couvre plus repart vers la réserve.
 */
export function reinforceFirstLine(state: GameState, front: Front, i: number): void {
  const side = front.sides[i]!;
  const lock = locked(front, i);
  const width = frontWidth(front);
  const secondWidth = secondLineWidth(front);
  let moved = false;
  for (const t of FILL_ORDER) {
    const mode = side.lineMode[t]!;
    if (mode === LINE_SECOND) continue;
    const u = UNIT_DATA[t]!;
    const total = side.firstLine[t]! + side.secondLine[t]!;
    const [target] = splitLines(mode, total, lineRoom(t, side.firstLine, false, width), u.frontWidth, u.breakthroughWidth);
    const move = Math.min(target - side.firstLine[t]!, side.secondLine[t]! - lock.second[t]!);
    if (move <= 0) continue;
    side.firstLine[t] = side.firstLine[t]! + move;
    side.secondLine[t] = side.secondLine[t]! - move;
    moved = true;
  }
  if (!moved) return;
  for (const t of FILL_ORDER) {
    const keep = Math.max(lock.second[t]!, Math.min(side.secondLine[t]!, lineRoom(t, side.secondLine, true, secondWidth)));
    sendOut(state, side, t, side.secondLine[t]! - keep);
    side.secondLine[t] = keep;
  }
  clipBreakthroughs(front);
}

// ---- affectation ----

/** Un camp d'un front du joueur, avec les effectifs projetés : lignes, unités en route, unités attribuées ce tour. */
interface Slot {
  readonly front: Front;
  readonly i: number;
  readonly side: FrontSide;
  readonly id: number;
  readonly width: number;
  /** Largeur de la seconde ligne, en mètres de percée. */
  readonly secondWidth: number;
  readonly percent: number;
  first: number[];
  second: number[];
}

interface Grant {
  readonly slot: Slot;
  readonly unit: number;
  readonly line: number;
  readonly count: number;
}

/** D'où viennent les unités à répartir : la réserve d'armement et la population (réel), ou en plus des unités libérées (simulation). */
interface Pool {
  available(t: number): number;
  take(t: number, n: number): void;
}

/** Unités formables avec `reserve` (équipements) et `people` personnes. */
function formable(reserve: readonly number[], people: number, t: number): number {
  const u = UNIT_DATA[t]!;
  return Math.min(Math.floor(reserve[u.equipment]! / u.equipmentCount), Math.floor(people / u.population));
}

function buildSlots(fronts: readonly Front[], playerId: number): Slot[] {
  const slots: Slot[] = [];
  for (const front of fronts) {
    const i = sideIndex(front, playerId);
    if (i < 0) continue;
    const side = front.sides[i]!;
    const first = side.firstLine.slice();
    const second = side.secondLine.slice();
    for (const tr of side.transfers) if (tr.toFront) (tr.line === 0 ? first : second)[tr.unit] += tr.count;
    slots.push({ front, i, side, id: front.id, width: frontWidth(front), secondWidth: secondLineWidth(front), percent: priorityPercent(side), first, second });
  }
  return slots;
}

/**
 * Répartit les unités du `pool` entre les camps `slots` (05-Fronts §4.3), type par
 * type, niche par niche, du meilleur type au moins bon. D'abord les premières
 * lignes, tous types, par paliers (chaque front jusqu'à son pourcentage de
 * priorité de son besoin, puis jusqu'à 100 % par pourcentage décroissant, au
 * prorata du manque dans un palier) ; puis les secondes lignes (cible = total ×
 * pourcentage × largeur / somme). `tier1Only` : seulement le premier palier de
 * la première ligne (mobilisation forcée). Les effectifs projetés des `slots` sont
 * mis à jour au fur et à mesure.
 */
function distribute(slots: Slot[], pool: Pool, tier1Only: boolean): Grant[] {
  const grants: Grant[] = [];
  const give = (slot: Slot, t: number, line: number, count: number): void => {
    if (count <= 0) return;
    pool.take(t, count);
    (line === 0 ? slot.first : slot.second)[t] += count;
    grants.push({ slot, unit: t, line, count });
  };

  // Première ligne.
  const percents = [...new Set(slots.map((s) => s.percent))].sort((a, b) => b - a);
  for (const t of FILL_ORDER) {
    const u = UNIT_DATA[t]!;
    const tiers: (number | null)[] = tier1Only ? [null] : [null, ...percents];
    for (const tier of tiers) {
      const available = pool.available(t);
      if (available <= 0) break;
      // Pour chaque camp : ce qu'il a et ce qu'il vise pour ce type.
      const gaps = slots.map((s) => {
        const mode = s.side.lineMode[t]!;
        if (mode === LINE_SECOND || !s.side.allowed[t]) return 0;
        const space = lineRoom(t, s.first, false, s.width);
        const balanced = mode === LINE_BALANCED;
        const have = balanced ? s.first[t]! + s.second[t]! : s.first[t]!;
        const wanted = balanced && space > 0 ? Math.ceil((space * (u.frontWidth + u.breakthroughWidth)) / u.breakthroughWidth) : space;
        const target = Math.max(have, wanted);
        if (tier === null) return Math.max(0, Math.floor((s.percent * target) / 100) - have);
        return s.percent === tier ? Math.max(0, target - have) : 0;
      });
      const amount = Math.min(available, gaps.reduce((a, b) => a + b, 0));
      const shares = splitProportional(amount, gaps);
      slots.forEach((s, k) => {
        if (shares[k]! === 0) return;
        const space = lineRoom(t, s.first, false, s.width);
        const mode = s.side.lineMode[t]!;
        const g = shares[k]!;
        let firstPart: number;
        if (mode === LINE_BALANCED) {
          const total = s.first[t]! + s.second[t]! + g;
          const a = Math.min(Math.floor((total * u.breakthroughWidth) / (u.frontWidth + u.breakthroughWidth)), space);
          firstPart = Math.min(g, Math.max(0, a - s.first[t]!));
        } else firstPart = Math.min(g, Math.max(0, space - s.first[t]!));
        const secondPart = Math.min(g - firstPart, Math.max(0, lineRoom(t, s.second, true, s.secondWidth) - s.second[t]!));
        give(s, t, 0, firstPart);
        give(s, t, 1, secondPart);
      });
    }
  }
  if (tier1Only) return grants;

  // Seconde ligne : plafonnée à `maxSecondLineOvercrowding` fois la largeur du front, et par l'infanterie pour l'équipement.
  for (const t of FILL_ORDER) {
    const available = pool.available(t);
    if (available <= 0) continue;
    // Poids : pourcentage × largeur ; tous les fronts à 0 % : partage égal. Un front qui refuse le type n'en reçoit pas.
    let weights = slots.map((s) => (s.side.allowed[t] ? s.percent * s.width : 0));
    if (weights.every((w) => w === 0)) weights = slots.map((s) => (s.side.allowed[t] ? 1 : 0));
    const total = slots.reduce((sum, s) => sum + s.second[t]!, 0) + available;
    const targets = splitProportional(total, weights);
    const gaps = slots.map((s, k) => Math.max(0, Math.min(targets[k]! - s.second[t]!, lineRoom(t, s.second, true, s.secondWidth) - s.second[t]!)));
    const shares = splitProportional(Math.min(available, gaps.reduce((a, b) => a + b, 0)), gaps);
    slots.forEach((s, k) => give(s, t, 1, shares[k]!));
  }
  return grants;
}

/** Unités d'un camp que des percées retiennent : elles ne peuvent pas quitter le front. */
function locked(front: Front, i: number): { first: number[]; second: number[] } {
  const first = zeros();
  const second = zeros();
  const mine = front.sides[i]!;
  const other = front.sides[1 - i]!;
  for (const bt of mine.breakthroughs) for (let t = 0; t < UNIT_COUNT; t++) second[t] = second[t]! + bt.attackers[t]!;
  for (const bt of other.breakthroughs) {
    for (let t = 0; t < UNIT_COUNT; t++) {
      first[t] = first[t]! + bt.defenders1[t]!;
      if (bt.phase === 2) second[t] = second[t]! + bt.defenders2[t]!;
    }
  }
  return { first, second };
}

/**
 * Réassignation (05-Fronts §4.4, provisoire) : les unités des fronts qui l'autorisent
 * entrent dans la quantité à répartir, comme la réserve. On simule la répartition
 * avec ces unités en plus ; ce qu'un front de ce type garde en trop par rapport au
 * résultat repart vers la réserve du pays (délai de transfert), où la répartition
 * normale le reprendra pour un front qui en a besoin.
 */
function releaseSurplus(state: GameState, player: Player, slots: Slot[]): void {
  const movers = slots.filter((s) => s.side.reassign);
  if (movers.length === 0) return;
  const pooled = zeros();
  const virtual: Slot[] = slots.map((s) => {
    if (!s.side.reassign) return { ...s, first: s.first.slice(), second: s.second.slice() };
    const lock = locked(s.front, s.i);
    const first = s.first.slice();
    const second = s.second.slice();
    for (let t = 0; t < UNIT_COUNT; t++) {
      const freeFirst = s.side.firstLine[t]! - lock.first[t]!;
      const freeSecond = s.side.secondLine[t]! - lock.second[t]!;
      first[t] = first[t]! - freeFirst;
      second[t] = second[t]! - freeSecond;
      pooled[t] = pooled[t]! + freeFirst + freeSecond;
    }
    return { ...s, first, second };
  });
  const reserve = player.armamentReserve.slice();
  let people = Math.max(0, player.population - player.soldiers);
  const pool: Pool = {
    available: (t) => pooled[t]! + formable(reserve, people, t),
    take: (t, n) => {
      const fromPool = Math.min(pooled[t]!, n);
      pooled[t] = pooled[t]! - fromPool;
      const made = n - fromPool;
      if (made > 0) {
        const u = UNIT_DATA[t]!;
        reserve[u.equipment] = reserve[u.equipment]! - made * u.equipmentCount;
        people -= made * u.population;
      }
    },
  };
  distribute(virtual, pool, false);
  slots.forEach((s, k) => {
    if (!s.side.reassign) return;
    const v = virtual[k]!;
    const lock = locked(s.front, s.i);
    for (let t = 0; t < UNIT_COUNT; t++) {
      // Place du camp, dans la simulation : ce que la répartition lui a donné, plus ce qui est en route et retenu.
      const wantFirst = v.first[t]! - (s.first[t]! - s.side.firstLine[t]!);
      const wantSecond = v.second[t]! - (s.second[t]! - s.side.secondLine[t]!);
      const outFirst = Math.max(0, s.side.firstLine[t]! - Math.max(lock.first[t]!, wantFirst));
      const outSecond = Math.max(0, s.side.secondLine[t]! - Math.max(lock.second[t]!, wantSecond));
      if (outFirst + outSecond === 0) continue;
      s.side.firstLine[t] = s.side.firstLine[t]! - outFirst;
      s.side.secondLine[t] = s.side.secondLine[t]! - outSecond;
      s.first[t] = s.first[t]! - outFirst;
      s.second[t] = s.second[t]! - outSecond;
      sendOut(state, s.side, t, outFirst + outSecond);
    }
  });
}

/**
 * Forme les unités du joueur et les envoie vers ses fronts (05-Fronts §4). `budget` :
 * personnes disponibles pour devenir soldats. `tier1Only` : mobilisation forcée avant
 * l'économie, seulement le premier palier de la première ligne. Renvoie la
 * population utilisée. Les soldats comptent dès le départ de l'unité.
 */
export function assignTroops(state: GameState, player: Player, budget: number, tier1Only: boolean, fronts: readonly Front[] = state.fronts): number {
  const slots = buildSlots(fronts, player.id);
  if (slots.length === 0) return 0;
  if (!tier1Only) releaseSurplus(state, player, slots);
  let people = budget;
  const pool: Pool = {
    available: (t) => formable(player.armamentReserve, people, t),
    take: (t, n) => {
      const u = UNIT_DATA[t]!;
      player.armamentReserve[u.equipment] = player.armamentReserve[u.equipment]! - n * u.equipmentCount;
      people -= n * u.population;
    },
  };
  const grants = distribute(slots, pool, tier1Only);
  const arrival = currentTurn(state) + FRONTS.transferTurns;
  let used = 0;
  for (const g of grants) {
    g.slot.side.transfers.push({ unit: g.unit, count: g.count, toFront: true, line: g.line, arrival } satisfies Transfer);
    used += g.count * UNIT_DATA[g.unit]!.population;
  }
  player.soldiers += used;
  return used;
}

/**
 * Applique les mouvements arrivés à ce tour (05-Fronts §4.5) : une unité arrivée à un
 * front rejoint la ligne visée ; une unité de retour rend ses équipements à la réserve
 * et sa population à la répartition.
 */
export function applyTransfers(state: GameState): void {
  const turn = currentTurn(state);
  for (const front of state.fronts) {
    for (let i = 0; i < 2; i++) {
      const side = front.sides[i]!;
      if (side.transfers.length === 0) continue;
      const player = state.players[front.players[i]! - 1]!;
      const keep: Transfer[] = [];
      for (const tr of side.transfers) {
        if (tr.arrival > turn) keep.push(tr);
        else if (tr.toFront) (tr.line === 0 ? side.firstLine : side.secondLine)[tr.unit] += tr.count;
        else giveBack(player, tr.unit, tr.count);
      }
      side.transfers = keep;
    }
  }
}

/** Mobilisation forcée (05-Fronts §4.1) : avant l'économie, les soldats passent avant les lignes de production. */
export function recruitBeforeEconomy(state: GameState): void {
  const fronts = frontsByPlayer(state);
  for (const p of state.players) {
    if (p.forcedMobilization) assignTroops(state, p, Math.max(0, p.population - p.soldiers), true, fronts[p.id - 1]);
  }
}

/** Après l'économie : les soldats sont recrutés en dernier, parmi les inactifs (05-Fronts §4.1). */
export function recruitAfterEconomy(state: GameState): void {
  const fronts = frontsByPlayer(state);
  for (const p of state.players) {
    const used = assignTroops(state, p, p.idle, false, fronts[p.id - 1]);
    p.idle -= used;
  }
}

export { NO_LIMIT };

/**
 * Retrait des troupes (05-Fronts §4.7). Le pays manque de `shortage` personnes pour ses lignes de production, ses fermiers
 * et ses pêcheurs, qui passent avant les soldats : on retire des unités des fronts, celles de plus haute `releasePriority`
 * d'abord (infanterie, puis équipement, puis chars), des fronts de plus basse priorité d'abord (à égalité, de plus grand
 * identifiant), de la seconde ligne avant la première, sans toucher aux unités qu'une percée engage. Un camp qui perd de
 * l'infanterie est recalé : son équipement en trop part avec elle (`trimSide`). Les unités retirées retournent à la réserve
 * avec le délai de transfert, et leur population ne travaille qu'à leur arrivée : les personnes déjà en chemin de retour
 * comptent donc dans le manque, pour ne pas retirer deux fois les mêmes.
 */
export function releaseTroops(state: GameState, player: Player, shortage: number, fronts: readonly Front[]): void {
  const sides = fronts
    .map((front) => ({ front, i: sideIndex(front, player.id) }))
    .filter((s) => s.i >= 0)
    .sort((a, b) => priorityPercent(a.front.sides[a.i]!) - priorityPercent(b.front.sides[b.i]!) || b.front.id - a.front.id);
  const outgoing = (): number => {
    let people = 0;
    for (const { front, i } of sides) {
      for (const tr of front.sides[i]!.transfers) if (!tr.toFront) people += tr.count * UNIT_DATA[tr.unit]!.population;
    }
    return people;
  };
  const types = UNIT_DATA.map((u) => u.index).sort((a, b) => UNIT_DATA[b]!.releasePriority - UNIT_DATA[a]!.releasePriority || a - b);
  for (const t of types) {
    let need = shortage - outgoing();
    if (need <= 0) return;
    const pop = UNIT_DATA[t]!.population;
    const touched: { front: Front; i: number }[] = [];
    for (const s of sides) {
      if (need <= 0) break;
      const side = s.front.sides[s.i]!;
      const lock = locked(s.front, s.i);
      const fromSecond = Math.min(side.secondLine[t]! - lock.second[t]!, Math.ceil(need / pop));
      if (fromSecond > 0) {
        side.secondLine[t] = side.secondLine[t]! - fromSecond;
        sendOut(state, side, t, fromSecond);
        need -= fromSecond * pop;
      }
      const fromFirst = Math.min(side.firstLine[t]! - lock.first[t]!, Math.ceil(Math.max(0, need) / pop));
      if (fromFirst > 0) {
        side.firstLine[t] = side.firstLine[t]! - fromFirst;
        sendOut(state, side, t, fromFirst);
        need -= fromFirst * pop;
      }
      if (fromSecond > 0 || fromFirst > 0) touched.push(s);
    }
    for (const s of touched) trimSide(state, s.front, s.i);
  }
}
