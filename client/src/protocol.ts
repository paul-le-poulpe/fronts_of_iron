// Messages entre la page et le Web Worker du moteur (Docs/Design/03-Client.md).
// Aucun état de partie complet ne passe : la carte une fois, puis par tour les
// cases dont la ville a changé, les villes et routes quand une ville est fondée,
// et quelques totaux par joueur.

/**
 * Identifiant du joueur humain en mode solo. Les bots ont les identifiants suivants. En ligne, le joueur
 * local est `you` du message de départ : la page lit `InitMessage.you`, jamais cette constante.
 */
export const HUMAN = 1;

/** Ordre du joueur local. Le champ `player` est écrit par le relais (règle 4 du CLAUDE.md), jamais par la page. */
export type HumanOrder =
  | { readonly type: "found_city"; readonly tile: number }
  | { readonly type: "set_farm_share"; readonly percent: number }
  | { readonly type: "build_factory"; readonly city: number; readonly factoryType: string }
  | { readonly type: "create_line"; readonly city: number; readonly good: string }
  | { readonly type: "set_active_lines"; readonly city: number; readonly good: string; readonly count: number }
  | { readonly type: "set_city_priority"; readonly city: number; readonly position: number }
  | { readonly type: "set_line_priority"; readonly city: number; readonly good: string; readonly position: number }
  | { readonly type: "declare_war"; readonly target: number }
  | { readonly type: "propose_pact"; readonly target: number }
  | { readonly type: "break_pact"; readonly target: number }
  | { readonly type: "propose_peace"; readonly target: number }
  | { readonly type: "answer_proposal"; readonly from: number; readonly accept: boolean }
  // Fronts (05-Fronts §5.2) : `front` est l'identifiant du front (0 : réserve nationale), `division` une clé de `DIVISIONS`.
  | { readonly type: "create_division"; readonly division: string }
  | { readonly type: "delete_division"; readonly id: number }
  | { readonly type: "move_division"; readonly ids: readonly number[]; readonly front: number; readonly line?: "first" | "second" }
  | { readonly type: "set_forced_mobilization"; readonly enabled: boolean }
  | { readonly type: "start_front_attack" | "stop_front_attack"; readonly front: number };

// ---- page → Worker ----

export type ToWorker =
  | {
      readonly type: "start";
      readonly mapSeed: number;
      /** Nombre de bots, 1 à 7. */
      readonly bots: number;
      /** Durée d'un tour en ms ; 100 par défaut. Outil de développement (paramètre `?step=` de l'adresse). */
      readonly stepMs?: number;
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
   * `addPopulation` et `addArmament` : le joueur humain ; `armBots` : chaque bot reçoit de la population et
   * `amount` fois un lot d'armement (pour essayer les fronts sans que les bots produisent).
   */
  | { readonly type: "debug"; readonly action: "addPopulation" | "addArmament" | "armBots"; readonly amount: number };

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
  /** Nom de chaque joueur, `playerNames[id - 1]` : « Vous » et « Bot n » en solo, les noms du message de départ en ligne. */
  readonly playerNames: readonly string[];
  readonly expansionRadius: number;
  readonly controlRadius: number;
  readonly stepMs: number;
  readonly catalog: FactoryCatalog;
  /** Types de division, niches et réglages des fronts (05-Fronts), envoyés une fois. */
  readonly military: MilitaryCatalog;
}

/** Un composant d'un type de division (05-Fronts §3.2), en entiers tels que le moteur les lit. */
export interface DivisionComponentInfo {
  /** `"men"` (les hommes) ou une clé de `ARMAMENT.types`. */
  readonly resource: string;
  readonly count: number;
  readonly required: boolean;
  readonly weight: number;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly airAttack: number;
  /** Échelle 100 (1 : 100). */
  readonly lossMultiplier: number;
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
  readonly components: readonly DivisionComponentInfo[];
  readonly icon: string;
  /** Description propre au type, sinon celle de l'armement de son premier composant d'armement. */
  readonly description: string;
  /** Largeur de première ligne, en liaisons. */
  readonly frontWidth: number;
  /** PV d'une division complète ; 0 pour l'appui-feu (jamais lus). */
  readonly hitPoints: number;
  /** Multiplicateurs à l'échelle 100. */
  readonly defenseHitPointsMultiplier: number;
  readonly attackMultiplier: number;
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
  /** Durée de formation d'une division, en tours. */
  readonly formationTurns: number;
  /** Délai d'un déplacement, en tours. */
  readonly transferTurns: number;
  /** Échelle de `DivisionView.state` (10 000 = 100 %). */
  readonly stateScale: number;
}

