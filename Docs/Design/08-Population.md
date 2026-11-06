# 08 — Population en bonshommes et boîtes d'activités (branche `Human-Style-Pop`)

**Ce document fait foi pour son domaine** : population, nourriture, extraction,
production, formation des divisions et des machines, blessés, déblocage et panneau
de production. Il remplace, là où il les contredit :

- `00-Game.md` §1 (barre de boutons : usines et production), §3.3 (paiement du
  coût d'une ville), §3.7 (exception des villes à usine), §4 à §8.4, les lignes
  correspondantes de §9, §10 et §13, et §11 (onglets Population, Nourriture,
  Armement, panneau de production) ;
- `06-Combat-Simplifie.md` §3 à §3.6 et §4 (usines sur la carte, niveaux, centres
  de recrutement). Restent valables : la barre de vie (§3.3), et le soin (§3.6),
  tous deux repris ici ;
- `05-Fronts.md` §3.2, §3.3, §3.5, §4.3, §4.5 et le bouton de recrutement et la
  corbeille de §11.2.

L'onglet Ressources (flux) sera remanié plus tard : il reste en place, branché sur
le fer et les machines.

Décisions de l'auteur du 5 novembre 2026. Ce qu'il n'a pas tranché est marqué
« *provisoire* » et listé au §12. Les valeurs de configuration sont des valeurs
d'essai sauf mention contraire.

---

## 1. Unités

- **1 bonhomme vaut 1 000 habitants de l'ancienne échelle.** `population` compte
  des bonshommes, entiers, par joueur.
- Le joueur déplace ses bonshommes entre des **boîtes d'activités**. Le moteur ne
  répartit plus rien tout seul, sauf les cas écrits au §7 et au §8.
- **Tout est un bilan statique** :
  - agriculture et pêche donnent la capacité de population ;
  - les mineurs donnent la capacité de fer ;
  - les ouvriers donnent la limite d'un produit, en consommant du fer.

  Rien n'est stocké. Le temps n'intervient que par les délais du §6.
- Le mot « boîte » désigne ici une boîte d'activités. Elle n'a aucun rapport avec les
  boîtes de percée de `05-Fronts.md` §4.6.

## 2. Les boîtes

Les boîtes sont empilées de haut en bas dans le panneau de production.

| Boîte | Reçoit | Sortie | Entrée |
| --- | --- | --- | --- |
| Inactifs | bonshommes ; machines disponibles, sur une ligne par type | aucune | aucune |
| Blessés | seulement par le §8 | aucune | aucune |
| Agriculteurs | bonshommes, tracteurs | nourriture, donc capacité de population | aucune |
| Pêcheurs | bonshommes, bateaux de pêche | nourriture, donc capacité de population | aucune |
| Mineurs | bonshommes, pompes à vapeur | fer | aucune |
| Usine de machines, une par produit | bonshommes | limite d'un bien | fer |
| Usine de division, une par type | bonshommes | limite de ce type de division | fer |
| Caserne, une par type d'infanterie | bonshommes | limite de ce type de division | fer |

- **Ordre et priorité** : le joueur réorganise les boîtes par glisser-déposer.
  L'ordre sert de priorité : les ouvriers vont d'abord en haut (§7 bis), et les
  disparitions commencent par le bas (§6).
- **Inactifs** reste tout en haut (*provisoire*).
- **Blessés** se déplace comme les autres, mais sa position ne joue aucun rôle de
  priorité. On ne peut pas en retirer de bonhomme.
- **Il n'y a pas d'usine sur la carte.** Plus de bouton « Inaugurer une usine », de
  logos ni de villes agrandies. Une boîte n'est liée à aucune ville : prendre une
  ville ne retire aucune boîte.
- Une boîte débloquée (§9) est toujours présente, même vide. Il n'y a pas de bouton
  de création.

### 2.1 Places

Agriculteurs, Pêcheurs et Mineurs ont un nombre de places, tiré des cases du joueur :

```
places = floor(cases / cases_par_travailleur)
```

| Boîte | Cases | `tilesPerWorker` |
| --- | --- | --- |
| Agriculteurs | `farmTiles` | `FARMING.tilesPerWorker`, 300 |
| Pêcheurs | `seaTiles` | `FISHING.tilesPerWorker`, 300 |
| Mineurs | cases de fer | `MINING.tilesPerWorker`, 100 |

Ces valeurs viennent de l'ancienne mécanisation de base (0,3 case par personne pour
l'agriculture et la pêche, 0,1 pour les mines), qui garde l'équilibre d'une ville.

Une machine et un bonhomme prennent chacun une place. Un bonhomme déposé dans une boîte
pleine est refusé. Une machine déposée dans une boîte sans assez de places libres prend
la place d'un bonhomme, qui retourne dans Inactifs ; elle n'est refusée que si les autres
machines occupent déjà toutes les places. Si les places baissent (ville prise), le trop-plein retourne dans
Inactifs, les bonshommes et les machines chacun sur leur ligne (*provisoire*).

**Surface en trop** : les cases qui ne suffisent pas à une place entière ne servent pas. Après la
dernière place, une case de même aspect sert de jauge vers la prochaine place : son bas est visible,
son haut transparent. La limite suit `reste / cases_par_travailleur`, de 0 % à 80 % de la hauteur.
Les 20 % restants arrivent d'un coup avec la place, pour qu'une jauge presque pleine ne passe pas
pour une place disponible.

**Usine de machines** : ses places sont les ouvriers qu'il faut pour produire une machine par
place de l'activité qui les reçoit :

```
places = ceil(places de l'activité × workersPerUnit / unitsPerWorker)
```

Avec 8 places d'agriculteurs et un ouvrier qui produit 2 tracteurs, l'usine a 4 places. Quand
le joueur pourra exporter, cette capacité pourra augmenter (commerce non décrit).

**Caserne et usine de division** : ses places suivent la production visée (§7 ter).

## 3. Capacité de population

**Une machine vaut un travailleur** : même place, même sortie. Elle ne va que dans
sa boîte : tracteur dans Agriculteurs, bateau dans Pêcheurs, pompe dans Mineurs. Il
n'y a besoin de personne pour l'actionner. Le gain d'une machine est donc le
bonhomme qu'elle libère.

```
travailleurs = bonshommes + machines de la boîte
surface_agricole = min(farmTiles, travailleurs × FARMING.tilesPerWorker)
blé     = fertilitySum × surface_agricole / farmTiles
surface_pêchée = min(seaTiles, travailleurs × FISHING.tilesPerWorker)
poisson = surface_pêchée × FISHING.foodPerWorker / FISHING.tilesPerWorker
nourriture = FOOD.base + FOOD.perCity × villes + blé + poisson
capacité = ceil(nourriture / POPULATION.foodPerPawn)
```

Multiplier avant de diviser. `foodPerPawn` vaut 1 000. Avec les valeurs actuelles,
un agriculteur sur une terre de fertilité 5 donne 1,5 et un pêcheur 1.

`FISHING.tileYield` et `tileYieldMax` disparaissent, comme la mécanisation et `GOODS_DECAY`.

Le panneau affiche la capacité de chaque boîte en décimal (`nourriture / foodPerPawn`).
Le **rayon d'exploitation** (`00-Game.md` §6.6) reste calculé par le client, à partir
de la surface agricole, de la surface pêchée et des cases de fer exploitées.

## 4. Fer

```
surface_minière = min(cases de fer, travailleurs × MINING.tilesPerWorker)
fer_produit = surface_minière × RESOURCES.iron.capacityPerTile
```

Le fer est une **réserve permanente**, comme la capacité de population : une boîte
d'usine ou une caserne réserve son fer tant qu'elle a sa sortie. Rien n'est stocké,
et une armée complète continue de réserver son fer.

**Malus proportionnel** : s'il manque du fer, toutes les boîtes qui en prennent perdent la même
part de leur production. L'en-tête du panneau affiche `−X % de production`.

```
unités = floor(ouvriers × unitsPerWorker / workersPerUnit)
fer_demandé = somme, sur les boîtes, de unités × ironPerUnit
unités_servies = fer_demandé ≤ fer_produit ? unités : floor(unités × fer_produit / fer_demandé)
X = 100 − floor(fer_produit × 100 / fer_demandé)
```

Le fer que l'arrondi laisse va ensuite aux boîtes du haut, unité par unité (*provisoire*) : sans
cela, une boîte d'une seule unité perdrait tout au moindre manque. `unités_servies` est la
**limite** du produit, et les unités en trop passent au §6. Une boîte sans fer en entrée n'a pas de malus.

Une caserne peut prendre du fer en entrée, comme une usine : `ironPerUnit` est propre
à chaque boîte. Les usines de chars n'ont pas de mécanique de blessés (§8).

## 5. Limite des machines et des divisions

- **Usine de bien** (tracteurs, bateaux de pêche, pompes à vapeur) : la limite est le
  nombre maximal de machines de ce type, dans Inactifs et dans sa boîte.
- **Usine ou caserne de division** : la limite est le nombre maximal de divisions de
  ce type. La caserne vaut un bonhomme pour une division (`workersPerUnit` 1).
- La division n'a plus d'équipement : elle n'a qu'une **barre de vie** (`Division.state`,
  0 à `STATE_SCALE`). Les dégâts du combat la baissent directement.
- Attaques d'une division : celles de sa définition × son état.
- Une division n'est liée à aucune usine ni à aucun bonhomme précis.
- **Soin** : tant que le joueur a une limite pour leur type, ses divisions abîmées se
  soignent hors combat (*provisoire* : `COMBAT.healPercentPerSecond`, 2 % par seconde,
  toutes en même temps). Une division en trop (§6) ne se soigne pas.
- **Limite des élites** : les places et la limite de la caserne d'élites sont plafonnées à
  `floor(divisions d'infanterie du joueur / ELITE_TROOPS_RATIO)`, élites comprises, en formation ou non.
  Si l'infanterie baisse, les places en trop disparaissent et leurs ouvriers retournent dans Inactifs.

## 6. Apparition et disparition

**Chaque unité a son propre compteur**, tout est en parallèle. Une unité est un
bonhomme, une machine ou une division.

- **Apparition** : si `limite > existants + à venir`, un compteur démarre pour
  chaque unité manquante. À la fin du compteur, l'unité apparaît.
  - Population : compteur `POPULATION.arrivalTurns`, le bonhomme arrive dans Inactifs.
    La limite est la capacité (§3).
  - Machine : compteur `GOODS_TIMING.arrivalTurns`, beaucoup plus court que celui des
    divisions, la machine arrive sur sa ligne d'Inactifs.
  - Division : `productionTurns` de son type, sinon `DIVISION_TIMING.defaultProductionTurns`.
    Elle existe tout de suite dans la réserve nationale, en formation (`formedTick`),
    et elle apparaît dans la section FORMATION de l'onglet Forces. La **milice** est
    quasi instantanée, les autres types prennent plus de temps.
- **Disparition** : si `existants > limite`, un compteur démarre pour chaque unité
  en trop. Elle clignote jusqu'à la fin de son compteur, puis disparaît.
  - Population : `POPULATION.leaveTurns`. Machine : `GOODS_TIMING.leaveTurns`.
    Division : `DIVISION_TIMING.leaveTurns`.
- Si l'écart se referme avant la fin d'un compteur, le compteur le plus récent est
  annulé (*provisoire*). Une unité à venir annulée n'apparaît pas, une unité en sursis
  ne clignote plus.

**Quelles unités partent** :

- Population : Inactifs d'abord, puis de la boîte la plus basse vers le haut. Blessés
  n'est touchée qu'à la toute fin (*provisoire*). Un bonhomme d'une caserne qui
  disparaît retire aussi sa place (§7).
- Machines : sa ligne d'Inactifs d'abord, puis sa boîte d'activité.
- Divisions (*provisoire*) : d'abord celles en formation, puis les plus abîmées, puis
  le plus grand identifiant.

Le client déduit les pions à faire clignoter de ces règles et du nombre de compteurs.

## 7. Casernes

- Un bonhomme déposé dans une caserne y ajoute une **place**. Le nombre de places est
  la cible du joueur. Sortir un bonhomme retire sa place.
- **Une place vide se remplit toute seule** dès qu'un inactif est disponible, casernes
  du haut d'abord. Le joueur règle le nombre de places avec les flèches (§7 ter).
- Une place vide ne donne aucune limite : seuls les bonshommes présents comptent.

### 7 bis. Auto-assignation

Une option du menu « Options » (§11), propre à chaque joueur, **allumée au départ**.

- **Allumée** : bonshommes et machines se placent seuls. De haut en bas, les inactifs remplissent
  les postes non barrés d'Agriculteurs, Pêcheurs, Mineurs et des usines de machines. Une machine
  d'Inactifs va seule dans sa boîte, sur un poste non barré, et remplace un ouvrier si la boîte est
  pleine. Le glisser-déposer des pions n'existe pas.
- **Éteinte** : le glisser-déposer des pions est le seul moyen de les déplacer. Les croix ne
  s'affichent pas et ne réagissent pas, et elles restent mémorisées.
- **Croix** : au survol d'une ligne, le joueur peut poser une croix rouge (`misc-red-cross.png`)
  sur un poste, vacant ou occupé par un ouvrier, en cliquant dessus. Un ouvrier barré quitte la
  ligne et va sur les autres lignes, par ordre de priorité. Une machine se comporte comme un
  ouvrier : barrée, elle retourne sur sa ligne d'Inactifs et y reste, sans sortie.
- **Barrer une case barre aussi toutes les cases à sa droite**. Au survol, les cases concernées
  montrent déjà la croix, à 50 % de transparence.
- Cliquer sur une case barrée la réactive, avec les cases barrées à sa gauche (*provisoire*).
- Les casernes et les usines de divisions ont les mêmes croix, sur leurs places. C'est redondant avec
  les flèches (§7 ter), pour la cohérence : une place barrée reste affichée et compte toujours
  dans le maximum, fixé par les flèches ; la croix ne règle que l'assignation des ouvriers.
  La flèche vers le bas retire d'abord les places barrées.
- **Priorité** : une ligne qui a de la place, parce que ses places augmentent ou qu'une croix est
  retirée, prend les ouvriers des lignes plus basses, en commençant par la plus basse, puis la
  suivante. Les inactifs passent avant. Les machines ne sont pas prises.

### 7 ter. Production visée

Les casernes et les usines de divisions se pensent en produit final. Deux flèches, vers le haut
et vers le bas, tout à droite de la boîte, à droite de l'icône du produit, augmentent ou
diminuent la production visée de 1, de 5 avec Maj, de 10 avec Ctrl. Le nombre de places suit
(`production visée × workersPerUnit`). Une place vide se remplit comme au §7, dans les deux modes,
et les ouvriers en trop retournent dans Inactifs. La production visée ne passe pas sous 0.

La sortie affiche deux nombres : à gauche du trait oblique, ce que permettent les ouvriers
présents ; à droite, le maximum réglé. Elle ne distingue pas les divisions en formation des
divisions déployées ; le survol donne le nombre d'actives et le nombre en formation.

## 8. Blessés

Le jeu a deux vitesses : la population grandit vite, mais les pertes au combat doivent
coûter du temps. Les blessés restent dans la population, occupent de la capacité, et
ne se soignent que lentement.

- **Entrée** : une division d'**infanterie** détruite (barre de vie à 0, *provisoire*,
  condition exacte à déterminer) fait passer un bonhomme de sa caserne à Blessés. Sa
  place reste : un inactif la remplit aussitôt s'il y en a un (§7), sinon elle reste
  vide. Encerclement compris.
