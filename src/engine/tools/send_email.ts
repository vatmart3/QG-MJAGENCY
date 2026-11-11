import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { piedProspection, prochainCreneau } from "@/commercial/pilote";
import { decisionAutonome, heureParis, SENSIBLE_RE } from "./autonomie";
import { defineTool, type ToolCtx, type ToolOutcome } from "./types";
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
    type: z.enum(["email", "relance", "prospection"]).optional().describe("relance pour un suivi de mail sans réponse ; prospection pour un premier mail à un prospect du CRM (pilote commercial)"),
    sensible: z.boolean().optional().describe("true si le mail engage l'agence (prix, délai promis, contrat, juridique) : validation obligatoire"),
  }),
  async run(ctx, input) {
    const dest = parseRecipients(input.a);
    if (!dest) return { content: "Adresse(s) de destinataire invalide(s).", isError: true };
    if (input.type === "prospection") return envoyerProspection(ctx, dest, input);
    // une seule réponse par mail : un mail déjà traité ne reçoit jamais une deuxième réponse
    if ((input.type ?? "email") === "email") {
      if (!input.repondre_a && dest.length === 1 && !isInternal(dest[0]!, ctx.settings)) {
        // pas d'id : on rattache au dernier mail reçu de cette personne (7 jours)
        const dernier = await ctx.db.dernierMailRecu(dest[0]!, new Date(ctx.now.getTime() - 7 * 86400_000).toISOString());
        if (dernier) {
          const deja = (await ctx.db.repondus([dernier.id]))[dernier.id];
          if (!deja) input.repondre_a = dernier.id;
          else if (!ctx.task.mission_id)
            return { content: `Rien n'est envoyé : ${dest[0]} a déjà reçu une réponse à son dernier mail (« ${dernier.objet} », répondu le ${new Date(deja).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}). Une seule réponse par mail : attends son prochain message.` };
        }
      }
      if (input.repondre_a) {
        const deja = (await ctx.db.repondus([input.repondre_a]))[input.repondre_a];
        if (deja) return { content: `Rien n'est envoyé : ce mail a déjà reçu sa réponse (le ${new Date(deja).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}). Une seule réponse par mail. Passe au suivant.`, etape: "Mail déjà traité" };
      }
    }
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

/**
 * Premier mail à un prospect du CRM (pilote commercial) : pied de désinscription ajouté, jamais de prospect de
 * démonstration ni de désinscrit, un seul premier mail par prospect. Pilote actif et sous le plafond du jour →
 * part tout seul au prochain créneau (étalé) ; sinon, ou s'il contient un prix / un engagement → Douane.
 */
async function envoyerProspection(ctx: ToolCtx, dest: string[], input: { objet: string; corps: string; sensible?: boolean }): Promise<ToolOutcome> {
  if (dest.length !== 1) return { content: "Un mail de prospection = un seul destinataire.", isError: true };
  const email = dest[0]!.toLowerCase();
  const lead = await ctx.db.commercial.leadParEmail(email);
  if (!lead) return { content: `${email} n'est pas un prospect du CRM : la prospection ne vise que les commerces trouvés par Hugo (create_lead d'abord).`, isError: true };
  if (lead.demo) return { content: `${lead.nom} est un prospect de DÉMONSTRATION (adresse fictive) : rien n'est envoyé. Ajoute la clé Google Places pour de vrais prospects.`, etape: "Prospect de démo ignoré" };
  if (await ctx.db.commercial.estDesinscrit(email)) return { content: `${lead.nom} a demandé à ne plus être contacté : rien n'est envoyé.`, etape: "Désinscrit : ignoré" };
  if (["contacte", "repondu", "converti", "ecarte"].includes(lead.statut)) return { content: `${lead.nom} a déjà été contacté (statut ${lead.statut}) : un seul premier mail par prospect.`, etape: "Déjà contacté" };
  const corps = withSignature(input.corps, ctx.settings) + piedProspection(email);
  const p = await ctx.db.commercial.pilote();
  const debutJour = fromZonedTime(`${formatInTimeZone(ctx.now, "Europe/Paris", "yyyy-MM-dd")}T00:00:00`, "Europe/Paris").toISOString();
  const plan = await ctx.db.commercial.envoisPilote(debutJour);
  const m = `${input.objet}\n${input.corps}`.match(SENSIBLE_RE);
  const raison = !p.actif ? "pilote commercial désactivé" : plan.aujourdhui >= p.mails_par_jour ? `plafond de ${p.mails_par_jour} mails de prospection atteint aujourd'hui` : input.sensible ? "marqué sensible" : m ? `contient « ${m[0].trim().slice(0, 30)} » (prix ou engagement)` : null;
  const payload = { kind: "email", a: email, objet: input.objet, corps, prospection: true, lead_id: lead.id };
  if (!raison) {
    const quand = prochainCreneau(plan.dernier ? new Date(plan.dernier) : null, ctx.now, p);
    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: "email",
      titre: `Prospection : ${lead.nom}`.slice(0, 200),
      destinataire: email,
      objet: input.objet,
      apercu: corps,
      payload: { ...payload, envoyer_apres: quand.toISOString() },
      statut: "approuve",
      decide_par: "pilote commercial",
      execution_statut: "a_faire",
    });
    await ctx.db.commercial.updateLead(lead.id, { statut: "contacte", contacte_le: quand.toISOString() });
    await ctx.db.insertJournal({ type: "action", titre: `📨 ${ctx.agent.nom} écrit à ${lead.nom} (envoi à ${heureParis(quand)})`.slice(0, 300), contenu: `${input.objet}\n\n${input.corps}`.slice(0, 1500), agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Mail de prospection programmé : il part tout seul à ${heureParis(quand)}${formatInTimeZone(quand, "Europe/Paris", "yyyy-MM-dd") !== formatInTimeZone(ctx.now, "Europe/Paris", "yyyy-MM-dd") ? ` le ${formatInTimeZone(quand, "Europe/Paris", "dd/MM")}` : ""}.`, etape: `Programme : ${lead.nom}` };
  }
  await ctx.db.insertApproval({
    agent_id: ctx.agent.id,
    task_id: ctx.task.id,
    type_action: "email",
    titre: `Prospection : ${lead.nom}`.slice(0, 200),
    destinataire: email,
    objet: input.objet,
    apercu: corps,
    payload: { ...payload, raison_douane: raison },
    execution_statut: "a_faire",
  });
  await ctx.db.commercial.updateLead(lead.id, { statut: "a_contacter" });
  return { content: `Mail de prospection déposé en Douane (${raison}).`, etape: "Prospection en Douane" };
}
