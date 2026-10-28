// Source de tours WebSocket (Docs/Design/03-Client.md §8) : une partie en ligne vue du Web Worker.
// Elle ouvre le WebSocket de la partie, envoie les ordres du joueur, reçoit le message de départ et les
// tours, les applique à la partie (`game.ts`), et envoie le hash de l'état tous les N tours
// (01-Architecture §3). Aucun accès au DOM, à `self` ni à `WebSocket` ici : le transport est fourni par
// engine.worker.ts (le vrai WebSocket) ou par un test (un relais en mémoire).

import { hashState } from "@fronts-of-iron/engine";
import { HASH_EVERY_TURNS, isMapId, type ClientMessage, type ServerMessage, type TurnData } from "@fronts-of-iron/shared";

import { Game, DEFAULT_STEP_MS, validRoster } from "./game.ts";
import type { EndedMessage, FromWorker, HumanOrder } from "./protocol.ts";

/** Une connexion ouverte : ce que la source de tours lui demande. */
export interface Transport {
  send(text: string): void;
  close(): void;
}

/** Ce que le transport signale. `open` n'est appelé qu'après le retour de `Connect`. */
export interface TransportHandlers {
  open(): void;
  message(text: string): void;
  close(): void;
}

export type Connect = (url: string, handlers: TransportHandlers) => Transport;

export interface OnlineOptions {
  readonly url: string;
  readonly name: string;
  readonly token: string;
  readonly connect: Connect;
  /** Envoie un message à la page. */
  readonly post: (message: FromWorker) => void;
}

export class OnlineGame {
  readonly #options: OnlineOptions;
  #transport: Transport | null = null;
  #game: Game | null = null;
  #stopped = false;
  /** Nombre de messages `tick` envoyés à la page : tant qu'il vaut 0, la page repart de rien. */
  #posted = 0;
  /** Identifiants des ordres envoyés au relais et pas encore revenus dans un tour, dans l'ordre d'envoi. */
  readonly #ids: number[] = [];

  constructor(options: OnlineOptions) {
    this.#options = options;
  }

  /** La partie, une fois le message de départ reçu (les tests la lisent). */
  get game(): Game | null {
    return this.#game;
  }

