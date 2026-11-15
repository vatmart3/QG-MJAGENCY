import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { defineTool } from "./types";

const TZ = "Europe/Paris";
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const sansAccents = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Jour d'une tâche (AAAA-MM-JJ, heure de Paris) à partir de « 2026-11-18 », « 18/11 », « aujourd'hui », « demain »,
 * « après-demain », « lundi »… (prochain jour de ce nom, aujourd'hui compris). Inconnu → aujourd'hui.
 */
export function jourDepuis(texte: string | undefined, now: Date): string {
  const auj = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  if (!texte) return auj;
  const t = sansAccents(texte);
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const plus = (n: number) => formatInTimeZone(new Date(fromZonedTime(`${auj}T12:00:00`, TZ).getTime() + n * 86400_000), TZ, "yyyy-MM-dd");
  const fr = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (fr) {
    const an = fr[3] ? (fr[3].length === 2 ? `20${fr[3]}` : fr[3]) : auj.slice(0, 4);
    const d = `${an}-${fr[2]!.padStart(2, "0")}-${fr[1]!.padStart(2, "0")}`;
    // « 05/01 » écrit en décembre : c'est l'année prochaine
    return !fr[3] && d < auj && plus(-60) > d ? `${Number(an) + 1}${d.slice(4)}` : d;
  }
  if (/apres[- ]demain/.test(t)) return plus(2);
  if (/demain/.test(t)) return plus(1);
  if (/aujourd/.test(t) || /ce (soir|matin|midi)/.test(t)) return auj;
  const i = JOURS.findIndex((j) => t.includes(j));
  if (i >= 0) {
    const ajd = Number(formatInTimeZone(now, TZ, "i")) % 7; // 1 = lundi … 7 = dimanche → 0 = dimanche
    return plus((i - ajd + 7) % 7);
  }
  return auj;
}

export const createFounderTodo = defineTool({
  name: "create_founder_todo",
  description:
    "Ajoute une tâche au CALENDRIER des fondateurs (onglet Calendrier du QG, et le récap) : post à publier (TikTok, Instagram…), appel, rendez-vous, relance, signature, démarche… avec le jour, l'heure conseillée et tout ce qu'il faut pour la faire (texte du post, script, numéro) dans « details ».",
  schema: z.object({
    titre: z.string().min(1).max(200).describe("Court et concret : « Publier le carrousel “3 erreurs sur Google” sur Instagram »"),
    jour: z.string().max(40).optional().describe("AAAA-MM-JJ, « demain », « vendredi », « 18/11 »… (par défaut aujourd'hui)"),
    heure: z
      .string()
      .regex(/^\d{1,2}[:h]\d{2}$/)
      .optional()
      .describe("Heure conseillée, ex. « 18:30 »"),
    categorie: z.enum(["contenu", "appel", "rdv", "prospection", "client", "finance", "admin", "autre"]).optional(),
    canal: z.enum(["tiktok", "instagram", "linkedin", "facebook", "youtube", "telephone", "email", "visite", "autre"]).optional(),
    details: z.string().max(6000).optional().describe("Texte complet du post, script d'appel, coordonnées, étapes…"),
    pour: z.enum(["Jérémy", "Matheis", "les deux"]).optional(),
    priorite: z.number().int().min(0).max(3).optional().describe("0 basse, 1 normale, 2 haute, 3 urgente"),
    /** compatibilité : ancienne échéance en texte libre */
    echeance: z.string().max(40).optional(),
  }),
  async run(ctx, input) {
    const jour = jourDepuis(input.jour ?? input.echeance, ctx.now);
    const heure = input.heure ? input.heure.replace("h", ":").padStart(5, "0") : null;
    const qui = input.pour ?? "les deux";
    await ctx.db.ajouterCalendrier({
      titre: input.titre,
      jour,
      heure,
      categorie: input.categorie ?? "autre",
      canal: input.canal ?? null,
      details: input.details ?? null,
      pour: qui === "les deux" ? null : qui,
      priorite: input.priorite ?? 1,
      agent_id: ctx.agent.id,
      cree_par: ctx.agent.id,
      cle: `${ctx.agent.id}:${jour}:${input.titre.slice(0, 80).toLowerCase()}`,
    });
    const quand = `${formatInTimeZone(fromZonedTime(`${jour}T12:00:00`, TZ), TZ, "EEEE d/MM")}${heure ? ` ${heure}` : ""}`;
    await ctx.db.insertJournal({ type: "action", titre: `🗓️ Au calendrier (${qui}) : ${input.titre} — ${quand}`, agent_id: ctx.agent.id, pole_id: ctx.agent.pole_id });
    return { content: `Ajouté au calendrier des fondateurs pour ${quand}.`, etape: "Calendrier des fondateurs" };
  },
});
