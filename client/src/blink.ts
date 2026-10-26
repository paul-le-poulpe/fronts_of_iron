// Clignotement : une seule durée de cycle pour tout ce qui clignote dans le panneau d'un front (boutons d'attaque actifs,
// tableaux de percées). 1 s : une demi-seconde allumé, une demi-seconde éteint (05-Fronts §11.3). Les animations CSS lisent la
// variable `--blink-period` posée par `applyBlinkPeriod`. Le contour d'une ligne de front survolée ne clignote plus.

export const BLINK_PERIOD_MS = 1000;

export function applyBlinkPeriod(): void {
  document.documentElement.style.setProperty("--blink-period", `${BLINK_PERIOD_MS}ms`);
}

