# Tests à faire

Liste des tests à écrire plus tard pour valider le jeu. **Rien ici n'est écrit
pour l'instant** : les règles changent encore beaucoup. La passe de tests se
fera quand l'auteur la demandera (pas avant).

Chaque test vérifie une règle de `Docs/Design/05-Fronts.md`, avec des valeurs
calculées à la main d'après le document (jamais recopiées de la sortie du
code). Un écart trouvé : on corrige le code, ou on signale le point si
05-Fronts ne le tranche pas.

## Fronts version 2 : réaction rapide, boîtes de percée, percée

Règles : 05-Fronts §4.6, §7.2, §12, §15. Code : `packages/engine/src/breakthroughs.ts`,
`combat.ts`, `placement.ts`.

**Boîtes et réaction rapide (§4.6)**
- `move_division` vers une nouvelle boîte (`line: "box", box: 0`), vers une
  boîte existante, vers la réaction rapide.
- Sans délai sur le même front ; délai de `transferRounds` depuis la réserve ou
  un autre front.
- Refusé : boîte d'un autre joueur, boîte d'un autre front, division engagée
  dans une percée.
- Une boîte vide et sans percée est supprimée ; une boîte dont toutes les
  divisions sont engagées reste.
- Boîtes et réaction rapide : ni attaque sur tout le front, ni rangement des
  lignes, ni échange.
- Renfort : oui hors percée, non pour une division engagée dans une percée.

**Lancement (§7.2, points 1 à 4)**
- Force prise au lancement : une liaison par niche en `breakthroughWidth` (une
  tankette compte 1), dans l'ordre de choix ; la dernière engagée en partie
  mais toute prise ; les autres restent dans la boîte.
- Appui-feu non engagé sans infanterie dans la force.
- Refusé : front en paix, axe hors du front, boîte vide, axe déjà attaqué par
  ce camp.
- Délai de `breakthroughDelayTurns` avant le combat 1 ; force vide au début du
  combat 1 : percée arrêtée, événement `breakthrough_failed`.

**Combat 1 (points 5, 6, 7, 10)**
- Tranche : une liaison par niche en `frontWidth`, dans l'ordre de choix,
  parmi la première ligne engagée ; elle reste en première ligne et garde part
  à l'attaque sur tout le front.
- Multiplicateurs : `breakthroughMultiplier` pour la force, rien pour la
  tranche, PV de défense pour le défenseur.
- Attaque de la force rapportée à `breakthroughWidth` (une tankette engagée sur
  1 liaison attaque à pleine force), celle de la tranche à `frontWidth`.
- Pas de remplacement de la tranche.
- Première ligne percée quand plus aucune infanterie de la tranche n'est
  engagée (détruite ou en fuite).
- Saut = arrondi(N × v × facteur de réaction) : motorisation de la
  contre-attaque à 50 %, 75 %, 100 % ; pas de contre-attaque ; force motorisée
  ou non.

**Combat 2 (points 8, 9)**
- Force de contre-attaque : réaction rapide d'abord, puis seconde ligne, une
  liaison par niche en `breakthroughWidth`, avec `counterAttackMultiplier`.
- Deux percées sur le même front : partage équitable, recalculé à chaque round.
- Une division de seconde ligne engagée dans la contre-attaque n'est pas
  montée en première ligne.
- La ville tombe quand la contre-attaque n'a plus d'infanterie, ou s'il n'y en
  a pas.

**Fin (points 11 à 13)**
- Essoufflement : état moyen de la force (pondéré par la largeur engagée) sous
  35 % de celui du début du combat 1.
- Fuite à 25 % : une division de la force reste dans sa boîte, libérée de la
  percée, en fuite ; une division de la contre-attaque est libérée, en fuite ;
  une division de la tranche repasse en seconde ligne.
- Annulation (`cancel_breakthrough`), paix : percées arrêtées.
- Les survivants de la force retournent dans leur boîte ; la boîte reste.

**Front qui change (§2.5, §4.6)** — `afterFrontsChanged`
- Une percée suit le front qui contient son axe ; elle s'arrête si l'axe
  disparaît ou si sa boîte n'est plus sur ce front.
- Une boîte dont le front disparaît est supprimée ; une division qui n'est plus
  sur le front de sa boîte va en seconde ligne.

**Hash et déterminisme**
- Chaque champ d'une boîte, d'une percée, et `box`, `breakthrough`,
  `btEngaged` d'une division change le hash.
- Le scénario de `test/determinism.test.ts` joue des boîtes, des percées et de
  la réaction rapide.

## Points relevés pendant la passe de la version 1 (non tranchés)

- Composant sans exemplaire et reste de perte positif : le moteur ne tire pas ;
  §1 ne le dit pas.
- Moyenne pondérée de l'appui-feu (§6.3) : avec les types actuels, toute
  l'infanterie engagée a la même fraction de pertes ; la pondération n'est pas
  distinguée d'une moyenne simple.
- Chenillette : la perte de 1 à 9 hommes retire un char (§3.2), donc le
  `lossMultiplier` de ses hommes ne se voit qu'au-delà de 10 hommes.
- Une mutation n'est détectée par aucun test : dégâts reçus calculés avec la
  largeur de la division au lieu de sa largeur engagée.

## Client

- Fenêtre d'un front, onglet des forces, menu « + », sélection simple et
  avancée, glisser-déposer, panneaux de survol, thèmes : rien n'est vérifié
  dans le navigateur par un test.
