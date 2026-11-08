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
- **Version 2** (décidée le 31 octobre 2026) : la **réaction rapide**, les
  **boîtes de percée** (§4.6) et la **percée** (§7.2).
- **Branche `Simpler-Combat`** : `06-Combat-Simplifie.md` remplace §3.5, §5,
  §6, §7.1 et §7.2 là où il les contredit (combat instantané, usines d'unités).
- **Branche `Human-Style-Pop`** : `08-Population.md` remplace §3.2, §3.3, §3.5, §4.3, §4.5
  et le bouton de recrutement et la corbeille de §11.2 : une division n'a plus de composants
  d'équipement mais une barre de vie, elle vient d'une usine ou d'une caserne, et le renfort et
  la mobilisation forcée n'existent plus. Les mentions d'hommes et d'équipement des autres
  paragraphes se lisent comme des pertes d'état.
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
`components`. La perte est bornée à ce que le composant a. **Les hommes ainsi
perdus s'ajoutent aux blessés du joueur** (00-Game §4.2, `applyLoss`) ; l'équipement
perdu disparaît.

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
  dans la réserve nationale, **sans délai** (voir « Fusion » pour le front
  le plus proche).
- **Fusion** : les divisions des fronts fusionnés sont mises ensemble, **dans
  le nouveau front**, sans retour à la réserve. Un ancien front dont aucune
  connexion n'est gardée (par exemple après la prise d'une ville) donne ses
  divisions au front des mêmes joueurs le plus proche : celui qui a une
  connexion dont une ville est une ville de l'ancien front ou à une route
  d'elle (à égalité, la plus petite distance, puis le plus petit
  identifiant) ; sans tel front, elles retournent à la réserve. Les
  nouveaux fronts sont tous calculés avant la répartition, donc l'ordre de
  création et de suppression n'a pas d'effet.
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
les niches d'appui-feu attaquent depuis l'arrière et reçoivent des dégâts
proportionnels à la largeur qu'elles occupent (§6.3).

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
composants de poids 0, est perdu), **mais seulement quand elle subit des pertes au
combat ou à l'encerclement** : une division ne peut être détruite que par le combat ou
manuellement par le joueur (§3.5). Une division à 0 % vidée autrement (§3.5, fondation
d'une ville) reste et se reconstitue par le renfort (§4.3).

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
| `breakthroughWidth` | largeur tenue dans une percée, en liaisons (§7.2) |
| `formationTurns` | durée de formation d'une division créée, en tours (§3.5) ; 0 : aucune |
| `elite` | le type est limité par `ELITE_TROOPS_RATIO` à la création (§3.5) ; absent : non |
| `breakthroughMultiplier` | multiplie les attaques de la division quand elle perce (§7.2) |
| `counterAttackMultiplier` | multiplie les attaques de la division dans une force de contre-attaque (§7.2) |

**Valeurs** (validées par l'auteur le 31 octobre 2026, à partir des unités de
la version 0.1 ; 1 liaison = 1 000 m). Un type par niche pour l'instant.

Composants (`count`, requis, `weight`, `softAttack`, `hardAttack`, `airAttack`,
`lossMultiplier`) :

| Type | Ressource | count | requis | weight | soft | hard | air | lossMult |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `regulars` | hommes | 1 000 | oui | 2 | 0 | 0 | 0 | 1 |
| | `rifle` | 1 000 | oui | 2 | 1 000 | 100 | 0 | 1 |
| | `machineGun` | 100 | non | 1 | 500 | 0 | 0 | 1 |
| `militia` | hommes | 1 000 | oui | 2 | 0 | 0 | 0 | 1 |
| | `rifle` | 500 | oui | 2 | 600 | 20 | 0 | 1 |
| `elite` | hommes | 1 000 | oui | 2 | 0 | 0 | 0 | 1 |
| | `rifle` | 1 500 | oui | 2 | 1 000 | 200 | 0 | 1 |
| | `machineGun` | 300 | non | 1 | 1 000 | 0 | 0 | 1 |
| `tankette` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `tankette` | 50 | oui | 1 | 2 500 | 500 | 0 | 1 |
| `infantryTank` | hommes | 400 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `infantryTank` | 40 | oui | 1 | 4 000 | 1 500 | 0 | 1 |
| `cruiserTank` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `cruiserTank` | 50 | oui | 1 | 3 000 | 1 000 | 0 | 1 |
| `mediumTank` | hommes | 400 | oui | 1 | 0 | 0 | 0 | 0,5 |
| | `mediumTank` | 40 | oui | 1 | 3 000 | 1 750 | 0 | 1 |
| `antiTank` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `antiTankGun` | 100 | oui | 1 | 0 | 5 000 | 0 | 1 |
| `antiAir` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `antiAirGun` | 100 | oui | 1 | 500 | 0 | 5 000 | 1 |
| `artillery` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `artillery` | 50 | oui | 1 | 2 500 | 250 | 0 | 1 |
| `armoredAntiTank` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `armoredAntiTankGun` | 100 | oui | 1 | 0 | 10 000 | 0 | 1 |
| `selfPropelledAntiAir` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `selfPropelledAntiAirGun` | 100 | oui | 1 | 1 000 | 0 | 10 000 | 1 |
| `selfPropelledArtillery` | hommes | 500 | oui | 1 | 0 | 0 | 0 | 1 |
| | `selfPropelledArtilleryGun` | 50 | oui | 1 | 3 000 | 0 | 0 | 1 |

- Les mitrailleuses sont servies par les 1 000 hommes de l'infanterie, sans
  homme de plus. Elles n'ont pas d'attaque antiaérienne (`airAttack` 0).
- Chaque composant a sa propre attaque (§3.2) : les 300 mitrailleuses des élites
  ont 1 000 en tout, soit moins par mitrailleuse que les 500 des 100 des
  réguliers, mais un plafond plus haut.
- Chars (tankette, char d'infanterie, char de cavalerie, char moyen) : 10 hommes par char (5 à bord, 5 à l'entretien) ; les hommes en
  trop après des pertes de chars retournent à la population (§3.2).

Attributs :

| Type | Nom | Niche | frontWidth | breakthroughWidth | hitPoints | defenseHP× | attack× | breakthrough× | counterAttack× | armorPercent | movement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `elite` | Forces spéciales | infanterie | 1 | 1 | 80 000 | 2 | 0,8 | 0,6 | 0,8 | 0 | foot |
| `regulars` | Réguliers | infanterie | 1 | 1 | 60 000 | 2 | 0,5 | 0,2 | 0,7 | 0 | foot |
| `militia` | Milice | infanterie | 1 | 1 | 50 000 | 2 | 0,3 | 0,2 | 0,7 | 0 | foot |
| `tankette` | Chenillette | chars | 2 | 1 | 20 000 | 1 | 1 | 1 | 1 | 100 | foot |
| `infantryTank` | Char d'infanterie | chars | 2 | 1 | 100 000 | 1 | 1 | 0,8 | 0,8 | 100 | foot |
| `cruiserTank` | Char de cavalerie | chars | 2 | 1 | 40 000 | 1 | 1 | 1 | 1 | 100 | motorized |
| `mediumTank` | Char moyen | chars | 2 | 1 | 80 000 | 1 | 1 | 1,2 | 1,2 | 100 | motorized |
| `antiTank` | Canon anti-char | antichar | 3 | 5 | 50 000 | 2 | 0,2 | 0,2 | 0,7 | 0 | foot |
| `antiAir` | Canon anti-aérien | antiaérien | 3 | 5 | 50 000 | 2 | 0,2 | 0,2 | 0,7 | 0 | foot |
| `artillery` | Artillerie | artillerie | 3 | 5 | 50 000 | 2 | 1 | 1 | 1 | 0 | foot |
| `armoredAntiTank` | Canon anti-char blindé | antichar | 3 | 1 | 80 000 | 1 | 0,8 | 1 | 1,2 | 100 | motorized |
| `selfPropelledAntiAir` | Canon anti-aérien autopropulsé | antiaérien | 3 | 1 | 40 000 | 1 | 0,8 | 1 | 1 | 100 | motorized |
| `selfPropelledArtillery` | Artillerie autopropulsée | artillerie | 3 | 1 | 40 000 | 1 | 1 | 1,2 | 1 | 100 | motorized |

Formation (`formationTurns`) : élites 200 tours (20 s), réguliers 100 (10 s),
milice 0, les autres types 100. Dans la niche d'infanterie, du meilleur au moins
bon : élites (nommées « forces spéciales » dans le client, décision de l'auteur du
1er novembre 2026), réguliers, milice.

- L'appui-feu reçoit des dégâts directs (§6.3) : ses PV, son multiplicateur de PV
  en défense et son blindage sont lus comme ceux des niches principales. Les PV
  des appuis-feu à pied sont ceux des réguliers (50 000, ×2 en défense) ; ceux des
  variantes blindées sont de l'auteur (1er novembre 2026). Ces trois variantes
  (`armoredAntiTank`, `selfPropelledAntiAir`, `selfPropelledArtillery`) ont les
  attaques de leurs variantes à pied, doublées (sauf l'artillerie autopropulsée :
  3 000 de soft, 0 de hard), une `breakthroughWidth` de 1 (5 pour les variantes à
  pied), un blindage de 100 % (elles prennent les dégâts antiblindés, les
  variantes à pied les dégâts anti-infanterie) et sont motorisées.
- Icônes : `armament/icon-inf-elite.png`, `armament/icon-inf-regulars.png`,
  `armament/icon-inf-milicia.png`, `armament/armament-tankette.png` (32 × 32 :
  `icon-armament-tankette-32.png`), `armament/icon-armament-infantry-tank-32.png`,
  `armament/icon-armament-cruiser-tank-32.png`, `armament/icon-armament-medium-tank-32.png`
  (ces trois chars n'existent qu'en 32 × 32),
  `armament/armament-AT-gun.png`, `armament/armament-AA-gun.png`,
  `armament/armament-artillery.png` (version 32 × 32 par `icon32Path`),
  `armament/icon-armament-armored-AT-32.png`, `armament/icon-armament-SPAA-32.png`,
  `armament/icon-armament-armored-SPART-32.png` (32 × 32 seulement).
- Descriptions : celle de l'armement (`ARMAMENT.types`), sauf l'infanterie :
  réguliers : « La base de toutes vos armées. Elle devra recevoir de
  l'équipement supplémentaire pour être vraiment efficace : canons, mitrailleuses,
  etc. » ; milice : « Des hommes avec quelques fusils. Mieux que rien. » ;
  élites : « La crème de la crème. Limités à 10 % de votre infanterie totale. »
  (le pourcentage vient de `ELITE_TROOPS_RATIO`). Les trois nouveaux chars n'ont
  pas de description propre : celle de leur armement (`config/armament.ts`).
- Niche des chars, du meilleur au moins bon : char d'infanterie, char moyen, char
  de cavalerie, chenillette (l'auteur place le char d'infanterie en tête ; le reste de l'ordre
  est *provisoire*).
  Chaque niche d'appui-feu range sa variante blindée avant celle à pied
  (*provisoire*, même raison).

### 3.5 Création et suppression

- **Création** (ordre `create_division`, depuis l'onglet des forces, §11.2) :
  le joueur choisit un type dans la liste des types. Valide seulement si le
  stock national d'armement et les **inactifs** suffisent à remplir ses
  **composants requis**. Sinon, l'ordre est sans effet. Les **composants
  optionnels** partent de 0 et arrivent par le renfort (§4.3). Les hommes ne sont
  pris que parmi les inactifs, même en mobilisation forcée (*provisoire* pour
  ce dernier point).
- Les hommes et l'équipement sont pris **au tour de l'ordre**. La division
  apparaît aussitôt dans la réserve nationale, **en formation** pendant
  `formationTurns` tours **de son type** (§3.4 : 100 pour les réguliers, 200 pour
  les élites, 0 pour la milice, prête aussitôt). En formation, elle n'est pas
  déplaçable (*provisoire*) ; son pion porte la flèche de statut vers le haut (§11.3).
- **Limite des élites** : `08-Population.md` §5.
- **Suppression** (ordre `delete_division`) : seulement une division de la
  **réserve nationale**, ni en déplacement, ni en formation (*provisoire* pour
  la formation). Ses hommes retournent à la population et son équipement au
  stock, **sans délai**.
- **Les hommes d'une division ne retournent jamais d'eux-mêmes à l'économie**
  (sauf l'excédent, §3.2) : il faut supprimer la division. Les hommes **tués** ne
  retournent pas aux inactifs : ils deviennent des blessés (00-Game §4.2).
- **Fondation d'une ville** (00-Game §3.3) : si les non-soldats non blessés ne
  suffisent pas à payer le coût, le manque est retiré aux divisions du joueur, le
  même ratio `manque / soldats` de leurs hommes à chacune (`removeSoldiers`) :
  chaque division perd `floor(manque × hommes / soldats)`, puis les hommes restants
  vont un par un aux plus grands restes, à égalité à la division qui vient la
  première dans `state.divisions`. Les composants qui dépassent le nouveau taux de
  soldats retournent au stock (§3.2) ; **une division vidée n'est pas détruite** : elle
  reste à 0 % et se reconstitue par le renfort (§4.3). Ces hommes ne deviennent pas
  blessés.

## 4. Affectation : réserve, fronts, lignes

### 4.1 Où est une division

Une division est à **un seul endroit** :

- la **réserve nationale** ;
- un **front**, dans une ligne : **première ligne**, **seconde ligne**,
  **réaction rapide** ou une **boîte de percée** (§4.6) ;
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
   largeur 3 sur un front de largeur 1 est engagée au tiers : **elle n'attaque
   qu'avec un tiers de sa force et ne reçoit qu'un tiers des pertes**.
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
  forcée**, avant les emplois (00-Game §4). Jamais des blessés (00-Game §4.2).
- **Pas de renfort pour une division de première ligne pendant un combat**
  (au moins une attaque en cours sur son front). **Sans combat**, toutes les
  divisions se renforcent, première ligne comprise. Une bonne seconde ligne
  est donc ce qui permet de tenir longtemps.
- *Provisoire* : pas de renfort non plus pour une division en déplacement ou
  en fuite. Une division en formation est renforcée comme les autres (ses
  composants optionnels, §3.5).
- *Provisoire* — **calcul** : à chaque tour, ressource par ressource, part égale
  plafonnée au besoin de chaque division, le surplus repartagé entre celles qui
  en manquent encore ; parties entières, une unité de plus aux divisions de
  plus petit identifiant pour le reste. Le renfort respecte « pas
  d'excédent » (§3.2).
- **Progressif** (`FRONTS.reinforcePercentPerRound`, **3**) : le renfort n'a
  lieu qu'une fois par round de combat (tours multiples de `combatTurns`) ; un
  composant ne regagne alors que 3 % de son effectif complet (au moins 1
  exemplaire), hommes compris. Une division vide est pleine en 34 rounds (34 s). L'état
  d'une division se déduit de ses exemplaires (§3.3) : il remonte donc de la
  même façon, sans second compteur. Ce qui n'est pas pris reste au stock.

### 4.4 Déplacement

- Tout déplacement de la réserve nationale vers un front, ou entre deux
  fronts, prend `FRONTS.transferRounds` **rounds de combat** (**10**, soit
  100 tours, 10 s). Le retour d'un front vers la réserve nationale se fait
  **sans délai** (décision de l'auteur, 1er novembre 2026) : le délai est payé
  à la réaffectation vers un front. Une division en route vers un front et
  rappelée à la réserve y est aussitôt.
- **Sans délai** entre la seconde ligne, la réaction rapide et les boîtes de
  percée d'un même front (§4.6). *Provisoire* : sans délai aussi entre la
  première ligne et ces endroits. Un nouvel ordre vers la destination d'un déplacement en cours ne
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

### 4.6 Réaction rapide et boîtes de percée (version 2)

Chaque camp d'un front a, en plus de ses deux lignes :

- une **réaction rapide** : des divisions qui ne sont ni en première ni en
  seconde ligne, rangées par niche comme une ligne. Elles ne prennent pas part
  à l'attaque sur tout le front ; elles défendent contre les percées adverses
  (§7.2, combat 2). De préférence des unités motorisées (§7.2, facteur de
  réaction).
- des **boîtes de percée**, dans un ordre de création :
  chacune est un groupe de divisions, sans ligne. Elles ne prennent pas part à
  l'attaque sur tout le front ; elles servent à lancer des percées (§7.2).

Règles :

- **Création d'une boîte** : déposer des divisions sur la boîte « + » crée une
  nouvelle boîte qui les contient. On ajoute ensuite des divisions à une boîte
  existante en les déposant dessus.
- Une boîte **reste** après une percée, même si ses divisions sont toutes
  engagées : on peut relancer une percée avec les divisions qui y restent. Une
  boîte n'est supprimée que quand elle n'a plus aucune division, ni dans la
  boîte ni engagée dans une de ses percées.
- **Déplacements** : sans délai entre la seconde ligne, la réaction rapide et
  les boîtes du même front (§4.4), et vers la réserve ; avec le délai habituel
  vers un autre front.
- **Renfort** (§4.3) : comme toute division qui n'est pas en combat. Une
  division engagée dans une percée (attaquant, tranche de première ligne ou
  force de contre-attaque) est en combat : pas de renfort.
- *Provisoire* : un front qui change (§2.5) — une division qui change de front
  sort de sa boîte et va en seconde ligne ; une boîte dont le front disparaît
  est supprimée.

## 5. Attaques et lignes en combat

### 5.1 Types et ordres

| Type | Qui tire | Avancée |
| --- | --- | --- |
| **Attaque sur tout le front** (assaut généralisé) | toute la première ligne des deux camps | sur toutes les routes du front (§7) |
| **Barrage d'artillerie** | hors périmètre | aucune |
| **Percée** | une boîte de percée contre une tranche de la première ligne adverse, puis contre sa réaction rapide (§7.2) | sur l'axe choisi |

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
| `move_division` | liste de divisions ; destination : réserve nationale, ou front + ligne (première, seconde, réaction rapide, boîte de percée existante, nouvelle boîte ; sans ligne → seconde). Vers la première ligne : si les divisions de sa niche qui y sont ou y vont, en route comprises, couvrent déjà toute la largeur du front, la division va en seconde ligne | chaque division est au joueur, n'est pas en formation ni engagée dans une percée ; le joueur est un camp du front ; la boîte est à lui sur ce front. *Provisoire* : les divisions invalides de la liste sont ignorées, les autres déplacées |
| `start_breakthrough` | front, boîte, axe (`city1`, `city2`) | front actif ; la boîte est au joueur sur ce front ; l'axe est une connexion du front ; la boîte a au moins une division disponible |
| `cancel_breakthrough` | percée | la percée est au joueur (*provisoire* : l'annulation de la v0.1 est gardée) |
| `set_forced_mobilization` | oui / non | toujours |
| `start_front_attack` / `stop_front_attack` | front | front actif ; le joueur en est un camp |

Noms proposés, à fixer à l'implémentation.

### 5.3 Échange avec la seconde ligne

À la fin des pertes de chaque round : une division de première ligne dont
l'état est **inférieur à la moitié** de celui d'une division disponible de la
seconde ligne **de la même niche** (*provisoire* : même niche) **échange sa
place** avec elle. Division choisie en seconde ligne : la meilleure selon
l'ordre du §4.2. Sans délai.

**Hors combat** (front sans attaque sur tout le front ni percée en combat,
c'est-à-dire sans renfort coupé en première ligne, §4.3) : à chaque tour, une
division de première ligne est remplacée par la division disponible de la
seconde ligne **de plus grand état**, si celle-ci est de la même niche, **du même
type ou d'un type prioritaire** (rang de la niche, §4.2) et a un état
**strictement supérieur** au sien. Si aucune division de seconde ligne ne
remplit ces conditions (type moins prioritaire, ou état pas supérieur), la
règle de la moitié ci-dessus s'applique. *Provisoire* : « type prioritaire » =
rang de la niche (§4.2) égal ou meilleur.

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

`10-Combat-Phases.md` remplace l'ordre d'application des dégâts (phases par
niche), la part de chaque division dans un type (§6.2 point 2 : l'unité la plus
abîmée d'abord) et le moment de la fuite (§5.4) ; la répartition entre niches
(§6.1 à §6.3) reste celle-ci.

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

### 6.3 Dégâts reçus par l'appui-feu

Décision de l'auteur du 1er novembre 2026 (remplace les pertes dérivées de celles
de l'infanterie et le facteur de blindage de la version du 30 octobre, voir
l'historique). Notations : `F` la largeur du front en liaisons (une liaison en
percée, tranche de première ligne comprise), `W_chars` la somme des largeurs
engagées de la ligne de chars du camp qui reçoit, `l` la largeur pleine de la
division d'appui-feu dans ce combat (`frontWidth`, ou `breakthroughWidth` en
percée et en contre-attaque), `part = largeur engagée / l`.

```
niche principale : dégâts = mixte × largeur engagée / (W_inf + W_chars)
appui-feu        : dégâts = mixte × part engagée / (F + W_chars)
mixte            = (armorPercent × antiblindé + (100 − armorPercent) × anti-infanterie) / 100
```

- L'appui-feu prend les dégâts d'**une liaison** de la ligne d'infanterie,
  multipliés par sa part engagée, **quelle que soit sa largeur**. Une division
  de largeur 3 est peu dense : elle ne prend que le tiers de ce qu'elle
  recevrait sur ses 3 liaisons (`mixte × (F/(F+W_chars)) × (largeur engagée/F) / l`).
- **L'infanterie compte comme si elle occupait tout le front** : en avoir moins
  ne protège pas l'appui-feu. Plus de chars le protègent (jusqu'à moitié moins,
  quand ils occupent tout le front).
- Le type de dégât reçu (soft, hard ou mélange) vient de l'`armorPercent` de la
  division, comme pour les niches principales : plus de rapport entre dégâts
  légers et durs.
- Perte : `f = dégâts / (PV × multiplicateur de PV en défense)`, puis chaque
  composant perd `f × lossMultiplier × count` (pertes tirées, §1), comme au §6.2
  (points 4 et 5).
- L'appui-feu n'est engagé que s'il y a de l'infanterie engagée (§4.2, §7.2).
- Les chars ne suivent pas cette règle : ils sont dans une niche principale
  (§6.2).

### 6.4 Fin du round

Dans l'ordre (*provisoire*) : pertes des deux camps ; divisions à 0 %
détruites ; fuites (§5.4) ; échanges (§5.3) ; rangement des lignes (§4.2) ;
avancée (§7), calculée sur les lignes rangées.

## 7. Avancée

### 7.1 Attaque sur tout le front

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
  engagée`). **Seule l'infanterie fait avancer le front** (décision de
  l'auteur, 1er novembre 2026) ; une division abîmée compte pour toute sa
  largeur.
- `A` = `FRONTS.advanceThresholdA` = **2** : rapport sous lequel le front
  n'avance pas (*provisoire*, repris de la version 0.1). `B` =
  `FRONTS.advanceThresholdB` = **10** (décision de l'auteur, 1er novembre 2026) :
  rapport à partir duquel il avance à vitesse maximale ; entre les deux, la
  vitesse croît en ligne droite.
- `v` : vitesse maximale, **progressive** (décision de l'auteur, 1er novembre
  2026) : de `FRONTS.footSpeedPermille` = **3** (0,3 % de la route par round,
  aucune division motorisée) à `FRONTS.motorizedSpeedPermille` = **10**
  (toutes motorisées ; valeurs de l'auteur du 5 novembre 2026, avant : 10 et
  20), au prorata de la largeur engagée des divisions motorisées, toutes
  niches :
  `v = foot + floor((motorisée − foot) × M / T)`, `M` = largeur engagée des
  divisions motorisées, `T` = largeur engagée de toutes (50 % motorisé : 6).
  Les deux vitesses servent aussi au saut d'une percée (§7.2), qui est tout
  ou rien.
- En entiers (largeurs comptées en millièmes de liaison) : `x = a − A × d`,
  borné à `[0, (B − A) × d]` ;
  `avancée = floor((2 × x × v + (B − A) × d) / (2 × (B − A) × d))`.
- **Défenseur sans infanterie engagée** (`d = 0`) : vitesse maximale.
  **Attaquant sans infanterie engagée** : aucune avancée. La vitesse `v`
  compte au contraire toutes les niches ; sans division engagée, elle est à pied.

### 7.2 Percée (version 2)

Décisions de l'auteur du 31 octobre 2026, reprises en partie de la version 0.1
(05-Fronts-History, §7.2 de la v0.1).

1. **Lancement** (ordre `start_breakthrough`) : le joueur choisit une boîte de
   percée, puis un **axe** sur la carte, une connexion du front (mode choix
   d'axe, §11.1). Front actif seulement. **La boîte doit contenir de
   l'infanterie** (disponible : ni en déplacement, ni en fuite) ; sinon l'ordre
   est invalide. Une force de chars seuls est refusée.
2. **Largeur de la percée** : **une liaison** (une connexion), quelle que soit
   la largeur du front. Les divisions y comptent avec leur
   **`breakthroughWidth`** (une tankette : 2 en première ligne, 1 en percée).
3. **Force qui perce** : prise dans la boîte **au lancement**, niche par niche,
   jusqu'à remplir une liaison par niche, dans l'ordre de choix (§4.2 : meilleur
   état, meilleur type, plus petit identifiant). La dernière peut n'être
   engagée qu'en partie (part engagée, §4.2) ; elle est quand même **toute
   prise** par cette percée. Les autres divisions **restent dans la boîte** et
   peuvent servir à une autre percée. **Pas de renfort** de la force en cours
   de percée : seules les divisions engagées au départ y prennent part.
   *Provisoire* : appui-feu sans infanterie dans la force, comme au §4.2 (il
   n'est pas engagé).
4. **Délai** : le combat commence `FRONTS.breakthroughDelayTurns` tours après
   le lancement (**50**, 5 s). Pendant le délai, la force est déjà prise (elle
   ne combat pas). Une percée a **sept phases**, pour que le joueur voie ce qui
   se passe (décision de l'auteur, 31 octobre 2026) : 0 délai, 1 combat contre
   la première ligne, 2 délai, 3 combat contre la réaction rapide, 4 délai
   (réussite), 5 délai (échec du combat 1), 6 délai (échec du combat 2).
   **Tous les délais ont la même durée**, `FRONTS.breakthroughDelayTurns`,
   un seul réglage.
5. **Combat 1, contre la première ligne** : le défenseur engage une **tranche
   de sa première ligne** de largeur une liaison par niche, en `frontWidth`,
   dans l'ordre de choix (*provisoire*). Cette tranche **reste en première
   ligne** et continue de prendre part à l'attaque sur tout le front s'il y en
   a une (*provisoire*). Rien ne la remplace pendant la percée. Pas d'avancée
   à chaque round.
6. **Première ligne percée** : quand plus aucune infanterie de la tranche
   n'est engagée (détruite ou en fuite). Alors :
   - le front **avance d'un coup** sur l'axe :
     `saut = arrondi(N × v × facteur de réaction)`, `N` =
     `FRONTS.breakthroughJumpRounds` = **10** ; `v` la vitesse de la force qui
     perce : motorisée (`FRONTS.motorizedSpeedPermille`) seulement si **toutes** les
     divisions disponibles de la boîte au lancement sont motorisées, sans
     exception — y compris celles que la percée ne prend pas et les chars qui
     roulent au pas, comme la chenillette ; sinon à pied
     (`FRONTS.footSpeedPermille`). Fixé au lancement ; le
     facteur de réaction est lu sur la force de contre-attaque telle qu'elle
     serait choisie à cet instant (point 8) ;
   - **délai** (phase 2), sans combat de la percée, **même sans infanterie dans
     la défense** (le délai sert à ce que les joueurs comprennent ce qui se
     passe) ;
   - puis le combat 2 commence (phase 3).
7. **Facteur de réaction** du défenseur, selon le pourcentage `m` de
   motorisation de sa force de contre-attaque (largeur des divisions
   motorisées / largeur de toutes, en `breakthroughWidth`, niches principales
   seulement, *provisoire*) : `m` = 100 % → 1 ; `m` < 50 % → `X` =
   `FRONTS.slowReactionFactor` = **3** ; entre les deux, linéaire (à 75 % : 2).
   Une défense à pied réagit lentement et laisse l'attaquant avancer plus.
8. **Combat 2, contre la réaction rapide** : la **force de contre-attaque** du
   défenseur remplit une liaison par niche, en `breakthroughWidth`, d'abord
   avec sa **réaction rapide**, puis complétée par sa **seconde ligne** pour
   arriver si possible à 100 % de couverture dans chaque niche ; dans l'ordre
   de choix. **Plusieurs percées** sur le même front : la réaction rapide et
   la seconde ligne se partagent **équitablement** entre elles, recalculé à
   chaque round. Les divisions de la force restent dans leur ligne.
9. **Seconde ligne percée** : quand plus aucune infanterie de la force de
   contre-attaque n'est engagée, ou qu'il n'y en a pas : **délai** (phase 4),
   puis le front avance jusqu'à la ville au bout de l'axe, qui tombe (§10). Pendant
   ce délai, la force de contre-attaque est libérée.
10. **Multiplicateurs** : la force qui perce attaque avec son
    **`breakthroughMultiplier`**, dans les deux combats. La force de
    contre-attaque (réaction rapide et seconde ligne) attaque avec son
    **`counterAttackMultiplier`**. La tranche de première ligne attaque sans
    multiplicateur. Le défenseur prend ses PV de défense
    (`defenseHitPointsMultiplier`) dans les deux combats (*provisoire*).
11. **Dégâts et pertes** : comme au §6, sur une largeur d'une liaison :
    partage infanterie / chars au prorata du remplissage, pertes de
    l'appui-feu, pertes tirées. **Fuite** (§5.4) : une division de la force
    qui perce qui tombe à 25 % retourne dans sa boîte, en fuite.
12. **Essoufflement** : la percée s'arrête quand l'état moyen de la force qui
    perce, pondéré par la largeur engagée, tombe sous
    `FRONTS.breakthroughExhaustionPercent` = **35** % de sa valeur au début du
    combat 1 (ou qu'elle est détruite). C'est un **échec** : la défense est
    libérée et un délai laisse la percée disparaître et ses divisions revenir
    dans la boîte — phase 5 après le combat 1, phase 6 après le combat 2.
    L'avancée déjà gagnée (le saut) reste ; si elle a mené le front au bout
    de la route, la ville tombe quand même à la fin du délai.
13. **Fin de la percée** : après le délai de la phase 4 (réussite : la ville
    tombe), 5 ou 6 (échec) ; **sans délai** si elle est annulée, si le front
    passe en paix ou si l'axe disparaît. Les divisions survivantes de la force
    qui perce **retournent dans leur boîte** ; celles du défenseur n'ont
    jamais quitté leur ligne.
14. *Provisoire* : boîte sans division d'infanterie disponible au lancement :
    l'ordre est invalide. Plus aucune division dans la force au début du
    combat 1 (elles ont fui pendant le délai) : c'est un échec, avec le délai de
    repli (phase 5) ; le joueur est prévenu (événement `breakthrough_failed`).
    Une force détruite ou en fuite pendant un délai d'échec (phases 5 et 6) ne
    raccourcit pas le délai.

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
  - si X était la dernière ville de B, B est éliminé (§10.3).

### 10.3 Élimination

- **Cas** : la prise de X laisse B sans ville. Le joueur nomade du début de
  partie, qui n'a pas encore fondé de première ville, n'est pas concerné : il
  n'a jamais eu de ville à perdre.
- **Effet**, au tour de la prise, après le recalcul des fronts (§10.1) :
  - B est marqué **éliminé** (`Player.defeated`) ; cela ne se défait pas ;
  - toutes ses divisions disparaissent, avec ses boîtes de percée et ses
    percées en cours ; ses propositions diplomatiques en attente sont
    supprimées ;
  - le moteur **ignore tous ses ordres** : il ne refonde donc pas de première
    ville gratuite. Les autres joueurs ne peuvent plus lui déclarer la guerre
    ni lui proposer un pacte ;
  - sa population est gardée (*provisoire*), pour le mode résistance.
- **Notification** : le moteur écrit l'événement `player_eliminated` (`from` :
  le preneur, `to` : l'éliminé). Voir §11.6 pour ce que la page affiche.
- **Mode résistance** : annoncé, **pas encore écrit** ; il est à décrire par
  l'auteur. En attendant, le joueur éliminé reste dans la partie en
  **spectateur**.

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
- **Unités** : quand l'écran montre au plus `FRONT_INFANTRY_MAX_TILES` cases
  (960 000, soit environ huit cents villes, *provisoire*), chaque camp dessine
  au plus une infanterie par connexion, centrée sur le segment droit, et rien
  d'autre, pas même le petit rond d'un emplacement vide. Quand il montre au plus `FRONT_UNITS_MAX_TILES` cases
  (240 000, soit environ deux cents villes, *provisoire*), toutes les icônes
  32 × 32 de la première ligne sont dessinées, aux couleurs de leur
  propriétaire, sur tous les fronts, **en guerre comme en paix** : elles
  remplacent les ronds d'un front actif. En paix, le point vaut le milieu de la
  route, sans petit point rouge. De chaque côté du point
  d'avancement, les unités sont en rangées parallèles au front. Première rangée,
  contre le front : l'infanterie (le plus haut à l'écran) et une autre unité
  (char ou appui-feu), côte à côte. Les autres unités de la connexion suivent par
  deux sur les rangées de derrière, vers l'arrière du camp ; une unité seule sur
  sa rangée est centrée. Les icônes sont dessinées vers la droite ; celles du camp
  situé à droite sur le trait entre les deux villes sont retournées, pour que les
  deux camps se fassent face (seul le sens gauche-droite du trait compte). Elles gardent leur
  taille à tout zoom : de loin, elles peuvent se chevaucher. Elles passent
  par-dessus les villes et les capitales.
  L'infanterie prend les connexions dans l'ordre de la chaîne, tant qu'il y en
  a ; un emplacement d'infanterie vide montre un petit rond de la couleur du
  joueur sur un front actif (*provisoire*), rien en paix. Chaque autre niche est
  espacée régulièrement le long du front, à partir d'un point de départ propre à
  la niche, pour que les types se mélangent ; une connexion reçoit d'abord une
  niche qu'elle n'a pas, puis celle qui a le moins d'unités passe avant
  (*provisoire*). Toute la première ligne est affichée. Une division en
  déplacement n'est pas montrée (*provisoire*).
- **Mode choix d'axe** (bouton « Lancer » d'une boîte de percée) : la fenêtre
  du front se ferme le temps du choix ; un clic sur la carte lance la percée
  sur la connexion du front la plus proche du clic (*provisoire*), surlignée
  au survol ; Échap ou le bouton **« Annuler la percée »**, en haut à droite
  de la carte, annule sans lancer la percée ; dans les deux cas la fenêtre se
  rouvre dans l'état d'avant (§11.4). Repris de la version 0.1.
- **Percée en cours** : un trait rouge sur le segment droit entre les deux
  villes de l'axe et une flèche au milieu, de la ville de celui qui perce vers
  celle de son adversaire. Les deux joueurs voient la même chose. Repris de la
  version 0.1.

### 11.2 Onglet des forces (nouveau)

Un nouvel onglet en haut de l'écran : un aperçu de **toutes les divisions** du
joueur, sous forme de pions (§11.3). Largeur d'exemple : 700 px (à fixer à
l'implémentation). De haut en bas :

1. **Barre du haut** : le **bouton « + »** (icône `misc-plus-lighter.png`,
   suivie du mot « RECRUTEMENT » en gras, majuscules, 22 px, bleu clair, sur un fond bleu très clair : `#dbeaff` en
   thème clair, `#2d4262` en thème sombre) occupe la
   **moitié gauche** ; la **corbeille** (fond rouge clair, icône noire ; auteur,
   3 novembre 2026) occupe la **moitié droite** et **n'apparaît que pendant un glisser**. Y déposer des divisions de la
   réserve nationale les supprime (§3.5). Icône de corbeille : *provisoire*.
2. **Réserve nationale**, en **deux sections séparées** comme les fronts
   (même écart, même fond), **formation en haut, réserve en bas**
   (décision de l'auteur, 1er novembre 2026). La section « formation » reçoit
   les divisions en formation (§3.5) ; la section « réserve » toutes les
   autres divisions de la réserve nationale (prêtes, ou en route vers elle).
   Chaque section porte son libellé (« FORMATION », « RÉSERVE ») en gros et en
   gras, en gris proche du fond, à droite et **derrière** les pions : un
   libellé caché par les pions n'est pas gênant. Seule la section « réserve »
   reçoit des déposes. Chacune est détaillée : de vrais pions, **un groupe par type**
   (§11.3 : espacé, puis piles), **jamais deux types dans la même pile**. Pas
   de colonnes de niche. Elle est **toujours déployée**, sans mode « trop de
   pions » ni survol : quand les piles ne tiennent pas sur une ligne, elles
   passent à la ligne. Les types d'une même niche se suivent et sont posés
   sur une seule ligne si possible (une niche n'est coupée qu'entre deux
   types, jamais au milieu d'un type) ; décalage de pile le plus grand qui
   fait tenir chaque niche sur une ligne (au plus petit : 8 px), le même pour
   toutes les piles. Un type qui ne tient pas seul sur une ligne montre le
   maximum de pions (le dessus de la pile) puis un « + », dans la police du
   nombre de divisions (20 px, blanc, contour noir) ; les pions cachés ne se
   sélectionnent pas tant que ceux du dessus sont là. La section
   grandit vers le bas, **les fronts sont repoussés dessous** et la fenêtre
   s'agrandit (défilement à partir de sa hauteur maximale).
3. **Les fronts**, chacun dans sa section : d'abord les **fronts en guerre
   active**, puis les **fronts en paix**, chaque groupe trié par longueur
   (*provisoire* : du plus long au plus court). Une section de front :
   - fond de la **couleur de l'adversaire**, telle que la carte la montre sur la terre, avec un contour de sa couleur de frontière ;
   - à gauche, la **colonne du statut diplomatique** : un carré de 32 × 32 px
     à bord noir, **rouge en guerre, bleu en paix** (*provisoire* : carrés en
     attendant les icônes) ; la réserve a une case vide de même largeur, pour
     l'alignement ;
   - à droite du carré, la **largeur du front** (nombre de connexions, §2) :
     un symbole de double flèche haut/bas (*provisoire* : carré gris de
     16 px en attendant l'icône) puis le nombre (police de 20 px, blanc,
     contour noir) ;
   - puis, côte à côte, pour chaque niche non vide : **une icône** (celle du
     type le plus nombreux de la niche) et, à côté, le **nombre total** de
     divisions de la niche (police de 20 px, blanc, contour noir de 1 px). Pas
     de pile, pas de case vide, pas de tri par ligne ;
   - **survol** (décision de l'auteur, 1er novembre 2026) : la souris sur une
     section met en évidence la zone de ce front sur la carte, comme si la
     souris était sur la carte (§11.1) ; réciproquement, la souris sur la zone
     d'un front de la carte met sa section en évidence dans la liste. L'infobulle
     de la section donne le nom de l'adversaire : « Front en guerre contre
     *nom* : cliquez pour l'ouvrir. » (« Front en paix contre … » sinon).
- **Glisser-déposer** (sélection : §11.4) d'une section à l'autre : une
  division déposée sur un front va en **seconde ligne** (§4.2) ; sur la
  réserve nationale, elle y retourne. **Quand la fenêtre d'un front est
  ouverte en même temps que l'onglet**, une division de l'onglet se dépose
  aussi directement sur ses lignes, sa réaction rapide et ses boîtes de percée
  (les mêmes déposes que depuis la fenêtre elle-même, §11.4). Pour retirer des divisions d'un front,
  le joueur **clique sur le front** : sa fenêtre s'ouvre (§11.4), avec le
  bouton « ← Retour ».

**Menu « + »**

- Menu déroulant sous le bouton ; **il ne se ferme pas après un clic** ; **un
  clic en dehors le ferme**.
- **Une ligne par niche** (fond de la niche, §11.4 ; nom de la niche à droite
  en lettres sombres, 36 px), **les types de la niche côte à côte** (icône de
  32 px), **du moins prioritaire au plus prioritaire** : l'inverse de l'ordre de
  la niche (§3.1), le meilleur type est à droite (décision de l'auteur, 1er
  novembre 2026). Un nouveau type se place **à droite** des types existants.
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
  **Pas de barre à 100 %** (division au complet). En formation, la même barre
  montre la part écoulée de la formation au lieu de l'état : elle se remplit
  jusqu'à ce que la division soit prête, avec les mêmes couleurs. Seul
  mini-widget pour l'instant.
- **Rang** : icône de 8 × 10 en taille réelle, coin **haut gauche**
  (`icons/ranks/icon-rank-N.png`, N de 0 à 7). Rang 0 : rien n'est dessiné sur
  le pion. **Le rang n'existe pas encore dans les règles** : en V1, toutes les
  divisions sont au rang 0, donc aucune icône de rang n'est dessinée sur un
  pion (§16).
- **Statut** : icône de 16 × 16 en taille réelle, coin **bas gauche** :
  `icons/miscellaneous/icon-up-arrow.png` en formation,
  `icon-down-arrow.png` pour une division en trop, qui va disparaître faute de
  bâtiments (08 §6, prioritaire sur les autres statuts),
  `icon-clock.png` en déplacement,
  `icon-white-flag.png` en fuite, `icon-shield.png` (bouclier) pour une
  division qui **défend une percée** (tranche de première ligne ou force de
  contre-attaque : elle reste dans sa colonne, et compte aussi dans la colonne
  « Défense » du petit tableau de la percée, §11.4). Le rang et le statut ne se
  chevauchent pas. La force qui perce n'a pas de pion dans les colonnes : elle
  est dans le petit tableau.
- **Transparence** : en formation, en déplacement ou en fuite, l'icône du type est à
  **50 % d'opacité**. Rang, statut et barre gardent leurs couleurs. Le bouclier
  ne rend pas l'icône transparente : la division combat.
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
   prêtes au combat, puis les abîmées par état décroissant, puis celles en
   formation, en déplacement ou en fuite, elles aussi par état décroissant.
3. **Trop de pions** (même à 8 px, ça ne rentre pas) : une seule icône par
   type, le pion du dessus de la pile (avec rang, statut et barre), et à côté
   le nombre de divisions du type (police de 20 px, blanc, contour noir de
   1 px) ; 16 px entre les types. **Au survol**, le rectangle de la zone
   s'élargit et grandit vers le bas le temps de la sélection : toutes les
   divisions y sont visibles côte à côte, une ligne ou plus par type, dans
   l'ordre de la pile, 3 px entre pions. Pas de hauteur maximale. Ce
   rectangle élargi **reste ouvert tant que la souris est dessus**, même hors du
   rectangle de base de la zone et même quand la zone est redessinée (survol d'un
   autre pion, tour suivant). Même principe pour toute vue de survol dans laquelle
   on peut sélectionner. Les boîtes de percée du joueur (§11.4) n'ont pas ce
   rectangle : leurs types passent à la ligne suivante quand ils ne tiennent pas
   sur une ligne.

### 11.4 Fenêtre d'un front

La fenêtre **recouvre presque toute la carte** (10 px de marge) ; il est
accepté que ses boîtes aient de l'espace inutilisé. Les largeurs de la maquette
(1 284 × 500 px) sont des exemples, à ajuster à l'implémentation.

**Bandeau du haut**, coupé en deux par la barre verticale :

- moitié du joueur : titre du front (« Front contre Bot k ») ; à sa droite,
  après un espace, « Largeur du front : », le symbole de largeur (16 × 16 px)
  et le nombre de liaisons en gras ; puis « paix » en bleu ou « guerre » en
  rouge ; puis l'interrupteur
  **« Sélection avancée »** (éteint par défaut ; un vrai **interrupteur** : une
  piste grise avec une pastille à gauche éteint, bleue avec la pastille à droite
  allumé) ; alignés à droite dans cette
  moitié, les boutons **« Attaque sur tout le front »** (interrupteur, §5.1) et
  **« Barrage d'artillerie »** (grisé, sans effet). Pas de bouton de percée en
  V1 ;
- moitié adverse : le bouton de fermeture ✕ à droite. Ouverte **depuis
  l'onglet des forces**, la fenêtre a aussi un bouton **« ← Retour »** à gauche
  du ✕, qui ramène à l'onglet ; ouverte depuis la carte, pas de bouton Retour,
  et ✕ ramène à la carte (*provisoire* : place du bouton Retour).

**Corps**, de gauche à droite :

- côté du joueur : colonne des **forces de percée**, colonne de la
  **réaction rapide**, puis une **capsule** (rectangle arrondi) qui
  contient la **seconde ligne** puis la **première ligne** ;
- **barre verticale** ;
- côté adverse, en miroir : une capsule avec la **première ligne**, contre la
  barre et **de la même largeur que celle du joueur**, puis la **seconde
  ligne** comprimée ; puis la réaction rapide et les forces de percée
  comprimées. Le reste du côté adverse est comprimé (maquette : 800 px
  pour le joueur, 484 px pour l'adversaire).
- **Réaction rapide** et **boîtes de percée** se présentent comme les lignes
  d'un front (rangées par niche, pions de §11.3), sauf que les boîtes de
  percée **n'ont pas de couleur de niche**.
- **Zone des avions** : en bas, sur toute la largeur, un cinquième de la
  hauteur, réservée et vide.
- **Statistiques de combat de la première ligne** : entre la capsule et la barre,
  une **colonne de 62 px** de chaque côté porte, **pour chaque rangée de
  première ligne**, trois lignes de 16 px : l'**attaque anti-infanterie**
  (`softAttack`), l'**attaque anti-armure** (`hardAttack`) et les **PV**, chacune
  avec son icône de 16 × 16 px (`icon-soft-attack`, `icon-hard-attack`,
  `icon-health`, dossier `miscellaneous`) et son nombre, de la couleur de
  l'icône (orange, bleu, rouge ; teintes plus foncées en thème clair). Côté du
  joueur : icône puis nombre, alignés à gauche contre la capsule ; côté
  adverse, le miroir (nombre puis icône, alignés à droite contre la capsule).
  Nombres courts : exacts sous 1 000, puis `4,5k`, `135k`, `2,5M`. Rangée
  vide : 0. Les **niches d'appui-feu** n'affichent **pas de PV** (la ligne
  garde sa place, les deux attaques restent à la même hauteur que dans les
  niches principales). Les flèches clignotantes de l'attaque sur tout le front
  n'existent plus dans la fenêtre : le bouton « Attaque sur tout le front »
  clignote (§5.1) ; la flèche des cartes de percée (ci-dessous) reste.
  **Calcul** (page, `frontstats.ts`, formules du moteur) sur les divisions
  **engagées en première ligne** (`line = first`, `engaged > 0`, pas en
  déplacement) :
  - attaques : ce qui tombe réellement (comme `attackOf`, §6.1) : pour chaque
    composant, part engagée de la division (`engaged` / largeur de première
    ligne) × attaque × taux de présence, en points. `attackMultiplier` du type
    s'applique **si ce camp a lancé l'attaque sur tout le front** (front actif),
    sinon l'attaque est celle par défaut (×1) ;
  - PV : `hitPoints` du type × état de la division (`state` / échelle), sans
    multiplicateur de PV en défense, **niches principales seulement**
    (infanterie et chars).
  Aucun champ n'est ajouté au message du Worker : `DivisionView` et le
  catalogue de `init` suffisent.
- **Totaux** : sous le titre de chaque première ligne (au-dessus des rangées),
  trois lignes de 16 px, **icônes collées** : icône, nombre, **barre fine** (5 px)
  centrée sur l'icône. Nombre = somme des rangées de la colonne : attaques de
  **toutes** les niches, PV des **niches principales** seulement. Barres
  **face à face** de part et d'autre de la barre centrale, à l'échelle
  commune aux deux camps. Les deux attaques ont **la même échelle** : la plus
  grande des quatre valeurs (anti-infanterie et anti-armure, des deux camps)
  remplit la barre. Les PV ont leur échelle : la plus grande des deux
  valeurs remplit la barre. Barres ancrées du côté de la barre centrale ; le
  nombre est du côté extérieur.
- Chaque colonne a un titre gris **en haut à gauche** (14 px ; « Seconde
  ligne », « Première ligne », « Réaction rapide », « Forces de percée » ;
  « Percée » pour la colonne comprimée de l'adversaire). Les colonnes
  comprimées de l'adversaire gardent un titre de 11 px, qui tient dans leur
  largeur. **Les titres de toutes les colonnes ont la même hauteur** (74 px :
  titre de 20 px, puis place des trois totaux de la première ligne), pour que
  les rangées restent alignées.
- **Largeur de la première ligne** : la première ligne adverse a la largeur de
  celle du joueur, et le reste du côté adverse a des largeurs fixes. La première
  ligne du joueur fait donc au plus ce que le côté adverse peut porter (au moins
  200 px) ; la **seconde ligne du joueur absorbe** le manque de place (au moins
  100 px). Si le côté adverse déborde encore (fenêtre étroite, environ moins de
  1 460 px), la zone des deux côtés **défile horizontalement**
  (*provisoire* : à refaire plus tard).
- **Pertes du dernier round** : en haut de chaque **première ligne** (du
  joueur et de l'adversaire), alignées à droite sur la ligne du titre, en
  rouge : « Pertes : x hommes / tour », `x` = les hommes perdus par les
  divisions de cette première ligne au dernier round de combat (une seconde),
  tranches de première ligne des percées comprises : la somme de
  `FrontSide.lastLossByNiche`, remis à 0 à chaque round ; la ligne disparaît 10 secondes après le dernier combat du front.
- **Pertes par rangée** (auteur, 4 novembre 2026) : dans la colonne de
  statistiques de chaque première ligne, sous les trois statistiques de chaque
  rangée, une quatrième ligne en rouge « −N » : les hommes perdus par cette
  niche au dernier round (`lastLossByNiche[niche]`, notation courte de
  `formatStat`). Vide sans perte, ou 10 secondes après le dernier combat du front,
  à la même hauteur, pour que les statistiques ne bougent pas.

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
- **Panneau de prédiction** : au survol du bouton d'attaque sur tout le front
  ou du bouton « Lancer » d'une boîte, un panneau estime le combat. Titres de colonnes « Vos pertes » et « Ses pertes » en gras. Vos pertes à
  gauche, celles de l'adversaire à droite, en % des divisions engagées, avec
  « ≈ » : total, puis infanterie, blindés et appui-feu. Entre les deux, une barre
  aux couleurs des joueurs, partagée selon ces pertes : le camp qui perd le moins
  a la plus grande part, et le rapport de pertes (×2,5) est écrit sur elle. Si
  une niche est vide d'un côté, ou, pour le total, si un camp n'a aucune division engagée, la barre est entièrement de la couleur du camp
  qui a quelque chose dans cette niche. En
  bas, les déroutes de chaque camp, et au milieu l'avancée et la durée. Pour une
  percée, une ligne par combat.
  **Estimation** (*provisoire*) : avec les formules du §6 (PV, multiplicateurs
  d'attaque, de percée, de contre-attaque et de défense). Une attaque sur tout
  le front est rejouée round par round, renforts, rounds d'attente et replis
  compris. Pour une percée, sans renforts, les pertes d'un round sont prolongées
  jusqu'à ce que l'infanterie d'un camp atteigne son seuil de fuite, au plus
  `combatMaxRounds` rounds.
  **Verdict** (*provisoire*) : position dominante si l'infanterie adverse cède
  d'abord et que vous perdez au moins deux fois moins que l'adversaire ; position
  perdante si la vôtre cède d'abord et que vous perdez au moins deux fois plus ;
  position équilibrée sinon. Percée probable si les deux combats sont gagnés,
  incertaine si seul le combat 1 l'est, improbable sinon ; un combat est gagné
  si l'infanterie adverse cède avant la vôtre.
- **Infanterie manquante** : quand la rangée d'infanterie de la première ligne
  du joueur, ou celle d'une de ses boîtes de percée, est vide, le texte rouge
  « L'infanterie est essentielle. » s'y affiche : les autres unités ne peuvent
  rien faire sans elle.
- **En première ligne seulement** (du joueur et de l'adversaire), sous les
  lettres, le **pourcentage de couverture du front** de la niche (largeur
  engagée / largeur du front), de même taille et gras ; lettres et
  pourcentage y sont plus sombres encore, en 24 px.
- **Largeur de la zone des pions en première ligne** : celle de la rangée
  **moins la place des lettres et du pourcentage** (96 px, à droite de la
  rangée). Les pions sont donc un peu plus comprimés (les piles se forment plus
  tôt) et ne passent jamais sous le texte. Cette largeur est celle passée à la
  disposition de §11.3 ; elle ne concerne pas la seconde ligne.
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

**Forces de percée du joueur** (colonne de 170 px) :

- une **liste de boîtes** qui défile verticalement (pas de compression des
  boîtes) ; chaque boîte : un petit **bouton « Lancer »** à gauche (mode choix
  d'axe, §11.1) et, à droite, la **motorisation de la boîte**, « Motorisée »
  ou « Au pas », suivie d'un symbole de 16 × 16 px (`icon-motorized.png`, un
  camion, ou `icon-on-foot.png`, des pieds, dans `miscellaneous/`) — le bouton est à gauche pour **ne pas
  bouger** quand la vue étendue s'ouvre (son en-tête a la même largeur et la
  même place que celui de la boîte). « Motorisée » : **toutes** les
  divisions de la boîte sont motorisées, sans exception (la règle de la
  vitesse de la force qui perce, §7.2 ; les divisions en déplacement ou en
  fuite ne comptent pas) ; sinon « Au pas ». Au survol du texte ou du symbole,
  un panneau (texte de l'auteur) : *Motorisée — Toutes les unités de ce groupe
  sont motorisées. Quand la première ligne adverse est percée, le front fait
  un saut trois fois plus long que celui d’une force à pied.* *Au pas — Une
  partie des unités de ce groupe avance au pas. Donc il avance lentement. Pour
  avancer plus loin, ne mettre que des unités motorisées.* Le bouton
  « Lancer » est **grisé sans infanterie** dans la boîte, avec le message
  « Vous avez besoin d'infanterie pour la percée. » au survol ; dessous,
  ses pions **groupés par type** (3 px entre pions, 10 px entre types), sans
  fond coloré ; quand ils ne tiennent pas sur une ligne (trop de types), ils
  passent à la ligne suivante et la boîte grandit, rien ne dépasse à droite ;
- **dernier élément de la liste** : la **boîte « + »** à bord pointillé, juste
  après la dernière boîte (tout en haut de la colonne s'il n'y en a pas)
  (décision de l'auteur, 1er novembre 2026). **Y déposer des
  divisions crée une nouvelle boîte** (§4.6) ; déposer sur une boîte existante
  les y ajoute ;
- **pendant un glisser**, la zone « Retour à la réserve nationale » apparaît
  sous la liste ;
- **au survol d'une boîte**, une vue étendue s'ouvre vers la droite : la
  même vue que les **premières lignes face à face**, sans les secondes lignes.
  À gauche, la boîte (bouton Lancer et motorisation, **cinq rangées par niche
  colorées**, pourcentage de couverture d'une liaison — largeur de percée,
  §7.2 —, pions) ; à droite, la première ligne adverse (rangées colorées,
  pourcentage de couverture du front, pions). Les pions de la boîte se
  sélectionnent et se glissent ; le survol d'un pion, de l'un ou de l'autre
  côté, ouvre son panneau (§11.7).

**Réaction rapide du joueur** (colonne de 170 px) : rangées par niche, comme
une ligne ; on y dépose des divisions.

**Percées en cours** : la force engagée d'une percée quitte sa boîte (la boîte
reste dans la liste avec ses autres divisions) et s'affiche **en haut de la
fenêtre du front**, sous le bandeau, dans un **petit tableau par percée**
(décision de l'auteur, 31 octobre 2026), de gauche à droite, des deux camps :

- titre « Percée n » (« Percée de Bot k » pour l'adversaire), sans les numéros
  de villes de l'axe ; bord gauche bleu pour les percées du joueur, rouge pour
  celles de l'adversaire ; **juste à droite du titre**, une petite **flèche
  rouge clignotante** (cycle de 1 s) pendant les deux combats (phases 1 et 3),
  vers la droite pour le joueur, vers la gauche pour l'adversaire ;
- une **croix** en haut à droite, sur les percées du joueur seulement :
  elle **arrête la percée** (`cancel_breakthrough`) ;
- un tableau : une rangée par niche engagée (icône), deux colonnes « Perce »
  (la force qui perce) et « Défense » (la tranche de première ligne ou la force
  de contre-attaque), chacune avec le **nombre de divisions** et leur **état
  moyen** ; « · » quand il n'y en a pas (pendant le délai, la défense n'est pas
  encore engagée) ;
- en bas, un **texte par phase** (§7.2, textes de l'auteur), les délais
  décomptés en secondes (`n s`) :
  0. « Préparation de l'assaut : n s » ;
  1. « Assaut première ligne » ;
  2. « Première ligne percée, contre-attaque en préparation : n s » ;
  3. « Contre-attaque des défenseurs en cours » ;
  4. « Percée accomplie, avancée du front dans : n s » (réussite) ;
  5. « Percée échouée, repli : n s » (échec du combat 1) ;
  6. « Première ligne percée, mais une contre-attaque a limité l'avancée. n s »
     (échec du combat 2) ;
- sous ce texte, « **Avancée de x% sur ce front** », mise à jour à chaque
  phase : `x` = l'avancée de la percée sur la route de son axe, en millièmes
  de route divisés par 10 (une décimale au plus). Zéro avant le saut ; le
  saut ensuite (§7.2, point 6) ; en phase 4 (réussite), le saut plus la
  distance qui reste jusqu'à la ville, que le front va parcourir à la fin du
  délai (`advanceOf`).

**Lancer une percée** : le bouton « Lancer » ferme la fenêtre pour le mode
choix d'axe (§11.1) ; à la fin du mode (clic ou Échap), la fenêtre **se
rouvre dans l'état d'avant** (même front, avec ou sans « ← Retour »).

**Colonnes comprimées de l'adversaire** : sa réaction rapide (comme sa seconde
ligne comprimée) ; ses forces de percée (une boîte comprimée par boîte, icône
et nombre, sans nom ni bouton ; boîte « ··· » pour celles qui ne tiennent pas
en hauteur ; au survol de la colonne, un cadre de 330 px vers la gauche avec
toutes les boîtes, rangées par niche non vides et pourcentages ; titre
« Percée »).

### 11.5 Points du front

- Point d'une connexion : `P = city1 + (city2 − city1) × position / 1000`, en
  flottants (client seulement). En paix, `position` = 500 (milieu).
- **Voisins** : deux connexions du même front sont voisines si elles partent de
  la même ville et sont consécutives dans l'ordre angulaire de **toutes** les
  routes de cette ville, avec un angle inférieur à 180°. Les voisinages forment
  des chaînes ou des boucles.
- Les points sont recalculés à la réception des fronts, pas à chaque image.

### 11.6 Hors des fronts

- **Liste des fronts** : il n'y a pas d'onglet à part, c'est l'onglet des forces
  (§11.2) qui les range, en guerre d'abord puis en paix, chaque groupe du plus
  long au plus court.
- **Onglet Population** : les soldats (hommes des divisions) gardent leur
  place, avant les inactifs ; les blessés (00-Game §4.2) sont en dernier. Interrupteur **« MOBILISATION FORCÉE »** : rouge,
  éteint par défaut ; il sert à remplir les divisions (§4.3).
- **Barre de stock de chaque armement** : la portion jaune foncé montre
  l'équipement des divisions.
- **Élimination d'un joueur (§10.3)** :
  - *Aux autres joueurs* : une notification (carte, 60 s) « X est éliminé : Y a
    pris sa dernière ville et ses troupes ont disparu », qui ajoute qu'un mode
    résistance arrivera bientôt dans le jeu et n'est pas encore implémenté.
  - *Au joueur éliminé* : une fenêtre au centre de la carte, « Vous êtes
    éliminé », qui dit qui a pris sa dernière ville, annonce le mode résistance
    (pas encore implémenté) et propose **« Continuer en spectateur »** ou
    **« Quitter la partie »**.
  - *Spectateur* : bandeau « Éliminé — spectateur » en haut, boutons « Créer
    une ville » et « Inaugurer une usine » désactivés, pas de menu de
    diplomatie au clic sur la carte ; la carte, les fronts et le tableau des
    joueurs (« (éliminé) » à côté du nom) restent affichés. Le moteur ignore de
    toute façon ses ordres. Un joueur qui rejoint après coup (rejeu) est
    spectateur sans fenêtre : l'événement n'est pas rejoué.

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
  s'il est nul. Chaque statistique a une petite icône (*provisoire* : carré de
  16 × 16 px), sauf le déplacement : camion (motorisé) ou pieds (à pied),
  `icon-motorized.png` / `icon-on-foot.png`. S'y ajoutent la **largeur de
  front en percée** (`breakthroughWidth`), le **multiplicateur en attaque** et
  le **multiplicateur de PV en défense**, **seulement s'ils diffèrent de × 1**.

**Panneau d'un pion** (fenêtre d'un front et onglet des forces), 280 px :

- apparaît **14 px au-dessus du pion**, jamais collé à la souris ;
- **disparaît dès qu'une sélection avancée (après le premier clic) ou un
  glisser commence** ;
- **ligne de statut**, optionnelle, **au-dessus de l'en-tête**, en **rouge et en
  gras** : ce que veut dire l'icône de statut du pion (§11.3) — « En
  entraînement » (en formation), « En route vers le front » (ou « vers la
  réserve »), « En repli » (en fuite), « Défend une percée ». Rien d'écrit quand
  la division n'a pas de statut ;
- en-tête : l'**icône du type** (32 × 32 px), puis l'**icône de rang** (rang 0
  compris ; agrandie ×2 : 16 × 20 px), puis le **nom du type en gras** ;
  **niche en gris** à droite ;
- **description** ;
- **équipement** : icône 32 × 32, nom, **quantité actuelle / quantité
  requise** (hommes compris) ;
- **état** : le pourcentage seul (« 92 % ») ;
- **attaques non nulles** : valeur actuelle / valeur maximale
  (anti-infanterie, antiblindée, antiaérienne), avec les mêmes icônes ;
- puis **les statistiques du type** du panneau d'un type : PV, blindage,
  largeur de front, largeur de front en percée, multiplicateurs, déplacement
  (mêmes règles d'affichage). Tout ce que montre le panneau d'un type figure
  aussi dans celui d'un pion.
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
| `transferRounds` | 10 | délai d'un déplacement, en rounds de combat |
| `fleeStatePercent` | 25 | état sous lequel (ou auquel) une division fuit |
| `fleeRounds` | 10 | rounds avant qu'une division en fuite puisse revenir en première ligne |
| `swapStatePercent` | 50 | une division de première ligne échange quand son état est sous ce % de celui d'une division de seconde ligne |
| `reinforcePercentPerRound` | 3 | part de son effectif complet qu'un composant regagne par round de combat (§4.3) |
| `capturePercent` | 1 | position du front, en % de la route depuis la ville prise |
| `minEncirclementLengthPercent` | 25 | part de la route que le perdant doit tenir pour que la route soit encerclée |
| `encirclementLossPercent` | 50 | pertes d'encerclement |
| `advanceThresholdA` | 2 | rapport d'infanterie sous lequel l'assaut n'avance pas |
| `advanceThresholdB` | 10 | rapport d'infanterie à partir duquel l'assaut avance à vitesse maximale |
| `footSpeedPermille` | 3 | vitesse maximale à pied, en millièmes de route par round (aussi pour le saut d'une percée) |
| `motorizedSpeedPermille` | 10 | vitesse maximale entièrement motorisée (aussi pour le saut d'une percée) ; une armée mixte est entre les deux (§7.1) |

| `breakthroughDelayTurns` | 50 | durée de **tous** les délais d'une percée (5 s) : avant le combat 1, avant le combat 2, avant la chute de la ville, et les deux délais d'échec |
| `breakthroughJumpRounds` | 10 | `N` : le saut d'une première ligne percée vaut `N × vitesse × facteur de réaction` |
| `slowReactionFactor` | 3 | `X` : facteur de réaction d'une défense motorisée à moins de 50 % |
| `breakthroughExhaustionPercent` | 35 | une percée s'arrête quand l'état moyen de sa force tombe sous ce % de celui du début |

Valeurs de la percée reprises de la version 0.1. Supprimés :
`metersPerConnection`, `priorityPercent`, `maxSecondLineOvercrowding`,
`transferTurns`.

**`packages/engine/src/config/divisions.ts`** (remplace `config/units.ts`) :
`DIVISIONS` (types, §3.4), `NICHES` (types rangés du meilleur au moins bon,
sorte principale ou appui-feu, §3.1) et `ELITE_TROOPS_RATIO` (10, §3.5).
Multiplicateurs : deux décimales au plus. La durée de formation est un champ de
chaque type (`formationTurns`), plus un réglage de `fronts.ts`.

## 13. Moteur

### 13.1 Structures

```ts
interface Division {              // divisions.ts
  readonly id: number;
  readonly owner: number;
  readonly type: number;          // indice dans les clés de DIVISIONS
  readonly counts: number[];      // exemplaires par composant, ordre de `components`
  front: number;                  // 0 : réserve nationale ; en déplacement : destination
  line: number;                   // LINE_FIRST, LINE_SECOND, LINE_RAPID, LINE_BOX ; seconde dans la réserve
  box: number;                    // boîte de percée (LINE_BOX) ; 0 sinon
  breakthrough: number;           // percée où elle est engagée (force, tranche, contre-attaque) ; 0 sinon
  btEngaged: number;              // largeur engagée dans cette percée, millièmes de liaison
  engaged: number;                // largeur engagée en première ligne, millièmes de liaison
  arrivalTick: number;            // en déplacement : tour d'arrivée ; 0 sinon
  readonly formedTick: number;    // fin de formation
  fleeUntilTick: number;          // en fuite jusqu'à ce tour exclu
}
interface FrontSide {            // fronts.ts, un par camp
  frontAttack: boolean;
  lastLossByNiche: number[];      // hommes perdus par sa première ligne au dernier round, par niche (§11.4) ; remis à 0 à chaque round
}
interface Front {
  readonly id: number;
  readonly players: readonly [number, number];   // p1 < p2
  readonly groups: readonly [number, number];
  connections: FrontConnection[];                 // par (city1, city2), avec position
  sides: [FrontSide, FrontSide];
}
interface Box { readonly id: number; readonly front: number; readonly owner: number }   // breakthroughs.ts
interface Breakthrough {          // breakthroughs.ts
  readonly id: number; front: number; readonly owner: number; readonly box: number;
  readonly city1: number; readonly city2: number;  // axe
  phaseTick: number;              // tour où la phase a commencé ; fin d'un délai : phaseTick + son délai
  phase: number;                  // 0 délai, 1 combat contre la tranche, 2 délai, 3 combat contre la contre-attaque, 4 délai (réussite), 5 et 6 délais (échecs 1 et 2)
  advance: number;                // avancée gagnée par le saut, en millièmes de route (advanceOf y ajoute le reste en phase 4)
  readonly motorized: boolean;    // fixé au lancement : toutes les divisions disponibles de la boîte sont motorisées
  startState: number;             // état moyen de la force au début du combat 1
}
// GameState : divisions (par id croissant), nextDivisionId, fronts, nextFrontId,
// boxes, nextBoxId, breakthroughs, nextBreakthroughId ;
// Player : forcedMobilization, soldiers (hommes des divisions, recomptés par countSoldiers), hurt (blessés, 00-Game §4.2).
```

- **Échelles** : état d'une division sur 10 000 (`STATE_SCALE`), largeurs en
  millièmes de liaison (`WIDTH_SCALE`), fractions de pertes `f` sur 1 000 000
  (`LOSS_SCALE`), dégâts en millièmes de point. Pertes tirées : `q` = 10⁸
  (`LOSS_SCALE` × échelle 100 du `lossMultiplier`).
- **Fichiers** : `divisions.ts` (types en entiers, état, excédent, attaques,
  pertes) ; `placement.ts` (ordres des divisions, renfort, arrivées, rangement
  des lignes, fuite, échange) ; `breakthroughs.ts` (boîtes, percées : ordres,
  forces, vérifications, nettoyage après un changement de front) ;
  `combat.ts` (round, combats de front et de percée, appui-feu, avancée) ;
  `conquest.ts` (prise, encerclement) ; `fronts.ts` (détection, coupure,
  guerre et paix).
- La largeur engagée est rangée dans l'état à chaque rangement ; l'état d'une
  division se recalcule à la lecture (`stateOf`).

### 13.2 Ordre dans un tour (*provisoire*)

Ordres ; économie (00-Game §4 : répartition sur `population − hommes des
divisions − blessés`) ; renfort (§4.3) ; fins de formation et arrivées ; excédents
(§3.2) ; rangement des lignes (§4.2) ; échange hors combat (§5.3) ; si `tick % combatTurns = 0`, le round de
combat de chaque front actif (§6, §7) ; prises de villes et encerclement (§10).

### 13.3 Hash (02-Engine §5)

Tout ce qui est dans `GameState` entre dans le hash : chaque division (tous ses
champs), `nextDivisionId`, chaque front (id, joueurs, groupes, connexions avec
positions, attaques, pertes du dernier round), la mobilisation forcée de chaque joueur, son état
d'élimination (`defeated`).

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
- Un round : partage 2/3 – 1/3, pertes par composant, dégâts de l'appui-feu
  (§6.3 : largeur du front, chars, part engagée), échange, fuite. Pertes tirées (§1) : partie entière
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

- coupure : plus grand reste, divisions et morceaux par identifiant, sans
  délai ; identifiant d'un front fusionné ou coupé (§2.5) ;
- nouvelle connexion créée en guerre par une fondation : 500 (§2.4) ; route
  vers un troisième joueur après une prise : 500 (§10.1) ;
- pion : place de la barre non réservée à 100 % (§11.3) ;
- panneau de prédiction : estimation sur un round, seuil de rapport de pertes
  (×2) et conditions des verdicts (§11.4) ;
- unités sur la carte : seuil de cases à l'écran, petit rond d'un emplacement d'infanterie
  vide, divisions en déplacement non montrées (§11.1) ;
- interface : ordre et lettres des niches, tri des fronts de l'onglet, place
  du bouton Retour et du panneau de type, largeurs, icônes de statut
  diplomatique, de statistique et de corbeille, panneau d'un pion adverse
  (§11.2, §11.4, §11.7) ;
- excédent rendu sans délai, à chaque tour (§3.2) ;
- division à 0 % : le reste est perdu (§3.3) ;
- création : inactifs seulement même en mobilisation forcée ; division en
  formation non déplaçable et non supprimable ; limite des élites comptée à la
  création, divisions en formation comprises (§3.5) ;
- rangement des lignes à chaque tour (§4.2) ;
- renfort : ni en déplacement, ni en fuite ; calcul par parts égales et reste
  par identifiant (§4.3) ;
- déplacement entre les lignes d'un même front sans délai ; nouvel ordre vers
  la destination en cours sans nouveau délai ; retour à la réserve sans délai
  (§4.4) ;
- interface : sélection avancée seulement dans la fenêtre d'un front (pas dans
  l'onglet des forces) ; une division en fuite peut être déplacée (§11.4) ;
- `move_division` : divisions invalides ignorées (§5.2) ;
- échange seulement dans la même niche (§5.3) ;
- dégâts calculés sur les états du début du round ; ordre de fin de round
  (§6, §6.4) ;
- avancée : seuil `A` = 2 repris (`B` = 10, vitesses 10 et 20, rapport en
  infanterie et vitesse progressive sur toutes les niches : auteur) (§7) ;
- encerclement appliqué composant par composant (§10.2) ;
- prise : usine détruite, nouvelle capitale (§10.2) ;
- élimination : population gardée pour le mode résistance, pas de réponse aux
  propositions en attente, ordres ignorés (§10.3) ;
- V2 : sans délai entre la première ligne et la réaction rapide ou une boîte ;
  division qui change de front sortie de sa boîte (§4.4, §4.6) ; tranche de
  première ligne dans l'ordre de choix, qui garde part à l'attaque sur tout le
  front ; PV de défense dans les deux combats ; motorisation sur les niches
  principales ; appui-feu sans infanterie non engagé dans une percée ;
  annulation d'une percée ; mode choix d'axe sur la connexion la plus proche
  (§7.2, §11.1) ;
- boîte de percée : symboles « Motorisée » / « Au pas » (icônes camion et pieds) (§11.4) ;
- double ligne rouge sur les fronts actifs seulement (§11.1) ;
- ordre des étapes dans un tour (§13.2).

## 16. Plus tard, hors périmètre et pistes

**Pistes** : une priorité de renfort entre divisions (rien n'est décidé).

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
