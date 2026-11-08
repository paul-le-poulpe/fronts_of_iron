// Fenêtre de résumé d'un combat (Docs/Design/10-Combat-Phases.md §4), ouverte par « Passer » : la disposition en miroir
// de la fenêtre détaillée, figée à la fin du combat. En tête l'issue ; la bande des avions ; dans chaque niche, les
// unités en ligne (de la plus intacte à la plus abîmée), puis les tuées (pâles, croix rouge), puis les fuyardes (pâles,
// drapeau blanc), empilées quand elles sont nombreuses ; sous chaque niche, ce qu'elle a détruit (infanterie,
// véhicules) ; en bas les blessés de chaque camp, et « Revoir le combat ».

import { COMBAT_KIND, PHASE_NICHES, finalUnits, issueText, killsBy, killsDetail, localWon, type Kill } from "./combatdata.ts";
import { nicheTitle } from "./combatwindow.ts";
import { playerName } from "./names.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";
import { attachTextPanel, hidePanel, unitPanel } from "./infopanels.ts";
import { unitIconUrl } from "./uniticons.ts";

/** Hauteur de la zone des unités d'une niche, en px : les icônes s'empilent pour y tenir. */
const STACK_H = 270;
const ICON = 32;
/** Écart vertical entre deux rangées d'icônes quand elles ne se chevauchent pas. */
const ROW_STEP = 42;

