import { z } from "zod";
import { defineTool } from "./types";
import { parisLabel, parseParis } from "./agenda_common";

export const listEvents = defineTool({
  name: "list_events",
  description: "Liste les rendez-vous de l'agenda Google de l'agence entre deux dates (AAAA-MM-JJ ou AAAA-MM-JJTHH:MM, heure de Paris).",
  schema: z.object({ du: z.string().min(10).max(40), au: z.string().min(10).max(40) }),
  async run(ctx, input) {
    const from = parseParis(input.du);
    const to = parseParis(input.au, true);
    if (!from || !to || to <= from) return { content: "Dates invalides (format AAAA-MM-JJ).", isError: true };
    if (to.getTime() - from.getTime() > 62 * 86400_000) return { content: "Période trop longue (2 mois maximum).", isError: true };
    const cal = await ctx.services.calendar();
    const list = await cal.list(from.toISOString(), to.toISOString());
    const lines = list.map((e) => `- ${parisLabel(e.debut)} → ${parisLabel(e.fin).split(" ").pop()} · ${e.titre}${e.lieu ? ` · ${e.lieu}` : ""}${e.invites.length ? ` · invités : ${e.invites.join(", ")}` : ""}`);
    return { content: `${list.length} rendez-vous${cal.kind === "demo" ? " (agenda de DÉMONSTRATION, Google non connecté)" : ""} :\n${lines.join("\n") || "Aucun."}`, etape: "Consulte l'agenda" };
  },
});
