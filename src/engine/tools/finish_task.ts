import { z } from "zod";
import { defineTool } from "./types";

export const finishTask = defineTool({
  name: "finish_task",
  description:
    "Termine la tâche en cours et rend ton livrable complet (texte rédigé, prêt à être utilisé). À appeler une seule fois, à la fin. important=true pour un livrable marquant (célébration dans la ville).",
  schema: z.object({
    resultat: z.string().min(1).max(20_000).describe("Le livrable complet, en français."),
    important: z.boolean().optional().describe("Livrable marquant (fin de mission, gros devis…)."),
  }),
  async run(_ctx, input) {
    return { content: "Tâche terminée.", finish: { texte: input.resultat, important: !!input.important }, etape: "Livrable rendu" };
  },
});