- Une division de **chars ou d'appui-feu** détruite ne fait aucun blessé : elle se
  reforme tant que la limite le permet (§6).
- **Soin, un bonhomme à la fois** :

  ```
  tours = min(POPULATION.hurtHealMaxTurns, floor(POPULATION.hurtHealTurnsTimesPop / population))
  ```

  `hurtHealTurnsTimesPop` vaut 100 000, `hurtHealMaxTurns` 4 000 : mêmes rythmes que
  l'ancienne guérison (400 s par bonhomme jusqu'à 25 bonshommes de population, 100 s à
  100, 10 s à 1 000). Le compteur démarre quand aucun soin n'est en cours et que Blessés
  n'est pas vide. La durée est calculée au démarrage.
- **Fin du soin** : le bonhomme passe dans Inactifs (*provisoire*).

## 9. Déblocage

- Au départ, sont ouvertes : Inactifs, Blessés, Agriculteurs, Pêcheurs, Mineurs.
- La **caserne de milice** se débloque dès que la population totale atteint 10. Sa boîte verrouillée
  montre l'icône d'inactif comme ce qui débloque, et la barre montre la population sur ce seuil.
- L'**usine de pompes à vapeur** se débloque dès que Mineurs compte 4 ouvriers, et l'**usine de bateaux
  de pêche** dès que Pêcheurs en compte 6. Un seuil atteint reste acquis, quel qu'il soit, et la barre de la boîte
  verrouillée montre les ouvriers présents sur le seuil.
