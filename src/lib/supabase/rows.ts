import type { AgentDef, AgentState, MemoryEntry, ModelTier, Pole, Routine, Settings, WallStyleName } from "@/data/types";
import { lireRapport, rapportDepuisTexte } from "@/lib/rapport";
import type { AgentRuntime, Approval, ApprovalType, FluxEvent, FluxType, JournalEntry, Mission, RapportItem, TaskItem, TaskRef, TaskStep } from "@/store/world";

/** Lignes des tables Supabase (noms de colonnes en snake_case sans accents) et conversions. */

export interface PoleRow {
  id: string;
  nom: string;
  court: string;
  icone: string;
  couleur: string;
  sol: string;
  description: string;
  missions: string[];
  type: "pole" | "lieu";
  position_grille: string;
  style: WallStyleName;
  ordre: number;
  actif: boolean;
}

export interface AgentRow {
  id: string;
  pole_id: string;
  nom: string;
  role: string;
  personnalite: string;
  prompt_systeme: string;
  modele: ModelTier;
  outils: string[];
  autonomie: { niveau?: number } | null;
  apparence_seed: string;
  critique: boolean;
  responsable: boolean;
  sortant: boolean;
  taches_exemple: string[];
  etat: AgentState;
  offline_raison: "nuit" | "budget" | null;
  interlocuteur: string | null;
  tache_courante_id: string | null;
  bulle: string | null;
  ordre: number;
  actif: boolean;
  maj_le: string;
}

export interface TaskRow {
  id: string;
  parent_id: string | null;
  mission_id: string | null;
  agent_id: string | null;
  titre: string;
  statut: TaskItem["status"];
  etapes: TaskStep[] | null;
  priorite: number;
  resultat?: { texte?: string; erreur?: string; rapport?: unknown } | null;
  cree_le: string;
  maj_le: string;
}

export interface ApprovalRow {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  type_action: ApprovalType;
  titre: string;
  destinataire: string | null;
  objet: string | null;
  apercu: string;
  statut: "en_attente" | "approuve" | "modifie" | "refuse";
  cree_le: string;
}

export interface JournalRow {
  id: string;
  type: JournalEntry["type"];
  pole_id: string | null;
  agent_id: string | null;
  titre: string;
  contenu: string | null;
  cree_le: string;
}

export interface MissionRow {
  id: string;
  demandeur: string;
  texte: string;
  cible: string | null;
  plan: { agentId?: string; agent_id?: string; title?: string; titre?: string }[] | null;
  statut: Mission["status"];
  synthese: string | null;
  cree_le: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string | null;
  from_agent: string | null;
  to_agent: string | null;
  task_id: string | null;
  type: "question" | "reponse" | "delegation" | "livrable" | "bavardage";
  contenu: string;
  resume_bulle: string | null;
  cree_le: string;
}

export interface RoutineRow {
  id: string;
  nom: string;
  agent_id: string | null;
  mode: "fixe" | "intervalle";
  heure: string;
  intervalle_minutes: number;
  plage_debut: string;
  plage_fin: string;
  jours: number[];
  jour_du_mois: number | null;
  prompt_tache: string;
  actif: boolean;
}

export interface MemoryRow {
  id: string;
  cle: string;
  contenu: string;
}

export interface SettingsRow {
  budget_jour: number | string;
  budget_mois: number | string;
  allowlist_emails: string[];
  recap_destinataires: string[];
  signataire: Settings["signataire"];
  bavardage_actif: boolean;
  contraintes_agenda: { jeremy?: string; matheis?: string } | null;
}

const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Date.now());
const hhmm = (t: string): string => t.slice(0, 5);

// ------------------------------------------------------------------ lecture
export const poleFromRow = (r: PoleRow): Pole => ({
  id: r.id,
  nom: r.nom,
  court: r.court || r.nom,
  icone: r.icone,
  couleur: r.couleur,
  sol: r.sol,
  description: r.description,
  missions: r.missions ?? [],
  kind: r.type,
  position: r.position_grille,
  style: r.style,
  ordre: r.ordre,
  actif: r.actif,
});

export const agentFromRow = (r: AgentRow): AgentDef => ({
  id: r.id,
  nom: r.nom,
  pole: r.pole_id,
  role: r.role,
  personnalite: r.personnalite,
  promptSysteme: r.prompt_systeme,
  modele: r.modele,
  outils: r.outils ?? [],
  autonomie: Math.max(0, Math.min(2, r.autonomie?.niveau ?? 0)) as 0 | 1 | 2,
  apparenceSeed: r.apparence_seed || r.id,
  critique: r.critique,
  responsable: r.responsable,
  sortant: r.sortant,
  taches: r.taches_exemple ?? [],
  routines: [],
  ordre: r.ordre,
  actif: r.actif,
});

export const taskRefFromRow = (r: TaskRow): TaskRef => ({
  id: r.id,
  title: r.titre,
  steps: Array.isArray(r.etapes) ? r.etapes : [],
  startedAt: ms(r.cree_le),
  missionId: r.mission_id ?? undefined,
  important: r.priorite >= 3,
});

export const runtimeFromRow = (r: AgentRow, task: TaskRow | undefined, approvalId: string | null): AgentRuntime => ({
  id: r.id,
  state: r.etat,
  task: task ? taskRefFromRow(task) : null,
  talkWith: r.interlocuteur,
  offlineReason: r.offline_raison,
  approvalId,
  since: ms(r.maj_le),
});

export const taskFromRow = (r: TaskRow): TaskItem => ({
  id: r.id,
  agentId: r.agent_id ?? "",
  title: r.titre,
  status: r.statut,
  createdAt: ms(r.cree_le),
  updatedAt: ms(r.maj_le),
  missionId: r.mission_id ?? undefined,
  parentId: r.parent_id ?? undefined,
});

