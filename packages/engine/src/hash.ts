// Hash 32 bits de l'état complet, comparé entre clients pour détecter une
// désynchronisation (01-Architecture.md §3). Construit avec les étapes de
// MurmurHash3 sur des mots de 32 bits assemblés à la main : ne pas lire les
// tableaux par une vue Uint32Array, dont l'ordre des octets dépend de la machine.

import { fmix32, mixWord } from "./bits.ts";
import type { GameMap } from "./map.ts";
import type { GameState } from "./state.ts";

export function hashMap(map: GameMap): number {
  const t = map.terrain;
  let h = mixWord(0x46524f4e, map.width);
  h = mixWord(h, map.height);
  let i = 0;
  for (; i + 3 < t.length; i += 4) {
    h = mixWord(h, t[i]! | (t[i + 1]! << 8) | (t[i + 2]! << 16) | (t[i + 3]! << 24));
  }
  for (; i < t.length; i++) h = mixWord(h, t[i]!);
  return fmix32(h ^ t.length);
}

/** Couvre : carte (par mapHash), numéro de tour, générateur aléatoire, joueurs, propriétaires. */
export function hashState(state: GameState): number {
  let h = mixWord(state.mapHash, state.tick);
  const r = state.rng;
  h = mixWord(h, r[0]!);
  h = mixWord(h, r[1]!);
  h = mixWord(h, r[2]!);
  h = mixWord(h, r[3]!);
  h = mixWord(h, state.players.length);
  for (const p of state.players) {
    h = mixWord(h, p.id);
    h = mixWord(h, p.tileCount);
  }
  const o = state.owner;
  let i = 0;
  for (; i + 1 < o.length; i += 2) h = mixWord(h, o[i]! | (o[i + 1]! << 16));
  if (i < o.length) h = mixWord(h, o[i]!);
  return fmix32(h ^ o.length);
}
