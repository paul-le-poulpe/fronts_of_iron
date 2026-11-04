// Combats résolus en un tour par le moteur (Docs/Design/06-Combat-Simplifie.md §2) :
// - `CombatIcons` : une icône par combat récent du joueur local, posée sur la carte au
//   milieu de la connexion du combat, retirée après `ICON_TURNS` tours ou au clic ;
// - `CombatReplay` : le panneau qui rejoue un rapport (`CombatView`) round par round.
//   Les deux camps sont en deux colonnes face à face ; à chaque round, la barre de vie de
//   chaque division baisse de sa perte, la perte s'affiche au-dessus, une division
//   détruite s'efface, une division en fuite recule.
// Le rapport vient du moteur : rien ici ne recalcule un combat.

import { icon32Path } from "./icons.ts";
import { playerName } from "./names.ts";
import type { CombatView, MilitaryCatalog } from "./protocol.ts";

/** Durée de vie d'une icône de combat sur la carte, en tours (300 = 30 s ; provisoire, 06-Combat-Simplifie §2). */
const ICON_TURNS = 300;
/** Durée d'un round dans le replay, en ms (provisoire, 06-Combat-Simplifie §2). */
const ROUND_MS = 600;
/** Durée de l'approche des deux colonnes avant le premier round, en ms. */
const APPROACH_MS = 700;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Une ligne d'historique : « tour, attaquant, résultat » (fenêtre d'un front, 06-Combat-Simplifie §2). */
export function combatSummary(c: CombatView, me: number): string {
  const seconds = Math.floor(c.tick / 10);
  const who = c.attacker === me ? `Vous attaquez ${playerName(c.defender)}` : `${playerName(c.attacker)} vous attaque`;
  const advance = c.rounds.reduce((s, r) => s + r.advance, 0);
  const result = c.captured !== 0 ? `ville n° ${c.captured} prise` : advance > 0 ? `avancée ${Math.round(advance / 10)} %` : "pas d'avancée";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} — ${who} — ${result}`;
}

export class CombatReplay {
  private readonly root: HTMLElement;
  private readonly military: MilitaryCatalog;
  private readonly me: () => number;
  private readonly panel: HTMLElement;
  private timers: number[] = [];

  constructor(root: HTMLElement, military: MilitaryCatalog, me: () => number) {
    this.root = root;
    this.military = military;
    this.me = me;
    this.panel = el("div", "cr themed");
    this.panel.hidden = true;
    this.root.append(this.panel);
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  open(c: CombatView): void {
    this.close();
    const me = this.me();
    const scale = this.military.stateScale;
    const head = el("div", "cr-head");
    head.append(el("strong", undefined, c.attacker === me ? `Votre attaque contre ${playerName(c.defender)}` : `Attaque de ${playerName(c.attacker)}`));
    const skip = el("button", "fw-btn", "Passer");
    skip.type = "button";
    const closeBtn = el("button", "fw-btn", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => this.close());
    head.append(el("div", "fw-spacer"), skip, closeBtn);

    // Le joueur local à gauche, l'adversaire à droite.
    const left = me === c.defender ? c.defender : c.attacker;
    const field = el("div", "cr-field");
    const cols = [el("div", "cr-col cr-left"), el("div", "cr-col cr-right")];
    field.append(cols[0]!, cols[1]!);
    const round = el("div", "cr-round", "");
    const result = el("div", "cr-result");

    const hp = c.units.map((u) => u.start);
    const cards = c.units.map((u) => {
      const info = this.military.divisions[u.type];
      const card = el("div", "cr-unit");
      const img = el("img", "cr-icon");
      img.src = info === undefined ? "" : `icons/${icon32Path(info.icon)}`;
      img.alt = "";
      const bar = el("div", "cr-bar");
      const fill = el("div", "cr-fill");
      fill.style.width = `${(100 * u.start) / scale}%`;
      bar.append(fill);
      const dmg = el("div", "cr-dmg");
      card.append(dmg, img, bar);
      card.title = info?.id ?? "";
      cols[u.owner === left ? 0 : 1]!.append(card);
      return { card, fill, dmg };
    });
    this.panel.replaceChildren(head, round, field, result);
    this.panel.hidden = false;

    let next = 0;
    const showRound = (): void => {
      const r = next++;
      const rd = c.rounds[r]!;
      round.textContent = `Round ${r + 1} / ${c.rounds.length}`;
      for (const k of cards) k.dmg.textContent = "";
      for (const [i, loss] of rd.hits) {
        const k = cards[i]!;
        hp[i] = Math.max(0, hp[i]! - loss);
        k.fill.style.width = `${(100 * hp[i]!) / scale}%`;
        if (loss > 0) {
          k.dmg.textContent = `−${Math.max(1, Math.round((100 * loss) / scale))} %`;
          k.card.classList.remove("hit");
          void k.card.offsetWidth;
          k.card.classList.add("hit");
        }
      }
      for (const i of rd.destroyed) cards[i]!.card.classList.add("dead");
      for (const i of rd.fled) cards[i]!.card.classList.add("fled");
    };
    const finish = (): void => {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      while (next < c.rounds.length) showRound();
      for (const k of cards) k.dmg.textContent = "";
      round.textContent = `${c.rounds.length} round${c.rounds.length > 1 ? "s" : ""}`;
      const lost = (owner: number): number =>
        c.units.reduce((s, u, i) => (u.owner === owner ? s + u.start - hp[i]! : s), 0);
      const advance = c.rounds.reduce((s, r) => s + r.advance, 0);
      const pct = (n: number): string => `${Math.round((100 * n) / scale)} %`;
      result.textContent =
        `Pertes : vous ${pct(lost(me))} de division, ${playerName(me === c.attacker ? c.defender : c.attacker)} ${pct(lost(me === c.attacker ? c.defender : c.attacker))}. ` +
        (c.captured !== 0 ? `Ville n° ${c.captured} prise.` : advance > 0 ? `Le front avance de ${Math.round(advance / 10)} %.` : "Le front ne bouge pas.");
      skip.disabled = true;
    };
    skip.addEventListener("click", finish);

    field.classList.add("apart");
    this.timers.push(window.setTimeout(() => field.classList.remove("apart"), 30));
    c.rounds.forEach((_, r) => this.timers.push(window.setTimeout(showRound, APPROACH_MS + r * ROUND_MS)));
    this.timers.push(window.setTimeout(finish, APPROACH_MS + c.rounds.length * ROUND_MS));
  }
}

/** Ce que les icônes lisent de la carte : la case de chaque ville et la position à l'écran d'une case. */
export interface CombatIconHost {
  cityTile(city: number): number | undefined;
  /** Coordonnées CSS (dans `#stage`) du centre d'une case, ou `null` si la vue n'est pas prête. */
  tileToCss(x: number, y: number): { x: number; y: number } | null;
  readonly width: number;
}

