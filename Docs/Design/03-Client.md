# 03 — Client

Le client (`client/`) est la page du jeu : une interface provisoire, et le moteur
dans un Web Worker. Ce qui existe : le **mode solo** (un humain contre des bots,
tout dans le navigateur, sans serveur ni lobby), l'**accueil et la salle
d'attente** des parties en ligne (§7, dernière sous-section), et la **partie en
ligne** hébergée par Cloudflare : le Web Worker reçoit les tours du relais par
WebSocket (§8). Le solo et le jeu en ligne passent par le même relais
(`packages/relay`).

**L'interface est provisoire.** L'auteur la définit (00-Game §1) ; la page ne
contient que ce qu'il faut pour essayer le moteur, et l'affiche
(« interface provisoire »). Rien dans la page n'est une règle : elle lit ce que
le moteur calcule.

---

## 1. Lancer

Depuis la racine du dépôt, après `npm install` :

- `npm run dev -w client` : Vite sur `http://localhost:5173`. `/api/*` est
  redirigé, WebSocket compris, vers `http://127.0.0.1:8787` (`wrangler dev`, lancé
  à part). L'accueil appelle `GET /api/games` au chargement : sans `wrangler dev`
  la liste affiche « Liste indisponible » et le solo marche quand même.
- Essayer une partie en ligne en local : `npm run build -w client` (le Worker
  sert `client/dist` et refuse de démarrer sans lui), `cd worker; npx wrangler
  dev`, puis `npm run dev -w client` ; deux onglets (ou deux navigateurs) font
  deux joueurs. Un onglet par joueur partage le même `localStorage`, donc le
  même nom et les mêmes jetons : utiliser un navigateur différent, ou une
  fenêtre de navigation privée, pour le second joueur.
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
| `index.html`, `src/style.css` | page : accueil et salles en ligne (`#lobby`), écran de départ du solo, barre d'informations, carte, barre de boutons, panneau latéral, panneau de production |
| `src/lobby.ts`, `src/lobby.css` | accueil (liste des parties, créer, rejoindre, solo), salle d'attente de l'hôte et d'un joueur, écran d'attente « Partie lancée » ; connexion WebSocket au relais jusqu'au message de départ, puis `main.ts` prend la partie en charge (§7). Palette et polices de la maquette de l'auteur (Barlow), tout sous `#lobby` |
| `src/online.ts` | parties en ligne sans DOM : adresse du WebSocket (`wsUrl`), nom et jetons dans `localStorage`, textes des erreurs, lecture de la liste du lobby, action proposée par partie |
| `src/main.ts` | page : écran de départ, panneau, barre (villes, usines, production), survol, messages ; crée le Worker (solo ou en ligne) |
| `src/tooltip.ts` | infobulles : encadré affiché 120 ms après le survol de tout élément qui a un `title` (le `title` est déplacé dans `data-tip`, le navigateur n'affiche plus le sien) ; curseur flèche sur ces éléments, pas le curseur de texte (`style.css`) |
| `src/infobar.ts` | barre d'informations en haut de l'écran (00-Game §11) : population, nourriture, ressources (flux), armement (stock), fronts, forces ; DOM construit une fois, pas de règle |
| `src/production.ts` | panneau de production (00-Game §8.1) : sections par ville, curseurs, priorités par glisser-déposer, déblocage, réserves (DOM, pas de règle) |
| `src/names.ts` | noms français et symboles provisoires (texte entre crochets) des biens, de l'armement et des types d'usine ; noms des types de division, des niches (et leurs lettres) et de l'équipement des divisions ; joueurs de la partie (`setRoster`, `localPlayer`, `playerName` : « Vous » pour le joueur de la page, sinon le nom du message de départ ou « Bot n » en solo) |
| `src/notifications.ts` | pile de notifications en bas à gauche de la carte (§7) : `notify`, `dismiss`, `updateNotifications`, `clearNotifications`. Ne connaît aucun système du jeu (DOM, pas de règle) |
| `src/diplomacy.ts` | diplomatie côté page (00-Game §1) : menu au clic sur le territoire d'un autre joueur, notifications des propositions et des changements de statut (§7). Pas de règle |
| `src/render.ts` | canvas de la carte : caméra, envoi du tampon de pixels, routes, villes, logos d'usine, modes placement et usine |
| `src/painter.ts` | couleur de chaque case dans un tampon RGBA (sans DOM) |
| `src/roadpaths.ts` | tracé A* des routes sur les cases, en cache par paire de cases de villes (sans DOM) |
| `src/mirror.ts` | copie locale de ce que l'affichage lit de la partie, rayons d'exploitation (champs, pêche, mine), usines, fronts et leurs zones (sans DOM) |
| `src/frontgeom.ts` | géométrie des fronts (05-Fronts §11.1, §11.4) : point du front d'une connexion, chaînes de connexions, zones de front ; flottants, sans DOM, aussi utilisée par `npm run viz:fronts` du moteur |
| `src/frontlayer.ts` | ce que la carte dessine des fronts : masques et contours des zones, points d'avancement avec le joueur de chaque côté ; recalculé quand `Mirror.frontsVersion` change |
| `src/frontwindow.ts` | fenêtre d'un front (05-Fronts §11.4) : bandeau (titre, « Sélection avancée », attaque, retour, fermeture), capsules des deux camps, rangées par niche, zones comprimées de l'adversaire, zone de retour, zone des avions (DOM construit une fois, pas de règle) |
| `src/burst.ts`, `src/burst.css` | envoi en rafale : `onPress(el, action)` envoie l'ordre à l'appui (`pointerdown`, pas au `click`, qu'un bouton reconstruit entre-temps ne reçoit jamais), 5 fois avec Maj, 10 fois avec Ctrl ; texte d'aide (« Shift + 5 », « Ctrl + 10 ») qui suit la souris sur tout élément marqué `data-burst` sans la classe `unavailable`. Utilisé par le menu « + » de l'onglet des forces (`create_division`) et par les boutons « + » du panneau de production (`create_line`). Le relais refuse au-delà de `MAX_ORDERS_PER_TURN` (20) ordres par tour et par joueur : l'excédent est perdu et la page affiche le message d'erreur |
| `src/forcestab.ts` | onglet des forces (05-Fronts §11.2) : détail de la sixième section de la barre d'informations ; bouton « + », corbeille, réserve nationale, sections de front, menu « + » |
| `src/dnd.ts` | sélection et glisser-déposer des pions (§11.4), commun à la fenêtre d'un front et à l'onglet des forces : survol, un clic, deux clics, pion fantôme, dépose sur un élément `data-drop` |
| `src/divisions.ts` | ce que l'interface lit des divisions, sans DOM : état affiché, attaques actuelles et maximales, « supportable » et « créable » du menu « + », couverture d'un front, rangement des fronts |
| `src/infopanels.ts` | panneaux de survol (§11.7) : panneau d'un type (menu « + ») et panneau d'un pion, posés sur `document.body` |
| `src/counttag.ts` | une icône et un nombre (sections de front de l'onglet, zones comprimées de l'adversaire) |
| `src/pawn.ts`, `src/pawn.css` | pion d'une division et disposition d'une zone (§11.3) : `renderZone`, `pawnOrder` ; ne gère ni la sélection ni les panneaux |
| `src/theme.ts`, `src/forces.css` | thèmes clair et sombre de la fenêtre d'un front et de l'onglet des forces (§11.8) ; styles de ces deux panneaux, du menu « + », du glisser et des panneaux de survol |
| `src/protocol.ts` | types des messages page ↔ Worker |
| `src/engine.worker.ts` | Web Worker : reçoit les messages de la page, choisit la source de tours (solo ou en ligne), tient l'horloge du solo, ouvre le vrai WebSocket |
| `src/game.ts` | `Game`, « la partie » : moteur du client, application d'un tour (`applyTurn`, `advance`), fabrication des messages de la page ; indépendante de la source (sans DOM, sans `self`) |
| `src/solo.ts` | `SoloGame`, source de tours locale : `Game` + relais (`Room`) + bots (sans DOM, sans `self`) |
| `src/online-game.ts` | `OnlineGame`, source de tours WebSocket : ordres, tours, hashes, pause, fin de partie ; le transport est fourni (sans `WebSocket`, sans `self`) |
| `src/bots.ts` | bots (§5) |
| `test/solo.test.ts`, `test/fronts.test.ts` | tests sous Node : partie solo, copie de la page, peinture ; géométrie des fronts, message des fronts, double ligne rouge, prise d'une ville |
| `test/online.test.ts` | tests sous Node de `online.ts` : adresse du WebSocket, nom et jetons gardés (stockage qui lève compris), liste du lobby |
| `test/online-game.test.ts` | tests sous Node de `OnlineGame` branché sur un vrai relais en mémoire : même état et mêmes hashes chez trois clients, rejeu d'une reprise (un seul `tick`), désynchronisation, pause, connexion perdue |
| `vite.config.ts` | `server.proxy` pour `/api` (`ws: true`), Worker au format module |
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
Worker n'est pas dans `packages/engine`. En ligne, il n'y a pas d'horloge dans
le Worker : le serveur donne le rythme (§8).

Le solo crée ses tours comme une partie en ligne (01-Architecture §1) :
`SoloGame` possède un relais (`Room`) où l'humain est l'hôte (connexion
`humain`, jeton d'hôte, `start`). À chaque tour, `SoloGame.tick` :

1. fait produire aux bots leurs ordres, dans l'ordre de leurs identifiants, et
   les fait entrer dans le relais au nom de leur identifiant (`Room.submit`) ;
2. demande le tour au relais (`Room.step`) : ses ordres sont ceux de l'humain,
   entrés à leur arrivée (`SoloGame.submit`, appelé par le Worker à chaque
   message `order`), puis ceux des bots. Le champ `player` est écrit par le
   relais d'après la connexion (règle 4 du `CLAUDE.md` : le message de la page
   n'a pas de champ `player`, et un champ `player` qu'il contiendrait serait
   écrasé) ;
3. donne le tour à `Game.applyTurn`, qui l'applique au moteur et fabrique le
   message du tour (§4).

Il n'y a plus de règle « l'humain passe avant les bots » : l'ordre est celui
d'arrivée au relais. L'humain passe avant les bots parce que ses ordres
arrivent entre deux tours et ceux des bots au moment du tour.

**Pause** : bouton « Pause (outil de développement) » en solo, « Mettre en
pause » pour l'hôte en ligne ; les autres joueurs n'ont pas le bouton
(00-Game §1.1, 01-Architecture §3). Le message `pause` va au relais, qui ne
crée plus de tour ; en solo, le Worker garde sa minuterie et `SoloGame.tick`
renvoie `null`, sans exécuter les bots. Les ordres reçus attendent. Ce n'est
pas un ordre. En ligne, tous les joueurs reçoivent `paused` et un message
« La partie est en pause. » s'affiche.

**Barre de debug** (demandée par l'auteur, 24 octobre 2026) : à droite de la
barre de boutons, encadrée en pointillé orange, étiquetée « Debug ». Ses
boutons modifient l'état du joueur humain directement, entre deux tours, hors
des règles et sans ordre : message `{ type: "debug", action, amount }` →
`SoloGame.debug`. Mode solo seulement ; en multijoueur, l'état ne change que
par les tours (règle 3 du `CLAUDE.md`), et ces boutons n'existeront pas.

| Bouton | Action |
| --- | --- |
| « +1 000 population » | `population += 1000` (jamais sous 0) |
| « + armement » | ajoute à la réserve du joueur de quoi équiper 10 divisions de chaque type (`DIVISIONS` : l'armement de chaque composant) ; message `addArmament` |
| « Armer les bots » | chaque bot reçoit 50 000 personnes et 3 lots d'armement (de quoi équiper 30 divisions de chaque type) ; message `armBots`. Les bots ne produisent pas d'armement : sans cela, aucun bot n'a de troupes. Pour essayer les fronts : fonder une ville près d'un bot, armer les bots, déclarer la guerre par le menu de diplomatie, ouvrir le front |
| « Thème : clair / sombre » | bascule le thème de la fenêtre d'un front et de l'onglet des forces (`theme.ts`, 05-Fronts §11.8) ; bouton temporaire en attendant un panneau de configuration du joueur ; pas de message : l'attribut `data-theme` de `<html>` |

Les quatre boutons sont des outils de développement hors des règles, comme la pause (05-Fronts §15). En ligne la barre est cachée et le Worker ignore le message `debug` (le bouton du thème est caché avec elle).

## 4. Messages

Page → Worker (`ToWorker`) :

- `start { mapSeed, bots, stepMs? }` (solo) : génère la carte (`generateTestMap`), crée
  la partie (`createGame`, graine = graine de la carte mélangée à une constante,
  `gameSeedFor`), les bots, lance l'horloge. Joueur 1 = l'humain, 2 à n = les bots.
- `online { url, name, token }` (en ligne) : le Worker ouvre le WebSocket `url`
  (calculée par la page d'après l'adresse du lobby, `wsUrl`) et envoie
  `join {name, token}`. Le message de départ du relais donne la carte, la
  graine, les joueurs et `you` : la partie est créée de la même façon chez
  tous (`new Game`, même graine de partie qu'en solo).
- `order { id, order }` : `found_city { tile }`, `set_farm_share { percent }`, ou un
  ordre d'usine : `build_factory { city, factoryType }`, `delete_factory { city }`, `create_line { city,
  good }`, `set_active_lines { city, good, count }`, `set_city_priority { city,
  position }`, `set_line_priority { city, good, position }` (02-Engine §4), ou un
  ordre de diplomatie : `declare_war { target }`, `propose_pact { target }`,
  `break_pact { target }`, `propose_peace { target }`, `answer_proposal { from,
  accept }`. Les chaînes ne sont pas vérifiées par la page : le moteur les vérifie.
- `pause { paused }` (solo : le relais local ; en ligne : demande à l'hôte, que le relais refuse à un autre joueur).
- `order` accepte aussi les ordres des fronts (05-Fronts §5.2, 02-Engine §4) : `create_division { division }` (clé d'un type de `DIVISIONS`),
  `delete_division { id }`, `move_division { ids, front, line?, box? }` (`front` 0 : réserve nationale ; sans `line` : seconde ligne ;
  `line` : `first`, `second`, `rapid` ou `box` ; `box` : boîte de percée, 0 pour en créer une),
  `set_forced_mobilization { enabled }`, `start_front_attack { front }`, `stop_front_attack { front }`,
  `start_breakthrough { box, city1, city2 }`, `cancel_breakthrough { id }`.
- `debug { action: "addPopulation" | "addArmament" | "armBots", amount }` (voir §3).

Worker → page (`FromWorker`) :

- `init` (une fois) : largeur, hauteur, `terrain`, `resources`, `fertility`
  (copies, transférées : le moteur garde les siennes), nombre de joueurs, `you`
  (le joueur de la page : 1 en solo, celui du message de départ en ligne) et
  `playerNames` (le nom de chaque joueur, indice `id - 1`), rayons
  d'expansion et de contrôle, coût d'une ville, `stepMs`, et `catalog` : la
  configuration des usines que la page affiche (types d'usine et leur arbre,
  `unlockTurns`, identifiants des biens et des armements, production,
  ouvriers et fer par ligne, par produit), lue dans le moteur par `factoryCatalog()` (`solo.ts`) ;
  `catalog.economy` : les réglages que la barre d'informations utilise
  (consommation par tête, nourriture minimale, `maxMachinesPer1000` de chaque
  machine, déclin de l'armement en pourcent) ; `military` (`MilitaryCatalog`) : les types de division
  (clé, indice, niche, rang dans la niche, composants avec leur quantité, leur poids et leurs attaques, icône,
  description, largeur de front, durée de formation, type d'élite, PV, multiplicateurs, blindage, motorisation), les niches et leurs types,
  `eliteTroopsRatio`, et les délais (tours entre deux rounds, déplacement) et l'échelle de l'état, lus dans
  `config/divisions.ts` et `config/fronts.ts` par `militaryCatalog()` (`solo.ts`).
- `tick`, à chaque tour :
  - `tick` : numéro du tour ;
  - `tiles` : paires `[case, ville]` des cases dont `tileCity` a changé, pas
    plus ; le propriétaire se déduit de la ville ;
  - `cities` et `roads` : listes complètes, **seulement** si une ville a été
    fondée pendant ce tour (c'est le seul cas où les villes, ports, groupes et
    routes changent) ; sinon `null` ;
  - `factoryMarks` : les usines de tous les joueurs, quatre nombres chacune [ville,
    indice du type, niveau, indice dans l'arbre du bien dominant (`dominantGood`,
    `names.ts` : le plus de lignes construites)], **seulement** si elles ont changé depuis le tour
    précédent (`SoloGame` compare une chaîne), sinon `null` ;
  - `human` : le détail des usines du joueur local (`you`), à chaque tour (quelques dizaines
    de nombres) : pour chaque usine, ses groupes `{ good, lines, active, filled }`
    et ses compteurs de déblocage ; biens produits, réserves d'armement, réserves
    cibles, capacité de fer, fer requis (somme des lignes actives × fer par ligne) ;
  - `players` : par joueur, population, fermiers, pêcheurs, inactifs,
    nourriture, blé, poisson, surface cultivée et max, surface pêchée et max,
    `farmPercent`, capitale, nombre de villes, ouvriers d'usine, mineurs, cases
    de fer exploitées, fer extrait ;
  - `results` : pour chaque ordre du joueur local dans le tour, `applied` vrai ou faux
    (`id` : l'identifiant que la page avait donné à l'ordre, rendu dans l'ordre d'envoi) ;
  - `diplomacy`, **à chaque tour** (`SoloGame.diplomacyView`, quelques dizaines
    d'octets : un statut par joueur, quelques propositions) : `status`, le statut du
    joueur local envers chaque joueur (`status[id - 1]` : `"neutral"`, `"pact"` ou
    `"war"`) ; `proposals`, les propositions en attente dont le joueur 1 est
    l'auteur ou la cible, chacune `{ from, to, kind, startTick, endTick }` (`endTick`
    = tour de l'envoi + `DIPLOMACY.proposalTurns`) ; `events`, les événements
    diplomatiques du tour où il est l'auteur ou la cible (`state.events` filtré,
    mêmes champs que `DiplomacyEvent`, 02-Engine §4). Pas d'envoi « seulement si
    changé » : c'est petit, et la liste est la source des cartes de proposition (§7) ;
  - `fronts` : tous les fronts à plat (`FrontView` : joueurs, groupes, `active`, connexions avec leur position,
    et pour chaque camp `frontAttack`, l'attaque sur tout le front), ou `null` si rien n'a changé depuis le dernier
    envoi. `SoloGame` les reconstruit à chaque round de combat (`combatTurns`), quand le joueur donne un ordre et quand
    des villes changent, et compare le JSON au dernier envoyé ; les positions changent à chaque round.
    Pas de brouillard de guerre : les fronts de tous les joueurs, pas seulement ceux du joueur 1 ;
  - `divisions` : toutes les divisions de tous les joueurs, par identifiant (`DivisionView` : propriétaire, type,
    quantités par composant, front (0 : réserve nationale), ligne, largeur engagée en millièmes de liaison, état sur
    `stateScale`, statut `ready`, `formation`, `moving` ou `fleeing`, tour de fin du statut), ou `null` si rien n'a changé ;
    `Mirror.divisions` garde le dernier tableau, le même objet tant qu'il ne change pas ;
  - `captured` : les villes prises pendant le tour (`{ city, from, to }`). Une ville prise
    change de joueur sans que `tileCity` change : `cities` est alors renvoyé, avec les paires
    `[case, ville]` de toute sa zone dans `tiles`, pour que la copie de la page la repeigne et
    refasse ses histogrammes ;
  - `eliminated` : les joueurs éliminés pendant le tour (`{ player, by }`, événement `player_eliminated` du moteur) ;
    vide après un rejeu. `players[i].defeated` dit, à chaque tour, si un joueur est éliminé (la page en tire l'état de
    spectateur, même après un rejeu) ;
  - `players` porte aussi `soldiers`, `hurt` (blessés, 00-Game §4.2 : `population` les compte, le total affiché les retire),
    `forcedMobilization` et `divisionEquipment` (armement
    des divisions du joueur, par type d'armement dans l'ordre de `armamentIds`) ;
  - `perf` : durées en ms dans le Worker (bots, `applyTurn`, fabrication du
    message).
- `paused { paused }` : état de la pause (la réponse du relais, solo comme en ligne).
- `notice { text }` (en ligne) : un refus du relais qui n'arrête pas la partie
  (ordre ignoré, pause demandée par un autre que l'hôte) ; la page l'affiche.
- `ended { reason, message }` (en ligne) : la source de tours s'est arrêtée.
  `desync` : la copie de la partie a divergé (01-Architecture §3) ; `refused` :
  le relais a refusé la connexion, la partie n'existe plus, ou le joueur est
  remplacé par un autre onglet ; `error` : le moteur a levé une erreur ou un
  tour manque ; `lost` : la connexion s'est fermée. `message` est le texte à
  afficher.

Aucun tableau complet par tour. Les grands tableaux de `tick` sont transférés,
pas copiés.

**Rejeu d'une reprise.** À la reconnexion, le relais renvoie tous les tours
depuis le début (`turns`). `OnlineGame` applique tous les tours sauf le dernier
avec `Game.advance` (moteur seul, aucun message) et le dernier avec
`Game.applyTurn(…, { full: true })` : la page reçoit un seul `tick` qui porte
tout ce que les messages sautés auraient apporté (toutes les cases de
`tileCity`, les villes et routes, les usines, les fronts), et aucun événement du
passé (`results`, `captured`, `encircled`, `failedBreakthroughs` et `events`
de la diplomatie sont vides). Un seul hash est envoyé : celui du dernier
multiple de N atteint pendant le rejeu.

**Cases modifiées.** `applyTurn` renvoie les cases dont le propriétaire a changé,
mais pas celles qui passent d'une ville à une autre du même joueur (02-Engine §4),
et l'affichage en a besoin (limites de zones, rayon d'exploitation). `SoloGame`
garde le `tileCity` déjà envoyé et le compare à celui du moteur, **seulement**
quand une ville a été fondée (400 000 comparaisons, environ 0,1 à 0,5 ms) : sans
fondation, `tileCity` n'a pas pu changer.

**`results`.** `applyTurn` ne dit pas quels ordres ont été appliqués. `SoloGame`
le lit dans l'état : une fondation est appliquée si une ville du joueur 1 est
apparue sur cette case pendant le tour ; un réglage, si `farmPercent` vaut la
valeur demandée. Ordres d'usine : une usine est construite si la ville n'en avait
pas avant le tour et en a une du bon type ; une ligne est créée si le nombre de
lignes du groupe a augmenté (état d'avant relevé seulement quand il y a un ordre
humain) ; un réglage de lignes actives, si `active` vaut `count` ; une priorité,
si la ville (ou le groupe) est à la position demandée. La page affiche un message
pour un ordre non appliqué. Ordres de diplomatie : appliqué si `state.events` (vidé
au début du tour) contient l'événement attendu pour ce joueur (`war_declared`,
`pact_broken`, `proposal_sent` du bon genre, ou `proposal_accepted` /
`proposal_refused` pour `answer_proposal`) ; le message d'un ordre refusé est
« Action diplomatique sans effet ».

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

Les bots n'envoient **aucun ordre de diplomatie** et ne répondent à aucune
proposition (IA reportée, 00-Game §1.1) : une proposition faite à un bot expire
après `DIPLOMACY.proposalTurns` tours.

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
texture de champs (terre fertile), de pêche (eau) ou de mine (case de fer
exploitée) → trait, tracé sur la terre seulement. Pour une case de terre de la
ville d'un joueur P : si une de ses quatre voisines (dans la carte) est de la
terre sans ville ou à un autre joueur, **frontière** de P (`playerBorder`, sa
teinte plus sombre) ; sinon, si sa voisine de droite ou du dessous est de la
terre d'une autre ville du même joueur, **limite** (`playerLimit`, sa teinte plus
claire). L'eau et le bord de la carte ne déclenchent rien. Entre deux joueurs,
chaque côté est peint de sa couleur : double ligne. Le trait ne dépend pas des
cases du menu « Carte » (`showPlayerColor` : mélange à 45 % de la couleur du
joueur sur la terre). Le relief d'une case de fer est toujours recouvert d'un gris
brun-rouge (`landIron`, `IRON_TINT` à 55 %) ; sinon, celui d'une case cultivable
(fertilité > 0) d'un vert léger (`landFertile`, 80/255 d'opacité). Les trois textures sont différentes de la couleur du joueur : champs en
bandes vertes, pêche en points blancs sur l'eau bleue, mine en bandes diagonales
sombres et orangées (provisoire, 00-Game §11). Chaque texture remplace la
couleur de la case quand `showPlayerColor` est faux ; quand il est vrai, la case
garde 70 % de sa couleur (relief teinté par le joueur, ou mer) et prend 30 % de
la texture (`TEXTURE_ALPHA_ON_PLAYER`) : à 100 %, les champs couvraient la
couleur des joueurs ; même réglage pour la pêche et la mine
(auteur, 25 octobre 2026). À chaque tour, seules sont
repeintes : les cases dont la ville a changé et leurs quatre voisines (la couleur
d'une case dépend de ses voisines de gauche, droite, haut et bas), et les cases dont l'appartenance au champ, à la zone de pêche ou à la
mine a changé. Le rectangle englobant est renvoyé au canvas par `putImageData` avec
rectangle sale.

**Rayon d'exploitation** (00-Game §6.6, affichage seulement). Pour chaque joueur,
un histogramme du nombre de cases fertiles (puis d'eau, puis de fer) de ses zones
par distance au carré à leur ville (de 0 à rayon de contrôle²), tenu à jour case
par case. Le seuil est la plus petite distance au carré dont le cumul est le plus
proche de la surface cultivée (puis pêchée, puis du nombre de cases de fer
exploitées, `minedTiles`) ; une case est dans le champ si sa distance au
carré à sa ville est ≤ au seuil. Quand un seuil change, seules les cases de
l'anneau entre l'ancien et le nouveau seuil sont repeintes. Un test compare
histogrammes incrémentaux, seuils et pixels à un recalcul complet.

**Tracé des routes** (`roadpaths.ts`, 00-Game §3.5, affichage seulement). Le moteur
ne connaît qu'une paire de villes par route. `Mirror` garde en plus `roadTiles` :
pour chaque route, la suite de cases qui la dessine. `RoadPaths.sync` le
recalcule quand un message `tick` apporte une liste de villes ou de routes (donc
à la fondation d'une ville, pas à chaque tour). Le chemin est un A* sur les
cases de terre (`TERRAIN_LAND`), 8 voisins ; le coût d'une case d'arrivée est
`1 + ROAD_HEIGHT_COST_FACTOR × altitude` (bits `TERRAIN_ALTITUDE` de
`mirror.terrain`, de 0 à 31), multiplié par `√2` pour un pas en diagonale ;
une case déjà traversée par le chemin d'une autre route coûte `ROAD_REUSE_COST_FACTOR`
(0,5) fois ce coût : deux routes qui arrivent à une même ville finissent ensemble
au lieu de longer l'une l'autre côte à côte. Les chemins conservés du cache
marquent leurs cases (`used`) avant que les nouveaux soient calculés, et chaque
nouveau chemin marque les siennes pour le suivant ; une route tracée plus tôt
n'est jamais modifiée par une route tracée plus tard.
L'heuristique est la distance octile × 0,5 (coût minimal d'une case), donc le
chemin est optimal pour ces coûts. La recherche reste dans le rectangle des deux villes agrandi de
`expansionRadius / 2` cases. Le cache est une `Map` dont la clé est la paire des
deux cases de villes (et non des identifiants, qui peuvent changer) : une route
déjà tracée est reprise telle quelle, une route absente de la nouvelle liste
(coupée par une nouvelle ville) est oubliée. Sans chemin de terre dans le
rectangle, le chemin passe par les ports quand les deux villes en ont un
(00-Game §3.6) : A* terrestre de la ville à son port (la case de côte de
`mirror.portTile`), puis A* sur les cases d'eau d'un port à l'autre, puis
A* terrestre du second port à la seconde ville. La recherche en mer porte sur
toute la carte ; les deux cases de port sont les seules cases de terre permises,
et un pas en diagonale ne passe pas entre deux cases de terre. Le coût d'une case
d'eau est `1 + SEA_COAST_COST × (SEA_COAST_CLEARANCE + 1 − d) / SEA_COAST_CLEARANCE`
pour une distance `d` à la terre de 1 à `SEA_COAST_CLEARANCE` cases (carte de
distances par parcours en largeur, calculée à la première route maritime), 1
au-delà ; la réutilisation d'une case déjà tracée divise toujours le coût par
deux. `RoadPaths.seaSpan(chemin)` donne les indices des deux ports dans le
chemin ; `render.ts` dessine cette partie en pointillés. `Mirror` calcule les
cases de port avant d'appeler `sync`, qui reçoit la table identifiant de ville →
case de port. Un chemin qui n'est pas entièrement de terre est gardé avec la paire
de ports qui l'a produit : si l'un des deux ports change de case ou disparaît,
il est recalculé. Sans port ou sans eau entre les ports, le chemin est vide et
`render.ts` ne dessine pas la route (les routes voisines portent le trajet). Les calculs sont en flottants : ils ne
touchent jamais l'état de la partie.

**Canvas** (`render.ts`). Molette : zoom centré sur la souris ; glisser : déplacer
(sous 4 pixels de mouvement, c'est un clic). À chaque image : le tampon de la
carte, puis routes (ligne brisée le long de `mirror.roadTiles`, trait plein foncé
entre deux villes d'un même joueur, pointillé gris sinon), villes (point ; étoile pour la capitale ; carré bleu de
port sur la case de côte de la zone la plus proche de la ville, ou à côté de la
ville si c'est la sienne), puis, en mode placement, le rayon d'expansion des
villes du joueur et la case survolée. Une ville qui porte une usine est dessinée
plus grande (`1 + 0,08 × niveau`, niveau plafonné à 10 : 00-Game §3.7) et son
logo, l'icône de son bien dominant (`FactoryMark.good`, 16 px) sur un fond gris clair
de 18 px cerclé de noir (1 px), soit 20 px d'écran à tout zoom, est à côté d'elle (l'initiale du type
tant que l'image n'est pas chargée : `MapView.logo`, un `Image` par chemin,
qui redessine la carte à son chargement ; 00-Game §8). Quand le logo (20 px) dépasse le tiers du rayon de contrôle en pixels d'écran
(`20 × 3 > controlRadius × zoom`, soit un zoom sous 2,4 avec un rayon de 25 cases), il est remplacé
par un carré de 5 px à bordure sombre (`FACTORY_DOT_*` : bordure `#3a3a3a`, intérieur `#9a9a9a`), posé au même coin. Dans le panneau de
production, la même icône précède le nom de l'usine. En mode usine, la zone de la ville survolée est
colorée, verte si la ville est au joueur et sans usine, rouge sinon
(`zoneLayer` : un petit calque par ville et par couleur, vidé quand les zones ou
les usines changent). Survoler la section d'une usine dans le panneau de
production met en évidence la ville : `ProductionPanel` appelle
`MapView.highlightCity(ville)` à l'entrée du pointeur (0 à la sortie, et à chaque
reconstruction du panneau, qui détruit les sections), et `draw` hachure en blanc
(bandes « / », même `drawHatch` que les vues) les cases dont `tileCity` est cette
ville, au-dessus des vues et sous les routes et les villes ; le masque de la zone
est recalculé à chaque changement de ville ou de zones. Une image n'est dessinée que si quelque chose a changé
(`requestAnimationFrame`).

**Fronts** (05-Fronts §11). `Mirror` garde les `FrontView` (`fronts`, `frontsVersion`), les paires de villes des
connexions des fronts actifs (`isFrontPair`) et, à la demande, la zone de front de chaque case (`frontZones` : `frontgeom.ts`,
distance à la ligne du front ≤ la moitié du rayon de contrôle (sélection et affichage), terre seulement, le front le plus proche gagne ; recalculée quand
`frontsVersion` change). **Double ligne rouge** : `Painter.colorOf` peint en rouge la case de terre dont une voisine est
la terre d'une ville d'un autre joueur reliée à la sienne par une connexion d'un front actif, et la ligne sombre du joueur
recule d'une case vers l'intérieur (bande de 4 cases : sombre, rouge, rouge, sombre). La couleur d'une case dépend donc de ses
voisines à deux cases : `Mirror.applyTick` repeint le losange de rayon 2 autour d'une case modifiée, et les cases des
villes dont une paire de front change. **Zones** (`frontlayer.ts`, `render.ts`) : hachures de 2 px tous les 8 px à 45° et contour
de 2 px (segments des côtés de cases qui touchent l'extérieur de la zone), en rouge pour les fronts actifs (case « Zones de
front » du menu Carte, cochée au départ), en bleu pour un front en paix **au survol seulement** ; la zone survolée s'affiche
toujours, même case décochée. **Soldats** : pour chaque connexion d'un front actif, le point d'avancement et un rond de la couleur du joueur de chaque côté, de la
taille d'une ville (`render.ts`, `FrontLayer.marks`) ; la courbe de Catmull-Rom est abandonnée (05-Fronts §11.1).
**Survol d'une zone de front** : contour de 5 px, fixe. **Clignotement** : `BLINK_PERIOD_MS` (1 000 ms, `blink.ts`) pour le bouton d'attaque
actif de la fenêtre d'un front (variable CSS `--blink-period` posée au démarrage). **Percées en cours** (`MapView.drawBreakthroughs`, 05-Fronts §11.1) : pour chaque percée des deux camps (`FrontView.breakthroughs`), un trait
rouge de 3 px le long du segment droit entre les deux villes de l'axe et une flèche de 14 px (`ARROW_PX`) au milieu, de la ville de celui
qui perce (`owner`) vers celle de son adversaire. **Mode choix d'axe** (`main.ts`, `startAxisMode`, `nearestConnection`) : repris de la
v0.1 ; le bouton « Lancer » d'une boîte ferme la fenêtre du front, la connexion du front la plus proche de la souris est surlignée
(`MapView.axisHover`), un clic envoie `start_breakthrough { box, city1, city2 }` et termine le mode, Échap ou le bouton `#axis-cancel` (« Annuler la percée », en haut à droite de la carte, affiché pendant le mode) l'annule ; dans les deux cas la fenêtre se rouvre
dans l'état d'avant (`FrontWindow.fromTab`, mémorisé par `startAxisMode`). `failedBreakthroughs > 0` : message « Percée arrêtée ».

## 7. Interface provisoire

- **Écran de départ** : nombre de bots (1 à 7, 3 par défaut), graine de la carte
  (12345 par défaut), « Jouer ».
- **Barre de boutons**, en bas (00-Game §1) : « Créer une ville », suivi du
  coût de la prochaine ville (`foundingCost`, mis à jour à chaque tour) avec
  l'icône de population neutre ; caché tant que le joueur n'a pas de capitale
  (première ville gratuite). Active le mode
  placement (échap : quitte). Sans ville : rien de particulier, toute terre libre
  est valide. Avec des villes : le rayon d'expansion de chacune est dessiné ; la
  case survolée est verte si la fondation respecte 00-Game §3.3 (terre,
  `tileCity === 0`, dans le rayon d'expansion d'une ville du joueur, population ≥
  coût) et rouge sinon, avec la raison dans la barre. En mode placement, les
  vues de `PLACEMENT_MAP_OPTIONS` sont affichées (pas `factories`, dont la case règle
  `MapView.showFactoryLogos` : logos d'usine, cochée au départ ; dont les hachures de
  fertilité, voir le menu « Carte »), le rayon de contrôle qu'aurait la ville est dessiné autour de la case
  survolée, et la barre donne le nombre de cases cultivables que cette ville
  prendrait (`Mirror.fertileTilesFor` : libres, ou plus proches d'elle que de
  leur ville actuelle, 00-Game §3.2). Le clic sur une case rouge
  n'envoie rien. Le clic sur une case verte envoie `found_city` ; si le moteur ne
  l'applique pas (`results`), la page affiche « Ville non fondée : le moteur a
  refusé l'ordre ». La page copie les conditions pour colorer la case ; **le
  moteur reste l'autorité** et vérifie à nouveau.
- **« Inaugurer une usine »** (00-Game §1) : un clic déplie vers le haut le menu
  des types d'usine (un choix par entrée de `catalog.factoryTypes`, avec l'icône
  de sa racine, ou son symbole provisoire, par exemple `[fusil]`). Au survol d'un
  choix, l'**arbre de progression** du type s'affiche à droite du menu, bords bas
  alignés (`attachFactoryTreeTip`, `goodtips.ts`) : en-tête « \<type\> : arbre de
  progression », puis un nœud par entrée de `tree` sous son `parent`, reliés par
  des traits en coude ; la racine en gras avec « production de base ». Chaque
  nœud porte l'icône du bien, ou un carré en pointillés s'il n'en a pas (le
  symbole texte répéterait le nom). Pas de condition de déblocage : elle est la
  même pour tous les nœuds (`FACTORY.unlockTurns`, décision de l'auteur,
  25 octobre 2026). Les types dont le joueur a déjà une usine sont grisés à
  l'ouverture du menu (une usine par type, 00-Game §8). Le choix arme le bouton
  et ferme le menu. En survolant la zone d'une ville du joueur qui n'a pas
  d'usine, la zone est verte ; ailleurs, rouge (autre joueur, ville qui a déjà une
  usine, hors de toute zone), avec la raison dans la barre. Un clic sur une zone
  verte envoie `build_factory` et désarme le bouton ; un clic sur une zone rouge
  affiche la raison et n'envoie rien. Échap désarme et ferme le menu. Armer
  l'un des deux modes (ville, usine) quitte l'autre.
