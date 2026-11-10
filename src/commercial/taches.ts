import type { EngineDb } from "@/engine/db";

/**
 * Tâches commerciales « à la demande » (seuls moments où l'IA travaille) : messages de Sacha,
 * fiche RDV de Théo, devis de Victor. Toutes les infos utiles sont dans la consigne : moins d'appels d'outils.
 */

export async function tacheSacha(db: EngineDb, leadIds: string[], par: string): Promise<string | null> {
  const leads = (await Promise.all(leadIds.slice(0, 10).map((id) => db.commercial.lead(id)))).filter((l): l is NonNullable<typeof l> => !!l);
  if (!leads.length) return null;
  const t = await db.insertTask({
    agent_id: "sacha",
    cree_par: par,
    titre: `Messages de prospection : ${leads.length} commerce${leads.length > 1 ? "s" : ""}`,
    description: [
      "Pour chaque commerce ci-dessous :",
      "1. Écris le DM Instagram (court, chaleureux, local, 3-4 phrases, une question ouverte, pas de lien) et enregistre-le avec update_lead (dm_instagram). Les fondateurs l'enverront à la main.",
      "2. S'il a un e-mail : prépare un mail de prospection personnalisé avec send_email (objet accrocheur, 5-7 lignes, vouvoiement, une observation concrète sur son commerce, l'angle proposé, une proposition d'appel de 15 min). Il partira en Douane (adresse jamais vue). Ne donne aucun prix.",
      "3. Passe le prospect au statut « a_contacter » avec update_lead.",
      "Termine avec un compte rendu court : un tableau commerce / angle / mail préparé (oui-non) / DM prêt.",
      "",
      ...leads.map(
        (l) =>
          `- id ${l.id} · ${l.nom} · ${l.metier ?? ""} à ${l.ville ?? ""} · ${l.note_google ? `${l.note_google}★, ${l.nb_avis ?? 0} avis` : "note inconnue"} · ${l.site ? `site ${l.site}` : "pas de site"} · e-mail : ${l.email ?? "aucun"} · Instagram : ${l.instagram ? `@${l.instagram}` : "inconnu"} · diagnostic : ${l.diagnostic ?? "—"} · angle : ${l.angle ?? "—"}`,
      ),
    ].join("\n"),
    priorite: 3,
    statut: "queued",
  });
  await db.insertMessage({ from_agent: "ines", to_agent: "sacha", task_id: t.id, type: "delegation", contenu: `${leads.length} prospects à contacter`, resume_bulle: `Sacha, ${leads.length} prospects prêts pour tes messages !` });
  return t.id;
}

export async function tacheTheo(db: EngineDb, oppId: string, par: string): Promise<string | null> {
  const [o] = await db.commercial.findOpportunities(oppId);
  if (!o) return null;
  const l = o.lead_id ? await db.commercial.lead(o.lead_id) : null;
  const t = await db.insertTask({
    agent_id: "theo",
    cree_par: par,
    titre: `Fiche RDV : ${o.titre}`.slice(0, 200),
    description: [
      `Prépare la fiche du rendez-vous${o.rdv_le ? ` du ${o.rdv_le.slice(0, 16).replace("T", " à ")}` : ""} : « ${o.titre} ».`,
      l ? `Prospect : ${l.nom} · ${l.metier ?? ""} à ${l.ville ?? ""} · ${l.note_google ? `${l.note_google}★ (${l.nb_avis} avis)` : ""} · ${l.site ?? "pas de site"} · diagnostic : ${l.diagnostic ?? "—"} · angle : ${l.angle ?? "—"}` : "",
      o.notes ? `Notes : ${o.notes}` : "",
      "Si le commerce a un site, lis-le avec fetch_url_summary (une fois). Puis rends ta fiche avec finish_task : le commerce en bref, ce qu'on a remarqué, 6 à 8 questions à poser, les objections probables avec les réponses, l'offre à proposer et la suite (devis, délai).",
    ]
      .filter(Boolean)
      .join("\n"),
    priorite: 3,
    statut: "queued",
  });
  return t.id;
}

export async function tacheVictor(db: EngineDb, oppId: string, par: string): Promise<string | null> {
  const [o] = await db.commercial.findOpportunities(oppId);
  if (!o) return null;
  const l = o.lead_id ? await db.commercial.lead(o.lead_id) : null;
  const t = await db.insertTask({
    agent_id: "victor",
    cree_par: par,
    titre: `Devis : ${o.titre}`.slice(0, 200),
    description: [
      `Prépare le devis de l'opportunité « ${o.titre} » (id ${o.id})${o.montant ? `, budget évoqué : ${o.montant} €` : ""}.`,
      l ? `Client : ${l.nom} · ${l.adresse ?? ""} · ${l.email ?? "pas d'e-mail"} · besoin probable : ${l.angle ?? "—"} (${l.diagnostic ?? ""})` : "",
      o.notes ? `Notes du RDV : ${o.notes}` : "",
      "Utilise la grille tarifaire de la mémoire d'entreprise. create_quote (client_nouveau si besoin), vérifie, puis render_pdf pour l'émettre, puis update_opportunity_stage avec le numéro du devis. Ne l'envoie pas : les fondateurs le relisent d'abord (send_document seulement si on te le demande).",
      "Rends un compte rendu : lignes du devis, total, justification des prix, ce qu'il reste à valider.",
    ]
      .filter(Boolean)
      .join("\n"),
    priorite: 3,
    statut: "queued",
  });
  return t.id;
}
