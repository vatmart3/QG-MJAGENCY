"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Etape, Lead, LeadStatut, Opportunity } from "@/commercial/db";
import { lireProspection, type Prospection } from "@/commercial/prospection";
import { eur, num, type Quote } from "@/finance/types";
import { browserSupabase } from "@/lib/supabase/client";
import { useUI } from "@/store/ui";
import { api, pdfUrl } from "./finances/data";
import { btn, btnDark, Card, input, Msg } from "./finances/ui";
import { PiloteCard } from "./PiloteCard";
import { RoutePanel } from "./RoutePanel";

const ETAPES: { id: Etape; label: string; color: string }[] = [
  { id: "nouveau", label: "Nouveau", color: "#8a8fa3" },
  { id: "contacte", label: "Contacté", color: "#3a7bd5" },
  { id: "rdv", label: "RDV", color: "#7c5cd6" },
  { id: "devis", label: "Devis envoyé", color: "#e0812c" },
  { id: "signe", label: "Signé", color: "#2e9d62" },
  { id: "perdu", label: "Perdu", color: "#c0392b" },
];
const STATUTS: Record<LeadStatut, string> = { nouveau: "Nouveau", a_contacter: "À contacter", contacte: "Contacté", repondu: "A répondu", converti: "Converti", ecarte: "Écarté" };

interface Data {
  leads: Lead[];
  opps: Opportunity[];
  quotes: Quote[];
  cfg: Prospection;
}

const kick = () => void import("@/sync/live").then(({ kickEngine }) => kickEngine());

