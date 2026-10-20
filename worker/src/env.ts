import type { Lobby } from "./lobby";

export interface Env {
  ASSETS: Fetcher;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Secret partagé avec les serveurs d'hôte. `wrangler secret put LOBBY_SECRET` en production, `.dev.vars` en local. */
  LOBBY_SECRET?: string;
}
