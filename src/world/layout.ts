import { agentsOfPole, allLieux, allPoles, catalogStore } from "@/data/catalog";
import { slotById } from "./slots";
import { hash2, mulberry32 } from "@/lib/rng";

/**
 * Plan de l'île : grille isométrique GW×GH.
 * Axes : +x = bas-droite à l'écran, +y = bas-gauche. La tuile (0,0) est le sommet haut.
 * Le canal suit les lignes y = 29-30 → il traverse l'île en diagonale à l'écran.
 */

export const GW = 58;
export const GH = 58;

export enum T {
  VOID = 0,
  GRASS = 1,
  PATH = 2,
  QUAY = 3,
  WATER = 4,
  BRIDGE = 5,
  FLOOR = 6,
  WOOD = 7,
  ROCK = 8,
  PONTOON = 9,
}

export type Side = "x-" | "x+" | "y-" | "y+";
/** direction du regard d'un bonhomme (le long d'un axe de grille) */
export type Facing = Side;

export type WallStyle = "muret" | "verre" | "douane" | "back" | "none";

export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  walls: WallStyle;
  doorSide: Side;
  /** couleur principale & sol */
  color: string;
  floor: string;
}

export type PropKind =
  | "desk"
  | "chair"
  | "plant"
  | "printer"
  | "whiteboard"
  | "shelf"
  | "bigTable"
  | "counter"
  | "coffee"
  | "roundTable"
  | "parasol"
  | "sofa"
  | "beanbag"
  | "babyfoot"
  | "pingpong"
  | "pine"
  | "tree"
  | "bush"
  | "lamp"
  | "bollard"
  | "crate"
  | "barrel"
  | "bench"
  | "phare"
  | "pile"
  | "stampDesk"
  | "bigScreen"
  | "archive"
  | "flowers"
  | "railing";

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /** emprise en cases (meubles multi-cases) */
  w?: number;
  h?: number;
  facing?: Facing;
  variant?: number;
  zone?: string;
  /** bloque le passage */
  blocks: boolean;
  /** décalage de tri (en px écran) */
  zBias?: number;
}

export interface Spot {
  x: number;
  y: number;
  facing: Facing;
  pose: "sit" | "stand";
  kind: "desk" | "cafe" | "terrasse" | "detente" | "criee" | "douane" | "archives";
}

export interface WallSlab {
  x: number;
  y: number;
  side: Side;
  style: Exclude<WallStyle, "back" | "none"> | "muret";
  zone: string;
}

export interface Layout {
  tiles: Uint8Array;
  /** id de zone par case (-1 = aucune) */
  zoneOf: Int16Array;
  blocked: Uint8Array;
  zones: Zone[];
  zoneIndex: Record<string, number>;
  props: Prop[];
  slabs: WallSlab[];
  spots: Spot[];
  deskOf: Record<string, Spot>;
  home: { x: number; y: number };
  /** case d'arrivée au bout du ponton (là où les agents apparaissent / disparaissent) */
  wanderCells: number[];
  lamps: { x: number; y: number }[];
  pharePos: { x: number; y: number };
  pileCell: { x: number; y: number };
}

export const idx = (x: number, y: number): number => y * GW + x;
export const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < GW && y < GH;

const ZW = 7;
const ZH = 6;

interface ZonePlan {
  id: string;
  x: number;
  y: number;
  walls: WallStyle;
  doorSide: Side;
}

/** Plan des zones à partir du catalogue (pôles + lieux actifs, chacun sur son emplacement). */
function zonePlan(): ZonePlan[] {
  const used = new Set<string>();
  const out: ZonePlan[] = [];
  for (const p of [...allPoles(), ...allLieux()]) {
    const slot = slotById(p.position);
    if (!slot || used.has(slot.id)) continue;
    used.add(slot.id);
    const doorSide: Side = p.id === "douane" ? "x-" : slot.rive === "nord" ? "y+" : "y-";
    out.push({ id: p.id, x: slot.x, y: slot.y, walls: p.style, doorSide });
  }
  return out;
}

