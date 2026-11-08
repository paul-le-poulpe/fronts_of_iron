# 06 — Combat simplifié et usines d'unités (branche `Simpler-Combat`)

**Ce document fait foi pour son domaine** : combats instantanés et leur replay,
usines placées sur la carte qui produisent des divisions, centres de
recrutement. Il remplace, sur cette branche, les parties suivantes, qui ne font
plus foi là où elles le contredisent :

- `05-Fronts.md` §5 (attaques), §6 (round de combat continu), §7.1 et §7.2
  (déclenchement de l'avancée, combats de la percée : un round par seconde
  remplacé par un combat résolu en un tour) ;
- `00-Game.md` §8 (usines à lignes, spécialisation, malus de production des
  lignes), §8.1, §8.2, §8.3 (réserve d'armement) et §8.4 (types d'usines) ;
- `05-Fronts.md` §3.5 (création des divisions par le joueur).

**`08-Population.md` remplace les §3 à §4 ci-dessous** (usines sur la carte, niveaux,
centres de recrutement), sauf la barre de vie (§3.3) et le soin (§3.6), qu'il reprend. Les
pertes du rapport sont décrites par `08-Population.md` §8 bis et §11.

**`10-Combat-Phases.md` remplace** la durée du combat (50 rounds, §1) et le
replay (§2) : combat en cycles de phases, fenêtre détaillée et résumé.

Décisions de l'auteur du 4 novembre 2026. Ce que l'auteur n'a pas tranché est
marqué « *provisoire* » et listé au §5. Version stable d'avant : tag git
`v0.2` (même commit que `avant-combat-simplifie`).

But : le combat continu fait des dégâts sans qu'on en voie l'effet, et les
quantités d'équipement produites sont abstraites. Deux leviers : un combat est
un événement ponctuel qu'on peut revoir ; une usine produit une division.

---

## 1. Combat instantané

1. **Lancement** : le joueur clique sur l'attaque sur tout le front, qui est
   **résolue tout de suite**, dans le tour du clic, après le rangement des lignes ;
   la fenêtre du combat s'ouvre aussitôt (décision de l'auteur, 7 novembre 2026).
   Pas de délai avant le combat, pas d'annulation. **Après** un combat, le camp
   attend **5 secondes** (`FRONTS.attackCooldownTurns`, 50 tours) avant de pouvoir
   en lancer un autre ; le bouton affiche ce compte à rebours. La percée garde son
   délai de 5 secondes (`FRONTS.breakthroughDelayTurns`).
