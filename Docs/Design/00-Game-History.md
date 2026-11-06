# 00 — Historique des règles remplacées

**Ce fichier ne fait jamais foi** : ne jamais implémenter à partir de lui. Il garde les
règles de population, de nourriture, d'extraction, de lignes de production et d'armement
d'avant `08-Population.md` (5 novembre 2026). La version complète est au tag `v0.2`, à
l'exception des derniers ajouts de `main`.

## 4. La population

- La population est comptée par joueur (l'État), pas par ville.
- Un joueur commence avec une population de 0. Avant sa première ville, elle
  croît déjà grâce à la nourriture minimale (§6.5) : des nomades. Sans ville,
  elle n'a pas de terre et reste inactive.
- La fondation de sa première ville lui donne en plus `POPULATION.initial`
  personnes, une valeur du fichier de configuration.
- À chaque tour, la population totale est de nouveau répartie, dans cet
  ordre (décision de l'auteur, 4 novembre 2026 : plus de remplissage ligne par
  ligne, qui s'arrêtait à la première ligne manquant de fer ou d'ouvriers, et
  que l'auteur trouvait illisible ; mineurs avant les fermiers depuis le
  4 novembre 2026, pour qu'une petite population extraie quand même le fer du
  premier tracteur ; ouvriers des biens avant les fermiers le même jour, pour
  qu'ils travaillent dans l'usine de bateaux) :
  1. les **mineurs** d'abord : ceux qu'il faut pour extraire le fer demandé
     par toutes les lignes qui tournent (§8), plafonné par la capacité des
     cases de fer (§7). Leur nombre suit donc toujours les lignes actives.
     S'il n'y a pas assez de monde, autant de mineurs que possible, et le fer
     extrait baisse en proportion ;
  2. les **ouvriers des lignes de biens** (tracteurs, bateaux de pêche, pompes,
     §8) : les lignes de biens demandent leurs ouvriers et en obtiennent la
     part que la population permet ; leur productivité est le plus petit des
     deux ratios, fer et ouvriers (§8) ;
  3. les **fermiers** et les **pêcheurs** sur ce qui reste, dans la proportion
     choisie par le joueur (un réglage ; l'interface sera définie par
     l'auteur). Ils prennent ce que leurs terres et leurs cases d'eau peuvent
     employer (§6.2, §6.4) ;
  4. **report** (décision de l'auteur, 23 octobre 2026) : si un des deux côtés
     a plus de travailleurs que sa surface n'en demande, le surplus passe à
     l'autre côté, jusqu'à ce que celui-ci soit plein. Le réglage ne joue donc
     que quand la population ne suffit pas à travailler à la fois tous les
     champs et toute la mer ; sinon, les deux sont remplis à 100 % ;
  5. les **ouvriers de l'armement** sur ce qui reste après les fermiers : les
     lignes d'armement demandent leurs ouvriers (§8.1) et en obtiennent la
     part que la population permet (malus de production, §8) ;
  6. ceux qui n'ont toujours pas d'emploi forment la **population inactive** ;
  7. les **hommes des divisions** ne travaillent pas : la répartition se fait
     sur la population moins ces hommes, et moins les **blessés** (§4.2). La
     création d'une division et le renfort prennent leurs hommes parmi les
     inactifs ; en mobilisation forcée, le renfort passe avant les emplois
     (règles dans `05-Fronts.md` §3.5, §4.3). Les blessés ne sont jamais pris,
     mobilisation forcée comprise.

  Avec une petite population, les lignes ont leur fer et les lignes de biens
  leurs ouvriers ; ce sont alors les champs qui manquent de bras, puis
  l'armement (productivité réduite, §8). Le début de partie sert l'expansion
  (machines, nourriture) avant l'armement. La demande de tracteurs et
  de bateaux est calculée sur la population qui irait aux champs si toutes
  les lignes actives tournaient (§8.2).

  ```
  actifs   = population − soldats − blessés
  mineurs  = min(mineurs requis par le fer demandé, actifs)
  ouvriers_biens = ouvriers demandés par les biens × productivité des biens (§8)
  F, P              = fermiers et pêcheurs disponibles, selon le réglage, sur actifs − mineurs − ouvriers_biens
  F_requis, P_requis = travailleurs requis (§6.2, §6.4 ; mécanisation calculée
                       avec F et P, une fois)
  fermiers = min(F_requis, F + max(0, P − P_requis))
  pêcheurs = min(P_requis, P + max(0, F − F_requis))
  reste    = actifs − mineurs − ouvriers_biens − fermiers − pêcheurs
  ouvriers_armement = ouvriers demandés par l'armement × productivité de l'armement (§8)    (au plus reste)
  inactifs = reste − ouvriers_armement
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

### 4.2 Les blessés

La croissance (§4.1) et les pertes en combat n'ont pas la même échelle de temps :
si les hommes perdus disparaissaient de la population, les naissances les
remplaceraient aussitôt. Les pertes en combat deviennent donc une part de la
population, les **blessés** (`Player.hurt`), qui coûte du temps sans ralentir
l'économie.

**Cycle de vie** : un habitant est d'abord inactif ; la création d'une division
ou le renfort en fait un soldat (§4) ; s'il est tué au combat, il devient blessé.
Un blessé ne revient jamais à un autre état.

- Les blessés sont **comptés dans `population`** : ils mangent et occupent des
  places de `population_max` (§4.1), donc aucune naissance ne les remplace tant
  qu'ils sont là. Ils ne travaillent pas, ne sont pas recrutés (mobilisation
  forcée comprise) et ne paient pas la fondation d'une ville (§3.3). La
  répartition du §4 se fait sur `population − soldats − blessés`.
- **Entrée** : les hommes perdus par une division au combat, en percée, en fuite
  ou par encerclement (05-Fronts §6, §7, §10). Les hommes qui quittent une
  division autrement (suppression, excédent rendu, §3.2 de 05-Fronts) restent des
  inactifs. L'équipement perdu disparaît.
- **Guérison** : une fois toutes les deux secondes (`POPULATION.hurtEveryTurns` tours, 20 ; auteur, 5 novembre 2026),
  `max(POPULATION.hurtMinimum, floor(population / POPULATION.hurtDivisor))`
  blessés disparaissent (au plus tous). `hurtDivisor` est un dénominateur entier de
  la configuration, jamais une fraction ; `hurtMinimum` est un nombre d'hommes par
  guérison. Avec `hurtDivisor` = 5 000, 10 % de la population guérit en 1 000 s
  (auteur, 3 novembre 2026). Le plancher `hurtMinimum` évite qu'une population presque entièrement
  blessée, donc sans main-d'œuvre pour produire de la nourriture, ne puisse plus
  repartir : quand la population est petite, la deuxième règle l'emporte, et quand
  elle est grande, c'est la première. Ils quittent aussi la population ; la
  croissance (§4.1) les remplace ensuite.
- **Famine** : quand la population baisse de `L` (nourriture restante négative),
  les blessés baissent avec elle. Les soldats ne sont jamais retirés : toute la
  perte tombe sur les non-soldats, donc sur les non-soldats non blessés et les
  blessés, en proportion. Les blessés retirés valent
  `ceil(blessés × L / (population − soldats))`, au plus tous. L'arrondi vers le
  haut est voulu : les blessés peuvent baisser plus vite que la population.
- **Plafond** : `blessés ≤ max(0, population − soldats)`, vérifié à la fin de
  chaque étape d'économie. Seules les pertes au combat font monter les blessés.
- **Affichage** : le total de population affiché ne compte pas les blessés ;
  `03-Client.md`.

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
| Biens | fabriqués par les usines à partir des ressources (§8) | machines : tracteurs, bateaux de pêche, pompes à vapeur ; navires de transport (§3.6) |

- Nourriture = blé + poisson. Elle ne sert qu'à fixer la population maximale
  (§4.1).
- Les machines augmentent la mécanisation d'une activité : tracteurs pour
  l'agriculture, bateaux pour la pêche, pompes à vapeur pour l'extraction.
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
fermiers_plein  = surface_max / M_max         fermiers qu'il faut à pleine mécanisation
référence       = min(fermiers_disponibles, fermiers_plein)
x               = min(tracteurs / référence, m_max) / m_max
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
- **Les fermiers disponibles sont plafonnés à `fermiers_plein`** (décision de
  l'auteur, 24 octobre 2026). Les tracteurs changent la surface que cultive
  chaque fermier ; le nombre de tracteurs d'une mécanisation totale est celui
  qu'il faut pour cultiver toute la surface à `M_max` : `référence × m_max`.
  Les fermiers inactifs n'en demandent pas. Exemple : 793 cases, 1 030 fermiers
  disponibles → `fermiers_plein` = 529, 53 tracteurs pour la mécanisation
  totale (et non 103). Quand la population manque (disponibles sous
  `fermiers_plein`), la référence est les disponibles : 300 fermiers → 30
  tracteurs.
  Historique : le plafond était d'abord `surface_max / M_base` (les fermiers
  qu'il faudrait sans tracteur), qui comptait encore dans le partage des
  disponibles qui deviennent inactifs à pleine mécanisation ; avant cela, il n'y
  avait pas de plafond, et une population qui grandit faisait baisser l'effet
  des mêmes tracteurs. Revenir à l'un ou l'autre réintroduit ces écarts.
- **Les travailleurs reçus par le report (§4) comptent parmi les
  disponibles** : à 0 % de fermiers, les pêcheurs en trop qui vont aux champs
  utilisent les tracteurs (constat de l'auteur, 24 octobre 2026 : sans cela,
  ils cultivaient sans tracteur).
- Même règle pour la pêche (bateaux, pêcheurs, cases d'eau, §6.4 ; le
  rendement de l'eau utilise la même référence). Pour les mines, la surface
  est le nombre de cases **exploitées** pour la demande, pas tout le gisement
  (§7), et la référence est les mineurs qui exploitent ces cases à pleine
  mécanisation (les mineurs sont embauchés à la demande : pas de disponibles).
  Les trois machines suivent la règle de `fermiers_plein` (décision de
  l'auteur, 24 octobre 2026).
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
ville entièrement cultivée en terre fertile produit 9 805 (1 961 cases de
fertilité 5 dans un disque de rayon de contrôle 25 ; c'était 317 cases et
1 585 avec l'ancien rayon de 10).

Le minimum n'est pas ajouté à la production : `max`, pas une somme. Une seule
ville cultivée ajoute donc peu au minimum. Voulu par l'auteur : un joueur aura
rarement une seule ville, et avec une seule ville il mettra sa population dans
les usines plutôt que dans les champs.

## 7. Extraction des ressources naturelles

Pour chaque ressource naturelle r autre que le blé et le poisson (le fer, et
celles de la liste). **Même fonctionnement que l'agriculture et la pêche**
(décision de l'auteur, 24 octobre 2026) : des cases (le gisement), des
travailleurs (les mineurs) qui en exploitent une partie, et des machines (les
pompes à vapeur) qui réduisent le nombre de mineurs requis. Le moteur n'a besoin
que du nombre de cases du gisement couvertes par les villes du joueur : c'est
sa capacité maximale.

```
gisement[r]     = nombre de cases portant r dans les zones de toutes les
                  villes du joueur
rendement[r]    = RESOURCES[r].capacityPerTile     ressource par case et par tour
capacité_max[r] = gisement[r] × rendement[r]
demande[r]      = consommation de r par les lignes qui tournent (§8)
                + quantité de r demandée à l'export par d'autres joueurs
extraction[r]   = min(demande[r], capacité_max[r]), réduite en proportion
                  si les mineurs manquent (§4)
cases_exploitées[r] = ceil(extraction[r] / rendement[r])
mineurs[r]      = ceil(cases_exploitées[r] × 1000 / Mécanisation_minière)
```

Pour le fer aujourd'hui : chaque ligne qui tourne demande le fer par ligne de
son bien ou type d'armement (§8).

**Une case de fer n'est pas cultivable** (décision de l'auteur) : sa fertilité
vaut 0 (§2).

- **On n'extrait que ce qui est demandé.** Une ressource sans demande n'occupe
  personne.
- **Extraire ne vide pas la case** : c'est une capacité par tour, un flux.
- `Mécanisation_minière` suit la courbe du §6.3, avec les **pompes à vapeur**
  comme machines et ses propres valeurs de configuration.
- **Les pompes servent à tous les minerais de la même façon** (décision de
  l'auteur, 25 octobre 2026) : fer, aluminium et les suivants. Elles sont
  réparties entre les minerais proportionnellement à leurs mineurs : avec
  100 mineurs sur le fer et 50 sur l'aluminium, 2/3 des pompes vont au fer.
  Choix optimal parce que les premières pompes donnent un plus grand bonus que
  les suivantes (courbe du §6.3), et que tous les mineurs viennent de la même
  population. **Pas encore dans le moteur** : seul le fer est extrait, il
  reçoit donc toutes les pompes ; la répartition reste à écrire avec
  l'extraction de l'aluminium.
- Les mineurs sont pris avant tous les autres (ouvriers des biens, fermiers,
  pêcheurs, ouvriers de l'armement), pour le fer de toutes les lignes qui
  tournent à la fois (§4).
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
- **Une seule usine par type et par joueur** (décision de l'auteur,
  1er novembre 2026) : plusieurs usines du même type ne servent à rien, une
  seule ligne par bien est plus efficace (spécialisation, ci-dessous). Plus tard,
  une usine aura un nombre maximal de lignes ; non implémenté.
- **Supprimer une usine** (décision de l'auteur, 1er novembre 2026) : ordre du
  joueur (§9), par une petite croix en haut à droite de la section de l'usine
  dans le panneau de production (§8.1), après une confirmation. L'usine disparaît avec toutes ses lignes
  et sa progression de déblocage.
- Le logo d'une usine est l'icône du bien qui a le plus de lignes construites
  dans l'usine (actives ou non ; à égalité, le premier de l'arbre ; sans ligne,
  la racine de l'arbre). Il est affiché à côté de la ville où elle est
  construite, sur un fond gris clair de 18 × 18 pixels d'écran cerclé de noir
  (20 × 20 au total ; remplacé par un carré gris de 5 × 5 à bordure sombre quand il
  dépasserait le tiers du rayon de contrôle à l'écran), et dans
  l'en-tête de sa section du panneau de production.
- **Niveau = ligne de production.** Un niveau d'usine est une ligne de
  production élémentaire d'un bien. Exemple : 3 lignes de tracteurs et 1 ligne
  de pompes à vapeur dans la même usine font une usine de niveau 4.
- Chaque ligne emploie un nombre fixe d'ouvriers, propre à son bien
  (`GOODS[b].workersPerLine`, `ARMAMENT.types[a].workersPerLine`), réglé comme
  sa production et sa consommation de fer. Le panneau de production indique,
  pour chaque groupe de lignes, les ouvriers et le fer qu'il utilise.
- Chaque ligne produit, par tour, une quantité propre au bien
  (`GOODS[b].productionPerLine`), et consomme la ressource indiquée pour ce
  bien. **Fer par ligne qui tourne et par tour** (`ironPerLine`, décisions de
  l'auteur du 24 octobre, du 3 et du 4 novembre 2026) : fusil et mitrailleuse 8,
  antichar et antiaérien 20, artillerie 50, tankette 200, char rapide 400,
  char d'infanterie et char moyen 800, artillerie automotrice 800, antichar
  blindé 600, antiaérien automoteur 400 ; tracteur 50, bateau de pêche 60,
  pompe à vapeur 20. Une case de fer en extrait 10 par tour
  (`RESOURCES.iron.capacityPerTile`, §7).
- **Déblocage** : plus une usine produit, plus elle débloque de productions
  alternatives, selon l'arbre de son type d'usine (§8.4). Exemples donnés par
  l'auteur : une usine de pompes à vapeur qui débloque les tracteurs, puis les
  chars (§8.4).
- **Spécialisation** (décision de l'auteur, 24 octobre 2026) : le coût en
  ouvriers d'une ligne baisse avec son **rang** dans le groupe (même bien ou
  même type d'armement, dans la même usine). Ce n'est pas la ligne qui en
  rend d'autres moins chères : chaque nouvelle ligne est moins chère que la
  précédente, les lignes déjà là gardent leur coût. But : un joueur spécialisé
  produit plus efficacement et échange pour obtenir le reste.

  ```
  coût(k) = W × ( f + (1 − f) × a / (a + d × (k − 1)) )      a = 1 − d − f
  ```

  `W` = `workersPerLine` du bien, `k` = rang de la ligne (1 pour la première),
  `d` = `FACTORY.specialization.decayPercent` (5 %), `f` =
  `FACTORY.specialization.floorPercent` (10 %). La 1re ligne coûte `W`, la 2e
  `W × (1 − d)` (190 pour `W` = 200), et le coût tend vers `W × f` (20)
  sans jamais l'atteindre : hyperbolique avec plancher, continue, sans seuil.
  Le total des ouvriers pour `n` lignes croît donc de plus en plus lentement
  mais n'est jamais borné, et aucune ligne n'est gratuite. Arrondi vers le
  bas à l'entier. Les lignes qui tournent sont toujours les premières rangs du
  groupe, donc les ouvriers demandés d'un groupe sont la somme des coûts des
  rangs 1 à `running`.
- Pas de stock : la production d'une usine à un tour est le flux disponible à
  ce tour.

- **Malus de production** (décision de l'auteur, 4 novembre 2026). Toutes les
  lignes actives tournent, sans ordre de remplissage, sauf les lignes de biens
  en trop (lignes utiles, §8.2). Elles demandent leurs ouvriers et leur fer ;
  si la population ou le fer manquent, elles tournent moins vite. **Deux passes**
  (décision de l'auteur, 4 novembre 2026) : les **lignes de biens** (tracteurs,
  bateaux, pompes) passent avant l'**armement** dans le partage du fer extrait et des
  ouvriers disponibles. Les mineurs sont servis avant les deux passes ; la
  passe des biens prend ses ouvriers avant les fermiers, celle de l'armement
  après (§4). Sur une échelle entière `RATIO_SCALE` = 10 000 (100 %) :

  ```
  passe 1, biens (lignes utiles seulement, à 100 % de productivité, §8.2) :
    ratio_fer_b      = min(1, fer extrait / fer demandé par les biens)
    ratio_ouvriers_b = min(1, ouvriers disponibles / ouvriers demandés par les biens)
    r_biens          = min(ratio_fer_b, ratio_ouvriers_b)     le plus grand des deux malus
  passe 2, armement, sur ce que les biens ont laissé (fer extrait − fer consommé par les
  biens ; ouvriers disponibles − ouvriers employés par les biens) :
    ratio_fer_a, ratio_ouvriers_a, r_armement : calculés de la même façon
  ```

  Les biens prennent donc ce qu'il leur faut, ou tout s'il n'y en a pas assez, avec un
  malus égal entre eux ; l'armement subit seul le manque restant. Pas de boucle : les
  machines utilisées pendant le tour sont les `goodsEffective` du tour précédent (§12).
  Les six ratios sont des entiers sur `RATIO_SCALE`, hachés.

  Les ouvriers demandés suivent le coût par rang (`workersForRank`, ci-dessus).
  Chaque ligne tourne à `r` de sa catégorie : production × r, fer consommé = demandé × r,
  ouvriers employés = demandés × r (**provisoire** : les ouvriers au-delà de ce
  que la productivité emploie restent inactifs, même si le fer est la cause du
  malus). Le malus du fer s'affiche sur l'onglet des usines et dans l'onglet
  « Ressources » (`03-Client.md`) ; celui des ouvriers seulement en rouge sur
  l'onglet des usines.

  **Calcul en entiers** (règle 2) : `r` est un entier sur 0…10 000 ; la fraction
  de production d'un tour est gardée dans un reste, par joueur et par produit,
  de la même échelle, inclus dans le hash : `Player.goodsRemainder` pour les
  biens (un flux, à chaque tour), `Player.armamentProductionRemainder` pour
  l'armement (en soixantièmes d'exemplaire × 10 000, versé chaque seconde,
  §8.3), `Factory.progressRemainder` pour le déblocage (§8.2).

```
production[b]     = somme, sur les lignes qui tournent de b, de GOODS[b].productionPerLine × r
consommation[r]   = somme, sur les biens b qui utilisent r, de production[b] × ratio de r pour b
```

Pour le fer, le ratio est fixé par ligne et non par unité produite :

```
demande[fer]      = somme, sur les lignes qui tournent (biens et armement), de ironPerLine
consommation[fer] = demande[fer] × r
```

`demande[r]` est la part « usines » de la demande d'extraction (§7).

### 8.1 Activer et désactiver les lignes

- Chaque ligne peut être activée ou désactivée par le joueur. Seules les
  lignes actives demandent des ouvriers (§4) et du fer, et l'extraction suit les
  lignes qui tournent.
- C'est ainsi que le joueur répartit sa population : en choisissant les lignes
  qui tournent.
- Les lignes identiques d'une usine (même bien) se règlent ensemble : un
  nombre de lignes actives, par exemple avec un curseur.
- **Panneau de production** (décrit par l'auteur, 24 octobre 2026), à droite
  de la carte, ouvert par défaut (auteur, 4 novembre 2026) ; le bouton
  « Production » (§1) le ferme ou le rouvre :
  - une section par ville qui a une usine : le type d'usine en gras (auteur,
    4 novembre 2026 : plus le nom de la ville ni le niveau), et en haut à droite une croix discrète qui
    supprime l'usine (§8) ;
  - dans la section, une sous-section par bien produit : les lignes de ce bien,
    leur nombre de lignes actives (curseur) ;
  - les biens encore verrouillés de l'arbre de l'usine (§8.4) apparaissent
    aussi, avec la progression de leur déblocage : **symbole du parent,
    progression en chiffres, jauge qui se remplit, cadenas, symbole du bien**. Le joueur voit ainsi quelle ligne
    débloque quel bien. Les symboles n'existent pas encore : un texte
    provisoire les remplace ;
  - **une ligne de panneau par bien de l'arbre de l'usine** (précision de
    l'auteur, 24 octobre 2026), dans l'un de trois états : en production
    (curseur des lignes actives avec un trait noir aux lignes utiles, §8.2,
    bouton **+** pour une ligne à la main, et
    dessous, pour une machine, une jauge de croissance qui se remplit jusqu'à
    la ligne suivante, §8.2), débloqué sans
    ligne (bouton **+** qui crée la première ligne), ou verrouillé (symbole du
    parent, progression, jauge, cadenas, symbole du bien). Il n'y a pas de bouton « Ajouter une
    ligne » séparé ni de liste de biens à choisir (§8.2).
- **Priorité** (**à supprimer plus tard**, décision de l'auteur, 4 novembre
  2026) : le joueur fait glisser **des villes entières** (une section monte ou
  descend avec toutes ses lignes), et **des lignes au sein d'une ville**.
  Les ordres `set_city_priority` et `set_line_priority` restent valides, mais
  la priorité ne sert plus à rien : il n'y a plus de remplissage (§4, §8). Elle
  ne départage que les lignes de biens en trop (§8.2). Inspiration : le panneau
  de production de Hearts of Iron.
- Une ligne qui ne peut pas être entièrement alimentée tourne à la productivité
  commune (malus, §8) ; le joueur le voit sur l'onglet des usines.

### 8.2 Créer une ligne

- Le joueur crée les lignes (ordre).
- **Nombre maximal de lignes** par joueur : fonction de sa population, définie
  dans le fichier de configuration.
- **Condition (déblocage)** : une ligne d'un bien qui a un parent dans l'arbre
  de l'usine (§8.4) ne peut être créée que si une ligne de ce parent
  a produit au moins `FACTORY.unlockTurns` tours-lignes (500 pour commencer,
  valeur donnée par l'auteur). La production de base de l'usine (la racine de
  l'arbre, par exemple les fusils) n'a pas de condition.
- **Progression** (décision de l'auteur, 24 octobre 2026) : les tours se
  cumulent. **C'est la production qui fait avancer le déblocage** : quand la
  ligne du parent ne produit pas (désactivée), la progression s'arrête mais n'est pas perdue ; elle
  reprend quand la ligne produit de nouveau. Lecture retenue : la progression
  est propre à l'usine.
- **Vitesse du déblocage** (décision de l'auteur, 24 octobre 2026) :
  proportionnelle à la production du parent. Chaque tour, la progression gagne
  le nombre de lignes du parent qui tournent dans l'usine, multiplié par la
  productivité `r` (§8 ; **provisoire**, avec un reste dans
  `Factory.progressRemainder`) : une ligne débloque en 500 tours à 100 %,
  vingt lignes en 25. Le panneau la montre par la flèche entre les deux
  symboles (§8.1).
- **Coût** : pas encore décidé. Piste de l'auteur : sacrifier un peu de
  population.

**Croissance automatique des lignes** (décision de l'auteur, 24 octobre 2026).

- Un groupe de lignes de **machine** (tracteurs, bateaux de pêche, pompes
  miniers) **grandit tout seul** : après `FACTORY.growthTurns` tours-lignes,
  il gagne une ligne, puis la jauge repart pour la ligne suivante (le
  dépassement éventuel est gardé).
- **Même principe que le déblocage : proportionnel à la production, pas au
  temps** (décision de l'auteur, 24 octobre 2026). Chaque tour où toutes les
  lignes du groupe sont actives et tournent, la jauge gagne le nombre de lignes
  du groupe, **sans regarder le malus** (**provisoire**) :
  passer de 1 à 2 lignes prend 500 tours, de 10 à 11 lignes 50 tours. Une
  jauge sous la ligne du panneau se remplit ainsi, comme la flèche de
  déblocage.
- **Arrêt à la demande** : un groupe cesse de grandir quand la production du
  joueur pour ce bien couvre sa demande. Pour une machine, la demande est le
  nombre de machines d'une mécanisation totale (§6.2 : référence × `m_max`),
  c'est-à-dire quand la jauge de cette machine est pleine dans la barre
  « Ressources » (§11).
- **Le bouton + reste** sur chaque bien en production (précision de l'auteur) :
  le joueur peut ajouter une ligne à la main, y compris au-delà de la demande.
  Il est bloqué tant que des lignes existantes de ce bien sont inactives (auteur,
  4 novembre 2026) : un clic affiche « Ligne inactive. Impossible d'agrandir. »
  en rouge. Le blocage est dans l'interface seulement, le moteur accepte l'ordre.
  Il est gardé pour le développement, où il est pratique. **Problème connu**
  (noté par l'auteur, 24 octobre 2026) : tel quel, le joueur n'a aucune raison
  d'attendre la croissance automatique, trop lente à côté d'un clic. Pour la
  version finale : soit le bouton disparaît, soit ajouter une ligne a un
  **coût**, qui donne une raison d'attendre. Le jeu n'a pas d'argent (choix de
  conception) : ce qui serait dépensé reste à trouver (§13).
- **La production d'un bien ne dépasse jamais sa demande** (décision de
  l'auteur, 24 octobre 2026). Un flux de machines au-delà de la demande ne
  sert à rien. Une ligne de tracteurs, de bateaux ou de pompes **ne tourne pas**
  quand la production des lignes déjà retenues pour ce bien (toutes usines,
  dans l'ordre des usines) couvre la demande, **calculée à 100 % de
  productivité** (décision de l'auteur, 4 novembre 2026) : s'il faut 100
  tracteurs et qu'une ligne peut en produire 100, une seule ligne tourne, même
  si le malus la fait produire 50. Les lignes au-delà ne demandent ni ouvriers
  ni fer. Même si le joueur a mis le curseur plus haut, la production s'arrête
  à cette limite ; quand la demande baisse, la production baisse d'elle-même.
  Exemple de l'auteur : ne pas produire des milliers de bateaux de pêche quand
  les pêcheurs sont partis dans les usines.
- **Demande des tracteurs et des bateaux** (décision de l'auteur, 5 novembre
  2026) : machines d'une mécanisation totale (§6.2), avec le report entre
  fermiers et pêcheurs (§4), pour les personnes qui iraient aux champs et à la
  pêche **si toutes les lignes actives tournaient à 100 %** : population −
  soldats − blessés − mineurs du fer de toutes les lignes actives (plafonné par
  les cases, §7) − ouvriers de toutes les lignes de biens actives (§8.1).
  Mineurs et ouvriers des biens étant servis avant les champs (§4), compter
  toute la population faisait produire des tracteurs pour des fermiers partis
  à l'usine fabriquer ces tracteurs. Ce nombre ne dépend que du réglage des
  lignes, pas des lignes qui tournent : pas de boucle dans le tour, pas
  d'alternance d'un tour à l'autre (un calcul sur les fermiers du tour
  précédent en aurait réintroduit une). Il sous-estime les fermiers quand des
  lignes de biens actives ne tournent pas ; avec de la population inactive,
  la demande atteint quand même la mécanisation totale. Les pompes gardent la
  demande du tour précédent : elle ne dépend pas de la population.
- Sur le curseur des lignes actives (§8.1), un **trait noir** (rouge jusqu'au
  1er novembre 2026) marque le
  nombre de lignes utiles de ce groupe : tout à droite si toutes ses lignes ne
  suffisent pas à la demande, au milieu sinon. Ne concerne pas l'armement.
- **Curseur et barre bleue sont deux informations distinctes** (précision de
  l'auteur, 24 octobre 2026) : le **curseur** reste là où le joueur l'a placé,
  c'est le maximum de lignes qu'il autorise ; la **barre bleue** sous le
  curseur montre les lignes en service, ce maximum ramené au pas juste
  au-dessus du trait noir (lignes utiles arrondies vers le haut). La vraie
  production est celle de la barre bleue. Quand la demande remonte, la barre
  remonte jusqu'au curseur.
- **Armement : pas de croissance automatique pour l'instant.** Une mécanique
  semblable n'aura de sens qu'avec les armées, qui feront la demande
  d'armement (§13, à traiter plus tard). Aujourd'hui, une ligne d'armement ne
  grandit que par le bouton +.
- **Avec le commerce** (non décrit) : la production maximale d'une usine sera
  la consommation du joueur **plus ce qu'il exporte** en flux.
- Choix provisoires du moteur (02-Engine §7), à valider : un tour compte quand
  **toutes** les lignes du groupe sont actives et tournent (quel que soit le
  malus) ; la capacité qui se compare à la
  demande compte toutes les lignes du joueur pour ce bien, toutes usines
  confondues ; un groupe ne perd pas de ligne si la demande baisse.

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
  2026) : une ligne active qui tourne produit, et ce qu'elle produit entre dans
  la réserve. Il n'y a pas de ligne suspendue.
- **Cadence** (auteur, 3 et 5 novembre 2026) : la production d'armement est
  comptée par heure (`ARMAMENT[a].productionPerHour`, entier) et versée une fois
  par seconde (`ARMAMENT.everyTurns` tours). Chaque seconde, chaque type ajoute
  `lignes qui tournent × productionPerHour × r_armement` à un reste
  (`Player.armamentProductionRemainder`, en 3 600es d'exemplaire ×
  `RATIO_SCALE`) ; les exemplaires entiers (`floor(reste / (3600 × RATIO_SCALE))`)
  passent dans la réserve, le reste attend la seconde suivante. La
  répartition des travailleurs et le fer sont calculés à chaque tour. Valeurs par
  heure : fusil 9 504, mitrailleuse 1 728, artillerie 360, antichar et antiaérien
  2 160, tankette, char rapide et artillerie automotrice 144, char d'infanterie
  et char moyen 72, antichar blindé et antiaérien automoteur 216. Le 5 novembre
  2026, toute la production d'armement a été divisée par 20 (l'unité est passée
  de la minute à l'heure pour garder des entiers) et le stock cible multiplié
  par 20 ; fer et ouvriers par ligne inchangés. Puis la production a été
  multipliée par 2, `maxStockSeconds` inchangé : à l'équilibre, le même nombre
  de lignes équipe deux fois plus de divisions. Puis encore × 2, avec
  `maxStockSeconds` ÷ 4 (800 → 200) : le stock cible d'une ligne est divisé
  par 2, et atteint quatre fois plus vite. Le 4 novembre
  2026, l'auteur a voulu quatre fois plus de lignes par unité pour l'artillerie
  tractée et deux fois plus pour les chars et l'appui-feu sur chenilles, au même
  fer par exemplaire : production et fer par ligne divisés d'autant ; puis tout
  le fer consommé multiplié par 2 ; puis, le même jour, production et fer de
  l'appui-feu à pied (artillerie, antichar, antiaérien) divisés par 2, ouvriers
  inchangés. Les biens (§8) restent un flux produit à chaque tour.
- **Stock cible** : `ARMAMENT.maxStockSeconds` secondes de production (une seule
  valeur pour tous les types, 200).

  ```
  stock_cible[a] = floor(nombre de lignes de a × ARMAMENT[a].productionPerHour
                         × ARMAMENT.maxStockSeconds / 3600)
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
  de son arbre. Chaque type a un **nom propre**, différent de celui de son bien
  principal (décision de l'auteur, 25 octobre 2026) : « manufacture d'armes »,
  « chantier naval », « usine mécanique ». C'est ce nom qu'affichent le menu
  « Inaugurer une usine » et l'en-tête de la section du panneau de production
  (l'icône reste celle du bien le plus construit) :

  | Type d'usine | Racine | Branches |
  | --- | --- | --- |
  | Manufacture d'armes | fusils | décrites ci-dessous |
  | Chantier naval | bateaux de pêche | plus tard ; exemple de l'auteur : navires de transport (§3.6), puis navires de guerre |
  | Usine mécanique | pompes à vapeur | tracteurs, puis chenillettes (premier char, débloqué par les tracteurs ; 25 octobre 2026) ; puis, à partir de la chenillette, le char d'infanterie et le char de cavalerie, et à partir de celui-ci le char moyen (1er novembre 2026) |

  Pour l'instant : l'arbre de l'infanterie, les bateaux de pêche seuls, et
  pompes à vapeur → tracteurs → chenillettes. La chenillette est un type
  d'armement (stocké dans la réserve, §8.3) produit par une usine de biens :
  un arbre peut mêler biens et armement.

**Usine d'armement d'infanterie** (premier arbre décrit) :

```
fusils                                        production de base de l'usine
├── mitrailleuses                             débloquées par une ligne de fusils
│   └── canons anti-aériens                   débloqués par une ligne de mitrailleuses
│       └── canons anti-aériens autopropulsés débloqués par une ligne de canons anti-aériens
└── artillerie                                débloquée par une ligne de fusils
    ├── artillerie autopropulsée              débloquée par une ligne d'artillerie
    └── canons anti-chars                     débloqués par une ligne d'artillerie
        └── canons anti-chars blindés         débloqués par une ligne de canons anti-chars
```

- Huit types d'armement dans cet arbre (§8.3) : les cinq à pied et les trois pièces
  sur châssis blindé (artillerie autopropulsée, canon anti-aérien autopropulsé,
  canon anti-char blindé). Chaque pièce blindée est débloquée directement par
  l'appui-feu à pied associé (décision de l'auteur, 1er novembre 2026). La
  chenillette et les trois chars (char d'infanterie, char de cavalerie, char
  moyen) viennent de l'usine mécanique.
- Débloquer une branche ajoute une production, sans remplacer les
  précédentes : une même usine peut avoir des lignes de fusils, de
  mitrailleuses et d'artillerie en même temps.
- Plusieurs lignes de chaque type sont possibles. Plus une usine a de lignes
  d'un même type, moins chacune demande d'ouvriers (spécialisation, §8).
- Chaque type a une icône, dessinée par l'auteur (§11).


  1. **Population** : total, variation par tour, maximum. Détail : la part de
     la population par occupation (ouvriers d'usine, mineurs, fermiers,
     pêcheurs, inactifs), en rectangles proportionnels.
  2. **Nourriture** : production par tour, surplus. Détail : en haut, une jauge
     de population en trois sections (précision de l'auteur, 24 octobre
     2026) : population actuelle (**vert**), population maximale avec la
     nourriture du tour (**vert hachuré**), population maximale si toutes les
     terres agricoles et toutes les zones de pêche étaient exploitées
     (**gris plein, très clair**). Puis agriculture (barre couleur **blé**) et pêche
     (barre **bleue**) séparées ; plus tard importations et exportations.

  4. **Armement (stock)** : rien dans la barre, tout dans le détail. Une jauge
     par type ; au-delà du stock cible (§8.3), la barre est **hachurée de
     rouge** : c'est la zone où l'excès décline.

- Logo de chaque usine à côté de sa ville (§8).
- Taille des villes : la même pour toutes, plus grande pour une ville qui
  porte une usine, selon le niveau de l'usine (§3.7).
- Panneau latéral des lignes de production, avec un réglage par groupe de
  lignes identiques (§8.1).

- L'armement est la seule quantité qui passe d'un tour à l'autre (§8.3) : la
  réserve de chaque type, par joueur, et l'équipement de chaque armée sont
  dans l'état, donc dans le hash. De même le type de chaque usine, ses lignes
  et la progression de déblocage de son arbre (§8.4).

- **Les flux se citent en boucle** : les tracteurs d'un tour viennent des
  usines, qui consomment du fer, extrait par des mineurs, dont le nombre dépend
  des pompes à vapeur, qui viennent des usines. Proposition : à chaque tour, les
  machines utilisées sont celles produites au tour précédent (100 ms de
  décalage). À valider.
- **Valeur produite et valeur effective** (décision de l'auteur du 1er novembre
  2026). Une machine (tracteur, bateau de pêche, pompe à vapeur) a deux valeurs :
  la **produite** (ce que les lignes ont fabriqué au tour ; lue par les usines
  pour ajuster leurs lignes, affichée dans les barres) et l'**effective** (ce que
  la mécanisation, la récolte et l'extraction utilisent au tour suivant). Si la
  produite est au moins égale à l'effective, l'effective devient la produite
  tout de suite. Sinon l'effective baisse vers la produite, une fois par seconde
  (tous les 10 tours) : du plus grand de 1 unité et de 1 % de l'effective,
  arrondi vers le bas, sans passer sous la produite. Cela évite que le parc de
  machines tombe à 0 un tour où les lignes sont écartées (la population
  alternait alors entre ouvriers et fermiers). Réglages : `GOODS_DECAY`
  (`config/goods.ts`). Le fer n'a pas de valeur effective propre : les mineurs
  sont dimensionnés sur le fer des lignes qui tournent du même tour : le fer extrait est
  consommé à la productivité `r` près (§8). L'aluminium, quand il sera extrait, suivra la règle des
  machines si un écart apparaît.


**Population**
- Priorité d'un groupe de lignes identiques (§8.1) : le groupe a-t-il une seule
  position dans la section de sa ville ? (Priorité décidée : villes entières,
  puis lignes au sein d'une ville, §8.1.)
- Mineurs pour l'export (§7) : pris avec ceux des lignes, après eux, ou avant ?
- Le format du réglage fermiers / pêcheurs, et son effet tant qu'un joueur n'a
  pas de cases de mer. Choix provisoire du moteur : un pourcentage entier de
  fermiers, 100 par défaut (02-Engine §7). Sans mer, les pêcheurs vont aux
  champs par le report du §4.
- Ordre dans un tour : choix provisoire du moteur, les ordres d'abord, puis la
  répartition, la nourriture et la croissance de chaque joueur (02-Engine §7).
- Si la population ne suffit pas à couvrir la demande d'extraction : extraction
  partielle, et rien pour les champs ?


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

**Extraction**
- Mécanisation minière : le nombre de pompes par mineur dépend du nombre de
  mineurs, qui dépend de la mécanisation (même boucle que celle évitée au §6.2
  par les fermiers disponibles). Les pompes sont rapportées aux mineurs qui
  exploitent les cases à pleine mécanisation (§6.2, décision de l'auteur du
  24 octobre 2026 ; avant : aux mineurs sans pompe, choix provisoire du moteur).
- Machines (tracteurs, bateaux de pêche, pompes à vapeur) : choix provisoire du
  moteur, les effectives, qui suivent les produites du tour précédent (§12).
  Le lissage de la baisse est un essai de l'auteur, à mesurer : la demande que
  les usines lisent (`goodsDemand`) n'est pas lissée.
- **Provisoire (malus de production, 4 novembre 2026, §8)** : les ouvriers employés valent
  les ouvriers demandés × la productivité, même quand le malus vient du fer ; la
  progression du déblocage avance de `lignes qui tournent × r` ; la croissance
  automatique d'un groupe ignore le malus ; les lignes de biens en trop sont
  départagées par l'ordre des usines, ce qui garde un rôle aux priorités ;
  `set_city_priority` et `set_line_priority` sont à supprimer plus tard.

**Usines**
- Construction : gratuite pour l'instant (§8). Coût réel et durée éventuelle :
  plus tard.
- Croissance automatique des lignes (§8.2) :
  - **Version finale : bouton + retiré ou payant.** Aujourd'hui, cliquer + est
    toujours plus rapide qu'attendre. Il faut retirer le bouton ou lui donner
    un coût ; pas d'argent dans le jeu, donc trouver autre chose à dépenser.
    À décider avec l'auteur ;
  - **À traiter avec les armées** : croissance automatique de l'armement,
    selon une demande venue des armées (décision de l'auteur : même mécanique
    que les machines, plus tard) ;
  - tours qui comptent (provisoire : toutes les lignes du groupe produisent) ;
  - quand la demande baisse (provisoire : le groupe garde ses lignes) ;
  - `FACTORY.growthTurns` : 500 pour l'essai, comme `unlockTurns`, à fixer ;
  - commerce : demande = consommation + exportations (§8.2), quand le
    commerce sera décrit.
- Créer une ligne : coût (piste : de la population). Condition décidée :
  `FACTORY.unlockTurns` tours-lignes de production du parent (§8.2).
  Décidé : tours cumulés de production, la pause ne fait pas perdre la
  progression (§8.2). Lecture retenue, à confirmer : ligne du parent dans la
  même usine.
- Spécialisation (§8.1) : formule hyperbolique avec plancher, rang compté
  dans le groupe, `decayPercent` 5 et `floorPercent` 10 (décidés le 24 octobre
  2026). Rien d'ouvert, sauf si le rang doit un jour se compter sur tout le
  joueur pour un bien présent dans plusieurs usines.
- `workersPerLine` : une valeur par bien (décidé le 24 octobre 2026) ; les
  valeurs elles-mêmes restent à fixer, 200 partout pour l'instant (multipliées
  par 4 sur décision de l'auteur, 24 octobre 2026 ; c'était 50).
- Forme du nombre maximal de lignes en fonction de la population.


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
  `FACTORY.unlockTurns` tours (§8.2). Ressource consommée : le fer par ligne
  de chaque type (§8).
- Usage des cinq types d'infanterie par les armées : avec le module armée.

**Taille des villes (affichage)**
- Niveau compté sur toutes les lignes de l'usine, ou seulement sur les lignes
  actives (§8.1) ? Paliers de taille, ou taille continue ?


