// Messages entre la page et le Web Worker du moteur (Docs/Design/03-Client.md).
// Aucun état de partie complet ne passe : la carte une fois, puis par tour les
// cases dont la ville a changé, les villes et routes quand une ville est fondée,
// et quelques totaux par joueur.

/**
 * Identifiant du joueur humain en mode solo. Les bots ont les identifiants suivants. En ligne, le joueur
 * local est `you` du message de départ : la page lit `InitMessage.you`, jamais cette constante.
 */
export const HUMAN = 1;

/** Marches de `DivisionView.formed` : une par pixel de remplissage de la barre d'un pion (`pawn.ts`). */
export const FORMATION_STEPS = 30;

/** Ordre du joueur local. Le champ `player` est écrit par le relais (règle 4 du CLAUDE.md), jamais par la page. */
export type HumanOrder =
  | { readonly type: "found_city"; readonly tile: number }
  // Pions et activités (08 §10) : `from` et `to` sont des identifiants d'activité (`ActivityInfo.id`), `good` un identifiant de bien.
  | { readonly type: "move_pawn"; readonly from: string; readonly to: string; readonly kind: "worker" | "machine"; readonly good?: string; readonly count: number }
  | { readonly type: "set_activity_order"; readonly activity: string; readonly position: number }
  | { readonly type: "set_auto_assign"; readonly enabled: boolean }
  | { readonly type: "set_disabled_slots"; readonly activity: string; readonly count: number }
  | { readonly type: "change_production_target"; readonly activity: string; readonly delta: number }
  | { readonly type: "open_activity" | "close_activity"; readonly activity: string }
  | { readonly type: "declare_war"; readonly target: number }
  | { readonly type: "propose_pact"; readonly target: number }
  | { readonly type: "break_pact"; readonly target: number }
  | { readonly type: "propose_peace"; readonly target: number }
  | { readonly type: "answer_proposal"; readonly from: number; readonly accept: boolean }
  // Fronts (05-Fronts §5.2) : `front` est l'identifiant du front (0 : réserve nationale).
  // `line: "box"` : `box` est une boîte de percée du joueur sur ce front, ou 0 pour en créer une (05-Fronts §4.6).
  | { readonly type: "move_division"; readonly ids: readonly number[]; readonly front: number; readonly line?: "first" | "second" | "rapid" | "box"; readonly box?: number }
  | { readonly type: "start_breakthrough"; readonly box: number; readonly city1: number; readonly city2: number }
  | { readonly type: "cancel_breakthrough"; readonly id: number }
  | { readonly type: "start_front_attack" | "stop_front_attack"; readonly front: number };

// ---- page → Worker ----

export type ToWorker =
  | {
      readonly type: "start";
      readonly mapSeed: number;
      /** Nombre de bots, 1 à 7. */
      readonly bots: number;
      /** Couleurs demandées (`PLAYER_COLORS`) : le joueur, puis les bots. */
      readonly colors: readonly number[];
      /** Pseudo gardé par la page, s'il y en a un. */
      readonly name?: string;
      /** Durée d'un tour en ms ; 100 par défaut. Outil de développement (paramètre `?step=` de l'adresse). */
      readonly stepMs?: number;
      /** Partie de test (développement seulement) : scénario de `TEST_SCENARIOS` ; un bot, économie gelée, divisions déjà placées. */
      readonly testGame?: string;
    }
  /**
   * Partie en ligne : le Worker ouvre lui-même le WebSocket (`url`, calculée par la page d'après l'adresse du
   * lobby) et envoie `join {name, token}` ; le relais répond par le message de départ et les tours.
   */
  | { readonly type: "online"; readonly url: string; readonly name: string; readonly token: string }
  | { readonly type: "order"; readonly id: number; readonly order: HumanOrder }
  /** Solo : pause ou reprise. En ligne : demande à l'hôte, que le relais refuse à un autre joueur. */
  | { readonly type: "pause"; readonly paused: boolean }
  /**
   * Outil de développement, mode solo seulement : modifie l'état directement, hors des règles et des ordres.
   * `addPopulation` : `amount` bonshommes dans Inactifs du joueur humain ; `armBots` : chaque bot reçoit `amount`
   * bonshommes dans Inactifs (pour essayer les fronts sans attendre que les bots grandissent).
   */
  | { readonly type: "debug"; readonly action: "addPopulation" | "armBots"; readonly amount: number };

