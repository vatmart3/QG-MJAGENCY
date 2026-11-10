import { PixelCanvas, type Pen } from "./pixel";

/**
 * Atlas unique : tous les sprites (mobilier, bonshommes, décor) sont dessinés
 * dans une seule texture → un seul lot de rendu WebGL, même avec le tri en profondeur.
 */

export interface AtlasEntryDef {
  key: string;
  w: number;
  h: number;
  /** point d'ancrage dans la région (px) */
  ax: number;
  ay: number;
  draw: (p: Pen) => void;
}

export interface AtlasFrame {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface BuiltAtlas {
  canvas: HTMLCanvasElement;
  frames: Map<string, AtlasFrame>;
}

export function buildAtlas(defs: AtlasEntryDef[], width = 2048): BuiltAtlas {
  // rangement en étagères, du plus haut au plus bas
  const sorted = [...defs].sort((a, b) => b.h - a.h || b.w - a.w);
  const pad = 1;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  const placed: AtlasFrame[] = [];
  for (const d of sorted) {
    if (x + d.w + pad > width) {
      x = 0;
      y += shelfH + pad;
      shelfH = 0;
    }
    placed.push({ key: d.key, x, y, w: d.w, h: d.h, ax: d.ax, ay: d.ay });
    x += d.w + pad;
    shelfH = Math.max(shelfH, d.h);
  }
  const height = y + shelfH + pad;
  const pc = new PixelCanvas(width, Math.max(1, height));
  const frames = new Map<string, AtlasFrame>();
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const f of placed) {
    const def = byKey.get(f.key);
    if (!def) continue;
    def.draw(pc.region(f.x, f.y, f.w, f.h));
    frames.set(f.key, f);
  }
  return { canvas: pc.toCanvas(), frames };
}
