# Fronts of Iron

Jeu de stratégie multijoueur dans le navigateur. Parties courtes, pas de
brouillard de guerre. En cours de développement : les règles sont écrites au fur
et à mesure dans `Docs/Design/00-Game.md`, et les valeurs de réglage sont des
valeurs d'essai.

Ce qui se joue aujourd'hui : une **partie solo contre des bots**, entièrement
dans le navigateur (fonder des villes, faire croître sa population). Le
multijoueur n'existe pas encore.

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
navigateur. `Ctrl + C` dans le terminal arrête le serveur.

Ce serveur ne fait que livrer la page. La partie elle-même se calcule dans le
navigateur : le moteur du jeu tourne dans un Web Worker de la page, qui joue un
tour toutes les 100 ms avec tes ordres et ceux des bots. Aucun serveur de
partie, aucun lobby, aucune connexion réseau pendant la partie.

### Jouer

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
- **Fermiers et pêcheurs** : le curseur du panneau de droite règle la part de ta
  population qui cultive ; le reste pêche, si tes villes touchent l'eau.
- **Carte** : molette pour zoomer, glisser pour déplacer. Le panneau de droite
  décrit la case survolée.
- **Outils de développement** : bouton pause (pas une règle du jeu), et `?step=20`
  à la fin de l'adresse pour un tour toutes les 20 ms au lieu de 100.

L'interface est provisoire. Détail du client : `Docs/Design/03-Client.md`.

### Vérifier

```bash
npm run typecheck
npm test
```

Autres commandes (visualisations du moteur, lobby en local) : `CLAUDE.md`,
section « Vérifier ».

---

## Héberger une partie

**Pas encore possible.** Le multijoueur demande deux pièces qui n'existent pas
encore : le serveur de partie (`server/`) et l'écran de lobby du client.

Ce qui est prévu (`Docs/Design/01-Architecture.md` §2 et §6) :

- La page du jeu et le lobby (liste des parties ouvertes) sont servis par
  Cloudflare, à `https://fronts-of-iron.paul-raynaud.workers.dev`. Le lobby y
  tourne déjà ; la page du jeu n'y est pas encore publiée.
- L'hôte lance le serveur de partie (Node) sur son PC. Ce serveur ouvre un
  tunnel Cloudflare (`cloudflared`) qui lui donne une adresse publique en
  `https://`, et inscrit la partie au lobby.
- Les joueurs ouvrent la page, choisissent la partie dans la liste, et leur
  navigateur se connecte directement au serveur de l'hôte par le tunnel.

Cette section sera complétée avec les commandes exactes quand le serveur de
partie existera.
