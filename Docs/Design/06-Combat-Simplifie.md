# 06 — Combat simplifié et usines d'unités (branche `Simpler-Combat`)

**Ce document fait foi pour son domaine** : combats instantanés et leur replay,
usines placées sur la carte qui produisent des divisions, centres de
recrutement. Il remplace, sur cette branche, les parties suivantes, qui ne font
plus foi là où elles le contredisent :

- `05-Fronts.md` §5 (attaques), §6 (round de combat continu), §7.1 et §7.2
  (déclenchement de l'avancée et de la percée) ;
- `00-Game.md` §8 (usines à lignes, spécialisation, malus de production des
  lignes), §8.1, §8.2, §8.3 (réserve d'armement) et §8.4 (types d'usines) ;
- `05-Fronts.md` §3.5 (création des divisions par le joueur).

Décisions de l'auteur du 4 novembre 2026. Ce que l'auteur n'a pas tranché est
marqué « *provisoire* » et listé au §5. Version stable d'avant : tag git
`avant-combat-simplifie`.

But : le combat continu fait des dégâts sans qu'on en voie l'effet, et les
quantités d'équipement produites sont abstraites. Deux leviers : un combat est
un événement ponctuel qu'on peut revoir ; une usine produit une division.

---

## 1. Combat instantané

1. **Lancement** : le joueur clique sur l'attaque (attaque sur tout le front, ou
   percée sur un axe). Un **délai de 5 secondes** (`FRONTS.attackDelayTurns`,
   50 tours, la même durée que les délais de la percée) s'écoule, affiché par un
   compte à rebours sur le bouton d'attaque, qui sert aussi à annuler.
2. **Résolution** : au tour où le délai finit, le moteur calcule **tout le
   combat dans ce tour**. Il enchaîne les rounds du §6 de `05-Fronts.md` (mêmes
   dégâts, mêmes pertes, fuites, échanges ; *provisoire*) pendant **50 rounds**
   (`FRONTS.combatMaxRounds`), ou jusqu'à ce qu'**un camp n'ait plus
   d'infanterie engagée** en première ligne (décision de l'auteur, 5 novembre
   2026), ou jusqu'à une prise de ville. Un camp sans infanterie engagée au
   moment du lancement ne combat pas : le combat n'a aucun round et n'est pas
   enregistré. Les dégâts sont appliqués aux
   divisions dans ce tour. Pendant ces rounds, l'échange avec la seconde ligne
   suit la règle **du combat** (`05-Fronts.md` §5.3 : sous la moitié de l'état
   d'une division de seconde ligne), pas celle du repos : sinon chaque division
   touchée serait remplacée aussitôt par une division intacte de seconde ligne.
3. **Issue** : *provisoire* : l'avancée du §7.1 de `05-Fronts.md` est appliquée
   à chaque round, comme avant (50 rounds avancent comme 50 secondes
   d'attaque), prise de ville comprise.
4. **Plus d'état d'attaque durable** : une attaque est un ordre ponctuel. Un
   nouveau clic lance un nouveau combat (après un nouveau délai). Pas de combat
   en dehors de ces événements : un front sans combat lancé ne fait aucun dégât.
5. **Enregistrement** : chaque combat produit un **rapport** gardé dans l'état
   (`Combat`) : front, axe ou front entier, tour, attaquant, défenseur, liste
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
  *Provisoire* : elle reste 30 secondes ou jusqu'au clic ; symbole ⚔ en
  attendant une icône de l'auteur.
- **Replay** : un clic sur l'icône ouvre un panneau, au milieu de la carte. Le
  joueur local est à gauche, l'adversaire à droite (décisions de l'auteur,
  5 novembre 2026, sauf mention *provisoire*) :
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
  - deux colonnes face à face qui se rapprochent, puis chaque round est une
    courte étape : les barres de vie baissent, la perte s'affiche au-dessus de
    la carte, une division détruite quitte la pile ;
  - une division **en fuite** passe dans la **carte des fuyards** de son type,
    posée juste après celle du type, un peu en retrait vers l'arrière de son
    camp et en gris, avec le **drapeau blanc** sur la pile ; seule de son type,
    sa carte recule sur place ; **l'ordre des cartes ne change pas** ;
  - **à la fin**, à gauche et à droite, dans un cadre, les **pertes de chaque
    camp** : hommes et matériel (exemplaires de chaque type d'armement), et
    l'issue au-dessus (avancée, ville prise).
  *Provisoire* : 0,45 seconde par round (22,5 secondes au plus pour 50 rounds) ;
  un bouton « Passer » va à la fin.
- **Historique** : la fenêtre d'un front liste les derniers combats de ce
  front (tour, attaquant, résultat) ; un clic sur une ligne ouvre le replay.

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
3. 20 combats gardés par joueur ; icône 30 s ; replay 0,45 s par round ;
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
- **Pas encore** : la percée garde ses rounds continus (`05-Fronts.md` §7.2) ;
  usines d'unités, barre de vie sans équipement, centres de recrutement (§3,
  §4) ; les tests de `05-Fronts` qui supposent une attaque durable
  (`packages/engine/test/combat.test.ts`, `fronts.test.ts`, `scenario.ts`) ne
  sont pas encore adaptés.