// ---- Worker → page ----

/** Envoyé une fois : la carte (copies, transférées) et les réglages utiles à l'affichage. */
export interface InitMessage {
  readonly type: "init";
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly resources: Uint8Array;
  readonly fertility: Uint8Array;
  readonly mapSeed: number;
  /** Nombre de joueurs, bots compris (identifiants 1 à playerCount). */
  readonly playerCount: number;
  /** Identifiant du joueur de cette page : 1 (`HUMAN`) en solo, `you` du message de départ en ligne. */
  readonly you: number;
  /** Nom de chaque joueur, `playerNames[id - 1]` : le pseudo du joueur et « Bot n » en solo, les noms du message de départ en ligne. */
  readonly playerNames: readonly string[];
  /** Couleur de chaque joueur, `playerColors[id - 1]` : indice dans `PLAYER_COLORS`. */
  readonly playerColors: readonly number[];
  readonly expansionRadius: number;
  readonly controlRadius: number;
  readonly stepMs: number;
  readonly catalog: ActivityCatalog;
  /** Types de division, niches et réglages des fronts (05-Fronts), envoyés une fois. */
  readonly military: MilitaryCatalog;
}

/** Un type de division (`config/divisions.ts`, 05-Fronts §3.4), en entiers tels que le moteur les lit. */
export interface DivisionTypeInfo {
  readonly id: string;
  /** Indice dans `MilitaryCatalog.divisions` : c'est `DivisionView.type`. */
  readonly index: number;
  /** Clé de la niche (`NICHES`). */
  readonly niche: string;
  /** Rang dans la niche : 0 est le meilleur type. */
  readonly rank: number;
  /** Niche d'appui-feu (antichar, antiaérien, artillerie). */
  readonly support: boolean;
  /** Attaques d'une division pleine : somme de ses composants (08 §5), millièmes de point. */
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly airAttack: number;
  readonly icon: string;
  /** Description propre au type ; vide s'il n'en a pas. */
  readonly description: string;
  /** Largeur de première ligne, en liaisons. */
  readonly frontWidth: number;
  /** Largeur dans une percée, en liaisons (05-Fronts §7.2). */
  readonly breakthroughWidth: number;
  /** Tours de formation d'une division produite (08 §6). */
  readonly productionTurns: number;
  /** Limité par `MilitaryCatalog.eliteTroopsRatio` (08 §5). */
  readonly elite: boolean;
  /** PV d'une division complète. */
  readonly hitPoints: number;
  /** Multiplicateurs à l'échelle 100. */
  readonly defenseHitPointsMultiplier: number;
  readonly attackMultiplier: number;
  readonly breakthroughMultiplier: number;
  readonly counterAttackMultiplier: number;
  readonly armorPercent: number;
  readonly motorized: boolean;
}

/** Ce que la page lit de `config/fronts.ts` et `config/divisions.ts` (envoyé une fois, dans `init`). */
export interface MilitaryCatalog {
  /** Types de division, dans l'ordre des clés de `DIVISIONS`. */
  readonly divisions: readonly DivisionTypeInfo[];
  /** Niches dans l'ordre de `NICHES` (principales, puis appui-feu), chacune avec ses types du meilleur au moins bon. */
  readonly niches: readonly { readonly id: string; readonly support: boolean; readonly types: readonly string[] }[];
  /** Tours entre deux rounds de combat. */
  readonly combatTurns: number;
  /** `ELITE_TROOPS_RATIO` : divisions d'infanterie par division d'élite au plus (08 §5). */
  readonly eliteTroopsRatio: number;
  /** Délai d'un déplacement, en tours. */
  readonly transferTurns: number;
  /** Échelle de `DivisionView.state` (10 000 = 100 %). */
  readonly stateScale: number;
  /** Délai entre le lancement d'une percée et son combat 1, en tours (05-Fronts §7.2). */
  readonly breakthroughDelayTurns: number;
  /** Délai entre l'ordre d'attaque sur tout le front et son combat, en tours (06-Combat-Simplifie §1). */
  readonly attackDelayTurns: number;
  /** Réglages du combat lus par l'estimation du panneau de prédiction (`prediction.ts`). */
  readonly combatMaxRounds: number;
  readonly reinforceRounds: number;
  readonly fleeStatePercent: number;
  readonly advanceThresholdA: number;
  readonly advanceThresholdB: number;
  readonly footSpeedPermille: number;
  readonly motorizedSpeedPermille: number;
}

