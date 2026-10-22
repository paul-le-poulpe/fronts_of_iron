# 01 — Architecture

Ce qui est décidé, comment les morceaux communiquent, et pourquoi. Écrit avant
toute ligne de code : la section 9 dit ce qui existe réellement.

Référence d'inspiration : OpenFront (`github.com/openfrontio/OpenFrontIO`), lu
en octobre 2026. Rien n'en est copié (règle 1 du `CLAUDE.md`).

---

## 1. Les composants

| Composant | Où il tourne | Ce qu'il fait |
| --- | --- | --- |
| Worker | Cloudflare | sert la page du jeu (fichiers statiques de `client/` compilé) |
| Lobby | Cloudflare, un Durable Object unique | tient la liste des parties ouvertes et l'adresse de leur hôte |
| Tunnel | Cloudflare (`cloudflared` sur le PC de l'hôte) | donne une adresse `https://` publique au serveur de l'hôte et relaie ses WebSocket |
| Serveur | Node, sur le PC de l'hôte | relaie les ordres d'une partie, envoie un tour à chaque pas (100 ms par défaut) |
| Client | navigateur de chaque joueur | interface, et moteur dans un Web Worker |

## 2. Déroulement

1. **Déploiement.** Un push sur `main` lance la GitHub Action : build du
   client, puis `wrangler deploy` dans `worker/`. Le Worker et le lobby sont
   mis à jour.
2. **Inscription d'un hôte.** Le serveur Node démarre, lance `cloudflared`,
   obtient une adresse publique, et l'envoie au lobby avec le nom de la partie
   et le secret du lobby. Il renvoie un signal environ toutes les 30 s ; sans
   signal, le lobby retire la partie de la liste.
3. **Arrivée d'un joueur.** Le navigateur charge la page depuis le Worker,
   demande au lobby la liste des parties, reçoit pour chacune son nom, son
   nombre de joueurs et l'adresse de l'hôte.
4. **Partie.** Le navigateur ouvre un WebSocket vers l'adresse de l'hôte. Le
   lobby n'intervient plus jusqu'à la fin.

## 3. Le lockstep (modèle d'OpenFront)

- Le client n'envoie que des **ordres** : une action du joueur et ses
  paramètres. La liste des ordres est dans `00-Game.md` §9.
- Le serveur accumule les ordres reçus. À chaque **pas**, il crée
  `{ numéroDeTour, ordres }`, l'ajoute à la liste des tours de la partie, vide
  la file, et envoie ce tour à tous les clients.
- **Le pas** vaut 100 ms par défaut. C'est un réglage du serveur seulement (une
  variable d'environnement, règle 5 du `CLAUDE.md`) : le moteur ne compte que
  des tours et ne connaît pas leur durée. Changer le pas change la vitesse de
  la partie en temps réel, jamais ses résultats (`00-Game.md` §1.1).
- Chaque client applique les ordres du tour dans son moteur. Même état de
  départ, même graine, mêmes ordres dans le même ordre : même état d'arrivée.
- Tous les N tours, chaque client envoie au serveur un **hash** de son état. Le
  serveur garde le hash majoritaire et signale aux clients divergents qu'ils
  sont désynchronisés. (N reste à choisir ; voir §8.)
- **Reconnexion** : le client donne le numéro du dernier tour reçu, le serveur
  lui renvoie les tours suivants, le client les rejoue. Les parties étant
  courtes, rejouer depuis le début reste acceptable.
- **Pause, outil de développement seulement** : le serveur cesse d'envoyer des
  tours ; elle prend effet à la fin d'un tour. Commandée sur le serveur de
  l'hôte, jamais par un ordre de joueur : le jeu n'a pas de pause
  (`00-Game.md` §1.1).

Conséquence voulue : le serveur ne calcule rien, ne connaît pas l'état, et
reste léger. Conséquence acceptée : chaque client a l'état complet, donc pas de
brouillard de guerre fiable — le jeu n'en a pas.

Une partie se rejoue exactement à partir de : graine + carte + liste des tours +
commit git du moteur. C'est l'outil de débogage des désynchronisations.

## 4. Le lobby

Code : `worker/src/index.ts` (routes, secret, validation), `worker/src/lobby.ts`
(classe `Lobby`), `worker/wrangler.toml`.

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
| `GET /api/games` | non | — | `200 {"games":[{id,name,address,players,maxPlayers}]}` |
| `POST /api/games` | oui | `{name, address, players, maxPlayers}` | `201 {"id"}` |
| `POST /api/games/:id/heartbeat` | oui | `{players}` | `200 {"ok":true}`, ou `404 {"error":"unknown_game"}` |

- Secret : en-tête `Authorization: Bearer <LOBBY_SECRET>`. Absent ou faux :
  `401`. Si le Worker n'a pas de `LOBBY_SECRET`, `503` : rien ne s'inscrit.
  Comparaison en temps constant (`crypto.subtle.timingSafeEqual`).
- Validation : nom de 1 à 40 caractères ; adresse en `https://` (une page
  `https` ne joint l'hôte qu'en `wss`, §10) ; `0 ≤ players ≤ maxPlayers ≤ 1000`.
  Sinon `400`.
- L'hôte envoie un signal environ toutes les 30 s. Une partie dont le dernier
  signal date de plus de 90 s (`GAME_TTL_MS`) n'est plus listée.
- **Un `404` au signal veut dire : se réinscrire.** Il arrive quand la partie a
  expiré (hôte injoignable plus de 90 s) ou que l'identifiant est inconnu. Le
  serveur de partie (`server/`) doit alors refaire `POST /api/games` et garder
  le nouvel identifiant.

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
  - à venir (`00-Game.md` §12) : fertilité, un octet par case (0 à 10) ; un
    bit par ressource naturelle et par case.
- `owner` ne change que quand une ville est fondée (ou disparaît) : seules les
  cases à portée du rayon de contrôle de cette ville sont recalculées, et
  seules les cases modifiées sont transmises à l'affichage.
- Zones maritimes (`00-Game.md` §2.1) : une liste de points, calculée une fois
  à la génération par un module qui ne lit que le masque terre / eau ; il
  reste valable si le générateur de carte change.
- Pour commencer, une carte de test générée par le code. Les vraies cartes
  (image → fichier binaire, par un script) viendront plus tard.

## 6. Hébergement

- **Gratuit, Cloudflare** : page, lobby, tunnel.
- **Le PC de l'auteur** : le serveur de partie, tant que le jeu n'est pas en
  ligne. Doit rester allumé pendant les parties.
- **Plus tard** : le même `server/` sur une vraie machine. La règle 5 du
  `CLAUDE.md` existe pour ça.

## 7. Décisions écartées, et pourquoi

| Écarté | Raison |
| --- | --- |
| Partie dans un Durable Object | quotas quotidiens (messages entrants, durée active) épuisés en quelques heures de jeu à plusieurs |
| Render gratuit | arrêt après 15 min d'inactivité, environ 1 min pour redémarrer |
| UDP / hole punching | un navigateur ne peut pas faire d'UDP brut ; en lockstep chaque tour doit arriver, dans l'ordre, ce que TCP fait déjà |
| Serveur qui simule la partie | inutile sans brouillard de guerre ; garde le serveur léger |
| Docker, nginx, `cluster`, Traefik (comme OpenFront) | servent à faire tourner des centaines de parties sur plusieurs machines |

## 8. À vérifier ou à décider

- Fréquence N des hashes et coût en messages.
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
     parties, joueurs, adresse de l'hôte ; pas de jeu) ;
   - `.github/workflows/deploy.yml` : sur le modèle de vitrine, `wrangler
     deploy` dans `worker/`. Pas encore d'étape de build du client.

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
3. Moteur (`packages/engine`). **Fait, non commité : la partie qui ne dépend
   pas des règles** — carte (`terrain`, `owner`), carte de test générée,
   générateur aléatoire seedé dans l'état, application d'un tour avec
   validation des ordres et liste des cases modifiées, hash de l'état, tests
   de déterminisme. Un seul ordre, `demo_claim`, exemple jetable. Détail :
   `02-Engine.md`. **Les règles du jeu attendent `00-Game.md`.**
4. Serveur de partie (`server/`) et formats de messages (`packages/shared`).
   Ne dépend pas des règles : il relaie des ordres sans les lire.
5. Client (`client/`). Seul existe `client/public/icons/` : des icônes
   provisoires (carrés gris), que l'auteur remplace par ses dessins sous le
   même nom (00-Game §11). Pas encore de `package.json` : `client/` n'est pas
   un workspace npm.

## 10. Pièges

- Tout appel non déterministe dans `packages/engine` (règle 2) ne produit
  aucune erreur : il produit des parties qui divergent quelques minutes plus
  tard, seulement chez certains joueurs. Le hash du §3 est ce qui le détecte.
- Mettre l'état de la partie dans un message réseau « pour simplifier »
  supprime la raison d'être du lockstep et multiplie la bande passante.
- Les pièges propres au moteur (hash, ordres, numéros de tour) sont dans
  `02-Engine.md` §6.
- Une page servie en `https` ne peut pas ouvrir un WebSocket `ws://` : l'hôte
  doit être joint en `wss://`, ce que fournit le tunnel.
