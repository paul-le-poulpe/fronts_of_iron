// Icônes d'unités aux couleurs de leur propriétaire (Docs/Design/09-Couleurs.md §4). Les PNG de
// `public/icons/units-generated/` portent trois couleurs de remplacement : `preloadUnitIcons` lit leurs pixels une
// fois, `unitIconUrl` y met les tons du joueur et garde le résultat par icône et par couleur.

import { icon32Path } from "./icons.ts";
import { playerColorIndex, type Rgb, unitTones } from "./playercolors.ts";

/** Fichiers de `units-generated/` : la liste `FILES` de `client/scripts/unit-icons.ts`. */
const UNIT_ICON_FILES = [
  "armament-AA-32.png",
  "armament-AA-gun.png",
  "armament-AT-32.png",
  "armament-AT-gun.png",
  "armament-artillery-32.png",
  "armament-artillery.png",
  "armament-tankette.png",
  "icon-armament-SPAA-32.png",
  "icon-armament-armored-AT-32.png",
  "icon-armament-armored-SPART-32.png",
  "icon-armament-cruiser-tank-32.png",
  "icon-armament-infantry-tank-32.png",
  "icon-armament-medium-tank-32.png",
  "icon-armament-tankette-32.png",
  "icon-inf-elite.png",
  "icon-inf-milicia.png",
  "icon-inf-regulars.png",
] as const;

/** Couleurs de remplacement des PNG, dans l'ordre des tons (`PLACEHOLDERS` du script). */
const PLACEHOLDERS: readonly Rgb[] = [
  [255, 0, 255],
  [0, 255, 255],
  [0, 255, 0],
];

/** Met dans `data` (RGBA) les tons `tones` à la place des couleurs de remplacement. */
export function recolorPixels(data: Uint8ClampedArray, tones: readonly [Rgb, Rgb, Rgb]): void {
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < PLACEHOLDERS.length; k++) {
      const p = PLACEHOLDERS[k]!;
      if (data[i] !== p[0] || data[i + 1] !== p[1] || data[i + 2] !== p[2]) continue;
      const tone = tones[k]!;
      data[i] = tone[0];
      data[i + 1] = tone[1];
      data[i + 2] = tone[2];
      break;
    }
  }
}

/** Pixels de chaque PNG lu, par nom de fichier. */
const pixels = new Map<string, ImageData>();
/** Chaque icône déjà colorée, par `fichier|indice de couleur`. */
const colored = new Map<string, HTMLCanvasElement>();
/** URL de chaque icône déjà colorée, même clé. */
const urls = new Map<string, string>();

function read(file: string, image: HTMLImageElement): void {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  pixels.set(file, ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/** Lit les PNG au chargement de la page. Une icône demandée avant la fin de sa lecture reste verte (`colorIconUrl`). */
export async function preloadUnitIcons(): Promise<void> {
  await Promise.all(
    UNIT_ICON_FILES.map(
      (file) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => {
            read(file, image);
            resolve();
          };
          image.onerror = () => resolve();
          image.src = `icons/units-generated/${file}`;
        }),
    ),
  );
}

/** Icône `path` aux couleurs de `player` (`colorIconUrl`). */
export const unitIconUrl = (path: string, player: number, size: 16 | 32 = 32): string => colorIconUrl(path, playerColorIndex(player), size);

/**
 * URL de l'icône `path` (chemin sous `public/icons/`, `icon` d'un type de division) dans la couleur `index` de
 * `PLAYER_COLORS`. `size` 32 : la version 32 × 32 si elle existe. L'icône d'origine si ses pixels ne sont pas lus.
 */
export function colorIconUrl(path: string, index: number, size: 16 | 32 = 32): string {
  const shown = size === 32 ? icon32Path(path) : path;
  const key = `${shown}|${index}`;
  const known = urls.get(key);
  if (known !== undefined) return known;
  const canvas = coloredCanvas(shown, index);
  if (canvas === null) return `icons/${shown}`;
  const url = canvas.toDataURL("image/png");
  urls.set(key, url);
  return url;
}

/** L'icône `shown` dans la couleur `index`, ou `null` si ses pixels ne sont pas lus. */
function coloredCanvas(shown: string, index: number): HTMLCanvasElement | null {
  const key = `${shown}|${index}`;
  const known = colored.get(key);
  if (known !== undefined) return known;
  const data = pixels.get(shown.slice(shown.lastIndexOf("/") + 1));
  if (data === undefined) return null;
  const copy = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  recolorPixels(copy.data, unitTones(index));
  const canvas = document.createElement("canvas");
  canvas.width = copy.width;
  canvas.height = copy.height;
  canvas.getContext("2d")!.putImageData(copy, 0, 0);
  colored.set(key, canvas);
  return canvas;
}

/** Version 32 × 32 de l'icône `path` aux couleurs de `player`, à dessiner sur un canvas ; `null` si ses pixels ne sont pas lus. */
export const unitIconCanvas = (path: string, player: number): HTMLCanvasElement | null => coloredCanvas(icon32Path(path), playerColorIndex(player));