/** Divisions détruites : une décimale (« 1,5 ») ; deux dans le détail au survol (« 0,25 »). */
const KILLS = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const KILLS_DETAIL = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class CombatSummary {
  private readonly panel: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly me: () => number;
  /** Clic sur « Revoir le combat ». */
  onReplay: ((c: CombatView) => void) | null = null;

  constructor(root: HTMLElement, military: MilitaryCatalog, me: () => number) {
    this.military = military;
    this.me = me;
    this.panel = el("div", "cs themed");
    this.panel.hidden = true;
    root.append(this.panel);
  }

  close(): void {
    hidePanel();
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  open(c: CombatView): void {
    const m = this.military;
    const me = this.me();
    const other = me === c.attacker ? c.defender : c.attacker;
    const sideOf = (owner: number): 0 | 1 => (owner === me ? 0 : 1);
    const final = finalUnits(c);

    const head = el("div", "cw-head");
    head.append(el("strong", undefined, COMBAT_KIND[c.kind]), el("div", "fw-spacer"));
    const closeBtn = el("button", "fw-btn", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => this.close());
    head.append(closeBtn);

    const won = localWon(c, m, me);
    const banner = el("div", "cs-banner");
    const name = (p: number, s: 0 | 1): HTMLElement => el("div", `cs-name s${s}`, `${playerName(p)}${p === c.attacker ? " (attaque)" : " (défense)"}`);
    const result = el("div", won ? "cs-result win" : "cs-result lose");
    result.append(el("strong", undefined, won ? "Victoire" : "Défaite"), el("span", undefined, issueText(c)));
    banner.append(name(me, 0), result, name(other, 1));

    const air = el("div", "cw-air cs-air", "Réservé : aviation");

    // Niches : du centre vers l'extérieur, en miroir ; le camp local à gauche.
    const field = el("div", "cs-field");
    const column = (s: 0 | 1, n: (typeof PHASE_NICHES)[number]): HTMLElement => {
      const nicheIndex = m.niches.findIndex((x) => x.id === n);
      const col = el("div", `cs-niche s${s} n-${n}`);
      col.append(el("div", "cw-niche-title", nicheTitle(n)));
      const stack = el("div", "cs-stack");
      stack.style.height = `${STACK_H}px`;
      const owner = s === 0 ? me : other;
      const here = c.units
        .map((u, i) => ({ u, i, f: final[i]! }))
        .filter(({ u, f }) => u.owner === owner && f.fought && m.divisions[u.type]?.niche === n);
      const rank = (f: (typeof final)[number]): number => (f.dead ? 1 : f.fled ? 2 : 0);
      here.sort((a, b) => rank(a.f) - rank(b.f) || b.f.hp - a.f.hp || a.i - b.i);
      const rows = Math.ceil(here.length / 2);
      // Empilées : chacune recouvre le haut de celle du dessous, sa barre reste visible.
      const step = rows > 1 ? Math.min(ROW_STEP, (STACK_H - ICON - 4) / (rows - 1)) : 0;
      here.forEach(({ u, f }, j) => {
        const unit = el("div", f.dead || f.fled ? "cs-u out" : "cs-u");
        if (f.dead) unit.classList.add("dead");
        if (f.fled) unit.classList.add("fled");
        const flip = el("div", s === 1 ? "cw-uf flip" : "cw-uf");
        const icon = el("img", "cw-ic");
        const info = m.divisions[u.type];
        icon.src = info === undefined ? "" : unitIconUrl(info.icon, u.owner);
        icon.alt = "";
        flip.append(icon);
        if (!f.dead) {
          const bar = el("div", "pz-bar");
          const fill = el("div", "pz-fill");
          const part = Math.max(0, Math.min(1, f.hp / m.stateScale));
          fill.style.height = `${Math.round((ICON - 2) * part)}px`;
          fill.style.background = `hsl(${Math.round(120 * part)},75%,45%)`;
          bar.append(fill);
          flip.append(bar);
        }
        const flag = el("img", "cw-flag");
        flag.src = "icons/miscellaneous/icon-white-flag.png";
        flag.alt = "";
        unit.append(flip, el("div", "cw-cross"), flag);
        // Survol : le même panneau que pour un pion, à l'état de la fin du combat.
        attachTextPanel(unit, () => unitPanel(m, { type: u.type, owner: u.owner, state: f.hp }, f.dead ? "Détruite" : f.fled ? "En repli" : null));
        const row = Math.floor(j / 2);
        unit.style.left = `calc(50% + ${(j % 2 === 0 ? -1 : 1) * 21 - (ICON + 5) / 2 + (row % 2 === 0 ? -3 : 3)}px)`;
        unit.style.top = `${row * step}px`;
        // Les rangées du bas d'abord : celles du haut sont dessinées par-dessus.
        unit.style.zIndex = String(1000 - j);
        stack.append(unit);
      });
      col.append(stack);
      // Ce que la niche a détruit : infanterie, puis véhicules ; le type adverse le plus touché, à sa couleur, barré.
      const kills = el("div", "cs-kills");
      const k = killsBy(c, m, owner, nicheIndex);
      const row = (kill: Kill, format: Intl.NumberFormat): HTMLElement => {
        const r = el("div", "cs-kill");
        const icon = el("div", "cs-kill-icon");
        const img = el("img", sideOf(kill.owner) === 1 ? "cw-ic flip" : "cw-ic");
        const info = m.divisions[kill.type];
        img.src = info === undefined ? "" : unitIconUrl(info.icon, kill.owner);
        img.alt = "";
        icon.append(img, el("div", "cw-cross"));
        r.append(icon, el("span", undefined, format.format(kill.amount)));
        return r;
      };
      // « a éliminé : » puis les victimes (plus tard, l'expérience sera attribuée ici, 10-Combat-Phases §4).
      const shown = [k.infantry, k.vehicles].filter((kill): kill is Kill => kill !== null && Math.round(kill.amount * 10) !== 0);
      if (shown.length > 0) kills.append(el("div", "cs-kills-title", "a éliminé :"));
      for (const kill of shown) kills.append(row(kill, KILLS));
      // Au survol : le détail, chaque type adverse touché, à deux décimales, avec la même mise en page.
      const detail = killsDetail(c, m, owner, nicheIndex);
      if (detail.length > 0) {
        const pop = el("div", "cs-kills-pop");
        for (const kill of detail) pop.append(row(kill, KILLS_DETAIL));
        kills.append(pop);
      }
      col.append(kills);
      return col;
    };
    for (const s of [0, 1] as const) {
      const cols = PHASE_NICHES.map((n) => column(s, n));
      // Camp de gauche : de l'extérieur vers le centre ; camp de droite : du centre vers l'extérieur.
      field.append(...(s === 0 ? [...cols].reverse() : cols));
      if (s === 0) field.append(el("div", "cs-mid"));
    }

    // Blessés de chaque camp (08 §8) : une icône par bonhomme blessé, et leur nombre en rouge.
    const hurt = el("div", "cs-hurt");
    const hurtSide = (s: 0 | 1): HTMLElement => {
      const n = c.losses[(s === 0 ? me : other) === c.attacker ? 0 : 1].wounded;
      const box = el("div", `cs-hurt-side s${s}`);
      const icons = el("div", "cs-hurt-icons");
      for (let k = 0; k < Math.min(n, 12); k++) {
        const img = el("img");
        img.src = "icons/population/pop-hurt.png";
        img.alt = "";
        icons.append(img);
      }
      box.append(icons, el("span", "cs-hurt-n", String(n)));
      return box;
    };
    hurt.append(hurtSide(0), el("div", "cs-hurt-title", "Blessés"), hurtSide(1));

    const again = el("button", "cw-skip", "Revoir le combat");
    again.type = "button";
    again.addEventListener("click", () => {
      this.close();
      this.onReplay?.(c);
    });
    const foot = el("div", "cs-foot");
    foot.append(again);

    this.panel.replaceChildren(head, banner, air, field, hurt, foot);
    this.panel.hidden = false;
  }
}
