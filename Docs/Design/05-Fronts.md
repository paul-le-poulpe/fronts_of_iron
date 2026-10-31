# 05 — Fronts terrestres (version 1 : les divisions)

**Ce document fait foi pour les fronts terrestres** : détection des fronts,
divisions, placement sur les fronts, renfort, attaques, combat, avancée, prise
de ville, encerclement, et leur interface. Il remplace 00-Game §3.8, qui n'en
garde qu'un résumé. Règles décidées avec l'auteur les 29 et 30 octobre 2026.

- **Historique** : `05-Fronts-History.md` garde les discussions et les règles
  remplacées, dont la **version 0.1** complète (couverture du front en mètres,
  priorités, interrupteurs, percée), à la fin du fichier. Il ne fait pas foi ;
  ne jamais implémenter à partir de lui.
- **Choix provisoires** : ce que l'auteur n'a pas tranché mais qu'il faut
  bien choisir pour implémenter est marqué « *provisoire* » et listé au §15.
  Tout le reste est décidé.
- **Version 2** (plus tard, §16) : la percée refaite, la réserve active, la
  boîte des forces de percée.
- **Hors périmètre** : fronts aériens et maritimes, avions, barrage
  d'artillerie, bots (§16).

**État (31 octobre 2026)** : **moteur implémenté** (§3 à §10, §13) ; client en
cours : la fenêtre d'un front est provisoire (texte), l'onglet des forces et le
pion restent à faire (§11, §14). Valeurs des divisions (§3.4) et interface (§11)
décidées avec l'auteur le 31 octobre 2026.
La version 0.1 est au tag git `v0.1`, décrite à la fin de
`05-Fronts-History.md`.

---

## 1. Vocabulaire

| Terme | Sens |
| --- | --- |
| **Connexion**, ou **liaison** | une route terrestre (00-Game §3.5) dont les deux villes appartiennent à deux joueurs différents |
| **Groupe**, ou **île** | les villes d'un joueur reliées entre elles par ses propres routes (00-Game §3.5, `City.group`) ; deux groupes du même continent non reliés par la terre comptent pour deux |
| **Front** | toutes les connexions entre un groupe d'un joueur et un groupe d'un autre joueur |
| **Front actif** | front entre deux joueurs en guerre (00-Game §1, Diplomatie) |
| **Front en paix** | front entre deux joueurs qui ne sont pas en guerre : une frontière, front potentiel |
| **Largeur d'un front** | son nombre de connexions. Toutes les largeurs se comptent en liaisons |
| **Division** | la brique de l'armée : un stock d'hommes et d'équipements, créé par le joueur, qui existe en dehors des fronts et se déplace entre eux (§3) |
| **Composant** | une ligne de la recette d'une division : les hommes, ou un type d'armement (00-Game §8.3), en un nombre fixé |
| **État** | de 0 à 100 % : ce qui reste de la division, pondéré par composant (§3.3) |
| **Niche** | un rôle sur le front, rempli par un ou plusieurs types de division rangés du meilleur au moins bon. **Principale** (infanterie, chars) ou **d'appui-feu** (antichar, antiaérien, artillerie) |
| **Ligne** | un front a une **première ligne** (combat) et une **seconde ligne** (attente, remplacement). Concept distinct des niches |
| **Réserve nationale** | les divisions du joueur affectées à aucun front |
| **Pion** | la représentation d'une division à l'écran (§11.3) |
| **Round** | un tour de combat, tous les `FRONTS.combatTurns` tours du moteur (10 : une seconde) |
| **Position** | où se trouve le front sur une connexion, en **millièmes** de la longueur de la route (entier de 0 à 1 000) |

**Entiers partout dans le moteur** (CLAUDE.md, règle 2). Les multiplicateurs
de la configuration, écrits en décimal (deux décimales au plus), sont convertis
une fois en entiers à l'échelle 100. **Arrondi** : au plus proche, 0,5 vers le
haut, partout où ce document dit « arrondi ». En entiers :
`arrondi(p / q) = floor((2p + q) / (2q))` pour `p ≥ 0`, `q > 0`.

**Pertes tirées** (pertes d'exemplaires d'un composant, §6.2, §6.3, §10.2) :
la perte exacte est `p / q` en entiers. La partie entière `floor(p / q)` est
toujours perdue ; pour le reste `r = p mod q`, un exemplaire de plus est perdu
si `nextInt(state.rng, q) < r`. On ne tire que si `r > 0`, dans un ordre fixé :
fronts par identifiant, divisions par identifiant, composants dans l'ordre de
`components`. La perte est bornée à ce que le composant a.

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
- **Largeur du front** = nombre de connexions, quelle que soit la longueur des
  routes. Calculée à la lecture, jamais stockée.

### 2.3 Fronts en paix et en guerre

Les fronts existent en paix comme en guerre. **Ils sont gérés de la même
façon** (divisions, panneau, zone sur la carte) ; en paix, ils sont simplement
inactifs : pas de position, pas d'attaque, pas de combat.

- **Déclaration de guerre** (ordre `declare_war`, 00-Game §1) : chaque
  connexion de chaque front entre les deux joueurs reçoit la position
  **500** (le milieu de la route).
- **Paix** : on supprime tout ce qui tient à la guerre active : positions,
  attaques. **Les divisions restent** sur le front. Les frontières reviennent
  au partage de Voronoi (00-Game §3.2).
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

### 2.5 Quand un front change

Fusion, coupure, ville prise ou perdue, nouvelle connexion : **pas de règle
d'identité à part** (décision de l'auteur).

- **Front qui disparaît** (plus aucune connexion) : ses divisions retournent
  dans la réserve nationale. *Provisoire* : avec le délai de déplacement
  (§4.4), comme un déplacement ordonné par le joueur.
- **Fusion** : les divisions des fronts fusionnés sont mises ensemble.
- **Coupure** (un front devient plusieurs) : les divisions de chaque camp sont
  réparties entre les morceaux **en proportion de leur nombre de connexions**.
  *Provisoire* : nombre de divisions par morceau au plus grand reste, à égalité
  au morceau de plus petit identifiant ; les divisions sont prises par
  identifiant croissant et données aux morceaux par identifiant croissant ;
  sans délai.
- **Ensuite, dans tous les cas**, les lignes du front sont rangées de nouveau
  (§4.2), sans délai.
- *Provisoire* — **identifiant** d'un front fusionné ou coupé : celui de
  l'ancien front qui partage le plus de connexions avec lui (mêmes `city1`,
  `city2`) ; à égalité, le plus petit identifiant ; un ancien identifiant
  n'est repris qu'une fois ; sinon un nouvel identifiant (`nextFrontId`).
  L'état d'attaque de chaque camp suit l'identifiant.
- **Nouveau front** : aucune division, aucune attaque.

## 3. Divisions

### 3.1 Types de division et niches

Les types de division sont **prédéfinis** dans la configuration
(`packages/engine/src/config/divisions.ts`, §12). Le joueur ne compose pas ses
propres types (V1).

Cinq **niches** pour l'instant ; chaque type de division est dans une seule
niche, et une niche range ses types du meilleur au moins bon :

| Niche | Sorte |
| --- | --- |
| infanterie | principale |
| chars | principale |
| antichar | appui-feu |
| antiaérien | appui-feu |
| artillerie | appui-feu |

Les niches principales tiennent le front et reçoivent les dégâts directement ;
les niches d'appui-feu attaquent depuis l'arrière et ne subissent que des
pertes dérivées de celles de l'infanterie (§6.3).

