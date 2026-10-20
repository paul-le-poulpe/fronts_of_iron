import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/** Une partie sans signal depuis plus longtemps que ceci n'est plus listée. */
export const GAME_TTL_MS = 90_000;

export interface GameInput {
  name: string;
  address: string;
  players: number;
  maxPlayers: number;
}

export interface GameListing extends GameInput {
  id: string;
}

/**
 * Le lobby : une seule instance pour tout le jeu (nommée "lobby" dans
 * src/index.ts). Les parties sont dans la base SQLite de l'instance, pas dans
 * un champ de la classe : la base survit au retrait de l'instance de la
 * mémoire et aux déploiements. Voir Docs/Design/01-Architecture.md §4.
 *
 * Les entrées arrivent déjà validées par src/index.ts.
 */
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        address     TEXT NOT NULL,
        players     INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        last_seen   INTEGER NOT NULL
      )
    `);
  }

  register(game: GameInput): string {
    const now = Date.now();
    this.deleteExpired(now);
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT INTO games (id, name, address, players, max_players, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
      id, game.name, game.address, game.players, game.maxPlayers, now,
    );
    return id;
  }

  /**
   * Met à jour l'heure du dernier signal et le nombre de joueurs. Renvoie
   * false si la partie est inconnue ou déjà expirée : l'hôte doit alors se
   * réinscrire.
   */
  heartbeat(id: string, players: number): boolean {
    const now = Date.now();
    this.deleteExpired(now);
    const cursor = this.ctx.storage.sql.exec(
      "UPDATE games SET last_seen = ?, players = MIN(?, max_players) WHERE id = ?",
      now, players, id,
    );
    return cursor.rowsWritten > 0;
  }

  /** Les parties ouvertes. N'écrit rien : les expirées sont filtrées ici et supprimées à la prochaine inscription ou au prochain signal. */
  list(): GameListing[] {
    const rows = this.ctx.storage.sql.exec<{
      id: string;
      name: string;
      address: string;
      players: number;
      max_players: number;
    }>(
      "SELECT id, name, address, players, max_players FROM games WHERE last_seen >= ? ORDER BY name, id",
      Date.now() - GAME_TTL_MS,
    ).toArray();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      players: r.players,
      maxPlayers: r.max_players,
    }));
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM games WHERE last_seen < ?", now - GAME_TTL_MS);
  }
}
