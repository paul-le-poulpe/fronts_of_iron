// Combat des fronts (Docs/Design/05-Fronts.md §6, §7, §10, §13.7) : pertes tirées, partage entre les lignes, pertes de
// l'appui-feu, échange, fuite, avancée, prise d'une ville, encerclement.
//
// Les fractions de pertes `f` (sur 10⁶ de la division complète) sont calculées à la main dans chaque test d'après les
// formules du §6, avec les valeurs du §3.4. Le modèle de `war-helpers.ts` en déduit les compteurs attendus et rejoue
// les tirages du §1 sur une copie du générateur : le test échoue si le moteur tire un autre nombre de fois, ou dans un
// autre ordre. Rappels : une infanterie complète d'une liaison tire 1 500 points anti-infanterie et 100 antiblindés
// (attaquante : × 0,5) ; elle a 50 000 PV (défendant : × 2).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGame,
  createRng,
  frontAdvance,
  FRONTS,
  isFleeing,
  LINE_FIRST,
  LINE_SECOND,
  MIDDLE,
  nextInt,
  type GameState,
} from "../src/index.ts";
import { applyLoss } from "../src/divisions.ts";
import { applyFlight, applySwaps } from "../src/placement.ts";
import { at, duel, expectModel, found, front, MAP, play, playRound, put, putMany, turn, war, widen } from "./war-helpers.ts";

/** Un état minimal pour `applyLoss`, qui ne lit que le générateur. */
const lossState = (seed: number): GameState => ({ rng: createRng(seed) }) as unknown as GameState;
const Q = 100_000_000;

describe("pertes tirées (05-Fronts §1)", () => {
  const fresh = (): ReturnType<typeof put> => put(duel(), 1, "regulars");

  it("sans reste, rien n'est tiré : 10 % d'une infanterie font 100, 100 et 10", () => {
    const d = fresh();
    const state = lossState(7);
    const rng = new Uint32Array(state.rng);
    applyLoss(state, d, 100_000);
    assert.deepEqual(d.counts, [900, 900, 90]);
    assert.deepEqual([...state.rng], [...rng]);
  });

  it("on ne tire que pour les composants dont le reste est positif : 0,5 % ne tire que pour les mitrailleuses", () => {
    // f = 5 000 : hommes et fusils 5 000 × 100 × 1 000 / 10⁸ = 5 exactement ; mitrailleuses 0,5 : reste 5 × 10⁷ sur 10⁸.
    for (let seed = 1; seed <= 20; seed++) {
      const d = fresh();
      const state = lossState(seed);
      const rng = new Uint32Array(state.rng);
      const draw = nextInt(rng, Q) < 50_000_000;
      applyLoss(state, d, 5000);
      assert.deepEqual(d.counts, [995, 995, draw ? 99 : 100], `graine ${seed}`);
      assert.deepEqual([...state.rng], [...rng], "un seul tirage");
    }
  });

  it("la partie entière est toujours perdue, le reste est tiré : 0,15 % font 1 ou 2 hommes, 0 ou 1 mitrailleuse", () => {
    // f = 1 500 : hommes et fusils 1,5 (reste 5 × 10⁷) ; mitrailleuses 0,15 (reste 1,5 × 10⁷). Tirages dans l'ordre des composants.
    let twice = 0;
    let gun = 0;
    const seeds = 2000;
    for (let seed = 1; seed <= seeds; seed++) {
      const d = fresh();
      const state = lossState(seed);
      const rng = new Uint32Array(state.rng);
      const lost = [1 + Number(nextInt(rng, Q) < 50_000_000), 1 + Number(nextInt(rng, Q) < 50_000_000), Number(nextInt(rng, Q) < 15_000_000)];
      applyLoss(state, d, 1500);
      assert.deepEqual(d.counts, [1000 - lost[0]!, 1000 - lost[1]!, 100 - lost[2]!], `graine ${seed}`);
      twice += lost[0]! - 1;
      gun += lost[2]!;
    }
    // Moyennes 1,5 et 0,15 : 1 000 ± 22 et 300 ± 16 sur 2 000 tirages (bornes à six écarts-types).
    assert.ok(twice > 860 && twice < 1140, `${twice} hommes perdus en plus de 1`);
    assert.ok(gun > 200 && gun < 400, `${gun} mitrailleuses perdues`);
  });

  it("la perte est bornée à ce que le composant a", () => {
    const d = fresh();
    d.counts.splice(0, 3, 3, 3, 0);
    applyLoss(lossState(1), d, 1_000_000);
    assert.deepEqual(d.counts, [0, 0, 0]);
  });
});