export class CombatIcons {
  private readonly layer: HTMLElement;
  private readonly host: CombatIconHost;
  private readonly onOpen: (c: CombatView) => void;
  private readonly icons = new Map<number, { readonly combat: CombatView; readonly el: HTMLElement }>();
  /** Combats déjà vus : une icône retirée ne revient pas quand la liste est renvoyée. */
  private readonly seen = new Set<number>();

  constructor(root: HTMLElement, host: CombatIconHost, onOpen: (c: CombatView) => void) {
    this.layer = el("div", "cr-icons");
    root.append(this.layer);
    this.host = host;
    this.onOpen = onOpen;
  }

  clear(): void {
    this.icons.clear();
    this.seen.clear();
    this.layer.replaceChildren();
  }

  /** Nouvelle liste des combats du joueur local : une icône pour chaque combat récent pas encore vu. */
  setCombats(combats: readonly CombatView[], tick: number): void {
    for (const c of combats) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      if (tick - c.tick > ICON_TURNS) continue;
      const b = el("button", "cr-mapicon", "⚔");
      b.type = "button";
      b.title = "Voir le combat";
      b.addEventListener("click", () => {
        this.remove(c.id);
        this.onOpen(c);
      });
      this.layer.append(b);
      this.icons.set(c.id, { combat: c, el: b });
    }
    this.place();
  }

  private remove(id: number): void {
    this.icons.get(id)?.el.remove();
    this.icons.delete(id);
  }

  /** Retire les icônes trop anciennes ; à appeler à chaque tour. */
  expire(tick: number): void {
    for (const [id, i] of [...this.icons]) if (tick - i.combat.tick > ICON_TURNS) this.remove(id);
  }

  /** Replace les icônes ; à appeler après chaque dessin de la carte (déplacement, zoom). */
  place(): void {
    const w = this.host.width;
    for (const { combat, el: b } of this.icons.values()) {
      const t1 = this.host.cityTile(combat.city1);
      const t2 = this.host.cityTile(combat.city2);
      if (t1 === undefined || t2 === undefined) continue;
      const p = this.host.tileToCss(((t1 % w) + (t2 % w)) / 2, (Math.floor(t1 / w) + Math.floor(t2 / w)) / 2);
      if (p === null) continue;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
    }
  }
}
