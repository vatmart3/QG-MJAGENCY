"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { agentById, useCatalogVersion } from "@/data/catalog";
import { eur } from "@/finance/types";
import { browserSupabase } from "@/lib/supabase/client";
import { formatParis } from "@/lib/paris";
import { ui, useUI } from "@/store/ui";
import { useWorld } from "@/store/world";
import { getGame } from "../gameRef";
import { useIsMobile } from "../hooks";
import { Portrait } from "../Portrait";
import { toast } from "@/store/toasts";

/**
 * Sur la ville : tableau de bord (en haut à gauche), agenda du jour (dessous), fil d'activité (à droite).
 * Données réelles en mode direct (Supabase), exemples marqués « démo » sinon. Rien ne s'affiche en mode TV.
 */
export function Hud() {
  const path = usePathname();
  const tv = useUI((s) => s.tv);
  const mobile = useIsMobile();
  const [ouvertMobile, setOuvertMobile] = useState(false);
  if (tv || path !== "/") return null;
  if (mobile)
    return (
      <div className="pointer-events-none fixed top-[calc(max(12px,env(safe-area-inset-top))+56px)] left-3 z-20 flex w-[min(320px,calc(100vw-24px))] flex-col gap-2">
        <button type="button" onClick={() => setOuvertMobile((o) => !o)} className="glass pointer-events-auto self-start rounded-full px-3 py-1.5 text-[12px] font-medium" aria-expanded={ouvertMobile}>
          📊 Aujourd&apos;hui {ouvertMobile ? "▴" : "▾"}
        </button>
        {ouvertMobile && (
          <div className="pointer-events-auto flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
            <TableauBord />
            <AgendaJour />
          </div>
        )}
      </div>
    );
  return (
    <>
      <div className="pointer-events-none fixed top-[76px] left-4 z-20 flex max-h-[calc(100dvh-200px)] w-[290px] flex-col gap-2.5 overflow-y-auto pb-2">
        <TableauBord />
        <AgendaJour />
      </div>
      <FilActivite />
    </>
  );
}

// ------------------------------------------------------------------ carte repliable (choix gardé dans le navigateur)
function useReplie(cle: string): [boolean, () => void] {
  const [replie, setReplie] = useState(false);
  useEffect(() => {
    try {
      setReplie(localStorage.getItem(`leport.hud.${cle}`) === "1");
    } catch {
      // stockage indisponible : ouvert par défaut
    }
  }, [cle]);
  const basculer = () =>
    setReplie((r) => {
      try {
        localStorage.setItem(`leport.hud.${cle}`, r ? "0" : "1");
      } catch {
        // rien
      }
      return !r;
    });
  return [replie, basculer];
}

function Carte({ titre, cle, droite, children }: { titre: string; cle: string; droite?: React.ReactNode; children: React.ReactNode }) {
  const [replie, basculer] = useReplie(cle);
  return (
    <section className="glass pointer-events-auto rounded-2xl px-3 py-2.5">
      <header className="flex items-center gap-2">
        <button type="button" onClick={basculer} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={!replie}>
          <span className="font-silk text-[9px] uppercase tracking-wide text-ink-soft">{titre}</span>
          <span className="text-[10px] text-ink-soft">{replie ? "▸" : "▾"}</span>
        </button>
        {droite}
      </header>
      {!replie && <div className="mt-2">{children}</div>}
    </section>
  );
}

const debutJour = () => {
  const j = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  return { jour: j, iso: new Date(`${j}T00:00:00`).toISOString() };
};

// ------------------------------------------------------------------ tableau de bord
interface Chiffres {
  encaisse: number;
  objectif: number;
  pct: number;
  impayes: number;
  totalImpayes: number;
  prospects: number;
  mails: number;
  reponses: number;
  ia: number;
  budget: number;
  signes: number;
  demo: boolean;
}

const DEMO_CHIFFRES: Chiffres = { encaisse: 2840, objectif: 6000, pct: 47, impayes: 1, totalImpayes: 590, prospects: 10, mails: 4, reponses: 1, ia: 0.42, budget: 3, signes: 2, demo: true };

