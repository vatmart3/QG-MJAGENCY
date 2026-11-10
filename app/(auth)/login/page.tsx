import Link from "next/link";

export const metadata = { title: "Connexion — LE PORT" };

/** Phase 2 : magic link Supabase réservé à l'allowlist des fondateurs. */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-lavender to-peach p-6">
      <div className="paper relative w-full max-w-sm rotate-[-0.6deg] rounded-[22px] p-6">
        <div className="tape" />
        <div className="text-3xl">⚓</div>
        <h1 className="mt-2 font-pixel text-2xl">LE PORT</h1>
        <p className="mt-1 text-sm text-ink-soft">Quartier général IA de MJAGENCY</p>
        <label className="mt-6 block text-sm">
          E-mail
          <input type="email" disabled placeholder="ton@email.fr" className="mt-1 w-full rounded-full border border-paper-edge bg-white/70 px-4 py-2.5 outline-none" />
        </label>
        <button type="button" disabled className="mt-3 w-full rounded-full bg-ink py-2.5 text-sm font-medium text-white opacity-40">
          Recevoir mon lien magique
        </button>
        <p className="mt-4 font-hand text-lg leading-tight text-ink/80">La connexion arrive en Phase 2 (Supabase Auth, allowlist des fondateurs).</p>
        <Link href="/" className="mt-4 inline-block text-sm text-sea underline underline-offset-2">
          Entrer dans le port (démo)
        </Link>
      </div>
    </main>
  );
}
