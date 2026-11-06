// Le canvas de la carte : caméra (molette = zoom, glisser = déplacer), tampon de
// pixels de la carte (painter.ts), puis par-dessus, à chaque image : hachures de
// fertilité (vue « Fertilité ») et de fer (vue « Ressources naturelles »), routes, villes, capitales, ports, et en mode
// placement le rayon d'expansion et la case survolée. Le tampon n'est renvoyé au
// canvas que pour la partie repeinte.

import { type Mirror, RESOURCE_ALUMINIUM, RESOURCE_IRON, TERRAIN_LAND } from "./mirror.ts";
import { type Painter } from "./painter.ts";
import { PlayerLabels, type LabelSpot } from "./playerlabels.ts";
import { playerColor, playerDark, playerLimit, rgbCss } from "./playercolors.ts";
import { FrontLayer, type FrontMark, type ZoneShape } from "./frontlayer.ts";
import { type LinkUnits } from "./frontunits.ts";
import { localPlayer, rosterName } from "./names.ts";
import { type DivisionView, type FrontView } from "./protocol.ts";
import { unitIconCanvas } from "./uniticons.ts";

export interface MapViewHooks {
  /** Case sous la souris, ou -1 hors de la carte. */
  onHover(tile: number): void;
  /** Clic (sans glisser) sur une case de la carte. */
  onClick(tile: number): void;
  /** Front dont la zone est sous la souris (0 : aucun), à chaque changement. */
  onHoverFront?(front: number): void;
}

const MAX_ZOOM = 48;

// Noms des joueurs sur la carte dézoomée, valeurs provisoires. Ils apparaissent quand l'écran montre au moins
// `LABEL_MIN_TILES` cases, soit environ cent villes.
const LABEL_MIN_TILES = 120000;
const LABEL_FONT_PX = 15;
const LABEL_STROKE_PX = 2;
const LABEL_FONT = `700 ${LABEL_FONT_PX}px Arial, sans-serif`;
/** Finesse du cache des positions : un calcul par palier de zoom de `1 / LABEL_ZOOM_STEPS` en logarithme. */
const LABEL_ZOOM_STEPS = 8;
const DRAG_THRESHOLD_PX = 4;
/** Hachures des vues : période et épaisseur des bandes, en pixels CSS (constantes à l'écran, quel que soit le zoom). */
const HATCH_PERIOD_PX = 10;
const HATCH_WIDTH_PX = 4;
/** Hachures des zones de front (05-Fronts §11.1) : trait de 2 px tous les 8 px, à 45°, pour voir la carte dessous. */
const FRONT_HATCH_PERIOD_PX = 8;
const FRONT_HATCH_WIDTH_PX = 2;
/**
 * Cases à l'écran au-delà desquelles un front ne montre plus que son infanterie, soit environ deux cents villes, et au-delà
 * desquelles il ne montre plus d'unités, soit environ huit cents villes (05-Fronts §11.1, provisoire).
 */
const FRONT_UNITS_MAX_TILES = 240000;
const FRONT_INFANTRY_MAX_TILES = 960000;
/** Taille d'une icône d'unité sur la carte, en pixels d'écran. */
const FRONT_UNIT_PX = 32;
/**
 * Centre d'une unité, en pixels d'écran : distance au point du front le long du segment pour la première rangée, distance
 * entre deux rangées, et écart de chaque côté du segment.
 */
const FRONT_UNIT_ALONG_PX = 22;
const FRONT_UNIT_RANK_PX = 34;
const FRONT_UNIT_ACROSS_PX = 17;
/** Rayon du petit rond d'un emplacement d'infanterie vide, en pixels d'écran. */
const FRONT_EMPTY_PX = 3;

/** Taille de la flèche d'une percée, du centre à la pointe, en pixels d'écran (14 : deux fois la première version). */
const FRONT_RED_RGBA = [200, 30, 30, 200] as const;
const FRONT_BLUE_RGBA = [40, 90, 210, 200] as const;
type Rgba = readonly [number, number, number, number];

/** Hachures d'une vue du menu Carte : un masque de cases, une couleur, un sens des bandes. */
interface Hatching {
  /** Un pixel opaque par case hachurée. */
  mask: HTMLCanvasElement;
  readonly rgba: Rgba;
  /** Bandes « / » (1) ou « \ » (-1) : la fertilité et le fer se croisent quand les deux sont affichés. */
  readonly slope: 1 | -1;
  /** Motif, refait quand la densité de pixels change. */
  pattern: CanvasPattern | null;
  patternDpr: number;
  /** Période et épaisseur des bandes, en pixels d'écran. */
  readonly period: number;
  readonly stroke: number;
}

