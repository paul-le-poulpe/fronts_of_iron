// Combat des fronts (Docs/Design/05-Fronts.md §6, §7, §10, §13.7) : dégâts et pertes, avancée de
// l'assaut, percée (saut, facteur de réaction, essoufflement, seconde ligne percée), prise de
// ville (positions 10 / 990, encerclement), paix.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  countSoldiers,
  createGame,
  damageOf,
  endOf,
  forceSpeed,
  FRONTS,
  frontAdvance,
  hitPointsOf,
  lossesFrom,
  motorization,
  reactionFactor100,
  roundDiv,
  UNIT_COUNT,
  type GameState,
} from "../src/index.ts";
import { at, duel, found, front, MAP, play, playToRound, turn, U } from "./war-helpers.ts";

const counts = (set: Record<string, number>): number[] => {
  const out = new Array<number>(UNIT_COUNT).fill(0);
  for (const [k, n] of Object.entries(set)) out[U[k as keyof typeof U]] = n;
  return out;
};
const order = (s: GameState, intent: Record<string, unknown>): boolean => applyIntent(s, intent as never, []);

describe("pertes d'un groupe (05-Fronts §6.1)", () => {
  it("antiblindé : unités perdues = arrondi(dégâts × n / PV totaux), au plus leur nombre", () => {
    // 10 chenillettes de 1 000 PV : 2 500 dégâts = 2,5 unités → 3 (0,5 vers le haut) ; 4 000 → 4 ; au-delà, tout le groupe.
    assert.equal(lossesFrom(counts({ tankette: 10 }), { soft: 0, hard: 2500 })[U.tankette], 3);
    assert.equal(lossesFrom(counts({ tankette: 10 }), { soft: 0, hard: 4000 })[U.tankette], 4);
    assert.equal(lossesFrom(counts({ tankette: 10 }), { soft: 0, hard: 99_999 })[U.tankette], 10);
    assert.equal(lossesFrom(counts({ tankette: 10 }), { soft: 0, hard: 400 })[U.tankette], 0, "moins d'une demi-unité : rien");
  });

  it("anti-infanterie sur l'infanterie ; les dégâts sans cible sont perdus", () => {
    // 100 infanteries de 500 PV : 5 000 dégâts = 10 unités.
    assert.equal(lossesFrom(counts({ infantry: 100 }), { soft: 5000, hard: 0 })[U.infantry], 10);
    assert.deepEqual(lossesFrom(counts({ infantry: 100 }), { soft: 0, hard: 5000 }), counts({}), "l'antiblindé ne touche pas l'infanterie");
    assert.deepEqual(lossesFrom(counts({ tankette: 10 }), { soft: 5000, hard: 0 }), counts({}), "l'anti-infanterie ne touche pas les blindés");
  });

  it("l'équipement perd le même pourcentage que l'infanterie, fois son multiplicateur de pertes", () => {
    // 10 % de l'infanterie perdue : 10 sur 100 → 10 mitrailleuses sur 100, 1 artillerie sur 10.
    const group = counts({ infantry: 100, machineGun: 100, artillery: 10 });
    const lost = lossesFrom(group, { soft: 5000, hard: 0 });
    assert.deepEqual([lost[U.infantry], lost[U.machineGun], lost[U.artillery]], [10, 10, 1]);
  });

  it("sans infanterie, l'équipement perd tout dès que le groupe reçoit des dégâts (choix provisoire)", () => {
    const lost = lossesFrom(counts({ machineGun: 7 }), { soft: 1, hard: 0 });
    assert.equal(lost[U.machineGun], 7);
    assert.equal(lossesFrom(counts({ machineGun: 7 }), { soft: 0, hard: 0 })[U.machineGun], 0);
  });

  it("dégâts d'un groupe : somme des attaques × multiplicateur du rôle, divisée une fois à la fin", () => {
    const group = counts({ infantry: 100, artillery: 4 });
    // base : 100 × 10 + 4 × 50 = 1 200 anti-infanterie, 100 × 1 + 4 × 5 = 120 antiblindé.
    assert.deepEqual(damageOf(group, "base"), { soft: 1200, hard: 120 });
    // attackMultiplier : infanterie 0,5 ; artillerie 1 → 100 × 10 × 0,5 + 4 × 50 = 700 ; 100 × 1 × 0,5 + 4 × 5 = 70.
    assert.deepEqual(damageOf(group, "attack"), { soft: 700, hard: 70 });
    // breakthroughMultiplier : infanterie 0,2 ; artillerie : celui de attackMultiplier (1).
    assert.deepEqual(damageOf(group, "breakthrough"), { soft: 400, hard: 40 });
    // counterAttackMultiplier : infanterie 0,7.
    assert.deepEqual(damageOf(group, "counter"), { soft: 900, hard: 90 });
    assert.equal(hitPointsOf(counts({ infantry: 3, tankette: 2, machineGun: 9 })), 3 * 500 + 2 * 1000);
  });
});

