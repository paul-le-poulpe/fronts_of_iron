// Barre d'informations en haut de l'écran (00-Game §11) : quatre sections, un clic
// déplie le détail sous la barre, un second clic le replie, un seul détail ouvert
// à la fois. La page n'applique aucune règle : elle affiche des nombres du moteur
// (HumanDetail, PlayerStats) et en tire quelques rapports (parts, écarts).
//
// Chaque bouton porte, sous ses chiffres, la barre la plus pertinente de son détail
// (mini-barre, mise à jour par `head` à chaque tour, détail ouvert ou non) : répartition
// de la population, population et capacité, fer, armement.
//
// Le DOM est construit une seule fois, dans le constructeur. Ensuite `update`
// écrit seulement des textes et des largeurs : rien n'est détruit entre deux tours.
// Seuls la barre et le détail ouvert sont mis à jour ; un détail replié est remis à
// jour à son ouverture.
//
// La cinquième section est l'onglet des forces (05-Fronts §11.2, `forcestab.ts`), juste à droite d'Armement ; la barre
// ne fait que poser son détail.
//
// Le dernier élément de la barre, contre le bord droit, est le bouton « Carte » : il
// ouvre un menu de cases à cocher (vues de la carte). Le menu est un enfant de la
// racine, comme les détails (la barre a `overflow` et le couperait). Les cases ne
// changent rien ici : elles appellent le rappel `onMapOption`.
//
// Chaque nombre a une infobulle (`title`) qui nomme ses valeurs dans l'ordre où
// elles sont écrites, avec les mêmes séparateurs : « Stock / cible · par minute ».

import { type ForcesTab } from "./forcestab.ts";
import { attachGoodTip } from "./goodtips.ts";
import { productIcon } from "./icons.ts";
import { productName } from "./names.ts";
import { type FactoryCatalog, type HumanDetail, type PlayerStats } from "./protocol.ts";
import { num } from "./format.ts";
import { setTip } from "./tooltip.ts";

const signed = (n: number): string => (n > 0 ? "+" : "") + num(n);

/** Part de `x` dans `total`, en pourcentage de largeur, bornée à 0…100. */
const pct = (x: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (100 * x) / total)) : 0);

/**
 * Travailleurs qui manquent pour couvrir `tiles` cases à la mécanisation `milli` (millièmes de case par travailleur) :
 * le requis du moteur (`harvest`), arrondi vers le haut, moins ceux qui travaillent.
 */
const missingWorkers = (tiles: number, milli: number, working: number): number =>
  tiles > 0 && milli > 0 ? Math.max(0, Math.ceil((tiles * 1000) / milli) - working) : 0;

