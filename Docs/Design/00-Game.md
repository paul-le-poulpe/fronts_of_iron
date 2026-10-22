# 00 — Le jeu

Ce que le jeu est, et chaque action du joueur, qui devient un type d'ordre du
moteur (01-Architecture §3). Rédigé avec l'auteur, au fur et à mesure.

**Ce qui n'est pas écrit ici n'est pas décidé.** Le moteur n'implémente que ce
document ; ce qui reste à trancher est listé au §13. Rien n'est repris
d'OpenFront par défaut.

---

## 1. Vue d'ensemble

Stratégie multijoueur dans le navigateur. Parties courtes. Pas de brouillard de
guerre.

Modules prévus :

| Module | État |
| --- | --- |
| Zones maritimes (maillage de la mer) | décrit en partie (§2.1) |
| Villes | décrit (§3) |
| Population | décrit en partie (§4) |
| Flux et ressources | décrit en partie (§5) |
| Agriculture et pêche (nourriture) | décrit (§6) |
| Extraction des ressources naturelles | décrit en partie (§7) |
| Usines et biens | décrit en partie (§8) |
| Armement (seule production stockée) | annoncé, non décrit |
| Routes terrestres et maritimes | annoncé. Nœuds : les villes sur terre, les zones maritimes en mer (§2.1). Routes non décrites |
| Croissance des villes | annoncé, non décrit |
| Commerce terrestre et maritime | annoncé, non décrit. Mêmes règles sur terre et sur mer, seul le support change |
| Armée, combat | annoncé, non décrit |
| Politique entre joueurs | annoncé, non décrit |

Le joueur agit par une barre de boutons. Pour l'instant, tous les boutons sont
dans cette même barre :
- créer une ville ;
- ouvrir le panneau latéral des lignes de production (§8.1).

Elle pourra être séparée plus tard, selon le nombre de boutons. L'interface est
définie par l'auteur ; elle n'est pas inventée.

## 2. La carte

- Au début de la partie, aucune case n'appartient à personne.
- **Distances** : à vol d'oiseau, en cases, sans tenir compte du terrain. Le
  moteur compare des distances au carré (`dx² + dy²`), en entiers, sans racine.
  Une case à une distance égale à un rayon est dans ce rayon (`distance ≤
  rayon`).
