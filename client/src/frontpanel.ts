// Panneau d'un front (Docs/Design/05-Fronts.md §11.3) : un panneau = un front. Titre,
// boutons d'attaque, section des percées, réglages, tableau des unités par niche. Les
// deux camps sont visibles (pas de brouillard de guerre) ; seuls les réglages du joueur
// humain sont actifs. La page n'applique aucune règle : elle affiche ce que le moteur
// envoie (`FrontView`) et envoie des ordres.
//
// Le DOM d'un front est construit à son ouverture ; ensuite `update` écrit seulement des
// textes et des classes, sauf pour les percées (un tableau par percée, créé ou retiré
// avec elle), pour ne pas détruire un bouton entre le `pointerdown` et le `click`.

import { playerColor, rgbCss } from "./painter.ts";
import { HUMAN, type BreakthroughView, type FrontSideView, type FrontView, type HumanOrder, type MilitaryCatalog, type UnitInfo } from "./protocol.ts";
import { nicheName, playerName, unitName } from "./names.ts";

const pctFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat("fr-FR");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export interface FrontPanelHooks {
  send(order: HumanOrder): void;
  /** « Percée » : la page ferme le panneau et passe la carte en mode choix d'axe (05-Fronts §11.1). */
  chooseAxis(frontId: number): void;
}

/** Cellules d'une rangée du tableau des unités, pour la mise à jour. */
interface UnitRow {
  readonly unit: UnitInfo;
  readonly q1: [HTMLElement, HTMLElement];
  readonly q2: [HTMLElement, HTMLElement];
  readonly pct: [HTMLElement, HTMLElement];
  readonly modes: HTMLButtonElement[];
}

interface NicheRow {
  readonly units: readonly number[];
  readonly pct: [HTMLElement, HTMLElement];
}

const MODE_TITLES = ["Priorité première ligne", "Équilibré : même pourcentage du front dans les deux lignes", "Priorité seconde ligne"];
/**
 * Interrupteur de chaque type, de gauche à droite dans la moitié du joueur : flèche vers la seconde ligne (côté extérieur),
 * égal (équilibré), flèche vers la première ligne (côté de la barre centrale). Valeurs de `lineMode` : 0 première ligne,
 * 1 équilibré, 2 seconde ligne.
 */
const MODE_ORDER = [2, 1, 0] as const;
const MODE_LABELS = ["◀", "=", "▶"];
const MODE_NAMES = ["first", "balanced", "second"] as const;

export class FrontPanel {
  private readonly root: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly hooks: FrontPanelHooks;
  private frontId = 0;
  /** Camp du joueur humain dans le front, -1 s'il n'en est pas un. */
  private me = -1;
  private left = 0;
  private body: HTMLElement | null = null;
  private frontal: [HTMLButtonElement, HTMLButtonElement] | null = null;
  private pierce: [HTMLButtonElement, HTMLButtonElement] | null = null;
  private barrage: [HTMLButtonElement, HTMLButtonElement] | null = null;
  private motorized: HTMLInputElement | null = null;
  private priorities: HTMLButtonElement[] = [];
  private reassign: HTMLInputElement | null = null;
  private title: HTMLElement | null = null;
  private btBox: HTMLElement | null = null;
  private readonly btTables = new Map<number, { root: HTMLElement; head: HTMLElement; note: HTMLElement; rows: HTMLElement }>();
  private unitRows: UnitRow[] = [];
  private nicheRows: NicheRow[] = [];
  /** Jusqu'à cette heure, les réglages ne sont pas réécrits par les tours (l'ordre n'est pas encore appliqué). */
  private holdUntil = 0;