/** Une division d'un combat, telle qu'au début du combat (06-Combat-Simplifie §1). */
export interface CombatUnitView {
  readonly division: number;
  readonly owner: number;
  /** Indice dans `MilitaryCatalog.divisions`. */
  readonly type: number;
  /** État au début du combat, échelle `MilitaryCatalog.stateScale`. */
  readonly start: number;
}

/** Un round d'un combat : pertes d'état des divisions engagées, détruites, en fuite, avancée de l'attaquant (millièmes de route). */
export interface CombatRoundView {
  /** [indice dans `units`, perte d'état]. */
  readonly hits: readonly (readonly [number, number])[];
  readonly destroyed: readonly number[];
  readonly fled: readonly number[];
  /** Renforts montés de la seconde ligne à la fin du round, en retrait pendant quelques rounds. */
  readonly arrived: readonly number[];
  /** Renforts qui rejoignent la première ligne au début du round. */
  readonly joined: readonly number[];
  /** Joueurs dont les troupes se replient à la fin du round faute d'infanterie (leurs divisions sont dans `fled`). */
  readonly withdrawn: readonly number[];
  readonly advance: number;
}

/** Rapport d'un combat résolu en un tour par le moteur, que la page rejoue (06-Combat-Simplifie §1, §2). */
export interface CombatView {
  readonly id: number;
  /** Attaque sur tout le front ; percée contre la première ligne ; contre-attaque de la réaction rapide contre une percée. */
  readonly kind: "front" | "breakthrough" | "counter";
  readonly front: number;
  readonly tick: number;
  readonly attacker: number;
  readonly defender: number;
  /** Connexion du front où l'icône du combat est placée (au milieu des deux villes). */
  readonly city1: number;
  readonly city2: number;
  readonly units: readonly CombatUnitView[];
  readonly rounds: readonly CombatRoundView[];
  /** Pertes de l'attaquant puis du défenseur (08 §11) : divisions détruites, et état perdu (échelle `MilitaryCatalog.stateScale`). */
  readonly losses: readonly [
    { readonly divisions: number; readonly state: number },
    { readonly divisions: number; readonly state: number },
  ];
  /** Ville prise à la fin du combat, 0 sinon. */
  readonly captured: number;
  /** Issue pour l'attaquant : le front a avancé ; la première ligne est percée ; la réaction rapide est battue. */
  readonly success: boolean;
}

/** Une activité de la table du moteur (`config/activities.ts`, 08 §2, §9), telle que le panneau l'affiche. */
export interface ActivityInfo {
  /** Identifiant de l'activité, celui des ordres. */
  readonly id: string;
  /** Indice dans `ActivityCatalog.activities` : c'est aussi celui de `HumanDetail.unlock`. */
  readonly index: number;
  /** `idle`, `hurt`, `farming`, `fishing`, `mining`, `factory` ou `barracks`. */
  readonly kind: string;
  /** Identifiant de l'activité parente, `null` s'il n'y en a pas. */
  readonly parent: string | null;
  /** Coût de déblocage, en tours d'un ouvrier servi du parent ; 0 : débloquée au départ. */
  readonly unlockCost: number;
  /** `unlockCost` compte les ouvriers présents dans le parent (08 §9). */
  readonly unlockByWorkers: boolean;
  /** `unlockCost` compte la population totale du joueur (08 §9). */
  readonly unlockByPopulation: boolean;
  readonly workersPerUnit: number;
  readonly unitsPerWorker: number;
  readonly ironPerUnit: number;
  /** Agriculteurs, pêcheurs, mineurs, usines de machines : places calculées, barrables (08 §7 bis). */
  readonly hasSlots: boolean;
  /** Casernes et usines de divisions : places choisies par la production visée (08 §7 ter). */
  readonly hasPlaces: boolean;
  /** Bien produit (usine de machines) ou machine reçue (agriculture, pêche, mines), `null` sinon. */
  readonly good: string | null;
  /** Type de division produit (usine ou caserne), `null` sinon. */
  readonly division: string | null;
  /** Cases par travailleur (agriculture, pêche, mines) ; 0 ailleurs. */
  readonly tilesPerWorker: number;
}

