# 02 — Moteur

Le moteur (`packages/engine`) calcule l'état d'une partie à partir de ses tours.
Chaque navigateur l'exécute et doit obtenir exactement le même état (règle 2 du
`CLAUDE.md`, 01-Architecture §3).

**Les règles du jeu ne sont pas définies.** Elles seront écrites par l'auteur
dans `00-Game.md`. Ce qui existe ici est l'infrastructure qui ne dépend pas des
règles, plus un seul ordre de démonstration (`demo_claim`, §4) qui sert à faire
tourner et tester la chaîne. Ce n'est pas une règle du jeu.

---

## 1. Ce qui existe

| Fichier (`packages/engine/`) | Contenu |
| --- | --- |
| `src/config.ts` | tous les nombres réglables (carte de test, nombre maximal de joueurs) |
| `src/bits.ts` | rotation de bits, étapes de MurmurHash3 |
| `src/rng.ts` | générateur aléatoire xoshiro128** |
| `src/map.ts` | bits du terrain, `GameMap`, parcours des 4 voisins |
| `src/mapgen.ts` | `generateTestMap(seed)` |
| `src/seazones.ts` | zones maritimes (00-Game §2.1) : `generateSeaZones`, `computeSeaZones`, `landMask` |
| `src/state.ts` | `GameState`, `createGame`, `setOwner` |
| `src/intents.ts` | types d'ordres, validation, `demo_claim` |
| `src/turn.ts` | `applyTurn(state, { turn, intents })` |
| `src/hash.ts` | `hashMap`, `hashState` |
| `test/*.test.ts` | tests (`npm test`) |
| `test/scenario.ts` | partie scriptée utilisée par les tests et la mesure |
| `test/bench.ts` | mesure (`npm run bench`) |
| `test/seazones-viz.ts` | visualisation pas à pas des zones maritimes (`npm run viz:sea`) → `out/sea-zones.html`, ignoré par git |

Aucune dépendance à l'exécution. `typescript` et `@types/node` sont des
dépendances de développement ; `@types/node` ne sert qu'aux tests :
`tsconfig.json` (sources) a `types: []` et `lib: es2024`, donc un accès au DOM
ou à Node dans `src/` ne compile pas.

Pas d'étape de compilation : le paquet exporte `src/index.ts`. Vite (client)
lit le TypeScript directement ; Node 24 aussi (suppression des types), d'où
`erasableSyntaxOnly` dans `tsconfig.json` (pas d'`enum`, pas de `namespace`) et
des imports écrits avec l'extension `.ts`.

## 2. La carte

- `terrain : Uint8Array`, un octet par case, adresse `y × largeur + x` :
  - bit 7 `TERRAIN_LAND` : terre ;
  - bit 6 `TERRAIN_SHORE` : côte = terre dont un des 4 voisins est de l'eau ;
  - bit 5 `TERRAIN_OCEAN` : eau reliée au bord de la carte. Une eau sans ce
    bit est un lac ;
  - bits 0 à 4 : altitude 0 à 31, toujours 0 sur l'eau.
- `owner : Uint16Array` dans l'état de la partie, 0 = personne. La carte, elle,
  ne change pas pendant la partie.
- Voisins : les 4 cases gauche, droite, haut, bas, dans cet ordre ; pas de
  passage d'un bord à l'autre.

### Carte de test

`generateTestMap(seed)` : 800 × 500 = 400 000 cases. Pour chaque case, une
élévation entière = bruit de valeur sur 5 octaves (grilles de pas 128 à 8,
valeurs aux nœuds tirées d'un hash de la graine et des coordonnées, interpolées
avec une courbe en S calculée en entiers) + un bonus au centre − une baisse qui
croît avec le carré de la distance au centre d'une ellipse. Au-dessus du niveau
de la mer : terre, altitude = excédent décalé de 11 bits. Ensuite un parcours en
largeur depuis le bord marque l'océan, puis la côte est marquée.

Résultat avec les réglages actuels : un continent central, 30 à 40 % de terre
selon la graine, parfois un lac ou un îlot.

### Zones maritimes

`generateSeaZones(width, height, land, cfg, onStep?)` : `land` vaut 1 sur la
terre, 0 sur l'eau (`landMask(map)` le tire d'une `GameMap`). Le module ne lit
rien d'autre de la carte. Renvoie la case de chaque point. `onStep` reçoit les
points après chaque étape ; seule la visualisation s'en sert.

`computeSeaZones(width, height, land, points)` : zone et distance de chaque
case. Parcours parti de tous les points à la fois, avec une file par distance
modulo 8 (algorithme de Dial ; coûts 5 et 7). Une case dont la zone ou la
distance s'améliore est remise en file ; l'entrée périmée est sautée quand sa
distance ne correspond plus. Égalité de distance : le plus petit indice de
point gagne.

Usage prévu : les points sont calculés une fois à la création de la partie,
après la carte. Ils ne sont pas encore dans `GameState` ni dans le hash.

## 3. Le générateur aléatoire

xoshiro128** (algorithme du domaine public, réécrit ici), état de 4 mots de
32 bits initialisé par splitmix32 à partir de la graine de la partie. L'état est
`state.rng`, il entre dans le hash. `nextU32` renvoie un entier dans [0, 2³²),
`nextInt(rng, n)` un entier dans [0, n) avec rejet des tirages au-delà du plus
grand multiple de n.

Aucun ordre ne l'utilise encore. Les règles de `00-Game.md` qui ont besoin de
hasard tireront ici, et seulement ici.

