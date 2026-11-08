# 10 — Combat par phases et ses deux fenêtres (branche `combat-visu-v2`)

**Ce document fait foi pour son domaine** : ordre de tir des niches, application
des dégâts dans une niche, fenêtre de combat détaillée, fenêtre de résumé. Il
remplace, là où il les contredit :

- `05-Fronts.md` §6 (round de combat) : les 50 rounds deviennent un cycle de
  5 phases (§1) ; §6.2 point 2 (part de chaque division proportionnelle à sa largeur,
  quel que soit son état) dans un type de division (§2) ; §5.4 (fuite vérifiée
  en fin de round) ;
- `05-Fronts.md` §4.2 point 5 (appui-feu sans infanterie : retiré aussitôt) :
  retiré en fin de cycle (§1) ; §5.3 et §4.2 pour les renforts pendant un
  combat (§2) ;
- `06-Combat-Simplifie.md` §1 (50 rounds par combat, 5 rounds de retrait d'un
  renfort, fin du combat vérifiée à chaque round) et §2 (replay).

Décisions de l'auteur du 8 novembre 2026. Ce qui n'est pas tranché est marqué
« *provisoire* » et listé au §6. Maquettes : `maquettes/combat-v2.svg`,
`maquettes/resume-v2.svg`.

But : rendre lisible ce que chaque niche inflige (fenêtre détaillée), et donner
un bilan d'un coup d'œil à qui ne regarde pas chaque combat (résumé).

---

## 1. Phases

Vocabulaire : une **phase** est le tir d'un type de niche (les deux camps,
l'un après l'autre) ; un **cycle** est la suite des 5 phases. Les trois
combats (attaque sur tout le front, percée, contre-attaque,
`06-Combat-Simplifie.md` §1) suivent tous ces règles.

1. Un combat dure **5 cycles** au plus (`FRONTS.combatCycles` ; essai de
   l'auteur du 8 novembre 2026, après 10 cycles puis un seul). Un cycle a
   **5 phases**, une par niche, dans l'ordre : **chars, infanterie, antichar,
   antiaérien, artillerie**. Le combat s'arrête avant, en fin de cycle, quand
   l'attaquant n'a plus d'infanterie en ligne.
2. Dans une phase, seules les niches de ce type tirent : **d'abord celle du
   défenseur, puis celle de l'attaquant**. L'attaquant est le camp qui attaque
   sur tout le front, ou qui perce ; *provisoire* : dans une contre-attaque
   aussi, le camp qui perce (celui du rapport), la réaction rapide est le
   défenseur.
3. Une niche inflige en une phase **les dégâts de 10 anciens rounds**
   (`FRONTS.roundsPerCycle`) : sur un combat complet de 5 cycles, le total est
   le même qu'avec 50 rounds. Les valeurs des unités (attaques, PV) ne changent pas
   pour l'instant ; leur révision (PV baissés) viendra plus tard, sur tableaux
   comparatifs. **Temporaire, pendant le développement** : les dégâts de
   chaque tir sont encore multipliés par `FRONTS.devDamageMultiplier`, sans
   toucher aux statistiques ; *provisoire* : 1.
4. **Attaques figées au début du cycle** : chaque division tire avec
   l'attaque qu'elle avait au début du cycle, selon son état d'alors (une
   division abîmée attaque moins fort, `attackOf`, 05-Fronts §6.1). Une
   division **tuée ou en fuite pendant le cycle tire quand même jusqu'à sa
   fin** ; elle ne reçoit plus de pertes (§2) et n'est retirée de la ligne
   qu'en fin de cycle. L'ordre défenseur puis attaquant ne change donc que
   l'ordre où les pertes sont prises.
5. La **répartition des dégâts entre niches ne change pas** (`05-Fronts.md`
   §6.1 à §6.3), sur les premières lignes du début du cycle, tuées et
   fuyardes comprises : les deux niches principales se partagent les dégâts
   selon leur remplissage, l'appui-feu (antichar, antiaérien, artillerie)
   reçoit sa part selon §6.3.