- Les autres boîtes se débloquent par leur **boîte parente** : chaque tour, le compteur
  de chaque boîte enfant verrouillée gagne le nombre d'ouvriers de la boîte parente
  dont la production est servie en fer. Pour un coût de 500, un ouvrier met 500 tours,
  deux ouvriers 250. Chaque enfant a son compteur, et la progression n'est jamais perdue.
- `U` est `UNLOCK.turns`, 500. Arbre :

  ```
  Population (10)
  └── caserne de milice
      └── caserne de réguliers (U)
          ├── usine - artillerie (U / 2)
          │   ├── usine - antichar (U)
          │   │   └── usine - antichar blindé (U)
          │   └── usine - artillerie automotrice (U)
          ├── usine - antiaérien (U)
          │   └── usine - antiaérien automoteur (U)
          └── caserne d'élites (U, *provisoire*)

  Mineurs (4 ouvriers)
  └── usine - pompe à vapeur
      └── usine - tracteur (U)
          └── usine - chenillette (U)
              ├── usine - char d'infanterie (U)
              └── usine - char rapide (U)
                  └── usine - char moyen (U)

  Pêcheurs (6 ouvriers)
  └── usine - bateau de pêche
  ```

  L'artillerie, ancienne enfant des fusils, coûte deux fois moins que l'antiaérien,
  ancienne enfant des mitrailleuses, comme l'a décidé l'auteur.
