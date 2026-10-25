// Carte de test générée par `generateTestMap`. Voir Docs/Design/02-Engine.md.

export const TEST_MAP = {
  width: 800,
  height: 500,
  /**
   * Bruit de valeur : une grille de valeurs aléatoires tous les `cell` pixels,
   * interpolée entre les nœuds. Les octaves sont additionnées avec leur poids.
   */
  octaves: [
    { cell: 128, weight: 16 },
    { cell: 64, weight: 8 },
    { cell: 32, weight: 4 },
    { cell: 16, weight: 2 },
    { cell: 8, weight: 1 },
  ],
  /** Demi-axes de l'ellipse du continent, en pourcentage de la demi-largeur et de la demi-hauteur. */
  continentRadiusPercent: 84,
  /** Ajouté à l'élévation au centre de l'ellipse (élévation du bruit : 0 à 65 535). */
  centerBoost: 26000,
  /** Retiré à l'élévation sur le bord de l'ellipse ; croît comme le carré de la distance au centre. */
  edgeDrop: 40000,
  /** Élévation au-dessus de laquelle une case est de la terre. */
  seaLevel: 32768,
  /** Altitude (0 à 31) = (élévation − seaLevel) >> altitudeShift, plafonnée à 31. */
  altitudeShift: 11,
  /**
   * Altitude à partir de laquelle une case de terre est une montagne : fertilité 0
   * (00-Game §2) et seuil du fer modifié (RESOURCES.iron.presence). Une seule
   * définition de « montagne » pour toute la carte.
   */
  mountainAltitude: 14,
} as const;

export type TestMapConfig = typeof TEST_MAP;
