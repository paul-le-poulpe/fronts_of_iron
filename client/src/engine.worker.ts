// Web Worker du moteur (01-Architecture §6, Client, règle 3). Il possède l'état de la partie, qui
// reçoit ses tours d'une source de tours choisie au lancement (03-Client.md §8) :
// - solo : l'horloge ci-dessous demande un tour toutes les `stepMs` ms au relais local (`solo.ts`) ;
// - en ligne : le WebSocket de la partie (`online-game.ts`), le serveur donne le rythme.
// Une minuterie est permise ici : ce fichier n'est pas dans `packages/engine`, et le moteur ne voit
// que des numéros de tour.

import type { FromWorker, ToWorker } from "./protocol.ts";
import { OnlineGame, type Connect } from "./online-game.ts";
import { SoloGame } from "./solo.ts";

declare const self: DedicatedWorkerGlobalScope;

let solo: SoloGame | null = null;
let online: OnlineGame | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextAt = 0;

/** Envoie un message à la page ; les grands tableaux sont transférés, pas copiés. */
function post(msg: FromWorker): void {
  const transfer: Transferable[] = [];
  if (msg.type === "init") transfer.push(msg.terrain.buffer, msg.resources.buffer, msg.fertility.buffer);
  else if (msg.type === "tick") {
    transfer.push(msg.tiles.buffer);
    if (msg.cities) transfer.push(msg.cities.buffer);
    if (msg.roads) transfer.push(msg.roads.buffer);
  }
  self.postMessage(msg, transfer);
}

/** Le vrai WebSocket, derrière l'interface que `OnlineGame` attend. */
const connect: Connect = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.open();
  ws.onmessage = (event) => {
    if (typeof event.data === "string") handlers.message(event.data);
  };
  // Une erreur est suivie d'un événement `close` : c'est lui qui est traité.
  ws.onclose = () => handlers.close();
  return {
    send: (text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    close: () => ws.close(1000),
  };
};

function stopAll(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  solo = null;
  online?.stop();
  online = null;
}

/** Horloge du solo. */
function loop(): void {
  const game = solo;
  if (game === null) return;
  const now = performance.now();
  const msg = game.tick();
  if (msg !== null) post(msg);
  // Horloge sans dérive : le tour suivant est planifié sur l'heure prévue, pas sur
  // la fin du calcul. En retard de plus d'un pas, on repart de maintenant au lieu
  // de rattraper en rafale. En pause, la minuterie continue sans tour.
  nextAt += game.stepMs;
  if (nextAt < now - game.stepMs) nextAt = now;
  timer = setTimeout(loop, Math.max(0, nextAt - performance.now()));
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case "start": {
      stopAll();
      const game = new SoloGame({ mapSeed: msg.mapSeed, bots: msg.bots, ...(msg.stepMs !== undefined ? { stepMs: msg.stepMs } : {}) });
      solo = game;
      post(game.init());
      nextAt = performance.now() + game.stepMs;
      timer = setTimeout(loop, game.stepMs);
      break;
    }
    case "online":
      stopAll();
      online = new OnlineGame({ url: msg.url, name: msg.name, token: msg.token, connect, post });
      online.start();
      break;
    case "order":
      // Le joueur est écrit par le relais d'après la connexion, jamais lu du message.
      if (solo !== null) solo.submit({ id: msg.id, order: msg.order });
      else online?.order(msg.id, msg.order);
      break;
    case "pause":
      if (solo !== null) post({ type: "paused", paused: solo.setPaused(msg.paused) });
      else online?.setPaused(msg.paused);
      break;
    case "debug":
      // Solo seulement : en ligne, l'état ne change que par les tours (règle 3).
      if (solo !== null) solo.debug(msg.action, msg.amount);
      break;
  }
};
