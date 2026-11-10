import { z } from "zod";
import { defineTool } from "./types";

export const proposeCompanyMemoryUpdate = defineTool({
  name: "propose_company_memory_update",
  description: "Propose d'ajouter ou de corriger une information de la mémoire d'entreprise. Elle passe par La Douane ; elle ne s'applique qu'après validation.",
  schema: z.object({
    cle: z.string().regex(/^[a-z0-9_]{1,80}$/).describe("Clé en minuscules (ex. « tarifs_sites »)."),
    contenu: z.string().min(1).max(4000),
    raison: z.string().max(1000),
  }),
  async run(ctx, input) {
    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: "memoire",
      titre: `Mémoire : ${input.cle}`,
      apercu: `${input.contenu}\n\nPourquoi : ${input.raison}`,
      payload: { cle: input.cle, contenu: input.contenu },
    });
    return { content: "Proposition déposée en Douane.", etape: "Proposition de mémoire" };
  },
});
