# Réglages du moteur — guide d'édition

Chaque fichier de ce dossier contient des nombres et des listes que le moteur
lit pendant la partie. Ce sont des modules TypeScript : ils sont compilés avec
le moteur et embarqués dans le même bundle (règle 2 du `CLAUDE.md`). Ils ne sont
jamais lus ou téléchargés au lancement.

`../config.ts` ré-exporte les douze fichiers. Le reste du code importe depuis
`config.ts`, jamais depuis un fichier du dossier.

Tous les joueurs d'une partie doivent faire tourner le même build. Si deux
joueurs ont des valeurs différentes, leurs états divergent dès que la valeur
intervient, sans message d'erreur.

---

## 1. Modifier une valeur existante

Changer un nombre ne demande aucune autre modification : le moteur, le
catalogue envoyé à la page (`client/src/solo.ts`, `factoryCatalog`) et les
infobulles relisent la nouvelle valeur. Après une modification : `npm run
typecheck`, puis `npm test` (certains tests comparent des résultats chiffrés).

| Fichier | Ce qu'il règle | Lu par |
| --- | --- | --- |
| `map.ts` | taille, relief et niveau de la mer de la carte de test ; `mountainAltitude` (altitude d'une montagne) | `mapgen.ts` ; `mountainAltitude` aussi par `resources.ts` |
| `sea-zones.ts` | découpage des mers en zones | `seazones.ts` |
| `cities.ts` | rayons d'expansion et de contrôle, coût de fondation | `cities.ts`, `client/src/bots.ts`, `client/src/solo.ts` |
| `workforce.ts` | population de départ, nourriture, fertilité, mécanisation de l'agriculture, de la pêche et de l'extraction | `economy.ts`, `cities.ts`, `mapgen.ts`, `client/src/bots.ts`, `client/src/solo.ts` |
| `resources.ts` | présence du fer et de l'aluminium sur la carte (`threshold` : plus haut = plus rare ; `mountainBonus` : plus haut = plus en montagne), capacité d'extraction d'une case de fer. Régler avec `npm run viz:resources` | `map.ts`, `mapgen.ts`, `resources.ts`, `economy.ts` |
| `goods.ts` | production, ouvriers et fer par ligne, pour chaque machine | `factories.ts` (`productConfig`), `economy.ts` |
| `armament.ts` | idem pour chaque type d'armement ; stock cible et déclin | `factories.ts`, `economy.ts` |
| `factories.ts` | délais de déblocage et de croissance, spécialisation, arbres de production | `economy.ts`, `factories.ts`, `state.ts` |
| `fronts.ts` | réglages des fronts : largeur d'une connexion, priorités, délais de transfert et de combat, avancée, percée, prise de ville, encerclement (valeurs de l'auteur, 05-Fronts §12) | `fronts.ts`, `troops.ts`, `combat.ts`, `conquest.ts`, `client/src/solo.ts` |
| `units.ts` | unités militaires (attaques, largeurs, PV, multiplicateurs décimaux à deux décimales au plus, valeurs de l'auteur) et niches des fronts ; convertis une fois en entiers par `src/units.ts` | `units.ts`, `troops.ts`, `combat.ts`, `client/src/solo.ts` |
| `diplomacy.ts` | durée de vie d'une proposition de pacte ou de paix (`DIPLOMACY.proposalTurns`, en tours) ; **valeur provisoire, à fixer par l'auteur** | `diplomacy.ts`, `client/src/solo.ts` (fin de la barre de temps restant) |
| `limits.ts` | plafonds liés à la taille des tableaux | `cities.ts`, `state.ts` |

`limits.ts` n'est pas un fichier de réglages : `MAX_PLAYERS` et `MAX_CITIES`
viennent de la taille des `Uint16Array` de la carte. Ne pas y toucher sans
changer ces tableaux.

### Contraintes à respecter

Aucun contrôle n'est fait au lancement : une valeur hors de ces limites donne un
résultat faux ou une division par zéro, pas un message.

- **`workforce.ts`, `FARMING` / `FISHING` / `MINING`** : `mechanizationBase` ≥ 1,
  `mechanizationMax` ≥ `mechanizationBase`, `maxMachinesPer1000` ≥ 1,
  `curveExponent` entier ≥ 1. `FISHING.tileYieldMax` ≥ `FISHING.tileYield`.
- **`cities.ts`** : `EXPANSION_RADIUS` est la seule valeur à modifier ;
  `controlRadius` en est la moitié, calculée. Garder `EXPANSION_RADIUS` pair.
- **`factories.ts`, `specialization`** : `decayPercent + floorPercent` < 100.
- **`armament.ts`, `decayRate`** : sur l'échelle 10 000, donc 100 = 1 % de
  l'excès perdu par tour. Le client divise par 100 pour afficher le pourcentage.
- **`goods.ts` et `armament.ts`, `ironPerLine`** : le remplissage des lignes
  s'arrête à la première ligne qui ne peut pas être remplie. Si `ironPerLine`
  dépasse la capacité de fer du joueur (cases de fer × `capacityPerTile`),
  cette ligne ne se remplit jamais et les lignes suivantes non plus.

---

## 2. L'ordre des clés compte

Les tableaux de l'état d'un joueur (`goods`, `goodsDemand`, `armamentReserve`,
`armamentRemainder`, `resourceTiles`) sont indexés par la position de la clé
dans `GOODS`, `ARMAMENT.types` ou `RESOURCES`. Le hash de l'état (`hash.ts`) les
parcourt dans cet ordre.

Changer l'ordre des clés ou en insérer une au milieu change donc quel nombre va
dans quelle case. C'est sans conséquence pour une nouvelle partie, mais deux builds
d'ordres différents ne peuvent pas jouer ensemble (leurs hashes diffèrent).
Pour ajouter une entrée, la mettre à la fin de sa liste.

L'ordre des nœuds d'un arbre (`FACTORY_TYPES`) compte aussi : la racine en
premier, chaque parent avant ses enfants. L'indice d'un nœud est sa case dans
`Factory.progress`.

---

## 3. Noms écrits en dur dans le code

Ces noms sont cités dans le code (pas lus depuis la configuration). Les
renommer ou les supprimer casse le moteur ou la page.

| Nom | Où il est cité |
| --- | --- |
| `tractor`, `fishingBoat`, `miningMachine` (clés de `GOODS`) | `economy.ts` (`TRACTOR`, `FISHING_BOAT`, `MINING_MACHINE`), `client/src/solo.ts`, `client/src/infobar.ts`, `client/src/goodtips.ts` |
| `iron` (clé de `RESOURCES`, aussi première clé : bit 0 de la carte) | `economy.ts`, `map.ts` (`RESOURCE_IRON`), `client/src/solo.ts`, `client/src/infobar.ts` |
| `FARMING`, `FISHING`, `MINING` | `economy.ts`, `client/src/solo.ts` |

Les noms des types d'armement et des types d'usine ne sont cités par aucun
code du moteur : on peut les renommer, en mettant à jour `client/src/names.ts`.

---

## 4. Ajouter une entrée

### Une icône

Dans `goods.ts` ou `armament.ts`, ajouter `icon: "<dossier>/<fichier>.png"` à
l'entrée : le chemin est relatif à `client/public/icons/`, qui a un sous-dossier
par famille (`population/`, `goods/`, `armament/`, `miscellaneous/`). Le fichier
est affiché à 16 × 16 px. Sans `icon`, la page affiche le texte entre crochets
de `client/src/names.ts`. Aucun autre fichier à modifier. Le fer, les types
d'usine et les icônes de la population n'ont pas encore de champ `icon`.

### Un type d'armement

Aucune ligne de code à écrire.

1. `armament.ts` : ajouter une entrée à `types`, à la fin, avec
   `productionPerLine`, `workersPerLine`, `ironPerLine`.
2. `factories.ts` : ajouter un nœud `{ good: "<nom>", parent: "<parent>" }` à
   l'arbre d'un type d'usine, après son parent. Sans nœud, aucune usine ne peut
   en produire.
3. `client/src/names.ts` : ajouter `<nom>: "nom affiché"` dans `PRODUCT_NAMES`.
   Sans cette ligne, la page affiche la clé telle quelle.

Le reste est dérivé des clés : taille des tableaux du joueur (`state.ts`),
hash, validation des ordres (`isProductId`), catalogue de la page.

### Un type d'usine

1. `factories.ts` : ajouter une entrée à `FACTORY_TYPES` avec son `tree`. Les
   produits cités doivent exister dans `GOODS` ou `ARMAMENT.types`.
2. `client/src/names.ts` : ajouter le nom dans `FACTORY_NAMES`. L'initiale
   affichée sur la carte en est tirée.

`FACTORY.maxTypesPerCity` limite le nombre de types différents par ville.

### Une unité militaire

`units.ts` : ajouter une entrée à `UNITS` (à la fin, l'ordre des clés est celui des effectifs de chaque camp d'un front et du
hash) avec un équipement existant de `ARMAMENT.types`, puis la ranger dans une seule niche de `NICHES` ; les multiplicateurs
s'écrivent avec deux décimales au plus (un test le vérifie). `client/src/names.ts` : son nom (`UNIT_NAMES`) et celui de la
niche (`NICHE_NAMES`). Le moteur n'a rien d'autre à changer.

### Un bien (machine)

Demande du code, pas seulement de la configuration.

1. `goods.ts` : ajouter l'entrée, à la fin.
2. `factories.ts` : l'ajouter à un arbre. `client/src/names.ts` : son nom.
3. `economy.ts`, `stepPlayer` : aujourd'hui, seules les demandes des trois
   machines existantes sont calculées (`p.goodsDemand[...]`). Une ligne de bien
   n'est remplie que si la demande du bien est supérieure à ce qui est déjà
   produit. Pour un nouveau bien, la demande reste à 0 : ses lignes ne se
   remplissent jamais tant qu'aucun code ne la calcule. De même, `p.goods`
   recevra sa production, mais rien ne la consomme.

### Une ressource naturelle

1. `resources.ts` : ajouter une section à `RESOURCES` (`presence`,
   `capacityPerTile`), après `iron`. `mapgen.ts` génère sa présence pour chaque
   clé ; `npm run viz:resources` permet de régler `presence`. Une case ne porte
   qu'une ressource : la clé la plus loin dans `RESOURCES` remplace les
   précédentes, donc mettre les plus rares en dernier. `capacityPerTile` n'est
   lu que pour le fer ; l'aluminium n'en a pas encore.
2. La carte stocke une ressource par bit d'un octet : 8 ressources au plus.
3. Rien ne l'exploite sans code : le comptage par joueur (`resourceTiles`) se
   fait tout seul, mais l'extraction (`economy.ts`) et l'affichage
   (`client/src/mirror.ts`, `infobar.ts`) ne connaissent que le fer.

### Une activité mécanisée (par exemple `SHIPPING`, 00-Game §3.6)

Ajouter une constante de type `MechanizationConfig` dans `workforce.ts`, puis
du code dans `economy.ts` qui l'utilise, et dans `client/src/solo.ts`
(`factoryCatalog`) pour envoyer ses valeurs à la page.

---

## 5. Documentation

Règle 8 du `CLAUDE.md` : en ajoutant ou en retirant un nom, mettre à jour le
tableau du §10 de `Docs/Design/00-Game.md` et le tableau du §1 de
`Docs/Design/02-Engine.md`.
