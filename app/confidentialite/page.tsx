import type { Metadata } from "next";

export const metadata: Metadata = { title: "Confidentialité — LE PORT (MJAGENCY)" };

/** Politique de confidentialité de l'outil interne LE PORT (exigée par Google pour l'accès Gmail / Agenda). */
export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-[15px] leading-relaxed text-ink">
      <h1 className="text-2xl font-bold">Politique de confidentialité — LE PORT</h1>
      <p className="mt-1 text-sm text-ink-soft">Dernière mise à jour : 10 novembre 2026</p>

      <h2 className="mt-8 text-lg font-bold">Qui sommes-nous</h2>
      <p className="mt-2">
        LE PORT est l&apos;outil interne de MJAGENCY (agence web et marketing digital, 54 rue Marceau, 34200 Sète — SIRET 992 328 120 00017), édité par Jérémy Vatuone et Matheis Farrieux. Il
        n&apos;est accessible qu&apos;aux fondateurs de l&apos;agence. Contact : mjagency.officiel@gmail.com.
      </p>

      <h2 className="mt-8 text-lg font-bold">Données Google utilisées</h2>
      <p className="mt-2">Avec l&apos;autorisation explicite du titulaire du compte Google de l&apos;agence, LE PORT accède :</p>
      <ul className="mt-2 list-disc pl-5">
        <li>à Gmail (lecture, classement par libellés, brouillons et envoi) pour trier le courrier de l&apos;agence et préparer les réponses ;</li>
        <li>à Google Agenda (lecture et création d&apos;événements) pour gérer les rendez-vous des fondateurs.</li>
      </ul>
      <p className="mt-2">Aucun mail n&apos;est envoyé et aucune invitation externe n&apos;est créée sans la validation d&apos;un fondateur, sauf règle explicitement créée et révocable par eux.</p>

      <h2 className="mt-8 text-lg font-bold">Utilisation et partage</h2>
      <p className="mt-2">
        Les données servent uniquement au fonctionnement de l&apos;agence. Elles ne sont ni vendues, ni utilisées pour de la publicité, ni partagées avec des tiers, en dehors des sous-traitants
        techniques nécessaires au service : Supabase (hébergement de la base de données, Union européenne), Vercel (hébergement de l&apos;application) et Anthropic (analyse et rédaction par
        l&apos;IA, sans entraînement de modèles sur ces données). L&apos;utilisation des données reçues des API Google respecte la{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , y compris les exigences de « Limited Use ».
      </p>

      <h2 className="mt-8 text-lg font-bold">Conservation et sécurité</h2>
      <p className="mt-2">
        L&apos;accès Google est stocké chiffré (AES-256-GCM). Les données sont protégées par une authentification réservée aux fondateurs. L&apos;accès peut être retiré à tout moment depuis
        LE PORT (Réglages → Connexions) ou depuis myaccount.google.com/permissions ; les jetons sont alors supprimés.
      </p>

      <h2 className="mt-8 text-lg font-bold">Vos droits</h2>
      <p className="mt-2">Conformément au RGPD, vous pouvez demander l&apos;accès, la rectification ou la suppression de vos données en écrivant à mjagency.officiel@gmail.com.</p>
    </main>
  );
}
