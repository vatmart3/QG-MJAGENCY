"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { catalogStore, setCatalog } from "@/data/catalog";
import { liveRepo, setRepo, traduireErreur } from "@/data/repo";
import type { AgentState } from "@/data/types";
import {
  agentFromRow,
  approvalFromRow,
  journalFromRow,
  memoryFromRow,
  missionFromRow,
  poleFromRow,
  routineFromRow,
  runtimeFromRow,
  settingsFromRow,
  taskFromRow,
  type AgentRow,
  type ApprovalRow,
  type JournalRow,
  type MemoryRow,
  type MessageRow,
  type MissionRow,
  type PoleRow,
  type RoutineRow,
  type SettingsRow,
  type TaskRow,
} from "@/lib/supabase/rows";
import { getDirector, type LiveAdapter } from "@/sim/director";
import { uiStore } from "@/store/ui";
import { world } from "@/store/world";

/**
 * Mode « direct » : charge l'état depuis Supabase puis écoute Realtime
 * (agents, agent_messages, approvals, journal, tasks, missions). La ville reflète la base.
 */

export type LiveStart = { ok: true; stop: () => void } | { ok: false; reason: "non_connecte" | "non_autorise" | "erreur"; message: string };

const agentRows = new Map<string, AgentRow>();
const taskRows = new Map<string, TaskRow>();

function refreshRuntime(id: string): void {
  const r = agentRows.get(id);
  if (!r) return;
  const task = r.tache_courante_id ? taskRows.get(r.tache_courante_id) : undefined;
  const rt = runtimeFromRow(r, task, null);
  world.patchAgent(id, rt);
}

