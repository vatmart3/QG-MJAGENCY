import { z } from "zod";

/** Validation des formulaires de Réglages (et, plus tard, des entrées d'API). */

const slug = z.string().regex(/^[a-z0-9-]{2,40}$/, "Identifiant : 2 à 40 caractères, minuscules, chiffres ou tirets");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #RRGGBB");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM");

export const TOOLS = [
  "ask_agent", "delegate_task", "post_to_journal", "request_meeting", "finish_task", "ask_founder",
  "read_company_memory", "search_memory", "write_agent_note", "propose_company_memory_update",
  "list_inbox", "read_email", "search_emails", "create_email_draft", "send_email", "label_email",
  "list_events", "find_free_slots", "create_event",
  "create_lead", "update_lead", "search_leads", "create_opportunity", "update_opportunity_stage", "get_client",
  "places_search", "fetch_url_summary", "web_search",
  "create_quote", "create_invoice", "render_pdf", "record_payment", "list_unpaid_invoices", "get_finance_summary", "get_tax_calendar",
  "check_site_health", "audit_url",
  "create_founder_todo",
] as const;

export const agentSchema = z.object({
  id: slug,
  nom: z.string().trim().min(1, "Nom requis").max(40),
  pole: z.string().min(1, "Choisis un pôle"),
  role: z.string().trim().min(1, "Rôle requis").max(120),
  personnalite: z.string().trim().max(400),
  promptSysteme: z.string().max(8000),
  modele: z.enum(["planner", "worker", "light"]),
  outils: z.array(z.enum(TOOLS)),
  autonomie: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  apparenceSeed: z.string().min(1).max(60),
  critique: z.boolean(),
  responsable: z.boolean().optional(),
  sortant: z.boolean(),
  taches: z.array(z.string().max(200)),
  routines: z.array(z.string()),
  actif: z.boolean(),
  ordre: z.number().int(),
});

export const poleSchema = z.object({
  id: slug,
  nom: z.string().trim().min(1, "Nom requis").max(80),
  court: z.string().trim().min(1, "Nom court requis").max(24),
  icone: z.string().trim().min(1, "Icône requise").max(8),
  couleur: hex,
  sol: hex,
  description: z.string().max(400),
  missions: z.array(z.string().trim().min(1).max(160)).max(12),
  kind: z.enum(["pole", "lieu"]),
  position: z.string().regex(/^c[1-5]r[1-5]$/, "Emplacement invalide"),
  style: z.enum(["muret", "verre", "douane", "back"]),
  actif: z.boolean(),
  ordre: z.number().int(),
});

export const routineSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{2,60}$/),
    nom: z.string().trim().min(1, "Nom requis").max(120),
    agentId: z.string().min(1, "Choisis un agent"),
    mode: z.enum(["fixe", "intervalle"]),
    heure: hhmm,
    intervalleMinutes: z.number().int().min(5, "5 minutes minimum").max(1440),
    plageDebut: hhmm,
    plageFin: hhmm,
    jours: z.array(z.number().int().min(1).max(7)),
    jourDuMois: z.number().int().min(1).max(28).nullable(),
    promptTache: z.string().trim().min(1, "Décris la tâche").max(4000),
    actif: z.boolean(),
  })
  .refine((r) => r.mode === "fixe" || r.plageDebut < r.plageFin, { message: "La plage doit finir après son début", path: ["plageFin"] });

export const memorySchema = z.object({
  id: z.string().min(1),
  cle: z.string().trim().regex(/^[a-z0-9_]{1,80}$/, "Clé : minuscules, chiffres et _"),
  contenu: z.string().trim().min(1, "Contenu requis").max(4000),
});

export const settingsSchema = z.object({
  budgetJour: z.number().min(0).max(500),
  budgetMois: z.number().min(0).max(10000),
  allowlistEmails: z.array(z.email("E-mail invalide")).min(1, "Au moins une adresse"),
  recapDestinataires: z.array(z.email("E-mail invalide")),
  signataire: z.enum(["Jérémy", "Matheis", "L'équipe MJAGENCY"]),
  bavardageActif: z.boolean(),
  contraintesAgenda: z.object({ jeremy: z.string().max(2000), matheis: z.string().max(2000) }),
});

export const missionSchema = z.object({ texte: z.string().trim().min(1).max(4000) });

/** Premier message d'erreur lisible d'une validation zod. */
export function firstError(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? i.message : "Saisie invalide";
}
