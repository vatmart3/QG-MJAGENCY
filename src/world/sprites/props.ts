import { boxOf, isoBox, isoPt, mix, rgb, shade, withAlpha, type Pen, type RGBA } from "./pixel";
import type { AtlasEntryDef } from "./atlas";
import { iso, tourDe, type Prop, type PropKind, type Side, type WallSlab, type Zone } from "../layout";
import { hash2, mulberry32 } from "@/lib/rng";
import type { StyleVille } from "../theme";
import { automne, drawBrownstone, drawCar, drawLoftWall, drawTower, tourTete } from "./newyork";

/** Style de dessin courant (fixé avant la construction de l'atlas). */
let styleDessin: StyleVille = "sete";
export function dessinerEnStyle(s: StyleVille): void {
  styleDessin = s;
}

/** Hauteur réservée au-dessus de l'emprise, par type de meuble. */
const HEAD: Record<PropKind, number> = {
  desk: 26, chair: 18, plant: 30, printer: 16, whiteboard: 26, shelf: 30, bigTable: 16, counter: 18,
  coffee: 30, roundTable: 14, parasol: 46, sofa: 18, beanbag: 12, babyfoot: 18, pingpong: 16,
  pine: 52, tree: 46, bush: 16, lamp: 38, bollard: 12, crate: 16, barrel: 16, bench: 16, phare: 118,
  pile: 8, stampDesk: 20, bigScreen: 30, archive: 32, flowers: 10, railing: 12,
  house: 62, treadmill: 22, weights: 22, tower: 0,
};

export function propKey(p: Pick<Prop, "kind" | "variant" | "facing" | "w" | "h" | "color">): string {
  return `prop:${p.kind}:${p.variant ?? 0}:${p.facing ?? "-"}:${p.w ?? 1}x${p.h ?? 1}${p.color ? `:${p.color}` : ""}`;
}

export function propDefs(props: Prop[]): AtlasEntryDef[] {
  const seen = new Map<string, AtlasEntryDef>();
  for (const p of props) {
    const key = propKey(p);
    if (seen.has(key)) continue;
    const fw = p.w ?? 1;
    const fh = p.h ?? 1;
    const head = p.kind === "tower" ? tourTete(p.variant ?? 0) : HEAD[p.kind];
    const W = (fw + fh) * 16;
    const H = (fw + fh) * 8 + head;
    const ox = fh * 16;
    const oy = head;
    seen.set(key, {
      key,
      w: W,
      h: H,
      ax: ox,
      ay: oy,
      draw: (pen) => drawProp(pen, p, ox, oy),
    });
  }
  return [...seen.values()];
}

/** Calque « fenêtres allumées » des gratte-ciel (ajouté en lumière la nuit). */
export const litKey = (p: Prop) => `lit:${propKey(p)}`;
export const litKeyAt = (p: Prop) => `${litKey(p)}@${p.x},${p.y}`;
export function towerLitDefs(props: Prop[], zones: Zone[]): AtlasEntryDef[] {
  // silhouettes (hexagones iso, coordonnées monde) de ce qui peut se trouver devant une tour
  type Occ = { d: number; pts: { x: number; y: number }[]; x0: number; x1: number; y0: number; y1: number };
  const hex = (x: number, y: number, w: number, h: number, H: number, d: number): Occ => {
    const b = [iso(x, y + h), iso(x + w, y + h), iso(x + w, y)];
    const t = [iso(x + w, y), iso(x, y), iso(x, y + h)].map((q) => ({ x: q.x, y: q.y - H }));
    const pts = [...b, ...t];
    return { d, pts, x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) };
  };
  const occ: Occ[] = [];
  for (const p of props) {
    const w = p.w ?? 1, h = p.h ?? 1;
    if (p.kind === "tower") occ.push(hex(p.x + 0.1, p.y + 0.1, w - 0.2, h - 0.2, tourDe(p.variant ?? 0).hauteur, p.x + w + p.y + h));
    if (p.kind === "house") occ.push(hex(p.x, p.y, w, h, 56, p.x + w + p.y + h));
  }
  for (const z of zones) occ.push(hex(z.x, z.y, z.w, z.h, 31, z.x + z.w + z.y + z.h));
  const dedans = (o: Occ, x: number, y: number) => {
    if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) return false;
    let signe = 0;
    for (let i = 0; i < o.pts.length; i++) {
      const a = o.pts[i]!, b = o.pts[(i + 1) % o.pts.length]!;
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) {
        if (signe === 0) signe = Math.sign(c);
        else if (Math.sign(c) !== signe) return false;
      }
    }
    return true;
  };
  const seen = new Map<string, AtlasEntryDef>();
  for (const p of props) {
    if (p.kind !== "tower") continue;
    const key = `${litKey(p)}@${p.x},${p.y}`;
    if (seen.has(key)) continue;
    const fw = p.w ?? 1;
    const fh = p.h ?? 1;
    const head = tourTete(p.variant ?? 0);
    const d = p.x + fw + p.y + fh;
    const o0 = iso(p.x, p.y);
    const devant = occ.filter((o) => o.d > d);
    const cache = (X: number, Y: number) => {
      const wx = o0.x - fh * 16 + X + 1, wy = o0.y - head + Y + 1;
      return devant.some((o) => dedans(o, wx, wy));
    };
    seen.set(key, { key, w: (fw + fh) * 16, h: (fw + fh) * 8 + head, ax: fh * 16, ay: head, draw: (pen) => drawTower(pen, fh * 16, head, fw, fh, p.variant ?? 0, true, cache) });
  }
  return [...seen.values()];
}

/** Taxis jaunes et quelques voitures (style New York). */
export const COULEURS_VOITURES = ["#f2c230", "#f2c230", "#f2c230", "#2b2f3a", "#e9e9e9", "#3a5c9c", "#b33a3a"];
export function carDefs(): AtlasEntryDef[] {
  const defs: AtlasEntryDef[] = [];
  for (const c of new Set(COULEURS_VOITURES))
    for (const axe of ["x", "y"] as const) defs.push({ key: `car:${c}:${axe}`, w: 32, h: 24, ax: 16, ay: 14, draw: (pen) => drawCar(pen, 16, 14, axe, c) });
  return defs;
}

// ------------------------------------------------------------------ palette
const C = {
  ink: rgb("#2a2140"),
  white: rgb("#f7f3ee"),
  deskTop: rgb("#f6f3ec"),
  deskSide: rgb("#d8d0c3"),
  wood: rgb("#b07a4a"),
  woodD: rgb("#7f5532"),
  woodL: rgb("#d4a372"),
  metal: rgb("#9aa3b5"),
  monitor: rgb("#3d4157"),
  pot: rgb("#c8693c"),
  leaf: rgb("#4f9d4a"),
  leafL: rgb("#79c262"),
  leafD: rgb("#2f6f3a"),
  red: rgb("#d8433a"),
  navy: rgb("#2f3a6b"),
};

