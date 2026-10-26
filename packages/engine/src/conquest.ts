// Prise d'une ville par un front (Docs/Design/05-Fronts.md §10) : encerclement,
// changement de propriétaire de la ville et de sa zone, recalcul des fronts.

import { CITY, FRONTS } from "./config.ts";
import { computeGroups } from "./cities.ts";
import { ROUTE, clipBreakthroughs, updateFronts } from "./fronts.ts";
import { setOwner, type GameState } from "./state.ts";
import { loseUnits } from "./troops.ts";
import { UNIT_COUNT, roundDiv, zeros } from "./units.ts";

/**
 * Le joueur `attacker` prend la ville `cityId` à `defender`, par la connexion `via`
 * (05-Fronts §10) :
 * 1. encerclement, calculé avec les connexions et les positions d'avant la prise ;
 * 2. la ville et sa zone passent à l'attaquant ; groupes recalculés ;
 * 3. fronts recalculés, avec la position `capturePercent` sur les nouvelles connexions.
 * Choix provisoires (05-Fronts §15) : l'usine de la ville est détruite ; si c'était la
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
    // Pertes sur la première ligne de B seulement, front par front, connexions comptées avant la prise.
    const side = front.sides[i]!;
    const lost = zeros();
    for (let t = 0; t < UNIT_COUNT; t++) {
      lost[t] = Math.min(side.firstLine[t]!, roundDiv(side.firstLine[t]! * encircled * FRONTS.encirclementLossPercent, front.connections.length * 100));
      side.firstLine[t] = side.firstLine[t]! - lost[t]!;
    }
    loseUnits(state, defender, lost);
    clipBreakthroughs(front);
  }

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
  const factory = lost.factories.findIndex((f) => f.city === cityId);
  if (factory >= 0) lost.factories.splice(factory, 1);
  computeGroups(state);
  state.events.push({ type: "city_captured", from: attacker, to: defender, city: cityId, turn: state.tick + 1 });

  // 3. Fronts recalculés.
  updateFronts(state, { city: cityId, attacker, defender });
}
