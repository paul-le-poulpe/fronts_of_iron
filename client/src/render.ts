// Le canvas de la carte : caméra (molette = zoom, glisser = déplacer), tampon de
// pixels de la carte (painter.ts), puis par-dessus, à chaque image : hachures de
// fertilité (vue « Fertilité ») et de fer (vue « Ressources naturelles »), routes, villes, capitales, ports, et en mode
// placement le rayon d'expansion et la case survolée. Le tampon n'est renvoyé au
// canvas que pour la partie repeinte.

import { type Mirror, TERRAIN_LAND } from "./mirror.ts";
import { type Painter, playerDark, rgbCss } from "./painter.ts";
import { factoryInitial } from "./names.ts";
import { HUMAN } from "./protocol.ts";

export interface MapViewHooks {
  /** Case sous la souris, ou -1 hors de la carte. */
  onHover(tile: number): void;
  /** Clic (sans glisser) sur une case de la carte. */
  onClick(tile: number): void;
}

const MAX_ZOOM = 48;
const DRAG_THRESHOLD_PX = 4;
/** Hachures des vues : période et épaisseur des bandes, en pixels CSS (constantes à l'écran, quel que soit le zoom). */
const HATCH_PERIOD_PX = 10;
const HATCH_WIDTH_PX = 4;

type Rgba = readonly [number, number, number, number];

/** Hachures d'une vue du menu Carte : un masque de cases, une couleur, un sens des bandes. */
interface Hatching {
  /** Un pixel opaque par case hachurée. */
  readonly mask: HTMLCanvasElement;
  readonly rgba: Rgba;
  /** Bandes « / » (1) ou « \ » (-1) : la fertilité et le fer se croisent quand les deux sont affichés. */
  readonly slope: 1 | -1;
  /** Motif, refait quand la densité de pixels change. */
  pattern: CanvasPattern | null;
  patternDpr: number;
}

