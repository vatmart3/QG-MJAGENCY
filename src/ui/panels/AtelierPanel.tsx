"use client";

import { useCallback, useEffect, useState } from "react";
import type { Commande, Produit, ReglagesBoutique } from "@/boutique/shopify";
import type { Kpis } from "@/engine/kpis";
import { eur } from "@/finance/types";
import { browserSupabase } from "@/lib/supabase/client";
import { useUI } from "@/store/ui";
import type { Audit } from "@/tech/audit";
import type { SiteSuivi } from "@/tech/db";
import { btn, btnDark, Card, input, Kpi } from "./finances/ui";
import { RoutePanel } from "./RoutePanel";

type Tab = "sites" | "boutique" | "chiffres";

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; audit?: Audit }> {
  const r = await fetch("/api/atelier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ error: `Erreur ${r.status}` }));
}

const jours = (d: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / 86400_000) : null);
const quand = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais");

export function AtelierPanel() {
  const conn = useUI((s) => s.conn);
  const [tab, setTab] = useState<Tab>("sites");
  return (
    <RoutePanel title="Atelier" kicker="Sites clients · Boutique · Chiffres" icon="🛠️" accent="#3a7bd5" width={820}>
      {conn === "demo" ? (
        <p className="text-sm text-ink-soft">Mode démo : branche Supabase pour suivre les sites clients, la boutique et les chiffres.</p>
      ) : (
        <>
          <div className="mb-4 flex gap-1">
            {(
              [
                ["sites", "🩺 Sites clients"],
                ["boutique", "🛍️ Boutique"],
                ["chiffres", "📊 Chiffres"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${tab === k ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}>
                {l}
              </button>
            ))}
          </div>
          {tab === "sites" ? <Sites /> : tab === "boutique" ? <Boutique /> : <Chiffres />}
        </>
      )}
    </RoutePanel>
  );
}

// ------------------------------------------------------------------ sites clients (Jade, Oscar)
function useSites() {
  const [sites, setSites] = useState<SiteSuivi[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const r = await sb.from("sites_monitored").select("*").order("nom");
    if (r.error) return setError(/does not exist|schema cache/i.test(r.error.message) ? "La base n'a pas encore la table des sites (migration 1200 à appliquer)." : r.error.message);
    setError(null);
    setSites((r.data ?? []) as SiteSuivi[]);
  }, []);
  useEffect(() => {
    void load();
    const sb = browserSupabase();
    if (!sb) return;
    const ch = sb
      .channel(`sites-${Date.now().toString(36)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sites_monitored" }, () => void load())
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [load]);
  return { sites, error, reload: load };
}

function Sites() {
  const { sites, error, reload } = useSites();
  const [nom, setNom] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [auditLibre, setAuditLibre] = useState<Audit | null>(null);

  const act = async (cle: string, body: Record<string, unknown>, ok: string) => {
    setBusy(cle);
    setMsg(null);
    const r = await post(body);
    setBusy(null);
    if (r.error) setMsg({ ok: false, t: r.error });
    else {
      setMsg({ ok: true, t: ok });
      if (r.audit && !body.id) setAuditLibre(r.audit);
      if (r.audit && body.id) setOuvert(String(body.id));
    }
    void reload();
  };

  if (error) return <p className="rounded-xl bg-phare/10 px-3 py-2 text-[13px] text-phare">{error}</p>;
  if (!sites) return <p className="text-[13px] text-ink-soft">Chargement…</p>;
  const enAlerte = sites.filter((s) => s.alerte).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="sites suivis" value={String(sites.filter((s) => s.actif).length)} />
        <Kpi label="en alerte" value={String(enAlerte)} tone={enAlerte ? "alert" : "ok"} />
        <Kpi label="contrôle" value="toutes les h" hint="Jade, 6 h → 23 h, sans IA" />
      </div>

      <Card>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            void act("ajout", { action: "ajouter", nom, url }, "Site ajouté et contrôlé.").then(() => {
              setNom("");
              setUrl("");
            });
          }}
        >
          <label className="min-w-40 flex-1 text-[11px] text-ink-soft">
            Nom (client)
            <input className={input} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Boulangerie du Port" />
          </label>
          <label className="min-w-48 flex-[2] text-[11px] text-ink-soft">
            Adresse du site
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="boulangerie-du-port.fr" />
          </label>
          <button type="submit" className={btnDark} disabled={!url.trim() || busy === "ajout"}>
            {busy === "ajout" ? "Contrôle…" : "Suivre ce site"}
          </button>
          <button type="button" className={btn} disabled={!url.trim() || busy === "libre"} onClick={() => void act("libre", { action: "audit", url }, "Audit terminé.")} title="Audit sans l'ajouter à la surveillance (ex. le site d'un prospect)">
            {busy === "libre" ? "Audit…" : "Auditer seulement"}
          </button>
        </form>
        {msg && <p className={`mt-2 text-[12px] ${msg.ok ? "text-moss" : "text-phare"}`}>{msg.t}</p>}
      </Card>

      {auditLibre && (
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <b className="text-[13px]">Audit — {auditLibre.url}</b>
            <button type="button" className="text-[12px] text-ink-soft" onClick={() => setAuditLibre(null)}>
              Fermer
            </button>
          </div>
          <AuditVue a={auditLibre} />
        </Card>
      )}

      {!sites.length && <p className="text-[13px] text-ink-soft">Aucun site suivi. Ajoute les sites de tes clients : Jade les contrôle toutes les heures (réponse, vitesse, certificat SSL, nom de domaine) et prévient au Journal en cas de souci.</p>}
      <div className="space-y-2">
        {sites.map((s) => {
          const js = jours(s.ssl_expire_le);
          const jd = jours(s.domaine_expire_le ? `${s.domaine_expire_le}T12:00:00Z` : null);
          const etat = !s.actif ? "bg-ink/25" : s.ok === null ? "bg-ink/25" : s.alerte ? "bg-phare" : s.ok ? "bg-moss" : "bg-amber-500";
          return (
            <Card key={s.id} className={s.actif ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`size-2.5 shrink-0 rounded-full ${etat}`} title={s.ok ? "répond" : "ne répond pas"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{s.nom}</div>
                  <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-[11.5px] text-ink-soft hover:underline">
                    {s.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </div>
                <Histo s={s} />
                <div className="flex shrink-0 flex-wrap gap-1 text-[11px]">
                  <span className="rounded-full bg-ink/5 px-2 py-0.5">{s.ok === null ? "—" : s.ok ? `${s.temps_ms} ms` : "en panne"}</span>
                  <span className={`rounded-full px-2 py-0.5 ${js !== null && js < 14 ? "bg-phare/10 text-phare" : "bg-ink/5"}`}>SSL {js === null ? "?" : `${js} j`}</span>
                  <span className={`rounded-full px-2 py-0.5 ${jd !== null && jd < 30 ? "bg-phare/10 text-phare" : "bg-ink/5"}`}>domaine {jd === null ? "?" : `${jd} j`}</span>
                  {s.audit && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">audit {s.audit.note}/100</span>}
                </div>
              </div>
              {s.alerte && <p className="mt-1.5 rounded-lg bg-phare/10 px-2 py-1 text-[12px] text-phare">⚠️ {s.alerte}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-auto text-[11px] text-ink-soft">Contrôlé : {quand(s.dernier_check)}</span>
                <button type="button" className={btn} disabled={!!busy} onClick={() => void act(`c${s.id}`, { action: "controler", id: s.id }, `${s.nom} contrôlé.`)}>
                  {busy === `c${s.id}` ? "…" : "Contrôler"}
                </button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => void act(`a${s.id}`, { action: "audit", id: s.id }, `Audit de ${s.nom} terminé.`)}>
                  {busy === `a${s.id}` ? "Audit…" : "Auditer (Oscar)"}
                </button>
                {s.audit && (
                  <button type="button" className={btn} onClick={() => setOuvert(ouvert === s.id ? null : s.id)}>
                    {ouvert === s.id ? "Masquer l'audit" : "Voir l'audit"}
                  </button>
                )}
                <button type="button" className={btn} disabled={!!busy} onClick={() => void act(`p${s.id}`, { action: "pause", id: s.id, actif: !s.actif }, s.actif ? "Surveillance en pause." : "Surveillance reprise.")}>
                  {s.actif ? "Pause" : "Reprendre"}
                </button>
                <button
                  type="button"
                  className={`${btn} text-phare`}
                  disabled={!!busy}
                  onClick={() => {
                    if (confirm(`Ne plus suivre ${s.nom} ?`)) void act(`r${s.id}`, { action: "retirer", id: s.id }, "Site retiré.");
                  }}
                >
                  Retirer
                </button>
              </div>
              {ouvert === s.id && s.audit && (
                <div className="mt-2 border-t border-paper-edge pt-2">
                  <AuditVue a={s.audit} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** 48 derniers contrôles : barres vertes (OK) ou rouges (panne), hauteur = temps de réponse. */
function Histo({ s }: { s: SiteSuivi }) {
  const h = (s.historique ?? []).slice(-24);
  if (!h.length) return null;
  const max = Math.max(500, ...h.map((x) => x.ms ?? 0));
  return (
    <div className="flex h-6 items-end gap-px" title="24 derniers contrôles">
      {h.map((x, i) => (
        <span key={i} className={`w-1 rounded-sm ${x.ok ? "bg-moss/70" : "bg-phare"}`} style={{ height: x.ok ? `${Math.max(15, Math.round(((x.ms ?? 0) / max) * 100))}%` : "100%" }} />
      ))}
    </div>
  );
}

function AuditVue({ a }: { a: Audit }) {
  if (a.erreur) return <p className="text-[12.5px] text-phare">Audit impossible : {a.erreur}</p>;
  const ko = a.points.filter((p) => !p.ok).sort((x, y) => y.poids - x.poids);
  const tone = a.note >= 80 ? "text-moss" : a.note >= 55 ? "text-amber-600" : "text-phare";
  return (
    <div className="text-[12.5px]">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className={`font-pixel text-2xl ${tone}`}>{a.note}/100</span>
        <span className="text-ink-soft">
          {a.titre ? `« ${a.titre} »` : ""} · {new Date(a.le).toLocaleDateString("fr-FR")}
          {a.demo ? " · DÉMO" : ""}
        </span>
      </div>
      {ko.length ? (
        <ul className="space-y-1">
          {ko.map((p) => (
            <li key={p.label} className="rounded-lg bg-white/70 px-2 py-1">
              <span className="mr-1 rounded bg-ink/5 px-1.5 text-[10.5px]">{p.categorie}</span>
              <b>{p.label}</b> — {p.conseil}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-moss">Rien à corriger sur les points contrôlés 👏</p>
      )}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">✓ {a.points.filter((p) => p.ok).map((p) => p.label).join(" · ")}</p>
    </div>
  );
}

// ------------------------------------------------------------------ boutique (Yanis, Lou, Iris)
interface BoutiqueData {
  kind: "shopify" | "demo";
  domaine: string | null;
  configure: boolean;
  commandes: Commande[];
  produits: Produit[];
  reglages: ReglagesBoutique;
  error?: string;
}
const ST: Record<string, string> = { PAID: "payée", PENDING: "en attente", REFUNDED: "remboursée", PARTIALLY_REFUNDED: "remb. partiel", UNFULFILLED: "à expédier", FULFILLED: "expédiée", PARTIALLY_FULFILLED: "exp. partielle" };

function Boutique() {
  const [d, setD] = useState<BoutiqueData | null>(null);
  const [seuil, setSeuil] = useState("");
  const [delai, setDelai] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/boutique");
    const j = (await r.json().catch(() => ({ error: `Erreur ${r.status}` }))) as BoutiqueData;
    setD(j);
    if (j.reglages) {
      setSeuil(String(j.reglages.seuil_stock));
      setDelai(String(j.reglages.delai_expedition_h));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!d) return <p className="text-[13px] text-ink-soft">Lecture de la boutique…</p>;
  if (d.error) return <Connexion d={d} erreur={d.error} />;
  const actives = d.commandes.filter((c) => !c.annulee);
  const ca = actives.reduce((s, c) => s + c.total, 0);
  const aExp = actives.filter((c) => c.paiement === "PAID" && c.expedition !== "FULFILLED");
  const bas = d.produits.flatMap((p) => p.variantes.filter((v) => v.suivi && v.stock !== null && v.stock <= d.reglages.seuil_stock).map((v) => ({ p, v })));
  const sauver = async () => {
    const sb = browserSupabase();
    if (!sb) return;
    const r = await sb.from("settings").update({ boutique: { seuil_stock: Number(seuil) || 0, delai_expedition_h: Number(delai) || 48 } }).eq("id", 1);
    setMsg(r.error ? r.error.message : "Réglages enregistrés.");
    void load();
  };
  return (
    <div className="space-y-3">
      {d.kind === "demo" && <Connexion d={d} />}
      {d.kind === "shopify" && <p className="text-[12px] text-ink-soft">Connectée à {d.domaine} · lecture seule : toute modification (stock, prix, mise en ligne) passe par La Douane.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="commandes · 30 j" value={String(actives.length)} />
        <Kpi label="chiffre · 30 j" value={eur(ca, 0)} />
        <Kpi label="à expédier" value={String(aExp.length)} tone={aExp.length ? "alert" : "ok"} />
        <Kpi label="stocks bas / ruptures" value={String(bas.length)} tone={bas.length ? "alert" : "ok"} />
      </div>
      <Card>
        <b className="text-[13px]">Commandes récentes</b>
        <div className="mt-1.5 divide-y divide-paper-edge">
          {actives.slice(0, 15).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px]">
              <span className="w-14 font-medium">{c.nom}</span>
              <span className="w-24 text-ink-soft">{new Date(c.cree_le).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              <span className="min-w-0 flex-1 truncate">
                {c.client ?? "Client"} · {c.articles.map((a) => `${a.quantite}× ${a.titre}`).join(", ")}
              </span>
              <span className="font-medium">{eur(c.total)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.expedition === "FULFILLED" ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-800"}`}>{ST[c.expedition] ?? c.expedition.toLowerCase()}</span>
              {c.lien && (
                <a className="text-[11px] text-ink-soft hover:underline" href={c.lien} target="_blank" rel="noreferrer">
                  Shopify ↗
                </a>
              )}
            </div>
          ))}
          {!actives.length && <p className="py-2 text-[12.5px] text-ink-soft">Aucune commande sur 30 jours.</p>}
        </div>
      </Card>
      <Card>
        <b className="text-[13px]">Catalogue et stocks</b>
        <div className="mt-1.5 divide-y divide-paper-edge">
          {d.produits.map((p) =>
            p.variantes.map((v) => {
              const alerte = v.suivi && v.stock !== null && v.stock <= d.reglages.seuil_stock;
              return (
                <div key={v.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">
                    {p.titre}
                    {p.variantes.length > 1 ? ` · ${v.titre}` : ""}
                    {p.statut !== "ACTIVE" && <span className="ml-1 rounded bg-ink/8 px-1 text-[10.5px]">{p.statut === "DRAFT" ? "brouillon" : "archivé"}</span>}
                  </span>
                  <span className="text-ink-soft">{eur(v.prix)}</span>
                  <span className={`w-20 rounded-full px-2 py-0.5 text-center text-[11px] ${!v.suivi ? "bg-ink/5" : v.stock! <= 0 ? "bg-phare text-white" : alerte ? "bg-phare/10 text-phare" : "bg-moss/15 text-moss"}`}>{v.suivi ? `${v.stock} en stock` : "non suivi"}</span>
                </div>
              );
            }),
          )}
        </div>
      </Card>
      <Card>
        <b className="text-[13px]">Alertes de Yanis</b>
        <p className="text-[11.5px] text-ink-soft">Toutes les 2 heures (8 h → 21 h), sans IA : nouvelle commande, commande payée pas expédiée, stock bas.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-ink-soft">
            Stock bas à partir de
            <input className={`${input} w-24`} type="number" min={0} value={seuil} onChange={(e) => setSeuil(e.target.value)} />
          </label>
          <label className="text-[11px] text-ink-soft">
            Expédition en retard après (h)
            <input className={`${input} w-24`} type="number" min={6} value={delai} onChange={(e) => setDelai(e.target.value)} />
          </label>
          <button type="button" className={btnDark} onClick={() => void sauver()}>
            Enregistrer
          </button>
          {msg && <span className="text-[12px] text-ink-soft">{msg}</span>}
        </div>
      </Card>
    </div>
  );
}

