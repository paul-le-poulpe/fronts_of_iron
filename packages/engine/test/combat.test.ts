// Combat des fronts (Docs/Design/05-Fronts.md §6, §7, §10 ; 06-Combat-Simplifie.md §1 ; 08-Population.md §5, §13) : barre de
// vie, combat résolu en un tour, partage entre les lignes, pertes de l'appui-feu, fuite, renforts, repli, avancée, prise
// d'une ville, encerclement.
//
// Les pertes du premier cycle sont calculées à la main dans chaque test d'après les formules du §6, avec les valeurs de
// `config/divisions.ts`. Une fraction `f` sur 10⁶ de la division fait perdre `f / 100` d'état, arrondi vers le bas.
// Rappels : une infanterie pleine d'une liaison tire 1 500 points anti-infanterie et 100 antiblindés (attaquante : × 0,5) ;
// elle a 50 000 PV (défendant : × 2). Un combat dure au plus `combatCycles` cycles de 5 phases ; un tir (une niche d'un camp,
// 10-Combat-Phases §1) inflige `roundsPerCycle` fois les dégâts d'un ancien round, soit pour une infanterie pleine : 3 000
// d'état sur l'infanterie qui attaque et 750 sur celle qui défend, au premier cycle. Les attaques de chaque division sont
// figées au début du cycle : une division tuée ou en fuite pendant le cycle tire quand même, avec son état d'avant, mais ne
// reçoit plus de pertes ; elle ne quitte la ligne qu'en fin de cycle. Les cycles suivants repartent de l'état laissé par le
// précédent. Dans le rapport, un cycle a ses tirs dans l'ordre (`hitsOf(r, cycle, tir)` : pertes par division ; `hitList` :
// dans l'ordre où elles sont prises).

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
  NICHE_IDS,
  STATE_SCALE,
  stateOf,
  type CombatRecord,
  type GameState,
} from "../src/index.ts";
import { applyLoss } from "../src/divisions.ts";
import { applyFlight, applySwaps } from "../src/placement.ts";
import { at, attack, divisionsOf, duel, found, front, game, hitList, hitsOf, play, put, putMany, settle, shotsOf, turn, war, widen } from "./war-helpers.ts";

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

  it("sans égalité d'état dans un type de division, le combat n'utilise pas le générateur aléatoire", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const rng = [...s.rng];
    assert.ok(combat(s).cycles.length > 0);
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

  it("un attaquant sans infanterie engagée au lancement ne combat pas : aucun cycle, aucun rapport", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "tankette", 1);
    putMany(s, 2, "regulars", 1);
    assert.equal(attack(s, 1), undefined);
    assert.equal(s.divisions[1]!.state, STATE_SCALE);
    assert.deepEqual(front(s).connections.map((c) => c.position), [MIDDLE]);
  });

  it("au plus combatCycles cycles, et les pertes du rapport sont la somme de leurs tirs", () => {
    const s = duel();
    widen(s, 3);
    war(s);
    putMany(s, 1, "elite", 3);
    putMany(s, 2, "elite", 3);
    const r = combat(s);
    assert.equal(r.cycles.length <= FRONTS.combatCycles, true);
    const lost = [0, 0];
    for (const cycle of r.cycles) for (const shot of cycle.shots) for (const [u, by] of shot.hits) lost[r.units[u]!.owner - 1]! += by;
    assert.deepEqual(r.losses.map((l) => l.state), lost);
  });

  it("combatCycles cycles de roundsPerCycle rounds remplacent les 50 rounds d'avant", () => {
    assert.equal(FRONTS.combatCycles * FRONTS.roundsPerCycle, 50);
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

describe("un tir (05-Fronts §6, 10-Combat-Phases §1)", () => {
  it("une infanterie contre une infanterie : le défenseur tire d'abord (3 000), puis l'attaquant, à pleine force (750)", () => {
    // Défenseur d'abord, sans multiplicateur : 1 500 points sur 50 000 PV, f = 30 000, × 10 = 300 000 : 3 000 d'état. L'attaquant
    // (× 0,5) tire avec l'état d'avant le cycle : 750 points sur 100 000 PV (défense), f = 7 500, × 10 : 750 d'état.
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    const [b] = putMany(s, 2, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([r.cycles[0]!.shots.map((x) => x.owner), hitsOf(r, 0, 0).get(a!), hitsOf(r, 0, 1).get(b!)], [[2, 1], FRONTS.roundsPerCycle * 300, FRONTS.roundsPerCycle * 75]);
  });

  it("les attaques suivent la barre de vie au début du cycle : à 50 %, la riposte est de moitié", () => {
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    put(s, 2, "regulars", 1, 5000);
    assert.equal(hitsOf(combat(s)).get(a!), 1500);
  });

  it("partage entre les lignes : au prorata de la largeur engagée, blindage compris", () => {
    // Front de 4 liaisons. Le joueur 1 attaque avec 4 infanteries (ids 1 à 4) ; le joueur 2 défend avec 4 infanteries
    // (5 à 8, engagées 4 000) et une chenillette (9, largeur 2 : engagée 2 000). Part de l'infanterie : 4 000 / 6 000.
    // Trois tirs : la chenillette (phase des chars), l'infanterie du 2, puis celle du 1.
    // - Chenillette : 2 500 points anti-infanterie sur 50 000 PV, × 10 : 5 000 d'état sur une infanterie du 1 (égalité tirée).
    // - Infanterie du 2 : 6 000 points × 10 sur 50 000 PV : 12 000. Sur la plus abîmée (5 000 restants : tuée), puis 7 000 sur une
    //   autre.
    // - Les 4 infanteries du 1 tirent (la tuée aussi) : 3 000 points anti-infanterie et 200 antiblindés. Une infanterie du 2 :
    //   3 000 × 1 000 / 6 000 = 500 sur 100 000 PV, f = 5 000, × 10 : 500 ; les quatre : 2 000 d'état, tous sur une seule.
    //   La chenillette (blindage 100) : 200 × 2 000 / 6 000 = 66,6 sur 50 000 PV, f = 1 333, × 10 : 133 d'état.
    const s = duel();
    widen(s, 4);
    war(s);
    putMany(s, 1, "regulars", 4);
    putMany(s, 2, "regulars", 4);
    const tank = put(s, 2, "tankette", 1);
    const r = combat(s);
    assert.deepEqual(r.cycles[0]!.shots.map((x) => [x.owner, NICHE_IDS[x.niche]]), [[2, "tanks"], [2, "infantry"], [1, "infantry"]]);
    assert.deepEqual(hitList(r, 0, 0).map(([, lost]) => lost), [5000]);
    const second = hitList(r, 0, 1);
    assert.deepEqual([second.map(([, lost]) => lost), second[0]![0] === hitList(r, 0, 0)[0]![0]], [[5000, 7000], true]);
    assert.deepEqual(divisionsOf(r, r.cycles[0]!.shots[1]!.destroyed), [second[0]![0]]);
    assert.equal(r.cycles[0]!.shots[2]!.shooters.length, 4, "les quatre tirent, la tuée comprise");
    const last = hitList(r, 0, 2);
    assert.deepEqual([last.length, last[0]![1], last[1]![0], last[1]![1]], [2, 2000, tank.id, 133]);
  });

  it("l'appui-feu pleinement engagé prend les dégâts d'une liaison : autant qu'une infanterie d'un front plein (05-Fronts §6.3)", () => {
    // Front de 3 liaisons : 3 infanteries (1 à 3) attaquent 3 infanteries (4 à 6) et une artillerie (7, largeur 3, engagée à
    // 100 %). L'infanterie du 2 tire d'abord : 4 500 × 10 / 50 000 : 9 000 d'état, qui tuent... pas une division (10 000) :
    // 7 500 pour une infanterie du 1 jusqu'à 25 % (elle fuit) et 1 500 pour une autre. Les 3 du 1 tirent : 2 250 points ; une
    // infanterie du 2 en reçoit 750 sur 100 000 PV, f = 7 500, × 10 : 750 ; les trois, 2 250 d'état, sur une seule.
    // L'artillerie (blindage 0, × 2 en défense) : 2 250 × 100 % / 3 liaisons = 750 : elle perd aussi 750.
    const s = duel();
    widen(s, 3);
    war(s);
    putMany(s, 1, "regulars", 3);
    putMany(s, 2, "regulars", 3);
    put(s, 2, "artillery", 1);
    const r = combat(s);
    assert.deepEqual(r.cycles[0]!.shots.map((x) => [x.owner, NICHE_IDS[x.niche]]), [[2, "infantry"], [1, "infantry"], [2, "artillery"]]);
    assert.deepEqual(hitList(r, 0, 0).map(([, lost]) => lost), [7500, 1500]);
    const theirs = hitsOf(r, 0, 1);
    assert.deepEqual([theirs.get(7), [4, 5, 6].reduce((t, id) => t + (theirs.get(id) ?? 0), 0)], [750, 2250]);
    assert.deepEqual(divisionsOf(r, r.cycles[0]!.shots[2]!.shooters), [7]);
  });

  it("l'appui-feu engagé en partie ne subit que cette part des dégâts, et ne tire que cette part", () => {
    // Front d'une liaison : l'artillerie du joueur 2 (id 3) n'est engagée qu'à 1 000 / 3 000. L'infanterie du 2 (id 2) tire
    // d'abord : 3 000. L'infanterie du 1 : 750 sur l'infanterie, 750 / 3 = 250 sur l'artillerie. L'artillerie tire un tiers de
    // ses 2 500 points : 833 × 10 / 50 000 : 1 666 d'état sur l'infanterie du 1.
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    put(s, 2, "artillery", 1);
    const r = combat(s);
    assert.deepEqual([hitsOf(r, 0, 0).get(1), hitsOf(r, 0, 1).get(2), hitsOf(r, 0, 1).get(3), hitsOf(r, 0, 2).get(1)], [3000, 750, 250, 1666]);
  });

  it("chenillette engagée à 50 %, canon anti-char engagé à 1/3 : attaques et dégâts au prorata", () => {
    // Le joueur 1 : infanterie (id 1) et canon (id 2, 1 000 / 3 000). Le joueur 2 : infanterie (id 3) et chenillette (id 4,
    // 1 000 / 2 000), 2 000 engagés en tout. Quatre tirs : chenillette, infanterie du 2, infanterie du 1, canon du 1.
    // - Chenillette : 1 250 points sur 50 000 PV, × 10 : 2 500 d'état sur l'infanterie du 1 ; le canon (appui-feu, engagé à 1/3)
    //   en reçoit le tiers : 833.
    // - Infanterie du 2 : 3 000 sur l'infanterie, le tiers de sa part sur le canon : 1 000.
    // - Infanterie du 1 (attaque figée) : 750 points, moitié pour chaque cible ; sur 100 000 PV : 375 d'état pour l'infanterie du
    //   2 ; 50 pour la chenillette (blindage 100 : 25 antiblindés sur 50 000 PV).
    // - Canon du 1 : 333 sur la chenillette.
    const s = duel();
    war(s);
    put(s, 1, "regulars", 1);
    put(s, 1, "antiTank", 1);
    put(s, 2, "regulars", 1);
    put(s, 2, "tankette", 1);
    const r = combat(s);
    assert.deepEqual(r.cycles[0]!.shots.map((x) => [x.owner, NICHE_IDS[x.niche]]), [[2, "tanks"], [2, "infantry"], [1, "infantry"], [1, "antiTank"]]);
    assert.deepEqual(hitList(r, 0, 0), [[1, 2500], [2, 833]]);
    assert.deepEqual(hitList(r, 0, 1), [[1, 3000], [2, 1000]]);
    assert.deepEqual(hitList(r, 0, 2), [[3, 375], [4, 50]]);
    assert.deepEqual(hitList(r, 0, 3), [[4, 333]]);
  });

  it("une division que le tir amène à 0 d'état est détruite : elle disparaît en fin de cycle, et le rapport la compte", () => {
    // Une infanterie à 7 % : le tir de l'attaquant (750) la tue.
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    const dead = put(s, 2, "regulars", 1, 700);
    const r = combat(s);
    const shot = r.cycles[0]!.shots[1]!;
    assert.deepEqual([shot.owner, divisionsOf(r, shot.destroyed), divisionsOf(r, shot.fled)], [1, [dead.id], []]);
    assert.equal(r.losses[1].divisions, 1);
    assert.equal(s.divisions.some((d) => d.id === dead.id), false);
  });
});

describe("enchaînement des cycles (10-Combat-Phases §1)", () => {
  it("un cycle lit l'état laissé par le précédent : les attaques du cycle 1 sont celles des divisions entamées", () => {
    // Cycle 0 : le défenseur fait perdre 3 000 à l'attaquant (7 000), l'attaquant 750 au défenseur (9 250). Cycle 1 : le
    // défenseur tire à 92,5 % (1 500 × 0,925 × 10 / 50 000 : 2 775), l'attaquant à 70 % (525).
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    const [b] = putMany(s, 2, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([hitsOf(r, 0, 0).get(a!), hitsOf(r, 0, 1).get(b!), hitsOf(r, 1, 0).get(a!), hitsOf(r, 1, 1).get(b!)], [3000, 750, 2775, 525]);
  });

  it("le combat s'arrête en fin de cycle quand l'attaquant n'a plus d'infanterie en ligne : moins de combatCycles cycles", () => {
    // L'infanterie de l'attaquant tombe à 25 % au deuxième cycle et fuit : pas de troisième cycle de combat avec elle.
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    putMany(s, 2, "regulars", 1);
    const r = combat(s);
    const mine = s.divisions.find((d) => d.id === a)!;
    assert.ok(r.cycles.length < FRONTS.combatCycles, `${r.cycles.length} cycles`);
    assert.deepEqual([mine.state, mine.line], [2500, LINE_SECOND]);
    const last = r.cycles.at(-1)!;
    assert.ok(last.shots.some((x) => divisionsOf(r, x.fled).includes(a!)), "elle a fui pendant le dernier cycle");
  });

  it("un renfort monté au rangement de fin de cycle tire au cycle suivant, et pas dans le cycle de son arrivée", () => {
    // Front de 6 liaisons : 6 infanteries contre 10, dont 4 en seconde ligne. Les divisions qui fuient ou meurent libèrent des
    // places, que la seconde ligne reprend en fin de cycle.
    const s = duel();
    widen(s, 6);
    war(s);
    putMany(s, 1, "regulars", 6);
    putMany(s, 2, "regulars", 10);
    const r = combat(s);
    const k = r.cycles.findIndex((c) => c.arrived.length > 0);
    assert.ok(k >= 0 && k < r.cycles.length - 1, "un renfort est arrivé avant le dernier cycle");
    const shooters = (c: number): number[] => r.cycles[c]!.shots.flatMap((x) => divisionsOf(r, x.shooters));
    for (const u of divisionsOf(r, r.cycles[k]!.arrived)) {
      assert.equal(shooters(k).includes(u), false, "il ne tire pas dans le cycle de son arrivée");
      assert.equal(shooters(k + 1).includes(u), true, "il tire au cycle suivant");
    }
  });

  it("au plus combatCycles cycles : sans défenseur, ils sont tous joués et chacun avance de roundsPerCycle fois la vitesse", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    const r = combat(s);
    assert.equal(r.cycles.length, FRONTS.combatCycles);
    assert.deepEqual(r.cycles.map((c) => c.advance), Array(FRONTS.combatCycles).fill(FRONTS.roundsPerCycle * FRONTS.footSpeedPermille));
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

describe("fuite, renforts et repli pendant un combat (05-Fronts §5.4, 06-Combat-Simplifie §1, 10-Combat-Phases §1)", () => {
  it("fuite : à 25 %, la division tire jusqu'à la fin du cycle, puis repasse en seconde ligne pour fleeRounds rounds", () => {
    // La division du joueur 1 est à 50 % ; elle perd de l'état à chaque cycle (750, 637, …) jusqu'à 25 % : elle fuit pendant un
    // cycle, tire jusqu'à sa fin, et n'est plus en ligne au cycle suivant.
    const s = duel();
    war(s);
    const weak = put(s, 1, "regulars", 1, 5000);
    weak.line = LINE_FIRST;
    weak.engaged = 1000;
    putMany(s, 2, "regulars", 1);
    const r = combat(s, 2);
    const roundTurn = s.tick;
    const k = r.cycles.findIndex((c) => c.shots.some((x) => divisionsOf(r, x.fled).includes(weak.id)));
    assert.ok(k >= 0);
    const shooters = (c: number): number[] => r.cycles[c]!.shots.flatMap((x) => divisionsOf(r, x.shooters));
    assert.equal(shooters(k).includes(weak.id), true, "elle tire pendant le cycle où elle fuit");
    if (k + 1 < r.cycles.length) assert.equal(shooters(k + 1).includes(weak.id), false, "et plus au cycle suivant");
    assert.deepEqual([weak.state, weak.line, weak.engaged, weak.fleeUntilTick], [2500, LINE_SECOND, 0, roundTurn + FRONTS.fleeRounds * FRONTS.combatTurns]);
    play(s, FRONTS.fleeRounds * FRONTS.combatTurns - 2);
    assert.ok(isFleeing(s, weak));
    assert.deepEqual([weak.line, weak.engaged], [LINE_SECOND, 0]);
  });

  it("renfort : quand la première ligne du type est sortie, le reste des pertes va à la seconde ligne, qui monte en première ligne", () => {
    // Le joueur 1 défend avec une infanterie à 25,5 % (id 1) et une milice à 50 % en seconde ligne (id 2). Le tir de
    // l'attaquant (750) amène la première à 25 % (50) ; le reste (700) va à la milice, qui monte : elle est dans `reinforced`
    // et dans `hits`, en première ligne. Elle n'a pas tiré au cycle 0 (elle n'était pas en ligne au début), elle tire au cycle 1.
    const s = duel();
    war(s);
    const weak = put(s, 1, "regulars", 1, 2550);
    weak.line = LINE_FIRST;
    weak.engaged = 1000;
    const spare = put(s, 1, "militia", 1, 5000);
    put(s, 2, "regulars", 1);
    const r = combat(s, 2);
    const shot = r.cycles[0]!.shots[1]!;
    assert.deepEqual([divisionsOf(r, shot.reinforced), hitList(r, 0, 1), divisionsOf(r, shot.fled)], [[spare.id], [[weak.id, 50], [spare.id, 700]], [weak.id]]);
    assert.equal(r.units.find((u) => u.division === spare.id)!.reserve, true);
    assert.equal(r.cycles[0]!.shots.some((x) => divisionsOf(r, x.shooters).includes(spare.id)), false, "elle ne tire pas au cycle 0");
    assert.equal(r.cycles[1]!.shots.some((x) => divisionsOf(r, x.shooters).includes(spare.id)), true, "elle tire au cycle 1");
    assert.deepEqual(r.cycles[0]!.arrived, [], "montée pendant le cycle : pas dans les arrivées du rangement");
  });

  it("renfort : la seconde ligne n'est prise qu'après la première ligne du type (pas d'échange pendant le combat)", () => {
    // 46 % contre une milice à 70 % : pas d'échange au lancement (la milice ne remplace qu'une infanterie à moins de la moitié
    // de son état). La seconde ligne ne reçoit aucune perte avant le tir où l'infanterie passe à 25 % et fuit.
    const s = duel();
    war(s);
    const worn = put(s, 1, "regulars", 1, 4600);
    worn.line = LINE_FIRST;
    worn.engaged = 1000;
    const spare = put(s, 1, "militia", 1, 7000);
    put(s, 2, "regulars", 1);
    const r = combat(s, 2);
    const shots = r.cycles.flatMap((c) => [...c.shots]);
    const flee = shots.findIndex((x) => divisionsOf(r, x.fled).includes(worn.id));
    assert.ok(flee >= 0);
    const firstSpareHit = shots.findIndex((x) => divisionsOf(r, x.hits.map(([u]) => u)).includes(spare.id));
    assert.ok(firstSpareHit >= flee, "la milice n'est touchée qu'à partir du tir où l'infanterie sort");
    if (firstSpareHit === flee) assert.deepEqual(divisionsOf(r, shots[flee]!.reinforced), [spare.id]);
    assert.ok(hitsOf(r, 0).get(worn.id)! > 0);
  });

  it("repli : sans infanterie en ligne ni en renfort, les autres divisions de première ligne se replient en fin de cycle", () => {
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    // Le tir de l'attaquant amène l'infanterie à 25 % (elle fuit) ; la chenillette, qui a tiré à la phase des chars, se replie
    // à la fin du cycle faute d'infanterie.
    const weak = put(s, 2, "regulars", 1, 2510);
    const tank = put(s, 2, "tankette", 1);
    const r = combat(s);
    assert.deepEqual(divisionsOf(r, r.cycles[0]!.shots[2]!.fled), [weak.id]);
    assert.deepEqual(r.cycles[0]!.withdrawn, [2]);
    assert.deepEqual(divisionsOf(r, r.cycles[0]!.fled), [tank.id]);
    assert.deepEqual([tank.line, tank.engaged], [LINE_SECOND, 0]);
    assert.equal(tank.fleeUntilTick, s.tick + FRONTS.combatCycles * FRONTS.roundsPerCycle * FRONTS.combatTurns);
  });
});

describe("phases et dégâts dans une niche (10-Combat-Phases §1, §2)", () => {
  const order = (r: CombatRecord, cycle = 0): [number, string][] => r.cycles[cycle]!.shots.map((x) => [x.owner, NICHE_IDS[x.niche]!]);

  it("ordre des tirs : chars, infanterie, antichar, antiaérien, artillerie, et dans chaque phase le défenseur avant l'attaquant", () => {
    const s = duel();
    widen(s, 5);
    war(s);
    for (const p of [1, 2]) for (const t of ["regulars", "mediumTank", "antiTank", "antiAir", "artillery"] as const) put(s, p, t, 1);
    const r = combat(s);
    const expected: [number, string][] = [];
    for (const n of ["tanks", "infantry", "antiTank", "antiAir", "artillery"]) expected.push([2, n], [1, n]);
    assert.deepEqual(order(r), expected);
  });

  it("attaques figées : une division en fuite pendant le cycle tire quand même à sa phase, et ne reçoit plus de pertes", () => {
    // Artillerie du 2 à 26 % : les chars de l'attaquant la font fuir (phase des chars) ; elle tire pourtant à la phase de
    // l'artillerie, avec l'état d'avant le cycle.
    const s = duel();
    widen(s, 5);
    war(s);
    putMany(s, 1, "regulars", 1);
    put(s, 1, "mediumTank", 1);
    put(s, 1, "artillery", 1);
    putMany(s, 2, "regulars", 1);
    const art = put(s, 2, "artillery", 1, 2600);
    const r = combat(s);
    const shots = r.cycles[0]!.shots;
    const tankShot = shots.find((x) => x.owner === 1 && NICHE_IDS[x.niche] === "tanks")!;
    assert.deepEqual(divisionsOf(r, tankShot.fled), [art.id]);
    const own = shots.find((x) => x.owner === 2 && NICHE_IDS[x.niche] === "artillery")!;
    assert.deepEqual(divisionsOf(r, own.shooters), [art.id]);
    assert.ok(own.hits.length > 0, "et ses coups portent");
    const later = shots.slice(shots.indexOf(tankShot) + 1).flatMap((x) => divisionsOf(r, x.hits.map(([u]) => u)));
    assert.equal(later.includes(art.id), false, "elle ne reçoit plus rien après sa sortie");
  });

  it("concentration : dans un type, tous les dégâts vont à la division la plus abîmée", () => {
    // Défenseur : deux infanteries à 90 % (id 3) et 60 % (id 4). Tir de l'attaquant : 2 × 750 points, soit 1 500 d'état : tous
    // sur la 4.
    const s = duel();
    widen(s, 2);
    war(s);
    putMany(s, 1, "regulars", 2);
    put(s, 2, "regulars", 1, 9000);
    const worn = put(s, 2, "regulars", 1, 6000);
    const r = combat(s);
    assert.deepEqual(hitList(r, 0, 1), [[worn.id, 1500]]);
  });

  it("fuite à 25 % : la division prend les dégâts jusqu'à 25 % et fuit, le reste passe à la suivante", () => {
    // Défenseur : infanteries à 90 % (id 3) et 26 % (id 4). Tir de l'attaquant : 1 500 ; la 4 ne meurt pas : elle prend 100
    // jusqu'à 25 % et fuit, les 1 400 qui restent vont à la 3.
    const s = duel();
    widen(s, 2);
    war(s);
    putMany(s, 1, "regulars", 2);
    const other = put(s, 2, "regulars", 1, 9000);
    const weak = put(s, 2, "regulars", 1, 2600);
    const r = combat(s);
    const shot = r.cycles[0]!.shots[1]!;
    assert.deepEqual(hitList(r, 0, 1), [[weak.id, 100], [other.id, 1400]]);
    assert.deepEqual([divisionsOf(r, shot.fled), divisionsOf(r, shot.destroyed)], [[weak.id], []]);
    assert.deepEqual([weak.state, weak.line], [2500, LINE_SECOND]);
  });

  it("une division n'est tuée que si les dégâts suffisent à l'amener à 0 ; elle fuit si ils suffisent à l'amener à 25 %", () => {
    // Une seule infanterie attaque une infanterie : son tir fait 750. À 7 % (700) la division est tuée ; à 27 % (2 700), 750
    // suffisent à l'amener à 25 % (200) : elle fuit et le reste est perdu ; à 38 % (3 800), 750 ne suffisent pas : elle les
    // prend et reste en ligne.
    const outcome = (state: number): { destroyed: number; fled: number; hits: [number, number][] } => {
      const s = duel();
      war(s);
      putMany(s, 1, "regulars", 1);
      put(s, 2, "regulars", 1, state);
      const r = combat(s);
      const shot = r.cycles[0]!.shots[1]!;
      return { destroyed: shot.destroyed.length, fled: shot.fled.length, hits: hitList(r, 0, 1) };
    };
    assert.deepEqual(outcome(700), { destroyed: 1, fled: 0, hits: [[2, 700]] });
    assert.deepEqual(outcome(2700), { destroyed: 0, fled: 1, hits: [[2, 200]] });
    assert.deepEqual(outcome(3800), { destroyed: 0, fled: 0, hits: [[2, 750]] });
  });

  it("mort avec reste : ce qui dépasse la division tuée passe à la suivante", () => {
    // Deux infanteries attaquent : 1 500. Défenseur à 7 % (id 4) et 90 % (id 3) : la 4 est tuée (700), la 3 prend 800.
    const s = duel();
    widen(s, 2);
    war(s);
    putMany(s, 1, "regulars", 2);
    const other = put(s, 2, "regulars", 1, 9000);
    const dead = put(s, 2, "regulars", 1, 700);
    const r = combat(s);
    assert.deepEqual(hitList(r, 0, 1), [[dead.id, 700], [other.id, 800]]);
    assert.deepEqual(divisionsOf(r, r.cycles[0]!.shots[1]!.destroyed), [dead.id]);
  });

  it("un tir inflige roundsPerCycle fois un ancien round (300 pour le défenseur d'une infanterie à pleine force)", () => {
    // À 26 % d'état, la défenseuse tire 26 % de 1 500 points : 300 × 26 % × roundsPerCycle (10) = 780, non plafonné.
    const s = duel();
    war(s);
    const [a] = putMany(s, 1, "regulars", 1);
    put(s, 2, "regulars", 1, 2600);
    assert.equal(hitsOf(combat(s), 0, 0).get(a!), (FRONTS.roundsPerCycle * 300 * 26) / 100);
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

  it("sans défenseur, chaque cycle avance de roundsPerCycle fois la vitesse maximale, sans dégâts, dans le sens de l'attaquant", () => {
    const by = FRONTS.combatCycles * FRONTS.roundsPerCycle * FRONTS.footSpeedPermille;
    const s = duel();
    war(s);
    putMany(s, 1, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([r.cycles.length, r.cycles[0]!.shots, r.success], [FRONTS.combatCycles, [], true]);
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
      return combat(s).cycles[0]!.advance / FRONTS.roundsPerCycle;
    };
    assert.equal(speed(false), FRONTS.footSpeedPermille);
    // 2 000 d'infanterie à pied, 2 000 de chars motorisés : 3 + 7 × 1/2 = 6,5, arrondi vers le bas.
    assert.equal(speed(true), 6);
  });

  it("l'avancée d'un cycle se calcule sur la première ligne de fin de cycle : 1 contre 1 → rien ; 4 contre 1 → 1 millième par round ; défenseur sorti → vitesse maximale", () => {
    const run = (attackers: number, defender?: number): { advance: number; positions: number[] } => {
      const s = duel();
      widen(s, 4);
      war(s);
      putMany(s, 1, "regulars", attackers);
      put(s, 2, "regulars", 1, defender);
      const r = combat(s);
      return { advance: r.cycles[0]!.advance, positions: front(s).connections.map((c) => c.position) };
    };
    assert.equal(run(1).advance, 0);
    // 4 000 d'infanterie contre 1 000, personne ne sort de la ligne au cycle 0 : frontAdvance(4000, 1000, 3) = 1 par round.
    const four = run(4);
    assert.equal(four.advance, FRONTS.roundsPerCycle * frontAdvance(4000, 1000, FRONTS.footSpeedPermille));
    // Défenseur à 26 % contre 4 infanteries : il fuit pendant le cycle, il n'est plus en ligne en fin de cycle.
    const out = run(4, 2600);
    assert.equal(out.advance, FRONTS.roundsPerCycle * FRONTS.footSpeedPermille);
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
    front(s).connections[0]!.position = 940;
    putMany(s, 1, "regulars", 1);
    const r = combat(s);
    assert.deepEqual([r.cycles.length, r.captured, r.success], [2, 2, true], "940 + 30 + 30 : la ville tombe au deuxième cycle");
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
