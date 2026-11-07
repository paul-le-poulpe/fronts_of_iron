// Combat des fronts (Docs/Design/05-Fronts.md §6, §7, §10 ; 06-Combat-Simplifie.md §1 ; 08-Population.md §5, §13) : barre de
// vie, combat résolu en un tour, partage entre les lignes, pertes de l'appui-feu, fuite, renforts, repli, avancée, prise
// d'une ville, encerclement.
//
// Les pertes du premier round sont calculées à la main dans chaque test d'après les formules du §6, avec les valeurs de
// `config/divisions.ts`. Une fraction `f` sur 10⁶ de la division fait perdre `f / 100` d'état, arrondi vers le bas.
// Rappels : une infanterie pleine d'une liaison tire 1 500 points anti-infanterie et 100 antiblindés (attaquante : × 0,5) ;
// elle a 50 000 PV (défendant : × 2).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureCity,
  frontAdvance,
  FRONTS,
  isFleeing,
  LINE_FIRST,
  LINE_SECOND,
  MIDDLE,
  STATE_SCALE,
  stateOf,
  type CombatRecord,
  type GameState,
} from "../src/index.ts";
import { applyLoss } from "../src/divisions.ts";
import { applyFlight, applySwaps } from "../src/placement.ts";
import { at, attack, divisionsOf, duel, found, front, game, hitsOf, play, put, putMany, settle, turn, war, widen } from "./war-helpers.ts";

/** Attaque sur tout le front de `attackers` (le joueur 1 par défaut) : le rapport du dernier combat. */
const combat = (s: GameState, ...attackers: number[]): CombatRecord => {
  const r = attack(s, ...(attackers.length > 0 ? attackers : [1]));
  assert.ok(r !== undefined, "aucun rapport de combat");
  return r;
};

describe("pertes : la barre de vie (08 §13)", () => {
  const fresh = (): ReturnType<typeof put> => put(duel(), 1, "regulars");

  it("`state` perd f × STATE_SCALE / 10⁶, arrondi vers le bas, et renvoie l'état perdu", () => {
    const d = fresh();
    assert.equal(applyLoss(d, 100_000), 1000);
    assert.equal(d.state, 9000);
    assert.equal(applyLoss(d, 1599), 15);
    assert.equal(d.state, 8985);
    assert.equal(applyLoss(d, 99), 0, "moins d'un point d'état : rien");
    assert.equal(d.state, 8985);
  });

  it("la perte est bornée à ce que la division a ; une perte nulle ne change rien", () => {
    const d = fresh();
    d.state = 30;
    assert.equal(applyLoss(d, 0), 0);
    assert.equal(d.state, 30);
    assert.equal(applyLoss(d, 1_000_000), 30);
    assert.equal(d.state, 0);
    assert.equal(applyLoss(d, 1_000_000), 0);
  });

  it("le combat n'utilise pas le générateur aléatoire", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const rng = [...s.rng];
    assert.ok(combat(s).rounds.length > 0);
    assert.deepEqual([...s.rng], rng);
  });
});