6. **Fin du cycle**, dans cet ordre (*provisoire*) : les tuées sont retirées et
   les fuyardes quittent la ligne ; rangement des lignes sans échange
   (`05-Fronts.md` §4.2 ; pas d'échange pendant un combat,
   `06-Combat-Simplifie.md` §1), où les renforts montés pendant le cycle (§2)
   prennent leur largeur et la seconde ligne reprend les places encore
   libres ; avancée, `roundsPerCycle` fois celle d'un round, sur la première
   ligne de la fin du cycle, renforts du cycle compris, sans les divisions qui
   viennent de monter au rangement (décision de l'auteur, 8 novembre 2026 :
   un camp qui perd toute sa ligne laisse donc souvent une avancée maximale) ;
   repli faute d'infanterie.
7. **Antiaérien** : il tire sur les unités au sol à sa phase, comme le reste de
   l'appui-feu. Quand les avions existeront, ils tireront à la même phase que
   l'antiaérien, en sous-phases à définir.

## 2. Dégâts dans une niche

1. Entre plusieurs **types de division** d'une même niche (par exemple
   réguliers et miliciens), les dégâts sont partagés comme aujourd'hui, en
   proportion des largeurs engagées. Plusieurs unités d'une niche peuvent donc
   être blessées.
2. Dans un type, les dégâts vont d'abord à **l'unité la plus abîmée** encore
   dans le cycle (ni tuée ni en fuite) : l'état le plus bas. À égalité, le
   générateur seedé de la partie choisit.
3. Si les dégâts qui restent suffisent à amener cette unité à 0 %, elle est
   **tuée** et ce qui dépasse passe à l'unité suivante la plus abîmée.
4. Sinon, elle prend les dégâts jusqu'à **25 %** (`FRONTS.fleeStatePercent`) :
   elle **fuit**, et le reste des dégâts passe à l'unité suivante. Seule une
   unité que les dégâts amènent à 0 % meurt.
5. Si les dégâts restants ne l'amènent pas à 25 %, elle les prend et reste en
   ligne.
6. **Renforts** (attaque sur tout le front) : quand toutes les unités d'un type
   sont tuées ou en fuite et qu'il reste des dégâts, ils vont aux renforts de
   la niche : d'abord ceux déjà montés pendant le cycle, puis la **seconde
   ligne** de la même niche, dans l'ordre de choix du rangement (meilleur
   état, puis meilleur type ; `05-Fronts.md` §4.2), avec les mêmes règles 3 à
   5. Chaque division ainsi touchée monte en première ligne. Ce qui dépasse
   toute la seconde ligne est perdu. Un renfort ne tire pas pendant le cycle
   où il arrive (les attaques sont figées). *Provisoire* : le reste d'un type
   passe aux renforts de toute la niche, quel que soit leur type. Pas de
   renfort dans une percée ni une contre-attaque.
7. Une unité en fuite **ne revient pas en première ligne avant la fin du
   combat**. Le délai de fuite (`FRONTS.fleeRounds`, `05-Fronts.md` §5.4) ne
   compte qu'après le combat, hors combat.

## 3. Fenêtre de combat détaillée

Ouverte à chaque combat. Grande : environ 75 % de l'écran (maquette :
1440 × 830 pour un écran 1920 × 1080).

- **En haut, une bande réservée aux avions**, vide pour l'instant (environ
  15 % de la hauteur).
- **Le joueur qui regarde à gauche, l'adversaire à droite**, en miroir ; les
  icônes du camp de droite sont retournées vers le centre.
- **Colonnes des bords** : en haut, les **renforts** : les divisions de
  **seconde ligne** du front, très serrées ; en bas, les **pertes**.
  Icônes serrées (24 px), comme dans les fenêtres de percée. Dans les pertes,
  toutes les icônes sont pâles : une **croix rouge** pour une unité tuée, le
  **drapeau blanc** (`icons/miscellaneous/icon-white-flag.png`) pour une unité
  en fuite, qui garde sa barre de vie (sous 25 %). Légende en bas de la
  colonne : croix « mort », drapeau « en fuite ».
- **Partie centrale** : du centre vers l'extérieur, une colonne par niche :
  chars, infanterie, antichar, antiaérien, artillerie. Chaque unité est une
  icône de 32 px avec sa **barre de vie verticale, celle des pions**
  (`client/src/pawn.css`, `.pz-bar` : 4 px de large, 1 px à droite de l'icône,
  remplie par le bas, du rouge au vert). Les unités d'une niche sont
  **groupées en haut**, en une colonne (une rangée toutes les 46 px) ; une
  colonne de plus n'apparaît que quand elles ne tiennent plus sur la hauteur,
  et les rangées ne se resserrent qu'à ce moment-là. Placement un peu irrégulier : une rangée
  sur deux décalée, petit décalage aléatoire (*provisoire* : ±6 px et ±2 px).
