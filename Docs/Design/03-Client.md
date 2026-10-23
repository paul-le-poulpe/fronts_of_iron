# 03 — Client

Le client (`client/`) est la page du jeu : une interface provisoire, et le moteur
dans un Web Worker. Ce qui existe : le **mode solo** (un humain contre des bots,
tout dans le navigateur, sans serveur ni lobby). Pas de multijoueur, pas d'écran
de lobby, pas de build pour Cloudflare (§8).

**L'interface est provisoire.** L'auteur la définit (00-Game §1) ; la page ne
contient que ce qu'il faut pour essayer le moteur, et l'affiche
(« interface provisoire »). Rien dans la page n'est une règle : elle lit ce que
le moteur calcule.

---

## 1. Lancer

Depuis la racine du dépôt, après `npm install` :

- `npm run dev -w client` : Vite sur `http://localhost:5173`. `/api/*` est
  redirigé vers `http://127.0.0.1:8787` (`wrangler dev`) ; le mode solo n'appelle
  pas le lobby.
- `npm run build -w client` : compilation dans `client/dist/` (ignoré par git).
  `npm run preview -w client` sert ce dossier.
- `npm run typecheck`, `npm test` : le client y est (trois projets TypeScript :
  page, Worker, tests).
- Dans l'adresse, `?step=20` donne un tour toutes les 20 ms au lieu de 100 :
  outil de développement, pour voir une longue partie vite. Le moteur ne change
  pas (01-Architecture §3).

## 2. Fichiers

| Fichier (`client/`) | Rôle |
| --- | --- |
| `index.html`, `src/style.css` | page : écran de départ, carte, barre de boutons, panneau latéral |
| `src/main.ts` | page : écran de départ, panneau, barre, survol, messages ; crée le Worker |
| `src/render.ts` | canvas de la carte : caméra, envoi du tampon de pixels, routes, villes, mode placement |
| `src/painter.ts` | couleur de chaque case dans un tampon RGBA (sans DOM) |
| `src/mirror.ts` | copie locale de ce que l'affichage lit de la partie, rayons d'exploitation (sans DOM) |
| `src/protocol.ts` | types des messages page ↔ Worker |
| `src/engine.worker.ts` | Web Worker : reçoit les messages, tient l'horloge de tour |
| `src/solo.ts` | `SoloGame` : moteur + bots + fabrication des messages (sans DOM, sans `self`) |
| `src/bots.ts` | bots (§5) |
| `test/solo.test.ts` | tests sous Node : partie solo, copie de la page, peinture |
| `vite.config.ts` | `server.proxy` pour `/api`, Worker au format module |
| `public/icons/` | icônes provisoires (00-Game §11), servies telles quelles |

Le moteur est importé par `@fronts-of-iron/engine` (workspace npm ; il exporte
`src/index.ts`). Seul le Worker l'importe pour calculer ; la page n'en lit que
les types et ses constantes via le message `init`.

Le Worker est créé par `new Worker(new URL("./engine.worker.ts", import.meta.url),
{ type: "module" })` (01-Architecture §6, règle 3) : Vite le compile de la même
façon en développement et au build.

## 3. Horloge de tour du mode solo

`engine.worker.ts` planifie un tour toutes les `stepMs` ms (100 par défaut) avec
`setTimeout`, sur une heure prévue (`nextAt += stepMs`) et non sur la fin du
calcul, donc sans dérive. En retard de plus d'un pas, il repart de l'heure
courante au lieu de rattraper en rafale. Une minuterie est permise ici : le
Worker n'est pas dans `packages/engine`.

À chaque tour, `SoloGame.step` :

1. prend les ordres humains reçus depuis le tour précédent, et écrit
   `player: 1` dans chacun (règle 4 du `CLAUDE.md` : le message de la page n'a
   pas de champ `player`, et un champ `player` qu'il contiendrait serait
   écrasé) ;
2. ajoute les ordres de chaque bot, dans l'ordre de leurs identifiants ;
3. appelle `applyTurn(state, { turn: state.tick + 1, intents })` ;
4. fabrique le message du tour (§4).

Les ordres humains passent avant ceux des bots : à case égale, l'humain gagne.

**Pause** : bouton « Pause (outil de développement) ». Le Worker saute alors les
tours, sans arrêter la minuterie ; les ordres reçus attendent. Le jeu n'a pas de
pause (00-Game §1.1) : ce n'est pas un ordre, et le bouton est étiqueté ainsi.

