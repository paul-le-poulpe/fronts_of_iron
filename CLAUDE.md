# Fronts of Iron — conventions du projet

Jeu de stratégie multijoueur dans le navigateur. **Parties courtes. Pas de
brouillard de guerre.** L'architecture réseau s'inspire d'OpenFront (lockstep) ;
**le jeu lui-même n'est pas OpenFront.**

**Les règles du jeu sont écrites avec l'auteur**, dans `Docs/Design/00-Game.md`
et dans les documents thématiques que 00-Game liste en tête. Tant qu'aucun de
ces documents ne tranche un point, aucune règle de jeu n'est implémentée ni
inventée — et rien n'est repris d'OpenFront « par défaut ».

**Où écrire une règle** :
- 00-Game est le point d'entrée : ce que le jeu est dans les grandes lignes,
  les règles qui n'ont pas de document à elles, et la liste des documents
  thématiques. Ne pas le surcharger : un domaine qui grossit (les fronts, par
  exemple) a son propre document, qui fait foi pour ce domaine.
- **Une règle n'est écrite qu'à un seul endroit.** 00-Game garde au plus un
  résumé du domaine et renvoie au document thématique.
- Un document thématique ne contient que l'état actuel des règles, sans
  historique. Les discussions et les règles remplacées vont dans un fichier
  `-History` (par exemple `05-Fronts-History.md`), qui **ne fait jamais foi** :
  ne jamais implémenter à partir de lui.
- Ce que l'auteur n'a pas tranché mais qu'il faut choisir pour implémenter est
  marqué « provisoire » dans le document et listé à part.

À lire avant de toucher au code :
- `Docs/Design/00-Game.md` — ce que le jeu est, et chaque action du joueur, qui
  devient un type d'ordre du moteur ; liste en tête les documents thématiques ;
- `Docs/Design/01-Architecture.md` — réseau, lobby, moteur : ce qui existe,
  pourquoi, et ce qu'une modification bien intentionnée casserait sans bruit ;
- `Docs/Design/03-Client.md` — le client : mode solo, messages avec le Worker,
  affichage, interface provisoire ;
- `Docs/Design/04-Tooltips.md` — feuille de route des infobulles des icônes ;
- `Docs/Design/05-Fronts.md` — fronts terrestres (version 1), document
  thématique qui fait foi : détection, unités, affectation des troupes,
  attaques, combat, avancée, prise de ville, encerclement, interface, et notes
  d'implémentation. Historique des discussions (ne fait pas foi) :
  `05-Fronts-History.md`.

---

## Structure

La racine du dépôt est ce dossier (`fronts_of_iron/fronts_of_iron/`, celui qui
contient `.git`), pas le dossier parent.

```
packages/
  shared/    formats des messages (ordre, tour, hash) — lus par client et serveur
  engine/    simulation déterministe ; ses règles viennent de Docs/Design/00-Game.md
client/      page du jeu (Vite + TypeScript) : interface + engine dans un Web Worker
worker/      Worker Cloudflare : sert client/ compilé + lobby (Durable Object)
server/      Node : relais des tours d'une partie, lancé sur le PC de l'hôte
.github/workflows/deploy.yml   build, puis wrangler deploy dans worker/
Docs/Design/                   documents de conception
README.md                      lancer et jouer en local ; héberger une partie
```

`README.md` s'adresse à quelqu'un qui veut jouer ou héberger, pas au
développement. Quand une commande de lancement change, ou quand le serveur de
partie existe, il est mis à jour dans le même tour (règle 8).

Les dossiers sont créés au fur et à mesure des parties ; ce qui n'existe pas
encore est listé dans `Docs/Design/01-Architecture.md` §9.

---

## Vérifier

Depuis la racine du dépôt, après `npm install` :

- `npm run typecheck` — typecheck TypeScript de tous les workspaces.
- `npm test` — tests de tous les workspaces. Pour le moteur : déterminisme
  (10 000 tours joués dans deux processus séparés → mêmes hashes), ordres
  invalides sans effet, et recherche des fonctions interdites par la règle 2
  dans `packages/engine/src`.
  Pour le client : partie solo et affichage (copie locale, peinture) sous Node,
  sans navigateur.
- `npm run dev -w client` — le client (mode solo contre des bots) sur
  `http://localhost:5173` ; `npm run build -w client` le compile dans
  `client/dist/`. Détail : `Docs/Design/03-Client.md`.
- `cd packages/engine && npm run bench` — temps moyen d'un tour et d'un hash
  sur la carte de test.
- `cd packages/engine && npm run viz:sea` — visualisation pas à pas des zones
  maritimes, écrite dans `packages/engine/out/sea-zones.html`. Réglages en
  argument : `npm run viz:sea -- --seed=7 --spacing=50`.
- `cd packages/engine && npm run viz:resources` — carte de présence du fer et
  de l'aluminium (une seule ressource par case), avec des curseurs pour leurs
  réglages, écrite dans `packages/engine/out/resources.html`. Autre graine :
  `npm run viz:resources -- --seed=7`. `npm run viz:iron` : le fer seul.
