// Lecture d'un rapport de combat (`CombatView`, Docs/Design/10-Combat-Phases.md), sans DOM : ce que les deux fenêtres de
// combat et l'historique d'un front en tirent. Rien ici ne recalcule un combat : tout vient des tirs du rapport.

import type { CombatShotView, CombatView, MilitaryCatalog } from "./protocol.ts";

/** Niches dans l'ordre de tir d'un cycle, du centre vers l'extérieur des fenêtres (10-Combat-Phases §1, §3). */
export const PHASE_NICHES = ["tanks", "infantry", "antiTank", "antiAir", "artillery"] as const;

/** Nom de chaque type de combat (06-Combat-Simplifie §2), affiché en tête des fenêtres et dans l'historique. */
export const COMBAT_KIND: Readonly<Record<CombatView["kind"], string>> = {
  front: "Attaque sur tout le front",
  breakthrough: "Percée : première ligne",
  counter: "Percée : contre-attaque du défenseur",
};

/** Tous les tirs d'un combat, dans l'ordre. */
export const shotsOf = (c: CombatView): CombatShotView[] => c.cycles.flatMap((cy) => cy.shots);

/** Avancée de l'attaquant sur tout le combat, en millièmes de route. */
export const totalAdvance = (c: CombatView): number => c.cycles.reduce((s, cy) => s + cy.advance, 0);

/** Une ligne d'historique : « moment, type, résultat » (fenêtre d'un front, 06-Combat-Simplifie §2). */
export function combatSummary(c: CombatView): string {
  const seconds = Math.floor(c.tick / 10);
  const advance = totalAdvance(c);
  const result = c.captured !== 0 ? `ville n° ${c.captured} prise` : advance > 0 ? `avancée ${Math.round(advance / 10)} %` : "pas d'avancée";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} — ${COMBAT_KIND[c.kind]} — ${result}`;
}

/** Issue d'un combat, en une phrase (avancée, ville prise ; percée percée ou arrêtée ; contre-attaque repoussée ou non). */
export function issueText(c: CombatView): string {
  const pct = Math.round(totalAdvance(c) / 10);
  if (c.kind === "breakthrough") return c.success ? `Première ligne percée : le front saute de ${pct} % sur l'axe.` : "Percée arrêtée par la première ligne.";
  if (c.kind === "counter") return c.success ? "Contre-attaque repoussée : la ville au bout de l'axe tombe après le délai." : "Percée arrêtée par la contre-attaque.";
  if (c.captured !== 0) return `Ville n° ${c.captured} prise.`;
  return pct > 0 ? `Le front avance de ${pct} %.` : "Le front ne bouge pas.";
}

/**
 * Vainqueur d'un combat (06-Combat-Simplifie §2) : le camp qui a perdu le moins d'infanterie, en état de division
 * (somme des pertes des divisions de la niche d'infanterie). Égalité : le défenseur (provisoire).
 */
export function localWon(c: CombatView, military: MilitaryCatalog, me: number): boolean {
  const lost = new Map<number, number>();
  for (const s of shotsOf(c)) {
    for (const [i, loss] of s.hits) {
      const u = c.units[i]!;
      if (military.divisions[u.type]?.niche !== "infantry") continue;
      lost.set(u.owner, (lost.get(u.owner) ?? 0) + loss);
    }
  }
  const other = me === c.attacker ? c.defender : c.attacker;
  const mine = lost.get(me) ?? 0;
  const theirs = lost.get(other) ?? 0;
  return mine === theirs ? me === c.defender : mine < theirs;
}

/** Dégâts reçus affichés à côté de la barre (10-Combat-Phases §3) : la perte d'état, en % d'une division complète, au moins 1. */
export const lossPercent = (military: MilitaryCatalog, lost: number): number => Math.max(1, Math.round((100 * lost) / military.stateScale));

/** État d'une division à la fin du combat. */
export interface FinalUnit {
  readonly hp: number;
  readonly dead: boolean;
  readonly fled: boolean;
  /** A été en première ligne pendant le combat (au début, ou renfort monté). */
  readonly fought: boolean;
}

