import type Anthropic from "@anthropic-ai/sdk";
import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { MISSION_ROUTES } from "@/data/mockContent";
import type { TaskStep } from "@/store/world";
import { CRITICAL_FALLBACK, LIMITS, MODELS, costEur } from "./config";
import type { EAgent, EMission, ERun, ETask, EngineDb, Msg, ToolResultBlock } from "./db";
import type { LLM, MockMeta } from "./llm";
import { bulle, systemFor, taskBrief } from "./prompts";
import { apiTools, toolByName, toolsFor } from "./tools";
import type { ToolCtx } from "./tools/types";

/**
 * Un « pas » de boucle d'agent : un appel au modèle, puis l'exécution des outils demandés.
 * L'historique est enregistré dans task_runs : une tâche peut s'étaler sur plusieurs ticks.
 */

export interface Shared {
  team: EAgent[];
  poles: Map<string, string>;
  memory: { cle: string; contenu: string }[];
  budgetOver: boolean;
  now: Date;
}

export type StepResult = "done" | "continue" | "wait" | "failed" | "deferred" | "retry";

export const isCritical = (a: EAgent): boolean => a.critique || CRITICAL_FALLBACK.includes(a.id);

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function pushStep(steps: TaskStep[], label: string, done: boolean): TaskStep[] {
  const prev = steps.filter((s) => s.label !== "Réfléchit…").map((s) => ({ ...s, done: true }));
  return [...prev, { label, done }].slice(-12);
}

const parisLabel = (d: Date) => formatInTimeZone(d, "Europe/Paris", "EEEE d MMMM yyyy, HH:mm", { locale: fr });

async function fail(db: EngineDb, task: ETask, agent: EAgent | undefined, raison: string): Promise<StepResult> {
  await db.updateTask(task.id, { statut: "failed", resultat: { erreur: raison }, locked_until: null });
  if (agent) await db.updateAgent(agent.id, { etat: "idle", tache_courante_id: null, interlocuteur: null });
  await db.insertJournal({ type: "alerte", titre: `Tâche échouée : ${task.titre}`, contenu: raison, agent_id: agent?.id ?? null, pole_id: agent?.pole_id ?? null });
  if (task.mission_id && !task.parent_id) await db.updateMission(task.mission_id, { statut: "annulee", synthese: `La mission n'a pas pu aboutir : ${raison}` });
  return "failed";
}

/** Données pour la simulation (sans clé API) : équipe proposée et collègue à consulter. */
async function mockMeta(db: EngineDb, task: ETask, agent: EAgent, mission: EMission | null, team: EAgent[]): Promise<MockMeta> {
  const meta: MockMeta = { agentId: agent.id, agentNom: agent.nom, role: agent.role, planner: agent.modele === "planner", taskTitle: task.titre };
  if (meta.planner && mission) {
    const n = mission.texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    // simulation : la première règle qui correspond désigne l'équipe (le vrai Marius choisit lui-même)
    const route = MISSION_ROUTES.find((r) => r.keys.some((k) => n.includes(k.normalize("NFD").replace(/\p{Diacritic}/gu, ""))));
    const ids = new Set<string>(route?.agents ?? ["clemence", "diane"]);
    meta.team = [...ids]
      .map((id) => team.find((a) => a.id === id && a.actif))
      .filter((a): a is EAgent => !!a)
      .slice(0, 4)
      .map((a) => ({ agentId: a.id, titre: `${a.role} — ${mission.texte.slice(0, 50)}`, consigne: `Prépare ta partie (${a.role.toLowerCase()}) pour : ${mission.texte}` }));
  }
  if (!meta.planner && task.mission_id) {
    const siblings = (await db.missionTasks(task.mission_id)).filter((t) => t.agent_id && t.agent_id !== agent.id && t.parent_id === task.parent_id);
    const other = siblings.map((t) => team.find((a) => a.id === t.agent_id)).find((a) => !!a);
    meta.colleague = other ? { id: other.id, nom: other.nom } : null;
  }
  return meta;
}

