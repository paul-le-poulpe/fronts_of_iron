// Panneau d'un front, PROVISOIRE : un texte par ligne et par niche, et l'interrupteur de
// l'attaque sur tout le front. Il tient la place de la fenêtre d'un front décrite au
// 05-Fronts §11.4, qui le remplacera. Les deux camps sont visibles (pas de brouillard de
// guerre). La page n'applique aucune règle : elle affiche ce que le moteur envoie
// (`FrontView`, `DivisionView`) et envoie des ordres.

import { playerColor, rgbCss } from "./painter.ts";
import { type DivisionView, type FrontView, type HumanOrder, type MilitaryCatalog } from "./protocol.ts";
import { localPlayer, nicheName, playerName, unitName } from "./names.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class FrontPanel {
  private readonly root: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly send: (order: HumanOrder) => void;
  private frontId = 0;
  private fronts: readonly FrontView[] = [];
  private divisions: readonly DivisionView[] = [];
  /** Texte du dernier dessin : le DOM n'est refait que s'il change (un bouton survit entre `pointerdown` et `click`). */
  private drawn = "";

  constructor(root: HTMLElement, military: MilitaryCatalog, send: (order: HumanOrder) => void) {
    this.root = root;
    this.military = military;
    this.send = send;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get openFront(): number {
    return this.isOpen ? this.frontId : 0;
  }

  close(): void {
    this.root.hidden = true;
    this.frontId = 0;
    this.drawn = "";
  }

  open(front: FrontView): void {
    this.frontId = front.id;
    this.root.hidden = false;
    this.drawn = "";
    this.draw();
  }

  refresh(fronts: readonly FrontView[], divisions: readonly DivisionView[], _tick: number): void {
    this.fronts = fronts;
    this.divisions = divisions;
    if (!this.isOpen) return;
    if (!fronts.some((f) => f.id === this.frontId)) {
      this.close();
      return;
    }
    this.draw();
  }

  /** Une ligne d'un camp : par niche, le nombre de divisions de chaque type et leur état moyen. */
  private lineText(front: FrontView, player: number, line: "first" | "second"): string[] {
    const here = this.divisions.filter((d) => d.front === front.id && d.owner === player && d.line === line);
    const out: string[] = [];
    for (const niche of this.military.niches) {
      const parts: string[] = [];
      for (const id of niche.types) {
        const type = this.military.divisions.findIndex((t) => t.id === id);
        const of = here.filter((d) => d.type === type);
        if (of.length === 0) continue;
        const state = Math.round((of.reduce((s, d) => s + d.state, 0) / of.length / this.military.stateScale) * 100);
        const waiting = of.filter((d) => d.status !== "ready").length;
        parts.push(`${unitName(id)} ×${of.length} (${state} %${waiting > 0 ? `, ${waiting} en attente` : ""})`);
      }
      if (parts.length > 0) out.push(`${nicheName(niche.id)} : ${parts.join(", ")}`);
    }
    return out;
  }

  private draw(): void {
    const front = this.fronts.find((f) => f.id === this.frontId);
    if (front === undefined) return;
    const me = front.players.indexOf(localPlayer());
    const lines = front.players.map((p) => [this.lineText(front, p, "first"), this.lineText(front, p, "second")]);
    const key = JSON.stringify([front.active, front.sides, front.connections.length, lines]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.root.replaceChildren();
    const head = el("div", "fp-head");
    const other = front.players[me === 0 ? 1 : 0]!;
    head.append(el("strong", undefined, `Front contre ${playerName(other)}`), el("span", "muted", ` · ${front.connections.length} liaisons · ${front.active ? "guerre" : "paix"}`));
    const close = el("button", "fp-close", "✕");
    close.addEventListener("click", () => this.close());
    head.append(close);
    this.root.append(head);
    if (me >= 0 && front.active) {
      const attacking = front.sides[me]!.frontAttack;
      const attack = el("button", attacking ? "on" : "", attacking ? "Arrêter l'attaque sur tout le front" : "Attaque sur tout le front");
      attack.addEventListener("click", () => this.send({ type: attacking ? "stop_front_attack" : "start_front_attack", front: front.id }));
      this.root.append(attack);
    }
    front.players.forEach((p, i) => {
      const box = el("div", "fp-side");
      box.style.borderLeft = `4px solid ${rgbCss(playerColor(p))}`;
      box.append(el("strong", undefined, `${playerName(p)}${front.sides[i]!.frontAttack ? " — attaque" : ""}`));
      for (const [k, label] of ["Première ligne", "Seconde ligne"].entries()) {
        box.append(el("div", "muted", label));
        const texts = lines[i]![k]!;
        if (texts.length === 0) box.append(el("div", undefined, "—"));
        for (const t of texts) box.append(el("div", undefined, t));
      }
      this.root.append(box);
    });
  }
}
