// Clignotement : une seule durée de cycle pour tout ce qui clignote (boutons d'attaque actifs, percées du panneau d'un front,
// contour d'une ligne de front survolée). 1 s : une demi-seconde allumé, une demi-seconde éteint (05-Fronts §11.1, §11.3).
// Les animations CSS lisent la variable `--blink-period` posée par `applyBlinkPeriod` ; le canvas lit la constante.

export const BLINK_PERIOD_MS = 1000;

export function applyBlinkPeriod(): void {
  document.documentElement.style.setProperty("--blink-period", `${BLINK_PERIOD_MS}ms`);
}

/** Vrai pendant la première moitié du cycle. */
export const blinkOn = (nowMs: number): boolean => nowMs % BLINK_PERIOD_MS < BLINK_PERIOD_MS / 2;