- **Boîte débloquée** : elle n'entre pas seule dans la liste. Elle clignote en bleu tout en haut
  des boîtes verrouillées. Quand le joueur clique dessus, un panneau d'information montre la
  description de l'unité et ses statistiques, et la boîte rejoint le bas des boîtes ouvertes.
- **Suppression** : une croix rouge, tout à droite d'une usine ou d'une caserne, supprime la
  boîte. Ses ouvriers retournent dans Inactifs, et ses unités deviennent en trop (§6). Elle passe
  sous les boîtes ouvertes, avec le texte « Cliquer pour recréer la ligne », au-dessus des boîtes
  pas encore débloquées, dont un séparateur en pointillé clair la sépare. Un clic la remet au bas
  des boîtes ouvertes, vide, sans panneau d'information. Agriculteurs, Pêcheurs, Mineurs, Inactifs et Blessés n'ont
  pas cette croix (*provisoire*).

## 10. Ordres

| Ordre | Paramètres | Valide si | Effet |
| --- | --- | --- | --- |
| `move_pawn` | boîte de départ, boîte d'arrivée, genre (bonhomme ou machine), bien pour une machine, nombre | boîtes ouvertes, assez d'unités au départ, départ différent de Blessés, arrivée différente de Blessés, machine vers sa boîte ou Inactifs, assez de places (§2.1) | déplace les unités ; casernes : §7 ; une machine peut renvoyer des bonshommes dans Inactifs (§2.1) |
| `set_activity_order` | boîte, position | boîte ouverte autre qu'Inactifs | change l'ordre des boîtes |
| `set_auto_assign` | oui / non | toujours | §7 bis |
| `open_activity` | boîte | fermée, déblocage fini | la rejoint au bas des boîtes ouvertes (§9) |
| `close_activity` | boîte | usine ou caserne ouverte | la supprime, ouvriers dans Inactifs (§9) |
| `set_disabled_slots` | boîte, nombre | boîte à places (§2.1, §7 ter), au plus ses places moins ses machines | fixe les postes barrés, depuis la droite (§7 bis) |
| `change_production_target` | boîte, écart | caserne ou usine de division ouverte | §7 ter |
| `found_city` | la case | `00-Game.md` §3.3 | paie en bonshommes (ci-dessous) |

