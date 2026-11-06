// Prise d'une ville par un front (Docs/Design/05-Fronts.md §10) : encerclement,
// changement de propriétaire de la ville et de sa zone, recalcul des fronts.

import { CITY, FRONTS } from "./config.ts";
import { endBreakthrough } from "./breakthroughs.ts";
import { computeGroups } from "./cities.ts";
import { LINE_FIRST, LOSS_SCALE, applyLoss, dataOf, type Division } from "./divisions.ts";
import { ROUTE, updateFronts } from "./fronts.ts";
import { removeDestroyed, sideDivisions } from "./placement.ts";
import { setOwner, type GameState } from "./state.ts";

/**
 * Le joueur `attacker` prend la ville `cityId` à `defender`, par la connexion `via`
 * (05-Fronts §10) :
 * 1. encerclement, calculé avec les connexions et les positions d'avant la prise ;
 * 2. la ville et sa zone passent à l'attaquant ; groupes recalculés ;
 * 3. fronts recalculés, avec la position `capturePercent` sur les nouvelles connexions.
 * 4. si c'était sa dernière ville, le défenseur est éliminé (05-Fronts §10.3).
 * Choix provisoire (05-Fronts §15) : si c'était la
 * capitale du défenseur, sa ville de plus petit identifiant devient sa capitale.
 */
export function captureCity(
  state: GameState,
  attacker: number,
  defender: number,
  cityId: number,
  via: { readonly city1: number; readonly city2: number },
  changed: number[],
): void {
  const city = state.cities[cityId - 1]!;
  if (city.player !== defender) return;

  // 1. Encerclement (05-Fronts §10.2). Les routes de B entre la ville prise et des villes de A sont coupées des deux
  // côtés ; la route de l'attaque ne compte pas, et une route n'est encerclée que si B en tenait plus de
  // `minEncirclementLengthPercent` % depuis la ville prise.
  const minLength = FRONTS.minEncirclementLengthPercent * 10;
  let touched = 0;
  const hit: Division[] = [];
  for (const front of state.fronts) {
    const i: number = front.players[0] === defender && front.players[1] === attacker ? 0 : front.players[1] === defender && front.players[0] === attacker ? 1 : -1;
    if (i < 0) continue;
    let encircled = 0;
    for (const c of front.connections) {
      if (c.city1 !== cityId && c.city2 !== cityId) continue;
      if (c.city1 === via.city1 && c.city2 === via.city2) continue;
      const held = c.city1 === cityId ? c.position : ROUTE - c.position;
      if (held > minLength) encircled++;
    }
    if (encircled === 0) continue;
    // Pertes sur la première ligne de B seulement, connexions comptées avant la prise : f de l'état, × part engagée,
    // sur sa barre de vie.
    const f = Math.floor((encircled * FRONTS.encirclementLossPercent * LOSS_SCALE) / (front.connections.length * 100));
    for (const d of sideDivisions(state, front, defender)) {
      if (d.line !== LINE_FIRST || d.engaged === 0) continue;
      applyLoss(d, Math.floor((f * d.engaged) / dataOf(d).width));
      hit.push(d);
      touched++;
    }
  }
  removeDestroyed(state, hit);

  if (touched > 0) state.events.push({ type: "encirclement", from: attacker, to: defender, city: cityId, divisions: touched, turn: state.tick + 1 });

  // 2. La ville et sa zone passent à l'attaquant.
  city.player = attacker;
  const { width: w, height: h } = state.map;
  const r = CITY.controlRadius;
  const cx = city.tile % w;
  const cy = (city.tile - cx) / w;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const t = y * w + x;
      if (state.tileCity[t] === cityId) setOwner(state, t, attacker, changed);
    }
  }
  const lost = state.players[defender - 1]!;
  const won = state.players[attacker - 1]!;
  lost.cityIds.splice(lost.cityIds.indexOf(cityId), 1);
  let at = won.cityIds.findIndex((id) => id > cityId);
  if (at < 0) at = won.cityIds.length;
  won.cityIds.splice(at, 0, cityId);
  if (lost.capital === cityId) lost.capital = lost.cityIds[0] ?? 0;
  computeGroups(state);
  state.events.push({ type: "city_captured", from: attacker, to: defender, city: cityId, turn: state.tick + 1 });

  // 3. Fronts recalculés.
  updateFronts(state, { city: cityId, attacker, defender });

  // 4. Dernière ville prise : le défenseur est éliminé (05-Fronts §10.3).
  if (lost.cityIds.length === 0) eliminatePlayer(state, defender, attacker);
}

/**
 * Élimine `player`, dont `by` vient de prendre la dernière ville (05-Fronts §10.3) : `defeated` passe à vrai, ses divisions,
 * boîtes de percée et percées disparaissent, ses propositions diplomatiques en attente sont supprimées. Sa population est
 * gardée (le mode résistance, pas encore écrit, en aura besoin). Les ordres d'un joueur éliminé sont ignorés (`applyIntent`).
 */
function eliminatePlayer(state: GameState, player: number, by: number): void {
  state.players[player - 1]!.defeated = true;
  for (const bt of state.breakthroughs.filter((b) => b.owner === player)) endBreakthrough(state, bt);
  state.boxes = state.boxes.filter((b) => b.owner !== player);
  state.divisions = state.divisions.filter((d) => d.owner !== player);
  state.proposals = state.proposals.filter((p) => p.from !== player && p.to !== player);
  state.events.push({ type: "player_eliminated", from: by, to: player, turn: state.tick + 1 });
}
