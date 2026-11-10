"use client";

import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

interface Etat {
  configure: boolean;
  bot?: string;
  webhook?: boolean;
  erreur?: string | null;
  chats: { id: string; email: string; niveau: "tout" | "important" }[];
}

/** Réglages → Connexions : bot Telegram gratuit (missions + notifications « quel agent fait quoi »). */
export function TelegramCard() {
  const [e, setE] = useState<Etat | null>(null);
  const [busy, setBusy] = useState(false);
  const [lien, setLien] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [niveauPush, setNiveauPush] = useState<"tout" | "important">("tout");

  const load = useCallback(async () => {
    const r = await fetch("/api/telegram/setup");
    setE((await r.json().catch(() => ({ configure: false, chats: [] }))) as Etat);
    const sb = browserSupabase();
    const s = await sb?.from("settings").select("notifications").eq("id", 1).maybeSingle();
    setNiveauPush((s?.data?.notifications as { niveau?: string } | null)?.niveau === "important" ? "important" : "tout");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const action = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    const r = (await fetch("/api/telegram/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json())) as { ok?: boolean; error?: string; lien?: string };
    setBusy(false);
    if (r.error) setMsg({ ok: false, t: r.error });
    else {
      if (r.lien) setLien(r.lien);
      if (ok) setMsg({ ok: true, t: ok });
    }
    void load();
  };
  const changerPush = async (n: "tout" | "important") => {
    setNiveauPush(n);
    await browserSupabase()?.from("settings").update({ notifications: { niveau: n } }).eq("id", 1);
  };

  return (
    <section className="rounded-2xl border-2 border-moss/30 bg-white/60 p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-pixel text-lg">✈️ Telegram</h3>
        <span className="rounded-full bg-moss/15 px-2 py-0.5 text-[11px] text-moss">gratuit · recommandé</span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-soft">
        Sur ton téléphone : <b>chaque action des agents</b> (« <b>Noé</b> (Accueil) — Réponse envoyée à La Marée »), les demandes de la Douane, les alertes… et tu envoies tes <b>missions</b> en écrivant au bot. Résultat renvoyé dans la conversation.
      </p>

      {e && !e.configure && (
        <ol className="mt-3 list-decimal space-y-1 rounded-xl bg-white/70 p-3 pl-7 text-[12.5px]">
          <li>
            Dans Telegram, ouvre <b>@BotFather</b> → <code>/newbot</code> → nom « LE PORT MJAGENCY » → identifiant qui finit par <code>bot</code> (ex. <code>leport_mjagency_bot</code>).
          </li>
          <li>
            BotFather te donne un <b>jeton</b> : mets-le dans Vercel → Environment Variables → <code>TELEGRAM_BOT_TOKEN</code> → Redeploy.
          </li>
          <li>Reviens ici : bouton « Brancher le bot », puis « Relier mon téléphone ».</li>
        </ol>
      )}

      {e?.configure && (
        <div className="mt-3 space-y-2 rounded-xl bg-white/70 p-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Bot : <b>{e.bot ? `@${e.bot}` : "?"}</b>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${e.webhook ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-800"}`}>{e.webhook ? "branché ✓" : "pas encore branché"}</span>
            {!e.webhook && (
              <button type="button" disabled={busy} onClick={() => void action({ action: "installer" }, "Bot branché sur LE PORT.")} className="ml-auto rounded-full bg-ink px-3 py-1 text-[12px] text-white">
                Brancher le bot
              </button>
            )}
          </div>
          {e.erreur && <p className="text-[12px] text-phare">⚠️ {e.erreur}</p>}
          {e.webhook && (
            <>
              <div>
                <b>Comptes reliés</b>
                {e.chats.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <span>{c.email}</span>
                    <span className="text-ink-soft">· {c.niveau === "tout" ? "tout" : "l'important"}</span>
                    <button type="button" className="ml-auto text-[12px] text-phare" onClick={() => void action({ action: "retirer", id: c.id }, "Compte retiré.")}>
                      Retirer
                    </button>
                  </div>
                ))}
                {!e.chats.length && <p className="text-ink-soft">Aucun : relie ton téléphone (et Matheis le sien, depuis son compte LE PORT).</p>}
              </div>
              <button type="button" disabled={busy} onClick={() => void action({ action: "lien" })} className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-white">
                📱 Relier mon téléphone
              </button>
              {lien && (
                <p>
                  Ouvre ce lien sur ton téléphone (valable 10 min) puis appuie sur <b>Démarrer</b> :{" "}
                  <a href={lien} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline">
                    {lien}
                  </a>
                </p>
              )}
              <p className="text-[11.5px] text-ink-soft">Dans Telegram : /tout (chaque action, sans sonnerie) ou /calme (seulement l&apos;important, avec sonnerie).</p>
            </>
          )}
        </div>
      )}
      {msg && <p className={`mt-1.5 text-[12px] ${msg.ok ? "text-moss" : "text-phare"}`}>{msg.t}</p>}

      <label className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        Notifications de l&apos;application installée :
        <select className="rounded-xl border border-paper-edge bg-white/80 px-2 py-1 text-[12.5px]" value={niveauPush} onChange={(ev) => void changerPush(ev.target.value as "tout" | "important")}>
          <option value="tout">chaque action des agents</option>
          <option value="important">seulement l&apos;important</option>
        </select>
      </label>
    </section>
  );
}