describe("pertes par composant et lossMultiplier (05-Fronts §6.2)", () => {
  it("à 10 % : l'infanterie perd 10 % de chaque composant ; la chenillette 5 % de ses hommes (×0,5) et 10 % de ses chars", () => {
    const s = duel();
    const infantry = put(s, 1, "regulars");
    const tankette = put(s, 1, "tankette");
    applyLoss(lossState(1), infantry, 100_000);
    applyLoss(lossState(1), tankette, 100_000);
    assert.deepEqual(infantry.counts, [900, 900, 90]);
    // hommes : 10 % × 0,5 × 500 = 25 ; chars : 10 % × 1 × 50 = 5
    assert.deepEqual(tankette.counts, [475, 45]);
  });

  it("l'artillerie a ×1 sur ses hommes et sur ses canons : 20 % de la division, 20 % de chaque composant", () => {
    const s = duel();
    const artillery = put(s, 1, "artillery");
    applyLoss(lossState(1), artillery, 200_000);
    assert.deepEqual(artillery.counts, [400, 40]);
  });
});

describe("un round (05-Fronts §6)", () => {
  it("pas d'attaque en cours : aucun dégât, aucun mouvement", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const { before, rng } = playRound(s);
    expectModel(s, before, [], rng);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE]);
  });

  it("partage entre les lignes : infanterie pleine, chars à 50 % → 2/3 et 1/3 des dégâts ; pertes par composant", () => {
    // Front de 4 liaisons. Le joueur 1 attaque avec 4 infanteries (ids 1 à 4) ; le joueur 2 défend avec 4 infanteries
    // (5 à 8, engagées 4 000) et une chenillette (9, largeur 2 : engagée 2 000, soit 50 % de la ligne des chars).
    // Part de la ligne d'infanterie : 4 000 / 6 000 = 2/3 ; chars : 1/3. Dans la ligne, au prorata de la largeur engagée.
    const s = duel();
    widen(s, 4);
    war(s, 1);
    putMany(s, 1, "regulars", 4);
    putMany(s, 2, "regulars", 4);
    put(s, 2, "tankette", 1);
    const { before, rng } = playRound(s);

    // Combat 1 : le joueur 1 attaque (× 0,5). Chaque infanterie : 750 anti-infanterie et 50 antiblindés, soit 3 000 et 200 pour 4.
    //  - une infanterie du joueur 2 reçoit 2/3 × 3 000 / 4 = 500 points sur 50 000 × 2 PV (elle défend) : 0,5 %, f = 5 000 ;
    //  - la chenillette reçoit 1/3 × 200 = 66,66 points antiblindés (blindage 100) sur 50 000 PV : 0,1333 %, f = 1 333.
    // Combat 2 : le joueur 2 riposte sans multiplicateur : 4 × 1 500 + 2 500 = 8 500 anti-infanterie (la chenillette y est
    //  engagée à 2 000 / 2 000), sur la ligne d'infanterie du joueur 1 seule : 2 125 points chacune sur 50 000 PV : f = 42 500.
    const hits = [
      [1, 2, 3, 4].map((id) => ({ id, f: 42_500 })),
      [5, 6, 7, 8].map((id) => ({ id, f: 5000 })),
      [{ id: 9, f: 1333 }],
    ].flat();
    expectModel(s, before, [hits], rng);

    // Valeurs sûres à la main, quel que soit le tirage : 5 hommes et 5 fusils perdus (5 000 × 100 × 1 000 = 5 × 10⁸ : exact),
    // mitrailleuses ramenées à 99 par le taux de soldats qu'elles aient perdu 0 ou 1 exemplaire.
    for (const id of [5, 6, 7, 8]) assert.deepEqual(s.divisions[id - 1]!.counts, [995, 995, 99]);
    // 42 500 : 42,5 hommes et fusils perdus (42 ou 43), mitrailleuses à 95 après le taux de soldats (957 ou 958 soldats).
    for (const id of [1, 2, 3, 4]) {
      const [men, rifles, guns] = s.divisions[id - 1]!.counts;
      assert.ok((men === 957 || men === 958) && men === rifles && guns === 95, `division ${id} : ${s.divisions[id - 1]!.counts}`);
    }
  });

  it("deux attaques sur le même front : deux combats, chaque camp attaquant et défenseur", () => {
    // Une infanterie contre une infanterie, les deux attaquent. Combat 1 (le 1 attaque) : le joueur 2 reçoit 750 points
    // sur 100 000 PV (défense) : f = 7 500 ; le joueur 1 reçoit 1 500 sur 50 000 : f = 30 000. Combat 2 (le 2 attaque) : le
    // joueur 1 reçoit 750 sur 100 000 : f = 7 500, le joueur 2 reçoit 1 500 sur 50 000 : f = 30 000. Total : 37 500 chacun.
    const s = duel();
    war(s, 1, 2);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const { before, rng } = playRound(s);
    expectModel(s, before, [[{ id: 1, f: 37_500 }, { id: 2, f: 37_500 }]], rng);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE], "rapport 1 : le front n'avance pas");
  });

  it("l'appui-feu pleinement engagé prend les dégâts d'une liaison : autant qu'une infanterie d'un front plein (05-Fronts §6.3)", () => {
    // Front de 5 liaisons : 5 infanteries du joueur 1 attaquent 5 infanteries (6 à 10) et une artillerie (11, engagée à
    // 5 000 / 5 000 = 100 %) du joueur 2. Dégâts sur les infanteries du joueur 2 : 5 × 750 = 3 750 points partagés à 5 :
    // 750 chacune sur 100 000 PV : f = 7 500. L'artillerie (blindage 0, 50 000 PV, ×2 en défense) prend 3 750 × part 100 %
    // / (F = 5 liaisons + 0 de chars) = 750 points : f = 7 500.
    // Riposte : 5 × 1 500 + 2 500 = 10 000 anti-infanterie sur 5 infanteries : 2 000 chacune sur 50 000 PV : f = 40 000.
    const s = duel();
    widen(s, 5);
    war(s, 1);
    putMany(s, 1, "regulars", 5);
    putMany(s, 2, "regulars", 5);
    put(s, 2, "artillery", 1);
    const { before, rng } = playRound(s);
    const hits = [
      [1, 2, 3, 4, 5].map((id) => ({ id, f: 40_000 })),
      [6, 7, 8, 9, 10, 11].map((id) => ({ id, f: 7500 })),
    ].flat();
    expectModel(s, before, [hits], rng);
    // 40 000 : 40 hommes et fusils, 4 mitrailleuses, exactement.
    for (const id of [1, 2, 3, 4, 5]) assert.deepEqual(s.divisions[id - 1]!.counts, [960, 960, 96]);
  });

  it("l'appui-feu engagé à 20 % ne subit que 20 % de ces dégâts (quarante graines)", () => {
    // Front d'une liaison : l'artillerie du joueur 2 n'est engagée qu'à 1 000 / 5 000 : 750 points × 20 % sur 100 000 PV, f = 1 500.
    // Riposte du joueur 2 : 1 500 + 500 (artillerie : 2 500 × 20 %) = 2 000 anti-infanterie : f = 40 000 sur l'infanterie du 1.
    for (let seed = 1; seed <= 40; seed++) {
      const s = duel();
      war(s, 1);
      putMany(s, 1, "regulars", 1);
      putMany(s, 2, "regulars", 1);
      put(s, 2, "artillery", 1);
      s.rng.set(createRng(seed));
      const { before, rng } = playRound(s);
      expectModel(s, before, [[{ id: 1, f: 40_000 }, { id: 2, f: 7500 }, { id: 3, f: 1500 }]], rng);
    }
  });
});

