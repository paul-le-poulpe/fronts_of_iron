// Thème clair ou sombre de la fenêtre d'un front et de l'onglet des forces (05-Fronts §11.8). Le thème est un
// attribut de `<html>` (`data-theme`) que forces.css lit ; le bouton de debug « Thème » le bascule. Provisoire :
// remplacé plus tard par un panneau de configuration du joueur. Sombre au départ.

export type Theme = "dark" | "light";

const root = document.documentElement;
if (root.dataset.theme === undefined) root.dataset.theme = "dark";

export const currentTheme = (): Theme => (root.dataset.theme === "light" ? "light" : "dark");

/** Passe de l'un à l'autre et renvoie le nouveau thème. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  return next;
}
