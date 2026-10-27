# 01 — Architecture

Ce qui est décidé, comment les morceaux communiquent, et pourquoi. Écrit avant
toute ligne de code : la section 9 dit ce qui existe réellement.

Référence d'inspiration : OpenFront (`github.com/openfrontio/OpenFrontIO`), lu
en octobre 2026. Rien n'en est copié (règle 1 du `CLAUDE.md`).

---

## 1. Les composants

### Trois façons de jouer

Décidé par l'auteur le 27 octobre 2026 : les trois existent en même temps.

| Mode | Qui crée les tours | Réseau |
| --- | --- | --- |
| **Solo** (construit) — outil de débogage | le Web Worker du moteur, dans le navigateur du joueur, avec les bots | aucun |
| **Hébergé par un joueur** | `server/` (Node) sur le PC de l'hôte, joint par un tunnel Cloudflare | WebSocket vers l'adresse du tunnel |
| **Hébergé par Cloudflare** | un Durable Object par partie, dans le Worker | WebSocket vers `/api/games/:id/ws`, même origine que la page |

Le serveur Node fonctionne aussi sans tunnel (`ws://localhost`), pour un essai
en développement.

Le solo sert au débogage : il doit se comporter comme une partie en ligne. Il
crée donc ses tours avec le même relais (`packages/relay`, ci-dessous), compilé
dans le Web Worker : pas de serveur, pas de réseau, `npm run dev -w client`
suffit.

### Modules

Dans les trois modes, la même suite d'opérations crée un tour : rassembler les
ordres reçus, écrire dans chacun l'identifiant du joueur de la connexion
(règle 4), numéroter le tour, le garder dans la liste des tours. Elle est
écrite une seule fois, dans un module qui n'appelle aucune API de plateforme ;
chaque mode l'entoure d'une enveloppe qui fournit la minuterie et le transport.

| Module | Contenu | Dépend de |
| --- | --- | --- |
| `packages/engine` | le moteur (`02-Engine.md`) | rien |
| `packages/shared` | formats des messages et réglages communs. **Construit** : messages de la salle d'attente, entrée du lobby, réglages (100 joueurs, longueur des noms, cartes). À venir : ordres, tours, hashes | rien |
| `packages/relay` | le relais : file d'ordres, création du tour, expéditeur réécrit, liste des tours, tours manqués pour la reconnexion, hash majoritaire. Reçoit des messages, renvoie les messages à envoyer et à qui. **Construit** : la salle d'attente (`Room`, §4). Pas encore : tours, ordres, hashes | `shared` |
| `client/` (Web Worker) | applique les tours au moteur et fabrique les messages de la page ; reçoit ses tours d'une **source de tours** : locale (solo) ou WebSocket (en ligne) — `03-Client.md` §8 | `engine`, `shared`, `relay` (solo) |
| `server/` | enveloppe Node : serveur WebSocket, `setInterval`, `cloudflared`, inscription et signaux au lobby | `relay`, `shared` |
| `worker/` | page, lobby, et enveloppe Durable Object d'une partie : WebSocket, `setInterval`, inscription et signaux au lobby | `relay`, `shared` |

`packages/relay` ne lit ni horloge, ni réseau, ni fichier, ni variable
d'environnement, et n'importe rien de Node, de Cloudflare ou du navigateur :
c'est ce qui permet aux trois enveloppes de l'utiliser telle quelle. La durée
du pas est un réglage de l'enveloppe ; le relais crée un tour quand
l'enveloppe le lui demande.

### Où tourne chaque composant

| Composant | Où il tourne | Ce qu'il fait |
| --- | --- | --- |
| Worker | Cloudflare | sert la page du jeu (fichiers statiques de `client/` compilé) |
| Lobby | Cloudflare, un Durable Object unique | tient la liste des parties ouvertes, des deux modes en ligne |
| Partie Cloudflare | Cloudflare, un Durable Object par partie | relaie les ordres de la partie (`packages/relay`), envoie un tour à chaque pas |
| Tunnel | Cloudflare (`cloudflared` sur le PC de l'hôte) | donne une adresse `https://` publique au serveur de l'hôte et relaie ses WebSocket |
| Serveur | Node, sur le PC de l'hôte | relaie les ordres de la partie (`packages/relay`), envoie un tour à chaque pas (100 ms par défaut) |
| Client | navigateur de chaque joueur | interface, et moteur dans un Web Worker |

## 2. Déroulement

1. **Déploiement.** Un push sur `main` lance la GitHub Action : build du
   client, puis `wrangler deploy` dans `worker/`. Le Worker, le lobby et la
   classe des parties Cloudflare sont mis à jour (ce qui coupe les parties
   Cloudflare en cours, §6).
2. **Création d'une partie.**
   - Hébergée par un joueur : le serveur Node démarre, lance `cloudflared`,
     obtient une adresse publique, et l'envoie au lobby avec le nom de la
     partie et le secret du lobby.
   - Hébergée par Cloudflare : un joueur la crée depuis la page
     (`POST /api/games/cloudflare`) ; le Worker crée le Durable Object de la
     partie, qui crée le jeton d'hôte. Quand l'hôte entre dans la salle, le
     Durable Object s'inscrit au lobby par un appel interne au Worker (pas de
     secret). Son adresse est le chemin relatif `/api/games/:id/ws`. Détail :
     §4.

   Dans les deux cas, l'enveloppe renvoie un signal environ toutes les 30 s,
   avec le nombre de joueurs et l'état (`waiting` ou `started`) ; sans signal,
   le lobby retire la partie de la liste. Un même mécanisme pour les deux : un
   Durable Object de partie redémarré par un déploiement n'exécute aucun code
   de fin, et seule l'absence de signal le retire du lobby. Un Durable Object
   de partie n'envoie de signal que tant qu'une connexion est ouverte.
