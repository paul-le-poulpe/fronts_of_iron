import { DurableObject } from "cloudflare:workers";
import { MAX_ONLINE_PLAYERS, cloudflareGamePath, type LobbyEntry, type MapId, type RoomState } from "@fronts-of-iron/shared";
import type { Env } from "./env.ts";

/** Une partie sans signal depuis plus longtemps que ceci n'est plus listée. */
export const GAME_TTL_MS = 90_000;

/** Inscription d'une partie hébergée par un joueur (`POST /api/games`). Les champs facultatifs peuvent manquer : requêtes d'avant la salle d'attente. */
export interface GameInput {
  name: string;
  address: string;
  players: number;
  maxPlayers: number;
  hostName?: string;
  map?: MapId;
  seed?: number;
}

/** Inscription d'une partie Cloudflare, par appel interne du Durable Object `Game`. */
export interface CloudflareGameInput {
  id: string;
  name: string;
  hostName: string;
  players: number;
  state: RoomState;
  map: MapId;
  seed: number;
}

/** Ce qu'un signal peut changer. Seul `players` est obligatoire (requêtes d'avant la salle d'attente). */
export interface GameUpdate {
  players: number;
  state?: RoomState;
  hostName?: string;
  map?: MapId;
  seed?: number;
}

export type GameListing = LobbyEntry;

/**
 * Colonnes ajoutées à la table `games` après sa création. Une base créée par une
 * version précédente ne les a pas : le constructeur les ajoute (ALTER TABLE).
 */
const ADDED_COLUMNS: readonly (readonly [name: string, definition: string])[] = [
  ["mode", "TEXT NOT NULL DEFAULT 'host'"],
  ["host_name", "TEXT NOT NULL DEFAULT ''"],
  ["map", "TEXT NOT NULL DEFAULT 'test'"],
  ["seed", "INTEGER"],
  ["state", "TEXT NOT NULL DEFAULT 'waiting'"],
];

/**
 * Le lobby : une seule instance pour tout le jeu (nommée "lobby" dans
 * src/index.ts). Les parties sont dans la base SQLite de l'instance, pas dans
 * un champ de la classe : la base survit au retrait de l'instance de la
 * mémoire et aux déploiements. Voir Docs/Design/01-Architecture.md §4.
 *
 * Les entrées arrivent déjà validées par src/index.ts (requêtes des hôtes) ou
 * viennent du Durable Object `Game` (appels internes, sans secret).
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
    for (const [name, definition] of ADDED_COLUMNS) {
      // Une lecture de la colonne échoue si la table vient d'une version précédente : on l'ajoute alors.
      try {
        ctx.storage.sql.exec(`SELECT ${name} FROM games LIMIT 0`).toArray();
      } catch {
        ctx.storage.sql.exec(`ALTER TABLE games ADD COLUMN ${name} ${definition}`);
      }
    }
  }

  /** Inscrit une partie hébergée par un joueur et renvoie son identifiant. */
  register(game: GameInput): string {
    const now = Date.now();
    this.deleteExpired(now);
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO games (id, name, address, players, max_players, last_seen, mode, host_name, map, seed, state)
       VALUES (?, ?, ?, ?, ?, ?, 'host', ?, ?, ?, 'waiting')`,
      id, game.name, game.address, game.players, game.maxPlayers, now, game.hostName ?? "", game.map ?? "test", game.seed ?? null,
    );
    return id;
  }

  /**
   * Inscrit (ou réinscrit, avec le même identifiant) une partie Cloudflare. Appelé
   * par le Durable Object de la partie : à sa première salle avec un hôte, et
   * quand un signal a répondu « inconnue » (partie expirée).
   */
  registerCloudflare(game: CloudflareGameInput): void {
    const now = Date.now();
    this.deleteExpired(now);
    this.ctx.storage.sql.exec(
      `INSERT INTO games (id, name, address, players, max_players, last_seen, mode, host_name, map, seed, state)
       VALUES (?, ?, ?, ?, ?, ?, 'cloudflare', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, address = excluded.address, players = excluded.players,
         max_players = excluded.max_players, last_seen = excluded.last_seen, mode = excluded.mode,
         host_name = excluded.host_name, map = excluded.map, seed = excluded.seed, state = excluded.state`,
      game.id, game.name, cloudflareGamePath(game.id), game.players, MAX_ONLINE_PLAYERS, now,
      game.hostName, game.map, game.seed, game.state,
    );
  }

  /**
   * Met à jour l'heure du dernier signal et ce que le signal apporte (nombre de
   * joueurs, et facultativement état, hôte, carte, graine). Renvoie false si la
   * partie est inconnue ou déjà expirée : l'hôte doit alors se réinscrire.
   */
  heartbeat(id: string, update: GameUpdate): boolean {
    const now = Date.now();
    this.deleteExpired(now);
    const cursor = this.ctx.storage.sql.exec(
      `UPDATE games SET
         last_seen = ?,
         players   = MIN(?, max_players),
         state     = COALESCE(?, state),
         host_name = COALESCE(?, host_name),
         map       = COALESCE(?, map),
         seed      = COALESCE(?, seed)
       WHERE id = ?`,
      now, update.players, update.state ?? null, update.hostName ?? null, update.map ?? null, update.seed ?? null, id,
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
      mode: string;
      host_name: string;
      map: string;
      seed: number | null;
      state: string;
    }>(
      `SELECT id, name, address, players, max_players, mode, host_name, map, seed, state
       FROM games WHERE last_seen >= ? ORDER BY name, id`,
      Date.now() - GAME_TTL_MS,
    ).toArray();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      hostName: r.host_name,
      mode: r.mode === "cloudflare" ? "cloudflare" : "host",
      address: r.address,
      map: r.map as MapId,
      seed: r.seed,
      players: r.players,
      maxPlayers: r.max_players,
      state: r.state === "started" ? "started" : "waiting",
    }));
  }

  private deleteExpired(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM games WHERE last_seen < ?", now - GAME_TTL_MS);
  }
}
