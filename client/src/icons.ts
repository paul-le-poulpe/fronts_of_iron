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

/** Icône d'un bien ou d'un type d'armement, ou son symbole texte s'il n'en a pas. */
export function productIcon(id: string): HTMLElement {
  const path = icons[id];
  if (path === undefined) {
    const s = document.createElement("span");
    s.className = "sym";
    s.textContent = productSymbol(id);
    return s;
  }
  const img = document.createElement("img");
  img.className = "ib-img";
  img.src = `icons/${path}`;
  img.alt = productName(id);
  return img;
}
