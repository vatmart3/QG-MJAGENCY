import { mulberry32 } from "@/lib/rng";
import { TOUR, tourDe, type Side } from "../layout";
import { boxOf, isoBox, isoPt, mix, rgb, shade, type Pen, type RGBA } from "./pixel";

/**
 * Style New York : gratte-ciel (verre, Art déco, brique avec réservoir d'eau, tour fine), brownstones,
 * murs de loft en brique. Les fenêtres allumées sont dessinées à part (calque « nuit » ajouté en lumière).
 */

const LIT_NY = [rgb("#ffd27a"), rgb("#ffe6a8"), rgb("#fff1c9"), rgb("#bfe1ff"), rgb("#ffc66b")];
const LIT_FUTUR = [rgb("#9ff6ff"), rgb("#e6fbff"), rgb("#7fd8ff"), rgb("#ffb3f2"), rgb("#c9f7ff")];
let LIT = LIT_NY;

/** Style futuriste (verre blanc, néons, toits-jardins) : fixé avant la construction de l'atlas. */
let futur = false;
export function dessinFutur(f: boolean): void {
  futur = f;
  LIT = f ? LIT_FUTUR : LIT_NY;
}
export const estFutur = () => futur;

const NEONS = [rgb("#3ff0ff"), rgb("#ff4fd8"), rgb("#b6ff4f"), rgb("#ffd34d")];

/** Ligne pixel qui saute les pixels masqués (calque de nuit). */
function ligne(p: Pen, a: [number, number], b: [number, number], c: RGBA, cache?: (x: number, y: number) => boolean): void {
  let x0 = Math.round(a[0]), y0 = Math.round(a[1]);
  const x1 = Math.round(b[0]), y1 = Math.round(b[1]);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!cache?.(x0, y0)) p.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Anneau de néon sur les deux façades visibles d'une boîte, à la hauteur z. */
function neon(p: Pen, ox: number, oy: number, a0: number, b0: number, a1: number, b1: number, z: number, c: RGBA, cache?: (x: number, y: number) => boolean): void {
  ligne(p, isoPt(ox, oy, a0, b1, z), isoPt(ox, oy, a1, b1, z), c, cache);
  ligne(p, isoPt(ox, oy, a1, b1, z), isoPt(ox, oy, a1, b0, z), c, cache);
}

/** Hauteur réservée au-dessus de l'emprise (px) pour une tour. */
export function tourTete(variant: number): number {
  const { style, hauteur } = tourDe(variant);
  return hauteur + (style === TOUR.deco ? 46 : style === TOUR.brique ? 30 : 34);
}

/**
 * Écrans géants de la tour « Times Square » (coordonnées relatives à l'emprise) : R = façade droite (u = w),
 * L = façade gauche (v = h) ; `a0`-`a1` le long de la façade, `z0`-`z1` en hauteur (px).
 */
export interface EcranGeom {
  face: "L" | "R";
  a0: number;
  a1: number;
  z0: number;
  z1: number;
  role: "infos" | "pubs" | "bandeau";
}
export function ecransTimes(w: number, h: number, H: number): EcranGeom[] {
  return [
    { face: "R", a0: 0.22, a1: h - 0.22, z0: Math.round(H * 0.42), z1: Math.round(H * 0.9), role: "infos" },
    { face: "L", a0: 0.22, a1: w - 0.22, z0: Math.round(H * 0.36), z1: Math.round(H * 0.8), role: "pubs" },
    { face: "L", a0: 0.12, a1: w - 0.12, z0: Math.round(H * 0.36) - 14, z1: Math.round(H * 0.36) - 5, role: "bandeau" },
  ];
}

/** Point le plus haut (feu rouge d'aviation) au-dessus du sol, au centre de l'emprise. */
export function tourSommet(variant: number): number {
  const { style, hauteur } = tourDe(variant);
  return style === TOUR.deco ? hauteur + 40 : style === TOUR.brique ? 0 : hauteur + 26;
}

type Face = "L" | "R";

/**
 * Fenêtres d'une façade : L = façade v = vf (le long de u), R = façade u = uf (le long de v).
 * `nuit` : ne dessine que les fenêtres allumées (même tirage aléatoire que le jour).
 */
