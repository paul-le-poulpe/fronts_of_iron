// Plafonds imposés par la taille des tableaux de l'état, pas des réglages :
// ne pas les modifier sans changer le type des tableaux concernés.

/** `owner` est un Uint16Array et 0 veut dire « personne » : 65 535 joueurs au plus. */
export const MAX_PLAYERS = 0xffff;

/** `tileCity` est un Uint16Array et 0 veut dire « aucune ville » : 65 535 villes au plus. */
export const MAX_CITIES = 0xffff;
