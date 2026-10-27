import { isMapId, isSeed, normalizeGameName, normalizePlayerName } from "@fronts-of-iron/shared";
import type { Env } from "./env.ts";
import type { GameInput, GameUpdate } from "./lobby.ts";

export { Game } from "./game.ts";
export { Lobby } from "./lobby.ts";

/**
 * Requêtes du lobby. Tout le reste (/, index.html, scripts…) est servi depuis le
 * client compilé sans passer par ce code (voir [assets] dans wrangler.toml).
 *
 *   GET  /api/games                  liste publique des parties (les deux modes)
 *   POST /api/games                  inscrire une partie d'hôte  (secret requis)
 *   POST /api/games/:id/heartbeat    signal « toujours active »  (secret requis)
 *   POST /api/games/cloudflare       créer une partie Cloudflare (mot de passe de création) → { id, hostToken }
 *   GET  /api/games/:id/ws           WebSocket d'une partie Cloudflare (salle d'attente)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const lobby = env.LOBBY.getByName("lobby");

    if (url.pathname === "/api/games") {
      if (request.method === "GET") {
        return json(200, { games: await lobby.list() });
      }
      if (request.method === "POST") {
        const denied = checkSecret(request, env);
        if (denied) return denied;
        const game = parseGame(await readJson(request));
        if (!game) return json(400, { error: "invalid_game" });
        return json(201, { id: await lobby.register(game) });
      }
      return json(405, { error: "method_not_allowed" });
    }

    if (url.pathname === "/api/games/cloudflare") {
      if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
      // Mot de passe de création (01-Architecture §4) : sans lui, n'importe quel visiteur pourrait épuiser les quotas du compte.
      if (!env.CREATE_PASSWORD) return json(503, { error: "create_password_not_configured" });
      const body = await readJson(request);
      const password = isRecord(body) && typeof body.password === "string" ? body.password : "";
      if (!sameSecret(password, env.CREATE_PASSWORD)) return json(401, { error: "wrong_password" });
      const name = normalizeGameName(isRecord(body) ? body.name : undefined);
      if (name === null) return json(400, { error: "invalid_game" });
      const id = crypto.randomUUID();
      const hostToken = await env.GAME.getByName(id).create(id, name);
      return json(201, { id, hostToken });
    }

    const socket = /^\/api\/games\/([^/]+)\/ws$/.exec(url.pathname);
    if (socket) {
      if (request.method !== "GET") return json(405, { error: "method_not_allowed" });
      // Le Durable Object répond 404 si cette partie n'a pas été créée, 426 sans en-tête Upgrade.
      return env.GAME.getByName(decodeURIComponent(socket[1])).fetch(request);
    }

    const heartbeat = /^\/api\/games\/([^/]+)\/heartbeat$/.exec(url.pathname);
    if (heartbeat) {
      if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
      const denied = checkSecret(request, env);
      if (denied) return denied;
      const update = parseUpdate(await readJson(request));
      if (!update) return json(400, { error: "invalid_players" });
      const known = await lobby.heartbeat(decodeURIComponent(heartbeat[1]), update);
      // 404 : partie inconnue ou expirée. L'hôte se réinscrit avec POST /api/games.
      return known ? json(200, { ok: true }) : json(404, { error: "unknown_game" });
    }

    return json(404, { error: "not_found" });
  },
} satisfies ExportedHandler<Env>;

/** Renvoie une réponse d'erreur si le secret est absent ou faux, sinon null. */
function checkSecret(request: Request, env: Env): Response | null {
  if (!env.LOBBY_SECRET) return json(503, { error: "lobby_secret_not_configured" });
  const header = request.headers.get("Authorization") ?? "";
  return sameSecret(header.startsWith("Bearer ") ? header.slice(7) : "", env.LOBBY_SECRET) ? null : json(401, { error: "unauthorized" });
}

/** Comparaison en temps constant d'un secret reçu et du secret attendu. */
function sameSecret(givenText: string, expectedText: string): boolean {
  const given = new TextEncoder().encode(givenText);
  const expected = new TextEncoder().encode(expectedText);
  // timingSafeEqual exige deux tampons de même taille.
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

/** Inscription d'une partie d'hôte. `hostName`, `map` et `seed` sont facultatifs : les anciennes requêtes restent valides. */
function parseGame(body: unknown): GameInput | null {
  if (!isRecord(body)) return null;
  const { name, address, players, maxPlayers } = body;
  const trimmed = normalizeGameName(name);
  if (trimmed === null) return null;
  if (typeof address !== "string" || !isHttpsUrl(address)) return null;
  if (!isCount(maxPlayers, 1, 1000) || !isCount(players, 0, maxPlayers)) return null;
  const extra = parseOptional(body);
  if (extra === null) return null;
  return { name: trimmed, address, players, maxPlayers, ...extra };
}

/** Signal d'un hôte : `players` obligatoire, `state`, `hostName`, `map` et `seed` facultatifs. */
function parseUpdate(body: unknown): GameUpdate | null {
  if (!isRecord(body)) return null;
  const { players, state } = body;
  if (!isCount(players, 0, 1000)) return null;
  if (state !== undefined && state !== "waiting" && state !== "started") return null;
  const extra = parseOptional(body);
  if (extra === null) return null;
  return { players, ...(state !== undefined ? { state } : {}), ...extra };
}

/** `hostName`, `map` et `seed`, s'ils sont présents ; null s'ils sont présents et invalides. */
function parseOptional(body: Record<string, unknown>): { hostName?: string; map?: "test"; seed?: number } | null {
  const out: { hostName?: string; map?: "test"; seed?: number } = {};
  if (body.hostName !== undefined) {
    const hostName = normalizePlayerName(body.hostName);
    if (hostName === null) return null;
    out.hostName = hostName;
  }
  if (body.map !== undefined) {
    if (!isMapId(body.map)) return null;
    out.map = body.map;
  }
  if (body.seed !== undefined) {
    if (!isSeed(body.seed)) return null;
    out.seed = body.seed;
  }
  return out;
}

/** L'adresse doit être en https : une page https ne peut joindre l'hôte qu'en wss (§10 de la doc). */
function isHttpsUrl(value: string): boolean {
  if (value.length > 200) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isCount(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
