import { z } from "zod";
import { defineTool } from "./types";
import { parseRecipients, withSignature } from "./mail_common";

export const createEmailDraft = defineTool({
  name: "create_email_draft",
  description: "Enregistre un brouillon dans Gmail (rien n'est envoyé). Pour un envoi, utilise send_email : il passe par La Douane.",
  schema: z.object({
    a: z.string().min(3).max(500).describe("destinataire(s), séparés par des virgules"),
    objet: z.string().min(1).max(200),
    corps: z.string().min(1).max(20_000).describe("texte du mail, sans signature (elle est ajoutée automatiquement)"),
    repondre_a: z.string().max(200).optional().describe("id du mail auquel on répond"),
  }),
  async run(ctx, input) {
    const dest = parseRecipients(input.a);
    if (!dest) return { content: "Adresse(s) de destinataire invalide(s).", isError: true };
    const mb = await ctx.services.mailbox();
    const orig = input.repondre_a ? await mb.read(input.repondre_a) : null;
    const d = await mb.draft({ a: dest.join(", "), objet: input.objet, corps: withSignature(input.corps, ctx.settings), threadId: orig?.threadId, inReplyTo: orig?.messageIdHeader, references: orig?.references });
    await ctx.db.insertJournal({ type: "action", titre: `📝 ${ctx.agent.nom} a préparé un brouillon Gmail : ${input.objet}`.slice(0, 300), contenu: `À : ${dest.join(", ")}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Brouillon enregistré (id ${d.id})${mb.kind === "demo" ? " — DÉMO, rien n'est créé dans Gmail" : ""}.`, etape: "Brouillon Gmail" };
  },
});