/** Ce que la page lit de la configuration des activités (envoyé une fois, dans `init`). */
export interface ActivityCatalog {
  /** Dans l'ordre du moteur (`ACTIVITY_IDS`). */
  readonly activities: readonly ActivityInfo[];
  /** Biens (machines), dans l'ordre de `HumanDetail.idleMachines`. */
  readonly goodIds: readonly string[];
  /** Icône d'un bien (chemin sous `public/icons/`) ; absent : symbole texte. */
  readonly icons: Readonly<Record<string, string>>;
  /** Délais en tours (08 §6) : apparition et disparition d'un bonhomme, d'une machine, d'une division. */
  readonly popArrivalTurns: number;
  readonly popLeaveTurns: number;
  readonly machineArrivalTurns: number;
  readonly machineLeaveTurns: number;
  readonly divisionLeaveTurns: number;
  /** `POPULATION.foodPerPawn` : la nourriture se lit en bonshommes en divisant par ce nombre (08 §3). */
  readonly foodPerPawn: number;
  /** `FOOD.base` et `FOOD.perCity`. */
  readonly foodBase: number;
  readonly foodPerCity: number;
  /** `RESOURCES.iron.capacityPerTile` : fer produit par case de fer exploitée (08 §4). */
  readonly ironPerTile: number;
  /** Nourriture d'une case d'eau pêchée : `FISHING.foodPerWorker / tilesPerWorker`. */
  readonly fishYield: number;
}

/** Une activité ouverte du joueur humain, dans l'ordre choisi par le joueur (`Player.activities`). */
export interface ActivityView {
  /** Identifiant (`ActivityInfo.id`). */
  readonly id: string;
  /** Bonshommes présents. Caserne : les places remplies. */
  readonly workers: number;
  /** Machines présentes (agriculteurs, pêcheurs, mineurs). */
  readonly machines: number;
  /** Casernes : places, remplies ou vides. */
  readonly places: number;
  /** Agriculteurs, pêcheurs, mineurs : places tirées des cases (08 §2.1). */
  readonly slots: number;
  /** Agriculteurs, pêcheurs, mineurs : cases de cette activité, pour la jauge de la prochaine place (08 §2.1). 0 ailleurs. */
  readonly surface: number;
  /** Postes barrés, comptés depuis la droite (08 §7 bis). */
  readonly disabled: number;
  /** Blé ou poisson (agriculteurs, pêcheurs), fer produit (mineurs), unités servies en fer (usines et casernes). */
  readonly output: number;
  /** Fer réservé par la sortie. */
  readonly ironUsed: number;
  /** Divisions du type en formation, comprises dans `existing` ; 0 sans type de division. */
  readonly forming: number;
  /** Usines et casernes : existants (machines du bien, ou divisions du type) et limite effective (élites plafonnées). -1 ailleurs. */
  readonly existing: number;
  readonly limit: number;
}

/** Ce dont le panneau de production a besoin, pour le joueur humain seulement. */
export interface HumanDetail {
  /** Dernier tour appliqué : les compteurs ci-dessous sont des tours de fin. */
  readonly tick: number;
  /** Activités ouvertes, de haut en bas. */
  readonly activities: readonly ActivityView[];
  /** Villes du joueur, blé, poisson, et nourriture d'un agriculteur et d'un pêcheur pleins : le détail de la nourriture (08 §3). */
  readonly cities: number;
  readonly wheat: number;
  readonly fish: number;
  readonly farmPerWorker: number;
  readonly fishPerWorker: number;
  /** Auto-assignation (08 §7 bis). */
  readonly autoAssign: boolean;
  /** Progression de déblocage de chaque activité (indice de `ActivityCatalog.activities`), en tours d'ouvrier servi. */
  readonly unlock: readonly number[];
  /** 1 pour une activité déjà ouverte une fois (08 §9), même indice. */
  readonly everOpened: readonly number[];
  /** Ouvriers servis en fer de chaque activité ouverte (unités servies × ouvriers par unité) : la vitesse de déblocage de ses enfants. 0 si fermée. */
  readonly served: readonly number[];
  /** Machines disponibles dans Inactifs, par bien (ordre de `ActivityCatalog.goodIds`). */
  readonly idleMachines: readonly number[];
  /** Tours de fin des bonshommes à venir et en sursis, triés (08 §6). */
  readonly popArrivals: readonly number[];
  readonly popLeaves: readonly number[];
  /** Tours de fin des machines à venir et en sursis, par bien, triés. */
  readonly machineArrivals: readonly (readonly number[])[];
  readonly machineLeaves: readonly (readonly number[])[];
  /** Fin du soin du blessé en cours, 0 si aucun. */
  readonly hurtHealEnd: number;
  /** Capacité de population (08 §3). */
  readonly capacity: number;
  /** Fer demandé par les usines et casernes (08 §4). */
  readonly ironWanted: number;
  /** Fer produit si tous les postes de mineurs sont occupés. */
  readonly ironMax: number;
  /** Fer produit par les mineurs et fer réservé par les usines et casernes servies (08 §4). */
  readonly ironProduced: number;
  readonly ironReserved: number;
}

