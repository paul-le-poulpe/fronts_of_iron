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
| `index.html`, `src/style.css` | page : accueil et salles en ligne (`#lobby`), écran de départ du solo, barre d'informations, carte, barre de boutons, panneau de debug, panneau de production |
| `src/lobby.ts`, `src/lobby.css` | accueil (liste des parties, créer, rejoindre, solo), salle d'attente de l'hôte et d'un joueur (avec le choix de la couleur), écran d'attente « Partie lancée » ; connexion WebSocket au relais jusqu'au message de départ, puis `main.ts` prend la partie en charge (§7). Palette et polices de la maquette de l'auteur (Barlow), tout sous `#lobby` |
| `src/online.ts` | parties en ligne sans DOM : adresse du WebSocket (`wsUrl`), nom et jetons dans `localStorage`, textes des erreurs, lecture de la liste du lobby, action proposée par partie |
| `src/main.ts` | page : écran de départ, panneau, barre (villes, production), survol, messages ; crée le Worker (solo ou en ligne) |
| `src/tooltip.ts` | infobulles : encadré affiché 120 ms après le survol de tout élément qui a un `title` (le `title` est déplacé dans `data-tip`, le navigateur n'affiche plus le sien) ; curseur flèche sur ces éléments, pas le curseur de texte (`style.css`) ; `hideTip` |
| `src/tutorial.ts` | tutoriel (`07-Tutoriel.md`) : contour bleu sur les composants `data-tuto` dont la leçon n'est pas lue, premier clic consommé qui ouvre la leçon (`#tuto`), leçons lues dans `localStorage` ; `resetTutorial`, `skipTutorial` (menu « Tutoriel ») |
| `src/infobar.ts` | barre d'informations en haut de l'écran (00-Game §11) : ressources (flux), forces, diplomatie, menu « Carte » ; DOM construit une fois, pas de règle |
| `src/production.ts`, `src/production.css` | panneau de production (08-Population §11) : boîtes d'activités, pions, glisser-déposer des pions et réorganisation des boîtes, boîtes verrouillées et déblocage (DOM, pas de règle) ; styles et couleurs des boîtes (variables CSS, clair et sombre) |
| `src/names.ts` | noms français des machines, des activités (les boîtes du panneau) et des types de division, des niches (et leurs lettres) ; symboles provisoires (texte entre crochets) des machines sans icône ; joueurs de la partie (`setRoster`, `localPlayer`, `rosterName` : le pseudo, ou « Bot n » en solo ; `playerName` : « Vous » pour le joueur de la page, sinon `rosterName`) |
| `src/notifications.ts` | pile de notifications en bas à gauche de la carte (§7) : `notify`, `dismiss`, `updateNotifications`, `clearNotifications`. Ne connaît aucun système du jeu (DOM, pas de règle) |
| `src/diplomacy.ts` | diplomatie côté page (00-Game §1) : menu au clic sur le territoire d'un autre joueur, notifications des propositions et des changements de statut (§7). Pas de règle |
| `src/render.ts` | canvas de la carte : caméra, envoi du tampon de pixels, routes, villes, mode placement, noms des joueurs |
| `src/playerlabels.ts` | position des noms des joueurs sur la carte (sans DOM) |
| `src/painter.ts` | couleur de chaque case dans un tampon RGBA (sans DOM) |
| `src/playercolors.ts` | liste des couleurs des joueurs, variantes de carte et tons d'unité (09-Couleurs §2, §3 ; sans DOM) |
| `src/uniticons.ts` | icônes d'unités aux couleurs du joueur : lecture des PNG de `units-generated/`, remplacement, cache (09-Couleurs §4) |
| `src/roadpaths.ts` | tracé A* des routes sur les cases, en cache par paire de cases de villes (sans DOM) |
| `src/mirror.ts` | copie locale de ce que l'affichage lit de la partie, rayons d'exploitation (champs, pêche, mine), fronts et leurs zones (sans DOM) |
| `src/frontgeom.ts` | géométrie des fronts (05-Fronts §11.1, §11.4) : point du front d'une connexion, chaînes de connexions, zones de front ; flottants, sans DOM, aussi utilisée par `npm run viz:fronts` du moteur |
| `src/prediction.ts` | estimation d'un combat pour le panneau de prédiction (05-Fronts §11.4) : un round avec les formules du moteur, sans DOM ; `POSITION_RATIO` |
| `src/predictionpanel.ts` | panneau de prédiction au survol des boutons d'attaque de la fenêtre d'un front |
| `src/frontunits.ts` | répartition de la première ligne sur les connexions d'un front, pour la carte (05-Fronts §11.1) : `linkUnits`, sans DOM |
| `src/frontlayer.ts` | ce que la carte dessine des fronts : masques et contours des zones, points d'avancement avec le joueur de chaque côté ; recalculé quand `Mirror.frontsVersion` change |
| `src/format.ts` | écriture des nombres affichés (`num`, `compact`) : voir « Nombres » au §7 |
| `src/frontstats.ts` | statistiques de combat d'une première ligne (05-Fronts §11.4) : attaques anti-infanterie et anti-armure (formules de `attackOf`, multiplicateur d'attaque si le camp attaque sur tout le front) et PV (niches principales, × état), par niche et au total ; nombres courts (pas de DOM) |
| `src/frontwindow.ts` | fenêtre d'un front (05-Fronts §11.4) : bandeau (titre, « Sélection avancée », attaque, retour, fermeture), capsules des deux camps, rangées par niche, statistiques de combat et totaux des premières lignes, zones comprimées de l'adversaire, zone de retour, zone des avions (DOM construit une fois, pas de règle) |
| `src/burst.ts`, `src/burst.css` | envoi en rafale : `onPress(el, action)` envoie l'ordre à l'appui (`pointerdown`, pas au `click`, qu'un bouton reconstruit entre-temps ne reçoit jamais), 5 fois avec Maj, 10 fois avec Ctrl ; texte d'aide (« Shift + 5 », « Ctrl + 10 ») qui suit la souris sur tout élément marqué `data-burst` sans la classe `unavailable` ; un élément `data-burst-blocked` n'envoie rien et, après un appui, l'aide ajoute son texte en rouge. Utilisé par le menu « + » de l'onglet des forces (`create_division`) et par les flèches ±1 du panneau de production (`change_production_target`). `onFixedPress(el, count, action)` : même envoi à l'appui, `count` fixe, sans touche ni texte d'aide (flèches ±5). Le relais refuse au-delà de `MAX_ORDERS_PER_TURN` (20) ordres par tour et par joueur : l'excédent est perdu et la page affiche le message d'erreur |
| `src/diplomacytab.ts` | onglet Diplomatie : détail de la troisième section de la barre d'informations ; liste des joueurs, clic → menu de diplomatie, survol → joueur mis en évidence sur la carte |
| `src/forcestab.ts` | onglet des forces (05-Fronts §11.2) : détail de la deuxième section de la barre d'informations ; réserve nationale (formation, réserve), sections de front |
| `src/dnd.ts` | sélection et glisser-déposer des pions (§11.4), commun à la fenêtre d'un front et à l'onglet des forces : survol, un clic, deux clics, pion fantôme, dépose sur un élément `data-drop` |
| `src/divisions.ts` | ce que l'interface lit des divisions, sans DOM : état affiché, attaques actuelles et maximales (somme des composants × état), couverture d'un front, rangement des fronts |
| `src/infopanels.ts` | panneaux de survol (§11.7) : panneau d'un type et panneau d'un pion, posés sur `document.body` |
| `src/counttag.ts` | une icône et un nombre (sections de front de l'onglet, zones comprimées de l'adversaire) |
| `src/pawn.ts`, `src/pawn.css` | pion d'une division et disposition d'une zone (§11.3) : `renderZone`, `pawnOrder` ; une division en trop (`leaveTick`) clignote ; ne gère ni la sélection ni les panneaux |
| `src/theme.ts`, `src/forces.css` | thèmes clair et sombre de la fenêtre d'un front et de l'onglet des forces (§11.8) ; styles de ces deux panneaux, du menu « + », du glisser et des panneaux de survol |
| `src/protocol.ts` | types des messages page ↔ Worker |
| `src/engine.worker.ts` | Web Worker : reçoit les messages de la page, choisit la source de tours (solo ou en ligne), tient l'horloge du solo, ouvre le vrai WebSocket |
| `src/game.ts` | `Game`, « la partie » : moteur du client, application d'un tour (`applyTurn`, `advance`), fabrication des messages de la page ; indépendante de la source (sans DOM, sans `self`) |
| `src/solo.ts` | `SoloGame`, source de tours locale : `Game` + relais (`Room`) + bots (sans DOM, sans `self`) |
| `src/online-game.ts` | `OnlineGame`, source de tours WebSocket : ordres, tours, hashes, pause, fin de partie ; le transport est fourni (sans `WebSocket`, sans `self`) |
| `src/bots.ts` | bots (§5), stratégie minimale pour le débogage |
| `test/solo.test.ts`, `test/fronts.test.ts` | tests sous Node : partie solo, copie de la page, peinture ; géométrie des fronts, message des fronts, double ligne rouge, prise d'une ville |
| `test/online.test.ts` | tests sous Node de `online.ts` : adresse du WebSocket, nom et jetons gardés (stockage qui lève compris), liste du lobby |
| `test/online-game.test.ts` | tests sous Node de `OnlineGame` branché sur un vrai relais en mémoire : même état et mêmes hashes chez trois clients, rejeu d'une reprise (un seul `tick`), désynchronisation, pause, connexion perdue |
| `vite.config.ts` | `server.proxy` pour `/api` (`ws: true`), Worker au format module |
| `public/icons/` | icônes provisoires (00-Game §11), servies telles quelles ; `units-generated/` : copies générées des icônes d'unités (09-Couleurs §4) |
| `scripts/unit-icons.ts` | génère `public/icons/units-generated/` (`npm run icons:units -w client`) |

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
| « +10 bonshommes » | 10 bonshommes de plus dans Inactifs du joueur (`population` aussi) ; message `addPopulation` |
| « Renforcer les bots » | chaque bot reçoit 3 bonshommes dans Inactifs ; message `armBots`. Pour essayer les fronts : fonder une ville près d'un bot, déclarer la guerre par le menu de diplomatie, ouvrir le front |
| « Thème : clair / sombre » | bascule le thème de la fenêtre d'un front et de l'onglet des forces (`theme.ts`, 05-Fronts §11.8) ; bouton temporaire en attendant un panneau de configuration du joueur ; pas de message : l'attribut `data-theme` de `<html>` |

Les trois boutons sont des outils de développement hors des règles, comme la pause (05-Fronts §15). En ligne la barre est cachée et le Worker ignore le message `debug` (le bouton du thème est caché avec elle).

### Partie de test

Bouton « Partie de test » de l'écran de départ du solo (`#play-test`), affiché seulement si `import.meta.env.DEV` est
vrai (donc absent de `npm run build`). Il montre trois boutons de scénario (`#test-choices`) : « Infanterie seule »,
« Infanterie et support », « Complet » (clés de `TEST_SCENARIOS`) ; la réserve nationale a 10 divisions de chaque type
dans les trois. Le choix envoie `start` avec `testGame: <scénario>` et un seul bot (le bot de `bots.ts`,
inchangé, qui ne déplace pas ses divisions) ; la graine de la carte est celle du formulaire. `SoloOptions.testGame` →
`GameOptions.testGame` → `Game` : `createGame` avec `freezeEconomy`, puis `setupTestGame`. Le bot reste actif mais ses
ordres `found_city` sont refusés (économie gelée). Les deux joueurs sont en paix : pour combattre, déclarer la guerre
par le menu de diplomatie. Les villes existent avant le premier tour, alors que `Game.applyTurn` n'envoie villes, zones et routes que quand leur nombre change : le premier tour d'une partie de test les envoie (`initialSent`), sinon la carte reste vide. Le moteur est décrit dans `01-Architecture.md` §9 bis.

## 4. Messages

Page → Worker (`ToWorker`) :

- `start { mapSeed, bots, colors, stepMs? }` (solo) : génère la carte (`generateTestMap`), crée
  la partie (`createGame`, graine = graine de la carte mélangée à une constante,
  `gameSeedFor`), les bots, lance l'horloge. Joueur 1 = l'humain, 2 à n = les bots.
- `online { url, name, token }` (en ligne) : le Worker ouvre le WebSocket `url`
  (calculée par la page d'après l'adresse du lobby, `wsUrl`) et envoie
  `join {name, token}`. Le message de départ du relais donne la carte, la
  graine, les joueurs et `you` : la partie est créée de la même façon chez
  tous (`new Game`, même graine de partie qu'en solo).
- `order { id, order }` : `found_city { tile }`, ou un ordre de pions (08 §10) : `move_pawn { from, to, kind, good?, count }`
  (`from` et `to` sont des identifiants d'activité, `kind` `"worker"` ou `"machine"`, `good` pour une machine),
  `set_activity_order { activity, position }`, `change_production_target { activity, delta }` (02-Engine §4), ou un
  ordre de diplomatie : `declare_war { target }`, `propose_pact { target }`,
  `break_pact { target }`, `propose_peace { target }`, `answer_proposal { from,
  accept }`. Les chaînes ne sont pas vérifiées par la page : le moteur les vérifie.
- `pause { paused }` (solo : le relais local ; en ligne : demande à l'hôte, que le relais refuse à un autre joueur).
- `order` accepte aussi les ordres des fronts (05-Fronts §5.2, 02-Engine §4) : `move_division { ids, front, line?, box? }` (`front` 0 : réserve nationale ; sans `line` : seconde ligne ;
  `line` : `first`, `second`, `rapid` ou `box` ; `box` : boîte de percée, 0 pour en créer une),
  `start_front_attack { front }`, `stop_front_attack { front }`,
  `start_breakthrough { box, city1, city2 }`, `cancel_breakthrough { id }`. Les divisions ne se créent ni ne se
  suppriment par ordre (08 §6).
- `debug { action: "addPopulation" | "armBots", amount }` (voir §3).

Worker → page (`FromWorker`) :

- `init` (une fois) : largeur, hauteur, `terrain`, `resources`, `fertility`
  (copies, transférées : le moteur garde les siennes), nombre de joueurs, `you`
  (le joueur de la page : 1 en solo, celui du message de départ en ligne) et
  `playerNames` (le nom de chaque joueur, indice `id - 1`), `playerColors` (sa couleur, même indice, 09-Couleurs §5), rayons
  d'expansion et de contrôle, coût d'une ville, `stepMs`, et `catalog` (`ActivityCatalog`) : la
  configuration des activités que la page affiche (08 §2, §9) : pour chaque activité son identifiant, son genre
  (`idle`, `hurt`, `farming`, `fishing`, `mining`, `factory`, `barracks`), son parent, son coût de déblocage, ses
  ouvriers et son fer par unité, son bien ou son type de division, ses cases par travailleur ; les identifiants et
  les icônes des machines ; les délais d'apparition et de disparition (population, machines, divisions) ; la nourriture
  par bonhomme, la nourriture minimale, le fer par case et le rendement d'une case d'eau. Lue dans le moteur par
  `activityCatalog()` (`game.ts`), sans règle recopiée dans la page ; `military` (`MilitaryCatalog`) : les types de division
  (clé, indice, niche, rang dans la niche, attaques d'une division pleine (somme des composants), icône,
  description, largeur de front, `productionTurns`, type d'élite, PV, multiplicateurs, blindage, motorisation), les niches et leurs types,
  `eliteTroopsRatio`, et les délais (tours entre deux rounds, déplacement) et l'échelle de l'état, lus dans
  `config/divisions.ts` et `config/fronts.ts` par `militaryCatalog()` (`solo.ts`).
- `tick`, à chaque tour :
  - `tick` : numéro du tour ;
  - `tiles` : paires `[case, ville]` des cases dont `tileCity` a changé, pas
    plus ; le propriétaire se déduit de la ville ;
  - `cities` et `roads` : listes complètes, **seulement** si une ville a été
    fondée pendant ce tour (c'est le seul cas où les villes, ports, groupes et
    routes changent) ; sinon `null` ;
  - `human` : les activités du joueur local (`you`), à chaque tour (quelques dizaines de nombres) :
    `activities` (dans l'ordre du joueur : bonshommes, machines, places, places de la boîte (`slots`), sortie,
    fer réservé, et pour une usine ou une caserne les existants et la limite effective, élites plafonnées),
    `unlock` (progression de chaque activité), `served` (ouvriers servis en fer de chaque activité : la vitesse de
    déblocage de ses enfants), `idleMachines`, les compteurs d'apparition et de sursis (`popArrivals`, `popLeaves`,
    `machineArrivals`, `machineLeaves` : des tours de fin, triés), `hurtHealEnd`, la capacité de population, le
    fer produit et le fer réservé ; `tick` donne le tour courant, pour lire les compteurs ;
  - `players` : par joueur, population, capacité, bonshommes d'Inactifs, de Blessés, d'Agriculteurs, de Pêcheurs, de
    Mineurs et de casernes (`soldiers`), nombre de divisions, nourriture, blé, poisson, surface cultivée, surface
    pêchée, cases de fer exploitées, cases de fer, fertiles et d'eau, fer produit et réservé, machines possédées et
    limites, capitale, nombre de villes, `defeated`, coût de la prochaine ville en bonshommes ;
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
    et pour chaque camp `frontAttack`, l'attaque sur tout le front, et `lastLossByNiche`, l'état perdu par sa première
    ligne au dernier round, par niche, à l'échelle `stateScale`), ou `null` si rien n'a changé depuis le dernier
    envoi. `SoloGame` les reconstruit à chaque round de combat (`combatTurns`), quand le joueur donne un ordre et quand
    des villes changent, et compare le JSON au dernier envoyé ; les positions changent à chaque round.
    Pas de brouillard de guerre : les fronts de tous les joueurs, pas seulement ceux du joueur 1 ;
  - `divisions` : toutes les divisions de tous les joueurs, par identifiant (`DivisionView` : propriétaire, type,
    front (0 : réserve nationale), ligne, largeur engagée en millièmes de liaison, état sur
    `stateScale`, statut `ready`, `formation`, `moving` ou `fleeing`, tour de fin du statut, `leaveTick` : le tour où
    une division en trop disparaît, 0 sinon), ou `null` si rien n'a changé ;
    `Mirror.divisions` garde le dernier tableau, le même objet tant qu'il ne change pas ;
  - `captured` : les villes prises pendant le tour (`{ city, from, to }`). Une ville prise
    change de joueur sans que `tileCity` change : `cities` est alors renvoyé, avec les paires
    `[case, ville]` de toute sa zone dans `tiles`, pour que la copie de la page la repeigne et
    refasse ses histogrammes ;
  - `eliminated` : les joueurs éliminés pendant le tour (`{ player, by }`, événement `player_eliminated` du moteur) ;
    vide après un rejeu. `players[i].defeated` dit, à chaque tour, si un joueur est éliminé (la page en tire l'état de
    spectateur, même après un rejeu) ;
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
`tileCity`, les villes et routes, les fronts), et aucun événement du
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
apparue sur cette case pendant le tour. Ordres de pions : le compte des pions de l'arrivée (bonshommes, places ou
machines) a changé depuis l'état d'avant le tour, relevé seulement quand il y a un ordre humain (approximation si
plusieurs ordres du même tour visent la même activité) ; un ordre de position, si l'activité est à la position
demandée ; le retrait d'une place, si les places de la caserne ont baissé. La page affiche un message
pour un ordre non appliqué. Ordres de diplomatie : appliqué si `state.events` (vidé
au début du tour) contient l'événement attendu pour ce joueur (`war_declared`,
`pact_broken`, `proposal_sent` du bon genre, ou `proposal_accepted` /
`proposal_refused` pour `answer_proposal`) ; le message d'un ordre refusé est
« Action diplomatique sans effet ».

## 5. Les bots (`src/bots.ts`)

Ce ne sont pas des règles du jeu : un bot lit l'état et envoie des ordres
`found_city` et `move_pawn`, que le moteur valide comme ceux de l'humain. Stratégie minimale, pour le débogage.
Chacun a son générateur (`createRng`, graine = graine de la carte mélangée à son
identifiant), donc deux parties de mêmes réglages envoient les mêmes ordres.

- **Première ville** : après un délai tiré entre 1 et 30 tours, il tire des cases
  au hasard sur la carte jusqu'à en avoir 5 de terre, de fertilité > 0 et sans
  ville (`tileCity === 0`), et prend celle qui a le plus de cases fertiles libres
  dans son rayon de contrôle.
- **Affectation** : tous les 10 tours (`ASSIGN_EVERY_TURNS`), les bonshommes d'Inactifs vont d'abord dans
  Agriculteurs (jusqu'aux places libres), puis, après l'éventuelle fondation, dans Mineurs, puis dans la caserne de
  milice (sans limite de places). Un seul `move_pawn` par destination, avec `count`.
- **Expansion** : au plus tous les 15 à 24 tours, si la surface cultivée atteint la moitié de la surface cultivable
  (`2 × cultivated ≥ farmTiles`, valeurs du dernier tour) et que les inactifs restants paient le coût de la ville
  suivante (`foundingCostPawns`), il tire des cases dans le rayon d'expansion d'une de ses villes (ville tirée au
  hasard à chaque tirage), garde celles qui sont de terre fertile et libre, et prend celle qui a le plus de cases
  fertiles libres. Les conditions sont vérifiées chez le bot avant d'envoyer : pas d'ordre perdu.

Les bots n'envoient **aucun ordre de diplomatie** et ne répondent à aucune
proposition (IA reportée, 00-Game §1.1) : une proposition faite à un bot expire
après `DIPLOMACY.proposalTurns` tours.

Les constantes sont en tête de `bots.ts`. Les bots ne produisent ni machines ni divisions autres que la milice : sans
renfort (« Renforcer les bots » du panneau de debug), leur armée reste celle que leur population permet.

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
cases du menu « Carte » (`showPlayerColor` : mélange à 40 % de la couleur du
joueur sur la terre). Le relief d'une case de fer est toujours recouvert d'un gris
brun-rouge (`landIron`, `IRON_TINT` à 55 %) ; sinon, celui d'une case cultivable
(fertilité > 0) d'un vert léger (`landFertile`, 80/255 d'opacité). **Couloirs de routes** : `Mirror.roadCorridor` marque
les cases à moins de `ROAD_CORRIDOR_RADIUS` (5, soit 11 cases de large, provisoire) du tracé d'une route ; sur une case
de terre d'un joueur, quand `showPlayerColor` est vrai, la peinture n'y met ni le vert léger ni les champs, pour que la
couleur du joueur se lise carte dézoomée. La couleur pleine du joueur, sans le sol, a été essayée et écartée : trop vive. Ce n'est que de l'affichage : la surface cultivée et son revenu ne changent
pas, et le moteur ne connaît pas ces couloirs. Les trois textures sont différentes de la couleur du joueur : champs en
bandes vertes, pêche en points blancs sur l'eau bleue, mine en bandes diagonales
sombres et orangées (provisoire, 00-Game §11). Chaque texture remplace la
couleur de la case quand `showPlayerColor` est faux ; quand il est vrai, la case
garde 70 % de sa couleur (relief teinté par le joueur, ou mer) et prend 30 % de
la texture (`TEXTURE_ALPHA_ON_PLAYER`) : à 100 %, les champs couvraient la
couleur des joueurs ; même réglage pour la pêche et la mine
(auteur, 25 octobre 2026). À chaque tour, seules sont
repeintes : les cases dont la ville a changé et leurs quatre voisines (la couleur
d'une case dépend de ses voisines de gauche, droite, haut et bas), les cases dont l'appartenance au champ, à la zone de pêche ou à la
mine a changé, et celles qui entrent dans un couloir de route ou en sortent. Le rectangle englobant est renvoyé au canvas par `putImageData` avec
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

**Noms des joueurs** (`render.ts`, `playerlabels.ts`). Quand la carte est assez dézoomée, le nom de chaque joueur est écrit
sur elle (`rosterName` : le joueur de la page a son pseudo, pas « Vous » ; en solo, le pseudo gardé par la page, ou « Joueur 1 » s'il n'y en a pas), par-dessus tout le reste (villes, routes, fronts), en 15 px gras, dans sa couleur de limite (`playerLimit`), avec un contour noir de 2 px. Il apparaît quand l'écran
montre au moins `LABEL_MIN_TILES` cases (120 000, soit environ cent villes, provisoire) et garde la même taille à l'écran
à tout zoom. Le nom va dans le plus grand territoire contigu du joueur (cases de terre reliées par les quatre côtés) : à
la position où son rectangle ne recouvre aucune case d'un autre joueur, couvre le plus de cases de ce territoire, puis
est le plus près de son centre. Il peut déborder sur la mer ou une terre libre. Si aucune position ne convient, le joueur
n'a pas de nom (provisoire). Les territoires ne sont refaits que si un propriétaire de case change, et les positions
sont gardées par palier de zoom. Les noms ne dépendent pas des cases du menu « Carte ».

**Canvas** (`render.ts`). Molette : zoom centré sur la souris ; glisser : déplacer
(sous 4 pixels de mouvement, c'est un clic). À chaque image : le tampon de la
carte, puis routes (ligne brisée le long de `mirror.roadTiles`, trait plein foncé
entre deux villes d'un même joueur, pointillé gris sinon), villes (point ; étoile pour la capitale ; carré bleu de
port sur la case de côte de la zone la plus proche de la ville, ou à côté de la
ville si c'est la sienne), puis, en mode placement, le rayon d'expansion des
villes du joueur et la case survolée. Il n'y a pas d'usine sur la carte (08 §2) : ni logo, ni ville agrandie, ni mode
usine. `MapView.highlightCity(ville)` hachure en blanc (bandes « / », même `drawHatch` que les vues) les cases dont `tileCity`
est cette ville, au-dessus des vues et sous les routes et les villes ; le masque de la zone est recalculé à chaque changement
de ville ou de zones. Une image n'est dessinée que si quelque chose a changé
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
taille d'une ville (`render.ts`, `FrontLayer.marks`) ; la courbe de Catmull-Rom est abandonnée (05-Fronts §11.1). **Unités** : quand l'écran montre au plus `FRONT_INFANTRY_MAX_TILES` cases (`visibleTiles`, indépendant de la taille de la fenêtre), `drawFrontSide` dessine l'infanterie seule ; au plus `FRONT_UNITS_MAX_TILES` cases, toute la première ligne. `drawFrontSide` dessine les icônes à la place des ronds. `linkUnits` (`frontunits.ts`) répartit la première ligne sur les connexions, `FrontLayer.marks` couvre tous les fronts (`active` : petit point rouge et ronds seulement en guerre), `FrontLayer.markUnits` garde le résultat tant que `Mirror.divisions` et les fronts ne changent pas, `unitIconCanvas` (`uniticons.ts`) donne l'icône 32 × 32 colorée. `MapView.divisionsChanged` redemande une image, au-delà du seuil seulement.
**Survol d'une zone de front** : contour de 5 px, fixe. **Clignotement** : `BLINK_PERIOD_MS` (1 000 ms, `blink.ts`) pour le bouton d'attaque
actif de la fenêtre d'un front (variable CSS `--blink-period` posée au démarrage). **Percées en cours** (`MapView.drawBreakthroughs`, 05-Fronts §11.1) : pour chaque percée des deux camps (`FrontView.breakthroughs`), un trait
rouge de 3 px le long du segment droit entre les deux villes de l'axe et une flèche de 14 px (`ARROW_PX`) au milieu, de la ville de celui
qui perce (`owner`) vers celle de son adversaire. **Mode choix d'axe** (`main.ts`, `startAxisMode`, `nearestConnection`) : repris de la
v0.1 ; le bouton « Lancer » d'une boîte ferme la fenêtre du front, la connexion du front la plus proche de la souris est surlignée
(`MapView.axisHover`), un clic envoie `start_breakthrough { box, city1, city2 }` et termine le mode, Échap ou le bouton `#axis-cancel` (« Annuler la percée », en haut à droite de la carte, affiché pendant le mode) l'annule ; dans les deux cas la fenêtre se rouvre
dans l'état d'avant (`FrontWindow.fromTab`, mémorisé par `startAxisMode`). `failedBreakthroughs > 0` : message « Percée arrêtée ».

## 7. Interface provisoire

- **Nombres** (auteur, 4 novembre 2026) : tout nombre affiché passe par `num`
  (`src/format.ts`). Sous 10 000 : entier avec séparateur de milliers
  (« 9 999 ») ; au-delà, en milliers puis en millions, une décimale sous 100,
  aucune au-dessus : « 10K », « 12,3K », « 123K », « 1,2M », « 123M ». La
  colonne de statistiques de la fenêtre d'un front (`formatStat`) passe en
  notation courte dès 1 000, faute de place.
- **Écran de départ** : nombre de bots (1 à 7, 3 par défaut), graine de la carte
  (12345 par défaut), « Jouer ».
- **Barre de boutons**, en bas (00-Game §1) : « Créer une ville », suivi du
  coût de la prochaine ville (`foundingCost`, mis à jour à chaque tour) avec
  l'icône de population neutre, puis « / » et l'icône de ville ; le coût est en bonshommes (08 §10) ; caché tant que le joueur n'a pas de capitale
  (première ville gratuite). Active le mode
  placement (échap : quitte ; l'ouverture d'un détail de la barre d'informations
  ou du menu « Carte » aussi). Sans ville : rien de particulier, toute terre libre
  est valide. Avec des villes : le rayon d'expansion de chacune est dessiné ; la
  case survolée est verte si la fondation respecte 00-Game §3.3 (terre,
  `tileCity === 0`, dans le rayon d'expansion d'une ville du joueur, inactifs ≥
  coût en bonshommes, 08 §10) et rouge sinon, avec la raison dans la barre. En mode placement, les
  vues de `PLACEMENT_MAP_OPTIONS` sont affichées (dont les hachures de
  fertilité, voir le menu « Carte »), le rayon de contrôle qu'aurait la ville est dessiné autour de la case
  survolée, et la barre donne le nombre de cases cultivables que cette ville
  prendrait (`Mirror.fertileTilesFor` : libres, ou plus proches d'elle que de
  leur ville actuelle, 00-Game §3.2). Le clic sur une case rouge
  n'envoie rien. Le clic sur une case verte envoie `found_city` ; si le moteur ne
  l'applique pas (`results`), la page affiche « Ville non fondée : le moteur a
  refusé l'ordre ». La page copie les conditions pour colorer la case ; **le
  moteur reste l'autorité** et vérifie à nouveau.
- **« Production »** : ouvre ou ferme le panneau de production (`production.ts`, `production.css`, 08-Population §11),
  posé sur le bord droit de la carte, ouvert au début de chaque partie, large d'environ 600 px (`--prod-w`). De haut en bas :
  - **l'en-tête** : « population / capacité » (icône `pop-default`), et « fer réservé / fer produit » (icône du lingot ; un clic
    ouvre l'onglet Ressources de la barre d'informations, `InfoBar.openTab`) ;
  - **les boîtes ouvertes**, dans l'ordre du joueur (`HumanDetail.activities`), chacune sur un fond légèrement coloré
    propre à son genre d'activité et une bordure marquée (variable `--box-c` posée par `data-kind`, tirée des `--occ-*` de
    `style.css` ; mélange de 14 % dans le thème clair, 22 % dans le sombre, `html[data-theme]`). Une boîte est une grille de
    six colonnes : poignée `⋮⋮`, entrée, flèche →, colonne centrale, flèche →, sortie. Les colonnes d'entrée (64 px) et de
    sortie (76 px) ont une largeur fixe : elles sont alignées d'une boîte à l'autre ; sans entrée, la tuile et sa flèche
    disparaissent et la colonne reste vide. Grille de deux rangées : titre en haut de la colonne centrale, pions en dessous, et entrée, flèches et sortie dans la rangée des pions, alignées en haut (`.pb-center` est en `display: contents`) ;
  - **entrée et sortie** sont dans la boîte, sur une petite tuile à fond clair, sans couleur de ressource. Entrée : le fer
    réservé de l'usine ou de la caserne qui en prend (`ironUsed`, rouge quand le fer manque : unités servies
    < `floor(ouvriers / workersPerUnit)`). Sortie : `+n` et l'icône de population pour Agriculteurs et Pêcheurs (la nourriture
    de la boîte ÷ `foodPerPawn`, une décimale), `+n` et le lingot pour Mineurs, « existants / limite » et l'icône du
    produit (machine ou division) pour une usine ou une caserne. Inactifs et Blessés n'ont pas de sortie ;
  - **la colonne centrale** : le titre (`activityName`) et le nombre de places (« 3 / 5 places » ; casernes : « bonshommes /
    places » ; usines : les ouvriers) au-dessus des pions, sans cadre intérieur ; sur une boîte parente dont un enfant reste
    verrouillé, un petit cadenas ouvert (`icon-padlock-open.png`, `data-tuto="prod-parent"`) dont **seul le survol** montre les enfants et leur
    barre de progression (`setTip`, `childrenTip`) ;
  - **les pions** : case de 22 px, icône de 16 × 16 de `icons/population/` (`pop-default` pour les inactifs, `pop-farmer`, `pop-fisherman`,
    `pop-miner`, `pop-worker`, `pop-soldier`, `pop-hurt`) pour un bonhomme, icône du bien (`catalog.icons`) pour une machine ;
    trop de pions pour une ligne : ils passent à la ligne et la boîte grandit vers le bas. Les bonshommes d'abord, puis les
    machines que la boîte reçoit (Agriculteurs, Pêcheurs, Mineurs), puis, dans une caserne, les places vides. Inactifs :
    une ligne de population puis une ligne par type de machine présent, sans libellé. **États** : normal ; **à venir**
    (`popArrivals`, `machineArrivals`) à la fin de la ligne d'Inactifs, contour en tirets et barre de compteur qui avance
    avec le tour (`data-end`, `data-total`) ; **en sursis**, clignotement (`--blink-period`, `blink.ts`) : la page déduit les
    pions de 08 §6 à partir du nombre de compteurs (`popLeaves`, `machineLeaves`) : la population part de la boîte la plus
    basse vers le haut, après Inactifs, Blessés tout à la fin, les derniers pions de chaque boîte d'abord ; une machine part
    de sa ligne d'Inactifs, puis de sa boîte ; **place vide** : case en pointillés, réglée par les flèches ;
  - **glisser des pions** (pointeur, comme `dnd.ts` pour les divisions du même type) : le survol met en surbrillance le pion sous la
    souris et tous les pions de même type (bonhomme ou machine d'un même bien) à sa droite dans la boîte, lignes du dessous
    comprises (`groupOf`) ; un appui puis un déplacement de plus de 4 px commence le glisser (pion fantôme `×n` sous la
    souris, curseur caché par `body.pw-moving`, pions source atténués) ; la boîte sous la souris est surlignée si elle accepte au moins un pion. Le relâchement
    envoie **un seul** `move_pawn { from, to, kind, good?, count }`. Les règles visibles évitent un ordre que le moteur refuserait
    (`dropCount`) : Blessés ne reçoit ni ne donne, une machine ne va que dans Inactifs ou la boîte qui la reçoit, une boîte à
    places (Agriculteurs, Pêcheurs, Mineurs) ne reçoit pas plus que ses places libres (le glisser est réduit à ce qui
    tient, rien s'il n'y a plus de place) ; les pions à venir, les places vides et les blessés ne se saisissent pas ;
  - **réorganisation** : la poignée `⋮⋮` d'une boîte (pointeur, copie `.pb-ghost` de la boîte dont le point saisi reste sous la souris, curseur caché par `body.pw-moving`) la dépose sur l'interstice le plus proche et envoie
    `set_activity_order { activity, position }` (indice de la boîte visée dans la liste des boîtes ouvertes ; Inactifs n'a pas de
    poignée et n'est pas une cible, 08 §2) ;
  - **ligne sous la souris** : quand le panneau est reconstruit (`rebuild`), `scrollTop` de `#prod` est corrigé de l'écart de position de la ligne sous la souris (`data-line`), pour qu'elle reste au même endroit de l'écran si Inactifs ou une autre boîte change de hauteur. Limite : tout en haut du panneau, `scrollTop` ne passe pas sous 0, donc une boîte du dessus qui rétrécit fait encore monter la ligne ; tout en bas, de même si le contenu raccourcit ;
  - **une erreur dans `ProductionPanel.update` coupe la fin de `onTick`** (`InfoBar.update`, diplomatie, notifications, résultats des ordres) : `refreshNumbers` ne lit que les `.pl[data-lock]`, car une boîte débloquée ou supprimée n'a pas de `data-lock` ;
  - **boîtes verrouillées**, sous un séparateur, très pâles : l'icône de ce qui est débloqué, le cadenas (`miscellaneous/icon-padlock-closed.png`), un
    petit trait, le symbole de la boîte parente (son produit, ou son bonhomme pour Agriculteurs, Pêcheurs et Mineurs), puis une
    barre de progression (« progression / coût » à gauche, nom de la boîte à droite) ; triées par progression décroissante (`lockedOrder`), le panneau défile vers le
    bas ; le survol donne l'explication (`lockedTip` : la progression gagne chaque tour le nombre d'ouvriers de la boîte parente
    servis en fer, `HumanDetail.served`, et le temps restant à ce rythme). Une boîte débloquée rejoint le bas des boîtes
    ouvertes.
  Le panneau n'est reconstruit que quand sa structure change (`structureKey` : pions, places, boîtes ouvertes, ordre des boîtes
  verrouillées, nombre de compteurs), et jamais pendant un glisser de pions ou de boîte. Après un ordre, la reconstruction est
  retenue jusqu'à ce que la clé change (le moteur a répondu) ou que `HOLD_MS` (500 ms) passe : pas de retour fugitif à l'ancien
  état. Entre deux reconstructions, seuls les nombres (sorties, tuiles, barres des compteurs et du déblocage) sont mis à jour.