function TableauBord() {
  const conn = useUI((s) => s.conn);
  const [c, setC] = useState<Chiffres | null>(null);
  const charger = useCallback(async () => {
    const sb = browserSupabase();
    if (conn === "demo" || !sb) return setC(DEMO_CHIFFRES);
    const { iso } = debutJour();
    const compter = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const [k, prospects, mails, reponses] = await Promise.all([
      fetch("/api/kpis")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null) as Promise<{ finance: { encaisse: number; objectif: number; pctObjectif: number; impayes: number; totalImpayes: number }; commercial: { signesMois: number }; ia: { coutJour: number; budgetJour: number } } | null>,
      compter(sb.from("leads").select("id", { count: "exact", head: true }).eq("demo", false).gte("cree_le", iso)),
      compter(sb.from("approvals").select("id", { count: "exact", head: true }).eq("execution_statut", "fait").in("type_action", ["email", "relance"]).gte("execute_le", iso)),
      compter(sb.from("leads").select("id", { count: "exact", head: true }).eq("statut", "repondu").gte("maj_le", iso)),
    ]);
    setC({
      encaisse: k?.finance.encaisse ?? 0,
      objectif: k?.finance.objectif ?? 0,
      pct: k?.finance.pctObjectif ?? 0,
      impayes: k?.finance.impayes ?? 0,
      totalImpayes: k?.finance.totalImpayes ?? 0,
      prospects,
      mails,
      reponses,
      ia: k?.ia.coutJour ?? 0,
      budget: k?.ia.budgetJour ?? 0,
      signes: k?.commercial.signesMois ?? 0,
      demo: false,
    });
  }, [conn]);
  useEffect(() => {
    void charger();
    const t = setInterval(() => void charger(), 60_000);
    return () => clearInterval(t);
  }, [charger]);

  const mois = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Europe/Paris" }).format(new Date());
  return (
    <Carte titre={`Tableau de bord · ${mois}`} cle="tableau" droite={c?.demo ? <span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800">démo</span> : null}>
      {!c ? (
        <p className="text-[12px] text-ink-soft">Chargement des chiffres…</p>
      ) : (
        <div className="space-y-2.5">
          <Link href="/finances" className="block rounded-xl transition hover:bg-white/50">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-ink-soft">Encaissé ce mois</span>
              <span className="tabular-nums">
                <b className="text-[15px]">{eur(c.encaisse)}</b>
                {c.objectif > 0 && <span className="text-ink-soft"> / {eur(c.objectif)}</span>}
              </span>
            </div>
            {c.objectif > 0 && (
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={Math.round(c.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Objectif du mois">
                <div className="h-full rounded-full bg-moss transition-[width] duration-700" style={{ width: `${Math.min(100, c.pct)}%` }} />
              </div>
            )}
            <div className="mt-1 flex justify-between text-[11px] text-ink-soft">
              <span>{c.objectif > 0 ? `${Math.round(c.pct)} % de l'objectif` : "Objectif à fixer dans Finances"}</span>
              <span>{c.signes} signé{c.signes > 1 ? "s" : ""} ce mois</span>
            </div>
          </Link>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat valeur={c.prospects} label="prospects trouvés" href="/commercial" />
            <Stat valeur={c.mails} label="mails envoyés" href="/douane" />
            <Stat valeur={c.reponses} label="réponses reçues" href="/commercial" accent={c.reponses > 0} />
            <Stat valeur={`${c.ia.toFixed(2).replace(".", ",")} €`} label={c.budget ? `IA sur ${eur(c.budget)}` : "coût de l'IA"} href="/reglages?onglet=acces" alerte={c.budget > 0 && c.ia > c.budget * 0.8} />
          </div>
          {c.impayes > 0 && (
            <Link href="/finances" className="block rounded-lg bg-phare/10 px-2 py-1 text-[11.5px] font-medium text-phare">
              ⚠️ {c.impayes} facture{c.impayes > 1 ? "s" : ""} en retard · {eur(c.totalImpayes)}
            </Link>
          )}
        </div>
      )}
    </Carte>
  );
}

function Stat({ valeur, label, href, accent, alerte }: { valeur: number | string; label: string; href: string; accent?: boolean; alerte?: boolean }) {
  return (
    <Link href={href} className={`rounded-xl px-2 py-1.5 transition hover:bg-white/70 ${accent ? "bg-moss/15" : alerte ? "bg-phare/10" : "bg-white/45"}`}>
      <div className="text-[16px] leading-tight font-semibold tabular-nums">{valeur}</div>
      <div className="text-[10.5px] leading-tight text-ink-soft">{label}</div>
    </Link>
  );
}

// ------------------------------------------------------------------ agenda du jour
interface Action {
  id: string;
  heure: string | null;
  texte: string;
  telephone: string | null;
  script: string | null;
  enRetard: boolean;
  etape: string;
  notes: string | null;
}

const DEMO_ACTIONS: Action[] = [
  { id: "d1", heure: "10:30", texte: "📞 Appeler Boulangerie du Port", telephone: "04 67 00 00 01", script: "Bonjour, je suis Jérémy de MJAGENCY, une agence web à Sète. J'ai vu que votre boulangerie n'a pas encore de site…", enRetard: false, etape: "nouveau", notes: null },
  { id: "d2", heure: "14:00", texte: "📞 Appeler Fleurs de Thau", telephone: "04 67 00 00 02", script: "Bonjour, je vous appelle parce que vos avis Google sont excellents, mais…", enRetard: false, etape: "nouveau", notes: null },
  { id: "d3", heure: null, texte: "Relancer La Marée pour le devis", telephone: null, script: null, enRetard: true, etape: "devis", notes: null },
];

function scriptDe(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/Message prévu \([^)]*\) :\n([\s\S]+)$/);
  return m ? m[1]!.trim() : null;
}

