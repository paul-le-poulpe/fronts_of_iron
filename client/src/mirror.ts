// Copie locale, côté page, de ce que l'affichage lit de la partie : la carte, la
// ville de chaque case, la liste des villes et des routes, les totaux des
// joueurs. Mise à jour par les messages du Worker (protocol.ts) ; ne contient
// aucun calcul de règle. Pas d'accès au DOM : testable sous Node.
//
// Calcule aussi les rayons d'exploitation (00-Game §6.6), qui sont de
// l'affichage seulement : pour chaque joueur, un seuil de distance au carré
// commun à toutes ses villes, tel que le nombre de cases fertiles (ou d'eau) de
// ses zones à moins de ce seuil de leur ville soit le plus proche possible de la
// surface cultivée (ou pêchée, ou du nombre de cases de fer exploitées). Les
// histogrammes sont tenus à jour case par case.

import type { FactoryCatalog, HumanDetail, InitMessage, PlayerStats, TickMessage } from "./protocol.ts";
import { RoadPaths } from "./roadpaths.ts";

export const TERRAIN_LAND = 0x80;
export const TERRAIN_SHORE = 0x40;
export const TERRAIN_OCEAN = 0x20;
export const TERRAIN_ALTITUDE = 0x1f;
/** Bits de `resources` : mêmes valeurs que RESOURCE_IRON et RESOURCE_ALUMINIUM du moteur (map.ts). */
export const RESOURCE_IRON = 0x01;
export const RESOURCE_ALUMINIUM = 0x02;

export interface MirrorCity {
  readonly id: number;
  readonly player: number;
  readonly tile: number;
  readonly port: boolean;
  readonly group: number;
}

/** L'usine d'une ville, telle que la carte la dessine. */
export interface FactoryMark {
  /** Identifiant du type d'usine (`FactoryCatalog.factoryTypes[i].id`). */
  readonly type: string;
  readonly level: number;
  /** Bien qui a le plus de lignes construites dans l'usine : son icône la représente (`dominantGood`). */
  readonly good: string;
}

/** Ce que comptent les rayons d'exploitation : les cases des champs, de la mer ou du fer. */
type Kind = "farm" | "sea" | "iron";

export class Mirror {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly resources: Uint8Array;
  readonly fertility: Uint8Array;
  readonly playerCount: number;
  readonly expansionRadius: number;
  readonly controlRadius: number;
  /** Ville de chaque case, 0 = aucune. Même contenu que `state.tileCity` du moteur. */
  readonly tileCity: Uint16Array;
  tick = 0;
  cities: MirrorCity[] = [];
  /** Routes : paires d'identifiants de villes. */
  roads: Uint16Array = new Uint16Array(0);
  /** Tracé d'affichage de chaque route (00-Game §3.5) : `roadTiles[i]` est la suite de cases de `roads[2i]`–`roads[2i+1]`. */
  roadTiles: Int32Array[] = [];
  private readonly roadPaths: RoadPaths;
  /** Statistiques du dernier tour, `stats[id - 1]`. */
  stats: PlayerStats[] = [];
  /** Identifiants des villes de chaque joueur, `cityIds[id - 1]`. */
  readonly cityIds: number[][];
  /** Seuil de distance au carré des champs de chaque joueur (-1 : aucune case), `farmThreshold[id - 1]`. */
  readonly farmThreshold: Int32Array;
  /** Même chose pour la pêche. */
  readonly seaThreshold: Int32Array;
  /** Même chose pour les cases de fer exploitées (la mine). */
  readonly ironThreshold: Int32Array;
  readonly catalog: FactoryCatalog;
  /** Usines de tous les joueurs, par identifiant de ville. */
  factoryMarks = new Map<number, FactoryMark>();
  /** Détail des usines du joueur humain, au dernier tour. */
  detail: HumanDetail | null = null;
  /** Cases de côte la plus proche de chaque ville à port, par identifiant de ville ; la case de la ville si aucune. */
  private readonly portTiles = new Map<number, number>();
  private readonly farmHist: Int32Array[];
  private readonly seaHist: Int32Array[];
  private readonly ironHist: Int32Array[];
  /** 1 sur les cases déjà dans la liste de repeinture du tour. */
  private readonly repaintMark: Uint8Array;

  constructor(init: InitMessage) {
    this.width = init.width;
    this.height = init.height;
    this.terrain = init.terrain;
    this.resources = init.resources;
    this.fertility = init.fertility;
    this.playerCount = init.playerCount;
    this.expansionRadius = init.expansionRadius;
    this.controlRadius = init.controlRadius;
    this.catalog = init.catalog;
    this.roadPaths = new RoadPaths(init.width, init.height, init.terrain, Math.floor(init.expansionRadius / 2));
    const size = init.width * init.height;
    this.tileCity = new Uint16Array(size);
    this.repaintMark = new Uint8Array(size);
    const bins = init.controlRadius * init.controlRadius + 1;
    this.cityIds = Array.from({ length: init.playerCount }, () => []);
    this.farmHist = Array.from({ length: init.playerCount }, () => new Int32Array(bins));
    this.seaHist = Array.from({ length: init.playerCount }, () => new Int32Array(bins));
    this.ironHist = Array.from({ length: init.playerCount }, () => new Int32Array(bins));
    this.farmThreshold = new Int32Array(init.playerCount).fill(-1);
    this.seaThreshold = new Int32Array(init.playerCount).fill(-1);
    this.ironThreshold = new Int32Array(init.playerCount).fill(-1);
  }

