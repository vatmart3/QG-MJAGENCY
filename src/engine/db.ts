import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentState } from "@/data/types";
import type { TaskStep } from "@/store/world";

/**
 * Accès à la base pour le moteur. Deux implémentations :
 * - Supabase (clé service_role) en production ;
 * - Postgres direct (src/engine/db-pg.ts) pour les tests locaux.
 */

export type Msg = Anthropic.Beta.BetaMessageParam;

export interface ETask {
  id: string;
  parent_id: string | null;
  mission_id: string | null;
  agent_id: string | null;
  cree_par: string;
  titre: string;
  description: string;
  statut: "queued" | "running" | "waiting_tool" | "waiting_approval" | "waiting_founder" | "done" | "failed" | "cancelled";
  priorite: number;
  etapes: TaskStep[];
  resultat: { texte?: string; erreur?: string; rapport?: unknown } | null;
  profondeur: number;
  depend_de: string[];
  pas_avant: string | null;
  locked_until: string | null;
  cree_le: string;
  maj_le: string;
}

export type Attente =
  | { tool_use_id: string; kind: "tasks"; ids: string[] }
  | { tool_use_id: string; kind: "approval"; id: string };

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ERun {
  id: string;
  task_id: string;
  messages: Msg[];
  iterations: number;
  cout: number;
  erreur: string | null;
  attente: Attente[];
  resultats_en_suspens: ToolResultBlock[];
}

export interface EAgent {
  id: string;
  pole_id: string;
  nom: string;
  role: string;
  personnalite: string;
  prompt_systeme: string;
  modele: "planner" | "worker" | "light";
  outils: string[];
  autonomie: { niveau?: number } | null;
  critique: boolean;
  actif: boolean;
  etat: AgentState;
  offline_raison: "nuit" | "budget" | null;
  tache_courante_id: string | null;
  maj_le: string;
}

export interface EMission {
  id: string;
  demandeur: string;
  texte: string;
  cible: string | null;
  plan: unknown;
  statut: "nouvelle" | "planification" | "en_cours" | "terminee" | "annulee";
  synthese: string | null;
  cree_le: string;
}

export interface EApproval {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  type_action: string;
  titre: string;
  apercu: string;
  payload: Record<string, unknown>;
  statut: "en_attente" | "approuve" | "modifie" | "refuse";
  motif: string | null;
  decide_par: string | null;
}

export interface ESettings {
  budget_jour: number;
  budget_mois: number;
  bavardage_actif: boolean;
  signataire: string;
}

export interface EngineDb {
  settings(): Promise<ESettings>;
  poles(): Promise<{ id: string; nom: string }[]>;
  memory(): Promise<{ cle: string; contenu: string }[]>;
  agents(): Promise<EAgent[]>;
  agent(id: string): Promise<EAgent | null>;
  updateAgent(id: string, patch: Partial<EAgent> & { interlocuteur?: string | null }): Promise<void>;
  updateAgents(ids: string[], patch: Partial<EAgent> & { interlocuteur?: string | null }): Promise<void>;
  /** agents dans un état passager (done, talking, meeting) depuis avant `before` */
  agentsToRelax(before: string): Promise<EAgent[]>;

  newMissions(): Promise<EMission[]>;
  mission(id: string): Promise<EMission | null>;
  updateMission(id: string, patch: Partial<EMission>): Promise<void>;

  insertTask(row: Partial<ETask> & { titre: string }): Promise<ETask>;
  updateTask(id: string, patch: Partial<ETask>): Promise<void>;
  task(id: string): Promise<ETask | null>;
  tasks(ids: string[]): Promise<ETask[]>;
  /** tâches d'une même mission (sous-tâches visibles par un agent) */
  missionTasks(missionId: string): Promise<ETask[]>;
  claimTasks(limit: number, lockSeconds: number): Promise<ETask[]>;
  waitingTasks(): Promise<ETask[]>;
  /** tâches non terminées créées avant `before` */
  staleTasks(before: string): Promise<ETask[]>;

  run(taskId: string): Promise<ERun | null>;
  saveRun(taskId: string, patch: Partial<ERun>): Promise<ERun>;

