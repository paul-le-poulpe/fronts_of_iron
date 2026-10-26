// Fronts terrestres : détection, positions, guerre et paix, ordres de réglage, fondation en
// guerre, hash (Docs/Design/05-Fronts.md §2, §5, §8, §13.7).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  applyTurn,
  createGame,
  FRONTS,
  hashState,
  NICHES,
  UNITS,
  updateFronts,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { bruteFronts } from "./helpers.ts";
import { at, duel, found, front, MAP, play, R, turn, U } from "./war-helpers.ts";

/** Les fronts de l'état, dans la forme de `bruteFronts`. */
function actual(s: GameState): ReturnType<typeof bruteFronts> {
  return s.fronts
    .map((f) => ({ players: [...f.players] as [number, number], groups: [...f.groups] as [number, number], connections: f.connections.map((c) => [c.city1, c.city2] as [number, number]) }))
    .sort((x, y) => x.connections[0]![0] - y.connections[0]![0] || x.connections[0]![1] - y.connections[0]![1]);
}

describe("config des unités (05-Fronts §3)", () => {
  it("les multiplicateurs ont deux décimales au plus", () => {
    for (const [id, u] of Object.entries(UNITS)) {
      const config = u as Record<string, unknown>;
      for (const key of ["attackMultiplier", "breakthroughMultiplier", "counterAttackMultiplier", "lossMultiplier"]) {
        const x = config[key];
        if (x === undefined) continue;
        assert.equal(typeof x, "number");
        assert.ok(Math.abs((x as number) * 100 - Math.round((x as number) * 100)) < 1e-9, `${id}.${key} = ${x} a plus de deux décimales`);
      }
    }
  });

  it("chaque type d'unité est dans une seule niche, et l'infanterie est la première", () => {
    const seen = new Map<string, number>();
    for (const units of Object.values(NICHES)) for (const id of units) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of Object.keys(UNITS)) assert.equal(seen.get(id), 1, `${id} doit être dans une seule niche`);
    assert.equal((UNITS[Object.values(NICHES)[0]![0] as keyof typeof UNITS] as { damageType: string }).damageType, "infantry");
  });
});

describe("détection des fronts (05-Fronts §2)", () => {
  /**
   * Trois joueurs, chacun un bloc de 2 colonnes × 3 lignes de villes sur un réseau carré de pas 1,5 R :
   * des routes relient les villes voisines, et deux fronts de 3 connexions séparent les blocs.
   */
  function crowded(): { s: GameState; steps: number } {
    const s = createGame({ seed: 3, map: MAP, playerCount: 3 });
    s.players.forEach((p) => (p.population = 1_000_000));
    let steps = 0;
    for (let player = 1; player <= 3; player++) {
      for (let c = 2 * (player - 1); c < 2 * player; c++) {
        for (let r = 0; r < 3; r++) {
          turn(s, found(player, at(3 * c + 2, 3 * r + 2)));
          steps++;
          assert.deepEqual(actual(s), bruteFronts(s), `après la ville ${steps}`);
        }
      }
    }
    return { s, steps };
  }

  it("après chaque fondation, les fronts sont ceux de la définition ; chaque connexion est dans un seul front", () => {
    const { s } = crowded();
    assert.equal(s.cities.length, 18);
    assert.deepEqual(s.fronts.map((f) => f.connections.length), [3, 3], "deux fronts de trois connexions");
    const seen = new Set<string>();
    for (const f of s.fronts) {
      for (const c of f.connections) {
        const k = `${c.city1},${c.city2}`;
        assert.ok(!seen.has(k), `connexion ${k} dans deux fronts`);
        seen.add(k);
        assert.notEqual(s.cities[c.city1 - 1]!.player, s.cities[c.city2 - 1]!.player);
        assert.equal(s.cities[c.city1 - 1]!.player, f.players[0]);
        assert.equal(s.cities[c.city2 - 1]!.player, f.players[1]);
      }
      assert.ok(f.players[0] < f.players[1]);
      assert.deepEqual(f.connections, f.connections.toSorted((a, b) => a.city1 - b.city1 || a.city2 - b.city2));
    }
    // Identifiants croissants, jamais réutilisés pour un autre front.
    for (let i = 1; i < s.fronts.length; i++) assert.ok(s.fronts[i - 1]!.id < s.fronts[i]!.id);
  });

  it("la largeur d'un front est son nombre de connexions × metersPerConnection", () => {
    const { s } = crowded();
    for (const f of s.fronts) assert.equal(f.connections.length * FRONTS.metersPerConnection, f.connections.length * 5000);
  });

  it("en paix : pas de position ; le front reste ; il n'y a rien d'actif", () => {
    const s = duel();
    assert.equal(front(s).connections[0]!.position, 0);
    assert.ok(!front(s).sides[0]!.frontAttack);
  });

  it("une connexion retrouvée garde sa position, une nouvelle reçoit 500 (fondation en guerre)", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.equal(front(s).connections[0]!.position, 500);
    front(s).connections[0]!.position = 700;
    // Une deuxième ville du joueur 1 reliée à la ville du joueur 2 : nouvelle connexion, dans le même groupe donc le même front.
    turn(s, found(1, at(9.5, 12.6)));
    assert.deepEqual(actual(s), bruteFronts(s));
    const f = front(s);
    assert.equal(s.fronts.length, 1, "même groupe, même front");
    const positions = f.connections.map((c) => [c.city1, c.city2, c.position]);
    assert.deepEqual(positions.find((p) => p[0] === 1 && p[1] === 2), [1, 2, 700], "la connexion existante garde sa position");
    for (const p of positions) if (!(p[0] === 1 && p[1] === 2)) assert.equal(p[2], 500, "la nouvelle connexion est au milieu");
  });

  it("les réglages d'un front se retrouvent après un recalcul ; un nouveau front a les réglages par défaut", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    const id = front(s).id;
    assert.ok(applyIntent(s, { type: "set_front_priority", player: 1, front: id, priority: 2 }, []));
    assert.ok(applyIntent(s, { type: "set_unit_line_mode", player: 1, front: id, unit: "artillery", mode: "second" }, []));
    turn(s, found(1, at(9.5, 12.6)));
    assert.equal(front(s).id, id, "l'identifiant du front est gardé");
    assert.equal(front(s).sides[0]!.priorityIndex, 2);
    assert.equal(front(s).sides[0]!.lineMode[U.artillery], 2);
    assert.equal(front(s).sides[1]!.priorityIndex, 0);
    assert.equal(front(s).sides[1]!.motorizedOnly, true);
    assert.equal(front(s).sides[1]!.reassign, false);
  });
});