describe("avancée et vitesse (05-Fronts §7.1, §7.3)", () => {
  it("assaut : rien sous le seuil A, vitesse maximale au seuil B, entre les deux au prorata, arrondi au plus proche", () => {
    const v = FRONTS.footSpeedPermille;
    assert.equal(frontAdvance(0, 10, v), 0, "attaquant sans infanterie");
    assert.equal(frontAdvance(0, 0, v), 0);
    assert.equal(frontAdvance(5, 0, v), v, "défenseur sans infanterie : vitesse maximale");
    assert.equal(frontAdvance(20, 10, v), 0, "rapport 2 : pas d'avancée");
    assert.equal(frontAdvance(50, 10, v), v, "rapport 5 : vitesse maximale");
    assert.equal(frontAdvance(500, 10, v), v);
    assert.equal(frontAdvance(35, 10, v), 3, "déséquilibre 0,5 × 5 = 2,5 → 3");
    assert.equal(frontAdvance(22, 10, v), 0, "un rapport sous 2,3 n'avance pas à pied (arrondi à 0)");
    assert.equal(frontAdvance(23, 10, v), 1, "0,1 × 5 = 0,5 → 1");
    assert.equal(frontAdvance(35, 10, FRONTS.motorizedSpeedPermille), 8, "0,5 × 15 = 7,5 → 8");
  });

  it("facteur de réaction : 100 % → 1 ; moins de 50 % → X ; linéaire entre les deux", () => {
    assert.equal(reactionFactor100(100, 100), 100);
    assert.equal(reactionFactor100(75, 100), 200, "à 75 % : 2");
    assert.equal(reactionFactor100(50, 100), 300);
    assert.equal(reactionFactor100(49, 100), 300);
    assert.equal(reactionFactor100(0, 100), 300);
    assert.equal(reactionFactor100(0, 0), 300, "pas de force : réaction la plus lente");
  });

  it("motorisation : l'infanterie et les véhicules seulement ; à pied, vitesse à pied (tous à pied aujourd'hui)", () => {
    const force = counts({ infantry: 10, artillery: 3, tankette: 2 });
    assert.deepEqual(motorization(force, false), { motor: 0, total: 10 * 10 + 2 * 100 });
    assert.equal(forceSpeed(force, false), FRONTS.footSpeedPermille);
    assert.equal(roundDiv(5, 2), 3);
  });
});

/** Le front du duel à la guerre, avec des troupes posées à la main. */
function war(p1: Record<string, number>, p2: Record<string, number>, second1: Record<string, number> = {}, second2: Record<string, number> = {}): GameState {
  const s = duel();
  s.players.forEach((p) => (p.population = 1_000_000));
  turn(s, { type: "declare_war", player: 1, target: 2 });
  const f = front(s);
  const put = (side: number, line: "firstLine" | "secondLine", set: Record<string, number>): void => {
    for (const [k, n] of Object.entries(set)) f.sides[side]![line][U[k as keyof typeof U]] = n;
  };
  put(0, "firstLine", p1);
  put(1, "firstLine", p2);
  put(0, "secondLine", second1);
  put(1, "secondLine", second2);
  for (const p of s.players) p.soldiers = countSoldiers(s, p.id);
  return s;
}