/** Une connexion d'un front : `position` en millièmes de la route depuis `city1` ; 0 en paix (le client prend alors 500). */
export interface FrontConnectionView {
  readonly city1: number;
  readonly city2: number;
  readonly position: number;
}

/** Un camp d'un front, tout visible (pas de brouillard de guerre). Ses divisions sont dans `TickMessage.divisions`. */
export interface FrontSideView {
  /** Attaque sur tout le front lancée, qui attend son combat (06-Combat-Simplifie §1). */
  readonly frontAttack: boolean;
  /** Tour où cette attaque sera résolue, 0 sans attaque (compte à rebours). */
  readonly attackAt: number;
  /** État perdu par sa première ligne au dernier round de combat (échelle `stateScale`), par niche (ordre de `military.niches`, 05-Fronts §11.4). */
  readonly lastLossByNiche: readonly number[];
}

/** Une boîte de percée (05-Fronts §4.6), dans l'ordre de création de son camp. */
export interface BoxView {
  readonly id: number;
  readonly owner: number;
}

/**
 * Une percée lancée (05-Fronts §7.2). `phase` : 0 délai avant le combat 1, 1 combat contre la tranche de première ligne,
 * 2 délai avant le combat 2, 3 combat contre la force de contre-attaque, 4 délai avant la chute de la ville (réussite),
 * 5 délai de repli (le combat 1 a échoué), 6 délai après l'échec du combat 2. Les divisions engagées ont
 * `DivisionView.breakthrough = id`.
 */
export interface BreakthroughView {
  readonly id: number;
  readonly owner: number;
  readonly box: number;
  readonly city1: number;
  readonly city2: number;
  readonly phase: number;
  /** Tour où prend fin le délai en cours (toutes les phases sauf 1 et 3) ; 0 pendant un combat. */
  readonly until: number;
  /** Avancée de la percée sur le front, en millièmes de route (en phase 4, avec la distance qui reste jusqu'à la ville). */
  readonly advance: number;
}

export interface FrontView {
  readonly id: number;
  readonly players: readonly [number, number];
  readonly groups: readonly [number, number];
  /** Les deux joueurs sont en guerre. */
  readonly active: boolean;
  readonly connections: readonly FrontConnectionView[];
  readonly sides: readonly [FrontSideView, FrontSideView];
  /** Boîtes de percée des deux camps, par identifiant. */
  readonly boxes: readonly BoxView[];
  /** Percées en cours sur ce front, des deux camps, par identifiant. */
  readonly breakthroughs: readonly BreakthroughView[];
}

