import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseCommercialDb, type CommercialDb } from "@/commercial/db";
import { supabaseFinanceDb, type FinanceDb } from "@/finance/db";
import { lireBoutique, type ReglagesBoutique } from "@/boutique/shopify";
import { supabaseTechDb, type TechDb } from "@/tech/db";
import { lireTelegram, type ChatTelegram } from "@/integrations/telegram";
import { lireModeIa, type ModeIa } from "./cerveau";
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
  resultat: { texte?: string; erreur?: string; rapport?: unknown; envoye_le?: string } | null;
  profondeur: number;
  depend_de: string[];
  pas_avant: string | null;
  locked_until: string | null;
  cree_le: string;
  maj_le: string;
  /** qui fait la tâche : moteur (clé API) ou Claude Code (abonnement) */
  executeur?: "api" | "claude";
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
  responsable?: boolean;
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
  /** numéro WhatsApp du fondateur si la mission est venue de WhatsApp */
  whatsapp?: string | null;
  whatsapp_envoye_le?: string | null;
  /** chat Telegram du fondateur si la mission est venue de Telegram */
  telegram?: string | null;
  telegram_envoye_le?: string | null;
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
  destinataire?: string | null;
  objet?: string | null;
  execution_statut?: ExecutionStatut | null;
  cree_le?: string;
}

export type ExecutionStatut = "a_faire" | "en_cours" | "fait" | "echec" | "simule" | "annule";

export interface EEmail {
  id: string;
  thread_id: string | null;
  compte: string;
  de: string;
  a: string;
  objet: string;
  extrait: string;
  recu_le: string | null;
  categorie?: string | null;
  resume?: string | null;
  urgence?: number;
  statut: "a_trier" | "trie" | "traite";
  task_id?: string | null;
  demo: boolean;
}

export interface ESettings {
  budget_jour: number;
  budget_mois: number;
  bavardage_actif: boolean;
  signataire: string;
  allowlist_emails: string[];
  contraintes_agenda: { jeremy?: string; matheis?: string };
  autonomie: Autonomie;
  recap_destinataires: string[];
}

export interface ERoutine {
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
  derniere_execution: string | null;
}

/** Mode autonome : les agents envoient sans attendre la Douane (envoi différé et annulable). */
export interface Autonomie {
  actif: boolean;
  types: string[];
  delai_minutes: number;
  plafond_jour: number;
}

export const AUTONOMIE_DEFAUT: Autonomie = { actif: false, types: ["email", "relance", "rdv"], delai_minutes: 5, plafond_jour: 30 };
export const lireAutonomie = (v: unknown): Autonomie => ({ ...AUTONOMIE_DEFAUT, ...((v && typeof v === "object" ? v : {}) as Partial<Autonomie>) });

export interface EngineDb {
  /** finance (factures, devis, paiements, abonnements) */
  finance: FinanceDb;
  /** prospection et pipeline commercial */
  commercial: CommercialDb;
  /** Atelier Tech : sites clients suivis */
  tech: TechDb;
  /** réglages de la boutique (seuil de stock, délai d'expédition) */
  reglagesBoutique(): Promise<ReglagesBoutique>;
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
  /** missions venues de WhatsApp ou Telegram, terminées ou annulées, dont le résultat n'est pas encore renvoyé */
  missionsARenvoyer(): Promise<EMission[]>;
  /** chats Telegram reliés et niveau des notifications push */
  canaux(): Promise<{ telegram: Record<string, ChatTelegram>; niveau: "tout" | "important" }>;
  /** toutes les entrées du Journal depuis une date (ordre chronologique) */
  journalDepuis(iso: string, limit: number, jusqua?: string): Promise<{ type: string; titre: string; contenu: string | null; agent_id: string | null; pole_id: string | null; cree_le: string }[]>;

