import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSupabase } from "@/lib/env";
import { effectiveAllowlist, serverSupabase } from "@/lib/supabase/server";

const body = z.object({ email: z.email(), password: z.string().min(1).max(200) });

/** Connexion par e-mail + mot de passe (réservée à l'allowlist). Le mot de passe se choisit dans Réglages. */
export async function POST(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase n'est pas configuré (mode démo)." }, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "E-mail ou mot de passe manquant." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const refus = NextResponse.json({ error: "E-mail ou mot de passe incorrect." }, { status: 401 });

  if (!(await effectiveAllowlist()).includes(email)) return refus;
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error) {
    if (/rate|too many/i.test(error.message)) return NextResponse.json({ error: "Trop d'essais, attends une minute." }, { status: 429 });
    return refus;
  }
  return NextResponse.json({ ok: true });
}
