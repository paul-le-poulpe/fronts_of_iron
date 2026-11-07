// Panneau latéral de production (Docs/Design/08-Population.md §11) : les boîtes d'activités du joueur, de haut en bas
// dans l'ordre de priorité, puis les boîtes verrouillées. Une boîte : poignée, entrée (fer), pions, sortie. Les pions
// sont les bonshommes et les machines ; un glisser prend le pion sous la souris et tous ceux de même type à sa droite,
// et part en un seul `move_pawn`. La page n'applique aucune règle : elle envoie des
// ordres (HumanOrder) et affiche ce que le moteur calcule. Seules les règles visibles (boîte pleine, machine hors de sa
// boîte, Blessés) évitent d'envoyer un ordre que le moteur refuserait.
//
// Le panneau est reconstruit seulement quand sa structure change (pions, places, boîtes ouvertes, ordre des boîtes
// verrouillées, compteurs d'apparition et de sursis). Entre deux reconstructions, seuls les nombres (sorties, barres
// des compteurs et du déblocage) sont mis à jour : un glisser en cours n'est pas détruit par le tour suivant, et un
// ordre qui vient de partir retient la reconstruction jusqu'à ce que l'état change (`holdKey`) ou `HOLD_MS` passe.

import "./production.css";
import { BURST_SHIFT, onFixedPress, onPress } from "./burst.ts";
import { icon32Path } from "./icons.ts";
import { unitIconUrl } from "./uniticons.ts";
import { textPanel, typePanel } from "./infopanels.ts";
import { activityName, localPlayer, productName, productSymbol, unitName } from "./names.ts";
import type { ActivityCatalog, ActivityInfo, ActivityView, HumanDetail, HumanOrder, MilitaryCatalog, PlayerStats } from "./protocol.ts";
import { dec, num } from "./format.ts";
import { RESOURCE_LEGEND } from "./render.ts";
import { setTip } from "./tooltip.ts";

/** Délai maximal pendant lequel une reconstruction est retenue après un ordre, le temps que le moteur l'applique (ms). */
const HOLD_MS = 500;
/** Population au-delà de laquelle le panneau passe en petites icônes, une fois par partie (08 §11). */
const SMALL_ICONS_POPULATION = 50;

/** Déplacement de la souris, en px, à partir duquel un appui sur un pion devient un glisser. */
const DRAG_PX = 4;

/** Onglet de la barre d'informations qu'ouvre une ligne de l'en-tête. */
export type SummaryTab = "resources";

/** Icône de pion d'un bonhomme selon le genre de l'activité où il est. */
const WORKER_ICON: Readonly<Record<string, string>> = {
  idle: "pop-default",
  hurt: "pop-hurt",
  farming: "pop-farmer",
  fishing: "pop-fisherman",
  mining: "pop-miner",
  factory: "pop-worker",
  barracks: "pop-soldier",
};

/** Un pion tel que la boîte le dessine. */
interface Pawn {
  /** `w` : un bonhomme ; `m:<bien>` : une machine. */
  readonly pk: string;
  /** `normal`, `coming` (à venir), `leaving` (en sursis, il clignote) ou `empty` (poste vacant ou place vide). */
  readonly state: "normal" | "coming" | "leaving" | "empty";
  /** À venir : tour où il arrive, et durée totale du compteur. */
  readonly end?: number;
  readonly total?: number;
}

/** Un glisser de pions, de l'appui jusqu'au relâchement. */
interface PawnDrag {
  readonly act: string;
  readonly kind: "worker" | "machine";
  readonly good: string | undefined;
  readonly els: HTMLElement[];
  readonly x: number;
  readonly y: number;
  started: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
}

/** Réorganisation d'une boîte par sa poignée (08 §2). `ghost` est `null` tant que la souris n'a pas bougé de `DRAG_PX`. */
interface BoxDrag {
  readonly act: string;
  readonly box: HTMLElement;
  readonly x: number;
  readonly y: number;
  /** Point saisi, en px depuis le coin de la boîte : il reste sous la souris. */
  readonly grabX: number;
  readonly grabY: number;
  ghost: HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Image de `public/icons/<path>`. */
function img(path: string, className: string, alt = ""): HTMLImageElement {
  return imgUrl(`icons/${path}`, className, alt);
}

function imgUrl(url: string, className: string, alt: string): HTMLImageElement {
  const i = el("img", className);
  i.src = url;
  i.alt = alt;
  i.draggable = false;
  return i;
}

export class ProductionPanel {
  private readonly root: HTMLElement;
  private readonly catalog: ActivityCatalog;
  private readonly military: MilitaryCatalog;
  private readonly send: (order: HumanOrder) => void;
  private readonly byId = new Map<string, ActivityInfo>();
  private readonly popLine: HTMLElement;
  private readonly popText: HTMLElement;
  private readonly foodText: HTMLElement;
  private readonly newLine: HTMLElement;
  private readonly ironLine: HTMLElement;
  private readonly ironText: HTMLElement;
  private readonly ironMalus: HTMLElement;
  private readonly list: HTMLElement;
  /** Options du panneau : posées dans le menu « Options » de la barre d'informations (infobar.ts). */
  readonly options: HTMLElement;
  private key = "";
  /** Clé de structure au moment du dernier ordre : tant qu'elle ne change pas, le moteur n'a pas encore répondu. */
  private holdKey = "";
  private holdUntil = 0;
  private pawnDrag: PawnDrag | null = null;
  private boxDrag: BoxDrag | null = null;
  /** Trait de l'interstice visé pendant la réorganisation des boîtes. */
  private readonly gapMark = el("div", "pb-gap");
  /** Interstice visé : la boîte glissée ira avant la boîte de cet indice ; -1 : aucun. */
  private gap = -1;
  /** Dernière position de la souris sur le panneau, `null` hors du panneau. */
  private pointer: { readonly x: number; readonly y: number } | null = null;
  private selected: HTMLElement[] = [];
  /** Cases qui montrent la croix transparente : ce qu'un clic changerait (08 §7 bis). */
  private previewed: HTMLElement[] = [];
  /** Auto-assignation allumée au dernier dessin : les pions ne se glissent pas, ils se barrent (08 §7 bis). */
  private auto = true;
  private readonly autoBox = el("input");
  /** Choisit la taille des icônes de pions ; `iconSizeOption` le pose. */
  private chooseIcons: (big: boolean) => void = () => {};
  /** Le passage automatique en petites icônes a déjà eu lieu dans cette partie. */
  private iconsShrunk = false;
  /** Appelé au passage automatique en petites icônes : main.ts montre où est l'option. */
  onIconsShrunk: (() => void) | null = null;
  private last: { detail: HumanDetail; stats: PlayerStats } | null = null;

