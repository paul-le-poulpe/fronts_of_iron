// Usines, lignes de production et leurs ordres (Docs/Design/00-Game.md §8, §9).
// Une usine par ville ; ses lignes sont rangées en groupes (un groupe = un bien) ;
// l'ordre des usines dans `Player.factories` et celui des groupes dans
// `Factory.groups` sont les priorités du remplissage (§4, §8.1). Le remplissage
// lui-même est dans economy.ts.

import {
  ARMAMENT,
  FACTORY,
  FACTORY_TYPES,
  GOODS,
  type ArmamentId,
  type FactoryNode,
  type FactoryTypeId,
  type GoodId,
  type ProductConfig,
  type ProductId,
} from "./config.ts";
import type { Factory, GameState, Player } from "./state.ts";

export const GOOD_IDS = Object.keys(GOODS) as GoodId[];
export const ARMAMENT_IDS = Object.keys(ARMAMENT.types) as ArmamentId[];
/** Biens puis armements : l'indice d'un produit est sa valeur dans le hash. */
export const PRODUCT_IDS: readonly ProductId[] = [...GOOD_IDS, ...ARMAMENT_IDS];
export const FACTORY_TYPE_IDS = Object.keys(FACTORY_TYPES) as FactoryTypeId[];

const PRODUCT_INDEX = new Map<string, number>(PRODUCT_IDS.map((id, i) => [id, i]));
const FACTORY_TYPE_INDEX = new Map<string, number>(FACTORY_TYPE_IDS.map((id, i) => [id, i]));

/** Indice d'un bien dans `Player.goods`, -1 si ce n'est pas un bien. */
export function goodIndex(id: ProductId): number {
  return GOOD_IDS.indexOf(id as GoodId);
}

/** Indice d'un type d'armement dans les tableaux d'armement du joueur, -1 si ce n'est pas de l'armement. */
export function armamentIndex(id: ProductId): number {
  return ARMAMENT_IDS.indexOf(id as ArmamentId);
}

export function productConfig(id: ProductId): ProductConfig {
  const a = armamentIndex(id);
  return a >= 0 ? ARMAMENT.types[ARMAMENT_IDS[a]!] : GOODS[id as GoodId];
}

/** Indice d'un produit dans `PRODUCT_IDS` (pour le hash). */
export function productIndex(id: ProductId): number {
  return PRODUCT_INDEX.get(id)!;
}

/** Indice d'un type d'usine dans `FACTORY_TYPE_IDS` (pour le hash). */
export function factoryTypeIndex(id: FactoryTypeId): number {
  return FACTORY_TYPE_INDEX.get(id)!;
}

export function isProductId(v: unknown): v is ProductId {
  return typeof v === "string" && PRODUCT_INDEX.has(v);
}

export function isFactoryTypeId(v: unknown): v is FactoryTypeId {
  return typeof v === "string" && FACTORY_TYPE_INDEX.has(v);
}

/** L'arbre de production d'un type d'usine. */
export function treeOf(type: FactoryTypeId): readonly FactoryNode[] {
  return FACTORY_TYPES[type].tree;
}

/** Indice de `good` dans l'arbre du type d'usine, -1 s'il n'y est pas. */
export function nodeIndex(type: FactoryTypeId, good: ProductId): number {
  return treeOf(type).findIndex((n) => n.good === good);
}

/** L'usine de la ville, ou undefined. */
export function factoryOf(player: Player, city: number): Factory | undefined {
  return player.factories.find((f) => f.city === city);
}

/** Le bien est-il créable dans cette usine : la racine, ou un enfant dont le parent a `unlockTurns` tours (00-Game §8.2) ? */
export function isUnlocked(factory: Factory, good: ProductId): boolean {
  const tree = treeOf(factory.type);
  const i = nodeIndex(factory.type, good);
  if (i < 0) return false;
  const parent = tree[i]!.parent;
  if (parent === null) return true;
  return factory.progress[nodeIndex(factory.type, parent)]! >= FACTORY.unlockTurns;
}

/** Nombre total de lignes de l'usine : son niveau (00-Game §8). */
export function factoryLevel(factory: Factory): number {
  let n = 0;
  for (const g of factory.groups) n += g.lines;
  return n;
}