/** Ce que la page lit de la configuration des usines (envoyé une fois, dans `init`). */
export interface FactoryCatalog {
  /** Dans l'ordre du moteur : l'indice d'un type est celui de `factoryMarks`. */
  readonly factoryTypes: readonly { readonly id: string; readonly tree: readonly { readonly good: string; readonly parent: string | null }[] }[];
  readonly unlockTurns: number;
  /** `FACTORY.growthTurns` : tours avant une ligne automatique (00-Game §8.2). */
  readonly growthTurns: number;
  /** Biens, dans l'ordre de `HumanDetail.goods`. */
  readonly goodIds: readonly string[];
  /** Types d'armement, dans l'ordre de `HumanDetail.reserve`. */
  readonly armamentIds: readonly string[];
  readonly productionPerLine: Readonly<Record<string, number>>;
  /** Ouvriers de la première ligne d'un groupe, par bien ou type d'armement. */
  readonly workersPerLine: Readonly<Record<string, number>>;
  /** Ouvriers minimaux d'une ligne (plancher de la spécialisation, 00-Game §8.1), par bien ou type d'armement. */
  readonly workersFloor: Readonly<Record<string, number>>;
  /** Fer consommé par une ligne remplie, par bien ou type d'armement. */
  readonly ironPerLine: Readonly<Record<string, number>>;
  /** Icône d'un bien ou d'un type d'armement (chemin sous `public/icons/`) ; absent : symbole texte. */
  readonly icons: Readonly<Record<string, string>>;
  /** Réglages que la barre d'informations lit (envoyés une fois). */
  readonly economy: EconomyInfo;
}

/** Réglages du moteur dont la barre d'informations tire des rapports (maximum de population, mécanisation totale, déclin du stock). */
export interface EconomyInfo {
  /** `POPULATION.foodPerHead`. */
  readonly foodPerHead: number;
  /** `FOOD.minimum`. */
  readonly foodMinimum: number;
  /** `maxMachinesPer1000` de chaque bien-machine (clé = identifiant du bien). */
  readonly machinesPer1000: Readonly<Record<string, number>>;
  /** Part de l'excès d'armement supprimée par tour, en pourcent (`ARMAMENT.decayRate` / 100). */
  readonly armamentDecayPercent: number;
  /**
   * `mechanizationBase` et `mechanizationMax` de chaque bien-machine (clé = identifiant
   * du bien) : surface par travailleur sans machine et à pleine mécanisation, en
   * millièmes de case (`FARMING`, `FISHING`, `MINING`).
   */
  readonly mechanization: Readonly<Record<string, { readonly base: number; readonly max: number }>>;
  /** `FISHING.tileYield` et `FISHING.tileYieldMax` : rendement d'une case d'eau sans bateau et au maximum. */
  readonly waterYield: { readonly base: number; readonly max: number };
}

/** Un groupe de lignes du même bien dans une usine du joueur. */
export interface LineGroupView {
  readonly good: string;
  readonly lines: number;
  readonly active: number;
  readonly filled: number;
  /** Ouvriers des lignes remplies (somme selon le rang de chaque ligne, 00-Game §8.1). */
  readonly workers: number;
  /** Tours comptés vers la prochaine ligne automatique (biens seulement, 00-Game §8.2). */
  readonly growth: number;
  /** La capacité du joueur pour ce bien couvre la demande : plus de croissance automatique. */
  readonly demandMet: boolean;
  /** Lignes de ce groupe dont la production reste sous la demande (biens) ; `lines` pour l'armement. Trait rouge du curseur. */
  readonly usefulLines: number;
}

export interface FactoryView {
  readonly city: number;
  readonly type: string;
  /** Nombre total de lignes. */
  readonly level: number;
  readonly groups: readonly LineGroupView[];
  /** Un compteur de déblocage par nœud de l'arbre du type (même indice que `FactoryCatalog.factoryTypes[...].tree`). */
  readonly progress: readonly number[];
}

/** Ce dont le panneau de production a besoin, pour le joueur humain seulement. */
export interface HumanDetail {
  /** Dans l'ordre de priorité des villes. */
  readonly factories: readonly FactoryView[];
  readonly goods: readonly number[];
  readonly reserve: readonly number[];
  readonly reserveMax: readonly number[];
  /** Capacité d'extraction de fer par tour (cases de fer des zones × capacité par case). */
  readonly ironCapacity: number;
  /** Fer demandé par toutes les lignes actives, remplies ou non : Σ (lignes actives × fer par ligne). */
  readonly ironRequired: number;
}

/** Une connexion d'un front : `position` en millièmes de la route depuis `city1` ; 0 en paix (le client prend alors 500). */
export interface FrontConnectionView {
  readonly city1: number;
  readonly city2: number;
  readonly position: number;
}

/** Un camp d'un front, tout visible (pas de brouillard de guerre). Ses divisions sont dans `TickMessage.divisions`. */
export interface FrontSideView {
  /** Attaque sur tout le front en cours (05-Fronts §5.1). */
  readonly frontAttack: boolean;
}

