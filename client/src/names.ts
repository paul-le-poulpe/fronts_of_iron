// Noms français des machines, des activités, des types de division et des joueurs, et les
// symboles provisoires des biens sans icône. Rien ici n'est une règle.

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  tractor: "tracteur",
  fishingBoat: "bateau de pêche",
  miningMachine: "pompe à vapeur",
};

/** Noms des activités sans usine (identifiants de `ACTIVITIES`, 08 §2). Une usine s'appelle « Usine - » et son produit : `activityName`. */
const ACTIVITY_NAMES: Readonly<Record<string, string>> = {
  idle: "Inactifs",
  hurt: "Blessés",
  farmers: "Agriculteurs",
  fishers: "Pêcheurs",
  miners: "Mineurs",
  militia: "Caserne de milice",
  regulars: "Caserne de réguliers",
  elite: "Caserne d'élites",
};

/** Noms des types de division (clés de `DIVISIONS`) et des niches des fronts (clés de `NICHES`, 05-Fronts §3). */
const UNIT_NAMES: Readonly<Record<string, string>> = {
  regulars: "Réguliers",
  militia: "Milice",
  elite: "Forces spéciales",
  tankette: "Chenillette",
  infantryTank: "Char d'infanterie",
  cruiserTank: "Char de cavalerie",
  mediumTank: "Char moyen",
  antiTank: "Canon anti-char",
  antiAir: "Canon anti-aérien",
  artillery: "Artillerie",
  armoredAntiTank: "Canon anti-char blindé",
  selfPropelledAntiAir: "Canon anti-aérien autopropulsé",
  selfPropelledArtillery: "Artillerie autopropulsée",
};

const NICHE_NAMES: Readonly<Record<string, string>> = {
  infantry: "Infanterie",
  tanks: "Char",
  antiTank: "Antichar",
  antiAir: "Antiaérien",
  artillery: "Artillerie",
};

/** Lettres de niche, en grosses lettres sombres au fond des rangées (05-Fronts §11.4). */
const NICHE_LETTERS: Readonly<Record<string, string>> = {
  infantry: "INF",
  tanks: "TANK",
  antiTank: "AT",
  antiAir: "AA",
  artillery: "ART",
};

/** Matériel d'une division qui n'est pas de l'infanterie (clés de `DIVISIONS`) : singulier, pluriel. */
const EQUIPMENT_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  tankette: ["chenillette", "chenillettes"],
  infantryTank: ["char d'infanterie", "chars d'infanterie"],
  cruiserTank: ["char de cavalerie", "chars de cavalerie"],
  mediumTank: ["char moyen", "chars moyens"],
  antiTank: ["canon anti-char", "canons anti-char"],
  antiAir: ["canon anti-aérien", "canons anti-aériens"],
  artillery: ["pièce d'artillerie", "pièces d'artillerie"],
  armoredAntiTank: ["canon anti-char blindé", "canons anti-char blindés"],
  selfPropelledAntiAir: ["canon anti-aérien autopropulsé", "canons anti-aériens autopropulsés"],
  selfPropelledArtillery: ["pièce d'artillerie autopropulsée", "pièces d'artillerie autopropulsées"],
};

/** Effectif affiché d'une division (08 §8 bis) : des hommes pour l'infanterie, du matériel pour le reste. Aucun effet sur le jeu. */
const MEN_PER_DIVISION = 1000;
const EQUIPMENT_PER_DIVISION = 100;

/** Effectif de `divisions` divisions du type `id` de la niche `niche` (une fraction pour des pertes) : nombre entier et nom accordé. */
export function strengthOf(id: string, niche: string, divisions: number): { readonly count: number; readonly name: string } {
  if (niche === "infantry") {
    const count = Math.round(divisions * MEN_PER_DIVISION);
    return { count, name: count > 1 ? "hommes" : "homme" };
  }
  const count = Math.round(divisions * EQUIPMENT_PER_DIVISION);
  const [one, many] = EQUIPMENT_NAMES[id] ?? [id, id];
  return { count, name: count > 1 ? many : one };
}

export const unitName = (id: string): string => UNIT_NAMES[id] ?? id;
export const nicheName = (id: string): string => NICHE_NAMES[id] ?? id;
export const nicheLetters = (id: string): string => NICHE_LETTERS[id] ?? id.toUpperCase();
export function activityName(id: string): string {
  const name = ACTIVITY_NAMES[id];
  if (name !== undefined) return name;
  const product = PRODUCT_NAMES[id] ?? UNIT_NAMES[id] ?? id;
  return `Usine - ${product.charAt(0).toUpperCase()}${product.slice(1)}`;
}

let localId = 1;
let rosterNames: readonly string[] = [];

/** Les joueurs de la partie en cours : le joueur de cette page, et le nom de chacun (`InitMessage.you`, `playerNames`). */
export function setRoster(you: number, names: readonly string[]): void {
  localId = you;
  rosterNames = names;
}

/** Identifiant du joueur de cette page : 1 en solo, `you` du message de départ en ligne. */
export const localPlayer = (): number => localId;

/** Pseudo d'un joueur, sans « Vous » : le nom du message de départ. */
export const rosterName = (id: number): string => rosterNames[id - 1] ?? `Joueur ${id}`;

/** Nom d'un joueur : « Vous » pour le joueur de la page, sinon le nom du message de départ (« Bot n » en solo). */
export const playerName = (id: number): string => (id === localId ? "Vous" : (rosterNames[id - 1] ?? `Joueur ${id}`));

export const productName = (id: string): string => PRODUCT_NAMES[id] ?? id;
/** Symbole provisoire d'un bien. */
export const productSymbol = (id: string): string => `[${productName(id)}]`;
