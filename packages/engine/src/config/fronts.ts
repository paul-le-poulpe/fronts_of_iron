// Fronts terrestres, version 1 : les divisions (Docs/Design/05-Fronts.md §12).
// Les types de division et les niches sont dans divisions.ts.
//
// Toutes les valeurs ci-dessous sont des VALEURS DE L'AUTEUR (tableau du §12 de
// 05-Fronts), sauf mention contraire. Elles se règlent ici et nulle part ailleurs ;
// le moteur ne les calcule qu'en entiers (règle 2 du CLAUDE.md).
//
// UNITÉS : les durées sont en tours du moteur (un tour = 100 ms) ou en rounds de
// combat (un round = `combatTurns` tours), les positions du front en millièmes de
// la longueur d'une route (0 à 1 000), les pourcentages en entiers (50 = 50 %).

export const FRONTS = {
  /**
   * Délai entre le clic sur l'attaque sur tout le front et le combat, en tours (50 = 5 s, comme les délais de la percée ;
   * 06-Combat-Simplifie §1).
   */
  attackDelayTurns: 50,
  /**
   * Rounds au plus d'un combat résolu en un tour ; il s'arrête avant quand un camp n'a plus d'infanterie engagée
   * (06-Combat-Simplifie §1 ; décision de l'auteur, 5 novembre 2026).
   */
  combatMaxRounds: 50,
  /**
   * Rounds pendant lesquels un renfort monté de la seconde ligne reste en retrait, sans combattre, avant de rejoindre la
   * première ligne, dans une attaque sur tout le front (06-Combat-Simplifie §1 ; auteur, 5 novembre 2026).
   */
  reinforceRounds: 5,
  /** Rapports de combat gardés par joueur, les plus anciens supprimés (06-Combat-Simplifie §1 ; provisoire). */
  combatHistoryPerPlayer: 20,
  /** Tours entre deux rounds de combat (10 = 1 s). */
  combatTurns: 10,
  /** Délai d'un déplacement de division entre la réserve et un front, ou entre deux fronts, en rounds de combat (10 = 10 s). */
  transferRounds: 10,
  /** État (en %) auquel ou sous lequel une division de première ligne fuit en seconde ligne. */
  fleeStatePercent: 25,
  /** Rounds de combat pendant lesquels une division en fuite ne peut pas revenir en première ligne. */
  fleeRounds: 10,
  /** Une division de première ligne échange sa place quand son état est sous ce % de celui d'une division de seconde ligne. */
  swapStatePercent: 50,
  /**
   * Position du front, en % de la longueur de la route depuis la ville prise, sur
   * les connexions créées par une prise de ville (1 : l'attaquant tient 1 %, le
   * défenseur 99 %).
   */
  capturePercent: 1,
  /**
   * Part de la route (en %, depuis la ville prise) que le perdant doit tenir pour
   * que la route soit encerclée par la prise. Plus près de la ville prise, les
   * divisions se replient sans perte.
   */
  minEncirclementLengthPercent: 25,
  /** Pertes d'encerclement, en % de l'état, par route encerclée rapportée aux connexions du front. */
  encirclementLossPercent: 50,
  /** `A` : rapport d'infanterie attaquant / défenseur sous lequel l'assaut n'avance pas (provisoire : repris de la version 0.1). */
  advanceThresholdA: 2,
  /** `B` : rapport d'infanterie à partir duquel l'assaut avance à vitesse maximale (10 contre 1 ; décision de l'auteur, 1er novembre 2026). */
  advanceThresholdB: 10,
  /** Vitesse maximale d'une armée à pied, en millièmes de route par round (3 = 0,3 % de la route ; auteur, 5 novembre 2026). Sert aussi au saut d'une percée. */
  footSpeedPermille: 3,
  /** Vitesse maximale d'une armée entièrement motorisée, en millièmes de route par round (10 = 1 % ; auteur, 5 novembre 2026) ; une armée mixte est entre les deux (`frontSpeed`). Sert aussi au saut d'une percée. */
  motorizedSpeedPermille: 10,
  /**
   * Durée de tous les délais d'une percée (50 = 5 s) : avant le combat 1, avant le combat 2, avant la chute de la ville,
   * et les deux délais d'échec (05-Fronts §7.2). Valeur de la version 0.1, confirmée par l'auteur ; la même partout.
   */
  breakthroughDelayTurns: 50,
  /** `N` : le saut d'une première ligne percée vaut `N × vitesse × facteur de réaction`. Valeur de la version 0.1. */
  breakthroughJumpRounds: 10,
  /** `X` : facteur de réaction d'une force de contre-attaque motorisée à moins de 50 % ; décroît jusqu'à 1 à 100 %. Valeur de la version 0.1. */
  slowReactionFactor: 3,
  /** Une percée s'arrête quand l'état moyen de sa force tombe sous ce % de celui du début du combat 1. Valeur de la version 0.1. */
  breakthroughExhaustionPercent: 35,
} as const;
