# 02 — Moteur

Le moteur (`packages/engine`) calcule l'état d'une partie à partir de ses tours.
Chaque navigateur l'exécute et doit obtenir exactement le même état (règle 2 du
`CLAUDE.md`, 01-Architecture §3).

**Les règles viennent de `00-Game.md`.** Le moteur n'implémente que ce que ce
document décide. Implémenté : les villes (00-Game §3.1 à §3.6 : fondation,
zones, routes terrestres, ports, groupes) et leur seul ordre, `found_city` (§4).
Pas implémenté : population (répartition, croissance), nourriture, extraction,
usines, armement, routes maritimes, changement de capitale, disparition d'une
ville, fertilité, commerce, armée, diplomatie.

---

## 1. Ce qui existe

| Fichier (`packages/engine/`) | Contenu |
| --- | --- |
| `src/config.ts` | tous les nombres réglables (carte de test, nombre maximal de joueurs et de villes, zones maritimes, présence des ressources, rayons des villes, population de départ) |
| `src/bits.ts` | rotation de bits, étapes de MurmurHash3 |
| `src/rng.ts` | générateur aléatoire xoshiro128** |
| `src/map.ts` | bits du terrain et des ressources, `GameMap`, parcours des 4 voisins |
| `src/noise.ts` | `valueNoise` : bruit de valeur en entiers, commun au relief et aux ressources |
| `src/mapgen.ts` | `generateTestMap(seed)` : terrain, puis présence des ressources |
| `src/resources.ts` | présence des ressources naturelles (00-Game §2) : `generateResourcePresence`, `resourceNoise`, `presenceThreshold` |
| `src/seazones.ts` | zones maritimes (00-Game §2.1) : `generateSeaZones`, `computeSeaZones`, `landMask` |
| `src/state.ts` | `GameState`, `Player`, `City`, `createGame`, `setOwner` |
| `src/cities.ts` | `foundCity` : validité, zones, ports, groupes (00-Game §3.2 à §3.6) |
| `src/roads.ts` | réseau de routes terrestres (00-Game §3.5) : `addCityToRoads` (mise à jour à chaque fondation), `computeRoads` (calcul complet, référence des tests), `segmentsCross` |
| `src/intents.ts` | types d'ordres, vérification des champs, `found_city` |
| `src/turn.ts` | `applyTurn(state, { turn, intents })` |
| `src/hash.ts` | `hashMap`, `hashState` |
| `test/*.test.ts` | tests (`npm test`) |
| `test/helpers.ts` | calculs de référence lents (zones par toutes les villes, routes par toutes les paires, groupes par parcours, ports) et cartes fabriquées à la main, pour les tests de villes |
| `test/scenario.ts` | partie scriptée utilisée par les tests et la mesure : des joueurs simulés envoient des ordres `found_city` |
| `test/bench.ts` | mesure (`npm run bench`) |
| `test/seazones-viz.ts` | visualisation pas à pas des zones maritimes (`npm run viz:sea`) → `out/sea-zones.html`, ignoré par git |
| `test/iron-viz.ts` | visualisation de la présence du fer, avec des curseurs pour les réglages (`npm run viz:iron`) → `out/iron.html`, ignoré par git |
| `test/cities-viz.ts` | visualisation d'une partie scriptée, avec un curseur sur les étapes : zones, fer, routes, villes, capitales, ports (`npm run viz:cities`) → `out/cities.html`, ignoré par git |

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
- `resources : Uint8Array`, un octet par case, un bit par ressource : le bit i
  est la i-ème clé de `RESOURCES` (`config.ts`). Bit 0 = fer (`RESOURCE_IRON`).
  `RESOURCE_COUNT` est le nombre de ressources. 1 = présente sur la case.
- Pas de fertilité dans `GameMap` : sa génération n'est pas décidée.
- `owner : Uint16Array` et `tileCity : Uint16Array` sont dans l'état de la
  partie (§4), 0 = personne. La carte, elle, ne change pas pendant la partie.
- Voisins : les 4 cases gauche, droite, haut, bas, dans cet ordre ; pas de
  passage d'un bord à l'autre.

### Carte de test