describe("déroulement d'un combat (06-Combat-Simplifie §1)", () => {
  it("pas d'attaque lancée : aucun rapport, aucun dégât, aucun mouvement", () => {
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    play(s, 2 * FRONTS.attackCooldownTurns);
    assert.deepEqual(s.combats, []);
    assert.equal(s.divisions.find((d) => d.id === a)!.state, STATE_SCALE);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE]);
  });

  it("le combat est résolu dans le tour de l'ordre, et le camp ne peut en relancer un qu'attackCooldownTurns tours après", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const ordered = s.tick + 1;
    turn(s, { type: "start_front_attack", player: 1, front: front(s).id });
    assert.deepEqual(s.combats.map((c) => [c.kind, c.tick, c.attacker, c.defender]), [["front", ordered, 1, 2]]);
    assert.equal(front(s).sides[0]!.attackReadyAt, ordered + FRONTS.attackCooldownTurns);
    play(s, FRONTS.attackCooldownTurns - 2);
    turn(s, { type: "start_front_attack", player: 1, front: front(s).id });
    assert.equal(s.combats.length, 1);
    turn(s, { type: "start_front_attack", player: 1, front: front(s).id });
    assert.equal(front(s).sides[0]!.attackReadyAt, ordered + 2 * FRONTS.attackCooldownTurns, "la deuxième attaque est lancée à la fin du délai");
  });

  it("un attaquant sans infanterie engagée au lancement ne combat pas : aucun round, aucun rapport", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "tankette", 1);
    putMany(s, 2, "regulars", 1);
    assert.equal(attack(s, 1), undefined);
    assert.equal(s.divisions[1]!.state, STATE_SCALE);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE]);
  });

  it("au plus combatMaxRounds rounds, et les pertes du rapport sont la somme de ceux-ci", () => {
    const s = duel();
    widen(s, 3);
    war(s);
    putMany(s, 1, "elite", 3);
    putMany(s, 2, "elite", 3);
    const r = combat(s);
    assert.equal(r.rounds.length <= FRONTS.combatMaxRounds, true);
    const lost = [0, 0];
    for (const round of r.rounds) for (const [u, by] of round.hits) lost[r.units[u]!.owner - 1]! += by;
    assert.deepEqual(r.losses.map((l) => l.state), lost);
  });

  it("deux attaques dans le même tour : deux combats, le camp 0 d'abord, chacun avec son rapport", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    attack(s, 1, 2);
    assert.deepEqual(s.combats.map((c) => [c.attacker, c.defender]), [[1, 2], [2, 1]]);
  });
});

