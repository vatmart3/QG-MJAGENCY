import { z } from "zod";
import { defineTool } from "./types";

export const searchMemory = defineTool({
  name: "search_memory",
  description: "Cherche un mot dans la mémoire d'entreprise et dans tes notes personnelles.",
  schema: z.object({ requete: z.string().min(2).max(100) }),
  async run(ctx, input) {
    const n = input.requete.toLowerCase();
    const mem = (await ctx.db.memory()).filter((m) => `${m.cle} ${m.contenu}`.toLowerCase().includes(n));
    const notes = await ctx.db.searchNotes(ctx.agent.id, input.requete);
    const lignes = [...mem.map((m) => `[mémoire] ${m.cle} : ${m.contenu}`), ...notes.map((x) => `[note] ${x}`)];
    return { content: lignes.join("\n") || "Rien trouvé." };
  },
});