describe("division engagée en partie et appui-feu engagé à 20 % (05-Fronts §4.2, §6.2, §6.3)", () => {
  it("chenillette engagée à 50 % qui reçoit l'antiblindé, canon anti-char engagé à 20 % qui prend 20 % des dégâts anti-infanterie (quarante graines)", () => {
    // Le joueur 1 attaque avec une infanterie (id 1) et un canon anti-char (id 2, engagé à 1 000 / 5 000) : antiblindé
    // 50 + 5 000 × 20 % × 0,2 = 250 points. La chenillette du joueur 2 (id 3, engagée à 1 000 / 2 000) est seule dans sa
    // ligne : elle reçoit tout, 250 points sur 50 000 PV (blindage 100, pas de bonus de défense) : f = 5 000. Riposte : la
    // chenillette engagée à 50 % fait 1 250 anti-infanterie sur l'infanterie du joueur 1 seule (le canon est de l'appui-feu) :
    // f = 25 000 ; le canon (blindage 0) prend 1 250 anti-infanterie × 20 % = 250 points sur 50 000 PV, f = 5 000.
    // (Le taux de soldats ramène les hommes d'une chenillette à 10 par char : toute perte d'homme coûte un char, donc ce test
    // ne distingue pas f = 5 000 de f = 10 000 pour la chenillette.)
    for (let seed = 1; seed <= 40; seed++) {
      const s = duel();
      war(s, 1);
      put(s, 1, "regulars", 1);
      put(s, 1, "antiTank", 1);
      put(s, 2, "tankette", 1);
      s.rng.set(createRng(seed));
      const { before, rng } = playRound(s);
      expectModel(s, before, [[{ id: 1, f: 25_000 }, { id: 2, f: 5000 }, { id: 3, f: 5000 }]], rng);
    }
  });
});