export async function runStep(db: EngineDb, llm: LLM, task: ETask, shared: Shared): Promise<StepResult> {
  const { team, now } = shared;
  const agent = team.find((a) => a.id === task.agent_id);
  if (!agent || !agent.actif) return fail(db, task, agent, "Agent introuvable ou désactivé.");

  // budget épuisé : seuls les agents critiques continuent
  if (shared.budgetOver && !isCritical(agent)) {
    await db.updateTask(task.id, { statut: "queued", locked_until: null, pas_avant: new Date(now.getTime() + 15 * 60_000).toISOString() });
    await db.updateAgent(agent.id, { etat: "offline", offline_raison: "budget", tache_courante_id: null });
    return "deferred";
  }

  const mission = task.mission_id ? await db.mission(task.mission_id) : null;
  let run: ERun | null = await db.run(task.id);
  if (!run) {
    run = await db.saveRun(task.id, {
      messages: [{ role: "user", content: taskBrief(task, mission?.texte ?? null, parisLabel(now)) }],
      iterations: 0,
      cout: 0,
      erreur: null,
      attente: [],
      resultats_en_suspens: [],
    });
  }
  if (run.iterations >= LIMITS.maxIterations) return fail(db, task, agent, `Plus de ${LIMITS.maxIterations} itérations d'outils sans terminer.`);

  await db.updateAgent(agent.id, { etat: "working", tache_courante_id: task.id, interlocuteur: null, offline_raison: null });
  let etapes = pushStep(task.etapes, "Réfléchit…", false);
  await db.updateTask(task.id, { etapes });

  const defs = toolsFor(agent);
  const model = MODELS[agent.modele];
  let res;
  try {
    res = await llm.create({
      model,
      tier: agent.modele,
      system: systemFor(agent, team, shared.poles, shared.memory),
      messages: run.messages,
      tools: apiTools(defs),
      meta: await mockMeta(db, task, agent, mission, team),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errors = (run.erreur?.match(/\|/g)?.length ?? 0) + 1;
    if (errors >= LIMITS.maxErrors) return fail(db, task, agent, `Erreurs répétées de l'API : ${msg}`);
    await db.saveRun(task.id, { erreur: `${run.erreur ?? ""}|${msg}`.slice(-2000) });
    await db.updateTask(task.id, { statut: "queued", locked_until: null, pas_avant: new Date(now.getTime() + 60_000).toISOString() });
    return "retry";
  }

  const cout = costEur(model, res.usage);
  await db.insertUsage({ agent_id: agent.id, modele: res.model, tokens_in: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite, tokens_out: res.usage.output, cout_estime: cout });
  if (res.refusal) return fail(db, task, agent, `Le modèle a refusé la tâche (${res.refusal}).`);

  const messages: Msg[] = [...run.messages, { role: "assistant", content: res.content as unknown as Anthropic.Beta.BetaContentBlockParam[] }];
  const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
  const ctx: ToolCtx = { db, llm, task, agent, run, team, poles: shared.poles, memory: shared.memory, now };

  // réponse sans outil : le texte devient le livrable
  if (!uses.length) {
    const texte = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (!texte) return fail(db, task, agent, "Réponse vide du modèle.");
    await db.saveRun(task.id, { messages, iterations: run.iterations + 1, cout: Number(run.cout) + cout });
    await completeTask(db, task, agent, mission, { texte, important: false }, pushStep(etapes, "Livrable rendu", true));
    return "done";
  }

  const results: ToolResultBlock[] = [];
  const attente: ERun["attente"] = [];
  let finish: { texte: string; important: boolean } | null = null;
  for (const u of uses) {
    const def = toolByName(u.name);
    if (!def || !defs.includes(def)) {
      results.push({ type: "tool_result", tool_use_id: u.id, content: `L'outil ${u.name} n'est pas disponible pour toi.`, is_error: true });
      continue;
    }
    const parsed = def.schema.safeParse(u.input);
    if (!parsed.success) {
      results.push({ type: "tool_result", tool_use_id: u.id, content: `Paramètres invalides : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}`, is_error: true });
      continue;
    }
    try {
      const out = await def.run(ctx, parsed.data);
      if (out.etape) etapes = pushStep(etapes, out.etape, true);
      if (out.finish) finish = out.finish;
      if (out.wait) attente.push({ tool_use_id: u.id, ...out.wait });
      else results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    } catch (e) {
      results.push({ type: "tool_result", tool_use_id: u.id, content: `Erreur de l'outil : ${e instanceof Error ? e.message : String(e)}`, is_error: true });
    }
  }
  const iterations = run.iterations + 1;
  const totalCout = Number(run.cout) + cout;

  if (finish) {
    // les résultats en attente n'ont plus d'objet : on clôt proprement l'historique
    const closing = [...results, ...attente.map((w) => ({ type: "tool_result" as const, tool_use_id: w.tool_use_id, content: "Sans objet : tâche terminée." }))];
    await db.saveRun(task.id, { messages: [...messages, { role: "user", content: closing }], iterations, cout: totalCout, attente: [], resultats_en_suspens: [] });
    await completeTask(db, task, agent, mission, finish, pushStep(etapes, "Livrable rendu", true));
    return "done";
  }

  if (attente.length) {
    const founder = attente.some((w) => w.kind === "approval");
    await db.saveRun(task.id, { messages, iterations, cout: totalCout, attente, resultats_en_suspens: results });
    await db.updateTask(task.id, { statut: founder ? "waiting_founder" : "waiting_tool", locked_until: null, etapes: etapes.map((s) => ({ ...s, done: true })) });
    const current = await db.agent(agent.id);
    if (current?.etat === "working") await db.updateAgent(agent.id, { etat: "idle", tache_courante_id: null });
    return "wait";
  }

  await db.saveRun(task.id, { messages: [...messages, { role: "user", content: results }], iterations, cout: totalCout });
  await db.updateTask(task.id, { statut: "queued", locked_until: null, etapes });
  return "continue";
}

async function completeTask(db: EngineDb, task: ETask, agent: EAgent, mission: EMission | null, finish: { texte: string; important: boolean }, etapes: TaskStep[]): Promise<void> {
  const isRoot = !!mission && !task.parent_id;
  await db.updateTask(task.id, { statut: "done", resultat: { texte: finish.texte }, locked_until: null, etapes: etapes.map((s) => ({ ...s, done: true })) });
  await db.updateAgent(agent.id, { etat: finish.important || isRoot ? "done" : "idle", tache_courante_id: null, interlocuteur: null });
  await db.insertJournal({ type: "action", titre: `${agent.nom} — ${task.titre}`, contenu: finish.texte.slice(0, 4000), agent_id: agent.id, pole_id: agent.pole_id });
  if (isRoot && mission) {
    await db.updateMission(mission.id, { statut: "terminee", synthese: finish.texte });
    await db.insertJournal({ type: "mission", titre: `Synthèse livrée : ${mission.texte.slice(0, 120)}`, contenu: finish.texte.slice(0, 8000), agent_id: agent.id, pole_id: agent.pole_id });
    await db.insertMessage({ from_agent: agent.id, to_agent: null, task_id: task.id, type: "bavardage", contenu: "Mission terminée.", resume_bulle: bulle("Mission terminée, la synthèse est dans le Journal !") });
  }
}

// ------------------------------------------------------------------ reprise des tâches en attente
export async function resumeWaiting(db: EngineDb, task: ETask, team: EAgent[]): Promise<boolean> {
  const run = await db.run(task.id);
  if (!run || !run.attente.length) {
    await db.updateTask(task.id, { statut: "queued", locked_until: null });
    return true;
  }
  const resolved: ToolResultBlock[] = [];
  for (const w of run.attente) {
    if (w.kind === "tasks") {
      const ts = await db.tasks(w.ids);
      if (ts.length < w.ids.length || ts.some((t) => !TERMINAL.has(t.statut))) return false;
      const content = ts
        .map((t) => {
          const nom = team.find((a) => a.id === t.agent_id)?.nom ?? t.agent_id;
          const corps = t.statut === "done" ? (t.resultat?.texte ?? "(sans texte)") : `Échec : ${t.resultat?.erreur ?? t.statut}`;
          return `### ${nom} — ${t.titre}\n${corps}`;
        })
        .join("\n\n");
      resolved.push({ type: "tool_result", tool_use_id: w.tool_use_id, content: `Livrables reçus :\n\n${content}` });
    } else {
      const a = await db.approval(w.id);
      if (!a) {
        resolved.push({ type: "tool_result", tool_use_id: w.tool_use_id, content: "La question a été retirée de la Douane sans réponse.", is_error: true });
        continue;
      }
      if (a.statut === "en_attente") return false;
      const content =
        a.statut === "refuse"
          ? `Les fondateurs ont répondu NON.${a.motif ? ` Motif : ${a.motif}` : ""}`
          : a.statut === "modifie"
            ? `Les fondateurs ont répondu : ${a.apercu}`
            : "Les fondateurs ont répondu OUI : c'est validé.";
      resolved.push({ type: "tool_result", tool_use_id: w.tool_use_id, content });
    }
  }
  // remet les résultats dans l'ordre des appels d'outils du dernier message
  const last = run.messages[run.messages.length - 1];
  const order = last && last.role === "assistant" && typeof last.content !== "string" ? last.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : [])) : [];
  const all = [...run.resultats_en_suspens, ...resolved];
  const ordered = order.length ? order.map((id) => all.find((r) => r.tool_use_id === id)).filter((r): r is ToolResultBlock => !!r) : all;
  await db.saveRun(task.id, { messages: [...run.messages, { role: "user", content: ordered }], attente: [], resultats_en_suspens: [] });
  await db.updateTask(task.id, { statut: "queued", locked_until: null });
  return true;
}
