import { RES, type Plan } from "./plan";

/**
 * Chemins des agents dans le bureau : A* sur la grille (cases de 25 cm, 8 directions), puis lissage en ligne
 * droite. Le départ et l'arrivée peuvent être dans un obstacle (une chaise collée à un bureau, un canapé) :
 * on rejoint alors la case libre la plus proche.
 */

export interface Pt {
  x: number;
  z: number;
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const COUT = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

export class Nav {
  private g: Float32Array;
  private parent: Int32Array;
  private vu: Uint32Array;
  private tour = 0;
  private tas: number[] = [];
  private f: Float32Array;

  constructor(private plan: Plan) {
    const n = plan.gw * plan.gh;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.vu = new Uint32Array(n);
  }

  private libre(i: number, j: number): boolean {
    const { gw, gh, nav } = this.plan;
    return i >= 0 && j >= 0 && i < gw && j < gh && !nav[j * gw + i];
  }

  /** Le point (en mètres) est-il accessible aux agents ? */
  estLibre(x: number, z: number): boolean {
    return this.libre(Math.floor(x / RES), Math.floor(z / RES));
  }

  /** case libre la plus proche d'un point (recherche en anneaux) */
  private proche(x: number, z: number): number | null {
    const { gw } = this.plan;
    const ci = Math.floor(x / RES);
    const cj = Math.floor(z / RES);
    if (this.libre(ci, cj)) return cj * gw + ci;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= 10 && best < 0; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !this.libre(ci + di, cj + dj)) continue;
          const d = (ci + di + 0.5 - x / RES) ** 2 + (cj + dj + 0.5 - z / RES) ** 2;
          if (d < bestD) {
            bestD = d;
            best = (cj + dj) * gw + ci + di;
          }
        }
    return best < 0 ? null : best;
  }

  /** vue dégagée entre deux centres de cases (pour le lissage) */
  private visible(a: number, b: number): boolean {
    const { gw } = this.plan;
    const ax = (a % gw) + 0.5;
    const az = Math.floor(a / gw) + 0.5;
    const bx = (b % gw) + 0.5;
    const bz = Math.floor(b / gw) + 0.5;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (!this.libre(Math.floor(ax + (bx - ax) * t), Math.floor(az + (bz - az) * t))) return false;
    }
    return true;
  }

  /** Chemin de `de` à `vers` (points en mètres, `vers` compris), ou null s'il n'y en a pas. */
  chemin(de: Pt, vers: Pt): Pt[] | null {
    const { gw } = this.plan;
    const s = this.proche(de.x, de.z);
    const e = this.proche(vers.x, vers.z);
    if (s === null || e === null) return null;
    if (s === e) return [vers];
    this.tour++;
    const { g, f, parent, vu, tas } = this;
    tas.length = 0;
    const ei = e % gw;
    const ej = Math.floor(e / gw);
    const h = (c: number) => {
      const dx = Math.abs((c % gw) - ei);
      const dz = Math.abs(Math.floor(c / gw) - ej);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const pousser = (c: number) => {
      tas.push(c);
      let k = tas.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[tas[p]!]! <= f[tas[k]!]!) break;
        [tas[p], tas[k]] = [tas[k]!, tas[p]!];
        k = p;
      }
    };
    const tirer = (): number => {
      const top = tas[0]!;
      const last = tas.pop()!;
      if (tas.length) {
        tas[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < tas.length && f[tas[l]!]! < f[tas[m]!]!) m = l;
          if (r < tas.length && f[tas[r]!]! < f[tas[m]!]!) m = r;
          if (m === k) break;
          [tas[m], tas[k]] = [tas[k]!, tas[m]!];
          k = m;
        }
      }
      return top;
    };
    g[s] = 0;
    f[s] = h(s);
    parent[s] = -1;
    vu[s] = this.tour;
    pousser(s);
    let trouve = false;
    let garde = 0;
    while (tas.length && garde++ < 60000) {
      const c = tirer();
      if (c === e) {
        trouve = true;
        break;
      }
      const ci = c % gw;
      const cj = Math.floor(c / gw);
      for (let d = 0; d < 8; d++) {
        const ni = ci + DI[d]!;
        const nj = cj + DJ[d]!;
        if (!this.libre(ni, nj)) continue;
        // pas de diagonale qui rase un coin
        if (d >= 4 && (!this.libre(ci + DI[d]!, cj) || !this.libre(ci, cj + DJ[d]!))) continue;
        const n = nj * gw + ni;
        const ng = g[c]! + COUT[d]!;
        if (vu[n] === this.tour && ng >= g[n]!) continue;
        vu[n] = this.tour;
        g[n] = ng;
        f[n] = ng + h(n);
        parent[n] = c;
        pousser(n);
      }
    }
    if (!trouve) return null;
    const cases: number[] = [];
    for (let c = e; c !== -1; c = parent[c]!) cases.push(c);
    cases.reverse();
    // lissage : on saute les cases intermédiaires tant que la vue est dégagée
    const lisse: number[] = [cases[0]!];
    let i = 0;
    while (i < cases.length - 1) {
      let j = Math.min(cases.length - 1, i + 60);
      while (j > i + 1 && !this.visible(cases[i]!, cases[j]!)) j--;
      lisse.push(cases[j]!);
      i = j;
    }
    const pts = lisse.slice(1).map((c) => ({ x: ((c % gw) + 0.5) * RES, z: (Math.floor(c / gw) + 0.5) * RES }));
    pts.push(vers);
    return pts;
  }

  /** Un point libre au hasard dans un rectangle (flânerie). */
  auHasard(x0: number, z0: number, x1: number, z1: number): Pt | null {
    for (let k = 0; k < 20; k++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      if (this.libre(Math.floor(x / RES), Math.floor(z / RES))) return { x, z };
    }
    return null;
  }
}
