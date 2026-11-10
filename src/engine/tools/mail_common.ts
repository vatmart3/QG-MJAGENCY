import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { adresse, EMAIL_RE, type MailSummary } from "@/integrations/types";
import type { ESettings } from "../db";
import { externe } from "../prompts";

export const AGENCY_MAILBOX = (process.env.AGENCY_MAILBOX ?? "mjagency.officiel@gmail.com").toLowerCase();

const SIGNATAIRES: Record<string, string> = {
  "Jérémy": "Jérémy Vatuone",
  Matheis: "Matheis Farrieux",
};

/** Signature automatique MJAGENCY (les agents ne signent jamais de leur nom vers l'extérieur). */
export function signature(s: ESettings): string {
  const nom = SIGNATAIRES[s.signataire] ?? "L'équipe MJAGENCY";
  return `\n\n--\n${nom}\nMJAGENCY — agence web & marketing digital · Sète\nmjagency.eu · ${AGENCY_MAILBOX}`;
}

export function withSignature(corps: string, s: ESettings): string {
  const propre = corps.replace(/\n+--\s*\n[\s\S]*$/, "").trimEnd();
  return propre + signature(s);
}

/** Adresses internes : fondateurs (allowlist) et boîte de l'agence. */
export function isInternal(addr: string, s: ESettings): boolean {
  const a = adresse(addr);
  return a === AGENCY_MAILBOX || s.allowlist_emails.some((e) => e.toLowerCase() === a);
}

export function parseRecipients(v: string): string[] | null {
  const list = v
    .split(/[,;]/)
    .map((x) => adresse(x))
    .filter(Boolean);
  if (!list.length || list.length > 10 || list.some((x) => !EMAIL_RE.test(x))) return null;
  return list;
}

export const dateFr = (iso: string) => formatInTimeZone(new Date(iso), "Europe/Paris", "EEE d MMM HH:mm", { locale: fr });

export function mailLines(list: MailSummary[]): string {
  if (!list.length) return "Aucun mail.";
  const body = list
    .map((m) => `- id=${m.id} · ${m.nonLu ? "[non lu] " : ""}${dateFr(m.date)}\n  De : ${m.de}\n  Objet : ${m.objet}\n  Extrait : ${m.extrait}`)
    .join("\n");
  return externe("gmail", body);
}

export const demoNote = (kind: string) => (kind === "demo" ? "\n(Boîte de DÉMONSTRATION : Google n'est pas encore connecté, ces mails sont fictifs et rien ne part vraiment.)" : "");
