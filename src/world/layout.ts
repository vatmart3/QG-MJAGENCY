import { agentsOfPole, allLieux, allPoles, catalogStore } from "@/data/catalog";
import { slotById } from "./slots";
import { hash2, mulberry32 } from "@/lib/rng";
import { styleVille, type StyleVille } from "./theme";

/**
 * Plan de l'île : grille isométrique GW×GH.
 * Axes : +x = bas-droite à l'écran, +y = bas-gauche. La tuile (0,0) est le sommet haut.
 * Le canal suit les lignes y = 29-30 → il traverse l'île en diagonale à l'écran.
 */

export const GW = 78;
export const GH = 78;

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
  | "railing"
  | "house"
  | "treadmill"
  | "weights"
  | "tower";

/** Gratte-ciel (style New York) : variant = style × 1000 + hauteur en px. */
export const TOUR = { verre: 0, deco: 1, brique: 2, fine: 3 } as const;
export const tourVariant = (style: number, hauteur: number) => style * 1000 + Math.round(hauteur);
export const tourDe = (variant: number) => ({ style: Math.floor(variant / 1000), hauteur: variant % 1000 });

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
  /** couleur (toit des maisons = couleur du pôle) */
  color?: string;
}

export interface Spot {
  x: number;
  y: number;
  facing: Facing;
  pose: "sit" | "stand";
  kind: "desk" | "cafe" | "terrasse" | "detente" | "criee" | "douane" | "archives" | "resto" | "lecture" | "sport";
}

