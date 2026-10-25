// Tous les nombres réglables du moteur, un fichier par thème dans config/.
// Aucun autre fichier de src/ ne contient de constante de réglage. Ces fichiers
// sont importés à la compilation (règle 2 du CLAUDE.md) : jamais lus à l'exécution.
// Voir Docs/Design/02-Engine.md.

export * from "./config/armament.ts";
export * from "./config/cities.ts";
export * from "./config/diplomacy.ts";
export * from "./config/factories.ts";
export * from "./config/goods.ts";
export * from "./config/limits.ts";
export * from "./config/map.ts";
export * from "./config/resources.ts";
export * from "./config/sea-zones.ts";
export * from "./config/workforce.ts";
