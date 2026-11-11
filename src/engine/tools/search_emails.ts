import { z } from "zod";
import { defineTool } from "./types";
import { demoNote, mailLines } from "./mail_common";

export const searchEmails = defineTool({
  name: "search_emails",
  description: "Cherche des mails avec la syntaxe de recherche Gmail (ex. « from:client@exemple.fr », « in:sent newer_than:7d devis »).",
  schema: z.object({
    requete: z.string().min(1).max(300),
    max: z.number().int().min(1).max(25).optional(),
  }),
  async run(ctx, input) {
    const mb = await ctx.services.mailbox();
    const list = await mb.list(input.requete, input.max ?? 10);
    return { content: `${list.length} résultat(s) pour « ${input.requete} »${demoNote(mb.kind)}\n${mailLines(list, await ctx.db.repondus(list.map((m) => m.id)))}`, etape: "Cherche dans les mails" };
  },
});
