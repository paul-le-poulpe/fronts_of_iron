// Onglet Diplomatie : détail de la sixième section de la barre d'informations (infobar.ts), juste à droite de Forces.
// Une ligne par joueur : couleur, nom, population, villes. Un clic sur la ligne d'un autre joueur appelle `onPick`, que
// main.ts branche sur le menu de diplomatie (le même qu'au clic sur son territoire) ; le survol d'une ligne appelle
// `onHover`, que main.ts branche sur `MapView.highlightPlayer`.
//
// Les lignes sont construites une fois par partie ; `update` n'écrit que des textes.

import { localPlayer, playerName } from "./names.ts";
import { playerColor, rgbCss } from "./playercolors.ts";
import { type PlayerStats } from "./protocol.ts";
import { num } from "./format.ts";

export class DiplomacyTab {
  readonly content: HTMLElement;
  private readonly rows: HTMLTableRowElement[] = [];
  private readonly onHover: (player: number) => void;
  /** Joueur dont la ligne est survolée (0 : aucun). */
  private hovered = 0;

  constructor(playerCount: number, onPick: (player: number) => void, onHover: (player: number) => void) {
    this.onHover = onHover;
    const table = document.createElement("table");
    table.className = "ib-players";
    table.innerHTML = "<thead><tr><th></th><th>Joueur</th><th>Population</th><th>Villes</th></tr></thead>";
    const body = document.createElement("tbody");
    for (let id = 1; id <= playerCount; id++) {
      const tr = document.createElement("tr");
      if (id === localPlayer()) tr.classList.add("me");
      const swatch = document.createElement("span");
      swatch.className = "sw";
      swatch.style.background = rgbCss(playerColor(id));
      // Les noms viennent des autres joueurs : textContent, jamais innerHTML.
      const cells = [document.createElement("td"), document.createElement("td"), document.createElement("td"), document.createElement("td")];
      cells[0]!.append(swatch);
      cells[1]!.textContent = playerName(id);
      cells[2]!.textContent = "0";
      cells[3]!.textContent = "0";
      tr.append(...cells);
      // Un joueur éliminé n'a plus de territoire : ni menu ni mise en évidence.
      tr.addEventListener("click", () => {
        if (!tr.classList.contains("out")) onPick(id);
      });
      tr.addEventListener("mouseenter", () => this.hover(tr.classList.contains("out") ? 0 : id));
      tr.addEventListener("mouseleave", () => this.hover(0));
      body.append(tr);
      this.rows.push(tr);
    }
    table.append(body);
    const title = document.createElement("h3");
    title.textContent = "Joueurs";
    this.content = document.createElement("div");
    this.content.append(title, table);
  }

  /** À appeler à chaque tour, détail ouvert ou non : population et villes de chaque joueur. */
  update(players: readonly PlayerStats[]): void {
    players.forEach((p, i) => {
      const tr = this.rows[i];
      if (tr === undefined) return;
      tr.classList.toggle("out", p.defeated);
      const cells = tr.children;
      cells[1]!.textContent = p.defeated ? `${playerName(p.id)} (éliminé)` : playerName(p.id);
      cells[2]!.textContent = num(p.population - p.hurt);
      cells[3]!.textContent = num(p.cities);
    });
  }

  /** Le détail se replie : la souris ne peut plus quitter une ligne cachée, la mise en évidence est retirée ici. */
  collapsed(): void {
    this.hover(0);
  }

  private hover(player: number): void {
    if (player === this.hovered) return;
    this.hovered = player;
    this.onHover(player);
  }
}