Disparaissent : `set_farm_share`, `build_factory`, `delete_factory`, `create_line`,
`set_active_lines`, `set_city_priority`, `set_line_priority`, `create_division`,
`delete_division`, `set_forced_mobilization`.

**Fondation** : la première ville est gratuite et donne `POPULATION.initial` bonhomme,
1. Le coût des suivantes est la formule de `00-Game.md` §3.3 divisée par 1 000, arrondie
vers le haut (*provisoire*) : 1, 2, 2, 3… Il est payé par les inactifs d'abord, puis par les
ouvriers des boîtes, de la plus basse à la plus haute, même si toute la population est assignée.
Les blessés ne paient pas : l'ordre n'est invalide que si la population sans les blessés ne suffit
pas. Une place de caserne ou d'usine reste, et se remplit de nouveau.

## 11. Panneau de production

Le panneau occupe environ 600 px. De haut en bas : un en-tête (population / capacité,
fer produit et réservé), les boîtes ouvertes dans leur ordre, les boîtes supprimées, un
séparateur en pointillé clair, puis les boîtes débloquées et les boîtes verrouillées.

**Menu « Options »** : un menu déroulant au survol, dans la barre des onglets, au-dessus du
panneau de production. Il contient la taille des icônes de pions et l'auto-assignation (§7 bis). Deux carrés, de
16 × 16 et de 32 × 32, suivis du texte « Icônes ». Un clic sélectionne un carré et
désélectionne l'autre ; le carré sélectionné est en bleu. Une partie commence en grandes icônes.
Dès que la population dépasse 50, le panneau passe en petites icônes, une fois par partie, et le
menu « Options » clignote. À son ouverture, il cesse et un message à côté du menu explique le passage. Le joueur peut ensuite revenir en grandes icônes.

