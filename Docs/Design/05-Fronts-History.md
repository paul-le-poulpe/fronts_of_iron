# 05 — Fronts : historique des discussions

**Ce fichier ne fait pas foi.** C'est l'historique de la conception des
fronts avec l'auteur (25 et 26 octobre 2026), dans l'ordre des discussions :
il contient des règles remplacées ensuite, des propositions refusées et des
questions. **La référence est `05-Fronts.md`.** Ne jamais implémenter à
partir d'ici ; s'en servir seulement pour retrouver pourquoi une règle a été
choisie.

**Refonte en divisions (30 octobre 2026)** : la version 0.1 de `05-Fronts.md`
(couverture en mètres, priorités, interrupteurs, percée) est copiée en fin de
fichier, section « Version 0.1 ». Elle est remplacée ; ne pas l'implémenter.

Ce qui suit est la copie du document de travail tel qu'il était avant la
réécriture de `05-Fronts.md` en référence (26 octobre 2026). Ses sections
§1 à §11 (notes d'implémentation) sont elles aussi périmées en partie.

---


**Les règles sont dans `00-Game.md` §3.8.** Ce fichier dit comment les
implémenter : structures, calculs, hash, client, tests, pièges. Il sert aussi de
carnet pour la suite de la conception (§12) et tient la liste de ce que
l'interface d'un front devra contenir (§13). Une règle n'est décidée que quand
elle est écrite dans 00-Game ; ici, tout ce qui n'y est pas est marqué
« proposition ».

Fronts aériens et maritimes : hors périmètre.

---

## 1. État

**Décision de l'auteur (25 octobre 2026) : le moteur des fronts n'est pas
implémenté avant que les attaques, les unités et la configuration d'un front
soient décrites.** Ces descriptions diront ce qu'une connexion et un front
contiennent en plus de ce qui suit ; implémenter avant, c'est remanier après.

Seul travail possible dès maintenant, optionnel : la visualisation de la
détection (§9), qui ne touche ni à l'état ni au hash.

| Décidé (00-Game §3.8) | Pas décrit |
| --- | --- |
| connexion = route entre villes de deux joueurs | événement qui déclare une guerre |
| front = paire de groupes, symétrique | ce qui fait avancer le front |
| classement : île, puis adversaire | ce qui déclenche une prise |
| largeur = connexions × `FRONTS.metersPerConnection` | unités, attaques |
| position par connexion, en millièmes ; 500 à la déclaration | contenu de la configuration d'un front |
| prise : routes retirées et ajoutées, 1 % / 99 % | identité d'un front quand les groupes changent |
| pas de fondation près d'un front en guerre | |
| cases et récoltes inchangées tant que la ville ne change pas de main | |
| affichage : Catmull-Rom en Bézier, client seulement | |

## 2. Contrat d'entrée : la sortie du système des routes

Les fronts lisent `state.roads` (`state.ts`), `City.player` et `City.group`, et
rien d'autre du système des routes. Ce qui peut être supposé :

- `state.roads` est un tableau de paires `[a, b]` d'identifiants de villes
  (`cities[id − 1]`), avec `a < b` ;
- chaque paire y est au plus une fois ;
- `City.group` est à jour quand les fronts sont recalculés (`computeGroups`
  est appelé avant, §5).

Ce qui **ne doit pas** être supposé, parce que le système des routes peut être
remanié :

- l'ordre du tableau (aujourd'hui : longueur au carré, puis a, puis b) ;
- qu'un indice dans le tableau désigne toujours la même route : `addCityToRoads`
  insère et retire avec `splice` ;
