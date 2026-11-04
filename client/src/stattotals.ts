// Les trois totaux de combat d'un camp (attaque anti-infanterie, attaque anti-armure, PV) : icône, nombre, barre
// (05-Fronts §11.4). Le même affichage sert à la fenêtre d'un front et au replay d'un combat (06-Combat-Simplifie §2).
// Aucune règle : les valeurs viennent de l'appelant.

import { STAT_KINDS, formatStat, type StatKind, type Stats } from "./frontstats.ts";

/** Icône (16 × 16 px, sous `public/icons/miscellaneous/`) et texte de survol de chaque statistique de combat. */
export const STAT_ICON: Readonly<Record<StatKind, string>> = {
  soft: "icons/miscellaneous/icon-soft-attack.png",
  hard: "icons/miscellaneous/icon-hard-attack.png",
  hp: "icons/miscellaneous/icon-health.png",
};
export const STAT_TITLE: Readonly<Record<StatKind, string>> = {
  soft: "Attaque anti-infanterie",
  hard: "Attaque anti-armure",
  hp: "Points de vie (niches principales)",
};

/** Une icône de statistique. */
export function statIcon(kind: StatKind): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "fw-st-icon";
  img.src = STAT_ICON[kind];
  img.alt = "";
  img.draggable = false;
  return img;
}

export interface Totals {
  readonly root: HTMLElement;
  readonly nums: HTMLElement[];
  readonly fills: HTMLElement[];
}

/** Les trois lignes de totaux d'un camp (`side` : du joueur, barre vers la droite ; de l'adversaire, vers la gauche). */
export function statTotals(side: "ours" | "theirs"): Totals {
  const root = document.createElement("div");
  root.className = `fw-tots ${side}`;
  const nums: HTMLElement[] = [];
  const fills: HTMLElement[] = [];
  for (const kind of STAT_KINDS) {
    const line = document.createElement("div");
    line.className = `fw-tot ${kind}`;
    line.title = STAT_TITLE[kind];
    const num = document.createElement("span");
    num.className = "fw-tot-num";
    num.textContent = "0";
    const track = document.createElement("span");
    track.className = "fw-tot-track";
    const fill = document.createElement("span");
    fill.className = "fw-tot-fill";
    track.append(fill);
    line.append(statIcon(kind), num, track);
    root.append(line);
    nums.push(num);
    fills.push(fill);
  }
  return { root, nums, fills };
}

/**
 * Remplit les totaux d'un camp. Les deux attaques ont la même échelle : la plus grande des quatre valeurs (deux
 * attaques, deux camps) remplit la barre. Les PV ont la leur.
 */
export function drawTotals(tots: Totals, own: Stats, other: Stats): void {
  const attackMax = Math.max(own.soft, own.hard, other.soft, other.hard);
  STAT_KINDS.forEach((kind, k) => {
    const v = own[kind];
    const max = kind === "hp" ? Math.max(v, other.hp) : attackMax;
    tots.nums[k]!.textContent = formatStat(v);
    tots.fills[k]!.style.width = max > 0 ? `${(100 * v) / max}%` : "0";
  });
}
