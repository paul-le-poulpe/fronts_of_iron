// Panneau de prédiction d'une attaque, au survol des boutons d'attaque de la fenêtre d'un front (Docs/Design/05-Fronts.md §11.4).
// Vos pertes à gauche, celles de l'adversaire à droite ; la barre est partagée selon ces pertes, la plus grande part au camp
// qui perd le moins. Les valeurs viennent de `prediction.ts`.

import { type BreakthroughEstimate, type FightEstimate, type FrontEstimate, LOSS_GROUPS, type LossGroup, type SideEstimate } from "./prediction.ts";
import { playerColor, rgbCss } from "./playercolors.ts";

const GROUP_NAMES: Readonly<Record<LossGroup, string>> = { infantry: "Infanterie", armor: "Blindés", support: "Appui-feu" };

const FRONT_VERDICTS = {
  dominant: { text: "Position dominante", cls: "good" },
  balanced: { text: "Position équilibrée", cls: "even" },
  losing: { text: "Position perdante", cls: "bad" },
} as const;

const BREAKTHROUGH_VERDICTS = {
  likely: { text: "Percée probable", cls: "good" },
  uncertain: { text: "Percée incertaine", cls: "even" },
  unlikely: { text: "Percée improbable", cls: "bad" },
} as const;

const ratioFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== undefined) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const percent = (value: number): string => `≈ ${Math.round(value)} %`;

/** Barre de part `share` (0 à 1) pour le joueur, avec le rapport de pertes sur la part du camp avantagé. */
function bar(mine: number, theirs: number, me: number, other: number): HTMLElement {
  const share = mine + theirs === 0 ? 0.5 : theirs / (mine + theirs);
  const root = el("div", "pr-bar");
  const left = el("i");
  const right = el("i");
  left.style.width = `${share * 100}%`;
  left.style.background = rgbCss(playerColor(me));
  right.style.width = `${(1 - share) * 100}%`;
  right.style.background = rgbCss(playerColor(other));
  const low = Math.min(mine, theirs);
  if (low > 0 && mine !== theirs) (mine < theirs ? left : right).textContent = `×${ratioFormat.format(Math.max(mine, theirs) / low)}`;
  root.append(left, right);
  return root;
}

function row(name: string, mine: number, theirs: number, me: number, other: number, main: boolean): HTMLElement {
  const r = el("div", main ? "pr-row pr-main" : "pr-row");
  const middle = el("div");
  middle.append(el("div", "pr-name", name), bar(mine, theirs, me, other));
  r.append(el("span", undefined, percent(mine)), middle, el("span", "pr-right", percent(theirs)));
  return r;
}

function panel(title: string, verdict: { readonly text: string; readonly cls: string }): HTMLElement {
  const root = el("div", "ip pr");
  const h = el("h4", "ip-head");
  const name = el("span", "ip-name");
  name.append(el("b", undefined, title));
  h.append(name);
  root.append(h, el("div", `pr-verdict ${verdict.cls}`, verdict.text));
  const head = el("div", "pr-cols");
  head.append(el("span", undefined, "Vos pertes"), el("span", "pr-right", "Ses pertes"));
  root.append(head);
  return root;
}

function groupRows(root: HTMLElement, mine: SideEstimate, theirs: SideEstimate, me: number, other: number): void {
  for (const group of LOSS_GROUPS) {
    const a = mine.groups[group];
    const b = theirs.groups[group];
    if (a !== null || b !== null) root.append(row(GROUP_NAMES[group], a ?? 0, b ?? 0, me, other, false));
  }
}

/** Panneau de l'attaque sur tout le front ; `note` : le texte qui décrit le bouton. */
export function frontPredictionPanel(estimate: FrontEstimate, me: number, other: number, note: string): HTMLElement {
  const root = panel("Attaque sur tout le front", FRONT_VERDICTS[estimate.verdict]);
  root.append(row("Total", estimate.attacker.total, estimate.defender.total, me, other, true));
  groupRows(root, estimate.attacker, estimate.defender, me, other);
  const foot = el("div", "pr-foot");
  const middle = el("div", "pr-mid", `Avancée ≈ ${Math.round(estimate.advance * 10) / 10} % · Durée ≈ ${estimate.rounds} rounds`.replace(".", ","));
  const side = (value: number, cls?: string): HTMLElement => {
    const s = el("div", cls, "Déroutes");
    s.append(el("b", undefined, `≈ ${value}`));
    return s;
  };
  foot.append(side(estimate.attacker.routs), middle, side(estimate.defender.routs, "pr-right"));
  root.append(foot, el("div", "pr-note", note));
  return root;
}

function combatRow(root: HTMLElement, name: string, fight: FightEstimate, me: number, other: number): void {
  root.append(row(name, fight.attacker.total, fight.defender.total, me, other, true));
}

/** Panneau du bouton « Lancer » d'une boîte de percée. */
export function breakthroughPredictionPanel(estimate: BreakthroughEstimate, me: number, other: number, note: string): HTMLElement {
  const root = panel("Lancer une percée", BREAKTHROUGH_VERDICTS[estimate.verdict]);
  combatRow(root, "Combat 1 : première ligne", estimate.first, me, other);
  if (estimate.second !== null) combatRow(root, "Combat 2 : contre-attaque", estimate.second, me, other);
  root.append(el("div", "pr-note", note));
  return root;
}
