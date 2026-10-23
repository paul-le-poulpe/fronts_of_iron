// Le canvas de la carte : caméra (molette = zoom, glisser = déplacer), tampon de
// pixels de la carte (painter.ts), puis par-dessus, à chaque image : routes,
// villes, capitales, ports, et en mode placement le rayon d'expansion et la case
// survolée. Le tampon n'est renvoyé au canvas que pour la partie repeinte.

import type { Mirror } from "./mirror.ts";
import { type Painter, playerDark, rgbCss } from "./painter.ts";
import { HUMAN } from "./protocol.ts";

export interface MapViewHooks {
  /** Case sous la souris, ou -1 hors de la carte. */
  onHover(tile: number): void;
  /** Clic (sans glisser) sur une case de la carte. */
  onClick(tile: number): void;
}

const MAX_ZOOM = 48;
const DRAG_THRESHOLD_PX = 4;

export class MapView {
  /** Mode « Créer une ville » actif. */
  placement = false;
  /** Raison pour laquelle on ne peut pas fonder une ville sur cette case, ou null si c'est permis. */
  placementCheck: (tile: number) => string | null = () => null;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mirror: Mirror;
  private readonly painter: Painter;
  private readonly hooks: MapViewHooks;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
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
    if (this.placement) this.requestDraw();
  }

  /** À rappeler quand le mode placement ou les villes changent. */
  refresh(): void {
    this.canvas.classList.toggle("placing", this.placement);
    this.requestDraw();
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

    const w = mirror.width;
    const px = 1 / zoom; // un pixel d'écran, en cases
    const cx = (t: number): number => (t % w) + 0.5;
    const cy = (t: number): number => Math.floor(t / w) + 0.5;
    const cities = mirror.cities;

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
    const roads = mirror.roads;
    for (let i = 0; i < roads.length; i += 2) {
      const a = cities[roads[i]! - 1]!;
      const b = cities[roads[i + 1]! - 1]!;
      const same = a.player === b.player;
      ctx.beginPath();
      ctx.setLineDash(same ? [] : [4 * px, 3 * px]);
      ctx.strokeStyle = same ? rgbCss(playerDark(a.player)) : "rgba(60,60,60,0.8)";
      ctx.lineWidth = (same ? 2 : 1.5) * px;
      ctx.moveTo(cx(a.tile), cy(a.tile));
      ctx.lineTo(cx(b.tile), cy(b.tile));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Villes : un point, une étoile pour la capitale, un carré bleu pour le port.
    const s = Math.min(6.5, Math.max(3, zoom * 1.6)) * px;
    ctx.lineWidth = 1.5 * px;
    for (const city of cities) {
      const x = cx(city.tile);
      const y = cy(city.tile);
      const capital = mirror.stats[city.player - 1]?.capital === city.id;
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
  }
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