- la règle de construction (non-croisement, rayon d'expansion) ;
- que les zones des deux villes se touchent (00-Game §3.5 : la règle retenue
  n'est pas Delaunay).

Les fronts produisent un ordre fixé à partir de ce contrat : ils trient
eux-mêmes ce qu'ils construisent (§5, étape 5).

## 3. Définitions opérationnelles

- **Connexion** : une paire `[a, b]` de `state.roads` avec
  `cities[a−1].player ≠ cities[b−1].player`.
- **Orientation** : `p1 < p2` sont les deux joueurs ; `city1` est la ville de
  `p1`, `city2` celle de `p2`.
- **Clé d'un front** : `(g1, g2)`, `g1` groupe de `city1`, `g2` groupe de
  `city2`. Un identifiant de groupe est un identifiant de ville, donc unique
  tous joueurs confondus : la paire suffit à désigner les deux joueurs.
- **Largeur** : `connections.length × FRONTS.metersPerConnection`. Calculée à
  la lecture, jamais stockée.

## 4. Structures (moteur)

Proposition, dans `packages/engine/src/fronts.ts` et `state.ts` :

```ts
/** Unité de position : millièmes de la longueur de la route. Pas un réglage. */
export const FRONT_POSITION_SCALE = 1000;

export interface FrontConnection {
  /** Ville de players[0]. */
  readonly city1: number;
  /** Ville de players[1]. */
  readonly city2: number;
  /**
   * Position du front sur le segment city1 → city2, en millièmes de sa longueur,
   * 0 à FRONT_POSITION_SCALE. C'est aussi la part de la route tenue par
   * players[0] ; players[1] tient le reste.
   */
  position: number;
}

export interface Front {
  /** Stable, jamais réutilisé. */
  readonly id: number;
  /** [p1, p2], p1 < p2. */
  readonly players: readonly [number, number];
  /** [groupe de p1, groupe de p2] (00-Game §3.5). Peut changer (§11). */
  groups: [number, number];
  /** Rangées par (city1, city2). */
  connections: FrontConnection[];
}

// GameState :
//   fronts: Front[]        rangés par id
//   nextFrontId: number    prochain identifiant, commence à 1
```

L'état de guerre entre deux joueurs n'est pas dans `Front` : c'est une relation
entre joueurs, pas entre groupes. Elle existe déjà dans `GameState.diplomacy`
(un statut par paire de joueurs : neutre, pacte, guerre ; 02-Engine §4). Le
calcul des fronts ne la lit pas encore : l'ordre `declare_war` change le statut
et ne met pas les connexions au milieu.

Positions en entiers seulement (règle 2). Le milieu est `500`. La prise
(00-Game §3.8) donne `FRONTS.capturePercent × 10` millièmes côté ville prise X :

| X est | position |
| --- | --- |
| `city1` (le preneur est `p1`) | `capturePercent × 10` (10 pour 1 %) |
| `city2` (le preneur est `p2`) | `1000 − capturePercent × 10` (990) |

Configuration : `packages/engine/src/config/fronts.ts`, ré-exporté par
`config.ts` (`metersPerConnection`, `capturePercent`, `noFoundingDistance` ;
00-Game §10). Les valeurs à fixer restent à fixer : ne pas les deviner.

## 5. Recalcul : `updateFronts(state, …)`

**Quand** : à chaque événement qui change les routes ou le propriétaire d'une
ville, après `computeGroups`. Aujourd'hui : la fondation (`foundCity`, juste
après `computeGroups(state)`). Plus tard : la prise, la disparition d'une ville.
Jamais à chaque tour : sans fondation ni prise, les connexions ne changent pas.
La déclaration de guerre ne recalcule pas les connexions, elle met leurs
positions à 500.

**Étapes** :

1. **Anciennes positions.** Indexer les connexions existantes par
   `(p1, p2, city1, city2)`. Les joueurs font partie de la clé (piège, §11).
2. **Connexions.** Parcourir `state.roads` ; garder les paires dont les villes
   ont des joueurs différents ; orienter (`city1`, `city2`) ; calculer la clé
   `(g1, g2)`.
3. **Positions.** Une connexion trouvée à l'étape 1 garde sa position. Une
   nouvelle connexion reçoit :
   - 500 si ses deux joueurs sont en paix ;
   - la valeur de la prise (§4) si elle vient d'une prise ;
   - autres cas en guerre : non décidé (00-Game §13, Fronts).
4. **Fronts.** Regrouper les connexions par clé `(g1, g2)`. Identifiant de
   chaque front : **non décidé** (00-Game §13). Proposition à valider avec
   l'auteur : un nouveau front reprend l'identifiant de l'ancien front avec
   lequel il partage le plus de connexions (même `city1`, `city2`) ; à
   égalité, le plus petit identifiant ; un ancien identifiant n'est repris
   qu'une fois ; sinon `nextFrontId++`. Cette règle couvre la fusion et la
   coupure des groupes.
5. **Ordre.** Fronts triés par `id`, connexions par `(city1, city2)`.
   L'ordre ne dépend donc ni de l'ordre de `state.roads` ni de celui d'une
   `Map`.

Coût : un parcours de `state.roads` (au plus environ 3 routes par ville dans un
réseau sans croisement), seulement à la fondation ou à la prise.

**Prise d'une ville X par A** (déclencheur non décrit) : changer
`cities[X−1].player`, recalculer les groupes, puis `updateFronts` avec X marqué
« vient d'être pris par A ». L'étape 3 donne 10 ou 990 aux nouvelles
connexions qui touchent X. Les routes entre X et une ville de A disparaissent
d'elles-mêmes à l'étape 2 (même joueur des deux côtés). Ce qui accompagne la
prise par ailleurs (zones, `owner`, `tileCity`, ports, totaux du joueur) n'est
pas décrit ici.

## 6. Hash (02-Engine §5)

Après les routes : `nextFrontId`, le nombre de fronts, puis pour chacun : `id`,
`p1`, `p2`, `g1`, `g2`, nombre de connexions, puis pour chacune `city1`,
`city2`, `position`. Ajouter à `test/engine.test.ts` la vérification que chaque
champ change le hash (02-Engine §6, premier piège).

## 7. Validité des ordres

**`found_city` en guerre** (00-Game §3.8) : invalide si la case est à moins de
`FRONTS.noFoundingDistance` d'un point du front d'une connexion entre deux
joueurs en guerre (proposition de mesure, à valider). En entiers, sans
division : avec `s = FRONT_POSITION_SCALE`, le point multiplié par `s` est

```
Ps = city1 × (s − position) + city2 × position      (par coordonnée)
```

et la condition est `|t × s − Ps|² < (noFoundingDistance × s)²`. Carte de 800 ×
500 : coordonnées × 1000 ≤ 800 000, carrés sommés ≤ environ 1,3 × 10¹², sous
2⁵³ : exact en `number`.

Ordres propres aux fronts : configurer un front n'est pas décrit. Déclarer la
guerre est un ordre de diplomatie (00-Game §1, §9), déjà dans le moteur, sans
effet sur les fronts.

## 8. Client

**Message** (03-Client §4) : un champ `fronts` dans `tick`, `null` s'il n'a pas
changé, sinon la liste complète à plat (`Int32Array`) :
`[id, p1, p2, g1, g2, n, puis n × (city1, city2, position)]` par front.
`SoloGame` détecte le changement comme pour `factoryMarks`. Quand l'avancée
existera, les positions changeront souvent : mesurer avant d'optimiser.

**Mirror** : garde la liste ; le tracé est recalculé à la réception, pas à
chaque image.

**Tracé**, seulement pour les fronts entre joueurs en guerre (en paix, la
frontière reste celle des zones, 00-Game §11) :

1. **Points.** Un par connexion :
   `P = city1 + (city2 − city1) × position / 1000`, en flottants (client :
   permis).
2. **Voisins.** Deux connexions du même front sont voisines si elles partent
   de la même ville et sont consécutives dans l'ordre angulaire de **toutes**
   les routes de cette ville, avec un angle inférieur à 180° entre elles.
   Raison : dans un triangle du réseau dont les sommets ont deux joueurs, les
   deux routes qui traversent la frontière partagent le sommet isolé ; la
   ligne du front passe par leurs deux points. Une connexion borde au plus
   deux faces, donc a au plus deux voisines : les voisinages forment des
   chaînes ou des boucles (enclave).
3. **Chaînes.** Une ligne par chaîne ; une boucle donne une courbe fermée. Une
   face qui n'est pas un triangle (route manquante, rayon) peut couper une
   chaîne : le front donne alors plusieurs lignes. À regarder sur la
   visualisation (§9).
4. **Courbe.** Catmull-Rom centripète (α = 0,5), passant par chaque point,
   convertie en Bézier cubiques. Pour le morceau P1 → P2, avec P0 et P3 ses
   voisins (aux bouts d'une chaîne, répéter le point du bout), `dᵢ` = distance
   entre les points consécutifs, `aᵢ = dᵢ^α`, `bᵢ = dᵢ^(2α)` :
   ```
   B1 = (b1·P2 − b2·P0 + (2·b1 + 3·a1·a2 + b2)·P1) / (3·a1·(a1 + a2))
   B2 = (b3·P1 − b2·P3 + (2·b3 + 3·a3·a2 + b2)·P2) / (3·a3·(a3 + a2))
   ctx.bezierCurveTo(B1, B2, P2)
   ```
   Si `d1 = 0` (bout répété), prendre `B1 = P1` ; si `d3 = 0`, `B2 = P2`. À
   vérifier au premier tracé.
5. **Bouts.** Où s'arrête la ligne au-delà du dernier point : non décidé
   (00-Game §13). Provisoire : au dernier point.
6. **Dessin.** Un `Path2D` par chaîne, gardé jusqu'au prochain message
   `fronts`.

**Interface** : le classement île → adversaire → fronts (00-Game §3.8) est
décidé ; le panneau qui l'affiche ne l'est pas.

## 9. Visualisation de la détection (possible dès maintenant)

`npm run viz:fronts` → `packages/engine/out/fronts.html`, sur le modèle de
`test/cities-viz.ts` (partie scriptée, curseur sur les étapes). Calcule les
connexions et les fronts **à côté** de l'état, avec les étapes 2 et 4 du §5,
sans toucher à `GameState` ni au hash. Affiche :

- les routes, les connexions en couleur de leur front, le milieu de chaque
  connexion ;
- par joueur, ses îles, puis par adversaire ses fronts : identifiant, nombre de
  connexions ;
- les chaînes du §8 (points 2 et 3), pour voir où elles se coupent.

But : vérifier sur la carte que la définition par les routes donne des fronts
qui paraissent justes à l'auteur, avant de construire les attaques dessus.

## 10. Tests à écrire

Une seule passe de tests à la fin de la série de modifications.

- Fronts recalculés après chaque fondation = calcul de référence lent
  (toutes les routes, regroupement par parcours) dans `test/helpers.ts`.
- Chaque connexion est dans exactement un front ; clés `(g1, g2)` uniques ;
  `p1 < p2` ; ordre par `id` et par `(city1, city2)`.
- Positions conservées d'un recalcul à l'autre quand une connexion garde ses
  deux villes et ses deux joueurs ; nouvelle position quand un joueur change
  (§11, premier piège).
- Prise : routes vers le preneur retirées, routes vers le perdant ajoutées à
  10 ou 990 selon l'orientation.
- `found_city` refusé près d'un front en guerre, accepté au-delà.
- Hash : chaque champ du §6 le change.
- Déterminisme : le test existant (10 000 tours, deux processus) couvre les
  fronts dès qu'ils sont dans l'état.

## 11. Pièges

- **Retrouver une connexion par ses seules villes.** X, ville de B, est prise
  par A ; la route X–C (C troisième joueur) était une connexion B–C et devient
  A–C. Si `B < C` et `A < C`, l'orientation `(X, C)` ne change pas : une clé
  sans les joueurs donnerait à la connexion A–C la position de l'ancienne
  connexion B–C. La clé inclut `(p1, p2)`.
- **Indexer par l'indice dans `state.roads`** : il change à chaque fondation
  (§2).
- **Identifiant de groupe** : le plus petit identifiant de ville du groupe ; il
  change quand cette ville change de main. Ne jamais l'utiliser comme
  identifiant de front.
- **Flottants dans le moteur** : la position est en millièmes entiers ; le
  point du front n'est calculé en flottants que dans le client.
- **Route retirée par une fondation** : une fondation hors de la distance
  interdite peut retirer une route d'un front par croisement (00-Game §3.5) ;
  la connexion et sa position disparaissent. Cas ouvert (00-Game §13).

## 12. Carnet de conception

Notes de discussion avec l'auteur, avant qu'elles passent dans 00-Game.

- **25 octobre 2026** — première discussion. Tout ce qui a été décidé est dans
  00-Game §3.8 ; les cas restés ouverts sont dans 00-Game §13, « Fronts ».
  À venir : guerre, attaques, unités, configuration d'un front. Implémentation
  du moteur repoussée jusque-là (§1).
- **25 octobre 2026** — identité d'un front à la fusion ou à la coupure des
  groupes : l'auteur tranchera quand tous les éléments des fronts seront
  décrits. La proposition du §5, étape 4, reste non validée.
- **25 octobre 2026** — unités sur le front (dit par l'auteur) :
  - **Deux lignes.** La première ligne subit les attaques en premier. Si elle
    est percée, la seconde ligne intervient. Modèle : Hearts of Iron. Première
    ligne : infanterie, artillerie, canons, peu mobiles et peu chers. Seconde
    ligne : unités très mobiles (chars), qui attaquent pour percer et
    colmatent les percées adverses. Le combat sera décrit plus tard.
  - **Pas d'unité suivie une à une** : le moteur garde un nombre d'unités de
    chaque type par front (exemple : 10 000 unités d'infanterie).
  - **Fichier de configuration des unités militaires** : chaque type a ses
    statistiques (attaque, défense, etc.), sa largeur de front et son coût.
    Infanterie : un fusil (armement `rifle`, 00-Game §8.4) et une unité de
    population ; 1 mètre de front par unité (valeur donnée par l'auteur).
  - **Niches** : chaque front a plusieurs niches. Une niche est un rôle, rempli
    par un ou plusieurs types d'unités (en général deux au plus). Première
    niche : l'infanterie. Autre exemple : la niche antichar, remplie par le
    canon antichar et par le chasseur de chars blindé, qui est meilleur.
  - **Remplissage d'une niche** : les unités sont prises de la meilleure à la
    moins bonne jusqu'à couvrir la largeur. Exemple : il en faut 100, le joueur
    a 50 chasseurs blindés → les 50, puis 50 canons antichars. Pas assez
    d'unités : la niche est remplie à X %. Trop d'unités : le surplus va en
    seconde ligne, sans limite pour l'instant (limite possible plus tard).
  - **Effet** : chaque type applique ses statistiques au front selon son
    pourcentage de présence.
  - **But des niches** : borner le nombre d'unités en première ligne (sinon le
    plus grand nombre d'infanterie gagne) ; une fois une niche pleine, densifier
    le front oblige à remplir d'autres niches (chars, canons) : le joueur doit
    diversifier.
  - **Forme de la configuration** (question de l'auteur) : proposition, une
    table des niches, chacune avec sa liste ordonnée d'unités, la meilleure
    d'abord ; chaque unité dans une seule niche. Raisons : l'ordre de
    remplissage est écrit une fois, à un seul endroit ; avec « chaque unité
    liste celles qu'elle remplace », trois unités peuvent donner un ordre
    incomplet (A remplace C, B remplace C, A contre B non dit) ou circulaire,
    qu'il faut détecter ; la niche a un nom, où accrocher ses propres réglages
    (sa ligne, par exemple). Non validée.
  - **Questions posées** : chaque niche a-t-elle pour capacité toute la largeur
    du front ? Qui répartit les unités du joueur entre ses fronts ? Réponses
    ci-dessous.
- **25 octobre 2026** — capacité des niches et répartition (dit par l'auteur) :
  - **Capacité d'une niche** : chaque niche couvre toute la largeur du front,
    en mètres. Chaque type d'unité a sa largeur de front, qui peut différer
    d'un type à l'autre. On couvre le plus de largeur possible avec la meilleure
    unité de la niche, puis on passe à la suivante.
  - **Dans un front** : on remplit d'abord la première ligne au maximum ; ce
    qui reste va en seconde ligne.
  - **Entre les fronts** : chaque front a une priorité de 1 à 3 (réglée par
    le joueur : supposé, à confirmer).
    - Priorité 1 : le front cherche à remplir 100 % de ses besoins.
    - Priorité 2 : le front cherche à remplir 50 % de ses besoins ; au-delà,
      le matériel va aux autres fronts.
    - Priorité 3 : le front ne reçoit que le surplus.
  - **Plusieurs fronts sous leur objectif** : le matériel est partagé en
    proportion, pour qu'ils progressent de la même façon vers leur objectif.
    Exemple de l'auteur : un front de priorité 2 à 40 % (objectif 50 %) et un
    front de priorité 1 à 80 % (objectif 100 %) reçoivent un tiers et deux
    tiers.
  - **Formule** (proposition, non validée) : manque d'un front = objectif ×
    besoin − ce qu'il a, en unités ; chaque front reçoit
    `A × manque / Σ manques`, A étant la quantité à répartir. Égal à
    l'exemple quand les besoins sont égaux ; si les besoins diffèrent, chaque
    front comble la même fraction de son manque. Paliers proposés : (1)
    priorité 1 à 100 % et priorité 2 à 50 % ; (2) priorité 2 à 100 % ; (3)
    priorité 3 à 100 % ; (4) secondes lignes. Arrondi : partie entière, puis
    une unité de plus aux fronts de plus grand reste, à égalité au plus petit
    identifiant. Calcul type par type, du meilleur au moins bon, le manque
    exprimé en unités de ce type (`ceil(manque en mètres / largeur du type)`).
  - **Questions posées** : A est-il le matériel nouveau de chaque tour
    (les unités déjà sur un front y restent) ou tout le matériel du joueur,
    redistribué à chaque tour (une unité peut changer de front) ? Ordre des
    paliers 2 à 4, et partage du surplus entre les secondes lignes ?
  - **À venir** : la liste des attributs d'une unité, donnée par l'auteur.
- **25 octobre 2026** — secondes lignes et vidage d'un front (dit par
  l'auteur) :
  - **Secondes lignes** : le matériel leur est attribué selon les mêmes
    priorités que pour les premières lignes.
  - **Matériel de seconde ligne seulement** : certains types d'unités ne vont
    jamais en première ligne, seulement en seconde ligne.
  - **Réponse à la question sur A** : par défaut, une unité déjà sur un front
    y reste ; seul le matériel nouveau est réparti. Le joueur a une option qui
    autorise à vider un front pour en remplir un autre ; désactivée par
    défaut. Par front ou pour tout le joueur : supposé par front, à confirmer.
  - **Question posée** : la seconde ligne n'a pas de limite, donc pas de
    « besoin » ; la règle des priorités (objectif = part du besoin) n'a rien
    sur quoi se calculer. Avec une seconde ligne sans limite, un front de
    priorité 1 absorbe tout et les priorités 2 et 3 ne reçoivent jamais rien.
    Faut-il un besoin de seconde ligne (une largeur, des niches), ou une autre
    règle de partage ? Réponse ci-dessous.
- **25 octobre 2026** — partage de la seconde ligne (dit par l'auteur) : un
  autre critère que la première ligne, en quantité totale. Exemple : 150 chars,
  trois fronts de priorité 1, 2 et 3 → 100, 50 et 0.
  - **Formule** (proposition, non validée) : poids 2, 1 et 0 pour les
    priorités 1, 2 et 3 (en entiers ; même rapport que les objectifs 100 % et
    50 % de la première ligne). Cible d'un front pour un type =
    `total du type en seconde ligne × poids / Σ poids`. Le matériel nouveau
    comble les écarts à la cible avec la formule de la première ligne
    (proportion des manques). Une unité déjà en place y reste (option de
    vidage mise à part). Si tous les fronts sont de priorité 3 (Σ poids = 0) :
    partage égal, puisque tout est alors du surplus.
  - **Question posée** : deux fronts de même priorité reçoivent-ils la même
    quantité, ou une quantité selon leur largeur ? Réponse ci-dessous.
- **25 octobre 2026** — largeur (dit par l'auteur) : la quantité de seconde
  ligne est proportionnelle à la largeur du front. **Principe général : on
  raisonne en largeur de front et en pourcentage de largeur, plutôt qu'en
  quantité absolue de matériel.**
  - **Formule corrigée** (proposition, non validée) : cible d'un front pour un
    type = `total × poids × largeur / Σ (poids × largeur)`, poids 2, 1, 0 pour
    les priorités 1, 2, 3. À largeurs égales, on retrouve l'exemple
    (150 chars → 100, 50, 0).
- **25 octobre 2026** — attributs d'une unité (dits par l'auteur ; équivalents
  Hearts of Iron cités comme repères) :
  1. **Attaque anti-infanterie** (soft attack).
  2. **Attaque antiblindée** (hard attack).
  3. **Attaque antiaérienne**.
  4. **Largeur de front en première ligne**.
  5. **Largeur de percée** : largeur utilisée en seconde ligne, pour tenter
     une percée ou en repousser une.
  6. **Type de dégâts reçus** : blindé, infanterie ou équipement. Équipement :
     surtout canons et mitrailleuses ; proche de l'infanterie, un peu
     différent.
  7. **Déplacement** : motorisé ou à pied. Un véhicule très lent compte à
     pied. D'autres types pourront s'ajouter.
  8. **Multiplicateur d'attaque** : appliqué quand l'unité attaque ; en
     défense, pas de multiplicateur. Exemple : mitrailleuse forte en défense,
     multiplicateur d'attaque < 1 ; char, bon multiplicateur, parfois > 1.
  9. **Multiplicateur de contre-attaque** : appliqué pour repousser une
     percée. En général égal au multiplicateur d'attaque. Exception : canon
     antichar sur chenilles, bon pour repousser une percée, mauvais pour en
     créer une.

  Déjà dit avant : niche (table des niches), coût (armement et population),
  certains types en seconde ligne seulement.
  **Proposés à l'auteur** : résistance ; lignes autorisées ; blindage contre
  perforation. Réponses ci-dessous.
- **25 octobre 2026** — réponses de l'auteur sur les attributs proposés :
  - **Résistance (PV) : attribut 10, stocké dans chaque type d'unité.**
    L'auteur a d'abord proposé une valeur commune à tous les véhicules, puis
    l'a remplacée par une valeur par type : une tankette ou une voiture
    blindée doit être bien plus facile à détruire qu'un vrai char. Elle sert
    seulement à compter les unités détruites : PV jamais suivis unité par
    unité, les unités sont retirées par paquets. Exemple : 100 dégâts contre
    des unités de 40 PV → 2 détruites, les 20 restants sont perdus (division
    entière, reste perdu).
  - **Blindage contre perforation : non.** Un seul niveau de blindage : tous
    les véhicules blindés sont équivalents. Le jeu reste simple.
  - **Lignes autorisées : réglage du joueur, pas attribut de l'unité.** Chaque
    type d'unité peut aller dans les deux lignes. Dans le panneau d'un front,
    le joueur choisit quels types sont autorisés en première et en seconde
    ligne (exemple : réserver les unités les plus puissantes à la seconde
    ligne). L'auteur y réfléchit encore. **Remplace** « certains types en
    seconde ligne seulement » (notes plus haut) : ce n'est plus une
    propriété du type.
- **25 octobre 2026** — **attribut 11 : population nécessaire** pour opérer
  l'armement de l'unité (dit par l'auteur). Fusil : 1 (valeur donnée). Char :
  20 évoqué comme exemple (5 dans le char, 15 pour le soutien, la réparation),
  non fixé. C'est la part « population » du coût noté plus haut.
- **25 octobre 2026** — **encerclement** (dit par l'auteur) :
  - **Cas** : des unités de A tiennent une connexion entre une ville de A et
    une ville de B. B prend la ville de A : la route relie maintenant deux
    villes de B, elle est coupée des deux côtés. La connexion est encerclée.
  - **Pas de suivi par unité** : les unités d'un front sont réparties sur
    toute sa largeur. Une connexion encerclée représente sa part du front :
    1 connexion sur 10 = 10 % du front.
  - **Pertes** : sur cette part des unités du front, on retire
    `FRONTS.encirclementLossPercent` % (« ratio de perte d'encerclement »,
    valeur à fixer ; 50 % pris en exemple). Exemple : 10 % du front, ratio
    50 % → 5 % des unités du front perdues.
  - **Une perte d'unités est toujours hommes et matériel ensemble** : la
    population et l'armement de l'unité disparaissent tous les deux.
  - **Formule** (proposition) : pour chaque type d'unité du front,
    `perdues = floor(unités × connexions encerclées × ratio / (connexions du
    front × 100))`, connexions comptées avant la prise. En largeur, c'est la
    même chose : chaque connexion ajoute la même largeur.
  - **Questions posées** : la route par laquelle B a pris la ville compte-t-elle
    comme encerclée, ou seulement les autres routes de la ville prise vers des
    villes de B ? Les pertes portent-elles sur les deux lignes du front, ou
    seulement sur la première ? Réponses ci-dessous.
- **25 octobre 2026** — encerclement, précisions de l'auteur :
  - **La route de l'attaque ne compte pas** : seules les autres routes entre
    la ville prise X et des villes de B peuvent être encerclées.
  - **Longueur minimale pour encerclement** : une de ces routes n'est
    encerclée que si le front y était à plus de
    `FRONTS.minEncirclementLengthPercent` % de la longueur de la route, compté
    depuis X (25 pour commencer, valeur donnée par l'auteur). Plus près de X,
    les unités de A étaient presque à leur ville : elles se replient en bon
    ordre, sans perte. En millièmes (§4) : encerclée si la part tenue par A
    sur cette route dépasse `minEncirclementLengthPercent × 10`.
  - **Seule la première ligne subit les pertes.**
  - **Formule mise à jour** (proposition) : pour chaque type d'unité de la
    première ligne du front, `perdues = floor(unités × encerclées ×
    encirclementLossPercent / (connexions du front × 100))`, « encerclées »
    = routes qui remplissent les deux conditions ci-dessus, connexions
    comptées avant la prise.
- **25 octobre 2026** — **attribut 12 : multiplicateur de percée** et types
  d'attaque (dit par l'auteur) :
  - **Multiplicateur de percée** : s'applique quand une unité de seconde ligne
    attaque la première ligne adverse.
  - **Trois types d'attaque**, lancés par le joueur :
    1. **Attaque sur tout le front** : toutes les unités du front de
       l'attaquant attaquent le front du défenseur sur toute la ligne.
    2. **Percée** : l'attaquant choisit une connexion. Sa seconde ligne
       attaque la première ligne du défenseur, dans la limite de la largeur
       de percée. Le nombre d'unités engagées sera décrit plus tard. Si la
       première ligne est battue, la percée commence : la seconde ligne du
       défenseur contre-attaque (multiplicateur de contre-attaque). La
       mobilité des deux camps fixe la longueur dont le front avance sur la
       route : attaquant très mobile contre seconde ligne peu mobile → grande
       avancée ; attaquant peu mobile contre seconde ligne très mobile →
       petite avancée avant d'être contré. Si la seconde ligne du défenseur
       est battue à son tour, le front avance beaucoup d'un coup. Les unités
       mobiles sont meilleures dans cette phase : elles réagissent plus vite.
    3. **Barrage d'artillerie** : hors périmètre pour l'instant.
  - **Questions posées** : quel multiplicateur s'applique à chaque camp dans
    chaque phase (tableau proposé dans la discussion, reporté ci-dessous) ?
    L'attaque sur tout le front engage-t-elle les deux lignes de l'attaquant ?

    | Phase | Attaquant | Défenseur |
    | --- | --- | --- |
    | Attaque sur tout le front | attaque | aucun |
    | Percée : seconde ligne contre première ligne | percée | aucun |
    | Percée : après la première ligne, contre la seconde ligne | attaque | contre-attaque |

    Dernière ligne tranchée par l'auteur le 25 octobre : l'attaquant repasse
    au multiplicateur d'attaque (modifiable plus tard). Les autres lignes du
    tableau sont la lecture de la discussion, non contredite.
  - **Attaque sur tout le front : la seconde ligne n'intervient pas** (dit
    par l'auteur) : seules les premières lignes combattent. Pour qu'une unité
    de seconde ligne y participe, le joueur doit l'autoriser en première
    ligne (réglage des lignes autorisées, §13).
- **25 octobre 2026** — **attributs 13 et 14** (dits par l'auteur) :
  - **13. Icône** : nom du fichier d'icône de l'unité. En général celle de son
    équipement (chars), parfois différente : l'infanterie a son propre
    symbole, pas celui du fusil produit par l'usine.
  - **14. Équipement requis** : toujours un seul équipement par unité, en
    général du même nom que l'unité ; exception : l'infanterie prend des
    fusils (`rifle`).
  - **Valeurs** : l'auteur donne des valeurs justes entre elles, à ajuster
    plus tard dans le jeu (exemple : 1 m de front par fantassin peut ne pas
    aller avec la population des villes ; on ajustera peut-être les villes
    plutôt que l'infanterie).
  - **Décimales : non** (décision de l'auteur). Le fichier de configuration
    des unités ne contient que des entiers ; l'auteur choisit ses valeurs en
    conséquence. **Exception : les multiplicateurs s'écrivent en décimal**
    (choix de l'auteur, plus lisible qu'un pourcentage) : `0.5`, `1.2`, `1`.
    **Deux décimales au plus** (choix de l'auteur). Le moteur les convertit
    une fois en entiers à l'échelle 100 au chargement (`Math.round(x × 100)` :
    0.5 → 50) et ne calcule ensuite qu'en entiers :
    `dégâts × multiplicateur / 100`, division entière à la fin. Un test
    vérifie que chaque multiplicateur est un multiple de 0,01. Règle écrite en
    commentaire en tête de `config/units.ts`.
  - **Attaques et PV : entiers, par changement d'échelle** (décision de
    l'auteur). Une unité est un paquet : **une unité d'infanterie = 10
    personnes, 10 fusils, 10 mètres de front** (remplace « 1 fusil, 1
    personne, 1 mètre »). Seul le rapport attaque / PV compte, donc l'échelle
    ne change pas les résultats.
  - **Attribut 15 : nombre d'équipements par unité** (`equipmentCount`) :
    toujours un seul type d'équipement, mais en plusieurs exemplaires
    (infanterie : 10 fusils).
- **25 octobre 2026** — unités écrites dans `config/units.ts` : infanterie
  (complète). Règles de l'auteur pour le fichier :
  - **Valeurs par défaut** : largeur de percée absente = largeur de front ;
    multiplicateurs de percée et de contre-attaque absents = multiplicateur
    d'attaque. Écrit par une clé absente (champ optionnel).
  - **Icône provisoire** : `miscellaneous/misc-dev-icon.png`, toute rouge, pour
    voir d'un coup d'œil les icônes qui restent à dessiner.
  - **Mitrailleuse** (en attente) : attaque anti-infanterie 5, antiaérienne 1,
    largeur 10, multiplicateurs attaque 0,2, percée 0,2, contre-attaque 0,5,
    type équipement, à pied, icône provisoire. Manquent : attaque antichar,
    population, nombre d'équipements, et la façon dont elle est perdue
    (ci-dessous).
  - **Pertes du type « équipement »** (dit par l'auteur) : un équipement est
    perdu en plus de l'infanterie. Question de l'auteur : écrire un rapport
    aux pertes d'infanterie (« 1 PV » = une mitrailleuse perdue par unité
    d'infanterie perdue), ou donner des PV (500) à chaque équipement, chacun
    subissant les dégâts indépendamment ? Proposition : pertes en
    pourcentage. Quand l'infanterie du front perd x % de ses unités, chaque
    type « équipement » perd `x % × lossRatio` de ses unités (décimal, 1 =
    même pourcentage), hommes et matériel ensemble.
  - **Décidé** : pertes en pourcentage. Un type « équipement » n'a pas de PV ;
    il a un **multiplicateur de pertes** (`lossMultiplier`, décimal comme les
    autres multiplicateurs, 1 = même pourcentage que l'infanterie du front,
    écrit « 1 » parce que plus lisible que des PV relatifs à l'infanterie).
    Infanterie et blindés gardent leurs PV.
  - **Description** (décidé par l'auteur) : texte affiché au survol. Chaque
    équipement (armement) a une description, affichée au survol de son icône
    dans la vue des usines. Une unité peut avoir sa propre description ;
    sinon, elle prend celle de son équipement (page des fronts). Champ
    `description` optionnel dans `config/units.ts` et dans `ProductConfig`
    (`config/goods.ts`, commun aux biens et à l'armement). Textes de
    l'auteur écrits : fusil, mitrailleuse (armement), infanterie (unité). La
    mitrailleuse (unité) prend celle de l'armement. Infobulle de la vue des
    usines : pas encore faite (04-Tooltips, « Armement »).
  - **Multiplicateur de pertes optionnel, 1 par défaut** : remarque de
    l'auteur, avec des pertes en pourcentage, la proportion en nombre suit
    déjà la largeur (artillerie 100 m contre infanterie 10 m → 1 artillerie
    perdue pour 10 infanteries). **Rôle du champ** (précisé par l'auteur) :
    permettre qu'un équipement soit plus résistant (< 1) ou plus fragile
    (> 1) que l'infanterie qu'il accompagne ; pourcentage perdu =
    pourcentage perdu par l'infanterie × lossMultiplier. La largeur reste
    nécessaire (elle fixe le nombre d'unités qui remplissent la niche).
  - **Artillerie écrite** : attaque anti-infanterie 50, antichar 5,
    antiaérienne 0, largeur 100, population 10, 1 pièce par unité, type
    équipement, à pied, multiplicateur d'attaque 1 (les autres par défaut),
    icône provisoire ; description sur l'armement (« Indispensable pour
    causer du tort à l'échelle industrielle. »).
  - **Question posée** : un front sans infanterie (seulement des équipements)
    ne perdrait jamais d'équipement, puisque ses pertes suivent celles de
    l'infanterie. Réponse de l'auteur : **le déploiement des équipements est
    plafonné par l'infanterie**. Remplissage de chaque niche d'équipement en
    première ligne ≤ remplissage de la niche infanterie (infanterie à 50 % →
    au plus 50 % de chaque équipement ; sans infanterie, aucun équipement
    déployé). Question suivante posée : où vont les équipements au-delà du
    plafond (seconde ligne, ou réserve non déployée) ?
  - **Au-delà du plafond** (dit par l'auteur) : l'équipement en trop pour la
    première ligne va en seconde ligne, **toujours plafonné par l'infanterie**
    (celle de la seconde ligne) ; ce qui dépasse encore reste **en stock**.
  - **Plafond en seconde ligne** (proposition, non validée) : la même règle
    écrite en mètres, valable dans les deux lignes. Dans une ligne, les mètres
    occupés par chaque niche d'équipement ≤ les mètres occupés par
    l'infanterie de cette ligne. Première ligne : largeur de front ; seconde
    ligne : largeur de percée. Exemple : 30 infanteries en seconde ligne
    (300 m) → au plus 3 artilleries (300 m).
  - **Stock** (proposition) : la réserve d'armement nationale (00-Game §8.3) ;
    l'équipement n'y est lié à aucune population.
  - **Validé par l'auteur** : plafond en mètres dans les deux lignes, et stock
    = réserve d'armement nationale.
  - **Canon antichar écrit** : 1 pour 5 infanteries → largeur 50 ; attaque
    anti-infanterie 0, antichar 50 ; population 5 ; 1 pièce par unité ;
    équipement, à pied ; multiplicateur d'attaque 0,2 (défensif par nature,
    percée et contre-attaque par défaut) ; icône provisoire ; description
    sur l'armement (« La réponse de base aux blindés adverses. »). Attaque
    antiaérienne : 0, non dite par l'auteur, à confirmer.
  - **Canon antiaérien écrit** : comme le canon antichar, mais antichar 0 et
    antiaérienne 50. L'aérien n'est pas implémenté : valeur abstraite pour
    l'instant (commentaire dans `config/units.ts`). Description sur
    l'armement : « Utile si vous n'avez pas le contrôle du ciel. »
  - **Corrections de l'auteur** : canon antichar et canon antiaérien,
    multiplicateur de contre-attaque 0,7 (au lieu de 0,2 par défaut) ; canon
    antiaérien, attaque anti-infanterie 10 ; sa description gagne « Peut
    occasionnellement être pointé vers le sol. »
  - **Chenillette (tankette)** (dit par l'auteur, pas encore écrite) :
    blindé, largeur 100, anti-infanterie 50, antichar 10, à pied, 1 000 PV,
    multiplicateurs 1, icône provisoire. Première unité d'une niche partagée :
    niche **char d'assaut** (`assaultTank`), avec les autres chars à venir.
    Manquent : population, attaque antiaérienne, nombre de véhicules par
    unité, et son équipement : il n'existe pas d'armement « chenillette »
    (production par ligne, ouvriers, fer, usine et place dans l'arbre de
    production, description).
  - **Chenillette, réponses de l'auteur** : population 10, antiaérienne 0, un
    véhicule par unité. Produite par l'usine des tracteurs
    (`FACTORY_TYPES.miningMachines`), débloquée par le tracteur (enfant de
    `tractor` dans l'arbre). Restent : production, ouvriers et fer par
    ligne, description de l'armement.
  - **Chenillette écrite** : armement `tankette` (1 par ligne et par tour,
    200 ouvriers, 5 fer : comme le tracteur sauf la production), nœud de
    l'arbre de l'usine mécanique sous le tracteur, unité `tankette` (blindé,
    1 000 PV, multiplicateur d'attaque 1), niche `assaultTank`. Description
    de l'armement : « Aucune chance face à un char d'assaut. Mais redoutable
    contre l'infanterie s'il n'y a pas de réponse appropriée. »
  - **Icônes de l'armement** (dessinées par l'auteur, 25 octobre) :
    `armament/armament-gun.png` (fusil), `armament-machine-gun.png`,
    `armament-artillery.png`, `armament-AT-gun.png`, `armament-AA-gun.png`,
    assignées aux armements et aux unités correspondantes. Restent
    provisoires : la chenillette (armement et unité). Tracteur passé de 30 à 10 par tour
    (auteur).
  - **Table des niches écrite** (`NICHES`, `config/units.ts`) : une niche par
    unité existante (infanterie, mitrailleuse, artillerie, antichar,
    antiaérien) et `assaultTank`, vide en attendant la chenillette. Une niche
    par unité pour les cinq premières : choix provisoire, à valider.
  - **Mitrailleuse écrite** : attaque anti-infanterie 5, antichar 0,
    antiaérienne 1, largeur 10 (percée : par défaut), population 1, 1
    mitrailleuse par unité, type équipement, multiplicateur de pertes 1, à
    pied, multiplicateurs attaque 0,2, percée 0,2, contre-attaque 0,5, icône
    provisoire.
- **25 octobre 2026** — avant l'interface d'affectation des troupes
  (décisions de l'auteur) :
  - **Soldats dans la répartition de la population** (00-Game §4) : pris **en
    dernier**, après tous les autres rôles. Dans l'onglet Population de la
    barre d'informations, un interrupteur **« MOBILISATION FORCÉE »**
    (interrupteur standard, rouge ; texte rouge, gras, majuscules), éteint par
    défaut, fait passer les soldats **en premier**. Allumé : on remplit chaque
    front jusqu'au pourcentage de sa priorité (100 %, 50 %, 0 % pour les
    priorités 1, 2, 3) ; le reste de la population retourne aux autres rôles.
  - **Onglet Population** : les rôles rangés du plus prioritaire au moins
    prioritaire. Les soldats peuvent rester affichés en dernier même quand la
    mobilisation forcée est allumée.
  - **La priorité n'est qu'un pourcentage** : 1 → 100 %, 2 → 50 %, 3 → 0 %.
    Toutes les règles lisent le pourcentage, jamais le niveau ; un niveau
    intermédiaire (25 %) pourra s'ajouter. Proposition :
    `FRONTS.priorityPercent = [100, 50, 0]` dans le fichier de configuration.
    Conséquences sur les formules plus haut (réécrites, non validées) :
    - première ligne : objectif d'un front = son pourcentage × besoin ;
      paliers : (1) chaque front jusqu'à son pourcentage, (2) puis chaque
      front jusqu'à 100 %, par pourcentage décroissant (un palier par
      pourcentage distinct) ;
    - seconde ligne : poids d'un front = pourcentage × largeur (remplace les
      poids 2, 1, 0, qui donnaient les mêmes proportions).
  - **Taille d'un front qui change** (fusion, coupure, ville prise ou perdue) :
    pas de règle d'identité à part. Fusion : les troupes des fronts fusionnés
    sont mises ensemble. Ensuite, dans tous les cas, le front se recale sur son
    besoin : le surplus repart vers la réserve du pays, le manque est pris dans
    la réserve. Coupure : proposition, troupes partagées au prorata du nombre
    de connexions de chaque morceau. Réglages (priorité, types autorisés,
    vidage) d'un front fusionné ou coupé : proposition, ceux du front qui
    apporte le plus de connexions ; à égalité, le plus petit identifiant.
  - **Nouveau front** : priorité 1 ; tous les types autorisés dans les deux
    lignes (un type peut donc être autorisé dans les deux à la fois).
  - **Réglés par le joueur, par front** : priorité, option de vidage
    (confirmé).
  - **Délai** : tout mouvement entre la réserve et un front (aller ou retour)
    prend `FRONTS.transferTurns` tours (valeur à fixer). Mécanisme proposé :
    chaque front a une liste de mouvements en cours (type d'unité, nombre,
    sens, tour d'arrivée), dans l'état et dans le hash ; à chaque tour, ceux
    dont le tour d'arrivée est atteint sont appliqués. **Piège** : la
    répartition compte les unités en route vers un front comme déjà
    présentes, sinon elle renverrait le même manque à chaque tour pendant le
    délai. Une unité en route ne combat pas ; sa population ne travaille pas.
  - **Déclin de l'armement** (00-Game §8.3) : l'équipement utilisé sur les
    fronts **compte** dans le stock qui décline. La production d'armement ne
    s'arrête jamais (00-Game §8.3) ; seul l'excès au-dessus du stock cible
    décline. Le déclin ne peut retirer que l'équipement non déployé : si
    l'équipement des fronts dépasse à lui seul le stock cible, le stock non
    déployé décline vers zéro, la production continue.
  - **Barre de stock de l'armement** (détail Armement de la barre
    d'informations) : nouvelle portion **jaune foncé** à gauche, l'équipement
    utilisé sur les fronts. De gauche à droite : jaune foncé (sur les fronts),
    bleu (en stock), hachures rouges (au-dessus du stock cible), comme
    aujourd'hui pour les deux dernières.
  - **Plus tard (piste, pas maintenant)** : une option qui règle
    automatiquement les lignes d'armement sur la taille des armées. La
    demande de l'armée servirait de limite de production, avec arrêt
    automatique des lignes, comme pour les biens.
- **25 octobre 2026** — panneau d'un front (dit par l'auteur) :
  - **Un panneau = un front.** Même avec plusieurs fronts, on en ouvre un.
  - **Deux façons de l'ouvrir** : clic sur le front dessiné sur la carte ; ou
    clic sur une ligne de la **liste des fronts**.
  - **Liste des fronts** : ouverte par un bouton de la barre d'informations,
    en **cinquième position**, juste à droite d'Armement. Une ligne par
    front, rangées par île (« continent ») puis par adversaire. Plus tard :
    une petite description, avec le nombre de soldats de chaque côté. Pour
    l'instant : l'île et l'adversaire seulement.
  - **Dessin d'un front sur la carte** : aujourd'hui, une frontière entre
    deux joueurs = deux lignes côte à côte, une case de la couleur sombre de
    chaque joueur. Sur un front : deux lignes rouges entre les deux, puis les
    deux lignes des joueurs. Proposition (maquette montrée) : la case de
    chaque côté de la limite devient rouge, la ligne sombre de chaque joueur
    recule d'une case vers l'intérieur ; bande de 4 cases : sombre A, rouge,
    rouge, sombre B. Une case de frontière est « de front » si les villes des
    deux zones qu'elle sépare sont reliées par une connexion d'un front
    (`tileCity` des deux côtés → paire de villes → connexion).
  - **Zone de clic** (dit par l'auteur) : toute la zone autour du front ouvre
    le panneau, pas seulement la ligne. Première proposition (zones des
    villes du joueur) remplacée par la zone de front ci-dessous.
  - **Zone de front** (dit par l'auteur, maquette montrée) : un « boudin »
    autour de la ligne de front, **des deux côtés de la frontière**, de
    largeur le rayon de contrôle (`CITY.controlRadius`) de chaque côté de la
    ligne. Plusieurs fronts qui se chevauchent : partage de Voronoi (chaque
    case au front le plus proche). Dessin : **contour rouge**, **hachures
    rouges espacées**, environ un quart de la surface sous le trait et trois
    quarts intacts (plus espacées que les hachures habituelles), pour voir la
    carte en dessous. **Un clic dans la zone ouvre le panneau du front** ;
    hors de la zone, un clic sur le territoire adverse ouvre la diplomatie
    comme aujourd'hui (et la liste des joueurs pourra aussi l'ouvrir).
    Mécanisme proposé, non validé :
    - ligne de front = suite des points du front (un par connexion, ordonnés
      comme au §8, points 2 et 3) ;
    - une case est dans la zone d'un front si sa distance à cette ligne est ≤
      `CITY.controlRadius` ; à plusieurs fronts, celui dont la ligne est la
      plus proche ;
    - calcul dans le client seulement (affichage et clic), refait quand les
      fronts changent ;
    - hachures : trait de 2 px tous les 8 px (25 %), à 45° ;
    - **terre seulement** (décidé par l'auteur), comme le territoire
      (00-Game §11).
  - **Précisions de l'auteur** :
    - la double ligne rouge sur la frontière **reste** ; la zone hachurée
      s'ajoute autour ;
    - les hachures sont provisoires : plus tard, de petits personnages qui
      se tirent dessus ;
    - nouvelle case à cocher dans le menu « Carte » (00-Game §11) : « Zones
      de front », **cochée par défaut**, pour afficher ou cacher les
      hachures ;
    - **la zone de clic est la zone de front, affichée ou non** : cachée,
      elle ouvre quand même le panneau ;
    - **survol** : la souris au-dessus d'une zone de front l'affiche, même
      quand la case « Zones de front » est décochée ; seulement la zone
      survolée (confirmé).
- **25 octobre 2026** — disposition du panneau d'un front (dit par
  l'auteur, maquette montrée) :
  - Grand panneau, une bonne partie de l'écran.
  - **Deux moitiés symétriques**, une barre au milieu = la ligne de front. À
    gauche le joueur actif, à droite l'adversaire (pas de brouillard de
    guerre : tout est visible).
  - **Trois colonnes par moitié**, en partant de la barre centrale :
    première ligne, seconde ligne, avions (vide pour l'instant).
  - **Une rangée par type d'unité** : infanterie, puis équipements
    d'infanterie, puis les chars de chaque type. À côté de chacun, un
    pourcentage : la part de la ligne de front remplie.
  - **En haut** : la priorité du front et l'option de vidage.
  - **Entre la colonne première ligne et la colonne seconde ligne**, pour
    chaque type d'unité du joueur : un interrupteur à **trois positions**,
    priorité première ligne / équilibré / priorité seconde ligne.
  - Lecture proposée : cet interrupteur **remplace** les cases « types
    autorisés en première ligne / en seconde ligne ». « Priorité première
    ligne » = la règle d'avant (remplir la première ligne, le surplus en
    seconde). « Priorité seconde ligne » = tout en seconde ligne (elle n'a
    pas de limite, rien ne déborde vers la première), ce qui couvre « réserver
    ses meilleures unités à la seconde ligne ». À confirmer.
  - **Questions posées** : sens de « équilibré » ; pourcentage affiché en
    seconde ligne (elle n'a pas de largeur à remplir) ; position par défaut
    de l'interrupteur (proposé : priorité première ligne). Réponses
    ci-dessous.
- **25 octobre 2026** — précisions de l'auteur sur le panneau :
  - **« Équilibré »** : le même pourcentage du front rempli dans les deux
    lignes. Pourcentage en première ligne = unités × largeur de front /
    largeur du front ; en seconde ligne = unités × **largeur de percée** /
    largeur du front (largeur de percée absente : largeur de front, déjà la
    règle de `config/units.ts`). Une unité qui prend moins de place en
    seconde ligne y va donc en plus grand nombre. Calcul proposé, en entiers,
    pour `u` unités d'un type, `w1` largeur de front, `w2` largeur de percée :
    première ligne `a = floor(u × w2 / (w1 + w2))`, seconde ligne
    `b = u − a` (alors `a × w1 ≈ b × w2`) ; si `a` dépasse la place libre en
    première ligne, le surplus passe en seconde. Le plafond par l'infanterie
    s'applique ensuite dans chaque ligne.
  - **Position par défaut de l'interrupteur** : priorité première ligne.
  - **Disposition d'une rangée** (pour le joueur, de l'extérieur vers la
    barre) : nom du type (une seule fois), quantité en seconde ligne,
    interrupteur, quantité en première ligne, pourcentage du front tenu en
    première ligne (quatrième colonne, titre court : proposé « Tenu »).
    Quantités en valeur absolue (nombre d'unités). En miroir pour
    l'adversaire. Colonne avions : proposé à l'extérieur, au-delà des noms.
  - **Bouton renommé** : « Autoriser la réassignation à d'autres fronts »
    (l'option de vidage).
- **25 octobre 2026** — mise en page du panneau (dit par l'auteur, maquette
  v3 montrée) :
  - Titre de la colonne des pourcentages : **« % front »**.
  - Titre du panneau **centré**.
  - Noms des types **alignés à droite**, **icône à droite du nom** (pour le
    joueur ; en miroir pour l'adversaire : icône puis nom, à gauche).
  - **Groupement par niche** : une rangée d'en-tête par niche, avec la
    couverture de la niche (% front), puis une rangée par type de la niche
    avec sa propre couverture. Le joueur voit pourquoi un type moins bon
    reste en seconde ligne (exemple : canons antichars en surplus quand les
    chasseurs de chars blindés remplissent déjà la niche).
  - Le panneau **s'allongera** avec les nouveaux types : proposition, titre
    et réglages fixes en haut, liste des niches défilante en dessous.
  - Pas de texte « ligne de front » sous la barre centrale.
  - **Barre centrale** : deux bandes, la couleur du joueur puis celle de
    l'adversaire, sur la même largeur totale (8 px : 4 + 4). Pas de rouge
    (correction de l'auteur : le rouge au milieu ne va pas dans le panneau).
    La double ligne rouge sur la carte n'est pas concernée.
  - **Séparateurs de niche** continus, à la même hauteur sur toute la
    rangée (maquette v4). **Placés au-dessus de l'en-tête de niche, pas en
    dessous** (correction de l'auteur) : trait, nom de la niche, ses types,
    puis le trait de la niche suivante. Une niche et ses types forment ainsi
    un seul bloc entre deux traits.
  - **Boutons d'attaque** (dit par l'auteur) : une rangée entre le titre et
    la rangée priorité / réassignation, avec trois boutons, un par type
    d'attaque : attaque sur tout le front, percée, barrage d'artillerie
    (barrage hors périmètre pour l'instant : bouton présent, sans effet,
    supposé). **Percée** : le clic ne lance pas l'attaque ; il ferme le
    panneau et passe la carte en mode choix d'axe ; le joueur clique sur une
    route entre deux villes (une connexion du front), qui devient l'axe de
    la percée. Proposition : la connexion la plus proche du clic, parmi
    celles du front ; Échap annule.
  - **Les boutons d'attaque sont des interrupteurs** (dit par l'auteur) : un
    clic lance l'attaque, un second l'arrête. **Un seul type d'attaque en
    cours à la fois** (par front : supposé). Lancer un autre type pendant une
    attaque : proposition, arrête la première et lance la seconde.
    - attaque sur tout le front : continue jusqu'à ce que le joueur l'arrête ;
    - percée : s'arrête d'elle-même si elle n'aboutit pas ; le joueur peut
      l'arrêter plus tôt pour éviter des pertes ;
    - barrage : comme l'attaque sur tout le front.
  - **Apparence** : rouge clair au repos ; actif, contour rouge foncé épais
    qui clignote.
  - Conséquence pour le moteur : une attaque est un **état durable** du
    front (type d'attaque en cours, axe pour une percée), dans l'état et le
    hash ; deux ordres, lancer et arrêter (noms à fixer).
  - **Confirmé** : un seul type d'attaque en cours **par front et par
    joueur** ; lancer un autre type arrête le premier. **Les deux joueurs
    peuvent attaquer en même temps** sur le même front : l'état d'attaque
    est donc gardé pour chaque camp.
  - **Boutons des deux côtés** : les trois boutons du joueur sont dans sa
    moitié du panneau ; les trois mêmes, en miroir, dans la moitié de
    l'adversaire, **gris**, sans effet au clic, avec le même contour rouge
    clignotant quand l'attaque adverse est active. Le joueur voit ainsi
    quand il est attaqué.
- **25 octobre 2026** — ce qu'il reste à définir pour que les attaques
  fonctionnent (liste dressée pour l'auteur) :
  - la guerre existe déjà (diplomatie, `packages/engine/src/diplomacy.ts` :
    neutre, pacte, guerre) ; attaque seulement en guerre (supposé) ; que
    deviennent les positions du front à la paix ?
  - rythme du combat : à chaque tour, ou tous les N tours ;
  - calcul des dégâts : somme des attaques (unités × attaque × couverture ?),
    partage entre attaque anti-infanterie et antiblindée, et entre les types
    visés du défenseur ; le défenseur riposte-t-il pendant l'attaque ;
  - effet du pourcentage de présence sur les statistiques ;
  - qui gagne un échange, et de combien le front avance sur chaque route
    (toutes les connexions également, ou selon le rapport local) ;
  - percée : nombre d'unités engagées dans la largeur de percée, condition
    « première ligne battue », avancée selon la mobilité des deux camps,
    arrêt automatique en cas d'échec ;
  - prise d'une ville : déclencheur (front arrivé au bout de la route ?) ;
  - front sans défenseur ;
  - bots : affectation des troupes, attaques.
- **25 octobre 2026** — combat (dit par l'auteur) :
  - **Rythme** : un round de combat tous les `FRONTS.combatTurns` tours ;
    10 pour commencer (valeur de l'auteur) : un round par seconde.
  - **Dégâts en valeur absolue** (correction : pas en pourcentage). Plus un
    front est large, plus il y a de pertes. Un camp inflige la **somme** des
    attaques de toutes ses unités engagées : un total anti-infanterie et un
    total antiblindé. Antiaérien : autre fonctionnement, hors périmètre.
  - **Pas d'attaque en cours : aucun dégât.**
  - **Attaque sur tout le front** : toute la première ligne de l'attaquant
    tire (multiplicateur d'attaque), toute la première ligne du défenseur
    riposte (valeurs de base, pas de multiplicateur en défense). Les deux
    camps subissent des pertes dans le même round.
  - **Les deux joueurs attaquent au même endroit** : à chaque round, chaque
    joueur est évalué comme attaquant et comme défenseur : deux combats.
  - **Avancée** : percée, seulement sur son axe ; attaque générale, sur
    toutes les routes du front ; barrage d'artillerie, aucune avancée, des
    pertes seulement. Conditions et distance : à décrire par l'auteur. Il n'y
    a pas de vainqueur d'un round : des pertes des deux côtés, et peut-être
    une avancée de l'attaquant.
  - **Répartition des dégâts reçus** :
    - anti-infanterie : unités d'infanterie détruites = dégâts / PV de
      l'infanterie ; les équipements perdent le même pourcentage (× leur
      multiplicateur de pertes), comme décidé plus haut ;
    - antiblindé : pour chaque type de blindé, PV totaux = nombre × PV d'une
      unité ; chaque type reçoit une part des dégâts égale à sa part des PV
      totaux des blindés ; il perd `dégâts reçus / PV d'une unité` unités ;
    - **arrondi au plus proche** (dit pour les blindés ; l'auteur pense
      l'arrondi négligeable, à vérifier) ;
    - dégâts d'un type sans cible (antiblindé sans blindé en face) : perdus
      (lecture, non dite).
  - **Percée** :
    - **largeur** = la part du front d'une connexion : largeur du front /
      nombre de connexions (front de 2 connexions → 50 % ; de 10 → 10 %).
      Une percée sur plusieurs axes à la fois : hors périmètre ;
    - **unités engagées, attaquant** : sa seconde ligne, le plus d'unités
      possible dans la largeur de la percée, chacune comptée avec sa largeur
      de percée ; multiplicateur de percée ;
    - **unités engagées, défenseur** : une largeur équivalente de sa première
      ligne (et non toute la ligne), valeurs de base. Ces unités sont
      **suivies à part** du reste de la ligne tant que la percée dure ;
    - **délai** : une percée ordonnée commence après 5 secondes, réglable
      (`FRONTS.breakthroughDelay…`, unité à confirmer) ;
    - **seuil de réussite** : toute l'**infanterie** défenseure engagée est
      éliminée, même s'il reste des véhicules ; ceux-ci « retournent en
      réserve ». Valable pour la première et pour la seconde ligne ;
    - **seconde ligne** : après la première ligne, la percée affronte la
      seconde ligne du défenseur. Unités engagées : celles de la seconde
      ligne qui ne défendent pas déjà une autre percée, le plus possible dans
      la largeur de la percée, comptées avec leur **largeur de percée** ;
      multiplicateur de contre-attaque pour le défenseur, d'attaque pour
      l'attaquant (décidé plus haut). Plusieurs percées : la seconde ligne se
      répartit **équitablement** entre elles, quitte à retirer des unités
      d'une percée pour les mettre sur une autre ;
    - **seconde ligne percée** : le front avance directement jusqu'à la ville
      suivante. Seconde ligne tenue : petite avancée, à décrire ;
    - **essoufflement** : une percée s'arrête d'elle-même si elle s'essouffle.
      Idée de l'auteur, jugée trop extrême : aucun ennemi éliminé pendant un
      round. Règle à trouver ;
    - **plusieurs percées** : bouton percée armé, le joueur clique sur
      plusieurs routes ; chaque clic lance une percée. Il peut réarmer le
      bouton plus tard pour en ajouter. Annulation : une petite croix en haut
      du tableau de chaque percée, seulement pour les siennes.
  - **Panneau, section des percées** : sous les boutons d'attaque. Un petit
    tableau par percée en cours, deux par rangée, puis rangée suivante ; le
    panneau défile s'il est trop long. Chaque tableau : en-tête « Percée
    première ligne » ou « Percée seconde ligne » selon la progression ; une
    colonne par camp ; une rangée par type d'unité engagé, sans niches ;
    contour de la couleur du joueur (qui lance la percée : supposé), second
    contour rouge clignotant possible ; croix d'annulation pour les siennes.
    Le panneau compte les unités dans les percées et hors des percées.
  - **Prise d'une ville** : le front arrivé au bout d'**une seule** route
    suffit. Ensuite : encerclement, règles plus haut.
  - **Front sans défenseur** : cas limite de la formule de vitesse d'avancée
    (à décrire).
  - **Paix** : les fronts sont supprimés, les frontières reviennent au
    partage de Voronoi. Précisé ci-dessous.
  - **Bots** : plus tard.
- **25 octobre 2026** — réponses de l'auteur :
  - **Arrondi au plus proche, 0,5 vers le haut**, pour tous les types
    (infanterie comprise ; remplace « le reste est perdu »). En entiers :
    `floor((2 × dégâts + PV) / (2 × PV))`. Une unité perdue l'est en entier
    (10 soldats et 10 fusils pour l'infanterie) : pas de fraction d'unité.
  - **Essoufflement d'une percée** : elle s'arrête quand les unités engagées
    par l'attaquant tombent sous `FRONTS.breakthroughExhaustionPercent` % de
    leurs PV de départ ; **35** (valeur de l'auteur).
  - **Paix** : on supprime **tout ce qui tient à la guerre active** :
    positions du front, attaques, percées. Les troupes restent sur le front.
  - **Fronts en paix** : on peut placer des troupes sur un front en paix (une
    frontière, front potentiel). Gérés comme les fronts en guerre (même zone,
    même rayon, même partage de Voronoi, même panneau), simplement inactifs.
    - **Liste des fronts** : deux sections, « fronts actifs » (en guerre)
      puis « fronts en paix ».
    - **Carte** : zone d'un front en paix hachurée en **bleu** au lieu du
      rouge, **seulement au survol** ; jamais affichée sinon, même avec la
      case « Zones de front » cochée (sinon la carte serait trop chargée).
      Clic dans la zone : ouvre son panneau.
  - **Unités de l'attaquant qui survivent à une percée** (réussie ou
    échouée) : retournent dans sa seconde ligne, **sans délai**.
- **25 octobre 2026** — réponses de l'auteur (suite) :
  - **Véhicules du défenseur** encore engagés quand son infanterie tombe dans
    une percée : rejoignent leur ligne, sans délai.
  - **Délai avant une percée** : compté en **tours** (5 s = 50 tours).
  - **Affichage en guerre** : la courbe lisse (Catmull-Rom) devient la
    nouvelle frontière et sépare les couleurs des joueurs. Repli accepté si
    c'est trop compliqué : couleurs au partage de Voronoi, courbe en
    surimpression. Proposition : surimpression d'abord (tant que l'avancée
    n'existe pas, les points restent au milieu des routes et la courbe suit
    presque le partage de Voronoi) ; couleurs le long de la courbe avec
    l'avancée.
  - **`FRONTS.metersPerConnection`** : du même ordre de grandeur que le rayon
    de contrôle d'une ville (25 cases). Demande une échelle mètres par case,
    qui n'existe pas encore : valeur à discuter.
  - **`FRONTS.transferTurns`** : 5 s = **50 tours**, à essayer. Plus tard,
    piste : un délai plus long pour un front sur une île loin de la capitale.
  - **Fondation interdite dans la zone hachurée d'un front actif** (en
    guerre) : remplace `noFoundingDistance`. Conséquence : le **moteur** doit
    calculer la zone de front (jusqu'ici prévue dans le client seulement),
    en entiers, pour valider `found_city` ; le client reprend le même calcul.
    **Remplacé** (auteur, pour ne pas alourdir le moteur) : **le rayon
    d'expansion d'une ville impliquée dans un front actif ne compte pas**
    pour fonder. Dans `found_city`, la recherche d'une ville du joueur à
    portée d'expansion saute les villes qui ont une connexion dans un front
    en guerre. La zone de front reste un calcul du client seulement.
  - **`FRONTS.encirclementLossPercent`** : **50**.
  - **Fichier `config/fronts.ts`** : tous les réglages des fronts, lisible et
    bien commenté (demande de l'auteur).
  - **Niches** : une niche par unité pour les cinq premières, validé.
  - **Unités engagées dans une percée** : choisies par la même règle que le
    remplissage d'un front (niche par niche, la meilleure unité d'abord).
  - **Attaque générale et percées en même temps : oui.** Lancer une attaque
    générale **n'arrête pas** les percées (remplace la proposition
    « un seul type à la fois » pour ce cas). Les unités du défenseur engagées
    dans une percée **restent comptées dans sa première ligne** : elles
    subissent aussi les dégâts de l'attaque générale.
  - **Bots** : en dernier.
  - **Question de l'auteur** : la position du front peut-elle être décimale,
    quelle est la plus petite progression possible ? Réponse : entier en
    millièmes de la route, plus petite progression 1/1000 ; l'échelle peut
    être affinée sans coût.
- **25 octobre 2026** — échelle et avancée (dit par l'auteur) :
  - **`FRONTS.metersPerConnection` = 5 000** (valeur de l'auteur).
  - **Ordre de grandeur de la carte** : le rayon de contrôle d'une ville vaut
    environ **10 000 m** (25 cases, donc une case ≈ 400 m). Repère pour
    choisir les valeurs, pas une règle du moteur (écrit aussi dans 00-Game
    §3.1).
  - **Avancée = déséquilibre × vitesse**, à chaque round de combat :
    - **déséquilibre** : rapport infanterie de l'attaquant / infanterie du
      défenseur, **infanterie seulement** (unités engagées). Deux seuils :
      `FRONTS.advanceThresholdA` = **2** (en dessous, pas d'avancée) et
      `FRONTS.advanceThresholdB` = **5** (vitesse maximale). Pourcentage de
      déséquilibre = 0 % au seuil A, 100 % au seuil B, linéaire entre les
      deux, borné à 0 et 100 % ;
    - **vitesse de l'armée** : à pied, `FRONTS.footSpeedPermille` = **5**
      (0,5 % de la route par round) ; motorisée,
      `FRONTS.motorizedSpeedPermille` = **15** (1,5 %). Vitesse
      intermédiaire pour une armée partiellement motorisée : piste pour plus
      tard. Aujourd'hui l'infanterie est toujours à pied ; des variantes
      motorisées viendront ;
    - **avancée du round** = arrondi au plus proche (0,5 vers le haut) de
      `déséquilibre × vitesse`, en millièmes de la route ;
    - **résolution** : 1 000 unités par route (choix de l'auteur).
  - **Calcul en entiers** (proposition), `a` et `d` infanteries engagées de
    l'attaquant et du défenseur, `v` la vitesse en millièmes :
    `x = a − A × d` borné à `[0, (B − A) × d]`, puis
    `avancée = floor((2 × x × v + (B − A) × d) / (2 × (B − A) × d))`.
    Défenseur sans infanterie (`d = 0`) : déséquilibre 100 %, vitesse
    maximale ; attaquant sans infanterie : aucune avancée.
  - Ordres de grandeur avec ces valeurs : à pied, au mieux 5 ‰ par round,
    soit 100 rounds (100 s) du milieu d'une route jusqu'à la ville ;
    motorisé, environ 34 s. Avec l'arrondi, à pied, un déséquilibre sous
    10 % (rapport entre 2 et 2,3) ne fait pas avancer.
- **26 octobre 2026** — avancée, suite (dit par l'auteur) :
  - **Les deux camps attaquent en même temps** : chacun pousse, les deux
    avancées s'appliquent en sens contraire sur chaque route (ça avance, ça
    recule).
  - **La formule déséquilibre × vitesse ne vaut que pour l'assaut
    généralisé** (attaque sur tout le front), à chaque round, sur toutes les
    routes du front.
  - **Percée : pas d'avancée à chaque round.** Quand la première ligne
    lâche (son infanterie engagée éliminée), le front avance **d'un coup**
    sur l'axe de `N × v` millièmes, `v` la vitesse de l'armée qui perce (5 à
    pied, 15 motorisée) et `N` = `FRONTS.breakthroughJumpRounds` = **50**
    pour commencer : 250 ‰ à pied, 750 ‰ motorisée.
  - **Réaction de la seconde ligne adverse** : pour remplir la largeur de la
    contre-attaque face à la percée, on prend **d'abord les unités
    motorisées**, puis on complète avec les autres. Pourcentage de
    motorisation de cette force : à 100 %, `N` ne change pas ; sous 50 %,
    `N × X`, `X` = `FRONTS.slowReactionFactor` = **3** pour commencer. Une
    seconde ligne à pied réagit lentement et laisse l'attaquant avancer plus.
    Une percée qui ne brise pas la seconde ligne fait donc quand même avancer
    le front.
  - **Seconde ligne brisée** : le front avance jusqu'à la ville suivante
    (décidé plus haut) ; une avancée qui dépasse le bout de la route arrive
    aussi à la ville (lecture : prise).
  - **Pourcentage de motorisation d'une force** : chaque unité pèse sa
    **largeur de front** ; seulement l'**infanterie et les véhicules**, pas
    l'équipement. Pourcentage = largeur des unités motorisées / largeur de
    toutes les unités comptées.
  - **Points d'attention pour plus tard** : l'équipement à pied ne ralentit
    pas une force (acceptable : l'équipement statique attaque mal, sauf
    l'artillerie, supposée derrière la ligne) ; piste, un interrupteur de
    motorisation de l'équipement (tracté par des camions).
  - **Questions posées** : facteur entre 50 % et 100 % de motorisation ;
    vitesse `v` d'une force qui perce partiellement motorisée ; largeur de
    front ou de percée comme poids pour une force de seconde ligne.
    Réponses ci-dessous.
- **26 octobre 2026** — percée, réponses de l'auteur :
  - **`N` = 10** (au lieu de 50, valeurs trop hautes) : saut de 50 ‰ à pied,
    150 ‰ motorisé ; × 3 face à une seconde ligne lente : 150 ‰ et 450 ‰.
  - **Facteur de réaction entre 50 % et 100 % de motorisation** : linéaire,
    `X` à 50 % jusqu'à 1 à 100 % (à 75 % : 2 avec `X` = 3). Sous 50 % : `X`.
  - **Vitesse de la force qui perce** : motorisée seulement si elle l'est à
    100 % ; sinon à pied.
  - **Interrupteur « Motorisé seulement »**, juste sous le bouton percée :
    allumé, seules les unités motorisées remplissent la largeur de la
    percée ; éteint, on complète avec les unités non motorisées s'il n'y a
    pas assez de motorisées (motorisées d'abord : confirmé). **Allumé par
    défaut** (seulement les motorisées).
  - **Poids de motorisation d'une force de seconde ligne** (contre-attaque,
    et force qui perce) : sa **largeur de percée** (à défaut, largeur de
    front), puisque c'est la place que ces unités occupent ; largeur de
    front pour une force de première ligne. Remplace la proposition
    « largeur de front partout ».
  - **Couleur des joueurs**, très légère, seulement à de petits endroits :
    proposition, un trait clair de la couleur du joueur sous chaque en-tête
    de niche, de son côté de la barre.
  - Interrupteurs : seulement du côté du joueur (proposition : l'adversaire
    n'en a pas dans le panneau ; ses quantités restent visibles, pas de
    brouillard de guerre).


## 13. Interface de contrôle d'un front : liste à tenir

L'interface n'est pas dessinée ; elle le sera avec l'auteur. Cette liste
rassemble ce qu'elle devra contenir, au fur et à mesure de la conception.
« Décidé » : l'auteur l'a dit. « Proposé » : à valider.

| Élément | État | Source |
| --- | --- | --- |
| Un panneau par front, ouvert par un clic dans sa zone de front (carte, affichée ou non) ou dans la liste des fronts | décidé | §12, 25 octobre |
| Hors du panneau : zone de front hachurée en rouge autour de chaque front ; case « Zones de front » du menu Carte, cochée par défaut ; zone survolée toujours affichée | décidé | §12, 25 octobre |
| Hors du panneau : double ligne rouge sur la frontière d'un front | décidé | §12, 25 octobre |
| Liste des fronts en deux sections, fronts actifs (en guerre) puis fronts en paix ; zone d'un front en paix hachurée en bleu, au survol seulement | décidé | §12, 25 octobre |
| Liste des fronts : bouton en 5e position de la barre d'informations (à droite d'Armement) ; une ligne par front, classés par île, puis par adversaire, plusieurs fronts possibles sous un même adversaire ; pour l'instant île et adversaire seulement, plus tard soldats de chaque côté | décidé | 00-Game §3.8, §12 |
| Priorité du front : 1, 2 ou 3 (= 100 %, 50 %, 0 %), réglée par le joueur ; 1 pour un nouveau front | décidé | §12, 25 octobre |
| Option « autoriser à vider ce front pour en remplir un autre », par front, désactivée par défaut | décidé | §12, 25 octobre |
| Types d'unités autorisés en première ligne et en seconde ligne, par front ; tous autorisés dans les deux lignes pour un nouveau front. Remplacé (à confirmer) par l'interrupteur à trois positions ci-dessous | décidé | §12, 25 octobre |
| Disposition : deux moitiés symétriques (vous à gauche, l'adversaire à droite) autour de la ligne de front ; colonnes première ligne, seconde ligne, avions (vide) ; une rangée par type d'unité avec le pourcentage de la ligne rempli ; priorité et vidage en haut | décidé | §12, 25 octobre |
| Interrupteur à trois positions par type d'unité, entre la quantité en seconde ligne et celle en première ligne : priorité première ligne (par défaut) / équilibré (même pourcentage du front dans les deux lignes) / priorité seconde ligne | décidé | §12, 25 octobre |
| Rangée, de l'extérieur vers la barre : nom aligné à droite et icône, quantité 2e ligne, interrupteur, quantité 1re ligne, « % front » ; miroir pour l'adversaire | décidé | §12, 25 octobre |
| Types groupés par niche : en-tête de niche avec sa couverture, puis la couverture de chaque type | décidé | §12, 25 octobre |
| Titre centré ; barre centrale en deux bandes, couleur du joueur et couleur de l'adversaire (pas de rouge) ; touches légères de la couleur de chaque joueur (trait sous chaque en-tête de niche) | décidé | §12, 25 octobre |
| Bouton « Autoriser la réassignation à d'autres fronts » (ancienne « option de vidage ») | décidé | §12, 25 octobre |
| Hors du panneau : interrupteur rouge « MOBILISATION FORCÉE » dans l'onglet Population de la barre d'informations ; rôles de la population rangés par priorité | décidé | §12, 25 octobre |
| Hors du panneau : portion jaune foncé « sur les fronts » dans la barre de stock de chaque armement | décidé | §12, 25 octobre |
| Largeur du front, en mètres | proposé | 00-Game §3.8 |
| Remplissage de chaque niche de première ligne, en %, et sa composition par type d'unité | proposé | §12, 25 octobre |
| Contenu de la seconde ligne, par type d'unité | proposé | §12, 25 octobre |
| Adversaire en guerre ou en paix ; position du front | proposé | 00-Game §3.8 |
| Rangée de trois boutons d'attaque entre le titre et la rangée priorité : attaque sur tout le front, percée, barrage d'artillerie (hors périmètre). Percée : ferme le panneau, puis clic sur la carte sur une route du front, qui devient l'axe. Interrupteur « Motorisé seulement » juste sous le bouton percée. Interrupteurs : un clic lance, un second arrête ; un seul type en cours par front et par joueur ; rouge clair au repos, contour rouge foncé épais clignotant quand actif. Boutons dans la moitié du joueur ; les mêmes en gris dans la moitié de l'adversaire, clignotants quand son attaque est active | décidé | §12, 25 octobre |

## 14. Courbe de Catmull-Rom (abandonnée le 26 octobre 2026)

Remplacée par deux ronds de chaque côté du point d'avancement (05-Fronts §11.1, §11.4).
Ce qui était écrit :

- **Courbe** : une spline de Catmull-Rom centripète (α = 0,5) passait par le point du front de chaque connexion, par chaîne
  (§11.4), en surimpression des couleurs ; décision de l'auteur : elle devait devenir la nouvelle frontière et séparer les
  couleurs des joueurs (repli accepté : couleurs au partage de Voronoi, courbe en surimpression). La ligne s'arrêtait au
  dernier point.
- Pour le morceau P1 → P2, avec P0 et P3 ses voisins (aux bouts, répéter le point du bout), `dᵢ` les distances entre points
  consécutifs, `aᵢ = dᵢ^0,5`, `bᵢ = dᵢ` :
  ```
  B1 = (b1·P2 − b2·P0 + (2·b1 + 3·a1·a2 + b2)·P1) / (3·a1·(a1 + a2))
  B2 = (b3·P1 − b2·P3 + (2·b3 + 3·a3·a2 + b2)·P2) / (3·a3·(a3 + a2))
  ctx.bezierCurveTo(B1, B2, P2)
  ```
  Si `d1 = 0`, `B1 = P1` ; si `d3 = 0`, `B2 = P2`.

---

# Version 0.1 de `05-Fronts.md` (remplacée le 30 octobre 2026)

Copie du document de référence tel qu'il était avant la refonte en divisions
(tag git `v0.1`, commit `f7df772`). Le code au tag `v0.1` implémente ces règles.
Titres décalés d'un niveau ; contenu inchangé. Gardé pour y faire référence
pendant la refonte, à supprimer ensuite (le tag `v0.1` le garde).

## 05 — Fronts terrestres (version 1)

**Ce document fait foi pour les fronts terrestres** : détection des fronts,
unités, affectation des troupes, attaques, combat, avancée, prise de ville,
encerclement, et leur interface. Il remplace 00-Game §3.8, qui n'en garde
qu'un résumé. Règles décidées avec l'auteur les 25 et 26 octobre 2026.

- **Historique** : `05-Fronts-History.md` garde les discussions, avec les
  règles remplacées ensuite. Il ne fait pas foi ; ne jamais implémenter à
  partir de lui.
- **Choix provisoires** : ce que l'auteur n'a pas tranché mais qu'il faut
  bien choisir pour implémenter est marqué « *provisoire* » et listé au §15.
  Tout le reste est décidé.
- **Hors périmètre** : fronts aériens et maritimes, avions, barrage
  d'artillerie, bots (§16).
- C'est la **version 1** des fronts : elle pourra changer.

**État (26 octobre 2026)** : les étapes 1 à 3 du §14 sont implémentées, moteur
et client : détection des fronts, affectation des troupes, mobilisation forcée,
ordres, guerre et paix, fondation en guerre, attaques, rounds de combat,
percées, prise de ville, encerclement, interface (liste, panneau, zones, double
ligne rouge, deux ronds de soldats sur chaque connexion, onglet Population, barre jaune de
l'armement), `npm run viz:fronts`. **Pas fait** : les bots (étape 4), le barrage
d'artillerie (bouton sans effet), la percée sur plusieurs axes à la fois. Le
moteur est décrit dans `02-Engine.md` (fichiers, état, hash, tour), le client
dans `03-Client.md`. Ordre d'implémentation au §14.

**Pour reprendre** (fin de la session du 26 octobre 2026) :

- **Code** : moteur `packages/engine/src/` : `config/fronts.ts`, `units.ts`, `fronts.ts`, `troops.ts`, `attacks.ts`,
  `combat.ts`, `conquest.ts` (liste et rôle de chacun : `02-Engine.md` §1) ; client `client/src/` : `frontgeom.ts`,
  `frontlayer.ts`, `frontpanel.ts`, `blink.ts`, plus `infobar.ts`, `main.ts`, `mirror.ts`, `painter.ts`, `render.ts`,
  `solo.ts` (`03-Client.md` §2). Tests : `npm test` (aucun échec ; `fronts`, `troops`, `combat`, `determinism` côté moteur,
  `fronts` côté client). Visualisation : `npm run viz:fronts`.
- **Essayer à la main** (mode solo) : fonder une ville à 1,5 rayon de contrôle d'un bot, « Armer les bots » et « + armement »
  (barre de debug, `03-Client.md` §3), ajouter de la population si besoin (« +1 000 population » : les soldats se recrutent
  parmi les inactifs seulement), déclarer la guerre par le menu de diplomatie (clic sur le territoire du bot, loin de la zone
  de front), ouvrir le front par la liste (barre d'informations) ou par un clic dans sa zone. Pour une percée : décocher
  « Motorisé seulement » (aucune unité motorisée n'existe) et avoir des unités en seconde ligne.
- **Décisions de l'auteur à cette étape** (déjà dans le texte ci-dessous) : soldats avant les inactifs (§11.5) ; retrait des
  troupes par priorité (§3, §4.7) ; zones de front au demi-rayon de contrôle (§11.1) ; mode choix d'axe qui se désactive
  après une percée (§11.1) ; percée dessinée en segment droit avec une flèche de 14 px (§11.1) ; contour de survol épais, sans
  clignotement, et 1 s par cycle pour les clignotements du panneau (§11.1, §11.3) ; interrupteur `◀ = ▶` et colonne « prio »
  (§11.3).
- **Non vérifié à l'écran** : les tableaux de percées du panneau (§11.3, point 3) et les couleurs d'un front en paix au
  survol ; vérifiés seulement par lecture du code et par les tests de géométrie.
- **Pas fait** : bots (§14, étape 4), barrage d'artillerie, percée multi-axes,
  unités motorisées (aucune dans `config/units.ts`), fronts aériens et maritimes (§16). Les choix provisoires à valider avec
  l'auteur sont au §15.
- **Tests** : l'auteur demande des tests minimaux (déterminisme avec fronts actifs, un round, une prise) ; ne pas en ajouter
  sans qu'il le demande, et ne lancer la suite qu'une fois à la fin.

---

### 1. Vocabulaire et échelle

| Terme | Sens |
| --- | --- |
| **Connexion** | une route terrestre (00-Game §3.5) dont les deux villes appartiennent à deux joueurs différents |
| **Groupe**, ou **île** | les villes d'un joueur reliées entre elles par ses propres routes (00-Game §3.5, `City.group`) ; deux groupes du même continent non reliés par la terre comptent pour deux |
| **Front** | toutes les connexions entre un groupe d'un joueur et un groupe d'un autre joueur |
| **Front actif** | front entre deux joueurs en guerre (00-Game §1, Diplomatie) |
| **Front en paix** | front entre deux joueurs qui ne sont pas en guerre : une frontière, front potentiel |
| **Ligne** | un front a une **première ligne** (subit les attaques en premier, tient la largeur du front) et une **seconde ligne** (unités mobiles, percées et contre-attaques) |
| **Niche** | un rôle sur le front (infanterie, antichar…), rempli par un ou plusieurs types d'unités rangés du meilleur au moins bon |
| **Unité** | un paquet : une unité d'infanterie = 10 personnes, 10 fusils, 10 m de front. Le moteur compte des unités par type, jamais des soldats un par un |
| **Round** | un tour de combat, tous les `FRONTS.combatTurns` tours du moteur (10 : une seconde) |
| **Position** | où se trouve le front sur une connexion, en **millièmes** de la longueur de la route (entier de 0 à 1 000) |

**Échelle** (repère de l'auteur, pas une règle du moteur) : le rayon de
contrôle d'une ville vaut environ **10 000 m** ; avec 25 cases, une case fait
environ 400 m (00-Game §3.1).

**Entiers partout dans le moteur** (CLAUDE.md, règle 2). Les multiplicateurs
de `config/units.ts`, écrits en décimal (deux décimales au plus), sont
convertis une fois en entiers à l'échelle 100 (§3). **Arrondi** : au plus
proche, 0,5 vers le haut, partout où ce document dit « arrondi ». En entiers :
`arrondi(p / q) = floor((2p + q) / (2q))` pour `p ≥ 0`, `q > 0`.

### 2. Détection des fronts

#### 2.1 Entrée : la liste des routes

Le système des fronts ne lit que le résultat du système des routes :
`state.roads`, `City.player`, `City.group`. Il suppose seulement que :

- `state.roads` est un tableau de paires `[a, b]` d'identifiants de villes,
  `a < b`, chaque paire au plus une fois ;
- `City.group` est à jour quand les fronts sont recalculés.

Il ne suppose **pas** l'ordre du tableau, ni qu'un indice désigne toujours la
même route (`addCityToRoads` insère et retire avec `splice`), ni la règle de
construction des routes, ni que les zones des deux villes se touchent. Le
système des routes peut être remanié sans toucher aux fronts.

#### 2.2 Connexions et fronts

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
- **Largeur du front** = nombre de connexions × `FRONTS.metersPerConnection`
  (**5 000 m**). Calculée à la lecture, jamais stockée.

#### 2.3 Fronts en paix et en guerre

Les fronts existent en paix comme en guerre. **Ils sont gérés de la même
façon** (troupes, réglages, panneau, zone sur la carte) ; en paix, ils sont
simplement inactifs : pas de position, pas d'attaque, pas de combat.

- **Déclaration de guerre** (ordre `declare_war`, 00-Game §1) : chaque
  connexion de chaque front entre les deux joueurs reçoit la position
  **500** (le milieu de la route).
- **Paix** : on supprime tout ce qui tient à la guerre active : positions,
  attaques, percées en cours. **Les troupes restent** sur le front. Les
  frontières reviennent au partage de Voronoi (00-Game §3.2).
- **Attaques seulement en guerre** (00-Game §1 : la guerre est le seul statut
  où le combat est possible).

#### 2.4 Recalcul

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

#### 2.5 Quand un front change de taille

Fusion, coupure, ville prise ou perdue, nouvelle connexion : **pas de règle
d'identité à part** (décision de l'auteur).

- **Fusion** : les troupes des fronts fusionnés sont mises ensemble.
- **Ensuite, dans tous les cas**, le front se recale sur son besoin (§4) :
  les unités en trop repartent vers la réserve du pays (avec le délai de
  transfert, §4.5), le manque est pris dans la réserve par l'affectation
  normale.
- *Provisoire* — **coupure** : les troupes du front coupé sont partagées entre
  les morceaux au prorata de leur nombre de connexions (arrondi, reste au
  morceau de plus petit identifiant).
- *Provisoire* — **identifiant et réglages** (priorité, interrupteurs,
  réassignation) d'un front fusionné ou coupé : ceux de l'ancien front qui
  partage le plus de connexions avec lui (mêmes `city1`, `city2`) ; à
  égalité, le plus petit identifiant ; un ancien identifiant n'est repris
  qu'une fois ; sinon un nouvel identifiant (`nextFrontId`) et les réglages
  par défaut.
- **Nouveau front** : priorité 1, réassignation non autorisée, interrupteur
  de chaque type sur « priorité première ligne », interrupteur « Motorisé
  seulement » allumé.

### 3. Unités

Fichier : `packages/engine/src/config/units.ts` (déjà écrit, commenté en
tête). Attributs d'un type d'unité :

| Champ | Sens |
| --- | --- |
| `equipment`, `equipmentCount` | un seul type d'équipement (un armement de `config/armament.ts`), en `equipmentCount` exemplaires par unité (infanterie : 10 fusils) |
| `population` | personnes pour opérer l'équipement (infanterie 10 ; artillerie 10 ; canons 5 ; mitrailleuse 1 ; chenillette 10) |
| `icon`, `description` | affichage ; description absente : celle de l'équipement (`ProductConfig.description`) |
| `softAttack`, `hardAttack`, `airAttack` | attaques anti-infanterie, antiblindée, antiaérienne (antiaérienne : hors périmètre, valeur sans effet) |
| `releasePriority` | priorité de retrait, de 1 à 10 (§4.7) : 10 est retirée du front en premier, 1 en dernier. Infanterie 10, équipement 5, chars 1 (valeurs de l'auteur) |
| `frontWidth` | mètres par unité en première ligne |
| `breakthroughWidth` | mètres par unité en seconde ligne (percée, contre-attaque). Absente : `frontWidth` |
| `damageType` | `infantry`, `armor` ou `equipment` : comment l'unité est perdue (§7.3) |
| `hitPoints` | infanterie et blindés : PV d'une unité, sert seulement à compter les unités détruites |
| `lossMultiplier` | équipement : rend l'équipement plus résistant (< 1) ou plus fragile (> 1) que l'infanterie qu'il accompagne. Absent : 1 |
| `movement` | `foot` ou `motorized`. Un véhicule très lent compte à pied |
| `attackMultiplier` | appliqué quand l'unité attaque ; aucun multiplicateur en défense |
| `breakthroughMultiplier` | appliqué quand une unité de seconde ligne attaque la première ligne adverse (percée). Absent : `attackMultiplier` |
| `counterAttackMultiplier` | appliqué pour repousser une percée (seconde ligne du défenseur). Absent : `attackMultiplier` |

- **Multiplicateurs** : décimaux, deux décimales au plus ; convertis au
  chargement en entiers à l'échelle 100 (`Math.round(x × 100)`), puis
  `dégâts × multiplicateur / 100`, division entière à la fin du calcul. Un
  test refuse une troisième décimale.
- **Un seul niveau de blindage** : tous les blindés sont équivalents.
- **Une unité perdue l'est en entier**, hommes et matériel ensemble (sa
  population et ses `equipmentCount` équipements disparaissent).
- **Niches** (`NICHES`, même fichier) : une liste de types par niche, du
  meilleur au moins bon ; chaque type dans une seule niche. Aujourd'hui :
  `infantry`, `machineGun`, `artillery`, `antiTank`, `antiAir`,
  `assaultTank` (chenillette). Les types de `damageType` `infantry` forment
  l'infanterie au sens des règles ci-dessous (déséquilibre, plafond, seuils).

### 4. Affectation des troupes

#### 4.1 Recrutement : population et équipement

- Une unité se forme avec `equipmentCount` équipements pris dans la **réserve
  d'armement** du joueur (00-Game §8.3) et `population` personnes.
- **Soldats dans la répartition de la population** (00-Game §4) : pris **en
  dernier**, après tous les autres rôles, donc seulement parmi les inactifs.
- **Mobilisation forcée** (interrupteur du joueur, éteint par défaut) : les
  soldats passent **en premier**, avant les lignes de production. On recrute
  alors pour remplir chaque front jusqu'au pourcentage de sa priorité ; le
  reste de la population retourne aux autres rôles.
- *Provisoire* : les soldats déployés et en route restent comptés dans la
  population (ils mangent, comptent pour la croissance) mais ne travaillent
  pas ; la répartition du §4 de 00-Game se fait sur `population − soldats
  déployés et en route`, puis le recrutement de nouveaux soldats prend parmi
  les inactifs (ou avant les lignes en mobilisation forcée).
- **Les soldats sont la dernière occupation avant l'inactivité** (décision de
  l'auteur, 26 octobre 2026) : les lignes, les fermiers et les pêcheurs passent
  avant eux. Quand les personnes qui ne sont pas des soldats ne leur suffisent pas,
  des unités sont retirées des fronts (§4.7) ; en mobilisation forcée, c'est
  l'inverse.
- Une unité qui revient d'un front rend sa population à la répartition et ses
  équipements à la réserve, à l'arrivée.

#### 4.2 Remplissage d'un front

**Première ligne** — chaque niche couvre **toute la largeur du front**, en
mètres :

1. dans une niche, on prend les types **du meilleur au moins bon** : le plus
   de largeur possible avec le premier, puis le suivant ;
2. **plafond par l'infanterie** : dans une ligne, les mètres occupés par
   chaque niche d'équipement (`damageType` `equipment`) ne dépassent pas les
   mètres occupés par l'infanterie de cette ligne. Infanterie à 50 % → au plus
   50 % de chaque équipement ; sans infanterie, aucun équipement ;
3. couverture d'une niche ou d'un type = `unités × frontWidth / largeur du
   front`, en %.

**Seconde ligne** — **plafonnée à `FRONTS.maxSecondLineOvercrowding` fois la
largeur du front** (`N`, **2** pour commencer, décision de l'auteur, 26 octobre
2026), comptée en **largeurs de percée** (`breakthroughWidth`) : la seconde
ligne tient donc `N` fois la population de la première ligne, davantage pour
les types dont la largeur de percée est plus petite que leur largeur de
première ligne. Comme la première ligne, chaque niche couvre cette largeur
(*provisoire* : un plafond par niche, pas un plafond pour toute la seconde
ligne). Ce qui ne trouve pas sa place en première ligne y va, **toujours
plafonné par l'infanterie**, compté en largeur de percée : mètres de chaque
niche d'équipement ≤ mètres de l'infanterie de la seconde ligne (exemple : 30
infanteries, 300 m → au plus 3 artilleries de 100 m). Ce qui dépasse encore
reste **en stock** (réserve d'armement, sans population) ; un camp dont la
seconde ligne dépasse le plafond (largeur du front réduite, interrupteur
changé) renvoie l'excédent à la réserve avec le délai du §4.5.

**Type autorisé ou non**, par front et par type d'unité (case à cocher du panneau,
cochée par défaut ; décision de l'auteur, 26 octobre 2026) : un type refusé ne
reçoit rien sur ce front (ni première ligne, ni seconde ligne) et ses unités
qui y sont **repartent vers la réserve** avec le délai du §4.5 ; celles qui y
étaient en route font demi-tour (même délai). Les autres fronts du joueur
peuvent les recevoir. *Provisoire* : les unités d'une percée en cours partent
aussi.

**Interrupteur à trois positions**, par front et par type d'unité (réglé par
le joueur ; par défaut « priorité première ligne ») :

| Position | Effet pour ce type sur ce front |
| --- | --- |
| priorité première ligne | la règle ci-dessus : première ligne d'abord, le surplus en seconde |
| équilibré | **même pourcentage du front** dans les deux lignes : `a × frontWidth ≈ b × breakthroughWidth` |
| priorité seconde ligne | tout en seconde ligne, jusqu'à son plafond ; rien ne déborde vers la première, l'excédent reste en stock |

**Renfort de la première ligne** (décision de l'auteur, 26 octobre 2026) : pour un
type sur « priorité première ligne » **ou « équilibré »**, quand la première
ligne perd des unités au combat, la **seconde ligne les remplace aussitôt**,
sans délai ; l'affectation du §4.3 ne demande du matériel à la réserve que pour
ce qui manque ensuite. Priorité première ligne : tant que la seconde ligne en
a. Équilibré : jusqu'à la part de la première ligne de la formule ci-dessous,
calculée sur le total du type (les deux lignes gardent le même pourcentage du
front ; la seconde ligne n'est donc pas vidée). Le renfort se fait à la fin des pertes de chaque round (§6),
avant les vérifications de percée et l'avancée. *Provisoire* : pour les deux
camps ; les unités qu'une percée engage restent en seconde ligne ; l'équipement
de la seconde ligne que l'infanterie restante ne couvre plus (plafond, ci-dessus)
repart vers la réserve avec le délai du §4.5.

Équilibré, en entiers, pour `u` unités du type sur ce front, `w1` largeur de
front, `w2` largeur de percée : première ligne `a = floor(u × w2 / (w1 + w2))`,
seconde ligne `b = u − a`. Si `a` dépasse la place libre en première ligne, le
surplus passe en seconde. Le plafond par l'infanterie s'applique ensuite dans
chaque ligne.

#### 4.3 Entre les fronts : priorités

- Chaque front a une **priorité** réglée par le joueur : 1, 2 ou 3. **La
  priorité n'est qu'un pourcentage** : `FRONTS.priorityPercent = [100, 50, 0]`.
  Toutes les règles lisent le pourcentage, jamais le niveau (un niveau à 25 %
  pourra s'ajouter).
- **Première ligne** : besoin d'un front = ce qu'il faut pour remplir ses
  niches (§4.2). Paliers :
  1. chaque front jusqu'à `pourcentage × besoin` ;
  2. puis chaque front jusqu'à 100 %, par pourcentage décroissant (un palier
     par pourcentage distinct).

  **Dans un palier**, si le matériel ne suffit pas, chaque front reçoit en
  proportion de son manque : `A × manque / Σ manques` (`A` = quantité à
  répartir, `manque` = objectif du palier − ce qu'il a, en unités). Chaque
  front comble ainsi la même fraction de son manque. Exemple de l'auteur : un
  front à 40 % pour 50 % et un front à 80 % pour 100 %, de même besoin,
  reçoivent un tiers et deux tiers.
- **Seconde ligne** : cible d'un front pour un type =
  `total du type en seconde ligne × pourcentage × largeur / Σ (pourcentage ×
  largeur)`. Exemple : 150 chars, trois fronts de même largeur à 100 %, 50 %,
  0 % → 100, 50, 0. Tous les fronts à 0 % : partage égal. Le matériel nouveau
  comble les écarts aux cibles comme en première ligne.
- **Calcul type par type**, niche par niche, du meilleur type au moins bon ;
  manque exprimé en unités du type (`ceil(manque en mètres / largeur du
  type)`).
- **Arrondi** des parts : partie entière, puis une unité de plus aux fronts de
  plus grand reste, à égalité au plus petit identifiant de front.

#### 4.4 Flux : ce qui est réparti

- **Par défaut, une unité déjà sur un front y reste** ; seul le matériel
  nouveau est réparti (unités formées à partir de la réserve et de la
  population, unités revenues d'un front).
- **Réassignation** : option du joueur, par front, « Autoriser la
  réassignation à d'autres fronts », désactivée par défaut. *Provisoire* : les
  unités d'un front qui l'autorise entrent dans la quantité à répartir, comme
  la réserve ; elles peuvent donc partir vers un autre front qui en a besoin.
- La répartition tourne à **chaque tour** du moteur.

#### 4.5 Délai de transfert

- Tout mouvement entre la réserve et un front, aller ou retour, prend
  `FRONTS.transferTurns` tours (**50**, 5 s).
- Chaque front garde la liste de ses mouvements en cours (camp, type d'unité,
  nombre, sens, ligne visée, tour d'arrivée), dans l'état et le hash ; à
  chaque tour, ceux dont le tour d'arrivée est atteint sont appliqués.
- **La répartition compte les unités en route vers un front comme déjà
  présentes** ; sinon elle renverrait le même manque à chaque tour pendant le
  délai.
- Une unité en route ne combat pas ; sa population ne travaille pas.
- Les mouvements **entre lignes d'un même front** (survivants d'une percée,
  véhicules du défenseur, changement d'interrupteur *provisoire*) sont
  **sans délai**.

#### 4.6 Réserve d'armement et déclin

- L'équipement des fronts (déployé et en route) **compte** dans le stock qui
  décline (00-Game §8.3).
- La production d'armement **ne s'arrête jamais** ; seul l'excès au-dessus du
  stock cible décline. Le déclin ne retire que l'équipement **non déployé** :
  si l'équipement des fronts dépasse à lui seul le stock cible, le stock non
  déployé décline vers zéro et la production continue.

#### 4.7 Retrait des troupes

Un pays dont la population hors soldats ne suffit pas à ses lignes de production, à ses
fermiers et à ses pêcheurs (les emplois qu'il ferait tourner avec toute sa population,
§4.1) **retire des unités des fronts** pour les leur rendre, à chaque tour, du manque :

1. **Quelles unités** : celles de plus haute `releasePriority` d'abord (10 : les moins
   importantes à retirer, retirées en premier ; 1 : en dernier), donc l'infanterie, puis
   l'équipement, puis les chars. Un camp qui perd de l'infanterie est recalé (§2.5) :
   son équipement en trop part avec elle, puisqu'il est plafonné par l'infanterie.
2. **Où** (*provisoire*) : dans les fronts de plus basse priorité d'abord (à égalité,
   de plus grand identifiant), la seconde ligne avant la première, sans toucher aux
   unités qu'une percée engage.
3. **Délai** : les unités retirées retournent à la réserve avec le délai de transfert
   (§4.5), et leur population ne travaille qu'à leur arrivée. Les personnes déjà en
   chemin de retour comptent dans le manque : on ne retire pas deux fois les mêmes.
4. **Mobilisation forcée** : rien n'est retiré ; les soldats passent avant les emplois.

### 5. Attaques : types et ordres

| Type | Qui tire | Avancée |
| --- | --- | --- |
| **Attaque sur tout le front** (assaut généralisé) | toute la première ligne des deux camps | sur toutes les routes du front (§8.1) |
| **Percée** | la seconde ligne de l'attaquant, sur une connexion choisie (l'axe) | seulement sur l'axe (§8.2) |
| **Barrage d'artillerie** | hors périmètre | aucune ; des pertes seulement |

- Les boutons d'attaque sont des **interrupteurs** : un clic lance, un second
  arrête.
  - attaque sur tout le front : dure jusqu'à ce que le joueur l'arrête ;
  - percée : s'arrête d'elle-même si elle échoue (§8.2) ; le joueur peut
    l'arrêter plus tôt ; **plusieurs percées** possibles en même temps, sur des
    axes différents (*provisoire* : au plus une par axe et par camp) ;
  - barrage : comme l'attaque sur tout le front (hors périmètre : bouton
    présent, sans effet).
- **Par front et par joueur** : au plus une attaque sur tout le front ou un
  barrage (lancer l'un arrête l'autre, *provisoire* pour le barrage) ;
  **l'attaque sur tout le front et les percées coexistent** (lancer l'une
  n'arrête pas les autres).
- **Les deux joueurs peuvent attaquer en même temps** sur le même front : l'état
  d'attaque est gardé pour chaque camp.
- **Seulement sur un front actif.** Un ordre d'attaque sur un front en paix est
  invalide.
- **Une attaque est un état durable** du front, dans l'état et le hash. Ordres
  (noms proposés, à fixer à l'implémentation, ajoutés à 00-Game §9) :

| Ordre | Paramètres | Valide si |
| --- | --- | --- |
| `set_front_priority` | front, pourcentage (indice dans `priorityPercent`) | le joueur est un camp du front |
| `set_front_reassign` | front, oui / non | idem |
| `set_unit_line_mode` | front, type d'unité, `first` / `balanced` / `second` | idem |
| `set_unit_allowed` | front, type d'unité, oui / non | idem |
| `set_breakthrough_motorized_only` | front, oui / non | idem |
| `set_forced_mobilization` | oui / non | toujours |
| `start_front_attack` / `stop_front_attack` | front | front actif ; le joueur en est un camp |
| `start_breakthrough` | front, connexion (`city1`, `city2`) | front actif ; la connexion est dans ce front |
| `cancel_breakthrough` | identifiant de percée | la percée est au joueur |

### 6. Combat : le round

- Un round tous les `FRONTS.combatTurns` tours (**10**, une seconde).
- **Pas d'attaque en cours sur un front : aucun dégât.**
- **Dégâts en valeur absolue** : un camp inflige la **somme** des attaques de
  ses unités engagées : un total anti-infanterie (`softAttack × unités ×
  multiplicateur`) et un total antiblindé (`hardAttack × unités ×
  multiplicateur`), sur toutes ses unités engagées. Plus un front est large,
  plus il y a de pertes. L'antiaérien n'entre pas dans le calcul.
- **Multiplicateurs selon le rôle** :

| Combat | Attaquant | Défenseur |
| --- | --- | --- |
| Attaque sur tout le front : première ligne contre première ligne | `attackMultiplier` | aucun (valeurs de base) |
| Percée, phase 1 : seconde ligne de l'attaquant contre la tranche engagée de la première ligne du défenseur | `breakthroughMultiplier` | aucun |
| Percée, phase 2 : la même force contre la seconde ligne du défenseur | `attackMultiplier` | `counterAttackMultiplier` |

- **Les deux camps tirent dans le même round** et subissent leurs pertes.
  *Provisoire* : les dégâts des deux camps sont calculés sur les effectifs du
  début du round, puis appliqués ensemble.
- **Deux attaques au même endroit** (chaque joueur attaque) : chaque joueur est
  évalué comme attaquant et comme défenseur, deux combats par round.
- Les unités du défenseur engagées dans une percée **restent comptées dans sa
  première ligne** : elles subissent aussi les dégâts d'une attaque sur tout le
  front.

#### 6.1 Répartition des dégâts reçus

Pour un groupe d'unités qui reçoit des dégâts (une première ligne, la tranche
engagée dans une percée, la force de contre-attaque) :

- **Antiblindé** sur les types `armor` du groupe : PV totaux d'un type =
  `nombre × hitPoints` ; chaque type reçoit une part des dégâts égale à sa part
  des PV totaux des blindés ; il perd `arrondi(dégâts reçus / hitPoints)`
  unités, sans dépasser son nombre.
- **Anti-infanterie** sur les types `infantry` : même calcul (aujourd'hui un
  seul type d'infanterie, qui reçoit tout).
- **Équipement** (`equipment`) : chaque type perd le **même pourcentage** que
  l'infanterie du groupe, multiplié par son `lossMultiplier` :
  `arrondi(nombre × pourcentage perdu par l'infanterie × lossMultiplier)`.
- Des dégâts sans cible (antiblindé sans blindé en face) sont perdus.
- Exemple de l'auteur : 10 chenillettes de 1 000 PV et 2 chars de 3 000 PV ;
  4 000 dégâts antiblindés → 2 500 aux chenillettes (2,5 → 3 perdues),
  1 500 aux chars (0,5 → 1 perdu). L'arrondi n'est pas négligeable quand il y
  a peu d'unités : à surveiller.

### 7. Avancée

L'attaquant fait avancer le front vers la ville adverse ; sur une connexion,
la position augmente si l'attaquant est `p1`, diminue si c'est `p2`. Quand
les deux camps poussent, les deux avancées s'appliquent en sens contraire
(ça avance, ça recule). Bornes : 0 et 1 000 ; atteindre le bout de la route
fait tomber la ville (§10).

#### 7.1 Attaque sur tout le front

À chaque round, sur **toutes les routes du front**, la même avancée :

```
déséquilibre = (a / d − A) / (B − A)        borné à [0, 1]
avancée      = arrondi(déséquilibre × v)     en millièmes de route
```

- `a`, `d` : unités d'**infanterie** en première ligne de l'attaquant et du
  défenseur (l'infanterie seulement est comparée).
- `A` = `FRONTS.advanceThresholdA` = **2** : en dessous, pas d'avancée.
  `B` = `FRONTS.advanceThresholdB` = **5** : vitesse maximale.
- `v` : vitesse de l'armée. À pied `FRONTS.footSpeedPermille` = **5**
  (0,5 % de la route par round) ; motorisée `FRONTS.motorizedSpeedPermille` =
  **15** (1,5 %). L'armée est motorisée **seulement si elle l'est à 100 %**
  (§7.3). Aujourd'hui l'infanterie est toujours à pied, donc l'assaut aussi.
- En entiers : `x = a − A × d`, borné à `[0, (B − A) × d]` ;
  `avancée = floor((2 × x × v + (B − A) × d) / (2 × (B − A) × d))`.
- **Défenseur sans infanterie** (`d = 0`) : déséquilibre 1, vitesse maximale.
  **Attaquant sans infanterie** : aucune avancée.
- Ordre de grandeur : à pied, au mieux 100 rounds (100 s) du milieu d'une
  route jusqu'à la ville. Avec la résolution de 1 000, un rapport sous 2,3
  ne fait pas avancer à pied (arrondi à 0) ; accepté par l'auteur.

#### 7.2 Percée

1. **Ordre** : le joueur choisit l'axe (une connexion du front). La percée
   commence après `FRONTS.breakthroughDelayTurns` tours (**50**, 5 s).
2. **Largeur de la percée** = largeur du front / nombre de connexions, soit
   `metersPerConnection` (front de 2 connexions → 50 % du front ; de 10 →
   10 %). Une percée sur plusieurs axes à la fois : hors périmètre.
3. **Force de l'attaquant** : sa **seconde ligne**, le plus d'unités possible
   dans la largeur de la percée, comptées avec leur `breakthroughWidth`,
   choisies par la règle du remplissage d'un front (§4.2 : niche par niche, la
   meilleure d'abord, plafond par l'infanterie).
   - Interrupteur **« Motorisé seulement »** (par front, allumé par défaut) :
     allumé, seules les unités motorisées sont prises ; éteint, on prend
     d'abord les motorisées puis on complète avec les autres.
   - Ces unités quittent la seconde ligne disponible tant que la percée dure.
4. **Phase 1, contre la première ligne** : le défenseur engage une **tranche
   de sa première ligne** de la même largeur (même règle de remplissage, en
   `frontWidth`). Cette tranche est **suivie à part** du reste de la ligne,
   mais reste comptée dans la première ligne (§6). Pas d'avancée à chaque
   round.
5. **Première ligne percée** : dès que **toute l'infanterie** de la tranche
   engagée est éliminée, même s'il reste des véhicules. Alors :
   - les véhicules et équipements restants de la tranche rejoignent leur
     ligne, sans délai ;
   - le front **avance d'un coup** sur l'axe :
     `saut = arrondi(N × v × facteur de réaction)`, `N` =
     `FRONTS.breakthroughJumpRounds` = **10**, `v` la vitesse de la force qui
     perce (5 ou 15 ; motorisée seulement à 100 %). Sans réaction lente :
     50 ‰ à pied, 150 ‰ motorisé ;
   - la phase 2 commence.
6. **Facteur de réaction** de la seconde ligne du défenseur, selon le
   pourcentage `m` de motorisation de sa force de contre-attaque (§7.3) :
   `m` = 100 % → 1 ; `m` < 50 % → `X` = `FRONTS.slowReactionFactor` = **3** ;
   entre les deux, linéaire de `X` à 50 % jusqu'à 1 à 100 % (à 75 % : 2).
   Une seconde ligne à pied réagit lentement et laisse l'attaquant avancer
   plus : une percée qui ne brise pas la seconde ligne fait quand même avancer
   le front.
7. **Phase 2, contre la seconde ligne** : force de contre-attaque = les
   unités de la seconde ligne du défenseur **qui ne défendent pas déjà une
   autre percée**, le plus possible dans la largeur de la percée, comptées
   avec leur `breakthroughWidth`, **motorisées d'abord**, puis les autres.
   **Plusieurs percées** : la seconde ligne du défenseur se répartit
   **équitablement** entre elles, à chaque round, quitte à retirer des unités
   d'une percée pour les mettre sur une autre.
8. **Seconde ligne percée** (toute l'infanterie de la force de contre-attaque
   éliminée, ou pas de force du tout) : le front avance jusqu'à la ville au
   bout de l'axe, qui tombe (§10).
   *Provisoire* : si l'attaquant n'a aucune force à engager au début (seconde ligne vide, ou « Motorisé seulement » allumé alors
   qu'aucune unité motorisée n'existe — c'est le cas de toutes aujourd'hui), la percée s'arrête sans avoir commencé ; le moteur
   écrit l'événement `breakthrough_failed`, que la page affiche.
9. **Essoufflement** : la percée s'arrête quand les PV des unités engagées par
   l'attaquant (infanterie et blindés : `nombre × hitPoints`) tombent sous
   `FRONTS.breakthroughExhaustionPercent` = **35** % de leur valeur au début de
   la percée. L'avancée déjà gagnée reste.
10. **Fin de la percée** (réussie, essoufflée, annulée par le joueur, front
    passé en paix) : les unités survivantes de l'attaquant retournent dans sa
    seconde ligne, **sans délai** ; celles du défenseur engagées rejoignent
    leur ligne, sans délai.

#### 7.3 Motorisation d'une force

Pourcentage de motorisation = largeur des unités motorisées / largeur de
toutes les unités comptées. **Seulement l'infanterie et les véhicules**
(`infantry`, `armor`), pas l'équipement. Poids : `frontWidth` pour une force
de première ligne ; `breakthroughWidth` pour une force de seconde ligne
(force qui perce, contre-attaque).

### 8. Fondation pendant une guerre

**Le rayon d'expansion d'une ville impliquée dans un front actif ne compte
pas** pour fonder (00-Game §3.3). Dans `found_city`, la recherche d'une ville
du joueur à portée d'expansion saute les villes qui ont au moins une connexion
dans un front actif (un drapeau par ville, mis à jour avec la table des
fronts). Un joueur dont toutes les villes sont sur un front actif ne peut donc
plus fonder.

### 9. Cases et récoltes

Le front ne change pas la propriété des cases : la zone d'une ville
(00-Game §3.2) reste à son joueur tant que la ville ne change pas de main,
même si une partie est derrière la ligne du front.

### 10. Prise d'une ville

**Le front arrivé au bout d'une seule route suffit.** Le joueur A prend la
ville X à B :

1. `X.player` devient A ; zones, propriétaires des cases, ports, groupes
   recalculés comme à une fondation (`setOwner` sur les cases de X).
2. **Encerclement** (§10.2), calculé avec les connexions et positions
   d'**avant** la prise.
3. **Fronts recalculés** (§2.4) avec la règle ci-dessous.

#### 10.1 Connexions après une prise

- Les routes entre X et des villes de A ne sont plus des connexions (même
  joueur des deux côtés), dont celle par laquelle A est passé : elles sortent
  du front.
- Les routes entre X et des villes de B deviennent des connexions, avec le
  front à `FRONTS.capturePercent` = **1** % de la route côté X : A tient 1 %,
  B 99 %. En millièmes : `capturePercent × 10` depuis X (10 si X est `city1`,
  990 si X est `city2`).
- *Provisoire* : les routes entre X et un troisième joueur C deviennent des
  connexions A–C ; en guerre, position 500.

#### 10.2 Encerclement

- **Cas** : des unités de B tenaient des connexions entre X (alors à B) et des
  villes de A. Après la prise, ces routes relient deux villes de A : elles sont
  coupées des deux côtés.
- **La route de l'attaque ne compte pas.** Parmi les autres, une route n'est
  encerclée que si le front y était à plus de
  `FRONTS.minEncirclementLengthPercent` = **25** % de la longueur de la route
  depuis X (B en tenait plus d'un quart). Plus près de X, les unités se
  replient en bon ordre, sans perte.
- **Notification** : le moteur écrit l'événement `encirclement` (prise, camps,
  unités perdues) ; la page prévient le joueur s'il est l'un des deux camps.
- **Pertes**, sur la **première ligne** de B seulement, front par front : pour
  chaque type, `arrondi(unités × routes encerclées × encirclementLossPercent /
  (connexions du front × 100))`, `FRONTS.encirclementLossPercent` = **50**,
  connexions comptées avant la prise. Hommes et matériel ensemble.
- *Provisoire* — **ce qui accompagne la prise** :
  - l'usine de X (00-Game §8) est détruite ;
  - si X était la capitale de B, sa ville de plus petit identifiant devient
    sa capitale ;
  - un joueur sans ville garde sa population et ne peut plus que refonder une
    première ville (00-Game §13, Villes).

### 11. Interface

L'interface vient de l'auteur. Maquettes montrées le 25 octobre (v3, v4) :
voir l'historique.

#### 11.1 Carte

- **Double ligne rouge** sur la frontière d'un front actif : la case de
  chaque côté de la limite devient rouge, la ligne sombre de chaque joueur
  recule d'une case vers l'intérieur. Bande de 4 cases : sombre A, rouge,
  rouge, sombre B. Une case de frontière est « de front » si les villes des
  deux zones qu'elle sépare sont reliées par une connexion (`tileCity` des
  deux côtés → paire de villes). *Provisoire* : fronts actifs seulement.
- **Zone de front** (calcul du client seulement) : un « boudin » autour de la
  ligne de front, **des deux côtés**, **terre seulement**. Ligne de front =
  la suite des points du front (un par connexion, ordonnés comme au §11.4) ;
  une case est dans la zone d'un front si sa distance à cette ligne est ≤
  **la moitié de `CITY.controlRadius`** (décision de l'auteur, 26 octobre 2026 : la
  même zone sert à sélectionner un front et à l'afficher) ; à plusieurs fronts, celui dont la ligne est la plus
  proche (partage de Voronoi). Recalculée quand les fronts changent.
- **Dessin de la zone** : contour rouge et hachures rouges espacées, environ
  un quart de la surface sous le trait (trait de 2 px tous les 8 px, à 45°),
  pour voir la carte dessous. Provisoire de l'auteur : plus tard, de petits
  personnages qui se tirent dessus.
  - **Front actif** : hachures **rouges**, affichées si la case « Zones de
    front » du menu Carte (00-Game §11) est cochée — **cochée par défaut**.
  - **Front en paix** : hachures **bleues**, **au survol seulement**, jamais
    autrement (même case cochée).
  - **Survol** : la zone survolée s'affiche toujours, même case décochée ;
    seulement celle-là.
- **Clic dans une zone de front, affichée ou non** : ouvre le panneau de ce
  front. Hors zone, un clic sur le territoire adverse ouvre la diplomatie comme
  aujourd'hui (`onMapClick`, `client/src/main.ts`).
- **Front actif, soldats** (décision de l'auteur, 26 octobre 2026 ; la courbe
  de Catmull-Rom est abandonnée) : sur chaque connexion, le **point
  d'avancement** du front (§11.4, petit point rouge foncé) et, de chaque côté
  sur le segment droit entre les deux villes, **un rond de la couleur du
  joueur de ce côté** (deux soldats qui se battent). Chaque rond a la taille
  d'une ville (rayon des villes, hors capitale) et touche le point. Ce sont de
  simples ronds pour l'instant ; des animations viendront plus tard. Fronts
  actifs seulement.
- **Mode choix d'axe** (après le bouton percée) : un clic sur la carte lance
  une percée sur la connexion du front la plus proche du clic (*provisoire*),
  et **le mode se désactive aussitôt** (décision de l'auteur, 26 octobre 2026) ;
  pour une seconde percée, on rouvre le panneau du front. Échap quitte le mode
  sans lancer de percée.
- **Percée lancée** : le trait rouge de la route choisie reste affiché (le
  **segment droit entre les deux villes**, pas le tracé de la route), avec une
  flèche au milieu, de la ville de celui qui perce vers celle de son adversaire
  (flèche de 14 px du centre à la pointe). Les percées de l'adversaire sont
  dessinées de la même façon, la flèche dans l'autre sens : les deux joueurs
  voient la même chose. Une percée qui s'arrête au début faute de force (§7.2)
  le dit par un message.
- **Survol d'une ligne de front** (zone du front survolée) : un contour plus
  épais apparaît, pour montrer qu'on peut cliquer (il ne clignote pas, décision
  de l'auteur, 26 octobre 2026). Les boutons d'attaque actifs et les tableaux de
  percées du panneau clignotent à **1 seconde par cycle**, une seule constante
  (`BLINK_PERIOD_MS`, `client/src/blink.ts`).

#### 11.2 Liste des fronts

- Bouton dans la barre d'informations, en **cinquième position**, juste à
  droite d'Armement.
- Deux sections : **fronts actifs**, puis **fronts en paix**.
- Une ligne par front, rangées par île puis par adversaire. Pour l'instant :
  l'île et l'adversaire ; plus tard, une petite description avec le nombre de
  soldats de chaque côté.
- Clic sur une ligne : ouvre le panneau du front.

#### 11.3 Panneau d'un front

Un panneau = un front ; une bonne partie de l'écran. De haut en bas :

1. **Titre centré** (île, adversaire).
2. **Boutons d'attaque**, une rangée de trois : attaque sur tout le front,
   percée, barrage. Ceux du joueur dans sa moitié ; les trois mêmes en miroir
   dans la moitié de l'adversaire, **gris**, sans effet au clic.
   - Rouge clair au repos ; actif : **contour rouge foncé épais qui
     clignote** (aussi côté adversaire quand son attaque est active : le
     joueur voit qu'il est attaqué).
   - **Percée** : le clic ferme le panneau et passe la carte en mode choix
     d'axe (§11.1).
   - Interrupteur **« Motorisé seulement »** **à l'intérieur** du bouton
     percée (même cadre rouge clair, sous le mot « Percée »), allumé par défaut.
   - *Provisoire* : sur un front en paix, les boutons d'attaque sont grisés.
3. **Section des percées** : un petit tableau par percée en cours, **deux par
   rangée**, puis la rangée suivante. Chaque tableau :
   - en-tête « **Percée première ligne** » ou « **Percée seconde ligne** »
     selon la phase ;
   - des colonnes, du camp qui perce vers le défenseur : **attaque**,
     **défense de première ligne**, **défense de seconde ligne** (en miroir si
     le camp qui perce est à droite) ; une rangée par type d'unité engagé, sans
     niches ;
   - **dès le compte à rebours** (5 s avant le début), les effectifs sont ceux
     que la percée engagerait, calculés comme à son début avec les effectifs du
     moment (`previewBreakthrough`, lecture seule) ; la défense de seconde
     ligne est la contre-attaque qu'elle aurait (la seconde ligne libre du
     défenseur, partagée avec les percées déjà en phase 2) et reste
     une prévision jusqu'à la phase 2 ;
   - contour de la couleur du joueur qui perce (*provisoire*), plus un second
     contour rouge clignotant ;
   - une petite **croix** en haut pour annuler, seulement sur ses percées.
4. **Réglages** : priorité (1 · 100 %, 2 · 50 %, 3 · 0 %) et case « Autoriser
   la réassignation à d'autres fronts ».
5. **Tableau des unités**, deux moitiés symétriques autour d'une **barre
   centrale** de 8 px : 4 px de la couleur du joueur, 4 px de celle de
   l'adversaire (pas de rouge). À gauche le joueur, à droite l'adversaire (pas
   de brouillard de guerre : tout est visible).
   - Colonnes de la moitié du joueur, de l'extérieur vers la barre : avions
     (vide pour l'instant) ; nom du type **aligné à droite** puis son
     **icône**, puis à droite de l'icône une **case à cocher** « autorisé sur ce
     front » (§4.2) ; quantité en seconde ligne ; interrupteur à trois positions ;
     quantité en première ligne ; **« % front »** (couverture de la première
     ligne). En miroir pour l'adversaire, **sans interrupteurs**.
   - Quantités en nombre d'unités. Sous chaque quantité de première et de
     seconde ligne, en **rouge**, les unités perdues au **dernier round de
     combat** de ce front (pertes de combat et d'encerclement, `lostFirst` /
     `lostSecond` du camp ; remises à zéro à chaque round) ; rien s'il n'y en
     a pas.
   - **Groupé par niche** : une rangée d'en-tête par niche avec sa couverture,
     puis une rangée par type avec sa couverture. Le joueur voit pourquoi un
     type moins bon reste en seconde ligne.
   - **Séparateur au-dessus de l'en-tête de chaque niche** (pas en dessous) :
     trait, nom de la niche, ses types, puis le trait suivant. Un trait clair
     de la couleur de chaque joueur, de son côté de la barre, continu sur
     toute la rangée.
   - Le panneau compte les unités dans les percées et hors des percées.
6. Le panneau **défile** quand il est trop long ; *provisoire* : titre, boutons
   et réglages restent fixes en haut.

#### 11.4 Points du front

- Point d'une connexion : `P = city1 + (city2 − city1) × position / 1000`, en
  flottants (client seulement). En paix, `position` = 500 (milieu).
- **Voisins** : deux connexions du même front sont voisines si elles partent de
  la même ville et sont consécutives dans l'ordre angulaire de **toutes** les
  routes de cette ville, avec un angle inférieur à 180°. Les voisinages forment
  des chaînes ou des boucles ; une chaîne peut se couper (face du réseau qui
  n'est pas un triangle).
- Les points (et leur sens ville 1 → ville 2) sont recalculés à la réception des fronts, pas à chaque image. Les chaînes
  servent aux zones de front (§11.1). La courbe de Catmull-Rom qui les reliait est abandonnée
  (`05-Fronts-History.md` §14).

#### 11.5 Hors du panneau

- **Onglet Population** de la barre d'informations : les rôles rangés du plus
  prioritaire au moins prioritaire : ouvriers, mineurs, fermiers, pêcheurs, puis les soldats
  (icône `pop-soldier`), puis les inactifs en dernier (décision de l'auteur, 26 octobre 2026) ; les
  soldats gardent cette place même quand la mobilisation forcée est allumée. Interrupteur
  **« MOBILISATION FORCÉE »** : interrupteur standard **rouge**, texte rouge,
  gras, majuscules, éteint par défaut.
- **Barre de stock de chaque armement** (détail Armement) : nouvelle portion
  **jaune foncé** à gauche, l'équipement sur les fronts (déployé et en route).
  De gauche à droite : jaune foncé, bleu (en stock), hachures rouges
  (au-dessus du stock cible).

### 12. Configuration

Fichier **`packages/engine/src/config/fronts.ts`**, ré-exporté par
`config.ts` : tous les réglages des fronts, **lisible et commenté** (chaque
valeur : sens, unité, origine). Valeurs données par l'auteur :

| Nom | Valeur | Sens |
| --- | --- | --- |
| `metersPerConnection` | 5 000 | largeur ajoutée au front par connexion, en mètres |
| `priorityPercent` | `[100, 50, 0]` | pourcentage de chaque niveau de priorité (1, 2, 3) |
| `maxSecondLineOvercrowding` | 2 | `N` : la seconde ligne tient `N` fois la largeur du front, en largeurs de percée (§4.2) |
| `transferTurns` | 50 | délai d'un mouvement entre la réserve et un front, en tours (5 s) |
| `combatTurns` | 10 | tours entre deux rounds de combat (1 s) |
| `capturePercent` | 1 | position du front, en % de la route depuis la ville prise, sur les connexions créées par une prise |
| `minEncirclementLengthPercent` | 25 | part de la route que le perdant doit tenir depuis la ville prise pour que la route soit encerclée |
| `encirclementLossPercent` | 50 | pourcentage des unités de la part encerclée qui sont perdues |
| `advanceThresholdA` | 2 | rapport d'infanterie attaquant / défenseur sous lequel l'assaut n'avance pas |
| `advanceThresholdB` | 5 | rapport à partir duquel l'assaut avance à vitesse maximale |
| `footSpeedPermille` | 5 | vitesse d'une armée à pied, en millièmes de route par round |
| `motorizedSpeedPermille` | 15 | vitesse d'une armée motorisée |
| `breakthroughDelayTurns` | 50 | tours entre l'ordre d'une percée et son début (5 s) |
| `breakthroughJumpRounds` | 10 | `N` : le saut d'une première ligne percée vaut `N × vitesse` |
| `slowReactionFactor` | 3 | `X` : multiplicateur du saut face à une seconde ligne motorisée à moins de 50 % |
| `breakthroughExhaustionPercent` | 35 | une percée s'arrête quand la force engagée tombe sous ce % de ses PV de départ |

Les unités et les niches sont dans `config/units.ts` (§3).

### 13. Moteur

#### 13.1 Structures (proposition d'implémentation)

```ts
interface FrontConnection {
  readonly city1: number;   // ville de players[0]
  readonly city2: number;   // ville de players[1]
  position: number;         // 0..1000 depuis city1 ; fronts actifs seulement
}
interface FrontSide {      // un par camp, players[0] puis players[1]
  firstLine: number[];      // unités par type (ordre des clés de UNITS)
  secondLine: number[];
  transfers: Transfer[];    // mouvements en cours (§4.5)
  priorityIndex: number;    // indice dans FRONTS.priorityPercent
  reassign: boolean;
  lineMode: number[];       // par type : 0 première, 1 équilibré, 2 seconde
  allowed: boolean[];       // par type : autorisé sur ce front (§4.2)
  motorizedOnly: boolean;
  frontAttack: boolean;     // attaque sur tout le front en cours
  breakthroughs: Breakthrough[];
}
interface Front {
  readonly id: number;
  readonly players: readonly [number, number];   // p1 < p2
  groups: [number, number];
  connections: FrontConnection[];                 // par (city1, city2)
  sides: [FrontSide, FrontSide];
}
// GameState : fronts (par id), nextFrontId, nextBreakthroughId,
// forcedMobilization par joueur, soldats par joueur.
```

Une percée garde : identifiant, axe (`city1`, `city2`), tour de début, phase
(attente, 1, 2), unités engagées de l'attaquant par type, tranche engagée du
défenseur par type, force de contre-attaque par type, PV de départ.

#### 13.2 Ordre dans un tour (*provisoire*)

Ordres, puis recrutement de la mobilisation forcée (§4.1), puis économie
(00-Game §4 à §8 : répartition de la population, lignes, production), puis
recrutement et affectation (§4), puis transferts arrivés, puis, si `tick %
combatTurns = 0`, le round de combat de chaque front actif (§6, §7), puis les
prises de villes et l'encerclement (§10). Implémenté tel quel
(`packages/engine/src/turn.ts`).

#### 13.3 Hash (02-Engine §5)

Tout ce qui est dans `GameState` entre dans le hash : `nextFrontId`,
`nextBreakthroughId`, chaque front (id, joueurs, groupes, connexions avec
positions, les deux camps avec tous leurs champs, transferts et percées), la
mobilisation forcée et les soldats de chaque joueur. `test/engine.test.ts`
vérifie que chaque champ change le hash.

#### 13.4 Client

- Message `tick` (03-Client §4) : la liste des fronts à plat, `null` si elle
  n'a pas changé ; positions et effectifs changent à chaque round.
- Zones de front, double ligne rouge, soldats du front, panneau, liste : client seulement
  (§11), calculés à la réception.

#### 13.5 Visualisation

`npm run viz:fronts` → `packages/engine/out/fronts.html`, sur le modèle de
`test/cities-viz.ts` : routes, connexions en couleur de leur front, points du
front, fronts par joueur (île, adversaire, connexions), chaînes du §11.4.

#### 13.6 Pièges

- **Retrouver une connexion par ses seules villes.** X, ville de B, est prise
  par A ; la route X–C (C troisième joueur) était une connexion B–C et devient
  A–C. Si `B < C` et `A < C`, l'orientation `(X, C)` ne change pas : une clé
  sans les joueurs donnerait à A–C la position de B–C. La clé inclut
  `(p1, p2)`.
- **Indexer par l'indice dans `state.roads`** : il change à chaque fondation.
- **Identifiant de groupe** : il change quand sa plus petite ville change de
  main ; ne jamais l'utiliser comme identifiant de front.
- **Flottants dans le moteur** : positions, dégâts, pourcentages, facteurs :
  entiers. Seul le client calcule en flottants (points, zones).
- **Unités en route oubliées par la répartition** : voir §4.5.
- **Diviser avant de multiplier** : multiplier d'abord, diviser une seule fois
  à la fin (arrondi du §1).
- **Parcours dans un ordre fixé** : fronts par identifiant, types dans l'ordre
  des clés de `UNITS`, percées par identifiant (CLAUDE.md, règle 2).

#### 13.7 Tests (une seule passe à la fin)

- Fronts recalculés après chaque fondation = calcul de référence lent
  (`test/helpers.ts`) ; chaque connexion dans un seul front ; ordre.
- Positions conservées d'un recalcul à l'autre ; nouvelle position quand un
  joueur change (§13.6).
- Affectation : niches du meilleur au moins bon, plafond par l'infanterie,
  interrupteur à trois positions, paliers et proportions (exemple 1/3 – 2/3),
  seconde ligne (exemple 100, 50, 0 ; le test en prend 60 : 40, 20, 0, sous le plafond de
  40 par front), délai, unités en route comptées, plafond de la seconde ligne.
- Combat : dégâts, multiplicateurs selon la phase, répartition des blindés
  (exemple du §6.1), arrondi, équipement au pourcentage de l'infanterie.
- Avancée : formule de l'assaut, cas `d = 0` et `a = 0` ; percée : saut,
  facteur de réaction (50 %, 75 %, 100 %), essoufflement, seconde ligne percée.
- Prise : connexions 10 / 990, encerclement (seuil de 25 %), fondation refusée
  depuis une ville d'un front actif.
- Paix : positions, attaques et percées supprimées, troupes gardées.
- Hash : chaque champ ; déterminisme (le test des 10 000 tours couvre les
  fronts dès qu'ils sont dans l'état).
- `config/units.ts` : multiplicateurs à deux décimales au plus ; chaque type
  dans une seule niche.

### 14. Ordre d'implémentation

1. **Fronts et troupes** : `config/fronts.ts`, détection (§2), affectation
   (§4), mobilisation forcée, ordres de réglage, guerre et paix (§2.3),
   fondation (§8) ; client : liste des fronts, zones et double ligne rouge,
   panneau sans attaques, onglet Population, barre jaune ; `viz:fronts`.
2. **Combat** : attaques, rounds, pertes (§5, §6), section des percées.
3. **Avancée, prise, encerclement** (§7, §10), points du front.
4. **Bots** : en dernier (hors de ce document pour l'instant).

À chaque étape : mettre à jour 02-Engine, 03-Client, 00-Game §9 (ordres) et
ce document s'il faut trancher un choix provisoire (CLAUDE.md, règle 8).

Étapes 1 à 3 faites le 26 octobre 2026 (voir « État » en tête).

### 15. Choix provisoires (non tranchés par l'auteur)

Choisis pour pouvoir implémenter ; à valider avec l'auteur, sans les
présenter comme décidés :

- coupure d'un front : troupes au prorata des connexions (§2.5) ;
  identifiant et réglages d'un front fusionné ou coupé (§2.5) ;
- nouvelle connexion créée en guerre par une fondation : position 500 (§2.4) ;
  route vers un troisième joueur après une prise : 500 (§10.1) ;
- soldats comptés dans la population, sans travailler ; population sous le
  nombre de soldats (§4.1) ;
- réassignation : les unités du front entrent dans la quantité à répartir
  (§4.4) ; changement d'interrupteur sans délai (§4.5) ;
- barrage et attaque sur tout le front exclusifs ; au plus une percée par axe
  et par camp (§5) ;
- dégâts calculés sur les effectifs du début du round (§6) ;
- prise : usine détruite, nouvelle capitale, joueur sans ville (§10.2) ;
- double ligne rouge sur les fronts actifs seulement ; connexion la plus
  proche du clic en mode choix d'axe (§11.1) ;
- boutons d'attaque grisés en paix ; contour d'une percée de la couleur du
  joueur qui perce ; en-tête fixe du panneau (§11.3) ;
- plafond de la seconde ligne par niche (§4.2) ;
- type refusé sur un front : ses unités repartent, y compris celles d'une percée (§4.2) ;
- renfort de la première ligne par la seconde : les deux camps, sans toucher aux unités
  d'une percée (§4.2) ;
- ordre des étapes dans un tour (§13.2).

Choix faits à l'implémentation (26 octobre 2026), pour les points que ce
document ne tranchait pas ; à valider avec l'auteur :

- **Objectif d'un palier** (§4.3) : `pourcentage × besoin` en partie entière ;
  le palier suivant complète jusqu'à 100 %, rien n'est perdu par l'arrondi.
- **Retrait des troupes** (§4.7) : les fronts de plus basse priorité d'abord, la seconde ligne
  avant la première ; le manque se compare à l'emploi maximal du pays (`workersNeeded`).
- **Population entre les types** (§4.1) : les types sont servis dans l'ordre
  des niches (`NICHES`), toutes les premières lignes d'abord, puis toutes les
  secondes lignes. L'infanterie, première niche, peut donc épuiser les
  inactifs avant que les autres types reçoivent des personnes.
- **Mobilisation forcée** (§4.1) : avant l'économie, un recrutement limité au
  premier palier de la première ligne (chaque front jusqu'à son pourcentage de
  priorité) prend sur toute la population qui peut travailler ; après
  l'économie, le recrutement normal prend le reste parmi les inactifs, comme
  hors mobilisation.
- **Réassignation** (§4.4) : on simule la répartition avec, en plus de la
  réserve, les unités libres des fronts qui l'autorisent (pas celles que des
  percées engagent) ; ce qu'un front de ce type garde en trop par rapport au
  résultat repart vers la réserve (délai de transfert), d'où la répartition
  normale le redonne à un front qui en manque, avec un second délai : un
  changement de front coûte deux délais.
- **Recalage d'un camp** : quand un interrupteur change, ou quand un front
  change de taille ou de composition (§2.5), toutes les unités du camp sont
  rangées de nouveau entre les deux lignes (interrupteurs, plafond de
  l'infanterie), sans délai ; l'équipement qui ne trouve pas de place même en
  seconde ligne repart vers la réserve avec le délai. Il n'y a pas d'autre
  passage d'une ligne à l'autre : les pertes de la première ligne ne sont pas
  remplacées par la seconde.
- **Front sans aucune connexion gardée** (une prise, une coupure de routes) :
  ses unités et celles en route rendent leurs équipements à la réserve et leur
  population au pays, sans délai.
- **Délai d'une unité formée** : `transferTurns` tours après le tour de sa
  formation ; l'unité formée hors tour par un test arrive un tour plus tard.
- **Déclin du stock** (§4.6) : l'excès compte la réserve et l'équipement
  déployé ; la perte est retirée de la réserve seulement, au plus ce qu'elle
  contient (le reste de la baisse est alors remis à 0).
- **Groupe touché sans infanterie** (§6.1) : son équipement est perdu en
  entier dès que le groupe reçoit des dégâts.
- **Attaque sur tout le front et percées** : elle tue d'abord les unités de la
  première ligne qu'aucune percée n'engage ; l'avancée d'un round (§7.1) est
  calculée sur les effectifs après les pertes du round.
- **Forces d'une percée** (§7.2) : l'attaquant et la tranche du défenseur sont
  choisis au premier round après le délai (`breakthroughDelayTurns`) ; une
  percée qui n'a alors aucune force s'arrête ; deux tranches d'un même
  attaquant ne recouvrent pas les mêmes unités ; la force de contre-attaque est
  recalculée à chaque round. Première ligne percée sans infanterie dans la
  tranche : elle l'est dès le premier round. Le facteur de réaction (§7.2,
  point 6) lit la force de contre-attaque de la percée qui saute ; sans force,
  X.
- **Prise par plusieurs routes** (§10) : si plusieurs connexions arrivent au
  bout dans le même round, les villes tombent une à une, par identifiant de
  front puis de connexion, chaque prise recalculant les fronts ; une arrivée
  qui n'est plus au bout après une prise est ignorée.
- **Fronts envoyés au client** : tous, sans brouillard de guerre ; le panneau
  d'un front dont le joueur n'est pas un camp n'a aucun réglage actif.
- **Mode choix d'axe** : il se désactive dès la première percée placée (décision de
  l'auteur) ; Échap le quitte sans percée ; le panneau est fermé pendant le mode.
- **Outil de développement** (hors règles, 03-Client §3) : « + armement » et
  « Armer les bots » donnent de l'armement et de la population ; ils servent à
  essayer les fronts sans que les bots produisent.

### 16. Hors périmètre et pistes

- **Problème connu, à reprendre avec le système de combat (l'auteur le
  refait ; observé le 27 octobre 2026)** : une percée d'infanterie ne tue
  personne. Une percée engage au plus une connexion (`metersPerConnection` =
  1 000 m), soit 100 infanteries de 10 m. Ses dégâts valent 100 × 10 × 0,2
  (`breakthroughMultiplier`) = 200 par round ; `lossesFrom` (`units.ts`) arrondit
  les pertes à `dégâts / PV` = 200 / 500 = 0,4, soit 0 mort par round, quel que
  soit le nombre d'unités de la tranche. La phase 1 ne se termine alors jamais :
  la tranche n'est pas éliminée et l'essoufflement ne se déclenche pas (400 tours
  joués sans changement). Il faut au moins 250 de dégâts par round pour tuer une
  infanterie. Avec l'ancienne largeur (5 000 m, 500 attaquants) la percée tuait
  2 unités par round. Deux tests le montrent et sont **laissés rouges**
  (`combat.test.ts`, « première ligne percée : saut… » et « sans force de
  contre-attaque… la ville tombe »). À ne pas réécrire pour qu'ils passent : à
  reprendre quand les règles de combat auront changé.
- Fronts aériens et maritimes ; avions (colonne vide du panneau) ; attaque
  antiaérienne.
- Barrage d'artillerie (bouton présent, sans effet).
- Percée sur plusieurs axes à la fois.
- Vitesse intermédiaire pour une armée partiellement motorisée ; variantes
  d'infanterie motorisées.
- L'équipement à pied ne ralentit pas une force : à surveiller (l'équipement
  statique attaque mal, sauf l'artillerie, supposée derrière la ligne). Piste :
  un interrupteur de motorisation de l'équipement, tracté par des camions.
- Délai de transfert plus long pour un front sur une île loin de la capitale.
- Lignes d'armement réglées automatiquement sur la taille des armées (la
  demande de l'armée comme limite de production, arrêt automatique des
  lignes).
- Plus de niveaux de priorité (25 %).
- Hachures remplacées par de petits personnages qui se tirent dessus.
- Bots : affectation des troupes et attaques, en dernier.