const CANAL_Y = [29, 30];
const QUAY_N = [27, 28];
const QUAY_S = [31, 32];
const BRIDGES_X = [21, 22, 39, 40];
const H_PATHS = [11, 12, 19, 20, 39, 40, 47, 48];
const V_PATHS = [12, 13, 21, 22, 30, 31, 39, 40];
export const PHARE = { x: 52, y: 6 };
const HOME_ROW = 47;

let cached: { key: string; layout: Layout } | null = null;

/** Plan de l'île, recalculé quand la structure du catalogue change (pôle ajouté, agent déplacé…). */
export function getLayout(): Layout {
  const key = catalogStore.getState().structure;
  if (cached && cached.key === key) return cached.layout;
  cached = { key, layout: buildLayout() };
  return cached.layout;
}

function buildLayout(): Layout {
  const tiles = new Uint8Array(GW * GH);
  const zoneOf = new Int16Array(GW * GH).fill(-1);
  const blocked = new Uint8Array(GW * GH);
  const props: Prop[] = [];
  const slabs: WallSlab[] = [];
  const spots: Spot[] = [];
  const deskOf: Record<string, Spot> = {};
  const rng = mulberry32(20260911);
  const ZONE_PLAN = zonePlan();

  // ---- 1. Forme de l'île : superellipse + emprise des zones + éperon du phare
  const cx = GW / 2;
  const cy = GH / 2;
  const mask = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const dx = Math.abs(x + 0.5 - cx) / 27.6;
      const dy = Math.abs(y + 0.5 - cy) / 27.6;
      const n = (hash2(x >> 1, y >> 1, 7) - 0.5) * 0.12;
      if (Math.pow(dx, 2.5) + Math.pow(dy, 2.5) <= 1 + n) mask[idx(x, y)] = 1;
      const px = x + 0.5 - PHARE.x - 0.5;
      const py = y + 0.5 - PHARE.y - 0.5;
      if (px * px + py * py <= 4.6 * 4.6) mask[idx(x, y)] = 1;
    }
  }
  for (const z of ZONE_PLAN) {
    for (let y = z.y - 2; y < z.y + ZH + 2; y++)
      for (let x = z.x - 2; x < z.x + ZW + 2; x++) if (inGrid(x, y)) mask[idx(x, y)] = 1;
  }
  // lisse : retire les cases isolées
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < GH - 1; y++)
      for (let x = 1; x < GW - 1; x++) {
        const n = mask[idx(x + 1, y)]! + mask[idx(x - 1, y)]! + mask[idx(x, y + 1)]! + mask[idx(x, y - 1)]!;
        if (mask[idx(x, y)] && n <= 1) mask[idx(x, y)] = 0;
        if (!mask[idx(x, y)] && n >= 3) mask[idx(x, y)] = 1;
      }
  }
  for (let i = 0; i < mask.length; i++) tiles[i] = mask[i] ? T.GRASS : T.VOID;

  const setIf = (x: number, y: number, t: T) => {
    if (inGrid(x, y) && tiles[idx(x, y)] !== T.VOID) tiles[idx(x, y)] = t;
  };

  // ---- 2. Allées, quais, canal, ponts
  for (const y of H_PATHS) for (let x = 0; x < GW; x++) setIf(x, y, T.PATH);
  for (const x of V_PATHS) for (let y = 0; y < GH; y++) setIf(x, y, T.PATH);
  for (const y of [...QUAY_N, ...QUAY_S]) for (let x = 0; x < GW; x++) setIf(x, y, T.QUAY);
  for (const y of CANAL_Y) for (let x = 0; x < GW; x++) setIf(x, y, T.WATER);
  for (const x of BRIDGES_X) for (const y of CANAL_Y) setIf(x, y, T.BRIDGE);
  // les allées verticales 12-13 et 30-31 s'arrêtent aux quais (pas de pont)
  // chemin vers le phare
  for (let x = 41; x <= 50; x++) for (const y of [11, 12]) setIf(x, y, T.PATH);
  for (let y = 7; y <= 12; y++) for (const x of [48, 49]) setIf(x, y, T.PATH);
  // éperon rocheux du phare
  for (let y = PHARE.y - 2; y <= PHARE.y + 2; y++)
    for (let x = PHARE.x - 2; x <= PHARE.x + 2; x++) {
      const d = Math.abs(x - PHARE.x) + Math.abs(y - PHARE.y);
      if (d <= 3) setIf(x, y, T.ROCK);
    }

  // ---- 3. Zones (pôles + lieux)
  const zones: Zone[] = [];
  const zoneIndex: Record<string, number> = {};
  const poleInfo = Object.fromEntries([...allPoles(), ...allLieux()].map((p) => [p.id, p]));
  for (const zp of ZONE_PLAN) {
    const info = poleInfo[zp.id];
    if (!info) throw new Error(`Zone sans pôle : ${zp.id}`);
    const zi = zones.length;
    zones.push({ id: zp.id, x: zp.x, y: zp.y, w: ZW, h: ZH, walls: zp.walls, doorSide: zp.doorSide, color: info.couleur, floor: info.sol });
    zoneIndex[zp.id] = zi;
    for (let y = zp.y; y < zp.y + ZH; y++)
      for (let x = zp.x; x < zp.x + ZW; x++) {
        tiles[idx(x, y)] = T.FLOOR;
        zoneOf[idx(x, y)] = zi;
      }
    if (zp.id === "quai" || zp.id === "detente") {
      // plancher bois pour la terrasse et la détente
      for (let y = zp.y; y < zp.y + ZH; y++) for (let x = zp.x; x < zp.x + ZW; x++) tiles[idx(x, y)] = zp.id === "quai" ? T.WOOD : T.FLOOR;
    }
  }

  // ---- 4. Murets
  for (const z of zones) {
    if (z.walls === "none") continue;
    const doorCells = doorCellsOf(z);
    const isDoor = (x: number, y: number) => doorCells.some((d) => d.x === x && d.y === y);
    for (let y = z.y; y < z.y + z.h; y++)
      for (let x = z.x; x < z.x + z.w; x++) {
        const sides: Side[] = [];
        if (x === z.x) sides.push("x-");
        if (y === z.y) sides.push("y-");
        if (z.walls !== "back") {
          if (x === z.x + z.w - 1) sides.push("x+");
          if (y === z.y + z.h - 1) sides.push("y+");
        }
        if (!sides.length) continue;
        if (isDoor(x, y)) continue;
        blocked[idx(x, y)] = 1;
        const style = z.walls === "back" ? "muret" : z.walls;
        for (const side of sides) slabs.push({ x, y, side, style, zone: z.id });
      }
  }

  // ---- 5. Mobilier par zone
  const add = (p: Prop) => {
    props.push(p);
    if (p.blocks) {
      for (let yy = p.y; yy < p.y + (p.h ?? 1); yy++)
        for (let xx = p.x; xx < p.x + (p.w ?? 1); xx++) blocked[idx(xx, yy)] = 1;
    }
  };
  const spot = (s: Spot) => spots.push(s);

  for (const z of zones) {
    const { x: x0, y: y0 } = z;
    const members = agentsOfPole(z.id);
    switch (z.id) {
      case "direction": {
        // verrière : deux grands bureaux + salon + écran
        const desks = [x0 + 2, x0 + 4];
        members.slice(0, desks.length).forEach((a, i) => {
          const dx = desks[i]!;
          add({ kind: "desk", x: dx, y: y0 + 2, blocks: true, zone: z.id, variant: 1 });
          add({ kind: "chair", x: dx, y: y0 + 1, blocks: false, zone: z.id, facing: "y+", zBias: -2 });
          const s: Spot = { x: dx, y: y0 + 1, facing: "y+", pose: "sit", kind: "desk" };
          deskOf[a.id] = s;
        });
        add({ kind: "bigScreen", x: x0 + 3, y: y0, blocks: false, zone: z.id });
        add({ kind: "plant", x: x0 + 1, y: y0 + 1, blocks: true, zone: z.id, variant: 2 });
        add({ kind: "plant", x: x0 + 5, y: y0 + 4, blocks: true, zone: z.id, variant: 1 });
        add({ kind: "sofa", x: x0 + 1, y: y0 + 4, blocks: false, zone: z.id, facing: "x+", variant: 0 });
        spot({ x: x0 + 1, y: y0 + 4, facing: "x+", pose: "sit", kind: "detente" });
        break;
      }
      case "criee": {
        add({ kind: "bigTable", x: x0 + 2, y: y0 + 2, w: 3, h: 2, blocks: true, zone: z.id });
        add({ kind: "bigScreen", x: x0 + 3, y: y0, blocks: false, zone: z.id, variant: 1 });
        const seats: [number, number, Facing][] = [
          [x0 + 2, y0 + 1, "y+"], [x0 + 3, y0 + 1, "y+"], [x0 + 4, y0 + 1, "y+"],
          [x0 + 1, y0 + 2, "x+"], [x0 + 1, y0 + 3, "x+"],
          [x0 + 5, y0 + 2, "x-"], [x0 + 5, y0 + 3, "x-"],
          [x0 + 2, y0 + 4, "y-"], [x0 + 3, y0 + 4, "y-"], [x0 + 4, y0 + 4, "y-"],
        ];
        for (const [sx, sy, f] of seats) {
          add({ kind: "chair", x: sx, y: sy, blocks: false, zone: z.id, facing: f, zBias: -2 });
          spot({ x: sx, y: sy, facing: f, pose: "sit", kind: "criee" });
        }
        add({ kind: "plant", x: x0 + 1, y: y0 + 1, blocks: true, zone: z.id, variant: 0 });
        add({ kind: "plant", x: x0 + 5, y: y0 + 1, blocks: true, zone: z.id, variant: 2 });
        break;
      }
      case "quai": {
        add({ kind: "counter", x: x0 + 1, y: y0 + 1, w: 3, h: 1, blocks: true, zone: z.id });
        add({ kind: "coffee", x: x0 + 2, y: y0 + 1, blocks: false, zone: z.id, zBias: 2 });
        for (const sx of [x0 + 1, x0 + 2, x0 + 3]) spot({ x: sx, y: y0 + 2, facing: "y-", pose: "stand", kind: "cafe" });
        add({ kind: "shelf", x: x0 + 5, y: y0, blocks: false, zone: z.id, variant: 1 });
        const tables: [number, number][] = [[x0 + 2, y0 + 4], [x0 + 5, y0 + 3]];
        for (const [tx, ty] of tables) {
          add({ kind: "roundTable", x: tx, y: ty, blocks: true, zone: z.id });
          add({ kind: "parasol", x: tx, y: ty, blocks: false, zone: z.id, zBias: 1, variant: tx % 2 });
        }
        const tseats: [number, number, Facing][] = [
          [x0 + 1, y0 + 4, "x+"], [x0 + 3, y0 + 4, "x-"], [x0 + 2, y0 + 5, "y-"],
          [x0 + 4, y0 + 3, "x+"], [x0 + 5, y0 + 2, "y+"], [x0 + 5, y0 + 4, "y-"],
        ];
        for (const [sx, sy, f] of tseats) {
          add({ kind: "chair", x: sx, y: sy, blocks: false, zone: z.id, facing: f, zBias: -2, variant: 2 });
          spot({ x: sx, y: sy, facing: f, pose: "sit", kind: "terrasse" });
        }
        add({ kind: "plant", x: x0 + 6, y: y0 + 1, blocks: true, zone: z.id, variant: 1 });
        break;
      }
      case "douane": {
        add({ kind: "stampDesk", x: x0 + 3, y: y0 + 2, w: 2, h: 1, blocks: true, zone: z.id });
        add({ kind: "pile", x: x0 + 2, y: y0 + 4, blocks: true, zone: z.id });
        spot({ x: x0 + 1, y: y0 + 4, facing: "x+", pose: "stand", kind: "douane" });
        spot({ x: x0 + 2, y: y0 + 3, facing: "y+", pose: "stand", kind: "douane" });
        spot({ x: x0 + 3, y: y0 + 4, facing: "x-", pose: "stand", kind: "douane" });
        add({ kind: "shelf", x: x0 + 2, y: y0, blocks: false, zone: z.id, variant: 2 });
        add({ kind: "shelf", x: x0 + 4, y: y0, blocks: false, zone: z.id, variant: 2 });
        add({ kind: "crate", x: x0 + 5, y: y0 + 4, blocks: true, zone: z.id });
        add({ kind: "crate", x: x0 + 5, y: y0 + 1, blocks: true, zone: z.id, variant: 1 });
        break;
      }
      case "archives": {
        for (const sx of [x0 + 1, x0 + 2, x0 + 4, x0 + 5]) add({ kind: "archive", x: sx, y: y0 + 1, blocks: true, zone: z.id, variant: sx % 3 });
        for (const sx of [x0 + 1, x0 + 2]) add({ kind: "archive", x: sx, y: y0 + 3, blocks: true, zone: z.id, variant: (sx + 1) % 3 });
        spot({ x: x0 + 3, y: y0 + 2, facing: "y-", pose: "stand", kind: "archives" });
        spot({ x: x0 + 5, y: y0 + 3, facing: "x-", pose: "stand", kind: "archives" });
        add({ kind: "plant", x: x0 + 5, y: y0 + 4, blocks: true, zone: z.id, variant: 0 });
        break;
      }
      case "detente": {
        add({ kind: "babyfoot", x: x0 + 2, y: y0 + 2, w: 2, h: 1, blocks: true, zone: z.id });
        for (const sx of [x0 + 2, x0 + 3]) {
          spot({ x: sx, y: y0 + 1, facing: "y+", pose: "stand", kind: "detente" });
          spot({ x: sx, y: y0 + 3, facing: "y-", pose: "stand", kind: "detente" });
        }
        add({ kind: "pingpong", x: x0 + 4, y: y0 + 4, w: 2, h: 1, blocks: true, zone: z.id });
        spot({ x: x0 + 3, y: y0 + 4, facing: "x+", pose: "stand", kind: "detente" });
        spot({ x: x0 + 6, y: y0 + 4, facing: "x-", pose: "stand", kind: "detente" });
        for (const sx of [x0 + 5, x0 + 6]) {
          add({ kind: "sofa", x: sx, y: y0 + 1, blocks: false, zone: z.id, facing: "y+", variant: sx - x0 - 5 });
          spot({ x: sx, y: y0 + 1, facing: "y+", pose: "sit", kind: "detente" });
        }
        add({ kind: "beanbag", x: x0 + 1, y: y0 + 5, blocks: false, zone: z.id });
        spot({ x: x0 + 1, y: y0 + 5, facing: "y-", pose: "sit", kind: "detente" });
        add({ kind: "plant", x: x0 + 1, y: y0 + 1, blocks: true, zone: z.id, variant: 2 });
        break;
      }
      default: {
        // bureau standard d'un pôle
        const doorY = z.doorSide === "y+";
        const chairRow = doorY ? y0 + 1 : y0 + 2;
        const deskRow = chairRow + 1;
        members.slice(0, 4).forEach((a, i) => {
          const dx = x0 + 1 + i;
          add({ kind: "desk", x: dx, y: deskRow, blocks: true, zone: z.id, variant: 0 });
          add({ kind: "chair", x: dx, y: chairRow, blocks: false, zone: z.id, facing: "y+", zBias: -2 });
          deskOf[a.id] = { x: dx, y: chairRow, facing: "y+", pose: "sit", kind: "desk" };
        });
        // décor
        add({ kind: "printer", x: x0 + 1, y: y0 + 4, blocks: true, zone: z.id });
        add({ kind: "plant", x: x0 + 5, y: y0 + 4, blocks: true, zone: z.id, variant: (x0 + y0) % 3 });
        if (doorY) {
          add({ kind: "whiteboard", x: x0 + 3, y: y0, blocks: false, zone: z.id });
          add({ kind: "shelf", x: x0 + 5, y: y0, blocks: false, zone: z.id, variant: 0 });
        } else {
          add({ kind: "whiteboard", x: x0, y: y0 + 3, blocks: false, zone: z.id, facing: "x+" });
          add({ kind: "plant", x: x0 + 5, y: y0 + 1, blocks: true, zone: z.id, variant: 1 });
        }
        if (members.length < 3) add({ kind: "plant", x: x0 + 4, y: deskRow, blocks: true, zone: z.id, variant: 2 });
        break;
      }
    }
  }

  // ---- 6. Phare, ponton, décor extérieur
  add({ kind: "phare", x: PHARE.x, y: PHARE.y, blocks: true });
  // ponton de départ (les agents rentrent chez eux par là)
  for (let x = 0; x < GW; x++) {
    for (const y of [HOME_ROW, HOME_ROW + 1]) {
      if (tiles[idx(x, y)] !== T.VOID) break;
      tiles[idx(x, y)] = T.PONTOON;
    }
  }
  const home = { x: 0, y: HOME_ROW };

  // quais : bittes d'amarrage, caisses, lampadaires (sur la rangée côté eau)
  const lamps: { x: number; y: number }[] = [];
  for (const y of [28, 31]) {
    for (let x = 1; x < GW - 1; x++) {
      if (tiles[idx(x, y)] !== T.QUAY) continue;
      const nearBridge = BRIDGES_X.some((bx) => Math.abs(bx - x) <= 1);
      if (nearBridge) continue;
      if (x % 8 === 3) {
        add({ kind: "lamp", x, y, blocks: true });
        lamps.push({ x, y });
      } else if (x % 4 === 1) add({ kind: "bollard", x, y, blocks: true });
      else if ((x % 11 === 6 || x % 13 === 9) && hash2(x, y) < 0.7) add({ kind: hash2(y, x) < 0.5 ? "crate" : "barrel", x, y, blocks: true, variant: x % 2 });
    }
  }
  // lampadaires aux carrefours des allées
  for (const [lx, ly] of [
    [11, 10], [20, 10], [29, 10], [38, 10], [11, 18], [29, 18], [47, 18], [20, 38], [38, 38], [29, 46], [11, 46], [47, 10],
  ] as [number, number][]) {
    if (tiles[idx(lx, ly)] === T.GRASS && !blocked[idx(lx, ly)]) {
      add({ kind: "lamp", x: lx, y: ly, blocks: true });
      lamps.push({ x: lx, y: ly });
    }
  }
  // garde-corps des ponts
  for (const bx of [21, 39]) {
    for (const by of CANAL_Y) {
      add({ kind: "railing", x: bx, y: by, blocks: false, facing: "x-" });
      add({ kind: "railing", x: bx + 1, y: by, blocks: false, facing: "x+" });
    }
  }
  // bancs et massifs dans le jardin du sud-est
  add({ kind: "bench", x: 34, y: 43, blocks: true, facing: "y+" });
  add({ kind: "bench", x: 36, y: 43, blocks: true, facing: "y+" });
  for (const [fx, fy] of [[33, 45], [35, 45], [37, 45], [43, 25], [45, 25], [15, 3], [24, 3], [33, 3]] as [number, number][]) {
    if (tiles[idx(fx, fy)] === T.GRASS && !blocked[idx(fx, fy)]) add({ kind: "flowers", x: fx, y: fy, blocks: true, variant: (fx + fy) % 3 });
  }

  // arbres : surtout en bordure de l'île, jamais sur les allées
  const isEdge = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (!inGrid(x + dx, y + dy) || tiles[idx(x + dx, y + dy)] === T.VOID) return true;
      }
    return false;
  };
  const nearWalk = (x: number, y: number) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const t = inGrid(x + dx, y + dy) ? tiles[idx(x + dx, y + dy)] : T.VOID;
      if (t === T.PATH || t === T.QUAY || t === T.FLOOR || t === T.WOOD || t === T.BRIDGE || t === T.ROCK) return true;
    }
    return false;
  };
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (tiles[idx(x, y)] !== T.GRASS || blocked[idx(x, y)]) continue;
      if (nearWalk(x, y)) continue;
      const edge = isEdge(x, y, 1);
      const r = rng();
      const p = edge ? 0.42 : 0.07;
      if (r < p) {
        const kr = rng();
        const kind: PropKind = kr < 0.5 ? "pine" : kr < 0.75 ? "bush" : "tree";
        add({ kind, x, y, blocks: true, variant: Math.floor(rng() * 3) });
      }
    }

  // ---- 7. Cases de flânerie
  const wanderCells: number[] = [];
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const t = tiles[idx(x, y)];
      if (blocked[idx(x, y)]) continue;
      if (t === T.PATH || t === T.QUAY || (t === T.GRASS && !isEdge(x, y, 2))) wanderCells.push(idx(x, y));
    }

  // blocage terrain
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t === T.VOID || t === T.WATER) blocked[i] = 1;
  }

  const pile = props.find((p) => p.kind === "pile");
  return {
    tiles,
    zoneOf,
    blocked,
    zones,
    zoneIndex,
    props,
    slabs,
    spots,
    deskOf,
    home,
    wanderCells,
    lamps,
    pharePos: PHARE,
    pileCell: pile ? { x: pile.x, y: pile.y } : { x: 0, y: 0 },
  };
}