  constructor(root: HTMLElement, military: MilitaryCatalog, hooks: FrontPanelHooks) {
    this.root = root;
    this.military = military;
    this.hooks = hooks;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get openFront(): number {
    return this.isOpen ? this.frontId : 0;
  }

  close(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.frontId = 0;
    this.btTables.clear();
  }

  /** Ouvre le panneau du front. */
  open(front: FrontView): void {
    this.frontId = front.id;
    this.me = front.players.indexOf(HUMAN);
    this.left = this.me >= 0 ? this.me : 0;
    this.build(front);
    this.root.hidden = false;
    this.update(front);
  }

  /** À appeler à chaque message qui apporte les fronts : met le panneau ouvert à jour, ou le ferme si le front a disparu. */
  refresh(fronts: readonly FrontView[], tick: number): void {
    if (!this.isOpen) return;
    const f = fronts.find((x) => x.id === this.frontId);
    if (f === undefined) return this.close();
    this.update(f, tick);
  }

  // ---- construction ----

  private build(front: FrontView): void {
    const L = this.left;
    const R = 1 - L;
    const mineSide = this.me >= 0;
    const head = el("div", "fp-head");
    const close = el("button", "fp-close", "×");
    close.type = "button";
    close.title = "Fermer";
    close.addEventListener("click", () => this.close());
    this.title = el("h2", "fp-title");
    head.append(close, this.title);

    // Boutons d'attaque : ceux du joueur dans sa moitié, les trois mêmes en miroir et gris dans celle de l'adversaire.
    const attacks = el("div", "fp-attacks");
    const half = (mine: boolean): { root: HTMLElement; frontal: HTMLButtonElement; pierce: HTMLButtonElement; barrage: HTMLButtonElement } => {
      const root = el("div", `fp-half${mine ? "" : " mirror"}`);
      const mk = (label: string, title: string): HTMLButtonElement => {
        const b = el("button", "fp-atk", label);
        b.type = "button";
        b.title = title;
        if (!mine || !mineSide) b.disabled = true;
        return b;
      };
      const frontal = mk("Attaque sur tout le front", "Assaut généralisé : toute la première ligne des deux camps, avance sur toutes les routes du front. Un second clic l'arrête.");
      const pierce = mk("Percée", "Percée de la seconde ligne sur une route choisie sur la carte. Plusieurs percées possibles sur des routes différentes.");
      const barrage = mk("Barrage d'artillerie", "Hors du périmètre de la version 1 : sans effet.");
      const row = el("div", "fp-atk-row");
      row.append(frontal, pierce, barrage);
      root.append(row);
      return { root, frontal, pierce, barrage };
    };
    const mine = half(true);
    const theirs = half(false);
    this.frontal = [mine.frontal, theirs.frontal];
    this.pierce = [mine.pierce, theirs.pierce];
    this.barrage = [mine.barrage, theirs.barrage];
    // Interrupteur « Motorisé seulement » juste sous le bouton percée.
    const motor = el("label", "fp-motor");
    const motorBox = el("input");
    motorBox.type = "checkbox";
    motorBox.disabled = !mineSide;
    motor.append(motorBox, el("span", "ib-switch"), document.createTextNode("Motorisé seulement"));
    motor.title = "Allumé : seules les unités motorisées font la percée. Éteint : les motorisées d'abord, puis les autres.";
    this.motorized = motorBox;
    mine.root.append(motor);
    motorBox.addEventListener("change", () => {
      this.hold();
      this.hooks.send({ type: "set_breakthrough_motorized_only", front: this.frontId, enabled: motorBox.checked });
    });
    attacks.append(mine.root, theirs.root);
    mine.frontal.addEventListener("click", () => {
      const f = this.current;
      if (f === undefined || this.me < 0) return;
      this.hooks.send({ type: f.sides[this.me]!.frontAttack ? "stop_front_attack" : "start_front_attack", front: this.frontId });
    });
    mine.pierce.addEventListener("click", () => this.hooks.chooseAxis(this.frontId));

    // Réglages : priorité et réassignation.
    const settings = el("div", "fp-settings");
    if (mineSide) {
      const prio = el("div", "fp-prio");
      prio.append(el("span", "muted", "Priorité"));
      this.priorities = this.military.priorityPercent.map((percent, i) => {
        const b = el("button", "fp-prio-btn", `${i + 1} · ${percent} %`);
        b.type = "button";
        b.title = `Niveau ${i + 1} : ${percent} % du besoin d'abord, le reste ensuite par priorité décroissante.`;
        b.addEventListener("click", () => {
          this.hold();
          this.priorities.forEach((x, k) => x.setAttribute("aria-pressed", String(k === i)));
          this.hooks.send({ type: "set_front_priority", front: this.frontId, priority: i });
        });
        prio.append(b);
        return b;
      });
      const reassign = el("label", "fp-reassign");
      const box = el("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        this.hold();
        this.hooks.send({ type: "set_front_reassign", front: this.frontId, enabled: box.checked });
      });
      this.reassign = box;
      reassign.append(box, document.createTextNode(" Autoriser la réassignation à d'autres fronts"));
      settings.append(prio, reassign);
    }
    head.append(attacks, settings);

    // Corps qui défile : percées, tableau des unités.
    const body = el("div", "fp-body");
    this.btBox = el("div", "fp-bts");
    body.append(this.btBox, this.buildUnits(front, L, R));
    this.body = body;
    this.root.replaceChildren(el("div", "fp-box"));
    this.root.firstElementChild!.append(head, body);
    this.btTables.clear();
  }