describe("troupes d'un front qui change de taille (05-Fronts §2.5)", () => {
  /** Deux fronts de même joueur, dont les troupes sont fixées à la main. */
  function twoConnections(): GameState {
    const s = createGame({ seed: 4, map: MAP, playerCount: 2 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
    turn(s, found(2, at(10.4, 12.4)));
    assert.equal(front(s).connections.length >= 2, true, "le front doit avoir deux connexions");
    return s;
  }

  it("coupure : les troupes sont partagées entre les morceaux au prorata de leurs connexions, le reste au plus petit identifiant", () => {
    const s = twoConnections();
    const f = front(s);
    assert.equal(f.connections.length, 2);
    f.sides[0]!.firstLine[U.infantry] = 11;
    f.sides[0]!.secondLine[U.infantry] = 5;
    const total = f.sides[0]!.firstLine[U.infantry]! + f.sides[0]!.secondLine[U.infantry]!;
    // Les deux villes du joueur 2 passent dans deux groupes différents : le front se coupe en deux.
    s.cities[2]!.group = 3;
    updateFronts(s);
    assert.equal(s.fronts.length, 2);
    assert.equal(s.fronts[0]!.id, f.id, "le morceau de plus petit identifiant garde l'identifiant");
    assert.ok(s.fronts[1]!.id > f.id);
    // Au prorata (1 connexion sur 2) : arrondi pour le second morceau, le reste au plus petit identifiant ; rien n'est perdu.
    const own = (g: (typeof s.fronts)[number]): [number, number] => [g.sides[0]!.firstLine[U.infantry]! + g.sides[0]!.secondLine[U.infantry]!, 0];
    assert.equal(own(s.fronts[1]!)[0], 6 + 3, "11 en première ligne : arrondi(5,5) = 6 ; 5 en seconde ligne : arrondi(2,5) = 3");
    assert.equal(own(s.fronts[0]!)[0], 5 + 2);
    assert.equal(own(s.fronts[0]!)[0] + own(s.fronts[1]!)[0], total);
  });

  it("une ville prise sans autre connexion : les unités d'un front disparu retournent à la réserve sans délai", () => {
    const s = duel();
    const f = front(s);
    f.sides[0]!.firstLine[U.infantry] = 7;
    f.sides[0]!.secondLine[U.artillery] = 3;
    s.players[0]!.soldiers = 7 * 10 + 3 * 10;
    s.players[0]!.armamentReserve.fill(0);
    s.roads.length = 0;
    updateFronts(s);
    assert.equal(s.fronts.length, 0);
    assert.equal(s.players[0]!.armamentReserve[0], 70, "7 infanteries rendent 70 fusils");
    assert.equal(s.players[0]!.soldiers, 0);
  });
});

describe("guerre et paix (05-Fronts §2.3)", () => {
  it("la déclaration de guerre met chaque connexion au milieu ; la paix supprime tout sauf les troupes", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    const id = front(s).id;
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.deepEqual(front(s).connections.map((c) => c.position), [500]);
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    assert.ok(applyIntent(s, { type: "start_breakthrough", player: 2, front: id, city1: 1, city2: 2 }, []));
    front(s).sides[0]!.firstLine[U.infantry] = 9;
    turn(s, { type: "propose_peace", player: 1, target: 2 });
    turn(s, { type: "answer_proposal", player: 2, from: 1, accept: true });
    const f = front(s);
    assert.deepEqual(f.connections.map((c) => c.position), [0]);
    assert.equal(f.sides[0]!.frontAttack, false);
    assert.equal(f.sides[1]!.breakthroughs.length, 0);
    assert.equal(f.sides[0]!.firstLine[U.infantry], 9, "les troupes restent sur le front");
  });
});

describe("ordres de réglage et d'attaque (05-Fronts §5)", () => {
  it("un ordre invalide ne change rien", () => {
    const s = duel();
    const id = front(s).id;
    const before = hashState(s);
    const bad: Record<string, unknown>[] = [
      { type: "set_front_priority", player: 1, front: id, priority: 3 },
      { type: "set_front_priority", player: 1, front: id, priority: -1 },
      { type: "set_front_priority", player: 1, front: id, priority: 0.5 },
      { type: "set_front_priority", player: 1, front: 99, priority: 0 },
      { type: "set_front_priority", player: 1, front: "1", priority: 0 },
      { type: "set_front_reassign", player: 1, front: id, enabled: "oui" },
      { type: "set_unit_line_mode", player: 1, front: id, unit: "char", mode: "first" },
      { type: "set_unit_line_mode", player: 1, front: id, unit: "infantry", mode: "third" },
      { type: "set_breakthrough_motorized_only", player: 1, front: id },
      { type: "set_forced_mobilization", player: 1, enabled: 1 },
      { type: "start_front_attack", player: 1, front: id }, // front en paix
      { type: "start_breakthrough", player: 1, front: id, city1: 1, city2: 2 }, // front en paix
      { type: "cancel_breakthrough", player: 1, id: 1 },
    ];
    for (const intent of bad) assert.ok(!applyIntent(s, intent as unknown as Intent, []), JSON.stringify(intent));
    assert.equal(hashState(s), before);
    // Un joueur étranger au front ne règle pas ses camps (il y en a trois joueurs ici).
    const t = createGame({ seed: 1, map: MAP, playerCount: 3 });
    turn(t, found(1, at(8, 10)), found(2, at(11, 10)));
    assert.ok(!applyIntent(t, { type: "set_front_priority", player: 3, front: 1, priority: 1 }, []));
    assert.ok(applyIntent(t, { type: "set_front_priority", player: 2, front: 1, priority: 1 }, []));
    assert.equal(front(t).sides[1]!.priorityIndex, 1);
  });

  it("attaque sur tout le front : interrupteur ; percée : une par axe et par camp ; annulation par son propriétaire", () => {
    const s = duel();
    const id = front(s).id;
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    assert.ok(!applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    // Les deux joueurs peuvent attaquer en même temps.
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 2, front: id }, []));
    assert.ok(applyIntent(s, { type: "stop_front_attack", player: 1, front: id }, []));
    assert.equal(front(s).sides[0]!.frontAttack, false);
    assert.equal(front(s).sides[1]!.frontAttack, true);
    assert.ok(!applyIntent(s, { type: "start_breakthrough", player: 1, front: id, city1: 2, city2: 1 }, []), "la connexion n'est pas dans ce front");
    assert.ok(applyIntent(s, { type: "start_breakthrough", player: 1, front: id, city1: 1, city2: 2 }, []));
    assert.ok(!applyIntent(s, { type: "start_breakthrough", player: 1, front: id, city1: 1, city2: 2 }, []), "une percée par axe et par camp");
    assert.ok(applyIntent(s, { type: "start_breakthrough", player: 2, front: id, city1: 1, city2: 2 }, []));
    const mine = front(s).sides[0]!.breakthroughs[0]!;
    assert.ok(!applyIntent(s, { type: "cancel_breakthrough", player: 2, id: mine.id }, []), "pas la percée de l'autre");
    assert.ok(applyIntent(s, { type: "cancel_breakthrough", player: 1, id: mine.id }, []));
    assert.equal(front(s).sides[0]!.breakthroughs.length, 0);
  });
});