describe("round d'une attaque sur tout le front (05-Fronts §6, §7.1)", () => {
  it("sans attaque, aucun dégât ; avec elle, les deux camps tirent, l'attaquant avance de la vitesse maximale", () => {
    const s = war({ infantry: 500 }, { infantry: 100 });
    playToRound(s);
    assert.deepEqual([front(s).sides[0]!.firstLine[U.infantry], front(s).sides[1]!.firstLine[U.infantry], front(s).connections[0]!.position], [500, 100, 500]);
    assert.ok(order(s, { type: "start_front_attack", player: 1, front: 1 }));
    playToRound(s);
    // Le défenseur tire sans multiplicateur : 100 × 10 = 1 000 → arrondi(1 000 × 500 / 250 000) = 2 pertes ;
    // l'attaquant, avec attackMultiplier : 500 × 10 × 0,5 = 2 500 → arrondi(2 500 × 100 / 50 000) = 5 pertes.
    assert.deepEqual([front(s).sides[0]!.firstLine[U.infantry], front(s).sides[1]!.firstLine[U.infantry]], [498, 95]);
    assert.equal(front(s).connections[0]!.position, 500 + FRONTS.footSpeedPermille);
    assert.equal(s.players[0]!.soldiers, countSoldiers(s, 1));
    assert.equal(s.players[1]!.soldiers, countSoldiers(s, 2));
  });

  it("deux attaques au même endroit : deux combats, et les avancées se retranchent", () => {
    const s = war({ infantry: 500 }, { infantry: 100 });
    order(s, { type: "start_front_attack", player: 1, front: 1 });
    order(s, { type: "start_front_attack", player: 2, front: 1 });
    playToRound(s);
    // Le joueur 1 avance de 5, le joueur 2 n'avance pas (rapport 0,2) : net +5.
    assert.equal(front(s).connections[0]!.position, 505);
    // Chaque camp est évalué comme attaquant et comme défenseur : le joueur 1 reçoit les dégâts de base ET d'attaque du joueur 2.
    const lossOne = 500 - front(s).sides[0]!.firstLine[U.infantry]!;
    assert.ok(lossOne > 2, `pertes du joueur 1 : ${lossOne}`);
  });

  it("l'assaut qui arrive au bout de la route prend la ville : propriétaire, zone, joueur sans ville", () => {
    const s = war({ infantry: 500 }, { infantry: 100 });
    s.players[1]!.armamentReserve.fill(0);
    order(s, { type: "start_front_attack", player: 1, front: 1 });
    let rounds = 0;
    let announced = false;
    while (s.cities[1]!.player === 2 && rounds < 200) {
      turn(s);
      if (s.events.some((e) => e.type === "city_captured")) announced = true;
      if (s.tick % FRONTS.combatTurns === 0) rounds++;
    }
    assert.ok(announced, "l'événement city_captured est émis");
    assert.equal(s.cities[1]!.player, 1, "la ville du joueur 2 est prise");
    assert.ok(rounds >= 100 && rounds <= 105, `${rounds} rounds : 500 millièmes à 5 par round`);
    assert.equal(s.players[1]!.cityIds.length, 0);
    assert.equal(s.players[1]!.capital, 0);
    assert.deepEqual(s.players[0]!.cityIds, [1, 2]);
    assert.equal(s.fronts.length, 0, "plus aucune connexion entre les deux joueurs");
    const zone = [...s.tileCity.keys()].filter((t) => s.tileCity[t] === 2);
    assert.ok(zone.length > 0 && zone.every((t) => s.owner[t] === 1));
    assert.equal(s.players[0]!.tileCount + s.players[1]!.tileCount, [...s.owner].filter((o) => o !== 0).length);
  });
});

/**
 * Siège : la ville X (au défenseur) est reliée à deux villes de l'attaquant, A1 et A2 (dans le même groupe), et à une autre
 * ville Y du défenseur. Le joueur 1 est l'attaquant si `attacker` vaut 1.
 */
function siege(attacker: 1 | 2): { s: GameState; X: number; A1: number; A2: number; Y: number } {
  const defender = attacker === 1 ? 2 : 1;
  const s = createGame({ seed: 5, map: MAP, playerCount: 2 });
  s.players.forEach((p) => (p.population = 1_000_000));
  turn(s, found(defender, at(14, 10)), found(attacker, at(11.4, 8.2)));
  turn(s, found(attacker, at(11.4, 11.8)), found(defender, at(17, 10)));
  assert.equal(s.cities.length, 4);
  const [X, A1, A2, Y] = [1, 2, 3, 4] as const;
  assert.deepEqual(s.fronts.map((f) => f.connections.length), [2], "A1–X et A2–X dans un front ; X–Y ne compte pas : même joueur");
  return { s, X, A1, A2, Y };
}

