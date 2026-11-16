import * as THREE from "three";
import { mulberry32 } from "@/lib/rng";
import { Lot, nuance } from "./geo";
import { HAUTEUR, type Meuble, type Mur, type Plan } from "./plan";

/**
 * Le décor du bureau : sols, murs (pleins, extérieurs à fenêtres, cloisons vitrées), plafond (visite à pied),
 * mobilier et jardin autour du bâtiment. Tout est fusionné en quelques maillages.
 */

const MUR = "#efe6d6";
const MUR_EXT = "#e9dfcd";
const PLINTHE = "#cdbfa8";
const CADRE = "#2b2e38";
const BOIS = "#c89a62";
const BOIS_F = "#8a5a33";
const BOIS_C = "#e2bd8a";
const BLANC = "#f6f3ec";
const METAL = "#9aa3b5";
const SOMBRE = "#2f3340";
const FEUILLE = ["#4f9d4a", "#3f8a4a", "#62b05a"];

export interface Decor {
  /** tout ce qui est toujours visible */
  fixe: THREE.Group;
  /** plafond et luminaires : seulement pendant la visite à pied */
  plafond: THREE.Group;
  /** matériau du jardin : teinté selon l'heure (la nuit tombe dehors, l'intérieur reste éclairé) */
  jardin: THREE.MeshLambertMaterial;
  /** écrans géants (hall, salle de réunion) : rectangle où poser une texture en direct */
  ecrans: { x: number; z: number; angle: number; w: number; h: number; y: number; role: "infos" | "pubs" }[];
  /** table de la Douane : là où s'empilent les colis en attente */
  pile: { x: number; z: number } | null;
  materiaux: THREE.Material[];
}

