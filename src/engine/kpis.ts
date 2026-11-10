import { formatInTimeZone } from "date-fns-tz";
import { moisDecale, resumeFinance } from "@/finance/calc";
import { eur } from "@/finance/types";
import type { Services } from "@/integrations/types";
import type { EngineDb } from "./db";

/** Tableau de bord de l'agence (Diane), calculé sans IA à partir des vraies données du port. */
export interface Kpis {
  mois: string;
  finance: { facture: number; encaisse: number; objectif: number; pctObjectif: number; aEncaisser: number; impayes: number; totalImpayes: number; abonnements: number };
  commercial: { prospects: number; aContacter: number; contactes: number; convertis: number; pipelineOuvert: number; pipelineMontant: number; signesMois: number; signesMontant: number };
  tech: { sites: number; enAlerte: number; disponibilite: number | null };
  boutique: { demo: boolean; commandes7j: number; ca7j: number; aExpedier: number } | null;
  ia: { coutMois: number; coutJour: number; budgetJour: number };
}

export async function kpis(db: EngineDb, services: Services, now = new Date()): Promise<Kpis> {
  const jour = formatInTimeZone(now, "Europe/Paris", "yyyy-MM-dd");
  const mois = jour.slice(0, 7);
  const f = db.finance;
  const [invoices, payments, subscriptions, fset, stats, sites, settings, coutMois, coutJour] = await Promise.all([
    f.invoicesSince(`${moisDecale(mois, -12)}-01`),
    f.payments(`${moisDecale(mois, -12)}-01`),
    f.subscriptions(),
    f.settings(),
    db.commercial.stats(),
    db.tech.sites(true),
    db.settings(),
    db.spentSince(`${mois}-01`),
    db.spentSince(jour),
  ]);
  const r = resumeFinance({ invoices, payments, subscriptions, settings: fset, mois, aujourdhui: jour });
  const ouverts = stats.pipeline.filter((p) => p.etape !== "signe" && p.etape !== "perdu");
  const signes = stats.pipeline.filter((p) => p.etape === "signe" && p.maj_le.slice(0, 7) === mois);
  const histo = sites.flatMap((s) => (s.historique ?? []).filter((h) => now.getTime() - new Date(h.le).getTime() < 7 * 86400_000));
  let boutique: Kpis["boutique"] = null;
  try {
    const b = await services.boutique();
    const cmd = (await b.commandes({ depuis: new Date(now.getTime() - 7 * 86400_000).toISOString(), max: 50 })).filter((c) => !c.annulee);
    boutique = { demo: b.kind === "demo", commandes7j: cmd.length, ca7j: Math.round(cmd.reduce((s, c) => s + c.total, 0) * 100) / 100, aExpedier: cmd.filter((c) => c.expedition === "UNFULFILLED").length };
  } catch {
    boutique = null;
  }
  const L = stats.leads;
  return {
    mois,
    finance: { facture: r.factureMois, encaisse: r.encaisseMois, objectif: r.objectif, pctObjectif: r.pctObjectif, aEncaisser: r.aEncaisser, impayes: r.impayes.length, totalImpayes: r.totalImpayes, abonnements: r.abonnementsMensuels },
    commercial: {
      prospects: Object.values(L).reduce((s, n) => s + n, 0),
      aContacter: L.a_contacter ?? 0,
      contactes: (L.contacte ?? 0) + (L.repondu ?? 0),
      convertis: L.converti ?? 0,
      pipelineOuvert: ouverts.length,
      pipelineMontant: ouverts.reduce((s, p) => s + p.montant, 0),
      signesMois: signes.length,
      signesMontant: signes.reduce((s, p) => s + p.montant, 0),
    },
    tech: { sites: sites.length, enAlerte: sites.filter((s) => s.alerte).length, disponibilite: histo.length ? Math.round((1000 * histo.filter((h) => h.ok).length) / histo.length) / 10 : null },
    boutique,
    ia: { coutMois: coutMois, coutJour: coutJour, budgetJour: settings.budget_jour },
  };
}

export function kpisTexte(k: Kpis): string {
  const pct = (n: number) => `${String(n).replace(".", ",")} %`;
  return [
    `📊 Chiffres de l'agence — ${k.mois}`,
    `Finance : facturé ${eur(k.finance.facture)}, encaissé ${eur(k.finance.encaisse)} (${k.finance.pctObjectif} % de l'objectif ${eur(k.finance.objectif, 0)}) · reste à encaisser ${eur(k.finance.aEncaisser)} · ${k.finance.impayes} impayé(s) en retard (${eur(k.finance.totalImpayes)}) · abonnements ${eur(k.finance.abonnements)}/mois`,
    `Commercial : ${k.commercial.prospects} prospects (${k.commercial.aContacter} à contacter, ${k.commercial.contactes} contactés, ${k.commercial.convertis} convertis) · pipeline ouvert : ${k.commercial.pipelineOuvert} affaire(s) pour ${eur(k.commercial.pipelineMontant, 0)} · signé ce mois : ${k.commercial.signesMois} (${eur(k.commercial.signesMontant, 0)})`,
    `Atelier Tech : ${k.tech.sites} site(s) suivi(s), ${k.tech.enAlerte} en alerte${k.tech.disponibilite !== null ? ` · disponibilité 7 j : ${pct(k.tech.disponibilite)}` : ""}`,
    k.boutique ? `Boutique${k.boutique.demo ? " (DÉMO)" : ""} : ${k.boutique.commandes7j} commande(s) sur 7 j pour ${eur(k.boutique.ca7j)} · ${k.boutique.aExpedier} à expédier` : "Boutique : indisponible",
    `IA : ${eur(k.ia.coutJour)} aujourd'hui (budget ${eur(k.ia.budgetJour)}) · ${eur(k.ia.coutMois)} ce mois`,
  ].join("\n");
}