function fenetres(
  p: Pen,
  ox: number,
  oy: number,
  face: Face,
  a0: number,
  a1: number,
  fixe: number,
  z0: number,
  z1: number,
  o: { pasH: number; pasZ: number; w: number; h: number; vitre: (r: number, face: Face) => RGBA; allume: number; seed: number; nuit: boolean; cadre?: RGBA; cache?: (x: number, y: number) => boolean },
): void {
  const r = mulberry32(o.seed);
  const pas = o.pasH / 16;
  for (let a = a0 + pas * 0.6; a < a1 - pas * 0.3; a += pas) {
    for (let z = z1 - 4; z >= z0 + o.pasZ - 1; z -= o.pasZ) {
      const [x, y] = face === "L" ? isoPt(ox, oy, a, fixe, z) : isoPt(ox, oy, fixe, a, z);
      const t1 = r();
      const t2 = r();
      const allume = t1 < o.allume * (z > z1 - 10 ? 0.5 : 1);
      const X = Math.round(x - o.w / 2);
      const Y = Math.round(y);
      if (o.nuit) {
        if (allume && !o.cache?.(X, Y)) p.rect(X, Y, o.w, o.h, LIT[Math.floor(t2 * LIT.length)]!);
        continue;
      }
      if (o.cadre !== undefined) p.rect(X - 1, Y - 1, o.w + 2, o.h + 1, o.cadre);
      p.rect(X, Y, o.w, o.h, o.vitre(t2, face));
    }
  }
}

/**
 * Gratte-ciel. `nuit` : calque des fenêtres allumées seulement ; `cache(x, y)` (coordonnées du crayon) dit si un
 * bâtiment situé devant recouvre ce pixel : le calque de nuit est ajouté par-dessus tout, il ne doit pas déborder.
 */
