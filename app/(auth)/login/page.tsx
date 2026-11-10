import Link from "next/link";
import { hasSupabase } from "@/lib/env";
import { LoginForm } from "@/ui/auth/LoginForm";

export const metadata = { title: "Connexion — LE PORT" };
export const dynamic = "force-dynamic";

/** Connexion par lien magique, réservée à l'allowlist des fondateurs. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  const live = hasSupabase();
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-lavender to-peach p-6">
      <div className="paper relative w-full max-w-sm rotate-[-0.6deg] rounded-[22px] p-6">
        <div className="tape" />
        <div className="text-3xl">⚓</div>
        <h1 className="mt-2 font-pixel text-2xl">LE PORT</h1>
        <p className="mt-1 text-sm text-ink-soft">Quartier général IA de MJAGENCY</p>
        {live ? (
          <LoginForm erreur={erreur} />
        ) : (
          <>
            <p className="mt-6 font-hand text-xl leading-tight text-ink/80">Supabase n&apos;est pas encore configuré : le port tourne en mode démo, sans connexion.</p>
            <Link href="/" className="mt-4 inline-block rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white">
              Entrer dans le port (démo)
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
