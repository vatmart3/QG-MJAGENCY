import { z } from "zod";
import { defineTool } from "./types";

/** Question aux fondateurs : elle attend en Douane, la tâche reprend avec leur réponse. */
export const askFounder = defineTool({
  name: "ask_founder",
  description: "Pose une question à Jérémy et Matheis quand la décision leur revient. La question apparaît dans La Douane ; ta tâche reprend dès qu'ils ont répondu.",
  schema: z.object({
    question: z.string().min(1).max(2000),
    contexte: z.string().max(2000).optional(),
  }),
  async run(ctx, input) {
    const id = await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: "question",
      titre: `${ctx.agent.nom} a une question`,
      apercu: input.contexte ? `${input.question}\n\nContexte : ${input.contexte}` : input.question,
    });
    await ctx.db.updateAgent(ctx.agent.id, { etat: "waiting_approval", interlocuteur: null });
    return { content: "Question posée.", wait: { kind: "approval", id }, etape: "Question aux fondateurs" };
  },
});
