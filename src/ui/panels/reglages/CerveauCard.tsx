"use client";

import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

interface Etat {
  mode: "api" | "mixte" | "abonnement";
  secret: boolean;
  dernierPassage: string | null;
  vivant: boolean;
  attente: number;
  error?: string;
}

const MODES = [
  { id: "mixte", titre: "Mélangé (conseillé)", texte: "Réponses aux clients, SAV et tri du courrier tout de suite (clé API). Missions, rapports, devis, veille, prospection : par Claude sur ton abonnement." },
  { id: "abonnement", titre: "Tout sur l'abonnement", texte: "Aucun appel à la clé API pour les agents. Tout est fait aux passages de Claude Code (plus lent)." },
  { id: "api", titre: "Tout par la clé API", texte: "Le plus rapide : chaque tâche démarre dans la minute. Payé à l'usage." },
] as const;

/** Réglages → Connexions : qui fait réfléchir les agents (clé API, abonnement Claude, ou les deux). */
export function CerveauCard() {
  const [e, setE] = useState<Etat | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const load = useCallback(async () => {
    setE((await fetch("/api/claude/etat").then((r) => r.json()).catch(() => null)) as Etat | null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const choisir = async (mode: string) => {
    await browserSupabase()?.from("settings").update({ ia: { mode } }).eq("id", 1);
    void load();
  };
  const creerSecret = () => {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    setSecret(btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "").slice(0, 40));
    setCopie(false);
  };

  return (
    <section className="rounded-2xl border border-paper-edge bg-white/60 p-4">
      <h3 className="font-pixel text-lg">🧠 Cerveau des agents</h3>
      <p className="mt-1 text-[12.5px] text-ink-soft">Qui fait réfléchir les agents : la clé API (rapide, payée à l&apos;usage) ou Claude Code sur ton abonnement (déjà payé, passe régulièrement).</p>

      {e?.error && <p className="mt-2 text-[12px] text-phare">{e.error}</p>}
      {e && !e.error && (
        <>
          <div className="mt-3 space-y-1.5">
            {MODES.map((m) => (
              <label key={m.id} className={`flex cursor-pointer gap-2 rounded-xl border p-2.5 text-[12.5px] ${e.mode === m.id ? "border-ink/40 bg-white" : "border-paper-edge bg-white/50"}`}>
                <input type="radio" name="mode-ia" checked={e.mode === m.id} onChange={() => void choisir(m.id)} className="mt-0.5" />
                <span>
                  <b>{m.titre}</b>
                  <br />
                  <span className="text-ink-soft">{m.texte}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 rounded-xl bg-white/70 p-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <b>Claude Code (abonnement)</b>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${e.vivant ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-800"}`}>
                {e.vivant ? "passe bien ✓" : e.dernierPassage ? "ne passe plus" : "pas encore branché"}
              </span>
              <span className="ml-auto text-[11.5px] text-ink-soft">
                Dernier passage : {e.dernierPassage ? new Date(e.dernierPassage).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais"} · {e.attente} tâche(s) en attente
              </span>
            </div>
            {e.mode !== "api" && !e.vivant && <p className="mt-1 text-[12px] text-ink-soft">Tant que Claude Code n&apos;est pas passé dans les 3 dernières heures, tout part par la clé API : rien ne reste bloqué.</p>}
            {!e.secret && (
              <div className="mt-2">
                <p className="text-[12px] text-ink-soft">À faire une fois : crée la clé du passage de Claude, mets-la dans Vercel (<code>CLAUDE_WORKER_SECRET</code>) puis Redeploy, et donne-la à Claude Code quand il te la demande.</p>
                <button type="button" onClick={creerSecret} className="mt-1.5 rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px]">
                  🔑 Créer la clé CLAUDE_WORKER_SECRET
                </button>
                {secret && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px]">{secret}</code>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopie(true))} className="shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] text-white">
                      {copie ? "Copiée ✓" : "Copier"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