export function drawTower(p: Pen, ox: number, oy: number, w: number, h: number, variant: number, nuit = false, cache?: (x: number, y: number) => boolean): void {
  const { style, hauteur: H } = tourDe(variant);
  if (futur && style !== TOUR.times) return drawTowerFutur(p, ox, oy, w, h, variant, nuit, cache);
  const seed = variant * 31 + w * 7 + h * 13;
  const m = 0.1;
  const u0 = m, v0 = m, u1 = w - m, v1 = h - m;
  const corps = (c: RGBA) => (nuit ? undefined : c);
  const boite = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, c: RGBA, top?: RGBA) => {
    if (nuit) return;
    const b = boxOf(c, false);
    isoBox(p, ox, oy, a0, b0, a1, b1, z0, z1, { top: top ?? b.top, left: b.left, right: b.right });
  };
  const facades = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, o: Parameters<typeof fenetres>[9]) => {
    fenetres(p, ox, oy, "L", a0, a1, b1, z0, z1, { ...o, seed: o.seed + 1 });
    fenetres(p, ox, oy, "R", b0, b1, a1, z0, z1, { ...o, seed: o.seed + 2 });
  };

  if (style === TOUR.verre) {
    const teintes = ["#5f86b8", "#4f7aa8", "#6c97bf", "#3f6c94", "#7aa2c4"];
    const base = rgb(teintes[seed % teintes.length]!);
    boite(u0, v0, u1, v1, 0, 5, rgb("#9aa3b5"));
    boite(u0, v0, u1, v1, 5, H, base);
    const vitre = (t: number, f: Face) => shade(t < 0.12 ? rgb("#eaf4ff") : t < 0.55 ? mix(base, rgb("#cfe3f7"), 0.35) : mix(base, rgb("#1c2c45"), 0.25), f === "L" ? -0.08 : 0.05);
    facades(u0, v0, u1, v1, 5, H, { pasH: 4, pasZ: 4, w: 2, h: 2, vitre, allume: 0.55, seed, nuit, cache });
    if (!nuit) {
      // reflet du ciel en biais sur la façade droite
      const a = isoPt(ox, oy, u1, v0 + 0.2, H * 0.92);
      const b = isoPt(ox, oy, u1, v0 + (v1 - v0) * 0.55, H * 0.55);
      const c = isoPt(ox, oy, u1, v0 + (v1 - v0) * 0.7, H * 0.62);
      const d = isoPt(ox, oy, u1, v0 + 0.35, H * 0.98);
      p.poly([a, b, c, d], rgb("#ffffff", 40));
      const cx = w / 2, cy = h / 2;
      boite(cx - 0.55, cy - 0.45, cx + 0.35, cy + 0.45, H, H + 7, rgb("#7d8494"));
      const [tx, ty] = isoPt(ox, oy, cx, cy, H + 7);
      p.vline(Math.round(tx), Math.round(ty), Math.round(ty - 16), rgb("#5a6070"));
    }
    void corps;
    return;
  }

  if (style === TOUR.times) {
    // façade sombre, cadres noirs des écrans (les images sont posées par la ville, en direct)
    const base = rgb("#2a2f3d");
    boite(u0, v0, u1, v1, 0, 6, rgb("#8d93a3"));
    boite(u0, v0, u1, v1, 6, H, base);
    const ecrans = ecransTimes(w, h, H);
    const vitre = (t: number, f: Face) => shade(t < 0.2 ? rgb("#8796b3") : rgb("#3a4152"), f === "L" ? -0.1 : 0);
    // fenêtres seulement hors des écrans (par bandes de hauteur)
    const bandes: [number, number][] = [];
    let z = 6;
    for (const zz of [...ecrans].sort((a, b) => a.z0 - b.z0)) {
      if (zz.z0 - 3 > z) bandes.push([z, zz.z0 - 3]);
      z = Math.max(z, zz.z1 + 3);
    }
    if (H > z) bandes.push([z, H]);
    for (const [za, zb] of bandes) {
      fenetres(p, ox, oy, "L", u0, u1, v1, za, zb, { pasH: 4, pasZ: 4, w: 2, h: 2, vitre, allume: 0.5, seed, nuit, cache });
      fenetres(p, ox, oy, "R", v0, v1, u1, za, zb, { pasH: 4, pasZ: 4, w: 2, h: 2, vitre, allume: 0.5, seed: seed + 5, nuit, cache });
    }
    if (nuit) return;
    const noir = rgb("#101218");
    for (const e of ecrans) {
      const q =
        e.face === "R"
          ? [isoPt(ox, oy, u1 + 0.01, e.a0 - 0.08, e.z0 - 2), isoPt(ox, oy, u1 + 0.01, e.a1 + 0.08, e.z0 - 2), isoPt(ox, oy, u1 + 0.01, e.a1 + 0.08, e.z1 + 2), isoPt(ox, oy, u1 + 0.01, e.a0 - 0.08, e.z1 + 2)]
          : [isoPt(ox, oy, e.a0 - 0.08, v1 + 0.01, e.z0 - 2), isoPt(ox, oy, e.a1 + 0.08, v1 + 0.01, e.z0 - 2), isoPt(ox, oy, e.a1 + 0.08, v1 + 0.01, e.z1 + 2), isoPt(ox, oy, e.a0 - 0.08, v1 + 0.01, e.z1 + 2)];
      p.poly(q as [number, number][], noir);
    }
    // enseigne sur le toit
    boite(u0 + 0.4, v0 + 0.4, u1 - 0.4, v1 - 0.4, H, H + 8, rgb("#3a4052"));
    const [tx, ty] = isoPt(ox, oy, w / 2, h / 2, H + 8);
    p.vline(Math.round(tx), Math.round(ty), Math.round(ty - 18), rgb("#9aa3b5"));
    return;
  }

  if (style === TOUR.fine) {
    const base = rgb("#3d4456");
    const a0 = u0 + w * 0.12, b0 = v0 + h * 0.12, a1 = u1 - w * 0.12, b1 = v1 - h * 0.12;
    boite(a0, b0, a1, b1, 0, H, base);
    const vitre = (t: number, f: Face) => shade(t < 0.2 ? rgb("#7f8ea8") : rgb("#4a5468"), f === "L" ? -0.1 : 0);
    facades(a0, b0, a1, b1, 4, H, { pasH: 3, pasZ: 3, w: 1, h: 2, vitre, allume: 0.5, seed, nuit, cache });
    if (!nuit) {
      boite(a0 + 0.25, b0 + 0.25, a1 - 0.25, b1 - 0.25, H, H + 10, rgb("#4c5468"));
      const [tx, ty] = isoPt(ox, oy, w / 2, h / 2, H + 10);
      p.vline(Math.round(tx), Math.round(ty), Math.round(ty - 15), rgb("#8a93a6"));
    }
    return;
  }

  if (style === TOUR.deco) {
    const pierres = ["#d9c8a3", "#cdbb96", "#e2d4b4", "#c9b18a"];
    const pierre = rgb(pierres[seed % pierres.length]!);
    const tiers: [number, number][] = [[0, 0.55], [Math.min(w, h) * 0.13, 0.82], [Math.min(w, h) * 0.26, 1]];
    let z0 = 0;
    tiers.forEach(([ins, fz], i) => {
      const a0 = u0 + ins, b0 = v0 + ins, a1 = u1 - ins, b1 = v1 - ins, z1 = Math.round(H * fz);
      boite(a0, b0, a1, b1, z0, z1, pierre);
      const vitre = (t: number, f: Face) => shade(t < 0.3 ? rgb("#4b5a72") : rgb("#2f3a4f"), f === "L" ? -0.1 : 0);
      facades(a0, b0, a1, b1, z0, z1, { pasH: 5, pasZ: 5, w: 2, h: 3, vitre, allume: 0.45, seed: seed + i * 10, nuit, cache });
      boite(a0 - 0.06, b0 - 0.06, a1 + 0.06, b1 + 0.06, z1 - 2, z1, mix(pierre, rgb("#ffffff"), 0.2));
      if (i === 2) {
        // couronne dorée et flèche (allumée la nuit)
        const cx = (a0 + a1) / 2, cy = (b0 + b1) / 2;
        const or = rgb("#d6a640"), orL = rgb("#ffd36a");
        const sommet = isoPt(ox, oy, cx, cy, z1 + 22);
        p.poly([isoPt(ox, oy, a0, b1, z1), isoPt(ox, oy, a1, b1, z1), sommet], nuit ? withA(orL, 170) : or);
        p.poly([isoPt(ox, oy, a1, b0, z1), isoPt(ox, oy, a1, b1, z1), sommet], nuit ? withA(orL, 130) : shade(or, -0.12));
        const [sx, sy] = sommet;
        p.vline(Math.round(sx), Math.round(sy), Math.round(sy - 18), nuit ? rgb("#ffe7a3") : rgb("#b9b2a6"));
      }
      z0 = z1;
    });
    return;
  }

  // brique : immeuble avec escalier de secours et réservoir d'eau
  const briques = ["#a4523c", "#9a4a36", "#b06246", "#8f4b3b", "#a85d3f"];
  const brique = rgb(briques[seed % briques.length]!);
  boite(u0, v0, u1, v1, 0, H, brique);
  const vitre = (t: number, f: Face) => shade(t < 0.25 ? rgb("#c9d4e2") : rgb("#3a3f4c"), f === "L" ? -0.1 : 0);
  facades(u0, v0, u1, v1, 3, H, { pasH: 6, pasZ: 6, w: 2, h: 3, vitre, allume: 0.5, seed, nuit, cadre: rgb("#e6dccb"), cache });
  if (nuit) return;
  boite(u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, H - 2, H + 1, mix(brique, rgb("#e8dccb"), 0.55));
  // escalier de secours sur la façade gauche
  const fx = u0 + (u1 - u0) * 0.62;
  const noir = rgb("#24262e");
  for (let z = 8; z < H - 5; z += 12) {
    const a = isoPt(ox, oy, fx - 0.5, v1 + 0.06, z);
    const b = isoPt(ox, oy, fx + 0.5, v1 + 0.06, z);
    p.line(a[0], a[1], b[0], b[1], noir);
    const c = isoPt(ox, oy, fx + 0.45, v1 + 0.06, z + 6);
    p.line(a[0] + 1, a[1], c[0], c[1], noir);
    const d = isoPt(ox, oy, fx - 0.45, v1 + 0.06, z + 12);
    p.line(c[0], c[1], d[0], d[1], noir);
  }
  // réservoir d'eau en bois sur pieds
  const r = mulberry32(seed);
  const tx = u0 + 0.6 + r() * Math.max(0.1, u1 - u0 - 1.4);
  const ty = v0 + 0.6 + r() * Math.max(0.1, v1 - v0 - 1.4);
  const pied = rgb("#3a3330");
  for (const [da, db] of [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]] as [number, number][]) {
    const [x1, y1] = isoPt(ox, oy, tx + da, ty + db, H + 1);
    p.vline(Math.round(x1), Math.round(y1), Math.round(y1 - 6), pied);
  }
  const [cx, cy] = isoPt(ox, oy, tx, ty, H + 7);
  const bois = rgb("#8b5d3c");
  p.rect(Math.round(cx - 6), Math.round(cy - 9), 12, 9, bois);
  p.rect(Math.round(cx - 6), Math.round(cy - 9), 3, 9, shade(bois, -0.15));
  p.ellipse(cx, cy, 6, 3, shade(bois, -0.1));
  p.hline(Math.round(cx - 6), Math.round(cx + 5), Math.round(cy - 3), rgb("#3a2a20"));
  p.hline(Math.round(cx - 6), Math.round(cx + 5), Math.round(cy - 7), rgb("#3a2a20"));
  p.poly([[cx - 7, cy - 9], [cx, cy - 15], [cx + 7, cy - 9]], rgb("#5b4a3e"));
}

