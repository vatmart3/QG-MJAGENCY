import { z } from "zod";
import { defineTool } from "./types";

export const writeAgentNote = defineTool({
  name: "write_agent_note",
  description: "Garde une note pour toi (préférence d'un client, info à retenir). Retrouvable avec search_memory.",
  schema: z.object({ contenu: z.string().min(1).max(2000) }),
  async run(ctx, input) {
    await ctx.db.insertNote(ctx.agent.id, input.contenu);
    return { content: "Note enregistrée.", etape: "Note personnelle" };
  },
});