function drawProp(p: Pen, prop: Prop, ox: number, oy: number): void {
  const v = prop.variant ?? 0;
  const f = prop.facing;
  const cx = ox; // centre de la case (0,0) : x
  const cy = oy + 8; // y
  const box = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, col: RGBA | ReturnType<typeof boxOf>) =>
    isoBox(p, ox, oy, u0, v0, u1, v1, z0, z1, typeof col === "number" ? boxOf(col) : col);

  switch (prop.kind) {
    case "desk": {
      const top = v === 1 ? rgb("#c99a6b") : C.deskTop;
      const side = v === 1 ? rgb("#9c6f45") : C.deskSide;
      // pieds
      box(0.1, 0.78, 0.18, 0.86, 0, 8, side);
      box(0.82, 0.78, 0.9, 0.86, 0, 8, side);
      box(0.82, 0.14, 0.9, 0.22, 0, 8, side);
      // caisson
      box(0.6, 0.18, 0.88, 0.84, 0, 8, v === 1 ? rgb("#8a6040") : rgb("#e3ddd2"));
      box(0.08, 0.12, 0.92, 0.88, 8, 10, { top, left: shade(side, -0.05), right: shade(side, -0.2), rim: shade(top, 0.4) });
      // tasse & papiers (derrière l'écran)
      const mug = [rgb("#e2574c"), rgb("#3a7bd5"), rgb("#f2c14e")][Math.floor(hash2(v, 3) * 3)]!;
      box(0.14, 0.2, 0.24, 0.3, 10, 13, mug);
      box(0.66, 0.18, 0.86, 0.38, 10, 11, { top: C.white, left: rgb("#e8e2d8"), right: rgb("#d8d0c3") });
      // écran (on voit son dos)
      box(0.46, 0.5, 0.54, 0.58, 10, 12, C.monitor);
      box(0.26, 0.6, 0.74, 0.68, 12, 21, { top: rgb("#5a6078"), left: C.monitor, right: rgb("#2e3246") });
      break;
    }
    case "chair": {
      const seat = v === 2 ? C.woodD : rgb("#4a4e69");
      box(0.45, 0.45, 0.55, 0.55, 0, 5, rgb("#2e3047"));
      if (v !== 2) {
        p.line(cx - 6, cy + 1, cx + 6, cy - 1, rgb("#2e3047"));
        p.line(cx - 5, cy - 2, cx + 5, cy + 2, rgb("#2e3047"));
      }
      box(0.22, 0.22, 0.78, 0.78, 5, 7, seat);
      if (f === "y+") box(0.22, 0.16, 0.78, 0.26, 7, 16, seat);
      if (f === "x+") box(0.16, 0.22, 0.26, 0.78, 7, 16, seat);
      break;
    }
    case "plant": {
      box(0.32, 0.32, 0.68, 0.68, 0, 7, { top: rgb("#5b3a24"), left: C.pot, right: shade(C.pot, -0.25), rim: shade(C.pot, 0.35) });
      const ty = cy - 7;
      if (v === 0) {
        p.ellipse(cx, ty - 7, 8, 7, C.leafD);
        p.ellipse(cx - 1, ty - 8, 7, 6, C.leaf);
        p.ellipse(cx - 3, ty - 10, 3, 3, C.leafL);
        for (let i = 0; i < 6; i++) p.set(cx - 5 + Math.floor(hash2(i, 1) * 10), ty - 12 + Math.floor(hash2(i, 2) * 9), C.leafL);
      } else if (v === 1) {
        for (let i = -3; i <= 3; i++) {
          const hgt = 12 + Math.floor(hash2(i, 5) * 9);
          const x = cx + i * 1.5;
          p.vline(Math.round(x), ty, ty - hgt, i % 2 ? C.leafD : C.leaf);
          p.set(Math.round(x), ty - hgt, rgb("#c9d86a"));
        }
      } else {
        for (const [dx, dy, r] of [[-5, -8, 5], [4, -10, 5], [0, -15, 5], [-3, -18, 4], [5, -4, 4]] as const) {
          p.ellipse(cx + dx, ty + dy, r, r * 0.75, C.leafD);
          p.ellipse(cx + dx - 0.5, ty + dy - 0.5, r - 1, r * 0.75 - 1, C.leaf);
          p.line(cx + dx - r + 2, ty + dy, cx + dx + r - 2, ty + dy, C.leafD);
        }
      }
      break;
    }
    case "printer": {
      box(0.2, 0.25, 0.8, 0.75, 0, 9, rgb("#d9dce3"));
      box(0.3, 0.3, 0.7, 0.6, 9, 10, rgb("#5b6070"));
      box(0.32, 0.75, 0.68, 0.88, 4, 5, C.white);
      p.set(cx + 6, cy - 6, rgb("#5fd38d"));
      break;
    }
    case "whiteboard":
    case "bigScreen": {
      const dark = prop.kind === "bigScreen";
      const faceCol = dark ? (v === 1 ? rgb("#f4f6fb") : rgb("#23263a")) : rgb("#fbfbf8");
      const frame = dark ? rgb("#1a1c2a") : rgb("#9aa0ad");
      const alongX = f !== "x+";
      if (alongX) {
        box(0.16, 0.46, 0.2, 0.52, 0, 8, frame);
        box(0.8, 0.46, 0.84, 0.52, 0, 8, frame);
        box(0.1, 0.44, 0.9, 0.52, 7, 22, { top: frame, left: faceCol, right: frame });
      } else {
        box(0.46, 0.16, 0.52, 0.2, 0, 8, frame);
        box(0.46, 0.8, 0.52, 0.84, 0, 8, frame);
        box(0.44, 0.1, 0.52, 0.9, 7, 22, { top: frame, left: frame, right: faceCol });
      }
      // contenu de la face
      const pt = (t: number, z: number) => (alongX ? isoPt(ox, oy, 0.12 + t * 0.76, 0.52, z) : isoPt(ox, oy, 0.52, 0.88 - t * 0.76, z));
      const r = mulberry32(v * 31 + (dark ? 7 : 3));
      if (dark && v === 0) {
        // graphique en barres
        for (let i = 0; i < 6; i++) {
          const hgt = 3 + Math.floor(r() * 9);
          const [x, y] = pt(0.12 + i * 0.13, 9);
          p.vline(Math.round(x), Math.round(y), Math.round(y - hgt), [rgb("#5fd38d"), rgb("#7aa6ff"), rgb("#ffb347")][i % 3]!);
        }
      } else {
        const inks = [rgb("#3a7bd5"), rgb("#e2574c"), rgb("#2e9d62"), rgb("#8b5cf6")];
        for (const z of [18, 15, 12, 9]) {
          const t0 = 0.1 + r() * 0.2;
          const t1 = t0 + 0.25 + r() * 0.4;
          const [x0, y0] = pt(t0, z);
          const [x1, y1] = pt(Math.min(0.92, t1), z);
          p.line(x0, y0, x1, y1, inks[Math.floor(r() * inks.length)]!);
        }
      }
      break;
    }
    case "shelf": {
      const wood = v === 1 ? rgb("#8a5a33") : v === 2 ? rgb("#7a6650") : rgb("#c49a6c");
      box(0.1, 0.3, 0.9, 0.58, 0, 24, wood);
      const r = mulberry32(v * 13 + 5);
      for (const z of [2, 10, 18]) {
        for (let t = 0.04; t < 0.94; ) {
          const wdt = 0.05 + r() * 0.06;
          const hgt = 4 + Math.floor(r() * 3);
          let col: RGBA;
          if (v === 1) col = [C.white, rgb("#e2c79f"), rgb("#9fd3c7")][Math.floor(r() * 3)]!;
          else if (v === 2) col = [rgb("#c99a5b"), rgb("#b3854c"), C.white][Math.floor(r() * 3)]!;
          else col = [rgb("#e2574c"), rgb("#3a7bd5"), rgb("#f2c14e"), rgb("#2e9d62"), rgb("#8b5cf6"), rgb("#f6f3ec")][Math.floor(r() * 6)]!;
          for (let k = 0; k < 2; k++) {
            const [x, y] = isoPt(ox, oy, 0.1 + (t + (k * wdt) / 2) * 0.8, 0.58, z);
            p.vline(Math.round(x), Math.round(y - 1), Math.round(y - hgt), col);
          }
          t += wdt + 0.02;
        }
        const [xa, ya] = isoPt(ox, oy, 0.1, 0.58, z);
        const [xb, yb] = isoPt(ox, oy, 0.9, 0.58, z);
        p.line(xa, ya, xb - 1, yb, shade(wood, -0.3));
      }
      break;
    }
    case "bigTable": {
      const top = rgb("#d9b48a");
      for (const [u, vv] of [[0.25, 1.7], [2.75, 1.7], [2.75, 0.3]] as const) box(u - 0.05, vv - 0.05, u + 0.05, vv + 0.05, 0, 8, C.woodD);
      box(0.15, 0.2, 2.85, 1.8, 8, 10, { top, left: shade(top, -0.2), right: shade(top, -0.32), rim: shade(top, 0.3) });
      // carnets et ordinateurs
      for (const [u, vv, col] of [[0.6, 0.5, C.white], [1.4, 1.3, rgb("#3d4157")], [2.2, 0.6, C.white], [2.4, 1.4, rgb("#f2c14e")], [1.0, 1.4, C.white]] as const)
        box(u - 0.15, vv - 0.12, u + 0.15, vv + 0.12, 10, 11, col);
      break;
    }
    case "counter": {
      const body = rgb("#8a5a33");
      box(0.05, 0.15, 2.95, 0.85, 0, 12, body);
      // lattes verticales sur la face avant
      for (let t = 0.2; t < 2.9; t += 0.3) {
        const [x, y] = isoPt(ox, oy, t, 0.85, 1);
        p.vline(Math.round(x), Math.round(y), Math.round(y - 10), shade(body, -0.25));
      }
      box(0.0, 0.1, 3.0, 0.9, 12, 14, { top: rgb("#f1ece3"), left: rgb("#d8d0c3"), right: rgb("#c4baab"), rim: C.white });
      break;
    }
    case "coffee": {
      box(0.3, 0.3, 0.72, 0.66, 14, 25, { top: rgb("#e3e6ec"), left: rgb("#c8423a"), right: rgb("#9e2f29"), rim: rgb("#ff8a7a") });
      box(0.4, 0.66, 0.6, 0.72, 17, 19, rgb("#2b2b33"));
      box(0.44, 0.7, 0.56, 0.8, 14, 16, C.white);
      break;
    }
    case "roundTable": {
      p.vline(cx, cy, cy - 8, rgb("#3a3646"));
      p.hline(cx - 3, cx + 3, cy, rgb("#3a3646"));
      p.ellipse(cx, cy - 9, 9, 4.6, rgb("#c4baab"));
      p.ellipse(cx, cy - 10, 9, 4.6, rgb("#f3efe7"));
      break;
    }
    case "parasol": {
      const apexY = cy - 44;
      const rimY = cy - 32;
      const rx = 15;
      const ry = 6;
      p.vline(cx, cy - 10, apexY + 2, rgb("#5b5866"));
      const c1 = v === 1 ? rgb("#3a7bd5") : rgb("#e2574c");
      const c2 = rgb("#fbf7ef");
      for (let y = apexY; y <= rimY + ry; y++)
        for (let x = -rx; x <= rx; x++) {
          const t = (y - apexY) / (rimY - apexY);
          const inTri = t >= 0 && t <= 1 && Math.abs(x) <= rx * t;
          const ex = x / rx;
          const ey = (y - rimY) / ry;
          const inEll = ex * ex + ey * ey <= 1;
          if (!inTri && !inEll) continue;
          const sector = Math.floor(((x / Math.max(1, rx * Math.min(1, t))) + 1) * 3);
          let col = sector % 2 ? c1 : c2;
          if (y > rimY) col = shade(col, -0.18);
          p.set(cx + x, y, col);
        }
      p.set(cx, apexY - 1, rgb("#5b5866"));
      break;
    }
    case "sofa": {
      const base = f === "x+" ? rgb("#4b5bb0") : rgb("#e07a5f");
      if (f === "x+") {
        box(0.18, 0.08, 0.92, 0.92, 0, 6, base);
        box(0.08, 0.08, 0.26, 0.92, 6, 14, base);
      } else {
        box(0.08, 0.18, 0.92, 0.92, 0, 6, base);
        box(0.08, 0.08, 0.92, 0.26, 6, 14, base);
        if (v === 0) box(0.06, 0.18, 0.22, 0.92, 6, 10, shade(base, -0.05));
        if (v === 1) box(0.78, 0.18, 0.94, 0.92, 6, 10, shade(base, -0.05));
      }
      break;
    }
    case "beanbag": {
      p.ellipse(cx, cy - 3, 9, 5.5, rgb("#c99a1e"));
      p.ellipse(cx - 1, cy - 4, 8, 4.5, rgb("#f2c14e"));
      p.ellipse(cx - 3, cy - 6, 3, 1.6, rgb("#fde3a0"));
      break;
    }
    case "babyfoot": {
      for (const [u, vv] of [[0.2, 0.75], [1.8, 0.75], [1.8, 0.25]] as const) box(u - 0.05, vv - 0.05, u + 0.05, vv + 0.05, 0, 4, C.woodD);
      box(0.1, 0.2, 1.9, 0.8, 4, 11, { top: rgb("#3f9d5a"), left: rgb("#6b4a2f"), right: rgb("#523722"), rim: rgb("#8a6040") });
      const [mx0, my0] = isoPt(ox, oy, 1, 0.2, 11);
      const [mx1, my1] = isoPt(ox, oy, 1, 0.8, 11);
      p.line(mx0, my0, mx1, my1, rgb("#e9f5e9"));
      [0.4, 0.7, 1.3, 1.6].forEach((u, i) => {
        const [a0, b0] = isoPt(ox, oy, u, 0.05, 13);
        const [a1, b1] = isoPt(ox, oy, u, 0.95, 13);
        p.line(a0, b0, a1, b1, rgb("#c9ccd6"));
        for (const t of [0.35, 0.65]) {
          const [x, y] = isoPt(ox, oy, u, 0.05 + t * 0.9, 13);
          p.rect(Math.round(x), Math.round(y) - 1, 1, 3, i < 2 ? C.red : rgb("#3a7bd5"));
        }
      });
      break;
    }
    case "pingpong": {
      for (const [u, vv] of [[0.2, 0.8], [1.8, 0.8], [1.8, 0.2]] as const) box(u - 0.04, vv - 0.04, u + 0.04, vv + 0.04, 0, 8, rgb("#3a3646"));
      box(0.05, 0.1, 1.95, 0.9, 8, 9, { top: rgb("#2c5aa0"), left: rgb("#1f3f73"), right: rgb("#18325c") });
      const ln = (u0: number, v0: number, u1: number, v1: number) => {
        const [a, b] = isoPt(ox, oy, u0, v0, 9);
        const [c, d] = isoPt(ox, oy, u1, v1, 9);
        p.line(a, b, c, d, C.white);
      };
      ln(0.1, 0.5, 1.9, 0.5);
      box(0.98, 0.06, 1.02, 0.94, 9, 13, { top: C.white, left: withAlpha(C.white, 200), right: withAlpha(C.white, 160) });
      break;
    }
    case "pine": {
      const hgt = [36, 44, 30][v] ?? 36;
      p.rect(cx - 1, cy - 6, 3, 6, rgb("#6b4228"));
      const tiers = 3;
      for (let i = 0; i < tiers; i++) {
        const base = cy - 4 - i * (hgt / 4);
        const top = base - hgt / 2.2;
        const half = (tiers - i) * 3.4 + 2;
        p.poly([[cx, top], [cx + half, base], [cx - half, base]], (x, y) => {
          const t = (x - cx) / half;
          if (t < -0.35) return rgb("#5aa86a");
          if (t > 0.3 || y > base - 2) return rgb("#24563a");
          return rgb("#357a4c");
        });
      }
      p.set(cx, cy - hgt - 2, rgb("#5aa86a"));
      break;
    }
    case "tower":
      drawTower(p, ox, oy, prop.w ?? 1, prop.h ?? 1, v);
      break;
    case "tree": {
      p.rect(cx - 1, cy - 9, 3, 9, rgb("#6b4228"));
      p.set(cx + 1, cy - 4, rgb("#4f2f1c"));
      const base = styleDessin === "newyork" ? automne(v + (prop.x + prop.y) % 2) : v === 2 ? rgb("#e0913a") : v === 1 ? rgb("#68b45c") : rgb("#4f9d4a");
      const blobs: [number, number, number][] = [[0, -20, 10], [-6, -15, 7], [6, -15, 7], [-2, -26, 7], [4, -24, 6]];
      for (const [dx, dy, r] of blobs) p.ellipse(cx + dx, cy + dy, r, r * 0.85, shade(base, -0.25));
      for (const [dx, dy, r] of blobs) p.ellipse(cx + dx - 1, cy + dy - 1, r - 1.5, r * 0.85 - 1.5, base);
      p.ellipse(cx - 4, cy - 25, 3, 2.5, shade(base, 0.3));
      p.ellipse(cx - 7, cy - 17, 2, 2, shade(base, 0.25));
      break;
    }
    case "bush": {
      p.ellipse(cx, cy - 4, 9, 5.5, rgb("#2f6f3a"));
      p.ellipse(cx - 1, cy - 5, 8, 4.5, rgb("#4f9d4a"));
      p.ellipse(cx - 3, cy - 7, 3, 2, rgb("#79c262"));
      if (v > 0) {
        const fl = v === 1 ? rgb("#ffd1e0") : rgb("#fff3b0");
        for (let i = 0; i < 5; i++) p.set(cx - 6 + Math.floor(hash2(i, v) * 12), cy - 8 + Math.floor(hash2(v, i) * 5), fl);
      }
      break;
    }
    case "lamp": {
      p.rect(cx - 2, cy - 2, 4, 2, rgb("#2f2b3a"));
      p.rect(cx - 1, cy - 28, 2, 27, rgb("#3a3646"));
      p.set(cx - 1, cy - 20, rgb("#5b5866"));
      p.rect(cx - 3, cy - 35, 6, 7, rgb("#2f2b3a"));
      p.rect(cx - 2, cy - 34, 4, 5, rgb("#ffe7a3"));
      p.rect(cx - 3, cy - 37, 6, 2, rgb("#2f2b3a"));
      p.set(cx, cy - 38, rgb("#2f2b3a"));
      break;
    }
    case "bollard": {
      cylinder(p, cx, cy, 3, 6, () => rgb("#3b3846"), rgb("#5b5866"));
      p.hline(cx - 3, cx + 2, cy - 3, rgb("#c9b48f"));
      break;
    }
    case "crate": {
      const col = v ? rgb("#a8774a") : rgb("#c08d5a");
      box(0.2, 0.2, 0.8, 0.8, 0, 11, col);
      for (const z of [4, 8]) {
        const [a, b] = isoPt(ox, oy, 0.2, 0.8, z);
        const [c, d] = isoPt(ox, oy, 0.8, 0.8, z);
        const [e, g] = isoPt(ox, oy, 0.8, 0.2, z);
        p.line(a, b, c - 1, d, shade(col, -0.3));
        p.line(c, d, e - 1, g, shade(col, -0.4));
      }
      break;
    }
    case "barrel": {
      cylinder(p, cx, cy, 5, 11, (z) => (z === 2 || z === 9 ? rgb("#4a3a2e") : rgb("#8a5a33")), rgb("#a87348"));
      break;
    }
    case "bench": {
      box(0.1, 0.4, 0.18, 0.6, 0, 5, rgb("#3a3646"));
      box(0.82, 0.4, 0.9, 0.6, 0, 5, rgb("#3a3646"));
      box(0.05, 0.35, 0.95, 0.65, 5, 6, C.woodL);
      box(0.05, 0.3, 0.95, 0.38, 6, 12, C.wood);
      break;
    }
    case "phare":
      drawPhare(p, cx, cy);
      break;
    case "house":
      if (styleDessin === "newyork") drawBrownstone(p, ox, oy, prop.w ?? 3, prop.h ?? 3, prop.color ?? "#8a8fa3", v);
      else drawHouse(p, ox, oy, prop.w ?? 3, prop.h ?? 3, prop.color ?? "#8a8fa3", v);
      break;
    case "treadmill": {
      box(0.2, 0.15, 0.8, 0.95, 0, 4, rgb("#3d4157"));
      box(0.28, 0.25, 0.72, 0.85, 4, 5, { top: rgb("#23263a"), left: rgb("#1b1d2c"), right: rgb("#15172a") });
      // montants et console
      box(0.22, 0.12, 0.3, 0.22, 4, 18, rgb("#9aa3b5"));
      box(0.7, 0.12, 0.78, 0.22, 4, 18, rgb("#9aa3b5"));
      box(0.22, 0.1, 0.78, 0.24, 18, 21, { top: rgb("#5ec2f2"), left: rgb("#3d4157"), right: rgb("#2f3346") });
      break;
    }
    case "weights": {
      box(0.15, 0.3, 0.85, 0.7, 0, 3, rgb("#7f5532"));
      box(0.2, 0.42, 0.8, 0.58, 3, 14, rgb("#9aa3b5"));
      // disques de couleur
      for (const [u, col] of [[0.3, "#d8433a"], [0.5, "#2f3a6b"], [0.7, "#3d8a5a"]] as [number, string][]) {
        const [x, y] = isoPt(ox, oy, u, 0.5, 12);
        p.ellipse(Math.round(x), Math.round(y), 3, 4, rgb(col));
        p.ellipse(Math.round(x), Math.round(y), 1, 1, rgb("#1c1530"));
      }
      break;
    }
    case "stampDesk": {
      box(0.05, 0.2, 1.95, 0.8, 0, 12, rgb("#6b4a2f"));
      // bandeau rayé rouge et blanc
      for (let t = 0; t < 1.9; t += 0.02) {
        const [x, y] = isoPt(ox, oy, 0.05 + t, 0.8, 5);
        const stripe = Math.floor((t * 10)) % 2 === 0;
        p.vline(Math.round(x), Math.round(y), Math.round(y - 3), stripe ? C.red : C.white);
      }
      box(0.0, 0.15, 2.0, 0.85, 12, 13, { top: rgb("#e9dcc6"), left: rgb("#c9b48f"), right: rgb("#b39f7b"), rim: C.white });
      box(0.3, 0.3, 0.7, 0.6, 13, 14, C.white);
      box(1.2, 0.35, 1.32, 0.47, 13, 18, rgb("#c0392b"));
      box(1.45, 0.3, 1.75, 0.6, 13, 14, rgb("#2f3a6b"));
      break;
    }
    case "archive": {
      const col = [rgb("#d8cdb5"), rgb("#aab4c3"), rgb("#b5b58a")][v % 3]!;
      box(0.1, 0.2, 0.9, 0.8, 0, 26, col);
      for (const z of [7, 14, 21]) {
        const [a, b] = isoPt(ox, oy, 0.1, 0.8, z);
        const [c, d] = isoPt(ox, oy, 0.9, 0.8, z);
        p.line(a, b, c - 1, d, shade(col, -0.25));
        const [hx, hy] = isoPt(ox, oy, 0.5, 0.8, z + 3);
        p.rect(Math.round(hx) - 1, Math.round(hy), 3, 1, shade(col, -0.45));
      }
      break;
    }
    case "flowers": {
      box(0.15, 0.15, 0.85, 0.85, 0, 3, { top: rgb("#6b4228"), left: rgb("#8a8a8a"), right: rgb("#707070") });
      const fl = [rgb("#ff6f91"), rgb("#ffd166"), rgb("#ffffff")][v % 3]!;
      for (let i = 0; i < 9; i++) {
        const x = cx - 8 + Math.floor(hash2(i, 9 + v) * 16);
        const y = cy - 6 + Math.floor(hash2(9 + v, i) * 6);
        p.set(x, y + 1, C.leaf);
        p.set(x, y, fl);
      }
      break;
    }
    case "railing": {
      const u = f === "x-" ? 0.06 : 0.94;
      for (const vv of [0.1, 0.5, 0.9]) {
        const [x, y] = isoPt(ox, oy, u, vv, 0);
        p.vline(Math.round(x), Math.round(y), Math.round(y - 8), rgb("#6b4a2f"));
      }
      const [a, b] = isoPt(ox, oy, u, 0.05, 8);
      const [c, d] = isoPt(ox, oy, u, 0.95, 8);
      p.line(a, b, c, d, rgb("#8a6040"));
      break;
    }
    case "pile":
      break;
  }
}

