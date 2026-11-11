import { CLIFF, GH, GW, T, WORLD_H, WORLD_W, idx, iso, inGrid, type Layout } from "../layout";
import { hash2 } from "@/lib/rng";
import { PixelCanvas, mix, rgb, shade, type Pen, type RGBA } from "./pixel";

/**
 * Sol de l'île rendu une fois dans une grande texture (pixel parfait) :
 * herbe, allées pavées, quais, canal, ponts, sols des pôles, falaise de terre en strates.
 */

const GRASS = [rgb("#93d36e"), rgb("#8acb66"), rgb("#9cda78"), rgb("#86c562")];
const GRASS_D = rgb("#6fb554");
const FLOWERS = [rgb("#fff3b0"), rgb("#ffd1e0"), rgb("#ffffff"), rgb("#cfe1ff")];
const WATER = rgb("#5db3d6");
const WATER_D = rgb("#3f8fb8");
const WATER_L = rgb("#9ad8ee");

function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** style New York : herbe pavée hors des parcs, rues en bitume, falaises de schiste */
let ny = false;
let parc: Uint8Array = new Uint8Array(0);

export function renderGround(layout: Layout): HTMLCanvasElement {
  const pc = new PixelCanvas(WORLD_W, WORLD_H);
  const p = pc.region(0, 0, WORLD_W, WORLD_H);
  const { tiles, zoneOf, zones } = layout;
  ny = layout.style === "newyork";
  parc = layout.parc;
  const tileAt = (x: number, y: number) => (inGrid(x, y) ? tiles[idx(x, y)]! : T.VOID);

  // 1. falaises (dessinées d'abord, le dessus des tuiles les recouvre)
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const t = tileAt(x, y);
      if (t === T.VOID || t === T.PONTOON) continue;
      const below = tileAt(x, y + 1);
      const right = tileAt(x + 1, y);
      if (below === T.VOID || below === T.PONTOON) drawFace(p, x, y, "left", t === T.WATER);
      if (right === T.VOID || right === T.PONTOON) drawFace(p, x, y, "right", t === T.WATER);
    }

  // 2. dessus des tuiles
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const t = tileAt(x, y);
      if (t === T.VOID) continue;
      const zi = zoneOf[idx(x, y)]!;
      const zone = zi >= 0 ? zones[zi] : undefined;
      drawTile(p, x, y, t, zone?.floor, zone?.id, tileAt);
    }

  // 3. pieux sous le ponton
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (tileAt(x, y) !== T.PONTOON) continue;
      if (tileAt(x, y + 1) !== T.PONTOON) {
        const { x: px, y: py } = iso(x + 0.5, y + 1);
        for (let k = 0; k < 26; k++) {
          const a = Math.max(0, 255 - k * 9);
          p.set(px - 1, py + k, rgb("#5b3a24", a));
          p.set(px, py + k, rgb("#7f5532", a));
        }
        // planche de rive
        const L = iso(x, y + 1);
        for (let k = 0; k < 16; k++) {
          p.set(L.x + k, Math.round(L.y + k / 2), rgb("#7f5532"));
          p.set(L.x + k, Math.round(L.y + k / 2) + 1, rgb("#5b3a24"));
        }
      }
    }

  return pc.toCanvas();
}

