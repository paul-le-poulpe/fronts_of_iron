// Fenêtre d'un front (05-Fronts §11.4), posée sur la carte. Bandeau (titre, interrupteur « Sélection avancée »,
// boutons d'attaque, fermeture et retour), forces de percée et réaction rapide du joueur, capsule du joueur (seconde
// ligne, première ligne), barre verticale, capsule de l'adversaire (première ligne de la même largeur, seconde ligne
// comprimée), sa réaction rapide et ses boîtes de percée comprimées, zone des avions réservée.
// Entre chaque première ligne et la barre : ses statistiques de combat par rangée, et ses totaux sous son titre (frontstats.ts).
// Les deux camps sont visibles (pas de brouillard de guerre). La page n'applique aucune règle : elle affiche ce que
// le moteur envoie (`FrontView`, `DivisionView`) et envoie des ordres (`move_division`, `start_front_attack`, ...).
// Réaction rapide et boîtes de percée (05-Fronts §4.6, §11.4) : des divisions de `line` « rapid » et « box ».
//
// Le DOM est construit une fois. `draw` ne remplace que le contenu des rangées de pions et des textes : un bouton
// survit entre `pointerdown` et `click`.

import "./forces.css";
import { countTag } from "./counttag.ts";
import { coveragePercent, divisionsAt, opponentOf, statePercent, typeOf } from "./divisions.ts";
import { Dnd, type DndHost, type ZoneView } from "./dnd.ts";
import { attachPawnPanels, attachTextPanel, frontWidthIcon, hidePanel, motorIcon, textPanel } from "./infopanels.ts";
import { STAT_KINDS, firstLineStats, formatStat, type FirstLineStats, type StatKind } from "./frontstats.ts";
import { unitIconUrl } from "./uniticons.ts";
import { localPlayer, nicheLetters, playerName } from "./names.ts";
import { estimateBreakthrough, estimateFrontAttack } from "./prediction.ts";
import { breakthroughPredictionPanel, frontPredictionPanel } from "./predictionpanel.ts";
import { pawnOrder, renderZone } from "./pawn.ts";
import { STAT_TITLE, drawTotals, statIcon, statTotals, type Totals } from "./stattotals.ts";
import { combatSummary, dismissCombat, isDismissed, isViewed, localWon } from "./combatreplay.ts";
import { type BreakthroughView, type CombatView, type DivisionView, type FrontView, type HumanOrder, type MilitaryCatalog } from "./protocol.ts";
import { num } from "./format.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Une rangée d'une colonne : le fond de sa niche, ses lettres, son pourcentage (première ligne), son contenu. */
interface RowRefs {
  readonly niche: string;
  readonly zone: HTMLElement;
  readonly pct: HTMLElement | null;
  /** Rectangle élargi au survol d'une rangée comprimée. */
  readonly pop: HTMLElement | null;
  /** Message d'une rangée d'infanterie vide ; `null` pour les autres niches. */
  readonly need: HTMLElement | null;
}

interface Column {
  readonly col: HTMLElement;
  readonly rows: RowRefs[];
  /** Pertes du dernier round, à droite du titre (première ligne seulement). */
  readonly loss: HTMLElement | null;
  /** Totaux de la première ligne sous le titre : un nombre et une barre par statistique (`STAT_KINDS`). */
  readonly totals: Totals | null;
}

/** Colonne de statistiques d'une première ligne : par niche, une ligne par statistique (`lines`) et son nombre (`values`). */
interface Gutter {
  readonly root: HTMLElement;
  readonly lines: HTMLElement[][];
  readonly values: HTMLElement[][];
  /** Pertes de chaque niche au dernier round : « −N », vide sans perte. */
  readonly losses: HTMLElement[];
}

/** Largeur minimale de la première ligne du joueur (px) : en dessous, la fenêtre défile horizontalement. */
const FIRST_MIN = 200;
/** Combats du front gardés dans son historique (06-Combat-Simplifie §2 ; auteur, 5 novembre 2026). */
const HISTORY_SIZE = 4;

/** Une boîte de percée du joueur : sa carte dans la liste, et sa vue étendue (rangées par niche), construites une fois. */
interface BoxUi {
  readonly id: number;
  readonly root: HTMLElement;
  readonly motor: MotorUi;
  readonly launch: HTMLButtonElement;
  readonly compact: HTMLElement;
  readonly pop: HTMLElement;
  readonly popMotor: MotorUi;
  readonly popLaunch: HTMLButtonElement;
  /** Rangées de la boîte (à gauche de la vue étendue), puis de la première ligne adverse (à droite). */
  readonly rows: RowRefs[];
  readonly theirRows: RowRefs[];
}

/** « Motorisée » ou « Au pas » d'une boîte, avec son symbole (icône de 16 × 16 px : camion ou pieds). */
interface MotorUi {
  readonly root: HTMLElement;
  readonly text: HTMLElement;
  readonly icon: HTMLImageElement;
  motorized: boolean;
}

/** Texte du panneau de survol de « Motorisée » / « Au pas » (05-Fronts §7.2, §11.4). */
const MOTOR_TIPS = {
  yes: ["Motorisée", "Toutes les unités de ce groupe sont motorisées. Quand la première ligne adverse est percée, le front fait un saut trois fois plus long que celui d’une force à pied."],
  no: ["Au pas", "Une partie des unités de ce groupe avance au pas. Donc il avance lentement. Pour avancer plus loin, ne mettre que des unités motorisées."],
} as const;

/** Une percée en cours : sa carte dans le bandeau, construite une fois ; le tableau est refait à chaque tour. */
interface BtUi {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  /** Flèche rouge clignotante à droite du titre, pendant un combat. */
  readonly arrow: HTMLElement;
  readonly body: HTMLElement;
  readonly phase: HTMLElement;
  /** « Avancée de x% sur ce front ». */
  readonly progress: HTMLElement;
}

/** Une flèche rouge qui clignote (05-Fronts §11.4) : `left` la fait pointer vers la gauche. Éteinte tant qu'elle n'a pas `on`. */
function arrow(left: boolean): HTMLElement {
  return el("span", `fw-arrow${left ? " l" : ""}`);
}

