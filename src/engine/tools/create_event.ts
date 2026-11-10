import { z } from "zod";
import { decisionAutonome, heureParis } from "./autonomie";
import { defineTool } from "./types";
import { parisLabel, parisLocal, parseParis } from "./agenda_common";
import { isInternal, parseRecipients } from "./mail_common";

/** Rendez-vous : ajouté directement s'il est interne, déposé en Douane s'il invite des personnes extérieures. */
export const createEvent = defineTool({
  name: "create_event",
  description:
    "Crée un rendez-vous dans l'agenda Google de l'agence (heure de Paris, format AAAA-MM-JJTHH:MM). Sans invité extérieur : ajouté tout de suite. Avec des invités extérieurs : l'invitation part en Douane pour validation.",
  schema: z.object({
    titre: z.string().min(1).max(200),
    debut: z.string().min(16).max(40),
    fin: z.string().min(16).max(40),
    lieu: z.string().max(300).optional(),
    description: z.string().max(4000).optional(),
    invites: z.array(z.string().max(200)).max(20).optional(),
  }),
  async run(ctx, input) {
    const d0 = parseParis(input.debut);
    const d1 = parseParis(input.fin);
    if (!d0 || !d1 || d1 <= d0) return { content: "Horaires invalides (format AAAA-MM-JJTHH:MM, fin après début).", isError: true };
    const invites = input.invites?.length ? parseRecipients(input.invites.join(",")) : [];
    if (invites === null) return { content: "Adresse d'invité invalide.", isError: true };
    const event = { titre: input.titre, debut: parisLocal(d0), fin: parisLocal(d1), lieu: input.lieu, description: input.description, invites };
    const externes = invites.filter((i) => !isInternal(i, ctx.settings));
    const cal = await ctx.services.calendar();
    const quand = `${parisLabel(d0)} → ${parisLabel(d1).split(" ").pop()}`;
    if (!externes.length) {
      const r = await cal.create(event);
      await ctx.db.insertJournal({ type: "action", titre: `📅 RDV ajouté à l'agenda : ${input.titre}`.slice(0, 300), contenu: `${quand}${input.lieu ? ` · ${input.lieu}` : ""}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
      return { content: `Rendez-vous ajouté (${quand})${cal.kind === "demo" ? " — agenda de DÉMONSTRATION" : ""}, id ${r.id}.`, etape: "Ajoute un RDV" };
    }
    const mb = await ctx.services.mailbox();
    const vues = await Promise.all(externes.map((x) => mb.hasExchangedWith(x).catch(() => false)));
    const d = await decisionAutonome(ctx, "rdv", { texte: `${input.titre}\n${input.description ?? ""}`, jamaisVue: externes.filter((_, i) => !vues[i]) });
    const apercu = [`📅 ${quand}`, input.lieu ? `📍 ${input.lieu}` : "", `Invités : ${invites.join(", ")}`, input.description ? `\n${input.description}` : ""].filter(Boolean).join("\n");
    await ctx.db.insertApproval({
      agent_id: ctx.agent.id,
      task_id: ctx.task.id,
      type_action: "rdv",
      titre: `Invitation : ${input.titre}`.slice(0, 200),
      destinataire: externes.join(", "),
      objet: input.titre,
      apercu,
      payload: { kind: "event", ...event, demo: cal.kind === "demo", ...(d.auto ? { envoyer_apres: d.envoyerApres.toISOString() } : { raison_douane: d.raison }) },
      execution_statut: "a_faire",
      ...(d.auto ? { statut: "approuve" as const, decide_par: "mode autonome" } : {}),
    });
    if (d.auto) {
      await ctx.db.insertJournal({ type: "action", titre: `⏱️ ${ctx.agent.nom} envoie l'invitation à ${heureParis(d.envoyerApres)} : ${input.titre}`.slice(0, 300), contenu: apercu, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
      return { content: `Invitation programmée : elle part automatiquement à ${heureParis(d.envoyerApres)} (mode autonome).`, etape: "Programme une invitation" };
    }
    await ctx.db.updateAgent(ctx.agent.id, { etat: "waiting_approval", interlocuteur: null });
    return { content: `Invitation déposée en Douane (invités extérieurs : ${externes.join(", ")}). Elle partira dès qu'un fondateur aura validé.`, etape: "Dépose une invitation en Douane" };
  },
});
