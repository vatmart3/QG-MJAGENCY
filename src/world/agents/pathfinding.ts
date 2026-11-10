import { GH, GW, idx } from "../layout";

/**
 * A* 4 directions sur la grille de l'île (les déplacements le long des axes
 * apparaissent en diagonale à l'écran, comme dans un vrai jeu iso).
 * Tas binaire + tableaux typés réutilisés : ~0,2 ms par chemin.
 */

const N = GW * GH;
const gScore = new Float32Array(N);
const fScore = new Float32Array(N);
const came = new Int32Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
let gen = 1;

class Heap {
  private a: number[] = [];
  push(n: number): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fScore[a[p]!]! <= fScore[a[i]!]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && fScore[a[l]!]! < fScore[a[m]!]!) m = l;
        if (r < a.length && fScore[a[r]!]! < fScore[a[m]!]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.a.length;
  }
}

/**
 * @param blocked cases bloquées (1)
 * @param extraCost coût additionnel par case (ex. herbe un peu plus chère que les allées)
 * @returns liste de cases (index) de départ exclu jusqu'à l'arrivée incluse, ou null
 */
export function findPath(blocked: Uint8Array, extraCost: Uint8Array, sx: number, sy: number, tx: number, ty: number): number[] | null {
  if (sx === tx && sy === ty) return [];
  gen++;
  const start = idx(sx, sy);
  const goal = idx(tx, ty);
  const open = new Heap();
  stamp[start] = gen;
  gScore[start] = 0;
  fScore[start] = Math.abs(tx - sx) + Math.abs(ty - sy);
  came[start] = -1;
  open.push(start);
  let iterations = 0;
  while (open.size) {
    const cur = open.pop()!;
    if (cur === goal) break;
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (++iterations > 6000) return null;
    const cx = cur % GW;
    const cy = (cur / GW) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (n !== goal && blocked[n]) continue;
      if (closed[n] === gen) continue;
      // léger surcoût aux changements de direction → trajets plus « humains »
      const prev = came[cur]!;
      const turn = prev >= 0 && (prev % GW === cx) !== (nx === cx) ? 0.15 : 0;
      const g = gScore[cur]! + 1 + extraCost[n]! * 0.35 + turn;
      if (stamp[n] !== gen || g < gScore[n]!) {
        stamp[n] = gen;
        gScore[n] = g;
        fScore[n] = g + Math.abs(tx - nx) + Math.abs(ty - ny);
        came[n] = cur;
        open.push(n);
      }
    }
  }
  if (stamp[goal] !== gen) return null;
  const path: number[] = [];
  let c = goal;
  while (c !== start && c >= 0) {
    path.push(c);
    c = came[c]!;
  }
  path.reverse();
  return path;
}