/** Texte de la ligne du bas d'une percée, par phase (`BreakthroughView.phase`) ; `s` : secondes restantes du délai. */
const PHASE_TEXT: readonly ((s: number) => string)[] = [
  (s) => `Préparation de l'assaut : ${s} s`,
  () => "Assaut première ligne",
  (s) => `Première ligne percée, contre-attaque en préparation : ${s} s`,
  () => "Contre-attaque des défenseurs en cours",
  (s) => `Percée accomplie, avancée du front dans : ${s} s`,
  (s) => `Percée échouée, repli : ${s} s`,
  (s) => `Première ligne percée, mais une contre-attaque a limité l'avancée. ${s} s`,
];

/** Boîtes de percée comprimées de l'adversaire : hauteur d'une boîte et d'un intervalle, et de la boîte « ··· » (px). */
const CBOX_STEP = 50;
const CDOTS_STEP = 26;

/** Largeur d'un rectangle élargi (zone comprimée de l'adversaire, §11.4), et pions par ligne qui y tiennent côte à côte. */
const POP_WIDTH = 240;
const POP_PER_LINE = 5;

export class FrontWindow implements DndHost {
  readonly military: MilitaryCatalog;
  private readonly root: HTMLElement;
  private readonly send: (order: HumanOrder) => void;
  private readonly onBack: () => void;
  private readonly dnd: Dnd;
  private readonly win: HTMLElement;
  private readonly title: HTMLElement;
  private readonly advancedBox: HTMLInputElement;
  private readonly attackButton: HTMLButtonElement;
  /** Texte du bouton d'attaque, en bas de son panneau de prédiction. */
  private attackNote = "";
  private readonly backButton: HTMLButtonElement;
  private readonly onLaunch: (front: number, box: number) => void;
  private readonly columns: {
    readonly o2: Column;
    readonly o1: Column;
    readonly rapid: Column;
    readonly t1: Column;
    readonly t2: Column;
    readonly rapidT: Column;
  };
  private readonly gutOurs: Gutter;
  private readonly gutTheirs: Gutter;
  private readonly mainEl: HTMLElement;
  private readonly theirsSide: HTMLElement;
  private readonly pierceCol: HTMLElement;
  private readonly pierceList: HTMLElement;
  private readonly plus: HTMLElement;
  private readonly pierceT: HTMLElement;
  private readonly pierceTList: HTMLElement;
  private readonly pierceTPop: HTMLElement;
  private readonly boxes = new Map<number, BoxUi>();
  private readonly strip: HTMLElement;
  private readonly btCards = new Map<number, BtUi>();
  private btOrder = "";
  private tick = 0;
  private fromTabFlag = false;
  private frontId = 0;
  private fronts: readonly FrontView[] = [];
  private divisions: readonly DivisionView[] = [];
  private byId = new Map<number, DivisionView>();
  /** Historique des combats du front ouvert (06-Combat-Simplifie §2) ; un clic sur une ligne ouvre le replay. */
  private readonly history: HTMLElement;
  private combats: readonly CombatView[] = [];
  /** Lignes affichées par `history` : combats et combats visionnés. */
  private historyKey = "";
  onReplay: ((c: CombatView) => void) | null = null;

  constructor(
    root: HTMLElement,
    military: MilitaryCatalog,
    send: (order: HumanOrder) => void,
    onBack: () => void,
    onLaunch: (front: number, box: number) => void,
  ) {
    this.root = root;
    this.military = military;
    this.send = send;
    this.onBack = onBack;
    this.onLaunch = onLaunch;
    this.dnd = new Dnd(this);

    this.win = el("div", "fw themed");
    this.title = el("div", "fw-title");

    // Bandeau : moitié du joueur (titre, interrupteur, attaque) | moitié adverse (retour, fermeture).
    const head = el("div", "fw-head");
    const hl = el("div", "fw-hl");
    const sw = el("label", "fw-sw");
    this.advancedBox = el("input");
    this.advancedBox.type = "checkbox";
    this.advancedBox.addEventListener("change", () => this.dnd.modeChanged());
    sw.append(this.advancedBox, el("span", "fw-switch"), el("span", undefined, "Sélection avancée"));
    this.attackButton = el("button", "fw-btn", "Attaque sur tout le front");
    this.attackButton.type = "button";
    this.attackButton.dataset.tuto = "attack";
    this.attackButton.addEventListener("click", () => this.startAttack());
    attachTextPanel(this.attackButton, () => this.attackPrediction());
    const barrage = el("button", "fw-btn", "Barrage d'artillerie");
    barrage.type = "button";
    barrage.disabled = true;
    barrage.title = "Hors périmètre : sans effet.";
    hl.append(this.title, sw, el("div", "fw-spacer"), this.attackButton, barrage);
    const hr = el("div", "fw-hr");
    this.backButton = el("button", "fw-btn", "← Retour");
    this.backButton.type = "button";
    this.backButton.hidden = true;
    this.backButton.addEventListener("click", () => {
      this.close();
      this.onBack();
    });
    const close = el("button", "fw-btn fw-close", "✕");
    close.type = "button";
    close.addEventListener("click", () => this.close());
    hr.append(this.backButton, close);
    head.append(hl, hr);

    // Corps : côté du joueur | barre | côté adverse.
    const main = el("div", "fw-main");
    const ours = el("div", "fw-side ours");
    const theirs = el("div", "fw-side theirs");
    const pierce = el("div", "fw-col fw-pierce");
    this.pierceList = el("div", "fw-plist");
    this.plus = el("div", "fw-pplus", "+");
    this.plus.title = "Déposez des divisions ici pour créer une nouvelle boîte de percée.";
    const retour = el("div", "fw-retour", "Retour à la réserve nationale");
    retour.dataset.drop = "reserve";
    // Le « + » est le dernier élément de la liste : juste après la dernière boîte, en haut de la colonne si elle est vide.
    this.pierceList.append(this.plus);
    const pierceLab = el("div", "fw-lab", "Forces de percée");
    pierceLab.dataset.tuto = "pierce";
    pierce.append(pierceLab, this.pierceList, retour);
    this.pierceCol = pierce;
    // Leçons du tutoriel (07-Tutoriel.md) : titres des colonnes du joueur, niches de sa première ligne.
    const rapid = this.column("Réaction rapide", false, false, undefined, "rapid");
    rapid.col.classList.add("fw-rapid");
    const o2 = this.column("Seconde ligne", false, false, undefined, "lines");
    const o1 = this.column("Première ligne", true, false, "ours", "lines");
    // La seconde ligne du joueur absorbe le manque de place : la première garde au moins `FIRST_MIN` et au plus ce que le côté adverse peut porter.
    o2.col.classList.add("fw-second");
    o1.col.classList.add("fw-first");
    const t1 = this.column("Première ligne", true, false, "theirs");
    const t2 = this.column("Seconde ligne", false, true);
    const rapidT = this.column("Réaction rapide", false, true);
    this.columns = { o2, o1, rapid, t1, t2, rapidT };
    const capsuleOurs = el("div", "fw-capsule");
    capsuleOurs.append(o2.col, o1.col);
    const capsuleTheirs = el("div", "fw-capsule");
    capsuleTheirs.append(t1.col, t2.col);
    // Statistiques de combat des rangées de première ligne, entre la capsule et la barre (frontstats.ts).
    this.gutOurs = this.gutter(false);
    this.gutTheirs = this.gutter(true);
    this.theirsSide = theirs;
    ours.append(pierce, rapid.col, capsuleOurs, this.gutOurs.root);
    // Boîtes de percée de l'adversaire : comprimées ; au survol de la colonne, un cadre vers la gauche avec toutes les boîtes.
    this.pierceT = el("div", "fw-col comp fw-pierce-c");
    this.pierceTList = el("div", "fw-plist");
    this.pierceTPop = el("div", "fw-cpop");
    this.pierceT.append(el("div", "fw-lab", "Percée"), this.pierceTList, this.pierceTPop);
    theirs.append(this.gutTheirs.root, capsuleTheirs, rapidT.col, this.pierceT);
    main.append(ours, theirs);
    this.mainEl = main;

    const air = el("div", "fw-air", "ZONE DES AVIONS (RÉSERVÉE)");
    // Percées en cours (§11.4) : sous le bandeau, masqué quand il n'y en a pas.
    this.strip = el("div", "fw-bts");
    this.strip.hidden = true;
    this.history = el("div", "fw-history");
    this.win.append(head, this.strip, this.history, main, air);
    root.replaceChildren(this.win);

    // Les rangées gardent leur largeur : elles sont redessinées si la fenêtre change de taille.
    new ResizeObserver(() => {
      if (this.isOpen) this.draw();
    }).observe(this.win);
  }

