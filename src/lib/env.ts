/**
 * Configuration publique. Sans URL/clé Supabase, LE PORT tourne en mode DÉMO
 * (tout en local, rien n'est enregistré côté serveur).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const hasSupabase = (): boolean => SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Allowlist de secours (variable ALLOWED_EMAILS) — côté serveur uniquement. */
export function envAllowlist(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
