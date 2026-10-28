// La partie lancée, côté relais (Docs/Design/01-Architecture.md §3) : file d'ordres, tours,
// hashes, pause. Comme `Room`, elle ne connaît ni horloge, ni réseau : l'enveloppe lui demande
// un tour quand elle veut, et `Room` fait le lien avec les connexions.
//
// Le relais ne lit pas le contenu des ordres au-delà de leur forme : c'est le moteur de chaque
// client qui les valide (règle 4 du CLAUDE.md).

import { MAX_ORDERS_PER_TURN, type Order, type TurnData, type TurnOrder } from "@fronts-of-iron/shared";

/** Le hash envoyé par un joueur pour un tour. */
interface Vote {
  readonly player: number;
  hash: number;
}

export class Match {
  /** Tous les tours créés, dans l'ordre : le tour `n` est à l'indice `n - 1`. Gardés pour la reconnexion. */
  readonly turns: TurnData[] = [];
  /** Tant que c'est vrai, `step` ne crée aucun tour. Les ordres reçus attendent. */
  paused = false;
  #queue: TurnOrder[] = [];
  /** Ordres déjà dans la file, par joueur : la borne `MAX_ORDERS_PER_TURN`. */
  readonly #queued = new Map<number, number>();
  /** Hashes reçus par tour, dans l'ordre d'arrivée du premier hash de chaque joueur. */
  readonly #votes = new Map<number, Vote[]>();
  /** Joueurs déjà avertis de leur désynchronisation, par tour. */
  readonly #warned = new Map<number, Set<number>>();

  /**
   * Met l'ordre du joueur `player` dans la file du prochain tour. Le champ `player` de l'ordre
   * est écrasé, même s'il était présent. Renvoie faux, sans rien ajouter, si le joueur a déjà
   * `MAX_ORDERS_PER_TURN` ordres dans la file.
   */
  queue(player: number, order: Order): boolean {
    const count = this.#queued.get(player) ?? 0;
    if (count >= MAX_ORDERS_PER_TURN) return false;
    this.#queued.set(player, count + 1);
    this.#queue.push({ ...order, player });
    return true;
  }

  /**
   * Crée le tour suivant avec les ordres dans la file, dans l'ordre d'arrivée, et vide la file.
   * Renvoie `null` en pause.
   */
  step(): TurnData | null {
    if (this.paused) return null;
    const turn: TurnData = { turn: this.turns.length + 1, orders: this.#queue };
    this.#queue = [];
    this.#queued.clear();
    this.turns.push(turn);
    return turn;
  }

  /**
   * Enregistre le hash du joueur pour le tour `turn` (déjà vérifié par l'appelant : multiple de N,
   * déjà créé). Un nouveau hash du même joueur pour le même tour remplace l'ancien : un client qui
   * rejoue la partie depuis le début renvoie ses hashes. Renvoie les joueurs à avertir : ceux dont
   * le hash diffère du hash majoritaire et qui ne l'ont pas encore été pour ce tour.
   *
   * Le hash majoritaire est le plus fréquent ; à égalité, celui qui est arrivé le premier (provisoire :
   * à deux joueurs, rien ne dit lequel a raison).
   */
  vote(player: number, turn: number, hash: number): number[] {
    let votes = this.#votes.get(turn);
    if (votes === undefined) this.#votes.set(turn, (votes = []));
    const own = votes.find((v) => v.player === player);
    if (own === undefined) votes.push({ player, hash });
    else own.hash = hash;
    // Un joueur qui renvoie un hash pourra être averti de nouveau.
    const warned = this.#warned.get(turn) ?? new Set<number>();
    this.#warned.set(turn, warned);
    warned.delete(player);

    const counts = new Map<number, number>();
    for (const v of votes) counts.set(v.hash, (counts.get(v.hash) ?? 0) + 1);
    let majority = votes[0]!.hash;
    for (const v of votes) if (counts.get(v.hash)! > counts.get(majority)!) majority = v.hash;

    const out: number[] = [];
    for (const v of votes) {
      if (v.hash === majority || warned.has(v.player)) continue;
      warned.add(v.player);
      out.push(v.player);
    }
    return out;
  }
}
