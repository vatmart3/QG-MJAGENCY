import { z } from "zod";
import { jouerPas } from "@/engine/claude-worker";
import { claudeCtx } from "@/engine/claude-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corps = z.object({
  id: z.string().uuid(),
  texte: z.string().max(20000).optional(),
  appels: z.array(z.object({ outil: z.string().min(1).max(80), input: z.unknown() })).max(10).default([]),
});

/** Un pas d'agent joué par Claude Code : les outils sont exécutés par le moteur (mêmes règles, même Douane). */
export async function POST(request: Request) {
  const c = await claudeCtx(request);
  if (!c.ok) return c.res;
  const p = corps.safeParse(await request.json().catch(() => null));
  if (!p.success) return Response.json({ erreur: `Corps invalide : ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}` }, { status: 400 });
  try {
    const r = await jouerPas(c.db, c.llm, c.services, p.data.id, p.data);
    return Response.json(r, { status: "erreur" in r ? 409 : 200 });
  } catch (e) {
    return Response.json({ erreur: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