/** Cylindre vertical pixel (tonneaux, bittes, phare). */
/** Maison du quartier résidentiel : murs crème, toit à deux pans couleur du pôle, porte, fenêtres, cheminée. */
function drawHouse(p: Pen, ox: number, oy: number, w: number, h: number, couleur: string, v: number): void {
  const roof = rgb(couleur);
  const murs = [rgb("#f4ead8"), rgb("#efe1cf"), rgb("#f6efe4"), rgb("#ecdcc6")][v % 4]!;
  const m = 0.18;
  const H = 24;
  const R = 42;
  // murs
  isoBox(p, ox, oy, m, m, w - m, h - m, 0, H, { top: murs, left: shade(murs, -0.06), right: shade(murs, -0.2) });
  isoBox(p, ox, oy, m, m, w - m, h - m, 0, 3, { top: murs, left: shade(murs, -0.25), right: shade(murs, -0.35) });
  // porte sur la façade sud (v = h), fenêtres
  const door = rgb("#8a5a34");
  p.poly([isoPt(ox, oy, w / 2 - 0.3, h - m, 0), isoPt(ox, oy, w / 2 + 0.3, h - m, 0), isoPt(ox, oy, w / 2 + 0.3, h - m, 15), isoPt(ox, oy, w / 2 - 0.3, h - m, 15)], door);
  const [kx, ky] = isoPt(ox, oy, w / 2 + 0.18, h - m, 7);
  p.set(Math.round(kx), Math.round(ky), rgb("#f2c14e"));
  const vitre = rgb("#bfe6f5");
  const cadre = rgb("#ffffff");
  for (const u of [0.55, w - 0.55]) {
    p.poly([isoPt(ox, oy, u - 0.28, h - m, 9), isoPt(ox, oy, u + 0.28, h - m, 9), isoPt(ox, oy, u + 0.28, h - m, 19), isoPt(ox, oy, u - 0.28, h - m, 19)], cadre);
    p.poly([isoPt(ox, oy, u - 0.2, h - m, 10), isoPt(ox, oy, u + 0.2, h - m, 10), isoPt(ox, oy, u + 0.2, h - m, 18), isoPt(ox, oy, u - 0.2, h - m, 18)], vitre);
  }
  for (const vv of [0.9, h - 0.9]) {
    p.poly([isoPt(ox, oy, w - m, vv - 0.3, 9), isoPt(ox, oy, w - m, vv + 0.3, 9), isoPt(ox, oy, w - m, vv + 0.3, 19), isoPt(ox, oy, w - m, vv - 0.3, 19)], cadre);
    p.poly([isoPt(ox, oy, w - m, vv - 0.22, 10), isoPt(ox, oy, w - m, vv + 0.22, 10), isoPt(ox, oy, w - m, vv + 0.22, 18), isoPt(ox, oy, w - m, vv - 0.22, 18)], shade(vitre, -0.1));
  }
  // toit à deux pans (faîtage selon u), avec débord
  const e = 0.05;
  const a0 = isoPt(ox, oy, e, e, H);
  const a1 = isoPt(ox, oy, w - e, e, H);
  const b0 = isoPt(ox, oy, e, h - e, H);
  const b1 = isoPt(ox, oy, w - e, h - e, H);
  const r0 = isoPt(ox, oy, e, h / 2, R);
  const r1 = isoPt(ox, oy, w - e, h / 2, R);
  p.poly([r0, r1, a1, a0], shade(roof, -0.25));
  // pignon (côté x+) couleur des murs
  p.poly([isoPt(ox, oy, w - m, m, H), isoPt(ox, oy, w - m, h - m, H), isoPt(ox, oy, w - m, h / 2, R - 2)], shade(murs, -0.2));
  p.poly([r0, r1, b1, b0], roof);
  // tuiles : quelques lignes plus sombres
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const l0 = isoPt(ox, oy, e, h / 2 + (h / 2 - e) * t, R - (R - H) * t);
    const l1 = isoPt(ox, oy, w - e, h / 2 + (h / 2 - e) * t, R - (R - H) * t);
    p.line(l0[0], l0[1], l1[0], l1[1], shade(roof, -0.15));
  }
  p.line(r0[0], r0[1], r1[0], r1[1], shade(roof, 0.3));
  // cheminée
  isoBox(p, ox, oy, w * 0.7, h * 0.3, w * 0.7 + 0.35, h * 0.3 + 0.35, R - 8, R + 6, boxOf(rgb("#a3533b")));
}

