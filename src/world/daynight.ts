/**
 * Cycle jour/nuit calé sur l'heure réelle de Paris.
 * Chaque clé : heure → couleurs du ciel (haut / bas), teinte du monde, intensité de nuit.
 */

interface Key {
  h: number;
  skyTop: number;
  skyBottom: number;
  water: number;
  mountains: number;
  tint: number;
  night: number;
}

const KEYS: Key[] = [
  { h: 0, skyTop: 0x10173a, skyBottom: 0x2a2d63, water: 0x1d2a55, mountains: 0x1b1b3f, tint: 0x6a74b8, night: 1 },
  { h: 5.2, skyTop: 0x1a1f4a, skyBottom: 0x3c3a75, water: 0x26336a, mountains: 0x24234e, tint: 0x7880c0, night: 0.95 },
  { h: 6.3, skyTop: 0x7d7cc4, skyBottom: 0xffb4c2, water: 0xa58fc0, mountains: 0x6a5a9a, tint: 0xf2cfe0, night: 0.35 },
  { h: 7.6, skyTop: 0xa9a6ec, skyBottom: 0xffd2cf, water: 0x9fc4e6, mountains: 0x8c7cc0, tint: 0xfff2f0, night: 0 },
  { h: 12, skyTop: 0xb7b3f2, skyBottom: 0xffdcd2, water: 0xa6d0ec, mountains: 0x9a8ccc, tint: 0xffffff, night: 0 },
  { h: 16.8, skyTop: 0xaea6ec, skyBottom: 0xffd0c0, water: 0xa2c6e6, mountains: 0x9283c4, tint: 0xfff6ee, night: 0 },
  { h: 18.4, skyTop: 0x8a7bd6, skyBottom: 0xff9e6b, water: 0xc59a9e, mountains: 0x6f5a9e, tint: 0xffd4b8, night: 0.15 },
  { h: 19.6, skyTop: 0x4b3f8f, skyBottom: 0xd9708a, water: 0x6a5a8e, mountains: 0x3f3470, tint: 0xb9a6d6, night: 0.6 },
  { h: 21, skyTop: 0x161c44, skyBottom: 0x342f6a, water: 0x222e5e, mountains: 0x1e1d46, tint: 0x7078bc, night: 1 },
  { h: 24, skyTop: 0x10173a, skyBottom: 0x2a2d63, water: 0x1d2a55, mountains: 0x1b1b3f, tint: 0x6a74b8, night: 1 },
];

export interface Ambiance {
  skyTop: number;
  skyBottom: number;
  water: number;
  mountains: number;
  tint: number;
  night: number;
}

export function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export function ambianceAt(hour: number): Ambiance {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = (h - a.h) / (b.h - a.h);
  return {
    skyTop: lerpColor(a.skyTop, b.skyTop, t),
    skyBottom: lerpColor(a.skyBottom, b.skyBottom, t),
    water: lerpColor(a.water, b.water, t),
    mountains: lerpColor(a.mountains, b.mountains, t),
    tint: lerpColor(a.tint, b.tint, t),
    night: a.night + (b.night - a.night) * t,
  };
}

export function phaseLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5.5 || h >= 21) return "Nuit";
  if (h < 7.5) return "Aube";
  if (h < 17.5) return "Jour";
  if (h < 19.5) return "Coucher";
  return "Crépuscule";
}

/** Heures de travail : les agents sont au port entre 7 h et 20 h 30. */
export function isWorkingHour(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= 7 && h < 20.5;
}
