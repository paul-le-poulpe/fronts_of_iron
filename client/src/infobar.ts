// Barre d'informations en haut de l'écran (00-Game §11) : quatre sections, un clic
// déplie le détail sous la barre, un second clic le replie, un seul détail ouvert
// à la fois. La page n'applique aucune règle : elle affiche des nombres du moteur
// (HumanDetail, PlayerStats) et en tire quelques rapports (parts, écarts).
//
// Le DOM est construit une seule fois, dans le constructeur. Ensuite `update`
// écrit seulement des textes et des largeurs : rien n'est détruit entre deux tours.
// Seuls la barre et le détail ouvert sont mis à jour ; un détail replié est remis à
// jour à son ouverture.

import { productName, productSymbol } from "./names.ts";
import type { FactoryCatalog, HumanDetail, PlayerStats } from "./protocol.ts";

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);
const signed = (n: number): string => (n > 0 ? "+" : "") + num(n);

/** Part de `x` dans `total`, en pourcentage de largeur, bornée à 0…100. */
const pct = (x: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (100 * x) / total)) : 0);

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

function symbol(text: string): HTMLElement {
  return el("span", "sym", text);
}

function legendItem(className: string, text: string): HTMLElement {
  const item = el("span", "ib-legend-item");
  item.append(el("span", `ib-key ${className}`), document.createTextNode(text));
  return item;
}

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
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;

  constructor(root: HTMLElement, catalog: FactoryCatalog) {
    this.root = root;
    this.catalog = catalog;
    this.bar = el("div", "ib-bar");
    this.sections = [this.population(), this.food(), this.flows(catalog), this.stocks(catalog)];
    root.replaceChildren(this.bar);
    this.sections.forEach((s, i) => {
      s.pane.hidden = true;
      s.button.addEventListener("click", () => this.toggle(i));
      this.bar.append(s.button);
      root.append(s.pane);
    });
  }

  /** À appeler à chaque tour. */
  update(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    for (const s of this.sections) s.head(detail, stats);
    if (this.open >= 0) this.sections[this.open]!.body(detail, stats);
  }

  private toggle(index: number): void {
    const previous = this.open;
    this.open = index === previous ? -1 : index;
    this.sections.forEach((s, i) => {
      const on = i === this.open;
      s.pane.hidden = !on;
      s.button.setAttribute("aria-expanded", String(on));
    });
    if (this.open < 0) return;
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
    delta.title = "Variation de la population pendant le dernier tour (croissance, 00-Game §4.1)";
    const max = el("span", "muted");
    max.title = "Population maximale : nourriture du tour ÷ consommation par tête (00-Game §4.1)";
    const button = this.button("pop", [el("span", "ib-name", "Population"), total, delta, max]);

    const occupations = [
      { label: "Ouvriers d'usine", color: "var(--occ-factory)", read: (s: PlayerStats) => s.factoryWorkers },
      { label: "Mineurs", color: "var(--occ-mine)", read: (s: PlayerStats) => s.miners },
      { label: "Fermiers", color: "var(--occ-farm)", read: (s: PlayerStats) => s.farmers },
      { label: "Pêcheurs", color: "var(--occ-fish)", read: (s: PlayerStats) => s.fishers },
      { label: "Inactifs", color: "var(--occ-idle)", read: (s: PlayerStats) => s.idle },
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
      r.append(sw, el("span", "ib-label", o.label), t.root, value);
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
    surplus.title = "Surplus : nourriture du tour − population × consommation par tête";
    const button = this.button("food", [el("span", "ib-name", "Nourriture"), total, el("span", "muted", "/tour"), surplus]);

    // Jauge de population : actuelle (vert), maximum avec la nourriture du tour (vert
    // hachuré), maximum si toutes les terres et eaux étaient travaillées (gris hachuré).
    const capRoot = el("div", "ib-track ib-cap");
    const capNow = el("i", "cap-now");
    const capFood = el("i", "cap-food");
    const capLand = el("i", "cap-land");
    capRoot.append(capLand, capFood, capNow);
    const capValue = el("span", "ib-value");
    const wheat = track("flow");
    wheat.root.classList.add("wheat");
    const wheatValue = el("span", "ib-value");
    const fish = track("flow");
    fish.root.classList.add("fish");
    const fishValue = el("span", "ib-value");
    const imports = row("Importations", track("flow").root, el("span", "ib-value", "à venir"), "soon");
    const exports_ = row("Exportations", track("flow").root, el("span", "ib-value", "à venir"), "soon");
    const consumption = el("p", "ib-consumption");
    const minimum = el("span");
    const surplusLine = el("span");
    consumption.append(el("strong", undefined, "Consommation"), document.createTextNode(" : "), minimum, document.createTextNode(" · surplus "), surplusLine);
    const pane = this.pane(
      "food",
      el("h3", undefined, "Nourriture produite par tour"),
      row("Population", capRoot, capValue),
      row("Agriculture", wheat.root, wheatValue),
      row("Pêche", fish.root, fishValue),
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
        capValue.title = "Population actuelle / maximum avec la nourriture du tour / maximum si toutes les terres et les eaux étaient exploitées";
        span(wheat.fill, 0, pct(s.wheat, s.food));
        wheatValue.textContent = `${num(s.wheat)} · ${num(s.cultivated)} / ${num(s.farmTiles)} cases`;
        span(fish.fill, 0, pct(s.fish, s.food));
        fishValue.textContent = `${num(s.fish)} · ${num(s.fished)} / ${num(s.seaTiles)} cases`;
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
    const ironRow = row(symbol("[fer]"), iron.root, ironValue);
    ironRow.querySelector(".ib-label")!.append(" Fer");

    const machines = [
      { good: "tractor", label: "Tracteurs" },
      { good: "fishingBoat", label: "Bateaux de pêche" },
      { good: "miningMachine", label: "Engins miniers" },
    ].map((m) => {
      const t = track("flow");
      const value = el("span", "ib-value");
      const label = el("span");
      label.append(symbol(productSymbol(m.good)), ` ${m.label}`);
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
      ...machines.map((m) => m.r),
      legend,
    );
    ironRow.title = "Barre pleine : capacité d'extraction (cases de fer × capacité par case). Trait noir : fer demandé par toutes les lignes actives.";

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
      const label = el("span");
      label.append(symbol(productSymbol(id)), ` ${capitalize(productName(id))}`);
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