  private get current(): FrontView | undefined {
    return this.lastFront;
  }
  private lastFront: FrontView | undefined;

  private hold(): void {
    this.holdUntil = Date.now() + 600;
  }

  /** Tableau des unités, deux moitiés symétriques autour d'une barre centrale (05-Fronts §11.3, point 5). */
  private buildUnits(front: FrontView, L: number, R: number): HTMLElement {
    const grid = el("div", "fp-units");
    const colorL = rgbCss(playerColor(front.players[L]!));
    const colorR = rgbCss(playerColor(front.players[R]!));
    const mineSide = this.me >= 0;
    // Colonnes, de l'extérieur gauche à l'extérieur droit : avions, nom, icône, 2e ligne, interrupteur, 1re ligne, % front | barre | % front, 1re ligne, interrupteur, 2e ligne, icône, nom, avions.
    const cells = (parts: { cls: string; node?: HTMLElement; text?: string }[]): void => {
      parts.forEach((p, i) => {
        const c = p.node ?? el("div", p.cls, p.text);
        // Moitié gauche (colonnes 0 à 6) : alignée vers la barre ; moitié droite (8 à 14) : alignée vers l'extérieur, en miroir.
        c.classList.add("fp-cell", ...p.cls.split(" ").filter(Boolean), i < 7 ? "l" : i > 7 ? "r" : "m");
        grid.append(c);
      });
    };
    /** Trait clair au-dessus d'une niche : un seul élément sur toute la rangée, de la couleur de chaque joueur de son côté de la barre. */
    const separator = (): void => {
      const s = el("div", "fp-sep");
      s.style.background = `linear-gradient(to right, ${colorL} 50%, ${colorR} 50%)`;
      grid.append(s);
    };
    const bar = (): { cls: string; node: HTMLElement } => {
      const b = el("div", "fp-bar");
      b.style.background = `linear-gradient(to right, ${colorL} 50%, ${colorR} 50%)`;
      return { cls: "fp-barcell", node: b };
    };
    // En-tête des colonnes.
    cells(
      [
        { cls: "h air", text: "" }, { cls: "h name", text: "" }, { cls: "h icon", text: "" },
        { cls: "h q", text: "2e ligne" }, { cls: "h swt", text: mineSide ? "prio" : "" }, { cls: "h q", text: "1re ligne" }, { cls: "h pct", text: "% front" },
        bar(),
        { cls: "h pct", text: "% front" }, { cls: "h q", text: "1re ligne" }, { cls: "h swt", text: "" }, { cls: "h q", text: "2e ligne" },
        { cls: "h icon", text: "" }, { cls: "h name", text: "" }, { cls: "h air", text: "" },
      ],
    );
    this.unitRows = [];
    this.nicheRows = [];
    for (const niche of this.military.niches) {
      // Séparateur au-dessus de l'en-tête de chaque niche, puis la niche, ses types.
      const pct: [HTMLElement, HTMLElement] = [el("div"), el("div")];
      separator();
      cells(
        [
          { cls: "n air" }, { cls: "n name", text: nicheName(niche.id) }, { cls: "n icon" },
          { cls: "n q" }, { cls: "n swt" }, { cls: "n q" }, { cls: "n pct", node: pct[0] },
          bar(),
          { cls: "n pct", node: pct[1] }, { cls: "n q" }, { cls: "n swt" }, { cls: "n q" },
          { cls: "n icon" }, { cls: "n name", text: nicheName(niche.id) }, { cls: "n air" },
        ],
      );
      this.nicheRows.push({ units: niche.units.map((id) => this.military.units.findIndex((u) => u.id === id)), pct });
      for (const id of niche.units) {
        const unit = this.military.units.find((u) => u.id === id)!;
        const q1: [HTMLElement, HTMLElement] = [el("div"), el("div")];
        const q2: [HTMLElement, HTMLElement] = [el("div"), el("div")];
        const upct: [HTMLElement, HTMLElement] = [el("div"), el("div")];
        // L'image est dans un conteneur : une image qui serait elle-même la cellule de la grille serait écrasée sur la largeur.
        const icon = (): HTMLElement => {
          const i = el("img", "fp-icon-img");
          i.src = `icons/${unit.icon}`;
          i.alt = "";
          const box = el("div");
          box.append(i);
          return box;
        };
        const mkName = (): HTMLElement => {
          const n = el("div", "t name", unitName(unit.id));
          n.title = this.unitTip(unit);
          return n;
        };
        // Interrupteur à trois positions, seulement pour le joueur.
        const sw = el("div", "t swt");
        const modes: HTMLButtonElement[] = [];
        if (mineSide) {
          MODE_LABELS.forEach((label, k) => {
            const mode = MODE_ORDER[k]!;
            const b = el("button", "fp-mode", label);
            b.type = "button";
            b.title = MODE_TITLES[mode]!;
            b.addEventListener("click", () => {
              this.hold();
              modes.forEach((x, j) => x.setAttribute("aria-pressed", String(j === k)));
              this.hooks.send({ type: "set_unit_line_mode", front: this.frontId, unit: unit.id, mode: MODE_NAMES[mode]! });
            });
            modes.push(b);
            sw.append(b);
          });
        }
        cells(
          [
            { cls: "t air" }, { cls: "t name", node: mkName() }, { cls: "t icon", node: icon() },
            { cls: "t q", node: q2[0] }, { cls: "t swt", node: sw }, { cls: "t q", node: q1[0] }, { cls: "t pct", node: upct[0] },
            bar(),
            { cls: "t pct", node: upct[1] }, { cls: "t q", node: q1[1] }, { cls: "t swt" }, { cls: "t q", node: q2[1] },
            { cls: "t icon", node: icon() }, { cls: "t name", node: mkName() }, { cls: "t air" },
          ],
        );
        this.unitRows.push({ unit, q1, q2, pct: upct, modes });
      }
    }
    return grid;
  }

