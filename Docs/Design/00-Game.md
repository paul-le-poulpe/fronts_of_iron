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

### 1.1 La partie

- **Fin de partie** : hors périmètre pour l'instant. En développement, l'auteur
  arrête la partie lui-même. Aucune condition de victoire n'est implémentée.
- **Joueurs** : le nombre maximal est réglé dans le lobby, à la création de la
  partie. Cible : jusqu'à 100 joueurs par partie.
- **Rythme** : temps réel, un tour toutes les 100 ms par défaut, pas réglable.
  Le moteur ne connaît que des tours, et toutes les règles sont exprimées en
  tours. Changer le pas change donc la vitesse de la partie en temps réel, pas
  ses résultats : 100 tours durent 10 s à 100 ms, 20 s à 200 ms.
- **Pas de pause pour les joueurs.** La pause existe seulement comme outil de
  développement : l'hôte arrête l'envoi des tours (01-Architecture §3). Ce
  n'est pas un ordre de joueur.
- **Joueurs non humains (IA)** : reporté.

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
| Armement (seule production stockée) | décrit en partie (§8.3) ; types d'usines et arbre de production (§8.4) |
| Capitale | décrit en partie (§3.4) |
| Routes terrestres et maritimes | décrit en partie (§3.5, §3.6). Nœuds : les villes sur terre, les zones maritimes en mer (§2.1) |
| Croissance des villes | décrit (§3.7) : affichage seulement, pas de taille dans le moteur |
| Commerce terrestre et maritime | annoncé, non décrit. Mêmes règles sur terre et sur mer, seul le support change |
| Armée, combat | annoncé, non décrit |
| Politique entre joueurs | annoncé. Menu de diplomatie et droit de passage envisagés (§1, §3.5) ; options non décrites |