3. **Arrivée d'un joueur.** Le navigateur charge la page depuis le Worker,
   demande au lobby la liste des parties, reçoit pour chacune son nom, son
   nombre de joueurs et son adresse.
4. **Partie.** Le navigateur ouvre un WebSocket vers cette adresse. Le lobby
   n'intervient plus jusqu'à la fin.

## 3. Le lockstep (modèle d'OpenFront)

- Le client n'envoie que des **ordres** : une action du joueur et ses
  paramètres. La liste des ordres est dans `00-Game.md` §9.
- Le serveur accumule les ordres reçus. À chaque **pas**, il crée
  `{ numéroDeTour, ordres }`, l'ajoute à la liste des tours de la partie, vide
  la file, et envoie ce tour à tous les clients.
- **Le pas** vaut 100 ms par défaut. C'est un réglage de l'enveloppe, jamais
  du relais ni du moteur : variable d'environnement pour `server/` (règle 5 du
  `CLAUDE.md`), réglage du Worker pour une partie Cloudflare, `?step=` dans
  l'adresse pour le solo (`03-Client.md` §1). Le moteur ne compte que des
  tours et ne connaît pas leur durée. Changer le pas change la vitesse de
  la partie en temps réel, jamais ses résultats (`00-Game.md` §1.1).
- Chaque client applique les ordres du tour dans son moteur. Même état de
  départ, même graine, mêmes ordres dans le même ordre : même état d'arrivée.
- Tous les N tours, chaque client envoie au serveur un **hash** de son état. Le
  serveur garde le hash majoritaire et signale aux clients divergents qu'ils
  sont désynchronisés. (Choix de N : ci-dessous.)
- **Reconnexion** : le client donne le numéro du dernier tour reçu, le serveur
  lui renvoie les tours suivants, le client les rejoue. Les parties étant
  courtes, rejouer depuis le début reste acceptable.
- **Pause, par l'hôte seulement** (`00-Game.md` §1.1) : le relais cesse de
  créer des tours ; elle prend effet à la fin d'un tour. Elle est commandée
  par un message de pause ou de reprise que le relais n'accepte que de la
  connexion de l'hôte. Ce n'est pas un ordre du moteur : il n'entre dans aucun
  tour. Même mécanisme dans les trois modes ; en solo, le joueur est l'hôte
  (bouton de pause, `03-Client.md` §3).

Conséquence voulue : le serveur ne calcule rien, ne connaît pas l'état, et
reste léger. Conséquence acceptée : chaque client a l'état complet, donc pas de
brouillard de guerre fiable — le jeu n'en a pas.

Une partie se rejoue exactement à partir de : graine + carte + liste des tours +
commit git du moteur. C'est l'outil de débogage des désynchronisations.

### Fréquence des hashes (N)

Le hash ne sert qu'à détecter une désynchronisation : le moteur n'en a pas
besoin pour appliquer un tour. Envoyer un hash tous les N tours ne change pas
la cadence des tours (un toutes les 100 ms) ; une divergence est seulement
détectée jusqu'à N tours plus tard. Un client divergent n'est pas réparé, il
est signalé : quelques tours de retard ne changent rien.

Ce que coûte un hash :

- **Calcul** : 0,7 à 0,9 ms dans le navigateur de chaque joueur, contre 62 µs
  pour un tour moyen (`02-Engine.md` §8). `hashState` relit en entier `owner`
  et `tileCity` (un élément par case), alors qu'un tour ne touche que ce qui
  change. Même à chaque tour, ce serait moins de 1 % du pas de 100 ms : le
  calcul ne limite pas N.
- **Messages** : c'est ce qui limite N. Le hash est le seul message que chaque
  client envoie à intervalle fixe, quoi que fasse le joueur ; les ordres ne
  partent que quand le joueur agit (estimé à 0,5 par seconde et par joueur,
  non mesuré). Messages client → serveur, par joueur :

  | N | Hashes | Ordres | Total |
  | --- | --- | --- | --- |
  | 1 | 10 /s | ≈ 0,5 /s | ≈ 10,5 /s (95 % de hashes) |
  | 10 | 1 /s | ≈ 0,5 /s | ≈ 1,5 /s |

  Ce nombre compte pour les parties hébergées par Cloudflare : le Durable
  Object facture les messages qu'il reçoit (§6).

N n'est pas fixé. Les calculs de ce document prennent N = 10 (un hash par
seconde). Ne pas descendre à N = 1 « pour détecter plus tôt » : cela multiplie
les messages par 7 sans rien apporter au joueur.

## 4. Le lobby

