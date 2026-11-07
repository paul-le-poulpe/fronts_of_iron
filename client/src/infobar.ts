// Barre d'informations en haut de l'écran (00-Game §11) : trois sections. Le survol d'un
// bouton déplie son détail sous la barre ; la souris sortie du bouton et du détail le
// replie (après `CLOSE_DELAY_MS`, le temps de passer de l'un à l'autre). Un seul détail
// ouvert à la fois ; chaque ouverture appelle `onOpen`. La page n'applique aucune règle : elle affiche des nombres du moteur
// (HumanDetail, PlayerStats) et en tire quelques rapports (parts, écarts). Les onglets Population, Nourriture et Armement
// n'existent plus (08 §11) : la population est dans l'en-tête du panneau de production.
//
// Chaque bouton porte, sous ses chiffres, la barre la plus pertinente de son détail
// (mini-barre, mise à jour par `head` à chaque tour, détail ouvert ou non) : le fer.
//
// Le DOM est construit une seule fois, dans le constructeur. Ensuite `update`
// écrit seulement des textes et des largeurs : rien n'est détruit entre deux tours.
// Seuls la barre et le détail ouvert sont mis à jour ; un détail replié est remis à
// jour à son ouverture.
//
// La première section est l'onglet Ressources (flux), branché sur le fer ; la
// deuxième, l'onglet des forces (05-Fronts §11.2, `forcestab.ts`) ; la troisième, l'onglet Diplomatie
// (`diplomacytab.ts`). La barre ne fait que poser le détail des deux dernières.
//
// Le dernier élément de la barre, contre le bord droit, est le bouton « Carte » : il
// ouvre, au survol comme les sections, un menu de cases à cocher (vues de la carte). Le menu est un enfant de la
// racine, comme les détails (la barre a `overflow` et le couperait). Les cases ne
// changent rien ici : elles appellent le rappel `onMapOption`.
//
// Chaque nombre a une infobulle (`title`) qui nomme ses valeurs dans l'ordre où
// elles sont écrites, avec les mêmes séparateurs : « Réservé / produit ».

import { type DiplomacyTab } from "./diplomacytab.ts";
import { type ForcesTab } from "./forcestab.ts";
import { activityName } from "./names.ts";
import { type HumanDetail, type PlayerStats } from "./protocol.ts";
import { num } from "./format.ts";
import { setTip } from "./tooltip.ts";

/** Part de `x` dans `total`, en pourcentage de largeur, bornée à 0…100. */
const pct = (x: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (100 * x) / total)) : 0);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

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

