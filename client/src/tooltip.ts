// Infobulles de la page : un encadré affiché sous l'élément survolé, à la place
// de l'infobulle du navigateur (lente à venir, petite). Le texte est celui de
// l'attribut `title`, écrit partout dans le code comme d'habitude.
//
// Au survol, le `title` de l'élément est déplacé dans `data-tip` : le navigateur
// n'a plus de `title` à afficher. Un `title` réécrit plus tard (texte qui change
// à chaque tour) est repris au survol suivant.
//
// Infobulle construite (`setTip`) : une fonction qui renvoie le contenu (titres,
// sections, barres) au lieu d'un texte. Elle est appelée à l'affichage, puis à
// chaque `refreshTip` tant que l'encadré reste affiché (une fois par tour).

/** Délai avant l'affichage, en ms. */
const SHOW_DELAY_MS = 120;
/** Écart entre l'élément et l'encadré, en px. */
const GAP_PX = 6;

/** Contenu construit de chaque élément enregistré par `setTip`. */
const builders = new WeakMap<Element, () => Node>();
/** Reconstruit l'encadré affiché ; sans effet avant `installTooltips`. */
let refresh = (): void => {};

/** Donne à `el` une infobulle construite par `build` (à la place d'un `title`). */
export function setTip(el: Element, build: () => Node): void {
  builders.set(el, build);
  el.removeAttribute("title");
  el.setAttribute("data-tip", "");
}

/** À appeler quand les données changent (chaque tour) : reconstruit l'infobulle construite affichée. */
export function refreshTip(): void {
  refresh();
}

export function installTooltips(): void {
  const box = document.createElement("div");
  box.id = "tip";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  document.body.append(box);

  let target: Element | null = null;
  let timer = 0;

  const hide = (): void => {
    window.clearTimeout(timer);
    target = null;
    box.hidden = true;
  };

  /** Sous l'élément, aligné sur son bord gauche, sans sortir de la fenêtre ; au-dessus s'il n'y a pas la place. */
  const place = (el: Element): void => {
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
    const below = r.bottom + GAP_PX;
    const top = below + h <= window.innerHeight - 4 ? below : Math.max(4, r.top - GAP_PX - h);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  };

  const show = (el: Element): void => {
    const build = builders.get(el);
    if (build) {
      box.replaceChildren(build());
    } else {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      box.textContent = text;
    }
    box.classList.toggle("rich", build !== undefined);
    box.hidden = false;
    place(el);
  };

  refresh = () => {
    if (target === null || box.hidden || !builders.has(target)) return;
    if (!target.isConnected) return hide();
    show(target);
  };

  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element).closest("[title], [data-tip]");
    if (el === target) return;
    hide();
    if (el === null) return;
    const title = el.getAttribute("title");
    if (title !== null) {
      el.setAttribute("data-tip", title);
      el.removeAttribute("title");
    }
    target = el;
    timer = window.setTimeout(() => show(el), SHOW_DELAY_MS);
  });
  document.addEventListener("pointerdown", hide);
  document.documentElement.addEventListener("pointerleave", hide);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}
