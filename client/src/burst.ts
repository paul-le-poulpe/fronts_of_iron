// Envoi en rafale : sur un bouton qui envoie un ordre répétable (créer une division, ajouter une ligne
// d'usine), Maj envoie l'ordre 5 fois et Ctrl 10 fois. Le moteur valide chaque ordre séparément (règle 4) :
// ceux que le stock ou les inactifs ne permettent plus sont sans effet. Le relais accepte au plus
// `MAX_ORDERS_PER_TURN` ordres par joueur et par tour (01-Architecture §4) ; au-delà, il répond par une erreur,
// que la page affiche comme un message, et l'ordre est perdu.
//
// L'action part à l'appui (`pointerdown`), pas au relâchement : un bouton reconstruit entre l'appui et le
// relâchement (le panneau de production, une fois par tour) ne reçoit jamais son `click`. Le `click` ne
// sert plus qu'au clavier (`detail` vaut 0).
//
// Un petit texte suit la souris au-dessus d'un bouton marqué (`data-burst`) pour rappeler les touches.
//
// Un bouton qui porte `data-burst-blocked` (un texte) n'appelle pas son action : un appui marque le bouton
// (`data-burst-tried`) et le texte s'ajoute en rouge sous les touches, jusqu'à ce que la souris quitte le bouton.

import "./burst.css";

export const BURST_SHIFT = 5;
export const BURST_CTRL = 10;

/** Nombre d'ordres pour cet appui : 10 avec Ctrl (ou Cmd), 5 avec Maj, 1 sinon. */
export function burstCount(e: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean }): number {
  return e.ctrlKey || e.metaKey ? BURST_CTRL : e.shiftKey ? BURST_SHIFT : 1;
}

/**
 * Appelle `action(n)` à chaque appui du bouton principal sur `el` (n : 1, 5 ou 10) ; au clavier, `action(1)`.
 * Marque `el` pour le texte d'aide. Un élément de classe `unavailable` n'affiche pas l'aide.
 */
export function onPress(el: HTMLElement, action: (count: number) => void): void {
  installHint();
  el.dataset["burst"] = "";
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (el.dataset["burstBlocked"] !== undefined) {
      el.dataset["burstTried"] = "";
      showBlocked(el);
      return;
    }
    action(burstCount(e));
  });
  el.addEventListener("pointerleave", () => delete el.dataset["burstTried"]);
  el.addEventListener("click", (e) => {
    if (e.detail === 0 && el.dataset["burstBlocked"] === undefined) action(1);
  });
}

/** Comme `onPress`, mais chaque appui vaut toujours `count`, quelles que soient les touches, et sans texte d'aide. */
export function onFixedPress(el: HTMLElement, count: number, action: (count: number) => void): void {
  el.addEventListener("pointerdown", (e) => {
    if (e.button === 0) action(count);
  });
  el.addEventListener("click", (e) => {
    if (e.detail === 0) action(count);
  });
}

// ---- texte d'aide sous la souris ----

/** Écart entre le pointeur et le texte, en px. */
const OFFSET_PX = 16;

let hint: HTMLElement | null = null;
/** Ligne rouge de l'aide : le texte `data-burst-blocked` du bouton, après un appui. */
let blockedLine: HTMLElement | null = null;

/** Montre la ligne rouge si `target` est un bouton bloqué déjà appuyé, la cache sinon. */
function showBlocked(target: Element | null): void {
  if (blockedLine === null) return;
  const text = target instanceof HTMLElement && target.dataset["burstTried"] !== undefined ? target.dataset["burstBlocked"] : undefined;
  blockedLine.hidden = text === undefined;
  blockedLine.textContent = text ?? "";
}

function installHint(): void {
  if (hint !== null) return;
  const box = document.createElement("div");
  box.id = "burst-hint";
  box.hidden = true;
  const blocked = line("");
  blocked.className = "burst-blocked";
  blocked.hidden = true;
  box.append(line(`Shift + ${BURST_SHIFT}`), line(`Ctrl + ${BURST_CTRL}`), blocked);
  document.body.append(box);
  hint = box;
  blockedLine = blocked;

  document.addEventListener("pointermove", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-burst]:not(.unavailable)") : null;
    if (target === null) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    showBlocked(target);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    // Sous le pointeur, à droite ; de l'autre côté s'il n'y a pas la place.
    const left = e.clientX + OFFSET_PX + w <= window.innerWidth - 4 ? e.clientX + OFFSET_PX : e.clientX - OFFSET_PX - w;
    const top = e.clientY + OFFSET_PX + h <= window.innerHeight - 4 ? e.clientY + OFFSET_PX : e.clientY - OFFSET_PX - h;
    box.style.left = `${Math.max(4, left)}px`;
    box.style.top = `${Math.max(4, top)}px`;
  });
  document.documentElement.addEventListener("pointerleave", () => (box.hidden = true));
  window.addEventListener("blur", () => (box.hidden = true));
}

function line(text: string): HTMLElement {
  const d = document.createElement("div");
  d.textContent = text;
  return d;
}
