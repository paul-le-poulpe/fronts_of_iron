// Peinture de la carte, une couleur par case, dans un tampon RGBA de
// largeur × hauteur pixels. Reprend les idées de packages/engine/test/cities-viz.ts
// (relief, teinte du joueur sur la terre seulement, frontières et limites de zones,
// champs et zone de pêche, mine, à textures distinctes de la couleur du joueur :
// 00-Game §11).
// Pas d'accès au DOM : la page fabrique l'`ImageData` sur le même tampon.
//
// L'ordre de peinture d'une case est celui de la visualisation : relief, recouvert
// d'un gris brun-rouge si la case a du fer, sinon d'un vert léger si elle est
// cultivable ; teinte du territoire sur la terre ; texture de champs, de pêche ou de
// mine ; puis trait par-dessus : frontière (couleur du joueur plus sombre) sur une case de terre qui
// touche une terre sans ville ou à un autre joueur, sinon limite entre deux villes
// du même joueur (couleur du joueur plus claire). La couleur d'une case dépend donc
// de ses quatre voisines.

import { Mirror, TERRAIN_ALTITUDE, TERRAIN_LAND } from "./mirror.ts";

export type Rgb = readonly [number, number, number];

/** Couleur d'un joueur : teinte à l'angle d'or, comme la visualisation du moteur. */
export function playerColor(player: number): Rgb {
  return hsl((player * 137.508) % 360, 0.6, 0.55);
}
/** Version foncée, pour les villes et les routes. */
export function playerDark(player: number): Rgb {
  return hsl((player * 137.508) % 360, 0.65, 0.3);
}

/** Couleur de frontière d'un joueur : sa teinte, plus sombre que `playerColor`. */
export function playerBorder(player: number): Rgb {
  return hsl((player * 137.508) % 360, 0.6, 0.42);
}
/** Couleur de limite entre deux villes d'un même joueur : sa teinte, plus claire que `playerColor`. */
export function playerLimit(player: number): Rgb {
  return hsl((player * 137.508) % 360, 0.6, 0.68);
}