/** Ressources de la vue « Ressources naturelles » : couleur des hachures (la légende de la carte la reprend) et icône. */
export const RESOURCE_LEGEND = {
  iron: { name: "Fer", icon: "goods/goods-iron-ingot.png", rgba: [130, 30, 22, 190] },
  aluminium: { name: "Aluminium", icon: "goods/goods-aluminium-ingot.png", rgba: [31, 63, 168, 190] },
} as const satisfies Record<string, { name: string; icon: string; rgba: Rgba }>;

/** Taille de la pointe de la flèche d'une percée, en pixels de l'écran. */
const ARROW_PX = 14;

export class MapView {
  /** Mode « Créer une ville » actif. */
  placement = false;
  /** Raison pour laquelle on ne peut pas fonder une ville sur cette case, ou null si c'est permis. */
  placementCheck: (tile: number) => string | null = () => null;
  /** Vue « Fertilité » du menu Carte : hachures vertes sur les cases cultivables. */
  showFertility = false;
  /** Vue « Ressources naturelles » du menu Carte : hachures rouge foncé sur les cases de fer, bleues sur celles d'aluminium. */
  showIron = false;
  /** Case « Zones de front » du menu Carte (05-Fronts §11.1) : hachures rouges des fronts actifs. */
  showFrontZones = true;
  /** Mode choix d'axe (05-Fronts §11.1) : front dont on choisit la connexion (0 : hors du mode), et la connexion visée par la souris. */
  axisFront = 0;
  axisHover: { readonly city1: number; readonly city2: number } | null = null;
  /** Front dont la zone est survolée (0 : aucun) : sa zone s'affiche toujours. */
  private hoverFront = 0;
  /** Front survolé dans la liste de l'onglet des forces (0 : aucun) ; prime sur `hoverFront`. */
  private listFront = 0;
  private readonly frontLayer: FrontLayer;
  private readonly frontHatchRed: Hatching;
  private readonly frontHatchBlue: Hatching;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mirror: Mirror;
  private readonly painter: Painter;
  private readonly hooks: MapViewHooks;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  /** Hachures vertes des cases cultivables (fertilité > 0). */
  private readonly fertileHatch: Hatching;
  /** Hachures rouge foncé des cases de fer. */
  private readonly ironHatch: Hatching;
  /** Hachures bleues des cases d'aluminium. */
  private readonly aluminiumHatch: Hatching;
  /** Hachures blanches de la zone de la ville dont l'usine est survolée dans le panneau ; son masque change avec la ville. */
  private readonly cityHatch: Hatching;
  /** Ville mise en évidence (0 : aucune) et le masque de sa zone. */
  private highlighted = 0;
  private highlightMask: HTMLCanvasElement | null = null;
  /** Joueur survolé dans la liste de l'onglet Diplomatie (0 : aucun) et le masque de son territoire, refait quand des cases changent. */
  private highlightedPlayer = 0;
  private playerMask: HTMLCanvasElement | null = null;
  private readonly labels: PlayerLabels;
  /** Positions des noms, pour le palier de zoom `labelZoom`. */
  private labelSpots: readonly LabelSpot[] = [];
  private labelZoom: number | null = null;
  /** Calque des hachures, à la taille du canvas : un masque à la caméra, rempli du motif. */
  private readonly hatch: HTMLCanvasElement;
  private readonly hatchCtx: CanvasRenderingContext2D;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private zoom = 1;
  private minZoom = 0.1;
  private tx = 0;
  private ty = 0;
  private hoverTile = -1;
  private frame = 0;
  private fitted = false;
  /** Dernière durée de dessin d'une image, en ms. */
  lastDrawMs = 0;

