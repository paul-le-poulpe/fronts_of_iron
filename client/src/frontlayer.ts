// Ce que la carte dessine pour les fronts (Docs/Design/05-Fronts.md §11.1, §11.4) :
// masques des zones de front (pour les hachures), contours, courbe de Catmull-Rom.
// Tout est recalculé quand les fronts changent (`Mirror.frontsVersion`), pas à chaque
// image. Les zones sont un calcul du client seulement.

import { catmullRom, connectionPoint, frontChains, frontPoints } from "./frontgeom.ts";
import type { Mirror } from "./mirror.ts";
import type { FrontView } from "./protocol.ts";

/** Un masque de cases (un pixel opaque par case) et le contour de ces cases. */
export interface ZoneShape {
  readonly mask: HTMLCanvasElement;
  readonly outline: Path2D;
}

export class FrontLayer {
  private version = -1;
  private zones: Uint16Array = new Uint16Array(0);
  private active: ZoneShape | null = null;
  private single = new Map<number, ZoneShape>();
  private curvePath: Path2D | null = null;
  private readonly mirror: Mirror;

  constructor(mirror: Mirror) {
    this.mirror = mirror;
  }

  /** Recalcule ce qui dépend des fronts s'ils ont changé depuis le dernier appel. */
  private sync(): void {
    if (this.version === this.mirror.frontsVersion) return;
    this.version = this.mirror.frontsVersion;
    this.zones = this.mirror.frontZones();
    this.active = null;
    this.single.clear();
    this.curvePath = null;
  }

  /** Front dont la zone contient la case, ou undefined. */
  frontAt(tile: number): FrontView | undefined {
    this.sync();
    const id = this.zones[tile];
    return id === undefined || id === 0 ? undefined : this.mirror.fronts.find((f) => f.id === id);
  }

  private shape(inside: (frontId: number) => boolean): ZoneShape | null {
    const m = this.mirror;
    const w = m.width;
    const h = m.height;
    const zones = this.zones;
    const ok = (t: number): boolean => zones[t] !== 0 && inside(zones[t]!);
    let any = false;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("canvas 2D indisponible");
    const img = new ImageData(w, h);
    const outline = new Path2D();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y * w + x;
        if (!ok(t)) continue;
        any = true;
        img.data.fill(255, t * 4, t * 4 + 4);
        // Les côtés de la case qui touchent une case hors de la zone (ou le bord de la carte).
        if (y === 0 || !ok(t - w)) {
          outline.moveTo(x, y);
          outline.lineTo(x + 1, y);
        }
        if (y === h - 1 || !ok(t + w)) {
          outline.moveTo(x, y + 1);
          outline.lineTo(x + 1, y + 1);
        }
        if (x === 0 || !ok(t - 1)) {
          outline.moveTo(x, y);
          outline.lineTo(x, y + 1);
        }
        if (x === w - 1 || !ok(t + 1)) {
          outline.moveTo(x + 1, y);
          outline.lineTo(x + 1, y + 1);
        }
      }
    }
    if (!any) return null;
    ctx.putImageData(img, 0, 0);
    return { mask: canvas, outline };
  }

  /** Zones de tous les fronts actifs (case « Zones de front » du menu Carte). */
  activeZones(): ZoneShape | null {
    this.sync();
    if (this.active === null) {
      const activeIds = new Set(this.mirror.fronts.filter((f) => f.active).map((f) => f.id));
      this.active = this.shape((id) => activeIds.has(id));
    }
    return this.active;
  }

  /** Zone d'un seul front (survol). */
  zoneOf(frontId: number): ZoneShape | null {
    this.sync();
    let s = this.single.get(frontId);
    if (s === undefined) {
      s = this.shape((id) => id === frontId) ?? undefined;
      if (s === undefined) return null;
      this.single.set(frontId, s);
    }
    return s;
  }

  /** Courbe de Catmull-Rom de chaque front actif, en cases (05-Fronts §11.4). */
  curves(): Path2D {
    this.sync();
    if (this.curvePath === null) {
      const world = this.mirror.world();
      const path = new Path2D();
      for (const f of this.mirror.fronts) {
        if (!f.active) continue;
        const points = frontPoints(world, f);
        for (const chain of frontChains(world, f)) {
          const curve = catmullRom(chain.order.map((i) => points[i]!), chain.closed);
          if (curve === null) continue;
          path.moveTo(curve.start.x, curve.start.y);
          for (const s of curve.segments) path.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
          if (chain.closed) path.closePath();
        }
      }
      this.curvePath = path;
    }
    return this.curvePath;
  }

  /** Point du front de chaque connexion d'un front actif : de petits repères sur la courbe. */
  points(): { x: number; y: number }[] {
    this.sync();
    const world = this.mirror.world();
    const out: { x: number; y: number }[] = [];
    for (const f of this.mirror.fronts) {
      if (!f.active) continue;
      f.connections.forEach((_, i) => out.push(connectionPoint(world, f, i)));
    }
    return out;
  }
}
