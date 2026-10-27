// Messages entre la page et le Web Worker du moteur (Docs/Design/03-Client.md).
// Aucun état de partie complet ne passe : la carte une fois, puis par tour les
// cases dont la ville a changé, les villes et routes quand une ville est fondée,
// et quelques totaux par joueur.

/** Identifiant du joueur humain en mode solo. Les bots ont les identifiants suivants. */
export const HUMAN = 1;

/** Ordre du joueur humain. Le champ `player` est écrit par le Worker (règle 4 du CLAUDE.md). */
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
  // Fronts (05-Fronts §5) : `front` est l'identifiant du front, `unit` une clé de `UNITS`.
  | { readonly type: "set_front_priority"; readonly front: number; readonly priority: number }
  | { readonly type: "set_front_reassign"; readonly front: number; readonly enabled: boolean }
  | { readonly type: "set_unit_line_mode"; readonly front: number; readonly unit: string; readonly mode: "first" | "balanced" | "second" }
  | { readonly type: "set_unit_allowed"; readonly front: number; readonly unit: string; readonly enabled: boolean }
  | { readonly type: "set_breakthrough_motorized_only"; readonly front: number; readonly enabled: boolean }
  | { readonly type: "set_forced_mobilization"; readonly enabled: boolean }
  | { readonly type: "start_front_attack" | "stop_front_attack"; readonly front: number }
  | { readonly type: "start_breakthrough"; readonly front: number; readonly city1: number; readonly city2: number }
  | { readonly type: "cancel_breakthrough"; readonly id: number };

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
  | { readonly type: "order"; readonly id: number; readonly order: HumanOrder }
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
  readonly expansionRadius: number;
  readonly controlRadius: number;
  readonly stepMs: number;
  readonly catalog: FactoryCatalog;
  /** Fronts et unités militaires (05-Fronts), envoyés une fois. */
  readonly military: MilitaryCatalog;
}

/** Une unité militaire (`config/units.ts`), en entiers tels que le moteur les lit. */
export interface UnitInfo {
  readonly id: string;
  /** Indice dans les tableaux d'effectifs (ordre des clés de `UNITS`). */
  readonly index: number;
  /** Clé de la niche (`NICHES`). */
  readonly niche: string;
  readonly equipment: string;
  readonly equipmentCount: number;
  readonly population: number;
  readonly icon: string;
  /** Description propre à l'unité, sinon celle de l'équipement, sinon vide. */
  readonly description: string;
  readonly softAttack: number;
  readonly hardAttack: number;
  readonly frontWidth: number;
  readonly breakthroughWidth: number;
  readonly kind: "infantry" | "armor" | "equipment";
  readonly hitPoints: number;
  readonly motorized: boolean;
  /** Priorité de retrait des fronts, 1 à 10 : 10 est retirée en premier (05-Fronts §4.7). */
  readonly releasePriority: number;
}

/** Ce que la page lit de `config/fronts.ts` et `config/units.ts` (envoyé une fois, dans `init`). */
export interface MilitaryCatalog {
  /** Types d'unités, dans l'ordre des clés de `UNITS`. */
  readonly units: readonly UnitInfo[];
  /** Niches dans l'ordre de `NICHES`, chacune avec ses types du meilleur au moins bon. */
  readonly niches: readonly { readonly id: string; readonly units: readonly string[] }[];
  readonly metersPerConnection: number;
  readonly priorityPercent: readonly number[];
  readonly transferTurns: number;
  readonly combatTurns: number;
  readonly breakthroughDelayTurns: number;
  readonly breakthroughExhaustionPercent: number;
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

/**
 * Une percée en cours (05-Fronts §7.2). `attackers`, `defenders1`, `defenders2` : unités engagées par type. Avant la phase 2,
 * ce sont les forces prévues (`previewBreakthrough`) : l'attente comme la phase 1 montrent déjà la contre-attaque à venir.
 */
export interface BreakthroughView {
  readonly id: number;
  readonly city1: number;
  readonly city2: number;
  /** 0 attente, 1 contre la première ligne, 2 contre la seconde ligne. */
  readonly phase: number;
  readonly startTick: number;
  readonly attackers: readonly number[];
  readonly defenders1: readonly number[];
  readonly defenders2: readonly number[];
}

/** Un camp d'un front, tout visible (pas de brouillard de guerre). Les effectifs sont des nombres d'unités par type. */
export interface FrontSideView {
  readonly first: readonly number[];
  readonly second: readonly number[];
  /** Unités perdues par type au dernier round de combat, en première et en seconde ligne. */
  readonly lostFirst: readonly number[];
  readonly lostSecond: readonly number[];
  /** Unités en route vers le front, par type. */
  readonly transit: readonly number[];
  /** Indice dans `MilitaryCatalog.priorityPercent`. */
  readonly priority: number;
  readonly reassign: boolean;
  /** Interrupteur de chaque type : 0 priorité première ligne, 1 équilibré, 2 priorité seconde ligne. */
  readonly lineMode: readonly number[];
  /** Case « autorisé sur ce front » de chaque type. */
  readonly allowed: readonly boolean[];
  readonly motorizedOnly: boolean;
  readonly frontAttack: boolean;
  readonly breakthroughs: readonly BreakthroughView[];
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

export interface PlayerStats {
  readonly id: number;
  /** Soldats : population des unités sur les fronts et en route (05-Fronts §4.1). */
  readonly soldiers: number;
  readonly forcedMobilization: boolean;
  /** Équipement dans des unités des fronts (déployé et en route), par type d'armement dans l'ordre de `FactoryCatalog.armamentIds`. */
  readonly frontEquipment: readonly number[];
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
   * tour précédent. Positions et effectifs changent à chaque round de combat.
   */
  readonly fronts: readonly FrontView[] | null;
  /** Nombre de percées du joueur humain qui se sont arrêtées au début faute de force à engager pendant ce tour (05-Fronts §7.2). */
  readonly failedBreakthroughs: number;
  /** Villes prises pendant ce tour. La page reçoit alors `cities` et les cases de leur zone. */
  readonly captured: readonly { readonly city: number; readonly from: number; readonly to: number }[];
  /** Encerclements causés par ces prises (05-Fronts §10.2) : `from` encercle des troupes de `to`, qui perdent `lost` unités. */
  readonly encircled: readonly { readonly city: number; readonly from: number; readonly to: number; readonly lost: number }[];
  readonly paused: boolean;
  /** Durées mesurées dans le Worker, en ms. */
  readonly perf: { readonly bots: number; readonly apply: number; readonly pack: number };
}

export type FromWorker = InitMessage | TickMessage | { readonly type: "paused"; readonly paused: boolean };
