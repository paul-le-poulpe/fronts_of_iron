# 05 — Fronts terrestres (version 1) : notes d'implémentation

**Les règles sont dans `00-Game.md` §3.8.** Ce fichier dit comment les
implémenter : structures, calculs, hash, client, tests, pièges. Il sert aussi de
carnet pour la suite de la conception (§12). Une règle n'est décidée que quand
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
    du front ? Qui répartit les unités du joueur entre ses fronts ?
