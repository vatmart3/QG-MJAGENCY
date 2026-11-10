import { z } from "zod";
import { bulle } from "../prompts";
import { defineTool, findAgent } from "./types";

/** Réunit des collègues dans La Criée (visible dans la ville) avec un message d'ouverture. */
export const requestMeeting = defineTool({
  name: "request_meeting",
  description: "Réunit des collègues dans La Criée pour un point rapide. Le message d'ouverture s'affiche dans la ville et dans le Journal.",
  schema: z.object({
    participants: z.array(z.string()).min(1).max(10),
    sujet: z.string().min(1).max(200),
    message: z.string().max(400).optional(),
  }),
  async run(ctx, input) {
    const ids = [...new Set(input.participants.map((p) => findAgent(ctx.team, p)?.id).filter((x): x is string => !!x))];
    if (!ids.length) return { content: "Aucun participant reconnu.", isError: true };
    await ctx.db.updateAgents([ctx.agent.id, ...ids], { etat: "meeting", interlocuteur: null });
    if (input.message) await ctx.db.insertMessage({ from_agent: ctx.agent.id, to_agent: null, type: "bavardage", contenu: input.message, resume_bulle: bulle(input.message) });
    const noms = ids.map((id) => ctx.team.find((a) => a.id === id)?.nom).join(", ");
    await ctx.db.insertJournal({ type: "decision", pole_id: "criee", agent_id: ctx.agent.id, titre: `Réunion dans La Criée : ${input.sujet}`, contenu: `Participants : ${noms}` });
    return { content: `Réunion organisée avec ${noms}.`, etape: "Réunion dans La Criée" };
  },
});