  private unitTip(u: UnitInfo): string {
    const lines = [
      unitName(u.id),
      u.description,
      `${u.population} personnes · ${u.equipmentCount} × ${u.equipment}`,
      `Largeur : ${u.frontWidth} m en première ligne, ${u.breakthroughWidth} m en seconde ligne`,
      `Attaque : ${u.softAttack} anti-infanterie, ${u.hardAttack} antiblindée` + (u.hitPoints > 0 ? ` · ${u.hitPoints} PV` : ""),
      u.motorized ? "Motorisé" : "À pied",
    ];
    return lines.filter((l) => l !== "").join("\n");
  }

  // ---- mise à jour ----

  update(front: FrontView, tick = 0): void {
    this.lastFront = front;
    const L = this.left;
    const R = 1 - L;
    const mineSide = this.me >= 0;
    const sides = [front.sides[L]!, front.sides[R]!];
    const total = front.connections.length * this.military.metersPerConnection;
    setText(this.title!, `Île n° ${front.groups[L]} · ${playerName(front.players[L]!)} contre ${playerName(front.players[R]!)} (île n° ${front.groups[R]})${front.active ? "" : " — en paix"}`);

    // Boutons d'attaque : actifs seulement en guerre (choix provisoire : grisés en paix).
    const states = [
      [sides[0]!.frontAttack, sides[0]!.breakthroughs.length > 0, false],
      [sides[1]!.frontAttack, sides[1]!.breakthroughs.length > 0, false],
    ] as const;
    for (let h = 0; h < 2; h++) {
      const buttons = [this.frontal![h]!, this.pierce![h]!, this.barrage![h]!];
      buttons.forEach((b, k) => {
        b.classList.toggle("on", states[h]![k]!);
        b.disabled = h === 1 || !mineSide || !front.active;
        b.classList.toggle("grey", h === 1 || !front.active);
      });
    }
    if (Date.now() >= this.holdUntil && mineSide) {
      const s = sides[0]!;
      this.motorized!.checked = s.motorizedOnly;
      this.priorities.forEach((b, i) => b.setAttribute("aria-pressed", String(i === s.priority)));
      this.reassign!.checked = s.reassign;
    }

    // Tableau des unités.
    const frontWidth = (u: UnitInfo, n: number): number => (total > 0 ? (100 * n * u.frontWidth) / total : 0);
    for (const r of this.unitRows) {
      const t = r.unit.index;
      for (let h = 0; h < 2; h++) {
        const s = sides[h]!;
        setText(r.q1[h]!, numFmt.format(s.first[t]!));
        setText(r.q2[h]!, numFmt.format(s.second[t]!));
        r.q2[h]!.title = s.transit[t]! > 0 ? `${numFmt.format(s.transit[t]!)} en route vers le front` : "";
        setText(r.pct[h]!, `${pctFmt.format(frontWidth(r.unit, s.first[t]!))} %`);
      }
      if (mineSide && Date.now() >= this.holdUntil) r.modes.forEach((b, k) => b.setAttribute("aria-pressed", String(MODE_ORDER[k] === sides[0]!.lineMode[t])));
    }
    for (const n of this.nicheRows) {
      for (let h = 0; h < 2; h++) {
        let sum = 0;
        for (const t of n.units) sum += frontWidth(this.military.units[t]!, sides[h]!.first[t]!);
        setText(n.pct[h]!, `${pctFmt.format(sum)} %`);
      }
    }
    this.updateBreakthroughs(front, tick, L);
  }