2. **Résolution** : dans le tour, le moteur calcule **tout le
   combat dans ce tour**. Il enchaîne les rounds du §6 de `05-Fronts.md` (mêmes
   dégâts, mêmes pertes, fuites, échanges ; *provisoire*) pendant **50 rounds**
   (`FRONTS.combatMaxRounds`), ou jusqu'à ce que **l'attaquant n'ait plus
   d'infanterie engagée** en première ligne, ou jusqu'à une prise de ville
   (décisions de l'auteur, 5 novembre 2026) et aucune en renfort. Quand c'est **le défenseur** qui
   n'a plus d'infanterie engagée (détruite ou en fuite), **l'attaquant avance
   pendant les rounds qui restent**, sans combat (*provisoire* : sans dégâts
   de part et d'autre), à sa vitesse maximale (`05-Fronts.md` §7.1 : 0,3 % de
   la route par round à pied, 1 % motorisé, entre les deux pour une armée
   mixte ; 50 rounds font donc 15 % à 50 % de la route). Un attaquant sans infanterie
   engagée au lancement ne combat pas : le combat n'a aucun round et n'est pas
   enregistré. Les dégâts sont appliqués aux
   divisions dans ce tour.
   **Renforts** (décisions de l'auteur, 5 novembre 2026) : dans une attaque sur
   tout le front, la place laissée en première ligne par une division détruite
   ou en fuite est reprise, à la fin du round, par la seconde ligne (rangement
   des lignes, `05-Fronts.md` §4.2). La division montée reste **5 rounds en
   retrait** (`FRONTS.reinforceRounds`) : elle occupe sa place mais ne combat
   pas et ne compte pas pour l'avancée ; puis elle rejoint la première ligne et
   combat. Pas d'échange avec la seconde ligne pendant le combat
   (`05-Fronts.md` §5.3 : une division abîmée mais encore en ligne reste). Un
   défenseur dont l'infanterie revient par un renfort combat de nouveau.
   Un attaquant dont toute l'infanterie engagée a disparu, mais qui a de
   l'infanterie en renfort dans ses rounds de retrait, ne perd pas le combat :
   ces rounds passent **sans dégâts ni avancée**, puis le combat reprend avec
   elle (décision de l'auteur, 7 novembre 2026). Ils comptent dans les 50 rounds.
   Le replay l'annonce au round (« Plus d'infanterie en ligne : en attente des
   renforts d'infanterie »).
   **Repli faute d'infanterie** (demande de l'auteur, 5 novembre 2026) : un camp
   qui n'a plus d'infanterie engagée en première ligne (détruite ou en fuite) et
   aucune infanterie en renfort qui arrive **replie ses autres divisions de
   première ligne** en seconde ligne, en fuite jusqu'à la fin du combat ; le
   rapport garde le camp dans `withdrawn` du round, et les divisions dans `fled`.
   Le replay affiche « … se sont repliées : plus d'infanterie » au round et dans
   l'issue. Attaque sur tout le front seulement (*provisoire* pour la percée).
   **Pas de renfort dans les combats d'une percée** (point 5).
3. **Issue** : *provisoire* : l'avancée du §7.1 de `05-Fronts.md` est appliquée
   à chaque round, comme avant (50 rounds avancent comme 50 secondes
   d'attaque), prise de ville comprise.
4. **Plus d'état d'attaque durable** : une attaque est un ordre ponctuel. Un
   nouveau clic lance un nouveau combat (après un nouveau délai). Pas de combat
   en dehors de ces événements : un front sans combat lancé ne fait aucun dégât.
5. **Percée** (décision de l'auteur, 5 novembre 2026) : ses phases et ses délais
   restent ceux de `05-Fronts.md` §7.2, mais **chacun de ses deux combats est
   instantané**, chacun résolu en un tour, au tour où le délai qui le précède
   finit, avec les règles de la percée (multiplicateurs, fuites) :
   - **combat 1** : la force qui perce, sur une largeur de 1 liaison, contre
     les défenseurs de la première ligne sur une largeur de 1 liaison (la
     tranche, choisie au lancement du combat) ;
   - **combat 2, contre-attaque du défenseur** (si le combat 1 est gagné) :
     la force de contre-attaque est formée **une fois, au début du combat** :
     pour chaque niche, d'abord le plus possible de la **réaction rapide** du
     défenseur, puis, s'il n'y en a pas assez, sa **seconde ligne** (jamais sa
     première ligne), pour couvrir si possible 100 % d'une liaison dans chaque
     niche (`05-Fronts.md` §7.2, point 8). Le combat se joue sur **ces
     divisions et pas d'autres** : elle n'est ni recalculée ni complétée
     ensuite. Une infanterie de la contre-attaque détruite ou en fuite n'est
     donc pas remplacée : sans infanterie engagée, la contre-attaque est
     battue (§7.2, point 9).
   Un combat s'arrête à son issue
   (§7.2 : première ligne percée, réaction rapide battue, force détruite ou
   essoufflée) ou au bout de 50 rounds ; *provisoire* : sans issue au bout des
   50 rounds, la percée échoue comme une force essoufflée. Une percée donne
   donc **deux combats**, deux rapports et deux icônes ; un combat sans
   division en face (pas de réaction rapide) n'est pas enregistré.
6. **Enregistrement** : chaque combat produit un **rapport** gardé dans l'état
   (`Combat`) : son **type** (attaque sur tout le front, percée contre la
   première ligne, contre-attaque du défenseur), son issue pour
   l'attaquant, front, axe ou front entier, tour, attaquant, défenseur, liste
   des divisions des deux camps (type, état au début), et pour chaque round la
   perte d'état de chaque division (en entiers), les divisions détruites et en
   fuite, l'avancée ; pour chaque camp, les pertes du combat en hommes et en
   exemplaires de chaque type d'armement (pertes tirées, sans les excédents
   rendus au stock). Le rapport ne sert qu'à l'affichage ; le moteur ne le relit
   pas, et il est hors du hash (`GameState.combats`, comme `events`).
   *Provisoire* : les `FRONTS.combatHistoryPerPlayer` (20) derniers combats par
   joueur sont gardés, les plus anciens sont supprimés.

## 2. Affichage d'un combat

- **Icône sur la carte** : à la fin d'un combat, une icône de combat apparaît
  au milieu de la connexion de l'axe (pour une attaque sur tout le front : de la
  première connexion du front, *provisoire*), chez les deux joueurs concernés.
  Tant que le combat n'a pas été visionné, elle **clignote en bleu** si le
  joueur local a gagné, **en rouge** sinon. **Vainqueur** : le camp qui a
  perdu le moins d'infanterie (somme des pertes d'état des divisions de la
  niche d'infanterie ; *provisoire* : à égalité, le défenseur). Un combat
  **visionné** (replay ouvert, depuis la carte ou depuis la fenêtre d'un
  front) **disparaît de la carte** ; sinon l'icône reste. Quand plusieurs
  icônes sont au même endroit, la plus ancienne est au-dessus : les combats se
  revoient du plus vieux au plus récent. *Provisoire* :
  symbole ⚔ en attendant une icône de l'auteur ; « visionné » est retenu par la
  page, pour la partie en cours (pas dans l'état du moteur).
- **Replay** : un clic sur l'icône ouvre un panneau, au milieu de la carte. Le
  joueur local est à gauche, l'adversaire à droite (décisions de l'auteur,
  5 novembre 2026, sauf mention *provisoire*) :
  - **en tête, le type du combat** : « Attaque sur tout le front »,
    « Percée : première ligne » ou « Percée : contre-attaque du défenseur »,
    puis qui attaque ; le type est aussi sur chaque ligne de
    l'historique ;
  - **en haut, les totaux des deux camps** (attaque anti-infanterie, attaque
    anti-armure, PV des niches principales) : **les mêmes barres que dans la
    fenêtre d'un front** (05-Fronts §11.4, même code, `stattotals.ts`), mises à
    jour à chaque round sur les divisions en ligne ;
  - **une carte par type de division et par camp** : les icônes des divisions
    **empilées**, une par division (décalées de quelques pixels ;
    *provisoire* : 8 au plus), une **grosse barre de vie** (état moyen), et
    dessous les attaques **soft et hard** de la carte (somme) avec leurs
    icônes. Pas de nombre écrit. *Provisoire* : attaques et PV
    estimés sur l'état de chaque division (attaques des composants × état, ×
    `attackMultiplier` pour l'attaquant ; PV × état), le rapport ne gardant pas
    les exemplaires ;
  - au milieu, entre les deux colonnes, une **flèche** de l'attaquant vers le
    défenseur (vers la droite quand le joueur local attaque, vers la gauche
    quand il est attaqué) ;
  - deux colonnes face à face qui se rapprochent, puis chaque round est une
    courte étape : les barres de vie baissent, la perte s'affiche au-dessus de
    la carte, une division détruite quitte la pile ;
  - une division **en fuite** passe dans la **carte des fuyards** de son type,
    posée juste après celle du type, un peu en retrait vers l'arrière de son
    camp et en gris, avec le **drapeau blanc** sur la pile ; **l'ordre des
    cartes ne change pas** ; quand toutes les divisions restantes d'un type ont
    fui, la carte du type disparaît, il ne reste que celle des fuyards ;
  - un **renfort** (attaque sur tout le front) arrive de l'arrière dans une
    carte de son type posée juste après celle du type, **vers l'extérieur** du
    côté de son camp (à l'opposé de l'axe central), avec un **plus bleu** de
    16 × 16 pixels sur la pile, sans gris ; il y reste les 5 rounds de retrait,
    puis rejoint la carte de son type en première ligne (créée s'il n'y en
    avait pas) ;
  - **aucune décimale** dans l'écran de bataille (totaux, attaques, pertes) :
    entiers, puis « 5K », « 3M » ;
  - **à la fin**, à gauche et à droite, dans un cadre, les **pertes de chaque
    camp** (`08-Population.md` §11), et l'issue au-dessus (avancée, ville prise ; pour une percée : première ligne
    percée et saut, ou percée arrêtée ; contre-attaque repoussée, ou percée
    arrêtée).
  *Provisoire* : 0,45 seconde par round (22,5 secondes au plus pour 50 rounds) ;
  un bouton « Passer » va à la fin.
- **Historique** : la fenêtre d'un front liste les **4 derniers combats** de
  ce front (décision de l'auteur, 5 novembre 2026), du plus récent au plus
  ancien : moment, type, résultat ; pas les noms des joueurs (le front est déjà
  celui du joueur et de cet adversaire). Un clic sur une ligne ouvre le
  replay. Une ligne pas encore visionnée clignote, en bleu ou en rouge comme
  l'icône de la carte ; visionnée, elle redevient ordinaire. Une **petite
  croix** à droite de chaque ligne retire le combat de la liste et son icône
  de la carte (*provisoire* : retenu par la page pour la partie en cours,
  comme « visionné »). Un combat sort aussi de la liste quand le moteur le
  supprime (20 par joueur, §1).

## 3. Usines d'unités

1. **Une usine est placée sur une case** de la zone d'une ville du joueur, par
   un ordre (*provisoire* : n'importe quelle case de la zone, sans restriction ;
   les restrictions viendront après la V1). **Plusieurs usines peuvent être sur
   la même case.**
2. **L'icône d'une usine est celle de ce qu'elle produit** (type de division ou
   bien), affichée sur sa case.
3. **Une division n'a plus d'équipement** : elle a une **barre de vie** (son
   état, 0 à 100 %). On ne compte plus des exemplaires consommés par division ;
   les dégâts du combat baissent directement la barre de vie.
4. **Niveau et capacité** : un niveau d'usine **supporte une division** de son
   type (pour un bien, une quantité, §3.6). La **capacité** d'un type de division
   est la **somme des niveaux** des usines de ce type du joueur. Le joueur peut
   **augmenter le niveau** d'une usine par un ordre (*provisoire* : gratuit,
   sans limite). Une division n'est pas liée à une usine précise.