function cylinder(p: Pen, cx: number, by: number, r: number, h: number, colAt: (z: number) => RGBA, top: RGBA, rTop = r): void {
  for (let z = 0; z < h; z++) {
    const rr = r + (rTop - r) * (z / h);
    for (let x = -Math.ceil(rr); x < Math.ceil(rr); x++) {
      const nx = (x + 0.5) / rr;
      if (Math.abs(nx) > 1) continue;
      const ey = Math.sqrt(1 - nx * nx) * (rr / 2);
      const k = nx < -0.45 ? 0.14 : nx > 0.35 ? -0.25 : 0;
      p.set(cx + x, Math.round(by + ey - z - 0.5), shade(colAt(z), k));
      p.set(cx + x, Math.round(by + ey - z + 0.5), shade(colAt(z), k));
    }
  }
  p.ellipse(cx, by - h, rTop, rTop / 2, top);
}

export const PHARE_LANTERN = { dx: 0, dy: -86 };

function drawPhare(p: Pen, cx: number, cy: number): void {
  // socle de pierres
  p.ellipse(cx, cy, 14, 7, rgb("#6e6a78"));
  p.ellipse(cx, cy - 2, 13, 6.5, rgb("#8d8999"));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    p.set(Math.round(cx + Math.cos(a) * 10), Math.round(cy - 2 + Math.sin(a) * 4.5), rgb("#b4b0c0"));
  }
  const H = 70;
  const by = cy - 3;
  cylinder(p, cx, by, 10, H, (z) => (Math.floor(z / 12) % 2 === 0 ? rgb("#f4efe8") : rgb("#d8433a")), rgb("#e9e3da"), 7);
  // porte
  p.rect(cx + 2, by - 9, 4, 9, rgb("#3a2a2a"));
  p.set(cx + 3, by - 10, rgb("#3a2a2a"));
  p.set(cx + 4, by - 10, rgb("#3a2a2a"));
  // hublots
  p.rect(cx + 1, by - 34, 2, 3, rgb("#2f3a6b"));
  p.rect(cx + 1, by - 56, 2, 3, rgb("#2f3a6b"));
  // galerie
  const gy = by - H;
  p.ellipse(cx, gy, 11, 5, rgb("#2f2b3a"));
  p.ellipse(cx, gy - 1, 10, 4.5, rgb("#4a4658"));
  for (let x = -10; x <= 10; x += 3) p.vline(cx + x, gy - 1 - Math.round(Math.sqrt(Math.max(0, 1 - (x / 10) ** 2)) * -4), gy - 5, rgb("#2f2b3a"));
  p.hline(cx - 10, cx + 10, gy - 5, rgb("#2f2b3a"));
  // lanterne vitrée
  cylinder(p, cx, gy - 2, 6, 10, (z) => (z % 5 === 0 ? rgb("#2f2b3a") : rgb("#ffe9a8")), rgb("#2f2b3a"));
  for (const x of [-4, 0, 4]) p.vline(cx + x, gy - 12, gy - 3, rgb("#2f2b3a"));
  p.rect(cx - 2, gy - 9, 4, 4, rgb("#fff7d6"));
  // toit
  p.poly([[cx, gy - 24], [cx + 8, gy - 12], [cx - 8, gy - 12]], (x) => (x > cx + 2 ? rgb("#a02f28") : rgb("#d8433a")));
  p.ellipse(cx, gy - 12, 8, 3, rgb("#a02f28"));
  p.ellipse(cx, gy - 25, 1.5, 1.5, rgb("#2f2b3a"));
}