export function construireDecor(plan: Plan): Decor {
  const opaque = new Lot();
  const verre = new Lot();
  const lumiere = new Lot();
  const toit = new Lot();
  const lampes = new Lot();
  const dehors = new Lot();
  const ecrans: Decor["ecrans"] = [];
  let pile: Decor["pile"] = null;
  const r = mulberry32(2026);

  // ---------------------------------------------------------------- sols
  opaque.repere(0, 0);
  // dalle du bâtiment et parquet des couloirs
  opaque.boite(plan.W / 2, -0.15, plan.D / 2, plan.W + 0.6, 0.3, plan.D + 0.6, "#b9ab95");
  for (const c of plan.couloirs) {
    opaque.boite((c.x0 + c.x1) / 2, 0.005, (c.z0 + c.z1) / 2, c.x1 - c.x0, 0.03, c.z1 - c.z0, c.nom === "La rue des pôles" ? "#d7a86a" : "#dcb57e");
  }
  // lames de parquet de la rue (un ton sur deux)
  const rue = plan.couloirs[0]!;
  for (let x = 0.6; x < plan.W; x += 1.2) opaque.boite(x, 0.022, (rue.z0 + rue.z1) / 2, 0.6, 0.004, rue.z1 - rue.z0 - 0.3, "#cf9d5e");
  for (const p of plan.pieces) {
    opaque.boite((p.x0 + p.x1) / 2, 0.01, (p.z0 + p.z1) / 2, p.x1 - p.x0, 0.04, p.z1 - p.z0, p.sol);
  }

  // ---------------------------------------------------------------- murs
  for (const w of plan.murs) dessinerMur(w, opaque, verre);

  // ---------------------------------------------------------------- mobilier
  for (const f of plan.meubles) {
    opaque.repere(f.x, f.z, f.angle);
    verre.repere(f.x, f.z, f.angle);
    lumiere.repere(f.x, f.z, f.angle);
    dessinerMeuble(f, opaque, verre, lumiere, r);
    if (f.type === "ecran") ecrans.push({ x: f.x, z: f.z, angle: f.angle, w: f.w - 0.16, h: f.variante === 2 ? 1.5 : 1.25, y: 1.75, role: f.variante === 2 ? "infos" : "pubs" });
    if (f.type === "colis") pile = { x: f.x, z: f.z };
  }

  // ---------------------------------------------------------------- jardin
  dehors.repere(0, 0);
  const cx = plan.W / 2;
  const cz = plan.D / 2;
  dehors.boite(cx, -0.32, cz, 420, 0.3, 420, "#8fc46e");
  // parvis et allée devant l'entrée
  dehors.boite(plan.entree.x, -0.16, plan.D + 7, 9, 0.02, 14, "#d8cdb9");
  dehors.boite(plan.entree.x, -0.155, plan.D + 30, 4, 0.02, 34, "#cfc4b0");
  // chemin autour du bâtiment
  dehors.boite(cx, -0.165, -2.2, plan.W + 9, 0.01, 2.4, "#cfc4b0");
  dehors.boite(cx, -0.165, plan.D + 2.2, plan.W + 9, 0.01, 2.4, "#cfc4b0");
  dehors.boite(-2.2, -0.165, cz, 2.4, 0.01, plan.D + 6.8, "#cfc4b0");
  dehors.boite(plan.W + 2.2, -0.165, cz, 2.4, 0.01, plan.D + 6.8, "#cfc4b0");
  // arbres, haies et bacs potagers
  const arbre = (x: number, z: number, s: number, sapin: boolean) => {
    dehors.repere(x, z, r() * 6);
    dehors.cylindre(0, -0.17, 0, 0.22 * s, 1.6 * s, "#7a5236", 6, 0.16 * s);
    if (sapin) {
      for (let i = 0; i < 3; i++) dehors.cylindre(0, (1.1 + i * 1.25) * s, 0, (1.7 - i * 0.42) * s, 1.9 * s, i % 2 ? "#3d8a52" : "#357a4c", 7, 0);
    } else {
      const c = FEUILLE[Math.floor(r() * 3)]!;
      dehors.bloc(0, 2.9 * s, 0, 1.7 * s, 1.5 * s, 1.7 * s, c);
      dehors.bloc(0.9 * s, 2.3 * s, 0.4 * s, 1.1 * s, 1 * s, 1.1 * s, nuance(c, -0.08));
      dehors.bloc(-0.8 * s, 2.4 * s, -0.5 * s, 1.2 * s, 1 * s, 1.2 * s, nuance(c, 0.08));
    }
  };
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2;
    const d = 14 + r() * 70;
    const x = cx + Math.cos(a) * (plan.W / 2 + d);
    const z = cz + Math.sin(a) * (plan.D / 2 + d);
    // pas sur l'allée d'entrée
    if (Math.abs(x - plan.entree.x) < 5 && z > plan.D) continue;
    arbre(x, z, 0.9 + r() * 0.9, r() < 0.55);
  }
  dehors.repere(0, 0);
  for (let x = 3; x < plan.W - 2; x += 6.5) {
    if (Math.abs(x - plan.entree.x) < 6) continue;
    // haie devant la façade sud, bacs potagers au nord
    dehors.boite(x, 0.3, plan.D + 4.6, 4.6, 0.9, 0.9, "#4f9d4a");
    dehors.boite(x, 0.05, -5.2, 3.2, 0.45, 1.3, BOIS_F);
    dehors.boite(x, 0.3, -5.2, 2.9, 0.1, 1, "#5a3f2a");
    for (let k = 0; k < 5; k++) dehors.bloc(x - 1.2 + k * 0.6, 0.48, -5.2 + (r() - 0.5) * 0.5, 0.2, 0.22, 0.2, r() < 0.3 ? "#e0564a" : "#62b05a");
  }
  // enseigne au-dessus de l'entrée
  opaque.boite(plan.entree.x, HAUTEUR + 0.55, plan.D + 0.25, 5.2, 0.9, 0.3, "#1f2438");
  lumiere.repere(0, 0);
  lumiere.boite(plan.entree.x, HAUTEUR + 0.55, plan.D + 0.42, 4.6, 0.12, 0.04, "#ffd34d");

  // ---------------------------------------------------------------- plafond (visite à pied)
  toit.repere(0, 0);
  toit.boite(cx, HAUTEUR + 0.12, cz, plan.W + 0.4, 0.2, plan.D + 0.4, "#f1ece2");
  // lattes de bois sous le plafond des couloirs, dalles lumineuses
  lampes.repere(0, 0);
  for (const c of plan.couloirs) {
    const long = c.x1 - c.x0 > c.z1 - c.z0;
    const L = long ? c.x1 - c.x0 : c.z1 - c.z0;
    const l = long ? c.z1 - c.z0 : c.x1 - c.x0;
    const mx = (c.x0 + c.x1) / 2;
    const mz = (c.z0 + c.z1) / 2;
    toit.boite(mx, HAUTEUR - 0.02, mz, c.x1 - c.x0 - 0.3, 0.04, c.z1 - c.z0 - 0.3, "#8a5a33");
    for (let a = 0.3; a < L; a += 0.5) {
      if (long) toit.boite(c.x0 + a, HAUTEUR - 0.1, mz, 0.22, 0.14, l - 0.4, a % 1 < 0.5 ? "#c98f52" : "#b9803f");
      else toit.boite(mx, HAUTEUR - 0.1, c.z0 + a, l - 0.4, 0.14, 0.22, a % 1 < 0.5 ? "#c98f52" : "#b9803f");
    }
    for (let a = 2.5; a < L - 1; a += 5) {
      if (long) lampes.boite(c.x0 + a, HAUTEUR - 0.2, mz, 1.6, 0.05, 0.28, "#fff6e0");
      else lampes.boite(mx, HAUTEUR - 0.2, c.z0 + a, 0.28, 0.05, 1.6, "#fff6e0");
    }
  }
  for (const p of plan.pieces) {
    const mx = (p.x0 + p.x1) / 2;
    const mz = (p.z0 + p.z1) / 2;
    for (const dx of [-2.4, 2.4]) for (const dz of [-1.8, 1.8]) lampes.boite(mx + dx, HAUTEUR + 0.005, mz + dz, 1.3, 0.03, 0.6, "#fffaf0");
    // bandeau à la couleur du pôle en haut des murs
    toit.boite(mx, HAUTEUR - 0.06, mz, p.x1 - p.x0 - 0.5, 0.02, p.z1 - p.z0 - 0.5, nuance(p.sol, 0.5));
  }

  const matOpaque = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matVerre = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const matLumiere = new THREE.MeshBasicMaterial({ vertexColors: true });
  const matToit = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matJardin = new THREE.MeshLambertMaterial({ vertexColors: true });
  const fixe = new THREE.Group();
  fixe.add(opaque.maillage(matOpaque));
  fixe.add(dehors.maillage(matJardin));
  const v = verre.maillage(matVerre, { ombre: false, recoit: false });
  v.renderOrder = 2;
  fixe.add(v);
  if (!lumiere.vide) fixe.add(lumiere.maillage(matLumiere, { ombre: false, recoit: false }));
  const plafond = new THREE.Group();
  plafond.add(toit.maillage(matToit, { ombre: false, recoit: false }));
  plafond.add(lampes.maillage(matLumiere, { ombre: false, recoit: false }));
  plafond.visible = false;
  return { fixe, plafond, jardin: matJardin, ecrans, pile, materiaux: [matOpaque, matVerre, matLumiere, matToit, matJardin] };
}