export async function startLive(sb: SupabaseClient): Promise<LiveStart> {
  uiStore.setState({ conn: "connexion" });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { ok: false, reason: "non_connecte", message: "Session expirée." };
  const email = (auth.user.email ?? "").toLowerCase();
  uiStore.setState({ userEmail: email });

  const allowed = await sb.rpc("is_allowed");
  if (allowed.error) return { ok: false, reason: "erreur", message: traduireErreur(allowed.error.message) };
  if (allowed.data !== true) return { ok: false, reason: "non_autorise", message: `${email} n'est pas dans l'allowlist du port.` };

  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const [poles, agents, settings, memory, routines, tasks, running, approvals, journal, missions] = await Promise.all([
    sb.from("poles").select("*").order("ordre"),
    sb.from("agents").select("*").order("ordre"),
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("company_memory").select("*").order("cle"),
    sb.from("routines").select("*").order("heure"),
    sb.from("tasks").select("*").gte("cree_le", since).order("cree_le", { ascending: false }).limit(300),
    sb.from("tasks").select("*").in("statut", ["queued", "running", "waiting_tool", "waiting_approval", "waiting_founder"]).limit(300),
    sb.from("approvals").select("*").eq("statut", "en_attente").order("cree_le"),
    sb.from("journal").select("*").order("cree_le", { ascending: false }).limit(250),
    sb.from("missions").select("*").order("cree_le", { ascending: false }).limit(30),
  ]);
  const firstErr = [poles, agents, settings, memory, routines, tasks, running, approvals, journal, missions].find((r) => r.error)?.error;
  if (firstErr) return { ok: false, reason: "erreur", message: traduireErreur(firstErr.message) };
  if (!poles.data?.length || !agents.data?.length) {
    return { ok: false, reason: "erreur", message: "La base est vide : applique les migrations puis supabase/seed.sql (voir README)." };
  }

  // ---- catalogue
  const agentList = (agents.data as AgentRow[]).map((r) => {
    agentRows.set(r.id, r);
    return agentFromRow(r);
  });
  setCatalog({
    poles: (poles.data as PoleRow[]).map(poleFromRow),
    agents: agentList,
    memory: ((memory.data ?? []) as MemoryRow[]).map(memoryFromRow),
    routines: ((routines.data ?? []) as RoutineRow[]).map(routineFromRow),
    ...(settings.data ? { settings: settingsFromRow(settings.data as SettingsRow) } : {}),
  });
  world.syncAgents(agentList.filter((a) => a.actif).map((a) => a.id));
  world.setChatter(catalogStore.getState().settings.bavardageActif);

  // ---- état
  for (const t of [...((tasks.data ?? []) as TaskRow[]), ...((running.data ?? []) as TaskRow[])]) taskRows.set(t.id, t);
  const runtimes = Object.fromEntries(
    agentList
      .filter((a) => a.actif)
      .map((a) => {
        const r = agentRows.get(a.id)!;
        return [a.id, runtimeFromRow(r, r.tache_courante_id ? taskRows.get(r.tache_courante_id) : undefined, null)];
      }),
  );
  world.hydrate({
    agents: runtimes,
    tasks: [...taskRows.values()].map(taskFromRow).sort((a, b) => b.updatedAt - a.updatedAt),
    approvals: ((approvals.data ?? []) as ApprovalRow[]).map(approvalFromRow),
    journal: ((journal.data ?? []) as JournalRow[]).map(journalFromRow),
    missions: ((missions.data ?? []) as MissionRow[]).map(missionFromRow),
  });

  setRepo(liveRepo(sb));

  // ---- écritures déclenchées depuis l'interface
  const adapter: LiveAdapter = {
    email,
    async insertMission(texte, cible) {
      const { error } = await sb.from("missions").insert({ demandeur: email, texte, cible, statut: "nouvelle" });
      if (error) throw new Error(traduireErreur(error.message));
      void kickEngine();
      await adapter.log({ type: "mission", titre: `Nouvelle mission pour ${catalogStore.getState().agents.find((a) => a.id === cible)?.nom ?? cible}`, contenu: texte, agentId: cible, poleId: agentRows.get(cible)?.pole_id });
    },
    async decideApproval(id, d) {
      const patch: Record<string, unknown> = { statut: d.statut, decide_par: email, decide_le: new Date().toISOString() };
      if (d.motif) patch.motif = d.motif;
      if (d.apercu !== undefined) patch.apercu = d.apercu;
      const { data, error } = await sb.from("approvals").update(patch).eq("id", id).select("titre, agent_id").maybeSingle();
      if (error) throw new Error(traduireErreur(error.message));
      if (d.regle) await sb.from("autonomy_rules").insert({ agent_id: d.regle.agentId, type_action: d.regle.type, cree_par: email });
      const verbe = d.statut === "refuse" ? "Refusé" : d.statut === "modifie" ? "Modifié et validé" : "Validé";
      await adapter.log({ type: "validation", titre: `${verbe} : ${data?.titre ?? "élément de la Douane"}`, contenu: d.motif ? `Motif : ${d.motif}` : undefined, agentId: data?.agent_id ?? undefined });
      if (d.regle) await adapter.log({ type: "decision", titre: `Règle d'autonomie ajoutée : « ${d.regle.type} » pour ${d.regle.agentId}`, agentId: d.regle.agentId });
    },
    chat: (agentId, text) => sendChat(agentId, text),
    async log(e) {
      await sb.from("journal").insert({ type: e.type, titre: e.titre.slice(0, 300), contenu: e.contenu ?? null, agent_id: e.agentId ?? null, pole_id: e.poleId ?? null });
    },
  };
  getDirector().start("live", adapter);

  // le moteur avance tant qu'il y a du travail (en attendant pg_cron, Phase 5)
  const pinger = setInterval(() => {
    const w = world.get();
    const busy =
      w.tasks.some((t) => ["queued", "running", "waiting_tool", "waiting_founder"].includes(t.status)) ||
      w.missions.some((m) => m.status === "nouvelle" || m.status === "planification" || m.status === "en_cours");
    if (busy) void kickEngine();
  }, 20_000);

  // ---- temps réel
  const channel: RealtimeChannel = sb
    .channel(`le-port-${Date.now().toString(36)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, (p) => {
      if (p.eventType === "DELETE") {
        const id = (p.old as { id?: string }).id;
        if (!id) return;
        agentRows.delete(id);
        setCatalog({ agents: catalogStore.getState().agents.filter((a) => a.id !== id) });
        world.syncAgents(catalogStore.getState().agents.filter((a) => a.actif).map((a) => a.id));
        return;
      }
      const r = p.new as AgentRow;
      agentRows.set(r.id, r);
      const def = agentFromRow(r);
      const list = catalogStore.getState().agents;
      const old = list.find((a) => a.id === r.id);
      // ne réécrit le catalogue que si la définition a changé (pas pour un simple changement d'état)
      if (!old || JSON.stringify({ ...old, routines: [] }) !== JSON.stringify(def)) {
        setCatalog({ agents: old ? list.map((a) => (a.id === r.id ? def : a)) : [...list, def] });
        world.syncAgents(catalogStore.getState().agents.filter((a) => a.actif).map((a) => a.id));
      }
      if (r.actif) refreshRuntime(r.id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
      if (p.eventType === "DELETE") return;
      const t = p.new as TaskRow;
      taskRows.set(t.id, t);
      world.upsertTask(taskFromRow(t));
      for (const [id, r] of agentRows) if (r.tache_courante_id === t.id) refreshRuntime(id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, (p) => {
      if (p.eventType === "DELETE") {
        const id = (p.old as { id?: string }).id;
        if (id) world.removeApproval(id);
        return;
      }
      const a = p.new as ApprovalRow;
      const exists = world.get().approvals.some((x) => x.id === a.id);
      if (a.statut === "en_attente" && !exists) world.hydrate({ approvals: [...world.get().approvals, approvalFromRow(a)] });
      if (a.statut !== "en_attente" && exists) world.removeApproval(a.id);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "journal" }, (p) => {
      const e = journalFromRow(p.new as JournalRow);
      if (!world.get().journal.some((x) => x.id === e.id)) world.hydrate({ journal: [e, ...world.get().journal].slice(0, 400) });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "missions" }, (p) => {
      if (p.eventType === "DELETE") return;
      const m = missionFromRow(p.new as MissionRow);
      const list = world.get().missions;
      world.hydrate({ missions: list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [m, ...list] });
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages" }, (p) => {
      const m = p.new as MessageRow;
      const text = (m.resume_bulle ?? m.contenu ?? "").slice(0, 90);
      getDirector().playMessage({ conversationId: m.conversation_id, from: m.from_agent, to: m.to_agent, text });
    })
    .subscribe((status) => {
      uiStore.setState({ conn: status === "SUBSCRIBED" ? "direct" : status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "hors_ligne" : "connexion" });
    });

  return {
    ok: true,
    stop: () => {
      clearInterval(pinger);
      void sb.removeChannel(channel);
      getDirector().stop();
    },
  };
}

// ------------------------------------------------------------------ moteur
let inFlight = false;

/** Fait avancer le moteur d'agents (un « tick » côté serveur). */
export async function kickEngine(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  uiStore.setState((s) => ({ moteur: { ...s.moteur, enCours: true } }));
  try {
    const res = await fetch("/api/engine/tick", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { moteur?: "anthropic" | "mock"; error?: string; erreurs?: string[] };
    uiStore.setState({
      moteur: {
        kind: data.moteur ?? uiStore.getState().moteur.kind,
        dernier: Date.now(),
        erreur: res.ok ? (data.erreurs?.[0] ?? null) : (data.error ?? `Erreur ${res.status}`),
        enCours: false,
      },
    });
  } catch (e) {
    uiStore.setState((s) => ({ moteur: { ...s.moteur, enCours: false, erreur: e instanceof Error ? e.message : "Réseau indisponible" } }));
  } finally {
    inFlight = false;
  }
}

/** Chat direct (fiche agent) : historique et envoi. */
export async function loadChat(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/chat`);
  if (!res.ok) return;
  const data = (await res.json()) as { messages: { role: "fondateur" | "agent"; contenu: string }[] };
  world.setChats(agentId, data.messages.map((m) => ({ from: m.role, text: m.contenu, at: Date.now() })));
}

