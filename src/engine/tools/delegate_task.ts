import { z } from "zod";
import { LIMITS } from "../config";
import { bulle } from "../prompts";
import { defineTool, findAgent } from "./types";

export const delegateTask = defineTool({
  name: "delegate_task",
  description:
    "Confie une tâche à un collègue d'un autre pôle. attendre=true (par défaut) : tu reprends quand il a fini, avec son livrable. attendre=false : tu continues sans lui.",
  schema: z.object({
    agent_id: z.string(),
    titre: z.string().min(1).max(200),
    consigne: z.string().min(1).max(4000),
    attendre: z.boolean().optional(),
  }),
  async run(ctx, input) {
    if (ctx.task.profondeur >= LIMITS.maxDepth) return { content: "Profondeur de délégation maximale atteinte : fais-le toi-même ou termine.", isError: true };
    const other = findAgent(ctx.team, input.agent_id);
    if (!other) return { content: `Agent inconnu : ${input.agent_id}.`, isError: true };
    if (other.id === ctx.agent.id) return { content: "Tu ne peux pas te déléguer une tâche.", isError: true };
    const child = await ctx.db.insertTask({
      parent_id: ctx.task.id,
      mission_id: ctx.task.mission_id,
      agent_id: other.id,
      cree_par: ctx.agent.id,
      titre: input.titre,
      description: input.consigne,
      priorite: ctx.task.priorite,
      profondeur: ctx.task.profondeur + 1,
      statut: "queued",
    });
    await ctx.db.insertMessage({ from_agent: ctx.agent.id, to_agent: other.id, task_id: child.id, type: "delegation", contenu: `${input.titre}\n\n${input.consigne}`, resume_bulle: bulle(`${other.nom}, à toi : ${input.titre}`) });
    await ctx.db.insertJournal({ type: "action", titre: `${ctx.agent.nom} délègue à ${other.nom} : ${input.titre}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    const attendre = input.attendre !== false;
    return attendre
      ? { content: "Tâche confiée.", wait: { kind: "tasks", ids: [child.id] }, etape: `Délègue à ${other.nom}` }
      : { content: `Tâche confiée à ${other.nom} (tu ne l'attends pas).`, etape: `Délègue à ${other.nom}` };
  },
});