describe("un round (05-Fronts §6)", () => {
  it("une infanterie contre une infanterie : 75 d'état pour le défenseur, 300 pour l'attaquant", () => {
    // Le 1 attaque (× 0,5) : 750 points sur 100 000 PV (défense), f = 7 500. Riposte sans multiplicateur : 1 500 sur 50 000, f = 30 000.
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    const [b] = putMany(s, 2, "regulars", 1);
    const hits = hitsOf(combat(s));
    assert.deepEqual([hits.get(a!), hits.get(b!)], [300, 75]);
  });

  it("les attaques suivent la barre de vie : à 50 %, la riposte est de moitié", () => {
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    put(s, 2, "regulars", 1, 5000);
    assert.equal(hitsOf(combat(s)).get(a!), 150);
  });

  it("partage entre les lignes : au prorata de la largeur engagée, blindage compris", () => {
    // Front de 4 liaisons. Le joueur 1 attaque avec 4 infanteries (ids 1 à 4) ; le joueur 2 défend avec 4 infanteries
    // (5 à 8, engagées 4 000) et une chenillette (9, largeur 2 : engagée 2 000). Part de l'infanterie : 4 000 / 6 000.
    // - Le joueur 1 tire 3 000 anti-infanterie et 200 antiblindés. Une infanterie : 3 000 × 1 000 / 6 000 = 500 sur
    //   100 000 PV : f = 5 000, 50 d'état. La chenillette (blindage 100) : 200 × 2 000 / 6 000 = 66,66 sur 50 000 PV :
    //   f = 1 333, 13 d'état.
    // - Riposte : 4 × 1 500 + 2 500 = 8 500 anti-infanterie, toutes sur l'infanterie du joueur 1 : 2 125 sur 50 000 PV
    //   chacune : f = 42 500, 425 d'état.
    const s = duel();
    widen(s, 4);
    war(s);
    putMany(s, 1, "regulars", 4);
    putMany(s, 2, "regulars", 4);
    put(s, 2, "tankette", 1);
    assert.deepEqual([...hitsOf(combat(s))].sort((x, y) => x[0] - y[0]), [[1, 425], [2, 425], [3, 425], [4, 425], [5, 50], [6, 50], [7, 50], [8, 50], [9, 13]]);
  });

  it("l'appui-feu pleinement engagé prend les dégâts d'une liaison : autant qu'une infanterie d'un front plein (05-Fronts §6.3)", () => {
    // Front de 3 liaisons : 3 infanteries attaquent 3 infanteries (4 à 6) et une artillerie (7, largeur 3, engagée à 100 %).
    // 3 × 750 = 2 250 points. Une infanterie : 750 sur 100 000 PV, f = 7 500. L'artillerie (blindage 0, ×2 en défense) :
    // 2 250 × 100 % / 3 liaisons = 750 : f = 7 500. Riposte : 3 × 1 500 + 2 500 = 7 000 sur 3 infanteries : 2 333,3 sur
    // 50 000 PV : f = 46 666, 466 d'état.
    const s = duel();
    widen(s, 3);
    war(s);
    putMany(s, 1, "regulars", 3);
    putMany(s, 2, "regulars", 3);
    put(s, 2, "artillery", 1);
    assert.deepEqual([...hitsOf(combat(s))].sort((x, y) => x[0] - y[0]), [[1, 466], [2, 466], [3, 466], [4, 75], [5, 75], [6, 75], [7, 75]]);
  });

  it("l'appui-feu engagé en partie ne subit que cette part des dégâts, et ne tire que cette part", () => {
    // Front d'une liaison : l'artillerie du joueur 2 (id 3) n'est engagée qu'à 1 000 / 3 000. 750 points × 1/3 sur 100 000 PV :
    // f = 2 500, 25 d'état. Riposte : 1 500 + 2 500 / 3 = 2 333,3 sur 50 000 PV : f = 46 666, 466 d'état.
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    put(s, 2, "artillery", 1);
    assert.deepEqual([...hitsOf(combat(s))].sort((x, y) => x[0] - y[0]), [[1, 466], [2, 75], [3, 25]]);
  });

  it("chenillette engagée à 50 %, canon anti-char engagé à 1/3 : attaques et dégâts au prorata", () => {
    // Le joueur 1 : infanterie (id 1) et canon (id 2, 1 000 / 3 000, × 0,2) : 750 anti-infanterie ; antiblindé 50 + 5 000 / 3
    // × 0,2 = 383,3. Le joueur 2 : infanterie (id 3) et chenillette (id 4, 1 000 / 2 000), 2 000 engagés en tout.
    // - Infanterie du 2 : 750 / 2 = 375 sur 100 000 PV : f = 3 750, 37 d'état. Chenillette : 383,3 / 2 = 191,6 sur 50 000 PV
    //   (pas de bonus de défense) : f = 3 833, 38 d'état.
    // - Riposte : 1 500 + 2 500 / 2 = 2 750 anti-infanterie. Infanterie du 1, seule de sa niche principale : f = 55 000, 550
    //   d'état. Canon (blindage 0) : 2 750 / 3 = 916,6 sur 50 000 PV : f = 18 333, 183 d'état.
    const s = duel();
    war(s);
    put(s, 1, "regulars", 1);
    put(s, 1, "antiTank", 1);
    put(s, 2, "regulars", 1);
    put(s, 2, "tankette", 1);
    assert.deepEqual([...hitsOf(combat(s))].sort((x, y) => x[0] - y[0]), [[1, 550], [2, 183], [3, 37], [4, 38]]);
  });

  it("une division à 0 d'état est détruite : elle disparaît, et le rapport la compte", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    const dead = put(s, 2, "regulars", 1, 50);
    const r = combat(s);
    assert.deepEqual(divisionsOf(r, r.rounds[0]!.destroyed), [dead.id]);
    assert.equal(r.losses[1].divisions, 1);
    assert.equal(s.divisions.some((d) => d.id === dead.id), false);
  });
});

describe("seuils exacts de fuite et d'échange (05-Fronts §5.3, §5.4)", () => {
  const firstLine = (s: GameState, state: number): ReturnType<typeof put> => {
    const d = put(s, 1, "regulars", front(s).id, state);
    d.line = LINE_FIRST;
    d.engaged = 1000;
    return d;
  };

  it("à exactement 25 % la division fuit, un point au-dessus elle reste", () => {
    const s = duel();
    const at25 = firstLine(s, 2500);
    const above = firstLine(s, 2501);
    applyFlight(s, front(s));
    assert.deepEqual([at25.line, at25.engaged, above.line], [LINE_SECOND, 0, LINE_FIRST]);
    assert.equal(at25.fleeUntilTick, s.tick + 1 + FRONTS.fleeRounds * FRONTS.combatTurns);
    assert.equal(above.fleeUntilTick, 0);
  });

  it("hors combat, une division de seconde ligne du même rang et de meilleur état prend la place, même de peu", () => {
    const s = duel();
    const worn = firstLine(s, 9000);
    const spare = put(s, 1, "regulars", front(s).id, 9001);
    applySwaps(s, front(s));
    assert.deepEqual([worn.line, spare.line, spare.engaged], [LINE_SECOND, LINE_FIRST, 1000]);
  });

  it("un type moins bon de la niche ne remplace qu'à moins de swapStatePercent % : exactement la moitié, pas d'échange ; en dessous, échange", () => {
    const s = duel();
    const worn = firstLine(s, 5000);
    const militia = put(s, 1, "militia", front(s).id);
    applySwaps(s, front(s));
    assert.deepEqual([worn.line, militia.line], [LINE_FIRST, LINE_SECOND]);
    worn.state = 4999;
    applySwaps(s, front(s));
    assert.deepEqual([worn.line, militia.line, militia.engaged], [LINE_SECOND, LINE_FIRST, 1000]);
  });
});