// ------------------------------------------------------------------ murets
const SLAB_H = { muret: 9, verre: 20, douane: 14 } as const;
/** mur du fond (côté x- et y-) : haut, avec fenêtres, comme la façade intérieure d'un bâtiment */
const BACK_H = 28;
const estFond = (side: Side) => side === "x-" || side === "y-";
const hauteurMur = (style: WallSlab["style"], side: Side) => (style === "muret" && estFond(side) ? BACK_H : SLAB_H[style]);

export function slabKey(s: WallSlab, z: Zone): string {
  return `slab:${s.style}:${z.color}:${s.side}`;
}

export function slabDefs(slabs: WallSlab[], zones: Zone[]): AtlasEntryDef[] {
  const zmap = new Map(zones.map((z) => [z.id, z]));
  const seen = new Map<string, AtlasEntryDef>();
  for (const s of slabs) {
    const z = zmap.get(s.zone);
    if (!z) continue;
    const key = slabKey(s, z);
    if (seen.has(key)) continue;
    const h = hauteurMur(s.style, s.side) + 3;
    seen.set(key, { key, w: 32, h: 16 + h, ax: 16, ay: h, draw: (p) => drawSlab(p, s.side, s.style, z.color, 16, h) });
  }
  return [...seen.values()];
}

const T_W = 0.2;
function slabRect(side: Side): [number, number, number, number] {
  switch (side) {
    case "x-": return [0, 0, T_W, 1];
    case "x+": return [1 - T_W, 0, 1, 1];
    case "y-": return [0, 0, 1, T_W];
    case "y+": return [0, 1 - T_W, 1, 1];
  }
}

