"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from "@/lib/env";

let client: SupabaseClient | null = null;

/** Client Supabase du navigateur (session dans les cookies, partagée avec le middleware). */
export function browserSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
