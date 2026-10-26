// Fronts terrestres, version 1 (Docs/Design/05-Fronts.md §12). Les unités et les
// niches sont dans units.ts.
//
// Toutes les valeurs ci-dessous sont des VALEURS DE L'AUTEUR (tableau du §12 de
// 05-Fronts, 25 et 26 octobre 2026). Elles se règlent ici et nulle part ailleurs ;
// le moteur ne les calcule qu'en entiers (règle 2 du CLAUDE.md).
//
// UNITÉS : les durées sont en tours du moteur (un tour = 100 ms par défaut), les
// largeurs en mètres, les positions du front en millièmes de la longueur d'une
// route (0 à 1 000), les pourcentages en entiers (50 = 50 %).

export const FRONTS = {
  /**
   * Largeur ajoutée à un front par connexion (route entre deux villes de joueurs
   * différents), en mètres. Largeur d'un front = connexions × cette valeur.
   * Valeur de l'auteur. Repère : le rayon de contrôle d'une ville vaut environ
   * 10 000 m (00-Game §3.1).
   */
  metersPerConnection: 5000,
  /**
   * Pourcentage de chaque niveau de priorité d'un front : niveau 1, 2, 3
   * (indices 0, 1, 2). Les règles lisent le pourcentage, jamais le niveau : un
   * niveau à 25 % pourra s'ajouter. Valeur de l'auteur.
   */
  priorityPercent: [100, 50, 0],
  /**
   * Délai d'un mouvement d'unités entre la réserve et un front, aller ou retour,
   * en tours (50 = 5 s). Valeur de l'auteur.
   */
  transferTurns: 50,
  /** Tours entre deux rounds de combat (10 = 1 s). Valeur de l'auteur. */
  combatTurns: 10,
  /**
   * Position du front, en % de la longueur de la route depuis la ville prise, sur
   * les connexions créées par une prise de ville (1 : l'attaquant tient 1 %, le
   * défenseur 99 %). Valeur de l'auteur.
   */
  capturePercent: 1,
  /**
   * Part de la route (en %, depuis la ville prise) que le perdant doit tenir pour
   * que la route soit encerclée par la prise. Plus près de la ville prise, les
   * unités se replient sans perte. Valeur de l'auteur.
   */
  minEncirclementLengthPercent: 25,
  /** Pourcentage des unités de la part encerclée qui sont perdues. Valeur de l'auteur. */
  encirclementLossPercent: 50,
  /** `A` : rapport d'infanterie attaquant / défenseur sous lequel l'assaut n'avance pas. Valeur de l'auteur. */
  advanceThresholdA: 2,
  /** `B` : rapport d'infanterie à partir duquel l'assaut avance à vitesse maximale. Valeur de l'auteur. */
  advanceThresholdB: 5,
  /** Vitesse d'une armée à pied, en millièmes de route par round (5 = 0,5 % de la route). Valeur de l'auteur. */
  footSpeedPermille: 5,
  /** Vitesse d'une armée motorisée à 100 %, en millièmes de route par round (15 = 1,5 %). Valeur de l'auteur. */
  motorizedSpeedPermille: 15,
  /** Tours entre l'ordre d'une percée et son début (50 = 5 s). Valeur de l'auteur. */
  breakthroughDelayTurns: 50,
  /** `N` : le saut d'une première ligne percée vaut N × la vitesse de la force qui perce. Valeur de l'auteur. */
  breakthroughJumpRounds: 10,
  /**
   * `X` : multiplicateur du saut face à une seconde ligne dont la force de
   * contre-attaque est motorisée à moins de 50 % ; décroît linéairement jusqu'à 1
   * à 100 %. Entier ≥ 1. Valeur de l'auteur.
   */
  slowReactionFactor: 3,
  /** Une percée s'arrête quand les PV de la force engagée tombent sous ce pourcentage de leur valeur de départ. Valeur de l'auteur. */
  breakthroughExhaustionPercent: 35,
} as const;