function drawSlab(p: Pen, side: Side, style: WallSlab["style"], color: string, ox: number, oy: number): void {
  const [u0, v0, u1, v1] = slabRect(side);
  const H = SLAB_H[style];
  const zc = rgb(color);
  if (style === "verre") {
    const glass = { top: rgb("#ffffff"), left: rgb("#bfe6f5", 120), right: rgb("#9fd2ea", 120) };
    isoBox(p, ox, oy, u0, v0, u1, v1, 0, 3, boxOf(rgb("#e9eef5")));
    isoBox(p, ox, oy, u0, v0, u1, v1, 3, H, glass);
    // montants et reflets
    const along = side === "y-" || side === "y+";
    const vis = side === "y+" ? 1 : side === "x+" ? 1 : 0;
    for (const t of [0.02, 0.98]) {
      const [x, y] = along ? isoPt(ox, oy, t, vis ? v1 : v0 + T_W, 0) : isoPt(ox, oy, vis ? u1 : u0 + T_W, t, 0);
      p.vline(Math.round(x), Math.round(y - 3), Math.round(y - H), rgb("#ffffff"));
    }
    const [rx, ry] = along ? isoPt(ox, oy, 0.35, v1, 8) : isoPt(ox, oy, u1, 0.35, 8);
    p.line(rx, ry, rx + 3, ry - 6, rgb("#ffffff", 200));
    isoBox(p, ox, oy, u0, v0, u1, v1, H, H + 1, { top: rgb("#ffffff"), left: rgb("#e3e9f2"), right: rgb("#cfd8e6") });
    return;
  }
  const body = style === "douane" ? rgb("#efe3d3") : rgb("#f1e9dc");
  if (style === "muret" && estFond(side) && styleDessin === "newyork") {
    drawLoftWall(p, side, color, ox, oy, u0, v0, u1, v1, BACK_H);
    return;
  }
  if (style === "muret" && estFond(side)) {
    // façade du bâtiment vue de l'intérieur : mur haut, fenêtre, corniche couleur du pôle
    const HB = BACK_H;
    isoBox(p, ox, oy, u0, v0, u1, v1, 0, HB, { top: body, left: shade(body, -0.05), right: shade(body, -0.12) });
    isoBox(p, ox, oy, u0, v0, u1, v1, 0, 3, { top: body, left: shade(zc, -0.15), right: shade(zc, -0.3) });
    // fenêtre sur la face visible (côté intérieur)
    const glass = rgb("#bfe6f5");
    const frame = rgb("#ffffff");
    if (side === "y-") {
      const pts: [number, number][] = [isoPt(ox, oy, 0.22, v1, 10), isoPt(ox, oy, 0.78, v1, 10), isoPt(ox, oy, 0.78, v1, 22), isoPt(ox, oy, 0.22, v1, 22)];
      p.poly(pts, frame);
      p.poly([isoPt(ox, oy, 0.28, v1, 11), isoPt(ox, oy, 0.72, v1, 11), isoPt(ox, oy, 0.72, v1, 21), isoPt(ox, oy, 0.28, v1, 21)], glass);
      const [mx, my] = isoPt(ox, oy, 0.5, v1, 11);
      p.vline(Math.round(mx), Math.round(my - 10), Math.round(my), frame);
    } else {
      p.poly([isoPt(ox, oy, u1, 0.22, 10), isoPt(ox, oy, u1, 0.78, 10), isoPt(ox, oy, u1, 0.78, 22), isoPt(ox, oy, u1, 0.22, 22)], frame);
      p.poly([isoPt(ox, oy, u1, 0.28, 11), isoPt(ox, oy, u1, 0.72, 11), isoPt(ox, oy, u1, 0.72, 21), isoPt(ox, oy, u1, 0.28, 21)], shade(glass, -0.08));
      const [mx, my] = isoPt(ox, oy, u1, 0.5, 11);
      p.vline(Math.round(mx), Math.round(my - 10), Math.round(my), frame);
    }
    isoBox(p, ox, oy, u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, HB, HB + 3, { top: shade(zc, 0.25), left: zc, right: shade(zc, -0.2) });
    return;
  }
  isoBox(p, ox, oy, u0, v0, u1, v1, 0, H, { top: body, left: shade(body, -0.08), right: shade(body, -0.2) });
  // soubassement et chaperon couleur du pôle
  isoBox(p, ox, oy, u0, v0, u1, v1, 0, 2, { top: body, left: shade(zc, -0.15), right: shade(zc, -0.3) });
  const cap = style === "douane" ? mix(zc, rgb("#ffffff"), 0.05) : zc;
  isoBox(p, ox, oy, u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, H, H + 2, { top: shade(cap, 0.25), left: cap, right: shade(cap, -0.2) });
}

