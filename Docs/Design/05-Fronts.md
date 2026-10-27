# 05 — Fronts terrestres (version 1)

**Ce document fait foi pour les fronts terrestres** : détection des fronts,
unités, affectation des troupes, attaques, combat, avancée, prise de ville,
encerclement, et leur interface. Il remplace 00-Game §3.8, qui n'en garde
qu'un résumé. Règles décidées avec l'auteur les 25 et 26 octobre 2026.

- **Historique** : `05-Fronts-History.md` garde les discussions, avec les
  règles remplacées ensuite. Il ne fait pas foi ; ne jamais implémenter à
  partir de lui.
- **Choix provisoires** : ce que l'auteur n'a pas tranché mais qu'il faut
  bien choisir pour implémenter est marqué « *provisoire* » et listé au §15.
  Tout le reste est décidé.
- **Hors périmètre** : fronts aériens et maritimes, avions, barrage
  d'artillerie, bots (§16).
- C'est la **version 1** des fronts : elle pourra changer.

**État (26 octobre 2026)** : les étapes 1 à 3 du §14 sont implémentées, moteur
et client : détection des fronts, affectation des troupes, mobilisation forcée,
ordres, guerre et paix, fondation en guerre, attaques, rounds de combat,
percées, prise de ville, encerclement, interface (liste, panneau, zones, double
ligne rouge, deux ronds de soldats sur chaque connexion, onglet Population, barre jaune de
l'armement), `npm run viz:fronts`. **Pas fait** : les bots (étape 4), le barrage
d'artillerie (bouton sans effet), la percée sur plusieurs axes à la fois. Le
moteur est décrit dans `02-Engine.md` (fichiers, état, hash, tour), le client
dans `03-Client.md`. Ordre d'implémentation au §14.

**Pour reprendre** (fin de la session du 26 octobre 2026) :

- **Code** : moteur `packages/engine/src/` : `config/fronts.ts`, `units.ts`, `fronts.ts`, `troops.ts`, `attacks.ts`,
  `combat.ts`, `conquest.ts` (liste et rôle de chacun : `02-Engine.md` §1) ; client `client/src/` : `frontgeom.ts`,
  `frontlayer.ts`, `frontpanel.ts`, `blink.ts`, plus `infobar.ts`, `main.ts`, `mirror.ts`, `painter.ts`, `render.ts`,
  `solo.ts` (`03-Client.md` §2). Tests : `npm test` (aucun échec ; `fronts`, `troops`, `combat`, `determinism` côté moteur,
  `fronts` côté client). Visualisation : `npm run viz:fronts`.
- **Essayer à la main** (mode solo) : fonder une ville à 1,5 rayon de contrôle d'un bot, « Armer les bots » et « + armement »
  (barre de debug, `03-Client.md` §3), ajouter de la population si besoin (« +1 000 population » : les soldats se recrutent
  parmi les inactifs seulement), déclarer la guerre par le menu de diplomatie (clic sur le territoire du bot, loin de la zone
  de front), ouvrir le front par la liste (barre d'informations) ou par un clic dans sa zone. Pour une percée : décocher
  « Motorisé seulement » (aucune unité motorisée n'existe) et avoir des unités en seconde ligne.
- **Décisions de l'auteur à cette étape** (déjà dans le texte ci-dessous) : soldats avant les inactifs (§11.5) ; retrait des
  troupes par priorité (§3, §4.7) ; zones de front au demi-rayon de contrôle (§11.1) ; mode choix d'axe qui se désactive
  après une percée (§11.1) ; percée dessinée en segment droit avec une flèche de 14 px (§11.1) ; contour de survol épais, sans
  clignotement, et 1 s par cycle pour les clignotements du panneau (§11.1, §11.3) ; interrupteur `◀ = ▶` et colonne « prio »
  (§11.3).
- **Non vérifié à l'écran** : les tableaux de percées du panneau (§11.3, point 3) et les couleurs d'un front en paix au
  survol ; vérifiés seulement par lecture du code et par les tests de géométrie.
- **Pas fait** : bots (§14, étape 4), barrage d'artillerie, percée multi-axes,
  unités motorisées (aucune dans `config/units.ts`), fronts aériens et maritimes (§16). Les choix provisoires à valider avec
  l'auteur sont au §15.
- **Tests** : l'auteur demande des tests minimaux (déterminisme avec fronts actifs, un round, une prise) ; ne pas en ajouter
  sans qu'il le demande, et ne lancer la suite qu'une fois à la fin.

---

## 1. Vocabulaire et échelle

| Terme | Sens |
| --- | --- |
| **Connexion** | une route terrestre (00-Game §3.5) dont les deux villes appartiennent à deux joueurs différents |
| **Groupe**, ou **île** | les villes d'un joueur reliées entre elles par ses propres routes (00-Game §3.5, `City.group`) ; deux groupes du même continent non reliés par la terre comptent pour deux |
| **Front** | toutes les connexions entre un groupe d'un joueur et un groupe d'un autre joueur |
| **Front actif** | front entre deux joueurs en guerre (00-Game §1, Diplomatie) |
| **Front en paix** | front entre deux joueurs qui ne sont pas en guerre : une frontière, front potentiel |
| **Ligne** | un front a une **première ligne** (subit les attaques en premier, tient la largeur du front) et une **seconde ligne** (unités mobiles, percées et contre-attaques) |
| **Niche** | un rôle sur le front (infanterie, antichar…), rempli par un ou plusieurs types d'unités rangés du meilleur au moins bon |
| **Unité** | un paquet : une unité d'infanterie = 10 personnes, 10 fusils, 10 m de front. Le moteur compte des unités par type, jamais des soldats un par un |
| **Round** | un tour de combat, tous les `FRONTS.combatTurns` tours du moteur (10 : une seconde) |
| **Position** | où se trouve le front sur une connexion, en **millièmes** de la longueur de la route (entier de 0 à 1 000) |

**Échelle** (repère de l'auteur, pas une règle du moteur) : le rayon de
contrôle d'une ville vaut environ **10 000 m** ; avec 25 cases, une case fait
environ 400 m (00-Game §3.1).

**Entiers partout dans le moteur** (CLAUDE.md, règle 2). Les multiplicateurs
de `config/units.ts`, écrits en décimal (deux décimales au plus), sont
convertis une fois en entiers à l'échelle 100 (§3). **Arrondi** : au plus
proche, 0,5 vers le haut, partout où ce document dit « arrondi ». En entiers :
`arrondi(p / q) = floor((2p + q) / (2q))` pour `p ≥ 0`, `q > 0`.

## 2. Détection des fronts

### 2.1 Entrée : la liste des routes

Le système des fronts ne lit que le résultat du système des routes :
`state.roads`, `City.player`, `City.group`. Il suppose seulement que :

- `state.roads` est un tableau de paires `[a, b]` d'identifiants de villes,
  `a < b`, chaque paire au plus une fois ;
- `City.group` est à jour quand les fronts sont recalculés.

Il ne suppose **pas** l'ordre du tableau, ni qu'un indice désigne toujours la
même route (`addCityToRoads` insère et retire avec `splice`), ni la règle de
construction des routes, ni que les zones des deux villes se touchent. Le
système des routes peut être remanié sans toucher aux fronts.

### 2.2 Connexions et fronts

- **Connexion** : paire `[a, b]` de `state.roads` avec
  `cities[a − 1].player ≠ cities[b − 1].player`.
- **Orientation** : `p1 < p2` les deux joueurs ; `city1` la ville de `p1`,
  `city2` celle de `p2`.
- **Front** : clé `(g1, g2)`, `g1` groupe de `city1`, `g2` groupe de `city2`.
  Un identifiant de groupe est un identifiant de ville, unique tous joueurs
  confondus.
- **Un front est symétrique** : les deux joueurs voient le même front. Si le
  groupe g de A touche deux groupes de B, il y a deux fronts, (g, B₁) et
  (g, B₂).
- **Classement pour chaque joueur** : par groupe du joueur (« île »), puis par
  adversaire. Sous un même adversaire, une île peut avoir plusieurs fronts. Un
  joueur peut avoir plusieurs fronts contre le même adversaire sur des îles
  différentes.
- **Largeur du front** = nombre de connexions × `FRONTS.metersPerConnection`
  (**5 000 m**). Calculée à la lecture, jamais stockée.

### 2.3 Fronts en paix et en guerre

Les fronts existent en paix comme en guerre. **Ils sont gérés de la même
façon** (troupes, réglages, panneau, zone sur la carte) ; en paix, ils sont
simplement inactifs : pas de position, pas d'attaque, pas de combat.

- **Déclaration de guerre** (ordre `declare_war`, 00-Game §1) : chaque
  connexion de chaque front entre les deux joueurs reçoit la position
  **500** (le milieu de la route).
- **Paix** : on supprime tout ce qui tient à la guerre active : positions,
  attaques, percées en cours. **Les troupes restent** sur le front. Les
  frontières reviennent au partage de Voronoi (00-Game §3.2).
- **Attaques seulement en guerre** (00-Game §1 : la guerre est le seul statut
  où le combat est possible).

### 2.4 Recalcul

La table des fronts est recalculée quand les routes ou le propriétaire d'une
ville changent : fondation, prise d'une ville. Jamais à chaque tour.
Étapes (`updateFronts`) :

1. **Anciennes connexions** indexées par `(p1, p2, city1, city2)`. Les joueurs
   font partie de la clé (piège, §13.6).
2. **Nouvelles connexions** : parcourir `state.roads`, garder les paires de
   joueurs différents, orienter, calculer la clé `(g1, g2)`.
3. **Positions** (fronts actifs seulement) : une connexion retrouvée à
   l'étape 1 garde sa position ; une nouvelle connexion reçoit 500, sauf
   après une prise (§10.1). *Provisoire* : une nouvelle connexion créée en
   guerre par une fondation reçoit 500.
4. **Fronts** : regrouper les connexions par clé `(g1, g2)`. Identifiant
   stable : voir §2.5.
5. **Ordre** : fronts par identifiant croissant, connexions par
   `(city1, city2)`. L'ordre ne dépend ni de `state.roads` ni d'une `Map`.

### 2.5 Quand un front change de taille

Fusion, coupure, ville prise ou perdue, nouvelle connexion : **pas de règle
d'identité à part** (décision de l'auteur).

- **Fusion** : les troupes des fronts fusionnés sont mises ensemble.
- **Ensuite, dans tous les cas**, le front se recale sur son besoin (§4) :
  les unités en trop repartent vers la réserve du pays (avec le délai de
  transfert, §4.5), le manque est pris dans la réserve par l'affectation
  normale.
- *Provisoire* — **coupure** : les troupes du front coupé sont partagées entre
  les morceaux au prorata de leur nombre de connexions (arrondi, reste au
  morceau de plus petit identifiant).
- *Provisoire* — **identifiant et réglages** (priorité, interrupteurs,
  réassignation) d'un front fusionné ou coupé : ceux de l'ancien front qui
  partage le plus de connexions avec lui (mêmes `city1`, `city2`) ; à
  égalité, le plus petit identifiant ; un ancien identifiant n'est repris
  qu'une fois ; sinon un nouvel identifiant (`nextFrontId`) et les réglages
  par défaut.
- **Nouveau front** : priorité 1, réassignation non autorisée, interrupteur
  de chaque type sur « priorité première ligne », interrupteur « Motorisé
  seulement » allumé.

## 3. Unités

Fichier : `packages/engine/src/config/units.ts` (déjà écrit, commenté en
tête). Attributs d'un type d'unité :

| Champ | Sens |
| --- | --- |
| `equipment`, `equipmentCount` | un seul type d'équipement (un armement de `config/armament.ts`), en `equipmentCount` exemplaires par unité (infanterie : 10 fusils) |
| `population` | personnes pour opérer l'équipement (infanterie 10 ; artillerie 10 ; canons 5 ; mitrailleuse 1 ; chenillette 10) |
| `icon`, `description` | affichage ; description absente : celle de l'équipement (`ProductConfig.description`) |
| `softAttack`, `hardAttack`, `airAttack` | attaques anti-infanterie, antiblindée, antiaérienne (antiaérienne : hors périmètre, valeur sans effet) |
| `releasePriority` | priorité de retrait, de 1 à 10 (§4.7) : 10 est retirée du front en premier, 1 en dernier. Infanterie 10, équipement 5, chars 1 (valeurs de l'auteur) |
| `frontWidth` | mètres par unité en première ligne |
| `breakthroughWidth` | mètres par unité en seconde ligne (percée, contre-attaque). Absente : `frontWidth` |
| `damageType` | `infantry`, `armor` ou `equipment` : comment l'unité est perdue (§7.3) |
| `hitPoints` | infanterie et blindés : PV d'une unité, sert seulement à compter les unités détruites |
| `lossMultiplier` | équipement : rend l'équipement plus résistant (< 1) ou plus fragile (> 1) que l'infanterie qu'il accompagne. Absent : 1 |
| `movement` | `foot` ou `motorized`. Un véhicule très lent compte à pied |
| `attackMultiplier` | appliqué quand l'unité attaque ; aucun multiplicateur en défense |
| `breakthroughMultiplier` | appliqué quand une unité de seconde ligne attaque la première ligne adverse (percée). Absent : `attackMultiplier` |
| `counterAttackMultiplier` | appliqué pour repousser une percée (seconde ligne du défenseur). Absent : `attackMultiplier` |

- **Multiplicateurs** : décimaux, deux décimales au plus ; convertis au
  chargement en entiers à l'échelle 100 (`Math.round(x × 100)`), puis
  `dégâts × multiplicateur / 100`, division entière à la fin du calcul. Un
  test refuse une troisième décimale.
- **Un seul niveau de blindage** : tous les blindés sont équivalents.
- **Une unité perdue l'est en entier**, hommes et matériel ensemble (sa
  population et ses `equipmentCount` équipements disparaissent).
- **Niches** (`NICHES`, même fichier) : une liste de types par niche, du
  meilleur au moins bon ; chaque type dans une seule niche. Aujourd'hui :
  `infantry`, `machineGun`, `artillery`, `antiTank`, `antiAir`,
  `assaultTank` (chenillette). Les types de `damageType` `infantry` forment
  l'infanterie au sens des règles ci-dessous (déséquilibre, plafond, seuils).

## 4. Affectation des troupes

### 4.1 Recrutement : population et équipement

- Une unité se forme avec `equipmentCount` équipements pris dans la **réserve
  d'armement** du joueur (00-Game §8.3) et `population` personnes.
- **Soldats dans la répartition de la population** (00-Game §4) : pris **en
  dernier**, après tous les autres rôles, donc seulement parmi les inactifs.
- **Mobilisation forcée** (interrupteur du joueur, éteint par défaut) : les
  soldats passent **en premier**, avant les lignes de production. On recrute
  alors pour remplir chaque front jusqu'au pourcentage de sa priorité ; le
  reste de la population retourne aux autres rôles.
- *Provisoire* : les soldats déployés et en route restent comptés dans la
  population (ils mangent, comptent pour la croissance) mais ne travaillent
  pas ; la répartition du §4 de 00-Game se fait sur `population − soldats
  déployés et en route`, puis le recrutement de nouveaux soldats prend parmi
  les inactifs (ou avant les lignes en mobilisation forcée).
- **Les soldats sont la dernière occupation avant l'inactivité** (décision de
  l'auteur, 26 octobre 2026) : les lignes, les fermiers et les pêcheurs passent
  avant eux. Quand les personnes qui ne sont pas des soldats ne leur suffisent pas,
  des unités sont retirées des fronts (§4.7) ; en mobilisation forcée, c'est
  l'inverse.
- Une unité qui revient d'un front rend sa population à la répartition et ses
  équipements à la réserve, à l'arrivée.

### 4.2 Remplissage d'un front

**Première ligne** — chaque niche couvre **toute la largeur du front**, en
mètres :

1. dans une niche, on prend les types **du meilleur au moins bon** : le plus
   de largeur possible avec le premier, puis le suivant ;
2. **plafond par l'infanterie** : dans une ligne, les mètres occupés par
   chaque niche d'équipement (`damageType` `equipment`) ne dépassent pas les
   mètres occupés par l'infanterie de cette ligne. Infanterie à 50 % → au plus
   50 % de chaque équipement ; sans infanterie, aucun équipement ;
3. couverture d'une niche ou d'un type = `unités × frontWidth / largeur du
   front`, en %.

**Seconde ligne** — **plafonnée à `FRONTS.maxSecondLineOvercrowding` fois la
largeur du front** (`N`, **2** pour commencer, décision de l'auteur, 26 octobre
2026), comptée en **largeurs de percée** (`breakthroughWidth`) : la seconde
ligne tient donc `N` fois la population de la première ligne, davantage pour
les types dont la largeur de percée est plus petite que leur largeur de
première ligne. Comme la première ligne, chaque niche couvre cette largeur
(*provisoire* : un plafond par niche, pas un plafond pour toute la seconde
ligne). Ce qui ne trouve pas sa place en première ligne y va, **toujours
plafonné par l'infanterie**, compté en largeur de percée : mètres de chaque
niche d'équipement ≤ mètres de l'infanterie de la seconde ligne (exemple : 30
infanteries, 300 m → au plus 3 artilleries de 100 m). Ce qui dépasse encore
reste **en stock** (réserve d'armement, sans population) ; un camp dont la
seconde ligne dépasse le plafond (largeur du front réduite, interrupteur
changé) renvoie l'excédent à la réserve avec le délai du §4.5.

**Type autorisé ou non**, par front et par type d'unité (case à cocher du panneau,
cochée par défaut ; décision de l'auteur, 26 octobre 2026) : un type refusé ne
reçoit rien sur ce front (ni première ligne, ni seconde ligne) et ses unités
qui y sont **repartent vers la réserve** avec le délai du §4.5 ; celles qui y
étaient en route font demi-tour (même délai). Les autres fronts du joueur
peuvent les recevoir. *Provisoire* : les unités d'une percée en cours partent
aussi.

**Interrupteur à trois positions**, par front et par type d'unité (réglé par
le joueur ; par défaut « priorité première ligne ») :

| Position | Effet pour ce type sur ce front |
| --- | --- |
| priorité première ligne | la règle ci-dessus : première ligne d'abord, le surplus en seconde |
| équilibré | **même pourcentage du front** dans les deux lignes : `a × frontWidth ≈ b × breakthroughWidth` |
| priorité seconde ligne | tout en seconde ligne, jusqu'à son plafond ; rien ne déborde vers la première, l'excédent reste en stock |

**Renfort de la première ligne** (décision de l'auteur, 26 octobre 2026) : pour un
type sur « priorité première ligne » **ou « équilibré »**, quand la première
ligne perd des unités au combat, la **seconde ligne les remplace aussitôt**,
sans délai ; l'affectation du §4.3 ne demande du matériel à la réserve que pour
ce qui manque ensuite. Priorité première ligne : tant que la seconde ligne en
a. Équilibré : jusqu'à la part de la première ligne de la formule ci-dessous,
calculée sur le total du type (les deux lignes gardent le même pourcentage du
front ; la seconde ligne n'est donc pas vidée). Le renfort se fait à la fin des pertes de chaque round (§6),
avant les vérifications de percée et l'avancée. *Provisoire* : pour les deux
camps ; les unités qu'une percée engage restent en seconde ligne ; l'équipement
de la seconde ligne que l'infanterie restante ne couvre plus (plafond, ci-dessus)
repart vers la réserve avec le délai du §4.5.

Équilibré, en entiers, pour `u` unités du type sur ce front, `w1` largeur de
front, `w2` largeur de percée : première ligne `a = floor(u × w2 / (w1 + w2))`,
seconde ligne `b = u − a`. Si `a` dépasse la place libre en première ligne, le
surplus passe en seconde. Le plafond par l'infanterie s'applique ensuite dans
chaque ligne.

### 4.3 Entre les fronts : priorités

- Chaque front a une **priorité** réglée par le joueur : 1, 2 ou 3. **La
  priorité n'est qu'un pourcentage** : `FRONTS.priorityPercent = [100, 50, 0]`.
  Toutes les règles lisent le pourcentage, jamais le niveau (un niveau à 25 %
  pourra s'ajouter).
- **Première ligne** : besoin d'un front = ce qu'il faut pour remplir ses
  niches (§4.2). Paliers :
  1. chaque front jusqu'à `pourcentage × besoin` ;
  2. puis chaque front jusqu'à 100 %, par pourcentage décroissant (un palier
     par pourcentage distinct).

  **Dans un palier**, si le matériel ne suffit pas, chaque front reçoit en
  proportion de son manque : `A × manque / Σ manques` (`A` = quantité à
  répartir, `manque` = objectif du palier − ce qu'il a, en unités). Chaque
  front comble ainsi la même fraction de son manque. Exemple de l'auteur : un
  front à 40 % pour 50 % et un front à 80 % pour 100 %, de même besoin,
  reçoivent un tiers et deux tiers.
- **Seconde ligne** : cible d'un front pour un type =
  `total du type en seconde ligne × pourcentage × largeur / Σ (pourcentage ×
  largeur)`. Exemple : 150 chars, trois fronts de même largeur à 100 %, 50 %,
  0 % → 100, 50, 0. Tous les fronts à 0 % : partage égal. Le matériel nouveau
  comble les écarts aux cibles comme en première ligne.
- **Calcul type par type**, niche par niche, du meilleur type au moins bon ;
  manque exprimé en unités du type (`ceil(manque en mètres / largeur du
  type)`).
- **Arrondi** des parts : partie entière, puis une unité de plus aux fronts de
  plus grand reste, à égalité au plus petit identifiant de front.

### 4.4 Flux : ce qui est réparti

- **Par défaut, une unité déjà sur un front y reste** ; seul le matériel
  nouveau est réparti (unités formées à partir de la réserve et de la
  population, unités revenues d'un front).
- **Réassignation** : option du joueur, par front, « Autoriser la
  réassignation à d'autres fronts », désactivée par défaut. *Provisoire* : les
  unités d'un front qui l'autorise entrent dans la quantité à répartir, comme
  la réserve ; elles peuvent donc partir vers un autre front qui en a besoin.
- La répartition tourne à **chaque tour** du moteur.

### 4.5 Délai de transfert

- Tout mouvement entre la réserve et un front, aller ou retour, prend
  `FRONTS.transferTurns` tours (**50**, 5 s).
- Chaque front garde la liste de ses mouvements en cours (camp, type d'unité,
  nombre, sens, ligne visée, tour d'arrivée), dans l'état et le hash ; à
  chaque tour, ceux dont le tour d'arrivée est atteint sont appliqués.
- **La répartition compte les unités en route vers un front comme déjà
  présentes** ; sinon elle renverrait le même manque à chaque tour pendant le
  délai.
- Une unité en route ne combat pas ; sa population ne travaille pas.
- Les mouvements **entre lignes d'un même front** (survivants d'une percée,
  véhicules du défenseur, changement d'interrupteur *provisoire*) sont
  **sans délai**.

### 4.6 Réserve d'armement et déclin

- L'équipement des fronts (déployé et en route) **compte** dans le stock qui
  décline (00-Game §8.3).
- La production d'armement **ne s'arrête jamais** ; seul l'excès au-dessus du
  stock cible décline. Le déclin ne retire que l'équipement **non déployé** :
  si l'équipement des fronts dépasse à lui seul le stock cible, le stock non
  déployé décline vers zéro et la production continue.

### 4.7 Retrait des troupes

Un pays dont la population hors soldats ne suffit pas à ses lignes de production, à ses
fermiers et à ses pêcheurs (les emplois qu'il ferait tourner avec toute sa population,
§4.1) **retire des unités des fronts** pour les leur rendre, à chaque tour, du manque :

1. **Quelles unités** : celles de plus haute `releasePriority` d'abord (10 : les moins
   importantes à retirer, retirées en premier ; 1 : en dernier), donc l'infanterie, puis
   l'équipement, puis les chars. Un camp qui perd de l'infanterie est recalé (§2.5) :
   son équipement en trop part avec elle, puisqu'il est plafonné par l'infanterie.
2. **Où** (*provisoire*) : dans les fronts de plus basse priorité d'abord (à égalité,
   de plus grand identifiant), la seconde ligne avant la première, sans toucher aux
   unités qu'une percée engage.
3. **Délai** : les unités retirées retournent à la réserve avec le délai de transfert
   (§4.5), et leur population ne travaille qu'à leur arrivée. Les personnes déjà en
   chemin de retour comptent dans le manque : on ne retire pas deux fois les mêmes.
4. **Mobilisation forcée** : rien n'est retiré ; les soldats passent avant les emplois.

## 5. Attaques : types et ordres

| Type | Qui tire | Avancée |
| --- | --- | --- |
| **Attaque sur tout le front** (assaut généralisé) | toute la première ligne des deux camps | sur toutes les routes du front (§8.1) |
| **Percée** | la seconde ligne de l'attaquant, sur une connexion choisie (l'axe) | seulement sur l'axe (§8.2) |
| **Barrage d'artillerie** | hors périmètre | aucune ; des pertes seulement |

- Les boutons d'attaque sont des **interrupteurs** : un clic lance, un second
  arrête.
  - attaque sur tout le front : dure jusqu'à ce que le joueur l'arrête ;
  - percée : s'arrête d'elle-même si elle échoue (§8.2) ; le joueur peut
    l'arrêter plus tôt ; **plusieurs percées** possibles en même temps, sur des
    axes différents (*provisoire* : au plus une par axe et par camp) ;
  - barrage : comme l'attaque sur tout le front (hors périmètre : bouton
    présent, sans effet).
- **Par front et par joueur** : au plus une attaque sur tout le front ou un
  barrage (lancer l'un arrête l'autre, *provisoire* pour le barrage) ;
  **l'attaque sur tout le front et les percées coexistent** (lancer l'une
  n'arrête pas les autres).
- **Les deux joueurs peuvent attaquer en même temps** sur le même front : l'état
  d'attaque est gardé pour chaque camp.
- **Seulement sur un front actif.** Un ordre d'attaque sur un front en paix est
  invalide.
- **Une attaque est un état durable** du front, dans l'état et le hash. Ordres
  (noms proposés, à fixer à l'implémentation, ajoutés à 00-Game §9) :

| Ordre | Paramètres | Valide si |
| --- | --- | --- |
| `set_front_priority` | front, pourcentage (indice dans `priorityPercent`) | le joueur est un camp du front |
| `set_front_reassign` | front, oui / non | idem |
| `set_unit_line_mode` | front, type d'unité, `first` / `balanced` / `second` | idem |
| `set_unit_allowed` | front, type d'unité, oui / non | idem |
| `set_breakthrough_motorized_only` | front, oui / non | idem |
| `set_forced_mobilization` | oui / non | toujours |
| `start_front_attack` / `stop_front_attack` | front | front actif ; le joueur en est un camp |
| `start_breakthrough` | front, connexion (`city1`, `city2`) | front actif ; la connexion est dans ce front |
| `cancel_breakthrough` | identifiant de percée | la percée est au joueur |

## 6. Combat : le round

- Un round tous les `FRONTS.combatTurns` tours (**10**, une seconde).
- **Pas d'attaque en cours sur un front : aucun dégât.**
- **Dégâts en valeur absolue** : un camp inflige la **somme** des attaques de
  ses unités engagées : un total anti-infanterie (`softAttack × unités ×
  multiplicateur`) et un total antiblindé (`hardAttack × unités ×
  multiplicateur`), sur toutes ses unités engagées. Plus un front est large,
  plus il y a de pertes. L'antiaérien n'entre pas dans le calcul.
- **Multiplicateurs selon le rôle** :

| Combat | Attaquant | Défenseur |
| --- | --- | --- |
| Attaque sur tout le front : première ligne contre première ligne | `attackMultiplier` | aucun (valeurs de base) |
| Percée, phase 1 : seconde ligne de l'attaquant contre la tranche engagée de la première ligne du défenseur | `breakthroughMultiplier` | aucun |
| Percée, phase 2 : la même force contre la seconde ligne du défenseur | `attackMultiplier` | `counterAttackMultiplier` |

- **Les deux camps tirent dans le même round** et subissent leurs pertes.
  *Provisoire* : les dégâts des deux camps sont calculés sur les effectifs du
  début du round, puis appliqués ensemble.
- **Deux attaques au même endroit** (chaque joueur attaque) : chaque joueur est
  évalué comme attaquant et comme défenseur, deux combats par round.
- Les unités du défenseur engagées dans une percée **restent comptées dans sa
  première ligne** : elles subissent aussi les dégâts d'une attaque sur tout le
  front.

### 6.1 Répartition des dégâts reçus

Pour un groupe d'unités qui reçoit des dégâts (une première ligne, la tranche
engagée dans une percée, la force de contre-attaque) :

- **Antiblindé** sur les types `armor` du groupe : PV totaux d'un type =
  `nombre × hitPoints` ; chaque type reçoit une part des dégâts égale à sa part
  des PV totaux des blindés ; il perd `arrondi(dégâts reçus / hitPoints)`
  unités, sans dépasser son nombre.
- **Anti-infanterie** sur les types `infantry` : même calcul (aujourd'hui un
  seul type d'infanterie, qui reçoit tout).
- **Équipement** (`equipment`) : chaque type perd le **même pourcentage** que
  l'infanterie du groupe, multiplié par son `lossMultiplier` :
  `arrondi(nombre × pourcentage perdu par l'infanterie × lossMultiplier)`.
- Des dégâts sans cible (antiblindé sans blindé en face) sont perdus.
- Exemple de l'auteur : 10 chenillettes de 1 000 PV et 2 chars de 3 000 PV ;
  4 000 dégâts antiblindés → 2 500 aux chenillettes (2,5 → 3 perdues),
  1 500 aux chars (0,5 → 1 perdu). L'arrondi n'est pas négligeable quand il y
  a peu d'unités : à surveiller.

## 7. Avancée

L'attaquant fait avancer le front vers la ville adverse ; sur une connexion,
la position augmente si l'attaquant est `p1`, diminue si c'est `p2`. Quand
les deux camps poussent, les deux avancées s'appliquent en sens contraire
(ça avance, ça recule). Bornes : 0 et 1 000 ; atteindre le bout de la route
fait tomber la ville (§10).

### 7.1 Attaque sur tout le front

À chaque round, sur **toutes les routes du front**, la même avancée :

```
déséquilibre = (a / d − A) / (B − A)        borné à [0, 1]
avancée      = arrondi(déséquilibre × v)     en millièmes de route
```

- `a`, `d` : unités d'**infanterie** en première ligne de l'attaquant et du
  défenseur (l'infanterie seulement est comparée).
- `A` = `FRONTS.advanceThresholdA` = **2** : en dessous, pas d'avancée.
  `B` = `FRONTS.advanceThresholdB` = **5** : vitesse maximale.
- `v` : vitesse de l'armée. À pied `FRONTS.footSpeedPermille` = **5**
  (0,5 % de la route par round) ; motorisée `FRONTS.motorizedSpeedPermille` =
  **15** (1,5 %). L'armée est motorisée **seulement si elle l'est à 100 %**
  (§7.3). Aujourd'hui l'infanterie est toujours à pied, donc l'assaut aussi.
- En entiers : `x = a − A × d`, borné à `[0, (B − A) × d]` ;
  `avancée = floor((2 × x × v + (B − A) × d) / (2 × (B − A) × d))`.
- **Défenseur sans infanterie** (`d = 0`) : déséquilibre 1, vitesse maximale.
  **Attaquant sans infanterie** : aucune avancée.
- Ordre de grandeur : à pied, au mieux 100 rounds (100 s) du milieu d'une
  route jusqu'à la ville. Avec la résolution de 1 000, un rapport sous 2,3
  ne fait pas avancer à pied (arrondi à 0) ; accepté par l'auteur.

### 7.2 Percée

1. **Ordre** : le joueur choisit l'axe (une connexion du front). La percée
   commence après `FRONTS.breakthroughDelayTurns` tours (**50**, 5 s).
2. **Largeur de la percée** = largeur du front / nombre de connexions, soit
   `metersPerConnection` (front de 2 connexions → 50 % du front ; de 10 →
   10 %). Une percée sur plusieurs axes à la fois : hors périmètre.
3. **Force de l'attaquant** : sa **seconde ligne**, le plus d'unités possible
   dans la largeur de la percée, comptées avec leur `breakthroughWidth`,
   choisies par la règle du remplissage d'un front (§4.2 : niche par niche, la
   meilleure d'abord, plafond par l'infanterie).
   - Interrupteur **« Motorisé seulement »** (par front, allumé par défaut) :
     allumé, seules les unités motorisées sont prises ; éteint, on prend
     d'abord les motorisées puis on complète avec les autres.
   - Ces unités quittent la seconde ligne disponible tant que la percée dure.
4. **Phase 1, contre la première ligne** : le défenseur engage une **tranche
   de sa première ligne** de la même largeur (même règle de remplissage, en
   `frontWidth`). Cette tranche est **suivie à part** du reste de la ligne,
   mais reste comptée dans la première ligne (§6). Pas d'avancée à chaque
   round.
5. **Première ligne percée** : dès que **toute l'infanterie** de la tranche
   engagée est éliminée, même s'il reste des véhicules. Alors :
   - les véhicules et équipements restants de la tranche rejoignent leur
     ligne, sans délai ;
   - le front **avance d'un coup** sur l'axe :
     `saut = arrondi(N × v × facteur de réaction)`, `N` =
     `FRONTS.breakthroughJumpRounds` = **10**, `v` la vitesse de la force qui
     perce (5 ou 15 ; motorisée seulement à 100 %). Sans réaction lente :
     50 ‰ à pied, 150 ‰ motorisé ;
   - la phase 2 commence.
6. **Facteur de réaction** de la seconde ligne du défenseur, selon le
   pourcentage `m` de motorisation de sa force de contre-attaque (§7.3) :
   `m` = 100 % → 1 ; `m` < 50 % → `X` = `FRONTS.slowReactionFactor` = **3** ;
   entre les deux, linéaire de `X` à 50 % jusqu'à 1 à 100 % (à 75 % : 2).
   Une seconde ligne à pied réagit lentement et laisse l'attaquant avancer
   plus : une percée qui ne brise pas la seconde ligne fait quand même avancer
   le front.
7. **Phase 2, contre la seconde ligne** : force de contre-attaque = les
   unités de la seconde ligne du défenseur **qui ne défendent pas déjà une
   autre percée**, le plus possible dans la largeur de la percée, comptées
   avec leur `breakthroughWidth`, **motorisées d'abord**, puis les autres.
   **Plusieurs percées** : la seconde ligne du défenseur se répartit
   **équitablement** entre elles, à chaque round, quitte à retirer des unités
   d'une percée pour les mettre sur une autre.
8. **Seconde ligne percée** (toute l'infanterie de la force de contre-attaque
   éliminée, ou pas de force du tout) : le front avance jusqu'à la ville au
   bout de l'axe, qui tombe (§10).
   *Provisoire* : si l'attaquant n'a aucune force à engager au début (seconde ligne vide, ou « Motorisé seulement » allumé alors
   qu'aucune unité motorisée n'existe — c'est le cas de toutes aujourd'hui), la percée s'arrête sans avoir commencé ; le moteur
   écrit l'événement `breakthrough_failed`, que la page affiche.
9. **Essoufflement** : la percée s'arrête quand les PV des unités engagées par
   l'attaquant (infanterie et blindés : `nombre × hitPoints`) tombent sous
   `FRONTS.breakthroughExhaustionPercent` = **35** % de leur valeur au début de
   la percée. L'avancée déjà gagnée reste.
10. **Fin de la percée** (réussie, essoufflée, annulée par le joueur, front
    passé en paix) : les unités survivantes de l'attaquant retournent dans sa
    seconde ligne, **sans délai** ; celles du défenseur engagées rejoignent
    leur ligne, sans délai.

### 7.3 Motorisation d'une force

Pourcentage de motorisation = largeur des unités motorisées / largeur de
toutes les unités comptées. **Seulement l'infanterie et les véhicules**
(`infantry`, `armor`), pas l'équipement. Poids : `frontWidth` pour une force
de première ligne ; `breakthroughWidth` pour une force de seconde ligne
(force qui perce, contre-attaque).

## 8. Fondation pendant une guerre

**Le rayon d'expansion d'une ville impliquée dans un front actif ne compte
pas** pour fonder (00-Game §3.3). Dans `found_city`, la recherche d'une ville
du joueur à portée d'expansion saute les villes qui ont au moins une connexion
dans un front actif (un drapeau par ville, mis à jour avec la table des
fronts). Un joueur dont toutes les villes sont sur un front actif ne peut donc
plus fonder.

## 9. Cases et récoltes

Le front ne change pas la propriété des cases : la zone d'une ville
(00-Game §3.2) reste à son joueur tant que la ville ne change pas de main,
même si une partie est derrière la ligne du front.

## 10. Prise d'une ville

**Le front arrivé au bout d'une seule route suffit.** Le joueur A prend la
ville X à B :

1. `X.player` devient A ; zones, propriétaires des cases, ports, groupes
   recalculés comme à une fondation (`setOwner` sur les cases de X).
2. **Encerclement** (§10.2), calculé avec les connexions et positions
   d'**avant** la prise.
3. **Fronts recalculés** (§2.4) avec la règle ci-dessous.

### 10.1 Connexions après une prise

- Les routes entre X et des villes de A ne sont plus des connexions (même
  joueur des deux côtés), dont celle par laquelle A est passé : elles sortent
  du front.
- Les routes entre X et des villes de B deviennent des connexions, avec le
  front à `FRONTS.capturePercent` = **1** % de la route côté X : A tient 1 %,
  B 99 %. En millièmes : `capturePercent × 10` depuis X (10 si X est `city1`,
  990 si X est `city2`).
- *Provisoire* : les routes entre X et un troisième joueur C deviennent des
  connexions A–C ; en guerre, position 500.

### 10.2 Encerclement

- **Cas** : des unités de B tenaient des connexions entre X (alors à B) et des
  villes de A. Après la prise, ces routes relient deux villes de A : elles sont
  coupées des deux côtés.
- **La route de l'attaque ne compte pas.** Parmi les autres, une route n'est
  encerclée que si le front y était à plus de
  `FRONTS.minEncirclementLengthPercent` = **25** % de la longueur de la route
  depuis X (B en tenait plus d'un quart). Plus près de X, les unités se
  replient en bon ordre, sans perte.
- **Notification** : le moteur écrit l'événement `encirclement` (prise, camps,
  unités perdues) ; la page prévient le joueur s'il est l'un des deux camps.
- **Pertes**, sur la **première ligne** de B seulement, front par front : pour
  chaque type, `arrondi(unités × routes encerclées × encirclementLossPercent /
  (connexions du front × 100))`, `FRONTS.encirclementLossPercent` = **50**,
  connexions comptées avant la prise. Hommes et matériel ensemble.
- *Provisoire* — **ce qui accompagne la prise** :
  - l'usine de X (00-Game §8) est détruite ;
  - si X était la capitale de B, sa ville de plus petit identifiant devient
    sa capitale ;
  - un joueur sans ville garde sa population et ne peut plus que refonder une
    première ville (00-Game §13, Villes).

## 11. Interface

L'interface vient de l'auteur. Maquettes montrées le 25 octobre (v3, v4) :
voir l'historique.

### 11.1 Carte

- **Double ligne rouge** sur la frontière d'un front actif : la case de
  chaque côté de la limite devient rouge, la ligne sombre de chaque joueur
  recule d'une case vers l'intérieur. Bande de 4 cases : sombre A, rouge,
  rouge, sombre B. Une case de frontière est « de front » si les villes des
  deux zones qu'elle sépare sont reliées par une connexion (`tileCity` des
  deux côtés → paire de villes). *Provisoire* : fronts actifs seulement.
- **Zone de front** (calcul du client seulement) : un « boudin » autour de la
  ligne de front, **des deux côtés**, **terre seulement**. Ligne de front =
  la suite des points du front (un par connexion, ordonnés comme au §11.4) ;
  une case est dans la zone d'un front si sa distance à cette ligne est ≤
  **la moitié de `CITY.controlRadius`** (décision de l'auteur, 26 octobre 2026 : la
  même zone sert à sélectionner un front et à l'afficher) ; à plusieurs fronts, celui dont la ligne est la plus
  proche (partage de Voronoi). Recalculée quand les fronts changent.
- **Dessin de la zone** : contour rouge et hachures rouges espacées, environ
  un quart de la surface sous le trait (trait de 2 px tous les 8 px, à 45°),
  pour voir la carte dessous. Provisoire de l'auteur : plus tard, de petits
  personnages qui se tirent dessus.
  - **Front actif** : hachures **rouges**, affichées si la case « Zones de
    front » du menu Carte (00-Game §11) est cochée — **cochée par défaut**.
  - **Front en paix** : hachures **bleues**, **au survol seulement**, jamais
    autrement (même case cochée).
  - **Survol** : la zone survolée s'affiche toujours, même case décochée ;
    seulement celle-là.
- **Clic dans une zone de front, affichée ou non** : ouvre le panneau de ce
  front. Hors zone, un clic sur le territoire adverse ouvre la diplomatie comme
  aujourd'hui (`onMapClick`, `client/src/main.ts`).
- **Front actif, soldats** (décision de l'auteur, 26 octobre 2026 ; la courbe
  de Catmull-Rom est abandonnée) : sur chaque connexion, le **point
  d'avancement** du front (§11.4, petit point rouge foncé) et, de chaque côté
  sur le segment droit entre les deux villes, **un rond de la couleur du
  joueur de ce côté** (deux soldats qui se battent). Chaque rond a la taille
  d'une ville (rayon des villes, hors capitale) et touche le point. Ce sont de
  simples ronds pour l'instant ; des animations viendront plus tard. Fronts
  actifs seulement.
- **Mode choix d'axe** (après le bouton percée) : un clic sur la carte lance
  une percée sur la connexion du front la plus proche du clic (*provisoire*),
  et **le mode se désactive aussitôt** (décision de l'auteur, 26 octobre 2026) ;
  pour une seconde percée, on rouvre le panneau du front. Échap quitte le mode
  sans lancer de percée.
- **Percée lancée** : le trait rouge de la route choisie reste affiché (le
  **segment droit entre les deux villes**, pas le tracé de la route), avec une
  flèche au milieu, de la ville de celui qui perce vers celle de son adversaire
  (flèche de 14 px du centre à la pointe). Les percées de l'adversaire sont
  dessinées de la même façon, la flèche dans l'autre sens : les deux joueurs
  voient la même chose. Une percée qui s'arrête au début faute de force (§7.2)
  le dit par un message.
- **Survol d'une ligne de front** (zone du front survolée) : un contour plus
  épais apparaît, pour montrer qu'on peut cliquer (il ne clignote pas, décision
  de l'auteur, 26 octobre 2026). Les boutons d'attaque actifs et les tableaux de
  percées du panneau clignotent à **1 seconde par cycle**, une seule constante
  (`BLINK_PERIOD_MS`, `client/src/blink.ts`).

### 11.2 Liste des fronts

- Bouton dans la barre d'informations, en **cinquième position**, juste à
  droite d'Armement.
- Deux sections : **fronts actifs**, puis **fronts en paix**.
- Une ligne par front, rangées par île puis par adversaire. Pour l'instant :
  l'île et l'adversaire ; plus tard, une petite description avec le nombre de
  soldats de chaque côté.
- Clic sur une ligne : ouvre le panneau du front.

### 11.3 Panneau d'un front

Un panneau = un front ; une bonne partie de l'écran. De haut en bas :

1. **Titre centré** (île, adversaire).
2. **Boutons d'attaque**, une rangée de trois : attaque sur tout le front,
   percée, barrage. Ceux du joueur dans sa moitié ; les trois mêmes en miroir
   dans la moitié de l'adversaire, **gris**, sans effet au clic.
   - Rouge clair au repos ; actif : **contour rouge foncé épais qui
     clignote** (aussi côté adversaire quand son attaque est active : le
     joueur voit qu'il est attaqué).
   - **Percée** : le clic ferme le panneau et passe la carte en mode choix
     d'axe (§11.1).
   - Interrupteur **« Motorisé seulement »** **à l'intérieur** du bouton
     percée (même cadre rouge clair, sous le mot « Percée »), allumé par défaut.
   - *Provisoire* : sur un front en paix, les boutons d'attaque sont grisés.
3. **Section des percées** : un petit tableau par percée en cours, **deux par
   rangée**, puis la rangée suivante. Chaque tableau :
   - en-tête « **Percée première ligne** » ou « **Percée seconde ligne** »
     selon la phase ;
   - des colonnes, du camp qui perce vers le défenseur : **attaque**,
     **défense de première ligne**, **défense de seconde ligne** (en miroir si
     le camp qui perce est à droite) ; une rangée par type d'unité engagé, sans
     niches ;
   - **dès le compte à rebours** (5 s avant le début), les effectifs sont ceux
     que la percée engagerait, calculés comme à son début avec les effectifs du
     moment (`previewBreakthrough`, lecture seule) ; la défense de seconde
     ligne est la contre-attaque qu'elle aurait (la seconde ligne libre du
     défenseur, partagée avec les percées déjà en phase 2) et reste
     une prévision jusqu'à la phase 2 ;
   - contour de la couleur du joueur qui perce (*provisoire*), plus un second
     contour rouge clignotant ;
   - une petite **croix** en haut pour annuler, seulement sur ses percées.
4. **Réglages** : priorité (1 · 100 %, 2 · 50 %, 3 · 0 %) et case « Autoriser
   la réassignation à d'autres fronts ».
5. **Tableau des unités**, deux moitiés symétriques autour d'une **barre
   centrale** de 8 px : 4 px de la couleur du joueur, 4 px de celle de
   l'adversaire (pas de rouge). À gauche le joueur, à droite l'adversaire (pas
   de brouillard de guerre : tout est visible).
   - Colonnes de la moitié du joueur, de l'extérieur vers la barre : avions
     (vide pour l'instant) ; nom du type **aligné à droite** puis son
     **icône**, puis à droite de l'icône une **case à cocher** « autorisé sur ce
     front » (§4.2) ; quantité en seconde ligne ; interrupteur à trois positions ;
     quantité en première ligne ; **« % front »** (couverture de la première
     ligne). En miroir pour l'adversaire, **sans interrupteurs**.
   - Quantités en nombre d'unités. Sous chaque quantité de première et de
     seconde ligne, en **rouge**, les unités perdues au **dernier round de
     combat** de ce front (pertes de combat et d'encerclement, `lostFirst` /
     `lostSecond` du camp ; remises à zéro à chaque round) ; rien s'il n'y en
     a pas.
   - **Groupé par niche** : une rangée d'en-tête par niche avec sa couverture,
     puis une rangée par type avec sa couverture. Le joueur voit pourquoi un
     type moins bon reste en seconde ligne.
   - **Séparateur au-dessus de l'en-tête de chaque niche** (pas en dessous) :
     trait, nom de la niche, ses types, puis le trait suivant. Un trait clair
     de la couleur de chaque joueur, de son côté de la barre, continu sur
     toute la rangée.
   - Le panneau compte les unités dans les percées et hors des percées.
6. Le panneau **défile** quand il est trop long ; *provisoire* : titre, boutons
   et réglages restent fixes en haut.

### 11.4 Points du front

- Point d'une connexion : `P = city1 + (city2 − city1) × position / 1000`, en
  flottants (client seulement). En paix, `position` = 500 (milieu).
- **Voisins** : deux connexions du même front sont voisines si elles partent de
  la même ville et sont consécutives dans l'ordre angulaire de **toutes** les
  routes de cette ville, avec un angle inférieur à 180°. Les voisinages forment
  des chaînes ou des boucles ; une chaîne peut se couper (face du réseau qui
  n'est pas un triangle).
- Les points (et leur sens ville 1 → ville 2) sont recalculés à la réception des fronts, pas à chaque image. Les chaînes
  servent aux zones de front (§11.1). La courbe de Catmull-Rom qui les reliait est abandonnée
  (`05-Fronts-History.md` §14).

### 11.5 Hors du panneau

- **Onglet Population** de la barre d'informations : les rôles rangés du plus
  prioritaire au moins prioritaire : ouvriers, mineurs, fermiers, pêcheurs, puis les soldats
  (icône `pop-soldier`), puis les inactifs en dernier (décision de l'auteur, 26 octobre 2026) ; les
  soldats gardent cette place même quand la mobilisation forcée est allumée. Interrupteur
  **« MOBILISATION FORCÉE »** : interrupteur standard **rouge**, texte rouge,
  gras, majuscules, éteint par défaut.
- **Barre de stock de chaque armement** (détail Armement) : nouvelle portion
  **jaune foncé** à gauche, l'équipement sur les fronts (déployé et en route).
  De gauche à droite : jaune foncé, bleu (en stock), hachures rouges
  (au-dessus du stock cible).

## 12. Configuration

Fichier **`packages/engine/src/config/fronts.ts`**, ré-exporté par
`config.ts` : tous les réglages des fronts, **lisible et commenté** (chaque
valeur : sens, unité, origine). Valeurs données par l'auteur :

| Nom | Valeur | Sens |
| --- | --- | --- |
| `metersPerConnection` | 5 000 | largeur ajoutée au front par connexion, en mètres |
| `priorityPercent` | `[100, 50, 0]` | pourcentage de chaque niveau de priorité (1, 2, 3) |
| `maxSecondLineOvercrowding` | 2 | `N` : la seconde ligne tient `N` fois la largeur du front, en largeurs de percée (§4.2) |
| `transferTurns` | 50 | délai d'un mouvement entre la réserve et un front, en tours (5 s) |
| `combatTurns` | 10 | tours entre deux rounds de combat (1 s) |
| `capturePercent` | 1 | position du front, en % de la route depuis la ville prise, sur les connexions créées par une prise |
| `minEncirclementLengthPercent` | 25 | part de la route que le perdant doit tenir depuis la ville prise pour que la route soit encerclée |
| `encirclementLossPercent` | 50 | pourcentage des unités de la part encerclée qui sont perdues |
| `advanceThresholdA` | 2 | rapport d'infanterie attaquant / défenseur sous lequel l'assaut n'avance pas |
| `advanceThresholdB` | 5 | rapport à partir duquel l'assaut avance à vitesse maximale |
| `footSpeedPermille` | 5 | vitesse d'une armée à pied, en millièmes de route par round |
| `motorizedSpeedPermille` | 15 | vitesse d'une armée motorisée |
| `breakthroughDelayTurns` | 50 | tours entre l'ordre d'une percée et son début (5 s) |
| `breakthroughJumpRounds` | 10 | `N` : le saut d'une première ligne percée vaut `N × vitesse` |
| `slowReactionFactor` | 3 | `X` : multiplicateur du saut face à une seconde ligne motorisée à moins de 50 % |
| `breakthroughExhaustionPercent` | 35 | une percée s'arrête quand la force engagée tombe sous ce % de ses PV de départ |

Les unités et les niches sont dans `config/units.ts` (§3).

## 13. Moteur

### 13.1 Structures (proposition d'implémentation)

```ts
interface FrontConnection {
  readonly city1: number;   // ville de players[0]
  readonly city2: number;   // ville de players[1]
  position: number;         // 0..1000 depuis city1 ; fronts actifs seulement
}
interface FrontSide {      // un par camp, players[0] puis players[1]
  firstLine: number[];      // unités par type (ordre des clés de UNITS)
  secondLine: number[];
  transfers: Transfer[];    // mouvements en cours (§4.5)
  priorityIndex: number;    // indice dans FRONTS.priorityPercent
  reassign: boolean;
  lineMode: number[];       // par type : 0 première, 1 équilibré, 2 seconde
  allowed: boolean[];       // par type : autorisé sur ce front (§4.2)
  motorizedOnly: boolean;
  frontAttack: boolean;     // attaque sur tout le front en cours
  breakthroughs: Breakthrough[];
}
interface Front {
  readonly id: number;
  readonly players: readonly [number, number];   // p1 < p2
  groups: [number, number];
  connections: FrontConnection[];                 // par (city1, city2)
  sides: [FrontSide, FrontSide];
}
// GameState : fronts (par id), nextFrontId, nextBreakthroughId,
// forcedMobilization par joueur, soldats par joueur.
```

Une percée garde : identifiant, axe (`city1`, `city2`), tour de début, phase
(attente, 1, 2), unités engagées de l'attaquant par type, tranche engagée du
défenseur par type, force de contre-attaque par type, PV de départ.

### 13.2 Ordre dans un tour (*provisoire*)

Ordres, puis recrutement de la mobilisation forcée (§4.1), puis économie
(00-Game §4 à §8 : répartition de la population, lignes, production), puis
recrutement et affectation (§4), puis transferts arrivés, puis, si `tick %
combatTurns = 0`, le round de combat de chaque front actif (§6, §7), puis les
prises de villes et l'encerclement (§10). Implémenté tel quel
(`packages/engine/src/turn.ts`).

### 13.3 Hash (02-Engine §5)

Tout ce qui est dans `GameState` entre dans le hash : `nextFrontId`,
`nextBreakthroughId`, chaque front (id, joueurs, groupes, connexions avec
positions, les deux camps avec tous leurs champs, transferts et percées), la
mobilisation forcée et les soldats de chaque joueur. `test/engine.test.ts`
vérifie que chaque champ change le hash.

### 13.4 Client

- Message `tick` (03-Client §4) : la liste des fronts à plat, `null` si elle
  n'a pas changé ; positions et effectifs changent à chaque round.
- Zones de front, double ligne rouge, soldats du front, panneau, liste : client seulement
  (§11), calculés à la réception.

### 13.5 Visualisation

`npm run viz:fronts` → `packages/engine/out/fronts.html`, sur le modèle de
`test/cities-viz.ts` : routes, connexions en couleur de leur front, points du
front, fronts par joueur (île, adversaire, connexions), chaînes du §11.4.

### 13.6 Pièges

- **Retrouver une connexion par ses seules villes.** X, ville de B, est prise
  par A ; la route X–C (C troisième joueur) était une connexion B–C et devient
  A–C. Si `B < C` et `A < C`, l'orientation `(X, C)` ne change pas : une clé
  sans les joueurs donnerait à A–C la position de B–C. La clé inclut
  `(p1, p2)`.
- **Indexer par l'indice dans `state.roads`** : il change à chaque fondation.
- **Identifiant de groupe** : il change quand sa plus petite ville change de
  main ; ne jamais l'utiliser comme identifiant de front.
- **Flottants dans le moteur** : positions, dégâts, pourcentages, facteurs :
  entiers. Seul le client calcule en flottants (points, zones).
- **Unités en route oubliées par la répartition** : voir §4.5.
- **Diviser avant de multiplier** : multiplier d'abord, diviser une seule fois
  à la fin (arrondi du §1).
- **Parcours dans un ordre fixé** : fronts par identifiant, types dans l'ordre
  des clés de `UNITS`, percées par identifiant (CLAUDE.md, règle 2).

### 13.7 Tests (une seule passe à la fin)

- Fronts recalculés après chaque fondation = calcul de référence lent
  (`test/helpers.ts`) ; chaque connexion dans un seul front ; ordre.
- Positions conservées d'un recalcul à l'autre ; nouvelle position quand un
  joueur change (§13.6).
- Affectation : niches du meilleur au moins bon, plafond par l'infanterie,
  interrupteur à trois positions, paliers et proportions (exemple 1/3 – 2/3),
  seconde ligne (exemple 100, 50, 0 ; le test en prend 60 : 40, 20, 0, sous le plafond de
  40 par front), délai, unités en route comptées, plafond de la seconde ligne.
- Combat : dégâts, multiplicateurs selon la phase, répartition des blindés
  (exemple du §6.1), arrondi, équipement au pourcentage de l'infanterie.
- Avancée : formule de l'assaut, cas `d = 0` et `a = 0` ; percée : saut,
  facteur de réaction (50 %, 75 %, 100 %), essoufflement, seconde ligne percée.
- Prise : connexions 10 / 990, encerclement (seuil de 25 %), fondation refusée
  depuis une ville d'un front actif.
- Paix : positions, attaques et percées supprimées, troupes gardées.
- Hash : chaque champ ; déterminisme (le test des 10 000 tours couvre les
  fronts dès qu'ils sont dans l'état).
- `config/units.ts` : multiplicateurs à deux décimales au plus ; chaque type
  dans une seule niche.

## 14. Ordre d'implémentation

1. **Fronts et troupes** : `config/fronts.ts`, détection (§2), affectation
   (§4), mobilisation forcée, ordres de réglage, guerre et paix (§2.3),
   fondation (§8) ; client : liste des fronts, zones et double ligne rouge,
   panneau sans attaques, onglet Population, barre jaune ; `viz:fronts`.
2. **Combat** : attaques, rounds, pertes (§5, §6), section des percées.
3. **Avancée, prise, encerclement** (§7, §10), points du front.
4. **Bots** : en dernier (hors de ce document pour l'instant).

À chaque étape : mettre à jour 02-Engine, 03-Client, 00-Game §9 (ordres) et
ce document s'il faut trancher un choix provisoire (CLAUDE.md, règle 8).

Étapes 1 à 3 faites le 26 octobre 2026 (voir « État » en tête).

## 15. Choix provisoires (non tranchés par l'auteur)

Choisis pour pouvoir implémenter ; à valider avec l'auteur, sans les
présenter comme décidés :

- coupure d'un front : troupes au prorata des connexions (§2.5) ;
  identifiant et réglages d'un front fusionné ou coupé (§2.5) ;
- nouvelle connexion créée en guerre par une fondation : position 500 (§2.4) ;
  route vers un troisième joueur après une prise : 500 (§10.1) ;
- soldats comptés dans la population, sans travailler ; population sous le
  nombre de soldats (§4.1) ;
- réassignation : les unités du front entrent dans la quantité à répartir
  (§4.4) ; changement d'interrupteur sans délai (§4.5) ;
- barrage et attaque sur tout le front exclusifs ; au plus une percée par axe
  et par camp (§5) ;
- dégâts calculés sur les effectifs du début du round (§6) ;
- prise : usine détruite, nouvelle capitale, joueur sans ville (§10.2) ;
- double ligne rouge sur les fronts actifs seulement ; connexion la plus
  proche du clic en mode choix d'axe (§11.1) ;
- boutons d'attaque grisés en paix ; contour d'une percée de la couleur du
  joueur qui perce ; en-tête fixe du panneau (§11.3) ;
- plafond de la seconde ligne par niche (§4.2) ;
- type refusé sur un front : ses unités repartent, y compris celles d'une percée (§4.2) ;
- renfort de la première ligne par la seconde : les deux camps, sans toucher aux unités
  d'une percée (§4.2) ;
- ordre des étapes dans un tour (§13.2).

Choix faits à l'implémentation (26 octobre 2026), pour les points que ce
document ne tranchait pas ; à valider avec l'auteur :

- **Objectif d'un palier** (§4.3) : `pourcentage × besoin` en partie entière ;
  le palier suivant complète jusqu'à 100 %, rien n'est perdu par l'arrondi.
- **Retrait des troupes** (§4.7) : les fronts de plus basse priorité d'abord, la seconde ligne
  avant la première ; le manque se compare à l'emploi maximal du pays (`workersNeeded`).
- **Population entre les types** (§4.1) : les types sont servis dans l'ordre
  des niches (`NICHES`), toutes les premières lignes d'abord, puis toutes les
  secondes lignes. L'infanterie, première niche, peut donc épuiser les
  inactifs avant que les autres types reçoivent des personnes.
- **Mobilisation forcée** (§4.1) : avant l'économie, un recrutement limité au
  premier palier de la première ligne (chaque front jusqu'à son pourcentage de
  priorité) prend sur toute la population qui peut travailler ; après
  l'économie, le recrutement normal prend le reste parmi les inactifs, comme
  hors mobilisation.
- **Réassignation** (§4.4) : on simule la répartition avec, en plus de la
  réserve, les unités libres des fronts qui l'autorisent (pas celles que des
  percées engagent) ; ce qu'un front de ce type garde en trop par rapport au
  résultat repart vers la réserve (délai de transfert), d'où la répartition
  normale le redonne à un front qui en manque, avec un second délai : un
  changement de front coûte deux délais.
- **Recalage d'un camp** : quand un interrupteur change, ou quand un front
  change de taille ou de composition (§2.5), toutes les unités du camp sont
  rangées de nouveau entre les deux lignes (interrupteurs, plafond de
  l'infanterie), sans délai ; l'équipement qui ne trouve pas de place même en
  seconde ligne repart vers la réserve avec le délai. Il n'y a pas d'autre
  passage d'une ligne à l'autre : les pertes de la première ligne ne sont pas
  remplacées par la seconde.
- **Front sans aucune connexion gardée** (une prise, une coupure de routes) :
  ses unités et celles en route rendent leurs équipements à la réserve et leur
  population au pays, sans délai.
- **Délai d'une unité formée** : `transferTurns` tours après le tour de sa
  formation ; l'unité formée hors tour par un test arrive un tour plus tard.
- **Déclin du stock** (§4.6) : l'excès compte la réserve et l'équipement
  déployé ; la perte est retirée de la réserve seulement, au plus ce qu'elle
  contient (le reste de la baisse est alors remis à 0).
- **Groupe touché sans infanterie** (§6.1) : son équipement est perdu en
  entier dès que le groupe reçoit des dégâts.
- **Attaque sur tout le front et percées** : elle tue d'abord les unités de la
  première ligne qu'aucune percée n'engage ; l'avancée d'un round (§7.1) est
  calculée sur les effectifs après les pertes du round.
- **Forces d'une percée** (§7.2) : l'attaquant et la tranche du défenseur sont
  choisis au premier round après le délai (`breakthroughDelayTurns`) ; une
  percée qui n'a alors aucune force s'arrête ; deux tranches d'un même
  attaquant ne recouvrent pas les mêmes unités ; la force de contre-attaque est
  recalculée à chaque round. Première ligne percée sans infanterie dans la
  tranche : elle l'est dès le premier round. Le facteur de réaction (§7.2,
  point 6) lit la force de contre-attaque de la percée qui saute ; sans force,
  X.
- **Prise par plusieurs routes** (§10) : si plusieurs connexions arrivent au
  bout dans le même round, les villes tombent une à une, par identifiant de
  front puis de connexion, chaque prise recalculant les fronts ; une arrivée
  qui n'est plus au bout après une prise est ignorée.
- **Fronts envoyés au client** : tous, sans brouillard de guerre ; le panneau
  d'un front dont le joueur n'est pas un camp n'a aucun réglage actif.
- **Mode choix d'axe** : il se désactive dès la première percée placée (décision de
  l'auteur) ; Échap le quitte sans percée ; le panneau est fermé pendant le mode.
- **Outil de développement** (hors règles, 03-Client §3) : « + armement » et
  « Armer les bots » donnent de l'armement et de la population ; ils servent à
  essayer les fronts sans que les bots produisent.

## 16. Hors périmètre et pistes

- **Problème connu, à reprendre avec le système de combat (l'auteur le
  refait ; observé le 27 octobre 2026)** : une percée d'infanterie ne tue
  personne. Une percée engage au plus une connexion (`metersPerConnection` =
  1 000 m), soit 100 infanteries de 10 m. Ses dégâts valent 100 × 10 × 0,2
  (`breakthroughMultiplier`) = 200 par round ; `lossesFrom` (`units.ts`) arrondit
  les pertes à `dégâts / PV` = 200 / 500 = 0,4, soit 0 mort par round, quel que
  soit le nombre d'unités de la tranche. La phase 1 ne se termine alors jamais :
  la tranche n'est pas éliminée et l'essoufflement ne se déclenche pas (400 tours
  joués sans changement). Il faut au moins 250 de dégâts par round pour tuer une
  infanterie. Avec l'ancienne largeur (5 000 m, 500 attaquants) la percée tuait
  2 unités par round. Deux tests le montrent et sont **laissés rouges**
  (`combat.test.ts`, « première ligne percée : saut… » et « sans force de
  contre-attaque… la ville tombe »). À ne pas réécrire pour qu'ils passent : à
  reprendre quand les règles de combat auront changé.
- Fronts aériens et maritimes ; avions (colonne vide du panneau) ; attaque
  antiaérienne.
- Barrage d'artillerie (bouton présent, sans effet).
- Percée sur plusieurs axes à la fois.
- Vitesse intermédiaire pour une armée partiellement motorisée ; variantes
  d'infanterie motorisées.
- L'équipement à pied ne ralentit pas une force : à surveiller (l'équipement
  statique attaque mal, sauf l'artillerie, supposée derrière la ligne). Piste :
  un interrupteur de motorisation de l'équipement, tracté par des camions.
- Délai de transfert plus long pour un front sur une île loin de la capitale.
- Lignes d'armement réglées automatiquement sur la taille des armées (la
  demande de l'armée comme limite de production, arrêt automatique des
  lignes).
- Plus de niveaux de priorité (25 %).
- Hachures remplacées par de petits personnages qui se tirent dessus.
- Bots : affectation des troupes et attaques, en dernier.
