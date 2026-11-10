/** Petits utilitaires d'aléatoire déterministe (pixel art procédural, placement du décor). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a 32 bits d'une chaîne (seed d'apparence = id de l'agent). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bruit entier déterministe pour une coordonnée 2D, résultat dans [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function pick<T>(arr: readonly T[], r: number): T {
  const v = arr[Math.floor(r * arr.length) % arr.length];
  if (v === undefined) throw new Error("pick: tableau vide");
  return v;
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