describe("fuite, renforts et repli pendant un combat (05-Fronts §5.4, 06-Combat-Simplifie §1)", () => {
  it("fuite : sous 25 %, la division repasse en seconde ligne pour fleeRounds rounds ; elle ne revient pas avant", () => {
    // La division du joueur 1 est à 25,50 % : elle perd 75 d'état et tombe à 24,75 %.
    const s = duel();
    war(s);
    const weak = put(s, 1, "regulars", 1, 2550);
    weak.line = LINE_FIRST;
    weak.engaged = 1000;
    const strong = put(s, 2, "regulars", 1);
    const r = combat(s, 2);
    const roundTurn = s.tick;
    assert.deepEqual(divisionsOf(r, r.rounds[0]!.fled), [weak.id]);
    assert.deepEqual([weak.state, weak.line, weak.engaged, weak.fleeUntilTick], [2475, LINE_SECOND, 0, roundTurn + FRONTS.fleeRounds * FRONTS.combatTurns]);
    assert.equal(strong.line, LINE_FIRST);
    play(s, FRONTS.fleeRounds * FRONTS.combatTurns - 2);
    assert.ok(isFleeing(s, weak));
    assert.deepEqual([weak.line, weak.engaged], [LINE_SECOND, 0]);
  });

  it("renfort : la seconde ligne reprend la place, reste reinforceRounds rounds en retrait, puis combat", () => {
    // Le renfort est une milice à 50 % : ni meilleur type, ni plus de deux fois l'état, donc pas d'échange pendant le délai.
    const s = duel();
    war(s);
    const weak = put(s, 1, "regulars", 1, 2550);
    weak.line = LINE_FIRST;
    weak.engaged = 1000;
    const spare = put(s, 1, "militia", 1, 5000);
    put(s, 2, "regulars", 1);
    const r = combat(s, 2);
    assert.deepEqual(divisionsOf(r, r.rounds[0]!.arrived), [spare.id]);
    const joinedAt = 1 + FRONTS.reinforceRounds;
    assert.deepEqual(divisionsOf(r, r.rounds[joinedAt]!.joined), [spare.id]);
    // En retrait, elle ne combat pas : pas de dégâts, et l'attaquant avance à sa vitesse maximale.
    for (let k = 1; k < joinedAt; k++) assert.deepEqual([r.rounds[k]!.hits, r.rounds[k]!.advance], [[], FRONTS.footSpeedPermille], `round ${k}`);
    assert.ok(hitsOf(r, joinedAt).get(spare.id)! > 0, "au round où elle rejoint, elle combat");
  });

  it("pas d'échange pendant un combat : une division abîmée mais encore en ligne reste", () => {
    // 36 % contre 70 % : pas d'échange au lancement. Le round 2 fait passer l'infanterie à 34,5 %, sous la moitié de la milice.
    const s = duel();
    war(s);
    const worn = put(s, 1, "regulars", 1, 3600);
    worn.line = LINE_FIRST;
    worn.engaged = 1000;
    const spare = put(s, 1, "militia", 1, 7000);
    put(s, 2, "regulars", 1);
    const r = combat(s, 2);
    for (const k of [0, 1, 2, 3]) {
      assert.ok(hitsOf(r, k).has(worn.id), `round ${k}`);
      assert.equal(hitsOf(r, k).has(spare.id), false, "la seconde ligne n'a reçu aucun dégât");
    }
  });

  it("repli : sans infanterie en ligne ni en renfort, les autres divisions de première ligne se replient", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    // 750 points partagés avec la chenillette : 37 d'état, sous les 25 %.
    const weak = put(s, 2, "regulars", 1, 2510);
    const tank = put(s, 2, "tankette", 1);
    const r = combat(s);
    assert.deepEqual(r.rounds[0]!.withdrawn, [2]);
    assert.deepEqual(divisionsOf(r, r.rounds[0]!.fled).sort((x, y) => x - y), [weak.id, tank.id]);
    assert.deepEqual([tank.line, tank.engaged], [LINE_SECOND, 0]);
    assert.equal(tank.fleeUntilTick, s.tick + FRONTS.combatMaxRounds * FRONTS.combatTurns);
  });
});

