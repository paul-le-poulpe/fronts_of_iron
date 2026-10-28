// Diplomatie côté page (00-Game §1) : le petit menu ouvert au clic sur le
// territoire d'un autre joueur, et la conversion des événements diplomatiques
// du moteur en notifications (notifications.ts).
//
// La page ne calcule aucune règle. Elle garde la dernière `DiplomacyView` reçue
// (statuts du joueur humain, propositions qui le concernent, événements du tour)
// et en tire : les lignes du menu, les cartes de proposition reçue (avec
// Accepter / Refuser), et les cartes d'information. Chaque action du menu et
// chaque bouton envoie un ordre par `sendOrder`; le moteur le valide.
//
// Une carte de proposition reçue est créée dès que la proposition est dans la liste
// et retirée dès qu'elle n'y est plus (réponse, expiration, déclaration de guerre) :
// la liste est la source, les événements ne servent qu'aux cartes d'information.

import { dismiss, notify } from "./notifications.ts";
import { localPlayer, playerName } from "./names.ts";
import { playerColor, rgbCss } from "./painter.ts";
import { type DiplomacyEventView, type DiplomacyView, type DiplomaticStatusName, type HumanOrder, type ProposalView } from "./protocol.ts";

const STATUS_LABELS: Readonly<Record<DiplomaticStatusName, string>> = {
  neutral: "Neutre",
  pact: "Pacte de non-agression",
  war: "Guerre",
};

/** Écart entre la souris et le coin du menu, en px. */
const MENU_OFFSET_PX = 8;

const proposalKey = (from: number): string => `proposal:${from}`;

/** Une ligne du menu : une action, ou une action grisée avec la raison. */
interface MenuAction {
  readonly label: string;
  readonly danger?: boolean;
  /** Ordre envoyé au clic. Absent : ligne grisée. */
  readonly order?: HumanOrder;
  /** Raison affichée sur une ligne grisée. */
  readonly note?: string;
}

export class Diplomacy {
  private readonly sendOrder: (order: HumanOrder) => void;
  private readonly menu: HTMLElement;
  private view: DiplomacyView | null = null;
  /** Joueur du menu ouvert, 0 si fermé. */
  private target = 0;
  /** Contenu du menu affiché : le menu n'est reconstruit que s'il change, sinon un clic en cours serait perdu. */
  private menuKey = "";
  /** Dernière position de la souris, en px de la fenêtre. */
  private pointer = { x: 0, y: 0 };
  /** Cartes de proposition reçue affichées, par auteur de la proposition. */
  private readonly shown = new Set<number>();

  constructor(sendOrder: (order: HumanOrder) => void) {
    this.sendOrder = sendOrder;
    this.menu = document.createElement("div");
    this.menu.id = "dip-menu";
    this.menu.setAttribute("role", "menu");
    this.menu.hidden = true;
    document.body.append(this.menu);

    // Position de la souris au moment du clic sur la carte (le crochet `onClick` de la vue n'en reçoit pas).
    const track = (e: PointerEvent): void => {
      this.pointer = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", track, true);
    document.addEventListener("pointerdown", track, true);
    // Un clic en dehors du menu le ferme ; un clic sur la carte peut en ouvrir un autre juste après.
    document.addEventListener("pointerdown", (e) => {
      if (this.target !== 0 && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
    // La molette déplace la case sous la souris : le menu ne désignerait plus rien.
    document.addEventListener("wheel", () => this.closeMenu(), { passive: true });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeMenu();
    });
  }

  /** Début ou fin de partie : ferme le menu et oublie l'état reçu. Les cartes sont retirées par `clearNotifications`. */
  reset(): void {
    this.closeMenu();
    this.view = null;
    this.shown.clear();
  }

  /** Reçoit la diplomatie d'un tour : met à jour le menu ouvert et les notifications. */
  update(view: DiplomacyView): void {
    this.view = view;
    this.syncProposalCards(view);
    for (const event of view.events) this.notifyEvent(event);
    if (this.target !== 0) this.renderMenu();
  }

  /**
   * Clic sur le territoire de `owner` (0 : personne). Ouvre le menu de ce joueur à côté
   * de la souris, ou ferme le menu si le clic ne désigne pas un autre joueur.
   */
  openFor(owner: number): void {
    if (owner === 0 || owner === localPlayer() || this.view === null) {
      this.closeMenu();
      return;
    }
    this.target = owner;
    this.menuKey = "";
    this.renderMenu();
    this.menu.hidden = false;
    this.place();
  }

  closeMenu(): void {
    this.target = 0;
    this.menuKey = "";
    this.menu.hidden = true;
  }

  // ---- menu ----

  /** Les actions possibles envers le joueur `target`, d'après le tableau du 00-Game §1. */
  private actionsFor(target: number, view: DiplomacyView): MenuAction[] {
    const status = view.status[target - 1] ?? "neutral";
    const pending = view.proposals.find((p) => (p.from === target && p.to === localPlayer()) || (p.from === localPlayer() && p.to === target));
    const note = pending === undefined ? undefined : pending.from === localPlayer() ? "En attente de réponse" : "Proposition reçue";
    const propose = (label: string, order: HumanOrder): MenuAction =>
      note === undefined ? { label, order } : { label, note };
    switch (status) {
      case "neutral":
        return [
          { label: "Déclarer la guerre", danger: true, order: { type: "declare_war", target } },
          propose("Proposer un pacte", { type: "propose_pact", target }),
        ];
      case "pact":
        return [{ label: "Rompre le pacte", danger: true, order: { type: "break_pact", target } }];
      case "war":
        return [propose("Proposer la paix", { type: "propose_peace", target })];
    }
  }

  private renderMenu(): void {
    const view = this.view;
    const target = this.target;
    if (view === null || target === 0) return;
    const status = view.status[target - 1] ?? "neutral";
    const actions = this.actionsFor(target, view);
    const key = `${target}|${status}|${actions.map((a) => `${a.label}:${a.note ?? ""}`).join(",")}`;
    if (key === this.menuKey) return;
    this.menuKey = key;

    const head = document.createElement("div");
    head.className = "dip-head";
    const swatch = document.createElement("span");
    swatch.className = "sw";
    swatch.style.background = rgbCss(playerColor(target));
    const name = document.createElement("strong");
    name.textContent = playerName(target);
    const badge = document.createElement("span");
    badge.className = `dip-badge ${status}`;
    badge.textContent = STATUS_LABELS[status];
    head.append(swatch, name, badge);

    const rows = actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.className = action.danger === true ? "danger" : "";
      const label = document.createElement("span");
      label.textContent = action.label;
      button.append(label);
      if (action.order === undefined) {
        button.disabled = true;
        const reason = document.createElement("span");
        reason.className = "dip-note";
        reason.textContent = action.note ?? "";
        button.append(reason);
      } else {
        const order = action.order;
        button.addEventListener("click", () => {
          this.sendOrder(order);
          this.closeMenu();
        });
      }
      return button;
    });
    this.menu.replaceChildren(head, ...rows);
    if (!this.menu.hidden) this.place();
  }

