# Infobulles des icônes — feuille de route

Chaque icône du jeu (machine, ressource, métier, activité, type de division) aura à terme
sa propre infobulle construite (`setTip` de `client/src/tooltip.ts`). Mécanisme et affichage : 03-Client.md
(« Infobulles construites »). Ce document liste ce qui existe et ce qui reste.

Aucune infobulle n'invente de règle : elle affiche des valeurs du catalogue
(envoyé une fois) et des statistiques du dernier tour, calculées par le moteur.
Tant qu'un document de règles (00-Game, 08-Population) ne décrit pas l'usage d'une chose,
son infobulle ne dit que ce qui est écrit.

## Forme commune

Forme validée par l'auteur le 24 octobre 2026.

1. Titre : le nom de la chose.
2. Une phrase : à quoi elle sert, en termes de mécanisme.
3. Section « règles » : les valeurs fixes de la configuration qui donnent son
   effet (par exemple, cases par travailleur, boîte qui reçoit la machine).
4. Section « Votre nation » : les nombres du dernier tour, avec des barres.

Couleurs des barres :
- **vert** (`--ok`) : remplissage d'une jauge d'effet (part du gain possible
  atteinte). Chaque barre a un libellé à gauche ; les machines n'ont plus de jauge de
  mécanisation (une machine vaut un travailleur, 08 §3) ;
- **couleur du métier** concerné, celle des boîtes du panneau de production (`--occ-farm`,
  `--occ-fish`, `--occ-mine`, `--occ-factory`, `--occ-idle`) : la barre de ce
  que ce métier produit ou travaille (surface cultivée, surface pêchée, cases de
  fer exploitées).

## Faites

Les machines n'ont pas d'infobulle construite. Les pions de machine du panneau de production, les tuiles de sortie
et les boîtes ont chacun un `title` (nom, ce qu'il montre, comment le glisser).

Panneau de production (08 §11, nouvelles infobulles construites) :
- **cadenas ouvert** d'une boîte parente : les boîtes qu'elle débloque, la barre de progression de chacune et le
  nombre d'ouvriers servis en fer qui la fait avancer ;
- **boîte verrouillée** : sa progression, comment elle avance (ouvriers servis de la boîte parente), le temps restant
  à ce rythme, ou la raison de l'arrêt (parent verrouillé, aucun ouvrier servi) ;
- **camembert du fer** (onglet Ressources) : une rangée par activité qui réserve du fer.

## À faire

Ordre proposé ; le contenu exact de chacune est à valider avec l'auteur.

### Ressources
- `[fer]` (onglet Ressources, en-tête du panneau de production) : à quoi sert le fer (les
  usines et les casernes en réservent), fer par case ; fer réservé / produit (08 §4).
- Nourriture (tuile de sortie d'Agriculteurs et de Pêcheurs) : capacité de population apportée (08 §3).

### Métiers (icônes de `public/icons/population/`)
- Pions du panneau de production (`pop-default`, `pop-farmer`, `pop-fisherman`, `pop-miner`, `pop-worker`,
  `pop-soldier`, `pop-hurt`) : un `title` générique est posé (bonhomme, état, comment le glisser). Une infobulle construite
  par métier (ce qu'il fait, nombre et part) reste à valider avec l'auteur.
- Blessés (`pop-hurt`) : soignés un à la fois, puis ils retournent dans Inactifs (08 §8) ; la durée de soin n'est pas écrite
  dans le texte, pour ne pas dupliquer la valeur.
- `pop-sailor`, `pop-fisherman-beard` : fichiers présents, pas encore utilisés.

### Activités
- Nom d'une boîte du panneau de production : pas encore d'infobulle construite ; elle pourrait reprendre l'entrée, la
  sortie et les ouvriers par unité de la configuration (`ActivityInfo`).

### Unités militaires
- Fait : au survol du nom d'une unité dans le panneau d'un front, un `title` (description de l'unité ;
  largeurs, attaques, PV, motorisé). Plus d'équipement (08 §5). Pas encore d'infobulle construite avec barres : à valider avec l'auteur.

### Autres
- `⇄` (Ressources, flux) sur la barre : rien de plus que le `title` actuel tant qu'il n'est qu'un titre de section.
