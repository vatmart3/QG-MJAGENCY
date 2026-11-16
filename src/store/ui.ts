import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export interface UIState {
  selectedAgent: string | null;
  selectedPole: string | null;
  hoverAgent: string | null;
  /** zoom courant de la caméra (échelle monde → écran) */
  zoom: number;
  /** la ville est prête (textures générées) */
  ready: boolean;
  fps: number;
  /** démo locale, ou état de la connexion temps réel à Supabase */
  conn: "demo" | "connexion" | "direct" | "hors_ligne";
  userEmail: string | null;
  /** dernier passage du moteur d'agents (mode direct) */
  moteur: { kind: "anthropic" | "mock" | null; dernier: number | null; erreur: string | null; enCours: boolean };
  /** mode TV : ville en plein écran, sans menus, caméra qui se promène */
  tv: boolean;
  /** visite à pied du bureau 3D : « oui » (on se déplace), « pause » (souris libérée), « non » */
  visite: "non" | "oui" | "pause";
  /** pièce où l'on se trouve pendant la visite */
  visiteLieu: string | null;
  /** agent juste devant soi pendant la visite (touche E pour lui parler) */
  visiteCible: string | null;
  /** le téléphone de la visite est sorti (touche G) */
  telephone: boolean;
  /** cette page EST l'écran du téléphone (chargée dans son cadre) : pas de 3D, onglets en plein écran */
  dansTelephone: boolean;
}

export const uiStore = createStore<UIState>(() => ({
  selectedAgent: null,
  selectedPole: null,
  hoverAgent: null,
  zoom: 1,
  ready: false,
  fps: 0,
  conn: "demo",
  userEmail: null,
  moteur: { kind: null, dernier: null, erreur: null, enCours: false },
  tv: false,
  visite: "non",
  visiteLieu: null,
  visiteCible: null,
  telephone: false,
  dansTelephone: false,
}));

export const useUI = <T>(selector: (s: UIState) => T): T => useStore(uiStore, selector);

export const ui = {
  selectAgent(id: string | null): void {
    uiStore.setState({ selectedAgent: id, selectedPole: id ? null : uiStore.getState().selectedPole });
  },
  selectPole(id: string | null): void {
    uiStore.setState({ selectedPole: id, selectedAgent: id ? null : uiStore.getState().selectedAgent });
  },
  closeSheets(): void {
    uiStore.setState({ selectedAgent: null, selectedPole: null });
  },
  setHover(id: string | null): void {
    if (uiStore.getState().hoverAgent !== id) uiStore.setState({ hoverAgent: id });
  },
};
