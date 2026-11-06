# 09 — Couleurs des joueurs

Couleur de chaque joueur : carte, interface et icônes d'unités. Fait foi pour ce
domaine ; 00-Game §11 n'en garde qu'un résumé. La couleur ne concerne que
l'affichage : elle n'entre ni dans le moteur, ni dans le hash, ni dans les ordres.

**État** : implémenté. La liste du §2 est dans `client/src/playercolors.ts`, les
icônes d'unités prennent la couleur de leur propriétaire (§4), le joueur choisit
sa couleur dans la salle d'attente et le relais l'attribue (§5).

---

## 1. Principe

Un joueur a une seule couleur, choisie dans une liste fixe (§2). Elle donne :

- la couleur de carte, dont dérivent la frontière et la limite entre villes ;
- trois tons d'unité (foncé, moyen, clair), de la même teinte.

## 2. Liste des couleurs (provisoire)

Vingt entrées, réglées sur l'aperçu validé par l'auteur le 6 novembre 2026. Les
trois premières colonnes de valeurs sont les réglages ; les couleurs hexadécimales
en sont calculées (§3).

| N° | Nom | Teinte | Saturation | Clarté | Carte | Foncé | Moyen | Clair |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | Rouge | 0 | 0,70 | 0,50 | `#d92626` | `#7c3c3c` | `#ac5353` | `#c78a8a` |
| 2 | Bordeaux | 345 | 0,60 | 0,34 | `#8b233d` | `#42242b` | `#713d4a` | `#a6596c` |
| 3 | Orange | 25 | 0,80 | 0,52 | `#e77423` | `#885a3a` | `#b67c54` | `#cea88d` |
| 4 | Or | 45 | 0,75 | 0,50 | `#dfaf20` | `#7e6d39` | `#af9750` | `#c9b988` |
| 5 | Jaune | 56 | 0,75 | 0,55 | `#e2d736` | `#908b41` | `#b7b261` | `#d1cd99` |
| 6 | Olive | 70 | 0,45 | 0,40 | `#859438` | `#4c5133` | `#757d4f` | `#a0a876` |
| 7 | Citron vert | 90 | 0,60 | 0,48 | `#7ac431` | `#57713d` | `#7a9f56` | `#a3bf88` |
| 8 | Vert | 130 | 0,50 | 0,42 | `#36a147` | `#36593b` | `#508659` | `#79af82` |
| 9 | Sapin | 155 | 0,55 | 0,30 | `#227754` | `#1e342b` | `#376250` | `#55967b` |
| 10 | Turquoise | 175 | 0,60 | 0,42 | `#2baba1` | `#325d59` | `#4b8b86` | `#74b4af` |
| 11 | Cyan | 192 | 0,70 | 0,50 | `#26b5d9` | `#3c6f7c` | `#539aac` | `#8abbc7` |
| 12 | Azur | 210 | 0,70 | 0,52 | `#2f85da` | `#3f6183` | `#5a85af` | `#91adca` |
| 13 | Bleu | 225 | 0,65 | 0,45 | `#284dbd` | `#354269` | `#4d6098` | `#7b8bbc` |
| 14 | Marine | 228 | 0,55 | 0,28 | `#20306f` | `#1a1e2e` | `#343c5b` | `#515e8f` |
| 15 | Indigo | 255 | 0,55 | 0,45 | `#5334b2` | `#443965` | `#635392` | `#8e80b7` |
| 16 | Violet | 280 | 0,55 | 0,48 | `#9137be` | `#5f3f6f` | `#86599c` | `#ac8abc` |
| 17 | Magenta | 310 | 0,60 | 0,50 | `#cc33b2` | `#77406e` | `#a65999` | `#c28eba` |
| 18 | Rose | 335 | 0,75 | 0,68 | `#eb70a3` | `#9a4669` | `#bc6c8d` | `#d6a4b9` |
| 19 | Marron | 25 | 0,45 | 0,33 | `#7a4e2e` | `#3b2f26` | `#675141` | `#997861` |
| 20 | Gris | 210 | 0,06 | 0,50 | `#788087` | `#595c5f` | `#7c8083` | `#a6a8ab` |

Couleurs proches, à revoir si besoin : Orange et Or, Bleu et Indigo, Violet et
Magenta sur les unités ; Marine et Gris sur la carte.

## 3. Calculs et réglages

Tous ces nombres sont provisoires. Pour une entrée de teinte `h`, saturation `s`
et clarté `l` :

| Couleur | Calcul |
| --- | --- |
| Carte | `hsl(h, s, l)` |
| Case de territoire | 60 % de la couleur du terrain, 40 % de la couleur de carte (`TERRITORY_ALPHA`, `painter.ts`) |
| Frontière | `hsl(h, s, l − 0,13)` |
| Limite entre villes | `hsl(h, s, l + 0,13)` |
| Villes et routes | `hsl(h, s + 0,05, l − 0,25)`, clarté d'au moins 0,15 |
| Ton moyen d'unité | `hsl(h, s × 0,5, m)`, avec `m` = `l` ramené entre 0,28 et 0,58 |
| Ton foncé d'unité | `hsl(h, s × 0,5, m − 0,14)` |
| Ton clair d'unité | `hsl(h, s × 0,5, m + 0,16)` |

Effet de chaque réglage :