- **Sacs de sable** : l'infanterie du défenseur (plus de PV en défense,
  `defenseHitPointsMultiplier`) porte par-dessus son icône les sacs de sable
  `icons/armament/icon-sandbag.png` (32 × 32, tournés vers la droite ;
  retournés pour le camp de droite), **seulement dans la fenêtre détaillée,
  en première ligne, tant qu'elle se bat** : ni dans les colonnes des renforts
  et des pertes, ni une fois tuée ou en fuite, ni dans le résumé.
- **Tir** : les niches qui tirent sont surlignées. Chaque unité qui tire joue
  son **animation de tir** par-dessus son icône, avec un décalage et un angle
  propres à sa niche (mêmes pour toutes les unités de la niche), et un **petit
  retard aléatoire** pour que tout ne parte pas en même temps. Aucun trait ni
  projectile entre le tireur et la cible. Animations dans
  `client/public/icons/animations/` :

  | Niche | Tir | Position du tir | Impact chez l'adversaire |
  | --- | --- | --- | --- |
  | Chars | `canon fire` | collé à droite de l'icône, 0° | `explosion 1` |
  | Infanterie | `automatic rifle fire` | collé à droite, 0° | `incoming rifle fire` |
  | Antichar | `canon fire` | collé à droite, 0° | `explosion 1` |
  | Antiaérien | `automatic rifle fire` | haut droit, 45° vers le haut | `incoming rifle fire` |
  | Artillerie | `canon fire` | haut droit, 45° vers le haut | `explosion 1` |

  « Collé à droite » : la boîte 32 × 32 du tir touche le bord droit de celle de
  l'icône, à la même hauteur (+32, 0). Le camp de droite est en miroir.
  *Provisoire* : retard de 0 à 250 ms.
  Chaque animation dure le temps de toutes les images de son GIF : la page
  relit cette durée dans le fichier au chargement (un GIF retouché est joué en
  entier, sans changer le code). **Un tir est joué une seule fois** : la page
  retire la boucle du GIF et lui donne une adresse neuve à chaque tir (sinon
  le navigateur synchronise toutes les copies d'un même GIF).
- **Impacts** : chaque unité qui tire provoque **une** animation d'impact, jouée
  au centre d'une icône adverse. Les animations d'impact sont dessinées pour un
  tir venu de la gauche : sur le camp de droite elles sont jouées telles
  quelles, sur le camp de gauche en miroir. L'impact a lui aussi un petit retard aléatoire. Ce
  n'est que de l'affichage : le moteur n'en sait rien, la répartition des
  dégâts reste celle du §2. Attribution des impacts :
  1. d'abord aux unités qui reçoivent **réellement** des dégâts : au moins une
     par niche touchée, en commençant par les niches principales, du centre vers
     l'extérieur (chars, infanterie, antichar, antiaérien, artillerie) ;
  2. s'il reste des impacts, à des unités **au hasard dans les niches
     principales** (chars et infanterie).
  *Provisoire* : une unité réellement touchée reçoit un seul impact quand il n'y
  en a pas assez pour toutes.
- **Dégâts affichés** : après son dernier impact, la barre de vie de chaque
  unité qui a réellement reçu des dégâts descend **en deux temps** : la barre
  descend en continu et laisse la part perdue **en blanc**, puis le blanc
  descend à son tour jusqu'au nouveau niveau (*provisoire* : 0,35 s chacun).
  Pendant ce temps, les dégâts reçus s'affichent **en petit à côté de la
  barre** (« −x % », la perte d'état en % d'une division complète), du côté opposé à
  l'icône, puis disparaissent avec la pause qui suit (*provisoire* : 1 s en
  tout).
