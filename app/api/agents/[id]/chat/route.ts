import { NextResponse } from "next/server";
import { z } from "zod";
import { MODELS, costEur } from "@/engine/config";
import { supabaseEngineDb } from "@/engine/db";
import { llmFromEnv } from "@/engine/llm";
import { systemFor } from "@/engine/prompts";
import { identify } from "@/lib/supabase/guard";
import { adminSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const body = z.object({ message: z.string().trim().min(1).max(4000) });

/** Chat direct avec un agent (fiche agent) : un appel, sans outils, avec sa personnalité et la mémoire. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = adminSupabase();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY manquante." }, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message invalide." }, { status: 400 });

  const { id } = await params;
  const db = supabaseEngineDb(admin);
  const [agents, poles, memory, history] = await Promise.all([db.agents(), db.poles(), db.memory(), db.chats(id, 20)]);
  const agent = agents.find((a) => a.id === id && a.actif);
  if (!agent) return NextResponse.json({ error: "Agent introuvable." }, { status: 404 });

  await db.insertChat(id, "fondateur", parsed.data.message, caller.email);
  const llm = llmFromEnv();
  const model = MODELS[agent.modele];
  const messages = [...history, { role: "fondateur" as const, contenu: parsed.data.message }].map((m) => ({
    role: m.role === "fondateur" ? ("user" as const) : ("assistant" as const),
    content: m.contenu,
  }));
  try {
    const res = await llm.create({
      model,
      tier: agent.modele === "planner" ? "worker" : agent.modele,
      system: [
        ...systemFor(agent, agents, new Map(poles.map((p) => [p.id, p.nom])), memory),
        { type: "text", text: `Tu discutes directement avec un fondateur (${caller.email}) depuis ta fiche. Réponds en quelques phrases, sur le ton d'un collègue. Tu n'as pas d'outils dans cette discussion : si on te demande un vrai travail, propose de le faire passer par une mission.` },
      ],
      messages,
      tools: [],
      maxTokens: 4000,
      meta: { agentId: agent.id, agentNom: agent.nom, role: agent.role, planner: false, taskTitle: "chat", chat: true },
    });
    const reply = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim() || "…";
    await db.insertChat(id, "agent", reply);
    await db.insertUsage({ agent_id: id, modele: res.model, tokens_in: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite, tokens_out: res.usage.output, cout_estime: costEur(model, res.usage) });
    return NextResponse.json({ reply, simule: llm.kind === "mock" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur du modèle" }, { status: 502 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const admin = adminSupabase();
  if (!admin) return NextResponse.json({ messages: [] });
  const { id } = await params;
  return NextResponse.json({ messages: await supabaseEngineDb(admin).chats(id, 40) });
}
