// Placement des noms de joueurs sur la carte : une règle par test, sur de petites cartes écrites à la main.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PlayerLabels, largestTerritories, placeLabel } from "../src/playerlabels.ts";

/** Une ligne par rangée : `.` mer, `0` terre libre, chiffre : joueur. */
function parse(rows: readonly string[]) {
  const width = rows[0]!.length;
  const cells = rows.join("");
  const owners = Uint16Array.from(cells, (c) => (c === "." ? 0 : Number(c)));
  return {
    width,
    height: rows.length,
    owners,
    isLand: (t: number) => cells[t] !== ".",
    ownerOf: (t: number) => owners[t]!,
  };
}

describe("noms des joueurs", () => {
  it("le plus grand territoire contigu porte le nom, sans liaison en diagonale", () => {
    const m = parse(["11.1", "11.1", "..1.", "1..."]);
    assert.equal(largestTerritories(m.owners, m.width).get(1)!.length, 4);
  });

  it("le nom se place au centre d'un territoire assez grand", () => {
    const m = parse(["1111111", "1111111", "1111111", "1111111", "1111111"]);
    const tiles = largestTerritories(m.owners, m.width).get(1)!;
    assert.deepEqual(placeLabel(m.owners, m.width, 1, tiles, 3, 1), { x: 3.5, y: 2.5 });
  });

  it("le nom ne recouvre jamais une case d'un autre joueur", () => {
    const m = parse(["1111111", "2211111", "2211111"]);
    const tiles = largestTerritories(m.owners, m.width).get(1)!;
    const spot = placeLabel(m.owners, m.width, 1, tiles, 3, 2)!;
    assert.ok(spot.x - 1.5 >= 2 || spot.y + 1 <= 1);
  });

  it("le nom peut déborder sur la mer et la terre libre", () => {
    const m = parse(["....", ".11.", "...."]);
    const tiles = largestTerritories(m.owners, m.width).get(1)!;
    assert.notEqual(placeLabel(m.owners, m.width, 1, tiles, 4, 1), null);
  });

  it("sans position possible, le joueur n'a pas de nom", () => {
    const m = parse(["212", "212", "212"]);
    const tiles = largestTerritories(m.owners, m.width).get(1)!;
    assert.equal(placeLabel(m.owners, m.width, 1, tiles, 3, 1), null);
  });

  it("un joueur sans case n'a pas de nom", () => {
    const m = parse(["11", "11"]);
    const spots = new PlayerLabels(m).spots(() => ({ w: 1, h: 1 }));
    assert.deepEqual(spots.map((s) => s.player), [1]);
  });
});
