# Tests à faire

Liste des tests à écrire plus tard pour valider le jeu. **Rien ici n'est écrit
pour l'instant** : les règles changent encore beaucoup. La passe de tests se
fera quand l'auteur la demandera (pas avant).

Chaque test vérifie une règle de `Docs/Design/05-Fronts.md`, avec des valeurs
calculées à la main d'après le document (jamais recopiées de la sortie du
code). Un écart trouvé : on corrige le code, ou on signale le point si
05-Fronts ne le tranche pas.

## Décision sur les tests (1er novembre 2026)

L'implémentation n'est pas finie et les règles des fronts changent encore :
**on n'écrit ni ne corrige de tests avant la fin.** Ce qui compte d'ici là, ce
sont des exigences claires, écrites dans ce fichier à mesure que les règles se
décident. Les tests sont écrits vers la fin, à la demande de l'auteur.

- **Tests existants** : on n'y touche plus. Quand une règle change, on note ici
  les tests qu'elle périme, sans les corriger. À la passe finale, on décide pour
  chacun : garder, réécrire ou supprimer. Piste : lire les valeurs de la
  configuration (`FRONTS.footSpeedPermille`…) au lieu de les écrire en dur, pour
  qu'un changement d'équilibrage ne casse plus les tests de combat et d'avancée.