export function doorCellsOf(z: Zone): { x: number; y: number }[] {
  const midX = z.x + Math.floor(z.w / 2);
  const midY = z.y + Math.floor(z.h / 2);
  switch (z.doorSide) {
    case "y+":
      return [{ x: midX, y: z.y + z.h - 1 }, { x: midX + 1, y: z.y + z.h - 1 }];
    case "y-":
      return [{ x: midX, y: z.y }, { x: midX + 1, y: z.y }];
    case "x-":
      return [{ x: z.x, y: midY - 1 }, { x: z.x, y: midY }];
    case "x+":
      return [{ x: z.x + z.w - 1, y: midY - 1 }, { x: z.x + z.w - 1, y: midY }];
  }
}

/** Projection iso : coin de grille (u, v) → coordonnées monde (px). */
export const TILE_W = 32;
export const TILE_H = 16;
export const ORIGIN_X = GH * (TILE_W / 2);
export const ORIGIN_Y = 40;
export const CLIFF = 64;
export const WORLD_W = (GW + GH) * (TILE_W / 2);
export const WORLD_H = (GW + GH) * (TILE_H / 2) + ORIGIN_Y + CLIFF + 40;

export function iso(u: number, v: number): { x: number; y: number } {
  return { x: ORIGIN_X + (u - v) * (TILE_W / 2), y: ORIGIN_Y + (u + v) * (TILE_H / 2) };
}

/** Centre d'une case en coordonnées monde. */
export function cellCenter(x: number, y: number): { x: number; y: number } {
  return iso(x + 0.5, y + 0.5);
}

/** Coordonnées monde → case de grille. */
export function worldToCell(wx: number, wy: number): { x: number; y: number } {
  const a = (wx - ORIGIN_X) / (TILE_W / 2);
  const b = (wy - ORIGIN_Y) / (TILE_H / 2);
  const u = (a + b) / 2;
  const v = (b - a) / 2;
  return { x: Math.floor(u), y: Math.floor(v) };
}

export function zoneAt(x: number, y: number): Zone | null {
  const l = getLayout();
  if (!inGrid(x, y)) return null;
  const zi = l.zoneOf[idx(x, y)]!;
  return zi >= 0 ? (l.zones[zi] ?? null) : null;
}

export function zoneCenterWorld(z: Zone): { x: number; y: number } {
  return iso(z.x + z.w / 2, z.y + z.h / 2);
}
