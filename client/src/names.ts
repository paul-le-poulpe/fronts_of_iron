// Noms français des biens, de l'armement, des types d'usine et des joueurs, et les
// symboles provisoires des biens. Les icônes n'existent pas encore (00-Game §11) : un texte entre
// crochets les remplace. Rien ici n'est une règle.

import { HUMAN } from "./protocol.ts";

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  rifle: "fusil",
  machineGun: "mitrailleuse",
  artillery: "artillerie",
  antiAirGun: "canon anti-aérien",
  antiTankGun: "canon anti-char",
  tankette: "chenillette",
  tractor: "tracteur",
  fishingBoat: "bateau de pêche",
  miningMachine: "pompe à vapeur",
};

const FACTORY_NAMES: Readonly<Record<string, string>> = {
  infantryArmament: "Manufacture d'armes",
  fishingBoats: "Chantier naval",
  miningMachines: "Usine mécanique",
};

/** Nom d'un joueur de la partie solo : le joueur humain, puis les bots dans l'ordre de leur identifiant. */
export const playerName = (id: number): string => (id === HUMAN ? "Vous" : `Bot ${id - 1}`);

export const productName = (id: string): string => PRODUCT_NAMES[id] ?? id;
export const factoryName = (id: string): string => FACTORY_NAMES[id] ?? id;

/** Symbole provisoire d'un bien ou d'un type d'armement. */
export const productSymbol = (id: string): string => `[${productName(id)}]`;
/** Symbole provisoire d'un type d'usine. */
export const factorySymbol = (id: string): string => `[${factoryName(id)}]`;
/**
 * Bien de l'arbre d'une usine qui a le plus de lignes construites (actives ou non) :
 * c'est lui qui la représente, dans le panneau et sur la carte. À égalité, le premier
 * de l'arbre ; sans aucune ligne, la racine de l'arbre.
 */
export function dominantGood(
  tree: readonly { readonly good: string }[],
  groups: readonly { readonly good: string; readonly lines: number }[],
): string {
  let best = tree[0]!.good;
  let bestLines = 0;
  for (const node of tree) {
    const lines = groups.find((g) => g.good === node.good)?.lines ?? 0;
    if (lines > bestLines) {
      best = node.good;
      bestLines = lines;
    }
  }
  return best;
}
/** Initiale dessinée sur la carte à côté de la ville qui porte l'usine. */
export const factoryInitial = (id: string): string => factoryName(id).charAt(0).toUpperCase();