describe("prise d'une ville (05-Fronts §10)", () => {
  for (const attacker of [1, 2] as const) {
    it(`encerclement et nouvelle position 1 % côté ville prise (attaquant : joueur ${attacker})`, () => {
      const { s, X, A1, A2, Y } = siege(attacker);
      const defender = attacker === 1 ? 2 : 1;
      assert.ok(order(s, { type: "declare_war", player: attacker, target: defender }));
      const f = s.fronts.find((g) => g.connections.length === 2)!;
      const x = attacker === 1 ? 0 : 1;
      const at1 = f.connections.find((c) => (c.city1 === A1 || c.city2 === A1))!;
      const at2 = f.connections.find((c) => (c.city1 === A2 || c.city2 === A2))!;
      // Route de l'attaque : A2–X, à 1 millième du bout. Autre route : A1–X, tenue à 50 % par le défenseur (> 25 %).
      at2.position = endOf(x) + (x === 0 ? -1 : 1);
      at1.position = 500;
      f.sides[x]!.firstLine[U.infantry] = 500;
      f.sides[1 - x]!.firstLine[U.infantry] = 100;
      for (const p of s.players) p.soldiers = countSoldiers(s, p.id);
      // Une usine à détruire dans la ville prise.
      assert.ok(order(s, { type: "build_factory", player: defender, city: X, factoryType: "infantryArmament" }));
      assert.ok(order(s, { type: "start_front_attack", player: attacker, front: f.id }));
      s.players[defender - 1]!.armamentReserve.fill(0);
      playToRound(s);
      assert.equal(s.cities[X - 1]!.player, attacker, "la ville est prise");
      // Le round a coûté 5 infanteries au défenseur (100 → 95), puis l'encerclement : arrondi(95 × 1 route × 50 / (2 connexions
      // × 100)) = arrondi(23,75) = 24 pertes sur sa première ligne. L'ancien front n'a plus de connexion : ses 71 survivants
      // rendent leurs fusils à la réserve du défenseur sans délai.
      assert.equal(s.players[defender - 1]!.armamentReserve[0], 710);
      // Usine détruite, capitale du défenseur déplacée sur sa ville de plus petit identifiant, listes de villes à jour.
      assert.equal(s.players[defender - 1]!.factories.length, 0);
      assert.deepEqual(s.players[defender - 1]!.cityIds, [Y]);
      assert.equal(s.players[defender - 1]!.capital, Y);
      assert.deepEqual(s.players[attacker - 1]!.cityIds, [X, A1, A2]);
      assert.equal(s.players[defender - 1]!.tileCount + s.players[attacker - 1]!.tileCount, [...s.owner].filter((o) => o !== 0).length);
      // Les routes entre X et les villes de l'attaquant ne sont plus des connexions ; X–Y le devient, à 1 % côté X.
      assert.equal(s.fronts.length, 1);
      const c = s.fronts[0]!.connections;
      assert.equal(c.length, 1);
      assert.deepEqual([c[0]!.city1, c[0]!.city2].sort(), [X, Y]);
      const xIsFirst = c[0]!.city1 === X;
      assert.equal(c[0]!.position, xIsFirst ? FRONTS.capturePercent * 10 : 1000 - FRONTS.capturePercent * 10);
      assert.equal(xIsFirst, attacker === 1, "la ville du joueur 1 est city1 : 10 si c'est lui qui l'a prise, sinon 990");
      assert.equal(s.players[0]!.soldiers, countSoldiers(s, 1));
      assert.equal(s.players[1]!.soldiers, countSoldiers(s, 2));
    });
  }

  it("une route que le perdant tient sur moins d'un quart depuis la ville prise n'est pas encerclée", () => {
    const { s, A1, A2 } = siege(1);
    order(s, { type: "declare_war", player: 1, target: 2 });
    const f = s.fronts.find((g) => g.connections.length === 2)!;
    const near = f.connections.find((c) => c.city1 === A1)!;
    const via = f.connections.find((c) => c.city1 === A2)!;
    via.position = 999;
    near.position = 900; // X est city2 : tenue 100 / 1 000 depuis X, sous 25 %.
    f.sides[0]!.firstLine[U.infantry] = 500;
    f.sides[1]!.firstLine[U.infantry] = 100;
    for (const p of s.players) p.soldiers = countSoldiers(s, p.id);
    order(s, { type: "start_front_attack", player: 1, front: f.id });
    playToRound(s);
    assert.equal(s.cities[0]!.player, 1);
    assert.equal(s.players[1]!.armamentReserve[0], 950, "aucune perte d'encerclement : repli en bon ordre, les 95 unités du round rendent leurs fusils");
  });
});

