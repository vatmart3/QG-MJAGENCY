"use client";

import { useEffect, useState } from "react";
import { lirePilote, type Pilote } from "@/commercial/pilote-reglages";
import { browserSupabase } from "@/lib/supabase/client";
import { btnDark, Card, input } from "./finances/ui";

/** Commercial → Réglages : le pilote commercial automatique (Sacha écrit tout seul aux prospects). */
export function PiloteCard() {
  const [p, setP] = useState<Pilote | null>(null);
  const [stats, setStats] = useState<{ programmes: number; contactes: number; repondu: number; desinscrits: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    const sb = browserSupabase();
    if (!sb) return;
    void (async () => {
      const { data, error } = await sb.from("settings").select("pilote_commercial").eq("id", 1).maybeSingle();
      if (error) return setMsg({ ok: false, t: /pilote_commercial/.test(error.message) ? "La base n'a pas encore le pilote commercial (migration 1700 à appliquer)." : error.message });
      setP(lirePilote(data?.pilote_commercial));
      const debut = new Date();
      debut.setHours(0, 0, 0, 0);
      const [a, c, r, d] = await Promise.all([
        sb.from("approvals").select("id", { count: "exact", head: true }).eq("decide_par", "pilote commercial").gte("cree_le", debut.toISOString()),
        sb.from("leads").select("id", { count: "exact", head: true }).eq("statut", "contacte"),
        sb.from("leads").select("id", { count: "exact", head: true }).eq("statut", "repondu"),
        sb.from("desinscrits").select("email", { count: "exact", head: true }),
      ]);
      setStats({ programmes: a.count ?? 0, contactes: c.count ?? 0, repondu: r.count ?? 0, desinscrits: d.count ?? 0 });
    })();
  }, []);
  if (!p) return msg ? <p className="text-[12px] text-phare">{msg.t}</p> : null;
  const set = (patch: Partial<Pilote>) => setP({ ...p, ...patch });
  const sauver = async () => {
    const { error } = await browserSupabase()!.from("settings").update({ pilote_commercial: p }).eq("id", 1);
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: p.actif ? "Pilote enregistré : Sacha prospecte tout seul." : "Pilote coupé : plus aucun mail de prospection automatique." });
  };
  return (
    <Card className={p.actif ? "border-moss/40" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px]">🤖 Pilote commercial automatique</b>
        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={p.actif} onChange={(e) => set({ actif: e.target.checked })} />
          {p.actif ? "Actif" : "Coupé"}
        </label>
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">
        Chaque jour de semaine : Hugo et Inès trouvent et notent des commerces (10 h), <b>Sacha écrit aux meilleurs</b> (10 h 30) et les mails <b>partent tout seuls</b>, étalés dans la journée. Relance unique sans réponse, puis plus rien. Une réponse arrive dans le pipeline (Noé et Victor prennent le relais) ; un « STOP » ou le lien de désinscription retire l&apos;adresse pour toujours. Un mail qui parle de prix passe par la Douane.
      </p>
      {stats && (
        <p className="mt-2 text-[12px]">
          Aujourd&apos;hui : <b>{stats.programmes}</b> mail(s) programmé(s) · contactés : <b>{stats.contactes}</b> · ont répondu : <b>{stats.repondu}</b> · désinscrits : <b>{stats.desinscrits}</b>
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <label>
          Mails par jour (max 40)
          <input className={input} inputMode="numeric" value={p.mails_par_jour} onChange={(e) => set({ mails_par_jour: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
        </label>
        <label>
          Score minimum (/100)
          <input className={input} inputMode="numeric" value={p.score_min} onChange={(e) => set({ score_min: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        </label>
        <label>
          Relance après (jours, 0 = jamais)
          <input className={input} inputMode="numeric" value={p.relance_jours} onChange={(e) => set({ relance_jours: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
        </label>
        <label>
          Envois entre
          <span className="flex items-center gap-1">
            <input className={input} value={p.debut} onChange={(e) => set({ debut: e.target.value })} />
            <input className={input} value={p.fin} onChange={(e) => set({ fin: e.target.value })} />
          </span>
        </label>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-soft">Conseil : 10 à 20 mails par jour maximum depuis une boîte Gmail, pour ne pas être classé en spam. Les commerces de démonstration ne sont jamais contactés : il faut la clé Google Places pour de vrais prospects.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={btnDark} onClick={() => void sauver()}>
          Enregistrer
        </button>
        {msg && <span className={`text-[12px] ${msg.ok ? "text-moss" : "text-phare"}`}>{msg.t}</span>}
      </div>
    </Card>
  );
}
