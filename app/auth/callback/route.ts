import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/supabase/server";

/** Retour du lien magique : échange le code contre une session puis entre dans le port. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await serverSupabase();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  return NextResponse.redirect(new URL(ok ? "/" : "/login?erreur=lien", url.origin));
}