  /** Coin haut gauche du menu à côté de la souris, sans sortir de la fenêtre. */
  private place(): void {
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    const x = Math.min(this.pointer.x + MENU_OFFSET_PX, window.innerWidth - w - 4);
    const y = Math.min(this.pointer.y + MENU_OFFSET_PX, window.innerHeight - h - 4);
    this.menu.style.left = `${Math.max(4, x)}px`;
    this.menu.style.top = `${Math.max(4, y)}px`;
  }

  // ---- notifications ----

  /** Une carte à boutons par proposition reçue ; retirée quand la proposition n'est plus dans la liste. */
  private syncProposalCards(view: DiplomacyView): void {
    const received = view.proposals.filter((p) => p.to === localPlayer());
    for (const p of received) {
      if (this.shown.has(p.from)) continue;
      this.shown.add(p.from);
      this.notifyProposal(p);
    }
    for (const from of [...this.shown]) {
      if (received.some((p) => p.from === from)) continue;
      this.shown.delete(from);
      dismiss(proposalKey(from));
    }
  }

  private notifyProposal(p: ProposalView): void {
    const answer = (accept: boolean) => () => this.sendOrder({ type: "answer_proposal", from: p.from, accept });
    notify({
      key: proposalKey(p.from),
      text: p.kind === "pact" ? `${playerName(p.from)} vous propose un pacte de non-agression` : `${playerName(p.from)} vous propose la paix`,
      color: rgbCss(playerColor(p.from)),
      buttons: [
        { label: "Accepter", kind: "primary", onClick: answer(true) },
        { label: "Refuser", onClick: answer(false) },
      ],
      lifetime: { startTurn: p.startTick, endTurn: p.endTick },
    });
  }

  /**
   * Cartes d'information pour les événements qui concernent le joueur humain. Ce qu'il a
   * fait lui-même (guerre déclarée, pacte rompu, proposition envoyée, réponse donnée à
   * une proposition qu'il refuse) n'a pas de carte : le menu et la carte de proposition
   * en tiennent lieu.
   */
  private notifyEvent(e: DiplomacyEventView): void {
    const info = (other: number, text: string): void => notify({ text, color: rgbCss(playerColor(other)) });
    switch (e.type) {
      case "war_declared":
        if (e.to === localPlayer()) info(e.from, `${playerName(e.from)} vous a déclaré la guerre`);
        break;
      case "pact_broken":
        if (e.to === localPlayer()) info(e.from, `${playerName(e.from)} a rompu le pacte`);
        break;
      case "proposal_accepted": {
        const other = e.from === localPlayer() ? e.to : e.from;
        info(other, e.kind === "pact" ? `Pacte de non-agression conclu avec ${playerName(other)}` : `Paix conclue avec ${playerName(other)}`);
        break;
      }
      case "proposal_refused":
        if (e.from === localPlayer()) {
          info(e.to, `${playerName(e.to)} a refusé votre proposition de ${e.kind === "pact" ? "pacte" : "paix"}`);
        }
        break;
      case "proposal_expired":
        if (e.from === localPlayer()) info(e.to, `Votre proposition à ${playerName(e.to)} a expiré`);
        break;
      case "proposal_sent":
        break;
    }
  }
}