## 4. Messages

Page → Worker (`ToWorker`) :

- `start { mapSeed, bots, stepMs? }` : génère la carte (`generateTestMap`), crée
  la partie (`createGame`, graine = graine de la carte mélangée à une constante),
  les bots, lance l'horloge. Joueur 1 = l'humain, 2 à n = les bots.
- `order { id, order }` : `found_city { tile }` ou `set_farm_share { percent }`.
- `pause { paused }`.

Worker → page (`FromWorker`) :

- `init` (une fois) : largeur, hauteur, `terrain`, `resources`, `fertility`
  (copies, transférées : le moteur garde les siennes), nombre de joueurs, rayons
  d'expansion et de contrôle, coût d'une ville, `stepMs`.
- `tick`, à chaque tour :
  - `tick` : numéro du tour ;
  - `tiles` : paires `[case, ville]` des cases dont `tileCity` a changé, pas
    plus ; le propriétaire se déduit de la ville ;
  - `cities` et `roads` : listes complètes, **seulement** si une ville a été
    fondée pendant ce tour (c'est le seul cas où les villes, ports, groupes et
    routes changent) ; sinon `null` ;
  - `players` : par joueur, population, fermiers, pêcheurs, inactifs,
    nourriture, blé, poisson, surface cultivée et max, surface pêchée et max,
    `farmPercent`, capitale, nombre de villes ;
  - `results` : pour chaque ordre humain du tour, `applied` vrai ou faux ;
  - `perf` : durées en ms dans le Worker (bots, `applyTurn`, fabrication du
    message).
- `paused { paused }`.

Aucun tableau complet par tour. Les grands tableaux de `tick` sont transférés,
pas copiés.

**Cases modifiées.** `applyTurn` renvoie les cases dont le propriétaire a changé,
mais pas celles qui passent d'une ville à une autre du même joueur (02-Engine §4),
et l'affichage en a besoin (limites de zones, rayon d'exploitation). `SoloGame`
garde le `tileCity` déjà envoyé et le compare à celui du moteur, **seulement**
quand une ville a été fondée (400 000 comparaisons, environ 0,1 à 0,5 ms) : sans
fondation, `tileCity` n'a pas pu changer.

**`results`.** `applyTurn` ne dit pas quels ordres ont été appliqués. `SoloGame`
le lit dans l'état : une fondation est appliquée si une ville du joueur 1 est
apparue sur cette case pendant le tour ; un réglage, si `farmPercent` vaut la
valeur demandée. La page affiche un message pour un ordre non appliqué.

## 5. Les bots (`src/bots.ts`)

Ce ne sont pas des règles du jeu : un bot lit l'état et envoie des ordres
`found_city` et `set_farm_share`, que le moteur valide comme ceux de l'humain.
Chacun a son générateur (`createRng`, graine = graine de la carte mélangée à son
identifiant), donc deux parties de mêmes réglages envoient les mêmes ordres.

- **Première ville** : après un délai tiré entre 1 et 30 tours, il tire des cases
  au hasard sur la carte jusqu'à en avoir 5 de terre, de fertilité > 0 et sans
  ville (`tileCity === 0`), et prend celle qui a le plus de cases fertiles libres
  dans son rayon de contrôle.
- **Expansion** : tous les 15 à 24 tours, si la population est ≥ 400
  (`EXPAND_MIN_POPULATION`) et au coût de la ville suivante, et si sa surface
  cultivée atteint la moitié de sa surface cultivable (`2 × cultivated ≥
  farmTiles`, valeurs du dernier tour), il tire des cases dans le rayon d'expansion d'une de
  ses villes (ville tirée au hasard à chaque tirage), garde celles qui sont de
  terre fertile et libre, et prend celle qui a le plus de cases fertiles libres.
  Les conditions sont vérifiées chez le bot avant d'envoyer : pas d'ordre perdu.
- **Part de fermiers** : tous les 30 tours, il vise la part qui occupe juste
  toute sa surface cultivable sans machine (`ceil(surface_max × 1000 /
  FARMING.mechanizationBase)` fermiers), le reste allant à la pêche ; 100 % sans
  case d'eau. Il n'envoie un ordre que si l'écart avec la part actuelle est
  d'au moins 5 points.