/** Une division (05-Fronts §3, §13.4), de n'importe quel joueur (pas de brouillard de guerre). */
export interface DivisionView {
  readonly id: number;
  readonly owner: number;
  /** Indice dans `MilitaryCatalog.divisions`. */
  readonly type: number;
  /** Front où elle est, ou vers lequel elle va ; 0 : réserve nationale. */
  readonly front: number;
  /** `box` : dans la boîte de percée `box` (05-Fronts §4.6) ; `rapid` : réaction rapide. */
  readonly line: "first" | "second" | "rapid" | "box";
  /** Boîte de percée ; 0 hors boîte. */
  readonly box: number;
  /**
   * Percée où la division est engagée (force qui perce, tranche de première ligne, force de contre-attaque) ; 0 sinon.
   * Une division de la force qui perce a toujours `line = "box"` : la page l'affiche dans la percée, pas dans sa boîte.
   */
  readonly breakthrough: number;
  /** Largeur engagée dans cette percée, en millièmes de liaison. */
  readonly btEngaged: number;
  /** Largeur engagée en première ligne, en millièmes de liaison (05-Fronts §4.2). */
  readonly engaged: number;
  /** État, de 0 à `MilitaryCatalog.stateScale` (05-Fronts §3.3). */
  readonly state: number;
  /**
   * `formation` (§3.5) : flèche verte vers le haut ; `moving` (§4.4) : icône horloge ; `fleeing` (§5.4) : drapeau blanc ; `ready` sinon.
   * Une division de `ready` qui défend une percée (`breakthrough ≠ 0`, `line ≠ "box"`) porte l'icône bouclier.
   * Une division en déplacement est comptée à sa destination.
   */
  readonly status: "ready" | "formation" | "moving" | "fleeing";
  /** Tour où le statut prend fin (formation, déplacement, fuite) ; 0 pour `ready`. */
  readonly until: number;
  /** Formation écoulée, de 0 à `FORMATION_STEPS` : remplit la barre du pion. 0 hors formation. */
  readonly formed: number;
  /** Division en trop (08 §6) : tour où elle disparaît, 0 sinon. Son pion clignote jusque-là. */
  readonly leaveTick: number;
}

export interface PlayerStats {
  readonly id: number;
  /** Population en bonshommes, blessés compris (ils occupent de la capacité). */
  readonly population: number;
  /** Capacité de population (08 §3). */
  readonly capacity: number;
  /** Bonshommes d'Inactifs, de Blessés, d'Agriculteurs, de Pêcheurs, de Mineurs. */
  readonly idle: number;
  readonly hurt: number;
  readonly farmers: number;
  readonly fishers: number;
  readonly miners: number;
  /** Bonshommes des casernes : le nombre de soldats. */
  readonly soldiers: number;
  /** Divisions du joueur (en formation ou en sursis comprises). */
  readonly divisions: number;
  readonly food: number;
  readonly wheat: number;
  readonly fish: number;
  /** Surface cultivée, surface pêchée, cases de fer exploitées (rayons d'exploitation, 00-Game §6.6). */
  readonly cultivated: number;
  readonly fished: number;
  readonly minedTiles: number;
  /** Cases de fer, cases fertiles et cases d'eau des zones du joueur. */
  readonly ironTiles: number;
  readonly farmTiles: number;
  readonly seaTiles: number;
  /** Fer produit et fer réservé par les usines et les casernes servies (08 §4). */
  readonly ironProduced: number;
  readonly ironReserved: number;
  /** Machines possédées (Inactifs et activité) et limite, par bien dans l'ordre de `ActivityCatalog.goodIds`. */
  readonly machines: readonly number[];
  readonly machineLimits: readonly number[];
  /** Identifiant de la capitale, 0 = aucune. */
  readonly capital: number;
  readonly cities: number;
  /** Éliminé (05-Fronts §10.3) : sa dernière ville a été prise. */
  readonly defeated: boolean;
  /** Coût en bonshommes de la prochaine ville (00-Game §3.3, 08 §10). */
  readonly foundingCost: number;
}

/** Statut diplomatique de deux joueurs (00-Game §1) : neutre, pacte de non-agression, guerre. */
export type DiplomaticStatusName = "neutral" | "pact" | "war";

/** Proposition en attente, dans un sens ou dans l'autre, qui concerne le joueur humain. */
export interface ProposalView {
  readonly from: number;
  readonly to: number;
  readonly kind: "pact" | "peace";
  /** Tour de l'envoi. */
  readonly startTick: number;
  /** Tour où elle expire sans réponse (`startTick` + `DIPLOMACY.proposalTurns`). */
  readonly endTick: number;
}

/** Événement diplomatique du tour (même sens des champs que `DiplomacyEvent` du moteur, diplomacy.ts). */
export type DiplomacyEventView =
  | {
      readonly type: "proposal_sent" | "proposal_accepted" | "proposal_refused" | "proposal_expired";
      readonly from: number;
      readonly to: number;
      readonly kind: "pact" | "peace";
      readonly turn: number;
    }
  | { readonly type: "war_declared" | "pact_broken"; readonly from: number; readonly to: number; readonly turn: number };