describe("avancée (05-Fronts §7)", () => {
  it("seuils et vitesses de la configuration", () => {
    assert.deepEqual(
      [FRONTS.advanceThresholdA, FRONTS.advanceThresholdB, FRONTS.footSpeedPermille, FRONTS.motorizedSpeedPermille],
      [2, 10, 3, 10],
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

  it("sans défenseur, chaque round avance à vitesse maximale, sans dégâts, dans le sens de l'attaquant", () => {
    const by = FRONTS.combatMaxRounds * FRONTS.footSpeedPermille;
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([r.rounds.length, r.rounds[0]!.hits, r.success], [FRONTS.combatMaxRounds, [], true]);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE + by]);
    // Le joueur 2 attaque : la position diminue.
    const t = duel();
    war(t);
    putMany(t, 2, "regulars", 1);
    attack(t, 2);
    assert.deepEqual(front(t).connections.map((c) => c.position), [MIDDLE - by]);
  });

  it("une armée motorisée avance à sa vitesse, et une armée mixte entre les deux, au prorata de la largeur engagée", () => {
    const speed = (motorized: boolean): number => {
      const s = duel();
      widen(s, 2);
      war(s);
      putMany(s, 1, "regulars", 2);
      if (motorized) put(s, 1, "cruiserTank", 1);
      return combat(s).rounds[0]!.advance;
    };
    assert.equal(speed(false), FRONTS.footSpeedPermille);
    // 2 000 d'infanterie à pied, 2 000 de chars motorisés : 3 + 7 × 1/2 = 6,5, arrondi vers le bas.
    assert.equal(speed(true), 6);
  });

  it("rapport d'infanterie : 6 contre 1 → 2 millièmes sur toutes les routes du front ; 2 contre 1 → rien", () => {
    const first = (n: number): { advance: number; positions: number[] } => {
      const s = duel();
      widen(s, n);
      war(s);
      putMany(s, 1, "regulars", n);
      putMany(s, 2, "regulars", 1);
      const r = combat(s);
      return { advance: r.rounds[0]!.advance, positions: front(s).connections.map((c) => c.position) };
    };
    const six = first(6);
    assert.equal(six.advance, 2);
    assert.equal(new Set(six.positions).size, 1, "la même sur toutes les routes");
    assert.equal(first(2).advance, 0);
  });
});

describe("prise d'une ville et encerclement (05-Fronts §10)", () => {
  /**
   * Quatre villes : 1 et 3 au joueur 1, 2 (la ville X) et 4 au joueur 2. Le front a deux connexions, (1, 2) et (3, 2) ;
   * la route (2, 4) est interne au joueur 2. Le joueur 2 tient la ligne avec une chenillette (id 1, 2 000 sur 2 000) et
   * une infanterie à moitié engagée dans sa ligne. La route (1, 2) est à `via`, l'autre (3, 2) à `other`.
   */
  function siege(via: number, other: number): GameState {
    const s = game(2);
    s.players.forEach((p) => (p.population = 1000));
    settle(s, [1, at(8, 10)], [2, at(11, 10)], [1, at(9.5, 12.6)], [2, at(14, 10)]);
    assert.equal(s.fronts.length, 1);
    assert.deepEqual(front(s).connections.map((c) => [c.city1, c.city2]), [[1, 2], [3, 2]]);
    assert.ok(s.roads.some(([a, b]) => a === 2 && b === 4), "la route interne (2, 4)");
    war(s);
    front(s).connections[0]!.position = via;
    front(s).connections[1]!.position = other;
    put(s, 2, "tankette", front(s).id);
    turn(s);
    return s;
  }
  const capture = (s: GameState): void => captureCity(s, 1, 2, 2, { city1: 1, city2: 2 }, []);

  it("la ville change de main avec ses cases ; l'autre route, tenue à plus de 25 %, est encerclée", () => {
    const s = siege(999, 510);
    const tank = s.divisions[0]!;
    assert.equal(tank.engaged, 2000);
    capture(s);

    // Sur (3, 2), le joueur 2 tient 1 000 − 510 = 490 millièmes depuis X, plus de 250 ; f = 1 route × 50 % / 2 connexions
    // = 25 %, sur une chenillette engagée à 2 000 / 2 000 : 2 500 d'état.
    assert.equal(stateOf(tank), 7500);
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
    // L'ancien front a disparu : ses divisions passent, sans délai, au front des mêmes joueurs le plus proche (05-Fronts §2.5).
    for (const d of s.divisions) assert.deepEqual([d.front, d.arrivalTick], [front(s).id, 0]);
  });

  it("une route que le perdant tient à 25 % ou moins n'est pas encerclée : pas de perte, pas d'événement d'encerclement", () => {
    // (3, 2) à 750 : le joueur 2 en tient exactement 250.
    const s = siege(999, 750);
    capture(s);
    assert.deepEqual(s.events.map((e) => e.type), ["city_captured"]);
    assert.equal(s.divisions[0]!.state, STATE_SCALE);
    assert.equal(s.cities[1]!.player, 1);
  });

  it("le combat prend la ville : la route de l'attaque ne compte pas pour l'encerclement ; dernière ville : joueur éliminé, plus de front", () => {
    const s = duel();
    war(s);
    front(s).connections[0]!.position = 994;
    putMany(s, 1, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([r.rounds.length, r.captured, r.success], [2, 2, true], "994 + 3 + 3 : la ville tombe au deuxième round");
    assert.equal(s.cities[1]!.player, 1);
    assert.deepEqual(s.events.map((e) => e.type), ["city_captured", "player_eliminated"]);
    assert.equal(s.fronts.length, 0, "plus de connexion entre les joueurs");
    assert.equal(s.players[1]!.cityIds.length, 0);
    assert.equal(s.players[1]!.capital, 0);
    assert.equal(s.players[1]!.defeated, true);
  });

  it("une route de la ville prise vers un troisième joueur devient une connexion du preneur, au milieu et pas à la position de l'ancien front", () => {
    // Joueurs 1 (ville A), 2 (ville X) et 3 (ville C) ; routes A–X et X–C. Le joueur 1 prend X ; X–C, qui était une
    // connexion 2–3 à 700, devient 1–3 : la clé des anciennes connexions comprend les joueurs (05-Fronts §13.6),
    // la position de l'ancien front n'est pas reprise, la nouvelle est 500 (provisoire, §10.1).
    const s = game(3);
    settle(s, [1, at(8, 10)], [2, at(11, 10)], [3, at(14, 10)]);
    assert.deepEqual(s.fronts.map((f) => f.players), [[1, 2], [2, 3]]);
    turn(s, { type: "declare_war", player: 1, target: 2 }, { type: "declare_war", player: 1, target: 3 }, { type: "declare_war", player: 2, target: 3 });
    const [attacked, other] = s.fronts;
    attacked!.connections[0]!.position = 996;
    other!.connections[0]!.position = 700;
    put(s, 1, "regulars", attacked!.id);
    combat(s);
    assert.equal(s.cities[1]!.player, 1);
    assert.deepEqual(s.fronts.map((f) => [f.players, f.connections]), [[[1, 3], [{ city1: 2, city2: 3, position: MIDDLE }]]]);
  });
});

describe("ordre `found` dans une partie non gelée", () => {
  it("les villes passent aussi par l'ordre : un duel joué par found_city a le même front", () => {
    const s = game(2, false);
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
    assert.deepEqual(front(s).connections.map((c) => [c.city1, c.city2]), [[1, 2]]);
  });
});