function useCommercial() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const [l, o, q, s] = await Promise.all([
      sb.from("leads").select("*").order("score", { ascending: false }).limit(500),
      sb.from("opportunities").select("*").order("maj_le", { ascending: false }).limit(500),
      sb.from("quotes").select("id, numero, total, statut").limit(500),
      sb.from("settings").select("prospection").eq("id", 1).maybeSingle(),
    ]);
    const err = [l, o].find((r) => r.error)?.error;
    if (err) return setError(/does not exist|schema cache/i.test(err.message) ? "La base n'a pas encore les tables commerciales (migration 1100 à appliquer)." : err.message);
    setError(null);
    setData({
      leads: ((l.data ?? []) as Lead[]).map((x) => ({ ...x, score: num(x.score), note_google: x.note_google === null ? null : num(x.note_google) })),
      opps: ((o.data ?? []) as Opportunity[]).map((x) => ({ ...x, montant: x.montant === null ? null : num(x.montant) })),
      quotes: ((q.data ?? []) as Quote[]).map((x) => ({ ...x, total: num(x.total) })),
      cfg: lireProspection(s.data?.prospection),
    });
  }, []);
  useEffect(() => {
    void load();
    const sb = browserSupabase();
    if (!sb) return;
    const ch = sb
      .channel(`commercial-${Date.now().toString(36)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunities" }, () => void load())
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [load]);
  return { data, error, reload: load };
}

export function CommercialPanel() {
  const conn = useUI((s) => s.conn);
  const [tab, setTab] = useState<"prospects" | "pipeline" | "reglages">("prospects");
  return (
    <RoutePanel title="Commercial" kicker="Prospection & pipeline" icon="🎯" accent="#e0812c" width={820}>
      {conn === "demo" ? (
        <p className="text-sm text-ink-soft">Mode démo : branche Supabase pour la prospection (Google Places) et le pipeline.</p>
      ) : (
        <>
          <div className="mb-4 flex gap-1">
            {(
              [
                ["prospects", "Prospects"],
                ["pipeline", "Pipeline"],
                ["reglages", "Réglages"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${tab === k ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}>
                {l}
              </button>
            ))}
          </div>
          <Live tab={tab} />
        </>
      )}
    </RoutePanel>
  );
}

function Live({ tab }: { tab: "prospects" | "pipeline" | "reglages" }) {
  const { data, error, reload } = useCommercial();
  if (error) return <p className="rounded-xl bg-phare/10 px-3 py-2 text-[13px] text-phare">{error}</p>;
  if (!data) return <p className="text-[13px] text-ink-soft">Chargement…</p>;
  if (tab === "pipeline") return <Pipeline d={data} reload={reload} />;
  if (tab === "reglages") return <Reglages d={data} reload={reload} />;
  return <Prospects d={data} reload={reload} />;
}

// ------------------------------------------------------------------ prospects
function Prospects({ d, reload }: { d: Data; reload: () => void }) {
  const [filtre, setFiltre] = useState<"a_traiter" | "contactes" | "ecartes">("a_traiter");
  const [sel, setSel] = useState<string[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<"google" | "osm" | null>(null);
  useEffect(() => {
    void fetch("/api/commercial/status")
      .then((r) => r.json())
      .then((x: { source?: "google" | "osm" }) => setSource(x.source ?? null))
      .catch(() => setSource(null));
  }, []);
  const list = useMemo(
    () =>
      // dès qu'il y a de vrais prospects, les commerces de démonstration disparaissent de la liste
      d.leads
        .filter((l) => !l.demo || !d.leads.some((x) => !x.demo))
        .filter((l) =>
          filtre === "ecartes" ? l.statut === "ecarte" : filtre === "contactes" ? ["contacte", "repondu", "converti"].includes(l.statut) : ["nouveau", "a_contacter"].includes(l.statut),
        ),
    [d.leads, filtre],
  );
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, t: await fn() });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const maj = async (id: string, patch: Partial<Lead>) => {
    await browserSupabase()?.from("leads").update(patch).eq("id", id);
    reload();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className={btnDark}
          onClick={() =>
            void run(async () => {
              const r = await api<{ crees: number; demo: boolean; erreurs?: string[]; recherches?: number }>("/api/commercial/prospects", {});
              reload();
              if (r.crees) return `${r.crees} nouveau(x) prospect(s) trouvé(s) et noté(s)${r.demo ? " (DÉMO)" : ""}.`;
              if (r.erreurs?.length && !r.recherches) throw new Error(`La recherche n'a pas abouti : ${r.erreurs[0]}. Réessaie dans une minute.`);
              return "Aucun nouveau commerce pour ces recherches : réessaie (Hugo passe aux métiers suivants) ou élargis les métiers et zones dans Réglages.";
            })
          }
        >
          🔎 Trouver des prospects
        </button>
        {sel.length > 0 && (
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() =>
              void run(async () => {
                await api("/api/commercial/agent", { agent: "sacha", leads: sel });
                setSel([]);
                kick();
                return "Sacha écrit les messages (DM à copier + mails en Douane) : résultat dans une minute ou deux.";
              })
            }
          >
            ✍️ Faire écrire Sacha ({sel.length})
          </button>
        )}
        <select className={`${input} ml-auto w-auto`} value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
          <option value="a_traiter">À traiter</option>
          <option value="contactes">Contactés</option>
          <option value="ecartes">Écartés</option>
        </select>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-soft">
        {source === "osm" ? "Source : OpenStreetMap (gratuit, © les contributeurs d'OpenStreetMap) — sans note Google. " : source === "google" ? "Source : Google Places (avec les avis). " : ""}Hugo cherche chaque matin de semaine à 10 h, Inès note (sans IA). Coche les commerces à contacter : seule l&apos;écriture des messages par Sacha utilise l&apos;IA.
      </p>
      <Msg m={msg} />
      <ul className="mt-3 space-y-2">
        {list.map((l) => {
          const open = ouvert === l.id;
          return (
            <li key={l.id} className="rounded-2xl border border-paper-edge bg-white/65">
              <div className="flex items-center gap-2.5 px-3 py-2">
                <input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} aria-label={`Sélectionner ${l.nom}`} />
                <span className="grid size-10 shrink-0 place-items-center rounded-full font-pixel text-[13px] text-white" style={{ background: l.score >= 70 ? "#2e9d62" : l.score >= 50 ? "#e0812c" : "#8a8fa3" }}>
                  {l.score}
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOuvert(open ? null : l.id)}>
                  <span className="block truncate text-[13.5px] font-semibold">
                    {l.nom}
                    {l.demo && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[9.5px] font-bold text-amber-800">DÉMO</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-soft">
                    {l.metier} · {l.ville} · {l.note_google ? `${l.note_google}★ (${l.nb_avis ?? 0})` : "pas de note"} · {l.angle}
                  </span>
                </button>
                <span className="flex shrink-0 gap-1 text-[11px]">
                  {!l.site && <span className="rounded-full bg-phare/10 px-1.5 text-phare">sans site</span>}
                  {l.email && <span className="rounded-full bg-sky-100 px-1.5 text-sky-800">e-mail</span>}
                  {l.instagram && <span className="rounded-full bg-pink-100 px-1.5 text-pink-700">insta</span>}
                  {l.dm_instagram && <span className="rounded-full bg-moss/15 px-1.5 text-moss">DM prêt</span>}
                </span>
              </div>
              {open && (
                <div className="border-t border-paper-edge px-3 py-2.5 text-[12.5px]">
                  <p>
                    <b>Diagnostic d&apos;Inès :</b> {l.diagnostic ?? "—"}
                  </p>
                  <p className="mt-1">
                    <b>Angle :</b> {l.angle}
                  </p>
                  <p className="mt-1 text-ink-soft">
                    {[l.adresse, l.telephone, l.email].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {l.site && (
                      <a className={btn} href={l.site} target="_blank" rel="noreferrer">
                        🌐 Site
                      </a>
                    )}
                    {l.maps_url && (
                      <a className={btn} href={l.maps_url} target="_blank" rel="noreferrer">
                        📍 Fiche Google
                      </a>
                    )}
                    {l.instagram && (
                      <a className={btn} href={`https://instagram.com/${l.instagram}`} target="_blank" rel="noreferrer">
                        📸 @{l.instagram}
                      </a>
                    )}
                  </div>
                  {l.dm_instagram && (
                    <div className="mt-2 rounded-xl bg-pink-50 p-2.5">
                      <p className="text-[11px] font-semibold text-pink-700">DM Instagram à envoyer à la main</p>
                      <p className="mt-1 whitespace-pre-wrap">{l.dm_instagram}</p>
                      <button type="button" className={`${btn} mt-1.5`} onClick={() => void navigator.clipboard.writeText(l.dm_instagram ?? "").then(() => setMsg({ ok: true, t: "DM copié ✓ — colle-le dans Instagram." }))}>
                        📋 Copier le DM
                      </button>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <select className={`${input} w-auto`} value={l.statut} onChange={(e) => void maj(l.id, { statut: e.target.value as LeadStatut })}>
                      {Object.entries(STATUTS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={btn}
                      onClick={() =>
                        void run(async () => {
                          const { error } = (await browserSupabase()?.from("opportunities").insert({ titre: `${l.nom} — ${l.angle ?? "projet"}`.slice(0, 200), lead_id: l.id, etape: l.statut === "contacte" || l.statut === "repondu" ? "contacte" : "nouveau" })) ?? { error: null };
                          if (error) throw new Error(error.message);
                          await maj(l.id, { statut: l.statut === "nouveau" ? "a_contacter" : l.statut });
                          return `${l.nom} ajouté au pipeline.`;
                        })
                      }
                    >
                      → Pipeline
                    </button>
                    {l.statut !== "ecarte" && (
                      <button type="button" className="text-[12px] text-ink-soft hover:text-phare" onClick={() => void maj(l.id, { statut: "ecarte" })}>
                        Écarter
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {!list.length && <li className="py-8 text-center text-[13px] text-ink-soft">Aucun prospect ici. Clique sur « Trouver des prospects ».</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ pipeline (kanban)
function Pipeline({ d, reload }: { d: Data; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Opportunity> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const total = (e: Etape) => d.opps.filter((o) => o.etape === e).reduce((s, o) => s + (o.montant ?? 0), 0);
  const save = async (o: Partial<Opportunity>) => {
    const sb = browserSupabase();
    const row = { titre: o.titre, montant: o.montant ?? null, etape: o.etape ?? "nouveau", prochaine_action: o.prochaine_action || null, echeance: o.echeance || null, rdv_le: o.rdv_le || null, notes: o.notes || null };
    const { error } = o.id ? ((await sb?.from("opportunities").update(row).eq("id", o.id)) ?? { error: null }) : ((await sb?.from("opportunities").insert(row)) ?? { error: null });
    if (error) throw new Error(error.message);
    reload();
  };
  const go = async (o: Opportunity, delta: number) => {
    const i = ETAPES.findIndex((e) => e.id === o.etape);
    const next = ETAPES[Math.max(0, Math.min(ETAPES.length - 1, i + delta))]!.id;
    await browserSupabase()?.from("opportunities").update({ etape: next }).eq("id", o.id);
    reload();
  };
  const agent = async (a: "theo" | "victor", o: Opportunity) => {
    try {
      await api("/api/commercial/agent", { agent: a, opportunite: o.id });
      kick();
      setMsg({ ok: true, t: a === "theo" ? "Théo prépare la fiche du RDV : elle arrivera dans Rapports." : "Victor prépare le devis : il apparaîtra dans Finances → Devis (brouillon émis, à relire)." });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    }
  };

  if (edit)
    return (
      <Card>
        <div className="grid grid-cols-2 gap-1.5 text-[12px]">
          <input className={`${input} col-span-2`} placeholder="Titre *" value={edit.titre ?? ""} onChange={(e) => setEdit({ ...edit, titre: e.target.value })} />
          <label>
            Montant estimé (€)
            <input className={input} inputMode="decimal" value={edit.montant ?? ""} onChange={(e) => setEdit({ ...edit, montant: e.target.value ? num(e.target.value) : null })} />
          </label>
          <label>
            Étape
            <select className={input} value={edit.etape ?? "nouveau"} onChange={(e) => setEdit({ ...edit, etape: e.target.value as Etape })}>
              {ETAPES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            Prochaine action
            <input className={input} value={edit.prochaine_action ?? ""} onChange={(e) => setEdit({ ...edit, prochaine_action: e.target.value })} />
          </label>
          <label>
            Échéance
            <input type="date" className={input} value={edit.echeance ?? ""} onChange={(e) => setEdit({ ...edit, echeance: e.target.value })} />
          </label>
          <label>
            Rendez-vous
            <input type="datetime-local" className={input} value={(edit.rdv_le ?? "").slice(0, 16)} onChange={(e) => setEdit({ ...edit, rdv_le: e.target.value })} />
          </label>
          <textarea className={`${input} col-span-2`} rows={3} placeholder="Notes (besoin, budget, décideur…)" value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={btnDark}
            onClick={() =>
              void save(edit)
                .then(() => setEdit(null))
                .catch((e: unknown) => setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }))
            }
          >
            Enregistrer
          </button>
          <button type="button" className={btn} onClick={() => setEdit(null)}>
            Annuler
          </button>
        </div>
        <Msg m={msg} />
      </Card>
    );

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" className={btnDark} onClick={() => setEdit({ etape: "nouveau" })}>
          + Opportunité
        </button>
        <span className="ml-auto text-[12.5px] text-ink-soft">
          En cours : <b className="text-ink">{eur(ETAPES.slice(0, 4).reduce((s, e) => s + total(e.id), 0), 0)}</b> · Signé : <b className="text-moss">{eur(total("signe"), 0)}</b>
        </span>
      </div>
      <Msg m={msg} />
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {ETAPES.map((e) => {
          const cards = d.opps.filter((o) => o.etape === e.id);
          return (
            <div key={e.id} className="w-56 shrink-0 rounded-2xl bg-ink/5 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12.5px] font-bold" style={{ color: e.color }}>
                  {e.label} <span className="font-silk text-[9px] text-ink-soft">{cards.length}</span>
                </span>
                <span className="text-[10.5px] text-ink-soft">{eur(total(e.id), 0)}</span>
              </div>
              <ul className="space-y-1.5">
                {cards.map((o) => {
                  const q = o.quote_id ? d.quotes.find((x) => x.id === o.quote_id) : null;
                  return (
                    <li key={o.id} className="rounded-xl border border-paper-edge bg-white p-2 text-[12px] shadow-sm">
                      <button type="button" className="block w-full text-left font-semibold leading-snug" onClick={() => setEdit(o)}>
                        {o.titre}
                      </button>
                      {o.montant ? <p className="text-ink-soft">{eur(o.montant, 0)}</p> : null}
                      {o.prochaine_action && <p className="mt-0.5 text-ink-soft">▸ {o.prochaine_action}</p>}
                      {o.rdv_le && <p className="mt-0.5 text-[#7c5cd6]">📅 {new Date(o.rdv_le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p>}
                      {q && (
                        <a className="mt-0.5 block text-sea underline" href={pdfUrl("devis", q.id)} target="_blank" rel="noreferrer">
                          📄 {q.numero ?? "Devis brouillon"}
                        </a>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <button type="button" className="rounded-full px-1.5 text-ink-soft hover:bg-ink/5" onClick={() => void go(o, -1)} aria-label="Étape précédente">
                          ◀
                        </button>
                        <button type="button" className="rounded-full px-1.5 text-ink-soft hover:bg-ink/5" onClick={() => void go(o, 1)} aria-label="Étape suivante">
                          ▶
                        </button>
                        {(o.etape === "contacte" || o.etape === "rdv") && (
                          <button type="button" className="rounded-full border border-ink/10 px-1.5 text-[11px]" onClick={() => void agent("theo", o)}>
                            Fiche RDV
                          </button>
                        )}
                        {!o.quote_id && o.etape !== "perdu" && o.etape !== "signe" && (
                          <button type="button" className="rounded-full border border-ink/10 px-1.5 text-[11px]" onClick={() => void agent("victor", o)}>
                            Devis
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">Un devis lié avance tout seul : envoyé → « Devis envoyé », accepté → « Signé », refusé ou expiré → « Perdu ». Margaux relance les devis sans réponse à J+7 et J+15 (en Douane, sans IA).</p>
    </div>
  );
}

// ------------------------------------------------------------------ réglages de prospection
function Reglages({ d, reload }: { d: Data; reload: () => void }) {
  const [metiers, setMetiers] = useState(d.cfg.metiers.join("\n"));
  const [zones, setZones] = useState(d.cfg.zones.join("\n"));
  const [parJour, setParJour] = useState(d.cfg.par_jour);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const lignes = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 30);
  return (
    <div className="space-y-3">
      <PiloteCard />
      <Card>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <label>
            Métiers ciblés (un par ligne)
            <textarea className={input} rows={9} value={metiers} onChange={(e) => setMetiers(e.target.value)} />
          </label>
          <label>
            Zones (une par ligne)
            <textarea className={input} rows={9} value={zones} onChange={(e) => setZones(e.target.value)} />
          </label>
          <label>
            Nouveaux prospects par recherche
            <input className={input} inputMode="numeric" value={parJour} onChange={(e) => setParJour(Math.max(1, Math.min(20, num(e.target.value))))} />
          </label>
        </div>
        <button
          type="button"
          className={`${btnDark} mt-2`}
          onClick={() =>
            void (async () => {
              const { error } = (await browserSupabase()?.from("settings").update({ prospection: { metiers: lignes(metiers), zones: lignes(zones), par_jour: parJour } }).eq("id", 1)) ?? { error: null };
              setMsg(error ? { ok: false, t: error.message } : { ok: true, t: "Enregistré ✓" });
              reload();
            })()
          }
        >
          Enregistrer
        </button>
        <Msg m={msg} />
      </Card>
      <Card>
        <b className="text-[13px]">Clé Google Places (pour de vrais commerces)</b>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-ink-soft">
          <li>console.cloud.google.com, projet « LE PORT » → API et services → Bibliothèque → activer « Places API (New) ».</li>
          <li>Identifiants → Créer des identifiants → Clé API ; restreins-la à « Places API (New) ».</li>
          <li>Vercel → Environment Variables → GOOGLE_PLACES_API_KEY → Redeploy.</li>
        </ol>
        <p className="mt-1.5 text-[11.5px] text-ink-soft">Coût : quelques recherches par jour, largement dans le quota gratuit mensuel de Google.</p>
      </Card>
    </div>
  );
}
