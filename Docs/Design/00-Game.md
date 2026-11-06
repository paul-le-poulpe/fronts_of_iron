# 00 — Le jeu

Ce que le jeu est, et chaque action du joueur, qui devient un type d'ordre du
moteur (01-Architecture §3). Rédigé avec l'auteur, au fur et à mesure.

**Ce qui n'est pas écrit ici, ou dans un document thématique listé ci-dessous,
n'est pas décidé.** Le moteur n'implémente que ces documents ; ce qui reste à
trancher est listé au §13 (et dans chaque document thématique). Rien n'est
repris d'OpenFront par défaut.

**Documents thématiques** : ils font foi pour leur domaine ; ce document n'en
garde qu'un résumé et y renvoie. Une règle n'est écrite qu'à un seul endroit.

| Domaine | Document |
| --- | --- |
| Fronts terrestres : détection, divisions, placement sur les fronts, renfort, attaques, combat, avancée, prise de ville, encerclement, leur interface | `05-Fronts.md` (§3.8 ici : résumé) |
| Combat instantané et replay (§1, §2) ; ses §3 à §4 sont remplacés par `08-Population.md` | `06-Combat-Simplifie.md` |
| Population en bonshommes, boîtes d'activités, nourriture, fer, usines, casernes, blessés, déblocage, panneau de production | `08-Population.md` (§4 ici : résumé) |
| Couleurs des joueurs : liste, tons d'unité, icônes de remplacement, choix sur l'accueil | `09-Couleurs.md` (§11 ici : résumé) |

Un fichier dont le nom finit par `-History` (par exemple `05-Fronts-History.md`)
est un historique de discussions : il ne fait jamais foi.

---

## 1. Vue d'ensemble

Stratégie multijoueur dans le navigateur. Parties courtes. Pas de brouillard de
guerre.

### 1.1 La partie

- **Fin de partie** : hors périmètre pour l'instant. En développement, l'auteur
  arrête la partie lui-même. Aucune condition de victoire n'est implémentée.
- **Joueurs** : jusqu'à 100 par partie, sans réglage à la création. Chaque
  joueur donne son nom en rejoignant. Pas d'arrivée après le lancement ; un
  joueur déconnecté peut revenir. Salle d'attente et lancement :
  01-Architecture §4.
- **Rythme** : temps réel, un tour toutes les 100 ms par défaut, pas réglable.
  Le moteur ne connaît que des tours, et toutes les règles sont exprimées en
  tours. Changer le pas change donc la vitesse de la partie en temps réel, pas
  ses résultats : 100 tours durent 10 s à 100 ms, 20 s à 200 ms.
- **Pause : l'hôte seulement.** Toute partie en ligne a un hôte, qui peut la
  mettre en pause et la reprendre ; les autres joueurs ne le peuvent pas. Ce
  n'est pas un ordre du moteur : le relais cesse de créer des tours
  (01-Architecture §3).
- **Joueurs non humains (IA)** : pas en ligne pour l'instant ; à terme, oui.
  Les bots arrivent en dernier, une fois le jeu stabilisé. Ceux du solo
  (`03-Client.md` §5) ne servent qu'au débogage.

Modules prévus :

| Module | État |
| --- | --- |
| Zones maritimes (maillage de la mer) | décrit en partie (§2.1) |
| Villes | décrit (§3) |
| Population, nourriture, extraction, usines, casernes | `08-Population.md` |
| Flux et ressources | onglet à remanier plus tard |
| Capitale | décrit en partie (§3.4) |
| Routes terrestres et maritimes | décrit en partie (§3.5, §3.6). Nœuds : les villes sur terre, les zones maritimes en mer (§2.1) |
| Croissance des villes | décrit (§3.7) : affichage seulement, pas de taille dans le moteur |
| Commerce terrestre et maritime | annoncé, non décrit. Mêmes règles sur terre et sur mer, seul le support change |
| Fronts terrestres | version 1 (divisions) décrite le 30 octobre 2026 (`05-Fronts.md`, résumé §3.8) ; moteur implémenté le 31 octobre 2026, interface en cours (version 0.1 : tag `v0.1`). Fronts aériens et maritimes plus tard |
| Armée, combat | terre : `05-Fronts.md` (divisions, combat, prise de ville) ; air et mer : annoncé, non décrit |
| Politique entre joueurs | décrit en partie (§1, Diplomatie) : statuts neutre, pacte de non-agression, guerre ; menu au clic sur un joueur. Ni alliance, ni droit de passage, ni garantie d'indépendance, ni commerce dans cette version |