function drawTile(p: Pen, gx: number, gy: number, t: T, floor: string | undefined, zoneId: string | undefined, tileAt: (x: number, y: number) => T): void {
  const top = iso(gx, gy);
  const floorCol = floor ? rgb(floor) : 0;
  for (let r = 0; r < 16; r++) {
    const half = r < 8 ? (r + 1) * 2 : (16 - r) * 2;
    for (let i = -half; i < half; i++) {
      const px = top.x + i;
      const py = top.y + r;
      // coordonnées de grille fractionnaires du centre du pixel
      const a = (i + 0.5) / 16;
      const b = (r + 0.5) / 8;
      const fu = (a + b) / 2;
      const fv = (b - a) / 2;
      p.set(px, py, tileColor(t, gx, gy, fu, fv, px, py, floorCol, zoneId, tileAt));
    }
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}

const route = (t: T) => t === T.PATH || t === T.BRIDGE;

/** Sol du style New York (rues, trottoirs, parcs) ; null = même rendu que l'île d'origine. */
function tileColorNY(t: T, gx: number, gy: number, fu: number, fv: number, px: number, py: number, tileAt: (x: number, y: number) => T): RGBA | null {
  const h = hash2(px, py, 3);
  if (t === T.GRASS && !parc[idx(gx, gy)]) {
    // trottoir : dalles de béton
    const nearRoad = (dx: number, dy: number) => route(tileAt(gx + dx, gy + dy));
    if ((fv > 0.9 && nearRoad(0, 1)) || (fu > 0.9 && nearRoad(1, 0)) || (fv < 0.1 && nearRoad(0, -1)) || (fu < 0.1 && nearRoad(-1, 0))) return rgb("#e4dfd6");
    if (frac((gx + fu) * 2) < 0.06 || frac((gy + fv) * 2) < 0.06) return rgb("#aca69c");
    const base = mix(rgb("#cdc8bf"), rgb("#c2bcb2"), hash2(Math.floor((gx + fu) * 2), Math.floor((gy + fv) * 2), 21));
    return h < 0.01 ? rgb("#9d978e") : base;
  }
  if (t === T.GRASS) {
    // parc : pelouse et feuilles mortes
    let c = [rgb("#7fb55e"), rgb("#76ad57"), rgb("#86bb64"), rgb("#70a652")][Math.floor(hash2(px >> 1, py >> 1, 1) * 4)]!;
    if (h < 0.03) c = rgb("#5f9447");
    else if (h > 0.985) c = [rgb("#e0a63a"), rgb("#d9772b"), rgb("#c8552f")][Math.floor(hash2(px, py, 9) * 3)]!;
    return c;
  }
  if (t === T.PATH || t === T.BRIDGE) {
    const L = route(tileAt(gx - 1, gy)), Rr = route(tileAt(gx + 1, gy)), U = route(tileAt(gx, gy - 1)), D = route(tileAt(gx, gy + 1));
    const asphalte = mix(rgb("#585c69"), rgb("#4f5360"), hash2(px >> 1, py >> 1, 17));
    const horiz = L && Rr && !(U && D);
    const vert = U && D && !(L && Rr);
    const carrefour = (U || D) && (L || Rr) && !horiz && !vert;
    if (t === T.BRIDGE && (fu < 0.08 || fu > 0.92)) return rgb("#8b93a6");
    // passages piétons à l'entrée des carrefours
    const zebre = (a: number) => (frac(a * 5) < 0.5 ? rgb("#e8e4da") : asphalte);
    if (horiz) {
      const nextCross = (dx: number) => { const a = tileAt(gx + dx, gy - 1), b = tileAt(gx + dx, gy + 1); return route(a) && route(b); };
      if ((nextCross(1) && fu > 0.45) || (nextCross(-1) && fu < 0.55)) return zebre(gy + fv);
      // ligne médiane jaune entre les deux voies
      if (((!U && D && fv > 0.92) || (U && !D && fv < 0.08)) && frac((gx + fu) * 1.5) < 0.55) return rgb("#e8c547");
      return asphalte;
    }
    if (vert) {
      const nextCross = (dy: number) => { const a = tileAt(gx - 1, gy + dy), b = tileAt(gx + 1, gy + dy); return route(a) && route(b); };
      if ((nextCross(1) && fv > 0.45) || (nextCross(-1) && fv < 0.55)) return zebre(gx + fu);
      if (((!L && Rr && fu > 0.92) || (L && !Rr && fu < 0.08)) && frac((gy + fv) * 1.5) < 0.55) return rgb("#e8c547");
      return asphalte;
    }
    if (carrefour) return h < 0.02 ? shade(asphalte, 0.08) : asphalte;
    return asphalte;
  }
  if (t === T.WATER) {
    const edgeN = tileAt(gx, gy - 1) !== T.WATER && tileAt(gx, gy - 1) !== T.BRIDGE;
    if (edgeN && fv < 0.18) return rgb("#2f5f80");
    const w = Math.sin((gx + fu) * 2.2 + (gy + fv) * 9) + Math.sin((gx + fu) * 5.1 - (gy + fv) * 3);
    if (w > 1.7 && h < 0.6) return rgb("#8fc0d8");
    return mix(rgb("#4a86a8"), rgb("#2f5f80"), (gy + fv - 29) * 0.25);
  }
  return null;
}

function tileColor(t: T, gx: number, gy: number, fu: number, fv: number, px: number, py: number, floorCol: RGBA, zoneId: string | undefined, tileAt: (x: number, y: number) => T): RGBA {
  if (ny) {
    const c = tileColorNY(t, gx, gy, fu, fv, px, py, tileAt);
    if (c !== null) return c;
  }
  const h = hash2(px, py, 3);
  switch (t) {
    case T.GRASS: {
      let c = GRASS[Math.floor(hash2(px >> 1, py >> 1, 1) * GRASS.length)]!;
      if (h < 0.035) c = GRASS_D;
      else if (h > 0.997) c = FLOWERS[Math.floor(hash2(px, py, 9) * FLOWERS.length)]!;
      // ombre douce au pied des allées et des sols
      const nearHard = (dx: number, dy: number) => {
        const n = tileAt(gx + dx, gy + dy);
        return n === T.PATH || n === T.QUAY || n === T.FLOOR || n === T.WOOD;
      };
      if ((fv < 0.08 && nearHard(0, -1)) || (fu < 0.08 && nearHard(-1, 0))) c = shade(c, -0.12);
      return c;
    }
    case T.PATH: {
      const row = Math.floor((gy + fv) * 4);
      const off = (row % 2) * 0.5;
      const col = Math.floor((gx + fu) * 3 + off);
      const mortar = frac((gy + fv) * 4) < 0.16 || frac((gx + fu) * 3 + off) < 0.1;
      if (mortar) return rgb("#bdb09e");
      const v = hash2(col, row, 4);
      const base = mix(rgb("#e4dacb"), rgb("#d3c6b2"), v);
      return h < 0.04 ? shade(base, -0.06) : base;
    }
    case T.QUAY: {
      const row = Math.floor((gy + fv) * 2);
      const off = (row % 2) * 0.5;
      const col = Math.floor((gx + fu) * 2 + off);
      const mortar = frac((gy + fv) * 2) < 0.08 || frac((gx + fu) * 2 + off) < 0.05;
      // margelle côté canal
      const waterBelow = tileAt(gx, gy + 1) === T.WATER;
      const waterAbove = tileAt(gx, gy - 1) === T.WATER;
      if ((waterBelow && fv > 0.86) || (waterAbove && fv < 0.14)) return mix(rgb("#efeae2"), rgb("#d9d2c6"), hash2(col, 1, 5));
      if (mortar) return rgb("#a9a6a2");
      const v = hash2(col, row, 6);
      return mix(rgb("#cfcbc4"), rgb("#bdb8b0"), v);
    }
    case T.WATER: {
      const edgeN = tileAt(gx, gy - 1) !== T.WATER && tileAt(gx, gy - 1) !== T.BRIDGE;
      if (edgeN && fv < 0.18) return WATER_D;
      const w = Math.sin((gx + fu) * 2.2 + (gy + fv) * 9) + Math.sin((gx + fu) * 5.1 - (gy + fv) * 3);
      if (w > 1.7 && h < 0.6) return WATER_L;
      return mix(WATER, WATER_D, (gy + fv - 29) * 0.25);
    }
    case T.BRIDGE: {
      const plank = Math.floor((gy + fv) * 5);
      if (frac((gy + fv) * 5) < 0.14) return rgb("#6b4a2f");
      const base = plank % 2 ? rgb("#c08d5a") : rgb("#b07a4a");
      return h < 0.05 ? shade(base, -0.1) : base;
    }
    case T.WOOD:
    case T.PONTOON: {
      const plank = Math.floor((gx + fu) * 4);
      if (frac((gx + fu) * 4) < 0.1) return rgb("#8a5a33");
      const base = mix(rgb("#d6a774"), rgb("#c4935f"), hash2(plank, gy, 8));
      if (t === T.PONTOON && (fv < 0.06 || fv > 0.94)) return rgb("#7f5532");
      return h < 0.04 ? shade(base, -0.08) : base;
    }
    case T.ROCK: {
      const v = hash2((px / 3) | 0, (py / 3) | 0, 11);
      return v < 0.2 ? rgb("#7c788a") : v > 0.85 ? rgb("#b8b4c4") : rgb("#9a96a8");
    }
    case T.FLOOR: {
      if (zoneId === "direction" || zoneId === "criee") {
        const c = (Math.floor((gx + fu) * 2) + Math.floor((gy + fv) * 2)) % 2;
        const base = c ? floorCol : shade(floorCol, -0.04);
        return h < 0.012 ? shade(base, 0.4) : base;
      }
      if (zoneId === "douane") {
        const c = (Math.floor((gx + fu) * 2) + Math.floor((gy + fv) * 2)) % 2;
        return c ? rgb("#f4ece2") : rgb("#e6cfc4");
      }
      if (zoneId === "detente") {
        return frac((gx + fu) * 4) < 0.08 ? shade(floorCol, -0.12) : floorCol;
      }
      // moquette légère à motif
      const dot = frac((gx + fu) * 4) < 0.1 && frac((gy + fv) * 4) < 0.1;
      return dot ? shade(floorCol, -0.08) : h < 0.02 ? shade(floorCol, -0.04) : floorCol;
    }
    default:
      return 0;
  }
}

/** Tranche de falaise sous une arête exposée (face gauche = +y, face droite = +x). */
function drawFace(p: Pen, gx: number, gy: number, side: "left" | "right", water: boolean): void {
  const start = side === "left" ? iso(gx, gy + 1) : iso(gx + 1, gy + 1);
  const dirY = side === "left" ? 0.5 : -0.5;
  for (let i = 0; i < 16; i++) {
    const x = start.x + i;
    const yEdge = Math.round(start.y + (i + 0.5) * dirY - 0.5);
    const n = smoothNoise(x * 0.06, 2) * 0.6 + smoothNoise(x * 0.21, 5) * 0.4;
    const depth = Math.round(30 + n * (CLIFF - 34));
    const drip = hash2(x, 0, 12) < 0.18 ? Math.round(hash2(x, 1, 12) * 6) : 0;
    for (let d = 0; d < depth + drip; d++) {
      const y = yEdge + d;
      let c: RGBA;
      if (water) {
        const streak = hash2(x, Math.floor((y + x * 3) / 5), 13);
        c = streak > 0.75 ? rgb("#f2fbff") : streak > 0.4 ? rgb("#9fdaf0") : rgb("#6fc0e0");
        if (d > depth - 8) c = mix(c, rgb("#ffffff"), 0.4);
      } else if (ny) {
        // schiste de Manhattan : strates grises pailletées de mica
        if (d < 3) c = rgb("#b9b3a9");
        else {
          const wave = Math.sin(x * 0.08) * 2 + Math.sin(x * 0.23) * 1.2;
          const band = Math.floor((d + wave) / 6);
          const bands = [rgb("#77788a"), rgb("#8a8b9c"), rgb("#6a6b7c"), rgb("#9796a6"), rgb("#5d5e70"), rgb("#7a7a8c"), rgb("#535466"), rgb("#45465a")];
          c = bands[Math.min(bands.length - 1, band)]!;
          const hh = hash2(x, y, 14);
          if (hh < 0.04) c = rgb("#d6d9e6");
          else if (hh < 0.08) c = shade(c, -0.25);
          if (d >= depth - 1) c = rgb("#34354a");
        }
      } else if (d < 2) c = rgb("#5ea64a");
      else if (d < 4) c = rgb("#4f8a3c");
      else {
        const wave = Math.sin(x * 0.08) * 2 + Math.sin(x * 0.23) * 1.2;
        const band = Math.floor((d + wave) / 7);
        const bands = [rgb("#8d5a35"), rgb("#a06b3f"), rgb("#7a4b2c"), rgb("#b07a4a"), rgb("#6b4026"), rgb("#8a5a36"), rgb("#5f3922"), rgb("#4f2f1c")];
        c = bands[Math.min(bands.length - 1, band)]!;
        const hh = hash2(x, y, 14);
        if (hh < 0.05) c = rgb("#c2a27a");
        else if (hh < 0.08) c = shade(c, -0.25);
        if (d >= depth - 1) c = rgb("#3f2516");
      }
      if (side === "right") c = shade(c, -0.14);
      else c = shade(c, 0.02);
      p.set(x, y, c);
    }
    // cascade : continue sous la falaise en s'effaçant
    if (water) {
      for (let k = 0; k < 40; k++) {
        const a = Math.max(0, 200 - k * 5);
        p.set(x, yEdge + depth + drip + k, rgb("#dff4fb", a));
      }
    }
  }
}
