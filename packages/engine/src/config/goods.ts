// Machines (08 §3, §5) : le tracteur vaut un travailleur dans Agriculteurs, le bateau de pêche dans Pêcheurs, la pompe
// à vapeur dans Mineurs. L'ordre des clés de GOODS est l'ordre des cases de `Player.idleMachines`, des compteurs de
// machines et du hash. Les ouvriers et le fer d'une machine sont dans l'usine correspondante (`activities.ts`).

/** Un type de machine. Sans effet sur la simulation. */
export interface GoodConfig {
  /** Icône : chemin sous `client/public/icons/`. Absent : la page affiche un symbole texte. */
  readonly icon?: string;
  /** Description affichée au survol de l'icône. */
  readonly description?: string;
}

export const GOODS = {
  tractor: { icon: "goods/goods-tractor-outline.png" },
  fishingBoat: { icon: "goods/goods-fishing-boat.png" },
  miningMachine: { icon: "goods/goods-mining-pump.png" },
} as const satisfies Record<string, GoodConfig>;

export type GoodId = keyof typeof GOODS;