// ------------------------------------------------------------------ murs
function dessinerMur(w: Mur, o: Lot, verre: Lot): void {
  const trous = [...w.trous].sort((a, b) => a[0] - b[0]);
  // boîte le long du mur : a = position le long de l'axe, de y0 à y1, épaisseur e
  const seg = (lot: Lot, a0: number, a1: number, y0: number, y1: number, e: number, teinte: THREE.ColorRepresentation, decal = 0) => {
    if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
    const m = (a0 + a1) / 2;
    if (w.axe === "x") lot.boite(m, (y0 + y1) / 2, w.c + decal, a1 - a0, y1 - y0, e, teinte);
    else lot.boite(w.c + decal, (y0 + y1) / 2, m, e, y1 - y0, a1 - a0, teinte);
  };
  o.repere(0, 0);
  verre.repere(0, 0);
  const pleins: [number, number][] = [];
  let a = w.a0;
  for (const [t0, t1] of trous) {
    if (t0 > a) pleins.push([a, t0]);
    a = Math.max(a, t1);
  }
  if (a < w.a1) pleins.push([a, w.a1]);

  if (w.type === "plein") {
    for (const [s0, s1] of pleins) {
      seg(o, s0, s1, 0, HAUTEUR, 0.2, MUR);
      seg(o, s0, s1, 0, 0.12, 0.24, PLINTHE);
    }
    for (const [t0, t1] of trous) {
      // linteau et montants de porte
      seg(o, t0, t1, 2.25, HAUTEUR, 0.2, MUR);
      seg(o, t0 - 0.06, t0 + 0.04, 0, 2.25, 0.26, BOIS_F);
      seg(o, t1 - 0.04, t1 + 0.06, 0, 2.25, 0.26, BOIS_F);
      seg(o, t0, t1, 2.19, 2.27, 0.26, BOIS_F);
    }
    return;
  }
  if (w.type === "verre" || w.type === "baie") {
    const ext = w.type === "baie";
    const e = ext ? 0.3 : 0.12;
    for (const [s0, s1] of pleins) {
      seg(o, s0, s1, 0, ext ? 0.25 : 0.1, e, ext ? MUR_EXT : CADRE);
      seg(o, s0, s1, 2.62, HAUTEUR, e, ext ? MUR_EXT : CADRE);
      seg(verre, s0, s1, ext ? 0.25 : 0.1, 2.62, 0.04, "#bfe3f2");
      // montants
      const n = Math.max(1, Math.round((s1 - s0) / 1.25));
      for (let i = 0; i <= n; i++) {
        const p = s0 + ((s1 - s0) * i) / n;
        seg(o, p - 0.03, p + 0.03, 0, 2.62, e, CADRE);
      }
      seg(o, s0, s1, 1.3, 1.34, 0.06, CADRE);
    }
    for (const [t0, t1] of trous) {
      seg(o, t0, t1, 2.25, HAUTEUR, e, CADRE);
      seg(o, t0 - 0.05, t0 + 0.03, 0, 2.25, e + 0.04, CADRE);
      seg(o, t1 - 0.03, t1 + 0.05, 0, 2.25, e + 0.04, CADRE);
    }
    return;
  }
  // mur extérieur : allège, fenêtres, linteau
  for (const [s0, s1] of pleins) {
    seg(o, s0, s1, 0, 0.95, 0.3, MUR_EXT);
    seg(o, s0, s1, 2.35, HAUTEUR, 0.3, MUR_EXT);
    seg(o, s0, s1, 0, 0.12, 0.34, PLINTHE);
    const n = Math.max(1, Math.round((s1 - s0) / 2.5));
    const pas = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const b0 = s0 + i * pas;
      // trumeau puis fenêtre
      seg(o, b0, b0 + 0.45, 0.95, 2.35, 0.3, MUR_EXT);
      seg(o, b0 + pas - 0.45, b0 + pas, 0.95, 2.35, 0.3, MUR_EXT);
      seg(verre, b0 + 0.45, b0 + pas - 0.45, 0.95, 2.35, 0.05, "#bfe3f2");
      seg(o, b0 + 0.45, b0 + pas - 0.45, 0.93, 0.99, 0.36, BLANC);
      seg(o, b0 + pas / 2 - 0.03, b0 + pas / 2 + 0.03, 0.95, 2.35, 0.08, CADRE);
    }
  }
}