/** Compte rendu d'une tâche terminée (ancien livrable en texte libre → rapport minimal). */
export const rapportFromRow = (r: TaskRow): RapportItem | null => {
  if (r.statut !== "done" || !r.resultat) return null;
  const rapport = lireRapport(r.resultat.rapport) ?? (r.resultat.texte ? rapportDepuisTexte(r.titre, r.resultat.texte) : null);
  if (!rapport) return null;
  return { taskId: r.id, agentId: r.agent_id ?? "", missionId: r.mission_id ?? undefined, parentId: r.parent_id ?? undefined, tache: r.titre, at: ms(r.maj_le), rapport };
};

const FLUX_TYPES: Record<MessageRow["type"], FluxType | null> = { question: "question", reponse: "reponse", delegation: "delegation", livrable: "livrable", bavardage: null };

/** Message entre agents → évènement du flux (les répliques d'ambiance n'y figurent pas). */
export const fluxFromMessage = (m: MessageRow, missionId?: string): FluxEvent | null => {
  const type = FLUX_TYPES[m.type];
  if (!type || !m.from_agent) return null;
  return { id: m.id, at: ms(m.cree_le), type, from: m.from_agent, to: m.to_agent, text: (m.contenu || m.resume_bulle || "").slice(0, 600), taskId: m.task_id ?? undefined, missionId };
};

export const approvalFromRow = (r: ApprovalRow): Approval => ({
  id: r.id,
  agentId: r.agent_id ?? "",
  type: r.type_action,
  title: r.titre,
  to: r.destinataire ?? undefined,
  subject: r.objet ?? undefined,
  preview: r.apercu,
  createdAt: ms(r.cree_le),
  delivered: true,
});

export const journalFromRow = (r: JournalRow): JournalEntry => ({
  id: r.id,
  at: ms(r.cree_le),
  agentId: r.agent_id ?? undefined,
  poleId: r.pole_id ?? undefined,
  type: r.type,
  title: r.titre,
  detail: r.contenu ?? undefined,
});

export const missionFromRow = (r: MissionRow): Mission => ({
  id: r.id,
  text: r.texte,
  target: r.cible ?? "marius",
  plan: (r.plan ?? []).map((p) => ({ agentId: p.agentId ?? p.agent_id ?? "", title: p.title ?? p.titre ?? "" })),
  status: r.statut,
  createdAt: ms(r.cree_le),
  synthese: r.synthese ?? undefined,
});

export const routineFromRow = (r: RoutineRow): Routine => ({
  id: r.id,
  nom: r.nom,
  agentId: r.agent_id ?? "",
  mode: r.mode,
  heure: hhmm(r.heure),
  intervalleMinutes: r.intervalle_minutes,
  plageDebut: hhmm(r.plage_debut),
  plageFin: hhmm(r.plage_fin),
  jours: r.jours ?? [],
  jourDuMois: r.jour_du_mois,
  promptTache: r.prompt_tache,
  actif: r.actif,
});

export const memoryFromRow = (r: MemoryRow): MemoryEntry => ({ id: r.id, cle: r.cle, contenu: r.contenu });

export const settingsFromRow = (r: SettingsRow): Settings => ({
  budgetJour: Number(r.budget_jour),
  budgetMois: Number(r.budget_mois),
  allowlistEmails: r.allowlist_emails ?? [],
  recapDestinataires: r.recap_destinataires ?? [],
  signataire: r.signataire,
  bavardageActif: r.bavardage_actif,
  contraintesAgenda: { jeremy: r.contraintes_agenda?.jeremy ?? "", matheis: r.contraintes_agenda?.matheis ?? "" },
});

// ------------------------------------------------------------------ écriture
export const poleToRow = (p: Pole): PoleRow => ({
  id: p.id,
  nom: p.nom,
  court: p.court,
  icone: p.icone,
  couleur: p.couleur,
  sol: p.sol,
  description: p.description,
  missions: p.missions,
  type: p.kind,
  position_grille: p.position,
  style: p.style,
  ordre: p.ordre,
  actif: p.actif,
});

export const agentToRow = (a: AgentDef) => ({
  id: a.id,
  pole_id: a.pole,
  nom: a.nom,
  role: a.role,
  personnalite: a.personnalite,
  prompt_systeme: a.promptSysteme,
  modele: a.modele,
  outils: a.outils,
  autonomie: { niveau: a.autonomie },
  apparence_seed: a.apparenceSeed,
  critique: a.critique,
  responsable: !!a.responsable,
  sortant: a.sortant,
  taches_exemple: a.taches,
  ordre: a.ordre,
  actif: a.actif,
});

export const routineToRow = (r: Routine): RoutineRow => ({
  id: r.id,
  nom: r.nom,
  agent_id: r.agentId || null,
  mode: r.mode,
  heure: r.heure,
  intervalle_minutes: r.intervalleMinutes,
  plage_debut: r.plageDebut,
  plage_fin: r.plageFin,
  jours: r.jours,
  jour_du_mois: r.jourDuMois,
  prompt_tache: r.promptTache,
  actif: r.actif,
});

export const settingsToRow = (s: Settings): SettingsRow => ({
  budget_jour: s.budgetJour,
  budget_mois: s.budgetMois,
  allowlist_emails: s.allowlistEmails,
  recap_destinataires: s.recapDestinataires,
  signataire: s.signataire,
  bavardage_actif: s.bavardageActif,
  contraintes_agenda: s.contraintesAgenda,
});