  insertMessage(row: { conversation_id?: string | null; from_agent: string | null; to_agent: string | null; task_id?: string | null; type: "question" | "reponse" | "delegation" | "livrable" | "bavardage"; contenu: string; resume_bulle: string | null }): Promise<void>;
  insertJournal(row: { type: string; titre: string; contenu?: string | null; agent_id?: string | null; pole_id?: string | null }): Promise<void>;
  journalSince(titre: string, sinceIso: string): Promise<boolean>;
  insertApproval(row: { agent_id: string; task_id: string | null; type_action: string; titre: string; apercu: string; destinataire?: string | null; objet?: string | null; payload?: Record<string, unknown> }): Promise<string>;
  approval(id: string): Promise<EApproval | null>;
  /** mises à jour de mémoire validées en Douane et pas encore appliquées */
  pendingMemoryApprovals(): Promise<EApproval[]>;
  markApprovalApplied(id: string, payload: Record<string, unknown>): Promise<void>;
  upsertMemory(cle: string, contenu: string): Promise<void>;
  insertNote(agentId: string, contenu: string): Promise<void>;
  searchNotes(agentId: string, query: string): Promise<string[]>;

  insertUsage(row: { agent_id: string | null; modele: string; tokens_in: number; tokens_out: number; cout_estime: number }): Promise<void>;
  /** coût cumulé (€) depuis une date (YYYY-MM-DD, fuseau Paris) */
  spentSince(day: string): Promise<number>;

  insertChat(agentId: string, role: "fondateur" | "agent", contenu: string, auteur?: string | null): Promise<void>;
  chats(agentId: string, limit: number): Promise<{ role: "fondateur" | "agent"; contenu: string }[]>;
}

// ------------------------------------------------------------------ Supabase
function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
/** lignes d'une requête de liste (jamais null) */
function rows<T>(r: { data: T[] | null; error: { message: string } | null }): T[] {
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}
/** ligne obligatoire (insert … single) */
function one<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  if (r.data === null) throw new Error("Aucune ligne renvoyée");
  return r.data;
}

const parseTask = (t: ETask): ETask => ({ ...t, etapes: Array.isArray(t.etapes) ? t.etapes : [], depend_de: t.depend_de ?? [] });

