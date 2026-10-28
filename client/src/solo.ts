// Source de tours locale (Docs/Design/03-Client.md §3, §8) : le mode solo. Le solo sert au débogage
// et doit créer ses tours comme une partie en ligne (01-Architecture §1) : il passe donc par le même
// relais (`packages/relay`, compilé dans le Web Worker). L'humain est l'hôte de la salle, les bots
// ajoutent leurs ordres au nom de leur identifiant. Aucun accès au DOM ni à `self` ici :
// engine.worker.ts le fait tourner dans un Web Worker, et les tests (client/test) dans Node.
//
// Une horloge extérieure appelle `tick` une fois par tour (100 ms).

import { Room, type Outgoing, type RoomEnv } from "@fronts-of-iron/relay";
import type { Order, TurnData } from "@fronts-of-iron/shared";
import type { GameState, Intent } from "@fronts-of-iron/engine";

import { createBot, type Bot } from "./bots.ts";
import { DEFAULT_STEP_MS, Game, type PendingOrder } from "./game.ts";
import { HUMAN, type InitMessage, type TickMessage } from "./protocol.ts";

export { DEFAULT_STEP_MS, type PendingOrder };

export const MAX_BOTS = 7;

export interface SoloOptions {
  readonly mapSeed: number;
  /** Nombre de bots, 1 à 7. */
  readonly bots: number;
  readonly stepMs?: number;
}

/** La seule connexion du relais du solo : celle de l'humain, qui est l'hôte. */
const CONN = "humain";

/** Le relais du solo n'a besoin ni de hasard ni de jetons difficiles à deviner : personne d'autre ne se connecte. */
function soloEnv(): RoomEnv {
  let tokens = 0;
  return { newToken: () => `solo-${++tokens}`, randomSeed: () => 0 };
}

export class SoloGame {
  readonly game: Game;
  readonly stepMs: number;
  /** Le relais : file d'ordres, numérotation des tours, pause (l'humain est l'hôte). */
  private readonly room: Room;
  private readonly bots: Bot[] = [];
  /** Identifiants donnés par la page aux ordres de l'humain, dans l'ordre où ils sont entrés dans le relais. */
  private readonly ids: number[] = [];

  constructor(options: SoloOptions) {
    if (!Number.isInteger(options.bots) || options.bots < 1 || options.bots > MAX_BOTS) {
      throw new Error(`nombre de bots invalide : ${options.bots}`);
    }
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    const players = [{ id: HUMAN, name: "Vous" }];
    for (let id = HUMAN + 1; id <= 1 + options.bots; id++) {
      players.push({ id, name: `Bot ${id - 1}` });
      this.bots.push(createBot(id, options.mapSeed));
    }
    this.game = new Game({ mapSeed: options.mapSeed, players, you: HUMAN, stepMs: this.stepMs });
    // Comme en ligne : l'humain entre dans la salle avec le jeton d'hôte, puis lance la partie.
    this.room = new Room(soloEnv());
    this.room.handle(CONN, { type: "join", name: "Vous", token: this.room.hostToken });
    this.room.handle(CONN, { type: "start" });
  }

  get state(): GameState {
    return this.game.state;
  }

  /** Copies de la carte (le moteur garde ses tableaux) : la page peut les recevoir par transfert. */
  init(): InitMessage {
    return this.game.init();
  }

  /**
   * Un ordre de l'humain, tel que la page l'envoie : il entre dans le relais à son arrivée, avant ceux
   * que les bots y ajouteront au prochain `tick`. Le champ `player` est écrit par le relais d'après la
   * connexion (règle 4 du CLAUDE.md), jamais lu du message.
   */
  submit(pending: PendingOrder): void {
    const out = this.room.handle(CONN, { type: "order", order: pending.order });
    if (!out.some((o) => o.message.type === "error")) this.ids.push(pending.id);
  }

  /** Pause ou reprise, par le relais (l'humain est l'hôte). Renvoie l'état de la pause. */
  setPaused(paused: boolean): boolean {
    this.room.handle(CONN, { type: "pause", paused });
    return this.room.paused;
  }

  get paused(): boolean {
    return this.room.paused;
  }

  /**
   * Un tour : les bots ajoutent leurs ordres dans l'ordre de leurs identifiants, le relais crée le tour
   * (ordres dans l'ordre d'arrivée), la partie l'applique. `null` en pause : ni bots ni tour.
   */
  tick(): TickMessage | null {
    if (this.room.paused) return null;
    const t0 = performance.now();
    const intents: Intent[] = [];
    for (const bot of this.bots) bot.step(this.game.state, intents);
    // Un ordre du moteur est un objet JSON avec un `type` : le relais ne lit rien d'autre.
    for (const intent of intents) this.room.submit(intent.player, intent as unknown as Order);
    const turn = turnOf(this.room.step());
    const botsMs = performance.now() - t0;
    if (turn === null) return null;
    return this.game.applyTurn(turn, { ids: this.ids.splice(0), botsMs });
  }

  /** Un tour avec ces ordres humains (tests) : `submit` de chacun, puis `tick`. Hors pause. */
  step(human: readonly PendingOrder[]): TickMessage {
    for (const pending of human) this.submit(pending);
    const msg = this.tick();
    if (msg === null) throw new Error("la partie est en pause");
    return msg;
  }

  /** Outils de développement : voir `Game.debug`. */
  debug(action: "addPopulation" | "addArmament" | "armBots", amount: number): void {
    this.game.debug(action, amount);
  }
}

/** Le tour que le relais vient de créer pour l'humain, ou `null` (pause). */
function turnOf(out: readonly Outgoing[]): TurnData | null {
  for (const { message } of out) if (message.type === "turn") return message;
  return null;
}
