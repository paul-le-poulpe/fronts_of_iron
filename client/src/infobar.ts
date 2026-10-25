// Barre d'informations en haut de l'écran (00-Game §11) : quatre sections, un clic
// déplie le détail sous la barre, un second clic le replie, un seul détail ouvert
// à la fois. La page n'applique aucune règle : elle affiche des nombres du moteur
// (HumanDetail, PlayerStats) et en tire quelques rapports (parts, écarts).
//
// Le DOM est construit une seule fois, dans le constructeur. Ensuite `update`
// écrit seulement des textes et des largeurs : rien n'est détruit entre deux tours.
// Seuls la barre et le détail ouvert sont mis à jour ; un détail replié est remis à
// jour à son ouverture.
//
// Le dernier élément de la barre, contre le bord droit, est le bouton « Carte » : il
// ouvre un menu de cases à cocher (vues de la carte). Le menu est un enfant de la
// racine, comme les détails (la barre a `overflow` et le couperait). Les cases ne
// changent rien ici : elles appellent le rappel `onMapOption`.
//
// Chaque nombre a une infobulle (`title`) qui nomme ses valeurs dans l'ordre où
// elles sont écrites, avec les mêmes séparateurs : « Stock / cible · par tour ».

import { attachGoodTip } from "./goodtips.ts";
import { productIcon } from "./icons.ts";
import { productName } from "./names.ts";
import type { FactoryCatalog, HumanDetail, PlayerStats } from "./protocol.ts";

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);
const signed = (n: number): string => (n > 0 ? "+" : "") + num(n);

/** Part de `x` dans `total`, en pourcentage de largeur, bornée à 0…100. */
const pct = (x: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (100 * x) / total)) : 0);

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
function setSigned(e: HTMLElement, n: number): void {
  e.textContent = signed(n);
  e.className = n > 0 ? "pos" : n < 0 ? "neg" : "zero";
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
}

