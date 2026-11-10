import { z } from "zod";
import { rapportSchema } from "@/lib/rapport";
import { defineTool } from "./types";

export const finishTask = defineTool({
  name: "finish_task",
  description:
    "Termine la tâche et rend ton compte rendu, rangé : un résumé de 2 à 4 phrases, le livrable complet découpé en sections (Markdown simple), les points clés, les prochaines étapes (qui fait quoi, quand) et, si utile, des fichiers prêts à l'emploi (brouillon de mail en .md, tableau en .csv…). À appeler une seule fois, à la fin. important=true pour un livrable marquant (célébration dans la ville).",
  schema: rapportSchema.extend({
    important: z.boolean().optional().describe("Livrable marquant (fin de mission, gros devis…)."),
  }),
  async run(_ctx, input) {
    const { important, ...rapport } = input;
    return { content: "Tâche terminée.", finish: { rapport, important: !!important }, etape: "Compte rendu rendu" };
  },
});