const withA = (c: RGBA, a: number): RGBA => ((c & 0xffffff00) | (a & 255)) >>> 0;

/** Arbre d'automne (New York, novembre). */
export function automne(v: number): RGBA {
  return [rgb("#d98b2b"), rgb("#c8552f"), rgb("#4f9d4a"), rgb("#e0a63a")][v % 4]!;
}

/** Mur du fond d'un loft (style New York) : brique, grande verrière d'atelier, bandeau à la couleur du pôle. */
export function drawLoftWall(p: Pen, side: Side, color: string, ox: number, oy: number, u0: number, v0: number, u1: number, v1: number, HB: number): void {
  const zc = rgb(color);
  const brique = rgb("#9b5843");
  isoBox(p, ox, oy, u0, v0, u1, v1, 0, HB, { top: rgb("#d9cfc2"), left: shade(brique, -0.05), right: shade(brique, -0.15) });
  // joints de brique (quelques lignes)
  const verre = rgb("#cfe0ee");
  const fer = rgb("#3a3a42");
  if (side === "y-") {
    p.poly([isoPt(ox, oy, 0.14, v1, 6), isoPt(ox, oy, 0.86, v1, 6), isoPt(ox, oy, 0.86, v1, 22), isoPt(ox, oy, 0.14, v1, 22)], fer);
    p.poly([isoPt(ox, oy, 0.19, v1, 7), isoPt(ox, oy, 0.81, v1, 7), isoPt(ox, oy, 0.81, v1, 21), isoPt(ox, oy, 0.19, v1, 21)], verre);
    for (const t of [0.39, 0.61]) {
      const [x, y] = isoPt(ox, oy, t, v1, 7);
      p.vline(Math.round(x), Math.round(y), Math.round(y - 14), fer);
    }
    const a = isoPt(ox, oy, 0.19, v1, 14);
    const b = isoPt(ox, oy, 0.81, v1, 14);
    p.line(a[0], a[1], b[0], b[1], fer);
  } else {
    p.poly([isoPt(ox, oy, u1, 0.14, 6), isoPt(ox, oy, u1, 0.86, 6), isoPt(ox, oy, u1, 0.86, 22), isoPt(ox, oy, u1, 0.14, 22)], fer);
    p.poly([isoPt(ox, oy, u1, 0.19, 7), isoPt(ox, oy, u1, 0.81, 7), isoPt(ox, oy, u1, 0.81, 21), isoPt(ox, oy, u1, 0.19, 21)], shade(verre, -0.08));
    for (const t of [0.39, 0.61]) {
      const [x, y] = isoPt(ox, oy, u1, t, 7);
      p.vline(Math.round(x), Math.round(y), Math.round(y - 14), fer);
    }
    const a = isoPt(ox, oy, u1, 0.19, 14);
    const b = isoPt(ox, oy, u1, 0.81, 14);
    p.line(a[0], a[1], b[0], b[1], fer);
  }
  // bandeau couleur du pôle puis corniche claire
  isoBox(p, ox, oy, u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, HB - 4, HB, { top: shade(zc, 0.25), left: zc, right: shade(zc, -0.2) });
  isoBox(p, ox, oy, u0 - 0.04, v0 - 0.04, u1 + 0.04, v1 + 0.04, HB, HB + 2, { top: rgb("#e9e1d6"), left: rgb("#cfc6b8"), right: rgb("#b9b0a3") });
}