/** Maison d'un pôle dans le quartier résidentiel : les agents y rentrent le soir. */
export interface House {
  x: number;
  y: number;
  w: number;
  h: number;
  poleId: string | null;
  color: string;
  door: { x: number; y: number };
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
  houses: House[];
  /** porte de la maison de chaque agent */
  homeOf: Record<string, { x: number; y: number }>;
  /** décor : « newyork » ou « sete » */
  style: StyleVille;
  /** New York : cases d'herbe gardées en pelouse (parcs) ; le reste de l'herbe devient trottoir */
  parc: Uint8Array;
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
const BRIDGES_X = [21, 22, 39, 40, 57, 58];
// rues du quartier résidentiel : 53-54, 60-61, 67-68 (les maisons ont leur porte sur la rue au sud)
export const H_PATHS = [11, 12, 19, 20, 39, 40, 47, 48, 53, 54, 60, 61, 67, 68];
export const V_PATHS = [12, 13, 21, 22, 30, 31, 39, 40, 48, 49, 57, 58];
export const PHARE = { x: 70, y: 6 };
const HOME_ROW = 47;
/** rangées de maisons (haut de la maison) : porte sur la rue juste en dessous */
const HOUSE_ROWS = [50, 57, 64];

let cached: { key: string; layout: Layout } | null = null;

/** Plan de l'île, recalculé quand la structure du catalogue change (pôle ajouté, agent déplacé…) ou le style de la ville. */
export function getLayout(style: StyleVille = styleVille()): Layout {
  const key = `${catalogStore.getState().structure}|${style}`;
  if (cached && cached.key === key) return cached.layout;
  cached = { key, layout: buildLayout(style) };
  return cached.layout;
}

function buildLayout(style: StyleVille): Layout {
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
      const dx = Math.abs(x + 0.5 - cx) / (GW / 2 - 1.4);
      const dy = Math.abs(y + 0.5 - cy) / (GH / 2 - 1.4);
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
  for (let x = 41; x <= PHARE.x - 2; x++) for (const y of [11, 12]) setIf(x, y, T.PATH);
  for (let y = PHARE.y + 1; y <= 12; y++) for (const x of [PHARE.x - 4, PHARE.x - 3]) setIf(x, y, T.PATH);
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
      case "restaurant": {
        // « La Tielle » : comptoir, cuisine, tables pour le déjeuner
        add({ kind: "counter", x: x0 + 1, y: y0 + 1, w: 3, h: 1, blocks: true, zone: z.id });
        add({ kind: "coffee", x: x0 + 1, y: y0 + 1, blocks: false, zone: z.id, zBias: 2 });
        add({ kind: "shelf", x: x0 + 5, y: y0, blocks: false, zone: z.id, variant: 1 });
        const tables: [number, number][] = [[x0 + 2, y0 + 3], [x0 + 5, y0 + 2], [x0 + 5, y0 + 4]];
        for (const [tx, ty] of tables) add({ kind: "roundTable", x: tx, y: ty, blocks: true, zone: z.id });
        const seats: [number, number, Facing][] = [
          [x0 + 1, y0 + 3, "x+"], [x0 + 3, y0 + 3, "x-"], [x0 + 2, y0 + 4, "y-"],
          [x0 + 4, y0 + 2, "x+"], [x0 + 6, y0 + 2, "x-"],
          [x0 + 4, y0 + 4, "x+"], [x0 + 6, y0 + 4, "x-"], [x0 + 5, y0 + 5, "y-"],
        ];
        for (const [sx, sy, f] of seats) {
          add({ kind: "chair", x: sx, y: sy, blocks: false, zone: z.id, facing: f, zBias: -2, variant: 2 });
          spot({ x: sx, y: sy, facing: f, pose: "sit", kind: "resto" });
        }
        add({ kind: "plant", x: x0 + 6, y: y0 + 1, blocks: true, zone: z.id, variant: 1 });
        add({ kind: "plant", x: x0 + 1, y: y0 + 5, blocks: true, zone: z.id, variant: 0 });
        break;
      }
      case "mediatheque": {
        // étagères, postes de lecture et canapés
        for (const sx of [x0 + 1, x0 + 2, x0 + 4, x0 + 5]) add({ kind: "shelf", x: sx, y: y0, blocks: false, zone: z.id, variant: sx % 3 });
        for (const sx of [x0 + 2, x0 + 4]) {
          add({ kind: "desk", x: sx, y: y0 + 3, blocks: true, zone: z.id, variant: 0 });
          add({ kind: "chair", x: sx, y: y0 + 2, blocks: false, zone: z.id, facing: "y+", zBias: -2 });
          spot({ x: sx, y: y0 + 2, facing: "y+", pose: "sit", kind: "lecture" });
        }
        add({ kind: "sofa", x: x0 + 5, y: y0 + 4, blocks: false, zone: z.id, facing: "x-", variant: 1 });
        spot({ x: x0 + 5, y: y0 + 4, facing: "x-", pose: "sit", kind: "lecture" });
        add({ kind: "beanbag", x: x0 + 1, y: y0 + 4, blocks: false, zone: z.id });
        spot({ x: x0 + 1, y: y0 + 4, facing: "x+", pose: "sit", kind: "lecture" });
        add({ kind: "plant", x: x0 + 6, y: y0 + 1, blocks: true, zone: z.id, variant: 2 });
        break;
      }
      case "sport": {
        // tapis de course, haltères, ping-pong
        for (const sx of [x0 + 1, x0 + 3, x0 + 5]) {
          add({ kind: "treadmill", x: sx, y: y0 + 1, blocks: true, zone: z.id });
          spot({ x: sx, y: y0 + 2, facing: "y-", pose: "stand", kind: "sport" });
        }
        add({ kind: "weights", x: x0 + 1, y: y0 + 4, blocks: true, zone: z.id });
        spot({ x: x0 + 2, y: y0 + 4, facing: "x-", pose: "stand", kind: "sport" });
        add({ kind: "pingpong", x: x0 + 4, y: y0 + 4, w: 2, h: 1, blocks: true, zone: z.id });
        spot({ x: x0 + 3, y: y0 + 4, facing: "x+", pose: "stand", kind: "sport" });
        spot({ x: x0 + 6, y: y0 + 4, facing: "x-", pose: "stand", kind: "sport" });
        add({ kind: "plant", x: x0 + 6, y: y0 + 2, blocks: true, zone: z.id, variant: 0 });
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

  // ---- 5 bis. Quartier résidentiel : une maison par pôle (toit à sa couleur), porte sur la rue
  const houses: House[] = [];
  const onVPath = (x: number) => V_PATHS.includes(x);
  for (const hy of HOUSE_ROWS) {
    for (let hx = 2; hx < GW - 4; hx++) {
      const cells: [number, number][] = [];
      for (let yy = hy; yy < hy + 3; yy++) for (let xx = hx; xx < hx + 3; xx++) cells.push([xx, yy]);
      const door = { x: hx + 1, y: hy + 3 };
      const libre = cells.every(([xx, yy]) => inGrid(xx, yy) && tiles[idx(xx, yy)] === T.GRASS && !blocked[idx(xx, yy)] && !onVPath(xx) && !onVPath(xx - 1) && !onVPath(xx + 1));
      if (!libre || !inGrid(door.x, door.y) || tiles[idx(door.x, door.y)] === T.VOID) continue;
      // maisons sans pôle (pour les pôles à venir) : toits de tuile, d'ardoise ou de brique
      houses.push({ x: hx, y: hy, w: 3, h: 3, poleId: null, color: ["#b5573b", "#5d6b7e", "#a0673a", "#8f3f36", "#6b7f5a"][(hx + hy) % 5]!, door });
      for (const [xx, yy] of cells) blocked[idx(xx, yy)] = 1;
      hx += 4; // jardin entre deux maisons
    }
  }
  // attribution : chaque pôle qui a des agents reçoit sa maison (dans l'ordre des pôles)
  const homeOf: Record<string, { x: number; y: number }> = {};
  const habites = allPoles().filter((p) => agentsOfPole(p.id).length);
  habites.forEach((p, i) => {
    const h = houses[i];
    if (!h) return;
    h.poleId = p.id;
    h.color = p.couleur;
    for (const a of agentsOfPole(p.id)) homeOf[a.id] = h.door;
  });
  houses.forEach((h, i) => {
    props.push({ kind: "house", x: h.x, y: h.y, w: 3, h: 3, blocks: true, color: h.color, variant: i % 4 });
    // petit jardin : fleurs et buisson devant certaines maisons
    if (inGrid(h.x + 3, h.y + 2) && tiles[idx(h.x + 3, h.y + 2)] === T.GRASS && !blocked[idx(h.x + 3, h.y + 2)] && i % 2 === 0)
      add({ kind: "flowers", x: h.x + 3, y: h.y + 2, blocks: true, variant: i % 3 });
  });

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
    [56, 10], [56, 18], [56, 38], [47, 46], [56, 46],
    [11, 55], [29, 55], [47, 55], [65, 55], [20, 62], [38, 62], [56, 62], [29, 69], [47, 69],
  ] as [number, number][]) {
    if (tiles[idx(lx, ly)] === T.GRASS && !blocked[idx(lx, ly)]) {
      add({ kind: "lamp", x: lx, y: ly, blocks: true });
      lamps.push({ x: lx, y: ly });
    }
  }
  // garde-corps des ponts
  for (const bx of [21, 39, 57]) {
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

  // ---- 6 bis. New York : gratte-ciel là où ils ne cachent rien d'important
  const parc = new Uint8Array(GW * GH);
  const tourPres = new Uint8Array(GW * GH);
  if (style === "newyork") placerTours(tiles, zoneOf, blocked, houses, add, tourPres, mulberry32(1979));

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
  if (style === "newyork") {
    // pelouses : l'herbe loin des rues et des tours ; le reste est pavé (trottoirs, places)
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (tiles[idx(x, y)] !== T.GRASS || tourPres[idx(x, y)]) continue;
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const t = inGrid(x + dx, y + dy) ? tiles[idx(x + dx, y + dy)] : T.VOID;
            if (t !== T.GRASS || (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && tourPres[idx(x + dx, y + dy)])) {
              ok = false;
              break;
            }
          }
        if (ok) parc[idx(x, y)] = 1;
      }
  }
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (tiles[idx(x, y)] !== T.GRASS || blocked[idx(x, y)]) continue;
      if (nearWalk(x, y)) continue;
      const edge = isEdge(x, y, 1);
      const r = rng();
      if (style === "newyork") {
        // arbres d'automne dans les parcs seulement
        if (parc[idx(x, y)] && r < (edge ? 0.2 : 0.09)) add({ kind: "tree", x, y, blocks: true, variant: Math.floor(rng() * 3) });
        continue;
      }
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
    houses,
    homeOf,
    style,
    parc,
  };
}

