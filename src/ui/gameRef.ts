import type { Game } from "@/world/Game";

/** Accès impératif à la ville depuis l'interface React (caméra, zoom). */
let current: Game | null = null;

export const setGame = (g: Game | null): void => {
  current = g;
};

export const getGame = (): Game | null => current;