/** Taxis et voitures, orientés le long de u (« x ») ou de v (« y »). */
export function drawCar(p: Pen, ox: number, oy: number, axe: "x" | "y", couleur: string): void {
  const c = rgb(couleur);
  const [a0, a1, b0, b1] = axe === "x" ? [-0.32, 0.32, -0.15, 0.15] : [-0.15, 0.15, -0.32, 0.32];
  isoBox(p, ox, oy, a0, b0, a1, b1, 1, 5, { top: shade(c, 0.1), left: shade(c, -0.1), right: shade(c, -0.25) });
  const [c0, c1, d0, d1] = axe === "x" ? [-0.16, 0.12, -0.13, 0.13] : [-0.13, 0.13, -0.16, 0.12];
  isoBox(p, ox, oy, c0, d0, c1, d1, 5, 8, { top: shade(c, 0.15), left: rgb("#2a2f3c"), right: rgb("#1f232e") });
  // roues
  p.set(Math.round(isoPt(ox, oy, axe === "x" ? a0 + 0.1 : b1, axe === "x" ? b1 : a0 + 0.1, 0)[0]), Math.round(isoPt(ox, oy, axe === "x" ? a0 + 0.1 : b1, axe === "x" ? b1 : a0 + 0.1, 0)[1]) - 1, rgb("#15161c"));
  p.set(Math.round(isoPt(ox, oy, axe === "x" ? a1 - 0.1 : b1, axe === "x" ? b1 : a1 - 0.1, 0)[0]), Math.round(isoPt(ox, oy, axe === "x" ? a1 - 0.1 : b1, axe === "x" ? b1 : a1 - 0.1, 0)[1]) - 1, rgb("#15161c"));
  if (couleur === "#f2c230") {
    // lumineux TAXI sur le toit
    const [tx, ty] = isoPt(ox, oy, 0, 0, 8);
    p.rect(Math.round(tx) - 1, Math.round(ty) - 2, 3, 2, rgb("#fff3c4"));
  }
}

// ------------------------------------------------------------------ ville futuriste
/**
 * Tours futuristes : flèche de verre à gradins et anneaux de néon (verre), tour à dôme (déco), habitat à terrasses
 * végétalisées (brique), aiguille noire à néons verticaux (fine). Les néons brillent dans le calque de nuit.
 */
