// Noms français des biens, de l'armement et des types d'usine, et leurs symboles
// provisoires. Les icônes n'existent pas encore (00-Game §11) : un texte entre
// crochets les remplace. Rien ici n'est une règle.

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  rifle: "fusil",
  machineGun: "mitrailleuse",
  artillery: "artillerie",
  antiAirGun: "canon anti-aérien",
  antiTankGun: "canon anti-char",
  tractor: "tracteur",
  fishingBoat: "bateau de pêche",
  miningMachine: "engin minier",
};

const FACTORY_NAMES: Readonly<Record<string, string>> = {
  infantryArmament: "Armement d'infanterie",
  fishingBoats: "Bateaux de pêche",
  miningMachines: "Engins miniers",
};

export const productName = (id: string): string => PRODUCT_NAMES[id] ?? id;
export const factoryName = (id: string): string => FACTORY_NAMES[id] ?? id;

/** Symbole provisoire d'un bien ou d'un type d'armement. */
export const productSymbol = (id: string): string => `[${productName(id)}]`;
/** Symbole provisoire d'un type d'usine. */
export const factorySymbol = (id: string): string => `[${factoryName(id)}]`;
/** Initiale dessinée sur la carte à côté de la ville qui porte l'usine. */
export const factoryInitial = (id: string): string => factoryName(id).charAt(0).toUpperCase();