export interface FrontView {
  readonly id: number;
  readonly players: readonly [number, number];
  readonly groups: readonly [number, number];
  /** Les deux joueurs sont en guerre. */
  readonly active: boolean;
  readonly connections: readonly FrontConnectionView[];
  readonly sides: readonly [FrontSideView, FrontSideView];
}

/** Une division (05-Fronts §3, §13.4), de n'importe quel joueur (pas de brouillard de guerre). */
export interface DivisionView {
  readonly id: number;
  readonly owner: number;
  /** Indice dans `MilitaryCatalog.divisions`. */
  readonly type: number;
  /** Exemplaires présents par composant, dans l'ordre de `components`. */
  readonly counts: readonly number[];
  /** Front où elle est, ou vers lequel elle va ; 0 : réserve nationale. */
  readonly front: number;
  readonly line: "first" | "second";
  /** Largeur engagée en première ligne, en millièmes de liaison (05-Fronts §4.2). */
  readonly engaged: number;
  /** État, de 0 à `MilitaryCatalog.stateScale` (05-Fronts §3.3). */
  readonly state: number;
  /**
   * `formation` (§3.5) et `moving` (§4.4) : icône horloge ; `fleeing` (§5.4) : drapeau blanc ; `ready` sinon.
   * Une division en déplacement est comptée à sa destination.
   */
  readonly status: "ready" | "formation" | "moving" | "fleeing";
  /** Tour où le statut prend fin (formation, déplacement, fuite) ; 0 pour `ready`. */
  readonly until: number;
}

export interface PlayerStats {
  readonly id: number;
  /** Soldats : hommes de toutes les divisions du joueur (00-Game §4, point 5). */
  readonly soldiers: number;
  readonly forcedMobilization: boolean;
  /** Armement dans les divisions du joueur, par type d'armement dans l'ordre de `FactoryCatalog.armamentIds` (05-Fronts §4.5, §11.6). */
  readonly divisionEquipment: readonly number[];
  readonly population: number;
  readonly farmers: number;
  readonly fishers: number;
  readonly idle: number;
  readonly food: number;
  readonly wheat: number;
  readonly fish: number;
  readonly cultivated: number;
  /**
   * Mécanisation du dernier tour par bien-machine, en millièmes de case par
   * travailleur : `Player.farmMechanization`, `fishMechanization`, `mineMechanization`.
   */
  readonly mechanization: Readonly<Record<string, number>>;
  /** Machines utilisées au dernier tour, par bien (celles produites au tour d'avant, 00-Game §12). */
  readonly machinesUsed: Readonly<Record<string, number>>;
  /** Cases de fer des zones du joueur. */
  readonly ironTiles: number;
  /** `surface_max` : cases fertiles du joueur. */
  readonly farmTiles: number;
  readonly fished: number;
  readonly seaTiles: number;
  readonly farmPercent: number;
  /** Identifiant de la capitale, 0 = aucune. */
  readonly capital: number;
  readonly cities: number;
  /** Coût en population de la prochaine ville (00-Game §3.3). */
  readonly foundingCost: number;
  /** Ouvriers des lignes remplies, mineurs, cases de fer exploitées, fer extrait (dernier tour). */
  readonly factoryWorkers: number;
  readonly miners: number;
  readonly minedTiles: number;
  readonly ironExtracted: number;
  /** Nourriture si toutes les terres et toutes les eaux étaient travaillées (au moins FOOD.minimum). */
  readonly foodPotential: number;
  /** Blé si toutes les cases fertiles étaient cultivées (`Player.fertilitySum`). */
  readonly wheatMax: number;
  /** Poisson si toutes les cases d'eau étaient pêchées, au rendement d'eau des bateaux actuels. */
  readonly fishMax: number;
  /**
   * Machines d'une mécanisation totale (00-Game §6.2) : la référence (disponibles
   * plafonnés aux travailleurs qui couvrent la surface à pleine mécanisation) × machines pour 1 000
   * ÷ 1 000. Clé = bien-machine.
   */
  readonly fullMachines: Readonly<Record<string, number>>;
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
  /**
   * Usines de tous les joueurs, 4 nombres chacune [ville, indice du type, niveau, indice dans
   * l'arbre du bien qui a le plus de lignes construites, `dominantGood`]. Présente
   * seulement si elle a changé depuis le tour précédent ; sinon `null`.
   */
  readonly factoryMarks: Uint32Array | null;
  /** Le détail des usines du joueur humain, à chaque tour. */
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
  /** Villes prises pendant ce tour. La page reçoit alors `cities` et les cases de leur zone. */
  readonly captured: readonly { readonly city: number; readonly from: number; readonly to: number }[];
  /** Encerclements causés par ces prises (05-Fronts §10.2) : `from` encercle des divisions de `to` ; `divisions` : divisions touchées. */
  readonly encircled: readonly { readonly city: number; readonly from: number; readonly to: number; readonly divisions: number }[];
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
