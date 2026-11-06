// Tutoriel (Docs/Design/07-Tutoriel.md) : un composant de l'interface marqué `data-tuto="<id>"` a un contour bleu qui
// pulse tant que le joueur n'a pas lu sa leçon. Le premier clic sur ce composant ouvre la leçon dans un encadré et ne
// déclenche pas l'action du composant ; les clics suivants sont normaux.
//
// L'attribut est écrit par le code qui construit le composant (ou dans index.html) et reste posé : un panneau
// reconstruit à chaque tour le retrouve. Les leçons lues sont gardées dans `localStorage` ; une feuille de style
// générée éteint leur contour (`[data-tuto="x"] { outline: none }`), sans toucher aux éléments eux-mêmes.
//
// Une leçon est marquée lue dès son ouverture : fermer l'encadré en cliquant ailleurs ne la fait pas revenir.

import { hideTip } from "./tooltip.ts";

/** Texte d'une leçon : un titre, puis des paragraphes. N'explique que des règles écrites dans Docs/Design/. */
interface Lesson {
  title: string;
  body: readonly string[];
}

/**
 * Leçons, par id de `data-tuto`. Textes provisoires, à relire avec l'auteur (07-Tutoriel.md), qui donne aussi le
 * composant de chaque id et la règle d'où vient le texte.
 */
const LESSONS: Readonly<Record<string, Lesson>> = {
  // Barre de boutons (index.html).
  found: {
    title: "Créer une ville",
    body: [
      "Une ville contrôle les cases autour d'elle. Cliquez ici, puis sur une case de terre libre.",
      "La première ville est gratuite. Les suivantes coûtent des bonshommes d'Inactifs et se posent dans le rayon d'expansion d'une des vôtres.",
    ],
  },
  production: {
    title: "Production",
    body: ["Ouvre ou ferme le panneau de production."],
  },
  // Panneau de production (production.ts, 08-Population.md §11).
  "prod-box": {
    title: "Ligne de production",
    body: [
      "Le fer consommé est à gauche, ce qui est produit à droite.",
      "Les bonshommes vont d'abord aux lignes du haut, et les disparitions commencent par celles du bas. S'il manque du fer, toutes les lignes perdent la même part de leur production. Glissez la poignée ⋮⋮ pour changer l'ordre.",
    ],
  },
  "prod-pawn": {
    title: "Pions",
    body: [
      "Un pion est un bonhomme ou une machine. Avec l'auto-assignation, ils se placent seuls de haut en bas : cliquez sur un poste pour le désactiver, avec ceux à sa droite. Sans elle, glissez un pion sur une autre ligne : il part avec ceux du même type à sa droite.",
      "Contour et barre : à venir. Clignotant : en trop, il va disparaître. Case en pointillés : poste vacant.",
    ],
  },
  "prod-parent": {
    title: "Lignes à débloquer",
    body: ["Survolez le cadenas pour voir ce que cette ligne débloque."],
  },
  "prod-locked": {
    title: "Ligne verrouillée",
    body: ["Se débloque quand la barre est pleine. Plus il y a d'ouvriers dans la ligne du symbole devant la barre, plus c'est rapide."],
  },
  // Onglets de la barre d'informations (infobar.ts).
  "tab-flow": {
    title: "Ressources",
    body: ["Le fer des mineurs, réservé par les usines et les casernes servies, et les machines possédées sur leur limite. Rien ne se stocke."],
  },
  "tab-forces": {
    title: "Forces",
    body: ["Toutes vos divisions. Elles apparaissent quand une usine ou une caserne en a la limite ; glissez un pion sur un front pour l'y envoyer."],
  },
  "tab-diplomacy": {
    title: "Diplomatie",
    body: ["Cliquez sur un joueur pour changer de statut avec lui. Le combat n'est possible qu'en guerre."],
  },
  // Symboles à infobulle (infobar.ts).
  pie: {
    title: "Répartition",
    body: ["Part de cette ressource prise par chaque produit. Survolez le camembert pour le détail."],
  },
  // Fenêtre d'un front (frontwindow.ts, stattotals.ts).
  attack: {
    title: "Attaque sur tout le front",
    body: [
      "Le combat est calculé d'un coup après le délai affiché sur le bouton. Un clic pendant le délai l'annule.",
      "Sans infanterie en première ligne, pas de combat.",
    ],
  },
  lines: {
    title: "Lignes",
    body: [
      "Chaque niche a sa première ligne, de la largeur du front : seules ses divisions combattent. Le pourcentage est la part du front couverte.",
      "La seconde ligne attend et remplit la première quand une place se libère.",
    ],
  },
  rapid: {
    title: "Réaction rapide",
    body: [
      "Ne prend pas part à l'attaque sur tout le front. Elle contre-attaque quand l'adversaire perce votre première ligne ; des unités motorisées y sont plus efficaces.",
    ],
  },
  pierce: {
    title: "Forces de percée",
    body: [
      "Déposez des divisions sur « + » pour créer une boîte, puis « Lancer » et choisissez un axe sur la carte.",
      "Une percée attaque une seule liaison du front. La boîte doit contenir de l'infanterie.",
    ],
  },
  "attack-types": {
    title: "Types d'attaque",
    body: ["L'attaque anti-infanterie touche les divisions non blindées, l'attaque anti-armure les blindées."],
  },
  "niche-infantry": {
    title: "Infanterie",
    body: [
      "Elle défend mieux qu'elle n'attaque.",
      "Elle est indispensable : il en faut en première ligne pour attaquer, dans la boîte pour percer. Sans elle, l'appui-feu ne combat pas.",
    ],
  },
  "niche-tanks": {
    title: "Chars",
    body: [
      "Blindés, ils ne prennent que les dégâts anti-armure.",
      "Les dégâts sont partagés entre infanterie et chars : les chars protègent l'infanterie en diluant les dégâts, et protègent aussi l'appui-feu.",
    ],
  },
  "niche-support": {
    title: "Appui-feu",
    body: ["Antichar, antiaérien et artillerie attaquent depuis l'arrière, seulement si de l'infanterie est engagée."],
  },
};