Code : `worker/src/index.ts` (routes, secret, validation), `worker/src/lobby.ts`
(classe `Lobby`), `worker/src/game.ts` (classe `Game`, une partie Cloudflare),
`worker/wrangler.toml`. La salle d'attente elle-même est dans `packages/relay`
(`Room`), les formats dans `packages/shared`.

- **Un seul Durable Object** pour tout le jeu : le Worker obtient toujours la
  même instance par `env.LOBBY.getByName("lobby")`.
- **Pas KV** : une écriture KV met jusqu'à environ 60 s à être visible partout,
  et les signaux réguliers des hôtes consommeraient le quota d'écritures
  gratuit.
- **Stockage SQLite.** Sur le plan gratuit, seuls les Durable Objects à
  stockage SQLite existent (doc Cloudflare, page *Pricing*, vérifiée en
  octobre 2026). La classe est déclarée par `[exports.Lobby]` avec
  `type = "durable-object"` et `storage = "sqlite"` : la doc recommande ce
  champ pour un nouveau Worker et le dit incompatible avec l'ancien tableau
  `[[migrations]]` / `new_sqlite_classes`. Ne pas mélanger les deux.

### Requêtes

| Requête | Secret | Corps | Réponse |
| --- | --- | --- | --- |
| `GET /api/games` | non | — | `200 {"games":[{id,name,hostName,mode,address,map,seed,players,maxPlayers,state}]}` (les deux modes) |
| `POST /api/games` | oui | `{name, address, players, maxPlayers}`, et facultatifs `hostName, map, seed` | `201 {"id"}` |
| `POST /api/games/:id/heartbeat` | oui | `{players}`, et facultatifs `state, hostName, map, seed` | `200 {"ok":true}`, ou `404 {"error":"unknown_game"}` |
| `POST /api/games/cloudflare` | non | `{name}` | `201 {"id","hostToken"}`, ou `400 {"error":"invalid_game"}` |
| `GET /api/games/:id/ws` | non | — | WebSocket (101) ; `426` sans en-tête `Upgrade` ; `404` si la partie n'a pas été créée |

- Entrée de la liste (`LobbyEntry`, `packages/shared`) : `mode` vaut `cloudflare`
  ou `host` ; `address` est `https://…` (tunnel d'un hôte) ou le chemin relatif
  `/api/games/:id/ws` (partie Cloudflare) ; `state` vaut `waiting` ou `started` ;
  `seed` vaut `null` si l'hôte ne l'a pas donnée. Une inscription ou un signal à
  l'ancien format (sans les champs facultatifs) reste valide : l'entrée a alors
  `hostName` vide, `map` `test`, `seed` `null`, `state` `waiting`.
- Secret : en-tête `Authorization: Bearer <LOBBY_SECRET>`. Absent ou faux :
  `401`. Si le Worker n'a pas de `LOBBY_SECRET`, `503` : rien ne s'inscrit.
  Comparaison en temps constant (`crypto.subtle.timingSafeEqual`). La création
  d'une partie Cloudflare et le WebSocket n'ont pas de secret.
- Validation : nom de partie de 1 à 40 caractères ; nom d'hôte de 1 à 24 ;
  adresse en `https://` (une page `https` ne joint l'hôte qu'en `wss`, §10) ;
  `0 ≤ players ≤ maxPlayers ≤ 1000` ; `state` `waiting` ou `started` ; `map` une
  carte connue ; `seed` un entier de 0 à 2³² − 1. Sinon `400`. Les noms sont
  vérifiés par `normalizeGameName` et `normalizePlayerName` (`packages/shared`),
  les mêmes que ceux de la page et du relais.
- L'hôte envoie un signal environ toutes les 30 s. Une partie dont le dernier
  signal date de plus de 90 s (`GAME_TTL_MS`) n'est plus listée.
- **Un `404` au signal veut dire : se réinscrire.** Il arrive quand la partie a
  expiré (hôte injoignable plus de 90 s) ou que l'identifiant est inconnu. Le
  serveur de partie (`server/`) doit alors refaire `POST /api/games` et garder
  le nouvel identifiant. Une partie Cloudflare se réinscrit de la même façon,
  sous le même identifiant, par appel interne.

### Parties hébergées par Cloudflare

- Un Durable Object `Game` par partie, nommé par l'identifiant de la partie
  (`env.GAME.getByName(id)`). `POST /api/games/cloudflare` génère
  l'identifiant (UUID), appelle `create(id, name)` sur le Durable Object (appel
  RPC, pas de HTTP) et renvoie l'identifiant et le jeton d'hôte. Le Durable
  Object garde dans son stockage `{id, name, hostToken}`, de quoi retrouver la
  partie s'il quitte la mémoire ; il répond `404` à un WebSocket si ce
  stockage est vide, donc une adresse inventée ne crée rien.
- Le WebSocket est un WebSocket **standard** (`accept()`), pas l'API
  d'hibernation : le Durable Object reste en mémoire tant qu'une connexion est
  ouverte, ce qu'il lui faut pour son `setInterval`. Chaque message reçu (au
  plus 1 024 caractères, du JSON) est passé à `Room.handle` ; les messages
  renvoyés partent vers les connexions indiquées.
