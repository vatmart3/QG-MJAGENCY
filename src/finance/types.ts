/** Finance de MJAGENCY : types partagés (interface, moteur, PDF, exports). */

export interface Ligne {
  designation: string;
  quantite: number;
  prix_unitaire: number;
}

export interface ClientSnapshot {
  nom: string;
  contact?: string | null;
  email?: string | null;
  adresse?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  siret?: string | null;
  type?: "pro" | "particulier";
}

export interface Client extends ClientSnapshot {
  id: string;
  telephone?: string | null;
  notes?: string | null;
  type: "pro" | "particulier";
  importe?: boolean;
}

export type InvoiceStatut = "brouillon" | "emise" | "envoyee" | "payee" | "annulee";
export type QuoteStatut = "brouillon" | "emis" | "envoye" | "accepte" | "refuse" | "expire";

export interface Invoice {
  id: string;
  type: "facture" | "avoir";
  numero: string | null;
  client_id: string | null;
  client_snapshot: ClientSnapshot | null;
  objet: string;
  lignes: Ligne[];
  total: number;
  statut: InvoiceStatut;
  emis_le: string | null;
  echeance: string | null;
  paye_le: string | null;
  delai_jours: number;
  avoir_de: string | null;
  quote_id: string | null;
  abonnement_id: string | null;
  activite: "agence" | "ecomm";
  pdf_path: string | null;
  pdf_sha256: string | null;
  importee: boolean;
  relances?: { niveau: number; le: string }[];
  notes: string | null;
  cree_le: string;
}

export interface Quote {
  id: string;
  numero: string | null;
  client_id: string | null;
  client_snapshot: ClientSnapshot | null;
  objet: string;
  lignes: Ligne[];
  total: number;
  statut: QuoteStatut;
  emis_le: string | null;
  valable_jusqu: string | null;
  conditions: string | null;
  activite: "agence" | "ecomm";
  pdf_path: string | null;
  pdf_sha256: string | null;
  notes: string | null;
  cree_le: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  montant: number;
  date: string;
  moyen: "virement" | "carte" | "especes" | "cheque" | "prelevement" | "autre";
  note: string | null;
}

export interface Subscription {
  id: string;
  client_id: string;
  libelle: string;
  lignes: Ligne[];
  montant: number;
  actif: boolean;
  debut: string;
  fin: string | null;
  dernier_mois: string | null;
}

export interface EcommMonth {
  mois: string;
  ca: number;
  cout_marchandises: number;
  depenses_pub: number;
  autres_frais: number;
  note: string | null;
}

export interface FinanceSettings {
  objectif_mensuel: number;
  taux_cotisations: number;
  periodicite: "mensuelle" | "trimestrielle";
  seuil_tva: number;
  seuil_tva_majore: number;
  delai_paiement: number;
  validite_devis: number;
  iban: string;
}

export const FINANCE_DEFAUT: FinanceSettings = {
  objectif_mensuel: 6000,
  taux_cotisations: 0.246,
  periodicite: "mensuelle",
  seuil_tva: 37500,
  seuil_tva_majore: 41250,
  delai_paiement: 30,
  validite_devis: 30,
  iban: "",
};

export const lireFinance = (v: unknown): FinanceSettings => ({ ...FINANCE_DEFAUT, ...((v && typeof v === "object" ? v : {}) as Partial<FinanceSettings>) });

/** Émetteur (mentions obligatoires). */
export const EMETTEUR = {
  nom: "MJAGENCY",
  dirigeants: "Jérémy Vatuone & Matheis Farrieux",
  adresse: "54 rue Marceau",
  ville: "34200 Sète",
  siret: "992 328 120 00017",
  email: "mjagency.officiel@gmail.com",
  telephone: "06 11 71 83 68",
  site: "mjagency.eu",
  tva: "TVA non applicable, art. 293 B du CGI",
};

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const totalLignes = (l: Ligne[]): number => Math.round(l.reduce((s, x) => s + num(x.quantite) * num(x.prix_unitaire), 0) * 100) / 100;

export const eur = (n: number, dec = 2): string =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/ /g, " ");

export const dateFr = (d: string | null | undefined): string => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "—");