/** Nourriture par travailleur : deux décimales au plus. */
const perHeadFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Pourcentage affiché, une décimale au plus. */
const share = (x: number, total: number): string =>
  total > 0 ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format((100 * x) / total)} %` : "0 %";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Colore un nombre signé : vert au-dessus de 0, rouge en dessous, neutre à 0. */
/**
 * Largeur fixe d'un nombre des onglets du haut, en `ch` : un peu plus que son texte le plus long (`num` : 5 caractères
 * au plus, « 99,9K », 6 avec un signe, 7 avec « / »), pour que l'onglet ne change pas de largeur quand le nombre change.
 * Dans `data-w`, pas dans une classe : `setSigned` remplace les classes.
 */
function fixedWidth<T extends HTMLElement>(e: T, ch: number): T {
  e.dataset["w"] = String(ch);
  e.style.minWidth = `${ch}ch`;
  return e;
}

function setSigned(e: HTMLElement, n: number): void {
  e.textContent = signed(n);
  e.className = n > 0 ? "pos" : n < 0 ? "neg" : "zero";
}

/** Place un segment de barre : de `from` % à `to` % de la largeur. */
function span(seg: HTMLElement, from: number, to: number): void {
  seg.style.left = `${from}%`;
  seg.style.width = `${Math.max(0, to - from)}%`;
}

/** Barre empilée : un segment par valeur, de gauche à droite, en parts de leur somme. */
function stackSpans(parts: readonly HTMLElement[], counts: readonly number[]): void {
  const sum = counts.reduce((a, b) => a + b, 0);
  let from = 0;
  counts.forEach((n, i) => {
    span(parts[i]!, from, from + pct(n, sum));
    from += pct(n, sum);
  });
}

interface Track {
  readonly root: HTMLElement;
  /** Remplissage : vert (flux) ou bleu (stock). */
  readonly fill: HTMLElement;
  /** Écart rouge entre le produit et le requis (flux de fer). */
  readonly gap: HTMLElement;
  /** Trait vertical : production requise (épais, noir) ou stock cible (fin). */
  readonly mark: HTMLElement;
  /** Zone hachurée de rouge (armement, au-delà du stock cible). */
  readonly hatch: HTMLElement;
  /** Équipement sur les fronts, jaune foncé, à gauche du stock (armement, 05-Fronts §11.5). */
  readonly deployed: HTMLElement;
}

function track(kind: "flow" | "stock"): Track {
  const root = el("div", `ib-track ${kind}`);
  const fill = el("i", "ib-fill");
  const gap = el("i", "ib-gap");
  const hatch = el("i", "ib-hatch");
  const mark = el("i", kind === "flow" ? "ib-mark thick" : "ib-mark thin");
  const deployed = el("i", "ib-front");
  mark.hidden = true;
  root.append(deployed, fill, gap, hatch, mark);
  return { root, fill, gap, mark, hatch, deployed };
}

/** Une ligne : étiquette, barre, texte de valeurs. */
function row(label: HTMLElement | string, bar: HTMLElement, value: HTMLElement, className = ""): HTMLElement {
  const r = el("div", `ib-row ${className}`.trim());
  const l = el("span", "ib-label");
  if (typeof label === "string") l.textContent = label;
  else l.append(label);
  r.append(l, bar, value);
  return r;
}

/** Icône dessinée (`public/icons/`), à la taille du texte. */
function icon(path: string): HTMLImageElement {
  const img = el("img", "ib-img");
  img.src = `icons/${path}`;
  img.alt = "";
  return img;
}

/** Libellé précédé d'une icône dessinée, alignés comme dans le détail Population. */
function iconLabel(path: string, text: string, ...after: HTMLElement[]): HTMLElement {
  const l = el("span", "ib-iconlabel");
  l.append(icon(path), text, ...after);
  return l;
}

/** Rendement par travailleur : « 0,9 [nourriture] / [métier] », en remplacement de l'icône seule du métier. */
function yieldLabel(job: string): { readonly root: HTMLElement; readonly value: HTMLElement } {
  const root = el("span", "ib-yield");
  const value = el("span", "ib-yield-num");
  root.append(value, icon("miscellaneous/misc-food-ham.png"), document.createTextNode("/"), icon(`population/${job}.png`));
  return { root, value };
}

/** Engrenage : l'infobulle de la machine qui mécanise un métier (goodtips.ts). */
function gearIcon(machine: string): HTMLImageElement {
  const gear = icon("miscellaneous/misc-gear-stolen.png");
  gear.classList.add("ib-gear");
  attachGoodTip(gear, machine);
  return gear;
}

/** Camembert : l'infobulle de la répartition d'une ressource entre les produits qui la consomment. */
function pieIcon(): HTMLImageElement {
  const pie = icon("miscellaneous/icon-pie-chart.png");
  pie.classList.add("ib-gear");
  return pie;
}

/** Libellé précédé d'un élément déjà construit (ici le rendement par travailleur). */
function labelWith(before: HTMLElement, text: string, ...after: HTMLElement[]): HTMLElement {
  const l = el("span", "ib-iconlabel");
  l.append(before, text, ...after);
  return l;
}

function legendItem(className: string, text: string): HTMLElement {
  const item = el("span", "ib-legend-item");
  item.append(el("span", `ib-key ${className}`), document.createTextNode(text));
  return item;
}

/** Options de vue de la carte du menu « Carte » (00-Game §11). */
export type MapOption = "iron" | "playerColor" | "fertility" | "factories" | "frontZones";

/** Options du menu, dans l'ordre d'affichage, avec l'état de leur case en début de partie. */
export const MAP_OPTIONS: readonly { readonly id: MapOption; readonly label: string; readonly initial: boolean }[] = [
  { id: "iron", label: "Ressources naturelles", initial: false },
  { id: "playerColor", label: "Couleur des joueurs", initial: true },
  { id: "fertility", label: "Fertilité", initial: false },
  { id: "factories", label: "Icônes d'usine", initial: true },
  { id: "frontZones", label: "Zones de front", initial: true },
];

interface Section {
  readonly button: HTMLButtonElement;
  readonly pane: HTMLElement;
  /** Textes de la barre : mis à jour à chaque tour. */
  readonly head: (d: HumanDetail, s: PlayerStats) => void;
  /** Contenu du détail : mis à jour seulement s'il est ouvert. */
  readonly body: (d: HumanDetail, s: PlayerStats) => void;
}

export class InfoBar {
  private readonly root: HTMLElement;
  private readonly catalog: FactoryCatalog;
  private readonly bar: HTMLElement;
  private readonly sections: Section[];
  private open = -1;
  private readonly mapButton: HTMLButtonElement;
  private readonly mapMenu: HTMLElement;
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;
  private readonly onFarmShare: (percent: number) => void;
  private readonly onForcedMobilization: (enabled: boolean) => void;
  private readonly forcesTab: ForcesTab;
  /** Vrai pendant que le joueur tient le curseur de la part de fermiers : les tours n'y touchent pas. */
  private farmSliderActive = false;
  /** Jusqu'à cette heure, la case « mobilisation forcée » n'est pas réécrite par les tours (l'ordre n'est pas encore appliqué). */
  private forcedUntil = 0;

  /**
   * `onMapOption` est appelé à chaque case du menu « Carte » cochée ou décochée ;
   * `onFarmShare`, au relâchement du curseur de la part de fermiers ;
   * `onForcedMobilization`, au changement de l'interrupteur de l'onglet Population ;
   * `forces`, l'onglet des forces (cinquième section).
   */
  constructor(
    root: HTMLElement,
    catalog: FactoryCatalog,
    onMapOption: (option: MapOption, checked: boolean) => void,
    onFarmShare: (percent: number) => void,
    onForcedMobilization: (enabled: boolean) => void,
    forces: ForcesTab,
  ) {
    this.root = root;
    this.catalog = catalog;
    this.onFarmShare = onFarmShare;
    this.onForcedMobilization = onForcedMobilization;
    this.forcesTab = forces;
    this.bar = el("div", "ib-bar");
    this.sections = [this.population(), this.food(), this.flows(catalog), this.stocks(catalog), this.forcesSection(forces)];
    root.replaceChildren(this.bar);
    this.sections.forEach((s, i) => {
      s.pane.hidden = true;
      s.button.addEventListener("click", () => this.toggle(i));
      this.bar.append(s.button);
      root.append(s.pane);
    });

    // Menu « Carte » : bouton poussé contre le bord droit de la barre, menu sous le bouton.
    this.mapButton = el("button", "ib-sec ib-map");
    this.mapButton.type = "button";
    this.mapButton.id = "ib-map";
    this.mapButton.setAttribute("aria-expanded", "false");
    this.mapButton.setAttribute("aria-controls", "ib-map-menu");
    this.mapButton.append(el("span", "ib-name", "Carte"), el("span", "ib-chev"));
    this.mapMenu = el("div", "menu ib-menu");
    this.mapMenu.id = "ib-map-menu";
    this.mapMenu.hidden = true;
    for (const o of MAP_OPTIONS) {
      const label = el("label", "ib-check");
      const box = el("input");
      box.type = "checkbox";
      box.checked = o.initial;
      box.addEventListener("change", () => onMapOption(o.id, box.checked));
      label.append(box, document.createTextNode(` ${o.label}`));
      this.mapMenu.append(label);
    }
    this.mapButton.addEventListener("click", () => (this.mapMenu.hidden ? this.openMenu() : this.closeMenu()));
    this.bar.append(this.mapButton);
    root.append(this.mapMenu);
  }

  /** Ferme le menu « Carte » (sans effet s'il est fermé). */
  closeMenu(): void {
    this.mapMenu.hidden = true;
    this.mapButton.setAttribute("aria-expanded", "false");
  }

  /** Vrai si la cible d'un clic est le bouton « Carte » ou son menu. */
  inMenu(target: EventTarget | null): boolean {
    return target instanceof Node && (this.mapButton.contains(target) || this.mapMenu.contains(target));
  }

  private openMenu(): void {
    this.collapse();
    this.mapMenu.hidden = false;
    this.mapButton.setAttribute("aria-expanded", "true");
  }

  /** Replie le détail ouvert et ferme le menu « Carte ». */
  closeAll(): void {
    this.closeMenu();
    this.collapse();
  }

  /** Ouvre le détail de l'onglet des forces (bouton « ← Retour » de la fenêtre d'un front). */
  openForces(): void {
    const index = this.sections.length - 1;
    if (this.open !== index) this.toggle(index);
  }

  /** Replie le détail ouvert, s'il y en a un. */
  private collapse(): void {
    this.forcesTab.collapsed();
    this.open = -1;
    this.sections.forEach((s) => {
      s.pane.hidden = true;
      s.button.setAttribute("aria-expanded", "false");
    });
  }

  /** À appeler à chaque tour. */
  update(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    for (const s of this.sections) s.head(detail, stats);
    if (this.open >= 0) {
      this.sections[this.open]!.body(detail, stats);
      // La largeur suit le texte, qui change d'un tour à l'autre : le détail ne doit pas déborder à droite.
      this.place();
    }
  }

  private toggle(index: number): void {
    this.closeMenu();
    const previous = this.open;
    this.collapse();
    if (index === previous) return;
    this.open = index;
    const section = this.sections[index]!;
    section.pane.hidden = false;
    section.button.setAttribute("aria-expanded", "true");
    this.place();
    if (this.last) this.sections[this.open]!.body(this.last.detail, this.last.stats);
  }

  /**
   * Aligne le détail ouvert sur le bord gauche de sa section, sans le laisser sortir de la carte : sa butée à droite
   * est le bord gauche du panneau latéral et, s'il est ouvert, du panneau de production. À rappeler quand le
   * panneau de production s'ouvre ou se ferme.
   */
  place(): void {
    if (this.open < 0) return;
    const { pane, button } = this.sections[this.open]!;
    const rootBox = this.root.getBoundingClientRect();
    let right = rootBox.right;
    for (const id of ["panel", "prod"]) {
      const e = document.getElementById(id);
      if (!e || e.hidden) continue;
      const left = e.getBoundingClientRect().left;
      // Un panneau passé sous la carte (écran étroit) n'est pas à droite de la barre.
      if (left > rootBox.left + 1) right = Math.min(right, left);
    }
    const available = Math.max(200, right - rootBox.left);
    pane.style.maxWidth = `${available}px`;
    pane.style.left = `${Math.max(0, Math.min(button.offsetLeft, available - pane.offsetWidth))}px`;
  }

  // ---- construction d'une section : bouton + détail ----

  /** Bouton de section : une ligne de chiffres, puis la mini-barre `mini` juste dessous (s'il y en a une). */
  private button(id: string, content: HTMLElement[], mini?: HTMLElement): HTMLButtonElement {
    const b = el("button", "ib-sec");
    b.type = "button";
    b.id = `ib-${id}`;
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", `ib-pane-${id}`);
    const line = el("span", "ib-line");
    line.append(...content, el("span", "ib-chev"));
    b.append(line);
    if (mini) {
      mini.classList.add("ib-mini");
      b.append(mini);
    }
    return b;
  }

  private pane(id: string, ...children: HTMLElement[]): HTMLElement {
    const p = el("section", "ib-pane");
    p.id = `ib-pane-${id}`;
    p.append(...children);
    return p;
  }

  // ---- 1. Population ----

  private population(): Section {
    const total = fixedWidth(el("strong", "ib-num"), 6);
    const delta = fixedWidth(el("span", "zero"), 7);
    const max = fixedWidth(el("span", "muted"), 8);
    // Mini-barre : la répartition par occupation, avec toutes les couleurs du détail.
    const miniStack = el("div", "ib-stack");
    const button = this.button("pop", [icon("population/pop-default.png"), el("span", "ib-name", "Population"), total, delta, max], miniStack);
    button.title = "Population · variation / maximum";

    const occupations = [
      { label: "Ouvriers d'usine", icon: "pop-worker", color: "var(--occ-factory)", read: (s: PlayerStats) => s.factoryWorkers },
      { label: "Mineurs", icon: "pop-miner", color: "var(--occ-mine)", read: (s: PlayerStats) => s.miners, machine: "miningMachine" },
      {
        label: "Fermiers",
        icon: "pop-farmer",
        color: "var(--occ-farm)",
        read: (s: PlayerStats) => s.farmers,
        machine: "tractor",
        missing: (s: PlayerStats) => missingWorkers(s.farmTiles, s.mechanization.tractor ?? 0, s.farmers),
        missingTip: "champs",
      },
      {
        label: "Pêcheurs",
        icon: "pop-fisherman",
        color: "var(--occ-fish)",
        read: (s: PlayerStats) => s.fishers,
        machine: "fishingBoat",
        missing: (s: PlayerStats) => missingWorkers(s.seaTiles, s.mechanization.fishingBoat ?? 0, s.fishers),
        missingTip: "eaux",
      },
      // Par ordre de priorité (05-Fronts §11.5) : les soldats, même en mobilisation forcée, passent après les emplois et avant l'inactivité.
      {
        label: "Soldats",
        icon: "pop-soldier",
        color: "var(--occ-soldier)",
        read: (s: PlayerStats) => s.soldiers,
        tip: "Hommes de vos divisions. Ils mangent mais ne travaillent pas. Une famine ne les retire jamais.",
      },
      { label: "Inactifs", icon: "pop-inactive", color: "var(--occ-idle)", read: (s: PlayerStats) => s.idle },
      // Dernier (00-Game §4.2) : non comptés dans le total affiché, ni dans les parts ; ni emploi ni recrutement.
      {
        label: "Blessés",
        icon: "pop-hurt",
        color: "var(--occ-hurt)",
        read: (s: PlayerStats) => s.hurt,
        tip: "Hommes blessés au combat. Ils mangent et occupent des places de population maximale, mais ne travaillent pas et ne peuvent pas être recrutés. Chaque seconde, un petit nombre disparaît.",
      },
    ];
    const hurtRow = occupations.length - 1;
    const stacked = el("div", "ib-stack");
    const stackParts = (bar: HTMLElement): HTMLElement[] =>
      occupations.map((o) => {
        const part = el("i");
        part.style.background = o.color;
        bar.append(part);
        return part;
      });
    const parts = stackParts(stacked);
    const miniParts = stackParts(miniStack);
    const rows = occupations.map((o) => {
      const r = el("div", "ib-row occ");
      const sw = el("span", "sw");
      sw.style.background = o.color;
      const t = track("flow");
      t.fill.style.background = o.color;
      // Fermiers et pêcheurs : zone hachurée à la suite du remplissage, les personnes qui manquent pour travailler toute la surface.
      const need = el("i", "ib-need");
      need.style.background = `repeating-linear-gradient(45deg, ${o.color} 0 2px, transparent 2px 5px)`;
      t.root.append(need);
      const value = el("span", "ib-value");
      value.title = "Personnes · part";
      const label = el("span", "ib-label");
      label.append(icon(`population/${o.icon}.png`), o.label);
      if (o.tip !== undefined) label.title = o.tip;
      // L'engrenage dit que ce métier se mécanise ; son infobulle est celle de la machine.
      if (o.machine !== undefined) label.append(gearIcon(o.machine));
      r.append(sw, label, t.root, value);
      return { r, fill: t.fill, need, track: t.root, value };
    });
    const note = el("p", "muted small ib-note", "Répartition de la population au début du dernier tour.");
    // Mobilisation forcée (05-Fronts §4.1, §11.5) : interrupteur rouge, éteint par défaut.
    const forcedBox = el("input");
    forcedBox.type = "checkbox";
    const forced = el("label", "ib-forced");
    forced.title = "Les hommes des divisions sont pris avant les emplois (lignes de production, fermiers, pêcheurs), pour remplir les divisions.";
    forced.append(forcedBox, el("span", "ib-switch"), el("span", "ib-forced-text", "MOBILISATION FORCÉE"));
    forcedBox.addEventListener("change", () => {
      this.forcedUntil = Date.now() + 600;
      this.onForcedMobilization(forcedBox.checked);
    });
    const pane = this.pane("pop", el("h3", undefined, "Population par occupation"), stacked, ...rows.map((x) => x.r), forced, note);

    return {
      button,
      pane,
      head: (_d, s) => {
        total.textContent = num(s.population - s.hurt);
        // Croissance du tour : la population d'après (sans les blessés) moins celle du début du tour, somme des occupations.
        setSigned(delta, s.population - s.hurt - (s.factoryWorkers + s.miners + s.farmers + s.fishers + s.idle + s.soldiers));
        max.textContent = `/ ${num(this.info.foodPerHead > 0 ? Math.floor(s.food / this.info.foodPerHead) : 0)}`;
        stackSpans(miniParts, occupations.map((o) => o.read(s)));
      },
      body: (_d, s) => {
        if (Date.now() >= this.forcedUntil) forcedBox.checked = s.forcedMobilization;
        const counts = occupations.map((o) => o.read(s));
        const sum = counts.reduce((a, b) => a + b, 0);
        const missing = occupations.map((o) => o.missing?.(s) ?? 0);
        // Échelle des barres : la population, ou plus large si le hachuré dépasserait la barre (les tailles restent comparables).
        const scale = counts.reduce((m, n, i) => Math.max(m, n + missing[i]!), sum);
        stackSpans(parts, counts);
        counts.forEach((n, i) => {
          const w = pct(n, scale);
          span(rows[i]!.fill, 0, w);
          span(rows[i]!.need, w, w + pct(missing[i]!, scale));
          const job = occupations[i]!.missingTip;
          rows[i]!.track.title =
            job === undefined ? "" : `Hachuré : ${num(missing[i]!)} personnes manquent pour travailler 100 % des ${job}, avec la mécanisation actuelle.`;
          rows[i]!.value.textContent = i === hurtRow ? num(n) : `${num(n)} · ${share(n, sum - counts[hurtRow]!)}`;
        });
      },
    };
  }

  // ---- 2. Nourriture ----

  private food(): Section {
    const total = fixedWidth(el("strong", "ib-num"), 6);
    const surplus = fixedWidth(el("span", "zero"), 7);
    // Mini-barre : la même jauge que « Population » du détail (vert, vert hachuré, gris).
    const miniCap = el("div", "ib-track ib-cap");
    const miniNow = el("i", "cap-now");
    const miniFood = el("i", "cap-food");
    const miniLand = el("i", "cap-land");
    const miniHurt = el("i", "cap-hurt");
    miniCap.append(miniLand, miniFood, miniNow, miniHurt);
    const button = this.button("food", [el("span", "ib-name", "Nourriture"), total, el("span", "muted", "/tour"), surplus], miniCap);
    button.title = "Production / tour · surplus";

    // Jauge de population : actuelle (vert), maximum avec la nourriture du tour (vert
    // hachuré), maximum si toutes les terres et eaux étaient travaillées (gris hachuré).
    const capRoot = el("div", "ib-track ib-cap");
    const capNow = el("i", "cap-now");
    const capFood = el("i", "cap-food");
    const capLand = el("i", "cap-land");
    // Les blessés (noir) à gauche, puis le reste de la population (vert) : ils occupent des places du maximum (00-Game §4.2).
    const capHurt = el("i", "cap-hurt");
    capRoot.append(capLand, capFood, capNow, capHurt);
    const capValue = el("span", "ib-value");
    capValue.title = "Actuelle (+ blessés) / nourrie / potentielle";
    capRoot.title = "Noir : blessés · vert : actuelle · hachuré : nourrie · gris : potentielle (toutes cases exploitées)";
    // Production maximale (toute la surface travaillée) : hachures sous le remplissage.
    const wheat = track("flow");
    wheat.root.classList.add("wheat");
    const wheatMax = el("i", "ib-max");
    wheat.root.prepend(wheatMax);
    const wheatValue = el("span", "ib-value");
    wheatValue.title = "Blé · cultivées / cultivables · maximum";
    // Nourriture par travailleur, pour comparer champs et mer selon les machines possédées.
    const wheatPerWorker = yieldLabel("pop-farmer");
    const fishPerWorker = yieldLabel("pop-fisherman");
    const fish = track("flow");
    fish.root.classList.add("fish");
    const fishMax = el("i", "ib-max");
    fish.root.prepend(fishMax);
    const fishValue = el("span", "ib-value");
    fishValue.title = "Poisson · pêchées / pêchables · maximum";
    // Icônes : le métier qui produit la nourriture ; le marin pour le commerce, en attendant une icône à lui.
    const imports = row(iconLabel("population/pop-sailor.png", "Importations"), track("flow").root, el("span", "ib-value", "à venir"), "soon");
    const exports_ = row(iconLabel("population/pop-sailor.png", "Exportations"), track("flow").root, el("span", "ib-value", "à venir"), "soon");
    // Curseur de la part de fermiers (00-Game §4). L'ordre part au relâchement (`change`), pas à chaque mouvement.
    const farmValue = el("span", "ib-value");
    const farmSlider = el("input", "ib-farm-slider");
    farmSlider.type = "range";
    farmSlider.min = "0";
    farmSlider.max = "100";
    farmSlider.step = "1";
    farmSlider.value = "100";
    farmSlider.title = "Part de la population disponible qui va aux champs ; le reste va à la pêche";
    farmSlider.addEventListener("pointerdown", () => (this.farmSliderActive = true));
    // Un clic sans déplacement n'envoie pas `change` : sans ceci, le curseur resterait gelé.
    farmSlider.addEventListener("pointerup", () => (this.farmSliderActive = false));
    farmSlider.addEventListener("pointercancel", () => (this.farmSliderActive = false));
    farmSlider.addEventListener("blur", () => (this.farmSliderActive = false));
    farmSlider.addEventListener("input", () => {
      this.farmSliderActive = true;
      farmSlider.style.setProperty("--p", farmSlider.value);
      farmValue.textContent = `${farmSlider.value} %`;
    });
    farmSlider.addEventListener("change", () => {
      this.farmSliderActive = false;
      this.onFarmShare(Number(farmSlider.value));
    });
    const farmRow = row("Agriculture versus pêche", farmSlider, farmValue, "farm-share");
    const farmNote = el("p", "muted small ib-note");
    const consumption = el("p", "ib-consumption");
    const minimum = el("span");
    const surplusLine = el("span");
    consumption.append(el("strong", undefined, "Consommation"), document.createTextNode(" : "), minimum, document.createTextNode(" · surplus "), surplusLine);
    const pane = this.pane(
      "food",
      el("h3", undefined, "Nourriture produite par tour"),
      row("Population", capRoot, capValue),
      row(labelWith(wheatPerWorker.root, "Agriculture", gearIcon("tractor")), wheat.root, wheatValue),
      row(labelWith(fishPerWorker.root, "Pêche", gearIcon("fishingBoat")), fish.root, fishValue),
      farmRow,
      farmNote,
      imports,
      exports_,
      consumption,
    );
    const surplusOf = (s: PlayerStats): number => s.food - s.population * this.info.foodPerHead;

    return {
      button,
      pane,
      head: (_d, s) => {
        total.textContent = num(s.food);
        setSigned(surplus, surplusOf(s));
        const perHead = this.info.foodPerHead > 0 ? this.info.foodPerHead : 1;
        const maxNow = this.info.foodPerHead > 0 ? Math.floor(s.food / perHead) : 0;
        const maxLand = Math.max(maxNow, Math.floor(s.foodPotential / perHead));
        const scale = Math.max(maxLand, s.population, 1);
        span(miniHurt, 0, pct(s.hurt, scale));
        span(miniNow, pct(s.hurt, scale), pct(s.population, scale));
        span(miniFood, 0, pct(maxNow, scale));
        span(miniLand, 0, pct(maxLand, scale));
      },
      body: (_d, s) => {
        const perHead = this.info.foodPerHead > 0 ? this.info.foodPerHead : 1;
        const maxNow = Math.floor(s.food / perHead);
        const maxLand = Math.max(maxNow, Math.floor(s.foodPotential / perHead));
        const scale = Math.max(maxLand, s.population, 1);
        span(capHurt, 0, pct(s.hurt, scale));
        span(capNow, pct(s.hurt, scale), pct(s.population, scale));
        span(capFood, 0, pct(maxNow, scale));
        span(capLand, 0, pct(maxLand, scale));
        capValue.textContent = `${num(s.population - s.hurt)}${s.hurt > 0 ? ` + ${num(s.hurt)}` : ""} / ${num(maxNow)} / ${num(maxLand)}`;
        // Même échelle pour le blé et le poisson : la plus grande production, atteinte ou possible.
        const foodScale = Math.max(s.wheat, s.fish, s.wheatMax, s.fishMax, 1);
        span(wheat.fill, 0, pct(s.wheat, foodScale));
        span(wheatMax, 0, pct(Math.max(s.wheat, s.wheatMax), foodScale));
        wheatValue.textContent = `${num(s.wheat)} / ${num(s.wheatMax)} · ${num(s.cultivated)} / ${num(s.farmTiles)} cases`;
        span(fish.fill, 0, pct(s.fish, foodScale));
        span(fishMax, 0, pct(Math.max(s.fish, s.fishMax), foodScale));
        fishValue.textContent = `${num(s.fish)} / ${num(s.fishMax)} · ${num(s.fished)} / ${num(s.seaTiles)} cases`;
        // Rendement par travailleur : mécanisation du dernier tour (millièmes de case par travailleur) × production moyenne d'une case.
        const perWorker = (milli: number, max: number, tiles: number): string => (tiles > 0 ? perHeadFmt.format((milli * max) / (1000 * tiles)) : "0");
        wheatPerWorker.value.textContent = perWorker(s.mechanization.tractor ?? 0, s.wheatMax, s.farmTiles);
        fishPerWorker.value.textContent = perWorker(s.mechanization.fishingBoat ?? 0, s.fishMax, s.seaTiles);
        // Infobulle : les deux facteurs du produit, avec leurs valeurs du dernier tour.
        const tip = (job: string, machines: string, milli: number, max: number, tiles: number, perTile: string): string =>
          `Nourriture par ${job} = mécanisation × ${perTile}.\n` +
          `Mécanisation : ${perHeadFmt.format(milli / 1000)} case par ${job} (selon vos ${machines}).\n` +
          `${perTile[0]!.toUpperCase()}${perTile.slice(1)} : ${tiles > 0 ? perHeadFmt.format(max / tiles) : "0"}.`;
        wheatPerWorker.root.title = tip("fermier", "tracteurs", s.mechanization.tractor ?? 0, s.wheatMax, s.farmTiles, "fertilité moyenne d'une case");
        fishPerWorker.root.title = tip("pêcheur", "bateaux de pêche", s.mechanization.fishingBoat ?? 0, s.fishMax, s.seaTiles, "rendement moyen d'une case d'eau");
        if (!this.farmSliderActive) {
          farmSlider.value = String(s.farmPercent);
          farmSlider.style.setProperty("--p", String(s.farmPercent));
          farmValue.textContent = `${s.farmPercent} %`;
        }
        // Report (00-Game §4) : le réglage ne joue que si la population ne suffit pas à tout travailler.
        farmNote.textContent =
          `Pêcheurs : ${100 - s.farmPercent} %. ` +
          (s.seaTiles === 0
            ? "Aucune case d'eau dans vos zones : tout le monde va aux champs."
            : "Si un côté a assez de monde, le surplus va à l'autre ; le réglage ne compte que si la population manque.");
        minimum.textContent = `minimum garanti ${num(this.info.foodMinimum)}`;
        setSigned(surplusLine, surplusOf(s));
      },
    };
  }

  // ---- 3. Ressources (flux) ----

  private flows(catalog: FactoryCatalog): Section {
    // Mini-barre : le fer, la ressource dont dépend la production (même barre que dans le détail).
    const miniIron = track("flow");
    miniIron.root.classList.add("iron");
    const button = this.button("flow", [el("span", "ib-icon", "⇄"), el("span", "ib-name", "Ressources (flux)")], miniIron.root);

    const iron = track("flow");
    iron.root.classList.add("iron");
    const ironValue = el("span", "ib-value");
    ironValue.title = "Extrait / demandé · capacité";
    // Dernières données reçues : l'infobulle du fer les relit à chaque affichage et à chaque tour.
    let latest: { readonly d: HumanDetail; readonly s: PlayerStats } | null = null;
    const ironPie = pieIcon();
    setTip(ironPie, () => this.ironTip(latest?.d ?? null, latest?.s ?? null));
    const ironRow = row(iconLabel("goods/goods-iron-ingot.png", "Fer", ironPie), iron.root, ironValue);
    // Aucune règle n'extrait l'aluminium encore : même ligne grisée que le commerce.
    const aluminiumPie = pieIcon();
    aluminiumPie.classList.add("off");
    setTip(aluminiumPie, () => el("div", undefined, "Aucune consommation"));
    const aluminiumRow = row(iconLabel("goods/goods-aluminium-ingot.png", "Aluminium", aluminiumPie), track("flow").root, el("span", "ib-value", "à venir"), "soon");

    const machines = [
      { good: "tractor", label: "Tracteurs" },
      { good: "fishingBoat", label: "Bateaux de pêche" },
      { good: "miningMachine", label: "Pompes à vapeur" },
    ].map((m) => {
      const t = track("flow");
      const value = el("span", "ib-value");
      value.title = "Possédés / utiles";
      const label = el("span");
      const sym = productIcon(m.good);
      attachGoodTip(sym, m.good);
      label.append(sym, ` ${m.label}`, gearIcon(m.good));
      return { ...m, index: catalog.goodIds.indexOf(m.good), t, value, r: row(label, t.root, value) };
    });

    const legend = el("p", "ib-legend");
    legend.append(
      legendItem("flow", "produit ce tour"),
      legendItem("req", "production requise"),
      legendItem("gap", "demandé, non obtenu"),
    );
    const pane = this.pane(
      "flow",
      el("h3", undefined, "Ressources (flux)"),
      ironRow,
      aluminiumRow,
      ...machines.map((m) => m.r),
      legend,
    );
    iron.root.title = "Barre pleine : capacité · trait noir : demandé";
    /** Fer : orange = consommé, hachures rouges = demandé non obtenu, trait noir = demandé, orange clair (barre pleine) = capacité. */
    const ironSpans = (t: Track, d: HumanDetail, s: PlayerStats): void => {
      const cap = d.ironCapacity;
      const got = s.ironConsumed;
      const need = s.ironDemanded;
      span(t.fill, 0, pct(got, cap));
      span(t.gap, pct(got, cap), got < need ? pct(need, cap) : 0);
      t.mark.style.left = `${pct(need, cap)}%`;
      t.mark.hidden = need === 0;
    };

    return {
      button,
      pane,
      head: (d, s) => ironSpans(miniIron, d, s),
      body: (d, s) => {
        const cap = d.ironCapacity;
        const got = s.ironConsumed;
        const need = s.ironDemanded;
        latest = { d, s };
        ironSpans(iron, d, s);
        ironValue.textContent = `${num(got)} / ${num(need)} · capacité ${num(cap)}`;
        for (const m of machines) {
          const have = m.index >= 0 ? (d.goods[m.index] ?? 0) : 0;
          // Machines d'une mécanisation totale : référence × machines pour 1 000 ÷ 1 000 (00-Game §6.2), calculé par SoloGame.
          const max = s.fullMachines[m.good] ?? 0;
          // Sans travailleur pour s'en servir, les machines produites ne servent à rien :
          // la barre reste vide, mais le nombre produit est affiché.
          span(m.t.fill, 0, max === 0 ? 0 : pct(have, max));
          m.value.textContent = max === 0 && have > 0 ? `${num(have)} produits · inutilisés` : `${num(have)} / ${num(max)}`;
        }
      },
    };
  }

  // ---- 4. Armement (stock) ----

  private stocks(catalog: FactoryCatalog): Section {
    // Mini-barre : tous les types d'armement additionnés, avec les couleurs et l'échelle du détail.
    const miniStock = track("stock");
    miniStock.mark.hidden = false;
    const button = this.button("stock", [el("span", "ib-icon", "▣"), el("span", "ib-name", "Armement (stock)")], miniStock.root);

    const rows = catalog.armamentIds.map((id, index) => {
      const t = track("stock");
      t.mark.hidden = false;
      const value = el("span", "ib-value");
      value.title = "Stock / cible · par minute · sur les fronts";
      // 32 px : les chars n'ont pas d'icône 16 px (icons.ts, `ICONS_32`).
      const label = el("span", "ib-iconlabel");
      label.append(productIcon(id, 32), ` ${capitalize(productName(id))}`);
      return { id, index, t, value, r: row(label, t.root, value) };
    });
    const empty = el("p", "muted", "Aucune ligne d'armement.");
    const legend = el("p", "ib-legend");
    const decay = el("span");
    const hatched = legendItem("hatch", "hachuré : au-delà du stock cible, ");
    hatched.append(decay);
    legend.append(legendItem("front", "sur les fronts"), legendItem("stock", "stock"), legendItem("target", "stock cible"), hatched);
    const pane = this.pane("stock", el("h3", undefined, "Armement (stock)"), ...rows.map((x) => x.r), empty, legend);
    /**
     * De gauche à droite : jaune foncé (fronts), bleu (en stock), hachures rouges (au-dessus du stock cible).
     * Échelle : 1,5 × la cible, ou le total s'il la dépasse davantage, pour que l'excès se voie.
     */
    const stockSpans = (t: Track, stock: number, target: number, onFronts: number): void => {
      const scale = Math.max(Math.floor((target * 3) / 2), stock + onFronts);
      span(t.deployed, 0, pct(onFronts, scale));
      span(t.fill, pct(onFronts, scale), pct(onFronts + stock, scale));
      span(t.hatch, pct(target, scale), 100);
      t.mark.style.left = `${pct(target, scale)}%`;
    };

    return {
      button,
      pane,
      head: (d, s) => {
        let stock = 0;
        let target = 0;
        let onFronts = 0;
        rows.forEach((x) => {
          stock += d.reserve[x.index] ?? 0;
          target += d.reserveMax[x.index] ?? 0;
          onFronts += s.divisionEquipment[x.index] ?? 0;
        });
        stockSpans(miniStock, stock, target, onFronts);
      },
      body: (d, s) => {
        let shown = 0;
        for (const x of rows) {
          const stock = d.reserve[x.index] ?? 0;
          const target = d.reserveMax[x.index] ?? 0;
          // Équipement dans des unités des fronts, déployé et en route : il compte dans le stock (05-Fronts §4.6).
          const onFronts = s.divisionEquipment[x.index] ?? 0;
          x.r.hidden = target === 0 && stock === 0 && onFronts === 0;
          if (x.r.hidden) continue;
          shown++;
          stockSpans(x.t, stock, target, onFronts);
          x.value.textContent = `${num(stock)} / ${num(target)} · +${num(this.production(d, x.id, catalog))} par minute · ${num(onFronts)} sur les fronts`;
        }
        empty.hidden = shown > 0;
        decay.textContent = `${num(this.info.armamentDecayPercent)} % de l'excès disparaît par tour`;
      },
    };
  }

  // ---- 5. Forces (05-Fronts §11.2) ----

  private forcesSection(tab: ForcesTab): Section {
    const count = fixedWidth(el("strong", "ib-num"), 4);
    const button = this.button("forces", [icon("population/pop-soldier.png"), el("span", "ib-name", "Forces"), count]);
    button.title = "Divisions de votre pays";
    const pane = this.pane("forces", tab.content);
    pane.classList.add("themed", "forces");
    return {
      button,
      pane,
      head: () => {
        count.textContent = num(tab.divisionCount);
      },
      body: (d, s) => tab.body(d, s),
    };
  }

  /** Production d'un type d'armement par minute, à une décimale : lignes qui tournent × production par ligne et par heure ÷ 60. */
  private production(d: HumanDetail, id: string, catalog: FactoryCatalog): number {
    let filled = 0;
    for (const f of d.factories) for (const g of f.groups) if (g.good === id) filled += g.running;
    return Math.round((filled * (catalog.productionPerLine[id] ?? 0)) / 6) / 10;
  }

  /**
   * Infobulle du camembert du fer : fer consommé, manquant et malus des lignes, puis une rangée par produit qui demande du
   * fer, du plus gros au plus petit. Barres à la même échelle (le plus grand total demandé occupe toute la largeur) :
   * orange = fer obtenu, hachures rouges = demandé non obtenu.
   */
  private ironTip(d: HumanDetail | null, s: PlayerStats | null): Node {
    const box = el("div");
    if (d === null || s === null) return box;
    const scale = this.catalog.ratioScale;
    const missing = s.ironDemanded - s.ironConsumed;
    const malus = (ratio: number): number => Math.round(((scale - ratio) * 100) / scale);
    box.append(el("h4", undefined, `Fer consommé ${num(s.ironConsumed)} · manquant ${num(missing)} · malus armement ${num(malus(s.armLineRatio))} %${s.goodsLineRatio < scale ? ` · malus biens ${num(malus(s.goodsLineRatio))} %` : ""}`));
    const byGood = new Map<string, { demanded: number; obtained: number }>();
    for (const f of d.factories) {
      for (const g of f.groups) {
        if (g.ironDemanded === 0) continue;
        const sum = byGood.get(g.good) ?? { demanded: 0, obtained: 0 };
        sum.demanded += g.ironDemanded;
        sum.obtained += g.ironObtained;
        byGood.set(g.good, sum);
      }
    }
    const rows = [...byGood].sort((a, b) => b[1].demanded - a[1].demanded);
    const biggest = rows.length === 0 ? 1 : rows[0]![1].demanded;
    const grid = el("div", "tip-iron");
    for (const [good, v] of rows) {
      const bar = el("div", "tip-ibar");
      const got = el("i", "obt");
      got.style.width = `${(v.obtained * 100) / biggest}%`;
      const lack = el("i", "mis");
      lack.style.width = `${((v.demanded - v.obtained) * 100) / biggest}%`;
      bar.append(got, lack);
      grid.append(productIcon(good), bar, el("span", undefined, `${num(v.obtained)} / ${num(v.demanded)}`));
    }
    box.append(grid);
    return box;
  }

  private get info(): FactoryCatalog["economy"] {
    return this.catalog.economy;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