function hsl(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export const rgbCss = (c: Rgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;

const WATER: Rgb = [111, 156, 204];
const FIELD_DARK: Rgb = [96, 152, 52];
const FIELD_LIGHT: Rgb = [128, 190, 72];
// Avec « Couleur des joueurs », un champ garde 70 % de la couleur du territoire et prend 30 % de sa bande verte ;
// sans, la bande remplace la couleur.
const FIELD_ALPHA_ON_PLAYER = 0.3;
const FISH_DARK: Rgb = [138, 184, 224];
const FISH_LIGHT: Rgb = [225, 240, 250];
// Texture provisoire de la mine (fer exploité) : bandes diagonales sombres et orangées.
const MINE_DARK: Rgb = [58, 52, 48];
const MINE_LIGHT: Rgb = [214, 126, 46];

const LAND_LOW = [150, 176, 112] as const;
const LAND_MID = [181, 160, 118] as const;
const LAND_HIGH = [236, 232, 224] as const;

// Terre cultivable (fertilité > 0) : relief recouvert de ce vert à 80/255 d'opacité, toujours.
const FERTILE: Rgb = [90, 220, 90];
const FERTILE_ALPHA = 80 / 255;
// Case de fer : relief recouvert de ce gris brun-rouge, toujours (prioritaire sur le vert cultivable).
// La vue « Ressources naturelles » y ajoute des hachures rouge foncé (render.ts).
const IRON_TINT: Rgb = [190, 160, 150];
const IRON_ALPHA = 0.55;

function landColor(alt: number): Rgb {
  const t = alt / 31;
  const [a, b, u] = t < 0.5 ? [LAND_LOW, LAND_MID, t * 2] : [LAND_MID, LAND_HIGH, (t - 0.5) * 2];
  const mix = (i: 0 | 1 | 2): number => Math.round(a[i] + (b[i] - a[i]) * u);
  return [mix(0), mix(1), mix(2)];
}

/** Relief de l'altitude `alt` recouvert de `over` à l'opacité `alpha`. */
function overlay(alt: number, over: Rgb, alpha: number): Rgb {
  const c = landColor(alt);
  const mix = (i: 0 | 1 | 2): number => Math.round(c[i] * (1 - alpha) + over[i] * alpha);
  return [mix(0), mix(1), mix(2)];
}

export class Painter {
  readonly buffer: ArrayBuffer;
  /** Même tampon vu en octets, pour `new ImageData(...)`. */
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  private readonly pixels: Uint32Array;
  private readonly land: Rgb[] = Array.from({ length: 32 }, (_, a) => landColor(a));
  private readonly landFertile: Rgb[] = Array.from({ length: 32 }, (_, a) => overlay(a, FERTILE, FERTILE_ALPHA));
  private readonly landIron: Rgb[] = Array.from({ length: 32 }, (_, a) => overlay(a, IRON_TINT, IRON_ALPHA));
  private readonly playerRgb: Rgb[] = [];
  private readonly borderRgb: Rgb[] = [];
  private readonly limitRgb: Rgb[] = [];
  /** Case « Couleur des joueurs » du menu Carte. */
  showPlayerColor = true;

  private readonly mirror: Mirror;

  constructor(mirror: Mirror) {
    this.mirror = mirror;
    const size = mirror.width * mirror.height;
    this.buffer = new ArrayBuffer(size * 4);
    this.bytes = new Uint8ClampedArray(this.buffer);
    this.pixels = new Uint32Array(this.buffer);
    for (let p = 0; p <= mirror.playerCount; p++) {
      this.playerRgb.push(playerColor(p));
      this.borderRgb.push(playerBorder(p));
      this.limitRgb.push(playerLimit(p));
    }
  }

  paintAll(): void {
    for (let t = 0; t < this.pixels.length; t++) this.pixels[t] = this.colorOf(t);
  }

  paintTiles(tiles: readonly number[]): void {
    for (const t of tiles) this.pixels[t] = this.colorOf(t);
  }

  /** Pixel de la case `t` tel qu'il doit être maintenant, d'après la copie locale. */
  colorOf(t: number): number {
    const m = this.mirror;
    const b = m.terrain[t]!;
    const onLand = (b & TERRAIN_LAND) !== 0;
    const w = m.width;
    const id = m.tileCity[t]!;
    const c: Rgb = onLand
      ? ((m.resources[t]! & 1) !== 0 ? this.landIron : m.fertility[t] !== 0 ? this.landFertile : this.land)[
          b & TERRAIN_ALTITUDE
        ]!
      : WATER;
    let r = c[0];
    let g = c[1];
    let bl = c[2];
    const x = t % w;
    const y = (t - x) / w;

    if (id !== 0) {
      const city = m.cities[id - 1]!;
      // Le territoire n'est dessiné que sur la terre (00-Game §11) : la zone d'une
      // ville couvre aussi l'eau dans le moteur, mais pas à l'affichage.
      if (onLand && this.showPlayerColor) {
        const pc = this.playerRgb[city.player]!;
        r = Math.round(r * 0.55 + pc[0] * 0.45);
        g = Math.round(g * 0.55 + pc[1] * 0.45);
        bl = Math.round(bl * 0.55 + pc[2] * 0.45);
      }
      // Champs (terre fertile) et zone de pêche (eau) à moins du rayon d'exploitation du joueur.
      // Mine : cases de fer à moins du rayon d'exploitation du fer (texture propre, provisoire : 00-Game §11).
      const mine = onLand && (m.resources[t]! & 1) !== 0;
      if (!onLand || m.fertility[t] !== 0 || mine) {
        const ct = city.tile;
        const dx = x - (ct % w);
        const dy = y - (((ct - (ct % w)) / w) | 0);
        const thr = (mine ? m.ironThreshold : onLand ? m.farmThreshold : m.seaThreshold)[city.player - 1]!;
        if (dx * dx + dy * dy <= thr) {
          const tex = mine
            ? (x + y) % 4 < 2 ? MINE_DARK : MINE_LIGHT
            : onLand
              ? y % 2 === 0 ? FIELD_DARK : FIELD_LIGHT
              : (x + 2 * y) % 4 === 0 ? FISH_LIGHT : FISH_DARK;
          if (onLand && !mine && this.showPlayerColor) {
            const a = FIELD_ALPHA_ON_PLAYER;
            r = Math.round(r * (1 - a) + tex[0] * a);
            g = Math.round(g * (1 - a) + tex[1] * a);
            bl = Math.round(bl * (1 - a) + tex[2] * a);
          } else {
            r = tex[0];
            g = tex[1];
            bl = tex[2];
          }
        }
      }
      if (onLand) {
        const e = this.edgeColor(t, x, id, city.player);
        if (e !== null) {
          r = e[0];
          g = e[1];
          bl = e[2];
        }
      }
    }
    return ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }

  /**
   * Trait d'une case de terre de la ville `id` du joueur `player` (00-Game §11), ou null.
   * Frontière : une des quatre voisines est de la terre sans ville ou à un autre joueur
   * (l'eau et le bord de la carte ne comptent pas). Sinon limite : la voisine de droite
   * ou du dessous est de la terre d'une autre ville du même joueur.
   */
  private edgeColor(t: number, x: number, id: number, player: number): Rgb | null {
    const m = this.mirror;
    const w = m.width;
    const size = this.pixels.length;
    const left = x > 0 ? t - 1 : -1;
    const right = x < w - 1 ? t + 1 : -1;
    const up = t >= w ? t - w : -1;
    const down = t + w < size ? t + w : -1;
    for (const u of [left, right, up, down]) {
      if (u < 0 || (m.terrain[u]! & TERRAIN_LAND) === 0) continue;
      const idU = m.tileCity[u]!;
      if (idU === 0 || m.cities[idU - 1]!.player !== player) return this.borderRgb[player]!;
    }
    for (const u of [right, down]) {
      if (u < 0 || (m.terrain[u]! & TERRAIN_LAND) === 0) continue;
      if (m.tileCity[u]! !== id) return this.limitRgb[player]!;
    }
    return null;
  }

  /** Pixel d'une case, pour les tests. */
  pixel(t: number): number {
    return this.pixels[t]!;
  }
}
