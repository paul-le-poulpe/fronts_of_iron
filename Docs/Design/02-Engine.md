# 02 — Moteur

Le moteur (`packages/engine`) calcule l'état d'une partie à partir de ses tours.
Chaque navigateur l'exécute et doit obtenir exactement le même état (règle 2 du
`CLAUDE.md`, 01-Architecture §3).

**Les règles viennent de `00-Game.md`.** Le moteur n'implémente que ce que ce
document décide. Implémenté : les villes (00-Game §3.1 à §3.6 : fondation,
zones, routes terrestres, ports, groupes), la fertilité de la carte (§2), la
population, l'agriculture, la pêche et la nourriture (§4, §4.1, §6.1 à §6.5), et
leurs deux ordres, `found_city` et `set_farm_share` (§4). Pas implémenté :
lignes de production et leurs ouvriers (§4 étape 1), machines (tracteurs et
bateaux de pêche valent 0 : pas d'usine), extraction, usines, armement, routes
maritimes, changement de capitale, disparition d'une ville, commerce, armée,
diplomatie.

---

## 1. Ce qui existe

| Fichier (`packages/engine/`) | Contenu |
| --- | --- |
| `src/config.ts` | tous les nombres réglables (carte de test, nombre maximal de joueurs et de villes, zones maritimes, présence des ressources, rayons des villes, population, nourriture, fertilité, agriculture, pêche) |
| `src/bits.ts` | rotation de bits, étapes de MurmurHash3 |
| `src/rng.ts` | générateur aléatoire xoshiro128** |
| `src/map.ts` | bits du terrain et des ressources, `GameMap`, parcours des 4 voisins |
| `src/noise.ts` | `valueNoise` : bruit de valeur en entiers, commun au relief et aux ressources |
| `src/mapgen.ts` | `generateTestMap(seed)` : terrain, puis présence des ressources, puis fertilité |
| `src/resources.ts` | présence des ressources naturelles (00-Game §2) : `generateResourcePresence`, `resourceNoise`, `presenceThreshold` |
| `src/seazones.ts` | zones maritimes (00-Game §2.1) : `generateSeaZones`, `computeSeaZones`, `landMask` |
| `src/state.ts` | `GameState`, `Player`, `City`, `createGame`, `setOwner` |
| `src/cities.ts` | `foundCity` : validité, zones, ports, groupes (00-Game §3.2 à §3.6) |
| `src/roads.ts` | réseau de routes terrestres (00-Game §3.5) : `addCityToRoads` (mise à jour à chaque fondation), `computeRoads` (calcul complet, référence des tests), `segmentsCross` |
| `src/economy.ts` | population, agriculture, pêche, nourriture (00-Game §4, §6) : `stepEconomy` (une étape par tour), `harvest`, `mechanization`, `mechanizationCurve` |
| `src/intents.ts` | types d'ordres, vérification des champs, `found_city`, `set_farm_share` |
| `src/turn.ts` | `applyTurn(state, { turn, intents })` |
| `src/hash.ts` | `hashMap`, `hashState` |
| `test/*.test.ts` | tests (`npm test`) |
| `test/helpers.ts` | calculs de référence lents (zones par toutes les villes, routes par toutes les paires, groupes par parcours, ports, totaux de fertilité par recomptage, récolte en rationnels exacts avec BigInt) et cartes fabriquées à la main, pour les tests de villes et d'économie |
| `test/economy.test.ts` | tests de la courbe, de la récolte, de l'étape de nourriture, de la croissance avec reste, des totaux de fertilité et de `set_farm_share` |
| `test/scenario.ts` | partie scriptée utilisée par les tests et la mesure : des joueurs simulés envoient des ordres `found_city` (payés par la croissance de la population) et de temps en temps `set_farm_share` |
| `test/bench.ts` | mesure (`npm run bench`) |
| `test/seazones-viz.ts` | visualisation pas à pas des zones maritimes (`npm run viz:sea`) → `out/sea-zones.html`, ignoré par git |
| `test/iron-viz.ts` | visualisation de la présence du fer, avec des curseurs pour les réglages (`npm run viz:iron`) → `out/iron.html`, ignoré par git |
| `test/cities-viz.ts` | visualisation d'une partie scriptée, avec un curseur sur les étapes : zones, fer, routes, villes, capitales, ports, tableau par joueur (population, fermiers, pêcheurs, inactifs, nourriture), surface cultivée et surface pêchée (`npm run viz:cities`) → `out/cities.html`, ignoré par git |

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
- `fertility : Uint8Array`, un octet par case : fertilité 0 à 10 (00-Game §2).
  Montagne et eau : 0. Autre terre : `FERTILITY.land` (§7).
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
largeur depuis le bord marque l'océan, puis la côte est marquée. Ensuite la
présence de chaque ressource (voir plus bas) est calculée sur ce terrain fini,
avec la même graine, et écrite dans le bit de la ressource. Enfin la fertilité :
une case de terre dont l'altitude est ≥ `TEST_MAP.mountainAltitude` (14) est une
montagne, fertilité 0 ; toute autre terre vaut `FERTILITY.land` ; l'eau vaut 0.
`RESOURCES.iron.presence.mountainAltitude` est ce même nombre (une seule
définition de « montagne » : un test vérifie l'égalité).

Le bruit de valeur est dans `noise.ts`, et non dans `mapgen.ts`, parce que
`mapgen.ts` appelle `resources.ts` qui lui-même a besoin du bruit : sans ce
fichier, les deux modules s'importeraient l'un l'autre.

Résultat avec les réglages actuels : un continent central, 30 à 40 % de terre
selon la graine (38,6 % pour la graine 12345), parfois un lac ou un îlot. Pour la
graine 12345, 23,5 % de la terre est montagne (36 378 cases sur 154 484), et le
centre de la carte, vers (400, 250), est une montagne : une ville fondée là n'a
aucune case cultivable.

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
`resources` et `fertility` comme `terrain`. `createGame` lève une erreur si
`resources` ou `fertility` n'a pas une longueur width × height.

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
  tableau, puis fait l'étape de population et de nourriture de chaque joueur
  (« Étape de nourriture », plus bas), passe `state.tick` à `turn`, et renvoie la liste des cases dont le
  propriétaire a été écrit, chacune une fois, dans l'ordre de leur première
  modification (pas par adresse croissante). C'est cette liste que l'affichage
  relira. Elle ne contient pas une case qui passe d'une ville à une autre du
  même joueur : son `owner` ne change pas.
- Toute écriture de `owner` passe par `setOwner`, qui tient à jour le nombre de
  cases de chaque joueur, le nombre de cases de chaque ressource
  (`Player.resourceTiles`), les totaux de fertilité (`farmTiles`,
  `fertilitySum`, `seaTiles`) et la liste des cases modifiées.
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
- Par joueur : `population` (personnes), `growthRemainder` (reste de croissance,
  millionièmes de personne), `farmPercent` (0 à 100, 100 au départ), `capital`
  (identifiant de ville, 0 = aucune), `cityIds` (dans l'ordre de fondation),
  `resourceTiles` (nombre de cases du joueur qui portent chaque ressource),
  `farmTiles` (cases du joueur de fertilité > 0 : `surface_max`), `fertilitySum`
  (somme de leurs fertilités : `fertilité_totale`), `seaTiles` (cases d'eau du
  joueur, mer et lacs), et les résultats du dernier tour : `farmers`, `fishers`,
  `idle`, `cultivated`, `fished`, `wheat`, `fish`, `food`.

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
3. si le joueur a déjà une capitale : `population ≥ foundingCost(n)`, `n`
   étant le nombre de ses villes (`cityIds.length`), et une de ses villes est à une distance
   ≤ `CITY.expansionRadius` de `tile` (`dx² + dy² ≤ R²`). Les villes des autres
   joueurs ne comptent pas ;
4. sinon (première ville) : aucune autre condition. Elle est gratuite.

Effets, dans cet ordre, une fois toutes les conditions vérifiées (un ordre
refusé ne modifie rien) :

1. population : première ville, `+ POPULATION.initial` ; sinon
   `− foundingCost(n)`, calculé avant l'ajout de la ville. `foundingCost`
   (`cities.ts`, exporté pour le client et les bots) : `floor(
   CITY.foundingCostPopulation × (100 + n × CITY.foundingCostIncreasePercent) /
   100)`, en entiers (00-Game §3.3) ;
2. la ville est ajoutée (`cities`, `cityIds` du joueur ; capitale du joueur si
   c'est sa première) ;
3. zones, 4. routes, 5. ports, 6. groupes (voir ci-dessous).

### `set_farm_share`

`{ type: "set_farm_share", player, percent }` (00-Game §4, §9 ; format provisoire,
§7). Valide si `percent` est un entier de 0 à 100. Effet : `farmPercent` du joueur
prend cette valeur. L'ordre est appliqué avec les autres, avant l'étape du tour : il
compte tout de suite.

### Étape de nourriture (00-Game §4, §4.1, §6)

`stepEconomy(state)` (`economy.ts`), appelée par `applyTurn` après tous les ordres du
tour, pour chaque joueur dans l'ordre des identifiants, y compris un joueur sans
ville. Elle utilise la population de ce moment : le coût d'une fondation de ce tour
est déjà retiré. Unités : population en personnes, surfaces en cases, mécanisation
`M` en millièmes de case par travailleur, `m_max` en machines pour 1 000
travailleurs (§7). `S` = 10 000. Pour un joueur :

```
fermiers_disponibles = floor(population × farmPercent / 100)
pêcheurs_disponibles = population − fermiers_disponibles   (pas de ligne de production : §7)

récolte(config, F, machines, surface_max, fertilité_totale, report) :
  X        = F == 0 ? 0 : min(S, floor(machines × 1000 × S / (F × m_max)))
  f        = courbe(X, n)
  M        = M_base + floor((M_max − M_base) × f / S)    calculé avec F seul, pas F + report
  requis   = ceil(surface_max × 1000 / M)           arrondi vers le haut (§7)
  travail  = min(F + report, requis)
  surface  = min(surface_max, floor(travail × M / 1000))
  produit  = surface_max == 0 ? 0 : floor(fertilité_totale × surface / surface_max)

courbe(X, n) : p = S ; n fois : p = floor(p × (S − X) / S) ; f = S − p     (00-Game §6.3)

report (00-Game §4, étape 3) : les disponibles en trop d'un côté vont à l'autre
surplus_fermiers = max(0, fermiers_disponibles − requis_champs)
surplus_pêcheurs = max(0, pêcheurs_disponibles − requis_mer)

blé      = récolte(FARMING, fermiers_disponibles, tracteurs = 0, farmTiles, fertilitySum, surplus_pêcheurs)
rendement_eau = tileYield × 1000 + floor((tileYieldMax − tileYield) × 1000 × f / S)   millièmes, même f que la pêche
poisson  = récolte(FISHING, pêcheurs_disponibles, bateaux = 0, seaTiles, floor(seaTiles × rendement_eau / 1000), surplus_fermiers)
inactifs = population − fermiers − pêcheurs
nourriture = max(blé + poisson, FOOD.minimum)

surplus  = nourriture − population × POPULATION.foodPerHead      (négatif possible)
reste    = reste + surplus × POPULATION.growthPerMillion
delta    = trunc(reste / 1 000 000)                               vers zéro
population = population + delta ; reste = reste − delta × 1 000 000
si population < 0 : population = 0 et reste = 0
```

Résultats écrits dans le joueur : `farmers` = travail des fermiers, `fishers` =
travail des pêcheurs, `idle` = (disponibles − travail) fermiers + pêcheurs,
`cultivated` et `fished` = les deux surfaces, `wheat`, `fish`, `food`. Ils sont
calculés sur la population du début de l'étape (avant `delta`) :
`farmers + fishers + idle` = cette population. La mécanisation est calculée avec les
travailleurs disponibles, pas ceux qui travaillent (00-Game §6.2). Le rayon
d'exploitation (§6.6) n'est pas calculé : la visualisation le fait.

`harvest` (récolte) et `mechanization` sont exportées : les usines fourniront
`tracteurs` et `bateaux` plus tard. Les tests comparent `harvest` à
`bruteHarvest` (`test/helpers.ts`), écrit avec des rationnels exacts (BigInt), sur
4 000 cas tirés au hasard.

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

1. le hash de la carte (dimensions, `terrain`, `resources` puis `fertility`,
   calculé une fois par `createGame`) ;
2. le numéro de tour ;
3. les 4 mots du générateur aléatoire ;
4. le nombre de joueurs, puis pour chacun : identifiant, nombre de cases,
   population, capitale, nombre de ressources puis `resourceTiles`, nombre de
   villes puis `cityIds`, puis `growthRemainder`, `farmPercent`, `farmTiles`,
   `fertilitySum`, `seaTiles`, `farmers`, `fishers`, `idle`, `cultivated`, `fished`,
   `wheat`, `fish`, `food` ;
5. le nombre de villes, puis pour chacune : identifiant, joueur, case, port
   (0 ou 1), groupe ;
6. le nombre de routes, puis pour chacune : a, b ;
7. `owner`, deux cases par mot ;
8. `tileCity`, deux cases par mot.

`test/engine.test.ts` change chaque champ des villes et de l'économie l'un après
l'autre et vérifie que le hash change. Les résultats du dernier tour sont
entièrement déterminés par le reste de l'état, mais ils sont dans `GameState` :
ils sont donc dans le hash (§6).

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
- **Déplacer l'étape de nourriture avant les ordres, ou changer `Math.trunc` en
  `Math.floor`** : tous les clients doivent faire pareil, et les parties déjà
  jouées se rejoueraient autrement. Avec `floor`, une baisse de 0,25 personne par
  tour retire une personne dès le premier tour. Les tests de croissance fixent
  l'arrondi (mutation vérifiée : dernier point de ce chapitre).
- **Retirer le reste de croissance** : une croissance inférieure à une personne
  par tour serait arrondie à 0 à chaque tour, et la population s'arrêterait sous
  son maximum (00-Game §4.1) : avec 0,005 personne par unité de surplus, à
  200 personnes sous le maximum.
- **Écrire un test qui suppose une petite `FOOD.minimum`** : la valeur est
  passée de 50 à 1 500 le 23 octobre 2026, et neuf tests de l'économie
  l'avaient supposée petite (nomades sous le maximum, blé au-dessus du
  minimum). Ils partent maintenant du maximum calculé, pas d'un nombre écrit.
- **Une configuration qui met `M` ou `m_max` à 0** : `harvest` divise par `M` et par
  `F × m_max`. `MechanizationConfig` demande `mechanizationBase` ≥ 1 et
  `maxMachinesPer1000` ≥ 1.
- **Écrire la position d'une ville de test en nombre de cases** : les tests de
  villes, d'économie et de tour l'écrivent à partir des rayons (`R` = contrôle,
  `E` = expansion = 2 R), par exemple `A + R + 1` pour « juste hors de la zone
  de A ». Jusqu'au 23 octobre 2026 elles étaient écrites pour des rayons de 10
  et 25 : changer les rayons faisait échouer une vingtaine de tests. Les cartes
  fabriquées font quelques R de côté. Une liste qui n'est valide qu'à l'arrondi
  près (`economy.test.ts`, totaux de fertilité) donne ses positions en dixièmes
  de R, paires, donc exactes pour R multiple de 5.
- **Tester une géométrie avec `play`** (`cities.test.ts`) : `play` porte la
  population du joueur au coût de sa prochaine ville avant chaque ordre. Sans
  cela, avec un coût de 500 + 500 par ville, la population de départ ne paie
  qu'une ville de plus. Les tests du coût lui-même (`engine.test.ts`,
  `economy.test.ts`) fixent la population à la main.
- **Le scénario par défaut et le surplus négatif** : la population ne baisse
  que quand un joueur perd des cases au profit d'une nouvelle ville voisine.
  Avec des villes chères et de grandes zones, la carte se remplissait avant que
  les populations atteignent leur maximum, et le test de déterminisme ne voyait
  plus aucune baisse. `DEFAULT_SCENARIO.foundMinPopulation` vaut donc 6 000
  (600 avant) : les joueurs simulés fondent plus tard, à population plus grande
  (environ 4 000 tours-joueurs de baisse sur 10 000 tours).
- **Lire la population juste après un ordre dans `applyTurn`** : l'étape du même
  tour l'a déjà changée. Les tests qui vérifient le coût exact d'une fondation
  appliquent l'ordre seul (`applyIntent`), sans étape.
- **Une ville au centre de la carte de test** : c'est une montagne, fertilité 0.
  Sa population baisse vers `FOOD.minimum`. Les tests de croissance utilisent des
  cartes fabriquées à la main (`customMap`).
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
- Ordres de grandeur de l'économie, tous très en dessous de 2⁵³ (≈ 9 × 10¹⁵) :
  `machines × 1000 × S` (10⁷ par machine), `fertilité_totale × surface` (≤ 4 × 10⁶ ×
  4 × 10⁵ sur la carte de test), `surplus × growthPerMillion` (5 × 10¹² pour une
  population de 10⁹, valeur que `bench.ts` atteint). Les divisions par
  `Math.floor` et `Math.ceil` sont exactes tant que le numérateur reste sous 2⁵³.
- Vérifié le 23 octobre 2026 : un `Math.random()` qui fait refuser un ordre
  `found_city` une fois sur vingt fait échouer le test des deux processus, le
  test des sources, et deux tests d'ordres.
- Vérifié le 23 octobre 2026, une règle cassée à la fois : retirer le reste de
  croissance fait échouer 8 tests ; arrondir `requis` vers le bas, 5 ; ne pas
  faire l'étape des joueurs sans ville, 7 ; `Math.floor` à la place de `Math.trunc`,
  1. Le test de déterminisme ne les voit pas (ils restent déterministes), les
  tests de l'économie, si.

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
8. Villes : `CITY.expansionRadius` (50, le rayon de contrôle en est la moitié :
   25), `CITY.foundingCostPopulation` (500), `CITY.foundingCostIncreasePercent` (100)
   et `POPULATION.initial` (1 000) sont des valeurs d'essai, pas des valeurs
   fixées. Contrainte des règles : rayon
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
14. Fertilité sur la carte (décision de l'auteur, 23 octobre 2026) : montagne =
    altitude ≥ `TEST_MAP.mountainAltitude` (14, la même valeur pour le fer) →
    fertilité 0 ; eau → 0 ; toute autre terre → `FERTILITY.land`. Le nombre
    `FERTILITY.land` (5, sur 0 à 10) est une valeur d'essai.
15. Cases de pêche : toutes les cases d'eau (océan ou lac, comme pour le port,
    point 10) des zones du joueur. Le rendement d'une case d'eau va de
    `FISHING.tileYield` (3 sans bateau, rapport 3 pour 5 donné par l'auteur) à
    `FISHING.tileYieldMax` (6 avec le maximum de bateaux, « environ le double »
    selon l'auteur), sur la même courbe que la mécanisation (00-Game §6.4,
    `waterYieldMilli`). Sans usine, il n'y a pas de bateau : le rendement reste 3.
16. Totaux par joueur tenus à jour dans `setOwner`, comme `resourceTiles` :
    `farmTiles`, `fertilitySum`, `seaTiles`.
17. Répartition fermiers / pêcheurs : `farmPercent`, entier 0 à 100, part de la
    population hors usines qui devient fermiers ; le reste devient pêcheurs. 100
    au départ. Ordre `set_farm_share { player, percent }`, valide si `percent` est
    un entier de 0 à 100 (00-Game §9 : format à définir). Le report (00-Game §4,
    étape 3, règle de l'auteur) envoie le surplus d'un côté vers l'autre : un
    joueur sans case d'eau a tous ses travailleurs aux champs.
18. Unités : la population est un nombre de personnes ; les surfaces sont des
    cases ; `M` est en millièmes de case par travailleur ; `m_max` est en machines
    pour 1 000 travailleurs. Tracteurs et bateaux de pêche valent 0 (pas
    d'usine) ; la formule complète est écrite, avec `machines` en entrée.
19. `fermiers_requis` arrondi vers le haut : assez de fermiers pour couvrir toute
    la surface (00-Game §13 laisse l'arrondi ouvert).
20. Croissance : un négatif est arrondi vers zéro (`Math.trunc`) ; 00-Game §4.1
    laisse le sens à la session du moteur. Le reste garde son signe, la hausse
    et la baisse sont symétriques. Population jamais sous 0 (reste remis à 0).
21. Ordre dans un tour : tous les ordres, puis l'étape pour chaque joueur dans
    l'ordre des identifiants. Un joueur sans ville fait aussi l'étape : sans
    terre ses fermiers sont inactifs et sa nourriture vaut `FOOD.minimum`
    (nomades, 00-Game §4).
22. Répartition de la population (00-Game §4) : sans ligne de production, toute
    la population va à l'étape 2 (fermiers et pêcheurs), puis à l'étape 3 (inactifs).
23. Résultats du dernier tour (`farmers`, `fishers`, `idle`, `cultivated`, `fished`,
    `wheat`, `fish`, `food`) gardés dans le joueur et hachés.
24. Valeurs d'essai de l'économie : `POPULATION.foodPerHead` 1,
    `POPULATION.growthPerMillion` 5 000 (0,5 % du surplus par tour ; 1 000 était
    cinq fois plus lent), `FARMING` et `FISHING` : `mechanizationBase` 300,
    `mechanizationMax` 1 500, `maxMachinesPer1000` 100, `curveExponent` 2.
    Aucune n'est fixée (00-Game §10). `FOOD.minimum` vaut 1 500, valeur donnée
    par l'auteur le 23 octobre 2026 (50 avant). Pour comparer : une ville en
    terre cultivable (317 cases) produit au plus 1 585.

## 8. Mesures

`npm run bench`, sur le PC de l'auteur (Node 24.19), 23 octobre 2026 :

- génération de la carte de test (400 000 cases), fer compris : 150 à 160 ms ;
- zones maritimes sur cette carte (graine 12345, 50 + 50 itérations, 155
  points) : environ 2,5 s, mesuré par `npm run viz:sea` le 22 octobre 2026.
  Une fois par partie ;
- tour moyen sur 10 000 tours, 8 joueurs, 33 ordres par tour (`found_city`, un
  `set_farm_share` de temps en temps, un ordre malformé), étape de nourriture
  comprise : 5,5 µs, 94 villes fondées (rayons 50 et 25, coût 500 + 500 par
  ville ; les joueurs simulés fondent quand leur population atteint 6 000).
  Presque tous les ordres sont refusés, donc ce chiffre mesure peu le vrai jeu.
  Avec les rayons 25 et 10, un coût fixe de 100 et un seuil de 600 : 5,6 à
  6,2 µs, 486 villes. Avant le bloc population : 2,4 µs, avec 88 villes ;
- étape de nourriture seule (`stepEconomy`) : 1,8 µs pour 8 joueurs, 24 µs pour
  100 joueurs, soit environ 0,2 µs par joueur (rayons 25 et 10 : 0,8 µs et
  10,6 µs : les zones sont plus petites) ;
- 100 joueurs, un ordre par joueur et par tour (101 avec l'ordre malformé),
  3 000 tours, 177 villes (1,8 par joueur) : tour moyen 34 µs, étape de
  nourriture comprise (rayons 25 et 10, coût fixe : 1 037 villes, 44 à 45 µs) ;
- hash de l'état complet : 0,7 à 0,9 ms (`owner` et `tileCity`, 200 000 mots
  chacun ; la fertilité est dans le hash de la carte, calculé une fois). Envoyé tous les N tours (§8 de 01-Architecture), c'est un coût
  négligeable à côté des 100 ms d'un tour ;
- fondation d'une ville, ordre complet (zones, routes, ports, groupes), avec les
  villes posées au plus serré (pour un rayon de contrôle R : lignes tous les
  0,9 R cases, villes tous les 1,1 R, une ligne sur deux décalée de 0,5 R,
  arrondis vers le haut ; 20 joueurs, population illimitée). Rayons 50 et 25,
  23 octobre 2026 :

  | Carte | Villes | Fondation n° 100 | n° 500 | dernières 50 (moyenne, maximum) | pour comparaison : `computeRoads`, toutes les villes |
  | --- | --- | --- | --- | --- | --- |
  | 800 × 500 (carte de test) | 241 (limite de la grille) | 0,14 ms | — | 0,13 ms, 0,54 ms | 1,3 ms |
  | 1 600 × 1 000 | 891 (limite de la grille) | 0,12 ms | 0,15 ms | 0,16 ms, 0,25 ms | 2,5 ms |

  Avec les rayons 25 et 10 (grille plus dense) : 1 555 villes sur la carte de
  test (fondation n° 1 000 : 0,25 ms ; `computeRoads` : 11 ms), 2 100 sur la
  grande carte (n° 2 000 : 0,32 ms ; `computeRoads` : 13 ms).

  Avant la mise à jour locale des routes, la fondation recalculait tout le
  réseau (rayons 25 et 10) : 8,5 ms en moyenne à 1 555 villes, 12,5 ms à 2 100.
  Ce qui croît encore avec le nombre de villes : les groupes, recalculés pour
  toutes les villes. La carte de test porte peu de villes (deux villes sont à
  plus du rayon de contrôle l'une de l'autre, et la terre fait 154 000 cases),
  d'où la carte de 1 600 × 1 000.