  /** Un petit tableau par percée en cours (05-Fronts §11.3, point 3). */
  private updateBreakthroughs(front: FrontView, tick: number, L: number): void {
    const wanted = new Map<number, { bt: BreakthroughView; owner: number }>();
    for (let x = 0; x < 2; x++) for (const bt of front.sides[x]!.breakthroughs) wanted.set(bt.id, { bt, owner: x });
    for (const [id, t] of this.btTables) {
      if (wanted.has(id)) continue;
      t.root.remove();
      this.btTables.delete(id);
    }
    const R = 1 - L;
    for (const [id, { bt, owner }] of [...wanted].sort((a, b) => a[0] - b[0])) {
      let t = this.btTables.get(id);
      if (t === undefined) {
        const root = el("div", "fp-bt");
        root.style.borderColor = rgbCss(playerColor(front.players[owner]!));
        const head = el("div", "fp-bt-head");
        if (owner === this.me) {
          const cancel = el("button", "fp-bt-cancel", "×");
          cancel.type = "button";
          cancel.title = "Annuler la percée";
          cancel.addEventListener("click", () => this.hooks.send({ type: "cancel_breakthrough", id }));
          root.append(cancel);
        }
        const note = el("div", "muted small");
        const rows = el("div", "fp-bt-rows");
        root.append(head, note, rows);
        this.btBox!.append(root);
        t = { root, head, note, rows };
        this.btTables.set(id, t);
      }
      setText(t.head, bt.phase === 2 ? "Percée seconde ligne" : "Percée première ligne");
      const wait = Math.max(0, bt.startTick + this.military.breakthroughDelayTurns - tick);
      setText(t.note, bt.phase === 0 ? `Début dans ${Math.ceil(wait / 10)} s` : "");
      const attackers = bt.attackers;
      const defenders = bt.phase === 2 ? bt.defenders2 : bt.defenders1;
      const lines: HTMLElement[] = [];
      const head = el("div", "fp-bt-row h");
      head.append(el("span", undefined, playerName(front.players[L]!)), el("span"), el("span", undefined, playerName(front.players[R]!)));
      lines.push(head);
      for (const u of this.military.units) {
        const a = attackers[u.index]!;
        const d = defenders[u.index]!;
        if (a === 0 && d === 0) continue;
        const [l, r] = owner === L ? [a, d] : [d, a];
        const row = el("div", "fp-bt-row");
        const icon = el("img", "ib-img");
        icon.src = `icons/${u.icon}`;
        icon.alt = unitName(u.id);
        row.append(el("span", "cnt", numFmt.format(l)), icon, el("span", "cnt", numFmt.format(r)));
        lines.push(row);
      }
      t.rows.replaceChildren(...lines);
    }
  }
}