`generateTestMap(seed)` : 800 × 500 = 400 000 cases. Pour chaque case, une
élévation entière = bruit de valeur sur 5 octaves (grilles de pas 128 à 8,
valeurs aux nœuds tirées d'un hash de la graine et des coordonnées, interpolées
avec une courbe en S calculée en entiers) + un bonus au centre − une baisse qui
croît avec le carré de la distance au centre d'une ellipse. Au-dessus du niveau
de la mer : terre, altitude = excédent décalé de 11 bits. Ensuite un parcours en
largeur depuis le bord marque l'océan, puis la côte est marquée. Enfin la
présence de chaque ressource (voir plus bas) est calculée sur ce terrain fini,
avec la même graine, et écrite dans le bit de la ressource.

Le bruit de valeur est dans `noise.ts`, et non dans `mapgen.ts`, parce que
`mapgen.ts` appelle `resources.ts` qui lui-même a besoin du bruit : sans ce
fichier, les deux modules s'importeraient l'un l'autre.

Résultat avec les réglages actuels : un continent central, 30 à 40 % de terre
selon la graine (38,6 % pour la graine 12345), parfois un lac ou un îlot.

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

### Ressources naturelles

`generateResourcePresence(map, seed, cfg)` : 1 si la ressource est sur la case,
0 sinon ; jamais sur l'eau. Le bruit (`resourceNoise`) est le même bruit de
valeur que le relief, sur ses propres octaves, avec une graine = graine de la
carte mélangée à `cfg.salt` : il ne suit pas le relief. Une case de terre porte
la ressource si son bruit dépasse :

```
seuil = threshold − altitude × perAltitude − (altitude ≥ mountainAltitude ? mountainBonus : 0)
```

Réglages du fer : `RESOURCES.iron.presence` dans `config.ts`, valeurs d'essai.
Avec ces valeurs, graine 12345 : fer sur 8,6 % des cases hors montagne, 21,6 %
des montagnes, 11,6 % de la terre. `npm run viz:iron` montre la carte et
recalcule la répartition à chaque mouvement de curseur ; la page affiche les
valeurs à recopier dans `config.ts`.

`generateTestMap` écrit le résultat dans `GameMap.resources`. `hashMap` couvre
`resources` comme `terrain`. `createGame` lève une erreur si `resources` n'a pas
une longueur width × height.

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
  modification (pas par adresse croissante). C'est cette liste que l'affichage
  relira. Elle ne contient pas une case qui passe d'une ville à une autre du
  même joueur : son `owner` ne change pas.
- Toute écriture de `owner` passe par `setOwner`, qui tient à jour le nombre de
  cases de chaque joueur, le nombre de cases de chaque ressource
  (`Player.resourceTiles`) et la liste des cases modifiées.
- Un ordre arrive du réseau : chaque champ est vérifié (`typeof`, entier, dans
  les bornes) avant usage. Un ordre invalide ne modifie rien et n'est pas
  signalé. Un `intents` qui n'est pas un tableau compte comme vide.
- Le champ `player` d'un ordre est écrit par le serveur (règle 4).

### État des villes

Dans `GameState` :

- `cities : City[]` ; la ville `id` est `cities[id - 1]`. Les identifiants sont
  1, 2, 3… dans l'ordre de fondation : plus petit = plus ancienne. Une `City`
  est `{ id, player, tile, port, group }`.
- `tileCity : Uint16Array`, une valeur par case : l'identifiant de la ville dont
  la zone contient la case, 0 = aucune. Les zones couvrent la terre **et** l'eau.
  `owner[t]` vaut `cities[tileCity[t] - 1].player`, ou 0.
- `roads : [a, b][]`, les routes gardées (identifiants, a < b), triées par
  (longueur au carré, a, b) : l'ordre dans lequel le calcul complet les garde.
- `roadNetwork` : toutes les routes candidates, gardées ou non, et leur grille
  (`roads.ts`). Entièrement déduit des villes, il n'entre pas dans le hash ;
  `roads`, qui en sort, y entre.
- Par joueur : `population`, `capital` (identifiant de ville, 0 = aucune),
  `cityIds` (dans l'ordre de fondation), `resourceTiles` (nombre de cases du
  joueur qui portent chaque ressource).

Au plus `MAX_CITIES` = 65 535 villes (`tileCity` est un `Uint16Array`) ; un
ordre au-delà est ignoré. Aucune règle n'en parle : c'est la limite du type.

### `found_city`

`{ type: "found_city", player, tile }` (00-Game §3.3). Les champs sont vérifiés
par `intents.ts` (`tile` entier, 0 ≤ `tile` < nombre de cases), le reste par
`foundCity` (`cities.ts`). L'ordre est valide si :

