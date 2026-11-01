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
    if (e.button === 0) action(burstCount(e));
  });
  el.addEventListener("click", (e) => {
    if (e.detail === 0) action(1);
  });
}

// ---- texte d'aide sous la souris ----

/** Écart entre le pointeur et le texte, en px. */
const OFFSET_PX = 16;

let hint: HTMLElement | null = null;

function installHint(): void {
  if (hint !== null) return;
  const box = document.createElement("div");
  box.id = "burst-hint";
  box.hidden = true;
  box.append(line(`Shift + ${BURST_SHIFT}`), line(`Ctrl + ${BURST_CTRL}`));
  document.body.append(box);
  hint = box;

  document.addEventListener("pointermove", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-burst]:not(.unavailable)") : null;
    if (target === null) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
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