describe("seuils exacts de fuite et d'échange (05-Fronts §5.3, §5.4)", () => {
  const firstLine = (s: GameState, counts: number[]): ReturnType<typeof put> => {
    const d = put(s, 1, "regulars", front(s).id);
    d.counts.splice(0, 3, ...counts);
    d.line = LINE_FIRST;
    d.engaged = 1000;
    return d;
  };

  it("à exactement 25 % la division fuit, à 25,08 % elle reste", () => {
    const s = duel();
    const at25 = firstLine(s, [250, 250, 25]); // (2 × 25 % + 2 × 25 % + 25 %) / 5 = 25 %
    const above = firstLine(s, [251, 251, 25]); // 25,08 %
    applyFlight(s, front(s));
    assert.deepEqual([at25.line, above.line], [LINE_SECOND, LINE_FIRST]);
    assert.equal(at25.fleeUntilTick, s.tick + 1 + FRONTS.fleeRounds * FRONTS.combatTurns);
    assert.equal(above.fleeUntilTick, 0);
  });

  it("à exactement la moitié de l'état de la seconde ligne il n'y a pas d'échange ; en dessous, il y en a un", () => {
    const s = duel();
    const half = firstLine(s, [500, 500, 50]); // 50 %
    const spare = put(s, 1, "regulars", front(s).id); // 100 %
    applySwaps(s, front(s));
    assert.deepEqual([half.line, spare.line], [LINE_FIRST, LINE_SECOND]);
    half.counts.splice(0, 3, 499, 499, 49); // 49,72 %
    applySwaps(s, front(s));
    assert.deepEqual([half.line, spare.line, spare.engaged], [LINE_SECOND, LINE_FIRST, 1000]);
  });
});