  constructor(root: HTMLElement, catalog: ActivityCatalog, military: MilitaryCatalog, send: (order: HumanOrder) => void, openTab: (tab: SummaryTab) => void) {
    this.root = root;
    this.catalog = catalog;
    this.military = military;
    this.send = send;
    for (const a of catalog.activities) this.byId.set(a.id, a);
    root.innerHTML = "";
    root.classList.add("pp");

    const summary = el("div", "pp-summary");
    this.popLine = el("div", "pp-line pp-pop");
    this.popText = el("span");
    this.foodText = el("span");
    // X [population] / Y [nourriture] (08 §11).
    const ham = img("miscellaneous/misc-food-ham.png", "pp-ic32");
    setTip(ham, () => this.foodTip());
    const help = el("span", "pp-help", "?");
    setTip(help, () => this.foodTip());
    this.popLine.append(this.popText, img("population/pop-default.png", "pp-ic32"), el("span", undefined, "/"), this.foodText, ham, help);
    this.ironLine = el("button", "pp-line pp-pop pp-link");
    (this.ironLine as HTMLButtonElement).type = "button";
    this.ironText = el("span");
    this.ironMalus = el("span", "pp-malus");
    const ironHelp = el("span", "pp-help", "?");
    setTip(ironHelp, () => this.ironTip());
    this.ironLine.append(img("goods/goods-iron-ingot.png", "pp-ic32"), this.ironText, ironHelp, this.ironMalus);
    this.ironLine.addEventListener("click", () => openTab("resources"));
    const stats = el("div", "pp-box");
    stats.append(this.popLine, this.ironLine);
    // Boîte de droite : les messages. « Nouvelle ligne disponible » fait défiler jusqu'aux lignes débloquées.
    const notes = el("div", "pp-box");
    this.newLine = el("button", "pp-note", "Nouvelle ligne disponible");
    (this.newLine as HTMLButtonElement).type = "button";
    this.newLine.hidden = true;
    this.newLine.addEventListener("click", () => {
      // Le panneau (`#prod`) est le conteneur qui défile : position écrite directement, sans animation que le tour suivant pourrait couper.
      const line = this.list.querySelector<HTMLElement>(".pl-new");
      if (line !== null) this.root.scrollTop += line.getBoundingClientRect().top - this.root.getBoundingClientRect().top - this.root.clientHeight / 2;
    });
    notes.append(this.newLine);
    summary.append(stats, notes);
    this.options = el("div");
    this.options.append(this.iconSizeOption(), this.autoAssignOption());

    this.list = el("div", "pp-list");
    root.append(summary, this.list);
    root.addEventListener("pointermove", (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    root.addEventListener("pointerleave", () => (this.pointer = null));
    this.installPawnDrag();
  }

  /** Option du menu « Options » (08 §11) : deux carrés, 16 × 16 et 32 × 32, le sélectionné en bleu, puis « Icônes ». */
  private iconSizeOption(): HTMLElement {
    const row = el("div", "pp-options");
    const small = el("button", "pp-size pp-size-16");
    const big = el("button", "pp-size pp-size-32");
    const choose = (on: boolean): void => {
      this.root.classList.toggle("pp-big", on);
      small.classList.toggle("on", !on);
      big.classList.toggle("on", on);
      small.setAttribute("aria-pressed", String(!on));
      big.setAttribute("aria-pressed", String(on));
    };
    for (const [button, on, title] of [[small, false, "Petites icônes"], [big, true, "Grandes icônes"]] as const) {
      button.type = "button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => choose(on));
    }
    this.chooseIcons = choose;
    choose(true);
    row.append(small, big, el("span", undefined, "Icônes"));
    return row;
  }

  /** Option du menu « Options » (08 §7 bis) : les inactifs remplissent seuls les postes vacants. */
  private autoAssignOption(): HTMLElement {
    const label = el("label", "pp-options pp-check");
    this.autoBox.type = "checkbox";
    this.autoBox.addEventListener("change", () => this.order({ type: "set_auto_assign", enabled: this.autoBox.checked }));
    label.append(this.autoBox, el("span", undefined, "Auto-assignation"));
    label.title = "Bonshommes et machines se placent seuls, de haut en bas. Désactive le glisser-déposer.";
    return label;
  }

  // ---- mise à jour ----

  /** À appeler à chaque tour (même panneau fermé : le coût est négligeable). */
  update(detail: HumanDetail, stats: PlayerStats): void {
    this.last = { detail, stats };
    this.autoBox.checked = detail.autoAssign;
    if (!this.iconsShrunk && stats.population > SMALL_ICONS_POPULATION) {
      this.iconsShrunk = true;
      if (this.root.classList.contains("pp-big")) {
        this.chooseIcons(false);
        this.onIconsShrunk?.();
      }
    }
    if (this.root.hidden) return;
    const key = this.structureKey(detail);
    if (key !== this.key && this.canRebuild(key)) {
      this.key = key;
      this.rebuild(detail);
    }
    this.refreshNumbers(detail, stats);
  }

  /** Après la réouverture du panneau ou la fin d'un glisser : remet le panneau à jour. */
  refresh(): void {
    if (this.last) this.update(this.last.detail, this.last.stats);
  }

  private canRebuild(key: string): boolean {
    if (this.pawnDrag !== null || this.boxDrag !== null) return false;
    return performance.now() >= this.holdUntil || key !== this.holdKey;
  }

  /** État d'une boîte hors de la liste (08 §9) : `new` débloquée, jamais ouverte ; `gone` supprimée ; `locked` verrouillée. */
  private lockState(a: ActivityInfo, d: HumanDetail): "new" | "locked" | "gone" {
    if (d.unlock[a.index]! < a.unlockCost) return "locked";
    return d.everOpened[a.index] === 1 ? "gone" : "new";
  }

  /** Ordre des boîtes hors de la liste : supprimées, débloquées, verrouillées par progression décroissante (08 §9, §11). */
  private lockedOrder(d: HumanDetail): ActivityInfo[] {
    const open = new Set(d.activities.map((a) => a.id));
    const rank = (a: ActivityInfo): number => ({ gone: 0, new: 1, locked: 2 })[this.lockState(a, d)];
    const share = (a: ActivityInfo): number => (a.unlockCost === 0 ? 1 : d.unlock[a.index]! / a.unlockCost);
    return this.catalog.activities.filter((a) => !open.has(a.id)).sort((a, b) => rank(a) - rank(b) || share(b) - share(a) || a.index - b.index);
  }

  private structureKey(d: HumanDetail): string {
    return JSON.stringify([
      d.activities.map((a) => [a.id, a.workers, a.machines, a.places, a.slots, a.disabled, a.surface]),
      d.autoAssign,
      d.everOpened,
      d.idleMachines,
      d.popArrivals.length,
      d.popLeaves.length,
      d.machineArrivals.map((x) => x.length),
      d.machineLeaves.map((x) => x.length),
      this.lockedOrder(d).map((a) => [a.index, this.lockState(a, d)]),
    ]);
  }

  // ---- construction ----

  private rebuild(d: HumanDetail): void {
    this.clearSelection();
    this.previewed = [];
    this.auto = d.autoAssign;
    const leaving = this.leavingPlan(d);
    const boxes = d.activities.map((a) => this.box(a, d, leaving));
    const others = this.lockedOrder(d);
    const gone = others.filter((a) => this.lockState(a, d) === "gone").map((a) => this.lockedBox(a, d));
    const locked = others.filter((a) => this.lockState(a, d) !== "gone").map((a) => this.lockedBox(a, d));
    // Un séparateur en pointillé clair entre chaque groupe qui existe : ouvertes, supprimées, pas encore ouvertes.
    const separator = (icon: string, text: string): HTMLElement => {
      const sep = el("div", "pp-sep");
      sep.append(img(icon, "pp-ic"), el("span", undefined, text), el("i", "pp-sep-line"));
      return sep;
    };
    const parts = [
      ...(gone.length > 0 ? [separator("miscellaneous/icon-padlock-open.png", "Déverrouillé"), ...gone] : []),
      ...(locked.length > 0 ? [separator("miscellaneous/icon-padlock-closed.png", "Verrouillé"), ...locked] : []),
    ];
    const anchor = this.lineUnderPointer();
    this.list.replaceChildren(...boxes, ...parts);
    // Une boîte au-dessus a pu changer de hauteur : le défilement compense pour que la ligne sous la souris ne bouge pas.
    const line = anchor === null ? null : this.list.querySelector<HTMLElement>(`[data-line="${anchor.id}"]`);
    if (anchor !== null && line !== null) this.root.scrollTop += line.getBoundingClientRect().top - anchor.top;
  }

  /** La ligne sous la souris et sa position à l'écran, ou `null`. */
  private lineUnderPointer(): { readonly id: string; readonly top: number } | null {
    if (this.pointer === null) return null;
    const line = document.elementFromPoint(this.pointer.x, this.pointer.y)?.closest<HTMLElement>("[data-line]") ?? null;
    if (line === null || !this.list.contains(line)) return null;
    return { id: line.dataset["line"]!, top: line.getBoundingClientRect().top };
  }

  /**
   * Unités en sursis par boîte (08 §6) : la population part d'Inactifs, puis de la boîte la plus basse vers le haut,
   * Blessés seulement à la toute fin ; une machine part de sa ligne d'Inactifs, puis de sa boîte d'activité.
   */
  private leavingPlan(d: HumanDetail): { workers: Map<string, number>; machines: Map<string, number> } {
    const workers = new Map<string, number>();
    let left = d.popLeaves.length;
    const take = (a: ActivityView): void => {
      const n = Math.min(left, a.workers);
      if (n > 0) workers.set(a.id, n);
      left -= n;
    };
    const named = (id: string): ActivityView | undefined => d.activities.find((x) => x.id === id);
    const order = [named("idle"), ...[...d.activities].reverse().filter((a) => a.id !== "idle" && a.id !== "hurt"), named("hurt")];
    for (const a of order) if (a !== undefined) take(a);
    const machines = new Map<string, number>();
    this.catalog.goodIds.forEach((good, g) => {
      const total = d.machineLeaves[g]?.length ?? 0;
      const idle = Math.min(total, d.idleMachines[g] ?? 0);
      if (idle > 0) machines.set(`idle:${good}`, idle);
      const host = d.activities.find((a) => this.byId.get(a.id)?.good === good && this.hostKind(a.id));
      if (host !== undefined && total > idle) machines.set(`${host.id}:${good}`, Math.min(total - idle, host.machines));
    });
    return { workers, machines };
  }

  /** L'activité reçoit une machine (agriculture, pêche, mines). */
  private hostKind(id: string): boolean {
    const k = this.byId.get(id)?.kind;
    return k === "farming" || k === "fishing" || k === "mining";
  }

  /** Icône du produit d'une activité (machine ou type de division), `null` sans produit. */
  private productIcon(info: ActivityInfo): HTMLElement | null {
    if (info.division !== null) {
      const t = this.military.divisions.find((x) => x.id === info.division);
      if (t !== undefined) return imgUrl(unitIconUrl(t.icon, localPlayer()), "pb-sym", unitName(t.id));
    }
    if (info.good !== null) return this.machineIcon(info.good, "pb-sym");
    return null;
  }

  /** Icône de 16 × 16 du produit d'une activité : le fichier 16 × 16 quand il existe, sinon le 32 × 32 réduit. */
  private smallIcon(info: ActivityInfo): HTMLElement {
    const type = this.military.divisions.find((t) => t.id === info.division);
    if (type !== undefined) return imgUrl(unitIconUrl(type.icon, localPlayer(), 16), "pp-ic", unitName(type.id));
    return info.good !== null ? this.machineIcon(info.good, "pp-ic") : el("span", "pp-ic");
  }

  private machineIcon(good: string, className: string): HTMLElement {
    const path = this.catalog.icons[good];
    if (path === undefined) return el("span", `${className} sym`, productSymbol(good));
    return img(className === "pb-sym" ? icon32Path(path) : path, className, productName(good));
  }

  private pawnEl(act: string, kindOfAct: string, p: Pawn): HTMLElement {
    const cell = el("span", `pw pw-${p.state}`);
    cell.dataset["act"] = act;
    cell.dataset["pk"] = p.pk;
    // Seuls les pions présents et hors de Blessés se glissent.
    cell.dataset["sel"] = !this.auto && (p.state === "normal" || p.state === "leaving") && kindOfAct !== "hurt" ? "1" : "0";
    if (cell.dataset["sel"] === "1") cell.dataset["tuto"] = "prod-pawn";
    if (p.pk === "w") {
      cell.append(img(`population/${WORKER_ICON[kindOfAct] ?? "pop-default"}.png`, "pw-ic"));
    } else {
      cell.append(this.machineIcon(p.pk.slice(2), "pw-ic"));
    }
    if (p.state === "coming") {
      cell.dataset["end"] = String(p.end);
      cell.dataset["total"] = String(p.total);
      cell.append(el("i", "pw-bar"));
    }
    const what = p.pk === "w" ? "Bonhomme" : productName(p.pk.slice(2));
    cell.title =
      p.state === "coming" ? (p.pk === "w" ? "Nourriture excédentaire. Population en croissance." : "Arrive bientôt.")
      : p.state === "leaving" ? (p.pk === "w" ? "Pas assez de nourriture. Population en déclin." : "En trop : va bientôt disparaître.")
      : p.state === "empty" ? "Poste vacant : glissez ici un bonhomme ou une machine."
      : kindOfAct === "hurt" ? `${what} blessé : soigné un à la fois, il retourne ensuite dans Inactifs.`
      : "Glissez pour le déplacer, avec ceux à sa droite.";
    return cell;
  }

  /** Une boîte. Ses pions, dans l'ordre de lecture : machines à gauche, puis bonshommes ; à venir et places vides en dernier. */
  private box(a: ActivityView, d: HumanDetail, leaving: ReturnType<ProductionPanel["leavingPlan"]>): HTMLElement {
    const info = this.byId.get(a.id)!;
    const kind = info.kind;
    const box = el("section", "pb");
    box.dataset["act"] = a.id;
    box.dataset["line"] = a.id;
    box.dataset["kind"] = kind;
    box.dataset["tuto"] = "prod-box";

    // Poignée de réorganisation (Inactifs reste en haut : pas de poignée, 08 §2).
    const grip = el("span", "pb-grip");
    if (a.id !== "idle") {
      grip.textContent = "⋮⋮";
      grip.title = "Glisser pour changer la priorité de la ligne.";
      this.bindGrip(grip, box, a.id);
    }

    // Entrée : fer des usines et casernes qui en prennent (08 §4). Sans entrée, la colonne reste vide.
    const input = el("div", "pb-in");
    const arrowIn = el("span", "pb-arrow pb-arrow-in");
    if (info.ironPerUnit > 0) {
      const tile = el("div", "pb-tile");
      tile.dataset["in"] = a.id;
      tile.append(img(icon32Path("goods/goods-iron-ingot.png"), "pb-tile-ic"), el("span"));
      input.append(tile);
      arrowIn.classList.add("on");
    }

    // Colonne centrale : titre et places au-dessus des pions.
    const center = el("div", "pb-center");
    const head = el("div", "pb-head");
    head.append(el("strong", "pb-title", activityName(a.id)));
    const places = el("span", "pb-places");
    places.dataset["places"] = a.id;
    const children = this.catalog.activities.filter((c) => c.parent === a.id && this.lockState(c, d) === "locked");
    if (children.length > 0) {
      const lock = el("span", "pb-lock");
      lock.dataset["tuto"] = "prod-parent";
      lock.append(img("miscellaneous/icon-padlock-open.png", "pb-open-lock", "Débloque d'autres lignes"));
      setTip(lock, () => this.childrenTip(info));
      head.append(lock);
    }
    // Après le cadenas : la longueur de ce texte varie, le cadenas ne doit pas bouger avec elle.
    head.append(places);
    const pawns = el("div", "pb-pawns");
    this.fillPawns(pawns, a, info, d, leaving);
    center.append(head, pawns);

    // Sortie : capacité, fer, ou « existants / limite » (08 §11).
    const output = el("div", "pb-out");
    const arrowOut = el("span", "pb-arrow pb-arrow-out");
    if (kind !== "idle" && kind !== "hurt") {
      const tile = el("div", "pb-tile");
      tile.dataset["out"] = a.id;
      if (kind === "farming" || kind === "fishing") tile.append(el("span"), img("miscellaneous/misc-food-ham.png", "pb-tile-ic"));
      else if (kind === "mining") tile.append(el("span"), img("goods/goods-iron-ingot.png", "pb-tile-ic"));
      else tile.append(el("span"), this.productIcon(info) ?? el("span"));
      if (kind === "factory" && info.good !== null) setTip(tile, () => this.replacesTip(info));
      output.append(tile);
      if (info.hasPlaces) output.append(this.targetArrows(a.id));
      arrowOut.classList.add("on");
    }

    // Croix tout à droite : supprime la ligne (08 §9). Agriculteurs, Pêcheurs, Mineurs, Inactifs et Blessés n'en ont pas.
    const close = el("span", "pb-end");
    if (kind === "factory" || kind === "barracks") {
      const b = el("button", "pb-close");
      b.type = "button";
      b.title = "Supprimer la ligne.";
      b.setAttribute("aria-label", "Supprimer la ligne");
      b.append(img("miscellaneous/misc-red-cross.png", "pb-close-ic"));
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        this.order({ type: "close_activity", activity: a.id });
      });
      close.append(b);
    }
    box.append(grip, input, arrowIn, center, arrowOut, output, close);
    return box;
  }

