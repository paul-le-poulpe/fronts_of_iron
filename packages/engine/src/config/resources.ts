// Ressources naturelles (Docs/Design/00-Game.md §2). Présence sur une case :
// un bruit de valeur (0 à 65 535) au-dessus d'un seuil qui baisse avec
// l'altitude. Valeurs d'essai pour la visualisation (`npm run viz:resources`), pas
// des valeurs fixées.

import { TEST_MAP } from "./map.ts";

export const RESOURCES = {
  iron: {
    presence: {
      /** Mélangé à la graine de la carte : le bruit du fer est indépendant de celui du relief. */
      salt: 0x1f0e,
      /** Octaves du bruit, comme TEST_MAP.octaves ; des cellules petites donnent des gisements en taches. */
      octaves: [
        { cell: 24, weight: 2 },
        { cell: 8, weight: 1 },
      ],
      /** Seuil du bruit à l'altitude 0. */
      threshold: 52000,
      /** Baisse du seuil par niveau d'altitude (0 à 31). */
      perAltitude: 300,
      /** Altitude à partir de laquelle une case est une montagne : la même valeur que pour la fertilité (TEST_MAP). */
      mountainAltitude: TEST_MAP.mountainAltitude,
      /** Baisse supplémentaire du seuil sur une montagne. */
      mountainBonus: 5500,
    },
    /**
     * Capacité d'extraction d'une case de fer, en fer par tour (00-Game §7). Une
     * case nourrit une ligne à 1 fer par tour (fusil, par exemple).
     */
    capacityPerTile: 1,
  },
  /**
   * Même calcul de présence que le fer, avec un seuil plus haut (plus rare) et
   * un autre `salt` (autres taches). Une case ne porte qu'une ressource : quand
   * le fer et l'aluminium y sont présents, l'aluminium la prend (mapgen.ts :
   * la ressource la plus loin dans cette liste l'emporte). Pas de
   * `capacityPerTile` : aucune règle n'extrait l'aluminium encore.
   */
  aluminium: {
    presence: {
      salt: 0x2a17,
      octaves: [
        { cell: 24, weight: 2 },
        { cell: 8, weight: 1 },
      ],
      threshold: 58000,
      perAltitude: 300,
      mountainAltitude: TEST_MAP.mountainAltitude,
      mountainBonus: 5000,
    },
  },
} as const;

export interface ResourcePresenceConfig {
  readonly salt: number;
  readonly octaves: readonly { readonly cell: number; readonly weight: number }[];
  readonly threshold: number;
  readonly perAltitude: number;
  readonly mountainAltitude: number;
  readonly mountainBonus: number;
}
