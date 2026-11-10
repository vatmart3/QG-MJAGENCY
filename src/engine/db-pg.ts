import type { Pool } from "pg";
import type { EAgent, EApproval, EMission, ERun, ETask, EngineDb } from "./db";

/**
 * Implémentation Postgres directe du moteur (tests d'intégration en local,
 * ou hébergement sans PostgREST). Mêmes tables et même fonction claim_tasks que Supabase.
 */

const cols = (patch: Record<string, unknown>): [string, unknown[]] => {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return [keys.map((k, i) => `"${k}" = $${i + 1}`).join(", "), keys.map((k) => jsonify(patch[k]))];
};

/** objets/tableaux d'objets → JSON (colonnes jsonb) ; tableaux simples → tableaux Postgres */
function jsonify(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.some((x) => typeof x === "object" && x !== null) ? JSON.stringify(v) : v;
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

const JSON_ARRAY_COLS = new Set(["etapes", "messages", "attente", "resultats_en_suspens", "plan"]);
function fixJsonArrays(row: Record<string, unknown>): Record<string, unknown> {
  // une colonne jsonb qui reçoit un tableau vide doit être envoyée en JSON, pas en tableau Postgres
  for (const k of Object.keys(row)) if (JSON_ARRAY_COLS.has(k) && Array.isArray(row[k])) row[k] = JSON.stringify(row[k]);
  return row;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const normTask = (t: Record<string, unknown>): ETask =>
  ({ ...t, cree_le: iso(t.cree_le), maj_le: iso(t.maj_le), pas_avant: t.pas_avant ? iso(t.pas_avant) : null, locked_until: t.locked_until ? iso(t.locked_until) : null, etapes: (t.etapes as ETask["etapes"]) ?? [], depend_de: (t.depend_de as string[]) ?? [] }) as ETask;
const normAgent = (a: Record<string, unknown>): EAgent => ({ ...a, maj_le: iso(a.maj_le) }) as EAgent;

export function pgEngineDb(pool: Pool): EngineDb {
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

  const update = async (table: string, where: string, whereParams: unknown[], patch: Record<string, unknown>) => {
    const [set, vals] = cols(fixJsonArrays({ ...patch }));
    if (!set) return;
    const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + vals.length}`);
    await q(`update public.${table} set ${set} where ${shifted}`, [...vals, ...whereParams]);
  };
  const insert = async (table: string, row: Record<string, unknown>) => {
    const r = fixJsonArrays({ ...row });
    const keys = Object.keys(r).filter((k) => r[k] !== undefined);
    const rows = await q(
      `insert into public.${table} (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
      keys.map((k) => jsonify(r[k])),
    );
    return rows[0]!;
  };

  return {
    async settings() {
      const [s] = await q<{ budget_jour: string; budget_mois: string; bavardage_actif: boolean; signataire: string }>("select * from public.settings where id = 1");
      return s ? { budget_jour: Number(s.budget_jour), budget_mois: Number(s.budget_mois), bavardage_actif: s.bavardage_actif, signataire: s.signataire } : { budget_jour: 3, budget_mois: 60, bavardage_actif: true, signataire: "L'équipe MJAGENCY" };
    },
    poles: () => q("select id, nom from public.poles"),
    memory: () => q("select cle, contenu from public.company_memory order by cle"),
    async agents() {
      return (await q("select * from public.agents order by ordre")).map(normAgent);
    },
    async agent(id) {
      const [a] = await q("select * from public.agents where id = $1", [id]);
      return a ? normAgent(a) : null;
    },
    updateAgent: (id, patch) => update("agents", "id = $1", [id], patch as Record<string, unknown>),
    async updateAgents(ids, patch) {
      if (ids.length) await update("agents", "id = any($1)", [ids], patch as Record<string, unknown>);
    },
    async agentsToRelax(before) {
      return (await q("select * from public.agents where etat in ('done','talking','meeting') and maj_le < $1", [before])).map(normAgent);
    },
    async newMissions() {
      return (await q("select * from public.missions where statut = 'nouvelle' order by cree_le")) as unknown as EMission[];
    },
    async mission(id) {
      const [m] = await q("select * from public.missions where id = $1", [id]);
      return (m as unknown as EMission) ?? null;
    },
    updateMission: (id, patch) => update("missions", "id = $1", [id], patch as Record<string, unknown>),
    async insertTask(row) {
      return normTask(await insert("tasks", row as Record<string, unknown>));
    },
    updateTask: (id, patch) => update("tasks", "id = $1", [id], patch as Record<string, unknown>),
    async task(id) {
      const [t] = await q("select * from public.tasks where id = $1", [id]);
      return t ? normTask(t) : null;
    },
    async tasks(ids) {
      return ids.length ? (await q("select * from public.tasks where id = any($1)", [ids])).map(normTask) : [];
    },
    async missionTasks(missionId) {
      return (await q("select * from public.tasks where mission_id = $1 order by cree_le", [missionId])).map(normTask);
    },
    async claimTasks(limit, lockSeconds) {
      return (await q("select * from public.claim_tasks($1, $2)", [limit, lockSeconds])).map(normTask);
    },
    async waitingTasks() {
      return (await q("select * from public.tasks where statut in ('waiting_tool','waiting_founder')")).map(normTask);
    },
    async staleTasks(before) {
      return (await q("select * from public.tasks where statut in ('queued','running','waiting_tool','waiting_founder') and cree_le < $1", [before])).map(normTask);
    },
    async run(taskId) {
      const [r] = await q("select * from public.task_runs where task_id = $1", [taskId]);
      return (r as unknown as ERun) ?? null;
    },
    async saveRun(taskId, patch) {
      const existing = await this.run(taskId);
      if (existing) {
        await update("task_runs", "task_id = $1", [taskId], patch as Record<string, unknown>);
        return (await this.run(taskId))!;
      }
      return (await insert("task_runs", { task_id: taskId, ...patch })) as unknown as ERun;
    },
    async insertMessage(row) {
      await insert("agent_messages", row as Record<string, unknown>);
    },
    async insertJournal(row) {
      await insert("journal", { ...row, titre: row.titre.slice(0, 300) });
    },
    async journalSince(titre, sinceIso) {
      return (await q("select 1 from public.journal where titre = $1 and cree_le >= $2 limit 1", [titre, sinceIso])).length > 0;
    },
    async insertApproval(row) {
      return String((await insert("approvals", row as Record<string, unknown>)).id);
    },
    async approval(id) {
      const [a] = await q("select * from public.approvals where id = $1", [id]);
      return (a as unknown as EApproval) ?? null;
    },
    async pendingMemoryApprovals() {
      return (await q("select * from public.approvals where type_action = 'memoire' and statut in ('approuve','modifie') and not coalesce((payload->>'applique')::boolean, false)")) as unknown as EApproval[];
    },
    markApprovalApplied: (id, payload) => update("approvals", "id = $1", [id], { payload: { ...payload, applique: true } }),
    async upsertMemory(cle, contenu) {
      await q("insert into public.company_memory (id, cle, contenu) values ($1, $2, $3) on conflict (cle) do update set contenu = excluded.contenu", [`mem_${cle}`, cle, contenu]);
    },
    async insertNote(agentId, contenu) {
      await insert("agent_notes", { agent_id: agentId, contenu });
    },
    async searchNotes(agentId, query) {
      return (await q<{ contenu: string }>("select contenu from public.agent_notes where agent_id = $1 and contenu ilike $2 limit 10", [agentId, `%${query}%`])).map((r) => r.contenu);
    },
    async insertUsage(row) {
      await insert("usage", row as Record<string, unknown>);
    },
    async spentSince(day) {
      const [r] = await q<{ s: string | null }>("select sum(cout_estime) as s from public.usage where date >= $1", [day]);
      return Number(r?.s ?? 0);
    },
    async insertChat(agentId, role, contenu, auteur) {
      await insert("agent_chats", { agent_id: agentId, role, contenu, auteur: auteur ?? null });
    },
    async chats(agentId, limit) {
      const r = await q<{ role: "fondateur" | "agent"; contenu: string }>("select role, contenu from public.agent_chats where agent_id = $1 order by cree_le desc limit $2", [agentId, limit]);
      return r.reverse();
    },
  };
}
