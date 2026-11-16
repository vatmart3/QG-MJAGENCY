/**
 * Accès impératif à la scène depuis l'interface React (caméra, zoom) : la ville en pixel art ou le bureau 3D.
 */
export interface Scene {
  zoomStep(dir: 1 | -1): void;
  flyToAgent(id: string): void;
  flyToZone(zoneId: string): void;
  /** vue d'ensemble */
  overview(): void;
  /** mode TV : la caméra va sur une pièce / un agent ; false si impossible */
  tvZone(id: string): boolean;
  tvAgent(id: string): boolean;
  destroy(): void;
  /** bureau 3D seulement : visite à pied */
  entrerVisite?(): void;
  reprendreVisite?(): void;
  quitterVisite?(): void;
  manetteVers?(x: number, y: number): void;
  /** téléphone de la visite (touche G) */
  ouvrirTelephone?(): void;
  fermerTelephone?(): void;
}

let current: Scene | null = null;

export const setGame = (g: Scene | null): void => {
  current = g;
};

export const getGame = (): Scene | null => current;