Le joueur agit par une barre de boutons. Pour l'instant, tous les boutons sont
dans cette même barre :
- créer une ville ;
- **production** : ouvre ou ferme le panneau latéral de production (`08-Population.md` §11).

Prévu : une section maritime, avec le bouton qui interdit des zones maritimes
aux bateaux du joueur (§3.6). Cette section n'existe pas encore. Elle pourra
être séparée de la barre plus tard, selon le nombre de boutons.

**Diplomatie** (décrite par l'auteur, 25 octobre 2026).

*Statut.* Une seule valeur par paire de joueurs, la même vue des deux côtés :
- **Neutre** : statut de départ. Pas de combat.
- **Pacte de non-agression** : pas de combat. Il faut le rompre avant de pouvoir
  déclarer la guerre.
- **Guerre** : le seul statut où le combat est possible. La guerre doit être
  déclarée avant d'attaquer.

Il n'y a, dans cette version, ni alliance, ni droit de passage, ni garantie
d'indépendance, ni commerce (les routes commerciales viendront plus tard).
**Les attaques sont décrites dans `05-Fronts.md` et implémentées** : la règle « pas de combat hors
guerre » y est appliquée (un ordre d'attaque sur un front en paix est invalide). Le moteur tient le statut
de chaque paire ; les fronts le lisent.
Effets de la guerre et de la paix sur les fronts : `05-Fronts.md` §2.3.

*Actions.* Le joueur clique sur le territoire d'un autre joueur (quand aucun
bouton de la barre n'est armé), ou sur sa ligne dans l'onglet Diplomatie de la
barre d'informations (liste des joueurs ; survoler une ligne met le territoire
du joueur en évidence sur la carte) : un petit menu apparaît à côté de la souris,
pas un panneau latéral. Il montre le nom du joueur, sa couleur, son statut avec
le joueur, puis seulement les actions possibles :

| Statut | Action | Qui décide | Résultat |
| --- | --- | --- | --- |
| Neutre | Déclarer la guerre | le joueur seul | guerre |
| Neutre | Proposer un pacte | les deux | pacte si l'autre accepte |
| Pacte | Rompre le pacte | le joueur seul | neutre |
| Guerre | Proposer la paix | les deux | neutre si l'autre accepte |

*Propositions* (idée reprise d'OpenFront). La cible reçoit une notification avec
deux boutons, Accepter et Refuser. Sans réponse après `DIPLOMACY.proposalTurns`
tours, la proposition expire et le statut ne change pas. L'auteur de la
proposition reçoit une notification quand elle est acceptée, refusée ou
expirée. Tant qu'elle attend, la ligne de son menu est grisée avec « En attente
de réponse ».

*Choix provisoires du moteur, à valider* (02-Engine §7) :
- au plus une proposition en attente par paire de joueurs, dans un sens ou dans
  l'autre ; un ordre de proposition pendant qu'une autre attend est ignoré. Chez
  la cible, la ligne est grisée avec « Proposition reçue » ;
- déclarer la guerre supprime la proposition en attente de la paire ; tout
  changement de statut supprime les propositions de la paire ;
- accepter un pacte demande que le statut soit encore neutre, accepter la paix
  qu'il soit encore guerre ;
- les bots n'envoient aucun ordre de diplomatie et ne répondent pas : une
  proposition qui leur est faite expire (IA reportée, §1.1).

Inspiration générale : les jeux Paradox.

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
  **Aluminium** (décision de l'auteur, 25 octobre 2026) : même calcul que le
  fer, avec un seuil plus haut (environ 4 fois moins de cases) et son propre
  bruit. **Une case ne porte qu'une ressource** : quand deux sont présentes,
  celle qui est la plus rare (la plus loin dans la liste du fichier de
  configuration) l'emporte, donc l'aluminium prend la place du fer. Comme le
  fer, une case d'aluminium n'est pas cultivable. Aucune règle n'extrait
  l'aluminium pour l'instant.
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

**Ordre de grandeur** (repère de l'auteur, 25 octobre 2026, pas une règle du
moteur) : le rayon de contrôle d'une ville vaut environ **10 000 m**. Avec 25
cases, une case fait environ 400 m. Sert à choisir les valeurs exprimées en
mètres (la largeur d'un front, elle, se compte en connexions : `05-Fronts.md` §2.2).
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
1 000, la troisième 1 500, la dixième 5 000. L'auteur a choisi l'additif plutôt qu'un coût composé
(`× (1 + x)ⁿ`), qui monte plus vite.

Le coût est en bonshommes, payé par les inactifs d'abord, puis par les boîtes (`08-Population.md` §10).
Provisoire : ce coût sera probablement remplacé par d'autres ressources quand
elles existeront.

**La première ville est gratuite.** Sa fondation donne au joueur
`POPULATION.initial` bonhomme.

**Pendant une guerre** : le rayon d'expansion d'une ville impliquée dans un
front actif ne compte pas pour fonder (règle dans `05-Fronts.md` §8).

L'auteur a annoncé d'autres règles de placement, à décrire (§13).

### 3.4 Capitale

- Chaque joueur a une capitale. Sa première ville est sa capitale.
- Plus tard dans la partie, le joueur peut désigner une autre de ses villes
  comme capitale (ordre). Coût et conditions : non décrits (§13).
- **Toute la production est nationale** : agriculture, pêche,
  extraction et usines (`08-Population.md`) sont calculées à l'échelle de la nation. Le
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
   Non décidé : la diplomatie du §1 ne contient pas cette option.
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
ne le calcule pas. Choix de l'auteur : le chemin ne passe que par des cases de
terre ; il se déplace sur 8 voisins, un pas en diagonale coûtant `√2` fois le
coût de la case d'arrivée. S'il n'existe aucun chemin de terre entre les deux
villes, la route passe par les ports (§3.6), ou n'est pas dessinée. Une case déjà traversée par une
autre route coûte la moitié (valeur choisie avec l'auteur, constante
`ROAD_REUSE_COST_FACTOR` de `client/src/roadpaths.ts`) : deux routes vers une
même ville se superposent au lieu de longer l'une l'autre côte à côte.

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
  par une usine comme les tracteurs ou les bateaux de pêche (`08-Population.md`). Nom choisi
  par l'auteur, plus générique que « commerce » : ils transporteront aussi
  autre chose. Formule d'avant `08-Population.md`, à reprendre quand les routes maritimes seront implémentées :

  ```
  travail      = quantité transportée × longueur du chemin        par tour
  Mécanisation = M_base + (M_max − M_base) × f(x)                 travail par marin
                 x : navires de transport par marin, ramené sur 0…1 par m_max
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
- **Affichage d'une liaison sans chemin de terre** (décision de l'auteur,
  28 octobre 2026) : une route du réseau terrestre (§3.5) dont les deux villes
  ne sont pas reliées par la terre passe par le port de chacune des deux
  villes. Le tracé va de la ville à son port par la terre (A* du §3.5), puis
  d'un port à l'autre par un A* sur les cases d'eau, puis du second port à la
  seconde ville. La partie en mer est en pointillés. Le coût d'une case d'eau
  augmente près de la côte (`SEA_COAST_CLEARANCE` et `SEA_COAST_COST` de
  `client/src/roadpaths.ts`) : le tracé longe les côtes en gardant quelques
  cases de distance quand la mer est assez large. Quand un port disparaît ou
  change de case (nouvelle ville voisine), le tracé est recalculé. Si une des
  deux villes n'a pas de port, ou si l'eau ne relie pas les deux ports (lac),
  (décision de l'auteur, 28 octobre 2026) la route n'est pas dessinée : le
  trajet passe par les villes voisines. Ce tracé ne sert qu'à l'affichage : le
  moteur ne le calcule pas, et ce n'est pas la route maritime de groupe
  décrite ci-dessus.

### 3.7 Taille des villes (affichage seulement)

Une ville n'a pas de taille dans le moteur : rien dans l'état de la partie ne
la représente, et aucune règle n'en dépend. La population est nationale (§4) ;
toutes les villes sont donc dessinées à la même taille.


### 3.8 Fronts terrestres (version 1)

**Les règles des fronts sont dans `05-Fronts.md`, qui fait foi.** Ce
paragraphe n'en est qu'un résumé ; en cas d'écart, `05-Fronts.md` a raison.

- Un **front** est l'ensemble des routes (§3.5) entre un groupe d'un joueur et
  un groupe d'un autre joueur. Il existe en paix (front potentiel, où l'on peut
  déjà placer des divisions) et en guerre (front actif).
- Le joueur crée des **divisions** de types prédéfinis (un stock d'hommes et
  d'équipements ; `config/divisions.ts`), qui existent en dehors des fronts. Il
  les déplace par glisser-déposer entre la réserve nationale et les fronts ;
  sur un front, elles se rangent par niche en première ligne (combat) et en
  seconde ligne (remplacement).
- En guerre, il lance l'**attaque sur tout le front** (percée : version 2 ;
  barrage : hors périmètre). Les rounds de combat font perdre de l'équipement
  et des hommes aux divisions de première ligne et font avancer le front le
  long des routes ; le front arrivé au bout d'une route prend la ville.
  Encerclement à la prise.
- Le front ne change pas la propriété des cases tant que la ville ne change pas
  de main.

## 4. Population, nourriture, production

**Les règles de ces domaines sont dans `08-Population.md`, qui fait foi.** La
population se compte en bonshommes de 1 000 habitants, que le joueur glisse entre
des boîtes d'activités : agriculteurs, pêcheurs, mineurs, usines, casernes. La
nourriture donne la capacité de population, les mineurs donnent le fer, les ouvriers
donnent la limite d'un bien ou d'un type de division. Les règles précédentes sont dans
`00-Game-History.md`, qui ne fait pas foi.

**Reste valable ici** : le rayon d'exploitation, calculé par le client.

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

## 9. Ordres

| Ordre | Paramètres | Valide si | Effet |
| --- | --- | --- | --- |
| Fonder une ville | la case | §3.3 | retire le coût en bonshommes ; crée la ville ; recalcule les zones (§3.2) et les totaux de cases des joueurs touchés |
| Déclarer la guerre | le joueur visé | un autre joueur ; statut neutre (§1) | statut guerre ; supprime la proposition en attente de la paire |
| Proposer un pacte | le joueur visé | un autre joueur ; statut neutre ; aucune proposition en attente pour la paire | crée une proposition (§1) |
| Rompre le pacte | le joueur visé | statut pacte | statut neutre |
| Proposer la paix | le joueur visé | un autre joueur ; statut guerre ; aucune proposition en attente pour la paire | crée une proposition (§1) |
| Répondre à une proposition | l'auteur de la proposition, accepter ou refuser | le joueur est la cible d'une proposition de cet auteur ; pour accepter, le statut est encore celui que la proposition change | accepter : statut pacte (pacte) ou neutre (paix) ; refuser : rien ne change. Dans les deux cas la proposition disparaît |
| Changer de capitale | la ville | la ville appartient au joueur ; coût et conditions à définir (§3.4) | la ville devient la capitale ; recalcule les villes reliées (§3.5, §3.6) |
| Interdire / autoriser une zone maritime | la zone | la zone existe | ajoute ou retire la zone des zones interdites du joueur ; recalcule ses routes maritimes (§3.6) |
| Déplacer des divisions | les divisions ; la réserve nationale, ou un front et une ligne | au joueur, pas en formation ; le joueur est un camp du front | `move_division` (§4, §5.2) |
| Lancer ou arrêter l'attaque sur tout le front | le front | front actif ; le joueur en est un camp | `start_front_attack`, `stop_front_attack` (§5) |

Les noms et formats exacts des ordres sont fixés avec la session du moteur.

## 10. Fichier de configuration

Noms proposés, dans le style des fichiers de `packages/engine/src/config/` (un
fichier par thème, voir 02-Engine §1 ; `config.ts` les ré-exporte). Les fichiers
sont importés à la compilation, jamais lus à l'exécution (CLAUDE.md, règle 2).

**Aucune valeur n'est fixée, et aucune ne doit être devinée.** Elles seront
choisies ensemble plus tard, en essayant des valeurs.

| Nom | Sens |
| --- | --- |
| `CITY.expansionRadius` | rayon d'expansion, en cases ; 50, valeur donnée par l'auteur (25 avant le 23 octobre 2026) |
| `CITY.controlRadius` | rayon de contrôle, en cases : la moitié du rayon d'expansion, calculée (§3.1) ; 25 (10 avant) |
| `CITY.foundingCostPopulation` | coût de base, en population, d'une ville autre que la première (§3.3) ; 500, valeur donnée par l'auteur (100 avant) |
| `CITY.foundingCostIncreasePercent` | pourcentage du coût de base ajouté au coût d'une ville par ville déjà possédée (§3.3) ; 100, valeur donnée par l'auteur |
| `FERTILITY.land` | fertilité (0 à 10) d'une case de terre qui n'est pas une montagne, pour commencer (§2) |
| `TEST_MAP.mountainAltitude` | altitude à partir de laquelle une case est une montagne : fertilité 0, fer plus fréquent (§2) |
| `SHIPPING.*` | mêmes quatre valeurs pour les routes maritimes, avec les navires de transport ; la mécanisation y est un travail (quantité × distance) par marin (§3.6) |
| `RESOURCES` | une section par ressource naturelle, qui regroupe tous ses paramètres : `capacityPerTile` (capacité d'extraction par tour d'une case qui la porte, §7), icône, critères qui modulent son seuil de présence (§2) |
| `DIPLOMACY.proposalTurns` | durée de vie d'une proposition de pacte ou de paix, en tours (§1) ; **à fixer** : 300 en attendant (valeur provisoire, pas donnée par l'auteur) |
| `ROADS.heightCostFactor` | client seulement : augmentation du coût d'une case avec son altitude, pour le tracé A* des routes (§3.5) ; **1**, choisi avec l'auteur : une case coûte `1 + altitude` (de 1 à 32). Constante `ROAD_HEIGHT_COST_FACTOR` de `client/src/roadpaths.ts` |
| `FRONTS`, `DIVISIONS`, `NICHES` | réglages des fronts et des divisions : `config/fronts.ts` et `config/divisions.ts`, décrits dans `05-Fronts.md` §3 et §12 |
| `SEA_ZONES.spacing` | écart entre les points de la grille de départ, en cases ; fixe aussi la taille visée d'une zone (§2.1) |
| `SEA_ZONES.maxLandPercent` | au-delà de ce pourcentage de terre dans son carré, un point de la grille est supprimé (80 pour commencer, valeur donnée par l'auteur) |
| `SEA_ZONES.iterations` | nombre d'itérations zones → barycentre avant la correction (§2.1) ; 50 pour commencer, valeur donnée par l'auteur (le calcul ne tourne qu'une fois par partie) |
| `SEA_ZONES.minBasinArea` | surface minimale d'un bassin, en cases d'eau ; en dessous, il n'a aucune zone maritime (§2.1) |
| `SEA_ZONES.finalIterations` | itérations zones → barycentre après la correction (§2.1) ; 50 pour commencer, valeur donnée par l'auteur |

Dans `config/sea-zones.ts`, `SEA_ZONES.spacing` et `SEA_ZONES.minBasinArea` ont des
valeurs d'essai, choisies pour faire tourner la visualisation. Elles ne sont
pas fixées.

Le générateur de la carte de test a déjà ses réglages, `TEST_MAP` dans
`packages/engine/src/config/map.ts` (02-Engine §2). `SEA_ZONES` en est séparé : il
s'applique à toute carte.

## 11. Affichage

Ces points ne concernent que le client. Ils seront tranchés avec l'auteur.

- **Couleur des joueurs** (décidé par l'auteur, 24 octobre 2026) : une teinte
  légère sur tout le territoire, masquable. La liste des couleurs, leur choix et
  les tons d'unité sont dans `09-Couleurs.md`. La **frontière** d'un joueur (contre
  un autre joueur ou une terre sans propriétaire) est une case de sa couleur un
  peu plus sombre, de chaque côté : entre deux joueurs, cela fait une double
  ligne. La **limite** entre deux villes d'un même joueur est une case de sa
  couleur un peu plus claire.
- **Le territoire s'arrête à la côte.** La zone d'une ville couvre aussi l'eau
  pour les règles (port, pêche : §3.6, §6.4), mais la couleur du joueur et les
  frontières et limites ne sont dessinées que sur la terre.
- **Menu « Carte »** dans la barre d'informations, contre son bord droit (à
  gauche du panneau de debug quand il est ouvert), texte plus gros que les sections (une icône de carte à
  terme), avec des cases à cocher : « Ressources naturelles » (hachures rouge
  foncé sur le fer, décochée en début de partie), « Couleur des joueurs »
  (cochée) et « Fertilité » (hachures vertes épaisses sur les terres
  cultivables, décochée) et « Zones de front » (hachures rouges des fronts actifs,
  cochée ; `05-Fronts.md` §11.1). D'autres vues pourront s'y ajouter (relief, par
  exemple). Les informations de la case survolée sont dans un encadré en bas à
  droite de la vue de la carte, affiché quand la souris est sur une case.
  Pendant le mode « Créer une ville » (§3.3), une liste de vues est affichée
  d'office, même décochées (précision de l'auteur, 24 octobre 2026) : pour
  l'instant les trois premières (pas « Icônes d'usine »). C'est temporaire : à la sortie du mode, la carte revient
  aux vues cochées.
- **Terres cultivables** (fertilité > 0) : un vert léger sur le relief, dans la
  carte de base, toujours affiché (auteur, 24 octobre 2026 ; avant, seulement
  pendant le placement d'une ville).
- **Fer** : un aplat gris clair tirant sur le brun-rouge sur les cases de fer,
  dans la carte de base, toujours affiché (auteur, 24 octobre 2026). Il
  remplace le rouge plein ; le rouge foncé ne sert plus qu'aux hachures de la
  vue « Ressources naturelles ».
- Zone d'exploitation : vert, puis texture de champs (§6.6). Quand la couleur
  des joueurs est affichée, les textures des champs, de la pêche et de la mine
  sont effacées (mélangées à 30 % à la couleur de la case) pour ne pas couvrir
  cette couleur ni trop trancher sur la mer (auteur, 25 octobre 2026). Zone de pêche :
  même calcul en mer, centré sur la ville (§6.6), dessinée par une texture
  propre à la pêche sur l'eau, comme les champs sur la terre. Elle ne doit pas
  ressembler au territoire du joueur. Zone de mine (fer exploité) : même calcul
  sur les cases de fer (§6.6), avec sa propre texture ; une texture provisoire
  d'abord, l'auteur dessine la vraie.
- Port : icône sur la case de côte la plus proche de la ville (§3.6).
- Routes terrestres : chemin A* sur les cases, plus cher en altitude (§3.5).
  Sans chemin de terre : par les deux ports, en pointillés sur la mer (§3.6).
- Routes maritimes : courbe lissée (Bézier) par les zones du chemin (§3.6).
- Fronts : double ligne rouge, zones hachurées, soldats sur les connexions, liste et fenêtre des
  fronts, onglet des forces et pions des divisions, mobilisation forcée, barre jaune de
  l'armement : `05-Fronts.md` §11.
- Diplomatie : petit menu à côté de la souris, au clic sur le territoire d'un
  autre joueur (§1) ; les propositions et les changements de statut arrivent
  par des notifications empilées en bas à gauche de la carte (03-Client §7).
- **Barre d'informations en haut de l'écran** (décrite par l'auteur, 24 octobre
  2026), compacte, sur une ligne. Survoler une section déplie son détail sous la
  barre ; sortir la souris de la section et de son détail le replie (auteur,
  4 novembre 2026, à la place du clic). Le menu « Carte » aussi. Ouvrir un détail ou ce menu désarme « Créer une
  ville » :
  1. **Ressources (flux)** : rien dans la barre, tout dans le détail. Barres
     **vertes**, pour marquer un flux. Fer : barre pleine = capacité, vert =
     production du tour, **gros trait noir** = production requise par les
     usines et casernes ; si
     la production est sous le requis, l'écart est
     **rouge**. Machines (tracteurs, bateaux de pêche, pompes à vapeur) :
     machines existantes sur la limite de leur usine.
- Taille des villes : la même pour toutes (§3.7).
- Panneau de production : `08-Population.md` §11.
- Une icône par ressource, par bien et par type d'armement, nommée dans le
  fichier de configuration. Des icônes provisoires d'abord ; l'auteur dessine
  et importe les vraies, sous le même nom de fichier.
- Les icônes ont un style par famille, pour qu'un coup d'œil dise ce qu'on
  regarde : un style pour les machines (tracteur, bateau de pêche, pompe à vapeur),
  un autre pour l'armement, etc. Styles à dessiner par l'auteur.
- Population : un personnage en pixel art de 16 × 16, dessiné par l'auteur,
  une variante par rôle, dans `client/public/icons/population/` :
  `pop-default` (sans attribut : l'onglet Population de la barre),
  `pop-worker` (ouvriers d'usine), `pop-miner` (mineurs), `pop-farmer`
  (fermiers), `pop-fisherman` (pêcheurs), `pop-inactive` (inactifs) ;
  `pop-sailor` (marins) et `pop-soldier` (soldats) existent, sans rôle dans le
  jeu pour l'instant.
- Infobulle sur chaque nombre affiché : le nom de chaque valeur, un mot
  chacune, dans l'ordre et avec les séparateurs de l'affichage (« Actuelle /
  nourrie / potentielle »).

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
- Le réseau de routes terrestres se déduit des villes (§3.5) : il peut être
  gardé dans l'état ou recalculé, le résultat est le même. Il est recalculé
  quand une ville est fondée ou disparaît.
- Fronts, divisions, attaques : état et hash décrits dans `05-Fronts.md` §13.
- Le réseau maritime (§3.6) est calculé une fois, à la génération de la
  carte, après les zones maritimes, et ne change pas. Comme les zones, il est
  recalculé par chaque client à partir de la graine.
- Les routes maritimes demandent un plus court chemin sur le réseau maritime,
  en entiers (§13 : longueur d'une liaison).

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

**Agriculture et pêche**
- Fer et aluminium : choix validés par l'auteur, implémentés (02-Engine §2,
  `npm run viz:resources`). Bruit du générateur de la carte, avec sa propre graine ; seuil
  qui baisse avec l'altitude, plus une baisse supplémentaire sur les
  montagnes (altitude ≥ un seuil). Réglages : valeurs d'essai, à choisir sur
  la visualisation. Le rapport fer / aluminium (environ 4 sur la graine
  12345) dépend de la surface de montagne de la carte, où l'aluminium se
  concentre : 6 sur la graine 7, 9 sur la graine 99.

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

**Diplomatie (§1)**
- Délai entre la rupture d'un pacte et la possibilité de déclarer la guerre.
  Aucun pour l'instant : la guerre peut être déclarée le tour suivant la
  rupture (choix provisoire du moteur).
- Durée d'un pacte. Illimitée pour l'instant : il dure jusqu'à ce qu'un joueur
  le rompe.
- `DIPLOMACY.proposalTurns` : valeur à fixer (§10).
- Alliance, droit de passage (§3.5), garantie d'indépendance, commerce : hors
  de cette version.
- Effet du statut sur le combat : avec les armées. Effet de la déclaration de
  guerre sur les fronts : `05-Fronts.md` §2.3.

**Fronts** : points ouverts et choix provisoires dans `05-Fronts.md` §15.

**Commerce** : la demande à l'export (§7) et les machines échangées (§5) en
dépendent ; non décrit.

**Modules non décrits** : voir le tableau du §1.
