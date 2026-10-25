// Panneau latéral de production (00-Game §8.1) : une section par ville qui a une
// usine, une ligne par bien de son arbre : en production (« actives / total », un
// curseur, un bouton + pour une ligne de plus), débloqué (un bouton + pour la
// première ligne) ou verrouillé (parent → flèche → enfant) ; la priorité par
// glisser-déposer. La page n'applique aucune
// règle : elle envoie des ordres (HumanOrder) et affiche ce que le moteur calcule.
//
// Le panneau est reconstruit seulement quand sa structure change (usines, groupes,
// nombres de lignes, biens débloqués). Entre deux reconstructions, seuls les
// nombres (lignes remplies, progression, fer, réserves) sont mis à jour : un
// curseur ou un glisser en cours n'est pas détruit par le tour suivant.

import { attachGoodTip } from "./goodtips.ts";
import { productIcon } from "./icons.ts";
import { dominantGood, factoryName, productName, productSymbol } from "./names.ts";
import type { FactoryCatalog, FactoryView, HumanDetail, HumanOrder, PlayerStats } from "./protocol.ts";

const fmt = new Intl.NumberFormat("fr-FR");
const num = (n: number): string => fmt.format(n);

/** Délai pendant lequel une reconstruction est retenue après un réglage, le temps que le moteur applique l'ordre (ms). */
const HOLD_MS = 500;

type Drag = { kind: "city"; city: number } | { kind: "line"; city: number; good: string };

/** Icône de `public/icons/miscellaneous/`, à la taille du texte. */
function miscIcon(file: string, alt: string): HTMLImageElement {
  const img = el("img", "ib-img") as HTMLImageElement;
  img.src = `icons/miscellaneous/${file}`;
  img.alt = alt;
  return img;
}

export class ProductionPanel {
  private readonly root: HTMLElement;
  private readonly send: (order: HumanOrder) => void;
  /** Survol d'une usine : la carte hachure la zone de sa ville (0 : plus rien). */
  private readonly highlight: (city: number) => void;
  private readonly catalog: FactoryCatalog;
  private readonly summary: HTMLElement;
  private readonly cities: HTMLElement;
  private readonly reserves: HTMLElement;
  private key = "";
  private drag: Drag | null = null;
  private sliderActive = false;
  private holdUntil = 0;
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;

  constructor(root: HTMLElement, catalog: FactoryCatalog, send: (order: HumanOrder) => void,
    highlight: (city: number) => void,
  ) {
    this.root = root;
    this.catalog = catalog;
    this.send = send;
    this.highlight = highlight;
    root.innerHTML = "";
    this.summary = el("div", "prod-summary");
    this.cities = el("div", "prod-cities");
    this.reserves = el("div", "prod-reserves");
    root.append(this.summary, this.cities, this.reserves);
  }

  /** À appeler à chaque tour (même panneau fermé : le coût est négligeable). */
  update(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    if (this.root.hidden) return;
    const key = this.structureKey(detail);
    if (key !== this.key && this.canRebuild()) {
      this.key = key;
      this.rebuild(detail);
    }
    this.refreshNumbers(detail, stats);
  }

  /** Après la réouverture du panneau ou la fin d'un glisser : remet le panneau à jour. */
  refresh(): void {
    if (this.last) this.update(this.last.detail, this.last.stats);
  }

  private canRebuild(): boolean {
    return this.drag === null && !this.sliderActive && performance.now() >= this.holdUntil;
  }

  private structureKey(d: HumanDetail): string {
    return JSON.stringify(
      d.factories.map((f) => [
        f.city,
        f.type,
        f.groups.map((g) => [g.good, g.lines, g.active]),
        f.progress.map((p) => (p >= this.catalog.unlockTurns ? 1 : 0)),
      ]),
    );
  }

  private tree(type: string): readonly { good: string; parent: string | null }[] {
    return this.catalog.factoryTypes.find((t) => t.id === type)!.tree;
  }

  // ---- construction ----

