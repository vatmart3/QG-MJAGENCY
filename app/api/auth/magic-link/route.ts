import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSupabase } from "@/lib/env";
import { adminSupabase, effectiveAllowlist, serverSupabase } from "@/lib/supabase/server";

const body = z.object({ email: z.email() });

/**
 * Envoie un lien magique, uniquement aux adresses de l'allowlist.
 * Avec la clé service_role, le compte est créé côté serveur : on peut alors
 * désactiver les inscriptions publiques dans Supabase (recommandé).
 */
export async function POST(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase n'est pas configuré (mode démo)." }, { status: 503 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Adresse e-mail invalide." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  const allowlist = await effectiveAllowlist();
  // même réponse que pour une adresse autorisée : on ne révèle pas qui a accès
  if (!allowlist.includes(email)) return NextResponse.json({ ok: true });

  const admin = adminSupabase();
  if (admin) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error && !/already|exists|registered/i.test(error.message)) {
      return NextResponse.json({ error: "Impossible de préparer le compte." }, { status: 500 });
    }
  }

  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: !admin, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    const limited = /rate|seconds/i.test(error.message);
    return NextResponse.json({ error: limited ? "Trop de demandes, réessaie dans une minute." : "L'envoi du lien a échoué." }, { status: limited ? 429 : 502 });
  }
  return NextResponse.json({ ok: true });
}