/** La diplomatie vue du joueur humain, envoyée à chaque tour. */
export interface DiplomacyView {
  /** Statut du joueur humain envers chaque joueur, `status[id - 1]` ; "neutral" pour lui-même. */
  readonly status: readonly DiplomaticStatusName[];
  /** Propositions en attente dont il est l'auteur ou la cible, dans l'ordre de création. */
  readonly proposals: readonly ProposalView[];
  /** Événements du tour dont il est l'auteur ou la cible. */
  readonly events: readonly DiplomacyEventView[];
}

export interface OrderResult {
  readonly id: number;
  readonly order: HumanOrder;
  /** Le moteur a-t-il appliqué l'ordre ? */
  readonly applied: boolean;
}

export interface TickMessage {
  readonly type: "tick";
  readonly tick: number;
  /** Paires [case, ville] : les cases dont `tileCity` a changé pendant ce tour. */
  readonly tiles: Uint32Array;
  /**
   * Liste complète des villes, 4 nombres chacune [joueur, case, port (0/1), groupe],
   * dans l'ordre des identifiants (ville 1 d'abord). Présente seulement si une ville
   * a été fondée pendant ce tour (c'est le seul cas où elle change).
   */
  readonly cities: Uint32Array | null;
  /** Routes : paires d'identifiants de villes. Même condition que `cities`. */
  readonly roads: Uint16Array | null;
  /** Les activités du joueur humain (panneau de production), à chaque tour. */
  readonly human: HumanDetail;
  /** Statistiques des joueurs, dans l'ordre des identifiants. */
  readonly players: readonly PlayerStats[];
  /** Résultat des ordres humains appliqués pendant ce tour. */
  readonly results: readonly OrderResult[];
  /** Statuts, propositions et événements diplomatiques du joueur humain (00-Game §1). */
  readonly diplomacy: DiplomacyView;
  /**
   * Tous les fronts à plat (05-Fronts §13.4), par identifiant ; `null` si rien n'a changé depuis le
   * tour précédent. Les positions changent à chaque round de combat.
   */
  readonly fronts: readonly FrontView[] | null;
  /** Toutes les divisions de tous les joueurs, par identifiant ; `null` si rien n'a changé depuis le tour précédent. */
  readonly divisions: readonly DivisionView[] | null;
  /** Les derniers combats du joueur local, par identifiant ; `null` si la liste n'a pas changé depuis le tour précédent. */
  readonly combats: readonly CombatView[] | null;
  /** Percées du joueur local arrêtées au début de leur combat 1 pendant ce tour, faute de division (05-Fronts §7.2, point 14). */
  readonly failedBreakthroughs: number;
  /** Villes prises pendant ce tour. La page reçoit alors `cities` et les cases de leur zone. */
  readonly captured: readonly { readonly city: number; readonly from: number; readonly to: number }[];
  /** Encerclements causés par ces prises (05-Fronts §10.2) : `from` encercle des divisions de `to` ; `divisions` : divisions touchées. */
  readonly encircled: readonly { readonly city: number; readonly from: number; readonly to: number; readonly divisions: number }[];
  /** Joueurs éliminés pendant ce tour (05-Fronts §10.3) : `by` a pris leur dernière ville. Vide après un rejeu. */
  readonly eliminated: readonly { readonly player: number; readonly by: number }[];
  readonly paused: boolean;
  /** Durées mesurées dans le Worker, en ms. */
  readonly perf: { readonly bots: number; readonly apply: number; readonly pack: number };
}

/**
 * La partie en ligne s'arrête (le Worker a fermé le WebSocket). `desync` : la copie de la partie a divergé
 * (01-Architecture §3) ; `refused` : le relais a refusé la connexion, ou la partie n'existe plus ; `lost` : la
 * connexion s'est fermée sans raison donnée ; `error` : le moteur a levé une erreur ou un tour manque.
 * `message` : le texte à afficher.
 */
export interface EndedMessage {
  readonly type: "ended";
  readonly reason: "desync" | "refused" | "lost" | "error";
  readonly message: string;
}

export type FromWorker =
  | InitMessage
  | TickMessage
  | EndedMessage
  | { readonly type: "paused"; readonly paused: boolean }
  /** Un refus du relais qui n'arrête pas la partie (ordre ignoré, pause demandée par un autre que l'hôte) : texte à afficher. */
  | { readonly type: "notice"; readonly text: string };