// ------------------------------------------------------------------ mobilier
function dessinerMeuble(f: Meuble, o: Lot, verre: Lot, lum: Lot, r: () => number): void {
  const v = f.variante ?? 0;
  const teinte = f.couleur ?? "#8a8fa3";
  switch (f.type) {
    case "tapis":
      o.boite(0, 0.04, 0, f.w, 0.02, f.d, nuance(teinte, 0.55));
      o.boite(0, 0.045, 0, f.w - 0.5, 0.02, f.d - 0.5, nuance(teinte, 0.7));
      break;
    case "bureau": {
      // plateau, piètement, écran ; la personne s'assoit côté +z
      const plateau = v === 1 ? BOIS : v === 2 ? BOIS_C : BLANC;
      o.boite(0, 0.73, 0, f.w, 0.05, f.d, plateau);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.06), 0.36, 0, 0.05, 0.72, f.d - 0.1, SOMBRE);
      o.boite(0, 0.5, -f.d / 2 + 0.03, f.w - 0.14, 0.4, 0.03, nuance(teinte, 0.35));
      // écran et clavier
      o.boite(0, 0.79, -0.12, 0.2, 0.03, 0.14, SOMBRE);
      o.boite(0, 0.87, -0.14, 0.04, 0.14, 0.04, SOMBRE);
      o.boite(0, 1.08, -0.14, 0.62, 0.38, 0.035, "#23262f");
      o.boite(0, 1.08, -0.119, 0.56, 0.32, 0.01, "#3b465c");
      o.boite(0, 0.765, 0.16, 0.4, 0.02, 0.13, "#d9dbe2");
      o.boite(0.36, 0.765, 0.16, 0.06, 0.02, 0.1, "#d9dbe2");
      if (r() < 0.5) o.cylindre(-0.5, 0.755, 0.05, 0.045, 0.1, ["#e2574c", "#3a7bd5", "#e8b100"][Math.floor(r() * 3)]!, 8);
      else o.boite(-0.48, 0.78, 0.0, 0.22, 0.05, 0.3, ["#e04f9a", "#2e9d62", "#f08a24"][Math.floor(r() * 3)]!, 0.2);
      break;
    }
    case "chaise": {
      const tissu = v === 1 ? "#c8693c" : "#3d4157";
      o.cylindre(0, 0.02, 0, 0.26, 0.04, SOMBRE, 5);
      o.cylindre(0, 0.04, 0, 0.035, 0.38, METAL, 6);
      o.boite(0, 0.45, 0, 0.46, 0.07, 0.46, tissu);
      o.boite(0, 0.78, -0.21, 0.44, 0.5, 0.06, nuance(tissu, 0.08));
      break;
    }
    case "plante": {
      const h = [0.9, 1.3, 1.7][v % 3]!;
      o.cylindre(0, 0, 0, 0.2, 0.42, v === 2 ? "#a03a2e" : "#c8693c", 8, 0.26);
      o.cylindre(0, 0.42, 0, 0.03, h * 0.5, "#5a3d2a", 5);
      const c = FEUILLE[v % 3]!;
      o.bloc(0, 0.42 + h * 0.62, 0, 0.42, h * 0.36, 0.42, c, false, r() * 3);
      o.bloc(0.2, 0.42 + h * 0.4, 0.12, 0.28, h * 0.22, 0.28, nuance(c, 0.12), false, r() * 3);
      o.bloc(-0.2, 0.42 + h * 0.5, -0.1, 0.26, h * 0.2, 0.26, nuance(c, -0.1), false, r() * 3);
      break;
    }
    case "etagere": {
      o.boite(0, 1, 0, f.w, 2, f.d, v === 2 ? BOIS_F : BOIS);
      const livres = ["#e2574c", "#3a7bd5", "#e8b100", "#2e9d62", "#8b5cf6", "#f08a24", "#f6f3ec", "#1f9aa8"];
      for (let k = 0; k < 4; k++) {
        o.boite(0, 0.3 + k * 0.48, 0.02, f.w - 0.1, 0.38, f.d - 0.02, nuance(BOIS_F, -0.25));
        let x = -f.w / 2 + 0.1;
        while (x < f.w / 2 - 0.16) {
          const l = 0.05 + r() * 0.07;
          const h = 0.24 + r() * 0.12;
          if (r() < 0.85) o.boite(x + l / 2, 0.12 + k * 0.48 + h / 2, 0.05, l, h, f.d - 0.14, livres[Math.floor(r() * livres.length)]!);
          x += l + 0.006;
        }
      }
      break;
    }
    case "tableau":
      o.boite(0, 1.6, 0, f.w, 1.2, 0.05, "#d9d4c8");
      o.boite(0, 1.6, 0.03, f.w - 0.12, 1.08, 0.02, "#ffffff");
      for (let k = 0; k < 5; k++) o.boite(-f.w / 2 + 0.3 + r() * (f.w - 0.9), 1.25 + k * 0.17, 0.045, 0.3 + r() * 0.6, 0.03, 0.005, ["#e2574c", "#3a7bd5", "#2e9d62", "#2a2140"][k % 4]!);
      o.boite(f.w / 2 - 0.35, 1.9, 0.045, 0.24, 0.24, 0.006, "#ffe27a");
      o.boite(f.w / 2 - 0.35, 1.6, 0.045, 0.24, 0.24, 0.006, "#ffb3d1");
      break;
    case "imprimante":
      o.boite(0, 0.3, 0, f.w, 0.6, f.d, "#d9dbe2");
      o.boite(0, 0.72, 0, f.w - 0.04, 0.24, f.d - 0.04, "#eef0f4");
      o.boite(0, 0.86, 0.1, f.w - 0.2, 0.02, 0.3, "#ffffff");
      o.boite(0.2, 0.845, -0.18, 0.16, 0.012, 0.08, "#3ac27a");
      break;
    case "canape": {
      const c = teinte;
      o.boite(0, 0.24, 0.02, f.w, 0.3, f.d, nuance(c, -0.12));
      o.boite(0, 0.46, 0.08, f.w - 0.3, 0.16, f.d - 0.18, nuance(c, 0.1));
      o.boite(0, 0.62, -f.d / 2 + 0.11, f.w, 0.62, 0.22, c);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.09), 0.44, 0.02, 0.18, 0.5, f.d, c);
      o.boite(-f.w / 4, 0.62, -0.1, 0.36, 0.3, 0.12, nuance(c, 0.35), 0.15, -0.3);
      break;
    }
    case "pouf":
      o.bloc(0, 0.28, 0, 0.44, 0.3, 0.44, teinte, true);
      break;
    case "grandeTable":
      o.boite(0, 0.74, 0, f.w, 0.06, f.d, BOIS);
      o.boite(0, 0.7, 0, f.w - 0.3, 0.04, f.d - 0.3, BOIS_F);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.5), 0.35, 0, 0.12, 0.7, f.d - 0.5, SOMBRE);
      o.boite(0, 0.79, 0, 0.5, 0.03, 0.3, "#23262f");
      break;
    case "ecran":
      // cadre noir au mur ; l'image en direct est posée par-dessus
      o.boite(0, 1.75, 0, f.w, (v === 2 ? 1.5 : 1.25) + 0.16, 0.08, "#15171d");
      break;
    case "comptoir":
      o.boite(0, 0.5, 0, f.w, 1, f.d, nuance(teinte, -0.1));
      o.boite(0, 1.03, 0, f.w + 0.1, 0.06, f.d + 0.1, BOIS_C);
      for (let x = -f.w / 2 + 0.4; x < f.w / 2 - 0.2; x += 0.5) o.boite(x, 0.5, f.d / 2 + 0.005, 0.03, 0.9, 0.01, nuance(teinte, -0.3));
      o.cylindre(f.w / 2 - 0.5, 1.06, 0, 0.14, 0.03, BLANC, 8);
      o.bloc(f.w / 2 - 0.5, 1.13, 0, 0.1, 0.06, 0.1, "#e8b100");
      break;
    case "machineCafe":
      o.boite(0, 1.26, 0, 0.42, 0.4, 0.38, "#3d4157");
      o.boite(0, 1.5, 0, 0.44, 0.06, 0.4, "#c0392b");
      o.boite(0, 1.12, 0.14, 0.3, 0.02, 0.14, METAL);
      o.cylindre(0, 1.13, 0.14, 0.04, 0.07, BLANC, 6);
      break;
    case "frigo":
      o.boite(0, 0.95, 0, f.w, 1.9, f.d, "#e6e9ef");
      o.boite(0, 1.2, f.d / 2 + 0.005, f.w - 0.06, 0.02, 0.01, METAL);
      o.boite(f.w / 2 - 0.1, 1.5, f.d / 2 + 0.02, 0.03, 0.4, 0.03, METAL);
      break;
    case "tableRonde": {
      const bois = v === 1 ? BLANC : v === 2 ? BOIS_F : BOIS_C;
      o.cylindre(0, 0.72, 0, f.w / 2, 0.05, bois, 14);
      o.cylindre(0, 0.03, 0, 0.06, 0.7, SOMBRE, 6);
      o.cylindre(0, 0, 0, 0.3, 0.03, SOMBRE, 10);
      if (v === 1) {
        o.cylindre(0.15, 0.77, 0.05, 0.11, 0.015, BLANC, 8);
        o.cylindre(-0.2, 0.77, -0.1, 0.035, 0.09, "#c8553d", 6);
      }
      break;
    }
    case "tampon":
      // comptoir de la Douane : guichet, tampon, bannette
      o.boite(0, 0.5, 0, f.w, 1, f.d, "#c0392b");
      o.boite(0, 1.03, 0, f.w + 0.1, 0.06, f.d + 0.1, BOIS_C);
      o.boite(0, 0.5, f.d / 2 + 0.005, f.w - 0.3, 0.5, 0.01, BLANC);
      o.cylindre(-0.5, 1.06, 0, 0.06, 0.12, BOIS_F, 6);
      o.cylindre(-0.5, 1.18, 0, 0.03, 0.08, SOMBRE, 6);
      o.boite(0.5, 1.09, 0, 0.36, 0.06, 0.28, "#3d4157");
      o.boite(0.5, 1.125, 0, 0.3, 0.012, 0.22, "#ffffff");
      break;
    case "colis":
      // table basse où s'empilent les colis à valider (ajoutés en direct)
      o.boite(0, 0.2, 0, f.w, 0.4, f.d, BOIS_F);
      o.boite(0, 0.42, 0, f.w + 0.06, 0.04, f.d + 0.06, BOIS);
      break;
    case "caisse":
      o.boite(0, 0.3, 0, 0.6, 0.6, 0.6, v ? "#b98a52" : "#c99b62");
      o.boite(0, 0.3, 0, 0.62, 0.08, 0.62, "#e8d9b8");
      if (v) o.boite(0.05, 0.78, 0.03, 0.42, 0.36, 0.42, "#c99b62", 0.5);
      break;
    case "archive": {
      const gris = ["#8f96a8", "#7d8a7a", "#9a8f7d"][v % 3]!;
      o.boite(0, 0.95, 0, f.w, 1.9, f.d, gris);
      const n = Math.round(f.w / 0.8);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 4; k++) {
          const x = -f.w / 2 + (i + 0.5) * (f.w / n);
          o.boite(x, 0.28 + k * 0.45, f.d / 2 + 0.005, f.w / n - 0.06, 0.38, 0.012, nuance(gris, 0.18));
          o.boite(x, 0.34 + k * 0.45, f.d / 2 + 0.02, 0.16, 0.03, 0.02, SOMBRE);
        }
      break;
    }
    case "babyfoot":
      o.boite(0, 0.8, 0, f.w, 0.26, f.d, "#2e7d4f");
      o.boite(0, 0.92, 0, f.w - 0.1, 0.02, f.d - 0.1, "#3fae6a");
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.boite(sx * (f.w / 2 - 0.08), 0.34, sz * (f.d / 2 - 0.08), 0.08, 0.68, 0.08, BOIS_F);
      for (let i = 0; i < 4; i++) {
        const x = -f.w / 2 + 0.25 + i * ((f.w - 0.5) / 3);
        o.boite(x, 0.98, 0, 0.02, 0.02, f.d + 0.5, METAL);
        o.boite(x, 0.95, -0.15, 0.05, 0.12, 0.04, i % 2 ? "#e2574c" : "#3a7bd5");
        o.boite(x, 0.95, 0.15, 0.05, 0.12, 0.04, i % 2 ? "#e2574c" : "#3a7bd5");
      }
      break;
    case "pingpong":
      o.boite(0, 0.76, 0, f.w, 0.05, f.d, "#2f6fb5");
      o.boite(0, 0.79, 0, f.w, 0.004, 0.03, BLANC);
      o.boite(0, 0.86, 0, 0.02, 0.16, f.d + 0.1, BLANC);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.4), 0.37, 0, 0.06, 0.74, f.d - 0.3, SOMBRE);
      break;
    case "tapisCourse":
      o.boite(0, 0.12, 0, f.w, 0.16, f.d, SOMBRE);
      o.boite(0, 0.21, 0, f.w - 0.16, 0.02, f.d - 0.2, "#15171d");
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.05), 0.7, -f.d / 2 + 0.25, 0.05, 1.1, 0.05, METAL, 0, 0.2);
      o.boite(0, 1.25, -f.d / 2 + 0.14, f.w, 0.22, 0.08, "#3d4157", 0, 0.5);
      lum.boite(0, 1.26, -f.d / 2 + 0.185, f.w - 0.3, 0.12, 0.01, "#7fe0ff", 0, 0.5);
      break;
    case "halteres":
      o.boite(0, 0.3, 0, f.w, 0.06, f.d, SOMBRE);
      o.boite(0, 0.6, -0.1, f.w, 0.06, f.d - 0.2, SOMBRE);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.05), 0.35, 0, 0.06, 0.7, f.d, METAL);
      for (let i = 0; i < 4; i++) {
        const x = -f.w / 2 + 0.25 + i * 0.3;
        for (const y of [0.4, 0.7]) {
          o.cylindre(x, y - 0.07, y > 0.5 ? -0.1 : 0, 0.07, 0.14, ["#e2574c", "#3a7bd5", "#e8b100", "#2e9d62"][i]!, 6);
        }
      }
      break;
    case "accueil":
      // banque d'accueil : façade à la couleur de l'agence, plateau bois
      o.boite(0, 0.55, 0.2, f.w, 1.1, 0.5, nuance(teinte, -0.05));
      o.boite(0, 1.13, 0.2, f.w + 0.1, 0.06, 0.6, BOIS_C);
      o.boite(0, 0.38, -0.2, f.w - 0.2, 0.76, 0.4, BOIS);
      lum.boite(0, 0.62, 0.455, f.w - 0.6, 0.06, 0.01, "#ffd34d");
      o.boite(-0.7, 0.98, -0.2, 0.5, 0.34, 0.04, "#23262f");
      o.cylindre(f.w / 2 - 0.5, 1.16, 0.2, 0.1, 0.16, BLANC, 8);
      o.bloc(f.w / 2 - 0.5, 1.45, 0.2, 0.2, 0.18, 0.2, "#62b05a");
      break;
    case "serveur": {
      o.boite(0, 1, 0, f.w, 2, f.d, "#23262f");
      o.boite(0, 1, f.d / 2 + 0.005, f.w - 0.12, 1.8, 0.01, "#3b465c");
      for (let k = 0; k < 9; k++) {
        const y = 0.25 + k * 0.19;
        o.boite(0, y, f.d / 2 + 0.012, f.w - 0.2, 0.13, 0.01, "#15171d");
        for (let i = 0; i < 4; i++) if (r() < 0.75) lum.boite(-f.w / 2 + 0.18 + i * 0.07, y, f.d / 2 + 0.02, 0.025, 0.025, 0.01, r() < 0.7 ? "#3ff08a" : r() < 0.5 ? "#3fb8ff" : "#ffb23f");
      }
      break;
    }
    case "arbre": {
      // arbre d'intérieur dans un grand bac
      o.boite(0, 0.25, 0, 0.9, 0.5, 0.9, BOIS_F);
      o.boite(0, 0.5, 0, 0.8, 0.04, 0.8, "#5a3f2a");
      o.cylindre(0, 0.5, 0, 0.09, 1.3, "#7a5236", 6, 0.06);
      const c = FEUILLE[v % 3]!;
      o.bloc(0, 2.2, 0, 0.85, 0.7, 0.85, c, false, r() * 3);
      o.bloc(0.4, 1.85, 0.2, 0.5, 0.42, 0.5, nuance(c, 0.1), false, r() * 3);
      o.bloc(-0.35, 1.9, -0.25, 0.55, 0.45, 0.55, nuance(c, -0.1), false, r() * 3);
      break;
    }
    case "banc":
      o.boite(0, 0.42, 0, f.w, 0.07, f.d, BOIS);
      for (const sx of [-1, 1]) o.boite(sx * (f.w / 2 - 0.15), 0.2, 0, 0.08, 0.4, f.d - 0.08, SOMBRE);
      break;
    case "micro":
      o.cylindre(0, 0.77, 0, 0.07, 0.02, SOMBRE, 8);
      o.cylindre(0, 0.79, 0, 0.012, 0.3, METAL, 5);
      o.bloc(0, 1.12, 0, 0.045, 0.07, 0.045, "#23262f", true);
      break;
    case "lampe":
      o.cylindre(0, 0, 0, 0.16, 0.03, SOMBRE, 8);
      o.cylindre(0, 0.03, 0, 0.018, 1.5, METAL, 5);
      lum.cylindre(0, 1.45, 0, 0.2, 0.3, "#ffe7a3", 8, 0.12);
      break;
    case "tabouret":
      o.cylindre(0, 0.6, 0, 0.18, 0.05, BOIS, 8);
      o.cylindre(0, 0, 0, 0.03, 0.6, METAL, 5);
      break;
  }
  void verre;
}