function Connexion({ d, erreur }: { d: Pick<BoutiqueData, "configure">; erreur?: string }) {
  return (
    <Card className={erreur ? "border-phare/40" : ""}>
      <b className="text-[13px]">{erreur ? "⚠️ Shopify ne répond pas" : "Boutique de DÉMONSTRATION"}</b>
      {erreur && <p className="text-[12px] text-phare">{erreur}</p>}
      {!d.configure && (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] text-ink-soft">
          <li>Shopify → Paramètres → Applications → « Développer des applications » → ouvre le <b>Dev Dashboard</b> et crée une application « LE PORT ».</li>
          <li>Dans sa version, coche les accès : read_orders, read_products, write_products, read_inventory, write_inventory, read_locations (et read_customers pour voir le nom des clients). Publie la version puis installe l&apos;application sur ta boutique.</li>
          <li>
            Dans Vercel → Settings → Environment Variables : <code>SHOPIFY_STORE_DOMAIN</code> (ta-boutique.myshopify.com), <code>SHOPIFY_CLIENT_ID</code> et <code>SHOPIFY_CLIENT_SECRET</code> (onglet Paramètres de l&apos;application), puis Redeploy.
          </li>
        </ol>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ chiffres (Diane)
function Chiffres() {
  const [k, setK] = useState<(Kpis & { error?: string }) | null>(null);
  useEffect(() => {
    void fetch("/api/kpis")
      .then((r) => r.json())
      .then(setK)
      .catch(() => setK({ error: "Lecture impossible" } as Kpis & { error: string }));
  }, []);
  if (!k) return <p className="text-[13px] text-ink-soft">Diane fait les comptes…</p>;
  if (k.error) return <p className="text-[13px] text-phare">{k.error}</p>;
  const f = k.finance;
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-soft">Calculé à l&apos;instant à partir des vraies données du port, sans IA. Pour un commentaire écrit, demande le récap à Diane (onglet Rapports).</p>
      <Section titre={`💶 Finance — ${k.mois}`}>
        <Kpi label="encaissé" value={eur(f.encaisse, 0)} hint={`${f.pctObjectif} % de ${eur(f.objectif, 0)}`} tone={f.pctObjectif >= 100 ? "ok" : undefined} />
        <Kpi label="facturé" value={eur(f.facture, 0)} />
        <Kpi label="reste à encaisser" value={eur(f.aEncaisser, 0)} />
        <Kpi label="impayés en retard" value={String(f.impayes)} hint={eur(f.totalImpayes, 0)} tone={f.impayes ? "alert" : "ok"} />
      </Section>
      <Section titre="🎯 Commercial">
        <Kpi label="prospects" value={String(k.commercial.prospects)} hint={`${k.commercial.aContacter} à contacter`} />
        <Kpi label="contactés" value={String(k.commercial.contactes)} hint={`${k.commercial.convertis} convertis`} />
        <Kpi label="pipeline ouvert" value={eur(k.commercial.pipelineMontant, 0)} hint={`${k.commercial.pipelineOuvert} affaire(s)`} />
        <Kpi label="signé ce mois" value={eur(k.commercial.signesMontant, 0)} hint={`${k.commercial.signesMois} affaire(s)`} tone={k.commercial.signesMois ? "ok" : undefined} />
      </Section>
      <Section titre="🛠️ Sites & boutique">
        <Kpi label="sites suivis" value={String(k.tech.sites)} hint={k.tech.disponibilite !== null ? `${String(k.tech.disponibilite).replace(".", ",")} % dispo (7 j)` : undefined} />
        <Kpi label="sites en alerte" value={String(k.tech.enAlerte)} tone={k.tech.enAlerte ? "alert" : "ok"} />
        <Kpi label={`commandes · 7 j${k.boutique?.demo ? " (démo)" : ""}`} value={k.boutique ? String(k.boutique.commandes7j) : "—"} hint={k.boutique ? eur(k.boutique.ca7j, 0) : undefined} />
        <Kpi label="à expédier" value={k.boutique ? String(k.boutique.aExpedier) : "—"} tone={k.boutique?.aExpedier ? "alert" : undefined} />
      </Section>
      <Section titre="🤖 Coût de l'IA">
        <Kpi label="aujourd'hui" value={eur(k.ia.coutJour)} hint={`budget ${eur(k.ia.budgetJour)}`} tone={k.ia.coutJour > k.ia.budgetJour ? "alert" : "ok"} />
        <Kpi label="ce mois" value={eur(k.ia.coutMois)} />
      </Section>
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-medium">{titre}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}
