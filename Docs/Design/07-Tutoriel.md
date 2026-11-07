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
- **Un id pour plusieurs composants** : tous les camemberts portent `pie`, toutes les boîtes
  du panneau de production `prod-box`, tous les pions `prod-pawn`. Ils pulsent ensemble ; lire la
  leçon sur l'un les éteint tous. Les ids s'emboîtent : un pion est dans une boîte, et sa leçon passe
  avant celle de la boîte.
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
| `found` | bouton « Créer une ville » | 00-Game §3.2, §3.3 ; 08 §10 (coût en bonshommes d'Inactifs) |
| `production` | bouton « Production » | 08 §11 |
| `prod-box` | chaque boîte d'activité (panneau de production) | 08 §2 (ordre et priorité), §11 (entrée, sortie, poignée) |
| `prod-pawn` | chaque pion saisissable d'une boîte | 08 §6 (à venir, en sursis), §7 (places vides), §11 (glisser) |
| `prod-parent` | cadenas ouvert d'une boîte parente | 08 §9, §11 |
| `prod-locked` | boîte verrouillée | 08 §9, §11 |
| `tab-flow` | onglet Ressources (flux) | 08 §4 (fer) |
| `tab-forces` | onglet Forces | 05-Fronts §11.2 |
| `tab-diplomacy` | onglet Diplomatie | 00-Game §1 (Diplomatie) |
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

Pas de leçon sur les PV (simples, décision de l'auteur, 4 novembre 2026), ni sur l'en-tête du panneau de production (population / capacité, fer réservé / produit), ni sur le menu « Carte » (cases à cocher qui se lisent seules) ni sur
le bouton « Tutoriel » (la première pression ouvrirait une leçon au lieu du
menu qui sert à passer le tutoriel).

Retirées avec les éléments qui disparaissent (08, 5 novembre 2026) : `factory` (bouton « Inaugurer une usine »),
`prod-slider`, `prod-plus`, `prod-growth` (lignes d'usine), `tab-pop`, `tab-food`, `tab-stock` (onglets Population,
Nourriture, Armement) et `gear` (engrenages de mécanisation). Les leçons des boîtes, des pions et du déblocage sont
nouvelles : textes à relire avec l'auteur.

## Provisoire

- Couleur du contour (`--tuto`, `#1e88e5`) et durée de la pulsation (1,6 s).
- Textes de toutes les leçons.
- Choix des composants marqués.

## À expliquer aux joueurs

Points de jeu à couvrir quand le tutoriel sera repris. Les quatre premiers n'ont pas de leçon.

- Les flèches de production visée des casernes et des usines d'armement, avec Maj et Ctrl.
- Les croix sur les ouvriers et les machines, et la réactivation par un clic sur une croix.
- Les lignes débloquées qui clignotent, la croix qui supprime une ligne et sa remise en liste.
- La priorité entre les lignes : une ligne qui a de la place prend les ouvriers des lignes plus basses.
- Le menu « Options » et la taille des icônes. Une infobulle le montre déjà au passage en petites
  icônes, à 50 de population (`08-Population.md` §11).

## Auto-assignation pendant le tutoriel (prévu)

- Au début d'une partie avec le tutoriel, l'auto-assignation est désactivée pour le joueur.
- Quand sa population dépasse un seuil, à fixer, une petite fenêtre lui explique l'auto-assignation.
- Pour l'instant, et pour les joueurs qui désactivent le tutoriel, elle est activée par défaut
  (`08-Population.md` §7 bis).

## Pas fait

- **Éléments de la carte** (villes, routes, fronts) : dessinés dans le canvas,
  le CSS ne peut pas les entourer. Il faudrait que `render.ts` dessine le
  contour.
- **Conteneurs en `overflow: hidden`** : ils coupent l'`outline` qui dépasse.
  Cas par cas : `outline-offset` négatif.
- **Ordre des leçons** : tous les composants marqués visibles pulsent en même
  temps (sept au début d'une partie : deux boutons, trois onglets, les boîtes et leurs pions ; douze
  éléments à la première ouverture d'une fenêtre de front). Un
  prérequis par leçon (« ne pulse qu'une fois X lue ») est possible si c'est trop
  chargé.