export function supabaseEngineDb(sb: SupabaseClient): EngineDb {
  return {
    async settings() {
      const s = ok(await sb.from("settings").select("budget_jour, budget_mois, bavardage_actif, signataire").eq("id", 1).maybeSingle());
      return s ? { ...s, budget_jour: Number(s.budget_jour), budget_mois: Number(s.budget_mois) } : { budget_jour: 3, budget_mois: 60, bavardage_actif: true, signataire: "L'équipe MJAGENCY" };
    },
    async poles() {
      return rows(await sb.from("poles").select("id, nom"));
    },
    async memory() {
      return rows(await sb.from("company_memory").select("cle, contenu").order("cle"));
    },
    async agents() {
      return rows(await sb.from("agents").select("*").order("ordre"));
    },
    async agent(id) {
      return ok(await sb.from("agents").select("*").eq("id", id).maybeSingle());
    },
    async updateAgent(id, patch) {
      ok(await sb.from("agents").update(patch).eq("id", id));
    },
    async updateAgents(ids, patch) {
      if (ids.length) ok(await sb.from("agents").update(patch).in("id", ids));
    },
    async agentsToRelax(before) {
      return rows(await sb.from("agents").select("*").in("etat", ["done", "talking", "meeting"]).lt("maj_le", before));
    },
    async newMissions() {
      return rows(await sb.from("missions").select("*").eq("statut", "nouvelle").order("cree_le"));
    },
    async mission(id) {
      return ok(await sb.from("missions").select("*").eq("id", id).maybeSingle());
    },
    async updateMission(id, patch) {
      ok(await sb.from("missions").update(patch).eq("id", id));
    },
    async insertTask(row) {
      return parseTask(one(await sb.from("tasks").insert(row).select("*").single()));
    },
    async updateTask(id, patch) {
      ok(await sb.from("tasks").update(patch).eq("id", id));
    },
    async task(id) {
      const t = ok(await sb.from("tasks").select("*").eq("id", id).maybeSingle());
      return t ? parseTask(t) : null;
    },
    async tasks(ids) {
      if (!ids.length) return [];
      return rows(await sb.from("tasks").select("*").in("id", ids)).map(parseTask);
    },
    async missionTasks(missionId) {
      return rows(await sb.from("tasks").select("*").eq("mission_id", missionId).order("cree_le")).map(parseTask);
    },
    async claimTasks(limit, lockSeconds) {
      return ((ok(await sb.rpc("claim_tasks", { p_limit: limit, p_lock_seconds: lockSeconds })) ?? []) as ETask[]).map(parseTask);
    },
    async waitingTasks() {
      return rows(await sb.from("tasks").select("*").in("statut", ["waiting_tool", "waiting_founder"])).map(parseTask);
    },
    async staleTasks(before) {
      return rows(await sb.from("tasks").select("*").in("statut", ["queued", "running", "waiting_tool", "waiting_founder"]).lt("cree_le", before)).map(parseTask);
    },
    async run(taskId) {
      return ok(await sb.from("task_runs").select("*").eq("task_id", taskId).maybeSingle());
    },
    async saveRun(taskId, patch) {
      return one(await sb.from("task_runs").upsert({ task_id: taskId, ...patch }, { onConflict: "task_id" }).select("*").single());
    },
    async insertMessage(row) {
      ok(await sb.from("agent_messages").insert(row));
    },
    async insertJournal(row) {
      ok(await sb.from("journal").insert({ ...row, titre: row.titre.slice(0, 300) }));
    },
    async journalSince(titre, sinceIso) {
      const r = rows(await sb.from("journal").select("id").eq("titre", titre).gte("cree_le", sinceIso).limit(1));
      return r.length > 0;
    },
    async insertApproval(row) {
      const created = one<{ id: string }>(await sb.from("approvals").insert(row).select("id").single());
      return created.id;
    },
    async approval(id) {
      return ok(await sb.from("approvals").select("*").eq("id", id).maybeSingle());
    },
    async pendingMemoryApprovals() {
      const list: EApproval[] = rows(await sb.from("approvals").select("*").eq("type_action", "memoire").in("statut", ["approuve", "modifie"]));
      return list.filter((r) => !r.payload?.applique);
    },
    async markApprovalApplied(id, payload) {
      ok(await sb.from("approvals").update({ payload: { ...payload, applique: true } }).eq("id", id));
    },
    async upsertMemory(cle, contenu) {
      ok(await sb.from("company_memory").upsert({ id: `mem_${cle}`, cle, contenu }, { onConflict: "cle" }));
    },
    async insertNote(agentId, contenu) {
      ok(await sb.from("agent_notes").insert({ agent_id: agentId, contenu }));
    },
    async searchNotes(agentId, query) {
      const r = rows(await sb.from("agent_notes").select("contenu").eq("agent_id", agentId).ilike("contenu", `%${query.replace(/[%_]/g, "")}%`).limit(10));
      return r.map((x: { contenu: string }) => x.contenu);
    },
    async insertUsage(row) {
      ok(await sb.from("usage").insert(row));
    },
    async spentSince(day) {
      const r = rows(await sb.from("usage").select("cout_estime").gte("date", day));
      return r.reduce((s: number, x: { cout_estime: number | string }) => s + Number(x.cout_estime), 0);
    },
    async insertChat(agentId, role, contenu, auteur) {
      ok(await sb.from("agent_chats").insert({ agent_id: agentId, role, contenu, auteur: auteur ?? null }));
    },
    async chats(agentId, limit) {
      const r = rows(await sb.from("agent_chats").select("role, contenu, cree_le").eq("agent_id", agentId).order("cree_le", { ascending: false }).limit(limit));
      return r.reverse().map((x: { role: "fondateur" | "agent"; contenu: string }) => ({ role: x.role, contenu: x.contenu }));
    },
  };
}