5. **Formation** : tant que le joueur a moins de divisions d'un type que sa
   capacité, les divisions manquantes sont **en formation** (fenêtre de
   formation) et se forment en continu, puis arrivent dans la réserve nationale
   (*provisoire* : en `COMBAT.divisionBuildSeconds` secondes, 60, toutes en même
   temps).
6. **Soin** : tant que le joueur a une capacité pour leur type, ses divisions
   abîmées se soignent en continu (*provisoire* : `COMBAT.healPercentPerSecond`
   %, 2, de barre de vie par seconde, toutes en même temps, hors combat).
   **Une division complètement détruite retourne dans la fenêtre de formation**
   et attend d'être produite de nouveau.
7. **Capacité dépassée** (usine supprimée ou améliorée) : les divisions en trop
   ne se soignent plus ; aucune n'est supprimée (*provisoire*).
8. **Quand toutes les divisions d'un type sont formées et à 100 %, ses usines ne
   travaillent plus** : elles n'emploient ni ouvriers ni fer.
9. **Coût** : *provisoire* : un niveau d'usine qui travaille (division en
   formation ou en soin) emploie les ouvriers et le fer d'une ligne du type
   d'armement principal de la division (valeurs actuelles de `ARMAMENT`). Si le
   fer ou les ouvriers manquent, formation et soin vont moins vite (même malus
   que `00-Game.md` §8).
