/**
 * Emplacements de la carte. Chaque pôle ou lieu occupe un emplacement 7×6 cases.
 * Colonnes c1…c6, rangées r1…r3 (rive nord, porte côté sud) et r4…r5 (rive sud, porte côté canal).
 */

export const COLS = [5, 14, 23, 32, 41, 50] as const;
export const ROWS = [5, 13, 21, 33, 41] as const;

export interface Slot {
  id: string;
  x: number;
  y: number;
  rive: "nord" | "sud";
  label: string;
}

export const SLOTS: Slot[] = ROWS.flatMap((y, ri) =>
  COLS.map((x, ci) => ({
    id: `c${ci + 1}r${ri + 1}`,
    x,
    y,
    rive: ri < 3 ? ("nord" as const) : ("sud" as const),
    label: `${ri < 3 ? "Rive nord" : "Rive sud"} — rangée ${ri < 3 ? ri + 1 : ri - 2}, colonne ${ci + 1}`,
  })),
);

export const slotById = (id: string): Slot | undefined => SLOTS.find((s) => s.id === id);
