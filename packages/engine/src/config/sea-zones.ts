// Zones maritimes (Docs/Design/00-Game.md §2.1). `maxLandPercent`, `iterations`
// et `finalIterations` viennent de l'auteur ; `spacing` et `minBasinArea` sont
// des valeurs d'essai pour la visualisation, pas des valeurs fixées.

export const SEA_ZONES = {
  /** Écart entre les points de la grille de départ, en cases ; taille visée d'une zone = spacing². */
  spacing: 40,
  /** Un point de la grille dont le carré a plus de ce pourcentage de terre est supprimé. */
  maxLandPercent: 80,
  /** Itérations zones → barycentre avant la correction. */
  iterations: 50,
  /** Bassin (eau reliée) de moins de cette surface, en cases : aucune zone. */
  minBasinArea: 200,
  /** Itérations zones → barycentre après la correction. */
  finalIterations: 50,
} as const;

export interface SeaZonesConfig {
  readonly spacing: number;
  readonly maxLandPercent: number;
  readonly iterations: number;
  readonly minBasinArea: number;
  readonly finalIterations: number;
}