**Une boîte** a un fond de couleur légère propre à son activité (par exemple vert très
clair pour les agriculteurs) et une bordure marquée. Ligne : poignée de réorganisation,
entrée, flèche vers la droite, zone des pions, flèche vers la droite, sortie.

- L'**entrée** et la **sortie** sont dans la boîte, sur une petite tuile à fond clair, sans
  couleur de ressource. Sans entrée, la tuile et sa flèche disparaissent, et la colonne
  reste vide pour garder l'alignement. Les colonnes sont alignées d'une boîte à l'autre.
- Le titre et le nombre de places sont au-dessus des pions, dans la colonne centrale. Une
  usine s'appelle « Usine - » suivi du nom de ce qu'elle produit, sans nom inventé.
- Dans une boîte, les machines sont toujours à gauche et les bonshommes à droite.
- Pendant un glisser, une boîte qui accepte le dépôt est mise en surbrillance, y compris
  quand des machines y renvoient des bonshommes dans Inactifs.
- **Survol des sorties** : nourriture, « Augmente la limite de population » ; fer, « Sert à produire
  des machines » ; machine, « Remplace les » suivi du métier et de son icône.
- **En-tête** : deux boîtes côte à côte, sans séparation visuelle, sur deux tiers et un tiers de la
  largeur. À gauche : en gros et en gras, `X` et le symbole de population, un trait oblique, `Y` et le
  symbole de nourriture (`misc-food-ham.png`), en 32 × 32, `X` en rouge si la population dépasse la
  nourriture ; puis, à la même taille, `réservé / produit` du fer avec son icône en 32 × 32, en rouge si les boîtes en
  demandent plus qu'il n'en est produit, un petit « ? », et `−X % de production`. Le survol du « ? »
  donne l'utilisation actuelle, la production actuelle et maximale, la part de chaque boîte, avec l'icône de son
  produit en 16 × 16, et les hachures de la carte. Chaque autre ressource aura sa ligne, avec le même fonctionnement. Un petit point d'interrogation suit le gigot : le survol de l'un ou de l'autre détaille la nourriture : base ; par ville (`icon-town-16.png`) ;
  par agriculteur ou tracteur ; par pêcheur ou bateau ; chacun avec une flèche vers son total. À
  droite : les messages, pour l'instant « Nouvelle ligne disponible », quand une ligne débloquée
  attend. Il clignote comme ces lignes, et un clic fait défiler le panneau jusqu'à elles.
