# Réglages du moteur — guide d'édition

Chaque fichier de ce dossier contient des nombres et des listes que le moteur
lit pendant la partie. Ce sont des modules TypeScript : ils sont compilés avec
le moteur et embarqués dans le même bundle (règle 2 du `CLAUDE.md`). Ils ne sont
jamais lus ou téléchargés au lancement.

`../config.ts` ré-exporte les fichiers. Le reste du code importe depuis
`config.ts`, jamais depuis un fichier du dossier.

Tous les joueurs d'une partie doivent faire tourner le même build. Si deux
joueurs ont des valeurs différentes, leurs états divergent dès que la valeur
intervient, sans message d'erreur.

Les règles de la population, des activités, du fer et des délais sont dans
`Docs/Design/08-Population.md`, qui fait foi.

---

## 1. Modifier une valeur existante

Après une modification : `npm run typecheck`, puis `npm test` (certains tests
comparent des résultats chiffrés).

| Fichier | Ce qu'il règle | Lu par |
| --- | --- | --- |
| `map.ts` | taille, relief et niveau de la mer de la carte de test ; `mountainAltitude` | `mapgen.ts`, `resources.ts` |
| `sea-zones.ts` | découpage des mers en zones | `seazones.ts` |
| `testgame.ts` | composition et taille de la partie de test (outil de développement) | `testgame.ts` |
| `cities.ts` | rayons d'expansion et de contrôle, coût de fondation (en habitants de l'ancienne échelle ; `POPULATION.inhabitantsPerPawn` le convertit en bonshommes) | `cities.ts` |
| `workforce.ts` | bonshommes de départ, nourriture par bonhomme, délais d'apparition et de disparition de la population (`POPULATION`) et des machines (`GOODS_TIMING`), soin des blessés, cases par travailleur de l'agriculture, de la pêche et des mines | `economy.ts`, `activities.ts`, `cities.ts` |
| `activities.ts` | activités qui ne sont pas une unité (agriculture, pêche, mines, usines de machines) : genre, parent, coût de déblocage (`UNLOCK.turns`), ordre de départ, ouvriers et fer par unité | `activities.ts`, `economy.ts` |
| `goods.ts` | les machines (tracteur, bateau de pêche, pompe) : icône et description ; l'ordre des clés est celui de `Player.idleMachines` | `activities.ts`, `state.ts`, `hash.ts` |
| `resources.ts` | présence du fer et de l'aluminium sur la carte, capacité d'extraction d'une case de fer. Régler avec `npm run viz:resources` | `map.ts`, `mapgen.ts`, `resources.ts`, `economy.ts` |
| `fronts.ts` | délais de déplacement et de combat, seuils de fuite et d'échange, avancée, vitesses, prise de ville, encerclement, percée | `fronts.ts`, `placement.ts`, `combat.ts`, `breakthroughs.ts`, `conquest.ts` |
| `divisions.ts` | une entrée par unité, seule définition de celle-ci : attaques, boîte de production (`production` : usine ou caserne, parent, coût de déblocage, ouvriers et fer par division), largeurs, `productionTurns`, PV, multiplicateurs décimaux à deux décimales au plus), niches des fronts, `ELITE_TROOPS_RATIO`, `DIVISION_TIMING`, `COMBAT.healPercentPerSecond` ; convertis une fois en entiers par `src/divisions.ts` | `divisions.ts`, `activities.ts`, `economy.ts`, `placement.ts`, `combat.ts`, `breakthroughs.ts` |
| `diplomacy.ts` | durée de vie d'une proposition de pacte ou de paix ; **valeur provisoire** | `diplomacy.ts` |
| `limits.ts` | plafonds liés à la taille des tableaux | `cities.ts`, `state.ts` |

`limits.ts` n'est pas un fichier de réglages : `MAX_PLAYERS` et `MAX_CITIES`
viennent de la taille des `Uint16Array` de la carte. Ne pas y toucher sans
changer ces tableaux.

### Contraintes à respecter

Aucun contrôle n'est fait au lancement : une valeur hors de ces limites donne un
résultat faux ou une division par zéro, pas un message.

- **`workforce.ts`** : `foodPerPawn`, `inhabitantsPerPawn` et chaque
  `tilesPerWorker` sont ≥ 1.
- **`activities.ts`** : `workersPerUnit` ≥ 1 pour une usine ou une caserne ;
  `parent` désigne une clé de la même table ; une activité sans parent est
  ouverte au départ et a un `startOrder`, sinon `startOrder` vaut `null`.
- **`divisions.ts`** : multiplicateurs avec deux décimales au plus (convertis
  par `toScale100`) ; `productionTurns` ≥ 1.
- **Tous les fichiers** : des entiers, sauf les multiplicateurs de
  `divisions.ts`.

---

## 2. Ajouter

- **Une activité** : une entrée dans `ACTIVITIES` (`activities.ts`), à la fin pour
  ne pas changer les indices du hash. Une usine ou une caserne de division
  désigne son type par `division` ; une usine de machines, son bien par `good`.
  Le client donne son nom et ses icônes.
- **Une machine** : une entrée dans `GOODS` (à la fin), une activité qui la reçoit
  (`farming`, `fishing` ou `mining`, champ `good`) et une usine qui la produit.
- **Un type de division** : une entrée dans `DIVISIONS` (`divisions.ts`), son nom
  dans `NICHES`, et une activité de production (ci-dessus). Son nom et son icône
  sont dans le client (`client/src/names.ts`).