export async function sendChat(agentId: string, text: string): Promise<void> {
  world.pushChat(agentId, { from: "fondateur", text, at: Date.now() });
  world.say(agentId, "Je regarde ça…", 2000);
  try {
    const res = await fetch(`/api/agents/${agentId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
    const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
    world.pushChat(agentId, { from: "agent", text: res.ok ? (data.reply ?? "…") : `(Je n'ai pas pu répondre : ${data.error ?? res.status})`, at: Date.now() });
  } catch {
    world.pushChat(agentId, { from: "agent", text: "(Réseau indisponible, réessaie.)", at: Date.now() });
  }
}

/** Dépense IA du jour (€), table usage. */
export async function spentToday(sb: SupabaseClient): Promise<number> {
  const day = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const { data } = await sb.from("usage").select("cout_estime").gte("date", day);
  return (data ?? []).reduce((s: number, r: { cout_estime: number | string }) => s + Number(r.cout_estime), 0);
}

// ------------------------------------------------------------------ banc d'essai (Réglages → Temps réel)
export const testBench = {
  async setState(sb: SupabaseClient, agentId: string, etat: AgentState, interlocuteur?: string | null): Promise<void> {
    const patch: Record<string, unknown> = { etat, offline_raison: etat === "offline" ? "nuit" : null, interlocuteur: etat === "talking" ? (interlocuteur ?? null) : null };
    const { error } = await sb.from("agents").update(patch).eq("id", agentId);
    if (error) throw new Error(traduireErreur(error.message));
  },
  async task(sb: SupabaseClient, agentId: string, titre: string): Promise<void> {
    const { data, error } = await sb
      .from("tasks")
      .insert({
        agent_id: agentId,
        titre,
        statut: "running",
        cree_par: "banc-essai",
        etapes: [
          { label: "Lire le contexte", done: true },
          { label: "Rédiger", done: false },
          { label: "Relire", done: false },
        ],
      })
      .select("id")
      .single();
    if (error) throw new Error(traduireErreur(error.message));
    const up = await sb.from("agents").update({ etat: "working", tache_courante_id: data.id, interlocuteur: null, offline_raison: null }).eq("id", agentId);
    if (up.error) throw new Error(traduireErreur(up.error.message));
  },
  async conversation(sb: SupabaseClient, a: string, b: string, lines: [string, string][]): Promise<void> {
    const conversation_id = crypto.randomUUID();
    await testBench.setState(sb, a, "talking", b);
    await testBench.setState(sb, b, "talking", a);
    for (const [from, text] of lines) {
      const { error } = await sb.from("agent_messages").insert({ conversation_id, from_agent: from, to_agent: from === a ? b : a, type: "question", contenu: text, resume_bulle: text.slice(0, 90) });
      if (error) throw new Error(traduireErreur(error.message));
      await new Promise((r) => setTimeout(r, 1200));
    }
  },
  async approval(sb: SupabaseClient, agentId: string): Promise<void> {
    const { error } = await sb.from("approvals").insert({
      agent_id: agentId,
      type_action: "email",
      titre: "Test temps réel",
      destinataire: "test@exemple.fr",
      objet: "Ceci est un test",
      apercu: "Bonjour,\n\nCe brouillon a été créé par le banc d'essai de Réglages pour vérifier que La Douane se met à jour en temps réel.\n\nL'équipe MJAGENCY",
    });
    if (error) throw new Error(traduireErreur(error.message));
    await sb.from("agents").update({ etat: "waiting_approval" }).eq("id", agentId);
  },
};
