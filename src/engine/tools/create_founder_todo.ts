import { z } from "zod";
import { defineTool } from "./types";

export const createFounderTodo = defineTool({
  name: "create_founder_todo",
  description: "Ajoute une action à faire par un fondateur (appel, signature, rendez-vous…). Elle apparaît dans le Journal et dans le récap du matin.",
  schema: z.object({
    titre: z.string().min(1).max(200),
    pour: z.enum(["Jérémy", "Matheis", "les deux"]).optional(),
    echeance: z.string().max(40).optional().describe("Ex. « vendredi », « 15/11 »."),
  }),
  async run(ctx, input) {
    const qui = input.pour ?? "les deux";
    await ctx.db.insertJournal({ type: "alerte", titre: `À faire (${qui}) : ${input.titre}${input.echeance ? ` — ${input.echeance}` : ""}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: "Ajouté à la to-do des fondateurs.", etape: "To-do fondateurs" };
  },
});
