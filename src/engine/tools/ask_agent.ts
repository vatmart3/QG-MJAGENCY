import { z } from "zod";
import { MODELS, costEur } from "../config";
import { bulle, systemFor } from "../prompts";
import { defineTool, findAgent } from "./types";

/** Pose une question à un collègue : il répond dans une mini-boucle courte (un appel, sans outils). */
export const askAgent = defineTool({
  name: "ask_agent",
  description: "Pose une question à un collègue et obtiens sa réponse tout de suite. Pour un avis, une info, une relecture rapide. Pour lui confier un vrai travail, utilise plutôt delegate_task.",
  schema: z.object({
    agent_id: z.string().describe("Identifiant du collègue (ex. « mila »)."),
    question: z.string().min(1).max(2000),
  }),
  async run(ctx, input) {
    const other = findAgent(ctx.team, input.agent_id);
    if (!other) return { content: `Agent inconnu : ${input.agent_id}. Consulte la liste de l'équipe.`, isError: true };
    if (other.id === ctx.agent.id) return { content: "Tu ne peux pas te poser la question à toi-même.", isError: true };

    const conversation_id = crypto.randomUUID();
    await ctx.db.updateAgent(ctx.agent.id, { etat: "talking", interlocuteur: other.id });
    if (other.etat !== "offline") await ctx.db.updateAgent(other.id, { etat: "talking", interlocuteur: ctx.agent.id });
    await ctx.db.insertMessage({ conversation_id, from_agent: ctx.agent.id, to_agent: other.id, task_id: ctx.task.id, type: "question", contenu: input.question, resume_bulle: bulle(input.question) });

    const model = MODELS[other.modele];
    const res = await ctx.llm.create({
      model,
      tier: other.modele === "planner" ? "worker" : other.modele,
      system: systemFor(other, ctx.team, ctx.poles, ctx.memory),
      messages: [
        {
          role: "user",
          content: `${ctx.agent.nom} (${ctx.agent.role}) te pose une question dans le cadre de la tâche « ${ctx.task.titre} » :\n\n${input.question}\n\nRéponds directement, en quelques phrases. Ta première phrase résume ta réponse (elle s'affiche dans ta bulle).`,
        },
      ],
      tools: [],
      maxTokens: 4000,
      meta: { agentId: other.id, agentNom: other.nom, role: other.role, planner: false, taskTitle: ctx.task.titre, answering: true },
    });
    await ctx.db.insertUsage({ agent_id: other.id, modele: res.model, tokens_in: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite, tokens_out: res.usage.output, cout_estime: costEur(model, res.usage) });
    const answer = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim() || "(pas de réponse)";
    await ctx.db.insertMessage({ conversation_id, from_agent: other.id, to_agent: ctx.agent.id, task_id: ctx.task.id, type: "reponse", contenu: answer, resume_bulle: bulle(answer) });
    return { content: `Réponse de ${other.nom} :\n${answer}`, etape: `Échange avec ${other.nom}` };
  },
});
