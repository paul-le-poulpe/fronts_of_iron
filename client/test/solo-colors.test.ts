// Couleurs du solo (Docs/Design/09-Couleurs.md §5) : celles du formulaire arrivent dans `InitMessage.playerColors`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SoloGame } from "../src/solo.ts";

const colorsOf = (colors?: readonly number[]): readonly number[] =>
  new SoloGame({ mapSeed: 7, bots: 2, ...(colors !== undefined ? { colors } : {}) }).init().playerColors;

describe("couleurs du solo", () => {
  it("le joueur et les bots reçoivent les couleurs demandées", () => {
    assert.deepEqual(colorsOf([5, 12, 3]), [5, 12, 3]);
  });

  it("une couleur déjà prise est remplacée par la première libre", () => {
    assert.deepEqual(colorsOf([0, 0, 1]), [0, 1, 2]);
  });

  it("sans couleur demandée, les bots ont des couleurs écartées", () => {
    assert.deepEqual(colorsOf(), [0, 6, 9]);
  });
});
