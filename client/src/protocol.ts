// Messages entre la page et le Web Worker du moteur (Docs/Design/03-Client.md).
// Aucun état de partie complet ne passe : la carte une fois, puis par tour les
// cases dont la ville a changé, les villes et routes quand une ville est fondée,
// et quelques totaux par joueur.

/** Identifiant du joueur humain en mode solo. Les bots ont les identifiants suivants. */
export const HUMAN = 1;

/** Ordre du joueur humain. Le champ `player` est écrit par le Worker (règle 4 du CLAUDE.md). */
export type HumanOrder =
  | { readonly type: "found_city"; readonly tile: number }
  | { readonly type: "set_farm_share"; readonly percent: number };

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
  | { readonly type: "pause"; readonly paused: boolean };

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
  /** Statistiques des joueurs, dans l'ordre des identifiants. */
  readonly players: readonly PlayerStats[];
  /** Résultat des ordres humains appliqués pendant ce tour. */
  readonly results: readonly OrderResult[];
  readonly paused: boolean;
  /** Durées mesurées dans le Worker, en ms. */
  readonly perf: { readonly bots: number; readonly apply: number; readonly pack: number };
}

export type FromWorker = InitMessage | TickMessage | { readonly type: "paused"; readonly paused: boolean };
