/** Boîte mail et agenda vus par les agents (Gmail / Google Agenda, ou données DÉMO). */

export interface MailSummary {
  id: string;
  threadId: string;
  de: string;
  a: string;
  objet: string;
  /** ISO */
  date: string;
  extrait: string;
  nonLu: boolean;
  demo?: boolean;
}

export interface MailFull extends MailSummary {
  corps: string;
  cc?: string;
  messageIdHeader?: string;
  references?: string;
}

export interface OutgoingMail {
  a: string;
  objet: string;
  corps: string;
  /** version HTML (récaps) : le texte reste la version de secours */
  html?: string;
  /** pièces jointes (PDF des factures et devis) */
  pieces?: { nom: string; mime: string; data: Uint8Array }[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface Mailbox {
  kind: "gmail" | "demo";
  compte: string;
  list(q: string, max: number): Promise<MailSummary[]>;
  read(id: string): Promise<MailFull | null>;
  draft(m: OutgoingMail): Promise<{ id: string }>;
  send(m: OutgoingMail): Promise<{ id: string; threadId: string }>;
  /** ajoute des libellés (créés au besoin) ; markRead retire « non lu » */
  label(id: string, labels: string[], opts?: { markRead?: boolean }): Promise<void>;
  /** mails envoyés restés sans réponse depuis au moins `days` jours */
  sentWithoutReply(days: number, max: number): Promise<MailSummary[]>;
  /** l'agence a-t-elle déjà échangé avec cette adresse ? */
  hasExchangedWith(addr: string): Promise<boolean>;
}

export interface CalEvent {
  id: string;
  titre: string;
  debut: string;
  fin: string;
  lieu?: string;
  description?: string;
  invites: string[];
  demo?: boolean;
}

export interface NewEvent {
  titre: string;
  debut: string;
  fin: string;
  lieu?: string;
  description?: string;
  invites?: string[];
}

export interface Calendar {
  kind: "google" | "demo";
  compte: string;
  list(fromIso: string, toIso: string): Promise<CalEvent[]>;
  busy(fromIso: string, toIso: string): Promise<{ debut: string; fin: string }[]>;
  create(e: NewEvent): Promise<{ id: string; lien?: string }>;
}

/** Coffre des PDF (Supabase Storage, bucket privé « factures »). */
export interface Documents {
  ecrire(path: string, bytes: Uint8Array): Promise<void>;
  lire(path: string): Promise<Uint8Array | null>;
}

export interface Services {
  mailbox(): Promise<Mailbox>;
  calendar(): Promise<Calendar>;
  documents: Documents;
  /** Google Places (prospection) ou commerces de DÉMO */
  places(): Promise<import("./places").Places>;
  /** Shopify (MJ E-comm) ou boutique de DÉMO */
  boutique(): Promise<import("@/boutique/shopify").Boutique>;
  /** notification push sur le téléphone des fondateurs (absent en DÉMO) ; renvoie le nombre d'envois */
  notifier?(n: { titre: string; corps: string; url: string; tag?: string }): Promise<number>;
}

/** Extrait l'adresse d'un en-tête « Nom <adresse> ». */
export function adresse(h: string): string {
  const m = h.match(/<([^>]+)>/);
  return (m ? m[1]! : h).trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