- **État au 1er novembre 2026** : les 205 tests du moteur passent. Huit tests
  périmés ont été mis à jour ce jour-là (seuils et vitesses d'avancée 10 / 10 /
  20, fronts disparus sans délai, `player_eliminated`, commentaires de l'appui-feu).
  Les trois tests de l'appui-feu de `combat.test.ts` passent par coïncidence de
  chiffres avec la nouvelle règle (05-Fronts §6.3) : à revérifier à la passe finale.
- **Audit des tests qui vérifient une règle disparue sans échouer** : non fait.
  À faire à la passe finale, en même temps que la décision ci-dessus.

## Fronts version 2 : réaction rapide, boîtes de percée, percée

Règles : 05-Fronts §4.6, §7.2, §12, §15. Code : `packages/engine/src/breakthroughs.ts`,
`combat.ts`, `placement.ts`.

**Boîtes et réaction rapide (§4.6)**
- `move_division` vers une nouvelle boîte (`line: "box", box: 0`), vers une
  boîte existante, vers la réaction rapide.
- Sans délai sur le même front et vers la réserve ; délai de `transferRounds`
  depuis la réserve ou un autre front.
- Refusé : boîte d'un autre joueur, boîte d'un autre front, division engagée
  dans une percée.
- Une boîte vide et sans percée est supprimée ; une boîte dont toutes les
  divisions sont engagées reste.
- Boîtes et réaction rapide : ni attaque sur tout le front, ni rangement des
  lignes, ni échange.
- Renfort : oui hors percée, non pour une division engagée dans une percée.

**Lancement (§7.2, points 1 à 4)**
- Force prise au lancement : une liaison par niche en `breakthroughWidth` (une
  tankette compte 1), dans l'ordre de choix ; la dernière engagée en partie
  mais toute prise ; les autres restent dans la boîte.
- Appui-feu non engagé sans infanterie dans la force.
- Refusé : front en paix, axe hors du front, boîte vide, boîte sans infanterie
  disponible (chars seuls), axe déjà attaqué par ce camp.
- Force qui a fui pendant le délai (vide au combat 1) : événement
  `breakthrough_failed` et phase 5, avec un délai complet ; force détruite ou en
  fuite pendant la phase 5 ou 6 : le délai n'est pas raccourci.
- `Breakthrough.motorized` fixé au lancement : vrai si toutes les divisions
  disponibles de la boîte (pas seulement la force prise, pas seulement
  l'infanterie) sont motorisées ; il règle la vitesse du saut.
- Délai de `breakthroughDelayTurns` avant le combat 1 ; force vide au début du
  combat 1 : percée arrêtée, événement `breakthrough_failed`.
- Sept phases : 0 délai, 1 combat 1, 2 délai (après le saut, même sans
  infanterie en défense), 3 combat 2, 4 délai (puis la ville tombe), 5 délai de
  repli (échec du combat 1), 6 délai (échec du combat 2) ; tous les délais
  durent `breakthroughDelayTurns` ; `advance` cumule le saut, `advanceOf` y
  ajoute la distance restante en phase 4 ; `inCombat` vrai seulement en phases 1 et 3 ; pendant les
  délais la défense n'est pas engagée ; force essoufflée ou détruite en phase 1
  ou 3 : phase 5 ou 6, le saut reste, puis la percée s'arrête ; annulation, paix
  ou axe disparu : arrêt sans délai.

**Combat 1 (points 5, 6, 7, 10)**
- Tranche : une liaison par niche en `frontWidth`, dans l'ordre de choix,
  parmi la première ligne engagée ; elle reste en première ligne et garde part
  à l'attaque sur tout le front.
- Multiplicateurs : `breakthroughMultiplier` pour la force, rien pour la
  tranche, PV de défense pour le défenseur.
- Attaque de la force rapportée à `breakthroughWidth` (une tankette engagée sur
  1 liaison attaque à pleine force), celle de la tranche à `frontWidth`.
- Pas de remplacement de la tranche.
- Première ligne percée quand plus aucune infanterie de la tranche n'est
  engagée (détruite ou en fuite).
- Saut = arrondi(N × v × facteur de réaction) : motorisation de la
  contre-attaque à 50 %, 75 %, 100 % ; pas de contre-attaque ; force motorisée
  ou non.

**Combat 2 (points 8, 9)**
- Force de contre-attaque : réaction rapide d'abord, puis seconde ligne, une
  liaison par niche en `breakthroughWidth`, avec `counterAttackMultiplier`.
- Deux percées sur le même front : partage équitable, recalculé à chaque round.
- Une division de seconde ligne engagée dans la contre-attaque n'est pas
  montée en première ligne.
- La ville tombe quand la contre-attaque n'a plus d'infanterie, ou s'il n'y en
  a pas.

**Fin (points 11 à 13)**
- Essoufflement : état moyen de la force (pondéré par la largeur engagée) sous
  35 % de celui du début du combat 1.
- Fuite à 25 % : une division de la force reste dans sa boîte, libérée de la
  percée, en fuite ; une division de la contre-attaque est libérée, en fuite ;
  une division de la tranche repasse en seconde ligne.
- Annulation (`cancel_breakthrough`), paix : percées arrêtées.
- Les survivants de la force retournent dans leur boîte ; la boîte reste.

**Front qui change (§2.5, §4.6)** — `afterFrontsChanged`
- Une percée suit le front qui contient son axe ; elle s'arrête si l'axe
  disparaît ou si sa boîte n'est plus sur ce front.
- Une boîte dont le front disparaît est supprimée ; une division qui n'est plus
  sur le front de sa boîte va en seconde ligne.

**Fusion de fronts (§2.5)** — `updateFronts`
- Deux fronts fusionnés : les divisions des deux vont dans le nouveau front, aucune
  à la réserve.
- Ancien front sans connexion gardée (ville prise) dont une ville est sur un front
  des mêmes joueurs, ou à une route d'une de ses villes : ses divisions vont à ce
  front (le plus proche) ; à deux routes ou plus, ou sans front des mêmes joueurs,
  à la réserve sans délai (ni horloge).

**Hash et déterminisme**
- Chaque champ d'une boîte, d'une percée, et `box`, `breakthrough`,
  `btEngaged` d'une division change le hash.
- Le scénario de `test/determinism.test.ts` joue des boîtes, des percées et de
  la réaction rapide.

## Élimination d'un joueur

Règles : 05-Fronts §10.3, §11.6. Code : `packages/engine/src/conquest.ts`
(`eliminatePlayer`), `intents.ts`, `diplomacy.ts` (`isOther`).

- La prise de la dernière ville d'un joueur : `defeated` vrai, événement
  `player_eliminated` (`from` le preneur, `to` l'éliminé) après `city_captured`.
- La prise d'une ville qui n'est pas la dernière : rien de tel.
- Un joueur sans ville qui n'en a jamais fondé (nomade) n'est pas éliminé.
- Divisions, boîtes et percées de l'éliminé supprimées ; `soldiers` à 0 ; les
  divisions de l'attaquant ne changent pas ; les propositions en attente qui le
  visent ou qu'il a envoyées sont supprimées.
- Tous les ordres d'un éliminé sont ignorés, `found_city` compris (pas de
  première ville gratuite) ; déclaration de guerre et propositions qui le visent
  refusées.
- `defeated` change le hash ; le scénario de `test/determinism.test.ts` joue au
  moins une élimination.
- Client : `eliminated` du message `tick` (vide après un rejeu), `defeated` des
  statistiques, bot éliminé muet.

## Points relevés pendant la passe de la version 1 (non tranchés)

- Composant sans exemplaire et reste de perte positif : le moteur ne tire pas ;
  §1 ne le dit pas.
- Moyenne pondérée de l'appui-feu (§6.3) : avec les types actuels, toute
  l'infanterie engagée a la même fraction de pertes ; la pondération n'est pas
  distinguée d'une moyenne simple.
- Chenillette : la perte de 1 à 9 hommes retire un char (§3.2), donc le
  `lossMultiplier` de ses hommes ne se voit qu'au-delà de 10 hommes.
- Une mutation n'est détectée par aucun test : dégâts reçus calculés avec la
  largeur de la division au lieu de sa largeur engagée.

## Renfort progressif (1er novembre 2026)

- `divisions.test.ts`, « renfort » : les attentes à un seul `reinforceAfterEconomy` supposent un renfort complet en
  un tour (500 fusils manquants, 100 manquants, +50 chacune) ; avec `reinforcePercentPerRound` = 5, un composant de
  1 000 ne gagne que 50 par round, et rien aux tours qui ne sont pas multiples de `combatTurns` (les tests qui
  appellent `reinforceAfterEconomy` à `tick` 0 ne reçoivent rien : mettre `tick` à 9). À recalculer.
- À ajouter : une division à 0 % pleine après 34 rounds (`reinforcePercentPerRound` 3 depuis le 3 novembre) ; plafond minimum de 1 exemplaire ; la part non prise reste au stock.

## Échange hors combat (1er novembre 2026)

- Les tests qui posent deux divisions du même type sur un front sans attaque (ex. « entre les deux lignes d'un même
  front », `divisions.test.ts`) peuvent voir la première ligne changer : `swapAtRest` remplace à chaque tour une
  division de première ligne par une de seconde ligne d'état strictement supérieur. À vérifier.
- À ajouter : hors combat, état supérieur et même type → échange avec la meilleure ; type moins prioritaire → règle
  des 50 % ; en combat → règle des 50 % seule ; état égal → pas d'échange (pas d'oscillation) ; division en fuite ou
  en percée jamais choisie.

## Blessés (2 novembre 2026, 00-Game §4.2)

Implémentés (`hurt`, `applyLoss`, `healHurt`, `cutHurtOnLoss`, `removeSoldiers`, `payFoundingCost`) ; aucun test écrit ni
lancé (seul `npm run typecheck` a passé). À écrire :

- **Entrée** : une perte d'hommes au combat, en percée, en fuite et par encerclement ajoute exactement les hommes perdus à
  `hurt`, `population` ne change pas, `idle` ne gagne rien ; l'équipement perdu n'entre nulle part. Suppression d'une
  division et excédent rendu (`trimExcess`) : hommes inactifs, `hurt` inchangé.
- **Emplois et renfort** : la répartition se fait sur `population − soldiers − hurt` ; création de division et renfort ne
  prennent que des inactifs ; mobilisation forcée : `population − soldiers − hurt`, jamais les blessés.
- **Guérison** : `max(hurtMinimum, floor(population / hurtDivisor))` par tour, borné à `hurt` ; la population baisse du même
  nombre. Cas : grande population (le quotient l'emporte), petite population (le plancher l'emporte), `hurt < hurtMinimum`
  (tous guéris), population presque entièrement blessée (le nombre de blessés baisse d'au moins `hurtMinimum` par tour).
- **Famine** : population qui baisse de `L` avec des soldats ; blessés retirés `ceil(H × L / (P − S))` ; exemple
  100 de population, 10 blessés, 10 % perdus, sans soldats : 1 blessé et 9 autres ; plafond `hurt ≤ max(0, population −
  soldiers)` ; `population < soldiers` : jamais de soldat retiré.
- **Fondation** : refusée si `population − hurt < coût` ; manque `coût − (population − soldiers − hurt)` retiré aux
  divisions au plus fort reste, total exact, composants rognés rendus au stock, `hurt` inchangé, `soldiers` recompté ;
  une division vidée n'est pas détruite et se reconstitue par le renfort (seul le combat, l'encerclement ou
  `delete_division` détruisent : `removeDestroyed(state, hit)` n'est plus appelée à chaque tour, `turn.ts`) ; les tests
  qui comptent sur la destruction par `applyTurn` d'une division vidée autrement sont périmés ; après la fondation `population − soldiers ≥ hurt`.
- **Déterminisme** : le hash change (nouveau champ) ; 10 000 tours dans deux processus avec des guerres.
- **Tests existants périmés à repérer** : ceux qui comptent sur le retour des hommes tués dans `idle`, sur le seuil de
  fondation `population ≥ coût` avec des soldats, ou qui fixent un hash.
- **Client, à vérifier à la main** : ligne « Blessés » noire en dernier de l'onglet Population, total sans blessés (bouton,
  panneau latéral, tableau des joueurs), segment noir à gauche de la jauge de nourriture et de sa mini-barre.
- **Réglage** : `POPULATION.hurtDivisor` = 2 400 et `POPULATION.hurtMinimum` = 5 (valeurs de l'auteur) ; lire les valeurs de la
  configuration dans les tests.

## Usines : une par type, suppression (1er novembre 2026, 00-Game §8, §9)

- `build_factory` refusé quand le joueur a déjà une usine de ce type, dans une autre ville.
- `delete_factory` : l'usine disparaît (groupes, progression), le stock cible d'armement baisse ; refusé sans usine ou pour la ville d'un autre joueur ; la ville peut ensuite recevoir une nouvelle usine.
- Le scénario (`packages/engine/test/scenario.ts`) n'envoie pas `delete_factory`, et ses `build_factory` réussissent moins souvent : les mesures de 02-Engine §8 sont à refaire.
- **Tests périmés** : `withTwoFactories` de `packages/engine/test/factories.test.ts` construit deux manufactures d'armes (villes 1 et 2) et sert à plusieurs tests (priorité des villes, ordres invalides, hash). À réécrire avec deux types d'usine différents.

## Pertes du dernier round (1er novembre 2026, 05-Fronts §11.4)

- `FrontSide.lastLoss` = hommes perdus au dernier round par les divisions de la première ligne de ce camp (tranches de première ligne des percées comprises ; pas la force qui perce) ; remis à 0 à chaque round, y compris sur un front sans combat.
- Gardé quand le front est recalculé (même règle que `frontAttack`) ; entre dans le hash.

## Demande des tracteurs et des bateaux au remplissage (1er novembre 2026, 00-Game §8.2, provisoire)

Règle provisoire, peut-être retirée (00-Game §13, Extraction). Si elle reste :

- Une ligne de tracteurs n'est remplie que si la production déjà remplie est sous la demande calculée avec les personnes qui resteraient, ses ouvriers et ses mineurs comptés. Cas de référence (une ville, 1 764 cases cultivables, une usine de pompes avec 5 lignes de pompes puis des lignes de tracteurs, population figée à 3 800) : 11 lignes de tracteurs remplies, stable d'un tour à l'autre.
- Pas d'alternance : population figée entre 3 000 et 4 000 dans ce cas, le nombre de lignes de tracteurs remplies ne change plus après le premier tour.
- `goodsDemand` des tracteurs et des bateaux = production retenue quand une ligne est refusée, sinon demande de la dernière ligne remplie ; la croissance des lignes et le trait noir du client tombent sur le même nombre de lignes que le moteur.
- Les pompes gardent la demande du tour précédent.
- **Test périmé** : `determinism.test.ts`. Le déterminisme tient (mêmes hashes), mais avec `botSeed` 4242 le scénario par défaut ne crée plus de division : ni soldats, ni prise, ni famine (`starvingPlayerTurns` = 0), et le garde-fou « le surplus négatif n'est pas testé » échoue. Les joueurs sans ligne de machines ne passent pas par la règle : c'est la trajectoire des bots qui diverge vers le tour 700. Avec `botSeed` 4243, 4244, 4245, 1 ou 2, tous les seuils du test sont atteints (4243 : 18 divisions, 18 prises, 2 789 tours-joueurs de famine). À changer à la passe finale.

## Client

- Bouclier « défend une percée » et ligne de statut rouge du panneau de pion (1er novembre 2026), à vérifier à la
  main : pion de première ligne attaqué par une percée, pion de réaction rapide ou de seconde ligne dans une force de
  contre-attaque, ligne de statut des quatre cas, thème clair et sombre.
- Fenêtre d'un front, onglet des forces, menu « + », sélection simple et
  avancée, glisser-déposer, panneaux de survol, thèmes : rien n'est vérifié
  dans le navigateur par un test.
- Changements du 1er novembre 2026, à vérifier à la main : menu « + » du moins au plus prioritaire ; surbrillance d'un front entre la liste de la réserve nationale et la carte, dans les deux sens, avec le nom de l'adversaire dans l'infobulle ; « + » des forces de percée juste après la dernière boîte ; boîte de percée avec beaucoup de types (retour à la ligne) ; rectangle élargi d'une seconde ligne « trop de pions » qui reste ouvert quand la souris sort du rectangle de base.

## Infanterie : milice, réguliers, élites

- `create_division` d'une élite (`ELITE_TROOPS_RATIO` passé de 5 à 10 le 1er novembre 2026 : les anciens chiffres de ce test sont à refaire) : refusée sans infanterie ; acceptée avec 9 divisions d'une autre sorte, puis refusée ; une deuxième acceptée à 19 ; limite recalculée avec `ELITE_TROOPS_RATIO` modifié (4 : 25 %). Les divisions en formation comptent.
- Supprimer de l'infanterie au-dessus de la limite : aucune élite supprimée ; la création d'une élite reste refusée.
- Formation par type : milice prête au tour de l'ordre (`formedTick` = tour), réguliers 100 tours, élites 200 ; une milice peut être déplacée et supprimée aussitôt.
- Milice : 500 fusils requis suffisent, aucun composant optionnel ; élite : 1 500 fusils requis, 300 mitrailleuses optionnelles (renfort).
- Client : l'élite est à 50 % de transparence quand la limite est atteinte (`eliteAllowed`), et le client s'accorde avec le moteur ; `create_division` confirmé pour une milice (formation 0).

## Chars : char d'infanterie, char de cavalerie, char moyen

- Arbre de l'usine mécanique : le char d'infanterie et le char de cavalerie se débloquent par la tankette, le char moyen par le char de cavalerie.
- `create_division` des trois chars : 400 / 500 / 400 hommes et 40 / 50 / 40 chars requis ; refusée au moindre manque.
- Mouvement : le char de cavalerie et le char moyen sont motorisés, le char d'infanterie à pied (vitesse d'avancée et saut de percée, 05-Fronts §7.1, §7.2).

## Appui-feu blindé : artillerie autopropulsée, canon anti-aérien autopropulsé, canon anti-char blindé

- Arbre de la manufacture d'armes (usine d'équipement d'infanterie, changé le 1er novembre 2026) : l'artillerie autopropulsée se débloque par l'artillerie, le canon anti-aérien autopropulsé par le canon anti-aérien, le canon anti-char blindé par le canon anti-char ; l'usine mécanique n'en produit plus aucun.
- `create_division` : 500 hommes et 50 / 100 / 100 pièces requis ; refusée au moindre manque. Les trois sont rangés avant leur variante à pied dans leur niche.
- Largeur : 5 en première ligne, 1 en percée (une division suffit à remplir la liaison de sa niche dans une force de percée ou de contre-attaque, et sa part engagée y est de 1 sur 1) ; le canon à pied reste à 5 / 5.
- Attaques : artillerie autopropulsée 3 000 de soft et 0 de hard ; anti-aérien 2 000 de soft et 10 000 d'air ; anti-char 10 000 de hard. Multiplicateurs d'attaque / de percée / de contre-attaque : 0,8 / 1 / 1,2 (anti-char), 0,8 / 1 / 1 (anti-aérien), 1 / 1,2 / 1 (artillerie).
- Dégâts de l'appui-feu (05-Fronts §6.3) : `mixte × part engagée / (F + W_chars)`. Cas à tester avec F = 10 liaisons, S = 1 000, H = 600 : 10 réguliers sans chars → régulier 100, artillerie à pied 100, autopropulsée 60 ; 5 réguliers seulement → l'appui-feu ne change pas (100 / 60) ; 5 chars de largeur 2 → 50 / 30 ; avec 5 réguliers et ces chars → 50 / 30 (et non 33 / 20) ; part engagée de moitié → moitié moins.
- En percée : F = une liaison, y compris dans la tranche de première ligne ; une variante blindée (largeur de percée 1) prend toute la part d'une liaison, un canon à pied (5) un cinquième.
- `armorPercent` 100 : l'appui-feu blindé prend le hard, celui à pied le soft ; PV 50 000 (×2 en défense) pour les trois à pied, 100 000 / 100 000 / 200 000 pour artillerie, anti-aérien et anti-char autopropulsés.
- Appui-feu sans infanterie engagée : non engagé, donc aucun dégât.
- `lossMultiplier` de l'artillerie (à pied et autopropulsée, hommes et pièces) : 1, vestige de l'ancienne règle retiré le 1er novembre 2026.
- `combat.test.ts` : le test « l'appui-feu perd les pertes de l'infanterie × sa part engagée × son lossMultiplier » (ancienne règle des pertes dérivées, §6.3) est à réécrire avec la nouvelle formule.
- Mouvement motorisé (provisoire) : une boîte de percée contenant seulement des divisions motorisées, appui-feu blindé compris, perce à vitesse motorisée.
- Artillerie à pied : `productionPerLine` passé de 2 à 1 ; plafond du stock d'armement recalculé en conséquence.

## Cadences à la seconde : guérison, armement, renfort (3 novembre 2026)

- **Guérison** : `healHurt` n'est appelée qu'aux tours multiples de `POPULATION.hurtEveryTurns` (10), économie gelée comprise ;
  `hurtDivisor` 5 000, `hurtMinimum` 5 par seconde. Les tests de guérison qui jouent un seul tour à `tick` 0 ne guérissent
  plus rien : mettre `tick` à 9.
- **Armement** : aux tours multiples de `ARMAMENT.everyTurns` (10), `filled × productionPerMinute` s'ajoute à
  `armamentProductionRemainder` ; `floor(reste / 60)` passe dans la réserve, le reste (0 à 59) est gardé et entre dans
  le hash. Cas : 1 ligne de chars d'infanterie (12/min) → 1 char toutes les 5 s ; deux groupes du même type dans deux
  usines partagent le même reste. Fer et ouvriers employés à chaque tour. `factories.test.ts` l. 77 (réserve après un
  tour) est faux tel quel. Stock cible = ⌊ lignes × `productionPerMinute` × `maxStockSeconds` (40) / 60 ⌋.
- **Biens** : toujours produits à chaque tour (`GOODS.*.productionPerLine`), rien ne change.
- **Renfort** : `reinforcePercentPerRound` 3 ; une division à 0 % pleine après 34 rounds (et non 20).
- **Client, à vérifier à la main** : onglet Armement « +X par minute », infobulle d'une ligne d'armement « produits par
  minute », « approprié pour » = ⌊ ⌊ lignes × productionPerMinute × 40 / 60 ⌋ ÷ exemplaires ⌋ ; corbeille de l'onglet
  des forces sur fond rouge clair, icône noire.

## Fer ×10 (3 novembre 2026)

- `RESOURCES.iron.capacityPerTile` 1 → 10 ; tous les `ironPerLine` ×10, sauf fusil et mitrailleuse : 1 → 2. Les tests
  qui supposent une case par fer (`ironTilesFor`, `minersFor`, `minedTiles`, capacité de fer = nombre de cases) sont à
  recalculer : une case nourrit 5 lignes de fusils, 1 ligne d'antichar, 1/10 de ligne d'artillerie.

## Lignes d'artillerie et de chars, fer ×2 (4 novembre 2026)

- Production par minute : artillerie 60 ; tankette, char rapide, artillerie automotrice 12 ; char d'infanterie, char moyen 6 ;
  antichar blindé, antiaérien automoteur 18. Fer par ligne et par tour : fusil et mitrailleuse 4, antichar et antiaérien
  20, artillerie 50, biens ×2 (tracteur 100, bateau 60, pompe 20) ; chars et appui-feu sur chenilles inchangés. Les tests
  qui comptent les lignes remplies avec un fer donné, ou les mineurs d'une ligne, sont à recalculer.

## Malus de production (4 novembre 2026, 00-Game §4, §8)

Le remplissage ligne par ligne (`fillLines`) est remplacé par un malus réparti sur toutes les lignes. `LineGroup.filled`
devient `running` ; nouveaux champs du joueur `ironDemanded`, `ironConsumed`, les six ratios (`goodsIronRatio`… `armLineRatio`),
`goodsRemainder` ; nouveau `Factory.progressRemainder` ; `armamentProductionRemainder` est maintenant en soixantièmes ×
`RATIO_SCALE` (10 000). Les tests ont seulement été renommés (`filled` → `running`) pour que le typecheck passe ; ils sont
à écrire ou à corriger :

- **À corriger** : `factories.test.ts` « remplissage des lignes » (tout ou rien, arrêt à la première ligne, capacité de fer,
  machines du tour précédent), « déblocage et réserve d'armement » (reste en soixantièmes × 10 000), « hash des usines »
  (nouveaux champs) ; `specialization.test.ts` « remplissage avec les coûts par rang » ; `client/test/solo.test.ts`
  « usine du joueur » (les fermiers passent avant : une petite population n'a plus ni mineurs ni ouvriers) ; le scénario
  (`filledLinePlayerTurns`) compte maintenant les joueurs qui ont des lignes qui tournent.
- **À écrire** : ordre de répartition (fermiers et pêcheurs, puis mineurs, puis ouvriers, le reste inactif) ; fer extrait
  proportionnel aux mineurs quand ils manquent ; `ratio_fer`, `ratio_ouvriers`, `r = min` ; production × r avec reste
  (biens, armement, déblocage) ; ligne de biens en trop écartée à 100 % de productivité (100 tracteurs demandés, une ligne
  de 100 : une seule tourne même à r = 50 %) ; demande de tracteurs et de bateaux des fermiers et pêcheurs répartis ;
  croissance automatique indifférente au malus ; ordres de priorité toujours valides, sans effet ; déterminisme avec
  malus (les restes sont dans le hash) ; **deux passes** : les biens prennent le fer et les ouvriers avant l'armement
  (`r_biens` et `r_armement` séparés, l'armement reçoit le reste, biens à 100 % : armement non touché si le fer suffit).
- **Appui-feu à pied divisé par 2** : artillerie 30 par minute et 25 fer, antichar et antiaérien 180 par minute et 10 fer ;
  ouvriers inchangés.
- **Client, à vérifier à la main** : onglet des usines (nombre du fer en gras, rouge si `ratio_fer` < 1 ; nombre des
  ouvriers rouge si `ratio_ouvriers` < 1) ; onglet Ressources (camembert du fer, infobulle, hachures rouges sur la barre et
  la mini-barre, camembert de l'aluminium grisé, engrenages des machines).

## Production ÷ 20, guérison toutes les 2 s (5 novembre 2026)

- Armement en `productionPerHour` (fusil 2 376, mitrailleuse 432, artillerie 90, antichar et antiaérien 540, tankette, char
  rapide, artillerie automotrice 36, char d'infanterie et char moyen 18, antichar blindé et antiaérien automoteur 54) ; reste
  en 3 600es × `RATIO_SCALE`. Stock cible = ⌊ lignes × `productionPerHour` × 800 / 3 600 ⌋ (même valeur par ligne qu'avant).
- Guérison aux tours multiples de 20 (`hurtEveryTurns`) : les tests qui jouent 10 tours n'en voient plus.
- Les mentions plus haut de `productionPerMinute` et de 40 s sont périmées.
