import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/env";
import { serverSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (hasSupabase()) await (await serverSupabase()).auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
