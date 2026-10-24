// Web Worker du moteur (01-Architecture §6, Client, règle 3). Il possède l'état
// de la partie. Horloge de tour du mode solo : toutes les `stepMs` ms (100 par
// défaut), un tour avec les ordres humains reçus depuis le tour précédent, puis
// ceux des bots. Une minuterie est permise ici : ce fichier n'est pas dans
// `packages/engine`, et le moteur ne voit que des numéros de tour.

import type { FromWorker, ToWorker } from "./protocol.ts";
import { SoloGame, type PendingOrder } from "./solo.ts";

declare const self: DedicatedWorkerGlobalScope;

let game: SoloGame | null = null;
let pending: PendingOrder[] = [];
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextAt = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function loop(): void {
  if (game === null) return;
  const now = performance.now();
  if (!paused) {
    const orders = pending;
    pending = [];
    const msg = game.step(orders);
    const transfer: Transferable[] = [msg.tiles.buffer];
    if (msg.cities) transfer.push(msg.cities.buffer);
    if (msg.roads) transfer.push(msg.roads.buffer);
    post(msg, transfer);
  }
  // Horloge sans dérive : le tour suivant est planifié sur l'heure prévue, pas sur
  // la fin du calcul. En retard de plus d'un pas, on repart de maintenant au lieu
  // de rattraper en rafale.
  nextAt += game.stepMs;
  if (nextAt < now - game.stepMs) nextAt = now;
  timer = setTimeout(loop, Math.max(0, nextAt - performance.now()));
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case "start": {
      if (timer !== undefined) clearTimeout(timer);
      game = new SoloGame({ mapSeed: msg.mapSeed, bots: msg.bots, ...(msg.stepMs !== undefined ? { stepMs: msg.stepMs } : {}) });
      pending = [];
      paused = false;
      const init = game.init();
      post(init, [init.terrain.buffer, init.resources.buffer, init.fertility.buffer]);
      nextAt = performance.now() + game.stepMs;
      timer = setTimeout(loop, game.stepMs);
      break;
    }
    case "order":
      // Le joueur est écrit par SoloGame (HUMAN), jamais lu du message.
      if (game !== null) pending.push({ id: msg.id, order: msg.order });
      break;
    case "pause":
      paused = msg.paused;
      post({ type: "paused", paused });
      break;
    case "debug":
      if (game !== null) game.debug(msg.action, msg.amount);
      break;
  }
};
