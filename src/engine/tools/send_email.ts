import { z } from "zod";
import { defineTool } from "./types";
import { isInternal, parseRecipients, withSignature } from "./mail_common";

/**
 * Envoi d'un mail : déposé en Douane (un fondateur valide), sauf règle « Toujours autoriser »
 * pour cet agent et ce type, et seulement vers une adresse avec qui l'agence a déjà échangé.
 */
export const sendEmail = defineTool({
  name: "send_email",
  description:
    "Prépare l'envoi d'un mail depuis la boîte de l'agence. Il part en Douane pour validation par un fondateur (sauf règle d'autonomie). La signature MJAGENCY est ajoutée automatiquement : ne signe pas de ton nom. Pour répondre, indique repondre_a (id du mail reçu) : le fil est conservé.",
  schema: z.object({
    a: z.string().min(3).max(500).describe("destinataire(s), séparés par des virgules"),
    objet: z.string().min(1).max(200),
    corps: z.string().min(1).max(20_000).describe("texte du mail, sans signature"),
    repondre_a: z.string().max(200).optional(),
    type: z.enum(["email", "relance"]).optional().describe("relance pour un suivi de mail sans réponse"),
  }),
  async run(ctx, input) {
    const dest = parseRecipients(input.a);
    if (!dest) return { content: "Adresse(s) de destinataire invalide(s).", isError: true };
    const mb = await ctx.services.mailbox();
    const orig = input.repondre_a ? await mb.read(input.repondre_a) : null;
    if (input.repondre_a && !orig) return { content: `Mail d'origine introuvable : ${input.repondre_a}.`, isError: true };
    const type = input.type ?? "email";
    const corps = withSignature(input.corps, ctx.settings);
    const objet = orig && !/^re\s*:/i.test(input.objet) && input.objet === orig.objet ? `Re: ${orig.objet}` : input.objet;
    const mail = { a: dest.join(", "), objet, corps, threadId: orig?.threadId, inReplyTo: orig?.messageIdHeader, references: orig?.references };

    // adresse jamais vue → toujours en Douane, quelle que soit la règle
    const externes = dest.filter((d) => !isInternal(d, ctx.settings));
    const vues = await Promise.all(externes.map((d) => mb.hasExchangedWith(d).catch(() => false)));
    const jamaisVue = externes.filter((_, i) => !vues[i]);
    const regle = await ctx.db.hasAutonomyRule(ctx.agent.id, type);

    if (regle && !jamaisVue.length) {
      const r = await mb.send(mail);
      await ctx.db.insertApproval({
        agent_id: ctx.agent.id,
        task_id: ctx.task.id,
        type_action: type,
        titre: `${ctx.agent.nom} — ${objet}`.slice(0, 200),
        destinataire: mail.a,
        objet,
        apercu: corps,
        payload: { kind: "email", ...mail, repondre_a: input.repondre_a ?? null, auto: true, demo: mb.kind === "demo" },
        statut: "approuve",
        decide_par: "règle d'autonomie",
        execution_statut: mb.kind === "demo" ? "simule" : "fait",
      });
      await ctx.db.insertJournal({ type: "action", titre: `✉️ Envoyé (règle d'autonomie) à ${mail.a} : ${objet}`.slice(0, 300), contenu: corps.slice(0, 1500), agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
      if (input.repondre_a) await ctx.db.updateEmail(input.repondre_a, { statut: "traite" }).catch(() => undefined);
      return { content: `Mail envoyé directement (règle d'autonomie active), id ${r.id}${mb.kind === "demo" ? " — DÉMO, rien n'est parti" : ""}.`, etape: "Mail envoyé (règle)" };
    }

    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: type,
      titre: `${type === "relance" ? "Relance" : "Mail"} : ${objet}`.slice(0, 200),
      destinataire: mail.a,
      objet,
      apercu: corps,
      payload: { kind: "email", ...mail, repondre_a: input.repondre_a ?? null, demo: mb.kind === "demo", jamais_vue: jamaisVue },
      execution_statut: "a_faire",
    });
    await ctx.db.updateAgent(ctx.agent.id, { etat: "waiting_approval", interlocuteur: null });
    const note = jamaisVue.length ? ` Adresse jamais vue (${jamaisVue.join(", ")}) : validation obligatoire.` : regle ? "" : " Il partira dès qu'un fondateur aura cliqué « Envoyer ».";
    return { content: `Mail déposé en Douane.${note}`, etape: "Dépose un mail en Douane" };
  },
});