  private rebuild(d: HumanDetail): void {
    this.cities.innerHTML = "";
    // Les sections remplacées ne signalent pas la fin du survol.
    this.highlight(0);
    if (d.factories.length === 0) {
      const p = el("p", "muted");
      p.textContent = "Aucune usine. Utilisez « Inaugurer une usine » dans la barre du bas, puis cliquez sur la zone d'une de vos villes.";
      this.cities.append(p);
      return;
    }
    d.factories.forEach((f) => this.cities.append(this.citySection(f)));
  }

  private citySection(f: FactoryView): HTMLElement {
    const section = el("section", "fsec");
    section.dataset["city"] = String(f.city);
    section.addEventListener("pointerenter", () => this.highlight(f.city));
    section.addEventListener("pointerleave", () => this.highlight(0));
    const head = el("header", "fhead");
    const grip = this.grip({ kind: "city", city: f.city }, section);
    const title = el("strong");
    title.textContent = `Ville n° ${f.city}`;
    const meta = el("span", "muted");
    meta.textContent = `${factoryName(f.type)} · niveau ${f.level}`;
    // Le bien qui a le plus de lignes construites représente l'usine (actives ou non).
    const mark = productIcon(dominantGood(this.tree(f.type), f.groups));
    head.append(grip, title, mark, meta);
    section.append(head);

    // Une ligne par bien de l'arbre (00-Game §8.1) : d'abord les biens en production,
    // dans l'ordre de priorité (glissables), avec un bouton + pour une ligne de plus ;
    // puis les autres biens de l'arbre, dans l'ordre de l'arbre : débloqués, un bouton +
    // crée la première ligne ; verrouillés, [parent] progression, jauge, cadenas, [bien].
    for (const g of f.groups) section.append(this.groupRow(f, g));
    const tree = this.tree(f.type);
    tree.forEach((node) => {
      if (f.groups.some((g) => g.good === node.good)) return;
      const parentIndex = node.parent === null ? -1 : tree.findIndex((n) => n.good === node.parent);
      if (parentIndex < 0 || f.progress[parentIndex]! >= this.catalog.unlockTurns) {
        const row = el("div", "unlocked");
        const text = el("span", "muted small");
        text.textContent = "aucune ligne";
        row.append(goodSpan(node.good), text, this.plus(f.city, node.good, "Créer la première ligne"));
        section.append(row);
        return;
      }
      const row = el("div", "locked");
      const bar = el("span", "arrow");
      const fill = el("i");
      fill.dataset["prog"] = `${f.city}:${parentIndex}`;
      bar.append(fill);
      const text = el("span", "muted small");
      text.dataset["progText"] = `${f.city}:${parentIndex}`;
      text.title = "Tours-lignes produits / requis";
      const padlock = el("img", "ib-img") as HTMLImageElement;
      padlock.src = "icons/miscellaneous/misc-padlock.png";
      padlock.alt = "Verrouillé";
      row.append(goodSpan(node.parent!), text, bar, padlock, goodSpan(node.good));
      row.title = `Verrouillé : il faut ${num(this.catalog.unlockTurns)} tours-lignes de production de ${productName(node.parent!)} (une ligne : ${num(this.catalog.unlockTurns)} tours ; dix lignes : dix fois moins).`;
      section.append(row);
    });

    this.bindCityDrop(section, f.city);
    return section;
  }

  /** Bouton + : envoie `create_line` (une ligne de plus de ce bien dans cette usine). */
  private plus(city: number, good: string, title: string): HTMLElement {
    const b = el("button", "plus") as HTMLButtonElement;
    b.type = "button";
    b.append(miscIcon("misc-plus-lighter.png", title));
    b.title = `${title} : ${productName(good)}`;
    b.addEventListener("click", () => {
      this.holdUntil = 0;
      this.send({ type: "create_line", city, good });
    });
    return b;
  }