Les constantes sont en tête de `bots.ts`. Avec elles, les bots dépensent leur
population aussi vite qu'elle croît (une ville coûte 100 habitants) : leur
population reste proche de 400 et leur nombre de villes ne dépend que de la
cadence d'expansion (environ 45 villes chacun après 4 000 tours).

## 6. Affichage

**Copie locale** (`mirror.ts`). La page garde `tileCity` (une valeur par case), la
liste des villes et des routes, et les derniers totaux. Elle les met à jour avec
les messages `tick`. `Mirror.applyTick` renvoie la liste des cases à repeindre.

**Peinture** (`painter.ts`). Un tampon RGBA de 800 × 500 pixels, un pixel par
case. Ordre de peinture d'une case, comme `packages/engine/test/cities-viz.ts` :
relief (ou fer) → teinte du joueur **sur la terre seulement** (00-Game §11) →
texture de champs (terre fertile) ou de pêche (eau) → trait de limite de zone
(blanc entre deux villes d'un même joueur, sombre entre deux joueurs, tracé sur
la terre). Les deux textures sont différentes de la couleur du joueur : champs en
bandes vertes, pêche en points blancs sur l'eau bleue. À chaque tour, seules sont
repeintes : les cases dont la ville a changé, leur voisine de gauche et celle du
dessus (le trait de limite d'une case dépend de ses voisines de droite et du
dessous), et les cases dont l'appartenance au champ ou à la zone de pêche a
changé. Le rectangle englobant est renvoyé au canvas par `putImageData` avec
rectangle sale.

