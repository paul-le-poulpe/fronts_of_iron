# 07 — Tutoriel

Aide pour un nouveau joueur : des composants de l'interface ont un contour bleu
qui pulse ; un clic sur l'un d'eux ouvre une courte leçon sur ce composant.
Décidé avec l'auteur le 4 novembre 2026. Code : `client/src/tutorial.ts`,
styles dans `client/src/style.css`.

Aucune leçon n'invente de règle : elle explique ce qui est écrit dans
`00-Game.md` et les documents thématiques. Les textes sont relus avec l'auteur.

## Mécanisme

- **Marquer un composant** : l'attribut `data-tuto="<id>"`, écrit dans
  `index.html` ou par le code qui construit le composant. L'attribut reste posé
  quand la leçon est lue : un panneau reconstruit à chaque tour le retrouve, et
  rien n'est à retirer.
- **Contour** : tout `[data-tuto]` a un `outline` bleu (`--tuto`) qui pulse en
  fondu. `outline` ne change pas la taille du composant et ne touche pas au
  `box-shadow` rouge qui clignote sur les boutons d'attaque.
- **Leçons lues** : leurs ids sont gardés dans `localStorage`
  (`foi.tutorialSeen`, tableau JSON). Une feuille de style générée par
  `tutorial.ts` contient `[data-tuto="x"] { outline: none; animation: none }`
  pour chaque id lu. Stockage bloqué : les leçons ne sont gardées que pour la
  page en cours.
- **Premier clic** : un écouteur `pointerdown` en phase de capture sur `window`
  (avant les écouteurs du composant, glisser-déposer compris) cherche le plus
  proche ancêtre de la cible marqué d'une leçon existante et non lue. S'il y en
  a un, l'événement est consommé (`preventDefault`, `stopPropagation`), la leçon
  s'ouvre, et le `click` qui suit sur ce composant est consommé aussi : l'action
  du composant n'a pas lieu. Un `click` sans `pointerdown` (touche Entrée sur un
  bouton) ouvre aussi la leçon. Clic droit : pas de leçon.
- **Lue à l'ouverture** : la leçon est marquée lue dès qu'elle s'ouvre. Les
  clics suivants sur le composant sont normaux.
- **Encadré** (`#tuto`) : titre, paragraphes, bouton « Compris ». Placé sous le
  composant, ou au-dessus s'il n'y a pas la place. Fermé par « Compris », Échap,
  un appui ailleurs (cet appui-là n'est pas consommé), un redimensionnement de
  la fenêtre ou un défilement. L'infobulle de survol est cachée à l'ouverture.
- **Un id pour plusieurs composants** : tous les engrenages portent `gear`, tous
  les camemberts `pie`. Ils pulsent ensemble ; lire la leçon sur l'un les éteint
  tous.
- **Menu « Tutoriel »** (barre de boutons, à droite de « Production ») :
  « Revoir le tutoriel » remet toutes les leçons à lire, « Passer le tutoriel »
  les marque toutes lues.
- **Onglets du haut** : la barre d'informations a `overflow`, le contour de ses
  onglets est tracé à l'intérieur du bouton (`outline-offset` négatif). Un onglet
  se déplie déjà au survol : l'encadré de la leçon se pose par-dessus son détail.
- **Lettres d'une niche** (fenêtre d'un front) : leur rangée a `pointer-events:
  none` et `overflow: hidden`. Marquées, elles reçoivent `pointer-events: auto`
  et un contour à 1 px ; elles sont dans la marge droite de la rangée, que les
  pions ne couvrent pas. Seule la première ligne du joueur est marquée.

## Leçons

Les textes sont courts : une ou deux phrases. Tous sont provisoires, à relire.