  private groupRow(f: FactoryView, g: FactoryView["groups"][number]): HTMLElement {
    const row = el("div", "grow");
    row.dataset["city"] = String(f.city);
    row.dataset["good"] = g.good;
    const grip = this.grip({ kind: "line", city: f.city, good: g.good }, row);
    const sym = productIcon(g.good);
    if (!attachGoodTip(sym, g.good)) sym.title = productName(g.good);
    const slider = el("input") as HTMLInputElement;
    slider.type = "range";
    slider.min = "0";
    slider.max = String(g.lines);
    slider.step = "1";
    // Le curseur montre les lignes en service : le réglage du joueur, ramené aux
    // lignes utiles (pas du dessus de la demande, 00-Game §8.2). Le réglage reste
    // dans le moteur et revient quand la demande remonte.
    // Deux informations distinctes (00-Game §8.1) : le curseur est le maximum réglé
    // par le joueur (`active`) ; la barre bleue, les lignes en service, ce réglage
    // ramené aux lignes utiles (trait rouge, 00-Game §8.2). La production est
    // celle de la barre bleue.
    slider.value = String(g.active);
    slider.className = "lines-slider";
    const inService = Math.min(g.active, g.usefulLines);
    const count = el("span", "cnt");
    const act = el("b");
    act.dataset["inService"] = `${f.city}:${g.good}`;
    act.textContent = String(inService);
    const max = el("span", "muted");
    max.textContent = ` · max ${g.active} / ${g.lines}`;
    count.append(act, max);
    count.title = "En service · réglé / lignes";
    const filled = el("span", "muted small");
    filled.dataset["filled"] = `${f.city}:${g.good}`;
    filled.title = `Par ligne remplie : ${num(this.catalog.ironPerLine[g.good] ?? 0)} fer, ${num(this.catalog.productionPerLine[g.good] ?? 0)} produits. Ouvriers : ${num(this.catalog.workersPerLine[g.good] ?? 0)} pour la 1re ligne, de moins en moins ensuite, ${num(this.catalog.workersFloor[g.good] ?? 0)} au minimum.`;
    slider.addEventListener("pointerdown", () => (this.sliderActive = true));
    // Un clic sans déplacement ne déclenche pas `change` : sans ceci, `sliderActive`
    // resterait vrai et le panneau ne serait plus jamais reconstruit (nouvelle usine
    // invisible, curseur bloqué à son ancien maximum).
    slider.addEventListener("pointerup", () => (this.sliderActive = false));
    slider.addEventListener("pointercancel", () => (this.sliderActive = false));
    slider.addEventListener("blur", () => (this.sliderActive = false));
    slider.addEventListener("input", () => {
      this.sliderActive = true;
      max.textContent = ` · max ${slider.value} / ${g.lines}`;
    });
    // L'ordre part au relâchement (événement `change`), pas à chaque mouvement du curseur.
    slider.addEventListener("change", () => {
      this.sliderActive = false;
      this.holdUntil = performance.now() + HOLD_MS;
      this.send({ type: "set_active_lines", city: f.city, good: g.good, count: Number(slider.value) });
    });
    // Trait rouge sur le curseur : lignes utiles, au-delà desquelles la production
    // dépasserait la demande et n'est pas remplie (00-Game §8.2). Biens seulement.
    const wrap = el("span", "slider-wrap");
    const track = el("i", "slider-track");
    const fill = el("i", "slider-fill");
    fill.dataset["fill"] = `${f.city}:${g.good}`;
    fill.style.width = onTrack(inService, g.lines);
    wrap.append(track, fill, slider);
    if (!this.catalog.armamentIds.includes(g.good)) {
      const mark = el("i", "useful-mark");
      mark.dataset["useful"] = `${f.city}:${g.good}`;
      mark.title = "Lignes utiles : au-delà, la production dépasserait la demande et les ouvriers vont ailleurs.";
      wrap.append(mark);
    }
    row.append(grip, sym, wrap, count, this.plus(f.city, g.good, "Ajouter une ligne"), filled);
    // Croissance automatique (00-Game §8.2), biens seulement : une jauge vers la ligne suivante.
    if (!this.catalog.armamentIds.includes(g.good)) {
      const growth = el("div", "growth");
      const bar = el("span", "arrow");
      const fill = el("i");
      fill.dataset["growth"] = `${f.city}:${g.good}`;
      bar.append(fill);
      const text = el("span", "muted small");
      text.dataset["growthText"] = `${f.city}:${g.good}`;
      text.title = "Tours / requis";
      growth.append(miscIcon("misc-up-lighter.png", "Ligne suivante"), bar, text);
      growth.title = `L'usine gagne un niveau à chaque fois qu'elle produit l'équivalent de ${num(this.catalog.growthTurns)} tours sur une seule ligne. Plus de lignes la font grandir plus vite.`;
      row.append(growth);
    }
    this.bindLineDrop(row, f.city);
    return row;
  }

