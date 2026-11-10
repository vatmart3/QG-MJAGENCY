import { z } from "zod";
import { defineTool } from "./types";

export const readCompanyMemory = defineTool({
  name: "read_company_memory",
  description: "Relit la mémoire d'entreprise complète (déjà incluse dans tes consignes ; utile seulement si tu doutes qu'elle ait changé).",
  schema: z.object({}),
  async run(ctx) {
    const mem = await ctx.db.memory();
    return { content: mem.map((m) => `- ${m.cle} : ${m.contenu}`).join("\n") || "(mémoire vide)" };
  },
});