- **Fertilité** : chaque case a une fertilité entière de 0 à 10. **0 = case non
  cultivable** (eau, montagne, et d'autres terrains).
- **Ressources naturelles** : pour chaque ressource de la liste (fichier de
  configuration), chaque case a un booléen : présente ou absente. La
  répartition est tirée d'un bruit, dont le seuil est modulé case par case
  selon des critères propres à la ressource. Exemple décrit : le **fer** est
  plus probable en altitude ; sur une montagne, le seuil est modifié pour que
  le fer y soit plus fréquent.
- Le propriétaire d'une case n'est pas conquis case par case : il se déduit des
  villes (§3.2).

### 2.1 Zones maritimes

La mer est découpée en zones maritimes. Elles servent de nœuds aux routes
maritimes, comme les villes sur terre (routes : non décrites). Elles sont
calculées une fois, à la génération de la carte, et ne changent pas pendant la
partie.

- **Entrée** : largeur, hauteur, et pour chaque case : terre ou eau (la carte
  de hauteur comparée au niveau de la mer). Le module ne lit rien d'autre ;
  changer le générateur de carte ne le touche pas.
- **Sortie** : une liste de points (x, y entiers). Chaque point est le centre
  d'une zone. Seuls les points sont stockés ; les zones sont recalculées à
  partir d'eux (affichage, routes).
- **Zone d'un point** : les cases d'eau plus proches de ce point que de tout
  autre point, la distance étant mesurée le long d'un chemin qui ne passe que
  par l'eau. La terre sépare donc deux zones : une zone ne passe jamais
  par-dessus la terre pour prendre l'eau de l'autre côté. Une case d'eau
  qu'aucun chemin d'eau ne relie à un point n'est dans aucune zone. À égalité,
  la case va au point de plus petit indice.
- Calcul de toutes les zones : un parcours de proche en proche sur les cases
  d'eau, parti de tous les points à la fois.

Étapes :

1. **Grille.** Un point tous les `SEA_ZONES.spacing` cases, en x et en y. Le
   premier est à `spacing / 2` du bord gauche et du bord haut. Chaque point a
   son carré de côté `spacing`.
2. **Suppression.** Le point dont le carré a plus de `SEA_ZONES.maxLandPercent`
   % de terre est supprimé.
3. **Itérations.** `SEA_ZONES.iterations` fois : calculer les zones, puis
   déplacer chaque point au barycentre de sa zone (moyenne entière des x et des
   y de ses cases). Méthode connue sous le nom de relaxation de Lloyd.
4. **Correction, par bassin.** Un bassin est un ensemble de cases d'eau
   reliées entre elles par l'eau. Chaque bassin est traité séparément :
   - surface < `SEA_ZONES.minBasinArea` cases : aucun point. Le bassin n'a pas
     de zone maritime, aucune flotte n'y opère ;
   - sinon : nombre de points visé = surface / `spacing²` (la densité de la
     grille de départ), au moins 1. On ajoute ou retire des points dans le
     bassin jusqu'à l'atteindre. Où ajouter et lesquels retirer : à définir
     (§13).
5. **Itérations finales.** `SEA_ZONES.finalIterations` itérations de plus,
   comme à l'étape 3.

Conséquence de l'étape 2 : une mer intérieure entourée de terre, dont le carré
dépasse le seuil de terre, perd son point. Comme une zone ne traverse pas la
terre, cette eau n'est alors dans aucune zone. L'étape 4 lui redonne un point
si sa surface atteint `minBasinArea`.

**Limite connue** : le bassin ne sépare que l'eau entièrement fermée. Une mer
reliée au reste par un détroit (exemple : la Méditerranée et l'Atlantique) est
dans le même bassin, alors qu'une flotte qui y opère n'est pas dans l'océan.
Elle devrait avoir ses propres points. Non résolu (§13).

La carte est générée par chaque client à partir de la graine (02-Engine §2).
Ce calcul aussi : il est donc fait en entiers, dans un ordre de parcours fixé
(règle 2 du `CLAUDE.md`).

**Prototype** (`packages/engine/src/seazones.ts`, visualisation pas à pas :
02-Engine §1). Pour qu'il tourne, les points ouverts du §13 ont reçu des choix
provisoires, tous à valider :
- parcours : pas orthogonal de coût 5, pas en diagonale de coût 7, diagonale
  interdite entre deux cases de terre qui se touchent par un coin ;
- point de la grille sur la terre, dans un carré gardé : déplacé sur la case
  d'eau du carré la plus proche ;
- carré coupé par le bord : pourcentage calculé sur sa partie dans la carte ;
- barycentre hors de sa zone : case de la zone la plus proche du barycentre ;
- nombre de points visé par bassin : surface / `spacing²` arrondi au plus
  proche, au moins 1 ;
- correction, répétée jusqu'à ce que chaque bassin ait son nombre de points :
  bassin sans point → un point au barycentre du bassin ; trop peu → un point
  de plus dans chacune des plus grandes zones, sur sa case la plus éloignée de
  son point ; trop → les points des plus petites zones sont retirés.

## 3. Les villes

Les villes sont l'unité avec laquelle un joueur contrôle la carte.

### 3.1 Les rayons

Chaque ville a trois rayons, du plus grand au plus petit :

| Rayon | Rôle | Valeur |
| --- | --- | --- |
| Expansion | zone où le joueur peut fonder une nouvelle ville | fixe, fichier de configuration |
| Contrôle | zone maximale que la ville contrôle ; une ressource n'est exploitable que dans la zone de contrôle d'une ville | fixe, fichier de configuration |
| Exploitation | zone des terres agricoles cultivées | dépend des fermiers ; **affichage seulement** (§6.6) |

Les rayons d'expansion et de contrôle sont les mêmes pour toutes les villes.
D'autres types de villes pourraient venir plus tard ; ce n'est pas prévu.

### 3.2 Zone d'une ville

Une case appartient à la ville C si :

1. sa distance à C est dans le rayon de contrôle, et
2. C est la ville la plus proche de la case, toutes villes et tous joueurs
   confondus (partage de Voronoi). À égalité de distance, la case revient à la
   ville la plus ancienne (plus petit identifiant).

Une case qui n'est dans le rayon de contrôle d'aucune ville n'appartient à
personne. Le propriétaire de la case est le joueur de sa ville.

Conséquence : fonder une ville près d'une autre lui retire les cases devenues
plus proches de la nouvelle ville, y compris chez un autre joueur.

### 3.3 Fonder une ville

Une ville peut être fondée sur la case `t` si :

- `t` est de la terre, cultivable ou non (montagne comprise) ;
- `t` n'est dans le rayon de contrôle d'**aucune** ville, quel que soit son
  joueur ;
- sauf pour la première ville du joueur : `t` est dans le rayon d'expansion
  d'une ville de ce joueur. Le rayon d'expansion d'une ville adverse peut
  recouvrir `t`, cela ne change rien.

La première ville se pose n'importe où, aux deux premières conditions près.

**Coût** : fonder une ville retire `CITY.foundingCostPopulation` personnes à la
population totale du joueur (§10). Si sa population est inférieure au coût,
l'ordre est invalide. Le coût est retiré du total avant la répartition du tour
(§4) : il n'y a pas à choisir dans quelle part de la population le prendre.
Provisoire : ce coût sera probablement remplacé par d'autres ressources quand
elles existeront.

**La première ville est gratuite.** Sa fondation donne au joueur
`POPULATION.initial` personnes (§4).

L'auteur a annoncé d'autres règles de placement, à décrire (§13).

## 4. La population

- La population est comptée par joueur (l'État), pas par ville.
- Un joueur commence avec une population de 0. Avant sa première ville, elle
  croît déjà grâce à la nourriture minimale (§6.5) : des nomades. Sans ville,
  elle n'a pas de terre et reste inactive.
- La fondation de sa première ville lui donne en plus `POPULATION.initial`
  personnes, une valeur du fichier de configuration.
- À chaque tour, la population totale est de nouveau répartie, dans cet
  ordre :
  1. les **lignes de production actives** (§8.1), **une par une, dans l'ordre
     de priorité choisi par le joueur** : pour chaque ligne, d'abord ses
     ouvriers d'usine, puis les mineurs qui extraient la ressource qu'elle
     consomme (§7). Une ligne n'est remplie que si les deux sont possibles en
     entier (assez de population, assez de capacité d'extraction). Sinon elle
     ne reçoit personne et ne produit rien (pas de production partielle), **et
     le remplissage des lignes s'arrête là** : les lignes situées plus bas ne
     reçoivent personne non plus. Ainsi, on n'a jamais des usines
     pleines sans ressource, ni des ressources extraites sans usine pour les
     transformer ;
  2. le reste devient **fermiers** et **pêcheurs**, dans la proportion choisie
     par le joueur (un réglage ; l'interface sera définie par l'auteur) ;
  3. les fermiers et pêcheurs qui n'ont pas de surface à travailler (§6)
     forment la **population inactive**.

### 4.1 Population maximale et croissance

La nourriture (§6.5) est un flux produit à chaque tour ; elle n'est pas
stockée (§5). Elle fixe la population maximale :

```
population_max      = nourriture / consommation_par_tête
nourriture_restante = nourriture − population × consommation_par_tête
croissance          = nourriture_restante × taux_de_croissance     par tour
```

Ce calcul est refait à chaque tour du moteur (la plus petite unité de temps,
100 ms). `consommation_par_tête` et `taux_de_croissance` sont dans le fichier
de configuration.

La population augmente jusqu'à `population_max`. Pour l'instant, la croissance
est proportionnelle à la nourriture restante : elle ralentit à l'approche de la
limite. Si la population dépasse `population_max` (nourriture restante
négative, par exemple après la perte d'une ville), la même formule la fait
baisser, proportionnellement au manque.

**La fraction de croissance est gardée d'un tour à l'autre.** Chaque joueur a
un reste de croissance, entier à une échelle fine, dans l'état de la partie :

```
reste      = reste + nourriture_restante × taux_de_croissance    (échelle fine)
population = population + partie entière de reste
reste      = reste − cette partie entière
```

Sans ce reste, une croissance inférieure à 1 par tour serait arrondie à 0 à
chaque tour, et la population s'arrêterait à
`1 / (taux_de_croissance × consommation_par_tête)` personnes sous le maximum,
quelle que soit sa taille. La même règle vaut pour une baisse (reste négatif) ;
le sens de l'arrondi des négatifs est fixé avec la session du moteur.

Boucle qui en résulte : plus de population donne plus de fermiers disponibles,
donc plus de surface cultivée et de nourriture, jusqu'à `surface_max` (§6.2).

## 5. Flux et ressources

**Presque tout est un flux, pas un stock.** Une quantité est produite à chaque
tour, consommée dans le même tour, et rien n'est gardé. Exemple : les tracteurs
disponibles pour l'agriculture à un tour sont les tracteurs produits (et
échangés, §13) à ce tour. **Seule exception annoncée : l'armement**, qui pourra
être stocké (non décrit).

Tous les flux sont comptés par nation, pas par ville. Deux catégories :

| Catégorie | Origine | Connues à ce jour |
| --- | --- | --- |
| Ressources naturelles | extraites de la carte, dans la zone des villes | blé (§6), poisson (§6), fer (§7) ; liste dans le fichier de configuration |
| Biens | fabriqués par les usines à partir des ressources (§8) | machines : tracteurs, bateaux de pêche, engins miniers |

- Nourriture = blé + poisson. Elle ne sert qu'à fixer la population maximale
  (§4.1).
- Les machines augmentent la mécanisation d'une activité : tracteurs pour
  l'agriculture, bateaux pour la pêche, engins miniers pour l'extraction.
  D'autres usages des biens pourront venir.
- Les joueurs peuvent échanger ressources et biens (commerce, non décrit).
- L'affichage des flux sera défini avec l'auteur.

## 6. Agriculture et pêche

### 6.1 Surface et fertilité de la nation

```
surface_max      = nombre de cases de fertilité > 0 dans les zones (§3.2)
                   de toutes les villes du joueur
fertilité_totale = somme des fertilités de ces mêmes cases
```

Le moteur n'a besoin que de ces deux totaux. Ils ne changent que quand une
ville est fondée (ou disparaît), pour le joueur de cette ville et pour ceux des
villes voisines.

### 6.2 Fermiers et mécanisation

```
x               = min(tracteurs / fermiers_disponibles, m_max) / m_max
Mécanisation    = M_base + (M_max − M_base) × f(x)          surface par fermier
fermiers_requis = surface_max / Mécanisation
fermiers        = min(fermiers_disponibles, fermiers_requis)
                  les fermiers disponibles en trop vont dans la population inactive
surface_cultivée = fermiers × Mécanisation                    (≤ surface_max)
```

- `fermiers_disponibles` : la population affectée aux fermiers par le §4,
  avant la limite de surface.
- Le nombre de tracteurs par fermier est calculé une fois, avec les fermiers
  disponibles. Il n'est pas recalculé avec les fermiers qui travaillent
  réellement : cela ferait dépendre la mécanisation d'elle-même, et ne
  changerait que le nombre d'inactifs (la surface est alors déjà au maximum).
- `M_base`, `M_max`, `m_max` et l'exposant `n` de la courbe sont fixes, dans le
  fichier de configuration. Seul le nombre de tracteurs par fermier varie.

### 6.3 La courbe de mécanisation

Commune à toutes les activités mécanisées (agriculture, pêche, extraction),
chacune avec ses propres valeurs de configuration.

```
f(x) = 1 − (1 − x)ⁿ        n entier ≥ 1
```

- f(0) = 0 : sans machine, Mécanisation = `M_base`.
- f(1) = 1 : à `m_max` machines par travailleur ou plus, Mécanisation =
  `M_max`.
- Pente n au départ, 0 à l'arrivée : les premières machines comptent le plus.
  n = 1 donne une droite.

Calcul en entiers (règle 2 du `CLAUDE.md` : ni `Math.pow` ni `**`) :

```
S = 10 000                       échelle : x = 1 s'écrit S
X = x ramené sur 0…S
p = S
répéter n fois : p = (p × (S − X)) / S     division entière
f = S − p                         f(x) sur 0…S
```

Le plus grand intermédiaire est S × S = 10⁸, loin sous 2⁵³.

### 6.4 Pêche

Même fonctionnement que l'agriculture (§6.1 à §6.3), avec :

- des cases de **mer** au lieu des cases de terre ;
- des **pêcheurs** au lieu des fermiers ;
- des **bateaux de pêche** au lieu des tracteurs pour la mécanisation.

Plus il y a de bateaux, plus la pêche est mécanisée. Le résultat est le flux de
**poisson**.

### 6.5 Nourriture produite

```
blé        = fertilité_totale × surface_cultivée / surface_max
poisson    = même calcul sur les cases de mer (§6.4)
nourriture = max(blé + poisson, FOOD.minimum)                     par tour
```

C'est la fertilité moyenne des cases cultivables de la nation, multipliée par
la surface cultivée. Les cases réellement cultivées ne sont pas choisies : seul
le total compte pour le jeu. Multiplier avant de diviser. Si `surface_max` = 0,
il n'y a rien à cultiver.

**Nourriture minimale** : `FOOD.minimum` (§10). Sans elle, une population
nulle donnerait zéro fermier, donc zéro nourriture, donc une population
maximale nulle : la population ne repartirait jamais.

### 6.6 Rayon d'exploitation (affichage seulement)

Le client calcule un rayon r commun à toutes les villes du joueur, tel que la
somme, sur toutes ses villes, des cases de fertilité > 0 de leur zone à moins
de r de la ville soit égale à `surface_cultivée`. Il dessine ces cases (en vert
pour commencer, une texture de champs plus tard). Une approximation suffit ; le
moteur ne calcule pas ce rayon.

Une case sans fertilité (montagne, eau) n'est pas comptée : le disque cultivé
s'étend plus loin quand il en contient.

## 7. Extraction des ressources naturelles

Pour chaque ressource naturelle r autre que le blé et le poisson (le fer, et
celles de la liste) :

```
capacité_max[r] = nombre de cases portant r dans les zones de toutes les
                  villes du joueur × RESOURCES[r].capacityPerTile
demande[r]      = consommation de r par les usines du joueur
                + quantité de r demandée à l'export par d'autres joueurs
extraction[r]   = min(demande[r], capacité_max[r]), limitée par la population
mineurs[r]      = extraction[r] / Mécanisation_minière
```

- **On n'extrait que ce qui est demandé.** Une ressource sans demande n'occupe
  personne.
- **Extraire ne vide pas la case** : c'est une capacité par tour, un flux.
- `Mécanisation_minière` suit la courbe du §6.3, avec les **engins miniers**
  comme machines et ses propres valeurs de configuration.
- Les mineurs sont affectés ligne de production par ligne de production, avec
  les ouvriers d'usine de chaque ligne, avant les champs et la pêche (§4).

## 8. Usines et biens

- Les usines transforment des ressources naturelles en biens. Seuls biens
  décrits : les machines (§5).
- Une usine est construite dans une ville. Nombre maximal de types d'usines
  différents par ville : `FACTORY.maxTypesPerCity` (fichier de configuration),
  1 pour commencer.
- Chaque type d'usine a un logo, affiché à côté de la ville où elle est
  construite.
- **Niveau = ligne de production.** Un niveau d'usine est une ligne de
  production élémentaire d'un bien. Exemple : 3 lignes de tracteurs et 1 ligne
  d'engins miniers dans la même usine font une usine de niveau 4.
- Chaque ligne emploie un nombre fixe d'ouvriers (fichier de configuration).
- Chaque ligne produit, par tour, une quantité propre au bien
  (`GOODS[b].productionPerLine`), et consomme la ressource indiquée pour ce
  bien.
- **Déblocage** : plus une usine produit, plus elle débloque de productions
  alternatives. Exemple donné par l'auteur, à titre d'illustration : une usine
  de tracteurs qui débloque aussi les engins miniers.
- **Spécialisation** : plus une usine a de lignes d'un même bien, moins chacune
  demande d'ouvriers. Pour commencer : `x` % d'ouvriers en moins par ligne
  supplémentaire du même bien dans la même usine, `x` =
  `FACTORY.specializationPercent`. Formule exacte à définir (§13). But : un
  joueur spécialisé produit plus efficacement et échange pour obtenir le
  reste.
- Pas de stock : la production d'une usine à un tour est le flux disponible à
  ce tour.

```
production[b]     = somme, sur les lignes actives et remplies de b, de GOODS[b].productionPerLine
consommation[r]   = somme, sur les biens b qui utilisent r, de production[b] × ratio de r pour b
```

`consommation[r]` est la part « usines » de la demande d'extraction (§7).

### 8.1 Activer et désactiver les lignes

- Chaque ligne peut être activée ou désactivée par le joueur. Seules les
  lignes actives reçoivent des ouvriers (§4), et l'extraction suit les lignes
  actives.
- C'est ainsi que le joueur répartit sa population : en choisissant les lignes
  qui tournent.
- Les lignes identiques d'une usine (même bien) se règlent ensemble : un
  nombre de lignes actives, par exemple avec un curseur.
- Un panneau latéral, que le joueur ouvre, liste toutes les lignes de son pays.
  Son interface sera définie par l'auteur.
- **Priorité** : le joueur fait glisser les lignes vers le haut ou le bas du
  panneau. Les lignes sont remplies de haut en bas (§4). Inspiration : le
  panneau de production de Hearts of Iron, sauf qu'on n'y affecte pas des
  usines : on ouvre et ferme des lignes selon la population disponible.
- Une ligne qui ne peut pas être entièrement alimentée ne produit rien. Le
  joueur est censé le voir avant et ne pas l'activer ; les ouvriers restants
  vont aux champs.

### 8.2 Créer une ligne

- Le joueur crée les lignes (ordre).
- **Nombre maximal de lignes** par joueur : fonction de sa population, définie
  dans le fichier de configuration.
- **Coût et conditions** : pas encore décidés. Piste de l'auteur : avoir une
  ligne du même bien, ou d'un bien « parent », qui tourne depuis un certain
  temps, et sacrifier un peu de population. C'est la forme envisagée du
  déblocage décrit plus haut.

## 9. Ordres

| Ordre | Paramètres | Valide si | Effet |
| --- | --- | --- | --- |
| Fonder une ville | la case | §3.3 | retire le coût en population ; crée la ville ; recalcule les zones (§3.2) et les totaux (§6.1, §7) des joueurs touchés |
| Régler la part fermiers / pêcheurs | la proportion | format à définir (§13) | change la répartition du §4 |
| Créer une ligne de production | la ville (l'usine), le bien | maximum de lignes non atteint ; conditions et coût à définir (§8.2) | ajoute une ligne |
| Régler les lignes actives | l'usine, le bien, le nombre de lignes actives | entre 0 et le nombre de lignes de ce bien dans cette usine | change les lignes qui reçoivent des ouvriers (§8.1) |
| Changer la priorité | la ligne (ou le groupe), sa nouvelle position | la ligne appartient au joueur | change l'ordre de remplissage (§4, §8.1) |

Les noms et formats exacts des ordres sont fixés avec la session du moteur.

## 10. Fichier de configuration

Noms proposés, dans le style de `packages/engine/src/config.ts`.

**Aucune valeur n'est fixée, et aucune ne doit être devinée.** Elles seront
choisies ensemble plus tard, en essayant des valeurs.

| Nom | Sens |
| --- | --- |
| `CITY.expansionRadius` | rayon d'expansion, en cases |
| `CITY.controlRadius` | rayon de contrôle, en cases |
| `CITY.foundingCostPopulation` | population retirée à la fondation d'une ville (§3.3) |
| `POPULATION.initial` | population donnée à la fondation de la première ville (§4) |
| `POPULATION.foodPerHead` | `consommation_par_tête` (§4.1) |
| `POPULATION.growthRate` | `taux_de_croissance` (§4.1) |
| `FOOD.minimum` | nourriture minimale par tour d'un joueur (§6.5) |
| `FARMING.mechanizationBase` | `M_base` : surface par fermier sans tracteur |
| `FARMING.mechanizationMax` | `M_max` : surface par fermier à pleine mécanisation |
| `FARMING.maxTractorsPerFarmer` | `m_max` : tracteurs par fermier au-delà desquels la mécanisation n'augmente plus |
| `FARMING.mechanizationCurveExponent` | `n` de la courbe §6.3, entier ≥ 1 |
| `FISHING.*` | mêmes quatre valeurs pour la pêche, avec les bateaux |
| `MINING.*` | mêmes quatre valeurs pour l'extraction, avec les engins miniers |
| `RESOURCES` | une section par ressource naturelle : `capacityPerTile` (capacité d'extraction par tour d'une case qui la porte, §7), icône, critères qui modulent son seuil de présence (§2) |
| `GOODS` | une section par bien : ressource(s) utilisée(s) et ratio, `productionPerLine` (§8), nom du fichier d'icône |
| `FACTORY.workersPerLine` | ouvriers employés par une ligne de production (§8) |
| `FACTORY.specializationPercent` | `x` : ouvriers en moins, en %, par ligne supplémentaire du même bien dans une usine (§8) |
| `FACTORY.maxLines…` | nombre maximal de lignes d'un joueur en fonction de sa population (§8.2) ; forme à définir |
| `FACTORY.maxTypesPerCity` | types d'usines différents par ville (1 pour commencer, valeur donnée par l'auteur) |
| `SEA_ZONES.spacing` | écart entre les points de la grille de départ, en cases ; fixe aussi la taille visée d'une zone (§2.1) |
| `SEA_ZONES.maxLandPercent` | au-delà de ce pourcentage de terre dans son carré, un point de la grille est supprimé (80 pour commencer, valeur donnée par l'auteur) |
| `SEA_ZONES.iterations` | nombre d'itérations zones → barycentre avant la correction (§2.1) ; 50 pour commencer, valeur donnée par l'auteur (le calcul ne tourne qu'une fois par partie) |
| `SEA_ZONES.minBasinArea` | surface minimale d'un bassin, en cases d'eau ; en dessous, il n'a aucune zone maritime (§2.1) |
| `SEA_ZONES.finalIterations` | itérations zones → barycentre après la correction (§2.1) ; 50 pour commencer, valeur donnée par l'auteur |

Dans `config.ts`, `SEA_ZONES.spacing` et `SEA_ZONES.minBasinArea` ont des
valeurs d'essai, choisies pour faire tourner la visualisation. Elles ne sont
pas fixées.

Le générateur de la carte de test a déjà ses réglages, `TEST_MAP` dans
`packages/engine/src/config.ts` (02-Engine §2). `SEA_ZONES` en est séparé : il
s'applique à toute carte.

## 11. Affichage

Ces points ne concernent que le client. Ils seront tranchés avec l'auteur.

- Chaque joueur a une couleur. Deux possibilités : une teinte légère sur tout
  son territoire, ou seulement ses frontières avec un dégradé vers l'intérieur.
- Entre deux villes d'un même joueur, une ligne légère ou en pointillé marque la
  limite de leurs zones. Affichable ou masquable.
- Options de vue de la carte : par joueur, ressources naturelles, relief, et
  d'autres.
- Zone d'exploitation : vert, puis texture de champs (§6.6).
- Logo de chaque usine à côté de sa ville (§8).
- Panneau latéral des lignes de production, avec un réglage par groupe de
  lignes identiques (§8.1).
- Une icône par ressource et par bien, nommée dans le fichier de
  configuration. Des icônes provisoires d'abord ; l'auteur dessine et importe
  les vraies.

## 12. Conséquences pour le moteur

- `owner` par case (01-Architecture §5) reste utile comme résultat calculé : il
  est réécrit à partir des villes (§3.2) quand une ville est fondée, sur les
  cases à portée de cette ville.
- La carte gagne la fertilité (un octet par case) et la présence des
  ressources (un bit par ressource et par case).
- La carte gagne la liste des points des zones maritimes (§2.1), calculée après
  le terrain, à partir du seul masque terre / eau. Module séparé du générateur
  de carte.
- Les villes, la population, sa répartition, les usines et leur progression
  entrent dans l'état de la partie, donc dans le hash (02-Engine §6).
- **Les flux se citent en boucle** : les tracteurs d'un tour viennent des
  usines, qui consomment du fer, extrait par des mineurs, dont le nombre dépend
  des engins miniers, qui viennent des usines. Proposition : à chaque tour, les
  machines utilisées sont celles produites au tour précédent (100 ms de
  décalage). À valider.

## 13. Points ouverts

**Zones maritimes**

Les points suivants ont un choix provisoire dans le prototype (§2.1), à
valider sur la visualisation.
- Correction (§2.1, étape 4) : où ajouter un point dans un bassin, lequel
  retirer.
- Mers reliées au reste par un détroit (Méditerranée) : comment les séparer de
  l'océan pour qu'elles aient leurs propres points. On essaie d'abord la
  correction par bassin seule. Piste, non décidée :
  1. calculer pour chaque case d'eau sa distance à la terre (parcours parti
     de toutes les côtes à la fois) ;
  2. dans un tableau temporaire, ne garder que l'eau à au moins
     `straitWidth / 2` de la terre (`SEA_ZONES.straitWidth`, réglage à
     ajouter). Les passages plus étroits, les détroits, disparaissent de ce
     tableau, et l'eau gardée se coupe en morceaux ;
  3. rattacher chaque case d'eau retirée au morceau le plus proche par l'eau.
     Chaque morceau devient une mer, traitée comme un bassin à l'étape 4.

  Le tableau temporaire ne sert qu'à la génération, et la carte ne change pas.
  Les zones des deux côtés d'un détroit se touchent, donc les routes y passent.
  Défaut prévu : un archipel aux passages étroits se coupe en petits
  morceaux. Un morceau sous `minBasinArea` serait fusionné avec son voisin,
  et non supprimé.
- Barycentre qui tombe sur la terre ou hors de sa zone (zone en forme de C).
- Point de la grille qui tombe sur la terre, dans un carré gardé.
- Carrés coupés par le bord de la carte : pourcentage de terre calculé sur la
  partie dans la carte ?
- Pas du parcours (4 voisins, 8 voisins, diagonales pondérées) : il donne la
  forme des zones.
- Voisinage entre zones, et lien entre une ville côtière et une zone : avec les
  routes maritimes.

**Villes**
- Les autres règles de placement annoncées par l'auteur.
- Un joueur qui a perdu toutes ses villes peut-il de nouveau en poser une
  n'importe où ?
- Comment la partie commence : quand et comment chaque joueur pose sa première
  ville.

**Population**
- Priorité d'un groupe de lignes identiques (§8.1) : le groupe a-t-il une seule
  position dans le panneau ?
- Mineurs pour l'export (§7) : remplis avec les lignes, après elles, ou après
  les champs ?
- Le format du réglage fermiers / pêcheurs, et son effet tant qu'un joueur n'a
  pas de cases de mer.
- Si la population ne suffit pas à couvrir la demande d'extraction : extraction
  partielle, et rien pour les champs ?

**Agriculture et pêche**
- Unités : la surface est-elle comptée en cases ? Combien de personnes
  représente une unité de population ?
- Arrondi de `fermiers_requis` (vers le haut, pour couvrir toute la surface, ou
  vers le bas).
- La fertilité change-t-elle en cours de partie ? Les engrais, cités comme
  critère global possible, ne sont pas retenus pour l'instant.
- Pêche : quelles cases de mer comptent (la zone de la ville, un rayon de pêche
  propre, un port obligatoire) ? Ont-elles un équivalent de la fertilité ?
- Fertilité et ressources sur la carte de test : comment elles sont générées.

**Extraction**
- Mécanisation minière : le nombre d'engins par mineur dépend du nombre de
  mineurs, qui dépend de la mécanisation (même boucle que celle évitée au §6.2
  par les fermiers disponibles).

**Usines**
- Construction : coût, durée, ordre du joueur.
- Créer une ligne : coût, conditions (durée de fonctionnement d'une ligne du
  même bien ou d'un bien parent), arbre des biens « parents ».
- Spécialisation : `x` % en moins par ligne, appliqué de façon composée
  (`(1 − x)ᵏ`) ou linéaire (`1 − k·x`) ; plancher éventuel.
- `FACTORY.workersPerLine` : une valeur commune, ou une par bien ?
- Forme du nombre maximal de lignes en fonction de la population.

**Commerce** : la demande à l'export (§7) et les machines échangées (§5) en
dépendent ; non décrit.

**Modules non décrits** : voir le tableau du §1.
