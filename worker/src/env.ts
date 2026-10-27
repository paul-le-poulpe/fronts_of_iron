import type { Game } from "./game.ts";
import type { Lobby } from "./lobby.ts";

export interface Env {
  ASSETS: Fetcher;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Une instance par partie hébergée par Cloudflare, nommée par l'identifiant de la partie. */
  GAME: DurableObjectNamespace<Game>;
  /** Secret partagé avec les serveurs d'hôte. `wrangler secret put LOBBY_SECRET` en production, `.dev.vars` en local. */
  LOBBY_SECRET?: string;
}
