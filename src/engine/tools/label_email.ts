import { z } from "zod";
import { bulle } from "../prompts";
import { defineTool, findAgent } from "./types";

const CATEGORIES = ["client", "prospect", "fournisseur", "admin", "spam", "perso", "autre"] as const;
const LABEL: Record<(typeof CATEGORIES)[number], string> = {
  client: "Client",
  prospect: "Prospect",
  fournisseur: "Fournisseur",
  admin: "Admin",
  spam: "Spam",
  perso: "Perso",
  autre: "Autre",
};

/** Tri d'un mail (Lucie) : catégorie, résumé, urgence, libellé Gmail, et tâche pour le bon agent. */
export const labelEmail = defineTool({
  name: "label_email",
  description:
    "Classe un mail trié : catégorie, résumé d'une ligne, urgence (0 normal, 1 important, 2 urgent), libellé « LE PORT/… » dans Gmail. action=repondre crée une tâche de réponse pour Noé ; action=transmettre confie le dossier au bon pôle (devis → Victor, facture → Bastien, site en panne → Atelier Tech) ET Noé répond quand même au client ; action=aucune pour l'info, la pub ou le spam.",
  schema: z.object({
    id: z.string().min(1).max(200),
    categorie: z.enum(CATEGORIES),
    resume: z.string().min(1).max(300),
    urgence: z.number().int().min(0).max(2),
    action: z.enum(["aucune", "repondre", "transmettre"]),
    agent_id: z.string().max(40).optional().describe("agent à qui confier la suite (par défaut noe pour une réponse)"),
    consigne: z.string().max(1500).optional().describe("ce que l'agent doit faire"),
  }),
  async run(ctx, input) {
    const mb = await ctx.services.mailbox();
    const mail = (await ctx.db.email(input.id)) ?? null;
    const full = mail ? null : await mb.read(input.id);
    if (!mail && !full) return { content: `Mail introuvable : ${input.id}.`, isError: true };
    if (!mail && full) await ctx.db.insertEmails([{ id: full.id, thread_id: full.threadId, compte: mb.compte, de: full.de, a: full.a, objet: full.objet, extrait: full.extrait, recu_le: full.date, demo: mb.kind === "demo" }]);
    const objet = mail?.objet ?? full?.objet ?? "";
    const de = mail?.de ?? full?.de ?? "";

    try {
      await mb.label(input.id, ["LE PORT/Trié", `LE PORT/${LABEL[input.categorie]}`]);
    } catch (e) {
      // le libellé est un confort : le tri continue même si Gmail refuse
      await ctx.db.insertJournal({ type: "alerte", titre: "Libellé Gmail non appliqué", contenu: e instanceof Error ? e.message : String(e), agent_id: ctx.agent.id });
    }

    let suite = "";
    let taskId: string | null = null;
    if (input.action !== "aucune" && input.categorie !== "spam") {
      const cibleId = input.agent_id ?? (input.action === "repondre" ? "noe" : "");
      const cible = cibleId ? findAgent(ctx.team, cibleId) : undefined;
      if (!cible) return { content: `Agent inconnu pour la suite : « ${cibleId || "(aucun)"} ». Indique agent_id.`, isError: true };
      const titre = `${input.action === "repondre" ? "Répondre" : "Traiter"} : ${objet}`.slice(0, 200);
      const t = await ctx.db.insertTask({
        agent_id: cible.id,
        cree_par: ctx.agent.id,
        titre,
        description: [
          `Mail id=${input.id} de ${de}.`,
          `Résumé de ${ctx.agent.nom} : ${input.resume}`,
          input.consigne ? `Consigne : ${input.consigne}` : "",
          input.action === "repondre"
            ? "Lis le mail avec read_email, puis RÉPONDS avec send_email (repondre_a = l'id du mail) — jamais un simple brouillon. Vouvoie le client ; la signature MJAGENCY est ajoutée automatiquement."
            : "Lis le mail avec read_email si besoin, fais le nécessaire, puis rends ton compte rendu.",
        ]
          .filter(Boolean)
          .join("\n"),
        priorite: input.urgence === 2 ? 5 : input.urgence === 1 ? 3 : 2,
        profondeur: Math.min(3, ctx.task.profondeur + 1),
        statut: "queued",
      });
      taskId = t.id;
      await ctx.db.insertMessage({ from_agent: ctx.agent.id, to_agent: cible.id, task_id: t.id, type: "delegation", contenu: `${titre}\n\n${input.resume}`, resume_bulle: bulle(`${cible.nom}, un mail pour toi : ${objet}`) });
      suite = ` Tâche créée pour ${cible.nom}.`;
    }
    // un client ou un prospect confié à un autre pôle reçoit quand même une réponse de Noé (accusé de réception)
    const noe = findAgent(ctx.team, "noe");
    if (input.action === "transmettre" && (input.categorie === "client" || input.categorie === "prospect") && noe && taskId && input.agent_id !== "noe") {
      const pole = findAgent(ctx.team, input.agent_id ?? "")?.nom ?? "l'équipe";
      await ctx.db.insertTask({
        agent_id: noe.id,
        cree_par: ctx.agent.id,
        titre: `Répondre : ${objet}`.slice(0, 200),
        description: [
          `Mail id=${input.id} de ${de}.`,
          `Résumé de ${ctx.agent.nom} : ${input.resume}`,
          `Le dossier est confié à ${pole}. Réponds tout de suite avec send_email (repondre_a = l'id du mail) : remercie, montre que la demande est bien comprise, dis ce qui va se passer et quand (ex. « vous recevrez notre proposition sous 48 h »). Ne donne aucun prix. Vouvoie le client.`,
        ].join("\n"),
        priorite: input.urgence === 2 ? 5 : 3,
        profondeur: Math.min(3, ctx.task.profondeur + 1),
        statut: "queued",
      });
      suite += ` Noé répond au client pendant que ${pole} s'en occupe.`;
    }
    await ctx.db.updateEmail(input.id, { categorie: input.categorie, resume: input.resume, urgence: input.urgence, statut: "trie", task_id: taskId });
    if (input.urgence === 2) await ctx.db.insertJournal({ type: "alerte", titre: `📬 Mail urgent : ${objet}`.slice(0, 300), contenu: `${de}\n${input.resume}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Mail classé « ${LABEL[input.categorie]} » (urgence ${input.urgence}).${suite}`, etape: `Trie : ${objet.slice(0, 40)}` };
  },
});