Un test vérifie les trois premières sorties pour l'état `[1, 2, 3, 4]` (11520,
0, 5927040, calculées à la main depuis la définition de l'algorithme), un autre
fige les six premières sorties pour la graine 1. Si l'un échoue, le générateur
a changé et toutes les parties enregistrées se rejoueraient autrement.

## 4. Ordres et tours

- `applyTurn(state, { turn, intents })` applique les ordres dans l'ordre du
  tableau, passe `state.tick` à `turn`, et renvoie la liste des cases dont le
  propriétaire a été écrit, chacune une fois, dans l'ordre de leur première
  modification. C'est cette liste que l'affichage relira.
- Toute écriture de `owner` passe par `setOwner`, qui tient à jour le nombre de
  cases de chaque joueur et la liste des cases modifiées.
- Un ordre arrive du réseau : chaque champ est vérifié (`typeof`, entier, dans
  les bornes) avant usage. Un ordre invalide ne modifie rien et n'est pas
  signalé. Un `intents` qui n'est pas un tableau compte comme vide.
- Le champ `player` d'un ordre est écrit par le serveur (règle 4).

### `demo_claim` — exemple jetable

`{ type: "demo_claim", player, tile }` : le joueur prend la case `tile` si c'est
de la terre sans propriétaire et, s'il possède déjà une case, si un des 4
voisins de `tile` lui appartient. Sert uniquement aux tests. À supprimer quand
`00-Game.md` définira les vrais ordres.

## 5. Le hash

`hashState(state)` : entier 32 bits, étapes de MurmurHash3 sur, dans l'ordre :
le hash de la carte (dimensions et terrain, calculé une fois par
`createGame`), le numéro de tour, les 4 mots du générateur aléatoire, le nombre
de joueurs puis l'identifiant et le nombre de cases de chacun, puis `owner`
lu deux cases par mot.

## 6. Pièges

- **Ajouter un champ à `GameState` sans l'ajouter à `hashState`** : deux
  clients dont ce champ diffère ne seraient jamais signalés comme
  désynchronisés.
- **Lire un tableau par une vue `Uint32Array` pour hasher plus vite** : l'ordre
  des octets d'une vue dépend de la machine. Le hash assemble ses mots à la
  main.
- **Écrire `state.owner[t] = …` directement** : le nombre de cases du joueur
  et la liste des cases modifiées ne sont pas mis à jour. Passer par
  `setOwner`.
- **Rendre `applyTurn` tolérant à un numéro de tour inattendu** : il lève une
  erreur, sans rien modifier, si le tour n'est pas `state.tick + 1`. Ignorer
  le tour ou l'appliquer quand même ferait diverger ce client sans bruit.
- **`**` et `Math.*`** : `test/engine.test.ts` cherche dans `src/` les
  fonctions interdites par la règle 2 et refuse tout `Math.*` hors de
  `imul`, `floor`, `ceil`, `trunc`, `abs`, `min`, `max`, `sign`, `clz32`. Il
  refuse aussi `**` : la spécification le classe, comme `Math.pow`, parmi les
  calculs approchés. Ajouter une fonction à la liste autorisée demande de
  vérifier que la spécification ECMAScript en fixe le résultat exact.
- **Parcourir un objet ou un `Set` construit dans un ordre qui dépend d'autre
  chose que l'état** : même ordre d'insertion requis chez tous les clients.
- Les tests de déterminisme tournent dans un seul moteur JavaScript (Node /
  V8). Ils prouvent que le moteur ne dépend ni du hasard, ni de l'heure, ni du
  processus ; ils ne prouvent pas l'égalité entre Chrome, Firefox et Safari.
  C'est la règle 2 (entiers seulement) qui la garantit.
- Vérifié une fois à la main : un `Math.random()` injecté dans `demo_claim`
  fait échouer le test des deux processus et le test des sources.

## 7. Choix provisoires, à valider

Choix d'infrastructure faits pour que le moteur tourne ; aucun n'est une règle
du jeu, tous peuvent être remis en cause par `00-Game.md`.

1. Les joueurs sont fixés à la création de la partie (identifiants 1 à n) ;
   pas d'arrivée en cours de partie.
2. Voisinage à 4 cases (pas de diagonales), pour la côte et pour
   `demo_claim`.
3. Côte = case de terre touchant l'eau (et non case d'eau touchant la terre).
4. Hash sur 32 bits : une collision entre deux états différents a environ une
   chance sur 4 milliards par comparaison.
5. Un tour au mauvais numéro lève une erreur (le client devra alors se
   resynchroniser, partie 3).
6. Carte de test 800 × 500 et ses réglages (`src/config.ts`).
7. `demo_claim` (§4) : exemple, à supprimer.
8. Zones maritimes : les choix provisoires du prototype sont listés dans
   00-Game §2.1 ; `SEA_ZONES.spacing` et `minBasinArea` sont des valeurs
   d'essai.

## 8. Mesures

`npm run bench`, sur le PC de l'auteur (Node 24.19), 20 octobre 2026 :

- génération de la carte de test (400 000 cases) : 105 ms ;
- zones maritimes sur cette carte (graine 12345, 50 + 50 itérations, 155
  points) : environ 2,5 s, mesuré par `npm run viz:sea` le 22 octobre 2026.
  Une fois par partie ;
- tour moyen sur 10 000 tours, 33 ordres `demo_claim` par tour (8 joueurs ×
  4, plus un ordre malformé) : 1,3 µs. Chiffre sans valeur pour le vrai jeu :
  `demo_claim` ne fait presque rien ;
- hash de l'état complet : 0,38 ms. Envoyé tous les N tours (§8 de
  01-Architecture), c'est un coût négligeable à côté des 100 ms d'un tour.
