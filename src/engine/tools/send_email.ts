import { z } from "zod";
import { decisionAutonome, heureParis } from "./autonomie";
import { defineTool } from "./types";
import { isInternal, parseRecipients, withSignature } from "./mail_common";

/**
 * Envoi d'un mail : déposé en Douane (un fondateur valide), sauf règle « Toujours autoriser »
 * pour cet agent et ce type, et seulement vers une adresse avec qui l'agence a déjà échangé.
 */
export const sendEmail = defineTool({
  name: "send_email",
  description:
    "Envoie un mail depuis la boîte de l'agence. Selon les réglages des fondateurs, il part tout seul (mode autonome, après quelques minutes) ou attend leur validation en Douane. Ce qui touche aux prix, devis, contrats, paiements ou engagements passe toujours en Douane : mets sensible=true dans ce cas. La signature MJAGENCY est ajoutée automatiquement : ne signe pas de ton nom. Pour répondre, indique repondre_a (id du mail reçu) : le fil est conservé.",
  schema: z.object({
    a: z.string().min(3).max(500).describe("destinataire(s), séparés par des virgules"),
    objet: z.string().min(1).max(200),
    corps: z.string().min(1).max(20_000).describe("texte du mail, sans signature"),
    repondre_a: z.string().max(200).optional(),
    type: z.enum(["email", "relance"]).optional().describe("relance pour un suivi de mail sans réponse"),
    sensible: z.boolean().optional().describe("true si le mail engage l'agence (prix, délai promis, contrat, juridique) : validation obligatoire"),
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

    // mode autonome : envoi différé de quelques minutes (les fondateurs peuvent le bloquer), sauf cas sensibles
    const origine = input.repondre_a ? await ctx.db.email(input.repondre_a) : null;
    const d = await decisionAutonome(ctx, type, { texte: `${objet}\n${input.corps}`, sensible: input.sensible, jamaisVue, origineSpam: origine?.categorie === "spam" });
    const titre = `${type === "relance" ? "Relance" : "Mail"} : ${objet}`.slice(0, 200);
    const payload = { kind: "email", ...mail, repondre_a: input.repondre_a ?? null, demo: mb.kind === "demo", jamais_vue: jamaisVue };
    if (d.auto) {
      await ctx.db.insertApproval({
        agent_id: ctx.agent.id,
        task_id: ctx.task.id,
        type_action: type,
        titre,
        destinataire: mail.a,
        objet,
        apercu: corps,
        payload: { ...payload, envoyer_apres: d.envoyerApres.toISOString() },
        statut: "approuve",
        decide_par: "mode autonome",
        execution_statut: "a_faire",
      });
      await ctx.db.insertJournal({ type: "action", titre: `⏱️ ${ctx.agent.nom} envoie à ${heureParis(d.envoyerApres)} : ${objet} → ${mail.a}`.slice(0, 300), contenu: corps.slice(0, 1500), agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
      return { content: `Mail programmé : il part automatiquement à ${heureParis(d.envoyerApres)} (mode autonome).${mb.kind === "demo" ? " DÉMO : rien ne partira vraiment." : ""}`, etape: "Programme un envoi" };
    }

    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: type,
      titre,
      destinataire: mail.a,
      objet,
      apercu: corps,
      payload: { ...payload, raison_douane: d.raison },
      execution_statut: "a_faire",
    });
    await ctx.db.updateAgent(ctx.agent.id, { etat: "waiting_approval", interlocuteur: null });
    const note = d.raison ? ` Validation obligatoire : ${d.raison}.` : regle ? "" : " Il partira dès qu'un fondateur aura cliqué « Envoyer ».";
    return { content: `Mail déposé en Douane.${note}`, etape: "Dépose un mail en Douane" };
  },
});