- **Sortie** : `+N` et son symbole pour la nourriture (agriculteurs, pêcheurs) ou du fer, « existants / limite » pour
  une usine de machines, « permis / maximum » pour une production visée (§7 ter).
- Les **pions** sont dans une case de 22 px, avec les icônes de 16 × 16 de
  `client/public/icons/population/` (case de 38 px et icône agrandie à 32 × 32 avec l'option). S'il y en a trop pour une ligne, ils passent à la
  ligne et la boîte grandit vers le bas.
- Inactifs : une ligne de population, puis une ligne par type de machine, sans libellé. Le
  pion d'un inactif est l'icône de base `pop-default` ; `pop-inactive`, à rayures, n'est pas utilisée.
- **États d'un pion** : normal ; à venir, contour et barre de compteur ; en sursis, il
  clignote ; poste vacant ou place vide, case à fond gris très léger et en pointillés, avec l'icône pâle du bonhomme
  qui finira dans la boîte, autant de cases que de postes vacants.
- **Réorganisation** : pendant le glisser d'une boîte, c'est l'interstice entre deux boîtes
  qui est mis en surbrillance, le plus proche de la souris, même au-dessus d'une boîte. La
  boîte est déposée dans cet interstice.
- **Sélection**, auto-assignation éteinte seulement (§7 bis), un glisser prend
  le pion sous la souris et tous les pions de même type à sa droite, lignes du dessous
  comprises. Pendant le glisser, le curseur disparaît, remplacé par l'icône des pions déplacés.
- **Boîte parente** : un petit symbole de cadenas ouvert à côté du titre, tant qu'une de ses boîtes
  enfants reste verrouillée. Son survol liste ces boîtes avec la barre de progression de chacune.
  Rien n'est affiché hors du survol.
- **Boîte verrouillée** : très pâle, peu de contraste. De gauche à droite : l'icône de ce qui est
  débloqué, le cadenas fermé, un petit trait horizontal, le symbole de ce qui débloque (le produit du
  parent, ou son bonhomme si le parent est Agriculteurs, Pêcheurs ou Mineurs), puis la barre de
  progression. Dans la barre, les chiffres sont à gauche et le nom à droite. Les plus
  proches du déblocage sont en haut, et le panneau défile vers le bas. Le survol donne
  plus d'explications.

**Disparaissent** : les onglets Population, Nourriture et Armement, le bouton « Inaugurer
une usine », le bouton RECRUTEMENT et la corbeille de l'onglet Forces, la mobilisation
forcée, la jauge d'armement de la fenêtre d'un front.

Le rapport de combat donne les pertes en divisions et en état, à la place des hommes et
du matériel (*provisoire*).

## 12. Choix provisoires (non tranchés par l'auteur)

1. Condition de destruction d'une division : barre de vie à 0.
2. Barre de vie de `06-Combat-Simplifie.md` §3.3, soin de 2 % par seconde hors combat.
3. Attaques d'une division : la somme des anciens composants, facultatifs compris.
4. Bonhomme soigné : il passe dans Inactifs.
5. Disparitions de population : Blessés en dernier.
6. Divisions en trop : en formation, puis les plus abîmées, puis le plus grand identifiant.
7. Inactifs reste fixe en haut.
8. Ville prise : le trop-plein d'une boîte retourne dans Inactifs.
9. Coût de fondation arrondi vers le haut ; places de caserne gardées après le paiement.
10. Capacité arrondie vers le haut.
11. Rapport de combat en divisions et en état.
12. Caserne d'élites débloquée par les réguliers.
13. Annulation du compteur le plus récent quand un écart se referme.
19. `unitsPerWorker` à 2 pour les usines de machines, valeur de l'exemple de l'auteur.
20. Les places des usines de machines ne sont pas barrées au départ : elles se remplissent.
23. Deux ouvriers par unité pour les trois chars et l'appui-feu sur chenilles (valeur de l'auteur) ; une seule pour les autres.
21. `move_pawn` reste un ordre valide pour le moteur en auto-assignation ; seul le panneau ne le propose pas.
22. Les casernes, comme les usines de divisions, ont leur production visée et leurs flèches.
14. Joueur sans ville, avant sa fondation ou éliminé : l'économie ne le traite pas. Il n'y a
    plus de nomades avant la première ville.
