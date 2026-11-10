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
  /** emplacement sur la carte (ex. « c3r2 », cf. src/world/slots.ts) */
  position: string;
  /** style des murs */
  style: WallStyleName;
  actif: boolean;
  ordre: number;
}

export type WallStyleName = "muret" | "verre" | "douane" | "back";

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
  /** instructions propres à l'agent (s'ajoutent aux règles communes) */
  promptSysteme: string;
  /** graine de l'apparence du bonhomme (par défaut = id) */
  apparenceSeed: string;
  actif: boolean;
  ordre: number;
}

export interface MemoryEntry {
  id: string;
  cle: string;
  contenu: string;
}

export interface Routine {
  id: string;
  nom: string;
  agentId: string;
  /** « fixe » = à heure(s) précise(s) ; « intervalle » = toutes les N minutes dans une plage */
  mode: "fixe" | "intervalle";
  heure: string; // HH:MM (mode fixe)
  intervalleMinutes: number; // mode intervalle
  plageDebut: string; // HH:MM
  plageFin: string; // HH:MM
  /** 1 = lundi … 7 = dimanche ; vide = tous les jours */
  jours: number[];
  /** jour du mois (1er du mois…) ; null = ignoré */
  jourDuMois: number | null;
  promptTache: string;
  actif: boolean;
}

export interface Settings {
  budgetJour: number;
  budgetMois: number;
  allowlistEmails: string[];
  recapDestinataires: string[];
  signataire: "Jérémy" | "Matheis" | "L'équipe MJAGENCY";
  bavardageActif: boolean;
  contraintesAgenda: { jeremy: string; matheis: string };
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