// ------------------------------------------------------------------ petits sprites (pile, effets, barques, mouettes)
export function miscDefs(): AtlasEntryDef[] {
  const defs: AtlasEntryDef[] = [];
  defs.push({
    key: "item:parcel", w: 14, h: 12, ax: 7, ay: 11,
    draw: (p) => {
      isoBox(p, 7, 3, -0.3, -0.25, 0.3, 0.25, 0, 5, { top: rgb("#d7a86a"), left: rgb("#b5834a"), right: rgb("#9a6d3b"), rim: rgb("#ecc48e") });
      p.line(5, 1, 9, 3, rgb("#f3e2c0"));
    },
  });
  defs.push({
    key: "item:envelope", w: 12, h: 8, ax: 6, ay: 7,
    draw: (p) => {
      p.poly([[6, 1], [11, 3.5], [6, 6], [1, 3.5]], C.white);
      p.line(1, 3, 6, 5, rgb("#c9c2b8"));
      p.line(6, 5, 10, 3, rgb("#c9c2b8"));
      p.set(6, 3, rgb("#c0392b"));
    },
  });
  defs.push({
    key: "fx:carry", w: 8, h: 6, ax: 4, ay: 5,
    draw: (p) => {
      p.rect(0, 0, 8, 5, C.white);
      p.line(0, 0, 3, 2, rgb("#c9c2b8"));
      p.line(7, 0, 4, 2, rgb("#c9c2b8"));
      p.set(3, 3, rgb("#c0392b"));
      p.outline(withAlpha(C.ink, 200));
    },
  });
  defs.push({
    key: "fx:shadow", w: 16, h: 6, ax: 8, ay: 3,
    draw: (p) => p.ellipse(8, 3, 7, 2.6, rgb("#1c1530", 70)),
  });
  defs.push({
    key: "fx:ring", w: 22, h: 10, ax: 11, ay: 5,
    draw: (p) => {
      p.ellipse(11, 5, 10, 4.6, rgb("#ffd34d"));
      p.ellipse(11, 5, 8, 3.2, 0);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 22; x++) {
        const dx = (x + 0.5 - 11) / 8;
        const dy = (y + 0.5 - 5) / 3.2;
        if (dx * dx + dy * dy <= 1) p.clear(x, y);
      }
    },
  });
  defs.push({
    key: "fx:px", w: 2, h: 2, ax: 1, ay: 1,
    draw: (p) => p.rect(0, 0, 2, 2, C.white),
  });
  defs.push({
    key: "fx:steam", w: 5, h: 5, ax: 2, ay: 2,
    draw: (p) => {
      p.ellipse(2.5, 2.5, 2.5, 2.5, rgb("#ffffff", 190));
    },
  });
  defs.push({
    key: "fx:sparkle", w: 5, h: 3, ax: 2, ay: 1,
    draw: (p) => {
      p.hline(0, 4, 1, rgb("#ffffff", 220));
      p.set(2, 0, rgb("#ffffff", 160));
      p.set(2, 2, rgb("#ffffff", 160));
    },
  });
  defs.push({
    key: "fx:hourglass", w: 9, h: 11, ax: 4, ay: 10,
    draw: (p) => {
      p.hline(1, 7, 1, rgb("#8a5a33"));
      p.hline(1, 7, 9, rgb("#8a5a33"));
      p.poly([[2, 2], [7, 2], [4.5, 5.5]], rgb("#ffe7a3"));
      p.poly([[4.5, 5.5], [7, 9], [2, 9]], rgb("#fff4d6"));
      p.poly([[3.5, 7.5], [5.5, 7.5], [6.5, 9], [2.5, 9]], rgb("#f2b84b"));
      p.outline(C.ink);
    },
  });
  defs.push({
    key: "fx:z", w: 7, h: 7, ax: 3, ay: 6,
    draw: (p) => {
      p.hline(1, 5, 1, rgb("#ffffff"));
      p.line(5, 2, 1, 4, rgb("#ffffff"));
      p.hline(1, 5, 5, rgb("#ffffff"));
      p.outline(rgb("#4b4bb0"));
    },
  });
  for (let i = 0; i < 2; i++) {
    defs.push({
      key: `fx:gull${i}`, w: 13, h: 7, ax: 6, ay: 4,
      draw: (p) => {
        const g = rgb("#ffffff");
        const w = rgb("#9aa3b5");
        p.rect(5, 3, 4, 2, g);
        p.set(9, 3, rgb("#f2b84b"));
        if (i === 0) {
          p.line(5, 3, 2, 0, w);
          p.line(8, 3, 11, 0, w);
          p.line(4, 3, 1, 1, w);
        } else {
          p.line(5, 4, 1, 5, w);
          p.line(8, 4, 12, 5, w);
        }
        p.outline(withAlpha(C.ink, 140));
      },
    });
  }
  const hulls: [string, string][] = [["#f7f3ee", "#2f6fb5"], ["#2f6fb5", "#f7f3ee"], ["#3f8a55", "#d8433a"]];
  hulls.forEach(([hull, band], i) => {
    defs.push({
      key: `boat:${i}`, w: 44, h: 30, ax: 22, ay: 18,
      draw: (p) => drawBoat(p, 22, 18, rgb(hull), rgb(band)),
    });
  });
  return defs;
}