/** Place un segment de barre : de `from` % à `to` % de la largeur. */
function span(seg: HTMLElement, from: number, to: number): void {
  seg.style.left = `${from}%`;
  seg.style.width = `${Math.max(0, to - from)}%`;
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

/** Libellé précédé d'une icône dessinée, alignés comme dans les lignes du détail. */
function iconLabel(path: string, text: string, ...after: HTMLElement[]): HTMLElement {
  const l = el("span", "ib-iconlabel");
  l.append(icon(path), text, ...after);
  return l;
}

/** Camembert : l'infobulle de la répartition d'une ressource entre les produits qui la consomment. */
function pieIcon(): HTMLImageElement {
  const pie = icon("miscellaneous/icon-pie-chart.png");
  pie.classList.add("ib-gear");
  pie.dataset.tuto = "pie";
  return pie;
}

function legendItem(className: string, text: string): HTMLElement {
  const item = el("span", "ib-legend-item");
  item.append(el("span", `ib-key ${className}`), document.createTextNode(text));
  return item;
}

/** Options de vue de la carte du menu « Carte » (00-Game §11). */
export type MapOption = "iron" | "playerColor" | "fertility" | "frontZones";

/** Options du menu, dans l'ordre d'affichage, avec l'état de leur case en début de partie. */
export const MAP_OPTIONS: readonly { readonly id: MapOption; readonly label: string; readonly initial: boolean }[] = [
  { id: "iron", label: "Ressources naturelles", initial: false },
  { id: "playerColor", label: "Couleur des joueurs", initial: true },
  { id: "fertility", label: "Fertilité", initial: false },
  { id: "frontZones", label: "Zones de front", initial: true },
];

interface Section {
  readonly button: HTMLButtonElement;
  readonly pane: HTMLElement;
  /** Textes de la barre : mis à jour à chaque tour. */
  readonly head: (d: HumanDetail, s: PlayerStats) => void;
  /** Contenu du détail : mis à jour seulement s'il est ouvert. */
  readonly body: (d: HumanDetail, s: PlayerStats) => void;
  /** Appelé quand le détail se replie. */
  readonly collapsed?: () => void;
  /** Vrai pendant un geste commencé dans le détail (glisser, curseur) : la sortie de la souris ne le replie pas encore. */
  readonly busy?: () => boolean;
}

/** Délai entre la sortie de la souris (bouton et détail) et le repli du détail, en ms. */
const CLOSE_DELAY_MS = 200;

export class InfoBar {
  /** Appelé à chaque ouverture d'un détail (main.ts : désarme « Créer une ville »). */
  onOpen: (() => void) | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly sections: Section[];
  private open = -1;
  private readonly mapButton: HTMLButtonElement;
  private readonly mapMenu: HTMLElement;
  /** Menu « Options », au-dessus du panneau de production (08 §11). */
  private readonly optionsButton: HTMLButtonElement;
  private readonly optionsMenu: HTMLElement;
  private readonly optionsHint: HTMLElement;
  /** Le message attend l'ouverture du menu « Options », qui clignote en attendant. */
  private hintPending = false;
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;
  private readonly forcesTab: ForcesTab;
  /** Position de l'onglet des forces dans `sections`. */
  private readonly forcesIndex: number;
  /**
   * `onMapOption` est appelé à chaque case du menu « Carte » cochée ou décochée ;
   * `forces`, l'onglet des forces (deuxième section) ; `diplomacy`, l'onglet Diplomatie (troisième section) ;
   * `productionOptions`, le contenu du menu « Options ».
   */
  constructor(
    root: HTMLElement,
    onMapOption: (option: MapOption, checked: boolean) => void,
    forces: ForcesTab,
    diplomacy: DiplomacyTab,
    productionOptions: HTMLElement,
  ) {
    this.root = root;
    this.forcesTab = forces;
    this.bar = el("div", "ib-bar");
    this.sections = [this.flows(), this.forcesSection(forces), this.diplomacySection(diplomacy)];
    this.forcesIndex = 1;
    root.replaceChildren(this.bar);
    this.sections.forEach((s, i) => {
      s.pane.hidden = true;
      // Le survol ouvre ; le clic aussi (clavier). Sortir du bouton et du détail replie.
      s.button.addEventListener("pointerenter", () => {
        this.cancelClose();
        this.show(i);
      });
      s.button.addEventListener("click", () => this.show(i));
      for (const e of [s.button, s.pane]) e.addEventListener("pointerleave", () => this.scheduleClose());
      s.pane.addEventListener("pointerenter", () => this.cancelClose());
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
    // Comme les sections : le survol (ou le clic) ouvre, sortir du bouton et du menu ferme.
    this.mapButton.addEventListener("pointerenter", () => {
      this.cancelClose();
      this.openMenu();
    });
    this.mapButton.addEventListener("click", () => this.openMenu());
    for (const e of [this.mapButton, this.mapMenu]) e.addEventListener("pointerleave", () => this.scheduleClose());
    this.mapMenu.addEventListener("pointerenter", () => this.cancelClose());
    this.bar.append(this.mapButton);
    root.append(this.mapMenu);

    // Menu « Options » : même fonctionnement que « Carte », au-dessus du panneau de production.
    this.optionsButton = el("button", "ib-sec ib-options");
    this.optionsButton.type = "button";
    this.optionsButton.setAttribute("aria-expanded", "false");
    this.optionsButton.setAttribute("aria-controls", "ib-options-menu");
    this.optionsButton.append(el("span", "ib-name", "Options"), el("span", "ib-chev"));
    this.optionsMenu = el("div", "menu ib-menu ib-options-menu");
    this.optionsMenu.id = "ib-options-menu";
    this.optionsMenu.hidden = true;
    this.optionsMenu.append(productionOptions);
    this.optionsButton.addEventListener("pointerenter", () => {
      this.cancelClose();
      this.openOptions();
    });
    this.optionsButton.addEventListener("click", () => this.openOptions());
    for (const e of [this.optionsButton, this.optionsMenu]) e.addEventListener("pointerleave", () => this.scheduleClose());
    this.optionsMenu.addEventListener("pointerenter", () => this.cancelClose());
    this.bar.append(this.optionsButton);
    this.optionsHint = el("div", "ib-hint", "Les icônes sont passées en petit. Vous pouvez changer leur taille dans ce menu.");
    this.optionsHint.hidden = true;
    root.append(this.optionsMenu, this.optionsHint);
  }

  /** Ferme les menus « Carte » et « Options » (sans effet s'ils sont fermés). */
  closeMenu(): void {
    this.mapMenu.hidden = true;
    this.mapButton.setAttribute("aria-expanded", "false");
    this.optionsMenu.hidden = true;
    this.optionsHint.hidden = true;
    this.optionsButton.setAttribute("aria-expanded", "false");
  }

  /** Vrai si la cible d'un clic est un bouton « Carte » ou « Options », ou son menu. */
  inMenu(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return [this.mapButton, this.mapMenu, this.optionsButton, this.optionsMenu].some((e) => e.contains(target));
  }

  /** Ouvre le menu « Carte » (sans effet s'il est ouvert) et appelle `onOpen`. */
  private openMenu(): void {
    if (!this.mapMenu.hidden) return;
    this.closeMenu();
    this.collapse();
    this.mapMenu.hidden = false;
    this.mapButton.setAttribute("aria-expanded", "true");
    this.onOpen?.();
  }

  /** Fait clignoter « Options » ; à son ouverture, le message apparaît à côté du menu (08 §11). */
  showOptionsHint(): void {
    this.hintPending = true;
    this.optionsButton.classList.add("ib-attn");
  }

  /** Ouvre le menu « Options » (sans effet s'il est ouvert) et appelle `onOpen`. */
  private openOptions(): void {
    if (!this.optionsMenu.hidden) return;
    this.optionsHint.hidden = !this.hintPending;
    this.hintPending = false;
    this.optionsButton.classList.remove("ib-attn");
    const hint = this.optionsHint.hidden;
    this.closeMenu();
    this.optionsHint.hidden = hint;
    this.collapse();
    this.optionsMenu.hidden = false;
    this.optionsButton.setAttribute("aria-expanded", "true");
    this.onOpen?.();
  }

  /** Replie le détail ouvert et ferme le menu « Carte ». */
  closeAll(): void {
    this.closeMenu();
    this.collapse();
  }

  /** Ouvre le détail de l'onglet des forces (bouton « ← Retour » de la fenêtre d'un front). */
  openForces(): void {
    this.show(this.forcesIndex);
  }

  /** Ouvre le détail Ressources (flux) : clic sur la ligne du fer de l'en-tête du panneau de production. */
  openTab(_tab: "resources"): void {
    this.closeMenu();
    this.show(0);
  }

  /** Replie le détail ouvert, s'il y en a un. */
  private collapse(): void {
    for (const s of this.sections) s.collapsed?.();
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

  /** Ouvre le détail `index` (sans effet s'il est déjà ouvert) et appelle `onOpen`. */
  private show(index: number): void {
    if (this.open === index) return;
    this.closeMenu();
    this.collapse();
    this.open = index;
    const section = this.sections[index]!;
    section.pane.hidden = false;
    section.button.setAttribute("aria-expanded", "true");
    this.place();
    if (this.last) this.sections[this.open]!.body(this.last.detail, this.last.stats);
    this.onOpen?.();
  }

  private cancelClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  /**
   * Replie le détail ouvert, ou ferme le menu « Carte », après `CLOSE_DELAY_MS`, sauf si la souris revient ; pendant
   * un geste (`busy`), attend sa fin.
   */
  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined;
      this.closeMenu();
      if (this.open < 0) return;
      if (this.sections[this.open]!.busy?.() === true) this.scheduleClose();
      else this.collapse();
    }, CLOSE_DELAY_MS);
  }

  /**
   * Aligne le détail ouvert sur le bord gauche de sa section, sans le laisser sortir de la carte : sa butée à droite
   * est le bord gauche du panneau de debug et du panneau de production, quand ils sont ouverts. À rappeler quand l'un
   * ou l'autre s'ouvre ou se ferme.
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
    b.dataset.tuto = `tab-${id}`;
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

  // ---- 1. Ressources (flux) ----

  private flows(): Section {
    // Mini-barre : le fer, la ressource dont dépend la production (même barre que dans le détail).
    const miniIron = track("flow");
    miniIron.root.classList.add("iron");
    const button = this.button("flow", [el("span", "ib-icon", "⇄"), el("span", "ib-name", "Ressources (flux)")], miniIron.root);

    const iron = track("flow");
    iron.root.classList.add("iron");
    const ironValue = el("span", "ib-value");
    ironValue.title = "Réservé / produit";
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

    const legend = el("p", "ib-legend");
    legend.append(
      legendItem("flow", "fer réservé"),
      legendItem("front", "fer produit"),
    );
    const pane = this.pane(
      "flow",
      el("h3", undefined, "Ressources (flux)"),
      ironRow,
      aluminiumRow,
      legend,
    );
    iron.root.title = "Orange : fer réservé par les usines et les casernes servies · orange clair : fer produit par les mineurs";
    /** Fer, à l'échelle du fer produit : orange clair jusqu'au produit, orange jusqu'au réservé (08 §4). */
    const ironSpans = (t: Track, d: HumanDetail): void => {
      const scale = Math.max(d.ironProduced, d.ironReserved);
      span(t.deployed, 0, pct(d.ironProduced, scale));
      span(t.fill, 0, pct(d.ironReserved, scale));
      span(t.gap, 0, 0);
      t.mark.hidden = true;
    };

    return {
      button,
      pane,
      head: (d) => ironSpans(miniIron, d),
      body: (d, s) => {
        latest = { d, s };
        ironSpans(iron, d);
        ironValue.textContent = `${num(d.ironReserved)} / ${num(d.ironProduced)}`;
      },
    };
  }

  // ---- 2. Forces (05-Fronts §11.2) ----

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
      collapsed: () => tab.collapsed(),
      busy: () => tab.isDragging,
    };
  }

  // ---- 3. Diplomatie ----

  private diplomacySection(tab: DiplomacyTab): Section {
    const button = this.button("diplomacy", [el("span", "ib-name", "Diplomatie")]);
    button.title = "Joueurs de la partie";
    const pane = this.pane("diplomacy", tab.content);
    return {
      button,
      pane,
      // Les lignes sont mises à jour à chaque tour par main.ts (elles lisent tous les joueurs, pas seulement le joueur local).
      head: () => {},
      body: () => {},
      collapsed: () => tab.collapsed(),
    };
  }

  /**
   * Infobulle du camembert du fer : fer produit et fer réservé, puis une rangée par activité qui réserve du fer, de la
   * plus grosse à la plus petite (08 §4). Barres à la même échelle (la plus grosse occupe toute la largeur).
   */
  private ironTip(d: HumanDetail | null, _s: PlayerStats | null): Node {
    const box = el("div");
    if (d === null) return box;
    box.append(el("h4", undefined, `Fer réservé ${num(d.ironReserved)} · produit ${num(d.ironProduced)}`));
    const rows = d.activities.filter((a) => a.ironUsed > 0).sort((a, b) => b.ironUsed - a.ironUsed);
    const biggest = rows.length === 0 ? 1 : rows[0]!.ironUsed;
    const grid = el("div", "tip-iron");
    for (const a of rows) {
      const bar = el("div", "tip-ibar");
      const got = el("i", "obt");
      got.style.width = `${(a.ironUsed * 100) / biggest}%`;
      bar.append(got);
      grid.append(el("span", undefined, activityName(a.id)), bar, el("span", undefined, num(a.ironUsed)));
    }
    box.append(grid);
    return box;
  }
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
