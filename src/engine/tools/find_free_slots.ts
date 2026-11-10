import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { defineTool } from "./types";
import { TZ, parisLabel, parisLocal, parseParis } from "./agenda_common";

/** Créneaux libres (jours ouvrés, plage horaire), en tenant compte de l'agenda et des contraintes fixes des fondateurs. */
export const findFreeSlots = defineTool({
  name: "find_free_slots",
  description:
    "Trouve des créneaux libres dans l'agenda de l'agence (lundi-vendredi, heure de Paris). Rappelle aussi les contraintes fixes de Jérémy et Matheis (Réglages) : respecte-les avant de proposer un créneau.",
  schema: z.object({
    du: z.string().min(10).max(40),
    au: z.string().min(10).max(40),
    duree_minutes: z.number().int().min(15).max(480),
    heure_min: z.number().int().min(6).max(22).optional().describe("début de journée, défaut 9"),
    heure_max: z.number().int().min(7).max(23).optional().describe("fin de journée, défaut 19"),
    max: z.number().int().min(1).max(15).optional(),
  }),
  async run(ctx, input) {
    const from = parseParis(input.du);
    const to = parseParis(input.au, true);
    if (!from || !to || to <= from) return { content: "Dates invalides (format AAAA-MM-JJ).", isError: true };
    if (to.getTime() - from.getTime() > 31 * 86400_000) return { content: "Période trop longue (31 jours maximum).", isError: true };
    const hMin = input.heure_min ?? 9;
    const hMax = Math.max(hMin + 1, input.heure_max ?? 19);
    const cal = await ctx.services.calendar();
    const busy = (await cal.busy(from.toISOString(), to.toISOString())).map((b) => [new Date(b.debut).getTime(), new Date(b.fin).getTime()] as const);
    const dur = input.duree_minutes * 60_000;
    const slots: Date[] = [];
    const now = ctx.now.getTime();
    for (let day = new Date(from); day <= to && slots.length < (input.max ?? 8); day = new Date(day.getTime() + 86400_000)) {
      const ymd = formatInTimeZone(day, TZ, "yyyy-MM-dd");
      const dow = Number(formatInTimeZone(day, TZ, "i"));
      if (dow > 5) continue;
      for (let m = hMin * 60; m + input.duree_minutes <= hMax * 60 && slots.length < (input.max ?? 8); m += 30) {
        const start = fromZonedTime(`${ymd}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`, TZ).getTime();
        if (start < now + 3600_000) continue;
        if (busy.some(([b0, b1]) => start < b1 && start + dur > b0)) continue;
        slots.push(new Date(start));
        m += 30; // espace les propositions
      }
    }
    const c = ctx.settings.contraintes_agenda;
    const contraintes = [c.jeremy && `Jérémy : ${c.jeremy}`, c.matheis && `Matheis : ${c.matheis}`].filter(Boolean).join(" · ");
    return {
      content: [
        `${slots.length} créneau(x) libre(s) de ${input.duree_minutes} min${cal.kind === "demo" ? " (agenda de DÉMONSTRATION)" : ""} :`,
        ...slots.map((s) => `- ${parisLabel(s)} (début ${parisLocal(s)})`),
        contraintes ? `Contraintes fixes à respecter : ${contraintes}` : "Aucune contrainte fixe renseignée dans Réglages.",
      ].join("\n"),
      etape: "Cherche des créneaux libres",
    };
  },
});
