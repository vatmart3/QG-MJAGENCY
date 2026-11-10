/**
 * Raster pixel art maison : on écrit directement dans un ImageData,
 * remplissages de polygones au centre des pixels (pas d'anticrénelage).
 */

export type RGBA = number; // 0xRRGGBBAA

export const rgb = (hex: string, a = 255): RGBA => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return ((n << 8) | (a & 255)) >>> 0;
};

export function mix(c1: RGBA, c2: RGBA, t: number): RGBA {
  const r = ((c1 >>> 24) & 255) * (1 - t) + ((c2 >>> 24) & 255) * t;
  const g = ((c1 >>> 16) & 255) * (1 - t) + ((c2 >>> 16) & 255) * t;
  const b = ((c1 >>> 8) & 255) * (1 - t) + ((c2 >>> 8) & 255) * t;
  const a = (c1 & 255) * (1 - t) + (c2 & 255) * t;
  return ((Math.round(r) << 24) | (Math.round(g) << 16) | (Math.round(b) << 8) | Math.round(a)) >>> 0;
}

export const shade = (c: RGBA, k: number): RGBA => (k >= 0 ? mix(c, 0xffffffff, k) : mix(c, ((0x1c1530 << 8) | (c & 255)) >>> 0, -k));
export const withAlpha = (c: RGBA, a: number): RGBA => ((c & 0xffffff00) | (a & 255)) >>> 0;

export class PixelCanvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  /** Fenêtre de dessin décalée (pour dessiner dans une région d'atlas). */
  region(ox: number, oy: number, w: number, h: number): Pen {
    return new Pen(this, ox, oy, w, h);
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    ctx.putImageData(new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, this.w, this.h), 0, 0);
    return c;
  }
}

/** Crayon : toutes les primitives, avec clipping sur sa région. */
export class Pen {
  constructor(
    readonly pc: PixelCanvas,
    readonly ox: number,
    readonly oy: number,
    readonly w: number,
    readonly h: number,
  ) {}

  set(x: number, y: number, c: RGBA): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = c & 255;
    if (a === 0) return;
    const i = ((this.oy + y) * this.pc.w + (this.ox + x)) * 4;
    const d = this.pc.data;
    if (a === 255 || d[i + 3] === 0) {
      d[i] = c >>> 24;
      d[i + 1] = (c >>> 16) & 255;
      d[i + 2] = (c >>> 8) & 255;
      d[i + 3] = a;
      return;
    }
    // composition « over »
    const sa = a / 255;
    const da = d[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    d[i] = ((c >>> 24) * sa + d[i]! * da * (1 - sa)) / oa;
    d[i + 1] = (((c >>> 16) & 255) * sa + d[i + 1]! * da * (1 - sa)) / oa;
    d[i + 2] = (((c >>> 8) & 255) * sa + d[i + 2]! * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = ((this.oy + y) * this.pc.w + (this.ox + x)) * 4;
    this.pc.data[i + 3] = 0;
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const i = ((this.oy + y) * this.pc.w + (this.ox + x)) * 4;
    const d = this.pc.data;
    return ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  hline(x0: number, x1: number, y: number, c: RGBA): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: RGBA): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  /** Remplissage de polygone convexe ou concave, échantillonné au centre des pixels. */
  poly(pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const n = pts.length;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % n]!;
        if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) {
          xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k]! - 0.5);
        const xb = Math.floor(xs[k + 1]! - 0.5);
        for (let x = xa; x <= xb; x++) this.set(x, y, typeof c === "function" ? c(x, y) : c);
      }
    }
  }

  /** Ligne pixel (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }

  /** Contour automatique : chaque pixel vide voisin d'un pixel plein prend la couleur c. */
  outline(c: RGBA, x0 = 0, y0 = 0, w = this.w, h = this.h): void {
    const marks: [number, number][] = [];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if ((this.get(x, y) & 255) !== 0) continue;
        const n =
          (this.get(x + 1, y) & 255) > 128 ||
          (this.get(x - 1, y) & 255) > 128 ||
          (this.get(x, y + 1) & 255) > 128 ||
          (this.get(x, y - 1) & 255) > 128;
        if (n) marks.push([x, y]);
      }
    for (const [x, y] of marks) this.set(x, y, c);
  }
}

// ------------------------------------------------------------------
// Primitives isométriques. Unité : 1 case = 32×16 px. Les points de grille
// (u, v) sont relatifs à une origine écran (ox, oy) = sommet haut de la case (0,0).

export const HW = 16;
export const HH = 8;

export function isoPt(ox: number, oy: number, u: number, v: number, z = 0): [number, number] {
  return [ox + (u - v) * HW, oy + (u + v) * HH - z];
}

export interface BoxColors {
  top: RGBA;
  left: RGBA;
  right: RGBA;
  /** liseré clair sur l'arête avant du dessus */
  rim?: RGBA;
}

/**
 * Boîte iso : emprise [u0,u1]×[v0,v1] (en cases), du sol z0 jusqu'à z1 (px).
 * Face « gauche » = face +v (bas-gauche), face « droite » = face +u (bas-droite).
 */
export function isoBox(p: Pen, ox: number, oy: number, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, col: BoxColors): void {
  const A = isoPt(ox, oy, u0, v1, z0);
  const B = isoPt(ox, oy, u1, v1, z0);
  const Cc = isoPt(ox, oy, u1, v0, z0);
  const A2 = isoPt(ox, oy, u0, v1, z1);
  const B2 = isoPt(ox, oy, u1, v1, z1);
  const C2 = isoPt(ox, oy, u1, v0, z1);
  const D2 = isoPt(ox, oy, u0, v0, z1);
  if (z1 > z0) {
    p.poly([A2, B2, B, A], col.left);
    p.poly([B2, C2, Cc, B], col.right);
  }
  p.poly([D2, C2, B2, A2], col.top);
  if (col.rim !== undefined) {
    p.line(A2[0], A2[1] - 0.5, B2[0] - 1, B2[1] - 0.5, col.rim);
    p.line(B2[0], B2[1] - 0.5, C2[0] - 1, C2[1] - 0.5, col.rim);
  }
}

/** Couleurs d'une boîte à partir d'une teinte de base. */
export function boxOf(base: RGBA, rim = true): BoxColors {
  return { top: shade(base, 0.12), left: shade(base, -0.12), right: shade(base, -0.28), rim: rim ? shade(base, 0.35) : undefined };
}