- `cd packages/engine && npm run viz:cities` — partie scriptée pas à pas :
  villes, zones, routes, ports, groupes, écrite dans
  `packages/engine/out/cities.html`.
- `cd packages/engine && npm run viz:fronts` — partie scriptée avec guerres :
  routes, connexions colorées par front, points du front, chaînes, fronts de
  chaque joueur, écrite dans `packages/engine/out/fronts.html`. Réglages en
  argument : `npm run viz:fronts -- --seed=7 --turns=5000 --every=250`.
- `cd worker && npx wrangler dev` — Worker et lobby en local sur
  `http://127.0.0.1:8787`. Le secret local vient de `worker/.dev.vars`
  (copier `worker/.dev.vars.example` ; fichier ignoré par git).
- Requêtes du lobby (format complet : `Docs/Design/01-Architecture.md` §4) :
  ```
  curl http://127.0.0.1:8787/api/games
  curl -X POST http://127.0.0.1:8787/api/games -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" -d '{"name":"Test","address":"https://a.trycloudflare.com","players":1,"maxPlayers":8}'
  curl -X POST http://127.0.0.1:8787/api/games/<id>/heartbeat -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" -d '{"players":2}'
  ```
- Après une modification de `worker/wrangler.toml` :
  `cd worker && npm run types` (régénère `worker-configuration.d.ts`).

wrangler n'est pas installé globalement : toujours `npx wrangler`.

---

## Règles

### 1. Rien n'est copié d'OpenFront

Le code d'OpenFront est sous AGPL-3.0, ses ressources (cartes comprises) sous
CC BY-SA 4.0. On reprend des **idées d'architecture**, décrites dans
`Docs/Design/01-Architecture.md` ; on n'importe ni code, ni carte, ni image, ni
texte. Pas de copier-coller « juste pour commencer ».

### 2. Le moteur est déterministe

Tous les navigateurs d'une partie calculent le même état à partir des mêmes
ordres. Un seul écart et les parties divergent sans erreur visible. Dans
`packages/engine` :

- pas de `Math.random()` : le hasard vient d'un générateur seedé stocké dans
  l'état de la partie ;
- pas de `Date.now()`, `performance.now()` ni minuterie : le temps est le numéro
  de tour ;
- pas de `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log` : leur résultat
  n'est pas garanti identique d'un navigateur à l'autre. Calculer en entiers ;
- pas de dépendance npm, pas d'accès au DOM, au réseau ni aux fichiers à
  l'exécution. Les réglages (`src/config/`, un fichier par thème) sont des
  modules TypeScript importés à la compilation, donc embarqués dans le bundle ;
  ne jamais les remplacer par un fichier lu ou téléchargé au lancement ;
- parcourir les collections dans un ordre fixé (tableaux, ou `Map`/`Set` dont
  l'ordre d'insertion est lui-même déterministe).

### 3. L'état de la partie ne passe jamais par le réseau

Seuls circulent : les ordres (client → hôte), les tours (hôte → clients), les
hashes d'état (client → hôte). Chaque client recalcule l'état lui-même.

### 4. Le moteur rejette les ordres invalides ; le serveur écrit l'expéditeur

Un ordre impossible (déplacer des troupes d'un autre joueur) est ignoré par le
moteur, donc par tous les clients de la même façon. Le serveur remplace
l'identifiant d'expéditeur d'un ordre par celui de la connexion qui l'a envoyé :
un client ne peut pas parler au nom d'un autre.

### 5. Le serveur est autonome

`server/` lit ses réglages dans des variables d'environnement (`PORT`, adresse
du lobby, secret du lobby) et ne lit aucun fichier en dehors de `server/`.
C'est ce qui permettra de l'héberger sur une vraie machine sans le remanier.

### 6. Aucun secret dans le dépôt

Jetons Cloudflare dans les secrets GitHub (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`), secret du lobby dans un secret du Worker et dans un
`.env` ignoré par git côté serveur. Un `account_id` dans `wrangler.toml` n'est
pas un secret.

### 7. Déploiement : suivre vitrine, ne rien inventer

Le modèle est `Projets code/Vitrine/vitrine/.github/workflows/deploy.yml` : à
chaque push sur `main`, une GitHub Action installe Node et wrangler, puis lance
`wrangler deploy` dans le dossier du Worker. La seule étape ajoutée ici est le
build du client (`npm ci` puis le build Vite) avant `wrangler deploy`, parce que
vitrine est en JavaScript brut et ce projet en TypeScript.

### 8. Mettre à jour la doc dans le même tour que le code

Quand une modification ajoute un système, change une règle écrite ici ou dans
`Docs/Design/`, ou corrige un bug qu'un retour en arrière réintroduirait, le
document concerné est mis à jour avant de terminer la tâche.