  insertTask(row: Partial<ETask> & { titre: string }): Promise<ETask>;
  updateTask(id: string, patch: Partial<ETask>): Promise<void>;
  task(id: string): Promise<ETask | null>;
  tasks(ids: string[]): Promise<ETask[]>;
  /** tâches d'une même mission (sous-tâches visibles par un agent) */
  missionTasks(missionId: string): Promise<ETask[]>;
  claimTasks(limit: number, lockSeconds: number): Promise<ETask[]>;
  /** tâches confiées à Claude Code (abonnement), réservées pour lui */
  claimTasksClaude(limit: number, lockSeconds: number): Promise<ETask[]>;
  /** Claude Code ne passe plus : ses tâches reviennent au moteur (clé API) */
  rendreTachesClaude(): Promise<number>;
  /** nombre de tâches qui attendent Claude Code */
  tachesClaudeEnAttente(): Promise<number>;
  modeIa(): Promise<ModeIa>;
  waitingTasks(): Promise<ETask[]>;
  /** tâches non terminées créées avant `before` */
  staleTasks(before: string): Promise<ETask[]>;

  run(taskId: string): Promise<ERun | null>;
  saveRun(taskId: string, patch: Partial<ERun>): Promise<ERun>;

  insertMessage(row: { conversation_id?: string | null; from_agent: string | null; to_agent: string | null; task_id?: string | null; type: "question" | "reponse" | "delegation" | "livrable" | "bavardage"; contenu: string; resume_bulle: string | null }): Promise<void>;
  insertJournal(row: { type: string; titre: string; contenu?: string | null; agent_id?: string | null; pole_id?: string | null }): Promise<void>;
  journalSince(titre: string, sinceIso: string): Promise<boolean>;
  insertApproval(row: { agent_id: string; task_id: string | null; type_action: string; titre: string; apercu: string; destinataire?: string | null; objet?: string | null; payload?: Record<string, unknown>; execution_statut?: ExecutionStatut | null; statut?: EApproval["statut"]; decide_par?: string | null }): Promise<string>;
  /** envois validés (ou refusés) dont l'exécution n'est pas encore traitée */
  approvalsToExecute(): Promise<EApproval[]>;
  /** réserve l'exécution d'un envoi (a_faire → en_cours) ; false si un autre tick l'a déjà pris */
  claimApprovalExecution(id: string): Promise<boolean>;
  finishApprovalExecution(id: string, statut: ExecutionStatut, execution: Record<string, unknown>): Promise<void>;
  /** règle « Toujours autoriser » active pour cet agent et ce type d'action */
  hasAutonomyRule(agentId: string, type: string): Promise<boolean>;
  /** envois partis sans clic d'un fondateur (règle ou mode autonome) depuis… */
  countAutoSendsSince(iso: string): Promise<number>;

  kvGet<T = unknown>(cle: string): Promise<T | null>;
  kvSet(cle: string, valeur: unknown): Promise<void>;
  routineActive(id: string): Promise<boolean>;
  activeRoutines(): Promise<ERoutine[]>;
  routine(id: string): Promise<ERoutine | null>;
  /** réserve une exécution de routine (derniere_execution < before) ; false si déjà faite */
  claimRoutine(id: string, beforeIso: string, nowIso: string): Promise<boolean>;
  /** réserve un créneau (clé dont la dernière mise à jour est antérieure à olderThanIso) */
  kvClaim(cle: string, valeur: unknown, olderThanIso: string, nowIso: string): Promise<boolean>;

  // ---- lectures pour les récaps
  pendingApprovals(): Promise<EApproval[]>;
  journalParType(type: string, iso: string, limit: number): Promise<{ titre: string; contenu: string | null; cree_le: string }[]>;
  emailsSince(iso: string): Promise<EEmail[]>;
  tasksDoneSince(iso: string, limit: number): Promise<ETask[]>;
  openTasks(limit: number): Promise<ETask[]>;
  /** comptes rendus de routine à envoyer par mail (récap, rapport hebdo) */
  reportsToSend(prefixes: string[], sinceIso: string): Promise<ETask[]>;
  /** une tâche non terminée de cet agent dont le titre commence par… */
  hasOpenTask(agentId: string, titrePrefix: string): Promise<boolean>;

