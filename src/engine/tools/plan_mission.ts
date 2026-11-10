import { z } from "zod";
import { LIMITS } from "../config";
import { bulle } from "../prompts";
import { defineTool, findAgent } from "./types";

/**
 * Le DG découpe la mission : sous-tâches + agent responsable + dépendances.
 * Le plan est visible dans la fiche de la mission ; les agents se retrouvent dans La Criée,
 * puis chacun part sur sa sous-tâche. Marius reprend quand tout est revenu.
 */
export const planMission = defineTool({
  name: "plan_mission",
  plannerOnly: true,
  description:
    "Découpe une mission en sous-tâches confiées aux agents (2 à 6). « apres » liste les numéros (à partir de 0) des étapes qui doivent être finies avant celle-ci. Tu reprends la main avec tous les livrables quand elles sont terminées.",
  schema: z.object({
    besoin: z.string().min(1).max(1000).describe("Le besoin des fondateurs, reformulé en une ou deux phrases."),
    etapes: z
      .array(
        z.object({
          agent_id: z.string(),
          titre: z.string().min(1).max(200),
          consigne: z.string().min(1).max(3000),
          apres: z.array(z.number().int().min(0)).optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  async run(ctx, input) {
    const etapes = input.etapes.map((e) => ({ ...e, agent: findAgent(ctx.team, e.agent_id) }));
    const inconnus = etapes.filter((e) => !e.agent).map((e) => e.agent_id);
    if (inconnus.length) return { content: `Agents inconnus : ${inconnus.join(", ")}. Utilise les identifiants de la liste de l'équipe.`, isError: true };
    if (etapes.some((e, i) => (e.apres ?? []).some((j) => j >= i))) return { content: "« apres » ne peut citer que des étapes précédentes.", isError: true };

    const pasAvant = new Date(ctx.now.getTime() + LIMITS.meetingDelayMs).toISOString();
    const ids: string[] = [];
    for (const e of etapes) {
      const child = await ctx.db.insertTask({
        parent_id: ctx.task.id,
        mission_id: ctx.task.mission_id,
        agent_id: e.agent!.id,
        cree_par: ctx.agent.id,
        titre: e.titre,
        description: e.consigne,
        priorite: Math.max(3, ctx.task.priorite),
        profondeur: ctx.task.profondeur + 1,
        depend_de: (e.apres ?? []).map((j) => ids[j]!).filter(Boolean),
        pas_avant: pasAvant,
        statut: "queued",
      });
      ids.push(child.id);
    }

    const plan = etapes.map((e, i) => ({ agentId: e.agent!.id, title: e.titre, consigne: e.consigne, apres: e.apres ?? [], taskId: ids[i] }));
    if (ctx.task.mission_id) await ctx.db.updateMission(ctx.task.mission_id, { plan, statut: "en_cours" });

    // réunion de lancement dans La Criée
    const participants = [...new Set(etapes.map((e) => e.agent!.id))];
    await ctx.db.updateAgents([ctx.agent.id, ...participants], { etat: "meeting", interlocuteur: null });
    await ctx.db.insertMessage({ from_agent: ctx.agent.id, to_agent: null, type: "bavardage", contenu: input.besoin, resume_bulle: bulle(`Mission : ${input.besoin}`) });
    for (const e of etapes) {
      await ctx.db.insertMessage({ from_agent: ctx.agent.id, to_agent: e.agent!.id, task_id: ctx.task.id, type: "delegation", contenu: `${e.titre}\n\n${e.consigne}`, resume_bulle: bulle(`${e.agent!.nom} : ${e.titre}`) });
    }
    await ctx.db.insertJournal({
      type: "decision",
      agent_id: ctx.agent.id,
      pole_id: ctx.agent.pole_id,
      titre: `Plan de ${ctx.agent.nom} : ${etapes.length} sous-tâche${etapes.length > 1 ? "s" : ""}`,
      contenu: etapes.map((e, i) => `${i + 1}. ${e.agent!.nom} — ${e.titre}${e.apres?.length ? ` (après ${e.apres.map((j) => j + 1).join(", ")})` : ""}`).join("\n"),
    });
    return { content: "Plan lancé.", wait: { kind: "tasks", ids }, etape: `Plan : ${etapes.length} sous-tâches` };
  },
});