  /** Flèches de la production visée (08 §7 ter) : ±1, ±5 avec Maj, ±10 avec Ctrl (burst.ts) ; à côté, ±5 sans touche. */
  private targetArrows(activity: string): HTMLElement {
    const box = el("div", "pb-steps");
    for (const [shape, sign, mark, title] of [["pb-step-up", 1, "+", "Augmenter la production visée"], ["pb-step-down", -1, "−", "Diminuer la production visée"]] as const) {
      const change = (n: number): void => this.order({ type: "change_production_target", activity, delta: sign * n });
      const one = el("button", `pb-step ${shape}`, `${mark}1`);
      one.type = "button";
      one.setAttribute("aria-label", title);
      one.title = `${title} (Maj : 5, Ctrl : 10)`;
      onPress(one, change);
      const five = el("button", `pb-step ${shape}`, `${mark}5`);
      five.type = "button";
      five.setAttribute("aria-label", `${title} de 5`);
      five.title = `${title} de 5`;
      onFixedPress(five, BURST_SHIFT, change);
      box.append(one, five);
    }
    return box;
  }

  private fillPawns(into: HTMLElement, a: ActivityView, info: ActivityInfo, d: HumanDetail, leaving: ReturnType<ProductionPanel["leavingPlan"]>): void {
    const kind = info.kind;
    const append = (row: HTMLElement, count: number, leavingCount: number, pk: string): void => {
      for (let i = 0; i < count; i++) row.append(this.pawnEl(a.id, kind, { pk, state: i >= count - leavingCount ? "leaving" : "normal" }));
    };
    const coming = (row: HTMLElement, ends: readonly number[], total: number, pk: string): void => {
      for (const end of ends) row.append(this.pawnEl(a.id, kind, { pk, state: "coming", end, total }));
    };
    if (kind === "idle") {
      // Une ligne de population, puis une ligne par type de machine présent, sans libellé (08 §11).
      const popRow = el("div", "pb-row");
      append(popRow, a.workers, leaving.workers.get(a.id) ?? 0, "w");
      coming(popRow, d.popArrivals, this.catalog.popArrivalTurns, "w");
      if (popRow.childElementCount > 0) into.append(popRow);
      this.catalog.goodIds.forEach((good, g) => {
        const row = el("div", "pb-row");
        append(row, d.idleMachines[g] ?? 0, leaving.machines.get(`idle:${good}`) ?? 0, `m:${good}`);
        coming(row, d.machineArrivals[g] ?? [], this.catalog.machineArrivalTurns, `m:${good}`);
        if (row.childElementCount > 0) into.append(row);
      });
      return;
    }
    const row = el("div", "pb-row");
    if (this.hostKind(a.id) && info.good !== null) append(row, a.machines, leaving.machines.get(`${a.id}:${info.good}`) ?? 0, `m:${info.good}`);
    append(row, a.workers, leaving.workers.get(a.id) ?? 0, "w");
    if (info.hasSlots) {
      // Postes vacants, avec l'icône du bonhomme qui finira dans la boîte (08 §11).
      for (let i = a.workers + a.machines; i < a.slots; i++) row.append(this.pawnEl(a.id, kind, { pk: "w", state: "empty" }));
    }
    if (info.hasPlaces) {
      for (let i = a.workers; i < a.places; i++) {
        const empty = this.pawnEl(a.id, kind, { pk: "w", state: "empty" });
        empty.title = "Place vide. Peut être remplie.";
        row.append(empty);
      }
    }
    // Auto-assignation : un clic barre ce poste et ceux à sa droite, ouvriers et machines compris (08 §7 bis).
    if (d.autoAssign && (info.hasSlots || info.hasPlaces)) {
      const cells = [...row.querySelectorAll<HTMLElement>(".pw:not(.pw-gauge)")];
      cells.forEach((cell, i) => {
        cell.dataset["vac"] = String(i);
        cell.classList.toggle("pw-off", i >= cells.length - a.disabled);
        cell.title = "Cliquez pour désactiver ce poste et ceux à sa droite. Cliquez pour réactiver celui-ci et ceux à sa gauche.";
        cell.append(img("miscellaneous/misc-red-cross.png", "pw-cross"));
      });
    }
    // Jauge de la prochaine place (08 §2.1) : montée jusqu'à 80 % du bas de la case, les 20 % restants arrivent avec la place.
    if (info.tilesPerWorker > 0) {
      const part = (a.surface % info.tilesPerWorker) / info.tilesPerWorker;
      const gauge = this.pawnEl(a.id, kind, { pk: "w", state: "empty" });
      delete gauge.dataset["pk"];
      gauge.classList.add("pw-gauge");
      gauge.style.setProperty("--gauge", `${Math.floor(part * 80)}%`);
      gauge.title = `Prochaine place : ${num(a.surface % info.tilesPerWorker)} / ${num(info.tilesPerWorker)} cases`;
      row.append(gauge);
    }
    into.append(row);
  }