- **Mort et fuite** : une unité tuée joue une **animation de mort** (à fournir
  par l'auteur ; en attendant, elle devient pâle avec une croix rouge), une
  unité en fuite devient pâle avec son drapeau ; elles **restent à leur place
  et tirent jusqu'à la fin du cycle**, puis partent dans les pertes.
- **Vagues de renforts** : quand des renforts ont pris des pertes pendant un
  tir (§2, point 6), le tir est montré en vagues. La première vague touche la
  ligne ; puis les renforts arrivent de leur colonne, autant que d'unités
  tuées ou en fuite à la vague d'avant, et l'attaque est rejouée sur eux ; et
  ainsi de suite jusqu'au dernier renfort.
- **Renfort** : l'unité **se déplace** de la colonne des renforts vers sa
  place (pendant un tir, en vagues ; en fin de cycle, au rangement),
  rapidement, pour ne pas être encore en mouvement quand l'attaque reprend
  (*provisoire* : 0,36 s).
- **Renforts à l'écran** : ils arrivent pendant la fin du cycle, entre la
  phase de l'artillerie et celle des chars du cycle suivant.
- **En bas** : l'ordre de tir, la phase en cours surlignée, et un gros bouton
  **bleu « Passer »** qui ouvre le résumé. **À la fin du combat, le résumé
  s'ouvre tout seul.**

## 4. Fenêtre de résumé

Ouverte par « Passer ». Plus petite (au plus 1160 px de large). Icônes en
32 × 32, comme dans la fenêtre détaillée, destructions comprises.

- **En tête** : l'issue (victoire ou défaite, avancée, ville prise) et les deux
  camps.
- **Bande des avions** : la même que dans la fenêtre détaillée, même part de la
  hauteur.
- **Niches** : la disposition en miroir de la fenêtre détaillée, figée à la fin
  du combat. Dans chaque niche : d'abord les unités en ligne, de la plus
  intacte à la plus abîmée, puis les tuées (pâles, croix rouge), puis celles en
  fuite (pâles, drapeau blanc). Chaque unité a sa barre de vie verticale (celle
  des pions, §3), sauf les tuées. **Les icônes s'empilent** (se chevauchent verticalement) quand elles
  sont nombreuses, pour garder la fenêtre basse ; chacune recouvre le haut de
  celle du dessous, sa barre reste visible.
- **Survol d'une unité** (fenêtre détaillée et résumé) : le même panneau que
  pour un pion d'un front (`05-Fronts.md` §11.7), à l'état du moment (fin du
  combat dans le résumé), avec « Détruite » ou « En repli » au-dessus du nom.
  De manière générale, une unité survolée, où qu'elle soit, montre ce panneau.
- **Sous chaque niche, ce qu'elle a détruit**, sous le titre « a éliminé : »
  (*plus tard*, c'est là que l'expérience sera attribuée) : une ligne pour l'infanterie,
  une pour les véhicules, en **divisions détruites** (une décimale, par
  exemple « 1,5 »). C'est la somme des états que la niche a fait perdre, en
  divisions complètes, que l'unité touchée soit morte, en fuite ou encore en
  ligne : 6 fois un quart de division font « 1,5 ». Chaque ligne montre l'icône du type adverse le plus détruit
  en quantité, **à la couleur de l'adversaire, pas pâle**, avec une croix
  rouge par-dessus. Une ligne à zéro n'est pas affichée. Les véhicules
  comprennent l'appui-feu (antichar, antiaérien, artillerie) : comme les
  chars, il ne contient pas d'infanterie et ne fait pas de blessés.
  **Au survol** de cette zone : le détail, chaque type adverse touché par la
  niche (infanterie d'abord, puis véhicules, du plus au moins touché), avec la
  même mise en page et deux décimales.
- **En bas** : les **blessés** de chaque camp (`08-Population.md` §8 ; le
  rapport du moteur les compte, `CombatLosses.wounded`), une
  icône `pop-hurt` par bonhomme blessé, et leur nombre, **en rouge pour les
  deux camps**.
- Sous les blessés : un bouton « Revoir le combat » qui rouvre la fenêtre
  détaillée.

## 5. Petits écrans

La fenêtre détaillée prend au plus 1440 × 830 px, et la place disponible en
dessous. Sur un petit écran, l'espacement des unités et l'écart entre les
colonnes d'une niche se réduisent d'abord (les icônes peuvent se chevaucher) ;
les icônes gardent 32 px.

## 6. À trancher

1. **Tempo** : durée d'une phase dans la fenêtre détaillée et des animations,
   réglée après l'implémentation. *Provisoire* : retard des tirs 0 à 250 ms,
   impact 100 à 220 ms après le tir, descente des barres 0,7 s (barre, puis blanc) puis 0,3 s de
   pause,
   déplacement 0,36 s,
   0,5 s avant le départ d'une division tuée ou en fuite, 0,3 s entre deux
   tirs. Manque l'animation de mort (en attendant : pâle et croix rouge).