export class MapView {
  /** Mode « Créer une ville » actif. */
  placement = false;
  /** Raison pour laquelle on ne peut pas fonder une ville sur cette case, ou null si c'est permis. */
  placementCheck: (tile: number) => string | null = () => null;
  /** Mode « Inaugurer une usine » armé : la zone survolée est colorée. */
  factoryMode = false;
  /** Ville dont la zone contient la case, et `ok` si on peut y inaugurer l'usine ; ville 0 : aucune zone. */
  factoryCheck: (tile: number) => { city: number; ok: boolean } = () => ({ city: 0, ok: false });
  /** Vue « Fertilité » du menu Carte : hachures vertes sur les cases cultivables. */
  showFertility = false;
  /** Vue « Ressources naturelles » du menu Carte : hachures rouge foncé sur les cases de fer. */
  showIron = false;

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
  /** Calque des hachures, à la taille du canvas : un masque à la caméra, rempli du motif. */
  private readonly hatch: HTMLCanvasElement;
  private readonly hatchCtx: CanvasRenderingContext2D;
  /** Zones de ville colorées pour le mode usine, par « ville:ok » ; vidé quand les zones changent. */
  private readonly zoneLayers = new Map<string, { canvas: HTMLCanvasElement; x: number; y: number }>();
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
      buildMask(mirror, (t) => (mirror.resources[t]! & 1) !== 0 && (mirror.terrain[t]! & TERRAIN_LAND) !== 0),
      [130, 30, 22, 190],
      -1,
    );
    this.hatch = document.createElement("canvas");
    const hatchCtx = this.hatch.getContext("2d");
    if (hatchCtx === null) throw new Error("canvas 2D indisponible");
    this.hatchCtx = hatchCtx;
    this.uploadAll();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Envoie tout le tampon au canvas de la carte (début de partie, bascule du fer). */
  uploadAll(): void {
    this.baseCtx.putImageData(this.image, 0, 0);
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
    this.requestDraw();
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
    this.requestDraw();
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
    if (this.placement || this.factoryMode) this.requestDraw();
  }

  /** À rappeler quand un mode (placement, usine), les villes ou les usines changent. */
  refresh(): void {
    this.canvas.classList.toggle("placing", this.placement || this.factoryMode);
    this.zoneLayers.clear();
    this.requestDraw();
  }

  /** Calque des cases de la zone de la ville `city`, vert ou rouge, avec la position de son coin dans la carte. */
  private zoneLayer(city: number, ok: boolean): { canvas: HTMLCanvasElement; x: number; y: number } {
    const key = `${city}:${ok ? 1 : 0}`;
    const cached = this.zoneLayers.get(key);
    if (cached) return cached;
    const m = this.mirror;
    const r = m.controlRadius;
    const ct = m.cities[city - 1]!.tile;
    const cx = ct % m.width;
    const cy = (ct - cx) / m.width;
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const x1 = Math.min(m.width - 1, cx + r);
    const y1 = Math.min(m.height - 1, cy + r);
    const canvas = document.createElement("canvas");
    canvas.width = x1 - x0 + 1;
    canvas.height = y1 - y0 + 1;
    const lctx = canvas.getContext("2d");
    if (lctx === null) throw new Error("canvas 2D indisponible");
    const img = new ImageData(canvas.width, canvas.height);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (m.tileCity[y * m.width + x] !== city) continue;
        const i = ((y - y0) * canvas.width + (x - x0)) * 4;
        img.data[i] = ok ? 40 : 220;
        img.data[i + 1] = ok ? 200 : 50;
        img.data[i + 2] = ok ? 70 : 40;
        img.data[i + 3] = 120;
      }
    }
    lctx.putImageData(img, 0, 0);
    const layer = { canvas, x: x0, y: y0 };
    this.zoneLayers.set(key, layer);
    return layer;
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
      hatch.pattern = h.createPattern(buildHatchTile(k, hatch.rgba, hatch.slope), "repeat");
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
    if (this.showIron) this.drawHatch(this.ironHatch);

    const w = mirror.width;
    const px = 1 / zoom; // un pixel d'écran, en cases
    const cx = (t: number): number => (t % w) + 0.5;
    const cy = (t: number): number => Math.floor(t / w) + 0.5;
    const cities = mirror.cities;

    // Mode usine : la zone de la ville survolée, verte si elle peut recevoir l'usine, rouge sinon.
    if (this.factoryMode && this.hoverTile >= 0) {
      const target = this.factoryCheck(this.hoverTile);
      if (target.city > 0) {
        const layer = this.zoneLayer(target.city, target.ok);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(layer.canvas, layer.x, layer.y);
        ctx.imageSmoothingEnabled = zoom < 1;
      }
    }

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
    if (this.placement && mirror.cityIds[HUMAN - 1]!.length > 0) {
      const r = mirror.expansionRadius;
      ctx.beginPath();
      for (const id of mirror.cityIds[HUMAN - 1]!) {
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
    const roads = mirror.roads;
    ctx.lineJoin = "round";
    for (let i = 0; i < roads.length; i += 2) {
      const a = cities[roads[i]! - 1]!;
      const b = cities[roads[i + 1]! - 1]!;
      const same = a.player === b.player;
      const path = mirror.roadTiles[i / 2]!;
      ctx.beginPath();
      ctx.setLineDash(same ? [] : [4 * px, 3 * px]);
      ctx.strokeStyle = same ? rgbCss(playerDark(a.player)) : "rgba(60,60,60,0.8)";
      ctx.lineWidth = (same ? 2 : 1.5) * px;
      ctx.moveTo(cx(path[0]!), cy(path[0]!));
      for (let k = 1; k < path.length; k++) ctx.lineTo(cx(path[k]!), cy(path[k]!));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Villes : un point, une étoile pour la capitale, un carré bleu pour le port.
    const s0 = Math.min(6.5, Math.max(3, zoom * 1.6)) * px;
    ctx.lineWidth = 1.5 * px;
    for (const city of cities) {
      const x = cx(city.tile);
      const y = cy(city.tile);
      const capital = mirror.stats[city.player - 1]?.capital === city.id;
      // Une ville qui porte une usine est dessinée plus grande, selon son niveau (00-Game §3.7).
      const factory = mirror.factoryMarks.get(city.id);
      const s = factory ? s0 * (1 + Math.min(factory.level, 10) * 0.08) : s0;
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = rgbCss(playerDark(city.player));
      ctx.beginPath();
      if (capital) star(ctx, x, y, s * 2);
      else ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Logo de l'usine à côté de la ville : un carré avec l'initiale du type (provisoire).
      if (factory) {
        const side = s0 * 2.4;
        const fx = x + s * 1.1;
        const fy = y - s * 1.1 - side;
        ctx.fillStyle = "#3a3430";
        ctx.fillRect(fx, fy, side, side);
        ctx.strokeRect(fx, fy, side, side);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${side * 0.75}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(factoryInitial(factory.type), fx + side / 2, fy + side / 2 + side * 0.04);
      }
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
  }
}

function hatching(mask: HTMLCanvasElement, rgba: Rgba, slope: 1 | -1): Hatching {
  return { mask, rgba, slope, pattern: null, patternDpr: 0 };
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
function buildHatchTile(dpr: number, rgba: Rgba, slope: 1 | -1): HTMLCanvasElement {
  const p = Math.max(2, Math.round(HATCH_PERIOD_PX * dpr));
  const width = Math.max(1, Math.round(HATCH_WIDTH_PX * dpr));
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
