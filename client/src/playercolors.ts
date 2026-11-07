// Couleurs des joueurs (Docs/Design/09-Couleurs.md) : une liste fixe, dont chaque entrée donne la couleur de carte,
// ses variantes et les trois tons d'unité. Pas d'accès au DOM. Ces couleurs n'entrent pas dans le moteur.

import { PLAYER_COLOR_COUNT } from "@fronts-of-iron/shared";

export type Rgb = readonly [number, number, number];

/** Une couleur de la liste : teinte (0 à 359), saturation et clarté (0 à 1). */
interface PlayerColorEntry {
  readonly name: string;
  readonly hue: number;
  readonly sat: number;
  readonly light: number;
}

/** Liste provisoire (09-Couleurs §2). */
export const PLAYER_COLORS: readonly PlayerColorEntry[] = [
  { name: "Rouge", hue: 0, sat: 0.7, light: 0.5 },
  { name: "Bordeaux", hue: 345, sat: 0.6, light: 0.34 },
  { name: "Orange", hue: 25, sat: 0.8, light: 0.52 },
  { name: "Or", hue: 45, sat: 0.75, light: 0.5 },
  { name: "Jaune", hue: 56, sat: 0.75, light: 0.55 },
  { name: "Olive", hue: 70, sat: 0.45, light: 0.4 },
  { name: "Citron vert", hue: 90, sat: 0.6, light: 0.48 },
  { name: "Vert", hue: 130, sat: 0.5, light: 0.42 },
  { name: "Sapin", hue: 155, sat: 0.55, light: 0.3 },
  { name: "Turquoise", hue: 175, sat: 0.6, light: 0.42 },
  { name: "Cyan", hue: 192, sat: 0.7, light: 0.5 },
  { name: "Azur", hue: 210, sat: 0.7, light: 0.52 },
  { name: "Bleu", hue: 225, sat: 0.65, light: 0.45 },
  { name: "Marine", hue: 228, sat: 0.55, light: 0.28 },
  { name: "Indigo", hue: 255, sat: 0.55, light: 0.45 },
  { name: "Violet", hue: 280, sat: 0.55, light: 0.48 },
  { name: "Magenta", hue: 310, sat: 0.6, light: 0.5 },
  { name: "Rose", hue: 335, sat: 0.75, light: 0.68 },
  { name: "Marron", hue: 25, sat: 0.45, light: 0.33 },
  { name: "Gris", hue: 210, sat: 0.06, light: 0.5 },
];

/** Part de la couleur du joueur sur une case de son territoire, le reste étant le terrain (09-Couleurs §3). */
export const TERRITORY_ALPHA = 0.4;
/** Sol de mi-altitude. */
export const LAND_MID: Rgb = [181, 160, 118];

// Réglages provisoires du calcul (09-Couleurs §3).
const BORDER_LIGHT = -0.13;
const LIMIT_LIGHT = 0.13;
const SEA_BORDER_BLUE: Rgb = [52, 96, 150];
const SEA_BORDER_BLUE_PART = 0.75;
const DARK_SAT = 0.05;
const DARK_LIGHT = -0.25;
const DARK_LIGHT_MIN = 0.15;
const UNIT_SAT = 0.5;
const UNIT_LIGHT_MIN = 0.28;
const UNIT_LIGHT_MAX = 0.58;
const UNIT_DARK = -0.14;
const UNIT_BRIGHT = 0.16;

function hsl(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export const rgbCss = (c: Rgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;

if (PLAYER_COLORS.length !== PLAYER_COLOR_COUNT) throw new Error("PLAYER_COLORS et PLAYER_COLOR_COUNT diffèrent");

let roster: readonly number[] = [];

/** Couleurs de la partie en cours, `colors[id - 1]` (`InitMessage.playerColors`). */
export function setPlayerColors(colors: readonly number[]): void {
  roster = colors;
}

/** Indice dans `PLAYER_COLORS` du joueur `player`. Sans partie en cours : calculé depuis son identifiant. */
export const playerColorIndex = (player: number): number => roster[player - 1] ?? (player * 3) % PLAYER_COLORS.length;

const entryOf = (player: number): PlayerColorEntry => PLAYER_COLORS[playerColorIndex(player)]!;

/** Couleur de carte de l'entrée `index` de `PLAYER_COLORS`. */
export function mapColor(index: number): Rgb {
  const c = PLAYER_COLORS[index]!;
  return hsl(c.hue, c.sat, c.light);
}

/** Couleur de carte d'un joueur, aussi celle des pastilles de l'interface. */
export const playerColor = (player: number): Rgb => mapColor(playerColorIndex(player));

/** Version foncée, pour les villes et les routes. */
export function playerDark(player: number): Rgb {
  const c = entryOf(player);
  return hsl(c.hue, Math.min(1, c.sat + DARK_SAT), Math.max(DARK_LIGHT_MIN, c.light + DARK_LIGHT));
}

/** Couleur de frontière d'un joueur : sa teinte, plus sombre que `playerColor`. */
export function playerBorder(player: number): Rgb {
  const c = entryOf(player);
  return hsl(c.hue, c.sat, c.light + BORDER_LIGHT);
}
/** Ton du trait entre deux zones de pêche : la frontière du joueur, tirée vers le bleu. */
export function playerSeaBorder(player: number): Rgb {
  const b = playerBorder(player);
  const mix = (i: 0 | 1 | 2): number => Math.round(b[i] * (1 - SEA_BORDER_BLUE_PART) + SEA_BORDER_BLUE[i] * SEA_BORDER_BLUE_PART);
  return [mix(0), mix(1), mix(2)];
}

/** Couleur de limite entre deux villes d'un même joueur : sa teinte, plus claire que `playerColor`. */
export function playerLimit(player: number): Rgb {
  const c = entryOf(player);
  return hsl(c.hue, c.sat, c.light + LIMIT_LIGHT);
}

/** Couleur du joueur telle que la carte la montre sur un sol de mi-altitude : barres de front de l'onglet Forces. */
export function playerOnLand(player: number): Rgb {
  const c = playerColor(player);
  const mix = (i: 0 | 1 | 2): number => Math.round(LAND_MID[i] * (1 - TERRITORY_ALPHA) + c[i] * TERRITORY_ALPHA);
  return [mix(0), mix(1), mix(2)];
}

/** Tons d'unité de l'entrée `index` de `PLAYER_COLORS` : foncé, moyen, clair. */
export function unitTones(index: number): readonly [Rgb, Rgb, Rgb] {
  const c = PLAYER_COLORS[index]!;
  const sat = c.sat * UNIT_SAT;
  const light = Math.min(UNIT_LIGHT_MAX, Math.max(UNIT_LIGHT_MIN, c.light));
  return [hsl(c.hue, sat, light + UNIT_DARK), hsl(c.hue, sat, light), hsl(c.hue, sat, light + UNIT_BRIGHT)];
}
