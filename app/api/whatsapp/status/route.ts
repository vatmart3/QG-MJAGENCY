import { identify } from "@/lib/supabase/guard";

export const dynamic = "force-dynamic";

/** Quelles variables WhatsApp sont présentes (jamais leur valeur). */
export async function GET(request: Request) {
  const caller = await identify(request);
  if (caller?.kind !== "fondateur") return Response.json({ error: "Non autorisé" }, { status: 401 });
  const v = (k: string) => !!process.env[k];
  return Response.json({
    variables: { WHATSAPP_TOKEN: v("WHATSAPP_TOKEN"), WHATSAPP_PHONE_NUMBER_ID: v("WHATSAPP_PHONE_NUMBER_ID"), WHATSAPP_APP_SECRET: v("WHATSAPP_APP_SECRET"), WHATSAPP_VERIFY_TOKEN: v("WHATSAPP_VERIFY_TOKEN") },
    webhook: `${(process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "")}/api/whatsapp`,
  });
}
