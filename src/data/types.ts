/** Types partagés entre le seed local (Phase 1) et, plus tard, la base Supabase. */

export type PoleKind = "pole" | "lieu";

export interface Pole {
  /** slug stable, sert d'identifiant */
  id: string;
  nom: string;
  /** nom court pour la mini-carte et les étiquettes compactes */
  court: string;
  icone: string;
  /** couleur principale (hauts des bonshommes, murets, étiquettes) */
  couleur: string;
  /** couleur pastel du sol */
  sol: string;
  description: string;
  missions: string[];
  kind: PoleKind;
}

export type ModelTier = "planner" | "worker" | "light";

/** Niveau d'autonomie par défaut (cf. §7.4) */
export type AutonomyLevel = 0 | 1 | 2;

export interface AgentDef {
  id: string;
  nom: string;
  pole: string;
  role: string;
  personnalite: string;
  modele: ModelTier;
  outils: string[];
  autonomie: AutonomyLevel;
  critique: boolean;
  routines: string[];
  /** titres de tâches d'exemple utilisés par le mode démo */
  taches: string[];
  /** l'agent prépare des actions qui partent vers l'extérieur (→ Douane) */
  sortant: boolean;
  /** responsable de pôle (participe au stand-up) */
  responsable?: boolean;
}

/** États réels d'un agent (§4) */
export type AgentState =
  | "idle"
  | "working"
  | "talking"
  | "meeting"
  | "waiting_approval"
  | "done"
  | "offline";

export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Disponible",
  working: "Au travail",
  talking: "En discussion",
  meeting: "En réunion",
  waiting_approval: "Attend une validation",
  done: "Tâche terminée",
  offline: "Hors ligne",
};

export const STATE_ICON: Record<AgentState, string> = {
  idle: "☕",
  working: "✍️",
  talking: "💬",
  meeting: "🗣️",
  waiting_approval: "⏳",
  done: "🎉",
  offline: "🌙",
};
