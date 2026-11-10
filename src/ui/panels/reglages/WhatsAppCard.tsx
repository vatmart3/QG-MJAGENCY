"use client";

import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

interface Status {
  variables: Record<string, boolean>;
  webhook: string;
}

/** Même règle que le serveur : 06 12 34 56 78 → 33612345678. */
function normNumero(n: string): string {
  const d = n.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (/^0[1-9]\d{8}$/.test(d)) return `33${d.slice(1)}`;
  return d;
}

/** Réglages → Connexions : envoyer des missions depuis WhatsApp. */
export function WhatsAppCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [numeros, setNumeros] = useState<Record<string, string>>({});
  const [allow, setAllow] = useState<string[]>([]);
  const [num, setNum] = useState("");
  const [mail, setMail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [verify, setVerify] = useState<string | null>(null);

  const load = useCallback(async () => {
    void fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then(setSt)
      .catch(() => undefined);
    const sb = browserSupabase();
    if (!sb) return;
    const { data, error } = await sb.from("settings").select("whatsapp, allowlist_emails").eq("id", 1).maybeSingle();
    if (error) return setMsg({ ok: false, t: /whatsapp/.test(error.message) ? "La base n'a pas encore les réglages WhatsApp (migration 1300 à appliquer)." : error.message });
    setNumeros(((data?.whatsapp as { numeros?: Record<string, string> } | null)?.numeros ?? {}) as Record<string, string>);
    const l = (data?.allowlist_emails as string[] | null) ?? [];
    setAllow(l);
    setMail((m) => m || l[0] || "");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const sauver = async (n: Record<string, string>, ok: string) => {
    const sb = browserSupabase();
    if (!sb) return;
    const { error } = await sb.from("settings").update({ whatsapp: { numeros: n } }).eq("id", 1);
    if (error) setMsg({ ok: false, t: error.message });
    else {
      setNumeros(n);
      setMsg({ ok: true, t: ok });
    }
  };
  const ajouter = () => {
    const n = normNumero(num);
    if (!/^\d{8,15}$/.test(n)) return setMsg({ ok: false, t: "Numéro invalide (ex. 06 12 34 56 78 ou +33 6 12 34 56 78)." });
    if (!mail) return setMsg({ ok: false, t: "Choisis le fondateur." });
    void sauver({ ...numeros, [n]: mail }, `+${n} peut envoyer des missions.`).then(() => setNum(""));
  };
  const pret = st && Object.values(st.variables).every(Boolean);

  return (
    <section className="rounded-2xl border border-paper-edge bg-white/60 p-4">
      <h3 className="font-pixel text-lg">💬 Missions par WhatsApp</h3>
      <p className="mt-1 text-[12.5px] text-ink-soft">
        Écris une mission au numéro WhatsApp du port : Marius l&apos;organise et le résultat revient dans la conversation. Aussi : <b>point</b>, <b>douane</b>, <b>aide</b>, ou « @victor … » pour un agent précis.
      </p>

      <div className="mt-3 rounded-xl bg-white/70 p-3">
        <b className="text-[13px]">Numéros autorisés</b>
        <div className="mt-1.5 space-y-1">
          {Object.entries(numeros).map(([n, e]) => (
            <div key={n} className="flex items-center gap-2 text-[12.5px]">
              <span className="font-medium">+{n}</span>
              <span className="text-ink-soft">→ {e}</span>
              <button
                type="button"
                className="ml-auto text-[12px] text-phare"
                onClick={() => {
                  const c = { ...numeros };
                  delete c[n];
                  void sauver(c, "Numéro retiré.");
                }}
              >
                Retirer
              </button>
            </div>
          ))}
          {!Object.keys(numeros).length && <p className="text-[12px] text-ink-soft">Aucun numéro : ajoute le tien (et celui de Matheis).</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="w-44 rounded-xl border border-paper-edge bg-white/80 px-3 py-1.5 text-[13px]" value={num} onChange={(e) => setNum(e.target.value)} placeholder="06 12 34 56 78" inputMode="tel" />
          <select className="rounded-xl border border-paper-edge bg-white/80 px-2 py-1.5 text-[13px]" value={mail} onChange={(e) => setMail(e.target.value)}>
            {allow.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button type="button" onClick={ajouter} className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-white">
            Autoriser
          </button>
        </div>
        {msg && <p className={`mt-1.5 text-[12px] ${msg.ok ? "text-moss" : "text-phare"}`}>{msg.t}</p>}
      </div>

      <div className="mt-3 rounded-xl bg-white/70 p-3 text-[12px]">
        <div className="flex items-center gap-2">
          <b className="text-[13px]">Connexion WhatsApp Business</b>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${pret ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-800"}`}>{pret ? "Configurée ✓" : "À configurer"}</span>
        </div>
        {st && (
          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 text-[11.5px]">
            {Object.entries(st.variables).map(([k, ok]) => (
              <li key={k}>
                {ok ? "✅" : "⬜"} <code>{k}</code>
              </li>
            ))}
          </ul>
        )}
        {st && (
          <p className="mt-2 text-ink-soft">
            Adresse du webhook à donner à Meta : <code className="rounded bg-white px-1 select-all">{st.webhook}</code>
          </p>
        )}
        {!pret && (
          <div className="mt-2">
            <button
              type="button"
              className="rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px]"
              onClick={() => {
                const b = new Uint8Array(18);
                crypto.getRandomValues(b);
                setVerify(btoa(String.fromCharCode(...b)).replace(/[+/=]/g, ""));
              }}
            >
              🔑 Créer un WHATSAPP_VERIFY_TOKEN
            </button>
            {verify && (
              <p className="mt-1">
                <code className="rounded bg-white px-1 select-all">{verify}</code> — à mettre dans Vercel ET dans Meta (« Jeton de vérification »).
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