  knownEmailIds(ids: string[]): Promise<string[]>;
  insertEmails(rows: Omit<EEmail, "statut">[]): Promise<void>;
  email(id: string): Promise<EEmail | null>;
  updateEmail(id: string, patch: Partial<EEmail>): Promise<void>;
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
    finance: supabaseFinanceDb(sb),
    commercial: supabaseCommercialDb(sb),
    tech: supabaseTechDb(sb),
    async reglagesBoutique() {
      const s = ok(await sb.from("settings").select("boutique").eq("id", 1).maybeSingle());
      return lireBoutique(s?.boutique);
    },
    async settings() {
      const s = ok(await sb.from("settings").select("*").eq("id", 1).maybeSingle());
      return s
        ? { ...s, budget_jour: Number(s.budget_jour), budget_mois: Number(s.budget_mois), allowlist_emails: s.allowlist_emails ?? [], contraintes_agenda: s.contraintes_agenda ?? {}, autonomie: lireAutonomie(s.autonomie), recap_destinataires: s.recap_destinataires ?? [] }
        : { budget_jour: 3, budget_mois: 60, bavardage_actif: true, signataire: "L'équipe MJAGENCY", allowlist_emails: [], contraintes_agenda: {}, autonomie: AUTONOMIE_DEFAUT, recap_destinataires: [] };
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
    async missionsARenvoyer() {
      return rows(
        await sb
          .from("missions")
          .select("*")
          .in("statut", ["terminee", "annulee"])
          .or("and(whatsapp.not.is.null,whatsapp_envoye_le.is.null),and(telegram.not.is.null,telegram_envoye_le.is.null)")
          .limit(10),
      );
    },
    async canaux() {
      const s = ok(await sb.from("settings").select("telegram, notifications").eq("id", 1).maybeSingle());
      return { telegram: lireTelegram(s?.telegram).chats, niveau: (s?.notifications as { niveau?: string } | null)?.niveau === "important" ? "important" : "tout" };
    },
    async journalDepuis(iso, limit, jusqua) {
      let q = sb.from("journal").select("type, titre, contenu, agent_id, pole_id, cree_le").gt("cree_le", iso).order("cree_le").limit(limit);
      if (jusqua) q = q.lte("cree_le", jusqua);
      return rows(await q);
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
    async claimTasksClaude(limit, lockSeconds) {
      return ((ok(await sb.rpc("claim_tasks_claude", { p_limit: limit, p_lock_seconds: lockSeconds })) ?? []) as ETask[]).map(parseTask);
    },
    async rendreTachesClaude() {
      const r = rows(await sb.from("tasks").update({ executeur: "api", locked_until: null }).eq("executeur", "claude").in("statut", ["queued", "running"]).or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`).select("id"));
      return r.length;
    },
    async tachesClaudeEnAttente() {
      const r = await sb.from("tasks").select("id", { count: "exact", head: true }).eq("executeur", "claude").in("statut", ["queued", "running"]);
      return r.count ?? 0;
    },
    async modeIa() {
      const s = ok(await sb.from("settings").select("ia").eq("id", 1).maybeSingle());
      return lireModeIa(s?.ia);
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
    async approvalsToExecute() {
      return rows(await sb.from("approvals").select("*").eq("execution_statut", "a_faire").neq("statut", "en_attente").order("decide_le").limit(20));
    },
    async claimApprovalExecution(id) {
      const r = rows(await sb.from("approvals").update({ execution_statut: "en_cours" }).eq("id", id).eq("execution_statut", "a_faire").select("id"));
      return r.length > 0;
    },
    async finishApprovalExecution(id, statut, execution) {
      ok(await sb.from("approvals").update({ execution_statut: statut, execution, execute_le: new Date().toISOString() }).eq("id", id));
    },
    async countAutoSendsSince(iso) {
      const r = await sb.from("approvals").select("id", { count: "exact", head: true }).in("decide_par", ["mode autonome", "règle d'autonomie"]).gte("cree_le", iso);
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    },
    async hasAutonomyRule(agentId, type) {
      const r = rows(await sb.from("autonomy_rules").select("id").eq("agent_id", agentId).eq("type_action", type).eq("actif", true).limit(1));
      return r.length > 0;
    },
    async kvGet(cle) {
      const r = ok(await sb.from("engine_kv").select("valeur").eq("cle", cle).maybeSingle());
      return (r?.valeur ?? null) as never;
    },
    async kvSet(cle, valeur) {
      ok(await sb.from("engine_kv").upsert({ cle, valeur, maj_le: new Date().toISOString() }, { onConflict: "cle" }));
    },
    async routineActive(id) {
      const r = ok(await sb.from("routines").select("actif").eq("id", id).maybeSingle());
      return r ? !!r.actif : true;
    },
    async activeRoutines() {
      return rows(await sb.from("routines").select("*").eq("actif", true));
    },
    async routine(id) {
      return ok(await sb.from("routines").select("*").eq("id", id).maybeSingle());
    },
    async claimRoutine(id, beforeIso, nowIso) {
      const r = rows(await sb.from("routines").update({ derniere_execution: nowIso }).eq("id", id).or(`derniere_execution.is.null,derniere_execution.lt.${beforeIso}`).select("id"));
      return r.length > 0;
    },
    async kvClaim(cle, valeur, olderThanIso, nowIso) {
      ok(await sb.from("engine_kv").upsert({ cle, valeur: {}, maj_le: "1970-01-01T00:00:00Z" }, { onConflict: "cle", ignoreDuplicates: true }));
      const r = rows(await sb.from("engine_kv").update({ valeur, maj_le: nowIso }).eq("cle", cle).lt("maj_le", olderThanIso).select("cle"));
      return r.length > 0;
    },
    async pendingApprovals() {
      return rows(await sb.from("approvals").select("*").eq("statut", "en_attente").order("cree_le").limit(50));
    },
    async journalParType(type, iso, limit) {
      return rows(await sb.from("journal").select("titre, contenu, cree_le").eq("type", type).gt("cree_le", iso).order("cree_le").limit(limit));
    },
    async emailsSince(iso) {
      return rows(await sb.from("emails").select("*").gte("recu_le", iso).order("recu_le", { ascending: false }).limit(60));
    },
    async tasksDoneSince(iso, limit) {
      return rows<ETask>(await sb.from("tasks").select("*").eq("statut", "done").gte("maj_le", iso).order("maj_le", { ascending: false }).limit(limit)).map(parseTask);
    },
    async openTasks(limit) {
      return rows<ETask>(await sb.from("tasks").select("*").in("statut", ["queued", "running", "waiting_tool", "waiting_approval", "waiting_founder"]).order("priorite", { ascending: false }).limit(limit)).map(parseTask);
    },
    async reportsToSend(prefixes, sinceIso) {
      const list = rows<ETask>(await sb.from("tasks").select("*").eq("statut", "done").eq("cree_par", "routine").gte("maj_le", sinceIso).limit(20)).map(parseTask);
      return list.filter((t) => prefixes.some((p) => t.titre.startsWith(p)) && !t.resultat?.envoye_le);
    },
    async hasOpenTask(agentId, titrePrefix) {
      const r = rows(
        await sb.from("tasks").select("id").eq("agent_id", agentId).like("titre", `${titrePrefix.replace(/[%_]/g, "")}%`).in("statut", ["queued", "running", "waiting_tool", "waiting_approval", "waiting_founder"]).limit(1),
      );
      return r.length > 0;
    },
    async knownEmailIds(ids) {
      if (!ids.length) return [];
      return rows<{ id: string }>(await sb.from("emails").select("id").in("id", ids)).map((r) => r.id);
    },
    async insertEmails(list) {
      if (list.length) ok(await sb.from("emails").upsert(list, { onConflict: "id", ignoreDuplicates: true }));
    },
    async email(id) {
      return ok(await sb.from("emails").select("*").eq("id", id).maybeSingle());
    },
    async updateEmail(id, patch) {
      ok(await sb.from("emails").update({ ...patch, maj_le: new Date().toISOString() }).eq("id", id));
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
