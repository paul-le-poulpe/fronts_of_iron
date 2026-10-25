# Infobulles des icônes — feuille de route

Chaque icône du jeu (arme, bien, ressource, métier, type d'usine) aura à terme
sa propre infobulle construite (`setTip` de `client/src/tooltip.ts`, contenus
dans `client/src/goodtips.ts`). Mécanisme et affichage : 03-Client.md
(« Infobulles construites »). Ce document liste ce qui existe et ce qui reste.

Aucune infobulle n'invente de règle : elle affiche des valeurs du catalogue
(envoyé une fois) et des statistiques du dernier tour, calculées par le moteur.
Tant que 00-Game ne décrit pas l'usage d'une chose (les armes, par exemple),
son infobulle ne dit que ce qui est écrit.

## Forme commune

Modèle : l'infobulle du tracteur (validée par l'auteur, 24 octobre 2026).

1. Titre : le nom de la chose.
2. Une phrase : à quoi elle sert, en termes de mécanisme.
3. Section « règles » : les valeurs fixes de la configuration qui donnent son
   effet (par exemple, surface par fermier sans tracteur et au maximum).
4. Section « Votre nation » : les nombres du dernier tour, avec des barres.

Couleurs des barres :
- **vert** (`--ok`) : remplissage d'une jauge d'effet (part du gain possible
  atteinte). Chaque barre a un libellé à gauche ; la jauge des machines est
  l'engrenage (`public/icons/miscellaneous/misc-gear-stolen.png`) suivi de
  « Mécanisation » ;
- **couleur du métier** concerné, celle du détail Population (`--occ-farm`,
  `--occ-fish`, `--occ-mine`, `--occ-factory`, `--occ-idle`) : la barre de ce
  que ce métier produit ou travaille (surface cultivée, surface pêchée, cases de
  fer exploitées).

## Faites

| Icône | Contenu | Barres |
| --- | --- | --- |
| `[tracteur]` | surface par fermier sans tracteur / au maximum ; fermiers, tracteurs utilisés / d'une mécanisation totale | jauge verte surface par fermier ; surface cultivée / cultivable (`--occ-farm`) |
| `[bateau de pêche]` | surface par pêcheur sans bateau / au maximum, rendement d'une case d'eau sans bateau / au maximum ; pêcheurs, bateaux utilisés / d'une mécanisation totale | jauge verte surface par pêcheur ; surface pêchée / pêchable (`--occ-fish`) |
| `[pompe à vapeur]` | texte : valable pour tous les minerais, répartition proportionnelle aux mineurs (00-Game §7) ; cases par mineur sans pompe / au maximum ; mineurs, pompes utilisées / d'une mécanisation totale | jauge verte cases par mineur ; cases de fer exploitées / cases de fer (`--occ-mine`) |

Ces trois infobulles sont posées sur chaque symbole du bien dans la barre
d'informations (détail Ressources) et dans le panneau de production.

Types d'usine, dans le menu « Inaugurer une usine » (validé par l'auteur sur
maquette, 25 octobre 2026) : au survol d'un choix, l'**arbre de progression**
du type, à droite du menu. Forme différente du modèle du tracteur : en-tête
« \<type\> : arbre de progression », puis l'arbre en liste indentée, traits en
coude, une icône et un nom par bien, la racine en gras avec « production de
base ». Pas de règle ni de nombre : la condition de déblocage est la même
partout (`FACTORY.unlockTurns`), l'afficher n'apprend rien. Détail :
03-Client.md (« Inaugurer une usine »).

## À faire

Ordre proposé ; le contenu exact de chacune est à valider avec l'auteur comme
pour le tracteur.

### Ressources
- `[fer]` (détail Ressources, panneau de production) : à quoi sert le fer (les
  lignes en consomment), capacité par case ; fer extrait / demandé, capacité.
- Blé et poisson (lignes Agriculture et Pêche du détail Nourriture, pas encore
  d'icône) : nourriture, population maximale (00-Game §4.1).

### Métiers (icônes de `public/icons/population/`)
- Ouvriers d'usine, mineurs, fermiers, pêcheurs, inactifs (détail Population) :
  ce que fait le métier, comment il est rempli (00-Game §4 : lignes d'abord,
  puis fermiers et pêcheurs, puis inactifs), nombre et part.
- `pop-sailor`, `pop-soldier`, `pop-fisherman-beard` : fichiers présents, pas
  encore utilisés ; pas d'infobulle avant que le métier existe.

### Armement
- `[fusil]`, `[mitrailleuse]`, `[artillerie]`, `[canon anti-aérien]`,
  `[canon anti-char]` (détail Armement, panneau de production) : stock, stock
  cible, production par tour, baisse de l'excès (00-Game §8.3). L'usage des
  armes n'est pas décrit dans 00-Game : rien d'autre tant qu'il ne l'est pas.

### Types d'usine
- Menu « Inaugurer une usine » : fait (arbre de progression, ci-dessus).
- En-tête de section du panneau de production (nom du type) : pas encore
  d'infobulle ; l'arbre de progression pourrait y être repris, avec l'état de
  déblocage de cette usine.

### Autres
- `⇄` (Ressources, flux) et `▣` (Armement, stock) sur la barre : rien de plus
  que le `title` actuel tant qu'ils ne sont que des titres de section.