  // ---- DndHost ----

  advanced(): boolean {
    return this.advancedBox.checked;
  }

  division(id: number): DivisionView | undefined {
    return this.byId.get(id);
  }

  dragging(on: boolean): void {
    this.win.classList.toggle("dragging", on);
  }

  /** Un glisser parti de l'onglet des forces : comme un glisser de la fenêtre, sans la zone de retour (les pions viennent de la réserve). */
  externalDrag(on: boolean): void {
    this.win.classList.toggle("dragging", on);
    this.win.classList.toggle("ext", on);
  }

  /**
   * Dépose sur une ligne du joueur (`line:front:ligne`, ligne `first`, `second` ou `rapid`), sur une boîte de percée
   * (`box:front:boîte`, boîte 0 : la boîte « + », qui en crée une) ou sur la zone de retour (`reserve`).
   */
  drop(target: string, ids: readonly number[]): void {
    const [kind, front, line] = target.split(":");
    if (kind === "line") {
      const f = Number(front);
      const l = line === "first" || line === "rapid" ? line : "second";
      const list = ids.filter((id) => {
        const d = this.byId.get(id);
        return d !== undefined && !(d.front === f && d.line === l && d.status !== "moving");
      });
      if (list.length > 0) this.send({ type: "move_division", ids: list, front: f, line: l });
    } else if (kind === "box") {
      const f = Number(front);
      const box = Number(line);
      const list = ids.filter((id) => {
        const d = this.byId.get(id);
        return d !== undefined && !(box !== 0 && d.front === f && d.line === "box" && d.box === box && d.breakthrough === 0 && d.status !== "moving");
      });
      if (list.length > 0) this.send({ type: "move_division", ids: list, front: f, line: "box", box });
    } else if (kind === "reserve") {
      const list = ids.filter((id) => this.byId.get(id)?.front !== 0);
      if (list.length > 0) this.send({ type: "move_division", ids: list, front: 0 });
    }
  }

  // ---- ouverture ----

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get openFront(): number {
    return this.isOpen ? this.frontId : 0;
  }

  /** Ouverte depuis l'onglet des forces ? (bouton « ← Retour »). */
  get fromTab(): boolean {
    return this.fromTabFlag;
  }

  /** `fromTab` : ouverte depuis l'onglet des forces, donc avec le bouton « ← Retour ». */
  open(front: FrontView, fromTab: boolean): void {
    this.fromTabFlag = fromTab;
    this.frontId = front.id;
    this.backButton.hidden = !fromTab;
    this.root.hidden = false;
    this.advancedBox.checked = false;
    this.dnd.cancel();
    this.draw();
  }

  close(): void {
    this.dnd.cancel();
    hidePanel();
    this.root.hidden = true;
    this.frontId = 0;
  }

  /** Nouvelle liste des combats du joueur local. */
  setCombats(combats: readonly CombatView[]): void {
    this.combats = combats;
    this.redrawHistory();
  }

  /** Redessine l'historique (un combat vient d'être visionné). */
  redrawHistory(): void {
    if (this.isOpen) this.drawHistory();
  }

  /**
   * Historique du front : ses `HISTORY_SIZE` derniers combats, sauf ceux retirés par leur croix. Un combat pas encore
   * visionné clignote, en bleu si le joueur local a gagné, en rouge sinon.
   */
  private drawHistory(): void {
    const mine = this.combats.filter((c) => c.front === this.frontId && !isDismissed(c.id)).slice(-HISTORY_SIZE).reverse();
    this.history.hidden = mine.length === 0;
    // `draw` passe ici dès que les divisions changent : refaire les lignes relancerait leur clignotement et perdrait le clic en cours.
    const key = mine.map((c) => `${c.id}:${isViewed(c.id)}`).join(",");
    if (key === this.historyKey) return;
    this.historyKey = key;
    this.history.replaceChildren(
      el("span", "fw-history-title", "Derniers combats :"),
      ...mine.map((c) => {
        const unseen = isViewed(c.id) ? "" : localWon(c, this.military, localPlayer()) ? " unseen win" : " unseen lose";
        const row = el("span", `fw-history-row${unseen}`);
        const b = el("button", "fw-history-open", combatSummary(c));
        b.type = "button";
        b.title = "Revoir le combat";
        b.addEventListener("click", () => this.onReplay?.(c));
        // La croix retire le combat de la liste et son icône de la carte.
        const x = el("button", "fw-history-x", "✕");
        x.type = "button";
        x.title = "Retirer ce combat";
        x.addEventListener("click", () => dismissCombat(c.id));
        row.append(b, x);
        return row;
      }),
    );
  }