  // ---- glisser-déposer : les villes entre elles, les groupes au sein de leur ville ----

  private grip(drag: Drag, moved: HTMLElement): HTMLElement {
    const g = el("span", "grip");
    g.textContent = "⋮⋮";
    g.draggable = true;
    g.title = drag.kind === "city" ? "Glisser pour changer la priorité de la ville" : "Glisser pour changer la priorité de cette production";
    g.addEventListener("dragstart", (e) => {
      this.drag = drag;
      e.dataTransfer?.setData("text/plain", "fronts-of-iron");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(moved, 10, 10);
      }
      moved.classList.add("dragging");
    });
    g.addEventListener("dragend", () => {
      this.drag = null;
      moved.classList.remove("dragging");
      for (const x of this.root.querySelectorAll(".drop")) x.classList.remove("drop");
      this.refresh();
    });
    return g;
  }

  private bindCityDrop(section: HTMLElement, city: number): void {
    section.addEventListener("dragover", (e) => {
      if (this.drag?.kind !== "city") return;
      e.preventDefault();
      section.classList.add("drop");
    });
    section.addEventListener("dragleave", (e) => {
      if (e.target === section) section.classList.remove("drop");
    });
    section.addEventListener("drop", (e) => {
      if (this.drag?.kind !== "city") return;
      e.preventDefault();
      section.classList.remove("drop");
      const sections = [...this.cities.querySelectorAll<HTMLElement>(".fsec")];
      const position = sections.indexOf(section);
      const dragged = this.drag.city;
      this.drag = null;
      this.holdUntil = performance.now() + HOLD_MS;
      if (dragged !== city && position >= 0) this.send({ type: "set_city_priority", city: dragged, position });
    });
  }

  private bindLineDrop(row: HTMLElement, city: number): void {
    row.addEventListener("dragover", (e) => {
      if (this.drag?.kind !== "line" || this.drag.city !== city) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add("drop");
    });
    row.addEventListener("dragleave", (e) => {
      if (e.target === row) row.classList.remove("drop");
    });
    row.addEventListener("drop", (e) => {
      if (this.drag?.kind !== "line" || this.drag.city !== city) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drop");
      const rows = [...(row.parentElement?.querySelectorAll<HTMLElement>(".grow") ?? [])];
      const position = rows.indexOf(row);
      const dragged = this.drag.good;
      this.drag = null;
      this.holdUntil = performance.now() + HOLD_MS;
      if (dragged !== row.dataset["good"] && position >= 0) this.send({ type: "set_line_priority", city, good: dragged, position });
    });
  }

  // ---- nombres mis à jour à chaque tour ----

  private refreshNumbers(d: HumanDetail, s: PlayerStats): void {
    let active = 0;
    let filled = 0;
    for (const f of d.factories) {
      for (const g of f.groups) {
        active += g.active;
        filled += g.filled;
        const cell = this.cities.querySelector<HTMLElement>(`[data-filled="${f.city}:${g.good}"]`);
        if (cell) {
          const wanted = Math.min(g.active, g.usefulLines);
          const workers = g.workers;
          const iron = g.filled * (this.catalog.ironPerLine[g.good] ?? 0);
          cell.textContent = `remplies : ${g.filled} · ouvriers : ${num(workers)} · fer : ${num(iron)}${g.filled < wanted ? " (population ou fer manquant)" : g.filled < g.active ? " (demande atteinte)" : ""}`;
        }
        const inService = Math.min(g.active, g.usefulLines);
        const fill = this.cities.querySelector<HTMLElement>(`[data-fill="${f.city}:${g.good}"]`);
        if (fill) fill.style.width = onTrack(inService, g.lines);
        const act = this.cities.querySelector<HTMLElement>(`[data-in-service="${f.city}:${g.good}"]`);
        if (act) act.textContent = String(inService);
        const mark = this.cities.querySelector<HTMLElement>(`[data-useful="${f.city}:${g.good}"]`);
        if (mark) mark.style.left = `calc(7px + ${onTrack(g.usefulLines, g.lines)})`;
        const gbar = this.cities.querySelector<HTMLElement>(`[data-growth="${f.city}:${g.good}"]`);
        if (gbar) gbar.style.width = g.demandMet ? "0%" : `${Math.min(100, Math.floor((g.growth * 100) / this.catalog.growthTurns))}%`;
        const gtext = this.cities.querySelector<HTMLElement>(`[data-growth-text="${f.city}:${g.good}"]`);
        if (gtext) gtext.textContent = g.demandMet ? "demande couverte" : `${num(g.growth)} / ${num(this.catalog.growthTurns)} → ligne suivante`;
      }
      f.progress.forEach((p, i) => {
        const bar = this.cities.querySelector<HTMLElement>(`[data-prog="${f.city}:${i}"]`);
        if (bar) bar.style.width = `${Math.min(100, Math.floor((p * 100) / this.catalog.unlockTurns))}%`;
        const text = this.cities.querySelector<HTMLElement>(`[data-prog-text="${f.city}:${i}"]`);
        if (text) text.textContent = `${num(p)} / ${num(this.catalog.unlockTurns)}`;
      });
    }
    const lines = [
      `Lignes remplies : ${num(filled)} sur ${num(active)} actives · ouvriers d'usine : ${num(s.factoryWorkers)}`,
      `Fer : capacité ${num(d.ironCapacity)} · extrait ${num(s.ironExtracted)} · cases exploitées ${num(s.minedTiles)} · mineurs ${num(s.miners)}`,
      "Biens produits au dernier tour (machines du tour suivant) : " +
        this.catalog.goodIds.map((id, i) => `${productName(id)} ${num(d.goods[i]!)}`).join(" · "),
    ];
    this.summary.replaceChildren(...lines.map((t) => Object.assign(el("div"), { textContent: t })));

    const reserveLines = this.catalog.armamentIds
      .map((id, i) => ({ id, i }))
      .filter(({ i }) => d.reserveMax[i]! > 0 || d.reserve[i]! > 0)
      .map(({ id, i }) => `${productSymbol(id)} ${num(d.reserve[i]!)} (stock cible ${num(d.reserveMax[i]!)})`);
    const head = Object.assign(el("strong"), { textContent: "Réserves d'armement" });
    this.reserves.replaceChildren(
      head,
      ...(reserveLines.length === 0
        ? [Object.assign(el("div", "muted"), { textContent: "Aucune ligne d'armement." })]
        : reserveLines.map((t) => Object.assign(el("div"), { textContent: t }))),
    );
  }
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function span(text: string): HTMLElement {
  return Object.assign(el("span", "sym"), { textContent: text });
}

/** Symbole d'un bien, avec son infobulle construite s'il en a une. */
function goodSpan(good: string): HTMLElement {
  const s = productIcon(good);
  attachGoodTip(s, good);
  return s;
}

/** Longueur sur la piste du curseur (entre les centres extrêmes du pouce, 14 px) pour `n` lignes sur `lines`. */
function onTrack(n: number, lines: number): string {
  const ratio = lines > 0 ? Math.min(1, n / lines) : 0;
  return `calc((100% - 14px) * ${ratio})`;
}