10. **Plus de réserve d'armement** ni de création de division par le joueur
    (`create_division` disparaît) : les divisions viennent des usines et des
    centres de recrutement. *Provisoire* : `delete_division` gardé ; la division
    supprimée retourne en formation.

### 3.5 Types d'usines et amélioration

- **Types de base** : ceux du menu « Inaugurer une usine », plus un nouveau
  bouton **« Centre de recrutement »** (§4).
- **Amélioration** : une usine peut être **remplacée par une usine d'un type
  enfant** dans l'arbre de production existant (`00-Game.md` §8.4), par un ordre
  du joueur. L'usine améliorée prend la place de l'ancienne (même case, même
  niveau) : la capacité passe de l'ancien type de division au nouveau
  (§3.7 pour les divisions de l'ancien type en trop). *Provisoire* :
  amélioration gratuite, possible à tout moment.
- **L'usine d'armement d'infanterie disparaît** (fusils, mitrailleuses) : ses
  divisions viennent des centres de recrutement. *Provisoire* : la manufacture
  d'armes reste pour l'appui-feu, sa racine devient l'artillerie, avec les
  branches actuelles (antichar, antiaérien, puis les pièces blindées).
- Les forces spéciales sont hors de ce système pour l'instant.

### 3.6 Usines de biens

- **Usine de tracteurs** de niveau 1 : produit assez de tracteurs pour
  **mécaniser entièrement une ville** (le nombre de machines d'une mécanisation
  totale, `00-Game.md` §6.2, pour la surface d'une ville). *Provisoire* :
  surface de référence = la surface agricole moyenne d'une zone de ville.
- **Chantier naval** de niveau 1 : produit **la même quantité** que l'usine de
  tracteurs, soit assez de bateaux pour mécaniser entièrement une ville qui
  n'aurait que de l'eau autour d'elle.
- Pompes à vapeur : *provisoire* : même règle, assez pour mécaniser entièrement
  les mineurs d'une ville.
- Une usine de biens produit jusqu'à `niveau × quantité` machines en service,
  puis s'arrête ; elle reprend quand des machines s'usent.

## 4. Centres de recrutement

- Nouveau type, construit comme une usine (§3) : bouton « Centre de
  recrutement » dans « Inaugurer une usine ».
- Un centre de recrutement **recrute de la milice**, avec les mêmes règles de
  niveau, de production et de réparation qu'une usine (§3).
- **Amélioration** : il peut être amélioré pour recruter de **l'infanterie
  régulière**.

## 5. Choix provisoires (non tranchés par l'auteur)

1. Résolution : rounds du §6 de `05-Fronts.md` enchaînés (50 rounds au plus :
   décision de l'auteur).
2. Avancée du §7.1 appliquée à chaque round du combat.
3. 20 combats gardés par joueur ; à égalité de pertes d'infanterie, le
   défenseur gagne ; replay 0,45 s par round ;
   8 icônes empilées au plus par carte ; statistiques
   des cartes estimées sur l'état.
4. Placement d'une usine sur n'importe quelle case de la zone d'une ville.
5. Niveau d'une usine augmenté gratuitement, sans limite.
6. Formation d'une division en 60 s ; soin 2 %/s, toutes en même temps, hors
   combat.
7. Coût d'un niveau qui travaille : une ligne de son armement principal.
8. Amélioration gratuite, à tout moment ; divisions en trop ni soignées ni
   supprimées.
11. Dégâts du combat appliqués directement à la barre de vie : la perte
    d'état calculée par `05-Fronts.md` §6, sans exemplaires par composant.
9. Manufacture d'armes gardée pour l'appui-feu, racine = artillerie.
10. Quantité de référence des tracteurs : surface agricole moyenne d'une zone de
    ville ; pompes : mineurs d'une ville.

## 6. État de l'implémentation

- **Fait** : attaque sur tout le front instantanée (§1) — `attacks.ts`
  (`FrontSide.attackAt`), `combat.ts` (`resolveFrontAttacks`, `CombatRecord`),
  appelée par `applyTurn` après l'échange hors combat ; client : compte à
  rebours et historique dans la fenêtre d'un front (`frontwindow.ts`), icône
  sur la carte et replay (`combatreplay.ts`), rapports envoyés à la page dans
  `TickMessage.combats` (ceux du joueur local, quand la liste change).
- **Fait** : les deux combats de la percée instantanés (§1, point 5) —
  `combat.ts` (`resolveBreakthroughCombat`), `breakthroughs.ts`
  (`failBreakthroughCombat`) ; `CombatRecord.kind` et `success`.
- **Fait** : barre de vie sans équipement, usines et casernes par `08-Population.md`.
- **Pas encore** : les tests de `05-Fronts` qui supposent une attaque durable
  (`packages/engine/test/combat.test.ts`, `fronts.test.ts`, `scenario.ts`) ne
  sont pas encore adaptés.