/**
 * Réserve maximale d'un type d'armement (00-Game §8.3) : toutes ses lignes, quel
 * que soit leur statut, × production par ligne × `maxStockTurns`.
 */
export function armamentReserveMax(player: Player, id: ArmamentId): number {
  let lines = 0;
  for (const f of player.factories) for (const g of f.groups) if (g.good === id) lines += g.lines;
  return lines * ARMAMENT.types[id].productionPerLine * ARMAMENT.maxStockTurns;
}

/** Ville du joueur `playerId` ou null (ordre venu du réseau : `city` a déjà été vérifié entier). */
function ownCity(state: GameState, playerId: number, city: number): boolean {
  return city >= 1 && city <= state.cities.length && state.cities[city - 1]!.player === playerId;
}

/** `build_factory` (00-Game §9) : gratuit pour l'instant ; au plus `FACTORY.maxTypesPerCity` types, une usine par ville ; une ligne de base active. */
export function buildFactory(state: GameState, playerId: number, city: number, type: FactoryTypeId): boolean {
  if (!ownCity(state, playerId, city)) return false;
  const player = state.players[playerId - 1]!;
  // Une seule usine par ville dans l'état (02-Engine §7) : `maxTypesPerCity` ≥ 1 la permet.
  if (FACTORY.maxTypesPerCity < 1 || factoryOf(player, city) !== undefined) return false;
  // L'usine naît avec une ligne active de son bien de base, la racine de son arbre (00-Game §8).
  player.factories.push({
    city,
    type,
    groups: [{ good: treeOf(type)[0]!.good, lines: 1, active: 1, filled: 0 }],
    progress: new Array<number>(treeOf(type).length).fill(0),
  });
  return true;
}

/**
 * `create_line` (00-Game §8.2) : ajoute une ligne du bien, activée. Le bien doit être
 * dans l'arbre de l'usine et débloqué. Gratuit, sans nombre maximal (02-Engine §7).
 */
export function createLine(state: GameState, playerId: number, city: number, good: ProductId): boolean {
  if (!ownCity(state, playerId, city)) return false;
  const factory = factoryOf(state.players[playerId - 1]!, city);
  if (factory === undefined || !isUnlocked(factory, good)) return false;
  const group = factory.groups.find((g) => g.good === good);
  if (group === undefined) factory.groups.push({ good, lines: 1, active: 1, filled: 0 });
  else {
    group.lines++;
    group.active++;
  }
  return true;
}

/** `set_active_lines` (00-Game §9) : `count` entre 0 et le nombre de lignes du groupe. */
export function setActiveLines(state: GameState, playerId: number, city: number, good: ProductId, count: number): boolean {
  if (!ownCity(state, playerId, city)) return false;
  const factory = factoryOf(state.players[playerId - 1]!, city);
  const group = factory?.groups.find((g) => g.good === good);
  if (group === undefined || count < 0 || count > group.lines) return false;
  group.active = count;
  return true;
}

/** Retire l'élément d'indice `from` et le remet à l'indice `to` (indice final). */
function moveTo<T>(list: T[], from: number, to: number): void {
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
}

/** `set_city_priority` : la ville (avec son usine) prend la position `position` (0 = remplie en premier). */
export function setCityPriority(state: GameState, playerId: number, city: number, position: number): boolean {
  if (!ownCity(state, playerId, city)) return false;
  const list = state.players[playerId - 1]!.factories;
  const from = list.findIndex((f) => f.city === city);
  if (from < 0 || position < 0 || position >= list.length) return false;
  moveTo(list, from, position);
  return true;
}

/** `set_line_priority` : le groupe de lignes du bien prend la position `position` dans la section de sa ville. */
export function setLinePriority(state: GameState, playerId: number, city: number, good: ProductId, position: number): boolean {
  if (!ownCity(state, playerId, city)) return false;
  const factory = factoryOf(state.players[playerId - 1]!, city);
  if (factory === undefined) return false;
  const from = factory.groups.findIndex((g) => g.good === good);
  if (from < 0 || position < 0 || position >= factory.groups.length) return false;
  moveTo(factory.groups, from, position);
  return true;
}