  /** Ouvre la connexion ; à l'ouverture, `join` avec le jeton (reconnexion de l'hôte ou du joueur). */
  start(): void {
    const { url, name, token, connect } = this.#options;
    this.#transport = connect(url, {
      open: () => this.#send({ type: "join", name, token }),
      message: (text) => this.#onText(text),
      close: () => this.#onClose(),
    });
  }

  /** Un ordre du joueur, pour la page. Le relais écrit le joueur (règle 4) : le message n'en contient pas. */
  order(id: number, order: HumanOrder): void {
    if (this.#game === null || this.#stopped) return;
    this.#ids.push(id);
    this.#send({ type: "order", order });
  }

  /** Demande de pause ou de reprise : le relais ne l'accepte que de l'hôte, et répond par `paused` à tous. */
  setPaused(paused: boolean): void {
    if (this.#game === null || this.#stopped) return;
    this.#send({ type: "pause", paused });
  }

  /** La page quitte la partie : ferme la connexion, sans message. */
  stop(): void {
    this.#stopped = true;
    this.#transport?.close();
  }

  #send(message: ClientMessage): void {
    if (!this.#stopped) this.#transport?.send(JSON.stringify(message));
  }

  #onText(text: string): void {
    if (this.#stopped) return;
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    try {
      this.#onMessage(message);
    } catch (error) {
      // Une erreur du moteur ou une partie qui ne peut plus continuer : la copie ne vaut plus rien.
      this.#end("error", `Erreur du moteur : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #onMessage(message: ServerMessage): void {
    const game = this.#game;
    switch (message.type) {
      case "start": {
        // Une partie déjà créée n'est jamais recréée : un second message de départ ne peut venir que d'une reconnexion.
        if (game !== null) return;
        if (!isMapId(message.map) || !validRoster(message.players, message.you)) {
          this.#end("refused", "Message de départ invalide.");
          return;
        }
        const created = new Game({ mapSeed: message.seed, map: message.map, players: message.players, you: message.you, stepMs: DEFAULT_STEP_MS });
        this.#game = created;
        const init = created.init();
        this.#options.post(init);
        return;
      }
      case "turn":
        if (game !== null) this.#live(game, message);
        return;
      case "turns":
        if (game !== null) this.#history(game, message.turns);
        return;
      case "paused":
        this.#options.post({ type: "paused", paused: message.paused });
        return;
      case "desync":
        this.#end("desync", `Votre partie n'est plus synchronisée avec celle des autres joueurs (tour ${message.turn}).`);
        return;
      case "error":
        // Avant le message de départ, toute erreur est un refus de rejoindre ; ensuite, seul « replaced » arrête la partie.
        if (game === null || message.code === "replaced") this.#end("refused", message.message);
        else this.#options.post({ type: "notice", text: message.message });
        return;
      case "welcome":
      case "room":
        // Le relais nous prend pour un nouveau joueur d'une salle d'attente : la partie lancée n'existe plus (déploiement, 01-Architecture §6).
        if (game === null) this.#end("refused", "Cette partie n'existe plus.");
        return;
    }
  }

  /** Un tour reçu en direct. Un tour déjà appliqué est ignoré ; un tour manquant est une erreur. */
  #live(game: Game, turn: TurnData): void {
    if (turn.turn <= game.state.tick) return;
    this.#checkNext(game, turn);
    this.#tick(game, turn);
  }

  /**
   * Tous les tours depuis le début (reconnexion, 01-Architecture §3). Si la page n'a encore rien reçu, ils
   * sont appliqués sans message, sauf le dernier : la page n'a pas à redessiner chaque tour d'une partie de
   * plusieurs milliers de tours, et les événements du passé (prises de villes, diplomatie) ne sont pas rejoués.
   * Un seul hash est envoyé : celui du dernier multiple de N, que le relais compare à celui des autres joueurs.
   */
  #history(game: Game, turns: readonly TurnData[]): void {
    const fresh = turns.filter((t) => t.turn > game.state.tick);
    if (fresh.length === 0) return;
    if (this.#posted > 0) {
      for (const turn of fresh) this.#live(game, turn);
      return;
    }
    const lastTurn = fresh[fresh.length - 1]!;
    const hashAt = lastTurn.turn - (lastTurn.turn % HASH_EVERY_TURNS);
    for (const turn of fresh) {
      this.#checkNext(game, turn);
      if (turn === lastTurn) break;
      game.advance(turn);
      if (turn.turn === hashAt) this.#sendHash(game);
    }
    const msg = game.applyTurn(lastTurn, { full: true });
    this.#posted++;
    this.#options.post(msg);
    if (lastTurn.turn === hashAt) this.#sendHash(game);
  }

  #checkNext(game: Game, turn: TurnData): void {
    if (turn.turn !== game.state.tick + 1) throw new Error(`tour ${turn.turn} reçu, tour ${game.state.tick + 1} attendu`);
  }

  /** Applique un tour, informe la page, envoie le hash si le tour est un multiple de N. */
  #tick(game: Game, turn: TurnData): void {
    const mine = turn.orders.reduce((n, o) => n + (o.player === game.you ? 1 : 0), 0);
    const msg = game.applyTurn(turn, { ids: this.#ids.splice(0, mine) });
    this.#posted++;
    this.#options.post(msg);
    if (turn.turn % HASH_EVERY_TURNS === 0) this.#sendHash(game);
  }

  #sendHash(game: Game): void {
    this.#send({ type: "hash", turn: game.state.tick, hash: hashState(game.state) >>> 0 });
  }

  #onClose(): void {
    if (this.#stopped) return;
    if (this.#game === null) this.#end("refused", "Connexion à la partie impossible.");
    else this.#end("lost", "Connexion perdue. Rechargez la page pour reprendre la partie.");
  }

  #end(reason: EndedMessage["reason"], message: string): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#transport?.close();
    this.#options.post({ type: "ended", reason, message });
  }
}
