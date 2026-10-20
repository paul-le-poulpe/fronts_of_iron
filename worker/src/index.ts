import type { Env } from "./env";
import type { GameInput } from "./lobby";

export { Lobby } from "./lobby";

/**
 * Requêtes du lobby. Tout le reste (/, index.html…) est servi depuis public/
 * sans passer par ce code (voir [assets] dans wrangler.toml).
 *
 *   GET  /api/games                  liste publique des parties ouvertes
 *   POST /api/games                  inscrire une partie      (secret requis)
 *   POST /api/games/:id/heartbeat    signal « toujours active » (secret requis)
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

    const heartbeat = /^\/api\/games\/([^/]+)\/heartbeat$/.exec(url.pathname);
    if (heartbeat) {
      if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
      const denied = checkSecret(request, env);
      if (denied) return denied;
      const body = await readJson(request);
      const players = isRecord(body) ? body.players : undefined;
      if (!isCount(players, 0, 1000)) return json(400, { error: "invalid_players" });
      const known = await lobby.heartbeat(decodeURIComponent(heartbeat[1]), players);
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
  const given = new TextEncoder().encode(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = new TextEncoder().encode(env.LOBBY_SECRET);
  // timingSafeEqual exige deux tampons de même taille.
  const ok = given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
  return ok ? null : json(401, { error: "unauthorized" });
}

function parseGame(body: unknown): GameInput | null {
  if (!isRecord(body)) return null;
  const { name, address, players, maxPlayers } = body;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return null;
  if (typeof address !== "string" || !isHttpsUrl(address)) return null;
  if (!isCount(maxPlayers, 1, 1000) || !isCount(players, 0, maxPlayers)) return null;
  return { name: trimmed, address, players, maxPlayers };
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
