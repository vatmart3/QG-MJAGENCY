import * as THREE from "three";

/**
 * « Lot » de géométrie : des centaines de boîtes, cylindres et volumes low-poly fusionnés en un seul maillage
 * coloré par sommet (un seul appel de rendu pour tout le mobilier). Chaque forme est posée dans un repère local
 * (position et rotation du meuble), ce qui permet de décrire un meuble une fois et de le placer partout.
 */

const BOITE = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const cylindres = new Map<string, THREE.BufferGeometry>();
const ICO = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
const ICO1 = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();

const m4 = new THREE.Matrix4();
const local = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const AXE_Y = new THREE.Vector3(0, 1, 0);
const couleur = new THREE.Color();

export type Teinte = THREE.ColorRepresentation;

export class Lot {
  private pos: number[] = [];
  private col: number[] = [];
  private base = new THREE.Matrix4();

  /** Place le repère local : origine (x, y, z), rotation autour de y. */
  repere(x: number, z: number, angle = 0, y = 0): this {
    this.base.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(AXE_Y, angle), new THREE.Vector3(1, 1, 1));
    return this;
  }

  private ajouter(geo: THREE.BufferGeometry, mat: THREE.Matrix4, teinte: Teinte): void {
    couleur.set(teinte);
    const p = geo.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mat);
      this.pos.push(v.x, v.y, v.z);
      this.col.push(couleur.r, couleur.g, couleur.b);
    }
  }

  /** Boîte centrée en (x, y, z) dans le repère local, de taille w × h × d, tournée de `rot` autour de y. */
  boite(x: number, y: number, z: number, w: number, h: number, d: number, teinte: Teinte, rot = 0, rotX = 0): this {
    q.setFromEuler(new THREE.Euler(rotX, rot, 0, "YXZ"));
    local.compose(v.set(x, y, z), q, new THREE.Vector3(w, h, d));
    this.ajouter(BOITE, m4.multiplyMatrices(this.base, local), teinte);
    return this;
  }

  /** Cylindre (ou cône si rHaut = 0) posé sur y0, d'axe vertical. */
  cylindre(x: number, y0: number, z: number, r: number, h: number, teinte: Teinte, seg = 8, rHaut = r): this {
    const k = `${seg}:${(rHaut / r).toFixed(3)}`;
    let g = cylindres.get(k);
    if (!g) {
      g = new THREE.CylinderGeometry(rHaut / r, 1, 1, seg).toNonIndexed();
      cylindres.set(k, g);
    }
    local.compose(v.set(x, y0 + h / 2, z), q.identity(), new THREE.Vector3(r, h, r));
    this.ajouter(g, m4.multiplyMatrices(this.base, local), teinte);
    return this;
  }

  /** Volume à facettes (feuillage, coussin) centré en (x, y, z). */
  bloc(x: number, y: number, z: number, rx: number, ry: number, rz: number, teinte: Teinte, fin = false, rot = 0): this {
    local.compose(v.set(x, y, z), q.setFromAxisAngle(AXE_Y, rot), new THREE.Vector3(rx, ry, rz));
    this.ajouter(fin ? ICO1 : ICO, m4.multiplyMatrices(this.base, local), teinte);
    return this;
  }

  get vide(): boolean {
    return this.pos.length === 0;
  }

  geometrie(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  maillage(materiau: THREE.Material, o: { ombre?: boolean; recoit?: boolean } = {}): THREE.Mesh {
    const m = new THREE.Mesh(this.geometrie(), materiau);
    m.castShadow = o.ombre ?? true;
    m.receiveShadow = o.recoit ?? true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

/** Éclaircit (k > 0) ou assombrit (k < 0) une couleur. */
export function nuance(c: Teinte, k: number): THREE.Color {
  const col = new THREE.Color(c);
  return k >= 0 ? col.lerp(new THREE.Color("#ffffff"), k) : col.lerp(new THREE.Color("#1c1530"), -k);
}