describe("fondation pendant une guerre (05-Fronts §8)", () => {
  it("le rayon d'expansion d'une ville d'un front actif ne compte pas", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    // En paix : une ville dans le rayon d'expansion de la ville 1.
    const tile = at(9.5, 12.6);
    const spare = createGame({ seed: 1, map: MAP, playerCount: 2 });
    spare.players.forEach((p) => (p.population = 1_000_000));
    turn(spare, found(1, at(8, 10)), found(2, at(11, 10)));
    assert.ok(applyIntent(spare, found(1, tile), []), "en paix, la fondation est permise");
    // En guerre : la seule ville du joueur 1 est sur un front actif.
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.ok(!applyIntent(s, found(1, tile), []), "en guerre, elle est refusée");
    assert.equal(s.cities.length, 2);
    // Une ville qui n'est pas du front peut encore servir : après la paix, elle revient.
    turn(s, { type: "propose_peace", player: 1, target: 2 });
    turn(s, { type: "answer_proposal", player: 2, from: 1, accept: true });
    assert.ok(applyIntent(s, found(1, tile), []));
  });
});

describe("hash des fronts (05-Fronts §13.3)", () => {
  it("chaque champ d'un front, d'un camp et d'une percée change le hash", () => {
    const base = (): GameState => {
      const s = duel();
      s.players.forEach((p) => (p.population = 1_000_000));
      turn(s, { type: "declare_war", player: 1, target: 2 });
      turn(s, { type: "start_front_attack", player: 1, front: 1 }, { type: "start_breakthrough", player: 1, front: 1, city1: 1, city2: 2 });
      front(s).sides[0]!.transfers.push({ unit: 0, count: 2, toFront: true, line: 1, arrival: 999 });
      return s;
    };
    const reference = hashState(base());
    assert.equal(hashState(base()), reference);
    const mutations: [string, (s: GameState) => void][] = [
      ["position", (s) => void front(s).connections[0]!.position++],
      ["première ligne", (s) => void front(s).sides[1]!.firstLine[2]!++],
      ["seconde ligne", (s) => void front(s).sides[0]!.secondLine[1]!++],
      ["mouvement : nombre", (s) => void front(s).sides[0]!.transfers[0]!.count++],
      ["mouvement : arrivée", (s) => void (front(s).sides[0]!.transfers[0] = { ...front(s).sides[0]!.transfers[0]!, arrival: 1000 })],
      ["mouvement : sens", (s) => void (front(s).sides[0]!.transfers[0] = { ...front(s).sides[0]!.transfers[0]!, toFront: false })],
      ["priorité", (s) => void front(s).sides[1]!.priorityIndex++],
      ["réassignation", (s) => void (front(s).sides[0]!.reassign = true)],
      ["interrupteur d'un type", (s) => void (front(s).sides[1]!.lineMode[3] = 1)],
      ["motorisé seulement", (s) => void (front(s).sides[0]!.motorizedOnly = false)],
      ["attaque", (s) => void (front(s).sides[0]!.frontAttack = false)],
      ["phase d'une percée", (s) => void front(s).sides[0]!.breakthroughs[0]!.phase++],
      ["unités engagées", (s) => void front(s).sides[0]!.breakthroughs[0]!.attackers[0]!++],
      ["tranche engagée", (s) => void front(s).sides[0]!.breakthroughs[0]!.defenders1[0]!++],
      ["force de contre-attaque", (s) => void front(s).sides[0]!.breakthroughs[0]!.defenders2[0]!++],
      ["PV de départ", (s) => void front(s).sides[0]!.breakthroughs[0]!.startHp++],
      ["nextFrontId", (s) => void s.nextFrontId++],
      ["nextBreakthroughId", (s) => void s.nextBreakthroughId++],
      ["mobilisation forcée", (s) => void (s.players[1]!.forcedMobilization = true)],
      ["soldats", (s) => void s.players[0]!.soldiers++],
      ["statut de guerre", (s) => void s.diplomacy.fill(1)],
    ];
    for (const [name, mutate] of mutations) {
      const s = base();
      mutate(s);
      assert.notEqual(hashState(s), reference, `le champ « ${name} » n'est pas dans le hash`);
    }
  });

  it("deux parties qui reçoivent les mêmes ordres ont les mêmes fronts", () => {
    const run = (): number => {
      const s = duel();
      s.players.forEach((p) => (p.population = 1_000_000));
      applyTurn(s, { turn: s.tick + 1, intents: [{ type: "declare_war", player: 1, target: 2 }] });
      play(s, 200);
      return hashState(s);
    };
    assert.equal(run(), run());
    assert.ok(R > 0);
  });
});