| Id | Composant | Source |
| --- | --- | --- |
| `found` | bouton « Créer une ville » | 00-Game §3.2, §3.3 |
| `factory` | bouton « Inaugurer une usine » | 00-Game §1, §8 |
| `production` | bouton « Production » | 00-Game §8.1 |
| `prod-slider` | curseur de chaque rangée de bien (panneau de production) | 00-Game §8.1, §8.2 |
| `prod-plus` | boutons « + » (panneau de production) | 00-Game §8.2 ; 03-Client §2 (`burst.ts`, Maj et Ctrl) et §7 (ligne inactive) |
| `prod-growth` | jauge de croissance d'une rangée de machine (panneau de production) | 00-Game §8.2 (croissance automatique, arrêt à la demande) |
| `prod-locked` | rangée d'un bien verrouillé (panneau de production) | 00-Game §8.2 (déblocage) |
| `tab-pop` | onglet Population | 00-Game §4, §4.1 |
| `tab-food` | onglet Nourriture | 00-Game §4.1, §5 |
| `tab-flow` | onglet Ressources (flux) | 00-Game §5 |
| `tab-stock` | onglet Armement (stock) | 00-Game §8.3 |
| `tab-forces` | onglet Forces | 05-Fronts §11.2 |
| `tab-diplomacy` | onglet Diplomatie | 00-Game §1 (Diplomatie) |
| `gear` | engrenages des onglets Population, Nourriture, Ressources | 04-Tooltips (machines), 00-Game §5 |
| `pie` | camemberts du fer et de l'aluminium (onglet Ressources) | 03-Client §7 (infobulle du camembert) |
| `attack` | bouton « Attaque sur tout le front » (fenêtre d'un front) | 06-Combat-Simplifie §1 |
| `lines` | titres « Première ligne » et « Seconde ligne » du joueur | 05-Fronts §4.2 |
| `rapid` | titre « Réaction rapide » du joueur | 05-Fronts §4.6 ; 06 §1 point 5 |
| `pierce` | titre « Forces de percée » | 05-Fronts §4.6, §7.2 point 1 et 2 |
| `attack-types` | icônes des deux attaques, totaux du joueur (fenêtre d'un front, replay) | 05-Fronts §6.2 |
| `niche-infantry` | lettres de la niche infanterie, première ligne du joueur | 05-Fronts §3.4 (PV ×2 en défense, attaque ×0,3 à 0,8), §4.2, §7.2 ; 06 §1 |
| `niche-tanks` | lettres de la niche chars, première ligne du joueur | 05-Fronts §6.2 (partage des dégâts entre les lignes d'infanterie et de chars : précision de l'auteur, 4 novembre 2026, « les chars protègent l'infanterie en diluant les dégâts »), §6.3 |
| `niche-support` | lettres des trois niches d'appui-feu, première ligne du joueur | 05-Fronts §3.1, §6.3 |

La leçon de l'infanterie dit qu'elle défend mieux qu'elle n'attaque
(précision de l'auteur, 4 novembre 2026) : c'est l'effet des valeurs de
05-Fronts §3.4, pas une règle de plus.

Pas de leçon sur les PV (simples, décision de l'auteur, 4 novembre 2026), ni sur les lignes « Ouvriers / Fer suffisants » du panneau de production (auteur, 4 novembre 2026), ni sur le menu « Carte » (cases à cocher qui se lisent seules) ni sur
le bouton « Tutoriel » (la première pression ouvrirait une leçon au lieu du
menu qui sert à passer le tutoriel).

Les leçons `factory` et `production` décrivent les usines à lignes actuelles :
à réécrire quand les usines d'unités de `06-Combat-Simplifie.md` seront
implémentées.

## Provisoire

- Couleur du contour (`--tuto`, `#1e88e5`) et durée de la pulsation (1,6 s).
- Textes de toutes les leçons.
- Choix des composants marqués.

## Pas fait

- **Éléments de la carte** (villes, routes, fronts) : dessinés dans le canvas,
  le CSS ne peut pas les entourer. Il faudrait que `render.ts` dessine le
  contour.
- **Conteneurs en `overflow: hidden`** : ils coupent l'`outline` qui dépasse.
  Cas par cas : `outline-offset` négatif.
- **Ordre des leçons** : tous les composants marqués visibles pulsent en même
  temps (neuf au début d'une partie : trois boutons, six onglets ; douze
  éléments à la première ouverture d'une fenêtre de front). Un
  prérequis par leçon (« ne pulse qu'une fois X lue ») est possible si c'est trop
  chargé.