15. Trop-plein d'une boîte : les bonshommes repartent d'abord, puis les machines.
16. Milice sans fer : sinon, un joueur sans fer dans sa première ville ne pourrait ni recruter
    ni débloquer les réguliers.
17. Glisser plus grand que les places libres : il est réduit à ce qui tient.
18. Pertes d'état du rapport affichées en pourcentage, 100 % valant une division.

**Valeurs à fixer avec l'auteur** : les délais du §6, `workersPerUnit` et `ironPerUnit` de
chaque boîte, le coût `U` et le coût en bonshommes des villes.

## 13. Notes d'implémentation

- Une unité n'est définie qu'à un seul endroit : son entrée de `DIVISIONS` (`config/divisions.ts`)
  porte ses attaques et sa boîte (`production`). `ACTIVITIES` ne contient que le reste.
- Dans le code, une boîte de ce document s'appelle une **activité** (`Activity`,
  `Player.activities`) : `Box` et `state.boxes` désignent déjà les boîtes de percée.
- Tout ce qui décide d'une règle entre dans le hash : activités et leur ordre, compteurs,
  déblocage, `Division.state`, tour de départ d'une division.
- Compteurs : des tableaux de tours de fin, triés, parcourus dans l'ordre (règle 2).
- `Player.soldiers` n'existe plus : le nombre de soldats se lit dans les casernes.
- `applyLoss` n'utilise plus le générateur aléatoire : `Division.state` perd directement
  `f × STATE_SCALE / LOSS_SCALE`.