- **Facteur de saturation des unités (0,5)** : à 1, les unités sont vives et se
  distinguent mieux, mais tranchent sur le gris et le noir du dessin (saturation
  des verts d'origine : environ 0,16). À 0,5, elles s'y intègrent mieux, et les
  couleurs voisines se ressemblent davantage.
- **Bornes de `m` (0,28 et 0,58)** : la borne basse garde les tons foncés visibles
  contre le contour noir ; la borne haute garde le ton clair sous le blanc.
  Une borne haute à 0,50 fait sortir le Rose nettement plus sombre que sa couleur
  de carte.
- **Écarts −0,14 et +0,16** : contraste des ombres et des lumières de l'icône.
  Dans les verts d'origine, les écarts sont d'environ −0,09 et +0,13.

## 4. Icônes de remplacement

`client/public/icons/units-generated/` contient une copie de chaque icône d'unité.
Le dossier est généré : on n'y dessine pas. Les originaux de l'auteur restent dans
`client/public/icons/armament/`, que le script ne modifie pas. Les PNG générés sont
committés, le déploiement n'a donc pas à lancer le script.

```
npm run icons:units -w client
```

Le script `client/scripts/unit-icons.ts` remplace chaque pixel de ton exact par une
couleur de remplacement, toujours la même pour un rôle donné :

| Rôle | Remplacement | Chars, blindés, 16 px | Pièces tractées 32 px | Infanterie |
| --- | --- | --- | --- | --- |
| Foncé | `#ff00ff` | `#334636` | `#29341f` | `#1a4a20` |
| Moyen | `#00ffff` | `#47614b` | `#445632` | `#24682d` |
| Clair | `#00ff00` | `#648869` | `#65804a` | aucun |

Tout autre pixel est conservé : noir, gris, jaune des obus, rouge des épaulettes et
du béret d'élite, cheveux de la milice. Le script échoue si une icône contient un
pixel semi-transparent, contient déjà une couleur de remplacement, ou n'a aucun ton
à remplacer.

**À refaire quand une icône change** : après une modification dans `armament/`,
relancer le script. Un nouveau vert ne sera pas remplacé tant qu'il n'est pas dans
`TONES` ; une nouvelle icône doit être ajoutée à `FILES` et à `UNIT_ICON_FILES`
(`client/src/uniticons.ts`), sinon elle reste verte.

**À l'exécution** (`client/src/uniticons.ts`) : `preloadUnitIcons`, au chargement de
la page, lit les pixels de chaque PNG dans un canvas. `unitIconUrl(path, player)`
copie ces pixels, remplace les trois couleurs par les tons du joueur, et renvoie une
URL `data:` gardée par icône et par couleur. L'appel est synchrone. Une icône demandée
avant la fin de la lecture, ou absente de la liste, est l'icône verte d'origine. Les
pions, les étiquettes de nombre, les infobulles, les percées et le replay prennent la
couleur du propriétaire de la division ; le panneau de production celle du joueur de
la page.

## 5. Choix de la couleur (décidé par l'auteur, 6 novembre 2026)

- La couleur se choisit dans la salle d'attente, pas sur l'accueil : c'est là qu'on
  sait quelles couleurs les autres joueurs ont prises. Une pastille montre la couleur
  du joueur ; un clic ouvre toutes les couleurs de la liste.
- Deux joueurs d'une même salle n'ont pas la même couleur tant que la liste n'est pas
  épuisée. Les couleurs prises sont grisées, et leur survol donne le nom du joueur.
- En entrant dans une salle, le joueur reçoit la dernière couleur qu'il a choisie si
  elle est libre, sinon la première libre. Au-delà de vingt joueurs, les doublons sont
  permis.
- La couleur ne change plus après le lancement.
- Solo : pas de salle d'attente. L'écran de départ, où l'on règle le nombre de bots,
  donne une ligne au joueur et une à chaque bot, avec une couleur à choisir par ligne.
  Une couleur prise par une autre ligne n'est pas proposée.

Implémentation :

- Le dernier choix est gardé dans le navigateur (`savePlayerColor`). `join` l'envoie ;
  `Room` appelle `pickPlayerColor` (`packages/shared`). Une valeur invalide dans `join`
  vaut une absence de choix, sans erreur.
- Dans la salle, `set_color` demande une couleur. Le relais répond par `room`, ou par
  l'erreur `color_taken` (un autre joueur l'a prise entre-temps), `invalid_color` ou
  `game_started`, affichée dans la salle.
- `room` et `start` portent la couleur attribuée à chaque joueur. Le relais ne connaît
  que le nombre de couleurs (`PLAYER_COLOR_COUNT`), pas leurs valeurs.
- La couleur d'un joueur parti de la salle redevient libre. À la reconnexion, la couleur
  demandée est ignorée.
- `Game` met les couleurs dans `InitMessage.playerColors` ; la page les donne à
  `setPlayerColors` avant de créer le `Painter`. Hors partie, `playerColorIndex`
  retombe sur un calcul depuis l'identifiant.
- Solo : le message `start` du Worker porte `colors`, le joueur puis les bots. Un bot
  ajouté au formulaire reçoit par défaut `(id × 3) modulo 20`, ce qui écarte les couleurs
  de deux bots voisins, ou la première libre si elle est prise. Seule la couleur du
  joueur est gardée dans le navigateur.