function drawTowerFutur(p: Pen, ox: number, oy: number, w: number, h: number, variant: number, nuit: boolean, cache?: (x: number, y: number) => boolean): void {
  const { style, hauteur: H } = tourDe(variant);
  const seed = variant * 31 + w * 7 + h * 13;
  const r = mulberry32(seed);
  const neonC = NEONS[seed % NEONS.length]!;
  const m = 0.1;
  const u0 = m, v0 = m, u1 = w - m, v1 = h - m;
  const boite = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, c: RGBA, top?: RGBA) => {
    if (nuit) return;
    isoBox(p, ox, oy, a0, b0, a1, b1, z0, z1, { top: top ?? shade(c, 0.12), left: shade(c, -0.1), right: shade(c, -0.24) });
  };
  const vitreB = (t: number, f: Face) => shade(t < 0.15 ? rgb("#f4fbff") : t < 0.6 ? rgb("#8fd6f2") : rgb("#4fa3d1"), f === "L" ? -0.08 : 0.04);
  const facades = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, o: { pasH: number; pasZ: number; w: number; h: number; vitre: (t: number, f: Face) => RGBA; allume: number; s: number }) => {
    fenetres(p, ox, oy, "L", a0, a1, b1, z0, z1, { ...o, seed: o.s + 1, nuit, cache });
    fenetres(p, ox, oy, "R", b0, b1, a1, z0, z1, { ...o, seed: o.s + 2, nuit, cache });
  };
  const anneau = (a0: number, b0: number, a1: number, b1: number, z: number, c = neonC) => neon(p, ox, oy, a0, b0, a1, b1, z, nuit ? c : shade(c, 0.05), cache);

  if (style === TOUR.verre) {
    // flèche : 4 gradins de verre qui se resserrent, un anneau de néon à chaque étage
    const n = 4;
    let z0 = 0;
    for (let i = 0; i < n; i++) {
      const ins = Math.min(w, h) * 0.09 * i;
      const a0 = u0 + ins, b0 = v0 + ins, a1 = u1 - ins, b1 = v1 - ins;
      const z1 = Math.round(H * [0.42, 0.68, 0.86, 1][i]!);
      boite(a0, b0, a1, b1, z0, z1, rgb("#cfe9f6"));
      facades(a0, b0, a1, b1, z0 + 2, z1, { pasH: 3, pasZ: 3, w: 2, h: 1, vitre: vitreB, allume: 0.5, s: seed + i * 9 });
      anneau(a0, b0, a1, b1, z1 - 1);
      z0 = z1;
    }
    const cx = w / 2, cy = h / 2;
    const [tx, ty] = isoPt(ox, oy, cx, cy, H);
    if (!nuit) p.vline(Math.round(tx), Math.round(ty), Math.round(ty - 24), rgb("#e8eef6"));
    else if (!cache?.(Math.round(tx), Math.round(ty - 24))) p.rect(Math.round(tx) - 1, Math.round(ty - 25), 2, 2, neonC);
    return;
  }

  if (style === TOUR.deco) {
    // tour à dôme : fût blanc, bandeau de verre, dôme en gradins, anneau lumineux
    const fut = Math.round(H * 0.8);
    boite(u0, v0, u1, v1, 0, fut, rgb("#eef3f8"));
    facades(u0, v0, u1, v1, 4, fut, { pasH: 5, pasZ: 6, w: 3, h: 3, vitre: vitreB, allume: 0.45, s: seed });
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const ins = (Math.min(w, h) / 2 - 0.15) * (1 - Math.cos((t * Math.PI) / 2));
      boite(u0 + ins, v0 + ins, u1 - ins, v1 - ins, fut + k * ((H - fut) / 6), fut + (k + 1) * ((H - fut) / 6), rgb("#9fd8f0"));
    }
    anneau(u0, v0, u1, v1, fut, rgb("#ff4fd8"));
    anneau(u0, v0, u1, v1, Math.round(fut * 0.5));
    return;
  }

  if (style === TOUR.brique) {
    // habitat : blocs blancs décalés, terrasses plantées sur chaque toit
    let z0 = 0;
    const blocs = 3;
    for (let i = 0; i < blocs; i++) {
      const dx = (r() - 0.5) * 0.5, dy = (r() - 0.5) * 0.5;
      const a0 = u0 + 0.15 + Math.max(0, dx), b0 = v0 + 0.15 + Math.max(0, dy), a1 = u1 - 0.15 + Math.min(0, dx), b1 = v1 - 0.15 + Math.min(0, dy);
      const z1 = Math.round((H * (i + 1)) / blocs);
      boite(a0, b0, a1, b1, z0, z1, rgb("#f2f4f1"), rgb("#6fbf5a"));
      facades(a0, b0, a1, b1, z0 + 2, z1 - 3, { pasH: 5, pasZ: 6, w: 3, h: 3, vitre: vitreB, allume: 0.55, s: seed + i * 5 });
      if (!nuit) for (let k = 0; k < 4; k++) {
        const [px, py] = isoPt(ox, oy, a0 + 0.3 + r() * (a1 - a0 - 0.6), b0 + 0.3 + r() * (b1 - b0 - 0.6), z1);
        p.ellipse(px, py - 2, 2.5, 2, rgb(r() < 0.5 ? "#3f9a4a" : "#58b45a"));
      }
      anneau(a0, b0, a1, b1, z1 - 3, rgb("#b6ff4f"));
      z0 = z1;
    }
    return;
  }

  // aiguille : verre fumé, néons verticaux aux arêtes
  const a0 = u0 + w * 0.14, b0 = v0 + h * 0.14, a1 = u1 - w * 0.14, b1 = v1 - h * 0.14;
  boite(a0, b0, a1, b1, 0, H, rgb("#2b3346"));
  facades(a0, b0, a1, b1, 4, H, { pasH: 3, pasZ: 3, w: 1, h: 2, vitre: (t, f) => shade(t < 0.2 ? rgb("#7aa8d8") : rgb("#3a4660"), f === "L" ? -0.1 : 0), allume: 0.5, s: seed });
  const nc = nuit ? neonC : shade(neonC, -0.05);
  ligne(p, isoPt(ox, oy, a1, b1, 0), isoPt(ox, oy, a1, b1, H), nc, cache);
  ligne(p, isoPt(ox, oy, a0, b1, 0), isoPt(ox, oy, a0, b1, H), nc, cache);
  ligne(p, isoPt(ox, oy, a1, b0, 0), isoPt(ox, oy, a1, b0, H), nc, cache);
  anneau(a0, b0, a1, b1, H - 1);
  const [tx, ty] = isoPt(ox, oy, w / 2, h / 2, H);
  if (!nuit) p.vline(Math.round(tx), Math.round(ty), Math.round(ty - 16), rgb("#9aa3b5"));
}

