import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, envAllowlist, hasSupabase } from "@/lib/env";

/** Client lié à la session de l'utilisateur (route handlers, server components). */
export async function serverSupabase(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // appelé depuis un server component : le middleware rafraîchit la session
        }
      },
    },
  });
}

/** Client « service_role » : contourne la RLS. Serveur uniquement, jamais exposé au navigateur. */
export function adminSupabase(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase() || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Allowlist effective : table settings (source de vérité), sinon variable ALLOWED_EMAILS. */
export async function effectiveAllowlist(): Promise<string[]> {
  const admin = adminSupabase();
  if (admin) {
    const { data, error } = await admin.from("settings").select("allowlist_emails").eq("id", 1).maybeSingle();
    if (!error && data?.allowlist_emails?.length) return (data.allowlist_emails as string[]).map((e) => e.toLowerCase());
  }
  return envAllowlist();
}