Le joueur agit par une barre de boutons. Pour l'instant, tous les boutons sont
dans cette même barre :
- créer une ville ;
- **inaugurer une usine** (décrit par l'auteur, 24 octobre 2026) : un clic
  déplie vers le haut la liste des types d'usine de base (§8.4). Le choix d'un
  type arme le bouton. Le joueur promène la souris : sur la zone (§3.2) d'une
  de ses villes sans usine, un clic crée l'usine de ce type dans cette ville,
  et le bouton est désarmé. Ordre « Construire une usine » (§9) ;
- **production** : ouvre ou ferme le panneau latéral des lignes de production
  (§8.1).

Prévu : une section maritime, avec le bouton qui interdit des zones maritimes
aux bateaux du joueur (§3.6). Cette section n'existe pas encore. Elle pourra
être séparée de la barre plus tard, selon le nombre de boutons.

**Diplomatie** (envisagée) : le joueur clique sur un autre joueur ; un petit
menu apparaît à côté de la souris (pas un panneau latéral), avec des options
comme déclarer la guerre, accorder un droit de passage (§3.5), faire une
alliance. Inspiration : les jeux Paradox. La liste exacte des options sera
choisie avec l'auteur.

L'interface est définie par l'auteur ; elle n'est pas inventée.

## 2. La carte

- Au début de la partie, aucune case n'appartient à personne.
- **Distances** : à vol d'oiseau, en cases, sans tenir compte du terrain. Le
  moteur compare des distances au carré (`dx² + dy²`), en entiers, sans racine.
  Une case à une distance égale à un rayon est dans ce rayon (`distance ≤
  rayon`).
- **Fertilité** : chaque case a une fertilité entière de 0 à 10. **0 = case non
  cultivable** (eau, montagne, et d'autres terrains).
  **Pour commencer** (décision de l'auteur, 23 octobre 2026) : une montagne a
  une fertilité de 0, une case qui porte du fer aussi (§7, décision du
  24 octobre 2026), toute autre case de terre a la même fertilité,
  `FERTILITY.land` (§10). Montagne = altitude ≥ `TEST_MAP.mountainAltitude`,
  la même limite que pour le fer.
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
maritimes, comme les villes sur terre (réseau maritime : §3.6). Elles sont
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
**Le rayon de contrôle est la moitié du rayon d'expansion** (règle de
l'auteur) : seul le rayon d'expansion est réglé, le moteur en déduit l'autre.
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

**Coût** : fonder une ville retire des personnes à la population totale du
joueur (§10). Le coût augmente avec le nombre `n` de villes que le joueur
possède déjà, toutes comptées, prises à un autre joueur comprises : chaque ville
ajoute `CITY.foundingCostIncreasePercent` % du coût de base
`CITY.foundingCostPopulation`. Le calcul est additif, en entiers, arrondi vers
le bas :

```
coût = floor(foundingCostPopulation × (100 + n × foundingCostIncreasePercent) / 100)
```

Avec un coût de base de 500 et 100 % : la deuxième ville (`n` = 1) coûte
1 000, la troisième 1 500, la dixième 5 000. Avec les 1 000 personnes de la
première ville (§4), un joueur paie donc une seule ville de plus avant que sa
population grandisse. L'auteur a choisi l'additif plutôt qu'un coût composé
(`× (1 + x)ⁿ`), qui monte plus vite.

Si sa population est inférieure au coût, l'ordre est invalide. Le coût est retiré du total avant la répartition du tour
(§4) : il n'y a pas à choisir dans quelle part de la population le prendre.
Provisoire : ce coût sera probablement remplacé par d'autres ressources quand
elles existeront.

**La première ville est gratuite.** Sa fondation donne au joueur
`POPULATION.initial` personnes (§4).

L'auteur a annoncé d'autres règles de placement, à décrire (§13).

### 3.4 Capitale

- Chaque joueur a une capitale. Sa première ville est sa capitale.
- Plus tard dans la partie, le joueur peut désigner une autre de ses villes
  comme capitale (ordre). Coût et conditions : non décrits (§13).
- **Toute la production est nationale** : agriculture, pêche (§6),
  extraction (§7) et usines (§8) sont calculées à l'échelle de la nation. Le
  moteur ne tient pas compte de la ville ni du groupe (§3.5) où se trouve une
  mine ou une usine, et rien ne passe réellement par une route. Où l'on
  extrait et où l'on produit est une question d'affichage seulement.
- La liaison à la capitale sert à fixer un **coût** : un groupe de villes
  relié par mer emploie des navires de transport et des marins (§3.6). C'est
  ce qui représente le coût d'une ville éloignée de la capitale, sur une île
  ou derrière un autre joueur.

### 3.5 Routes terrestres

**Pour le moteur, une route est un segment entre deux villes.** Il n'a ni
tracé, ni cases. Le moteur ne lit que la liste des paires de villes reliées.
**Une route terrestre n'a aucun coût** : ni population, ni biens. Seules les
routes maritimes coûtent (§3.6).

1. **Routes candidates** : toutes les paires de villes à une distance
   `≤ CITY.expansionRadius` l'une de l'autre (§2 pour la distance), **tous
   joueurs confondus** : deux villes de joueurs différents peuvent être
   reliées. Le rayon d'expansion est le même pour toutes les villes (§3.1) :
   si A est dans le rayon de B, B est dans celui de A.
2. **Pas de croisement** : deux routes gardées ne se croisent jamais. Les
   candidates sont traitées de la plus courte à la plus longue (distance au
   carré ; à égalité, la paire dont les identifiants sont les plus petits).
   Une candidate est gardée si elle ne croise aucune route déjà gardée. Quand
   deux routes se croisent, c'est donc la plus longue qui disparaît.

   Le tri est nécessaire : sans lui, une route A pourrait être supprimée à
   cause d'une route B elle-même supprimée à cause d'une route C, et le
   résultat dépendrait de l'ordre des suppressions.

   Deux routes qui partagent une ville ne se croisent pas. Le test de
   croisement de deux segments se fait en entiers, sans approximation : signes
   de produits vectoriels de coordonnées entières.

   Le réseau est unique, pour tous les joueurs. Conséquence : fonder une ville
   peut supprimer la route d'un autre joueur, si une nouvelle route plus
   courte la croise.
3. **Recalcul** : quand une ville est fondée ou disparaît. Proposition : tout
   le réseau est recalculé, une fondation étant rare et les villes peu
   nombreuses. Le nombre de candidates par ville est borné : deux villes sont
   au moins à `CITY.controlRadius` l'une de l'autre (§3.3).
4. **Ville reliée par terre** : un chemin de routes, de ville en ville, la
   relie à la capitale, **en ne passant que par des villes du joueur**. Une
   route entre une ville du joueur et une ville d'un autre joueur existe dans
   le réseau, mais ce chemin ne l'emprunte pas. Calculé par un parcours du
   réseau parti de la capitale. Une ville qui ne l'est pas doit passer par une
   route maritime (§3.6).

   Envisagé : un **droit de passage**, accordé par un joueur à un autre par la
   diplomatie (§1). Le chemin du joueur autorisé pourrait alors passer par les
   villes de celui qui l'autorise, et éviter une route maritime plus longue.
   Non décidé ; les options de diplomatie seront choisies avec l'auteur.
5. **Groupes** : les villes du joueur reliées entre elles par ses routes
   (point 4, sans passer par d'autres joueurs) forment un groupe. Le groupe de
   la capitale, le **groupe principal**, est relié par terre ; chaque autre
   groupe a besoin d'une route maritime (§3.6). Un autre groupe n'est pas
   forcément une île : il peut être sur le même continent, séparé du groupe
   principal par les villes d'un autre joueur.

Variante évoquée par l'auteur, non retenue pour l'instant : relier deux villes
si leurs cellules de Voronoi se touchent (triangulation de Delaunay), à une
distance `≤ CITY.expansionRadius`. Elle donne aussi un réseau sans croisement,
mais demande un test « point dans un cercle » et un code plus long ; sur
certaines dispositions, ses routes diffèrent de celles de la règle retenue.

**Affichage** (client seulement) : chaque route est dessinée par un chemin
A* sur les cases entre ses deux villes. Le coût d'une case augmente avec son
altitude, selon `ROADS.heightCostFactor` (§10), choisi assez fort pour que les
routes passent par les vallées. Ce tracé ne sert qu'à l'affichage ; le moteur
ne le calcule pas.

### 3.6 Ports et routes maritimes

- **Port** : une ville a un port si sa zone (§3.2) contient au moins une
  case de mer. Pour le moteur, le port est un attribut de la ville (oui /
  non), recalculé quand sa zone change (fondation ou disparition d'une ville
  voisine). Le port sert aux routes maritimes et à la pêche (§6.4).
- **Affichage du port** : une icône de port sur la case de côte la plus
  proche de la ville. Le moteur ne place pas le port sur une case.
- **Réseau maritime** : les points des zones maritimes (§2.1) sont reliés par
  des liaisons, construites comme les routes terrestres (§3.5) : candidates
  triées de la plus courte à la plus longue, une candidate gardée si elle ne
  croise aucune liaison déjà gardée. Ce réseau n'appartient à personne. Il est
  calculé une fois, à la génération de la carte, après les zones maritimes,
  et ne change pas. Quelles paires sont candidates : §13.
- **Route maritime** : relie à la capitale un groupe de villes qui ne l'est
  pas par la terre (§3.5, point 5). **Une seule route par groupe.** Elle va
  d'un port du groupe à un port du groupe de la capitale : parmi toutes ces
  paires de ports, celle dont le plus court chemin sur le réseau maritime est
  le plus court. Le trajet par mer est ainsi le plus court possible, et le
  trajet par terre, de chaque côté, le plus long possible. Les routes de
  joueurs différents peuvent emprunter les mêmes liaisons et se croiser.
- **Quantité transportée** : non décidée. Elle ne peut pas venir de ce que le
  groupe produit, puisque la production est nationale (§3.4). Piste de
  l'auteur, à reprendre avec lui : la part de la population qui vit dans le
  groupe, comptée par nombre de villes :

  ```
  quantité = population du joueur × villes du groupe / villes du joueur
             multiplier avant de diviser
  ```
- **Zones interdites** : le joueur peut interdire des zones maritimes à ses
  bateaux (ordre ; bouton de la section maritime, §1). Le plus court chemin de
  ses routes maritimes ne passe pas par ces zones.
- **Coût** : une route maritime emploie des **marins** (population) et des
  **navires de transport**. Les navires de transport sont un bien, produit
  par des lignes comme les tracteurs ou les bateaux de pêche (§8). Nom choisi
  par l'auteur, plus générique que « commerce » : ils transporteront aussi
  autre chose. Même mécanisme que les fermiers et les tracteurs (§6.2, §6.3) :

  ```
  travail      = quantité transportée × longueur du chemin        par tour
  Mécanisation = M_base + (M_max − M_base) × f(x)                 travail par marin
                 x : navires de transport par marin, ramené sur 0…1 par m_max (§6.2)
  marins       = travail / Mécanisation
  ```

  - Sans bateau, une route maritime existe, mais coûte beaucoup de
    population (`M_base` faible).
  - Les bateaux réduisent fortement le nombre de marins. L'écart entre
    `M_base` et `M_max` est prévu nettement plus grand que pour l'agriculture.
  - `M_base`, `M_max`, `m_max` et `n` sont dans le fichier de configuration
    (`SHIPPING.*`, §10). Aucune valeur n'est fixée.
  - Le nombre de bateaux par marin dépend du nombre de marins : même boucle
    que pour l'extraction (§13).
- **Affichage** (client seulement) : la route est dessinée par une courbe
  lissée (courbes de Bézier) passant par les zones de son chemin. Le moteur ne
  garde que la suite des zones.

### 3.7 Taille des villes (affichage seulement)

Une ville n'a pas de taille dans le moteur : rien dans l'état de la partie ne
la représente, et aucune règle n'en dépend. La population est nationale (§4) ;
toutes les villes sont donc dessinées à la même taille.

Exception, calculée par le client : une ville qui porte une usine (§8) est
dessinée plus grande, selon le niveau de l'usine (son nombre de lignes).

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
     de priorité choisi par le joueur** (villes dans leur ordre, puis lignes
     dans l'ordre de leur ville, §8.1) : pour chaque ligne, d'abord ses
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
  3. **report** (décision de l'auteur, 23 octobre 2026) : si un des deux côtés
     a plus de travailleurs que sa surface n'en demande (§6.2, §6.4), le
     surplus passe à l'autre côté, jusqu'à ce que celui-ci soit plein. Le
     réglage ne joue donc que quand la population ne suffit pas à travailler
     à la fois tous les champs et toute la mer ; sinon, les deux sont remplis
     à 100 % ;
  4. ceux qui n'ont toujours pas de surface à travailler forment la
     **population inactive**.

  ```
  F, P              = fermiers et pêcheurs disponibles, selon le réglage
  F_requis, P_requis = travailleurs requis (§6.2, §6.4 ; mécanisation calculée
                       avec F et P, une fois)
  fermiers = min(F_requis, F + max(0, P − P_requis))
  pêcheurs = min(P_requis, P + max(0, F − F_requis))
  inactifs = population − fermiers − pêcheurs
  ```

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
échangés, §13) à ce tour. **Seule exception : l'armement**, stocké dans une
réserve nationale limitée (§8.3).

Tous les flux sont comptés par nation, pas par ville. Deux catégories :

| Catégorie | Origine | Connues à ce jour |
| --- | --- | --- |
| Ressources naturelles | extraites de la carte, dans la zone des villes | blé (§6), poisson (§6), fer (§7) ; liste dans le fichier de configuration |
| Biens | fabriqués par les usines à partir des ressources (§8) | machines : tracteurs, bateaux de pêche, engins miniers ; navires de transport (§3.6) |

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

- des cases de **mer** au lieu des cases de terre : les cases de mer de la
  zone (§3.2) des villes du joueur. Une ville dont la zone contient de la mer
  a un port (§3.6) ;
- des **pêcheurs** au lieu des fermiers ;
- des **bateaux de pêche** au lieu des tracteurs pour la mécanisation.

Plus il y a de bateaux, plus la pêche est mécanisée. Le résultat est le flux de
**poisson**.

**Différence avec la terre** (décision de l'auteur, 23 octobre 2026) :

- Sur terre, deux choses jouent, séparément : le rendement d'une case vient de
  sa fertilité (et plus tard des engrais, non décrits) ; les tracteurs ne font
  que réduire le nombre de fermiers requis.
- En mer, les bateaux de pêche jouent sur les deux : ils réduisent le nombre de
  pêcheurs requis (mécanisation, comme les tracteurs) **et** augmentent le
  rendement d'une case d'eau.
- Sans bateau, une case d'eau rapporte un peu moins qu'une case de terre :
  `FISHING.tileYield` (3, pour une fertilité de terre de 5). Avec le maximum de
  bateaux, son rendement double environ : `FISHING.tileYieldMax` (6 ; l'auteur a
  évoqué « 7 ou 8 pour 5 »). La pêche mécanisée devient alors plus intéressante
  que l'agriculture.

```
rendement_eau = tileYield + (tileYieldMax − tileYield) × f(x)
```

`f(x)` est la courbe du §6.3, avec le même `x` (bateaux par pêcheur) que la
mécanisation de la pêche : un seul nombre de bateaux règle les deux effets.

### 6.5 Nourriture produite

```
blé        = fertilité_totale × surface_cultivée / surface_max
poisson    = rendement_eau × surface_pêchée                       (§6.4)
nourriture = max(blé + poisson, FOOD.minimum)                     par tour
```

C'est la fertilité moyenne des cases cultivables de la nation, multipliée par
la surface cultivée. Les cases réellement cultivées ne sont pas choisies : seul
le total compte pour le jeu. Multiplier avant de diviser. Si `surface_max` = 0,
il n'y a rien à cultiver.

**Nourriture minimale** : `FOOD.minimum` (§10), **1 500 par tour** (valeur
donnée par l'auteur, 23 octobre 2026). Sans elle, une population nulle
donnerait zéro fermier, donc zéro nourriture, donc une population maximale
nulle : la population ne repartirait jamais. La population tend donc toujours
au moins vers `FOOD.minimum / consommation_par_tête`. Pour comparer : une
ville entièrement cultivée en terre fertile (317 cases de fertilité 5) produit
1 585.

Le minimum n'est pas ajouté à la production : `max`, pas une somme. Une seule
ville cultivée ajoute donc peu au minimum. Voulu par l'auteur : un joueur aura
rarement une seule ville, et avec une seule ville il mettra sa population dans
les usines plutôt que dans les champs.

### 6.6 Rayon d'exploitation (affichage seulement)

Le client calcule un rayon r commun à toutes les villes du joueur, tel que la
somme, sur toutes ses villes, des cases de fertilité > 0 de leur zone à moins
de r de la ville soit égale à `surface_cultivée`. Il dessine ces cases (en vert
pour commencer, une texture de champs plus tard). Une approximation suffit ; le
moteur ne calcule pas ce rayon.

Une case sans fertilité (montagne, eau) n'est pas comptée : le disque cultivé
s'étend plus loin quand il en contient.

Pêche : même calcul, sur les cases de mer de la zone des villes à port, avec
la surface pêchée (§6.4). Le disque est centré sur la ville, pas sur l'icône
du port (§3.6).

Fer (et toute ressource extraite, §7) : même calcul, sur les cases de fer des
zones du joueur, avec `cases_exploitées`. Un rayon commun à toutes ses villes,
agrandi jusqu'à ce que le nombre de cases de fer couvertes égale le nombre de
cases exploitées.

## 7. Extraction des ressources naturelles

Pour chaque ressource naturelle r autre que le blé et le poisson (le fer, et
celles de la liste). **Même fonctionnement que l'agriculture et la pêche**
(décision de l'auteur, 24 octobre 2026) : des cases (le gisement), des
travailleurs (les mineurs) qui en exploitent une partie, et des machines (les
engins miniers) qui réduisent le nombre de mineurs requis. Le moteur n'a besoin
que du nombre de cases du gisement couvertes par les villes du joueur : c'est
sa capacité maximale.

```
gisement[r]     = nombre de cases portant r dans les zones de toutes les
                  villes du joueur
rendement[r]    = RESOURCES[r].capacityPerTile     ressource par case et par tour
capacité_max[r] = gisement[r] × rendement[r]
demande[r]      = consommation de r par les lignes remplies (§8)
                + quantité de r demandée à l'export par d'autres joueurs
extraction[r]   = min(demande[r], capacité_max[r]), limitée par la population
cases_exploitées[r] = ceil(extraction[r] / rendement[r])
mineurs[r]      = ceil(cases_exploitées[r] × 1000 / Mécanisation_minière)
```

Pour le fer aujourd'hui : chaque ligne remplie consomme 1 fer par tour (§8).

**Une case de fer n'est pas cultivable** (décision de l'auteur) : sa fertilité
vaut 0 (§2).

- **On n'extrait que ce qui est demandé.** Une ressource sans demande n'occupe
  personne.
- **Extraire ne vide pas la case** : c'est une capacité par tour, un flux.
- `Mécanisation_minière` suit la courbe du §6.3, avec les **engins miniers**
  comme machines et ses propres valeurs de configuration.
- Les mineurs sont affectés ligne de production par ligne de production, avec
  les ouvriers d'usine de chaque ligne, avant les champs et la pêche (§4).
- Le groupe (§3.5) où se trouvent les cases n'intervient pas : l'extraction
  est nationale (§3.4).

## 8. Usines et biens

- Les usines transforment des ressources naturelles en biens ou en armement
  (§8.3). Seuls biens décrits : les machines (§5).
- Une usine est construite dans une ville, par un ordre du joueur (§9).
  **Pour l'instant, construire une usine est gratuit.** **Une usine est créée
  avec une ligne de son bien de base** (la racine de son arbre, §8.4), active,
  sans second clic (décision de l'auteur, 24 octobre 2026). Nombre maximal de
  types d'usines différents par ville : `FACTORY.maxTypesPerCity` (fichier de
  configuration), 1 pour commencer.
- Chaque type d'usine a un logo, affiché à côté de la ville où elle est
  construite.
- **Niveau = ligne de production.** Un niveau d'usine est une ligne de
  production élémentaire d'un bien. Exemple : 3 lignes de tracteurs et 1 ligne
  d'engins miniers dans la même usine font une usine de niveau 4.
- Chaque ligne emploie un nombre fixe d'ouvriers (fichier de configuration).
- Chaque ligne produit, par tour, une quantité propre au bien
  (`GOODS[b].productionPerLine`), et consomme la ressource indiquée pour ce
  bien. **Pour commencer : chaque ligne remplie consomme 1 unité de fer par
  tour**, quel que soit son bien ou son type d'armement.
- **Déblocage** : plus une usine produit, plus elle débloque de productions
  alternatives, selon l'arbre de son type d'usine (§8.4). Exemples donnés par
  l'auteur : une usine d'engins miniers qui débloque les tracteurs, puis les
  chars (§8.4).
- **Spécialisation** : plus une usine a de lignes d'un même bien, moins chacune
  demande d'ouvriers. Pour commencer : `x` % d'ouvriers en moins par ligne
  supplémentaire du même bien dans la même usine, `x` =
  `FACTORY.specializationPercent`. Formule exacte à définir (§13). But : un
  joueur spécialisé produit plus efficacement et échange pour obtenir le
  reste. **Pas implémentée pour l'instant** : prévue plus tard (décision de
  l'auteur, 23 octobre 2026). D'ici là, chaque ligne emploie
  `FACTORY.workersPerLine` ouvriers.
- Pas de stock : la production d'une usine à un tour est le flux disponible à
  ce tour.

```
production[b]     = somme, sur les lignes actives et remplies de b, de GOODS[b].productionPerLine
consommation[r]   = somme, sur les biens b qui utilisent r, de production[b] × ratio de r pour b
```

Pour commencer, avec 1 fer par ligne :

```
consommation[fer] = nombre de lignes remplies (biens et armement)
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
- **Panneau latéral** (décrit par l'auteur, 24 octobre 2026), ouvert par le
  bouton « Production » (§1) :
  - une section par ville qui a une usine : nom de la ville, type d'usine,
    niveau (nombre de lignes) ;
  - dans la section, une sous-section par bien produit : les lignes de ce bien,
    leur nombre de lignes actives (curseur) ;
  - les biens encore verrouillés de l'arbre de l'usine (§8.4) apparaissent
    aussi, avec la progression de leur déblocage : **symbole du parent →
    flèche qui se remplit → symbole du bien**. Le joueur voit ainsi quelle ligne
    débloque quel bien. Les symboles n'existent pas encore : un texte
    provisoire les remplace ;
  - **une ligne de panneau par bien de l'arbre de l'usine** (précision de
    l'auteur, 24 octobre 2026), dans l'un de trois états : en production
    (curseur des lignes actives et bouton **+** qui ajoute une ligne de ce
    bien), débloqué sans ligne (bouton **+** qui crée la première ligne), ou
    verrouillé (symbole du parent → flèche → symbole du bien). Il n'y a pas de
    bouton « Ajouter une ligne » séparé ni de liste de biens à choisir (§8.2).
- **Priorité** : le joueur fait glisser **des villes entières** (une section
  monte ou descend avec toutes ses lignes), et **des lignes au sein d'une
  ville**. Les deux ne se mélangent pas : une ligne ne sort pas de la section
  de sa ville. Ordre de remplissage (§4) : la première ville, ses lignes de
  haut en bas, puis la ville suivante. Inspiration : le panneau de production
  de Hearts of Iron, sauf qu'on n'y affecte pas des usines : on ouvre et ferme
  des lignes selon la population disponible.
- Une ligne qui ne peut pas être entièrement alimentée ne produit rien. Le
  joueur est censé le voir avant et ne pas l'activer ; les ouvriers restants
  vont aux champs.

### 8.2 Créer une ligne

- Le joueur crée les lignes (ordre).
- **Nombre maximal de lignes** par joueur : fonction de sa population, définie
  dans le fichier de configuration.
- **Condition (déblocage)** : une ligne d'un bien qui a un parent dans l'arbre
  de l'usine (§8.4) ne peut être créée que si une ligne de ce parent
  fonctionne depuis au moins `FACTORY.unlockTurns` tours (500 pour commencer,
  valeur donnée par l'auteur). La production de base de l'usine (la racine de
  l'arbre, par exemple les fusils) n'a pas de condition.
- **Progression** (décision de l'auteur, 24 octobre 2026) : les tours se
  cumulent. **C'est la production qui fait avancer le déblocage** : quand la
  ligne du parent ne produit pas (désactivée, ou pas remplie faute de
  population ou de fer), la progression s'arrête mais n'est pas perdue ; elle
  reprend quand la ligne produit de nouveau. Lecture retenue : la progression
  est propre à l'usine, et compte les tours où au moins une ligne du parent de
  cette usine produit. Le panneau la montre par la flèche entre les deux
  symboles (§8.1).
- **Coût** : pas encore décidé. Piste de l'auteur : sacrifier un peu de
  population.

### 8.3 Armement

- **Production** : l'armement est produit comme les biens, par des lignes
  d'usine qui consomment un flux de ressources et emploient des ouvriers
  (§8). Une ligne produit soit un flux de biens, soit un flux d'armement.
- **Types** : l'armement couvre les fusils, les chars, les camions, les
  navires de guerre, les avions. Chaque type est défini dans le fichier de
  configuration, comme un bien (§10). Types décrits : les cinq de l'usine
  d'armement d'infanterie (§8.4) — fusils, mitrailleuses, artillerie, canons
  anti-aériens, canons anti-chars.
- **Biens et armement** : un flux de biens est consommé dans le tour, jamais
  stocké (§5). L'armement, lui, peut être stocké, jusqu'à une limite.

**Réserve nationale.** Inspiration : Hearts of Iron 4.

- Chaque joueur a une réserve nationale par type d'armement.
- Les armées prennent leur équipement dans cette réserve. L'équipement
  attribué à une armée sort de la réserve. Quand toutes les armées sont
  entièrement équipées, l'armement produit s'accumule dans la réserve.
- **La production ne s'arrête jamais** (correction de l'auteur, 24 octobre
  2026) : une ligne active et remplie produit à chaque tour, et ce qu'elle
  produit entre dans la réserve. Il n'y a pas de ligne suspendue.
- **Stock cible** : `ARMAMENT.maxStockTurns` tours de production (une seule
  valeur pour tous les types). Exemple de l'auteur : avec 1 char par tour et
  100 tours, le stock cible est de 100 chars, en plus de ceux des armées.

  ```
  stock_cible[a] = nombre de lignes de a × ARMAMENT[a].productionPerLine
                   × ARMAMENT.maxStockTurns
  ```

  Calculé sur toutes les lignes de ce type (la limite théorique décidée plus
  tôt avec l'auteur) : désactiver des lignes ne le fait pas baisser.
- **Déclin au-dessus du stock cible** : la réserve peut dépasser le stock
  cible. À chaque tour, `ARMAMENT.decayRate` de la part au-dessus du stock
  cible est supprimée. La réserve se stabilise donc là où le déclin égale la
  production.

  ```
  réserve = réserve + production[a]
  excès   = max(0, réserve − stock_cible)
  réserve = réserve − excès × ARMAMENT.decayRate / S     (reste : §13)
  ```
- **Consommation** : une armée inactive consomme très peu d'armement ; une
  armée au combat en perd bien plus. Les quantités dépendent du combat, non
  décrit.

### 8.4 Types d'usines et arbre de production

- Il y a plusieurs **types d'usines**. Une ville porte au plus
  `FACTORY.maxTypesPerCity` types (1 pour commencer, §8).
- Chaque type d'usine a un **arbre de production** : des biens et des types
  d'armement reliés de parent à enfant. Pour débloquer une branche, il faut
  d'abord une ligne qui fonctionne plus haut dans l'arbre. Elle débloque les
  branches suivantes (forme du déblocage : §8.2).
- La structure des arbres est dans le fichier de configuration.
- **Types d'usine de base** (décrits par l'auteur, 24 octobre 2026) : ce sont
  les choix du menu « Inaugurer une usine » (§1). Chacun commence par la racine
  de son arbre :

  | Type d'usine | Racine | Branches |
  | --- | --- | --- |
  | Armement d'infanterie | fusils | décrites ci-dessous |
  | Bateaux de pêche | bateaux de pêche | plus tard ; exemple de l'auteur : navires de transport (§3.6), puis navires de guerre |
  | Engins miniers | engins miniers | tracteurs ; plus tard, différents types de chars à partir des tracteurs |

  Pour l'instant : l'arbre de l'infanterie, les bateaux de pêche seuls, et
  engins miniers → tracteurs.

**Usine d'armement d'infanterie** (premier arbre décrit) :

```
fusils                       production de base de l'usine
├── mitrailleuses            débloquées par une ligne de fusils
│   └── canons anti-aériens  débloqués par une ligne de mitrailleuses
└── artillerie               débloquée par une ligne de fusils
    └── canons anti-chars    débloqués par une ligne d'artillerie
```

- Cinq types d'armement en tout (§8.3).
- Débloquer une branche ajoute une production, sans remplacer les
  précédentes : une même usine peut avoir des lignes de fusils, de
  mitrailleuses et d'artillerie en même temps.
- Plusieurs lignes de chaque type sont possibles. Plus une usine a de lignes
  d'un même type, moins chacune demande d'ouvriers (spécialisation, §8).
- Chaque type a une icône, dessinée par l'auteur (§11).

## 9. Ordres

| Ordre | Paramètres | Valide si | Effet |
| --- | --- | --- | --- |
| Fonder une ville | la case | §3.3 | retire le coût en population ; crée la ville ; recalcule les zones (§3.2) et les totaux (§6.1, §7) des joueurs touchés |
| Régler la part fermiers / pêcheurs | la proportion | format à définir (§13) | change la répartition du §4 |
| Construire une usine | la ville, le type d'usine (§8.4) | la ville appartient au joueur ; elle a moins de `FACTORY.maxTypesPerCity` types d'usines. Gratuit pour l'instant | crée une usine de ce type, avec une ligne active de son bien de base |
| Créer une ligne de production | la ville (l'usine), le bien | maximum de lignes non atteint ; conditions et coût à définir (§8.2) | ajoute une ligne |
| Régler les lignes actives | l'usine, le bien, le nombre de lignes actives | entre 0 et le nombre de lignes de ce bien dans cette usine | change les lignes qui reçoivent des ouvriers (§8.1) |
| Changer la priorité | la ligne (ou le groupe), sa nouvelle position | la ligne appartient au joueur | change l'ordre de remplissage (§4, §8.1) |
| Changer de capitale | la ville | la ville appartient au joueur ; coût et conditions à définir (§3.4) | la ville devient la capitale ; recalcule les villes reliées (§3.5, §3.6) |
| Interdire / autoriser une zone maritime | la zone | la zone existe | ajoute ou retire la zone des zones interdites du joueur ; recalcule ses routes maritimes (§3.6) |

Les noms et formats exacts des ordres sont fixés avec la session du moteur.

## 10. Fichier de configuration

Noms proposés, dans le style de `packages/engine/src/config.ts`.

**Aucune valeur n'est fixée, et aucune ne doit être devinée.** Elles seront
choisies ensemble plus tard, en essayant des valeurs.

| Nom | Sens |
| --- | --- |
| `CITY.expansionRadius` | rayon d'expansion, en cases ; 50, valeur donnée par l'auteur (25 avant le 23 octobre 2026) |
| `CITY.controlRadius` | rayon de contrôle, en cases : la moitié du rayon d'expansion, calculée (§3.1) ; 25 (10 avant) |
| `CITY.foundingCostPopulation` | coût de base, en population, d'une ville autre que la première (§3.3) ; 500, valeur donnée par l'auteur (100 avant) |
| `CITY.foundingCostIncreasePercent` | pourcentage du coût de base ajouté au coût d'une ville par ville déjà possédée (§3.3) ; 100, valeur donnée par l'auteur |
| `POPULATION.initial` | population donnée à la fondation de la première ville (§4) |
| `POPULATION.foodPerHead` | `consommation_par_tête` (§4.1) |
| `POPULATION.growthPerMillion` | `taux_de_croissance` (§4.1), en millionièmes de personne par unité de nourriture restante et par tour |
| `FOOD.minimum` | nourriture minimale par tour d'un joueur (§6.5) ; 1 500, valeur donnée par l'auteur |
| `FERTILITY.land` | fertilité (0 à 10) d'une case de terre qui n'est pas une montagne, pour commencer (§2) |
| `TEST_MAP.mountainAltitude` | altitude à partir de laquelle une case est une montagne : fertilité 0, fer plus fréquent (§2) |
| `FARMING.mechanizationBase` | `M_base` : surface par fermier sans tracteur |
| `FARMING.mechanizationMax` | `M_max` : surface par fermier à pleine mécanisation |
| `FARMING.maxTractorsPerFarmer` | `m_max` : tracteurs par fermier au-delà desquels la mécanisation n'augmente plus |
| `FARMING.mechanizationCurveExponent` | `n` de la courbe §6.3, entier ≥ 1 |
| `FISHING.*` | mêmes quatre valeurs pour la pêche, avec les bateaux ; plus `FISHING.tileYield` (rendement d'une case d'eau sans bateau, 3 pour une terre de 5, ratio donné par l'auteur) et `FISHING.tileYieldMax` (rendement avec le maximum de bateaux, environ le double ; 6 pour commencer) (§6.4) |
| `MINING.*` | mêmes quatre valeurs pour l'extraction, avec les engins miniers |
| `SHIPPING.*` | mêmes quatre valeurs pour les routes maritimes, avec les navires de transport ; la mécanisation y est un travail (quantité × distance) par marin (§3.6) |
| `RESOURCES` | une section par ressource naturelle, qui regroupe tous ses paramètres : `capacityPerTile` (capacité d'extraction par tour d'une case qui la porte, §7), icône, critères qui modulent son seuil de présence (§2) |
| `GOODS` | une section par bien : ressource(s) utilisée(s) et ratio, `productionPerLine` (§8), nom du fichier d'icône |
| `ARMAMENT` | une section par type d'armement, comme `GOODS` : ressource(s) utilisée(s) et ratio, `productionPerLine`, icône (§8.3) |
| `ARMAMENT.maxStockTurns` | nombre de tours de production qu'une réserve d'armement peut contenir, même valeur pour tous les types (§8.3) ; 100 évoqué par l'auteur, non fixé. Un tour dure 100 ms : 100 tours = 10 s de production |
| `ARMAMENT.decayRate` | part de l'excès au-dessus de `réserve_max` perdue à chaque tour (§8.3). À une échelle fine (comme S = 10 000, §6.3) plutôt qu'en %, un tour ne durant que 100 ms |
| `FACTORY_TYPES` | une section par type d'usine : son arbre de production (biens et armement, de parent à enfant), logo (§8.4). Premier type : `infantryArmament` (§8.4) |
| `ARMAMENT` (noms) | noms proposés des cinq types d'infanterie : `rifle`, `machineGun`, `artillery`, `antiAirGun`, `antiTankGun` (§8.4) |
| `FACTORY.workersPerLine` | ouvriers employés par une ligne de production (§8) |
| `FACTORY.specializationPercent` | `x` : ouvriers en moins, en %, par ligne supplémentaire du même bien dans une usine (§8) ; pas encore utilisé |
| `FACTORY.unlockTurns` | nombre de tours de fonctionnement d'une ligne du bien parent avant de pouvoir créer une ligne du bien enfant (§8.2) ; 500 pour commencer, valeur donnée par l'auteur |
| `FACTORY.maxLines…` | nombre maximal de lignes d'un joueur en fonction de sa population (§8.2) ; forme à définir |
| `FACTORY.maxTypesPerCity` | types d'usines différents par ville (1 pour commencer, valeur donnée par l'auteur) |
| `ROADS.heightCostFactor` | client seulement : augmentation du coût d'une case avec son altitude, pour le tracé A* des routes (§3.5) ; assez fort, selon l'auteur |
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
- **Le territoire s'arrête à la côte.** La zone d'une ville couvre aussi l'eau
  pour les règles (port, pêche : §3.6, §6.4), mais la couleur du joueur et les
  limites de zones ne sont dessinées que sur la terre.
- Entre deux villes d'un même joueur, une ligne légère ou en pointillé marque la
  limite de leurs zones. Affichable ou masquable.
- Options de vue de la carte : par joueur, ressources naturelles, relief, et
  d'autres.
- Zone d'exploitation : vert, puis texture de champs (§6.6). Zone de pêche :
  même calcul en mer, centré sur la ville (§6.6), dessinée par une texture
  propre à la pêche sur l'eau, comme les champs sur la terre. Elle ne doit pas
  ressembler au territoire du joueur. Zone de mine (fer exploité) : même calcul
  sur les cases de fer (§6.6), avec sa propre texture ; une texture provisoire
  d'abord, l'auteur dessine la vraie.
- Port : icône sur la case de côte la plus proche de la ville (§3.6).
- Routes terrestres : chemin A* sur les cases, plus cher en altitude (§3.5).
- Routes maritimes : courbe lissée (Bézier) par les zones du chemin (§3.6).
- Diplomatie : petit menu à côté de la souris, au clic sur un joueur (§1).
- **Barre d'informations en haut de l'écran** (décrite par l'auteur, 24 octobre
  2026), compacte, sur une ligne. Quatre sections ; un clic sur une section
  déplie son détail sous la barre, un second clic le replie :
  1. **Population** : total, variation par tour, maximum. Détail : la part de
     la population par occupation (ouvriers d'usine, mineurs, fermiers,
     pêcheurs, inactifs), en rectangles proportionnels.
  2. **Nourriture** : production par tour, surplus. Détail : agriculture et
     pêche séparées ; plus tard importations et exportations.
  3. **Ressources (flux)** : rien dans la barre, tout dans le détail. Barres
     **vertes**, pour marquer un flux. Fer : barre pleine = capacité, vert =
     production du tour, **gros trait noir** = production requise par les
     lignes actives ; si la production est sous le requis, l'écart est
     **rouge**. Machines (tracteurs, bateaux de pêche, engins miniers) :
     valeur actuelle sur le nombre qu'il faudrait pour une mécanisation totale.
  4. **Armement (stock)** : rien dans la barre, tout dans le détail. Une jauge
     par type ; au-delà du stock cible (§8.3), la barre est **hachurée de
     rouge** : c'est la zone où l'excès décline.
- Logo de chaque usine à côté de sa ville (§8).
- Taille des villes : la même pour toutes, plus grande pour une ville qui
  porte une usine, selon le niveau de l'usine (§3.7).
- Panneau latéral des lignes de production, avec un réglage par groupe de
  lignes identiques (§8.1).
- Une icône par ressource, par bien et par type d'armement, nommée dans le
  fichier de configuration. Des icônes provisoires d'abord ; l'auteur dessine
  et importe les vraies. Existent déjà, en provisoire (un carré gris) : les
  cinq types d'infanterie, dans `client/public/icons/armament/`
  (`rifle.svg`, `machine-gun.svg`, `artillery.svg`, `anti-air-gun.svg`,
  `anti-tank-gun.svg`). Remplacer un fichier par le vrai dessin, sous le même
  nom, suffit.

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
  entrent dans l'état de la partie, donc dans le hash (02-Engine §6). De même
  la capitale de chaque joueur et ses zones maritimes interdites (§3.4, §3.6).
- Le port est un attribut de la ville, déduit de sa zone (§3.6) : recalculé
  avec `owner`, quand une ville est fondée ou disparaît.
- L'armement est la seule quantité qui passe d'un tour à l'autre (§8.3) : la
  réserve de chaque type, par joueur, et l'équipement de chaque armée sont
  dans l'état, donc dans le hash. De même le type de chaque usine, ses lignes
  et la progression de déblocage de son arbre (§8.4).
- Le réseau de routes terrestres se déduit des villes (§3.5) : il peut être
  gardé dans l'état ou recalculé, le résultat est le même. Il est recalculé
  quand une ville est fondée ou disparaît.
- Le réseau maritime (§3.6) est calculé une fois, à la génération de la
  carte, après les zones maritimes, et ne change pas. Comme les zones, il est
  recalculé par chaque client à partir de la graine.
- Les routes maritimes demandent un plus court chemin sur le réseau maritime,
  en entiers (§13 : longueur d'une liaison).
- **Les flux se citent en boucle** : les tracteurs d'un tour viennent des
  usines, qui consomment du fer, extrait par des mineurs, dont le nombre dépend
  des engins miniers, qui viennent des usines. Proposition : à chaque tour, les
  machines utilisées sont celles produites au tour précédent (100 ms de
  décalage). À valider.

## 13. Points ouverts

**Partie**
- Fin de partie et IA : reportées par l'auteur (§1.1). Une IA, le jour où elle
  existe, fait partie du moteur, doit être déterministe, et chaque client la
  calcule entièrement.

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
  position dans la section de sa ville ? (Priorité décidée : villes entières,
  puis lignes au sein d'une ville, §8.1.)
- Mineurs pour l'export (§7) : remplis avec les lignes, après elles, ou après
  les champs ?
- Le format du réglage fermiers / pêcheurs, et son effet tant qu'un joueur n'a
  pas de cases de mer. Choix provisoire du moteur : un pourcentage entier de
  fermiers, 100 par défaut (02-Engine §7). Sans mer, les pêcheurs vont aux
  champs par le report du §4.
- Ordre dans un tour : choix provisoire du moteur, les ordres d'abord, puis la
  répartition, la nourriture et la croissance de chaque joueur (02-Engine §7).
- Si la population ne suffit pas à couvrir la demande d'extraction : extraction
  partielle, et rien pour les champs ?

**Agriculture et pêche**
- Unités : la surface est-elle comptée en cases ? Combien de personnes
  représente une unité de population ? Choix provisoire du moteur : surface en
  cases, population en personnes, mécanisation en millièmes de case par
  travailleur (02-Engine §7).
- Arrondi de `fermiers_requis` (vers le haut, pour couvrir toute la surface, ou
  vers le bas). Choix provisoire du moteur : vers le haut.
- Arrondi d'une baisse de population (§4.1) : choix provisoire du moteur, la
  partie entière est prise vers zéro, le reste garde son signe.
- La fertilité change-t-elle en cours de partie ? Les engrais augmenteront le
  rendement des cases de terre (§6.4, décision de l'auteur) ; leur forme (un
  bien ? un flux consommé ?) n'est pas décrite.
- Pêche : les cases de mer ont-elles un équivalent de la fertilité ? Les
  cases de mer d'un bassin sans zone maritime (§2.1, lac) comptent-elles ?
  Choix provisoire du moteur : toute case d'eau de la zone compte, lac
  compris, avec un rendement fixe `FISHING.tileYield` (02-Engine §7).
- Fer : choix validés par l'auteur, implémentés (02-Engine §2, `npm run
  viz:iron`). Bruit du générateur de la carte, avec sa propre graine ; seuil
  qui baisse avec l'altitude, plus une baisse supplémentaire sur les
  montagnes (altitude ≥ un seuil). Réglages : valeurs d'essai, à choisir sur
  la visualisation.

**Extraction**
- Mécanisation minière : le nombre d'engins par mineur dépend du nombre de
  mineurs, qui dépend de la mécanisation (même boucle que celle évitée au §6.2
  par les fermiers disponibles). Choix provisoire du moteur : les engins sont
  rapportés aux mineurs qu'il faudrait sans engin (02-Engine §7).
- Machines (tracteurs, bateaux de pêche, engins miniers) : choix provisoire du
  moteur, celles produites au tour précédent (proposition du §12).

**Usines**
- Construction : gratuite pour l'instant (§8). Coût réel et durée éventuelle :
  plus tard.
- Créer une ligne : coût (piste : de la population). Condition décidée :
  `FACTORY.unlockTurns` tours de fonctionnement d'une ligne du parent (§8.2).
  Décidé : tours cumulés de production, la pause ne fait pas perdre la
  progression (§8.2). Lecture retenue, à confirmer : ligne du parent dans la
  même usine.
- Spécialisation (reportée par l'auteur, prévue plus tard) : `x` % en moins
  par ligne, appliqué de façon composée (`(1 − x)ᵏ`) ou linéaire (`1 − k·x`) ;
  plancher éventuel.
- `FACTORY.workersPerLine` : une valeur commune, ou une par bien ?
- Forme du nombre maximal de lignes en fonction de la population.

**Capitale et routes**
- Changer de capitale : coût, conditions, délai.
- Perte de la capitale.
- Droit de passage (§3.5) : décidé ou non, réciproque ou non, révocable ;
  passe-t-il aussi les routes maritimes d'un joueur par les ports d'un autre ?
- Une ville posée exactement sur une route candidate (trois villes alignées) :
  la route compte-t-elle comme croisée ? Choix provisoire du moteur : non,
  seul un croisement franc compte (02-Engine §7).
- Port et lacs : choix provisoire du moteur, toute case d'eau de la zone
  compte, lac compris (02-Engine §7).
- **Quantité d'une route maritime (§3.6) : à redemander à l'auteur.** Piste :
  population × villes du groupe / villes du joueur. Écartées : la production
  du groupe, et un ordre d'extraction par groupe (groupe principal d'abord),
  parce que la production reste nationale (§3.4).
- Marins : place dans l'ordre de répartition de la population (§4). Principe
  confirmé par l'auteur, pour l'instant : pas de demi-mesure. Ce qui demande
  des marins n'en reçoit qu'en entier, ou pas du tout.
- Groupe relié ni par terre ni par mer (pas de port, toutes les zones
  interdites) : quel effet, puisque sa production compte quand même ?
- Route maritime : comment une ville à port se rattache au réseau maritime
  (zone de la case de côte la plus proche, zones touchées par sa zone…), et la
  longueur de ce rattachement.
- Route maritime en chaîne : un groupe peut-il passer par le port d'un autre
  groupe déjà relié par mer, si c'est plus court que d'aller jusqu'au groupe
  de la capitale ?
- Réseau maritime : quelles paires de points sont candidates (zones qui se
  touchent, ou distance maximale) ? Une liaison peut-elle passer au-dessus de
  la terre ?
- Longueur d'une liaison maritime, en entiers : la distance exacte demande une
  racine carrée. Piste : racine carrée entière calculée en entiers, une fois
  par liaison à la génération.
- Navires de transport par marin : dépend du nombre de marins, qui dépend de la
  mécanisation (même boucle qu'à l'extraction).

**Armement**
- Stock cible (§8.3) : les lignes désactivées par le joueur comptent-elles
  dans « toutes les lignes » ? Écrit pour l'instant : toutes les lignes du
  type, quel que soit leur état.
- Arrondi du déclin de l'excès en entiers : le moteur garde un reste d'un tour
  à l'autre, comme pour la croissance (§4.1, 02-Engine §7).
- Ordre dans le tour : production, puis équipement des armées, puis réserve ?
- Arbre (§8.4) : la ligne « plus haut dans l'arbre » qui débloque une branche
  doit-elle être dans la même usine, ou n'importe où dans la nation ?
- Usine d'armement d'infanterie (§8.4) : la branche suivante se débloque après
  `FACTORY.unlockTurns` tours (§8.2). Ressource consommée : 1 fer par ligne
  pour commencer (§8).
- Usage des cinq types d'infanterie par les armées : avec le module armée.

**Taille des villes (affichage)**
- Niveau compté sur toutes les lignes de l'usine, ou seulement sur les lignes
  actives (§8.1) ? Paliers de taille, ou taille continue ?

**Commerce** : la demande à l'export (§7) et les machines échangées (§5) en
dépendent ; non décrit.

**Modules non décrits** : voir le tableau du §1.