describe("échange et fuite (05-Fronts §5.3, §5.4)", () => {
  it("fuite : une division de première ligne à 25 % ou moins repasse en seconde ligne pour fleeRounds rounds", () => {
    // Le joueur 2 attaque avec une infanterie pleine. La division du joueur 1 est à 25,24 % ([253, 253, 25]) : elle reçoit
    // 750 points sur 100 000 PV (défense), f = 7 500, soit 7,5 hommes et fusils (7 au moins) : elle tombe sous 25 %.
    // Sa riposte (253 000 + 125 000 millièmes = 378 points sur 50 000 PV) donne f = 7 560 à l'attaquant.
    const s = duel();
    war(s, 2);
    const weak = put(s, 1, "regulars", 1);
    weak.counts.splice(0, 3, 253, 253, 25);
    weak.line = LINE_FIRST;
    weak.engaged = 1000;
    const strong = put(s, 2, "regulars", 1);
    const { before, rng } = playRound(s);
    expectModel(s, before, [[{ id: weak.id, f: 7500 }, { id: strong.id, f: 7560 }]], rng);
    const roundTurn = s.tick;
    assert.deepEqual([weak.line, weak.engaged, weak.fleeUntilTick], [LINE_SECOND, 0, roundTurn + FRONTS.fleeRounds * FRONTS.combatTurns]);
    assert.equal(strong.line, LINE_FIRST);
    // Elle ne revient pas en première ligne pendant le délai.
    play(s, FRONTS.fleeRounds * FRONTS.combatTurns - 2);
    assert.ok(isFleeing(s, weak));
    assert.deepEqual([weak.line, weak.engaged], [LINE_SECOND, 0]);
    play(s, 1);
    assert.deepEqual([weak.line, weak.engaged], [LINE_SECOND, 0], "dernier tour de fuite");
  });

  it("échange : une division de première ligne sous la moitié de l'état d'une division de seconde ligne lui laisse sa place", () => {
    // A (id 1, 40 %) tient la première ligne, B (id 2, 100 %) attend. Le joueur 2 attaque (id 3). A reçoit f = 7 500 et reste
    // à environ 39 % > 25 % : pas de fuite ; 39 % < 50 % × 100 % : B prend sa place et sa largeur engagée.
    // Riposte de A (400 000 + 200 000 millièmes = 600 points sur 50 000 PV) : f = 12 000 pour la division 3.
    const s = duel();
    war(s, 2);
    const a = put(s, 1, "regulars", 1);
    a.counts.splice(0, 3, 400, 400, 40);
    a.line = LINE_FIRST;
    a.engaged = 1000;
    const b = put(s, 1, "regulars", 1);
    const attacker = put(s, 2, "regulars", 1);
    const { before, rng } = playRound(s);
    expectModel(s, before, [[{ id: a.id, f: 7500 }, { id: attacker.id, f: 12_000 }]], rng);
    assert.deepEqual([a.line, a.engaged, a.fleeUntilTick], [LINE_SECOND, 0, 0]);
    assert.deepEqual([b.line, b.engaged], [LINE_FIRST, 1000]);
    assert.deepEqual(b.counts, [1000, 1000, 100], "la seconde ligne n'a reçu aucun dégât");
  });

  it("pas d'échange à partir de la moitié : A à 60 % garde sa place face à B à 100 %", () => {
    const s = duel();
    war(s, 2);
    const a = put(s, 1, "regulars", 1);
    a.counts.splice(0, 3, 600, 600, 60);
    a.line = LINE_FIRST;
    a.engaged = 1000;
    const b = put(s, 1, "regulars", 1);
    put(s, 2, "regulars", 1);
    playRound(s);
    assert.deepEqual([a.line, b.line], [LINE_FIRST, LINE_SECOND]);
  });
});

describe("avancée (05-Fronts §7)", () => {
  it("seuils et vitesses de la configuration", () => {
    assert.deepEqual(
      [FRONTS.advanceThresholdA, FRONTS.advanceThresholdB, FRONTS.footSpeedPermille, FRONTS.motorizedSpeedPermille],
      [2, 10, 10, 20],
    );
  });

  it("formule : rien sous A, vitesse maximale à partir de B, droite entre les deux, arrondi à 0,5 vers le haut", () => {
    // a / d ≤ 2 : rien ; a / d ≥ 10 : v
    assert.equal(frontAdvance(1000, 1000, 10), 0);
    assert.equal(frontAdvance(2000, 1000, 10), 0);
    assert.equal(frontAdvance(10_000, 1000, 10), 10);
    assert.equal(frontAdvance(18_000, 1000, 10), 10);
    // a = 4 000, d = 1 000 : (4 − 2) / 8 = 0,25 × 10 = 2,5 → 3 ;  a = 3 600 : 0,2 × 10 = 2 ;  a = 3 000 : 1/8 × 10 = 1,25 → 1
    assert.equal(frontAdvance(4000, 1000, 10), 3);
    assert.equal(frontAdvance(3600, 1000, 10), 2);
    assert.equal(frontAdvance(3000, 1000, 10), 1);
    // motorisée : a = 6 000, d = 1 000 : 0,5 × 20 = 10 ; a = 4 000, d = 500 : rapport 8, 3/4 × 20 = 15
    assert.equal(frontAdvance(6000, 1000, 20), 10);
    assert.equal(frontAdvance(4000, 500, 20), 15);
  });

  it("d = 0 : vitesse maximale ; a = 0 : aucune avancée, même sans défenseur", () => {
    assert.equal(frontAdvance(1000, 0, 10), 10);
    assert.equal(frontAdvance(1, 0, 20), 20);
    assert.equal(frontAdvance(0, 1000, 10), 0);
    assert.equal(frontAdvance(0, 0, 10), 0);
  });

  it("un round : le défenseur sans infanterie recule de 10 millièmes de route, dans le sens de l'attaquant", () => {
    const s = duel();
    war(s, 1);
    putMany(s, 1, "regulars", 1);
    playRound(s);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE + 10]);
    // Le joueur 2 attaque : la position diminue.
    const t = duel();
    war(t, 2);
    putMany(t, 2, "regulars", 1);
    playRound(t);
    assert.deepEqual(front(t).connections.map((c) => c.position), [MIDDLE - 10]);
  });

  it("un round : l'attaquant sans infanterie (a = 0) n'avance pas, même devant un défenseur absent", () => {
    const s = duel();
    war(s, 1);
    putMany(s, 1, "tankette", 1);
    playRound(s);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE]);
  });

  it("un round : rapport 3 (3 000 contre 1 000) → 1 millième sur toutes les routes du front ; rapport 2 → rien", () => {
    const s = duel();
    widen(s, 4);
    war(s, 1);
    putMany(s, 1, "regulars", 3);
    putMany(s, 2, "regulars", 1);
    playRound(s);
    assert.deepEqual(front(s).connections.map((c) => c.position), [501, 501, 501, 501]);
    const t = duel();
    widen(t, 4);
    war(t, 1);
    putMany(t, 1, "regulars", 2);
    putMany(t, 2, "regulars", 1);
    playRound(t);
    assert.deepEqual(front(t).connections.map((c) => c.position), [MIDDLE, MIDDLE, MIDDLE, MIDDLE]);
  });
});

