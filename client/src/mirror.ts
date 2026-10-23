// Copie locale, côté page, de ce que l'affichage lit de la partie : la carte, la
// ville de chaque case, la liste des villes et des routes, les totaux des
// joueurs. Mise à jour par les messages du Worker (protocol.ts) ; ne contient
// aucun calcul de règle. Pas d'accès au DOM : testable sous Node.
//
// Calcule aussi les rayons d'exploitation (00-Game §6.6), qui sont de
// l'affichage seulement : pour chaque joueur, un seuil de distance au carré
// commun à toutes ses villes, tel que le nombre de cases fertiles (ou d'eau) de
// ses zones à moins de ce seuil de leur ville soit le plus proche possible de la
// surface cultivée (ou pêchée). Les histogrammes sont tenus à jour case par case.

import type { InitMessage, PlayerStats, TickMessage } from "./protocol.ts";

export const TERRAIN_LAND = 0x80;
export const TERRAIN_SHORE = 0x40;
export const TERRAIN_OCEAN = 0x20;
export const TERRAIN_ALTITUDE = 0x1f;

export interface MirrorCity {
  readonly id: number;
  readonly player: number;
  readonly tile: number;
  readonly port: boolean;
  readonly group: number;
}

export class Mirror {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly resources: Uint8Array;
  readonly fertility: Uint8Array;
  readonly playerCount: number;
  readonly expansionRadius: number;
  readonly controlRadius: number;
  readonly foundingCost: number;
  /** Ville de chaque case, 0 = aucune. Même contenu que `state.tileCity` du moteur. */
  readonly tileCity: Uint16Array;
  tick = 0;
  cities: MirrorCity[] = [];
  /** Routes : paires d'identifiants de villes. */
  roads: Uint16Array = new Uint16Array(0);
  /** Statistiques du dernier tour, `stats[id - 1]`. */
  stats: PlayerStats[] = [];
  /** Identifiants des villes de chaque joueur, `cityIds[id - 1]`. */
  readonly cityIds: number[][];
  /** Seuil de distance au carré des champs de chaque joueur (-1 : aucune case), `farmThreshold[id - 1]`. */
  readonly farmThreshold: Int32Array;
  /** Même chose pour la pêche. */
  readonly seaThreshold: Int32Array;
  /** Cases de côte la plus proche de chaque ville à port, par identifiant de ville ; la case de la ville si aucune. */
  private readonly portTiles = new Map<number, number>();
  private readonly farmHist: Int32Array[];
  private readonly seaHist: Int32Array[];
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
    this.foundingCost = init.foundingCost;
    const size = init.width * init.height;
    this.tileCity = new Uint16Array(size);
    this.repaintMark = new Uint8Array(size);
    const bins = init.controlRadius * init.controlRadius + 1;
    this.cityIds = Array.from({ length: init.playerCount }, () => []);
    this.farmHist = Array.from({ length: init.playerCount }, () => new Int32Array(bins));
    this.seaHist = Array.from({ length: init.playerCount }, () => new Int32Array(bins));
    this.farmThreshold = new Int32Array(init.playerCount).fill(-1);
    this.seaThreshold = new Int32Array(init.playerCount).fill(-1);
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
   * changé, leur voisine de gauche et celle du dessus (le trait de limite d'une
   * case dépend de ses voisines de droite et du dessous), et les cases dont
   * l'appartenance au champ ou à la zone de pêche a changé avec le rayon.
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
      if (t >= w) mark(t - w);
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
      if (farm !== this.farmThreshold[k]) {
        this.markDiscRing(k, this.farmThreshold[k]!, farm, true, mark);
        this.farmThreshold[k] = farm;
      }
      if (sea !== this.seaThreshold[k]) {
        this.markDiscRing(k, this.seaThreshold[k]!, sea, false, mark);
        this.seaThreshold[k] = sea;
      }
    }

    for (const t of repaint) this.repaintMark[t] = 0;
    return repaint;
  }

  /** Ajoute (`sign` = +1) ou retire (-1) la case de l'histogramme du joueur de la ville `cityId` (0 : rien). */
  private count(tile: number, cityId: number, sign: number): void {
    if (cityId === 0) return;
    const land = this.isLand(tile);
    if (land && this.fertility[tile] === 0) return;
    const city = this.cities[cityId - 1]!;
    const w = this.width;
    const dx = (tile % w) - (city.tile % w);
    const dy = Math.floor(tile / w) - Math.floor(city.tile / w);
    const d2 = dx * dx + dy * dy;
    const hist = land ? this.farmHist : this.seaHist;
    const bins = hist[0]!.length;
    if (d2 < bins) hist[city.player - 1]![d2]! += sign;
  }

  /** Marque les cases des villes du joueur `k` dont la distance au carré est dans ]min(a, b), max(a, b)]. */
  private markDiscRing(k: number, a: number, b: number, farm: boolean, mark: (t: number) => void): void {
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
          const land = this.isLand(t);
          if (land ? !farm || this.fertility[t] === 0 : farm) continue;
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
  referenceThresholds(): { farm: number[]; sea: number[] } {
    const bins = this.controlRadius * this.controlRadius + 1;
    const farm = Array.from({ length: this.playerCount }, () => new Int32Array(bins));
    const sea = Array.from({ length: this.playerCount }, () => new Int32Array(bins));
    const w = this.width;
    for (let t = 0; t < this.tileCity.length; t++) {
      const id = this.tileCity[t]!;
      if (id === 0) continue;
      const land = this.isLand(t);
      if (land && this.fertility[t] === 0) continue;
      const city = this.cities[id - 1]!;
      const dx = (t % w) - (city.tile % w);
      const dy = Math.floor(t / w) - Math.floor(city.tile / w);
      (land ? farm : sea)[city.player - 1]![dx * dx + dy * dy]!++;
    }
    return {
      farm: this.stats.map((p, k) => pickThreshold(farm[k]!, p.cultivated)),
      sea: this.stats.map((p, k) => pickThreshold(sea[k]!, p.fished)),
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
