// Une icône et un nombre (05-Fronts §11.2, §11.4) : les sections de front de l'onglet des forces et les zones
// comprimées de l'adversaire montrent, par niche, l'icône d'un type et le nombre total de divisions de la niche.
// Pas de DOM hors de la fonction ; aucune règle.

import { type DivisionView, type MilitaryCatalog } from "./protocol.ts";
import { unitIconUrl } from "./uniticons.ts";

/**
 * `divisions` : celles d'une niche (non vide). L'icône est celle du type le plus nombreux (`"most"`, onglet des
 * forces) ou du premier type rencontré (`"first"`, zones comprimées de l'adversaire) ; le nombre est le total de
 * la niche, quel que soit le type.
 */
export function countTag(military: MilitaryCatalog, divisions: readonly DivisionView[], pick: "most" | "first"): HTMLElement {
  const counts = new Map<number, number>();
  for (const d of divisions) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  let type = divisions[0]!.type;
  if (pick === "most") {
    for (const [t, n] of [...counts].sort((a, b) => a[0] - b[0])) if (n > (counts.get(type) ?? 0)) type = t;
  }
  const tag = document.createElement("div");
  tag.className = "ct";
  const img = document.createElement("img");
  img.className = "ct-icon";
  img.src = unitIconUrl(military.divisions[type]!.icon, divisions[0]!.owner);
  img.alt = "";
  img.draggable = false;
  const n = document.createElement("span");
  n.className = "ct-num";
  n.textContent = String(divisions.length);
  tag.append(img, n);
  return tag;
}