1. `tile` est de la terre (montagne comprise) ;
2. `tileCity[tile] === 0`. Cela équivaut à « `tile` est dans le rayon de
   contrôle d'aucune ville » : si une ville est à une distance ≤ rayon, la plus
   proche l'est aussi et possède la case (voir Zones) ; inversement, une case
   possédée est à portée de sa ville ;
3. si le joueur a déjà une capitale : `population ≥
   CITY.foundingCostPopulation`, et une de ses villes est à une distance
   ≤ `CITY.expansionRadius` de `tile` (`dx² + dy² ≤ R²`). Les villes des autres
   joueurs ne comptent pas ;
4. sinon (première ville) : aucune autre condition. Elle est gratuite.

Effets, dans cet ordre, une fois toutes les conditions vérifiées (un ordre
refusé ne modifie rien) :

1. population : première ville, `+ POPULATION.initial` ; sinon
   `− CITY.foundingCostPopulation` ;
2. la ville est ajoutée (`cities`, `cityIds` du joueur ; capitale du joueur si
   c'est sa première) ;
3. zones, 4. routes, 5. ports, 6. groupes (voir ci-dessous).

### Zones (00-Game §3.2)

Une case est à la ville la plus proche si celle-ci est à une distance ≤
`CITY.controlRadius` ; à égalité, la plus ancienne. Distances au carré, en
entiers, sans tenir compte du terrain.

Mise à jour à la fondation (`updateZones`) : seules les cases du disque de
contrôle de la nouvelle ville peuvent changer. On parcourt la boîte
englobante du disque (bornée à la carte), ligne par ligne. La nouvelle ville a
le plus grand identifiant : elle prend une case sans ville, ou une case dont la
ville actuelle est strictement plus éloignée. Pour chaque case prise :
`tileCity` est écrit, puis `setOwner(case, joueur de la ville)`. Les villes qui
perdent au moins une case sont notées pour le calcul des ports.

Le résultat est le même qu'un recalcul de toutes les cases par la définition ;
`test/helpers.ts` (`bruteTileCity`) fait ce recalcul et `test/cities.test.ts`
compare.

### Routes (00-Game §3.5)

**Définition** : `computeRoads(tiles, width, height, radius)` (`roads.ts`), le
calcul complet sur toutes les villes, décrit ci-dessous. Les identifiants sont
les rangs + 1. La fondation ne l'appelle plus : elle appelle `addCityToRoads`
(plus bas), qui donne le même résultat. `computeRoads` sert de référence aux
tests et à la mesure.

1. Candidates : toutes les paires à une distance ≤ `radius`, tous joueurs
   confondus. Une grille de cellules de côté `radius` limite la recherche aux 9
   cellules autour de chaque ville.
2. Tri par (distance au carré, plus petit identifiant, plus grand identifiant),
   croissant. C'est un ordre total : le résultat ne dépend pas de
   l'algorithme de tri.
3. Parcours dans cet ordre : une candidate est gardée si elle ne croise aucune
   route déjà gardée. Les routes gardées sont rangées dans une seconde grille,
   dans chaque cellule que recouvre leur boîte englobante ; une candidate n'est
   comparée qu'aux routes des cellules de sa propre boîte. Deux segments qui se
   croisent ont des boîtes qui se recouvrent, donc une cellule commune : aucun
   croisement n'est manqué.
4. Deux routes qui partagent une ville ne sont pas comparées.

Croisement de [a, b] et [c, d] : on calcule le signe de (b − a) × (c − a) et de
(b − a) × (d − a), puis de (d − c) × (a − c) et de (d − c) × (b − c)
(produits vectoriels d'entiers, exacts). Les deux segments se croisent si les
deux premiers signes sont opposés et non nuls, et les deux derniers aussi. Un
alignement ou un contact en bout compte donc comme « pas de croisement » (§7).

**Mise à jour à la fondation** : `addCityToRoads(roadNetwork, case, roads)`.
`roadNetwork` garde toutes les candidates (gardées ou non) d'une partie, avec
une grille par boîte englobante. Une candidate est gardée si aucune candidate
gardée qui la précède dans l'ordre du tri ne la croise ; son état ne peut donc
changer que si une candidate qui la précède et la croise change d'état.
1. Les candidates de la nouvelle ville (villes à distance ≤ rayon) sont
   ajoutées et mises dans une file.
2. On retire de la file la première dans l'ordre du tri, et on calcule son état
   à partir des candidates gardées qui la précèdent et la croisent.
3. Si son état change, `roads` est mis à jour (insertion ou retrait à sa place
   dans l'ordre du tri), et chaque candidate qui la suit dans l'ordre et la
   croise entre dans la file.
4. On recommence jusqu'à ce que la file soit vide.

Une candidate n'entre dans la file que par une candidate qui la précède : quand
elle sort, toutes celles qui la précèdent ont leur état final. Chaque candidate
est traitée au plus une fois, et les routes que la nouvelle ville ne touche pas
ne sont pas relues. `test/cities.test.ts` compare `roads` au calcul complet
après chaque ajout, sur des centaines de villes.

Une ville qui disparaît (pas encore de règle) demandera l'opération inverse.

### Ports (00-Game §3.6)

`port` = la zone de la ville contient au moins une case qui n'est pas de la
terre. Recalculé pour la nouvelle ville et pour chaque ville qui a perdu des
cases : on parcourt la boîte englobante de son disque de contrôle et on cherche
une case de `tileCity` égal à son identifiant et sans le bit `TERRAIN_LAND`.

### Groupes (00-Game §3.5, points 4 et 5)

Recalculés pour toutes les villes à chaque fondation. Les villes sont les
nœuds, les routes dont les **deux** extrémités sont au même joueur sont les
liens (les autres routes existent dans `roads` mais ne servent pas ici). Une
union-find rattache toujours la racine d'identifiant le plus grand à la plus
petite : la racine d'une composante est donc son plus petit identifiant, et
`City.group` est cette racine. Le groupe principal d'un joueur est le groupe de
sa capitale : `cities[capital - 1].group`.

## 5. Le hash

`hashState(state)` : entier 32 bits, étapes de MurmurHash3 sur, dans l'ordre :

1. le hash de la carte (dimensions, `terrain` puis `resources`, calculé une fois
   par `createGame`) ;
2. le numéro de tour ;
3. les 4 mots du générateur aléatoire ;
4. le nombre de joueurs, puis pour chacun : identifiant, nombre de cases,
   population, capitale, nombre de ressources puis `resourceTiles`, nombre de
   villes puis `cityIds` ;
5. le nombre de villes, puis pour chacune : identifiant, joueur, case, port
   (0 ou 1), groupe ;
6. le nombre de routes, puis pour chacune : a, b ;
7. `owner`, deux cases par mot ;
8. `tileCity`, deux cases par mot.

`test/engine.test.ts` change chaque champ des villes l'un après l'autre et
vérifie que le hash change.

## 6. Pièges

- **Ajouter un champ à `GameState` sans l'ajouter à `hashState`** : deux
  clients dont ce champ diffère ne seraient jamais signalés comme
  désynchronisés.
- **Lire un tableau par une vue `Uint32Array` pour hasher plus vite** : l'ordre
  des octets d'une vue dépend de la machine. Le hash assemble ses mots à la
  main.
- **Écrire `state.owner[t] = …` directement** : le nombre de cases du joueur,
  le nombre de cases de ressources et la liste des cases modifiées ne sont pas
  mis à jour. Passer par `setOwner`.
- **Écrire `tileCity` sans `owner`, ou l'inverse** : la condition de fondation
  (`tileCity[tile] === 0`) et les propriétaires ne diraient plus la même chose.
  `updateZones` écrit les deux ensemble.
- **Un propriétaire sur l'eau** : les zones couvrent l'eau, donc `owner` et
  `tileCount` comptent aussi des cases d'eau. Compter des cases de terre
  demande de lire `terrain`.
- **Changer le tri des candidates ou le test de croisement des routes** : le
  réseau change, donc les groupes. Tous les clients doivent avoir la même
  version. Le changer dans `computeRoads` sans le changer dans
  `addCityToRoads` (ou l'inverse) fait échouer les tests de comparaison.
- **Mettre à jour `roads` sans passer par `addCityToRoads`** : `roadNetwork`
  ne le saurait pas, et la fondation suivante partirait d'un état faux.
- **Mettre deux tableaux dans une même fonction de hash** : une fonction
  `mixUint16(h, tableau)` appelée pour `owner` puis `tileCity` a coûté 5 ms par
  hash, contre 0,9 ms avec les deux boucles écrites dans `hashState` (mesuré
  sous Node 24). Le moteur n'en dépend pas pour son résultat, seulement pour sa
  vitesse.
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
- Vérifié le 23 octobre 2026 : un `Math.random()` qui fait refuser un ordre
  `found_city` une fois sur vingt fait échouer le test des deux processus, le
  test des sources, et deux tests d'ordres.

## 7. Choix provisoires, à valider

Choix faits pour que le moteur tourne ; tous peuvent être remis en cause par
`00-Game.md`.

1. Les joueurs sont fixés à la création de la partie (identifiants 1 à n) ;
   pas d'arrivée en cours de partie.
2. Voisinage à 4 cases (pas de diagonales), pour la côte.
3. Côte = case de terre touchant l'eau (et non case d'eau touchant la terre).
4. Hash sur 32 bits : une collision entre deux états différents a environ une
   chance sur 4 milliards par comparaison.
5. Un tour au mauvais numéro lève une erreur (le client devra alors se
   resynchroniser, partie 3).
6. Carte de test 800 × 500 et ses réglages (`src/config.ts`).
7. Zones maritimes : les choix provisoires du prototype sont listés dans
   00-Game §2.1 ; `SEA_ZONES.spacing` et `minBasinArea` sont des valeurs
   d'essai.
8. Villes : `CITY.expansionRadius` (25), `CITY.controlRadius` (10),
   `CITY.foundingCostPopulation` (100) et `POPULATION.initial` (1 000) sont des
   valeurs d'essai, pas des valeurs fixées. Contrainte des règles : rayon
   d'expansion > rayon de contrôle.
9. Croisement de deux routes (00-Game §13 le laisse ouvert) : seul un croisement
   franc compte. Un contact en bout, ou une ville posée exactement sur le
   segment d'une autre route, ne supprime rien. Conséquence : trois villes
   alignées A, C, B peuvent avoir les routes A–C, C–B et A–B, qui se
   recouvrent.
10. Port (00-Game §13 le laisse ouvert) : toute case d'eau de la zone compte,
    lac compris, même dans un bassin sans zone maritime.
11. Les routes ne sont pas recalculées en entier à chaque fondation : seules
    celles que la nouvelle ville touche le sont (§4, Routes), avec le même
    résultat. Demandé par l'auteur le 23 octobre 2026, à la place de la
    proposition de 00-Game §3.5, point 3.
12. Les zones couvrent l'eau et lui donnent un propriétaire (00-Game §3.2 :
    « une case »).
13. Au plus 65 535 villes (type de `tileCity`) ; pas dans 00-Game.

## 8. Mesures

`npm run bench`, sur le PC de l'auteur (Node 24.19), 23 octobre 2026 :

- génération de la carte de test (400 000 cases), fer compris : 150 à 160 ms ;
- zones maritimes sur cette carte (graine 12345, 50 + 50 itérations, 155
  points) : environ 2,5 s, mesuré par `npm run viz:sea` le 22 octobre 2026.
  Une fois par partie ;
- tour moyen sur 10 000 tours, 33 ordres `found_city` par tour (8 joueurs × 4,
  plus un ordre malformé) : 2,4 µs. Chiffre sans valeur pour le vrai jeu : la
  population de départ limite chaque joueur à 11 villes, donc 88 villes au
  total, et presque tous les ordres sont refusés ;
- hash de l'état complet : 0,8 à 0,9 ms (`owner` et `tileCity`, 200 000 mots
  chacun). Envoyé tous les N tours (§8 de 01-Architecture), c'est un coût
  négligeable à côté des 100 ms d'un tour ;
- fondation d'une ville, ordre complet (zones, routes, ports, groupes), avec les
  villes posées au plus serré (lignes tous les 9 cases, villes tous les 11, une
  ligne sur deux décalée de 5 ; 20 joueurs, population illimitée) :

  | Carte | Villes | Fondation n° 100 | n° 500 | n° 1 000 | n° 2 000 | dernières 50 (moyenne, maximum) | pour comparaison : `computeRoads`, toutes les villes |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 800 × 500 (carte de test) | 1 555 (limite de la grille) | 0,10 ms | 0,19 ms | 0,25 ms | — | 0,15 ms, 0,18 ms | 11 ms |
  | 1 600 × 1 000 | 2 100 | 0,09 ms | 0,10 ms | 0,25 ms | 0,32 ms | 0,23 ms, 1,3 ms | 13 ms |

  Avant la mise à jour locale des routes, la fondation recalculait tout le
  réseau : 8,5 ms en moyenne à 1 555 villes, 12,5 ms à 2 100. Ce qui croît
  encore avec le nombre de villes : les groupes, recalculés pour toutes les
  villes. La carte de test ne peut pas porter 2 000 villes (deux villes sont à
  plus de 10 cases l'une de l'autre, et la terre fait 154 000 cases), d'où la
  carte de 1 600 × 1 000.