**Rayon d'exploitation** (00-Game §6.6, affichage seulement). Pour chaque joueur,
un histogramme du nombre de cases fertiles (puis d'eau) de ses zones par distance
au carré à leur ville (de 0 à rayon de contrôle²), tenu à jour case par case. Le
seuil est la plus petite distance au carré dont le cumul est le plus proche de la
surface cultivée (puis pêchée) ; une case est dans le champ si sa distance au
carré à sa ville est ≤ au seuil. Quand un seuil change, seules les cases de
l'anneau entre l'ancien et le nouveau seuil sont repeintes. Un test compare
histogrammes incrémentaux, seuils et pixels à un recalcul complet.

**Canvas** (`render.ts`). Molette : zoom centré sur la souris ; glisser : déplacer
(sous 4 pixels de mouvement, c'est un clic). À chaque image : le tampon de la
carte, puis routes (trait plein foncé entre deux villes d'un même joueur,
pointillé gris sinon), villes (point ; étoile pour la capitale ; carré bleu de
port sur la case de côte de la zone la plus proche de la ville, ou à côté de la
ville si c'est la sienne), puis, en mode placement, le rayon d'expansion des
villes du joueur et la case survolée. Une image n'est dessinée que si quelque
chose a changé (`requestAnimationFrame`).

## 7. Interface provisoire

- **Écran de départ** : nombre de bots (1 à 7, 3 par défaut), graine de la carte
  (12345 par défaut), « Jouer ».
- **Barre de boutons**, en bas (00-Game §1) : « Créer une ville ». Active le mode
  placement (échap : quitte). Sans ville : rien de particulier, toute terre libre
  est valide. Avec des villes : le rayon d'expansion de chacune est dessiné ; la
  case survolée est verte si la fondation respecte 00-Game §3.3 (terre,
  `tileCity === 0`, dans le rayon d'expansion d'une ville du joueur, population ≥
  coût) et rouge sinon, avec la raison dans la barre. En mode placement, les
  cases cultivables (fertilité > 0) sont couvertes d'un vert léger
  (`buildFertileLayer`, `render.ts`, calculé une fois : la fertilité ne change
  pas), le rayon de contrôle qu'aurait la ville est dessiné autour de la case
  survolée, et la barre donne le nombre de cases cultivables que cette ville
  prendrait (`Mirror.fertileTilesFor` : libres, ou plus proches d'elle que de
  leur ville actuelle, 00-Game §3.2). Le clic sur une case rouge
  n'envoie rien. Le clic sur une case verte envoie `found_city` ; si le moteur ne
  l'applique pas (`results`), la page affiche « Ville non fondée : le moteur a
  refusé l'ordre ». La page copie les conditions pour colorer la case ; **le
  moteur reste l'autorité** et vérifie à nouveau.
- **Panneau latéral** : population, fermiers, pêcheurs, inactifs, nourriture,
  villes, cultivé / max, pêché / max du joueur ; curseur de la part de fermiers
  (0 à 100 %), l'ordre `set_farm_share` part au relâchement ; la note sous le
  curseur rappelle le report (00-Game §4) : le réglage ne compte que si la
  population ne suffit pas à travailler champs et mer ; tableau de tous les
  joueurs (couleur, population, villes) ; case survolée (coordonnées, terrain et
  altitude, fertilité, fer, propriétaire, ville) ; case à cocher du fer ; bloc
  développement (durées mesurées, pause, quitter).
- Tout le texte est en français.

La section maritime de la barre (00-Game §1), les lignes de production et la
diplomatie n'existent pas.

## 8. Pas fait

- Écran de lobby (liste des parties, `fetch("/api/games")`), multijoueur : le
  client n'ouvre aucun WebSocket. Il faudra un second « moteur de tours » côté
  page qui reçoit les tours du serveur au lieu de les fabriquer ; `SoloGame` et
  `engine.worker.ts` sont séparés pour que ce changement ne touche que la source
  des tours.
- Hash de l'état envoyé au serveur (01-Architecture §3) : sans objet en solo.
- Usines, lignes de production, routes maritimes : pas de règle, donc pas
  d'ordre ni d'interface.
- Build pour Cloudflare : `[assets] directory` de `worker/wrangler.toml` pointe
  toujours sur `worker/public`, la page d'accueil du lobby n'est pas reprise, et
  `.github/workflows/deploy.yml` n'a pas l'étape `npm ci` + build du client
  (01-Architecture §6, Client, point 4). Aucun des trois n'est fait.
- Chemin des routes par A* selon l'altitude (00-Game §3.5) : les routes sont des
  segments droits.
- Couleurs de joueur, textures et tailles : provisoires, choisies à la main.
- Rendu mobile / tactile : la mise en page s'adapte, mais le zoom au pincement
  n'existe pas.

## 9. Pièges

- **Un Worker à qui on envoie le tableau du moteur** : le transfert détache le
  tableau chez l'expéditeur. `SoloGame.init` envoie des copies ; envoyer
  `map.terrain` lui-même viderait celui du moteur.
- **Se fier à `changed` de `applyTurn` pour l'affichage** : il ne contient pas les
  cases qui passent d'une ville à une autre du même joueur (§4).
- **Ajouter un champ de joueur à l'état sans l'ajouter à `PlayerStats`** : la
  page ne le verrait pas ; l'inverse n'a pas de conséquence pour le moteur.
- **Compiler le Worker et la page avec les mêmes bibliothèques TypeScript** :
  `lib.dom` et `lib.webworker` déclarent les mêmes noms avec des types
  différents (`self`, `postMessage`). `tsconfig.json` (page, DOM) et
  `tsconfig.worker.json` (Worker, WebWorker) sont deux projets ; chaque fichier
  est dans un seul.
- **Un `constructor(private x)` ou un `enum`** : refusés par `erasableSyntaxOnly`,
  et par Node quand les tests exécutent le TypeScript directement.
- **Relancer une partie sans remplacer le canvas** : les écouteurs de la
  partie précédente resteraient sur l'ancien. `main.ts` remplace le canvas à
  chaque partie.
- **Mesures du navigateur** : `performance.now()` y est arrondi (environ 0,1 ms
  ou plus selon le navigateur) : les durées de moins de 0,1 ms affichées dans le
  bloc développement sont à lire comme « sous la résolution ».

## 10. Mesures

Sous Node 24.19, 8 joueurs (7 bots), carte 12345, 3 000 tours, 241 villes à la
fin, sans ordre humain (`npm test -w client`, dernier test) : par tour, bots
0,002 ms, `applyTurn` 0,007 ms, fabrication du message 0,105 ms en moyenne (comparaison
de `tileCity` à chaque fondation, listes de villes et de routes) ; le plus long
tour, 6 ms, est le premier (code non encore compilé par le moteur JavaScript). Côté
page, dans le navigateur intégré de l'application (Chromium), pour 7 bots à un tour toutes les 10 ms
pendant 4 000 tours (43 villes par bot) : application d'un message et
peinture sous 0,1 ms en moyenne, dessin d'une image sous 0,1 ms (sous la résolution
du navigateur). Un tour de 100 ms laisse donc la quasi-totalité du temps au
navigateur.
