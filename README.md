# Fronts of Iron

Jeu de stratégie multijoueur dans le navigateur. Parties courtes, pas de
brouillard de guerre. En cours de développement : les règles sont écrites au fur
et à mesure dans `Docs/Design/00-Game.md`, et les valeurs de réglage sont des
valeurs d'essai.

Ce qui se joue aujourd'hui : une **partie solo contre des bots**, entièrement
dans le navigateur (fonder des villes, faire croître sa population). Le
multijoueur est commencé : on peut créer une partie, la rejoindre et la lancer
depuis une salle d'attente, mais la partie en ligne elle-même (les tours) n'existe
pas encore.

---

## Jouer en local

### Prérequis

- [Node.js](https://nodejs.org/) 24 ou plus récent (testé avec 24.19), qui
  fournit `npm`.
- Le dépôt cloné :
  ```bash
  git clone https://github.com/paul-le-poulpe/fronts_of_iron.git
  cd fronts_of_iron
  ```

### Lancer

Depuis la racine du dépôt :

```bash
npm install
npm run dev -w client
```

`npm install` n'est nécessaire qu'une fois, puis après chaque modification de
`package.json`. La seconde commande démarre un serveur de développement (Vite)
et affiche son adresse, `http://localhost:5173`. Ouvrir cette adresse dans un
navigateur. `Ctrl + C` dans le terminal arrête le serveur. La page s'ouvre sur
l'accueil (liste des parties) ; le solo est dans la carte « Solo — débogage ».

**La page affiche une erreur de connexion** (« connexion refusée », « site
inaccessible ») : le serveur de développement n'est plus lancé, par exemple
parce que son terminal a été fermé. Relancer `npm run dev -w client` depuis la
racine du dépôt, puis recharger la page. Une partie déjà ouverte continue de
tourner sans le serveur, mais recharger la page la perd : elle n'existe que
dans la page.

Ce serveur ne fait que livrer la page. La partie elle-même se calcule dans le
navigateur : le moteur du jeu tourne dans un Web Worker de la page, qui joue un
tour toutes les 100 ms avec tes ordres et ceux des bots. Aucun serveur de
partie, aucun lobby, aucune connexion réseau pendant la partie.

### Jouer

- **Accueil** : « Lancer le solo » dans la carte « Solo — débogage » ouvre
  l'écran de départ.
- **Écran de départ** : choisir le nombre de bots (1 à 7) et la graine de la
  carte (même graine = même carte), puis « Jouer ».
- **Fonder une ville** : bouton « Créer une ville » en bas, puis clic sur la
  carte. La case survolée est verte si la fondation est permise, rouge sinon
  (la raison s'affiche dans la barre). Échap quitte ce mode.
  - La première ville se pose sur n'importe quelle terre libre ; elle est
    gratuite et devient ta capitale.
  - Les suivantes coûtent de la population et doivent être dans le rayon
    d'expansion d'une de tes villes (cercle affiché), hors de la zone de toute
    ville.
- **Fermiers et pêcheurs** : si ta population suffit à travailler tous tes
  champs et toute ta mer, les deux sont remplis. Sinon, le curseur du panneau
  de droite décide de la part qui cultive ; le reste pêche, si tes villes
  touchent l'eau.
- **Carte** : molette pour zoomer, glisser pour déplacer. Le panneau de droite
  décrit la case survolée.
- **Outils de développement** : bouton pause (pas une règle du jeu), `?step=20`
  à la fin de l'adresse pour un tour toutes les 20 ms au lieu de 100, et la
  barre « Debug » en bas à droite (« +1 000 population »), qui modifie la
  partie hors des règles.

L'interface est provisoire. Détail du client : `Docs/Design/03-Client.md`.

### Essayer le lobby et la salle d'attente en local

La liste des parties, la création d'une partie et la salle d'attente passent par
le Worker Cloudflare, qui tourne aussi sur ton PC. Depuis la racine du dépôt,
une compilation, puis deux terminaux :

```bash
npm run build -w client          # le Worker sert client/dist : à compiler une fois
cd worker && npx wrangler dev    # le Worker, à http://127.0.0.1:8787
npm run dev -w client            # la page, à http://localhost:5173
```

À faire une fois : copier `worker/.dev.vars.example` vers `worker/.dev.vars` (le
secret ne sert qu'aux serveurs d'hôte, pas à la création d'une partie depuis la
page).

Ouvrir `http://localhost:5173`, « Créer une partie », donner un nom de partie et
ton nom : tu entres dans la salle comme hôte (tu choisis la graine, « Lancer la
partie »). Pour un deuxième joueur, ouvrir la page dans **un autre navigateur ou
une fenêtre privée** (deux onglets du même navigateur partagent le nom et les
jetons gardés, donc le même joueur), puis « Actualiser » et « Rejoindre ».
Après le lancement, chacun voit un écran « Partie lancée » avec le message de
départ ; la partie en ligne n'est pas encore jouable.

### Vérifier

```bash
npm run typecheck
npm test
```

Autres commandes (visualisations du moteur, lobby en local) : `CLAUDE.md`,
section « Vérifier ».

---

## Héberger une partie

**Hébergée par Cloudflare** : depuis la page, « Créer une partie » (accueil), puis
la salle d'attente. Aucun serveur à lancer : la partie tourne dans le Worker
Cloudflare. La page du jeu et le lobby sont servis à
`https://fronts-of-iron.paul-raynaud.workers.dev` (le workflow de déploiement
compile le client et le publie avec le Worker). Un déploiement coupe les parties
Cloudflare en cours.

**Hébergée sur ton PC : pas encore possible.** Elle demande le serveur de partie
(`server/`), qui n'existe pas encore. Ce qui est prévu
(`Docs/Design/01-Architecture.md` §2 et §6) :

- L'hôte lance le serveur de partie (Node) sur son PC. Ce serveur ouvre un
  tunnel Cloudflare (`cloudflared`) qui lui donne une adresse publique en
  `https://`, et inscrit la partie au lobby.
- Les joueurs ouvrent la page, choisissent la partie dans la liste, et leur
  navigateur se connecte directement au serveur de l'hôte par le tunnel.

Cette section sera complétée avec les commandes exactes quand le serveur de
partie existera.
