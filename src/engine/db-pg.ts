import type { Pool } from "pg";
import type { FinanceDb } from "@/finance/db";
import { lireFinance, num, type Client, type Invoice, type Ligne, type Payment, type Quote, type Subscription } from "@/finance/types";
import { AUTONOMIE_DEFAUT, lireAutonomie, type ERoutine, type EAgent, type EApproval, type EEmail, type EMission, type ERun, type ETask, type EngineDb } from "./db";

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
    finance: pgFinanceDb(q),
    async settings() {
      const [s] = await q<{ budget_jour: string; budget_mois: string; bavardage_actif: boolean; signataire: string; allowlist_emails: string[]; contraintes_agenda: { jeremy?: string; matheis?: string }; autonomie: unknown }>("select * from public.settings where id = 1");
      return s
        ? { budget_jour: Number(s.budget_jour), budget_mois: Number(s.budget_mois), bavardage_actif: s.bavardage_actif, signataire: s.signataire, allowlist_emails: s.allowlist_emails ?? [], contraintes_agenda: s.contraintes_agenda ?? {}, autonomie: lireAutonomie(s.autonomie), recap_destinataires: (s as { recap_destinataires?: string[] }).recap_destinataires ?? [] }
        : { budget_jour: 3, budget_mois: 60, bavardage_actif: true, signataire: "L'équipe MJAGENCY", allowlist_emails: [], contraintes_agenda: {}, autonomie: AUTONOMIE_DEFAUT, recap_destinataires: [] };
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
    async approvalsToExecute() {
      return (await q("select * from public.approvals where execution_statut = 'a_faire' and statut <> 'en_attente' order by decide_le nulls first limit 20")) as unknown as EApproval[];
    },
    async claimApprovalExecution(id) {
      return (await q("update public.approvals set execution_statut = 'en_cours' where id = $1 and execution_statut = 'a_faire' returning id", [id])).length > 0;
    },
    finishApprovalExecution: (id, statut, execution) => update("approvals", "id = $1", [id], { execution_statut: statut, execution, execute_le: new Date().toISOString() }),
    async countAutoSendsSince(iso) {
      const [r] = await q<{ n: string }>("select count(*) as n from public.approvals where decide_par in ('mode autonome', 'règle d''autonomie') and cree_le >= $1", [iso]);
      return Number(r?.n ?? 0);
    },
    async hasAutonomyRule(agentId, type) {
      return (await q("select 1 from public.autonomy_rules where agent_id = $1 and type_action = $2 and actif limit 1", [agentId, type])).length > 0;
    },
    async kvGet(cle) {
      const [r] = await q<{ valeur: unknown }>("select valeur from public.engine_kv where cle = $1", [cle]);
      return (r?.valeur ?? null) as never;
    },
    async kvSet(cle, valeur) {
      await q("insert into public.engine_kv (cle, valeur, maj_le) values ($1, $2, now()) on conflict (cle) do update set valeur = excluded.valeur, maj_le = now()", [cle, JSON.stringify(valeur)]);
    },
    async activeRoutines() {
      return (await q("select *, to_char(heure, 'HH24:MI') as heure, to_char(plage_debut, 'HH24:MI') as plage_debut, to_char(plage_fin, 'HH24:MI') as plage_fin from public.routines where actif")).map((r) => ({
        ...r,
        derniere_execution: r.derniere_execution ? iso(r.derniere_execution) : null,
      })) as unknown as ERoutine[];
    },
    async routine(id) {
      const [r] = await q("select *, to_char(heure, 'HH24:MI') as heure, to_char(plage_debut, 'HH24:MI') as plage_debut, to_char(plage_fin, 'HH24:MI') as plage_fin from public.routines where id = $1", [id]);
      return (r as unknown as ERoutine) ?? null;
    },
    async claimRoutine(id, beforeIso, nowIso) {
      return (await q("update public.routines set derniere_execution = $3 where id = $1 and (derniere_execution is null or derniere_execution < $2) returning id", [id, beforeIso, nowIso])).length > 0;
    },
    async kvClaim(cle, valeur, olderThanIso, nowIso) {
      await q("insert into public.engine_kv (cle, valeur, maj_le) values ($1, '{}', 'epoch') on conflict (cle) do nothing", [cle]);
      return (await q("update public.engine_kv set valeur = $2, maj_le = $4 where cle = $1 and maj_le < $3 returning cle", [cle, JSON.stringify(valeur), olderThanIso, nowIso])).length > 0;
    },
    async pendingApprovals() {
      return (await q("select * from public.approvals where statut = 'en_attente' order by cree_le limit 50")) as unknown as EApproval[];
    },
    async emailsSince(since) {
      return (await q("select * from public.emails where recu_le >= $1 order by recu_le desc limit 60", [since])) as unknown as EEmail[];
    },
    async tasksDoneSince(since, limit) {
      return (await q("select * from public.tasks where statut = 'done' and maj_le >= $1 order by maj_le desc limit $2", [since, limit])).map(normTask);
    },
    async openTasks(limit) {
      return (await q("select * from public.tasks where statut in ('queued','running','waiting_tool','waiting_approval','waiting_founder') order by priorite desc limit $1", [limit])).map(normTask);
    },
    async reportsToSend(prefixes, since) {
      const list = (await q("select * from public.tasks where statut = 'done' and cree_par = 'routine' and maj_le >= $1 and (resultat->>'envoye_le') is null limit 20", [since])).map(normTask);
      return list.filter((t) => prefixes.some((p) => t.titre.startsWith(p)));
    },
    async routineActive(id) {
      const [r] = await q<{ actif: boolean }>("select actif from public.routines where id = $1", [id]);
      return r ? r.actif : true;
    },
    async hasOpenTask(agentId, titrePrefix) {
      return (await q("select 1 from public.tasks where agent_id = $1 and starts_with(titre, $2) and statut in ('queued','running','waiting_tool','waiting_approval','waiting_founder') limit 1", [agentId, titrePrefix])).length > 0;
    },
    async knownEmailIds(ids) {
      if (!ids.length) return [];
      return (await q<{ id: string }>("select id from public.emails where id = any($1)", [ids])).map((r) => r.id);
    },
    async insertEmails(list) {
      for (const e of list) await q("insert into public.emails (id, thread_id, compte, de, a, objet, extrait, recu_le, demo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing", [e.id, e.thread_id, e.compte, e.de, e.a, e.objet, e.extrait, e.recu_le, e.demo]);
    },
    async email(id) {
      const [r] = await q("select * from public.emails where id = $1", [id]);
      return (r as unknown as EEmail) ?? null;
    },
    updateEmail: (id, patch) => update("emails", "id = $1", [id], { ...patch, maj_le: new Date().toISOString() }),
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

// ------------------------------------------------------------------ finance (tests)
type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const pInv = (r: Record<string, unknown>): Invoice => ({ ...(r as unknown as Invoice), total: num(r.total), lignes: (r.lignes as Ligne[]) ?? [], emis_le: d10(r.emis_le), echeance: d10(r.echeance), paye_le: d10(r.paye_le), cree_le: String(r.cree_le) });
const pQuo = (r: Record<string, unknown>): Quote => ({ ...(r as unknown as Quote), total: num(r.total), lignes: (r.lignes as Ligne[]) ?? [], emis_le: d10(r.emis_le), valable_jusqu: d10(r.valable_jusqu), cree_le: String(r.cree_le) });
const pPay = (r: Record<string, unknown>): Payment => ({ ...(r as unknown as Payment), montant: num(r.montant), date: d10(r.date)! });

function pgFinanceDb(q: Q): FinanceDb {
  const ins = async (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const vals = keys.map((k) => (typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k]));
    const [r] = await q(`insert into public.${table} (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`, vals);
    return r!;
  };
  const upd = async (table: string, id: string, patch: Record<string, unknown>) => {
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (!keys.length) return;
    const vals = keys.map((k) => (typeof patch[k] === "object" && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]));
    await q(`update public.${table} set ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(",")} where id = $${keys.length + 1}`, [...vals, id]);
  };
  return {
    async settings() {
      const [s] = await q<{ finance: unknown }>("select finance from public.settings where id = 1");
      return lireFinance(s?.finance);
    },
    async clients(recherche) {
      return (await q(recherche ? "select * from public.clients where nom ilike $1 order by nom" : "select * from public.clients order by nom", recherche ? [`%${recherche}%`] : [])) as unknown as Client[];
    },
    async client(id) {
      const [r] = await q("select * from public.clients where id = $1", [id]);
      return (r as unknown as Client) ?? null;
    },
    async insertClient(c) {
      return (await ins("clients", c as Record<string, unknown>)) as unknown as Client;
    },
    async invoice(id) {
      const [r] = await q("select * from public.invoices where id = $1", [id]);
      return r ? pInv(r) : null;
    },
    async invoiceByNumero(n) {
      const [r] = await q("select * from public.invoices where numero = $1", [n]);
      return r ? pInv(r) : null;
    },
    async quote(id) {
      const [r] = await q("select * from public.quotes where id = $1", [id]);
      return r ? pQuo(r) : null;
    },
    async quoteByNumero(n) {
      const [r] = await q("select * from public.quotes where numero = $1", [n]);
      return r ? pQuo(r) : null;
    },
    async insertInvoice(row) {
      return pInv(await ins("invoices", row as Record<string, unknown>));
    },
    async insertQuote(row) {
      return pQuo(await ins("quotes", row as Record<string, unknown>));
    },
    updateInvoice: (id, patch) => upd("invoices", id, patch as Record<string, unknown>),
    updateQuote: (id, patch) => upd("quotes", id, patch as Record<string, unknown>),
    async emettre(kind, id) {
      const [r] = await q<{ n: string }>(`select public.${kind === "facture" ? "emettre_facture" : "emettre_devis"}($1) as n`, [id]);
      return r!.n;
    },
    async avoir(id, motif) {
      const [r] = await q<{ n: string }>("select public.creer_avoir($1, $2, null) as n", [id, motif]);
      return r!.n;
    },
    async insertPayment(p) {
      await ins("payments", p as Record<string, unknown>);
    },
    async invoicesSince(date) {
      return (await q("select * from public.invoices where statut <> 'brouillon' and emis_le >= $1 order by emis_le", [date])).map(pInv);
    },
    async openInvoices() {
      return (await q("select * from public.invoices where type = 'facture' and statut in ('emise','envoyee') order by echeance")).map(pInv);
    },
    async payments(since) {
      return (await q("select * from public.payments where date >= $1 order by date", [since])).map(pPay);
    },
    async paymentsOf(id) {
      return (await q("select * from public.payments where invoice_id = $1", [id])).map(pPay);
    },
    async subscriptions() {
      return (await q("select * from public.subscriptions order by libelle")).map((s) => ({ ...(s as unknown as Subscription), montant: num(s.montant), debut: d10(s.debut)!, fin: d10(s.fin) }));
    },
    async markSubscription(id, mois) {
      return (await q("update public.subscriptions set dernier_mois = $2 where id = $1 and (dernier_mois is null or dernier_mois < $2) returning id", [id, mois])).length > 0;
    },
  };
}
