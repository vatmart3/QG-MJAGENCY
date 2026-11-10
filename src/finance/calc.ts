import { type EcommMonth, type FinanceSettings, type Invoice, type Payment, type Subscription, num } from "./types";

/** Tableau de bord financier (calculs purs, réutilisés par l'interface, les agents et la clôture du mois). */

export interface MoisStat {
  mois: string;
  facture: number;
  encaisse: number;
}

export interface Resume {
  mois: string;
  factureMois: number;
  encaisseMois: number;
  aEncaisser: number;
  impayes: { id: string; numero: string; client: string; total: number; reste: number; retardJours: number }[];
  totalImpayes: number;
  objectif: number;
  pctObjectif: number;
  cotisationsMois: number;
  caAnnuelEncaisse: number;
  seuilTva: number;
  pctSeuilTva: number;
  historique: MoisStat[];
  prevision: { mois: string; montant: number; detail: string }[];
  abonnementsMensuels: number;
}

const ym = (d: string) => d.slice(0, 7);

export function moisDecale(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mm - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function resumeFinance(o: { invoices: Invoice[]; payments: Payment[]; subscriptions: Subscription[]; settings: FinanceSettings; mois: string; aujourdhui: string }): Resume {
  const agence = o.invoices.filter((i) => i.activite === "agence" && i.statut !== "brouillon");
  const ids = new Set(agence.map((i) => i.id));
  const pays = o.payments.filter((p) => ids.has(p.invoice_id));
  const regle = new Map<string, number>();
  for (const p of pays) regle.set(p.invoice_id, (regle.get(p.invoice_id) ?? 0) + num(p.montant));

  const factureDe = (m: string) => agence.filter((i) => i.emis_le && ym(i.emis_le) === m).reduce((s, i) => s + num(i.total), 0);
  const encaisseDe = (m: string) => pays.filter((p) => ym(p.date) === m).reduce((s, p) => s + num(p.montant), 0);

  const ouvertes = agence.filter((i) => i.type === "facture" && (i.statut === "emise" || i.statut === "envoyee"));
  const impayes = ouvertes
    .map((i) => {
      const reste = Math.round((num(i.total) - (regle.get(i.id) ?? 0)) * 100) / 100;
      const retard = i.echeance ? Math.floor((Date.parse(o.aujourdhui) - Date.parse(i.echeance)) / 86400_000) : 0;
      return { id: i.id, numero: i.numero ?? "—", client: i.client_snapshot?.nom ?? "—", total: num(i.total), reste, retardJours: retard };
    })
    .filter((x) => x.reste > 0);
  const enRetard = impayes.filter((x) => x.retardJours > 0);

  const historique: MoisStat[] = [];
  for (let k = 11; k >= 0; k--) {
    const m = moisDecale(o.mois, -k);
    historique.push({ mois: m, facture: round(factureDe(m)), encaisse: round(encaisseDe(m)) });
  }
  const annee = o.mois.slice(0, 4);
  const caAnnuel = pays.filter((p) => p.date.startsWith(annee)).reduce((s, p) => s + num(p.montant), 0);

  // prévision 3 mois : abonnements actifs + moyenne des encaissements « ponctuels » des 3 derniers mois + reste à encaisser
  const abonnements = o.subscriptions.filter((s) => s.actif).reduce((s, x) => s + num(x.montant), 0);
  const moy3 = historique.slice(-4, -1).reduce((s, h) => s + h.encaisse, 0) / 3;
  const aEncaisser = impayes.reduce((s, x) => s + x.reste, 0);
  const prevision = [1, 2, 3].map((k) => {
    const m = moisDecale(o.mois, k);
    const montant = Math.max(abonnements, moy3) + (k === 1 ? aEncaisser : 0);
    return { mois: m, montant: round(montant), detail: k === 1 ? "tendance des 3 derniers mois (abonnements compris) + factures en attente" : "tendance des 3 derniers mois (abonnements compris)" };
  });

  const encaisseMois = encaisseDe(o.mois);
  return {
    mois: o.mois,
    factureMois: round(factureDe(o.mois)),
    encaisseMois: round(encaisseMois),
    aEncaisser: round(aEncaisser),
    impayes: enRetard.sort((a, b) => b.retardJours - a.retardJours),
    totalImpayes: round(enRetard.reduce((s, x) => s + x.reste, 0)),
    objectif: o.settings.objectif_mensuel,
    pctObjectif: o.settings.objectif_mensuel ? Math.round((encaisseMois / o.settings.objectif_mensuel) * 100) : 0,
    cotisationsMois: round(encaisseMois * o.settings.taux_cotisations),
    caAnnuelEncaisse: round(caAnnuel),
    seuilTva: o.settings.seuil_tva,
    pctSeuilTva: o.settings.seuil_tva ? Math.round((caAnnuel / o.settings.seuil_tva) * 100) : 0,
    historique,
    prevision,
    abonnementsMensuels: round(abonnements),
  };
}

export function margeEcomm(m: EcommMonth): number {
  return round(num(m.ca) - num(m.cout_marchandises) - num(m.depenses_pub) - num(m.autres_frais));
}

const round = (n: number) => Math.round(n * 100) / 100;