  /**
   * Cases de terre cultivables (fertilité > 0) qu'une ville fondée sur `tile`
   * prendrait (00-Game §3.2) : dans son rayon de contrôle, sans ville, ou dont la
   * ville actuelle est strictement plus éloignée. Affichage du mode placement.
   */
  fertileTilesFor(tile: number): number {
    const w = this.width;
    const r = this.controlRadius;
    const cx = tile % w;
    const cy = (tile - cx) / w;
    let n = 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r * r) continue;
        const t = y * w + x;
        if (this.fertility[t] === 0) continue;
        const id = this.tileCity[t]!;
        if (id !== 0) {
          const o = this.cities[id - 1]!.tile;
          const ox = (o % w) - x;
          const oy = Math.floor(o / w) - y;
          if (d2 >= ox * ox + oy * oy) continue;
        }
        n++;
      }
    }
    return n;
  }

  isLand(tile: number): boolean {
    return (this.terrain[tile]! & TERRAIN_LAND) !== 0;
  }

  /** Propriétaire d'une case (joueur de sa ville), 0 = personne. */
  ownerOf(tile: number): number {
    const id = this.tileCity[tile]!;
    return id === 0 ? 0 : this.cities[id - 1]!.player;
  }

  /** Case où dessiner l'icône de port de la ville (00-Game §3.6, §11). */
  portTile(cityId: number): number {
    return this.portTiles.get(cityId) ?? this.cities[cityId - 1]!.tile;
  }

  /**
   * Applique un tour. Renvoie les cases à repeindre : celles dont la ville a
   * changé et leurs quatre voisines (la couleur d'une case, trait de frontière ou
   * de limite compris, dépend de ses voisines de gauche, droite, haut et bas), et
   * les cases dont l'appartenance au champ ou à la zone de pêche a changé avec le rayon.
   */
  applyTick(msg: TickMessage): number[] {
    this.tick = msg.tick;
    const repaint: number[] = [];
    const w = this.width;
    const mark = (t: number): void => {
      if (this.repaintMark[t] === 0) {
        this.repaintMark[t] = 1;
        repaint.push(t);
      }
    };

    if (msg.cities !== null) {
      const c = msg.cities;
      const n = c.length / 4;
      this.cities = [];
      for (const ids of this.cityIds) ids.length = 0;
      for (let i = 0; i < n; i++) {
        const city = { id: i + 1, player: c[4 * i]!, tile: c[4 * i + 1]!, port: c[4 * i + 2] === 1, group: c[4 * i + 3]! };
        this.cities.push(city);
        this.cityIds[city.player - 1]!.push(city.id);
      }
      this.portTiles.clear();
    }
    if (msg.roads !== null) this.roads = msg.roads;
    if (msg.cities !== null || msg.roads !== null) this.roadTiles = this.roadPaths.sync(this.cities, this.roads);
    if (msg.factoryMarks !== null) {
      const f = msg.factoryMarks;
      this.factoryMarks = new Map();
      for (let i = 0; i < f.length; i += 4) {
        const type = this.catalog.factoryTypes[f[i + 1]!]!;
        this.factoryMarks.set(f[i]!, { type: type.id, level: f[i + 2]!, good: type.tree[f[i + 3]!]!.good });
      }
    }
    this.detail = msg.human;

    const tiles = msg.tiles;
    for (let i = 0; i < tiles.length; i += 2) {
      const t = tiles[i]!;
      const next = tiles[i + 1]!;
      const prev = this.tileCity[t]!;
      this.count(t, prev, -1);
      this.count(t, next, +1);
      this.tileCity[t] = next;
      mark(t);
      if (t % w > 0) mark(t - 1);
      if (t % w < w - 1) mark(t + 1);
      if (t >= w) mark(t - w);
      if (t + w < this.terrain.length) mark(t + w);
    }
    if (msg.cities !== null) {
      this.portTiles.clear();
      for (const city of this.cities) if (city.port) this.portTiles.set(city.id, this.findPortTile(city));
    }

    this.stats = msg.players.slice();
    for (const p of this.stats) {
      const k = p.id - 1;
      const farm = pickThreshold(this.farmHist[k]!, p.cultivated);
      const sea = pickThreshold(this.seaHist[k]!, p.fished);
      const iron = pickThreshold(this.ironHist[k]!, p.minedTiles);
      if (farm !== this.farmThreshold[k]) {
        this.markDiscRing(k, this.farmThreshold[k]!, farm, "farm", mark);
        this.farmThreshold[k] = farm;
      }
      if (sea !== this.seaThreshold[k]) {
        this.markDiscRing(k, this.seaThreshold[k]!, sea, "sea", mark);
        this.seaThreshold[k] = sea;
      }
      if (iron !== this.ironThreshold[k]) {
        this.markDiscRing(k, this.ironThreshold[k]!, iron, "iron", mark);
        this.ironThreshold[k] = iron;
      }
    }

    for (const t of repaint) this.repaintMark[t] = 0;
    return repaint;
  }

  /** Ce que la case compte pour les rayons d'exploitation : champs (terre fertile), mer, ou fer (terre qui porte du fer). */
  private kindsOf(tile: number): Record<Kind, boolean> {
    const land = this.isLand(tile);
    return { farm: land && this.fertility[tile] !== 0, sea: !land, iron: land && (this.resources[tile]! & 1) !== 0 };
  }

  /** Ajoute (`sign` = +1) ou retire (-1) la case de l'histogramme du joueur de la ville `cityId` (0 : rien). */
  private count(tile: number, cityId: number, sign: number): void {
    if (cityId === 0) return;
    const kinds = this.kindsOf(tile);
    if (!kinds.farm && !kinds.sea && !kinds.iron) return;
    const city = this.cities[cityId - 1]!;
    const w = this.width;
    const dx = (tile % w) - (city.tile % w);
    const dy = Math.floor(tile / w) - Math.floor(city.tile / w);
    const d2 = dx * dx + dy * dy;
    if (d2 >= this.farmHist[0]!.length) return;
    const player = city.player - 1;
    if (kinds.farm) this.farmHist[player]![d2]! += sign;
    if (kinds.sea) this.seaHist[player]![d2]! += sign;
    if (kinds.iron) this.ironHist[player]![d2]! += sign;
  }

  /** Marque les cases des villes du joueur `k` dont la distance au carré est dans ]min(a, b), max(a, b)]. */
  private markDiscRing(k: number, a: number, b: number, kind: Kind, mark: (t: number) => void): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const w = this.width;
    const r = this.controlRadius;
    for (const id of this.cityIds[k]!) {
      const ct = this.cities[id - 1]!.tile;
      const cx = ct % w;
      const cy = (ct - cx) / w;
      for (let y = Math.max(0, cy - r); y <= Math.min(this.height - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= lo || d2 > hi) continue;
          const t = y * w + x;
          if (this.tileCity[t] !== id) continue;
          if (!this.kindsOf(t)[kind]) continue;
          mark(t);
        }
      }
    }
  }

  /** Case de côte (terre qui touche l'eau) de la zone de la ville la plus proche d'elle ; sa propre case sinon. */
  private findPortTile(city: MirrorCity): number {
    const w = this.width;
    const r = this.controlRadius;
    const cx = city.tile % w;
    const cy = (city.tile - cx) / w;
    let best = city.tile;
    let bestD2 = Infinity;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const t = y * w + x;
        if (this.tileCity[t] !== city.id || (this.terrain[t]! & (TERRAIN_LAND | TERRAIN_SHORE)) !== (TERRAIN_LAND | TERRAIN_SHORE)) continue;
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = t;
        }
      }
    }
    return best;
  }

  /** Recalcule les seuils depuis zéro à partir de `tileCity` (référence des tests). */
  referenceThresholds(): { farm: number[]; sea: number[]; iron: number[] } {
    const bins = this.controlRadius * this.controlRadius + 1;
    const make = (): Int32Array[] => Array.from({ length: this.playerCount }, () => new Int32Array(bins));
    const hist: Record<Kind, Int32Array[]> = { farm: make(), sea: make(), iron: make() };
    const w = this.width;
    for (let t = 0; t < this.tileCity.length; t++) {
      const id = this.tileCity[t]!;
      if (id === 0) continue;
      const kinds = this.kindsOf(t);
      const city = this.cities[id - 1]!;
      const dx = (t % w) - (city.tile % w);
      const dy = Math.floor(t / w) - Math.floor(city.tile / w);
      const d2 = dx * dx + dy * dy;
      for (const kind of ["farm", "sea", "iron"] as const) if (kinds[kind]) hist[kind][city.player - 1]![d2]!++;
    }
    return {
      farm: this.stats.map((p, k) => pickThreshold(hist.farm[k]!, p.cultivated)),
      sea: this.stats.map((p, k) => pickThreshold(hist.sea[k]!, p.fished)),
      iron: this.stats.map((p, k) => pickThreshold(hist.iron[k]!, p.minedTiles)),
    };
  }
}

/**
 * Plus petit seuil de distance au carré dont le nombre cumulé de cases est le
 * plus proche de `target` ; -1 s'il n'y a aucune case à afficher (`target` 0, ou
 * aucune case ne rapproche du but).
 */
export function pickThreshold(hist: Int32Array, target: number): number {
  let best = -1;
  let bestDiff = target;
  let cum = 0;
  for (let d2 = 0; d2 < hist.length; d2++) {
    cum += hist[d2]!;
    const diff = Math.abs(cum - target);
    if (diff < bestDiff) {
      best = d2;
      bestDiff = diff;
    }
  }
  return best;
}