/**
 * Gratte-ciel du style New York. Chaque tour prend la plus grande hauteur qui ne cache aucun pôle, aucune maison
 * ni le phare : une case « derrière » la tour à l'écran (même colonne, plus haut) doit rester visible avec ses murs
 * et ses agents. Les grandes tours se retrouvent donc au fond de l'île. Une ruelle d'une case sépare deux tours.
 */
function placerTours(
  tiles: Uint8Array,
  zoneOf: Int16Array,
  blocked: Uint8Array,
  houses: House[],
  add: (p: Prop) => void,
  tourPres: Uint8Array,
  rng: () => number,
): void {
  // colonnes d'écran (x − y) → profondeurs (x + y) des cases à ne pas cacher, triées
  const imp = new Map<number, number[]>();
  const marque = (x: number, y: number) => {
    const c = x - y;
    const l = imp.get(c) ?? [];
    l.push(x + y);
    imp.set(c, l);
  };
  const maison = new Uint8Array(GW * GH);
  for (const h of houses) for (let yy = h.y - 1; yy <= h.y + h.h; yy++) for (let xx = h.x - 1; xx <= h.x + h.w; xx++) if (inGrid(xx, yy)) maison[idx(xx, yy)] = 1;
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const t = tiles[idx(x, y)];
      if (zoneOf[idx(x, y)]! >= 0 || t === T.ROCK || maison[idx(x, y)] || t === T.BRIDGE) marque(x, y);
    }
  for (const l of imp.values()) l.sort((a, b) => a - b);
  /** plus grande profondeur « importante » dans la colonne c, strictement inférieure à d (−∞ si aucune) */
  const derriere = (c: number, d: number) => {
    const l = imp.get(c);
    if (!l) return -Infinity;
    let lo = 0;
    let hi = l.length - 1;
    let best = -Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (l[m]! < d) {
        best = l[m]!;
        lo = m + 1;
      } else hi = m - 1;
    }
    return best;
  };
  const interdit = (t: number | undefined) => t === T.FLOOR || t === T.WOOD || t === T.ROCK || t === T.BRIDGE || t === T.WATER;
  const reserve = new Uint8Array(GW * GH);
  const cands: { x: number; y: number; w: number; h: number; H: number }[] = [];
  for (const [w, h] of [[4, 4], [4, 3], [3, 4], [3, 3], [3, 2], [2, 3], [2, 2]] as [number, number][]) {
    for (let y = 1; y + h < GH - 1; y++)
      for (let x = 1; x + w < GW - 1; x++) {
        let ok = true;
        for (let yy = y - 1; yy <= y + h && ok; yy++)
          for (let xx = x - 1; xx <= x + w; xx++) {
            const i = idx(xx, yy);
            const dedans = xx >= x && xx < x + w && yy >= y && yy < y + h;
            if (dedans ? tiles[i] !== T.GRASS || blocked[i] || maison[i] : interdit(tiles[i]) || maison[i] || zoneOf[i]! >= 0) {
              ok = false;
              break;
            }
          }
        if (!ok) continue;
        // hauteur maximale sans cacher une case importante située derrière
        const front = x + w - 1 + (y + h - 1);
        let H = 236;
        for (let c = x - (y + h - 1) - 1; c <= x + w - 1 - y + 1; c++) {
          const d = derriere(c, front);
          if (d === -Infinity) continue;
          H = Math.min(H, (x + y - d - 1) * 8 - 42);
        }
        if (H >= 46) cands.push({ x, y, w, h, H });
      }
  }
  cands.sort((a, b) => b.H * b.w * b.h - a.H * a.w * a.h);
  for (const c of cands) {
    let libre = true;
    for (let yy = c.y - 1; yy <= c.y + c.h && libre; yy++) for (let xx = c.x - 1; xx <= c.x + c.w; xx++) if (reserve[idx(xx, yy)]) libre = false;
    if (!libre) continue;
    for (let yy = c.y; yy < c.y + c.h; yy++) for (let xx = c.x; xx < c.x + c.w; xx++) if (blocked[idx(xx, yy)]) libre = false;
    if (!libre) continue;
    const H = Math.round(Math.min(c.H, 70 + rng() * 170));
    const r = rng();
    const st = H >= 150 ? (r < 0.45 ? TOUR.verre : r < 0.75 ? TOUR.deco : TOUR.fine) : H >= 90 ? (r < 0.5 ? TOUR.verre : r < 0.75 ? TOUR.deco : TOUR.brique) : TOUR.brique;
    const hh = st === TOUR.brique ? Math.min(H, 52 + Math.round(rng() * 40)) : H;
    add({ kind: "tower", x: c.x, y: c.y, w: c.w, h: c.h, blocks: true, variant: tourVariant(st, hh) });
    for (let yy = c.y - 1; yy <= c.y + c.h; yy++) for (let xx = c.x - 1; xx <= c.x + c.w; xx++) if (inGrid(xx, yy)) reserve[idx(xx, yy)] = 1;
    for (let yy = c.y; yy < c.y + c.h; yy++) for (let xx = c.x; xx < c.x + c.w; xx++) tourPres[idx(xx, yy)] = 1;
  }
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
