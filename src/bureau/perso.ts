import * as THREE from "three";
import { appearanceOf } from "@/world/sprites/characters";

/**
 * Personnage low-poly d'un agent (1,70 m) : mêmes couleurs que son portrait (peau, cheveux, haut à la couleur
 * du pôle). Articulé aux épaules, aux hanches et aux genoux : marche, assis, tape au clavier, parle, fête, dort.
 */

export type Pose3 = "stand" | "walk" | "sit" | "type" | "talk" | "drink" | "sleep" | "cheer" | "carry";

const geoBoite = new THREE.BoxGeometry(1, 1, 1);
const materiaux = new Map<string, THREE.MeshLambertMaterial>();
const mat = (hex: string): THREE.MeshLambertMaterial => {
  let m = materiaux.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    materiaux.set(hex, m);
  }
  return m;
};
const hexDe = (rgba: number) => `#${(rgba >>> 8).toString(16).padStart(6, "0")}`;
const PANTALONS = ["#2f3a55", "#3a3f4c", "#5b4a3e", "#1f2a3a", "#6b7280", "#3d4a66"];

function boite(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, couleur: string): THREE.Mesh {
  const m = new THREE.Mesh(geoBoite, mat(couleur));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Perso {
  readonly racine = new THREE.Group();
  private corps = new THREE.Group();
  private tete = new THREE.Group();
  private bras: [THREE.Group, THREE.Group];
  private hanches: [THREE.Group, THREE.Group];
  private genoux: [THREE.Group, THREE.Group];
  private colis: THREE.Mesh;
  private t = Math.random() * 10;
  pose: Pose3 = "stand";

  constructor(agentId: string) {
    const ap = appearanceOf(agentId);
    const peau = hexDe(ap.skin);
    const cheveux = hexDe(ap.hair);
    const haut = hexDe(ap.shirt);
    let h = 0;
    for (const c of agentId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pantalon = PANTALONS[h % PANTALONS.length]!;
    this.racine.add(this.corps);

    // torse et cou
    boite(this.corps, 0.4, 0.52, 0.23, 0, 1.06, 0, haut);
    boite(this.corps, 0.42, 0.1, 0.24, 0, 0.83, 0, pantalon);
    boite(this.corps, 0.12, 0.08, 0.12, 0, 1.35, 0, peau);

    // tête : visage vers +z
    this.tete.position.set(0, 1.39, 0);
    this.corps.add(this.tete);
    boite(this.tete, 0.3, 0.3, 0.28, 0, 0.15, 0, peau);
    boite(this.tete, 0.045, 0.05, 0.02, -0.07, 0.17, 0.142, "#2a2140");
    boite(this.tete, 0.045, 0.05, 0.02, 0.07, 0.17, 0.142, "#2a2140");
    boite(this.tete, 0.1, 0.02, 0.02, 0, 0.07, 0.142, "#b4605a");
    // cheveux (6 coiffures)
    const s = ap.hairStyle % 6;
    if (s !== 3) boite(this.tete, 0.33, 0.1, 0.31, 0, 0.3, -0.005, cheveux);
    else boite(this.tete, 0.31, 0.04, 0.29, 0, 0.31, 0, cheveux);
    if (s === 0 || s === 4) boite(this.tete, 0.33, 0.2, 0.07, 0, 0.2, -0.13, cheveux);
    if (s === 1) {
      boite(this.tete, 0.34, 0.42, 0.08, 0, 0.1, -0.14, cheveux);
      boite(this.tete, 0.05, 0.34, 0.24, -0.165, 0.12, -0.02, cheveux);
      boite(this.tete, 0.05, 0.34, 0.24, 0.165, 0.12, -0.02, cheveux);
    }
    if (s === 2) {
      boite(this.tete, 0.33, 0.2, 0.07, 0, 0.2, -0.13, cheveux);
      boite(this.tete, 0.16, 0.16, 0.16, 0, 0.4, -0.08, cheveux);
    }
    if (s === 4) boite(this.tete, 0.33, 0.07, 0.05, 0.03, 0.27, 0.15, cheveux);
    if (s === 5) {
      boite(this.tete, 0.33, 0.2, 0.07, 0, 0.2, -0.13, cheveux);
      boite(this.tete, 0.1, 0.34, 0.1, 0, 0.08, -0.2, cheveux);
    }

    // bras (pivot à l'épaule)
    const bras = (cote: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(cote * 0.26, 1.28, 0);
      this.corps.add(g);
      boite(g, 0.11, 0.3, 0.12, 0, -0.13, 0, haut);
      boite(g, 0.1, 0.24, 0.11, 0, -0.39, 0, ap.shirtStyle % 2 ? haut : peau);
      boite(g, 0.1, 0.09, 0.11, 0, -0.55, 0, peau);
      return g;
    };
    this.bras = [bras(-1), bras(1)];
    // colis porté à la Douane
    this.colis = boite(this.corps, 0.34, 0.24, 0.3, 0, 1.0, 0.38, "#c99b62");
    this.colis.visible = false;

    // jambes (pivot à la hanche, puis au genou)
    const hanches: THREE.Group[] = [];
    const genoux: THREE.Group[] = [];
    for (const cote of [-1, 1]) {
      const hanche = new THREE.Group();
      hanche.position.set(cote * 0.1, 0.8, 0);
      this.corps.add(hanche);
      boite(hanche, 0.16, 0.42, 0.18, 0, -0.2, 0, pantalon);
      const genou = new THREE.Group();
      genou.position.set(0, -0.4, 0);
      hanche.add(genou);
      boite(genou, 0.14, 0.36, 0.16, 0, -0.17, 0, pantalon);
      boite(genou, 0.15, 0.08, 0.26, 0, -0.36, 0.04, "#23262f");
      hanches.push(hanche);
      genoux.push(genou);
    }
    this.hanches = hanches as [THREE.Group, THREE.Group];
    this.genoux = genoux as [THREE.Group, THREE.Group];
  }

  /** hauteur du sommet de la tête (pour les bulles et les étiquettes) */
  get hauteur(): number {
    return this.pose === "sit" || this.pose === "type" || this.pose === "sleep" ? 1.42 : 1.78;
  }

  animer(dt: number, parle: boolean): void {
    this.t += dt;
    const t = this.t;
    const assis = this.pose === "sit" || this.pose === "type" || this.pose === "sleep";
    const [bg, bd] = this.bras;
    const [hg, hd] = this.hanches;
    const [gg, gd] = this.genoux;
    let y = 0;
    let brasG = 0.05;
    let brasD = 0.05;
    let teteX = 0;
    let teteY = 0;
    let hancheG = 0;
    let hancheD = 0;
    let genouG = 0;
    let genouD = 0;
    this.colis.visible = this.pose === "carry";
    if (assis) {
      y = -0.3;
      hancheG = hancheD = -Math.PI / 2;
      genouG = genouD = Math.PI / 2;
      if (this.pose === "type") {
        brasG = -1.15 + Math.sin(t * 14) * 0.05;
        brasD = -1.15 + Math.cos(t * 12) * 0.05;
        teteX = 0.08;
      } else if (this.pose === "sleep") {
        teteX = 0.55 + Math.sin(t * 1.2) * 0.04;
        brasG = brasD = -0.6;
      } else {
        brasG = brasD = -0.5;
        teteY = Math.sin(t * 0.6) * 0.2;
      }
    } else if (this.pose === "walk" || this.pose === "carry") {
      const a = Math.sin(t * 8.5);
      hancheG = a * 0.6;
      hancheD = -a * 0.6;
      genouG = Math.max(0, -a) * 0.9;
      genouD = Math.max(0, a) * 0.9;
      y = Math.abs(Math.cos(t * 8.5)) * 0.03;
      if (this.pose === "carry") brasG = brasD = -1.2;
      else {
        brasG = -a * 0.5;
        brasD = a * 0.5;
      }
    } else if (this.pose === "cheer") {
      y = Math.abs(Math.sin(t * 7)) * 0.22;
      brasG = -2.8 + Math.sin(t * 9) * 0.2;
      brasD = -2.8 - Math.sin(t * 9) * 0.2;
    } else if (this.pose === "drink") {
      brasD = -1.9 + Math.sin(t * 1.5) * 0.25;
      teteX = -0.05;
    } else if (this.pose === "talk") {
      brasD = -0.7 + Math.sin(t * 5) * 0.35;
      brasG = -0.15 + Math.sin(t * 3.1) * 0.1;
      teteX = Math.sin(t * 4) * 0.06;
    } else {
      // debout : respiration
      brasG = 0.05 + Math.sin(t * 1.4) * 0.03;
      brasD = 0.05 - Math.sin(t * 1.4) * 0.03;
      teteY = Math.sin(t * 0.5) * 0.25;
    }
    if (parle && this.pose !== "talk" && this.pose !== "walk") {
      teteX += Math.sin(t * 6) * 0.05;
      if (!assis) brasD = -0.7 + Math.sin(t * 5) * 0.3;
    }
    const k = Math.min(1, dt * 12);
    this.corps.position.y += (y - this.corps.position.y) * k;
    bg.rotation.x += (brasG - bg.rotation.x) * k;
    bd.rotation.x += (brasD - bd.rotation.x) * k;
    hg.rotation.x += (hancheG - hg.rotation.x) * k;
    hd.rotation.x += (hancheD - hd.rotation.x) * k;
    gg.rotation.x += (genouG - gg.rotation.x) * k;
    gd.rotation.x += (genouD - gd.rotation.x) * k;
    this.tete.rotation.x += (teteX - this.tete.rotation.x) * k;
    this.tete.rotation.y += (teteY - this.tete.rotation.y) * k;
  }
}