- **Inscription et signaux.** Le Durable Object s'inscrit au lobby
  (`registerCloudflare`, appel RPC sur le stub `env.LOBBY`, sans secret) dès que
  l'hôte est entré dans la salle : une partie sans hôte n'est pas listée. Il
  signale ensuite (`heartbeat`, avec `players`, `state`, `hostName`, `map`,
  `seed`) toutes les 30 s tant qu'au moins une connexion est ouverte, et tout de
  suite au lancement. Si le lobby répond « inconnue », il réinscrit la partie
  sous le même identifiant. Quand la dernière connexion se ferme, le
  `setInterval` s'arrête : plus de signal, le lobby retire la partie après 90 s,
  et la prochaine connexion la réinscrit. Un seul signal à la fois ; un
  signal demandé pendant un autre est rejoué ensuite avec l'état courant.
- **La salle est en mémoire.** Seuls l'identifiant, le nom et le jeton d'hôte
  sont dans le stockage. Une partie dont le Durable Object quitte la mémoire
  (plus aucune connexion) ou qu'un déploiement redémarre perd sa salle : joueurs,
  jetons des joueurs, lancement (§6). Sans tours en ligne, il n'y a rien d'autre
  à perdre ; quand les tours existeront, la liste des tours devra être
  persistée.
- Coût du signal : environ 60 requêtes pour 30 min.
- **Pas de limite** au nombre de créations (§8).

### Salle d'attente et lancement

Décidé par l'auteur le 27 octobre 2026. Fonctionnellement proche du lobby
d'OpenFront ; visuellement, pas forcément. Maquette : artifact « Fronts of
Iron — lobby » (accueil, rejoindre, créer, salle d'attente de l'hôte et d'un
joueur).

- **Toute partie en ligne a un hôte** : celui qui la crée depuis la page
  (partie Cloudflare) ou celui qui lance `server/` (partie sur son PC). Seul
  l'hôte choisit la carte et la graine, lance la partie, et la met en pause
  (§3).
- **Aucune partie ne se lance seule** : pas de partie créée ni lancée à
  intervalle régulier, contrairement à OpenFront.
- **Jusqu'à 100 joueurs**, sans réglage à la création. Chaque joueur donne son
  nom en rejoignant.
- **Pas d'arrivée après le lancement** (l'auteur : « si ça a un coût, ça ne
  vaut pas la peine »). Un joueur déjà inscrit qui s'est déconnecté revient
  par la reconnexion du §3.
- **Pas de bots en ligne** pour l'instant (`00-Game.md` §1.1).