### 3.2 Composants

Un type de division est une liste de **composants**. Chacun a :

| Champ | Sens |
| --- | --- |
| ressource | les **hommes** (population), ou un type d'armement de `config/armament.ts` |
| `count` | nombre d'exemplaires dans une division complète (infanterie : 1 000 hommes, 1 000 fusils, 100 mitrailleuses, par exemple) |
| `required` | **requis** ou **optionnel** |
| `weight` | poids dans l'état de la division (§3.3) ; peut valoir 0 ; la somme des poids n'a pas à valoir 100 |
| `softAttack`, `hardAttack`, `airAttack` | apport du composant **complet** aux attaques de la division. L'antiaérien n'a pas d'effet (pas d'aérien) |
| `lossMultiplier` | part des pertes de la division que subit ce composant (§6.2) ; 1 par défaut |

Il n'y a pas de composant « blindé » : aucune division ne mêle équipements
blindés et non blindés (le blindage d'une division est son `armorPercent`,
§3.4).

- **Les stats appartiennent aux composants** ; celles de la division sont leur
  somme. Deux types de division peuvent utiliser le même armement avec des
  stats différentes (une infanterie de 500 fusils peut avoir 700 d'attaque).
- **Taux d'un composant** = exemplaires présents / `count`.
- **Taux de soldats** de la division = le plus petit taux parmi ses composants
  **requis**. Avec 1 000 hommes et 500 fusils requis : 50 %, soit 500 soldats.
- **Pas d'excédent** : aucun composant (requis ou optionnel) ne dépasse le taux
  de soldats. Ce qui dépasse (hommes sans fusil, mitrailleuses en trop après
  des pertes) **retourne au stock national** (hommes : à la population),
  *provisoire* : sans délai, à chaque tour.
- **Apport d'un composant** = sa stat × son taux. Un optionnel absent
  n'apporte rien ; à moitié présent, la moitié de ses stats.

### 3.3 État

```
état = Σ (weight × taux du composant) / Σ weight        de 0 à 100 %
```

Exemple : fusils 80, mitrailleuses 20 → tous les fusils sans mitrailleuse :
80 % ; la moitié de chaque : 50 %. L'état sert surtout à informer le joueur
(barre du pion, §11.3), et aux règles d'échange et de fuite (§5.3, §5.4). Une
division à **0 %** est **détruite** (*provisoire* : ce qui lui reste, sur des
composants de poids 0, est perdu).

### 3.4 Attributs d'un type de division

| Champ | Sens |
| --- | --- |
| `components` | la liste du §3.2 |
| `icon`, `description` | affichage (pion, menu « + », panneaux). Le **nom** de chaque type, celui de l'unité (« Chenillette »), distinct de celui de sa niche (« Chars »), est dans le client (`client/src/names.ts`) |
| `frontWidth` | largeur tenue en première ligne, en liaisons (infanterie : 1) |
| `hitPoints` | PV maximum : perte = dégâts / PV (1 dégât sur 100 PV : 1 %, §6.2) |
| `defenseHitPointsMultiplier` | multiplie les PV quand la division défend (l'infanterie, plus résistante en défense) |
| `attackMultiplier` | multiplie les attaques de la division quand son camp attaque ; aucun multiplicateur en défense |
| `armorPercent` | de 0 (infanterie) à 100 (chars) : part des dégâts antiblindés qu'elle prend, le reste en anti-infanterie (§6.2) |
| `movement` | `foot` ou `motorized` |
| `breakthroughWidth`, `breakthroughMultiplier`, `counterAttackMultiplier` | gardés pour la percée de la V2 ; sans effet en V1 |

**Valeurs** (validées par l'auteur le 31 octobre 2026, à partir des unités de
la version 0.1 ; 1 liaison = 1 000 m). Un type par niche pour l'instant.

Composants (`count`, requis, `weight`, `softAttack`, `hardAttack`, `airAttack`,
`lossMultiplier`) :

| Type | Ressource | count | requis | weight | soft | hard | air | lossMult |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `infantry` | hommes | 1 000 | oui | 2 | 0 | 0 | 0 | 1 |
| | `rifle` | 1 000 | oui | 2 | 1 000 | 100 | 0 | 1 |
| | `machineGun` | 100 | non | 1 | 500 | 0 | 100 | 1 |
| `tankette` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `tankette` | 50 | oui | 1 | 2 500 | 500 | 0 | 1 |
| `antiTank` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `antiTankGun` | 100 | oui | 1 | 0 | 5 000 | 0 | 1 |
| `antiAir` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `antiAirGun` | 100 | oui | 1 | 1 000 | 0 | 5 000 | 1 |
| `artillery` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `artillery` | 50 | oui | 1 | 2 500 | 250 | 0 | 0,5 |

- Les mitrailleuses sont servies par les 1 000 hommes de l'infanterie, sans
  homme de plus.
- Tankette : 10 hommes par char (5 à bord, 5 à l'entretien) ; les hommes en
  trop après des pertes de chars retournent à la population (§3.2).

Attributs :

| Type | Nom | Niche | frontWidth | breakthroughWidth | hitPoints | defenseHP× | attack× | breakthrough× | counterAttack× | armorPercent | movement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `infantry` | Infanterie | infanterie | 1 | 1 | 50 000 | 2 | 0,5 | 0,2 | 0,7 | 0 | foot |
| `tankette` | Chenillette | chars | 2 | 1 | 50 000 | 1 | 1 | 1 | 1 | 100 | foot |
| `antiTank` | Canon anti-char | antichar | 5 | 5 | — | — | 0,2 | 0,2 | 0,7 | — | foot |
| `antiAir` | Canon anti-aérien | antiaérien | 5 | 5 | — | — | 0,2 | 0,2 | 0,7 | — | foot |
| `artillery` | Artillerie | artillerie | 5 | 5 | — | — | 1 | 1 | 1 | — | foot |

- « — » : l'appui-feu ne reçoit pas de dégâts directs (§6.3) ; ces champs ne
  sont jamais lus (0, 1 et 0 dans la configuration).
- Icônes : `population/pop-soldier.png`, `armament/armament-tankette.png`,
  `armament/armament-AT-gun.png`, `armament/armament-AA-gun.png`,
  `armament/armament-artillery.png` (version 32 × 32 par `icon32Path`).
- Descriptions : celle de l'armement (`ARMAMENT.types`), sauf l'infanterie :
  « La base de toutes vos armées. Elle devra recevoir de l'équipement
  supplémentaire pour être vraiment efficace : canons, mitrailleuses, etc. »

### 3.5 Création et suppression

- **Création** (ordre `create_division`, depuis l'onglet des forces, §11.2) :
  le joueur choisit un type dans la liste des types. Valide seulement si le
  stock national d'armement et les **inactifs** suffisent à **remplir la
  division entièrement**. Sinon, l'ordre est sans effet. Les hommes ne sont
  pris que parmi les inactifs, même en mobilisation forcée (*provisoire* pour
  ce dernier point).
- Les hommes et l'équipement sont pris **au tour de l'ordre**. La division
  apparaît aussitôt dans la réserve nationale, **en formation** pendant
  `FRONTS.formationTurns` tours (**100**, 10 s). En formation, elle n'est pas
  déplaçable (*provisoire*) ; son pion porte l'icône de statut horloge (§11.3).
- **Suppression** (ordre `delete_division`) : seulement une division de la
  **réserve nationale**, ni en déplacement, ni en formation (*provisoire* pour
  la formation). Ses hommes retournent à la population et son équipement au
  stock, **sans délai**.
- **Les hommes d'une division ne retournent jamais d'eux-mêmes à l'économie**
  (sauf l'excédent, §3.2) : il faut supprimer la division.

## 4. Affectation : réserve, fronts, lignes

### 4.1 Où est une division

Une division est à **un seul endroit** :

- la **réserve nationale** ;
- un **front**, dans une ligne : **première ligne** ou **seconde ligne**
  (réserve active et boîte des forces de percée : V2) ;
- **en déplacement** vers l'un de ces endroits (§4.4).

Le joueur la place par glisser-déposer (ordre `move_division`, plusieurs
divisions à la fois possibles) ; le placement dans la bonne niche est
automatique, où que le pion soit posé.

### 4.2 Remplissage des lignes d'un front

Pour chaque camp, **chaque niche a sa propre première ligne**, de largeur =
largeur du front. Les niches se remplissent indépendamment : un front peut
avoir à la fois sa ligne d'infanterie, sa ligne de chars et sa ligne
d'artillerie pleines.

1. **La première ligne se remplit tant qu'il y a des divisions disponibles**
   dans la seconde ligne de la même niche : une division disponible n'est ni
   en déplacement, ni en formation, ni en fuite (§5.4).
2. **Ordre de choix** : la division de meilleur état ; à égalité, le meilleur
   type dans l'ordre de la niche ; à égalité, le plus petit identifiant.
3. **Part engagée** : les divisions remplissent la largeur dans cet ordre ; la
   dernière peut ne tenir qu'une partie de sa largeur. Une artillerie de
   largeur 5 sur un front de largeur 1 est engagée à 20 % : **elle n'attaque
   qu'avec 20 % de sa force et ne reçoit que 20 % des pertes**.
4. **Le reste attend en seconde ligne**, sans combattre ni subir de pertes.
5. **Appui-feu sans infanterie** : si aucune division d'infanterie n'est
   engagée en première ligne, l'appui-feu repasse en seconde ligne ; il
   remonte **aussitôt** que de l'infanterie revient (pas de délai).
6. **Une division abîmée tient toute sa largeur.**
7. *Provisoire* : le rangement est refait à chaque tour, après les ordres, les
   arrivées et les pertes.

Un pion posé sur un front sans préciser de ligne (onglet des forces, §11.2)
va en **seconde ligne**, d'où le remplissage le fait monter s'il y a de la
place.

### 4.3 Renfort

- **Le matériel du stock national est partagé à parts égales entre toutes les
  divisions du pays qui en ont besoin, quel que soit leur état** (pas de
  priorité en V1). Les hommes viennent des inactifs, ou, en **mobilisation
  forcée**, avant les emplois (00-Game §4).
- **Pas de renfort pour une division de première ligne pendant un combat**
  (au moins une attaque en cours sur son front). **Sans combat**, toutes les
  divisions se renforcent, première ligne comprise. Une bonne seconde ligne
  est donc ce qui permet de tenir longtemps.
- *Provisoire* : pas de renfort non plus pour une division en déplacement ou
  en fuite ; une division en formation est déjà pleine.
- *Provisoire* — **calcul** : à chaque tour, ressource par ressource, part égale
  plafonnée au besoin de chaque division, le surplus repartagé entre celles qui
  en manquent encore ; parties entières, une unité de plus aux divisions de
  plus petit identifiant pour le reste. Le renfort respecte « pas
  d'excédent » (§3.2).

### 4.4 Déplacement

- Tout déplacement entre la réserve nationale et un front, ou entre deux
  fronts, prend `FRONTS.transferRounds` **rounds de combat** (**10**, soit
  100 tours, 10 s).
- *Provisoire* : un déplacement entre les deux lignes d'un même front est sans
  délai. Un nouvel ordre vers la destination d'un déplacement en cours ne
  relance pas le délai ; il change seulement la ligne demandée.
- La ligne demandée (première ou seconde) est gardée pendant le trajet ; à
  l'arrivée, le rangement (§4.2) la place.
- Pendant le trajet, la division est comptée à sa **destination**, affichée
  grisée avec l'icône de statut horloge (§11.3) ; elle ne combat pas, ne compte
  pas pour le remplissage et ne réagit pas aux clics.
- Chaque division en déplacement garde sa destination et son tour d'arrivée,
  dans l'état et le hash.

### 4.5 Armement des divisions et déclin

- L'équipement des divisions **compte** dans le stock qui décline
  (00-Game §8.3).
- Le déclin ne retire que l'équipement **hors des divisions**.

## 5. Attaques et lignes en combat

### 5.1 Types et ordres

| Type | Qui tire | Avancée |
| --- | --- | --- |
| **Attaque sur tout le front** (assaut généralisé) | toute la première ligne des deux camps | sur toutes les routes du front (§7) |
| **Barrage d'artillerie** | hors périmètre | aucune |
| **Percée** | V2 : **le bouton disparaît** jusque-là | — |

- Le bouton est un **interrupteur** : un clic lance, un second arrête.
- **Les deux joueurs peuvent attaquer en même temps** sur le même front : l'état
  d'attaque est gardé pour chaque camp.
- **Seulement sur un front actif.** Un ordre d'attaque sur un front en paix est
  invalide.
- **Une attaque est un état durable** du front, dans l'état et le hash.

### 5.2 Ordres (ajoutés à 00-Game §9)

| Ordre | Paramètres | Valide si |
| --- | --- | --- |
| `create_division` | type de division | stocks et inactifs suffisants (§3.5) |
| `delete_division` | division | elle est au joueur, dans la réserve nationale, ni en déplacement ni en formation |
| `move_division` | liste de divisions ; destination : réserve nationale, ou front + ligne (première, seconde, ou sans ligne → seconde) | chaque division est au joueur, n'est pas en formation ; le joueur est un camp du front. *Provisoire* : les divisions invalides de la liste sont ignorées, les autres déplacées |
| `set_forced_mobilization` | oui / non | toujours |
| `start_front_attack` / `stop_front_attack` | front | front actif ; le joueur en est un camp |

Noms proposés, à fixer à l'implémentation.

### 5.3 Échange avec la seconde ligne

À la fin des pertes de chaque round : une division de première ligne dont
l'état est **inférieur à la moitié** de celui d'une division disponible de la
seconde ligne **de la même niche** (*provisoire* : même niche) **échange sa
place** avec elle. Division choisie en seconde ligne : la meilleure selon
l'ordre du §4.2. Sans délai.

### 5.4 Fuite

- Une division de première ligne dont l'état tombe à **25 %**
  (`FRONTS.fleeStatePercent`) ou moins **repasse d'elle-même en seconde
  ligne** : elle fuit.
- Pendant `FRONTS.fleeRounds` rounds de combat (**10**), elle ne peut pas
  revenir en première ligne ; la première ligne se remplit avec les autres
  divisions disponibles. Son pion porte l'icône de statut drapeau blanc (§11.3).
- Ce délai ne vaut que pour la fuite (pas pour l'appui-feu qui se retire faute
  d'infanterie, §4.2).

## 6. Combat : le round

- Un round tous les `FRONTS.combatTurns` tours (**10**, une seconde).
- **Pas d'attaque en cours sur un front : aucun dégât.**
- **Seule la première ligne combat et reçoit des dégâts.**
- **Deux attaques au même endroit** (chaque joueur attaque) : chaque camp est
  évalué comme attaquant et comme défenseur, deux combats par round.
- *Provisoire* : les dégâts des deux camps sont calculés sur les états du début
  du round, puis appliqués ensemble.

### 6.1 Dégâts infligés

Un camp inflige deux totaux, sur toutes ses divisions engagées (principales et
appui-feu) :

```
anti-infanterie = Σ part engagée × Σ (softAttack du composant × taux) × multiplicateur
antiblindé      = Σ part engagée × Σ (hardAttack du composant × taux) × multiplicateur
```

Multiplicateur : `attackMultiplier` de la division quand son camp est
l'attaquant de ce combat ; aucun quand il défend.

### 6.2 Dégâts reçus par les niches principales

1. **Entre l'infanterie et les chars** : chaque total reçu (anti-infanterie et
   antiblindé) est partagé entre la ligne d'infanterie et la ligne de chars en
   proportion de leur **remplissage** (largeur engagée / largeur du front).
   Infanterie pleine à 100 %, chars à 50 % : 2/3 et 1/3. **Les deux lignes
   reçoivent les deux types de dégâts.**
2. **Dans une ligne** : la part de chaque division est proportionnelle à sa
   largeur engagée (`frontWidth × part engagée`), **quel que soit son état**.
3. **Dégâts effectifs** d'une division = `armorPercent × part antiblindée +
   (100 − armorPercent) × part anti-infanterie`, en %. Une infanterie
   (`armorPercent` 0) ne prend que l'anti-infanterie ; un char (100), que
   l'antiblindé ; un half-track blindé, un mélange.
4. **Perte** : `f = dégâts effectifs / PV`, en fraction de la division
   complète, PV = `hitPoints`, × `defenseHitPointsMultiplier` quand la division
   défend. 1 dégât pour 100 PV : 1 %.
5. **Chaque composant perd** `f × lossMultiplier × count` exemplaires (pertes
   tirées, §1). Exemple : à 10 %, fusils ×1 → 10 % de ses fusils,
   mitrailleuses ×0,5 → 5 %. L'état est recalculé (§3.3) ; l'excédent créé
   retourne au stock (§3.2).

Des dégâts sans cible (aucune division principale engagée) sont perdus.

### 6.3 Pertes de l'appui-feu

L'appui-feu ne reçoit pas de dégâts directs.

```
f_inf   = Σ (f de chaque infanterie engagée × sa largeur engagée) / Σ largeurs engagées
f_comp  = f_inf × part engagée de la division d'appui-feu × lossMultiplier
pertes  = f_comp × count             (pertes tirées, §1)
```

- `f_inf` : moyenne des pertes de l'infanterie engagée **en fraction de sa
  capacité totale**, pondérée par la largeur engagée. Mesurée avant les
  échanges et fuites du round. Deux infanteries de même largeur qui perdent
  10 % et 5 % donnent 7,5 %. Pour une infanterie, `f` est celui du §6.2
  (point 4), avant le tirage.
- Exemple : artillerie, hommes et canons à `lossMultiplier` 0,5 → elle perd
  moitié moins que l'infanterie.
- Les chars ne suivent pas cette règle : ils sont dans une niche principale
  (§6.2).

### 6.4 Fin du round

Dans l'ordre (*provisoire*) : pertes des deux camps ; divisions à 0 %
détruites ; fuites (§5.4) ; échanges (§5.3) ; rangement des lignes (§4.2) ;
avancée (§7), calculée sur les lignes rangées.

## 7. Avancée

L'attaquant fait avancer le front vers la ville adverse ; sur une connexion,
la position augmente si l'attaquant est `p1`, diminue si c'est `p2`. Quand
les deux camps poussent, les deux avancées s'appliquent en sens contraire.
Bornes : 0 et 1 000 ; atteindre le bout de la route fait tomber la ville
(§10).

À chaque round d'une attaque sur tout le front, sur **toutes les routes du
front**, la même avancée :

```
déséquilibre = (a / d − A) / (B − A)        borné à [0, 1]
avancée      = arrondi(déséquilibre × v)     en millièmes de route
```

- `a`, `d` : **largeur d'infanterie engagée** en première ligne de
  l'attaquant et du défenseur, en liaisons (somme de `frontWidth × part
  engagée`). Seule l'infanterie compte ; une division abîmée compte pour toute
  sa largeur.
- `A` = `FRONTS.advanceThresholdA` = **2** : rapport sous lequel le front
  n'avance pas. `B` = `FRONTS.advanceThresholdB` = **5** : rapport à partir
  duquel il avance à vitesse maximale ; entre les deux, la vitesse croît en
  ligne droite. *Provisoire* : valeurs reprises de la version 0.1.
- `v` : vitesse. À pied `FRONTS.footSpeedPermille` = **5** (0,5 % de la route
  par round) ; motorisée `FRONTS.motorizedSpeedPermille` = **15**.
  *Provisoire* : motorisée seulement si toute l'infanterie engagée de
  l'attaquant l'est.
- En entiers (largeurs comptées en millièmes de liaison) : `x = a − A × d`,
  borné à `[0, (B − A) × d]` ;
  `avancée = floor((2 × x × v + (B − A) × d) / (2 × (B − A) × d))`.
- **Défenseur sans infanterie engagée** (`d = 0`) : vitesse maximale.
  **Attaquant sans infanterie engagée** : aucune avancée.

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
3. **Fronts recalculés** (§2.4, §2.5).

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

- **Cas** : B tenait des connexions entre X (alors à B) et des villes de A.
  Après la prise, ces routes relient deux villes de A : elles sont coupées des
  deux côtés.
- **La route de l'attaque ne compte pas.** Parmi les autres, une route n'est
  encerclée que si le front y était à plus de
  `FRONTS.minEncirclementLengthPercent` = **25** % de la longueur de la route
  depuis X (B en tenait plus d'un quart). Plus près de X, les divisions se
  replient en bon ordre, sans perte.
- **Pertes** : chaque division de **première ligne** de B sur ce front perd
  `f = routes encerclées × encirclementLossPercent / (connexions du front ×
  100)` de son état, `FRONTS.encirclementLossPercent` = **50**, connexions
  comptées avant la prise. *Provisoire* : appliqué composant par composant
  comme au §6.2 (point 5), avec la part engagée et le `lossMultiplier`
  (pertes tirées, §1).
- **Notification** : le moteur écrit l'événement `encirclement` (prise, camps,
  divisions touchées) ; la page prévient le joueur s'il est l'un des deux
  camps.
- *Provisoire* — **ce qui accompagne la prise** :
  - l'usine de X (00-Game §8) est détruite ;
  - si X était la capitale de B, sa ville de plus petit identifiant devient
    sa capitale ;
  - un joueur sans ville garde sa population et ne peut plus que refonder une
    première ville (00-Game §13, Villes).

## 11. Interface

L'interface vient de l'auteur. Ce qui n'est pas écrit ici est **à décrire par
lui** ; rien n'est inventé. Les tailles, couleurs et noms des maquettes de la
session de l'interface (31 octobre 2026) sont des exemples, sauf indication
contraire.

### 11.1 Carte

- **Double ligne rouge** sur la frontière d'un front actif : la case de
  chaque côté de la limite devient rouge, la ligne sombre de chaque joueur
  recule d'une case vers l'intérieur. Bande de 4 cases : sombre A, rouge,
  rouge, sombre B. Une case de frontière est « de front » si les villes des
  deux zones qu'elle sépare sont reliées par une connexion (`tileCity` des
  deux côtés → paire de villes). *Provisoire* : fronts actifs seulement.
- **Zone de front** (calcul du client seulement) : un « boudin » autour de la
  ligne de front, **des deux côtés**, **terre seulement**. Ligne de front =
  la suite des points du front (un par connexion, ordonnés comme au §11.5) ;
  une case est dans la zone d'un front si sa distance à cette ligne est ≤
  **la moitié de `CITY.controlRadius`** ; à plusieurs fronts, celui dont la
  ligne est la plus proche (partage de Voronoi). Recalculée quand les fronts
  changent.
- **Dessin de la zone** : contour rouge et hachures rouges espacées (trait de
  2 px tous les 8 px, à 45°).
  - **Front actif** : hachures **rouges**, affichées si la case « Zones de
    front » du menu Carte (00-Game §11) est cochée — **cochée par défaut**.
  - **Front en paix** : hachures **bleues**, **au survol seulement**.
  - **Survol** : la zone survolée s'affiche toujours, même case décochée ;
    seulement celle-là, avec un contour plus épais (sans clignotement).
- **Clic dans une zone de front, affichée ou non** : ouvre le panneau de ce
  front. Hors zone, un clic sur le territoire adverse ouvre la diplomatie.
- **Front actif, soldats** : sur chaque connexion, le **point d'avancement**
  du front (§11.5, petit point rouge foncé) et, de chaque côté sur le segment
  droit entre les deux villes, **un rond de la couleur du joueur de ce côté**,
  de la taille d'une ville, qui touche le point. Fronts actifs seulement.
- Les éléments de carte de la percée (mode choix d'axe, flèche) disparaissent
  avec elle jusqu'à la V2.

### 11.2 Onglet des forces (nouveau)

Un nouvel onglet en haut de l'écran : un aperçu de **toutes les divisions** du
joueur, sous forme de pions (§11.3). Largeur d'exemple : 700 px (à fixer à
l'implémentation). De haut en bas :

1. **Barre du haut** : le **bouton « + »** (icône `misc-plus-lighter.png`)
   occupe la **moitié gauche** ; la **corbeille** occupe la **moitié droite**
   et **n'apparaît que pendant un glisser**. Y déposer des divisions de la
   réserve nationale les supprime (§3.5). Icône de corbeille : *provisoire*.
2. **Réserve nationale**, détaillée : de vrais pions, **un groupe par type**
   (§11.3 : espacé, piles, « trop de pions »), **jamais deux types dans la
   même pile**. Pas de colonnes de niche.
3. **Les fronts**, chacun dans sa section : d'abord les **fronts en guerre
   active**, puis les **fronts en paix**, chaque groupe trié par longueur
   (*provisoire* : du plus long au plus court). Une section de front :
   - fond de la **couleur de l'adversaire** ;
   - à gauche, la **colonne du statut diplomatique** : un carré de 32 × 32 px
     à bord noir, **rouge en guerre, bleu en paix** (*provisoire* : carrés en
     attendant les icônes) ; la réserve a une case vide de même largeur, pour
     l'alignement ;
   - puis, côte à côte, pour chaque niche non vide : **une icône** (celle du
     type le plus nombreux de la niche) et, à côté, le **nombre total** de
     divisions de la niche (police de 20 px, blanc, contour noir de 1 px). Pas
     de pile, pas de case vide, pas de tri par ligne.
- **Glisser-déposer** (sélection : §11.4) d'une section à l'autre : une
  division déposée sur un front va en **seconde ligne** (§4.2) ; sur la
  réserve nationale, elle y retourne. Pour retirer des divisions d'un front,
  le joueur **clique sur le front** : sa fenêtre s'ouvre (§11.4), avec le
  bouton « ← Retour ».

**Menu « + »**

- Menu déroulant sous le bouton ; **il ne se ferme pas après un clic** ; **un
  clic en dehors le ferme**.
- **Une ligne par niche** (fond de la niche, §11.4 ; nom de la niche à droite
  en lettres sombres, 36 px), **les types de la niche côte à côte** (icône de
  32 px). Un nouveau type se place **à droite** des types existants.
- À côté de chaque type, **« actuel / supportable »** : « actuel » = nombre de
  divisions du type ; « supportable » = nombre de divisions complètes que le
  pays peut équiper avec ce qu'il a (dans les divisions et en stock),
  l'équipement le plus limitant fixant ce nombre (les hommes comptent aussi).
  Exemple : 10 divisions de chars à moitié équipées, aucun stock : « 10/5 ».
  « Actuel » est écrit **en rouge** s'il dépasse « supportable ».
- Un type dont on ne peut pas créer **une** division (§3.5) est à **50 % de
  transparence** ; son clic est sans effet.
- **Un clic crée une seule division** (`create_division`). Pas de quantité ni
  de clic maintenu.
- Survol d'un type : panneau de type (§11.7).

### 11.3 Pion d'une division

Décisions de l'auteur avec la session « Propositions visuelles du pion de
division » (30 octobre 2026) et la session de l'interface (31 octobre 2026).

**Le pion**

- Une **icône de 32 × 32**, celle du type de division, **sans fond**.
- **Barre d'état** à **droite** de l'icône, à 1 px d'elle : 4 px de large
  (bordure noire de 1 px, 2 px de remplissage), 32 px de haut, piste noire.
  Remplissage proportionnel à l'état, en pixels entiers (30 px possibles),
  couleur `hsl(état × 1,2 ; 75 % ; 45 %)` : rouge à 0 %, vert à 100 %.
  **Pas de barre à 100 %** (division au complet). Seul mini-widget pour
  l'instant.
- **Rang** : icône de 8 × 10 en taille réelle, coin **haut gauche**
  (`icons/ranks/icon-rank-N.png`, N de 0 à 7). Rang 0 : rien n'est dessiné sur
  le pion. **Le rang n'existe pas encore dans les règles** : en V1, toutes les
  divisions sont au rang 0, donc aucune icône de rang n'est dessinée sur un
  pion (§16).
- **Statut** : icône de 16 × 16 en taille réelle, coin **bas gauche** :
  `icons/miscellaneous/icon-clock.png` en formation ou en déplacement,
  `icon-white-flag.png` en fuite. Le rang et le statut ne se chevauchent pas.
- **Transparence** : avec une horloge ou un drapeau, l'icône du type est à
  **50 % d'opacité**. Rang, statut et barre gardent leurs couleurs.
- **Rectangle de sélection** : fond gris-bleu clair
  `rgba(159, 182, 209, 0.60)`, coins arrondis de 4 px, derrière les pions.
  48 px de haut (8 px au-dessus et au-dessous des pions), 3 px de marge à
  gauche du premier et à droite du dernier pion sélectionné. Il reste dans sa
  rangée, sans toucher le bord de la rangée ni un autre rectangle. Dans une
  pile, les pions sélectionnés sont **au-dessus** du rectangle, et le
  rectangle **au-dessus** des pions non sélectionnés.
- **Survol** : panneau d'un pion (§11.7).

**Disposition des pions dans une zone** (section de l'onglet des forces, zone
de la fenêtre d'un front)

1. **Mode espacé** (par défaut, tant qu'il y a la place) : pions groupés par
   type, 3 px entre deux pions (barre comprise), 16 px entre deux types.
   Largeur d'un pion : 32 px, plus 1 + 4 px avec sa barre (*provisoire* : sans
   barre, la place n'est pas réservée).
2. **Piles** (quand le mode espacé ne rentre plus) : une pile par type, 16 px
   entre les piles, comme des cartes à jouer : le pion du dessus est à gauche,
   chaque pion en dessous dépasse vers la droite. Décalage de 8, 12, 16 ou
   20 px : le plus grand qui rentre, le même pour toutes les piles de la zone.
   Le rang et le statut d'un pion en dessous sont cachés ; seule sa barre
   dépasse, sur une piste opaque gris foncé.
   **Ordre** (de gauche, dessus, à droite, dessous) : les divisions les plus
   prêtes au combat, puis les abîmées par état décroissant, puis celles à
   horloge ou drapeau, elles aussi par état décroissant.
3. **Trop de pions** (même à 8 px, ça ne rentre pas) : une seule icône par
   type, le pion du dessus de la pile (avec rang, statut et barre), et à côté
   le nombre de divisions du type (police de 20 px, blanc, contour noir de
   1 px) ; 16 px entre les types. **Au survol**, le rectangle de la zone
   s'élargit et grandit vers le bas le temps de la sélection : toutes les
   divisions y sont visibles côte à côte, une ligne ou plus par type, dans
   l'ordre de la pile, 3 px entre pions. Pas de hauteur maximale.

### 11.4 Fenêtre d'un front

Taille d'exemple : 1 284 × 500 px ; les tailles et positions sont à ajuster à
l'implémentation.

**Bandeau du haut**, coupé en deux par la barre verticale :

- moitié du joueur : titre du front ; à sa droite, l'interrupteur
  **« Sélection avancée »** (éteint par défaut) ; alignés à droite dans cette
  moitié, les boutons **« Attaque sur tout le front »** (interrupteur, §5.1) et
  **« Barrage d'artillerie »** (grisé, sans effet). Pas de bouton de percée en
  V1 ;
- moitié adverse : le bouton de fermeture ✕ à droite. Ouverte **depuis
  l'onglet des forces**, la fenêtre a aussi un bouton **« ← Retour »** à gauche
  du ✕, qui ramène à l'onglet ; ouverte depuis la carte, pas de bouton Retour,
  et ✕ ramène à la carte (*provisoire* : place du bouton Retour).

**Corps**, de gauche à droite :

- côté du joueur : colonne des **forces de percée** (V2), colonne de la
  **réaction rapide** (V2), puis une **capsule** (rectangle arrondi) qui
  contient la **seconde ligne** puis la **première ligne** ;
- **barre verticale** ;
- côté adverse, en miroir : une capsule avec la **première ligne**, contre la
  barre et **de la même largeur que celle du joueur**, puis la **seconde
  ligne** comprimée ; puis la réaction rapide et les forces de percée
  comprimées (V2). Le reste du côté adverse est comprimé (maquette : 800 px
  pour le joueur, 484 px pour l'adversaire).
- **En V1**, les colonnes de la V2 (forces de percée, réaction rapide, et
  leurs colonnes comprimées chez l'adversaire) sont **dessinées vides** : titre,
  rangées par niche pour la réaction rapide, boîte « + » des forces de percée
  sans effet.
- **Zone des avions** : en bas, sur toute la largeur, un cinquième de la
  hauteur, réservée et vide.
- Chaque colonne a un petit titre gris centré au-dessus (« Seconde ligne »,
  « Première ligne », « Réaction rapide », « Forces de percée » ; « Percée »
  pour la colonne comprimée de l'adversaire).

**Rangées par niche** (dans chaque ligne) : une rangée par niche, dans l'ordre
infanterie, chars, antichar, antiaérien, artillerie (*provisoire*). Fond gris
très légèrement teinté :

| Niche | Teinte | Sombre | Clair |
| --- | --- | --- | --- |
| infanterie | vert | `#262c27` | `#dde8de` |
| chars | rouge | `#2d2626` | `#eadcdc` |
| antichar | orange | `#2e2a23` | `#eae2d2` |
| antiaérien | bleu | `#232830` | `#d9e0ea` |
| artillerie | jaune | `#2d2c22` | `#e9e6cf` |

- **Lettres de niche** en grosses lettres grasses, **plus sombres que le
  fond** (à peine visibles) : `INF`, `TANK`, `AT`, `AA`, `ART` (*provisoire*),
  alignées à droite de la rangée, derrière les pions. 36 px.
- **En première ligne seulement** (du joueur et de l'adversaire), sous les
  lettres, le **pourcentage de couverture du front** de la niche (largeur
  engagée / largeur du front), de même taille et gras ; lettres et
  pourcentage y sont plus sombres encore, en 24 px.
- Les pions d'une rangée suivent §11.3. Le placement dans la bonne niche est
  automatique (§4.1).

**Seconde ligne adverse comprimée** (76 px de large ; *provisoire*) :

- chaque rangée montre **une icône** (celle du premier type) et, à côté, le
  **nombre total de divisions** de la niche (police de 20 px, blanc, contour
  noir de 1 px). Pas de pile.
- **Au survol**, la zone s'élargit **vers la gauche** (240 px pour une
  rangée), grandit vers le bas et montre toutes ses divisions, une ligne par
  type, 3 px entre pions.
- Les pions de l'adversaire ne sont pas sélectionnables.

**Retour à la réserve nationale** : pendant un glisser seulement, une zone
« Retour à la réserve nationale » (bord pointillé clair, 90 px de haut)
apparaît en bas de la colonne de gauche ; y déposer des divisions les renvoie
à la réserve nationale. Hors glisser, elle n'est pas visible.

**Sélection et glisser-déposer** (fenêtre d'un front et onglet des forces) :

- **Sélection simple** (par défaut), un seul clic : survoler une division
  montre le rectangle de ce qui sera sélectionné : **les divisions du même
  type, depuis le début du groupe jusqu'à celle-ci**, dans l'ordre de la pile
  (§11.3). **Le clic lance directement le glisser** : les divisions
  sélectionnées suivent le curseur. À la dépose, elles vont dans la zone
  visée (ligne d'un front, placement automatique dans la niche), dans la zone
  de retour, sur une section de l'onglet des forces, ou sur la corbeille
  (`move_division` ou `delete_division`).
- **Sélection avancée** (interrupteur du bandeau), deux clics :
  - le **premier clic marque la première division** (rectangle sur elle
    seule) ;
  - **dès que la souris bouge**, le rectangle se dessine jusqu'à la division
    survolée, pour montrer ce que donnerait le second clic ;
  - le **second clic fige** la sélection, qui peut ensuite être glissée.
  - **Toutes les divisions entre les deux clics** sont sélectionnées, rangée
    après rangée (rangées de haut en bas, pions de gauche à droite dans
    l'ordre de la pile) : de la première à la fin de sa rangée, les rangées
    entières entre les deux, du début de la dernière rangée à la seconde.
    **Un rectangle par rangée.**
  - Disponible dans toutes les zones ; **une sélection ne sort jamais de sa
    zone** (une ligne, la réserve nationale, une section de front).
- Les divisions en formation ou en déplacement ne sont pas déplaçables
  (§3.5, §4.4).

**V2** (pour mémoire, non affiché en V1) : colonne des forces de percée du
joueur (170 px : liste défilante de boîtes « Percée n » avec bouton
« Lancer », boîte « + » à bord pointillé, vue étendue de 330 px au survol
d'une boîte, avec rangées par niche et pourcentages de la largeur du front de
percée) ; colonne de réaction rapide (170 px, rangées par niche) ; colonnes
comprimées de l'adversaire (une boîte comprimée par force de percée, boîte
« ··· » pour celles qui ne tiennent pas, cadre de 330 px au survol). La zone
de retour à la réserve se place alors sous la boîte « + ».

### 11.5 Points du front

- Point d'une connexion : `P = city1 + (city2 − city1) × position / 1000`, en
  flottants (client seulement). En paix, `position` = 500 (milieu).
- **Voisins** : deux connexions du même front sont voisines si elles partent de
  la même ville et sont consécutives dans l'ordre angulaire de **toutes** les
  routes de cette ville, avec un angle inférieur à 180°. Les voisinages forment
  des chaînes ou des boucles.
- Les points sont recalculés à la réception des fronts, pas à chaque image.

### 11.6 Hors des fronts

- **Liste des fronts** (barre d'informations, cinquième bouton) : fronts
  actifs, puis en paix ; un clic ouvre la fenêtre du front.
- **Onglet Population** : les soldats (hommes des divisions) gardent leur
  place, avant les inactifs. Interrupteur **« MOBILISATION FORCÉE »** : rouge,
  éteint par défaut ; il sert à remplir les divisions (§4.3).
- **Barre de stock de chaque armement** : la portion jaune foncé montre
  l'équipement des divisions.

### 11.7 Panneaux de survol

**Panneau d'un type** (menu « + »), 280 px, à droite du menu, à la hauteur de
la ligne survolée (*provisoire*) :

- en-tête : **nom du type en gras** à gauche, **niche en gris** à droite ;
- **description** du type (§3.4) ;
- **équipement requis** : pour chaque composant, son icône en **32 × 32 px**
  (la version 32 × 32 si elle existe, sinon la 16 × 16 agrandie ; hommes
  compris), son nom, la quantité requise ;
- **statistiques** : attaque anti-infanterie, attaque antiblindée, attaque
  antiaérienne, PV, blindage en %, largeur de front, déplacement (à pied ou
  motorisé). **Une attaque nulle n'est pas affichée** ; le blindage non plus
  s'il est nul ; *provisoire* : PV non affichés pour l'appui-feu (jamais lus,
  §3.4). Chaque statistique a une petite icône (*provisoire* : carré de
  16 × 16 px).

**Panneau d'un pion** (fenêtre d'un front et onglet des forces), 280 px :

- apparaît **14 px au-dessus du pion**, jamais collé à la souris ;
- **disparaît dès qu'une sélection avancée (après le premier clic) ou un
  glisser commence** ;
- en-tête : l'**icône de rang** à gauche, avant le nom (rang 0 compris ;
  agrandie ×2 : 16 × 20 px), puis le **nom du type en gras** ; **niche en
  gris** à droite ;
- **description** ;
- **équipement** : icône 32 × 32, nom, **quantité actuelle / quantité
  requise** (hommes compris) ;
- **état** : le pourcentage seul (« 92 % ») ;
- **attaques non nulles** : valeur actuelle / valeur maximale
  (anti-infanterie, antiblindée, antiaérienne), avec les mêmes icônes.
- Panneau d'un pion adverse (seconde ligne adverse au survol) : non décrit ;
  *provisoire* : le même.

### 11.8 Thèmes clair et sombre

- La fenêtre d'un front et l'onglet des forces existent en **thème clair**
  (par défaut) et en **thème sombre** (couleurs des niches : §11.4 ; en clair,
  panneau `#f6f7f9`, lettres de niche plus sombres que leur fond).
- Les boutons à icône (« + ») peuvent avoir une version par thème ; pour
  l'instant, **les deux thèmes utilisent la même**.
- Un **bouton de debug temporaire**, à côté des boutons de debug existants,
  bascule entre les deux thèmes. Il ne concerne que ces deux panneaux et sera
  remplacé plus tard par un panneau de configuration du joueur.

## 12. Configuration

**`packages/engine/src/config/fronts.ts`** (lisible et commenté) :

| Nom | Valeur | Sens |
| --- | --- | --- |
| `combatTurns` | 10 | tours entre deux rounds de combat (1 s) |
| `formationTurns` | 100 | durée de formation d'une division (10 s) |
| `transferRounds` | 10 | délai d'un déplacement, en rounds de combat |
| `fleeStatePercent` | 25 | état sous lequel (ou auquel) une division fuit |
| `fleeRounds` | 10 | rounds avant qu'une division en fuite puisse revenir en première ligne |
| `swapStatePercent` | 50 | une division de première ligne échange quand son état est sous ce % de celui d'une division de seconde ligne |
| `capturePercent` | 1 | position du front, en % de la route depuis la ville prise |
| `minEncirclementLengthPercent` | 25 | part de la route que le perdant doit tenir pour que la route soit encerclée |
| `encirclementLossPercent` | 50 | pertes d'encerclement |
| `advanceThresholdA` | 2 | rapport d'infanterie sous lequel l'assaut n'avance pas |
| `advanceThresholdB` | 5 | rapport à partir duquel l'assaut avance à vitesse maximale |
| `footSpeedPermille` | 5 | vitesse à pied, en millièmes de route par round |
| `motorizedSpeedPermille` | 15 | vitesse motorisée |

Les réglages de la percée de la version 0.1 (`breakthroughDelayTurns`,
`breakthroughJumpRounds`, `slowReactionFactor`,
`breakthroughExhaustionPercent`) attendent la V2. Supprimés :
`metersPerConnection`, `priorityPercent`, `maxSecondLineOvercrowding`,
`transferTurns`.

**`packages/engine/src/config/divisions.ts`** (remplace `config/units.ts`) :
`DIVISIONS` (types, §3.4) et `NICHES` (types rangés du meilleur au moins bon,
sorte principale ou appui-feu, §3.1). Multiplicateurs : deux décimales au plus.

## 13. Moteur

### 13.1 Structures

```ts
interface Division {              // divisions.ts
  readonly id: number;
  readonly owner: number;
  readonly type: number;          // indice dans les clés de DIVISIONS
  readonly counts: number[];      // exemplaires par composant, ordre de `components`
  front: number;                  // 0 : réserve nationale ; en déplacement : destination
  line: number;                   // LINE_FIRST (0) ou LINE_SECOND (1) ; seconde dans la réserve
  engaged: number;                // largeur engagée en première ligne, millièmes de liaison
  arrivalTick: number;            // en déplacement : tour d'arrivée ; 0 sinon
  readonly formedTick: number;    // fin de formation
  fleeUntilTick: number;          // en fuite jusqu'à ce tour exclu
}
interface FrontSide { frontAttack: boolean }      // fronts.ts, un par camp
interface Front {
  readonly id: number;
  readonly players: readonly [number, number];   // p1 < p2
  readonly groups: readonly [number, number];
  connections: FrontConnection[];                 // par (city1, city2), avec position
  sides: [FrontSide, FrontSide];
}
// GameState : divisions (par id croissant), nextDivisionId, fronts, nextFrontId ;
// Player : forcedMobilization, soldiers (hommes des divisions, recomptés par countSoldiers).
```

- **Échelles** : état d'une division sur 10 000 (`STATE_SCALE`), largeurs en
  millièmes de liaison (`WIDTH_SCALE`), fractions de pertes `f` sur 1 000 000
  (`LOSS_SCALE`), dégâts en millièmes de point. Pertes tirées : `q` = 10⁸
  (`LOSS_SCALE` × échelle 100 du `lossMultiplier`).
- **Fichiers** : `divisions.ts` (types en entiers, état, excédent, attaques,
  pertes) ; `placement.ts` (ordres des divisions, renfort, arrivées, rangement
  des lignes, fuite, échange) ; `combat.ts` (round, appui-feu, avancée) ;
  `conquest.ts` (prise, encerclement) ; `fronts.ts` (détection, coupure,
  guerre et paix).
- La largeur engagée est rangée dans l'état à chaque rangement ; l'état d'une
  division se recalcule à la lecture (`stateOf`).

### 13.2 Ordre dans un tour (*provisoire*)

Ordres ; économie (00-Game §4 : répartition sur `population − hommes des
divisions`) ; renfort (§4.3) ; fins de formation et arrivées ; excédents
(§3.2) ; rangement des lignes (§4.2) ; si `tick % combatTurns = 0`, le round de
combat de chaque front actif (§6, §7) ; prises de villes et encerclement (§10).

### 13.3 Hash (02-Engine §5)

Tout ce qui est dans `GameState` entre dans le hash : chaque division (tous ses
champs), `nextDivisionId`, chaque front (id, joueurs, groupes, connexions avec
positions, attaques), la mobilisation forcée de chaque joueur.

### 13.4 Client

- Message `tick` (03-Client §4) : fronts et divisions ; `null` quand rien n'a
  changé.
- Zones, double ligne rouge, soldats, onglet des forces, fenêtre du front :
  client seulement, calculés à la réception.

### 13.5 Visualisation

`npm run viz:fronts` → `packages/engine/out/fronts.html` : routes, connexions
en couleur de leur front, points du front, fronts par joueur ; à compléter avec
les divisions de chaque front.

### 13.6 Pièges

- **Retrouver une connexion par ses seules villes.** X, ville de B, est prise
  par A ; la route X–C (C troisième joueur) était une connexion B–C et devient
  A–C. Si `B < C` et `A < C`, l'orientation `(X, C)` ne change pas : une clé
  sans les joueurs donnerait à A–C la position de B–C. La clé inclut
  `(p1, p2)`.
- **Indexer par l'indice dans `state.roads`** : il change à chaque fondation.
- **Identifiant de groupe** : il change quand sa plus petite ville change de
  main ; ne jamais l'utiliser comme identifiant de front.
- **Flottants dans le moteur** : positions, dégâts, pourcentages, facteurs,
  parts engagées : entiers (millièmes). Seul le client calcule en flottants.
- **Diviser avant de multiplier** : multiplier d'abord, diviser une seule fois
  à la fin (arrondi du §1).
- **Parcours dans un ordre fixé** : fronts et divisions par identifiant,
  composants dans l'ordre de `components` (CLAUDE.md, règle 2).
- **Divisions en déplacement oubliées** : elles comptent à leur destination
  pour l'affichage, pas pour le remplissage ni le combat.

### 13.7 Tests (une seule passe à la fin, minimaux)

- Déterminisme avec des fronts actifs et des divisions ; chaque champ d'une
  division change le hash.
- Création refusée faute de stock ou d'inactifs ; suppression ; déplacement
  et délai.
- Un round : partage 2/3 – 1/3, pertes par composant, pertes de l'appui-feu
  (moyenne pondérée), échange, fuite. Pertes tirées (§1) : partie entière
  et tirage du reste.
- Avancée : formule, cas `d = 0` et `a = 0`. Une prise, un encerclement.

## 14. Ordre d'implémentation

1. Règles (ce document, 00-Game) — fait le 30 octobre 2026.
2. **Valeurs des divisions** (§3.4) — fait le 31 octobre 2026.
3. **Interface** (§11) — décidée le 31 octobre 2026.
4. à 9. **Moteur** : configuration, état et hash, ordres, placement, combat,
   avancée, prise, encerclement — fait le 31 octobre 2026. Messages du client
   (`FrontView`, `DivisionView`, 03-Client) et fenêtre provisoire d'un front
   faits le même jour.
10. **Client** : onglet des forces, fenêtre du front, menu « + », sélection,
    panneaux, thèmes (session de l'interface) ; le pion (session « Propositions
    visuelles du pion de division »).
11. **Tests** (§13.7), en une passe.

À chaque étape : mettre à jour 02-Engine, 03-Client, 00-Game §9 et ce document
(CLAUDE.md, règle 8).

## 15. Choix provisoires (non tranchés par l'auteur)

Choisis pour pouvoir implémenter ; à valider avec l'auteur :

- front qui disparaît : retour à la réserve avec le délai de déplacement
  (§2.5) ;
- coupure : plus grand reste, divisions et morceaux par identifiant, sans
  délai ; identifiant d'un front fusionné ou coupé (§2.5) ;
- nouvelle connexion créée en guerre par une fondation : 500 (§2.4) ; route
  vers un troisième joueur après une prise : 500 (§10.1) ;
- pion : place de la barre non réservée à 100 % (§11.3) ;
- interface : ordre et lettres des niches, tri des fronts de l'onglet, place
  du bouton Retour et du panneau de type, largeurs, icônes de statut
  diplomatique, de statistique et de corbeille, panneau d'un pion adverse
  (§11.2, §11.4, §11.7) ;
- excédent rendu sans délai, à chaque tour (§3.2) ;
- division à 0 % : le reste est perdu (§3.3) ;
- création : inactifs seulement même en mobilisation forcée ; division en
  formation non déplaçable et non supprimable (§3.5) ;
- rangement des lignes à chaque tour (§4.2) ;
- renfort : ni en déplacement, ni en fuite ; calcul par parts égales et reste
  par identifiant (§4.3) ;
- déplacement entre les lignes d'un même front sans délai ; nouvel ordre vers
  la destination en cours sans nouveau délai (§4.4) ;
- interface : sélection avancée seulement dans la fenêtre d'un front (pas dans
  l'onglet des forces) ; une division en fuite peut être déplacée (§11.4) ;
- `move_division` : divisions invalides ignorées (§5.2) ;
- échange seulement dans la même niche (§5.3) ;
- dégâts calculés sur les états du début du round ; ordre de fin de round
  (§6, §6.4) ;
- avancée : seuils `A` = 2 et `B` = 5 repris ; motorisée seulement si toute
  l'infanterie engagée l'est (§7) ;
- encerclement appliqué composant par composant (§10.2) ;
- prise : usine détruite, nouvelle capitale, joueur sans ville (§10.2) ;
- double ligne rouge sur les fronts actifs seulement (§11.1) ;
- ordre des étapes dans un tour (§13.2).

## 16. Version 2, hors périmètre et pistes

**Version 2** :
- la **percée** refaite (bouton absent en V1) ;
- la **réserve active** (de préférence des unités motorisées, pour répondre
  aux percées) ;
- la **boîte des forces de percée** ;
- une priorité de renfort entre divisions.

**Plus tard, sans version fixée** : le **rang** d'une division (0 à 7,
icônes déjà dessinées, §11.3) ; ce qu'il représente et ses effets sont à
définir par l'auteur.

**Hors périmètre et pistes** :
- fronts aériens et maritimes ; avions (zone réservée de la fenêtre) ;
  attaque antiaérienne ;
- barrage d'artillerie (bouton présent, sans effet) ;
- modèles d'armement améliorés (un multiplicateur par modèle, fusil II ×1,2) ;
- types de division composés par le joueur ;
- divisions en partie blindées (déjà prévues par `armorPercent`) ;
- bots : création, placement et attaques, en dernier.