function AgendaJour() {
  const conn = useUI((s) => s.conn);
  const douane = useWorld((s) => s.approvals.length);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [faits, setFaits] = useState<Set<string>>(new Set());
  const charger = useCallback(async () => {
    const sb = browserSupabase();
    if (conn === "demo" || !sb) return setActions(DEMO_ACTIONS);
    const { jour } = debutJour();
    const demain = new Date(new Date(`${jour}T00:00:00`).getTime() + 86400_000).toISOString();
    const { data } = await sb
      .from("opportunities")
      .select("id, prochaine_action, echeance, rdv_le, notes, etape, leads(nom, telephone)")
      .not("prochaine_action", "is", null)
      .not("etape", "in", "(signe,perdu)")
      .or(`echeance.lte.${jour},rdv_le.lt.${demain}`)
      .order("rdv_le", { ascending: true, nullsFirst: false })
      .limit(30);
    type Row = { id: string; prochaine_action: string; echeance: string | null; rdv_le: string | null; notes: string | null; etape: string; leads: { nom: string; telephone: string | null } | { nom: string; telephone: string | null }[] | null };
    setActions(
      ((data ?? []) as Row[]).map((r) => {
        const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
        const heure = r.rdv_le ? formatParis(new Date(r.rdv_le).getTime(), "HH:mm") : (r.prochaine_action.match(/(\d{1,2})h(\d{2})/)?.slice(1, 3).join(":") ?? null);
        const enRetard = (r.echeance ?? jour) < jour || (!!r.rdv_le && new Date(r.rdv_le).getTime() < new Date(`${jour}T00:00:00`).getTime());
        return { id: r.id, heure, texte: r.prochaine_action.replace(/\s—\s[^—]*$/, ""), telephone: lead?.telephone ?? null, script: scriptDe(r.notes), enRetard, etape: r.etape, notes: r.notes };
      }),
    );
  }, [conn]);
  useEffect(() => {
    void charger();
    const t = setInterval(() => void charger(), 120_000);
    return () => clearInterval(t);
  }, [charger]);

  const fait = async (a: Action) => {
    setFaits((f) => new Set(f).add(a.id));
    const sb = browserSupabase();
    if (conn === "demo" || !sb) return toast({ kind: "fete", titre: "C'est noté (démo)", texte: a.texte });
    const quand = formatParis(Date.now(), "dd/MM HH:mm");
    const { error } = await sb
      .from("opportunities")
      .update({ prochaine_action: null, echeance: null, rdv_le: null, etape: a.etape === "nouveau" ? "contacte" : a.etape, notes: `${a.notes ?? ""}\n\n✓ ${a.texte} — fait le ${quand}`.trim() })
      .eq("id", a.id);
    if (error) {
      setFaits((f) => {
        const n = new Set(f);
        n.delete(a.id);
        return n;
      });
      return toast({ kind: "alerte", titre: "Pas enregistré", texte: error.message });
    }
    await sb.from("journal").insert({ type: "action", titre: `✅ Fait : ${a.texte}`.slice(0, 300), contenu: "Coché dans l'agenda du jour." });
    toast({ kind: "fete", titre: "Bien joué !", texte: `${a.texte} — l'affaire passe à « contacté ». Note le résultat dans Commercial.`, href: "/commercial" });
  };

  const restantes = (actions ?? []).filter((a) => !faits.has(a.id));
  return (
    <Carte titre="Mon agenda du jour" cle="agenda" droite={actions ? <span className="text-[10px] text-ink-soft tabular-nums">{restantes.length} à faire</span> : null}>
      {!actions ? (
        <p className="text-[12px] text-ink-soft">Chargement…</p>
      ) : (
        <ul className="space-y-1.5">
          {douane > 0 && (
            <li>
              <Link href="/douane" className="flex items-center gap-2 rounded-xl bg-white/45 px-2 py-1.5 text-[12px] transition hover:bg-white/70">
                <span>🛂</span>
                <span className="flex-1">
                  <b>{douane}</b> demande{douane > 1 ? "s" : ""} en Douane
                </span>
                <span className="text-ink-soft">→</span>
              </Link>
            </li>
          )}
          {actions.length === 0 && douane === 0 && <li className="text-[12px] text-ink-soft">Rien de prévu aujourd&apos;hui. Les appels préparés par Sacha apparaîtront ici avec leur script.</li>}
          {actions.map((a) => {
            const coche = faits.has(a.id);
            return (
              <li key={a.id} className={`rounded-xl px-2 py-1.5 transition ${coche ? "bg-moss/10 opacity-60" : a.enRetard ? "bg-phare/10" : "bg-white/45"}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-moss)]" checked={coche} disabled={coche} onChange={() => void fait(a)} aria-label={`Marquer comme fait : ${a.texte}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 text-[12px]">
                      {a.heure && <span className="font-silk text-[9px] tabular-nums text-ink-soft">{a.heure}</span>}
                      {a.enRetard && <span className="text-[9.5px] font-semibold text-phare">en retard</span>}
                    </div>
                    <div className={`text-[12.5px] leading-snug ${coche ? "line-through" : ""}`}>{a.texte}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                      {a.telephone && (
                        <a href={`tel:${a.telephone.replace(/\s/g, "")}`} className="font-medium text-sea tabular-nums select-text">
                          {a.telephone}
                        </a>
                      )}
                      {a.script && (
                        <button type="button" className="text-ink-soft underline-offset-2 hover:underline" onClick={() => setOuvert(ouvert === a.id ? null : a.id)} aria-expanded={ouvert === a.id}>
                          {ouvert === a.id ? "Masquer le script" : "Voir le script"}
                        </button>
                      )}
                    </div>
                    {ouvert === a.id && a.script && <p className="mt-1 rounded-lg bg-white/70 p-2 text-[11.5px] leading-relaxed whitespace-pre-wrap select-text">{a.script}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Carte>
  );
}

// ------------------------------------------------------------------ fil d'activité en direct
function FilActivite() {
  useCatalogVersion();
  const journal = useWorld((s) => s.journal);
  const selected = useUI((s) => s.selectedAgent || s.selectedPole);
  const [replie, basculer] = useReplie("fil");
  if (selected) return null;
  const lignes = journal.filter((j) => j.agentId || j.type === "mission" || j.type === "alerte").slice(0, 14);
  return (
    <section className="glass pointer-events-auto fixed top-[76px] right-4 z-20 w-[270px] rounded-2xl px-3 py-2.5">
      <header className="flex items-center gap-2">
        <button type="button" onClick={basculer} className="flex flex-1 items-center gap-1.5 text-left" aria-expanded={!replie}>
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-phare opacity-60" />
            <span className="relative size-2 rounded-full bg-phare" />
          </span>
          <span className="font-silk text-[9px] uppercase tracking-wide text-ink-soft">En direct</span>
          <span className="text-[10px] text-ink-soft">{replie ? "▸" : "▾"}</span>
        </button>
        <Link href="/journal" className="text-[10.5px] text-ink-soft hover:underline">
          Journal →
        </Link>
      </header>
      {!replie && (
        <ul className="mt-2 max-h-[calc(100dvh-470px)] min-h-[120px] space-y-0.5 overflow-y-auto pr-1">
          {lignes.length === 0 && <li className="text-[12px] text-ink-soft">Le port est calme pour l&apos;instant.</li>}
          {lignes.map((j) => {
            const a = j.agentId ? agentById(j.agentId) : undefined;
            const aller = () => {
              if (!j.agentId) return;
              ui.selectAgent(j.agentId);
              getGame()?.flyToAgent(j.agentId);
            };
            return (
              <li key={j.id}>
                <button type="button" onClick={aller} disabled={!a} className="flex w-full items-start gap-2 rounded-xl px-1.5 py-1 text-left transition hover:bg-white/60 disabled:cursor-default">
                  {a ? <Portrait agentId={a.id} size={1.1} className="mt-0.5 shrink-0" /> : <span className="mt-0.5 w-[18px] text-center">{j.type === "alerte" ? "⚠️" : "⚓"}</span>}
                  <span className="min-w-0 flex-1 text-[11.5px] leading-snug">
                    {a && <b>{a.nom} </b>}
                    <span className="break-words">{a && j.title.startsWith(`${a.nom} `) ? j.title.slice(a.nom.length + 1) : j.title}</span>
                    <span className="ml-1 font-silk text-[8.5px] text-ink-soft tabular-nums">{formatParis(j.at, "HH:mm")}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