  /** Bouton d'attaque sur tout le front : compte à rebours avant la prochaine attaque du camp (06-Combat-Simplifie §1). */
  private drawAttackButton(front: FrontView): void {
    const me = front.players.indexOf(localPlayer());
    const ready = front.sides[me]!.attackReadyAt;
    const waiting = ready > this.tick;
    const seconds = Math.max(0, Math.ceil((ready - this.tick) / this.military.combatTurns));
    this.attackButton.textContent = waiting ? `Prochaine attaque dans ${seconds} s` : "Attaque sur tout le front";
    this.attackButton.disabled = !front.active || waiting;
    this.attackNote = `Le combat a lieu aussitôt, en une fois, et s'affiche tout de suite. Ensuite, ${Math.round(this.military.attackCooldownTurns / this.military.combatTurns)} s avant la prochaine attaque de ce camp.`;
    this.attackButton.title = front.active ? "" : "Seulement sur un front actif.";
  }

  /** Divisions des deux camps sur le front ouvert, pour le panneau de prédiction. */
  private sides(): { readonly front: FrontView; readonly me: number; readonly other: number; readonly mine: DivisionView[]; readonly theirs: DivisionView[] } | null {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined || !front.active) return null;
    const me = localPlayer();
    if (!front.players.includes(me)) return null;
    const other = front.players[0] === me ? front.players[1] : front.players[0];
    const here = this.divisions.filter((d) => d.front === front.id);
    return { front, me, other, mine: here.filter((d) => d.owner === me), theirs: here.filter((d) => d.owner === other) };
  }

  private attackPrediction(): HTMLElement | null {
    const s = this.sides();
    if (s === null) return null;
    return frontPredictionPanel(estimateFrontAttack(this.military, s.mine, s.theirs, s.front.connections.length), s.me, s.other, this.attackNote);
  }

  private breakthroughPrediction(box: number): HTMLElement | null {
    const s = this.sides();
    if (s === null) return null;
    const force = this.inBox(s.mine, box);
    if (force.length === 0) return null;
    return breakthroughPredictionPanel(estimateBreakthrough(this.military, force, s.theirs), s.me, s.other, "Choisir l'axe de la percée sur la carte.");
  }

  /** À appeler à chaque tour. */
  refresh(fronts: readonly FrontView[], divisions: readonly DivisionView[], tick: number): void {
    const changed = fronts !== this.fronts || divisions !== this.divisions;
    const tickChanged = tick !== this.tick;
    this.tick = tick;
    this.fronts = fronts;
    if (divisions !== this.divisions) {
      this.divisions = divisions;
      this.byId = new Map(divisions.map((d) => [d.id, d]));
    }
    if (!this.isOpen) return;
    if (!fronts.some((f) => f.id === this.frontId)) {
      this.close();
      return;
    }
    if (changed) {
      this.dnd.prune();
      this.draw();
    } else if (tickChanged) {
      // Le délai d'une percée et celui de l'attaque sur tout le front se décomptent à chaque tour.
      const front = fronts.find((f) => f.id === this.frontId);
      if (front !== undefined) {
        this.drawStrip(front);
        this.drawAttackButton(front);
      }
    }
  }

  // ---- percées en cours (§11.4) ----

  /** Un petit tableau par percée, des deux camps : ce qui perce, ce qui défend ; la croix arrête les siennes. */
  private drawStrip(front: FrontView): void {
    const player = localPlayer();
    const ids = new Set(front.breakthroughs.map((b) => b.id));
    for (const [id, ui] of this.btCards) {
      if (ids.has(id)) continue;
      ui.root.remove();
      this.btCards.delete(id);
    }
    for (const bt of front.breakthroughs) {
      let ui = this.btCards.get(bt.id);
      if (ui === undefined) {
        ui = this.createBtCard(bt);
        this.btCards.set(bt.id, ui);
      }
      this.updateBtCard(ui, front, bt, player);
    }
    // L'ordre des cartes ne change que si des percées apparaissent ou disparaissent : les boutons gardent leur place.
    const order = front.breakthroughs.map((b) => b.id).join(",");
    if (order !== this.btOrder) {
      this.btOrder = order;
      this.strip.replaceChildren(...front.breakthroughs.map((b) => this.btCards.get(b.id)!.root));
    }
    this.strip.hidden = front.breakthroughs.length === 0;
  }

  private createBtCard(bt: BreakthroughView): BtUi {
    const mine = bt.owner === localPlayer();
    const root = el("div", `fw-bt ${mine ? "mine" : "theirs"}`);
    const head = el("div", "fw-bt-head");
    const title = el("span", "fw-bt-title");
    const arr = arrow(!mine);
    const name = el("span", "fw-bt-name");
    name.append(title, arr);
    head.append(name);
    if (mine) {
      const cross = el("button", "fw-bt-cross", "✕");
      cross.type = "button";
      cross.title = "Arrêter la percée";
      cross.addEventListener("click", () => this.send({ type: "cancel_breakthrough", id: bt.id }));
      head.append(cross);
    }
    const body = el("div", "fw-bt-body");
    const phase = el("div", "fw-bt-phase");
    const progress = el("div", "fw-bt-progress");
    root.append(head, body, phase, progress);
    return { root, title, arrow: arr, body, phase, progress };
  }

  private updateBtCard(ui: BtUi, front: FrontView, bt: BreakthroughView, player: number): void {
    const m = this.military;
    const mine = bt.owner === player;
    const boxes = front.boxes.filter((b) => b.owner === bt.owner);
    const number = boxes.findIndex((b) => b.id === bt.box) + 1;
    ui.title.textContent = mine ? `Percée ${Math.max(1, number)}` : `Percée de ${playerName(bt.owner)}`;
    const engaged = this.divisions.filter((d) => d.breakthrough === bt.id);
    const attack = engaged.filter((d) => d.owner === bt.owner);
    const defense = engaged.filter((d) => d.owner !== bt.owner);
    const table = el("table");
    const header = el("tr");
    header.append(el("th"), el("th", undefined, "Perce"), el("th", undefined, "Défense"));
    table.append(header);
    const cell = (list: readonly DivisionView[]): HTMLElement => {
      const td = el("td");
      if (list.length === 0) {
        td.textContent = "·";
        return td;
      }
      const state = Math.round(list.reduce((sum, d) => sum + statePercent(m, d), 0) / list.length);
      td.append(String(list.length), el("small", undefined, ` ${state} %`));
      return td;
    };
    for (const niche of m.niches) {
      const a = attack.filter((d) => typeOf(m, d).niche === niche.id);
      const d = defense.filter((x) => typeOf(m, x).niche === niche.id);
      if (a.length === 0 && d.length === 0) continue;
      const row = el("tr");
      const icon = el("td");
      const img = el("img", "fw-bt-icon");
      const shown = (a[0] ?? d[0])!;
      img.src = unitIconUrl(typeOf(m, shown).icon, shown.owner);
      img.alt = "";
      icon.append(img);
      row.append(icon, cell(a), cell(d));
      table.append(row);
    }
    ui.body.replaceChildren(table);
    // Les sept phases d'une percée (§7.2) : cinq délais (secondes restantes) et deux combats.
    const seconds = Math.max(0, Math.ceil((bt.until - this.tick) / m.combatTurns));
    ui.phase.textContent = PHASE_TEXT[bt.phase]?.(seconds) ?? "";
    ui.arrow.classList.toggle("on", front.active && (bt.phase === 1 || bt.phase === 3));
    // Millièmes de route → pour cent, une décimale au plus.
    const percent = bt.advance / 10;
    ui.progress.textContent = `Avancée de ${Number.isInteger(percent) ? percent : percent.toFixed(1).replace(".", ",")}% sur ce front`;
  }

  // ---- construction ----

  /**
   * Colonne de statistiques à côté d'une première ligne : même structure que `column` (une marge de la hauteur du titre,
   * cinq rangées de même hauteur), donc les trois statistiques d'une niche sont alignées sur sa rangée. Du côté du joueur
   * (`left` faux) : icône puis nombre, alignés à gauche contre la capsule ; côté adverse, le miroir (nombre puis icône,
   * alignés à droite contre la capsule).
   */
  private gutter(left: boolean): Gutter {
    const root = el("div", `fw-gut${left ? " l" : ""}`);
    const rows = el("div", "fw-rows");
    const lines: HTMLElement[][] = [];
    const values: HTMLElement[][] = [];
    const losses: HTMLElement[] = [];
    for (let i = 0; i < this.military.niches.length; i++) {
      const cell = el("div", "fw-gcell");
      const stack = el("div", "fw-gstack");
      const nicheLines: HTMLElement[] = [];
      const nicheValues: HTMLElement[] = [];
      for (const kind of STAT_KINDS) {
        const line = el("div", `fw-st ${kind}`);
        line.title = STAT_TITLE[kind];
        const value = el("span", undefined, "0");
        line.append(statIcon(kind), value);
        stack.append(line);
        nicheLines.push(line);
        nicheValues.push(value);
      }
      // Quatrième ligne : les pertes du dernier round. Vide (même hauteur) hors combat, pour que les statistiques ne bougent pas.
      const loss = el("div", "fw-st loss");
      loss.title = "État perdu au dernier round de combat (une seconde), en pourcent d'une division";
      stack.append(loss);
      losses.push(loss);
      lines.push(nicheLines);
      values.push(nicheValues);
      cell.append(stack);
      rows.append(cell);
    }
    root.append(el("div", "fw-lab"), rows);
    return { root, lines, values, losses };
  }

  /**
   * Une colonne de cinq rangées, une par niche. `coverage` : première ligne, avec le pourcentage de couverture (et, avec un
   * titre, les pertes du dernier round à droite du titre) ; `compressed` : zone comprimée. `side` : première ligne d'un
   * camp avec titre, qui porte les totaux de ses statistiques sous le titre. `tuto` : leçon du tutoriel sur le titre ;
   * la première ligne du joueur porte aussi une leçon par niche, sur ses lettres.
   */
  private column(label: string | null, coverage: boolean, compressed: boolean, side?: "ours" | "theirs", tuto?: string): Column {
    const col = el("div", `fw-col${compressed ? " comp" : ""}`);
    let loss: HTMLElement | null = null;
    let totals: Totals | null = null;
    if (label !== null) {
      const lab = el("div", "fw-lab");
      const title = el("span", undefined, label);
      if (tuto !== undefined) title.dataset.tuto = tuto;
      lab.append(title);
      if (coverage) {
        loss = el("span", "fw-loss");
        lab.append(loss);
      }
      if (side !== undefined) {
        totals = statTotals(side);
        lab.append(totals.root);
      }
      col.append(lab);
    }
    const rows: RowRefs[] = [];
    const box = el("div", "fw-rows");
    for (const niche of this.military.niches) {
      const row = el("div", `fw-row n-${niche.id}${coverage ? " cov" : ""}${compressed ? " comp" : ""}`);
      const clip = el("div", "fw-clip");
      const big = el("div", "fw-big");
      big.append(el("span", "fw-letters", nicheLetters(niche.id)));
      if (side === "ours") big.dataset.tuto = niche.support ? "niche-support" : `niche-${niche.id}`;
      const pct = coverage ? el("span", "fw-pct", "0 %") : null;
      if (pct !== null) big.append(pct);
      clip.append(big);
      const zone = el("div", "fw-zone");
      row.append(clip, zone);
      const need = niche.id === "infantry" ? el("div", "fw-need", "L'infanterie est essentielle.") : null;
      if (need !== null) {
        need.hidden = true;
        row.append(need);
      }
      let pop: HTMLElement | null = null;
      if (compressed) {
        pop = el("div", "fw-pop");
        row.append(pop);
        attachPawnPanels(pop, this.military, (id) => this.byId.get(id));
      }
      rows.push({ niche: niche.id, zone, pct, pop, need });
      box.append(row);
    }
    col.append(box);
    return { col, rows, loss, totals };
  }

  // ---- dessin ----

  private startAttack(): void {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined) return;
    const me = front.players.indexOf(localPlayer());
    if (me < 0 || !front.active) return;
    this.send({ type: "start_front_attack", front: front.id });
  }

  private draw(): void {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined) return;
    const me = front.players.indexOf(localPlayer());
    if (me < 0) {
      this.close();
      return;
    }
    const player = localPlayer();
    const other = opponentOf(front, player);
    const m = this.military;
    const nicheOf = (d: DivisionView): string => typeOf(m, d).niche;

    const width = el("span", "fw-width", "Largeur du front : ");
    width.append(frontWidthIcon("inline-width-icon"), el("strong", undefined, String(front.connections.length)));
    this.title.replaceChildren(
      el("strong", undefined, `Front contre ${playerName(other)}`),
      width,
      el("span", front.active ? "fw-war" : "fw-peace", front.active ? "guerre" : "paix"),
    );
    this.title.title = `Largeur du front : ${front.connections.length} liaison${front.connections.length > 1 ? "s" : ""}`;
    this.drawAttackButton(front);
    this.drawHistory();
    // État perdu par chaque première ligne au dernier combat (08 §11), en pourcent d'une division, sans décimale.
    const percent = (n: number): number => Math.round((n * 100) / m.stateScale);
    const loss = (n: number): string => `Pertes au dernier combat : ${num(percent(n))} % d'état`;
    const sum = (byNiche: readonly number[]): number => byNiche.reduce((s, n) => s + n, 0);
    this.columns.o1.loss!.textContent = loss(sum(front.sides[me]!.lastLossByNiche));
    this.columns.t1.loss!.textContent = loss(sum(front.sides[1 - me]!.lastLossByNiche));
    front.sides[me]!.lastLossByNiche.forEach((n, i) => (this.gutOurs.losses[i]!.textContent = n > 0 ? `−${formatStat(percent(n))} %` : ""));
    front.sides[1 - me]!.lastLossByNiche.forEach((n, i) => (this.gutTheirs.losses[i]!.textContent = n > 0 ? `−${formatStat(percent(n))} %` : ""));

    // La première ligne adverse a la largeur de celle du joueur (§11.4) ; le reste de son côté est comprimé.
    this.capFirstLine();
    const lineWidth = this.columns.o1.col.getBoundingClientRect().width;
    if (lineWidth > 0) {
      this.columns.t1.col.style.flex = "none";
      this.columns.t1.col.style.width = `${lineWidth}px`;
    }
    // Le côté adverse ne tient pas dans sa part de la fenêtre (fenêtre étroite) : la zone des deux côtés défile horizontalement.
    this.mainEl.classList.toggle("hscroll", this.theirsSide.scrollWidth - this.theirsSide.clientWidth > 1);

    const mine = divisionsAt(this.divisions, front.id, player);
    const theirs = divisionsAt(this.divisions, front.id, other);

    // Statistiques de combat des premières lignes (05-Fronts §11.4) : les attaques portent le multiplicateur d'attaque d'un camp qui attaque sur tout le front.
    // Un camp « attaque » pendant le délai qui suit son attaque (`attackReadyAt`), le combat étant résolu tout de suite.
    const mineStats = firstLineStats(m, mine, front.active && front.sides[me]!.attackReadyAt > this.tick);
    const theirStats = firstLineStats(m, theirs, front.active && front.sides[1 - me]!.attackReadyAt > this.tick);
    this.drawStats(this.gutOurs, this.columns.o1.totals!, mineStats, theirStats);
    this.drawStats(this.gutTheirs, this.columns.t1.totals!, theirStats, mineStats);

    // Cibles de dépose : les deux lignes du joueur.
    this.columns.o2.col.dataset.drop = `line:${front.id}:second`;
    this.columns.o1.col.dataset.drop = `line:${front.id}:first`;

    const fill = (column: Column, zone: ZoneView | null, source: readonly DivisionView[], line: "first" | "second" | "rapid"): void => {
      const rows = column.rows.map((r) => {
        const here = source.filter((d) => d.line === line && nicheOf(d) === r.niche);
        if (r.pct !== null) r.pct.textContent = `${coveragePercent(front, here.reduce((s, d) => s + d.engaged, 0))} %`;
        return { el: r.zone, divisions: here };
      });
      if (zone !== null) zone.set(rows);
      else for (const r of rows) this.plain(r.el, r.divisions);
    };
    fill(this.columns.o2, this.dnd.zone("o2"), mine, "second");
    fill(this.columns.o1, this.dnd.zone("o1"), mine, "first");
    this.showNeed(this.columns.o1.rows, mine.filter((d) => d.line === "first"), nicheOf);
    fill(this.columns.t1, null, theirs, "first");
    this.compressed(this.columns.t2, theirs.filter((d) => d.line === "second"), nicheOf);

    // Réaction rapide (§4.6) : comme une ligne.
    this.columns.rapid.col.dataset.drop = `line:${front.id}:rapid`;
    fill(this.columns.rapid, this.dnd.zone("or"), mine, "rapid");
    this.compressed(this.columns.rapidT, theirs.filter((d) => d.line === "rapid"), nicheOf);
    this.drawBoxes(front, mine, theirs, player, nicheOf);
    this.drawStrip(front);
    this.drawTheirBoxes(front, theirs, other, nicheOf);
  }

  /**
   * Plafonne la première ligne du joueur à ce que le côté adverse peut porter : la première ligne adverse a sa largeur, et
   * le reste de ce côté (statistiques, seconde ligne et colonnes comprimées, espaces) est fixe. Jamais en dessous de
   * `FIRST_MIN` : c'est alors la seconde ligne du joueur qui rétrécit, puis la fenêtre qui défile.
   */
  private capFirstLine(): void {
    const side = this.theirsSide;
    const style = getComputedStyle(side);
    const kids = [...side.children] as HTMLElement[];
    let used = (parseFloat(style.columnGap) || 0) * (kids.length - 1);
    for (const k of kids) {
      const s = getComputedStyle(k);
      used += k.offsetWidth + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0);
    }
    const room = side.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const first = this.columns.t1.col.offsetWidth;
    const max = Math.floor(room - (used - first));
    this.win.style.setProperty("--fw-first-max", `${Math.max(FIRST_MIN, max)}px`);
  }

  /** Remplit la colonne de statistiques et les totaux d'une première ligne ; les barres ont une échelle commune aux deux camps. */
  private drawStats(gut: Gutter, tots: Totals, own: FirstLineStats, other: FirstLineStats): void {
    this.military.niches.forEach((niche, i) => {
      STAT_KINDS.forEach((kind, k) => {
        gut.values[i]![k]!.textContent = formatStat(own.rows[i]![kind]);
      });
      // Les niches d'appui-feu n'ont pas de PV affichés : la ligne garde sa place, les attaques restent à la même hauteur.
      gut.lines[i]![2]!.classList.toggle("off", niche.support);
    });
    drawTotals(tots, own.total, other.total);
  }

  /** Couverture d'une liaison par une niche d'une boîte : somme des `breakthroughWidth` (en liaisons), sans plafond : deux infanteries de largeur de percée 1 sur une liaison font 200 % (§11.4). */
  private boxCoverage(divisions: readonly DivisionView[]): string {
    const width = divisions.reduce((sum, d) => sum + typeOf(this.military, d).breakthroughWidth, 0);
    return `${Math.round(100 * width)} %`;
  }

  /** Divisions d'une boîte qui y sont encore : celles engagées dans une percée (la force qui perce) sont dans la percée en cours. */
  private inBox(divisions: readonly DivisionView[], box: number): DivisionView[] {
    return divisions.filter((d) => d.line === "box" && d.box === box && d.breakthrough === 0);
  }

  // ---- boîtes de percée du joueur (§11.4) ----

  private createBox(id: number): BoxUi {
    const root = el("div", "fw-box");
    const motor = this.motorLabel();
    const launch = el("button", "fw-btn fw-launch", "Lancer");
    launch.type = "button";
    // Le bouton à gauche, la motorisation à droite : la vue étendue est plus large, le bouton ne bouge pas quand elle s'ouvre.
    const head = el("div", "fw-box-head");
    head.append(launch, motor.root);
    const compact = el("div", "fw-bzone");
    root.append(head, compact);
    // Vue étendue : posée dans la colonne (la liste défile et la couperait), visible tant que la souris est sur la boîte ou sur elle.
    const pop = el("div", "fw-bpop");
    const popMotor = this.motorLabel();
    const popLaunch = el("button", "fw-btn fw-launch", "Lancer");
    popLaunch.type = "button";
    const popHead = el("div", "fw-box-head");
    popHead.append(popLaunch, popMotor.root);
    // Comme les premières lignes face à face, sans les secondes lignes : la boîte à gauche, la première ligne adverse à droite.
    const mineCol = this.column(null, true, false);
    const theirCol = this.column(null, true, false);
    const face = el("div", "fw-bface");
    face.append(mineCol.col, theirCol.col);
    pop.append(popHead, face);
    const open = (): void => this.showBox(ui);
    const leave = (e: PointerEvent): void => {
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (to === null || (!root.contains(to) && !pop.contains(to))) pop.classList.remove("show");
    };
    root.addEventListener("pointerenter", open);
    root.addEventListener("pointerleave", leave);
    pop.addEventListener("pointerleave", leave);
    const ui: BoxUi = { id, root, motor, launch, compact, pop, popMotor, popLaunch, rows: mineCol.rows, theirRows: theirCol.rows };
    const go = (): void => this.onLaunch(this.frontId, id);
    launch.addEventListener("click", go);
    popLaunch.addEventListener("click", go);
    for (const button of [launch, popLaunch]) attachTextPanel(button, () => this.breakthroughPrediction(id));
    return ui;
  }

  /** Texte « Motorisée » / « Au pas », son symbole et son panneau de survol (les textes sont dans `MOTOR_TIPS`). */
  private motorLabel(): MotorUi {
    const root = el("span", "fw-motor");
    const text = el("span", "fw-motor-text");
    const icon = el("img", "fw-motor-icon");
    icon.alt = "";
    icon.draggable = false;
    root.append(text, icon);
    const ui: MotorUi = { root, text, icon, motorized: false };
    attachTextPanel(root, () => {
      const [title, body] = ui.motorized ? MOTOR_TIPS.yes : MOTOR_TIPS.no;
      return textPanel(title, body, motorIcon(ui.motorized));
    });
    return ui;
  }

  /** Une boîte est motorisée si toutes ses divisions disponibles le sont, sans exception (même règle que le moteur, 05-Fronts §7.2). */
  private setMotor(ui: MotorUi, divisions: readonly DivisionView[]): void {
    const available = divisions.filter((d) => d.status !== "moving" && d.status !== "fleeing");
    ui.motorized = available.length > 0 && available.every((d) => typeOf(this.military, d).motorized);
    ui.text.textContent = ui.motorized ? MOTOR_TIPS.yes[0] : MOTOR_TIPS.no[0];
    ui.icon.src = `icons/miscellaneous/${ui.motorized ? "icon-motorized" : "icon-on-foot"}.png`;
  }

  /** Ouvre la vue étendue d'une boîte, à la hauteur de la boîte (sauf pendant un glisser). */
  private showBox(ui: BoxUi): void {
    if (this.win.classList.contains("dragging")) return;
    const col = this.pierceCol.getBoundingClientRect();
    ui.pop.style.top = `${Math.max(0, ui.root.getBoundingClientRect().top - col.top)}px`;
    ui.pop.classList.add("show");
  }

  private drawBoxes(front: FrontView, mine: readonly DivisionView[], theirs: readonly DivisionView[], player: number, nicheOf: (d: DivisionView) => string): void {
    const mineBoxes = front.boxes.filter((b) => b.owner === player);
    const ids = new Set(mineBoxes.map((b) => b.id));
    for (const [id, ui] of this.boxes) {
      if (ids.has(id)) continue;
      ui.root.remove();
      ui.pop.remove();
      this.dnd.zone(`bx${id}`).set([]);
      this.boxes.delete(id);
    }
    const order: HTMLElement[] = [];
    mineBoxes.forEach((b) => {
      let ui = this.boxes.get(b.id);
      if (ui === undefined) {
        ui = this.createBox(b.id);
        this.boxes.set(b.id, ui);
        this.pierceCol.append(ui.pop);
        // Dans la page avant le dessin des pions : une boîte détachée a une largeur nulle et resterait vide jusqu'au tour suivant.
        this.pierceList.append(ui.root);
      }
      const here = this.inBox(mine, b.id);
      this.setMotor(ui.motor, here);
      this.setMotor(ui.popMotor, here);
      // Une percée a besoin d'infanterie (le moteur refuse sinon, 05-Fronts §7.2) : bouton grisé et message au survol.
      const infantry = here.some((d) => d.status !== "moving" && d.status !== "fleeing" && nicheOf(d) === "infantry");
      for (const btn of [ui.launch, ui.popLaunch]) {
        btn.disabled = !front.active || here.length === 0 || !infantry;
        btn.title = !front.active
          ? "Seulement sur un front actif."
          : here.length === 0
            ? "La boîte est vide."
            : !infantry
              ? "Vous avez besoin d'infanterie pour la percée."
              : "";
      }
      ui.root.dataset.drop = `box:${front.id}:${b.id}`;
      ui.pop.dataset.drop = `box:${front.id}:${b.id}`;
      this.renderCompact(ui.compact, here);
      const rows = ui.rows.map((r) => {
        const inNiche = here.filter((d) => nicheOf(d) === r.niche);
        if (r.pct !== null) r.pct.textContent = this.boxCoverage(inNiche);
        return { el: r.zone, divisions: inNiche };
      });
      // En face : la première ligne adverse, comme dans la fenêtre (couverture du front).
      for (const r of ui.theirRows) {
        const inNiche = theirs.filter((d) => d.line === "first" && nicheOf(d) === r.niche);
        if (r.pct !== null) r.pct.textContent = `${coveragePercent(front, inNiche.reduce((sum, d) => sum + d.engaged, 0))} %`;
        this.plain(r.zone, inNiche);
      }
      order.push(ui.root);
      this.dnd.zone(`bx${b.id}`).set(rows);
      this.showNeed(ui.rows, here, nicheOf);
    });
    this.pierceList.replaceChildren(...order, this.plus);
    this.plus.dataset.drop = `box:${front.id}:0`;
  }

  /** Message de la rangée d'infanterie : les autres unités ne combattent pas sans elle, il s'affiche quand la rangée est vide. */
  private showNeed(rows: readonly RowRefs[], divisions: readonly DivisionView[], nicheOf: (d: DivisionView) => string): void {
    const need = rows.find((r) => r.need !== null)?.need;
    if (need) need.hidden = divisions.some((d) => nicheOf(d) === "infantry");
  }

  /** Une boîte au repos : ses pions groupés par type (pas de sélection : elle se fait dans la vue étendue). */
  private renderCompact(zone: HTMLElement, divisions: readonly DivisionView[]): void {
    if (divisions.length === 0) {
      zone.replaceChildren();
      return;
    }
    const width = zone.clientWidth;
    // Les types qui ne tiennent pas sur une ligne passent à la ligne suivante : la zone grandit (jamais rognée sur la droite).
    if (width > 0) renderZone(zone, divisions, this.military, { width, selected: new Set(), multiline: true });
  }

  // ---- boîtes de percée de l'adversaire, comprimées (§11.4) ----

  private drawTheirBoxes(front: FrontView, theirs: readonly DivisionView[], other: number, nicheOf: (d: DivisionView) => string): void {
    const boxes = front.boxes.filter((b) => b.owner === other);
    const tags: HTMLElement[] = [];
    this.pierceTPop.replaceChildren();
    boxes.forEach((b) => {
      const here = this.inBox(theirs, b.id);
      const cbox = el("div", "fw-cbox");
      if (here.length > 0) cbox.append(countTag(this.military, here, "first"));
      tags.push(cbox);
      // Cadre étendu : les rangées par niche non vides, avec la couverture d'une liaison.
      const pb = el("div", "fw-pbox");
      const inner = this.column(null, true, false);
      pb.append(inner.col);
      this.pierceTPop.append(pb);
      for (const r of inner.rows) {
        const inNiche = here.filter((d) => nicheOf(d) === r.niche);
        r.zone.parentElement!.hidden = inNiche.length === 0;
        if (r.pct !== null) r.pct.textContent = this.boxCoverage(inNiche);
        this.plain(r.zone, inNiche);
      }
    });
    this.pierceTList.replaceChildren(...tags);
    // Les boîtes qui ne tiennent pas en hauteur sont remplacées par une boîte « ··· » (qui fait partie de la zone de survol).
    const room = this.pierceTList.clientHeight;
    if (room > 0 && tags.length * CBOX_STEP > room) {
      let keep = Math.floor((room - CDOTS_STEP) / CBOX_STEP);
      keep = Math.max(0, keep);
      tags.slice(keep).forEach((t) => t.remove());
      const dots = el("div", "fw-cdots");
      dots.innerHTML = "<i></i><i></i><i></i>";
      this.pierceTList.append(dots);
    }
  }

  /** Rangée sans sélection (première ligne de l'adversaire) : les pions, et leur panneau de survol. */
  private plain(zone: HTMLElement, divisions: readonly DivisionView[]): void {
    if (divisions.length === 0) {
      zone.replaceChildren();
      return;
    }
    const width = zone.clientWidth;
    if (width === 0) return;
    renderZone(zone, divisions, this.military, { width, selected: new Set() });
    if (zone.dataset.panels === undefined) {
      zone.dataset.panels = "1";
      attachPawnPanels(zone, this.military, (id) => this.byId.get(id));
    }
  }

  /** Seconde ligne de l'adversaire : par niche, une icône et le nombre de divisions ; au survol, toutes les divisions, une ligne par type. */
  private compressed(column: Column, divisions: readonly DivisionView[], nicheOf: (d: DivisionView) => string): void {
    for (const r of column.rows) {
      const here = divisions.filter((d) => nicheOf(d) === r.niche);
      r.zone.replaceChildren();
      r.pop?.replaceChildren();
      if (here.length === 0) continue;
      r.zone.append(countTag(this.military, here, "first"));
      const ordered = pawnOrder(here, this.military);
      const byType = new Map<number, DivisionView[]>();
      for (const d of ordered) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
      for (const group of byType.values()) {
        for (let i = 0; i < group.length; i += POP_PER_LINE) {
          const line = el("div", "fw-popline");
          line.style.width = `${POP_WIDTH - 16}px`;
          r.pop?.append(line);
          renderZone(line, group.slice(i, i + POP_PER_LINE), this.military, { width: POP_WIDTH - 16, selected: new Set() });
        }
      }
    }
  }
}