  private lockedBox(info: ActivityInfo, d: HumanDetail): HTMLElement {
    const state = this.lockState(info, d);
    const row = el("section", `pl pl-${state}`);
    row.dataset["line"] = info.id;
    if (state !== "locked") {
      // Boîte débloquée, ou supprimée : un clic la met dans la liste ; la première fois, avec son panneau d'information (08 §9).
      const button = el("span", "pl-name pl-open", activityName(info.id));
      row.append(this.productIcon(info) ?? el("span", "pb-sym"), button, el("span", "pl-state", state === "new" ? "Débloquée" : "Cliquer pour recréer la ligne"));
      row.title = state === "new" ? "Cliquez pour découvrir cette ligne." : "Cliquer pour recréer la ligne.";
      row.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (state === "new") this.showInfo(info);
        this.order({ type: "open_activity", activity: info.id });
      });
      return row;
    }
    row.dataset["lock"] = String(info.index);
    row.dataset["kind"] = info.kind;
    row.dataset["tuto"] = "prod-locked";
    const parent = info.parent === null ? undefined : this.byId.get(info.parent);
    // Agriculteurs, Pêcheurs, Mineurs : la ligne se débloque par ses ouvriers, pas par la machine qu'elle reçoit.
    const sym = parent === undefined ? null : ((this.hostKind(parent.id) ? null : this.productIcon(parent)) ?? img(`population/${WORKER_ICON[parent.kind]}.png`, "pb-sym", activityName(parent.id)));
    const bar = el("div", "pl-bar");
    bar.append(el("i", "pl-fill"));
    bar.append(el("span", "pl-name", activityName(info.id)), el("span", "pl-num"));
    const lock = img("miscellaneous/icon-padlock-closed.png", "pl-lock", "Verrouillé");
    row.append(this.productIcon(info) ?? el("span", "pb-sym"), lock, el("span", "pl-sep"), sym ?? el("span", "pb-sym"), bar);
    setTip(row, () => this.lockedTip(info));
    this.writeLocked(row, info, d.unlock[info.index]!);
    return row;
  }

  /** Panneau d'information d'une ligne débloquée (08 §9) : description et statistiques de l'unité, jusqu'au clic sur « Compris ». */
  private showInfo(info: ActivityInfo): void {
    document.querySelector(".pp-info")?.remove();
    const box = el("div", "pp-info themed");
    const type = this.military.divisions.find((t) => t.id === info.division);
    const host = this.catalog.activities.find((c) => c.good === info.good && c.id !== info.id);
    // Image de l'unité (ou de la machine) en 64 × 64 au-dessus de la description.
    const picture = this.productIcon(info);
    if (picture !== null) {
      picture.classList.add("pp-info-img");
      box.append(picture);
    }
    box.append(type !== undefined ? typePanel(type) : textPanel(activityName(info.id), `Remplace un ${activityName(host?.id ?? "").toLowerCase().replace(/s$/, "")}.`));
    const ok = el("button", "pp-info-ok", "Compris");
    ok.type = "button";
    ok.addEventListener("click", () => box.remove());
    box.append(ok);
    document.body.append(box);
  }

  // ---- infobulles ----

  /**
   * Survol du « ? » du fer : utilisation, production actuelle et maximale, part de chaque boîte, et la représentation des
   * cases de fer sur la carte. Une ligne par ressource quand d'autres seront extraites (08 §11).
   */
  private ironTip(): Node {
    const box = el("div", "pt");
    const d = this.last?.detail;
    if (d === undefined) return box;
    box.append(el("div", "pt-title", "Fer"));
    const figures = el("div", "pt-figures");
    for (const [label, value] of [["Utilisation actuelle", d.ironReserved], ["Production actuelle", d.ironProduced], ["Production maximale", d.ironMax]] as const) {
      figures.append(el("span", undefined, label), el("b", undefined, num(value)));
    }
    box.append(figures);
    const rows = d.activities.filter((a) => a.ironUsed > 0).sort((a, b) => b.ironUsed - a.ironUsed);
    if (rows.length > 0) {
      const grid = el("div", "tip-iron");
      for (const a of rows) {
        const bar = el("div", "tip-ibar");
        const got = el("i", "obt");
        got.style.width = `${(a.ironUsed * 100) / rows[0]!.ironUsed}%`;
        bar.append(got);
        const symbol = this.smallIcon(this.byId.get(a.id)!);
        symbol.title = activityName(a.id);
        grid.append(symbol, bar, el("span", undefined, num(a.ironUsed)));
      }
      box.append(grid);
    }
    const map = el("div", "pt-map");
    const swatch = el("span", "legend-swatch");
    const [red, green, blue] = RESOURCE_LEGEND.iron.rgba;
    swatch.style.setProperty("--hatch", `rgb(${red} ${green} ${blue})`);
    map.append(swatch, el("span", undefined, "Sur la carte, ces hachures marquent les cases de fer (vue « Ressources naturelles » du menu Carte)."));
    box.append(map);
    return box;
  }

  /** Survol de la sortie d'une usine de machines : le métier que la machine remplace, et son icône. */
  private replacesTip(info: ActivityInfo): Node {
    const host = this.catalog.activities.find((c) => c.good === info.good && c.id !== info.id)!;
    const box = el("div", "pt-replace");
    box.append(`Remplace les ${activityName(host.id).toLowerCase()}`, img(`population/${WORKER_ICON[host.kind]}.png`, "pp-ic"));
    return box;
  }

  /** Survol du gigot de l'en-tête : la nourriture par source (08 §3), en bonshommes nourris. */
  private foodTip(): Node {
    const box = el("div", "pt pt-food");
    const d = this.last?.detail;
    if (d === undefined) return box;
    const f = (food: number): string => dec(food / this.catalog.foodPerPawn);
    const row = (left: (string | Node)[], value: number): void => {
      const label = el("span", "pt-food-l");
      label.append(...left);
      box.append(label, el("span", undefined, "→"), el("b", undefined, f(value)));
    };
    row(["Base"], this.catalog.foodBase);
    row([`${f(this.catalog.foodPerCity)} /`, img("miscellaneous/icon-town-16.png", "pp-ic32", "Ville")], this.catalog.foodPerCity * d.cities);
    row([`${f(d.farmPerWorker)} /`, this.machineIcon("tractor", "pp-ic32"), img("population/pop-farmer.png", "pp-ic32", "Agriculteur")], d.wheat);
    row([`${f(d.fishPerWorker)} /`, img("population/pop-fisherman.png", "pp-ic32", "Pêcheur"), this.machineIcon("fishingBoat", "pp-ic32")], d.fish);
    return box;
  }

  private progressRow(c: ActivityInfo, progress: number): HTMLElement {
    const r = el("div", "pt-row");
    const bar = el("span", "pt-bar");
    const fill = el("i");
    fill.style.width = `${Math.min(100, Math.floor((progress * 100) / c.unlockCost))}%`;
    bar.append(fill);
    r.append(el("span", "pt-name", activityName(c.id)), bar, el("span", "pt-num", `${num(progress)} / ${num(c.unlockCost)}`));
    return r;
  }

  /** Survol du cadenas ouvert d'une boîte parente : ses enfants à débloquer et leur barre (08 §11). */
  private childrenTip(parent: ActivityInfo): Node {
    const box = el("div", "pt");
    const d = this.last?.detail;
    const children = this.catalog.activities.filter((c) => c.parent === parent.id);
    box.append(el("div", "pt-title", `Débloqué par ${children.some((c) => c.unlockByPopulation) ? "la population" : activityName(parent.id)}`));
    if (d === undefined) return box;
    for (const c of children) if (this.lockState(c, d) === "locked") box.append(this.progressRow(c, d.unlock[c.index]!));
    const served = d.served[parent.index] ?? 0;
    if (children.some((c) => c.unlockByWorkers || c.unlockByPopulation)) return box;
    box.append(el("div", "pt-note", served > 0 ? `${num(served)} ouvrier(s) servi(s) en fer : ${num(served)} tour(s) de progression par tour.` : `Il manque des ouvriers ou du fer dans « ${activityName(parent.id)} ».`));
    return box;
  }

  /** Survol d'une boîte verrouillée : ce qu'il faut pour la débloquer (08 §9, §11). */
  private lockedTip(c: ActivityInfo): Node {
    const box = el("div", "pt");
    const d = this.last?.detail;
    box.append(el("div", "pt-title", activityName(c.id)));
    if (c.parent === null || d === undefined) return box;
    const parent = this.byId.get(c.parent)!;
    const progress = d.unlock[c.index]!;
    box.append(this.progressRow(c, progress));
    if (c.unlockByPopulation) {
      box.append(el("div", "pt-note", `Se débloque à une population de ${num(c.unlockCost)}.`));
      return box;
    }
    if (c.unlockByWorkers) {
      box.append(el("div", "pt-note", `Se débloque dès que « ${activityName(parent.id)} » compte ${num(c.unlockCost)} ouvriers.`));
      return box;
    }
    const parentOpen = d.activities.some((a) => a.id === parent.id);
    const served = d.served[parent.index] ?? 0;
    const product = parent.division !== null ? unitName(parent.division) : parent.good !== null ? productName(parent.good) : activityName(parent.id);
    box.append(el("div", "pt-note", `Produisez ${product} pour débloquer.`));
    if (!parentOpen) box.append(el("div", "pt-note", `« ${activityName(parent.id)} » est elle-même verrouillée.`));
    else if (served === 0) box.append(el("div", "pt-note", `Il manque des ouvriers ou du fer dans « ${activityName(parent.id)} ».`));
    else box.append(el("div", "pt-note", `${num(served)} ouvrier(s) servi(s) : environ ${num(Math.ceil((c.unlockCost - progress) / served))} tours restants.`));
    return box;
  }

  // ---- nombres mis à jour à chaque tour ----

  private writeLocked(row: HTMLElement, c: ActivityInfo, progress: number): void {
    const fill = row.querySelector<HTMLElement>(".pl-fill");
    if (fill) fill.style.width = `${Math.min(100, Math.floor((progress * 100) / c.unlockCost))}%`;
    const text = row.querySelector<HTMLElement>(".pl-num");
    if (text) text.textContent = `${num(progress)} / ${num(c.unlockCost)}`;
  }

  private refreshNumbers(d: HumanDetail, s: PlayerStats): void {
    this.popText.textContent = num(s.population);
    this.popText.classList.toggle("pp-bad", s.population > d.capacity);
    this.foodText.textContent = num(d.capacity);
    this.newLine.hidden = !this.catalog.activities.some((a) => !d.activities.some((x) => x.id === a.id) && this.lockState(a, d) === "new");
    this.ironText.textContent = `${num(d.ironReserved)} / ${num(d.ironProduced)}`;
    // Rouge et malus si les boîtes demandent plus de fer qu'il n'en est produit (08 §4).
    const short = d.ironWanted > d.ironProduced;
    this.ironLine.classList.toggle("pp-bad", short);
    this.ironMalus.textContent = short ? ` −${100 - Math.floor((d.ironProduced * 100) / d.ironWanted)} % de production` : "";

    for (const a of d.activities) {
      const info = this.byId.get(a.id)!;
      const box = this.list.querySelector<HTMLElement>(`.pb[data-act="${a.id}"]`);
      if (box === null) continue;
      const kind = info.kind;
      const places = box.querySelector<HTMLElement>(".pb-places");
      if (places) {
        places.textContent =
          info.hasSlots ? `${num(a.workers + a.machines)} / ${num(a.slots)} places`
          : info.hasPlaces ? `${num(a.workers)} / ${num(a.places)} places`
          : kind === "idle" || kind === "hurt" ? ""
          : `${num(a.workers)} ouvrier${a.workers > 1 ? "s" : ""}`;
      }
      const tileIn = box.querySelector<HTMLElement>(".pb-tile[data-in]");
      if (tileIn) {
        tileIn.lastElementChild!.textContent = num(a.ironUsed);
        const units = Math.floor((a.workers * info.unitsPerWorker) / info.workersPerUnit);
        tileIn.classList.toggle("pb-bad", a.output < units);
        tileIn.title = `${num(info.ironPerUnit)} par ligne
Besoin satisfait à ${units === 0 ? 100 : Math.floor((a.output * 100) / units)} %`;
      }
      const tileOut = box.querySelector<HTMLElement>(".pb-tile[data-out]");
      if (tileOut) {
        const value = tileOut.firstElementChild!;
        if (kind === "farming" || kind === "fishing") {
          value.textContent = `+${dec(a.output / this.catalog.foodPerPawn)}`;
          tileOut.title = "Augmente la limite de population";
        } else if (kind === "mining") {
          value.textContent = `+${num(a.output)}`;
          tileOut.title = "Sert à produire des machines";
        } else {
          // Production visée (08 §7 ter) : permis par les ouvriers présents / maximum réglé, sans distinguer la formation.
          const unitsFor = (n: number): number => Math.floor((n * info.unitsPerWorker) / info.workersPerUnit);
          value.textContent = info.hasPlaces ? `${num(unitsFor(a.workers))} / ${num(unitsFor(a.places))}` : `${num(a.existing)} / ${num(a.limit)}`;
          tileOut.classList.toggle("pb-bad", a.existing > a.limit);
          if (info.good === null) {
            const elite = this.military.divisions.find((t) => t.id === info.division)?.elite === true;
            const cap = elite ? `
Max ${num(Math.floor(100 / this.military.eliteTroopsRatio))} % de l'infanterie` : "";
            tileOut.title = `${num(a.existing - a.forming)} active(s), ${num(a.forming)} en formation${cap}`;
          }
        }
      }
    }
    for (const c of this.list.querySelectorAll<HTMLElement>(".pw-coming")) {
      const end = Number(c.dataset["end"]);
      const total = Number(c.dataset["total"]);
      const bar = c.querySelector<HTMLElement>(".pw-bar");
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, Math.round(((total - (end - d.tick)) * 100) / total)))}%`;
    }
    // `data-lock` : seulement les boîtes verrouillées ; les boîtes débloquées ou supprimées n'ont pas de barre à écrire.
    for (const row of this.list.querySelectorAll<HTMLElement>(".pl[data-lock]")) {
      const c = this.catalog.activities[Number(row.dataset["lock"])]!;
      this.writeLocked(row, c, d.unlock[c.index]!);
    }
  }

  // ---- ordres ----

  private order(order: HumanOrder): void {
    this.holdKey = this.key;
    this.holdUntil = performance.now() + HOLD_MS;
    this.send(order);
  }

  // ---- glisser des pions : un appui prend le pion sous la souris et ceux de même type à sa droite (08 §11) ----

  /** Les pions glissables de même type que `pawn`, de la boîte, à partir de `pawn` inclus, dans l'ordre de lecture. */
  private groupOf(pawn: HTMLElement): HTMLElement[] {
    const box = pawn.closest<HTMLElement>(".pb");
    if (box === null) return [];
    const all = [...box.querySelectorAll<HTMLElement>(`.pw[data-pk="${pawn.dataset["pk"]}"][data-sel="1"]`)];
    return all.slice(all.indexOf(pawn));
  }

  /** Les postes vacants de la boîte de `cell`, de gauche à droite. */
  private vacantCells(cell: HTMLElement): HTMLElement[] {
    return [...(cell.closest(".pb")?.querySelectorAll<HTMLElement>(".pw[data-vac]") ?? [])];
  }

  /** Montre les croix à 50 % sur les postes qu'un clic sur `cell` changerait (08 §7 bis). */
  private previewOff(cell: HTMLElement | null): void {
    for (const c of this.previewed) c.classList.remove("pw-would");
    this.previewed = [];
    if (cell === null || cell.dataset["vac"] === undefined) return;
    const k = Number(cell.dataset["vac"]);
    const off = cell.classList.contains("pw-off");
    this.previewed = this.vacantCells(cell).filter((c, i) => (off ? i <= k : i >= k) && c.classList.contains("pw-off") === off);
    for (const c of this.previewed) c.classList.add("pw-would");
  }

  private clearSelection(): void {
    for (const e of this.selected) e.classList.remove("pw-sel");
    this.selected = [];
  }

  private select(pawn: HTMLElement | null): void {
    const group = pawn !== null && pawn.dataset["sel"] === "1" ? this.groupOf(pawn) : [];
    if (group.length === this.selected.length && group.every((e, i) => e === this.selected[i])) return;
    this.clearSelection();
    for (const e of group) e.classList.add("pw-sel");
    this.selected = group;
  }

  /**
   * Nombre de pions du glisser que la boîte `to` recevrait, 0 si le dépôt est refusé par les règles visibles : boîte
   * pleine (une place par bonhomme ou machine, 08 §2.1), machine hors de sa boîte ou d'Inactifs, Blessés (08 §2). Une
   * machine prend aussi la place d'un bonhomme, renvoyé dans Inactifs : seules les autres machines la limitent.
   */
  private dropCount(drag: PawnDrag, to: string): number {
    const target = this.byId.get(to);
    if (target === undefined || to === drag.act || to === "hurt") return 0;
    const n = drag.els.length;
    if (drag.kind === "machine") {
      const host = this.catalog.activities.find((c) => c.good === drag.good && (c.kind === "farming" || c.kind === "fishing" || c.kind === "mining"));
      if (to !== "idle" && to !== host?.id) return 0;
    }
    if (target.hasSlots) {
      const a = this.last?.detail.activities.find((x) => x.id === to);
      if (a === undefined) return 0;
      const taken = drag.kind === "machine" ? a.machines : a.workers + a.machines;
      return Math.min(n, Math.max(0, a.slots - taken));
    }
    return n;
  }

  private installPawnDrag(): void {
    this.list.addEventListener("pointermove", (e) => {
      if (this.pawnDrag !== null) return;
      const pawn = (e.target as Element).closest<HTMLElement>(".pw");
      this.select(pawn);
      this.previewOff(pawn);
    });
    this.list.addEventListener("pointerleave", () => {
      if (this.pawnDrag === null) this.clearSelection();
      this.previewOff(null);
    });
    this.list.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.pawnDrag !== null) return;
      const pawn = (e.target as Element).closest<HTMLElement>(".pw");
      // Clic sur un poste vacant : il se désactive avec ceux à sa droite ; sur un poste désactivé, il se réactive avec ceux à sa gauche.
      if (pawn?.dataset["vac"] !== undefined) {
        const k = Number(pawn.dataset["vac"]);
        const vacant = this.vacantCells(pawn).length;
        e.preventDefault();
        this.order({ type: "set_disabled_slots", activity: pawn.dataset["act"]!, count: pawn.classList.contains("pw-off") ? vacant - k - 1 : vacant - k });
        return;
      }
      if (pawn === null || pawn.dataset["sel"] !== "1") return;
      const els = this.groupOf(pawn);
      const pk = pawn.dataset["pk"]!;
      this.pawnDrag = {
        act: pawn.dataset["act"]!,
        kind: pk === "w" ? "worker" : "machine",
        good: pk === "w" ? undefined : pk.slice(2),
        els,
        x: e.clientX,
        y: e.clientY,
        started: false,
        ghost: null,
        over: null,
      };
      e.preventDefault();
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onCancel);
    });
  }

  private readonly onMove = (e: PointerEvent): void => {
    const drag = this.pawnDrag;
    if (drag === null) return;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) <= DRAG_PX) return;
      drag.started = true;
      const ghost = el("div", "pw-ghost");
      ghost.classList.toggle("pp-big", this.root.classList.contains("pp-big"));
      ghost.append(drag.els[0]!.cloneNode(true), el("b", undefined, `× ${drag.els.length}`));
      document.body.append(ghost);
      // L'icône des pions déplacés remplace le curseur (08 §11).
      document.body.classList.add("pw-moving");
      drag.ghost = ghost;
      for (const p of drag.els) p.classList.add("pw-drag");
    }
    drag.ghost!.style.left = `${e.clientX}px`;
    drag.ghost!.style.top = `${e.clientY}px`;
    const over = this.dropBox(drag, e.clientX, e.clientY);
    if (over !== drag.over) {
      drag.over?.classList.remove("pb-over");
      over?.classList.add("pb-over");
      drag.over = over;
    }
  };

  /** La boîte sous la souris qui accepte au moins un pion du glisser. */
  private dropBox(drag: PawnDrag, x: number, y: number): HTMLElement | null {
    for (const e of document.elementsFromPoint(x, y)) {
      const box = e.closest<HTMLElement>(".pb");
      if (box !== null) return this.dropCount(drag, box.dataset["act"]!) > 0 ? box : null;
    }
    return null;
  }

  private readonly onUp = (e: PointerEvent): void => {
    const drag = this.pawnDrag;
    if (drag === null) return;
    const target = drag.started ? this.dropBox(drag, e.clientX, e.clientY) : null;
    this.endPawnDrag();
    if (target !== null) {
      const to = target.dataset["act"]!;
      const count = this.dropCount(drag, to);
      this.order({
        type: "move_pawn",
        from: drag.act,
        to,
        kind: drag.kind,
        ...(drag.good !== undefined ? { good: drag.good } : {}),
        count,
      });
    }
    this.refresh();
  };

  private readonly onCancel = (): void => {
    this.endPawnDrag();
    this.refresh();
  };

  private endPawnDrag(): void {
    const drag = this.pawnDrag;
    if (drag === null) return;
    drag.ghost?.remove();
    document.body.classList.remove("pw-moving");
    drag.over?.classList.remove("pb-over");
    for (const p of drag.els) p.classList.remove("pw-drag");
    this.pawnDrag = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
  }

  // ---- réorganisation des boîtes par la poignée (08 §2) ----

  private bindGrip(grip: HTMLElement, box: HTMLElement, act: string): void {
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.boxDrag !== null) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      this.boxDrag = { act, box, x: e.clientX, y: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, ghost: null };
      window.addEventListener("pointermove", this.onBoxMove);
      window.addEventListener("pointerup", this.onBoxUp);
      window.addEventListener("pointercancel", this.endBoxDrag);
    });
  }

  private readonly onBoxMove = (e: PointerEvent): void => {
    const drag = this.boxDrag;
    if (drag === null) return;
    if (drag.ghost === null) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) <= DRAG_PX) return;
      drag.ghost = el("div", "pb-ghost");
      drag.ghost.classList.toggle("pp-big", this.root.classList.contains("pp-big"));
      drag.ghost.style.width = `${drag.box.offsetWidth}px`;
      drag.ghost.append(drag.box.cloneNode(true));
      document.body.append(drag.ghost);
      document.body.classList.add("pw-moving");
      drag.box.classList.add("pb-dragging");
    }
    drag.ghost.style.left = `${e.clientX - drag.grabX}px`;
    drag.ghost.style.top = `${e.clientY - drag.grabY}px`;
    const r = this.list.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      this.hideGap();
      return;
    }
    // Le trait suit l'interstice le plus proche, même au-dessus d'une boîte.
    const { gap, at } = this.nearestGap(e.clientY);
    this.gap = gap;
    this.gapMark.style.top = `${at - r.top - 2}px`;
    this.list.append(this.gapMark);
  };

  private readonly onBoxUp = (): void => {
    const drag = this.boxDrag;
    if (drag === null) return;
    const gap = this.gap;
    const from = [...this.list.querySelectorAll<HTMLElement>(".pb")].findIndex((b) => b === drag.box);
    this.endBoxDrag();
    // `position` est l'indice final : la boîte glissée quitte d'abord sa place. Les deux interstices qui la bordent ne la déplacent pas.
    if (gap >= 0 && gap !== from && gap !== from + 1) this.order({ type: "set_activity_order", activity: drag.act, position: gap > from ? gap - 1 : gap });
  };

  private readonly endBoxDrag = (): void => {
    const drag = this.boxDrag;
    if (drag === null) return;
    drag.ghost?.remove();
    document.body.classList.remove("pw-moving");
    drag.box.classList.remove("pb-dragging");
    this.boxDrag = null;
    this.hideGap();
    window.removeEventListener("pointermove", this.onBoxMove);
    window.removeEventListener("pointerup", this.onBoxUp);
    window.removeEventListener("pointercancel", this.endBoxDrag);
    this.refresh();
  };

  /** L'interstice le plus proche de `y` (08 §11) : `gap` est l'indice de la boîte qui suit, jamais avant Inactifs. */
  private nearestGap(y: number): { gap: number; at: number } {
    const rects = [...this.list.querySelectorAll<HTMLElement>(".pb")].map((b) => b.getBoundingClientRect());
    let best = { gap: rects.length, at: rects[rects.length - 1]!.bottom + 4 };
    for (let i = 1; i < rects.length; i++) {
      const at = (rects[i - 1]!.bottom + rects[i]!.top) / 2;
      if (Math.abs(y - at) < Math.abs(y - best.at)) best = { gap: i, at };
    }
    return best;
  }

  private hideGap(): void {
    this.gap = -1;
    this.gapMark.remove();
  }
}