- **« Production »** : ouvre ou ferme le panneau de production (`production.ts`),
  posé sur le bord droit de la carte :
  - en haut, un résumé : lignes remplies / actives, ouvriers d'usine, fer
    (capacité, extrait, cases exploitées, mineurs), biens produits au dernier
    tour ;
  - une section par ville qui a une usine, dans l'ordre de priorité : « Ville
    n° N », icône du bien dominant (`dominantGood`) et nom propre du type
    (`FACTORY_NAMES` dans `names.ts` : manufacture d'armes, chantier naval, usine
    mécanique ; le même nom est dans le menu « Inaugurer une usine »), niveau (nombre de lignes) ; une poignée
    `⋮⋮` à glisser change la priorité de la ville (`set_city_priority`, position
    = indice de la section sur laquelle on dépose) ; une croix `×` discrète en
    haut à droite de la section (`.fdelete`) demande confirmation (`window.confirm`,
    avec le nom du type et le nombre de lignes perdues), puis envoie
    `delete_factory` ;
  - dans la section, une ligne par bien : poignée (`set_line_priority`, au sein de
    la section seulement), puis sur la première ligne, pour les lignes remplies
    au dernier tour : fer consommé au total (lignes remplies × `ironPerLine`),
    icône du fer, →, production totale (lignes remplies × `productionPerLine`),
    icône du bien ; curseur de 0 à `lines`, « actives / total ». Sur la seconde
    ligne (auteur, 1er novembre 2026) : ouvriers employés en gras (`workers` du
    groupe, somme des coûts par rang calculée par le moteur, 00-Game §8.1)
    suivis de l'icône d'ouvrier (`population/pop-worker.png`) ; pour un type
    d'armement, « approprié pour : » le nombre de divisions de référence que
    le stock cible de **cette ligne** équipe, en gras, et l'icône de la division :
    `⌊ lignes × productionPerLine × stockTurns ÷ exemplaires par division ⌋`,
    la formule du stock cible de l'onglet « Armement » (00-Game §8.3) appliquée
    aux lignes construites du groupe. Division de référence
    (`FactoryCatalog.equipUnit`, calculée dans `game.ts`) : les réguliers s'ils
    utilisent l'armement (fusils, mitrailleuses), sinon la première division de
    `DIVISIONS` qui l'utilise. Les biens n'ont pas ce second bloc. Plus de
    nombre de lignes remplies ni de raison du manque sur cette ligne ;
    l'infobulle donne le coût d'une ligne : ouvriers de la 1re ligne et
    minimum (`workersPerLine`, `workersFloor`), fer, produits. L'ordre `set_active_lines` part au
    relâchement du curseur. Contour des sections et séparations entre lignes :
    même trait, 2 px (`--fsec-line`, `style.css`) ;
  - un bien verrouillé de l'arbre (pas encore créé et dont le parent n'a pas
    `unlockTurns` tours-lignes) : `[parent]`, « compteur / unlockTurns », barre qui se remplit,
    cadenas (`icons/miscellaneous/misc-padlock.png`), `[bien]` ;
  - une ligne par bien de l'arbre : en production, un bouton + à côté du curseur
    envoie `create_line` (une ligne de plus, à la main) et, pour une machine,
    une jauge de croissance automatique dessous, précédée de l'icône `misc-up-lighter.png` (les boutons +
    portent `misc-plus-lighter.png`, dans `icons/miscellaneous/`) (`growth / growthTurns` en tours-lignes, ou
    « demande couverte » quand `demandMet`, 00-Game §8.2) et un trait noir sur
    le curseur à `usefulLines / lines` : lignes utiles, calculées par
    `SoloGame.humanDetail` dans l'ordre de remplissage du moteur
    (`ceil((goodsDemand − production des groupes d'avant) / productionPerLine)`,
    borné à `lines`). Le curseur (`input.lines-slider`, piste native
    transparente) est à `active`, le maximum réglé par le joueur ; dessous, une
    piste grise et une barre bleue (`.slider-fill`) de longueur
    `min(filled, active, usefulLines)` : la production réelle. Quand les lignes
    en service (`min(active, usefulLines)`) dépassent les lignes remplies (pas
    assez d'ouvriers), une barre rouge (`.slider-short`) couvre l'écart et un
    trait rouge (`.short-mark`) marque la production réelle ; sans manque,
    ni l'un ni l'autre (auteur, 1er novembre 2026). Quand le réglage du joueur
    dépasse les lignes utiles (`active > usefulLines`, la demande est couverte), une
    barre verte (`.slider-slack`) va des lignes en service au réglage. L'infobulle
    du curseur (`data-bar`) explique chaque cas : « pas assez de main-d'œuvre ou de
    ressources » (rouge), « le besoin est inférieur à la production cible » (vert). Barre et traits
    sont placés entre les centres extrêmes du pouce (7 px de chaque côté). Le
    compte affiche « en service · max réglé / lignes ». Débloqué sans
    ligne, un bouton + crée la première ; verrouillé, la flèche de
    progression. Plus de bouton « Ajouter une ligne » ni de liste ;
  - en bas, les réserves d'armement (réserve et stock cible).
  Le panneau n'est reconstruit que quand sa structure change (usines, groupes,
  lignes, biens débloqués), et jamais pendant un glisser ou un réglage de curseur
  (ni pendant 500 ms après, le temps que le moteur applique l'ordre) ; entre deux
  reconstructions, seuls les nombres sont mis à jour.
- **Barre d'informations**, en haut de l'écran de jeu (00-Game §11, `infobar.ts`) :
  44 px de haut, cinq boutons séparés par un trait ; chacun a une ligne de
  chiffres et, juste dessous, une **mini-barre** (10 px, `.ib-mini`) : la barre
  la plus pertinente de son détail, mise à jour par `head` à chaque tour, détail
  ouvert ou non. Population : la barre empilée de toutes les occupations, avec
  leurs couleurs. Nourriture : la même jauge que la ligne « Population » du détail : la
  population (vert plein), la population que la nourriture du tour fait vivre
  (vert hachuré) et le maximum si toutes les cases étaient travaillées (gris),
  à l'échelle du plus grand des trois.
  Ressources (flux) : la barre du fer, **orange** (`.ib-track.iron`, comme dans
  le détail) : orange clair pour la barre pleine (capacité, ce que les cases de
  fer pourraient donner), orange pour l'extrait, écart rouge, trait noir du
  requis. Provisoire : elle deviendra une vue agrégée de toutes les ressources
  (hors biens produits), à définir, car elle doit couvrir plusieurs types autres
  que le fer. Armement : tous les types additionnés, mêmes couleurs et même
  échelle que les lignes du détail (fronts, stock, hachures au-delà de la cible,
  trait de la cible). Fronts : part des fronts du joueur qui sont actifs
  (vert). Un clic sur un
  bouton déplie son détail juste sous la barre, par-dessus le haut de la carte,
  aligné sur le bord gauche du bouton ; un second clic le replie ; un seul détail
  est ouvert à la fois. Le détail ne sort pas de la carte : sa butée à droite est
  le bord gauche du panneau latéral (`#panel`) et, quand il est ouvert, du panneau
  de production (`#prod`) ; le détail se décale vers la gauche (et se rétrécit si
  besoin) à l'ouverture ou à la fermeture du panneau de production
  (`InfoBar.place`, appelé par le bouton « Production »). Le DOM est construit une fois par partie ; chaque tour,
  `InfoBar.update` écrit seulement des textes et des largeurs (la barre, et le
  détail ouvert ; un détail replié est mis à jour à l'ouverture). Les barres
  **vertes** sont des flux (production du tour), les barres **bleues** des stocks.
  Les icônes sont des textes provisoires entre crochets (`[fer]`…), `⇄` pour les
  flux, `▣` pour le stock, sauf la population et les trois machines : images
  16 × 16 de `public/icons/` (00-Game §11), affichées à 16 px sans lissage
  (`image-rendering: pixelated`) ; `pop-default` sur l'onglet, une icône par
  occupation dans son détail. Les machines tirent la leur de `icon` dans
  `config/goods.ts` (voir ci-dessous).
  **Icônes en 32 px (essai)** : dans l'interface des usines (onglet Production,
  menu « Inaugurer une usine » et son arbre de progression au survol) et dans l'onglet militaire (tableau des unités et
  combats), les icônes de biens, d'armement et d'unités sont affichées à 32 px
  (`productIcon(id, 32)`, classe `.ib-img.big`, `.fp-icon-img`) ; les lignes de l'armement
  (stock) de la barre d'informations aussi ; la barre du haut et
  les autres infobulles restent à 16 px. `icons.ts` (`ICONS_32`) associe aux icônes
  d'armement AA, AT, artillerie et chenillette leur fichier dessiné en 32 × 32 (les trois
  chars n'existent qu'en 32 × 32) ; les autres sont
  les fichiers 16 × 16 agrandis sans lissage. Provisoire : à terme, un bien aura
  ses deux versions dessinées.
  **Menu « Carte »** : dernier élément de la barre (bouton `Carte ▾`, texte plus
  gros que les sections ; une icône de carte le remplacera). Son bord droit est
  contre le bord gauche du panneau latéral : `margin-right: var(--panel-w)`, la
  variable qui donne aussi sa largeur à la colonne du panneau ; sous 760 px, le
  panneau passe sous la carte et le bouton revient contre le bord droit. Il ouvre
  sous le bouton, aligné sur son bord droit, un menu de cases à cocher
  (`MAP_OPTIONS`, `infobar.ts`, avec l'état de chaque case en début de partie :
  « Ressources naturelles » → `view.showIron`, décochée ; « Couleur des
  joueurs » → `painter.showPlayerColor`, cochée ; « Fertilité » →
  `view.showFertility`, décochée) ; chaque changement appelle le rappel
  `onMapOption` de `InfoBar`, que `main.ts` branche sur le painter et la vue de la
  partie. La couleur des joueurs est dans le tampon : la changer repeint tout
  (`paintAll` puis `uploadAll`). Les hachures des deux autres vues sont dessinées
  par `render.ts` à chaque image (`drawHatch`, une `Hatching` par vue) : le masque
  des cases concernées (`buildMask`, calculé une fois, la fertilité et le fer ne
  changent pas) est posé à la caméra dans un calque à la taille du canvas, puis
  rempli d'un motif de bandes diagonales (`source-in`) de 4 px sur une période de
  10 px d'écran, à tout zoom ; le motif est décalé avec la carte pour ne pas
  glisser quand on la déplace. Fertilité : vert doux, bandes « / ». Fer : rouge
  foncé, bandes « \ », pour que les deux se croisent au lieu de se confondre
  quand elles sont affichées ensemble (placement d'une ville). Aluminium : bleu,
  bandes « \ » aussi (une case ne porte qu'une ressource, rien ne se croise).
  Les couleurs et les icônes des ressources sont dans `RESOURCE_LEGEND`
  (`render.ts`). Quand la vue « Ressources naturelles » est affichée, `#map-legend`
  (en bas à gauche de `#stage`, rempli par `main.ts` depuis `RESOURCE_LEGEND`)
  montre pour chaque ressource son icône, un rectangle rayé de la couleur des
  hachures et son nom. Le menu est un enfant de `#infobar`, comme les détails, parce que
  `.ib-bar` a `overflow` et le couperait. Il reste ouvert quand on coche ; il se
  ferme au reclic sur le bouton, au clic en dehors (`pointerdown` sur le document),
  à Échap, ou à l'ouverture d'un détail, et l'ouvrir replie le détail ouvert. Les
  cases reprennent leur état de début de partie à chaque nouvelle partie (rien
  n'est mémorisé). `main.ts`
  garde l'état des cases dans `mapChecked` ; `applyMapOptions` affiche une vue si
  sa case est cochée, ou si le mode placement est actif et qu'elle est dans
  `PLACEMENT_MAP_OPTIONS`. Il est appelé à chaque case changée et à chaque entrée
  ou sortie du mode placement, et ne repeint que si une vue change. Les cases ne
  sont pas modifiées : à la sortie du mode, la carte revient aux vues cochées.
  **Infobulles** (`tooltip.ts`, encadré en 14 px, pas l'infobulle du
  navigateur, trop lente) : chaque nombre a un `title` qui nomme ses valeurs dans l'ordre
  d'écriture, avec les mêmes séparateurs, en un mot chacune : « Actuelle /
  nourrie / potentielle », « Stock / cible · par tour ». Sur la barre, l'infobulle
  est celle du bouton entier. Même règle dans le panneau latéral (« Cultivées /
  cultivables ») et le panneau de production (« En service · réglé / lignes »).
  **Infobulles construites** (`setTip(el, build)` de `tooltip.ts`) : `build`
  renvoie un contenu (titre, sections, barres) au lieu d'un texte ; il est appelé
  à l'affichage, puis à chaque tour tant que l'encadré est affiché (`refreshTip`,
  appelé par `main.ts` après la barre d'informations). Encadré de 340 px, en 13 px
  (largeur du contenu pour l'arbre de progression). `setTip(el, build, beside)` :
  l'encadré est placé à droite de `beside` au lieu de sous `el` (menu « Inaugurer
  une usine »).
  Les contenus des biens sont dans `goodtips.ts` (`attachGoodTip(el, bien)`, posé
  sur chaque `[bien]` de la barre d'informations et du panneau de production, et
  sur l'engrenage `misc-gear-stolen.png` (`gearIcon`, `infobar.ts`) à droite de
  Mineurs, Fermiers et Pêcheurs dans l'onglet Population, et après Agriculture et
  Pêche dans l'onglet Nourriture : il montre l'infobulle de la machine du métier,
  dont le titre porte l'icône de la machine).
  Feuille de route de toutes les icônes : `04-Tooltips.md`. Les trois
  **machines** (tracteur, bateau de pêche, pompe à vapeur) ont la même infobulle,
  décrite par une entrée de `MACHINE_TIPS` (noms, libellés, ce qu'on lit dans
  les statistiques, couleur de la barre) :
  titre ; une phrase (la machine augmente la surface que travaille chaque
  fermier, pêcheur ou mineur, donc moins de travailleurs pour la même surface ;
  les bateaux augmentent aussi le rendement d'une case d'eau) ; la surface par
  travailleur sans machine et à pleine mécanisation (`economy.mechanization[bien]`,
  avec le rapport tiré de `machinesPer1000[bien]`) ; pour les bateaux, le
  rendement d'une case d'eau sans bateau et au maximum (`economy.waterYield`) ;
  « Votre nation · travailleurs · machines utilisées / machines d'une
  mécanisation totale », une jauge verte précédée de l'engrenage
  (`miscellaneous/misc-gear-stolen.png`, 16 px, `.ib-img`) et de
  « Mécanisation », la mécanisation du dernier tour
  (`stats.mechanization[bien]`, copié de `Player.farmMechanization`,
  `fishMechanization`, `mineMechanization`), de la valeur sans machine (vide) à
  la valeur maximale (pleine), la valeur écrite au bout ; jauge et barre sont dans
  une grille libellé | barre | valeur (`.tip-bars`), bords gauches alignés, la
  jauge prenant aussi la colonne de valeur ; puis une barre de la
  couleur du métier dans le détail Population : « Surface cultivée » cultivées /
  cultivables (`--occ-farm`), « Surface pêchée » pêchées / cases d'eau
  (`--occ-fish`), « Cases exploitées » cases de fer exploitées / cases de fer
  (`--occ-mine`, `stats.ironTiles`). La jauge montre un effet commun à tous les
  travailleurs (00-Game §6.2 : une seule mécanisation pour tous), pas une part
  de travailleurs équipés. `stats.machinesUsed` est lu par `SoloGame` dans
  `goodsEffective` **avant** `applyTurn` : ce sont les machines que l'étape a utilisées
  (la valeur effective, 00-Game §12), celles qui donnent la jauge, pas celles
  produites pendant le tour (`goods`, que les lignes de machines du détail Ressources affichent).
  1. **Population** : « Population n  ±v  / max ». `v` est la croissance du
     tour (population − somme des occupations, qui est la population au début du
     tour : une fondation de ville, qui retire des habitants avant l'étape, n'y
     compte pas), verte si positive, rouge si négative. `max` = nourriture ÷
     `foodPerHead`. Détail : une barre empilée de la population par occupation
     (ouvriers d'usine, mineurs, fermiers, pêcheurs, inactifs), puis une ligne par
     occupation : couleur, nom, rectangle proportionnel, « n · x % ». Les parts
     sont rapportées à la somme des occupations. Sur les lignes fermiers et
     pêcheurs, une zone hachurée de la couleur du métier suit le remplissage :
     les personnes qui manquent pour travailler toute la surface avec la
     mécanisation actuelle, `⌈cases × 1000 ÷ M⌉ − travailleurs` (le requis de
     `harvest`). Remplissage et hachuré ont la même échelle : si la moitié des
     cases est travaillée, les deux ont la même largeur. L'échelle des barres
     est la population, élargie (pour toutes les lignes) quand un hachuré la
     dépasserait.
  2. **Nourriture** : « Nourriture f /tour  s », `s` = nourriture − population ×
     `foodPerHead`, coloré. Détail : une jauge Population en trois sections,
     « actuelle / max / tout exploité » : population (vert), `food /
     foodPerHead` (vert hachuré), `foodPotential / foodPerHead` (gris plein très clair),
     à l'échelle du plus grand des trois. `foodPotential` est calculé par
     `SoloGame` : `max(FOOD.minimum, fertilitySum + floor(seaTiles ×
     waterYieldMilli(pêcheurs, bateaux) / 1000))`. Puis Agriculture (blé ·
     cultivé / cases cultivables, barre couleur blé) et Pêche (poisson · pêché /
     cases d'eau, barre bleue), à une échelle commune, la plus grande production
     atteinte ou possible. Sous le remplissage, des hachures de la même couleur
     montrent la production maximale (toute la surface travaillée) :
     `stats.wheatMax` = `fertilitySum`, `stats.fishMax` = `floor(seaTiles ×
     waterYieldMilli(pêcheurs, bateaux) / 1000)`, calculés par `SoloGame`. Le
     texte donne « produit / maximum · cases travaillées / cases » ;
     Importations et Exportations grisées
     (« à venir ») ; une ligne Consommation : minimum garanti et surplus.
     Icônes des libellés (`iconLabel`) : `pop-sailor` pour Importations et
     Exportations, en attendant une icône du commerce. Agriculture et Pêche
     n'ont plus l'icône du métier seule : elles portent le **rendement par
     travailleur**, « n [nourriture] / [métier] » (`yieldLabel`,
     `miscellaneous/misc-food-ham.png` puis `pop-farmer` ou `pop-fisherman`), pour
     comparer champs et mer selon les machines possédées. `n` = mécanisation du
     dernier tour (`stats.mechanization.tractor` ou `.fishingBoat`, millièmes de
     case par travailleur) × production maximale ÷ cases (`wheatMax / farmTiles`,
     `fishMax / seaTiles`), deux décimales au plus, 0 sans case : c'est ce que
     rapporte un travailleur de plus tant que la surface n'est pas toute
     travaillée. Aucun nouveau champ du moteur ni du message. L'infobulle
     (réécrite à chaque tour) nomme les deux facteurs et leurs valeurs :
     mécanisation (cases par travailleur, selon les tracteurs ou les bateaux
     possédés) et fertilité moyenne d'une case (rendement moyen d'une case d'eau
     pour la pêche). Le texte contient des retours à la ligne : `#tip:not(.rich)`
     est en `white-space: pre-line`.
     Entre Pêche et Importations, le **curseur de la part de fermiers** (il était
     dans le panneau latéral) : « Agriculture versus pêche », curseur de 0 à 100, valeur
     en % de fermiers ; la piste est jaune (`--occ-farm`) à gauche du curseur et
     bleue (`--occ-fish`) à droite, coupée au curseur par la variable CSS `--p`
     que `infobar.ts` met à jour ; puis la note du report (00-Game §4 : le réglage ne compte que si la
     population manque). L'ordre `set_farm_share` part au relâchement (`change`)
     par le rappel `onFarmShare` du constructeur de `InfoBar` ; le curseur n'est
     pas réécrit par les tours tant qu'il est tenu (`farmSliderActive`, remis à
     faux aussi sur `pointerup`, `pointercancel` et `blur` : un clic sans
     déplacement n'envoie pas `change`). Il est mis à jour à l'ouverture du
     détail et à chaque tour tant qu'il est ouvert.
  3. **Ressources (flux)** : rien dans la barre que le titre. Détail, barres vertes :
     *Fer* : barre pleine (orange clair) = capacité (`ironCapacity`), orange = fer extrait au
     dernier tour, trait noir épais = fer requis (`ironRequired`, compté sur
     les lignes en service, `min(active, usefulLines)`, pas sur toutes les
     lignes actives : une ligne arrêtée parce que la demande est atteinte ne
     demande pas de fer) ; si l'extrait est sous le requis, l'écart est rouge,
     ce qui veut dire population ou capacité de fer insuffisante. *Aluminium* :
     ligne grisée « à venir » (aucune règle ne l'extrait). Les deux lignes
     ont leur icône (`goods/goods-iron-ingot.png`, `goods/goods-aluminium-ingot.png`).
     *Tracteurs*, *bateaux de pêche*,
     *pompes à vapeur* : vert = machines disponibles (`goods`, produites au tour
     précédent), barre pleine = machines d'une mécanisation totale,
     `stats.fullMachines`, recopié de `Player.goodsDemand` du moteur (la
     demande qui arrête aussi la croissance automatique des lignes, 00-Game
     §8.2). 0 : barre vide, et « n produits · inutilisés » s'il y en a. Une
     ligne de légende.
  4. **Armement (stock)** : rien dans la barre que le titre. Détail : une ligne par
     type d'armement qui a des lignes, un stock ou de l'équipement sur les fronts, barre de gauche à droite :
     **jaune foncé** = l'équipement des unités des fronts, déployé et en route (`PlayerStats.divisionEquipment`),
     **bleu** = stock, **hachures rouges** = au-delà du stock cible ; trait fin = stock cible (`reserveMax`),
     échelle = max(1,5 × cible, stock + fronts) pour que cette zone se voie ;
     texte « stock / cible · +production par tour · n sur les fronts ». Légende : l'excès disparaît à
     `armamentDecayPercent` % par tour ; l'équipement des fronts compte dans le stock, mais seul
     l'équipement non déployé décline (05-Fronts §4.6).
  5. **Fronts** (cinquième position, juste à droite d'Armement ; 05-Fronts §11.2) : « Fronts n / m » (actifs / tous ceux du
     joueur). Détail : deux sections, **fronts actifs** puis **fronts en paix**, une ligne par front rangée par île
     (groupe du joueur) puis par adversaire : pastille de l'adversaire, « Île n° g · Bot k », et en petit l'île adverse et le
     nombre de connexions. Un clic sur une ligne ouvre la fenêtre du front (`openFront`, `main.ts`).
  6. **Forces** (sixième position ; 05-Fronts §11.2, `forcestab.ts`) : « Forces n » (nombre de divisions du joueur). Détail : l'onglet des forces
     (§ « Onglet des forces » ci-dessous). Le volet (`.ib-pane.forces`) a la classe `themed` : fond et couleurs de son thème.
  L'onglet **Population** a une ligne **Soldats** (icône `pop-soldier`) avant les inactifs, qui sont en dernier, même en mobilisation forcée, et un
  interrupteur standard rouge « **MOBILISATION FORCÉE** » (texte rouge, gras, majuscules, éteint au départ) qui envoie
  `set_forced_mobilization` ; l'interrupteur n'est pas réécrit par les tours pendant 600 ms après un clic. La croissance
  affichée tient compte des soldats.
  **Blessés** (00-Game §4.2) : dernière ligne de l'onglet (icône `pop-hurt`, noir `--occ-hurt`), après les inactifs, avec
  son segment noir à la fin de la barre ; son nombre n'a pas de part (les parts des autres lignes sont calculées sans lui).
  Le total de population (bouton de la barre, panneau latéral `s-pop`, tableau des joueurs) est `population − hurt`, et la
  croissance affichée est celle de ce total. Le panneau latéral a une ligne « Blessés » (`s-hurt`). La jauge « Population »
  de l'onglet Nourriture (et sa mini-barre) a un segment noir tout à gauche, de 0 à `hurt`, puis le vert jusqu'à
  `population` ; son texte est « population sans blessés + blessés / nourrie / potentielle ». Le maximum nourri compte
  les places des blessés. Les bots (`bots.ts`) et `foundingProblem` (`main.ts`) testent `population − hurt`
  contre le coût d'une ville.

  Calculé côté page à partir des messages : la croissance du tour, le maximum de
  population, le surplus, les parts par occupation, les machines d'une
  mécanisation totale, l'échelle et la zone hachurée de l'armement, la production
  d'armement par tour (lignes remplies × `productionPerLine` du catalogue). Lu tel
  quel du moteur : tout le reste. Seul `ironRequired` est ajouté au message par
  `SoloGame.humanDetail` (la page n'a pas le fer par ligne).
- **Fenêtre d'un front** (`frontwindow.ts`, 05-Fronts §11.4), posée sur la carte (`#front-panel`, dans `#stage`), qu'elle recouvre presque en entier (10 px de marge, `.fw` à 100 % de largeur et de hauteur ; les boîtes ont de l'espace inutilisé), ouverte par la liste
  des fronts, par un clic dans une zone de front, affichée ou non (`MapView.frontAt`, qui passe avant le menu de diplomatie ; hors zone,
  un clic sur le territoire d'un autre joueur ouvre toujours la diplomatie), ou par une section de l'onglet des forces (avec le bouton
  « ← Retour », qui rouvre l'onglet). N'importe quel front s'ouvre ; seuls ceux dont le joueur est un camp ont des réglages. Bandeau en
  deux moitiés autour de la barre verticale : titre, interrupteur « Sélection avancée » (éteint à chaque ouverture) et boutons
  « Attaque sur tout le front » (interrupteur, `start_front_attack` / `stop_front_attack`, grisé en paix, contour rouge qui clignote quand
  l'attaque est en cours) et « Barrage d'artillerie » (grisé, sans effet) à gauche ; « ← Retour » et ✕ à droite. Corps : côté du joueur,
  les forces de percée (170 px : liste défilante des boîtes dont le dernier élément est la boîte « + » `data-drop="box:front:0"` (`drawBoxes`
  fait `replaceChildren(...boîtes, plus)`), puis la zone « Retour à la réserve
  nationale », visible pendant un glisser seulement) et la réaction rapide (170 px, rangées par niche, `data-drop="line:front:rapid"`),
  puis la capsule seconde ligne / première ligne ; côté adverse, la capsule première ligne (même largeur que celle du joueur, fixée en px à
  chaque dessin) / seconde ligne comprimée (76 px), puis la réaction rapide comprimée (76 px, comme la seconde ligne) et les boîtes de percée comprimées (76 px).
  **Boîtes de percée du joueur** (`BoxUi`, créées une fois par boîte de `FrontView.boxes`, dans l'ordre de création de leur
  camp) : bouton « Lancer » et « Motorisée » / « Au pas » (`MotorUi`, `setMotor` : toutes les divisions de la boîte motorisées, hors divisions en
  déplacement ou en fuite ; « Lancer » grisé sans infanterie, avec un `title` « Vous avez besoin d'infanterie pour la percée. ») avec l'icône de 16 × 16 px `icon-motorized.png` (camion) ou `icon-on-foot.png` (pieds), et un panneau (dont le titre porte la même icône) de survol (`textPanel`, `attachTextPanel` de
  `infopanels.ts` ; textes dans `MOTOR_TIPS`) ; bouton « Lancer » (actif si le front est actif et que la boîte a des divisions ; `onLaunch` → mode choix d'axe), pions au repos
  (`renderZone` avec `multiline`, sans sélection : `.pz-open` masqué ; en mode « trop de pions », les types passent à la ligne suivante et
  `.fw-bzone` grandit, `min-height: 50px`) ; **au survol**, la vue étendue de 700 px (`.fw-bpop`, posée dans la colonne et pas dans la liste
  qui défile, qui la couperait) : les premières lignes face à face sans les secondes — à gauche la boîte (cinq rangées par niche, couverture
  d'une liaison = somme des `breakthroughWidth`, pions sélectionnables, zone `bx<id>`), à droite la première ligne adverse (couverture du front,
  pions avec leur panneau de survol) ; elle reste mesurable (`visibility`, pas `display`) et disparaît pendant un glisser. Une boîte contient les
  divisions de `line` « box » et `box` égale, sans `breakthrough` : la force qui perce est dans la percée en cours. Dépose sur une boîte :
  `move_division { ids, front, line: "box", box }`. **Boîtes** : le bouton « Lancer » est à gauche et la motorisation à droite (la vue étendue a un en-tête de 156 px calé sur celui de la boîte : le bouton ne bouge pas à l'ouverture) ; une boîte neuve est insérée dans la liste **avant** le dessin de ses pions (`renderCompact` lit `clientWidth`, nul pour un élément détaché : elle resterait vide jusqu'au tour suivant). **Flèches de l'attaque sur tout le front** : deux colonnes `.fw-gut` (`gutter()`), contre la barre, avec une flèche `.fw-arrow` par rangée de première ligne, allumée (`on`) selon `FrontSideView.frontAttack` de chaque camp. Interrupteur « Sélection avancée » : `.fw-switch` (piste et pastille, CSS seul). **Percées en cours** (`.fw-bts`, sous le bandeau, masqué sans percée) : un petit tableau par percée de `FrontView.breakthroughs`, des deux camps :
  « Percée n » (ou « Percée de X »), croix sur les nôtres (`cancel_breakthrough`), une rangée par niche engagée avec le nombre de divisions et
  l'état moyen de ce qui perce (`DivisionView.breakthrough` = id, `owner` de la percée) et de la défense, un texte par phase (`PHASE_TEXT`, sept phases : cinq délais décomptés en secondes à
  chaque tour depuis `BreakthroughView.until`, deux combats), « Avancée de x% sur ce front » (`BreakthroughView.advance` en millièmes de route, divisé
  par 10), et une flèche rouge clignotante à droite du titre pendant les combats ; les cartes sont créées une fois par percée, seul le tableau est refait. **Boîtes adverses** : une boîte comprimée par boîte (`countTag`), les boîtes qui ne tiennent pas en
  hauteur remplacées par la boîte « ··· » ; au survol de la colonne, le cadre de 330 px vers la gauche (`.fw-cpop`) avec toutes les boîtes. Cinq rangées par niche (`MilitaryCatalog.niches`), fond et lettres
  de niche par thème (variables CSS `--n-bg`, `--n-ink`, `--n-ink2` posées par la classe `n-<niche>`) ; en première ligne, le pourcentage de
  couverture (somme des `engaged` de la niche / (connexions × 1 000)) ; la zone des pions d'une première ligne a une marge droite de 96 px
  (`--fw-text-w`, `.fw-row.cov .fw-zone`) : `renderZone` reçoit sa `clientWidth`, donc les piles se forment plus tôt et ne passent pas sous le texte. Seconde ligne adverse : par niche `countTag` (icône du premier type,
  nombre total) ; au survol, un rectangle de 240 px qui s'élargit vers la gauche et vers le bas, une ligne par type, cinq pions par ligne.
  Le DOM est construit une fois ; `draw` ne remplace que le contenu des rangées (`renderZone`) et des textes, donc un bouton survit entre
  `pointerdown` et `click` ; il n'est refait que si `fronts` ou `divisions` (objets du `Mirror`) ont changé ou si la fenêtre change de taille
  (`ResizeObserver`). Dépose : sur une ligne du joueur ou la réaction rapide, `move_division { ids, front, line }` ; sur la zone de retour, `move_division` vers la
  réserve ; les divisions déjà à leur destination sont filtrées.
- **Onglet des forces** (`forcestab.ts`, 05-Fronts §11.2), le détail de la cinquième section de la barre d'informations. Barre du haut : le « + »
  (moitié gauche) et la corbeille (moitié droite, `data-drop="trash"`, visible pendant un glisser seulement). Le « + » porte le texte « RECRUTEMENT » (`.fx-plus-lab`, bleu `--t-blue` ; fond du bouton `--t-recruit-bg`, bleu clair). Réserve nationale en deux sections (`resSection`) :
  « FORMATION » (divisions `status === "formation"`, zone `"form"`) au-dessus de « RÉSERVE » (toutes les autres divisions de la réserve, zone `"res"`, seule
  section avec `data-drop="reserve"`) ; le libellé est un `.fx-mlab` (même style que les lettres du menu « + »), premier enfant de la section donc
  sous la zone des pions, couleur `--t-res-ink`. Dans chaque section, de vrais
  pions, un groupe par type (`renderZone` avec `wrap`, via `Dnd.zone(clé, true, true)`, redessinée si ses divisions ou sa largeur changent) :
  toujours déployée, jamais en mode « trop de pions » ; sans place sur une ligne, les piles passent sur plusieurs lignes (blocs par niche, une
  niche sur une ligne si possible ; un type trop long est tronqué avec un « + » en `.pz-num`, `layout.groups` garde tous ses ids) et la hauteur de la
  section (`ZoneLayout.height`) suit, ce qui repousse les fronts vers le bas. Sections de front : fronts en guerre active puis
  en paix, du plus long au plus court (`sortedFronts`), fond de la couleur de l'adversaire (`playerColor`), carré de 32 × 32 px de statut
  diplomatique (rouge guerre, bleu paix ; provisoire), à droite la largeur du front (`connections.length`, `.fx-width` : icône
  `icon-front-width.png` (`frontWidthIcon` de `infopanels.ts`, 16 px), puis le nombre), et par niche non vide `countTag` (icône du type le plus nombreux, nombre total) ; un clic
  ouvre la fenêtre du front ; `title` : « Front en guerre|paix contre *nom de l'adversaire* : cliquez pour l'ouvrir. » ; **surbrillance liée à la carte** :
  `pointerenter` / `pointerleave` d'une section appellent `MapView.highlightFront(id)` (zone dessinée comme au survol de la carte, `listFront`
  prime sur `hoverFront`), et `MapViewHooks.onHoverFront` (changement de front sous la souris) appelle `ForcesTab.setHighlight(id)`, qui met la
  classe `hl` sur la section ; le repli du volet retire la surbrillance de la carte ; `data-drop="front:id"` : une dépose envoie `move_division { ids, front }` (seconde ligne). **Glisser vers la fenêtre d'un front ouverte en même temps** :
  `Dnd` trouve la cible par `document.elementsFromPoint`, donc les `data-drop` `line:…` et `box:…` de la fenêtre sont atteints ; `ForcesTab.drop` les
  transmet à `FrontWindow.drop` (interface `DropWindow`, passée au constructeur), et `ForcesTab.dragging` appelle `FrontWindow.externalDrag` (classes `dragging ext` :
  les zones de dépose s'affichent, pas la zone de retour). Les sections sont
  reconstruites seulement si leur contenu change. La sélection y est simple (l'interrupteur « Sélection avancée » est dans la fenêtre d'un front).
  **Menu « + »** : sous le bouton, une ligne par niche (fond de la niche, lettres à droite), les types côte à côte, du moins prioritaire au plus prioritaire
  (`NICHES[].types` parcouru à l'envers ; icône de 32 px et
  « actuel / supportable », `supportable` de `divisions.ts` : pour chaque composant requis, (divisions + stock) / quantité, le plus petit ;
  hommes : soldats + inactifs ; « actuel » en rouge s'il dépasse) ; type que l'on ne peut pas créer (`creatable`, copie de la condition du
  moteur : inactifs et stock remplissent tous les composants ; et `eliteAllowed` de `divisions.ts`, copie de la limite des élites) à 50 % de transparence, clic sans effet ; un clic crée une division
  (`create_division`) et le menu reste ouvert ; clic en dehors, Échap ou repli du volet le ferme ; survol d'un type : panneau de type.
- **Sélection et glisser-déposer** (`dnd.ts`, 05-Fronts §11.4) : une `ZoneView` regroupe les rangées d'une zone (une ligne d'un front, la
  réserve nationale) ; chaque rangée est un conteneur passé à `renderZone`, qui renvoie `groups` (ids par type, dans l'ordre de la pile) ; le pion
  sous la souris est lu dans l'événement (`.pz-pawn[data-id]`, le navigateur connaît l'ordre d'empilement des piles). Un redessin
  (`renderAll`, à chaque changement d'aperçu et à chaque tour) remplace le DOM de la rangée : le rectangle élargi du mode « trop de pions »
  (`.pz-open`, ouvert par `:hover`) serait refermé si la souris était hors du rectangle de base ; `renderZone` donne donc la classe `pz-keep` au
  nouveau `.pz-root` quand l'ancien était survolé ou `pz-keep`, et `pointerleave` du conteneur la retire. Mode simple : le survol
  donne l'aperçu (du début du groupe jusqu'au pion), le clic prend la sélection et lance le glisser. Mode avancé : premier clic = `anchor`
  (rectangle sur la division), la souris dessine l'aperçu jusqu'au pion survolé dans la même zone (`range` : ordre de lecture des rangées de
  la zone), second clic = sélection figée ; un clic sur un pion sélectionné lance le glisser. Seules les divisions `ready` ou `fleeing` sont
  prises (`movable`). Glisser : pion fantôme (`.dnd-ghost`, `renderZone` des divisions prises), cible = l'élément le plus proche portant
  `data-drop` sous le pointeur (`dnd-over` : contour clair, choix de la page), `DndHost.drop` envoie les ordres ; Échap abandonne. Un glisser
  sans mouvement (moins de 4 px) ne dépose rien.
- **Panneaux de survol** (`infopanels.ts`, 05-Fronts §11.7) : posés sur `document.body` (position fixe), un seul à la fois. Panneau d'un type :
  nom en gras et niche en gris, description, composants (icône 32 × 32 : `icon32Path`, nom, quantité), statistiques non nulles (attaques, PV,
  blindage, largeur de front, largeur de front en percée, multiplicateurs d'attaque et de PV en défense s'ils diffèrent de × 1, déplacement),
  carrés provisoires, sauf les deux largeurs de front (icône `icon-front-width.png`, `frontWidthIcon`) et le déplacement (icône camion / pieds, `motorIcon`). Ces statistiques sont écrites par `typeStats`, commune aux deux panneaux.
  Panneau d'un pion : icône du type (32 × 32), rang (icône 8 × 10 agrandie ×2), nom, niche, description,
  composants « présents / requis », état (« 92 % »), attaques actuelles / maximales (`currentAttacks`, `maxAttacks` : stat × taux, sans
  multiplicateur), puis `typeStats`. Il apparaît 120 ms après le survol, 14 px au-dessus du pion (au-dessous s'il n'y a pas la place), disparaît dès qu'un
  glisser ou le premier clic de la sélection avancée commence. Pions de l'adversaire : même panneau (`attachPawnPanels`).
- **Thèmes** (`theme.ts`, `forces.css`, 05-Fronts §11.8) : `html[data-theme="dark" | "light"]`, clair au départ ; le
  bouton « + » est le même dans les deux thèmes (`--t-plus-filter: none`) ; les variables `--t-*` sont
  posées sur la classe `themed` (fenêtre, volet des forces) et sur `.ip` (panneaux de survol), le reste de la page garde sa palette claire.
- **Notifications des prises de villes** : « Vous avez pris la ville n° k à Bot j. » / « Bot j vous a pris la ville n° k. »
  (`captured`). **Encerclements** (`encircled`, événement `encirclement` du moteur) : une carte du même module
  (`notifications.ts`) pour le joueur qui encercle ou qui est encerclé, avec le nombre d'unités perdues.
- **Élimination** (`eliminated`, 05-Fronts §10.3 et §11.6) : une carte pour chaque joueur autre que l'éliminé (60 s),
  qui annonce le mode résistance « pas encore implémenté » ; pour l'éliminé, la fenêtre `#defeat` au centre de la carte
  (« Continuer en spectateur » ou « Quitter la partie »). `setSpectator` (`main.ts`), appelée à chaque tour d'après
  `players[you].defeated`, affiche le bandeau `#spectator-badge`, désactive « Créer une ville » et « Inaugurer une usine »,
  désarme les outils et supprime le menu de diplomatie au clic ; le tableau des joueurs ajoute « (éliminé) ». Les bots
  éliminés ne jouent plus (`bots.ts`).
- **Menu de diplomatie** (`diplomacy.ts`, 00-Game §1). Quand aucun outil n'est armé
  (ni « Créer une ville » ni « Inaugurer une usine »), un clic sans glisser sur une
  case dont `Mirror.ownerOf` est un autre joueur ouvre un petit menu à côté de la
  souris (`#dip-menu`, position `fixed`, coin haut gauche à 8 px de la souris, ramené
  dans la fenêtre). Une case d'eau de la zone d'une ville compte comme territoire de
  son joueur. En-tête : pastille de couleur, nom, badge du statut (Neutre / Pacte de
  non-agression / Guerre). Puis seulement les actions possibles, d'après
  `DiplomacyView.status` : neutre, « Déclarer la guerre » (rouge) et « Proposer un
  pacte » ; pacte, « Rompre le pacte » (rouge) ; guerre, « Proposer la paix ». Si une
  proposition est en attente pour ce joueur, la ligne de proposition est grisée avec
  « En attente de réponse » (envoyée par le joueur 1) ou « Proposition reçue ».
  Un clic sur une action envoie l'ordre et ferme le menu. Le menu se ferme au clic
  ailleurs (la carte, un bouton, le panneau), sur son propre territoire ou une case sans
  propriétaire, à la molette et à Échap. Un clic sur le territoire d'un autre joueur
  alors que le menu est ouvert le déplace. Le menu est reconstruit à chaque tour
  **seulement si** son contenu change (clé : joueur, statut, lignes) : le reconstruire
  toutes les 100 ms détruirait le bouton entre le `pointerdown` et le `click`. La
  position de la souris vient d'écouteurs `pointermove` / `pointerdown` du document :
  le crochet `onClick` de `MapView` ne donne que la case.
- **Notifications** (`notifications.ts`, `#notifs`, enfant de `#stage`). Pile en bas à
  gauche de la carte, la plus récente en bas. Le conteneur est à 12 px du bord ; quand
  la légende des ressources (`#map-legend`, même coin) est affichée, il passe à 76 px
  (CSS `#map-legend:not([hidden]) ~ #notifs`, hauteur de la légende estimée : deux
  lignes). Le coin n'est occupé par rien d'autre : la barre d'informations est en
  haut, la barre de boutons sous la carte, le panneau de production à droite. Le
  message court `#toast` est centré en bas et peut passer sous la pile sur une carte
  étroite. Chaque carte a un trait de la couleur du joueur à gauche. Toute carte a une
  petite croix qui la retire. Sans bouton, elle
  disparaît après 30 s (`DEFAULT_DURATION_MS`, valeur provisoire) ou au clic ; plus de 6
  cartes (`MAX_CARDS`, provisoire) : les plus anciennes sans bouton partent. Avec des
  boutons, elle reste jusqu'à `dismiss(clé)` ou jusqu'à son tour de fin, et une barre
  fine donne le temps restant, recalculé à chaque tour (`updateNotifications(tour)`,
  appelé par `main.ts` avant `diplomacy.update`). Après un clic sur un bouton, tous les
  boutons de la carte sont désactivés.
- **Notifications de diplomatie** (`diplomacy.ts`). Une carte à boutons « Accepter » /
  « Refuser » par proposition reçue (`proposals` avec `to` = joueur 1), créée dès que
  la proposition est dans la liste, retirée dès qu'elle n'y est plus (réponse,
  expiration ou guerre) : « Bot 2 vous propose un pacte de non-agression » / « … vous
  propose la paix ». Les boutons envoient `answer_proposal`. Cartes d'information, pour
  les événements du tour : « Bot 2 vous a déclaré la guerre » ; « Bot 2 a rompu le
  pacte » ; « Pacte de non-agression conclu avec Bot 2 » / « Paix conclue avec Bot 2 »
  (que la proposition vienne du joueur 1 ou de l'autre) ; « Bot 2 a refusé votre
  proposition de pacte » / « … de paix » ; « Votre proposition à Bot 2 a expiré ». Ce
  que le joueur 1 fait lui-même (guerre déclarée, pacte rompu, proposition envoyée,
  refus donné) n'a pas de carte. Les noms viennent de `playerName` (« Bot n ») : les
  joueurs n'ont pas encore de nom propre.
  **Provisoire, à valider** : une proposition par paire à la fois, les bots ne
  répondent pas, durée de vie des propositions à fixer (02-Engine §7, point 33).
- **Panneau latéral** : population, fermiers, pêcheurs, inactifs, nourriture,
  villes, cultivé / max, pêché / max du joueur (le curseur de la part de
  fermiers est dans le détail Nourriture de la barre d'informations) ; tableau de tous les
  joueurs (couleur, population, villes) ; case survolée (coordonnées, terrain et
  altitude, fertilité, fer, propriétaire, ville) ; bloc
  développement (durées mesurées, pause, quitter).
- Tout le texte est en français.

La section maritime de la barre (00-Game §1) n'existe pas. La diplomatie se limite au
menu et aux notifications ci-dessus : ni alliance, ni droit de passage, ni commerce
(00-Game §1).

### Écrans en ligne : accueil, salle d'attente, partie lancée

Code : `lobby.ts` (DOM), `online.ts` (sans DOM, testé). Maquette validée par
l'auteur (octobre 2026) : accueil, rejoindre, créer, salle de l'hôte, salle d'un
joueur ; structure, textes et couleurs sont repris, les polices Barlow viennent
de Google Fonts (`index.html`). La page ne contient aucune règle de jeu.

- **Accueil** (`#lb-home`) : la liste des parties (`GET /api/games`), chargée à
  l'ouverture de la page et au clic sur « Actualiser » seulement (quota,
  01-Architecture §4). Une ligne : nom et « Hôte : X », hébergement
  (Cloudflare / PC de l'hôte), carte et graine, joueurs, état, et une action :
  « Rejoindre » (partie en attente), « Pleine », « Reprendre » (partie lancée
  dont le navigateur a un jeton), « Commencée » (sinon). Au chargement, la page
  reprend d'elle-même la première partie « Reprendre » de la liste
  (`gameToResume`, 01-Architecture §4). À droite : « Créer une
  partie » (Cloudflare), « Héberger sur votre PC » (texte et lien vers le
  README, `server/` n'existe pas encore), « Solo — débogage ». Le solo cache
  `#lobby` et montre `#app`, l'écran de départ solo d'avant, inchangé, avec un
  bouton « Retour à l'accueil ».
- **Rejoindre** (`#lb-join`) : nom du joueur (1 à 24 caractères, gardé dans le
  navigateur). **Créer** (`#lb-create`) : nom de la partie (1 à 40), nom du
  joueur et mot de passe de création (01-Architecture §4, Requêtes) ;
  `POST /api/games/cloudflare`, puis connexion avec le jeton d'hôte reçu. Un
  refus s'affiche sous le formulaire, avec le texte du serveur (mot de passe
  faux, ou création fermée faute de `CREATE_PASSWORD` sur le Worker).
- **Connexion.** L'adresse du WebSocket vient de l'`address` de l'entrée du lobby
  (`wsUrl`, 01-Architecture §6, Client, point 2) : chemin relatif → `wss://` +
  hôte de la page (`ws://` si la page est en `http`), `https://…` → `wss://…`.
  Aucune adresse n'est écrite dans le code. À l'ouverture, la page envoie
  `join {name, token?}` ; le jeton est celui que le navigateur a gardé pour cette
  partie, s'il y en a un.
- **Ce que le navigateur garde** (`localStorage`, chaque lecture et écriture dans
  un `try/catch` : stockage bloqué ou navigation privée ne cassent rien) :
  `foi.playerName` (le nom), `foi.createPassword` (le mot de passe de création,
  gardé seulement après une création acceptée), `foi.tokens` (un jeton par
  identifiant de partie, les 20 plus récents). Le jeton arrive dans `welcome` (nouveau joueur) ; celui de
  l'hôte vient de la réponse de `POST /api/games/cloudflare`.
- **Salle d'attente** (`#lb-room`) : joueurs (couleur de `playerColor`, celle de
  la partie), compteur sur 100, carte. L'hôte voit la liste des cartes (une :
  « Carte de test (générée) »), le champ de la graine (envoyée à Entrée ou en
  quittant le champ), « Au hasard » (`set_map {seed: "random"}`), « Lancer la
  partie » ; un joueur voit la carte et la graine en lecture seule. L'aperçu de
  la carte est un emplacement vide. Le champ de la graine n'est pas écrasé par un
  message `room` pendant qu'il a le focus. « Quitter la salle » ferme le
  WebSocket.
- **Partie lancée** (`#lb-started`) : écran d'attente, visible le temps que le
  Web Worker crée la partie (et rejoue les tours déjà joués d'une reprise). Il
  affiche le message de départ reçu : carte, graine, joueur du destinataire,
  liste des joueurs. Au message de départ, la page ferme son WebSocket de salle
  et `main.ts` crée le Worker (`startOnline`), qui rouvre une connexion avec
  le même jeton ; le premier message `init` remplace `#lobby` par `#app` et le
  jeu. « Reprendre » à l'accueil (ou la reprise automatique au chargement)
  suit le même chemin. « Retour à l'accueil » abandonne le chargement.
- **Partie en ligne** (`#app`, même écran que le solo) : `main.ts` lit `you` et
  `playerNames` de `init` (`setRoster`) ; « Vous » désigne le joueur de la page,
  les autres joueurs ont le nom du message de départ (tableau des joueurs,
  diplomatie, notifications, panneau d'un front). La barre de debug est cachée ;
  le bouton de pause n'existe que pour l'hôte (joueur 1). Les noms viennent
  d'autres joueurs : `textContent`, jamais `innerHTML`. **Désynchronisation**
  (`ended desync`) : la page termine le Worker, abandonne sa copie de la
  partie et revient à l'accueil avec un message ; elle ne se reconnecte pas
  d'elle-même (la reprise automatique ne se fait qu'au chargement de la page,
  donc pas de boucle) et le joueur peut rejouer la partie depuis le début par
  « Reprendre ». **Connexion perdue** (`ended lost`) : la partie reste
  affichée avec « Connexion perdue. Rechargez la page pour reprendre la
  partie. » ; provisoire, le client ne se reconnecte pas seul.
- **Erreurs.** Un refus à l'arrivée (partie pleine, déjà lancée, nom invalide)
  ramène à l'écran d'où l'on vient avec le texte envoyé par le relais (`message`
  de `error`, 01-Architecture §4) ; un refus HTTP du Worker affiche son
  `message` (`httpErrorText`), et un serveur sans réponse « Serveur
  injoignable ». Une erreur
  pendant la salle (graine invalide, lancement refusé) s'affiche dans un bandeau.
  Une connexion perdue affiche « Connexion perdue » et « Se reconnecter » (même
  nom, jeton gardé) ; `replaced` (même jeton dans un autre onglet) n'offre pas de
  reconnexion. Une reprise dont le serveur répond `welcome` au lieu de `start`
  (la partie n'existe plus, par exemple après un déploiement) oublie le jeton.

## 8. Le Web Worker : la partie et deux sources de tours

Les trois façons de jouer (solo, hébergé par un joueur, hébergé par Cloudflare :
01-Architecture §1) passent par le même Web Worker, découpé ainsi :

- **la partie** (`game.ts`, `Game`) : applique un tour au moteur et fabrique le
  message `tick` de la page. Elle ne dépend pas du mode : elle connaît
  seulement le joueur local (`you`) ;
- **une source de tours**, choisie au lancement par `engine.worker.ts` :
  - locale (`solo.ts`) : la minuterie d'`engine.worker.ts`, les bots, et
    `packages/relay`, qui reçoit les ordres de l'humain (joueur 1) et des bots
    (leur identifiant) et crée le tour ;
  - WebSocket (`online-game.ts`) : envoie les ordres au relais, applique les
    tours reçus, envoie un hash tous les N tours (01-Architecture §3). Le
    transport (`Connect`) est fourni par le Worker, qui ouvre le vrai
    WebSocket ; un test le remplace par un relais en mémoire.

La page ne sait pas quelle source est utilisée, sauf pour l'écran de lobby, la
barre de debug (solo seulement, §3) et le bouton de pause (§3).

Comportement de `OnlineGame` :

- au message de départ, crée la partie et envoie `init` ; ensuite chaque `turn`
  est appliqué (un tour déjà appliqué est ignoré, un tour manquant arrête la
  partie : `ended error`) et le hash de l'état est envoyé après chaque tour
  multiple de N, calculé juste après l'avoir appliqué ;
- `turns` (reprise) : voir §4, Rejeu d'une reprise ;
- `desync`, une erreur du relais avant le message de départ, une salle qui
  répond `welcome` ou `room` (partie perdue, 01-Architecture §6), `replaced` :
  fin avec `ended` ; toute autre erreur du relais est un `notice` ;
- `order(id, ordre)` envoie `{type: "order", order}` sans champ `player` ; les
  identifiants sont rendus dans `results` dans l'ordre d'envoi.

## 8 bis. Pas fait

- Reconnexion automatique en cours de partie (le client demande de recharger
  la page).
- Hash de l'état envoyé au serveur (01-Architecture §3) : sans objet en solo, fait en ligne.
- Routes maritimes : pas de règle, donc pas d'ordre ni d'interface.
- Bots et usines : les bots ne construisent pas d'usine (rien ne les y oblige ; une
  usine retire des travailleurs aux champs). Seul l'humain en a.
- Icônes : un sous-dossier de `public/icons/` par famille : `population/`,
  `goods/` (machines), `armament/` (vide) et `miscellaneous/` (divers :
  `misc-gear-stolen.png`, l'engrenage de la jauge de mécanisation des
  infobulles de machines, chemin écrit dans `goodtips.ts`). Le nom du fichier d'un bien ou d'un type
  d'armement est le champ `icon` de sa section dans `config/goods.ts` ou
  `config/armament.ts` (chemin relatif à `public/icons/`, facultatif) ; le moteur
  ne s'en sert pas. `solo.ts` le met dans `FactoryCatalog.icons`, `main.ts` le
  donne à `icons.ts` (`setProductIcons`) avant la construction des panneaux, et
  `productIcon(id)` renvoie l'image, ou le texte entre crochets de `names.ts`
  quand le bien n'a pas d'icône. Les types d'usine, le fer et les icônes de la
  population sont encore à part (texte provisoire ou chemin écrit dans le code).
  Les noms de ville (« Ville n° N ») sont leur identifiant.
- Build pour Cloudflare : fait (01-Architecture §6, Client, point 4).
- Aperçu de la carte dans la salle d'attente : un emplacement vide.
- Couleurs de joueur, textures et tailles : provisoires, choisies à la main.
- Rendu mobile / tactile : la mise en page s'adapte, mais le zoom au pincement
  n'existe pas.

## 9. Pièges

- **Reconstruire le menu de diplomatie à chaque tour** : un bouton remplacé entre le
  `pointerdown` et le `pointerup` ne reçoit pas le `click`. `Diplomacy.renderMenu`
  compare une clé et ne reconstruit que si le contenu change.
- **Attendre de `wasApplied` qu'il lise l'état pour un ordre de diplomatie** : une
  guerre déjà déclarée ou une proposition déjà présente donnerait « appliqué »
  alors que l'ordre a été ignoré. Il lit les événements du tour, qui n'existent que
  si l'ordre a eu un effet (02-Engine §4).
- **Compter le fer requis sur toutes les lignes actives** : depuis que la
  production d'un bien s'arrête à sa demande (00-Game §8.2), des lignes actives
  ne tournent pas volontairement. Comptées dans le requis, elles faisaient
  apparaître du rouge (« manque ») dans la barre du fer alors que rien ne
  manquait. `ironRequired` compte les lignes en service. Corrigé le 24 octobre
  2026.

- **Un curseur du panneau de production cliqué sans être déplacé** : le
  navigateur n'envoie pas `change`. Si seul `change` remet `sliderActive` à faux,
  le panneau croit un réglage en cours et ne se reconstruit plus jamais (nouvelle
  usine absente, curseur bloqué à son ancien maximum). `production.ts` le remet
  aussi à faux sur `pointerup`, `pointercancel` et `blur`. Corrigé le 24 octobre
  2026.
- **Reconstruire la fenêtre d'un front ou l'onglet des forces à chaque message** : un bouton remplacé entre le `pointerdown` et le `click`
  perd le clic ; `FrontWindow` ne remplace que le contenu des rangées et des textes, et seulement si `fronts` ou `divisions` ont changé ;
  `ForcesTab` compare une clé (identifiants, états, largeur).
- **`renderZone` remplace le contenu de son conteneur** (`innerHTML`) : les écouteurs sont sur le conteneur, jamais sur un pion, et le panneau
  de survol retrouve le pion par `ZoneView.pawnEl` (l'élément lu au survol a pu être remplacé par un changement d'aperçu).
- **Rendre une rangée dans un volet fermé** : `clientWidth` vaut 0. `ZoneView.render` saute alors la rangée ; le volet rend à l'ouverture
  (`toggle` appelle `body` après l'avoir affiché) et la clé de la réserve contient la largeur.
- **Mettre les panneaux de survol dans un conteneur à défilement** : ils seraient coupés ; ils sont sur `document.body`.
- **Peindre une ville prise comme une ville fondée** : `tileCity` ne change pas à une prise. `SoloGame` renvoie les cases de
  sa zone, `Mirror` retire la zone des histogrammes de l'ancien joueur avant de remplacer les villes, et la remet dans ceux du
  nouveau après ; sans cela, les rayons d'exploitation des deux joueurs seraient faux.
- **Fixer la largeur des colonnes d'un détail de la barre d'informations** (`.ib-pane`) : un texte plus long que la colonne (autre police,
  nombres à plus de chiffres) déborde et fait apparaître une barre de défilement horizontale. Le détail est une grille dont les colonnes
  étiquette et valeurs sont `max-content` ; les lignes (`.ib-row`) les partagent en `subgrid`, ce qui garde les barres alignées. Sa
  largeur est celle du contenu (minimum 640 px, 720 px pour les forces), plafonnée par `place()`, rappelé à chaque tour.
- **Compiler `frontgeom.ts` avec des dépendances du DOM** : le moteur le charge pour `viz:fronts`, sous Node.
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
- **Reconstruire le panneau de production à chaque tour** : un curseur ou un
  glisser en cours serait détruit toutes les 100 ms. `ProductionPanel.update`
  compare une clé de structure et ne reconstruit pas pendant une interaction.
- **Glisser-déposer sans filtre** : une ligne ne doit pas sortir de la section de
  sa ville, une ville ne doit pas être déposée sur une ligne. `production.ts`
  garde le type de glisser en cours et ignore les dépôts d'un autre type ; le
  moteur refuserait de toute façon une position hors bornes.
- **Compter le fer comme terre cultivable côté page** : la page lit `fertility` de `init`,
  donc le fer y est à 0. Le rayon de la mine et celui des champs ne comptent pas
  les mêmes cases (`Mirror.kindsOf`).
- **Relancer une partie sans remplacer le canvas** : les écouteurs de la
  partie précédente resteraient sur l'ancien. `main.ts` remplace le canvas à
  chaque partie.
- **Écrire un nom de joueur avec `innerHTML`** : les noms viennent d'autres joueurs.
  `lobby.ts` crée les éléments (`el`) et fixe `textContent`.
- **Deux onglets du même navigateur pour deux joueurs** : ils partagent
  `localStorage`, donc le même jeton pour une même partie. Le second onglet
  « remplace » le premier (`error replaced`). Pour tester à deux, un autre
  navigateur ou une fenêtre privée.
- **Importer `lobby.ts` ou `main.ts` depuis un test** : ils lisent `document` à
  l'import. Ce qui se teste sous Node est dans `online.ts` (sans DOM).
- **Un `tick` sauté sans le dernier en `full`** : pour un rejeu, la page n'a pas
  reçu les `tiles`, `cities`, `factoryMarks` ni `fronts` des tours sautés, qui ne
  sont envoyés que quand ils changent. `Game.applyTurn(…, { full: true })` les
  envoie tous ; toute donnée « seulement si changée » ajoutée à `tick` doit
  être forcée dans ce cas.
- **Lire `HUMAN` dans la page** : en ligne le joueur local n'est pas le joueur 1.
  La page lit `localPlayer()` (`names.ts`), posé par `setRoster` à l'`init`.
  `HUMAN` n'existe plus que pour le solo (`SoloGame`, tests).
- **Hacher l'état à un autre moment qu'après le tour multiple de N** : le relais
  compare des hashes de même tour ; un hash calculé après le tour suivant est
  déclaré divergent.
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