/** Hauteur réservée au-dessus d'un immeuble d'habitation (variant = couleur + 10 × hauteur). */
export function residenceTete(v: number): number {
  return Math.max(44, Math.floor(v / 10)) + 26;
}

/**
 * Immeuble d'habitation d'un pôle (ville New York ou futuriste) : les agents du pôle y habitent.
 * Entrée, auvent et corniche (ou néon) à la couleur du pôle ; fenêtres allumées dans le calque de nuit.
 */
export function drawResidence(p: Pen, ox: number, oy: number, w: number, h: number, couleur: string, v: number, nuit = false, cache?: (x: number, y: number) => boolean): void {
  const pole = rgb(couleur);
  const H = Math.max(44, Math.floor(v / 10));
  const k = v % 10;
  const m = 0.16;
  const seed = H * 17 + k * 101 + w;
  const u0 = m, v0 = m, u1 = w - m, v1 = h - m;
  const boite = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, c: RGBA, top?: RGBA) => {
    if (nuit) return;
    isoBox(p, ox, oy, a0, b0, a1, b1, z0, z1, { top: top ?? shade(c, 0.1), left: shade(c, -0.08), right: shade(c, -0.22) });
  };
  const fen = (vitre: (t: number, f: Face) => RGBA, cadre: RGBA | undefined, pasZ: number) => {
    fenetres(p, ox, oy, "L", u0, u1, v1, 10, H, { pasH: 5, pasZ, w: 2, h: 3, vitre, allume: 0.6, seed: seed + 1, nuit, cache, cadre });
    fenetres(p, ox, oy, "R", v0, v1, u1, 10, H, { pasH: 5, pasZ, w: 2, h: 3, vitre, allume: 0.6, seed: seed + 2, nuit, cache, cadre });
  };
  const dc = w / 2;
  if (futur) {
    boite(u0, v0, u1, v1, 0, H, rgb("#eef2f6"));
    fen((t, f) => shade(t < 0.2 ? rgb("#f4fbff") : rgb("#7fc4e6"), f === "L" ? -0.08 : 0.04), undefined, 6);
    if (!nuit) {
      // balcons blancs à chaque étage
      for (let z = 14; z < H - 4; z += 12) isoBox(p, ox, oy, u0, v1, u1, v1 + 0.22, z, z + 2, { top: rgb("#ffffff"), left: rgb("#dfe6ee"), right: rgb("#c9d3de") });
      // toit-jardin
      isoBox(p, ox, oy, u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, H, H + 2, { top: rgb("#6fbf5a"), left: rgb("#4f8f42"), right: rgb("#447c39") });
      const r = mulberry32(seed);
      for (let i = 0; i < 4; i++) {
        const [px, py] = isoPt(ox, oy, u0 + 0.5 + r() * (u1 - u0 - 1), v0 + 0.5 + r() * (v1 - v0 - 1), H + 2);
        p.ellipse(px, py - 2, 3, 2.5, rgb(r() < 0.5 ? "#3f9a4a" : "#58b45a"));
      }
      // entrée vitrée
      p.poly([isoPt(ox, oy, dc - 0.35, v1, 0), isoPt(ox, oy, dc + 0.35, v1, 0), isoPt(ox, oy, dc + 0.35, v1, 10), isoPt(ox, oy, dc - 0.35, v1, 10)], rgb("#bfe8f8"));
    }
    // néon à la couleur du pôle en haut et au-dessus de l'entrée
    neon(p, ox, oy, u0, v0, u1, v1, H - 2, nuit ? pole : shade(pole, 0.1), cache);
    ligne(p, isoPt(ox, oy, dc - 0.4, v1 + 0.02, 11), isoPt(ox, oy, dc + 0.4, v1 + 0.02, 11), nuit ? pole : shade(pole, 0.1), cache);
    return;
  }
  // New York : immeuble de briques ou de pierre, auvent et corniche du pôle
  const murs = [rgb("#9a4a36"), rgb("#7b4a36"), rgb("#b9a58a"), rgb("#8d5a40")][k % 4]!;
  boite(u0, v0, u1, v1, 0, H, murs);
  boite(u0, v0, u1, v1, 0, 8, rgb("#8f8273"), shade(murs, 0.1));
  fen((t, f) => shade(t < 0.25 ? rgb("#c9dbea") : rgb("#3a3f4c"), f === "L" ? -0.1 : 0), rgb("#efe8dc"), 7);
  if (nuit) return;
  // entrée : porte, auvent à la couleur du pôle, marches
  p.poly([isoPt(ox, oy, dc - 0.25, v1, 0), isoPt(ox, oy, dc + 0.25, v1, 0), isoPt(ox, oy, dc + 0.25, v1, 11), isoPt(ox, oy, dc - 0.25, v1, 11)], rgb("#2c2a30"));
  p.poly([isoPt(ox, oy, dc - 0.45, v1, 13), isoPt(ox, oy, dc + 0.45, v1, 13), isoPt(ox, oy, dc + 0.45, v1 + 0.45, 10), isoPt(ox, oy, dc - 0.45, v1 + 0.45, 10)], pole);
  isoBox(p, ox, oy, dc - 0.4, v1, dc + 0.4, v1 + 0.3, 0, 2, boxOf(rgb("#a39584"), false));
  // corniche du pôle et réservoir d'eau un immeuble sur deux
  isoBox(p, ox, oy, u0 - 0.05, v0 - 0.05, u1 + 0.05, v1 + 0.05, H, H + 4, { top: shade(pole, 0.25), left: pole, right: shade(pole, -0.2) });
  if (k % 2 === 0) {
    const [cx, cy] = isoPt(ox, oy, w * 0.35, h * 0.35, H + 4);
    for (const dx of [-4, 4]) p.vline(Math.round(cx + dx), Math.round(cy), Math.round(cy - 5), rgb("#3a3330"));
    const bois = rgb("#8b5d3c");
    p.rect(Math.round(cx - 5), Math.round(cy - 13), 10, 8, bois);
    p.poly([[cx - 6, cy - 13], [cx, cy - 18], [cx + 6, cy - 13]], rgb("#5b4a3e"));
  }
}

/** Mur du fond d'un loft futuriste : panneaux blancs, grande baie, néon à la couleur du pôle. */
export function drawLoftWallFutur(p: Pen, side: Side, color: string, ox: number, oy: number, u0: number, v0: number, u1: number, v1: number, HB: number): void {
  const zc = rgb(color);
  isoBox(p, ox, oy, u0, v0, u1, v1, 0, HB, { top: rgb("#ffffff"), left: rgb("#e6ecf2"), right: rgb("#d3dbe4") });
  const verre = rgb("#a8dcf2");
  if (side === "y-") p.poly([isoPt(ox, oy, 0.1, v1, 5), isoPt(ox, oy, 0.9, v1, 5), isoPt(ox, oy, 0.9, v1, 21), isoPt(ox, oy, 0.1, v1, 21)], verre);
  else p.poly([isoPt(ox, oy, u1, 0.1, 5), isoPt(ox, oy, u1, 0.9, 5), isoPt(ox, oy, u1, 0.9, 21), isoPt(ox, oy, u1, 0.1, 21)], shade(verre, -0.06));
  isoBox(p, ox, oy, u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, HB - 2, HB, { top: shade(zc, 0.35), left: shade(zc, 0.15), right: zc });
}