Construit (octobre 2026), dans `packages/relay` (`Room`) et `packages/shared`
(messages) ; chaque enveloppe lui passe les messages reçus et envoie ce qu'elle
renvoie. Choix techniques, **provisoires** (non tranchés par l'auteur) :

- Le relais attribue les identifiants de joueur dans l'ordre d'arrivée dans
  la salle ; l'hôte est le joueur 1. Un joueur qui quitte la salle avant le
  lancement libère sa place ; les identifiants sont renumérotés au lancement,
  sans trou (le moteur attend `1..n`).
- Tant que la partie n'est pas lancée, le relais envoie à chaque changement
  l'état de la salle : joueurs (identifiant, nom, hôte), carte, graine.
- **Message de départ** : envoyé par le relais à tous les clients au
  lancement, avant le tour 1 : graine, réglages de la carte, liste des
  joueurs (identifiant, nom), identifiant du destinataire. Chaque client
  appelle `createGame` avec ces valeurs. C'est ce qui garantit que tous les
  moteurs partent du même état.
- **Reconnexion** : à l'arrivée dans la salle, le relais remet au joueur un
  jeton, que le navigateur garde (`localStorage`). Pour revenir, le client
  envoie le jeton et le numéro du dernier tour reçu ; le relais renvoie le
  message de départ puis les tours manquants. La liste des parties affiche
  « Reprendre » pour une partie lancée dont le navigateur a un jeton.
- **Hôte d'une partie sur un PC** : `server/` crée le jeton de l'hôte au
  démarrage et affiche dans sa console un lien vers la page qui le contient ;
  l'hôte ouvre ce lien pour entrer dans la salle comme hôte.
- **Entrée du lobby** : gagne un champ `state` (`waiting` ou `started`),
  envoyé avec le signal. Une partie lancée reste listée (pour « Reprendre »)
  mais ne peut pas être rejointe.

Messages de la salle (JSON, types dans `packages/shared/src/index.ts`, qui fait
foi pour les champs) :

| Sens | Message | Rôle |
| --- | --- | --- |
| client → relais | `join {name, token?}` | entrer dans la salle ; le jeton d'hôte, ou le jeton reçu à l'arrivée pour revenir (le nom est alors ignoré) |
| client → relais | `set_map {map?, seed?}` | hôte seulement ; `seed` : un entier, ou `"random"` (graine tirée par l'enveloppe) |
| client → relais | `start` | hôte seulement |
| relais → client | `welcome {token}` | à l'arrivée d'un nouveau joueur : le jeton à garder |
| relais → client | `room {you, players, map, seed}` | état de la salle, à chaque changement, à chaque joueur avec son propre `you` |
| relais → client | `start {you, map, seed, players}` | message de départ, au lancement et à chaque reconnexion après le lancement |
| relais → client | `error {code}` | `invalid_message`, `not_joined`, `already_joined`, `game_full`, `game_started`, `invalid_name`, `not_host`, `invalid_map`, `invalid_seed`, `replaced` |

Choix faits à l'implémentation, **provisoires** eux aussi :

- Le jeton d'hôte est créé avec la salle (`Room.hostToken`, par la fonction
  `newToken` de l'enveloppe) et sert de jeton au joueur 1 : le joueur qui entre
  avec lui est l'hôte, premier de la liste ; il revient avec lui, même après
  avoir quitté la salle. Sa place est réservée : les autres ne comptent que 99
  places tant qu'il est absent. Les autres joueurs reçoivent leur propre jeton.
- Avant le lancement, `id` est le rang dans la liste (hôte en premier, puis
  ordre d'arrivée) et change quand un joueur part : un client se reconnaît par
  `you`, jamais par un `id` gardé. Au lancement, ces rangs sont figés.
- Un joueur ordinaire qui quitte la salle avant le lancement perd sa place et
  son jeton : en revenant, il arrive comme un nouveau joueur. Après le
  lancement, ses place et jeton restent. Une deuxième connexion avec le même
  jeton remplace la première, qui reçoit `error replaced` et est fermée.
- Nom d'un joueur : 1 à 24 caractères après `trim` (comptés en points de
  code), sans caractère de contrôle. Graine : entier de 0 à 2³² − 1 ; celle
  d'une salle neuve est 12345. L'hôte peut lancer seul.
- Le `seed` du message de départ est la graine de la carte ; la graine de la
  partie (`createGame`) s'en déduit comme en solo (`03-Client.md` §4), côté
  client, quand le jeu en ligne existera.
- Les colonnes ajoutées à la table `games` pour ces champs (`mode`,
  `host_name`, `map`, `seed`, `state`) le sont par `ALTER TABLE` au démarrage
  du Durable Object si une lecture de la colonne échoue : une base créée par la
  version précédente est migrée sans perdre ses lignes.

### Mémoire du Durable Object : la liste est dans le stockage

Cloudflare retire de la mémoire un Durable Object inactif, et le redémarre à
chaque déploiement. Les champs de la classe sont alors perdus ; sa base SQLite
(`ctx.storage.sql`) ne l'est pas. La table `games` est donc dans la base, et la
classe n'a aucun champ qui contienne des parties.

Pourquoi ce choix plutôt qu'une liste en mémoire avec réinscription sur `404` :
avec une liste en mémoire, chaque déploiement viderait la liste, et les parties
ne réapparaîtraient qu'au signal suivant de leur hôte (jusqu'à 30 s pendant
lesquelles la page n'affiche rien). Le coût : chaque signal écrit une ligne. Le
`404` reste nécessaire pour les parties expirées.

Expiration : la liste filtre `last_seen` sans rien écrire (une requête publique
ne consomme pas d'écritures) ; les lignes expirées sont supprimées au début de
chaque inscription et de chaque signal.

Vérifié en local (`wrangler dev`) : la liste survit à l'arrêt et au redémarrage
du Worker.

Tests (`npm test -w worker`, sous Node, sans `wrangler dev`) : les routes, la
table des parties (dont la migration d'une table de la version précédente,
sur `node:sqlite`) et le Durable Object `Game` (WebSocket factices, minuterie
et heure de `node:test`) avec un `cloudflare:workers` remplacé. Ils ne
remplacent pas un essai avec `wrangler dev` et deux onglets : à faire à la
main (`CLAUDE.md`, section Vérifier).

### Quotas gratuits concernés

Par compte et par jour (partagés avec vitrine, même compte) : 100 000 requêtes
Worker, 100 000 requêtes Durable Object, 100 000 lignes écrites. Un hôte en
ligne envoie 2 880 signaux par jour (une requête Worker, une requête Durable
Object, une ligne écrite chacun) : environ 30 hôtes en ligne 24 h sur 24
épuiseraient le quota. La page d'accueil ne rafraîchit la liste qu'au clic pour
la même raison. Rien de tout cela n'est consommé pendant une partie.

## 5. La carte

Les règles viennent de `00-Game.md` (§2, §3.2, §12). Le territoire n'est pas
conquis case par case comme dans OpenFront : le propriétaire d'une case se
déduit des villes (rayon de contrôle, puis ville la plus proche).

- Une case par pixel. L'adresse d'une case est `y × largeur + x`.
- Tableaux plats, un élément par case, pas un objet par case :
  - `terrain` (`Uint8Array`) : terre, côte, océan, altitude sur 5 bits ;
  - `owner` (`Uint16Array`, 0 = personne) : **résultat calculé** à partir des
    villes, jamais modifié directement par un ordre ;
  - `resources` (`Uint8Array`) : un bit par ressource naturelle et par case
    (bit 0 : fer) ;
  - `tileCity` (`Uint16Array`, 0 = aucune) : ville dont la zone contient la
    case, terre et eau ;
  - à venir (`00-Game.md` §12) : fertilité, un octet par case (0 à 10).
- `owner` ne change que quand une ville est fondée (ou disparaît) : seules les
  cases à portée du rayon de contrôle de cette ville sont recalculées, et
  seules les cases modifiées sont transmises à l'affichage.
- Zones maritimes (`00-Game.md` §2.1) : une liste de points, calculée une fois
  à la génération par un module qui ne lit que le masque terre / eau ; il
  reste valable si le générateur de carte change.
- Pour commencer, une carte de test générée par le code. Les vraies cartes
  (image → fichier binaire, par un script) viendront plus tard.

## 6. Hébergement

- **Cloudflare, plan gratuit** : page, lobby, tunnel, parties hébergées par
  Cloudflare (quotas ci-dessous).
- **Le PC d'un joueur** : le serveur des parties qu'il héberge. Doit rester
  allumé pendant la partie. Ne consomme aucun quota Cloudflare pendant la
  partie (le tunnel n'est pas facturé), seulement les signaux au lobby (§4).
- **Plus tard, si besoin** : le même `server/` sur une vraie machine. La
  règle 5 du `CLAUDE.md` existe pour ça.

### Parties hébergées par Cloudflare : quotas

Quotas du plan gratuit (page *Pricing* des Durable Objects, vérifiée le
27 octobre 2026), par compte et par jour, partagés avec vitrine et le lobby :

- **100 000 requêtes.** Ouvrir un WebSocket compte pour une requête ; 20
  messages reçus par le Durable Object comptent pour une ; les messages qu'il
  envoie (les tours) sont gratuits. Les alarmes sont facturées comme des
  requêtes : la cadence des tours vient d'un `setInterval` dans le Durable
  Object, pas d'une alarme par tour.
- **13 000 GB-s de durée**, facturés à 128 Mo par Durable Object, soit environ
  29 h de Durable Object actif. La durée est comptée en temps réel tant que le
  Durable Object est en mémoire, même quand il attend : un Durable Object qui
  envoie un tour toutes les 100 ms n'hiberne jamais, toute la durée de la
  partie est facturée.

Partie de 30 min à 8 joueurs (messages par joueur : §3) :

| N | Requêtes par partie | Parties par jour (requêtes) | Parties par jour (durée) |
| --- | --- | --- | --- |
| 1 | ≈ 7 600 | ≈ 13 | ≈ 57 |
| 10 | ≈ 1 100 | ≈ 90 | ≈ 57 |

Avec N = 10, le plan gratuit suffit à quelques dizaines de parties par jour.
Plan payant (5 $ par mois minimum) : 1 million de requêtes et 400 000 GB-s
inclus par mois, soit environ 890 h de partie active. Quand le quota du jour
est épuisé, les parties hébergées par un joueur restent possibles.

**Un déploiement coupe les parties Cloudflare en cours** : il redémarre les
Durable Objects et ferme leurs WebSocket. Ne pas pousser sur `main` pendant
une partie Cloudflare ; pour qu'une partie survive au redémarrage, il faudrait
garder la liste des tours dans le stockage SQLite du Durable Object et que les
clients se reconnectent. Les parties hébergées par un joueur ne sont pas
touchées par un déploiement.

### Client : développé en local, servi par Cloudflare

Le client est développé sur le PC (`npm run dev`, Vite, `http://localhost`),
puis servi par le Worker. C'est le même code : Vite le compile en fichiers
statiques, que le Worker sert par `[assets]` (`worker/wrangler.toml`). Pour
que le passage de l'un à l'autre ne demande aucune modification du code :

1. **Le lobby est appelé par un chemin relatif** (`/api/games`), jamais par une
   adresse complète. En développement, Vite redirige `/api/*` vers
   `wrangler dev` (`http://127.0.0.1:8787`, réglage `server.proxy` de Vite).
   Sur Cloudflare, le Worker traite `/api/*` avant les fichiers statiques
   (`run_worker_first`).
2. **L'adresse du serveur de partie n'est jamais écrite dans le code.** Elle
   vient du lobby (`address`). Une adresse `https://` (tunnel) devient
   `wss://` ; un chemin relatif (partie Cloudflare) devient `wss://` suivi de
   l'hôte de la page et du chemin (`ws://` si la page est en `http`, en
   développement). Seul un essai direct sans tunnel utilise `ws://localhost`.
3. **Le moteur tourne dans un Web Worker créé par
   `new Worker(new URL("…", import.meta.url), { type: "module" })`** : Vite
   compile ce Worker de la même façon en développement et au build.
4. **Fait (octobre 2026).** `[assets] directory` de `worker/wrangler.toml` est
   `../client/dist`, le dossier compilé du client (`npm run build -w client`,
   ignoré par git) ; `worker/public/index.html` n'existe plus, son rôle (liste
   des parties) est l'accueil du client. Le workflow lance `npm ci` puis le
   build Vite avant `wrangler deploy` (règle 7 du `CLAUDE.md`).
   `run_worker_first = [ "/api/*" ]` couvre les requêtes du lobby et le
   WebSocket de `/api/games/:id/ws`. Sans `client/dist`, `wrangler dev` et
   `wrangler deploy` échouent : compiler le client d'abord.

**Mode solo contre des bots** (construit, `Docs/Design/03-Client.md`) : le
Web Worker du moteur crée lui-même un tour toutes les 100 ms avec les ordres du
joueur (champ `player` écrit par le Worker, règle 4) et des bots, sans serveur
de partie ni lobby. Il n'a besoin que de la page, servie en local ou par
Cloudflare. Il passera par `packages/relay` quand ce module existera (§1).

**Développement des deux modes en ligne** : `npx wrangler dev` exécute le
Worker, le lobby et les Durable Objects des parties, WebSocket compris, sur
le PC. Le serveur Node se lance sur le PC sans tunnel. Avec `npm run dev -w
client`, Vite redirige `/api/*` vers `wrangler dev`, **WebSocket compris**
(`ws: true` dans `vite.config.ts`).

## 7. Décisions écartées, et pourquoi

| Écarté | Raison |
| --- | --- |
| Render gratuit | arrêt après 15 min d'inactivité, environ 1 min pour redémarrer |
| UDP / hole punching | un navigateur ne peut pas faire d'UDP brut ; en lockstep chaque tour doit arriver, dans l'ordre, ce que TCP fait déjà |
| Serveur qui simule la partie | inutile sans brouillard de guerre ; garde le serveur léger |
| Docker, nginx, `cluster`, Traefik (comme OpenFront) | servent à faire tourner des centaines de parties sur plusieurs machines |

## 8. À vérifier ou à décider

- Fréquence N des hashes : analyse au §3 ; valeur non fixée.
- ~~Requêtes du lobby pour les parties hébergées par Cloudflare~~ Faites (§4).
- Qui peut créer une partie Cloudflare depuis la page, et combien à la fois :
  sans limite, n'importe quel visiteur peut épuiser le quota du jour (§6).
- Les Quick Tunnels (`*.trycloudflare.com`, sans compte) : limites, et prise en
  charge des WebSocket — non vérifiées.
- ~~Le compte Cloudflare utilisé~~ Décidé : le même que vitrine,
  `2808dbbc2de69c79fa846846b70c00ef`, écrit dans `worker/wrangler.toml`. Les
  quotas gratuits par compte sont donc partagés avec vitrine (§4).
- Format des messages : JSON pour commencer ; binaire seulement si la taille
  devient un problème.

## 9. État d'avancement

Ordre prévu :

1. **Fait et déployé (octobre 2026).** Worker + lobby (Cloudflare), et la
   GitHub Action de déploiement. Existe :
   - `package.json` racine, workspaces npm (`worker`) ;
   - `worker/` : `wrangler.toml`, `src/index.ts`, `src/lobby.ts`,
     `src/env.ts`, `public/index.html` (page d'accueil statique : liste des
     parties, joueurs, adresse de l'hôte ; pas de jeu). Ce dossier `public`
     a été supprimé depuis : le client le remplace (point 6) ;
   - `.github/workflows/deploy.yml` : sur le modèle de vitrine, `wrangler
     deploy` dans `worker/`. L'étape de build du client a été ajoutée depuis
     (point 6).

   Déployé le 20 octobre 2026 sur
   `https://fronts-of-iron.paul-raynaud.workers.dev`. En place : les secrets
   GitHub `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` du dépôt (ceux de
   vitrine ne sont pas visibles depuis ce dépôt), et le secret du Worker
   `LOBBY_SECRET`. Sa valeur n'existe que dans `server/.env` (ignoré par git,
   pour le serveur de la partie 3) ; pour la changer, réécrire ce fichier puis
   `npx wrangler secret put LOBBY_SECRET` dans `worker/`. Sans
   `LOBBY_SECRET`, inscriptions et signaux répondent `503`.
2. **En cours : `Docs/Design/00-Game.md`**, rédigé avec l'auteur dans une
   session dédiée. Le moteur en dépend. Décrits (octobre 2026) : villes et
   leurs rayons, population, agriculture et pêche, extraction, usines (en
   partie), zones maritimes (en partie), capitale et routes (en partie). Le
   reste est dans ses points ouverts (§13).
3. Moteur (`packages/engine`). **Fait (commit `cff9c88`) : la partie qui ne
   dépend pas des règles** — carte (`terrain`, `owner`), carte de test générée,
   générateur aléatoire seedé dans l'état, application d'un tour avec
   validation des ordres et liste des cases modifiées, hash de l'état, tests
   de déterminisme. Détail : `02-Engine.md`.

   **Fait (octobre 2026) : bloc villes** (00-Game §2, §3) — fer sur la carte,
   ordre `found_city` (seul ordre ; `demo_claim` supprimé), zones et `owner`,
   capitale, routes terrestres, ports, groupes. Pas encore : fertilité,
   population (croissance), agriculture, usines, routes maritimes.
4. Multijoueur (§1, Modules). Ne dépend pas des règles : le relais transmet
   des ordres sans les lire. Ordre de construction :
   1. `packages/shared` (formats) et `packages/relay` (relais), avec leurs
      tests sous Node. **Fait pour la salle d'attente** (point 6) ; les tours,
      les ordres et les hashes restent à faire ;
   2. le mode solo passe par `packages/relay` (source de tours locale,
      `03-Client.md` §8) : premier utilisateur du relais, sans réseau ;
   3. la source de tours WebSocket du client, et l'écran de lobby. **Écran de
      lobby fait** (point 6) ; la source de tours WebSocket reste à faire ;
   4. les deux enveloppes : `server/` (Node, tunnel) et le Durable Object de
      partie dans `worker/`, dans l'ordre que l'auteur choisira. **Le
      Durable Object `Game` est fait pour la salle d'attente** (pas de tours) ;
      `server/` n'existe pas encore ;
   5. un test qui joue la même suite d'ordres à travers les deux enveloppes et
      vérifie que les tours envoyés sont identiques.
5. Client (`client/`). **Fait : le mode solo** (octobre 2026), workspace npm,
   Vite, TypeScript : écran de départ, carte (zoom, déplacement), barre de
   boutons, panneau latéral, bots, moteur dans un Web Worker avec horloge de
   tour de 100 ms. Interface provisoire, en attendant celle de l'auteur.
   Détail : `03-Client.md`. Existe aussi `client/public/icons/` : des icônes
   provisoires (carrés gris), que l'auteur remplace par ses dessins sous le
   même nom (00-Game §11). Les règles de §6, Client, sont suivies (chemins
   `/api` relatifs, `server.proxy` de Vite, Worker créé par `new URL`) ; le
   point 4 (`[assets]`, page d'accueil du lobby, étape de build du workflow) est
   fait depuis (point 6) ; le jeu en ligne (tours par WebSocket) ne l'est pas.
6. **Fait (octobre 2026) : lobby et salle d'attente en ligne, jusqu'au message
   de départ** (pas encore de tours). Existe :
   - `packages/shared` (messages de la salle, `LobbyEntry`, réglages) et
     `packages/relay` (`Room`), avec leurs tests sous Node ;
   - `worker/src/game.ts` (Durable Object `Game`, une partie Cloudflare),
     `POST /api/games/cloudflare`, `GET /api/games/:id/ws`, table `games` étendue
     (§4), tests sous Node (`worker/test/`) ;
   - le client : accueil (liste, rejoindre, créer, solo), salle d'attente de
     l'hôte et d'un joueur, écran provisoire « Partie lancée »
     (`03-Client.md` §7) ;
   - `[assets]` sur `client/dist`, `worker/public` supprimé, étape de build du
     client dans le workflow (§6, Client, point 4).

   Pas fait : les tours en ligne (relais, source de tours WebSocket du client),
   `server/` (partie hébergée sur un PC), la pause, la limite de créations de
   parties Cloudflare (§8), l'aperçu de la carte (un emplacement vide), un essai
   de bout en bout avec `wrangler dev` et deux navigateurs.

## 10. Pièges

- Tout appel non déterministe dans `packages/engine` (règle 2) ne produit
  aucune erreur : il produit des parties qui divergent quelques minutes plus
  tard, seulement chez certains joueurs. Le hash du §3 est ce qui le détecte.
- Mettre l'état de la partie dans un message réseau « pour simplifier »
  supprime la raison d'être du lockstep et multiplie la bande passante.
- Les pièges propres au moteur (hash, ordres, numéros de tour) sont dans
  `02-Engine.md` §6.
- Une page servie en `https` ne peut pas ouvrir un WebSocket `ws://` : l'hôte
  doit être joint en `wss://`, ce que fournit le tunnel (une partie Cloudflare
  est sur l'origine de la page, donc aussi en `wss://`).
- Une API de plateforme dans `packages/relay` (`setInterval`, `Date.now()`,
  `ws`, `process.env`, un type Cloudflare) fonctionne dans l'enveloppe pour
  laquelle on l'a écrite et casse les deux autres. Ce qui dépend de la
  plateforme va dans l'enveloppe.
- Une règle de relais corrigée dans une enveloppe au lieu de `packages/relay`
  (par exemple l'ordre des ordres dans un tour) fait se comporter
  différemment les parties hébergées par un joueur et par Cloudflare. Le test
  du §9, point 4.5, le détecte.
- Une adresse complète écrite dans le client (`http://localhost:8787/api/…`,
  `ws://localhost:…`) fonctionne en développement et casse une fois la page
  servie par Cloudflare. Chemins relatifs pour le lobby, adresse du lobby pour
  le serveur de partie (§6, Client).
- `id` d'un joueur dans la salle : c'est son rang, renuméroté à chaque départ
  avant le lancement. Un client qui garde l'`id` d'un `room` précédent désigne
  un autre joueur ; il utilise `you` du dernier message.
- Le proxy de Vite sans `ws: true` laisse passer les requêtes `/api/*` mais pas
  le WebSocket : la salle d'attente échoue en développement, et fonctionne une
  fois déployée. Ne pas retirer l'option.
- `client/dist` est ignoré par git : un clone neuf sans `npm run build -w
  client` fait échouer `wrangler dev` et `wrangler deploy` (`[assets]` pointe
  dessus).
- Une colonne ajoutée à la table `games` ailleurs que dans `ADDED_COLUMNS`
  (`worker/src/lobby.ts`) plante le Durable Object du lobby sur une base
  existante (déploiement, `.wrangler/state` local) : `CREATE TABLE IF NOT
  EXISTS` ne modifie pas une table qui existe.
- Passer `Game` à l'API d'hibernation des WebSocket arrêterait son
  `setInterval` quand le Durable Object s'endort : plus de signal, la partie
  disparaîtrait du lobby avec ses joueurs encore connectés.
