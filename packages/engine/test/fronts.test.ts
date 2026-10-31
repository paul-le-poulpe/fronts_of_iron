// Fronts terrestres : détection, positions, guerre et paix, divisions d'un front qui change,
// ordres, fondation en guerre, hash (Docs/Design/05-Fronts.md §2, §3, §5, §8, §13.7).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyIntent,
  applyTurn,
  createGame,
  DIVISIONS,
  FRONTS,
  frontWidth,
  hashState,
  NICHES,
  updateFronts,
  type DivisionComponentConfig,
  type GameState,
  type Intent,
} from "../src/index.ts";
import { bruteFronts } from "./helpers.ts";
import { at, duel, found, front, MAP, play, put, R, turn } from "./war-helpers.ts";

/** Les fronts de l'état, dans la forme de `bruteFronts`. */
function actual(s: GameState): ReturnType<typeof bruteFronts> {
  return s.fronts
    .map((f) => ({ players: [...f.players] as [number, number], groups: [...f.groups] as [number, number], connections: f.connections.map((c) => [c.city1, c.city2] as [number, number]) }))
    .sort((x, y) => x.connections[0]![0] - y.connections[0]![0] || x.connections[0]![1] - y.connections[0]![1]);
}

describe("config des divisions (05-Fronts §3)", () => {
  it("les multiplicateurs ont deux décimales au plus", () => {
    const decimals = (x: number, name: string): void =>
      assert.ok(Math.abs(x * 100 - Math.round(x * 100)) < 1e-9, `${name} = ${x} a plus de deux décimales`);
    for (const [id, d] of Object.entries(DIVISIONS)) {
      for (const key of ["defenseHitPointsMultiplier", "attackMultiplier", "breakthroughMultiplier", "counterAttackMultiplier"] as const) decimals(d[key], `${id}.${key}`);
      for (const c of d.components as readonly DivisionComponentConfig[]) if (c.lossMultiplier !== undefined) decimals(c.lossMultiplier, `${id}.${c.resource}.lossMultiplier`);
    }
  });

  it("chaque type de division est dans une seule niche, et l'infanterie est la première", () => {
    const seen = new Map<string, number>();
    for (const niche of Object.values(NICHES)) for (const id of niche.types) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of Object.keys(DIVISIONS)) assert.equal(seen.get(id), 1, `${id} doit être dans une seule niche`);
    assert.equal(Object.keys(NICHES)[0], "infantry");
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

  it("la largeur d'un front est son nombre de connexions, en millièmes de liaison", () => {
    const { s } = crowded();
    for (const f of s.fronts) assert.equal(frontWidth(f), f.connections.length * 1000);
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

  it("l'attaque d'un front se retrouve après un recalcul", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    const id = front(s).id;
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    turn(s, found(1, at(9.5, 12.6)));
    assert.equal(front(s).id, id, "l'identifiant du front est gardé");
    assert.equal(front(s).sides[0]!.frontAttack, true);
    assert.equal(front(s).sides[1]!.frontAttack, false);
  });
});

describe("divisions d'un front qui change (05-Fronts §2.5)", () => {
  /** Un front de deux connexions. */
  function twoConnections(): GameState {
    const s = createGame({ seed: 4, map: MAP, playerCount: 2 });
    s.players.forEach((p) => (p.population = 1_000_000));
    turn(s, found(1, at(8, 10)), found(2, at(11, 10)));
    turn(s, found(2, at(10.4, 12.4)));
    assert.equal(front(s).connections.length >= 2, true, "le front doit avoir deux connexions");
    return s;
  }

  it("coupure : les divisions sont partagées au prorata des connexions, au plus grand reste, le reste au plus petit identifiant", () => {
    const s = twoConnections();
    const f = front(s);
    assert.equal(f.connections.length, 2);
    for (let k = 0; k < 3; k++) put(s, 1, "infantry", f.id);
    // Les deux villes du joueur 2 passent dans deux groupes différents : le front se coupe en deux.
    s.cities[2]!.group = 3;
    updateFronts(s);
    assert.equal(s.fronts.length, 2);
    assert.equal(s.fronts[0]!.id, f.id, "le morceau de plus petit identifiant garde l'identifiant");
    const on = (id: number): number[] => s.divisions.filter((d) => d.front === id).map((d) => d.id);
    assert.deepEqual(on(s.fronts[0]!.id), [1, 2], "1,5 et 1,5 : le reste au plus petit identifiant ; divisions par identifiant");
    assert.deepEqual(on(s.fronts[1]!.id), [3]);
  });

  it("front disparu : ses divisions retournent à la réserve avec le délai de déplacement", () => {
    const s = duel();
    const d = put(s, 1, "infantry", front(s).id);
    s.roads.length = 0;
    updateFronts(s);
    assert.equal(s.fronts.length, 0);
    assert.equal(d.front, 0);
    assert.equal(d.arrivalTick, s.tick + 1 + FRONTS.transferRounds * FRONTS.combatTurns);
  });
});

describe("guerre et paix (05-Fronts §2.3)", () => {
  it("la déclaration de guerre met chaque connexion au milieu ; la paix supprime tout sauf les divisions", () => {
    const s = duel();
    s.players.forEach((p) => (p.population = 1_000_000));
    const id = front(s).id;
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.deepEqual(front(s).connections.map((c) => c.position), [500]);
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    const d = put(s, 1, "infantry", id);
    turn(s, { type: "propose_peace", player: 1, target: 2 });
    turn(s, { type: "answer_proposal", player: 2, from: 1, accept: true });
    const f = front(s);
    assert.deepEqual(f.connections.map((c) => c.position), [0]);
    assert.equal(f.sides[0]!.frontAttack, false);
    assert.equal(d.front, id, "les divisions restent sur le front");
  });
});

describe("ordres des fronts (05-Fronts §5)", () => {
  it("un ordre invalide ne change rien", () => {
    const s = duel();
    const id = front(s).id;
    const mine = put(s, 1, "infantry");
    const theirs = put(s, 2, "infantry");
    const before = hashState(s);
    const bad: Record<string, unknown>[] = [
      { type: "create_division", player: 1, division: "char" },
      { type: "create_division", player: 1, division: "infantry" }, // ni armement ni inactifs
      { type: "delete_division", player: 1, id: theirs.id },
      { type: "delete_division", player: 1, id: 99 },
      { type: "move_division", player: 1, ids: [theirs.id], front: id },
      { type: "move_division", player: 1, ids: [mine.id], front: 99 },
      { type: "move_division", player: 1, ids: [mine.id], front: id, line: "third" },
      { type: "move_division", player: 1, ids: mine.id, front: id },
      { type: "move_division", player: 1, ids: [mine.id], front: 0 }, // déjà dans la réserve
      { type: "set_forced_mobilization", player: 1, enabled: 1 },
      { type: "start_front_attack", player: 1, front: id }, // front en paix
    ];
    for (const intent of bad) assert.ok(!applyIntent(s, intent as unknown as Intent, []), JSON.stringify(intent));
    assert.equal(hashState(s), before);
    // Un joueur étranger au front n'y envoie pas de division (il y a trois joueurs ici).
    const t = createGame({ seed: 1, map: MAP, playerCount: 3 });
    turn(t, found(1, at(8, 10)), found(2, at(11, 10)));
    const third = put(t, 3, "infantry");
    assert.ok(!applyIntent(t, { type: "move_division", player: 3, ids: [third.id], front: 1 }, []));
  });

  it("attaque sur tout le front : interrupteur de chaque camp, les deux peuvent attaquer en même temps", () => {
    const s = duel();
    const id = front(s).id;
    turn(s, { type: "declare_war", player: 1, target: 2 });
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    assert.ok(!applyIntent(s, { type: "start_front_attack", player: 1, front: id }, []));
    assert.ok(applyIntent(s, { type: "start_front_attack", player: 2, front: id }, []));
    assert.ok(applyIntent(s, { type: "stop_front_attack", player: 1, front: id }, []));
    assert.equal(front(s).sides[0]!.frontAttack, false);
    assert.equal(front(s).sides[1]!.frontAttack, true);
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

describe("hash des fronts et des divisions (05-Fronts §13.3)", () => {
  it("chaque champ d'un front et d'une division change le hash", () => {
    const base = (): GameState => {
      const s = duel();
      s.players.forEach((p) => (p.population = 1_000_000));
      turn(s, { type: "declare_war", player: 1, target: 2 });
      turn(s, { type: "start_front_attack", player: 1, front: 1 });
      put(s, 1, "infantry", 1);
      return s;
    };
    const reference = hashState(base());
    assert.equal(hashState(base()), reference);
    const div = (s: GameState) => s.divisions[0]!;
    const mutations: [string, (s: GameState) => void][] = [
      ["position", (s) => void front(s).connections[0]!.position++],
      ["attaque", (s) => void (front(s).sides[0]!.frontAttack = false)],
      ["nextFrontId", (s) => void s.nextFrontId++],
      ["nextDivisionId", (s) => void s.nextDivisionId++],
      ["exemplaires d'un composant", (s) => void div(s).counts[1]!--],
      ["front", (s) => void (div(s).front = 0)],
      ["ligne", (s) => void (div(s).line = 0)],
      ["largeur engagée", (s) => void div(s).engaged++],
      ["arrivée", (s) => void (div(s).arrivalTick = 999)],
      ["fin de formation", (s) => void ((div(s) as { formedTick: number }).formedTick = 999)],
      ["fuite", (s) => void (div(s).fleeUntilTick = 999)],
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
