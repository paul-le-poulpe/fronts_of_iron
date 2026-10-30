// Icônes des biens et de l'armement. Le chemin de chaque icône vient de la
// configuration du moteur (`icon` dans config/goods.ts), envoyé une fois dans le
// catalogue ; sans icône, la page garde le symbole texte provisoire (names.ts).

import { productName, productSymbol } from "./names.ts";

let icons: Readonly<Record<string, string>> = {};

/** Catalogue de la partie (avant la construction des panneaux). */
export function setProductIcons(paths: Readonly<Record<string, string>>): void {
  icons = paths;
}

/** Chemin de l'icône sous `public/icons/`, ou `undefined`. */
export const productIconPath = (id: string): string | undefined => icons[id];

/**
 * Icônes qui existent aussi dessinées en 32 × 32 (chemin 16 → chemin 32). Les autres sont
 * affichées en 32 px à partir du fichier 16 × 16, agrandi sans lissage (`.ib-img.big`).
 */
const ICONS_32: Readonly<Record<string, string>> = {
  "armament/armament-AA-gun.png": "armament/armament-AA-32.png",
  "armament/armament-AT-gun.png": "armament/armament-AT-32.png",
  "armament/armament-artillery.png": "armament/armament-artillery-32.png",
};

/** Chemin de l'icône à afficher en 32 px : la version 32 × 32 si elle existe, sinon la 16 × 16. */
export const icon32Path = (path: string): string => ICONS_32[path] ?? path;

/**
 * Icône d'un bien ou d'un type d'armement, ou son symbole texte s'il n'en a pas.
 * `size` 16 : barres du haut, infobulles ; 32 : interface des usines (arbres, production).
 */
export function productIcon(id: string, size: 16 | 32 = 16): HTMLElement {
  const path = icons[id];
  if (path === undefined) {
    const s = document.createElement("span");
    s.className = "sym";
    s.textContent = productSymbol(id);
    return s;
  }
  const img = document.createElement("img");
  img.className = size === 32 ? "ib-img big" : "ib-img";
  img.src = `icons/${size === 32 ? icon32Path(path) : path}`;
  img.alt = productName(id);
  return img;
}