const SEEN_KEY = "foi.tutorialSeen";
/** Écart entre le composant et l'encadré, en px. */
const GAP_PX = 8;

/** Ids des leçons lues. */
const seen = new Set<string>();
/** Feuille de style qui éteint le contour des leçons lues. */
let seenStyle: HTMLStyleElement | null = null;
/** Ferme l'encadré ; sans effet avant `installTutorial`. */
let close = (): void => {};

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Toute lecture ou écriture peut lever (stockage bloqué) : le tutoriel marche alors pour la page en cours seulement. */
function load(): void {
  try {
    const raw = store()?.getItem(SEEN_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") seen.add(id);
  } catch {
    // Valeur illisible : aucune leçon lue.
  }
}

function save(): void {
  try {
    store()?.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Pas de stockage : les leçons reviendront à la prochaine page.
  }
}

/** Réécrit la feuille de style des leçons lues. Les ids sont ceux de `LESSONS`, jamais une saisie du joueur. */
function applySeen(): void {
  if (seenStyle === null) return;
  const selectors = [...seen].map((id) => `[data-tuto="${id}"]`);
  seenStyle.textContent = selectors.length > 0 ? `${selectors.join(",")} { outline: none; animation: none; }` : "";
}

/** Le plus proche ancêtre de `node` (lui compris) marqué d'une leçon existante et non lue, ou `null`. */
function unreadAt(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof Element ? node.closest<HTMLElement>("[data-tuto]") : null;
  while (el !== null) {
    const id = el.dataset.tuto ?? "";
    if (LESSONS[id] !== undefined && !seen.has(id)) return el;
    el = el.parentElement?.closest<HTMLElement>("[data-tuto]") ?? null;
  }
  return null;
}

/** Remet toutes les leçons à lire (menu « Tutoriel »). */
export function resetTutorial(): void {
  close();
  seen.clear();
  save();
  applySeen();
}

/** Marque toutes les leçons lues : plus aucun contour (menu « Tutoriel »). */
export function skipTutorial(): void {
  close();
  for (const id of Object.keys(LESSONS)) seen.add(id);
  save();
  applySeen();
}

export function installTutorial(): void {
  load();
  seenStyle = document.createElement("style");
  document.head.append(seenStyle);
  applySeen();

  const box = document.createElement("div");
  box.id = "tuto";
  box.setAttribute("role", "dialog");
  box.hidden = true;
  document.body.append(box);

  close = () => {
    box.hidden = true;
  };

  /** Sous le composant, aligné sur son bord gauche, sans sortir de la fenêtre ; au-dessus s'il n'y a pas la place. */
  const place = (el: Element): void => {
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const below = r.bottom + GAP_PX;
    box.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
    box.style.top = `${below + h <= window.innerHeight - 4 ? below : Math.max(4, r.top - GAP_PX - h)}px`;
  };

  const open = (el: HTMLElement): void => {
    const id = el.dataset.tuto ?? "";
    const lesson = LESSONS[id];
    if (lesson === undefined) return;
    seen.add(id);
    save();
    applySeen();
    hideTip();
    const title = document.createElement("h4");
    title.textContent = lesson.title;
    const paragraphs = lesson.body.map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Compris";
    ok.addEventListener("click", close);
    box.replaceChildren(title, ...paragraphs, ok);
    box.hidden = false;
    place(el);
  };

  // Fenêtre redimensionnée ou conteneur défilé : l'encadré ne serait plus à côté de son composant, il se ferme.
  window.addEventListener("resize", close);
  document.addEventListener("scroll", close, true);

  // Phase de capture sur `window` : passe avant les écouteurs du composant (glisser-déposer compris, qui part de
  // `pointerdown`). Le `click` qui suit le `pointerdown` consommé est consommé lui aussi.
  let swallowClick: Element | null = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      swallowClick = null;
      if (e.target instanceof Node && box.contains(e.target)) return;
      const el = e.button === 0 ? unreadAt(e.target) : null;
      if (el === null) return close();
      e.preventDefault();
      e.stopPropagation();
      swallowClick = el;
      open(el);
    },
    true,
  );
  window.addEventListener(
    "click",
    (e) => {
      if (e.target instanceof Node && box.contains(e.target)) return;
      const swallowed = swallowClick !== null && e.target instanceof Node && swallowClick.contains(e.target);
      swallowClick = null;
      // Un clic sans `pointerdown` (touche Entrée sur un bouton) ouvre aussi la leçon.
      const el = swallowed ? null : unreadAt(e.target);
      if (!swallowed && el === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (el !== null) open(el);
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
