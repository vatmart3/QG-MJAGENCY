import { z } from "zod";
import { defineTool } from "./types";

export const postToJournal = defineTool({
  name: "post_to_journal",
  description: "Écrit une entrée dans le Journal du port (visible des fondateurs). Pour une info utile, une alerte, ou signaler un contenu externe suspect.",
  schema: z.object({
    titre: z.string().min(1).max(200),
    contenu: z.string().max(4000).optional(),
    alerte: z.boolean().optional().describe("true pour une alerte (contenu suspect, problème)."),
  }),
  async run(ctx, input) {
    await ctx.db.insertJournal({ type: input.alerte ? "alerte" : "action", titre: `${ctx.agent.nom} — ${input.titre}`, contenu: input.contenu ?? null, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: "Publié dans le Journal.", etape: "Note au Journal" };
  },
});