- **« Tutoriel »**, à droite de « Production » : un clic déplie vers le haut un
  menu de deux choix, « Revoir le tutoriel » (toutes les leçons à lire) et
  « Passer le tutoriel » (toutes lues, plus aucun contour). Un appui en dehors
  ou Échap ferme le menu. Mécanisme et
  leçons : `07-Tutoriel.md`.
- **Barre d'informations**, en haut de l'écran de jeu (00-Game §11, `infobar.ts`) :
  44 px de haut, trois boutons séparés par un trait (le troisième, Diplomatie, n'a ni chiffre ni mini-barre) ; chacun a une ligne de
  chiffres et, juste dessous, une **mini-barre** (10 px, `.ib-mini`) : la barre
  la plus pertinente de son détail, mise à jour par `head` à chaque tour, détail
  ouvert ou non. Les onglets Population, Nourriture et Armement n'existent plus (08 §11). Ressources (flux) : la barre du
  fer, **orange** (`.ib-track.iron`, comme dans le détail), à l'échelle du plus grand du fer produit et du fer réservé :
  orange clair jusqu'au fer produit, orange jusqu'au fer réservé. Provisoire : elle deviendra une vue agrégée de toutes les
  ressources (hors machines), à définir. Fronts : part des fronts du joueur qui sont actifs (vert).
  **Largeur fixe** (auteur, 4 novembre 2026) : les nombres qui changent à
  chaque tour (nombre de divisions) ont une largeur minimale en `ch` (`fixedWidth`), un peu plus que
  leur texte le plus long avec la notation de `num` (« 99,9K », « +99,9K »,
  « / 99,9K ») : les boutons ne changent pas de largeur quand les chiffres changent.
  Le survol d'un
  bouton (auteur, 4 novembre 2026 ; le clic aussi, pour le clavier) déplie son détail
  juste sous la barre, par-dessus le haut de la carte, aligné sur le bord gauche du
  bouton ; la souris sortie du bouton et du détail le replie après 200 ms
  (`CLOSE_DELAY_MS`, le temps de passer de l'un à l'autre ; y revenir annule). Pendant un
  geste commencé dans le détail (`Section.busy` : glisser de l'onglet des forces), le repli attend la fin du geste. Un détail ouvert par le
  programme (« ← Retour » d'un front, ligne du fer de l'en-tête du panneau de production) reste
  ouvert jusqu'à ce que la souris y entre puis en sorte, ou qu'un autre bouton soit
  survolé. Chaque ouverture appelle `InfoBar.onOpen`, que `main.ts` branche sur la sortie
  du mode « Créer une ville ». Le menu « Carte » se comporte de la même façon. Un seul détail
  est ouvert à la fois. Le détail ne sort pas de la carte : sa butée à droite est
  le bord gauche du panneau de debug (`#panel`) et du panneau
  de production (`#prod`), quand ils sont ouverts ; le détail se décale vers la gauche (et se rétrécit si
  besoin) à l'ouverture ou à la fermeture de l'un d'eux
  (`InfoBar.place`, appelé par les boutons « Production » et « Panneau de debug »). Le DOM est construit une fois par partie ; chaque tour,
  `InfoBar.update` écrit seulement des textes et des largeurs (la barre, et le
  détail ouvert ; un détail replié est mis à jour à l'ouverture). Les barres
  **vertes** sont des flux.
  Les icônes sont des textes provisoires entre crochets (`[fer]`…), `⇄` pour les
  flux, sauf la population et les trois machines : images
  16 × 16 de `public/icons/` (00-Game §11), affichées à 16 px sans lissage
  (`image-rendering: pixelated`) ; `pop-default` sur l'onglet, une icône par
  occupation dans son détail. Les machines tirent la leur de `icon` dans
  `config/goods.ts` (voir ci-dessous).
  **Icônes en 32 px (essai)** : dans l'onglet militaire (tableau des unités et
  combats), les icônes de machines et d'unités sont affichées à 32 px
  (`productIcon(id, 32)`, classe `.ib-img.big`, `.fp-icon-img`) ; la barre du haut et
  les autres infobulles restent à 16 px. `icons.ts` (`ICONS_32`) associe aux icônes
  de division AA, AT, artillerie et chenillette leur fichier dessiné en 32 × 32 (les trois
  chars n'existent qu'en 32 × 32) ; les autres sont
  les fichiers 16 × 16 agrandis sans lissage. Provisoire : à terme, un bien aura
  ses deux versions dessinées.
  **Menu « Carte »** : dernier élément de la barre (bouton `Carte ▾`, texte plus
  gros que les sections ; une icône de carte le remplacera). Il est en haut à droite
  de la vue de la carte (auteur, 4 novembre 2026) : son bord droit est contre le bord
  gauche du panneau de production quand il est ouvert, sinon du panneau de debug.
  `margin-right: calc(var(--panel-w) + var(--prod-offset))` : `--panel-w` donne aussi
  sa largeur à la colonne du panneau de debug, et `#game:has(> #panel[hidden])` la met
  à 0 ; `--prod-offset` vaut `--prod-w` (la largeur de `#prod`) quand `#prod` est
  ouvert, 0 sinon. Le menu a le même décalage à droite ; sous 760 px, le
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
  `.ib-bar` a `overflow` et le couperait. Il s'ouvre au survol du bouton (ou au clic) et
  reste ouvert quand on coche ; il se ferme quand la souris sort du bouton et du menu
  (même délai que les détails), au clic en dehors (`pointerdown` sur le document),
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
  d'écriture, avec les mêmes séparateurs, en un mot chacune : « Réservé / produit »,
  « Possédées / limite ». Sur la barre, l'infobulle est celle du bouton entier. Même règle dans le panneau de debug
  (« Cultivées / cultivables »).
  **Infobulles construites** (`setTip(el, build)` de `tooltip.ts`) : `build`
  renvoie un contenu (titre, sections, barres) au lieu d'un texte ; il est appelé
  à l'affichage, puis à chaque tour tant que l'encadré est affiché (`refreshTip`,
  appelé par `main.ts` après la barre d'informations). Encadré de 340 px, en 13 px
  (largeur du contenu). `setTip(el, build, beside)` : l'encadré est placé à droite de `beside`
  au lieu de sous `el`.
  Les contenus des machines sont dans `goodtips.ts` (`attachGoodTip(el, bien)`, posé
  sur chaque `[bien]` de l'onglet Ressources). Feuille de route de toutes les icônes : `04-Tooltips.md`. Les trois
  **machines** (tracteur, bateau de pêche, pompe à vapeur) ont la même infobulle, décrite par une entrée de
  `MACHINE_TIPS` (noms, ce qu'on lit dans les statistiques, couleur de la barre) : titre ; une phrase (une machine vaut un
  travailleur : même place dans sa boîte, même sortie, sans personne pour l'actionner, elle libère un bonhomme) ; les règles
  lues dans le catalogue (cases par travailleur ou machine, boîte qui la reçoit, usine et fer par machine) ; « Votre nation ·
  travailleurs · machines possédées / limite » et une barre de la couleur du métier : « Surface cultivée » cultivées /
  cultivables (`--occ-farm`), « Surface pêchée » pêchées / cases d'eau (`--occ-fish`), « Cases exploitées » cases de fer
  exploitées / cases de fer (`--occ-mine`).
  1. **Ressources (flux)** : rien dans la barre que le titre et la mini-barre du fer. Détail, barres vertes :
     *Fer* : échelle = le plus grand du fer produit (`HumanDetail.ironProduced`) et du fer réservé (`ironReserved`) ; orange clair
     (`.ib-front`) jusqu'au fer produit, orange jusqu'au fer réservé ; texte « réservé / produit ». *Aluminium* : ligne grisée
     « à venir » (aucune règle ne l'extrait). Les deux lignes ont leur icône (`goods/goods-iron-ingot.png`,
     `goods/goods-aluminium-ingot.png`), suivie dans la case du libellé de l'icône camembert
     (`miscellaneous/icon-pie-chart.png`, `pieIcon`). **Infobulle du camembert du fer** (`setTip`, `InfoBar.ironTip`) : titre
     « fer réservé, fer produit » ; puis une rangée par activité qui réserve du fer, de la plus grosse à la plus petite : nom de
     l'activité, barre orange, fer réservé ; toutes les barres ont la même échelle. Camembert de l'aluminium : grisé, infobulle
     « Aucune consommation ». *Tracteurs*, *bateaux de pêche*, *pompes à vapeur* : l'icône de la machine (infobulle de
     `goodtips.ts`), une barre verte « possédées / limite » (`PlayerStats.machines`, `machineLimits`, 08 §5) et ce texte.
     Une ligne de légende (fer réservé, fer produit).
  2. **Forces** (deuxième position, juste à droite de Ressources ; 05-Fronts §11.2, `forcestab.ts`) : « Forces n » (nombre de divisions du joueur). Détail : l'onglet des forces
     (§ « Onglet des forces » ci-dessous). Le volet (`.ib-pane.forces`) a la classe `themed` : fond et couleurs de son thème.
  3. **Diplomatie** (troisième position, `diplomacytab.ts`).

  Calculé côté page à partir des messages : les barres du fer et des machines, les durées restantes des compteurs, les pions
  en sursis (déduits de 08 §6), les temps de déblocage restants. Lu tel quel du moteur : tout le reste.
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
  `move_division { ids, front, line: "box", box }`. **Boîtes** : le bouton « Lancer » est à gauche et la motorisation à droite (la vue étendue a un en-tête de 156 px calé sur celui de la boîte : le bouton ne bouge pas à l'ouverture) ; une boîte neuve est insérée dans la liste **avant** le dessin de ses pions (`renderCompact` lit `clientWidth`, nul pour un élément détaché : elle resterait vide jusqu'au tour suivant). **Infanterie manquante** : `.fw-need`, dans la rangée d'infanterie de chaque colonne, montré par `showNeed` pour la première ligne du joueur et ses boîtes quand la rangée est vide. **Statistiques de combat** : deux colonnes `.fw-gut` de 62 px (`gutter()`), contre la barre, avec par rangée de première ligne trois lignes `.fw-st` (attaque anti-infanterie, anti-armure, PV ; la ligne des PV est masquée, `off`, pour les niches d'appui-feu) ; trois totaux `.fw-tot` (icône, nombre, barre de 5 px) sous le titre de chaque première ligne (`totals()`), échelle commune aux deux camps ; calcul dans `frontstats.ts` à chaque `draw`. Les titres de colonnes font tous `--fw-lab-h` (74 px). `capFirstLine()` plafonne la première ligne du joueur à ce que le côté adverse peut porter (`--fw-first-max`, plancher 200 px : la seconde ligne rétrécit), et la zone `.fw-main` défile horizontalement (`.hscroll`) si le côté adverse déborde encore. Interrupteur « Sélection avancée » : `.fw-switch` (piste et pastille, CSS seul). **Percées en cours** (`.fw-bts`, sous le bandeau, masqué sans percée) : un petit tableau par percée de `FrontView.breakthroughs`, des deux camps :
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
- **Onglet des forces** (`forcestab.ts`, 05-Fronts §11.2), le détail de la deuxième section de la barre d'informations. Plus de bouton « RECRUTEMENT », de menu « + » ni de corbeille (08 §11) : les divisions apparaissent quand une usine ou une caserne en a la limite (08 §6). Réserve nationale en deux sections (`resSection`) :
  « FORMATION » (divisions `status === "formation"`, zone `"form"`) au-dessus de « RÉSERVE » (toutes les autres divisions de la réserve, zone `"res"`, seule
  section avec `data-drop="reserve"`) ; le libellé est un `.fx-mlab` (même style que les lettres du menu « + »), premier enfant de la section donc
  sous la zone des pions, couleur `--t-res-ink`. Dans chaque section, de vrais
  pions, un groupe par type (`renderZone` avec `wrap`, via `Dnd.zone(clé, true, true)`, redessinée si ses divisions ou sa largeur changent) :
  toujours déployée, jamais en mode « trop de pions » ; sans place sur une ligne, les piles passent sur plusieurs lignes (blocs par niche, une
  niche sur une ligne si possible ; un type trop long est tronqué avec un « + » en `.pz-num`, `layout.groups` garde tous ses ids) et la hauteur de la
  section (`ZoneLayout.height`) suit, ce qui repousse les fronts vers le bas. Sections de front : fronts en guerre active puis
  en paix, du plus long au plus court (`sortedFronts`), fond de la couleur de l'adversaire telle que la carte la montre sur un sol de mi-altitude (`playerOnLand`), contour de 3 px de sa couleur de frontière (`playerBorder`), carré de 32 × 32 px de statut
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
  Une division en formation montre la flèche verte vers le haut (statut `formation`, jusqu'à `formedTick`) et sa barre se remplit (`DivisionView.formed`, 30 marches, calculé depuis `formedTick` et `productionTurns`) ; une division en trop (`leaveTick`) clignote et montre la flèche rouge vers le bas.
- **Sélection et glisser-déposer** (`dnd.ts`, 05-Fronts §11.4) : une `ZoneView` regroupe les rangées d'une zone (une ligne d'un front, la
  réserve nationale) ; chaque rangée est un conteneur passé à `renderZone`, qui renvoie `groups` (ids par type, dans l'ordre de la pile) ; le pion
  sous la souris est lu dans l'événement (`.pz-pawn[data-id]`, le navigateur connaît l'ordre d'empilement des piles). Un redessin
  (`renderAll`, à chaque changement d'aperçu et à chaque tour) remplace le DOM de la rangée : le rectangle élargi du mode « trop de pions »
  (`.pz-open`, ouvert par `:hover`) serait refermé si la souris était hors du rectangle de base ; `renderZone` donne donc la classe `pz-keep` au
  nouveau `.pz-root` quand l'ancien était survolé ou `pz-keep`, et `pointerleave` du conteneur la retire. Mode simple : le survol
  donne l'aperçu (du début du groupe jusqu'au pion), le clic prend la sélection et lance le glisser. Mode avancé : premier clic = `anchor`
  (rectangle sur la division), la souris dessine l'aperçu jusqu'au pion survolé dans la même zone (`range` : ordre de lecture des rangées de
  la zone), second clic = sélection figée ; un clic sur un pion sélectionné lance le glisser. Seules les divisions `ready` ou `fleeing` sont
  prises (`movable`). Glisser : pion fantôme (`.dnd-ghost`, `renderZone` des divisions prises) dont le premier pion est centré sous la souris, curseur caché par `body.pw-moving`, cible = l'élément le plus proche portant
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
  `players[you].defeated`, affiche le bandeau `#spectator-badge`, désactive « Créer une ville »,
  désarme l'outil et supprime le menu de diplomatie au clic ; l'onglet Diplomatie ajoute « (éliminé) » (ligne grisée, ni clic ni mise en évidence). Les bots
  éliminés ne jouent plus (`bots.ts`).
- **Menu de diplomatie** (`diplomacy.ts`, 00-Game §1). Quand aucun outil n'est armé
  (pas « Créer une ville »), un clic sans glisser sur une
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
- **Panneau de debug** (`#panel`, auteur, 4 novembre 2026) : caché au départ ; le bouton
  « Panneau de debug », dernier élément de la barre de boutons (en bas à droite), l'ouvre ou le ferme
  (`aria-pressed`). Fermé, sa colonne a une largeur nulle et la carte prend la place. Contenu : population / capacité,
  agriculteurs, pêcheurs, inactifs, blessés, nourriture, villes, cultivé / max, pêché / max du joueur ; bloc
  développement (durées mesurées, pause, quitter). La liste des joueurs est dans l'onglet Diplomatie.
- **Case survolée** (`#hover-box`, dans `#stage`, auteur, 4 novembre 2026) : petit encadré
  en bas à droite de la vue de la carte, à gauche du panneau de production quand il est
  ouvert (`right: calc(12px + var(--prod-offset))`), `pointer-events: none`. Coordonnées,
  terrain et altitude, fertilité, fer, aluminium, propriétaire, ville, écrits par
  `showHover` (`main.ts`) ; affiché seulement quand la souris est sur une case et que le
  petit bouton « Cursor info » (`#cursor-info`, à droite de `#bar`, en dessous de l'encadré) est allumé. Le choix est gardé
  par la page (`foi.cursorInfo`).
- **Onglet Diplomatie** (`diplomacytab.ts`, sixième section de la barre d'informations, juste à droite de
  Forces) : bouton « Diplomatie » sans chiffre ni mini-barre ; détail : tableau des joueurs (couleur, nom,
  population, villes), le joueur local en gras. Les lignes sont construites une fois par partie et
  `DiplomacyTab.update` (appelé par `onTick`, détail ouvert ou non) n'écrit que les textes. Un clic sur la ligne
  d'un autre joueur ouvre le menu de diplomatie de ce joueur à côté de la souris (`Diplomacy.openFor`, comme un
  clic sur son territoire ; rien pour un spectateur, ni sur sa propre ligne). Le survol d'une ligne hachure en
  blanc le territoire terrestre du joueur sur la carte (`MapView.highlightPlayer`, même motif que la ville
  survolée du panneau de production) ; le masque est refait quand des cases changent (`upload`, `uploadAll`) ;
  la mise en évidence est retirée quand la souris quitte la ligne ou que le détail se replie
  (`Section.collapsed`). Le menu de diplomatie ouvert met en évidence son joueur de la même façon, jusqu'à sa
  fermeture (`Diplomacy.onTarget`) ; le survol d'une ligne de l'onglet est prioritaire.
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
  suit le même chemin. « Retour à l'accueil » abandonne le chargement. Une
  erreur avant le premier `init` (le Worker ne se charge pas, ou `onInit` lève
  une exception) ramène à l'accueil avec son texte : `#toast` est dans `#app`,
  caché tant que le lobby est affiché, et l'écran resterait sinon figé sans
  message.
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
- Bots : ils ne produisent ni machines ni divisions autres que la milice (stratégie minimale, §5).
- Icônes : un sous-dossier de `public/icons/` par famille : `population/`,
  `goods/` (machines), `armament/` (vide) et `miscellaneous/` (divers :
  `icon-padlock-closed.png`, le cadenas des boîtes verrouillées, et `icon-padlock-open.png`). Le nom du fichier d'une machine est
  le champ `icon` de sa section dans `config/goods.ts` (chemin relatif à
  `public/icons/`, facultatif) ; le moteur ne s'en sert pas. `activityCatalog()` le met dans `ActivityCatalog.icons`, `main.ts` le
  donne à `icons.ts` (`setProductIcons`) avant la construction des panneaux, et
  `productIcon(id)` renvoie l'image, ou le texte entre crochets de `names.ts`
  quand le bien n'a pas d'icône. Le fer et les icônes de la
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
- **Reconstruire le panneau de production à chaque tour** : un glisser de pions ou de boîte en cours serait détruit toutes les
  100 ms, et un ordre qui vient de partir ferait réapparaître l'ancien état. `ProductionPanel.update` compare une clé de
  structure, ne reconstruit pas pendant un glisser (`pawnDrag`, `boxDrag`) et retient la reconstruction après un ordre jusqu'à ce
  que la clé change ou que `HOLD_MS` passe. Le tutoriel consomme le `pointerdown` d'un composant non lu, pas le glisser qui suit.
- **Envoyer un glisser de pions plus gros que les places libres** : le moteur refuse tout l'ordre (08 §10). La page réduit le
  glisser à ce qui tient (`dropCount`) ; Blessés ne reçoit ni ne donne, et une machine hors de sa boîte n'est pas une cible.
- **Reconstruire la fenêtre d'un front ou l'onglet des forces à chaque message** : un bouton remplacé entre le `pointerdown` et le `click`
  perd le clic ; `FrontWindow` ne remplace que le contenu des rangées et des textes, et seulement si `fronts` ou `divisions` ont changé ; l'historique des combats, lui, n'est refait que si sa liste change (`historyKey`), sinon ses lignes clignotent très vite et le clic se perd ;
  `ForcesTab` compare une clé (identifiants, états, largeur).
- **`renderZone` remplace le contenu de son conteneur** (`innerHTML`) : les écouteurs sont sur le conteneur, jamais sur un pion, et le panneau
  de survol retrouve le pion par `ZoneView.pawnEl` (l'élément lu au survol a pu être remplacé par un changement d'aperçu).
- **Rendre une rangée dans un volet fermé** : `clientWidth` vaut 0. `ZoneView.render` saute alors la rangée ; le volet rend à l'ouverture
  (`toggle` appelle `body` après l'avoir affiché) et la clé de la réserve contient la largeur.
- **Fixer la largeur des colonnes d'un détail de la barre d'informations** (`.ib-pane`) : un texte plus long que la colonne (autre police,
  nombres à plus de chiffres) déborde et fait apparaître une barre de défilement horizontale. Le détail est une grille dont les colonnes
  étiquette et valeurs sont `max-content` ; les lignes (`.ib-row`) les partagent en `subgrid`, ce qui garde les barres alignées. Sa
  largeur est celle du contenu (minimum 640 px, 720 px pour les forces), plafonnée par `place()`, rappelé à chaque tour.
- **Mettre les panneaux de survol dans un conteneur à défilement** : ils seraient coupés ; ils sont sur `document.body`.
- **Peindre une ville prise comme une ville fondée** : `tileCity` ne change pas à une prise. `SoloGame` renvoie les cases de
  sa zone, `Mirror` retire la zone des histogrammes de l'ancien joueur avant de remplacer les villes, et la remet dans ceux du
  nouveau après ; sans cela, les rayons d'exploitation des deux joueurs seraient faux.
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
  reçu les `tiles`, `cities` ni `fronts` des tours sautés, qui ne
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
