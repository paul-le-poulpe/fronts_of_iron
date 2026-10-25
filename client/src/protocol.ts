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
  | { readonly type: "set_line_priority"; readonly city: number; readonly good: string; readonly position: number };

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
  /** Outil de développement, mode solo seulement : modifie l'état directement, hors des règles et des ordres. */
  | { readonly type: "debug"; readonly action: "addPopulation"; readonly amount: number };

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

export interface PlayerStats {
  readonly id: number;
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
   * Usines de tous les joueurs, 3 nombres chacune [ville, indice du type, niveau]. Présente
   * seulement si elle a changé depuis le tour précédent ; sinon `null`.
   */
  readonly factoryMarks: Uint32Array | null;
  /** Le détail des usines du joueur humain, à chaque tour. */
  readonly human: HumanDetail;
  /** Statistiques des joueurs, dans l'ordre des identifiants. */
  readonly players: readonly PlayerStats[];
  /** Résultat des ordres humains appliqués pendant ce tour. */
  readonly results: readonly OrderResult[];
  readonly paused: boolean;
  /** Durées mesurées dans le Worker, en ms. */
  readonly perf: { readonly bots: number; readonly apply: number; readonly pack: number };
}

export type FromWorker = InitMessage | TickMessage | { readonly type: "paused"; readonly paused: boolean };