describe("prise d'une ville et encerclement (05-Fronts §10)", () => {
  /**
   * Quatre villes : 1 et 3 au joueur 1, 2 (la ville X) et 4 au joueur 2. Le front a deux connexions, (1, 2) et (3, 2) ;
   * la route (2, 4) est interne au joueur 2. Le joueur 1 attaque avec une infanterie (id 1), le joueur 2 tient avec une
   * chenillette (id 2, première ligne de 2 000) : pas d'infanterie, donc d = 0 et le front avance de 10 par round.
   * La route d'attaque (1, 2) est à `via`, l'autre (3, 2) à `other`, en millièmes depuis la ville du joueur 1.
   */
  function siege(via: number, other: number): GameState {
    const s = createGame({ seed: 5, map: MAP, playerCount: 2 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
    turn(s, found(1, at(9.5, 12.6)));
    turn(s, found(2, at(14, 10)));
    assert.equal(s.cities.length, 4);
    assert.equal(s.fronts.length, 1);
    assert.deepEqual(front(s).connections.map((c) => [c.city1, c.city2]), [[1, 2], [3, 2]]);
    assert.ok(s.roads.some(([a, b]) => a === 2 && b === 4), "la route interne (2, 4)");
    war(s, 1);
    front(s).connections[0]!.position = via;
    front(s).connections[1]!.position = other;
    put(s, 1, "regulars", front(s).id);
    put(s, 2, "tankette", front(s).id);
    return s;
  }

  it("le front arrive au bout d'une route : la ville change de main avec ses cases ; l'autre route, tenue à plus de 25 %, est encerclée", () => {
    const s = siege(996, 500);
    const { before, rng } = playRound(s);

    // Combat : f = 50 000 pour l'infanterie du joueur 1 (2 500 points de la chenillette sur 50 000 PV), f = 1 000 pour la
    // chenillette (50 points antiblindés sur 50 000 PV). Avance de 10 : (1, 2) à 1 006 → 1 000, (3, 2) à 510.
    // Encerclement : sur (3, 2), le joueur 2 tient 1 000 − 510 = 490 millièmes depuis X, plus de 250 ; f = 1 route × 50 %
    // / 2 connexions = 25 % = 250 000, sur une chenillette engagée à 2 000 / 2 000.
    expectModel(s, before, [[{ id: 1, f: 50_000 }, { id: 2, f: 1000 }], [{ id: 2, f: 250_000 }]], rng);
    assert.deepEqual(s.divisions.find((d) => d.id === 1)!.counts, [950, 950, 95]);

    assert.equal(s.cities[1]!.player, 1);
    assert.equal(s.owner[s.cities[1]!.tile], 1, "la case de la ville est passée au joueur 1");
    assert.deepEqual(s.players[0]!.cityIds, [1, 2, 3]);
    assert.deepEqual(s.players[1]!.cityIds, [4]);
    assert.equal(s.players[1]!.capital, 4, "la capitale perdue passe à la ville de plus petit identifiant");
    assert.deepEqual(
      s.events.map((e) => [e.type, "from" in e ? e.from : 0, "to" in e ? e.to : 0, "city" in e ? e.city : 0, e.type === "encirclement" ? e.divisions : 0]),
      [["encirclement", 1, 2, 2, 1], ["city_captured", 1, 2, 2, 0]],
    );

    // Fronts recalculés : seule la route (2, 4) sépare encore les deux joueurs, à 1 % depuis la ville prise (X est city1).
    assert.equal(s.fronts.length, 1);
    assert.deepEqual(front(s).connections, [{ city1: 2, city2: 4, position: FRONTS.capturePercent * 10 }]);
    assert.deepEqual(front(s).sides.map((x) => x.frontAttack), [false, false]);
    // L'ancien front a disparu : ses divisions passent, sans délai, au front des mêmes joueurs le plus proche (05-Fronts §2.5).
    for (const d of s.divisions) assert.deepEqual([d.front, d.arrivalTick], [front(s).id, 0]);
  });

  it("une route que le perdant tient à 25 % ou moins n'est pas encerclée : pas de perte, pas d'événement d'encerclement", () => {
    // (3, 2) à 800 + 10 = 810 : le joueur 2 en tient 190 ≤ 250.
    const s = siege(996, 800);
    const { before, rng } = playRound(s);
    expectModel(s, before, [[{ id: 1, f: 50_000 }, { id: 2, f: 1000 }]], rng);
    assert.deepEqual(s.events.map((e) => e.type), ["city_captured"]);
    assert.equal(s.cities[1]!.player, 1);
  });

  it("la route de l'attaque ne compte pas : une seule route, aucune perte d'encerclement ; plus de front", () => {
    const s = createGame({ seed: 5, map: MAP, playerCount: 2 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
    war(s, 1);
    front(s).connections[0]!.position = 996;
    put(s, 1, "regulars", front(s).id);
    put(s, 2, "tankette", front(s).id);
    const { before, rng } = playRound(s);
    // Front d'une liaison : la chenillette n'est engagée qu'à 1 000 / 2 000, donc 1 250 points anti-infanterie : f = 25 000.
    expectModel(s, before, [[{ id: 1, f: 25_000 }, { id: 2, f: 1000 }]], rng);
    assert.equal(s.cities[1]!.player, 1);
    assert.deepEqual(s.events.map((e) => e.type), ["city_captured", "player_eliminated"]);
    assert.equal(s.fronts.length, 0, "plus de connexion entre les joueurs");
    assert.equal(s.players[1]!.cityIds.length, 0);
    assert.equal(s.players[1]!.capital, 0);
  });

  it("une route de la ville prise vers un troisième joueur devient une connexion du preneur, au milieu et pas à la position de l'ancien front", () => {
    // Joueurs 1 (ville A), 2 (ville X) et 3 (ville C) ; routes A–X et X–C. Le joueur 1 prend X ; X–C, qui était une
    // connexion 2–3 à 700, devient 1–3 : la clé des anciennes connexions comprend les joueurs (05-Fronts §13.6),
    // la position de l'ancien front n'est pas reprise, la nouvelle est 500 (provisoire, §10.1).
    const s = createGame({ seed: 5, map: MAP, playerCount: 3 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)), found(3, at(14, 10)));
    assert.deepEqual(s.fronts.map((f) => f.players), [[1, 2], [2, 3]]);
    turn(s, { type: "declare_war", player: 1, target: 2 }, { type: "declare_war", player: 1, target: 3 }, { type: "declare_war", player: 2, target: 3 });
    const [attacked, other] = s.fronts;
    attacked!.connections[0]!.position = 996;
    other!.connections[0]!.position = 700;
    turn(s, { type: "start_front_attack", player: 1, front: attacked!.id });
    put(s, 1, "regulars", attacked!.id);
    put(s, 2, "tankette", attacked!.id);
    playRound(s);
    assert.equal(s.cities[1]!.player, 1);
    assert.deepEqual(s.fronts.map((f) => [f.players, f.connections]), [[[1, 3], [{ city1: 2, city2: 3, position: MIDDLE }]]]);
  });
});