describe("percée (05-Fronts §7.2)", () => {
  /** Duel à la guerre, motorisés seulement éteint, une percée sur la seule route. */
  function breakthrough(p2First: number, p2Second: number, p1Second = 2000): GameState {
    const s = war({ infantry: 10 }, { infantry: p2First }, { infantry: p1Second }, { infantry: p2Second });
    assert.ok(order(s, { type: "set_breakthrough_motorized_only", player: 1, front: 1, enabled: false }));
    assert.ok(order(s, { type: "start_breakthrough", player: 1, front: 1, city1: 1, city2: 2 }));
    return s;
  }

  it("la percée commence après le délai, avec la seconde ligne de l'attaquant et une tranche de la première ligne adverse", () => {
    const s = breakthrough(2000, 0);
    const bt = front(s).sides[0]!.breakthroughs[0]!;
    assert.equal(bt.phase, 0);
    playToRound(s);
    assert.equal(bt.phase, 0, "pas avant breakthroughDelayTurns tours");
    play(s, FRONTS.breakthroughDelayTurns);
    playToRound(s);
    assert.equal(bt.phase, 1);
    // 1 000 m de percée (une connexion) : au plus 100 infanteries de 10 m de chaque côté.
    assert.ok(bt.attackers[U.infantry]! > 80 && bt.attackers[U.infantry]! <= 100);
    assert.ok(bt.defenders1[U.infantry]! > 0 && bt.defenders1[U.infantry]! <= 100);
  });

  it("première ligne percée : saut de N × vitesse × facteur de réaction (seconde ligne à pied : × 3) ; puis phase 2", () => {
    // Tranche de 1 infanterie : éliminée au premier round. Seconde ligne adverse : 200 infanteries à pied.
    const s = breakthrough(1, 200);
    play(s, FRONTS.breakthroughDelayTurns + 10);
    while (front(s).sides[0]!.breakthroughs[0]!.phase === 0) playToRound(s);
    const bt = front(s).sides[0]!.breakthroughs[0]!;
    assert.equal(bt.phase, 2);
    // arrondi(10 × 5 × 300 / 100) = 150 millièmes.
    assert.equal(front(s).connections[0]!.position, 500 + 150);
    assert.ok(bt.defenders2[U.infantry]! > 0);
  });

  it("sans force de contre-attaque, la seconde ligne est percée d'emblée : la ville tombe", () => {
    const s = breakthrough(1, 0);
    for (let i = 0; i < 20 && s.cities[1]!.player === 2; i++) playToRound(s);
    assert.equal(s.cities[1]!.player, 1);
  });

  it("essoufflement : la percée s'arrête sous 35 % des PV de départ ; l'avancée gagnée reste", () => {
    // Une tranche de 500 infanteries contre 2 000 : l'attaquant s'use sans percer.
    const s = breakthrough(2000, 0, 500);
    for (let i = 0; i < 200 && front(s).sides[0]!.breakthroughs.length > 0; i++) playToRound(s);
    assert.equal(front(s).sides[0]!.breakthroughs.length, 0, "la percée est terminée");
    assert.equal(front(s).connections[0]!.position, 500, "aucune avancée : la première ligne n'a pas cédé");
    assert.ok(s.cities[1]!.player === 2);
  });

  it("le joueur peut annuler sa percée ; ses unités restent en seconde ligne", () => {
    const s = breakthrough(2000, 0);
    const id = front(s).sides[0]!.breakthroughs[0]!.id;
    assert.ok(order(s, { type: "cancel_breakthrough", player: 1, id }));
    assert.equal(front(s).sides[0]!.breakthroughs.length, 0);
    assert.equal(front(s).sides[0]!.secondLine[U.infantry], 2000, "les unités restent en seconde ligne");
  });
});