function drawBoat(p: Pen, ox: number, oy: number, hull: RGBA, band: RGBA): void {
  // coque pointue aux deux bouts, orientée le long de l'axe u (canal)
  const outlinePts = (s: number): [number, number][] => [
    [-0.85 * s, 0], [-0.5 * s, -0.24 * s], [0.5 * s, -0.24 * s], [0.85 * s, 0], [0.5 * s, 0.24 * s], [-0.5 * s, 0.24 * s],
  ];
  const toScreen = (u: number, v: number, z: number): [number, number] => [ox + (u - v) * 16, oy + (u + v) * 8 - z];
  for (let z = 0; z <= 6; z++) {
    const s = 0.82 + z * 0.03;
    const col = z === 6 ? shade(hull, 0.25) : z === 4 || z === 3 ? band : shade(hull, z < 2 ? -0.2 : 0);
    p.poly(outlinePts(s).map(([u, v]) => toScreen(u, v, z)), col);
  }
  p.poly(outlinePts(0.84).map(([u, v]) => toScreen(u, v * 0.8, 5)), rgb("#9c6a3e"));
  // banc
  p.poly([toScreen(-0.08, -0.2, 6), toScreen(0.08, -0.2, 6), toScreen(0.08, 0.2, 6), toScreen(-0.08, 0.2, 6)], rgb("#c08d5a"));
  // étraves relevées (capians)
  for (const u of [-1.02, 1.02]) {
    const [x, y] = toScreen(u, 0, 6);
    p.vline(Math.round(x), Math.round(y), Math.round(y - 5), shade(hull, -0.1));
    p.set(Math.round(x), Math.round(y - 6), band);
  }
}