/** État de chaque division du rapport à la fin du combat. */
export function finalUnits(c: CombatView): FinalUnit[] {
  const hp = c.units.map((u) => u.start);
  const dead = c.units.map(() => false);
  const fled = c.units.map(() => false);
  const fought = c.units.map((u) => !u.reserve);
  for (const cy of c.cycles) {
    for (const s of cy.shots) {
      for (const [i, loss] of s.hits) hp[i] = Math.max(0, hp[i]! - loss);
      for (const i of s.destroyed) dead[i] = true;
      for (const i of s.fled) fled[i] = true;
    }
    for (const i of cy.shots.flatMap((s) => s.reinforced)) fought[i] = true;
    for (const i of cy.arrived) fought[i] = true;
    for (const i of cy.fled) fled[i] = true;
  }
  return c.units.map((_, i) => ({ hp: hp[i]!, dead: dead[i]!, fled: fled[i]!, fought: fought[i]! }));
}

/** Ce qu'une niche a détruit d'un groupe (10-Combat-Phases §4) : divisions détruites (état perdu infligé, en divisions), type le plus touché. */
export interface Kill {
  readonly amount: number;
  /** Type adverse qui a perdu le plus d'état (indice dans `MilitaryCatalog.divisions`). */
  readonly type: number;
  /** Joueur de ce type. */
  readonly owner: number;
}

/**
 * Détail des destructions de la niche `niche` de `owner` (10-Combat-Phases §4, survol) : chaque type adverse touché,
 * avec l'état qu'elle lui a fait perdre, en divisions complètes ; d'abord l'infanterie, puis les véhicules, chaque groupe
 * du plus touché au moins touché.
 */
export function killsDetail(c: CombatView, military: MilitaryCatalog, owner: number, niche: number): Kill[] {
  const byType = new Map<number, { loss: number; owner: number }>();
  for (const s of shotsOf(c)) {
    if (s.owner !== owner || s.niche !== niche) continue;
    for (const [i, loss] of s.hits) {
      const u = c.units[i]!;
      const g = byType.get(u.type) ?? { loss: 0, owner: u.owner };
      g.loss += loss;
      byType.set(u.type, g);
    }
  }
  const infantry = (type: number): number => (military.divisions[type]?.niche === "infantry" ? 0 : 1);
  return [...byType]
    .filter(([, g]) => g.loss > 0)
    .sort((a, b) => infantry(a[0]) - infantry(b[0]) || b[1].loss - a[1].loss || a[0] - b[0])
    .map(([type, g]) => ({ amount: g.loss / military.stateScale, type, owner: g.owner }));
}

/**
 * Destructions de la niche `niche` de `owner` (10-Combat-Phases §4) : l'état qu'elle a fait perdre, en divisions
 * complètes, d'un côté à l'infanterie, de l'autre aux véhicules (chars et appui-feu), morts, fuyards et survivants
 * confondus. `null` pour un groupe sans dégât.
 */
export function killsBy(c: CombatView, military: MilitaryCatalog, owner: number, niche: number): { readonly infantry: Kill | null; readonly vehicles: Kill | null } {
  const byType = [new Map<number, number>(), new Map<number, number>()] as const;
  let target = 0;
  for (const s of shotsOf(c)) {
    if (s.owner !== owner || s.niche !== niche) continue;
    for (const [i, loss] of s.hits) {
      const u = c.units[i]!;
      target = u.owner;
      const g = byType[military.divisions[u.type]?.niche === "infantry" ? 0 : 1];
      g.set(u.type, (g.get(u.type) ?? 0) + loss);
    }
  }
  const kill = (g: ReadonlyMap<number, number>): Kill | null => {
    let total = 0;
    let best = -1;
    for (const [type, loss] of [...g].sort((a, b) => a[0] - b[0])) {
      total += loss;
      if (best < 0 || loss > g.get(best)!) best = type;
    }
    return total <= 0 ? null : { amount: total / military.stateScale, type: best, owner: target };
  };
  return { infantry: kill(byType[0]), vehicles: kill(byType[1]) };
}