  constructor(canvas: HTMLCanvasElement, mirror: Mirror, painter: Painter, hooks: MapViewHooks) {
    this.canvas = canvas;
    this.mirror = mirror;
    this.painter = painter;
    this.hooks = hooks;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("canvas 2D indisponible");
    this.ctx = ctx;
    this.base = document.createElement("canvas");
    this.base.width = mirror.width;
    this.base.height = mirror.height;
    const baseCtx = this.base.getContext("2d");
    if (baseCtx === null) throw new Error("canvas 2D indisponible");
    this.baseCtx = baseCtx;
    this.image = new ImageData(painter.bytes, mirror.width, mirror.height);
    this.fertileHatch = hatching(buildMask(mirror, (t) => mirror.fertility[t] !== 0), [70, 160, 80, 120], 1);
    this.ironHatch = hatching(
      buildMask(mirror, (t) => (mirror.resources[t]! & RESOURCE_IRON) !== 0 && (mirror.terrain[t]! & TERRAIN_LAND) !== 0),
      RESOURCE_LEGEND.iron.rgba,
      -1,
    );
    this.aluminiumHatch = hatching(
      buildMask(mirror, (t) => (mirror.resources[t]! & RESOURCE_ALUMINIUM) !== 0 && (mirror.terrain[t]! & TERRAIN_LAND) !== 0),
      RESOURCE_LEGEND.aluminium.rgba,
      -1,
    );
    this.cityHatch = hatching(document.createElement("canvas"), [255, 255, 255, 220], 1);
    this.frontLayer = new FrontLayer(mirror);
    this.frontHatchRed = hatching(document.createElement("canvas"), FRONT_RED_RGBA, 1, FRONT_HATCH_PERIOD_PX, FRONT_HATCH_WIDTH_PX);
    this.frontHatchBlue = hatching(document.createElement("canvas"), FRONT_BLUE_RGBA, 1, FRONT_HATCH_PERIOD_PX, FRONT_HATCH_WIDTH_PX);
    this.hatch = document.createElement("canvas");
    const hatchCtx = this.hatch.getContext("2d");
    if (hatchCtx === null) throw new Error("canvas 2D indisponible");
    this.hatchCtx = hatchCtx;
    this.labels = new PlayerLabels(mirror);
    this.uploadAll();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Envoie tout le tampon au canvas de la carte (début de partie, bascule du fer). */
  uploadAll(): void {
    this.baseCtx.putImageData(this.image, 0, 0);
    this.playerMask = null;
    this.invalidateLabels();
    this.requestDraw();
  }

  /** Envoie seulement le rectangle qui contient ces cases. */
  upload(tiles: readonly number[]): void {
    if (tiles.length === 0) return;
    const w = this.mirror.width;
    let x0 = w;
    let y0 = this.mirror.height;
    let x1 = 0;
    let y1 = 0;
    for (const t of tiles) {
      const x = t % w;
      const y = (t - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    this.baseCtx.putImageData(this.image, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.playerMask = null;
    this.invalidateLabels();
    this.requestDraw();
  }

  /** Appelé après chaque dessin de la carte : les icônes posées par-dessus (combats) se replacent. */
  onDrawn: (() => void) | null = null;

  /** Centre de la case (x, y), en pixels CSS du canvas (donc de `#stage`). */
  tileToCss(x: number, y: number): { x: number; y: number } {
    return { x: this.tx + (x + 0.5) * this.zoom, y: this.ty + (y + 0.5) * this.zoom };
  }

  requestDraw(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const t0 = performance.now();
      this.draw();
      this.lastDrawMs = performance.now() - t0;
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.hatch.width = this.canvas.width;
    this.hatch.height = this.canvas.height;
    this.minZoom = Math.min(this.cssW / this.mirror.width, this.cssH / this.mirror.height) * 0.9;
    if (!this.fitted && rect.width > 1) this.fit();
    else this.clampPan();
    // Changer canvas.width / height efface le canvas : redessiner tout de suite, dans le même rappel de
    // ResizeObserver et donc avant la peinture. Avec requestDraw() (prochain frame), un frame vide
    // (le fond sombre de #stage) s'affichait à chaque changement de taille.
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.draw();
  }

  /** Carte entière dans la fenêtre. */
  fit(): void {
    this.fitted = true;
    this.zoom = Math.min(this.cssW / this.mirror.width, this.cssH / this.mirror.height);
    this.tx = (this.cssW - this.mirror.width * this.zoom) / 2;
    this.ty = (this.cssH - this.mirror.height * this.zoom) / 2;
  }

  private clampPan(): void {
    const mw = this.mirror.width * this.zoom;
    const mh = this.mirror.height * this.zoom;
    // Au moins la moitié de la fenêtre reste couverte par la carte.
    this.tx = Math.min(this.cssW / 2, Math.max(this.cssW / 2 - mw, this.tx));
    this.ty = Math.min(this.cssH / 2, Math.max(this.cssH / 2 - mh, this.ty));
  }

  private tileAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.tx) / this.zoom);
    const y = Math.floor((clientY - rect.top - this.ty) / this.zoom);
    if (x < 0 || y < 0 || x >= this.mirror.width || y >= this.mirror.height) return -1;
    return y * this.mirror.width + x;
  }

  private bindPointer(): void {
    const canvas = this.canvas;
    let down: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down !== null) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          down.moved = true;
          canvas.classList.add("dragging");
        }
        if (down.moved) {
          this.tx = down.tx + dx;
          this.ty = down.ty + dy;
          this.clampPan();
          this.requestDraw();
        }
      }
      this.setHover(this.tileAt(e.clientX, e.clientY));
    });
    const end = (e: PointerEvent): void => {
      const d = down;
      down = null;
      canvas.classList.remove("dragging");
      if (d !== null && !d.moved && e.type === "pointerup") {
        const tile = this.tileAt(e.clientX, e.clientY);
        if (tile >= 0) this.hooks.onClick(tile);
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => {
      if (down === null) this.setHover(-1);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const next = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.zoom * Math.exp(-e.deltaY * 0.0015)));
        // La case sous la souris reste sous la souris.
        const mx = (px - this.tx) / this.zoom;
        const my = (py - this.ty) / this.zoom;
        this.zoom = next;
        this.tx = px - mx * next;
        this.ty = py - my * next;
        this.clampPan();
        this.requestDraw();
      },
      { passive: false },
    );
  }

  private setHover(tile: number): void {
    if (tile === this.hoverTile) return;
    this.hoverTile = tile;
    this.hooks.onHover(tile);
    const front = tile >= 0 ? (this.frontLayer.frontAt(tile)?.id ?? 0) : 0;
    const frontChanged = front !== this.hoverFront;
    this.hoverFront = front;
    if (frontChanged) this.hooks.onHoverFront?.(front);
    if (this.placement || this.axisFront !== 0 || frontChanged) this.requestDraw();
  }

  /** Met en évidence la zone du front `front` comme au survol (0 : retire) : la liste des fronts de l'onglet des forces. */
  highlightFront(front: number): void {
    if (front === this.listFront) return;
    this.listFront = front;
    this.requestDraw();
  }

  /** Front dont la zone contient la case (05-Fronts §11.1), affichée ou non. */
  frontAt(tile: number): FrontView | undefined {
    return this.frontLayer.frontAt(tile);
  }

  /** À rappeler quand les fronts changent : les zones et la courbe sont redessinées. */
  frontsChanged(): void {
    this.hoverFront = this.hoverTile >= 0 ? (this.frontLayer.frontAt(this.hoverTile)?.id ?? 0) : 0;
    this.requestDraw();
  }

  /** À rappeler quand les divisions changent : les unités du front ne sont dessinées qu'au-delà du seuil de zoom. */
  divisionsChanged(): void {
    if (this.visibleTiles() <= FRONT_INFANTRY_MAX_TILES) this.requestDraw();
  }

  /** Nombre de cases que l'écran montre. */
  private visibleTiles(): number {
    return (this.cssW * this.cssH) / (this.zoom * this.zoom);
  }

  /** Mode choix d'axe : `frontId` 0 pour en sortir. */
  setAxisMode(frontId: number): void {
    this.axisFront = frontId;
    this.axisHover = null;
    this.canvas.classList.toggle("placing", this.placement || frontId !== 0);
    this.requestDraw();
  }

  /** À rappeler quand un mode (placement) ou les villes changent. */
  refresh(): void {
    this.canvas.classList.toggle("placing", this.placement || this.axisFront !== 0);
    this.highlightMask = null;
    this.requestDraw();
  }

  /** Hachure en blanc la zone de la ville `city` (0 : retire la mise en évidence). */
  highlightCity(city: number): void {
    if (city === this.highlighted) return;
    this.highlighted = city;
    this.highlightMask = null;
    this.requestDraw();
  }

  /** Hachure en blanc le territoire du joueur `player` (0 : retire) : la liste des joueurs de l'onglet Diplomatie. */
  highlightPlayer(player: number): void {
    if (player === this.highlightedPlayer) return;
    this.highlightedPlayer = player;
    this.playerMask = null;
    this.requestDraw();
  }

  /**
   * Hachures d'une vue : son masque de cases est dessiné à la caméra dans le calque
   * `hatch`, puis seul ce qu'il couvre est rempli du motif (`source-in`). Le motif
   * est décalé avec la carte, pour ne pas glisser quand on la déplace ; ses bandes
   * gardent la même épaisseur à l'écran à tout zoom.
   */
  private drawHatch(hatch: Hatching): void {
    const k = this.dpr;
    const h = this.hatchCtx;
    if (hatch.pattern === null || hatch.patternDpr !== k) {
      hatch.pattern = h.createPattern(buildHatchTile(k, hatch.rgba, hatch.slope, hatch.period, hatch.stroke), "repeat");
      hatch.patternDpr = k;
    }
    const pattern = hatch.pattern;
    if (pattern === null) return;
    const W = this.hatch.width;
    const H = this.hatch.height;
    h.globalCompositeOperation = "source-over";
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.clearRect(0, 0, W, H);
    h.setTransform(k * this.zoom, 0, 0, k * this.zoom, k * this.tx, k * this.ty);
    h.imageSmoothingEnabled = this.zoom < 1;
    h.drawImage(hatch.mask, 0, 0);
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.globalCompositeOperation = "source-in";
    pattern.setTransform(new DOMMatrix([1, 0, 0, 1, k * this.tx, k * this.ty]));
    h.fillStyle = pattern;
    h.fillRect(0, 0, W, H);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.hatch, 0, 0);
    ctx.restore();
  }

  /**
   * Zones de front (05-Fronts §11.1) : contour et hachures rouges des fronts actifs (case du menu Carte),
   * hachures bleues d'un front en paix au survol seulement ; la zone survolée s'affiche toujours.
   */
  private drawFrontZones(): void {
    const { ctx, zoom } = this;
    const px = 1 / zoom;
    const shown = this.listFront !== 0 ? this.listFront : this.hoverFront;
    const hovered = shown === 0 ? undefined : this.mirror.fronts.find((f) => f.id === shown);
    const shapes: { shape: ZoneShape | null; hatch: Hatching; stroke: string }[] = [];
    const RED = "rgba(200,30,30,0.95)";
    const BLUE = "rgba(40,90,210,0.95)";
    if (this.showFrontZones) shapes.push({ shape: this.frontLayer.activeZones(), hatch: this.frontHatchRed, stroke: RED });
    if (hovered !== undefined && (!this.showFrontZones || !hovered.active)) {
      shapes.push({ shape: this.frontLayer.zoneOf(hovered.id), hatch: hovered.active ? this.frontHatchRed : this.frontHatchBlue, stroke: hovered.active ? RED : BLUE });
    }
    for (const s of shapes) {
      if (s.shape === null) continue;
      s.hatch.mask = s.shape.mask;
      this.drawHatch(s.hatch);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = s.stroke;
      ctx.stroke(s.shape.outline);
    }
    // Front survolé : un contour plus épais montre qu'on peut cliquer (05-Fronts §11.1).
    if (hovered !== undefined) {
      const shape = this.frontLayer.zoneOf(hovered.id);
      if (shape !== null) {
        ctx.lineWidth = 5 * px;
        ctx.strokeStyle = hovered.active ? "rgba(200,30,30,1)" : "rgba(40,90,210,1)";
        ctx.stroke(shape.outline);
      }
    }
  }

  /** Les percées lancées, de l'un et l'autre camp, vues de la même façon. */
  private drawBreakthroughs(ctx: CanvasRenderingContext2D, px: number): void {
    const { mirror } = this;
    const w = mirror.width;
    const at = (id: number): { x: number; y: number } => {
      const t = mirror.cities[id - 1]!.tile;
      return { x: (t % w) + 0.5, y: Math.floor(t / w) + 0.5 };
    };
    for (const front of mirror.fronts) {
      for (const bt of front.breakthroughs) {
        // Celui qui perce part de sa propre ville et va vers celle de son adversaire.
        const own = mirror.cities[bt.city1 - 1]!.player === bt.owner;
        const from = at(own ? bt.city1 : bt.city2);
        const to = at(own ? bt.city2 : bt.city1);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = "#d11b1b";
        ctx.stroke();
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const s = ARROW_PX * px;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(angle) * s, my + Math.sin(angle) * s);
        ctx.lineTo(mx + Math.cos(angle + 2.5) * s, my + Math.sin(angle + 2.5) * s);
        ctx.lineTo(mx + Math.cos(angle - 2.5) * s, my + Math.sin(angle - 2.5) * s);
        ctx.closePath();
        ctx.fillStyle = "#d11b1b";
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
  }

  private invalidateLabels(): void {
    this.labels.invalidate();
    this.labelZoom = null;
  }

  /** Noms des joueurs, de taille constante à l'écran, quand la carte est assez dézoomée. Les positions restent en cache par palier de zoom. */
  /**
   * Unités d'un camp sur une connexion (05-Fronts §11.1) : `sign` -1 du côté de la ville 1, 1 de l'autre.
   * `all` faux : au plus une infanterie, centrée sur le segment, et rien d'autre.
   */
  private drawFrontSide(ctx: CanvasRenderingContext2D, px: number, m: FrontMark, sign: number, player: number, units: LinkUnits, all: boolean): void {
    // Perpendiculaire au segment, vers le haut de l'écran : l'infanterie est toujours du côté le plus haut.
    const up = m.ux > 0 || (m.ux === 0 && m.uy < 0) ? 1 : -1;
    const nx = m.uy * up;
    const ny = -m.ux * up;
    // Position d'une rangée, à `across` pixels d'écran du segment.
    const spot = (rank: number, across: number): { x: number; y: number } => {
      const along = sign * (FRONT_UNIT_ALONG_PX + rank * FRONT_UNIT_RANK_PX) * px;
      return { x: m.x + m.ux * along + nx * across * px, y: m.y + m.uy * along + ny * across * px };
    };
    // Les icônes regardent vers la gauche : à gauche du front, elles sont retournées pour faire face à l'adversaire.
    const flip = sign * m.ux < 0;
    const draw = (d: DivisionView, at: { x: number; y: number }): void => {
      const info = this.mirror.military.divisions[d.type];
      const icon = info === undefined ? null : unitIconCanvas(info.icon, d.owner);
      if (icon === null) return;
      const s = FRONT_UNIT_PX * px;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.scale(flip ? -1 : 1, 1);
      ctx.drawImage(icon, -s / 2, -s / 2, s, s);
      ctx.restore();
    };
    const first = spot(0, all ? FRONT_UNIT_ACROSS_PX : 0);
    if (units.infantry !== null) draw(units.infantry, first);
    else if (m.active && all) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, FRONT_EMPTY_PX * px, 0, Math.PI * 2);
      ctx.strokeStyle = rgbCss(playerColor(player));
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
    if (!all) return;
    // La première à côté de l'infanterie, les suivantes par deux derrière ; une unité seule sur sa rangée est centrée.
    const [beside, ...rest] = units.others;
    if (beside !== undefined) draw(beside, spot(0, -FRONT_UNIT_ACROSS_PX));
    rest.forEach((d, i) => {
      const alone = i % 2 === 0 && i === rest.length - 1;
      draw(d, spot(1 + Math.floor(i / 2), alone ? 0 : i % 2 === 0 ? FRONT_UNIT_ACROSS_PX : -FRONT_UNIT_ACROSS_PX));
    });
  }

  private drawPlayerLabels(ctx: CanvasRenderingContext2D): void {
    const { zoom } = this;
    if ((this.cssW * this.cssH) / (zoom * zoom) < LABEL_MIN_TILES) return;
    const k = this.dpr;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2 * LABEL_STROKE_PX;
    ctx.strokeStyle = "#000";
    const step = Math.round(Math.log(zoom) * LABEL_ZOOM_STEPS);
    if (step !== this.labelZoom) {
      this.labelZoom = step;
      // Bas du palier : le plus petit zoom du palier donne le nom le plus grand en cases.
      const low = Math.exp((step - 0.5) / LABEL_ZOOM_STEPS);
      const boxH = Math.ceil((LABEL_FONT_PX + 2 * LABEL_STROKE_PX) / low);
      this.labelSpots = this.labels.spots((player) => ({
        w: Math.ceil((ctx.measureText(rosterName(player)).width + 2 * LABEL_STROKE_PX) / low),
        h: boxH,
      }));
    }
    for (const spot of this.labelSpots) {
      const x = this.tx + spot.x * zoom;
      const y = this.ty + spot.y * zoom;
      const name = rosterName(spot.player);
      ctx.strokeText(name, x, y);
      ctx.fillStyle = rgbCss(playerLimit(spot.player));
      ctx.fillText(name, x, y);
    }
    ctx.restore();
  }

  private draw(): void {
    const { ctx, mirror, zoom } = this;
    const k = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1d232b";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k * zoom, 0, 0, k * zoom, k * this.tx, k * this.ty);
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(this.base, 0, 0);
    if (this.showFertility) this.drawHatch(this.fertileHatch);
    if (this.showIron) {
      this.drawHatch(this.ironHatch);
      this.drawHatch(this.aluminiumHatch);
    }

    this.drawFrontZones();

    if (this.highlighted > 0 && this.highlighted <= mirror.cities.length) {
      this.highlightMask ??= buildMask(mirror, (t) => mirror.tileCity[t] === this.highlighted);
      this.cityHatch.mask = this.highlightMask;
      this.drawHatch(this.cityHatch);
    }
    if (this.highlightedPlayer > 0) {
      this.playerMask ??= buildMask(mirror, (t) => mirror.ownerOf(t) === this.highlightedPlayer && (mirror.terrain[t]! & TERRAIN_LAND) !== 0);
      this.cityHatch.mask = this.playerMask;
      this.drawHatch(this.cityHatch);
    }

    const w = mirror.width;
    const px = 1 / zoom; // un pixel d'écran, en cases
    const cx = (t: number): number => (t % w) + 0.5;
    const cy = (t: number): number => Math.floor(t / w) + 0.5;
    const cities = mirror.cities;

    // Mode placement : rayon de contrôle qu'aurait une ville sur la case survolée.
    if (this.placement && this.hoverTile >= 0) {
      const t = this.hoverTile;
      ctx.beginPath();
      ctx.arc(cx(t), cy(t), mirror.controlRadius, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = "rgba(20,112,43,0.9)";
      ctx.stroke();
    }

    // Rayon d'expansion des villes du joueur, en mode placement (00-Game §3.1, §3.3).
    if (this.placement && mirror.cityIds[localPlayer() - 1]!.length > 0) {
      const r = mirror.expansionRadius;
      ctx.beginPath();
      for (const id of mirror.cityIds[localPlayer() - 1]!) {
        const t = cities[id - 1]!.tile;
        ctx.moveTo(cx(t) + r, cy(t));
        ctx.arc(cx(t), cy(t), r, 0, Math.PI * 2);
      }
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fill();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Routes : trait plein foncé entre deux villes d'un même joueur, pointillé gris sinon.
    // Chaque route suit son chemin de cases (00-Game §3.5), calculé quand la liste des routes change.
    // La partie en mer d'une route qui passe par deux ports (00-Game §3.6) est toujours en pointillé.
    const roads = mirror.roads;
    ctx.lineJoin = "round";
    for (let i = 0; i < roads.length; i += 2) {
      const a = cities[roads[i]! - 1]!;
      const b = cities[roads[i + 1]! - 1]!;
      const same = a.player === b.player;
      const path = mirror.roadTiles[i / 2]!;
      if (path.length === 0) continue;
      const sea = mirror.seaSpan(path);
      ctx.strokeStyle = same ? rgbCss(playerDark(a.player)) : "rgba(60,60,60,0.8)";
      ctx.lineWidth = (same ? 2 : 1.5) * px;
      const stroke = (from: number, to: number, dash: number[]): void => {
        if (to <= from) return;
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.moveTo(cx(path[from]!), cy(path[from]!));
        for (let k = from + 1; k <= to; k++) ctx.lineTo(cx(path[k]!), cy(path[k]!));
        ctx.stroke();
      };
      const landDash = same ? [] : [4 * px, 3 * px];
      if (sea === null) {
        stroke(0, path.length - 1, landDash);
      } else {
        stroke(0, sea[0], landDash);
        stroke(sea[0], sea[1], [5 * px, 4 * px]);
        stroke(sea[1], path.length - 1, landDash);
      }
    }
    ctx.setLineDash([]);

    // Taille d'une ville, aussi celle des soldats du front.
    const s0 = Math.min(6.5, Math.max(3, zoom * 1.6)) * px;

    // Fronts actifs (05-Fronts §11.4) : le point d'avancement du front sur chaque connexion, et de loin, de chaque côté, un rond de la
    // couleur du joueur de ce côté (deux soldats qui se battent), de la taille d'une ville.
    // Assez près, chaque camp montre les unités de sa première ligne à la place du rond, en guerre comme en paix.
    const tiles = this.visibleTiles();
    const units = tiles <= FRONT_INFANTRY_MAX_TILES ? this.frontLayer.markUnits() : null;
    const all = tiles <= FRONT_UNITS_MAX_TILES;
    this.frontLayer.marks().forEach((m, i) => {
      if (m.active) {
        ctx.fillStyle = "#7a0c0c";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5 * px, 0, Math.PI * 2);
        ctx.fill();
      }
      if (units !== null) {
        this.drawFrontSide(ctx, px, m, -1, m.player1, units[i]!.units1, all);
        this.drawFrontSide(ctx, px, m, 1, m.player2, units[i]!.units2, all);
        return;
      }
      if (!m.active) return;
      ctx.lineWidth = 1.5 * px;
      const d = s0 + 3 * px;
      for (const [sign, player] of [[-1, m.player1], [1, m.player2]] as const) {
        ctx.beginPath();
        ctx.arc(m.x + sign * m.ux * d, m.y + sign * m.uy * d, s0, 0, Math.PI * 2);
        ctx.fillStyle = rgbCss(playerColor(player));
        ctx.strokeStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
    });

    // Percées en cours, des deux camps (05-Fronts §11.1) : un trait rouge le long du segment droit entre les deux villes de l'axe,
    // et une flèche au milieu, de la ville de celui qui perce vers celle de son adversaire.
    this.drawBreakthroughs(ctx, px);

    // Mode choix d'axe : la connexion du front la plus proche de la souris.
    if (this.axisFront !== 0 && this.axisHover !== null) {
      const a = cities[this.axisHover.city1 - 1]!;
      const b = cities[this.axisHover.city2 - 1]!;
      ctx.beginPath();
      ctx.moveTo(cx(a.tile), cy(a.tile));
      ctx.lineTo(cx(b.tile), cy(b.tile));
      ctx.strokeStyle = "rgba(255,60,40,0.95)";
      ctx.lineWidth = 5 * px;
      ctx.stroke();
    }

    // Villes : un point, une étoile pour la capitale, un carré bleu pour le port.
    ctx.lineWidth = 1.5 * px;
    for (const city of cities) {
      const x = cx(city.tile);
      const y = cy(city.tile);
      const capital = mirror.stats[city.player - 1]?.capital === city.id;
      // Plus de ville agrandie par une usine : il n'y a pas d'usine sur la carte (08 §2).
      const s = s0;
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = rgbCss(playerDark(city.player));
      ctx.beginPath();
      if (capital) star(ctx, x, y, s * 2);
      else ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (city.port) {
        const pt = mirror.portTile(city.id);
        const off = pt === city.tile ? s * 1.4 : 0;
        const side = s * 1.5;
        ctx.fillStyle = "#1d6fd8";
        ctx.fillRect(cx(pt) + off - side / 2, cy(pt) - off - side / 2, side, side);
        ctx.strokeRect(cx(pt) + off - side / 2, cy(pt) - off - side / 2, side, side);
      }
    }

    // Case survolée en mode placement : verte si la fondation est permise, rouge sinon.
    if (this.placement && this.hoverTile >= 0) {
      const t = this.hoverTile;
      const ok = this.placementCheck(t) === null;
      const x = t % w;
      const y = (t - x) / w;
      // Au moins 8 pixels d'écran de côté, pour rester visible quand la carte est dézoomée.
      const side = Math.max(1, 8 * px);
      ctx.fillStyle = ok ? "rgba(60,200,90,0.6)" : "rgba(220,60,50,0.6)";
      ctx.fillRect(x + 0.5 - side / 2, y + 0.5 - side / 2, side, side);
      ctx.strokeStyle = ok ? "#14702b" : "#8f1f16";
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(x + 0.5 - side / 2, y + 0.5 - side / 2, side, side);
    }
    // En dernier : les noms passent par-dessus les villes, les routes et les fronts.
    this.drawPlayerLabels(ctx);
    this.onDrawn?.();
  }
}

function hatching(mask: HTMLCanvasElement, rgba: Rgba, slope: 1 | -1, period = HATCH_PERIOD_PX, stroke = HATCH_WIDTH_PX): Hatching {
  return { mask, rgba, slope, pattern: null, patternDpr: 0, period, stroke };
}

/**
 * Un pixel par case : blanc opaque si `inside(t)`, transparent sinon. Calculé une
 * fois : la fertilité et le fer ne changent pas pendant la partie.
 */
function buildMask(mirror: Mirror, inside: (t: number) => boolean): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = mirror.width;
  layer.height = mirror.height;
  const lctx = layer.getContext("2d");
  if (lctx === null) throw new Error("canvas 2D indisponible");
  const img = new ImageData(mirror.width, mirror.height);
  const d = img.data;
  for (let t = 0; t < mirror.width * mirror.height; t++) {
    if (inside(t)) d.fill(255, t * 4, t * 4 + 4);
  }
  lctx.putImageData(img, 0, 0);
  return layer;
}

/** Tuile du motif de hachures : bandes diagonales de `HATCH_WIDTH_PX` sur une période de `HATCH_PERIOD_PX`, en pixels d'écran. */
function buildHatchTile(dpr: number, rgba: Rgba, slope: 1 | -1, period: number, stroke: number): HTMLCanvasElement {
  const p = Math.max(2, Math.round(period * dpr));
  const width = Math.max(1, Math.round(stroke * dpr));
  const tile = document.createElement("canvas");
  tile.width = p;
  tile.height = p;
  const tctx = tile.getContext("2d");
  if (tctx === null) throw new Error("canvas 2D indisponible");
  const img = new ImageData(p, p);
  for (let y = 0; y < p; y++) {
    for (let x = 0; x < p; x++) {
      const d = slope === 1 ? (x + y) % p : (x - y + p) % p;
      if (d >= width) continue;
      img.data.set(rgba, (y * p + x) * 4);
    }
  }
  tctx.putImageData(img, 0, 0);
  return tile;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.45;
    if (k === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
}
