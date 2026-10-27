// Notifications de la page : une pile de cartes en bas à gauche de la carte, la
// plus récente en bas. Ce module ne connaît aucun système du jeu : il affiche un
// texte, une couleur, éventuellement des boutons, et retire la carte.
//
// Toute carte a une petite croix qui la retire. Une carte sans bouton disparaît toute seule après `durationMs` (ou au clic).
// Une carte avec boutons reste jusqu'à ce que l'appelant la retire (`dismiss`),
// ou jusqu'au tour `lifetime.endTurn`. Si `lifetime` est donné, une barre fine
// montre le temps restant, recalculé à chaque appel d'`updateNotifications` (un
// par tour) : la barre n'avance donc pas entre deux tours.
//
// Après un clic sur un bouton de la carte, tous ses boutons sont désactivés : un
// second clic enverrait un second ordre avant que le moteur ait répondu.
//
// Le conteneur (`#notifs`) est un enfant de `#stage` : voir style.css.

/** Durée d'affichage d'une carte sans bouton, en ms. Valeur provisoire. */
const DEFAULT_DURATION_MS = 30_000;
/** Nombre de cartes au-delà duquel les plus anciennes cartes sans bouton sont retirées. Valeur provisoire. */
const MAX_CARDS = 6;

export interface NotificationButton {
  readonly label: string;
  /** "primary" : bouton plein ; "danger" : texte et bordure rouges. Sans valeur : bouton ordinaire. */
  readonly kind?: "primary" | "danger";
  readonly onClick: () => void;
}

export interface NotificationOptions {
  /** Identifiant pour `dismiss`. Une carte de même clé remplace la précédente. */
  readonly key?: string;
  readonly text: string;
  /** Couleur CSS du trait à gauche de la carte (par exemple celle d'un joueur). */
  readonly color?: string;
  readonly buttons?: readonly NotificationButton[];
  /** Tours de début et de fin : la barre de temps restant va de l'un à l'autre, et la carte est retirée au tour de fin. */
  readonly lifetime?: { readonly startTurn: number; readonly endTurn: number };
  /** Cartes sans bouton seulement : durée d'affichage en ms. */
  readonly durationMs?: number;
}

interface Card {
  readonly key: string | undefined;
  readonly root: HTMLElement;
  readonly hasButtons: boolean;
  readonly lifetime: { readonly startTurn: number; readonly endTurn: number } | undefined;
  readonly bar: HTMLElement | null;
  timer: number;
}

let container: HTMLElement | null = null;
/** Cartes affichées, de la plus ancienne à la plus récente (même ordre que dans le DOM). */
let cards: Card[] = [];
/** Dernier tour reçu : sert à placer la barre d'une carte qui vient d'être créée. */
let lastTurn = 0;

/** À appeler une fois, avec l'élément qui contient la pile. */
export function installNotifications(root: HTMLElement): void {
  container = root;
}

/** Retire toutes les cartes (début ou fin de partie). */
export function clearNotifications(): void {
  for (const card of [...cards]) remove(card);
  lastTurn = 0;
}

/** Retire la carte de cette clé, si elle est affichée. */
export function dismiss(key: string): void {
  const card = cards.find((c) => c.key === key);
  if (card !== undefined) remove(card);
}

/** À appeler à chaque tour : met à jour les barres de temps restant et retire les cartes arrivées à leur tour de fin. */
export function updateNotifications(turn: number): void {
  lastTurn = turn;
  for (const card of [...cards]) {
    if (card.lifetime === undefined) continue;
    if (turn >= card.lifetime.endTurn) remove(card);
    else setBar(card, turn);
  }
}

export function notify(options: NotificationOptions): void {
  if (container === null) return;
  if (options.key !== undefined) dismiss(options.key);

  const root = document.createElement("div");
  root.className = "notif";
  if (options.color !== undefined) root.style.setProperty("--notif-color", options.color);
  const text = document.createElement("div");
  text.className = "notif-text";
  text.textContent = options.text;
  root.append(text);

  const buttons = options.buttons ?? [];
  if (buttons.length > 0) {
    const row = document.createElement("div");
    row.className = "notif-buttons";
    for (const b of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = b.label;
      if (b.kind !== undefined) button.classList.add(b.kind);
      button.addEventListener("click", () => {
        for (const other of row.querySelectorAll("button")) other.disabled = true;
        b.onClick();
      });
      row.append(button);
    }
    root.append(row);
  }

  let bar: HTMLElement | null = null;
  if (options.lifetime !== undefined) {
    const track = document.createElement("div");
    track.className = "notif-bar";
    bar = document.createElement("i");
    track.append(bar);
    root.append(track);
  }

  const card: Card = { key: options.key, root, hasButtons: buttons.length > 0, lifetime: options.lifetime, bar, timer: 0 };
  const close = document.createElement("button");
  close.type = "button";
  close.className = "notif-close";
  close.textContent = "×";
  close.title = "Fermer";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    remove(card);
  });
  root.append(close);
  if (!card.hasButtons) {
    root.classList.add("dismissable");
    root.addEventListener("click", () => remove(card));
    card.timer = window.setTimeout(() => remove(card), options.durationMs ?? DEFAULT_DURATION_MS);
  }
  cards.push(card);
  container.append(root);
  setBar(card, lastTurn);

  // Trop de cartes : on retire les plus anciennes qui n'ont pas de bouton (celles à boutons attendent une réponse).
  for (const old of [...cards]) {
    if (cards.length <= MAX_CARDS) break;
    if (!old.hasButtons) remove(old);
  }
}

function setBar(card: Card, turn: number): void {
  if (card.bar === null || card.lifetime === undefined) return;
  const { startTurn, endTurn } = card.lifetime;
  const total = Math.max(1, endTurn - startTurn);
  const left = Math.min(1, Math.max(0, (endTurn - turn) / total));
  card.bar.style.width = `${(100 * left).toFixed(1)}%`;
}

function remove(card: Card): void {
  window.clearTimeout(card.timer);
  card.root.remove();
  cards = cards.filter((c) => c !== card);
}