function track(kind: "flow" | "stock"): Track {
  const root = el("div", `ib-track ${kind}`);
  const fill = el("i", "ib-fill");
  const gap = el("i", "ib-gap");
  const hatch = el("i", "ib-hatch");
  const mark = el("i", kind === "flow" ? "ib-mark thick" : "ib-mark thin");
  mark.hidden = true;
  root.append(fill, gap, hatch, mark);
  return { root, fill, gap, mark, hatch };
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
export type MapOption = "iron" | "playerColor" | "fertility" | "factories";

/** Options du menu, dans l'ordre d'affichage, avec l'état de leur case en début de partie. */
export const MAP_OPTIONS: readonly { readonly id: MapOption; readonly label: string; readonly initial: boolean }[] = [
  { id: "iron", label: "Ressources naturelles", initial: false },
  { id: "playerColor", label: "Couleur des joueurs", initial: true },
  { id: "fertility", label: "Fertilité", initial: false },
  { id: "factories", label: "Icônes d'usine", initial: true },
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
  /** Vrai pendant que le joueur tient le curseur de la part de fermiers : les tours n'y touchent pas. */
  private farmSliderActive = false;

  /**
   * `onMapOption` est appelé à chaque case du menu « Carte » cochée ou décochée ;
   * `onFarmShare`, au relâchement du curseur de la part de fermiers.
   */
  constructor(
    root: HTMLElement,
    catalog: FactoryCatalog,
    onMapOption: (option: MapOption, checked: boolean) => void,
    onFarmShare: (percent: number) => void,
  ) {
    this.root = root;
    this.catalog = catalog;
    this.onFarmShare = onFarmShare;
    this.bar = el("div", "ib-bar");
    this.sections = [this.population(), this.food(), this.flows(catalog), this.stocks(catalog)];
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

  /** Replie le détail ouvert, s'il y en a un. */
  private collapse(): void {
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
    if (this.open >= 0) this.sections[this.open]!.body(detail, stats);
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
    // Le détail s'aligne sur le bord gauche de sa section, sans dépasser de la barre.
    const pane = this.sections[this.open]!.pane;
    const button = this.sections[this.open]!.button;
    const left = Math.max(0, Math.min(button.offsetLeft, this.root.clientWidth - pane.offsetWidth));
    pane.style.left = `${left}px`;
    if (this.last) this.sections[this.open]!.body(this.last.detail, this.last.stats);
  }

  // ---- construction d'une section : bouton + détail ----

  private button(id: string, content: HTMLElement[]): HTMLButtonElement {
    const b = el("button", "ib-sec");
    b.type = "button";
    b.id = `ib-${id}`;
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", `ib-pane-${id}`);
    b.append(...content, el("span", "ib-chev"));
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
    const total = el("strong", "ib-num");
    const delta = el("span", "zero");
    const max = el("span", "muted");
    const button = this.button("pop", [icon("population/pop-default.png"), el("span", "ib-name", "Population"), total, delta, max]);
    button.title = "Population · variation / maximum";

    const occupations = [
      { label: "Ouvriers d'usine", icon: "pop-worker", color: "var(--occ-factory)", read: (s: PlayerStats) => s.factoryWorkers },
      { label: "Mineurs", icon: "pop-miner", color: "var(--occ-mine)", read: (s: PlayerStats) => s.miners, machine: "miningMachine" },
      { label: "Fermiers", icon: "pop-farmer", color: "var(--occ-farm)", read: (s: PlayerStats) => s.farmers, machine: "tractor" },
      { label: "Pêcheurs", icon: "pop-fisherman", color: "var(--occ-fish)", read: (s: PlayerStats) => s.fishers, machine: "fishingBoat" },
      { label: "Inactifs", icon: "pop-inactive", color: "var(--occ-idle)", read: (s: PlayerStats) => s.idle },
    ];
    const stacked = el("div", "ib-stack");
    const parts = occupations.map((o) => {
      const part = el("i");
      part.style.background = o.color;
      stacked.append(part);
      return part;
    });
    const rows = occupations.map((o) => {
      const r = el("div", "ib-row occ");
      const sw = el("span", "sw");
      sw.style.background = o.color;
      const t = track("flow");
      t.fill.style.background = o.color;
      const value = el("span", "ib-value");
      value.title = "Personnes · part";
      const label = el("span", "ib-label");
      label.append(icon(`population/${o.icon}.png`), o.label);
      // L'engrenage dit que ce métier se mécanise ; son infobulle est celle de la machine.
      if (o.machine !== undefined) label.append(gearIcon(o.machine));
      r.append(sw, label, t.root, value);
      return { r, fill: t.fill, value };
    });
    const note = el("p", "muted small ib-note", "Répartition de la population au début du dernier tour.");
    const pane = this.pane("pop", el("h3", undefined, "Population par occupation"), stacked, ...rows.map((x) => x.r), note);

    return {
      button,
      pane,
      head: (_d, s) => {
        total.textContent = num(s.population);
        // Croissance du tour : la population d'après moins celle du début du tour, somme des occupations.
        setSigned(delta, s.population - (s.factoryWorkers + s.miners + s.farmers + s.fishers + s.idle));
        max.textContent = `/ ${num(this.info.foodPerHead > 0 ? Math.floor(s.food / this.info.foodPerHead) : 0)}`;
      },
      body: (_d, s) => {
        const counts = occupations.map((o) => o.read(s));
        const sum = counts.reduce((a, b) => a + b, 0);
        let from = 0;
        counts.forEach((n, i) => {
          const w = pct(n, sum);
          span(parts[i]!, from, from + w);
          from += w;
          span(rows[i]!.fill, 0, w);
          rows[i]!.value.textContent = `${num(n)} · ${share(n, sum)}`;
        });
      },
    };
  }

  // ---- 2. Nourriture ----

  private food(): Section {
    const total = el("strong", "ib-num");
    const surplus = el("span", "zero");
    const button = this.button("food", [el("span", "ib-name", "Nourriture"), total, el("span", "muted", "/tour"), surplus]);
    button.title = "Production / tour · surplus";

    // Jauge de population : actuelle (vert), maximum avec la nourriture du tour (vert
    // hachuré), maximum si toutes les terres et eaux étaient travaillées (gris hachuré).
    const capRoot = el("div", "ib-track ib-cap");
    const capNow = el("i", "cap-now");
    const capFood = el("i", "cap-food");
    const capLand = el("i", "cap-land");
    capRoot.append(capLand, capFood, capNow);
    const capValue = el("span", "ib-value");
    capValue.title = "Actuelle / nourrie / potentielle";
    capRoot.title = "Vert : actuelle · hachuré : nourrie · gris : potentielle (toutes cases exploitées)";
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
      },
      body: (_d, s) => {
        const perHead = this.info.foodPerHead > 0 ? this.info.foodPerHead : 1;
        const maxNow = Math.floor(s.food / perHead);
        const maxLand = Math.max(maxNow, Math.floor(s.foodPotential / perHead));
        const scale = Math.max(maxLand, s.population, 1);
        span(capNow, 0, pct(s.population, scale));
        span(capFood, 0, pct(maxNow, scale));
        span(capLand, 0, pct(maxLand, scale));
        capValue.textContent = `${num(s.population)} / ${num(maxNow)} / ${num(maxLand)}`;
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
    const button = this.button("flow", [el("span", "ib-icon", "⇄"), el("span", "ib-name", "Ressources (flux)")]);

    const iron = track("flow");
    const ironValue = el("span", "ib-value");
    ironValue.title = "Extrait / demandé · capacité";
    const ironRow = row(iconLabel("goods/goods-iron-ingot.png", "Fer"), iron.root, ironValue);
    // Aucune règle n'extrait l'aluminium encore : même ligne grisée que le commerce.
    const aluminiumRow = row(iconLabel("goods/goods-aluminium-ingot.png", "Aluminium"), track("flow").root, el("span", "ib-value", "à venir"), "soon");

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
      label.append(sym, ` ${m.label}`);
      return { ...m, index: catalog.goodIds.indexOf(m.good), t, value, r: row(label, t.root, value) };
    });

    const legend = el("p", "ib-legend");
    legend.append(
      legendItem("flow", "produit ce tour"),
      legendItem("req", "production requise"),
      legendItem("gap", "manque"),
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

    return {
      button,
      pane,
      head: () => {},
      body: (d, s) => {
        const cap = d.ironCapacity;
        const got = s.ironExtracted;
        const need = d.ironRequired;
        span(iron.fill, 0, pct(got, cap));
        span(iron.gap, pct(got, cap), got < need ? pct(need, cap) : 0);
        iron.mark.style.left = `${pct(need, cap)}%`;
        iron.mark.hidden = need === 0;
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
    const button = this.button("stock", [el("span", "ib-icon", "▣"), el("span", "ib-name", "Armement (stock)")]);

    const rows = catalog.armamentIds.map((id, index) => {
      const t = track("stock");
      t.mark.hidden = false;
      const value = el("span", "ib-value");
      value.title = "Stock / cible · par tour";
      const label = el("span");
      label.append(productIcon(id), ` ${capitalize(productName(id))}`);
      return { id, index, t, value, r: row(label, t.root, value) };
    });
    const empty = el("p", "muted", "Aucune ligne d'armement.");
    const legend = el("p", "ib-legend");
    const decay = el("span");
    const hatched = legendItem("hatch", "hachuré : au-delà du stock cible, ");
    hatched.append(decay);
    legend.append(legendItem("stock", "stock"), legendItem("target", "stock cible"), hatched);
    const pane = this.pane("stock", el("h3", undefined, "Armement (stock)"), ...rows.map((x) => x.r), empty, legend);

    return {
      button,
      pane,
      head: () => {},
      body: (d) => {
        let shown = 0;
        for (const x of rows) {
          const stock = d.reserve[x.index] ?? 0;
          const target = d.reserveMax[x.index] ?? 0;
          x.r.hidden = target === 0 && stock === 0;
          if (x.r.hidden) continue;
          shown++;
          // Échelle : 1,5 × la cible, ou le stock s'il la dépasse davantage, pour que l'excès se voie.
          const scale = Math.max(Math.floor((target * 3) / 2), stock);
          span(x.t.fill, 0, pct(stock, scale));
          span(x.t.hatch, pct(target, scale), 100);
          x.t.mark.style.left = `${pct(target, scale)}%`;
          x.value.textContent = `${num(stock)} / ${num(target)} · +${num(this.production(d, x.id, catalog))} par tour`;
        }
        empty.hidden = shown > 0;
        decay.textContent = `${num(this.info.armamentDecayPercent)} % de l'excès disparaît par tour`;
      },
    };
  }

  /** Production d'un type d'armement au dernier tour : lignes remplies × production par ligne. */
  private production(d: HumanDetail, id: string, catalog: FactoryCatalog): number {
    let filled = 0;
    for (const f of d.factories) for (const g of f.groups) if (g.good === id) filled += g.filled;
    return filled * (catalog.productionPerLine[id] ?? 0);
  }

  private get info(): FactoryCatalog["economy"] {
    return this.catalog.economy;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
