"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { agentById } from "@/data/catalog";
import { browserSupabase } from "@/lib/supabase/client";
import { useUI } from "@/store/ui";
import { useWorld } from "@/store/world";
import { toast } from "@/store/toasts";
import { useIsMobile } from "../hooks";
import { Portrait } from "../Portrait";
import { RoutePanel } from "./RoutePanel";
import { btn, btnDark, input } from "./finances/ui";

/**
 * Calendrier des fondateurs : tout ce qu'il y a à faire dans la semaine (posts TikTok / Instagram, appels,
 * rendez-vous, relances, admin…). Vue Semaine (une colonne par jour, glisser-déposer) ou Tableau (façon Monday,
 * groupé par catégorie, statut en couleur cliquable). Les agents ajoutent leurs tâches tout seuls.
 */

type Statut = "a_faire" | "en_cours" | "fait";
type Categorie = "contenu" | "appel" | "rdv" | "prospection" | "client" | "finance" | "admin" | "autre";

export interface Tache {
  id: string;
  titre: string;
  details: string | null;
  categorie: Categorie;
  canal: string | null;
  jour: string;
  heure: string | null;
  statut: Statut;
  priorite: number;
  pour: string | null;
  agent_id: string | null;
  opportunity_id: string | null;
  lien: string | null;
}

export const CATEGORIES: Record<Categorie, { label: string; couleur: string; emoji: string }> = {
  contenu: { label: "Contenu & réseaux", couleur: "#e04f9a", emoji: "🎬" },
  appel: { label: "Appels", couleur: "#3a7bd5", emoji: "📞" },
  rdv: { label: "Rendez-vous", couleur: "#8b5cf6", emoji: "🤝" },
  prospection: { label: "Prospection", couleur: "#f08a24", emoji: "🎯" },
  client: { label: "Clients", couleur: "#2e9d62", emoji: "💚" },
  finance: { label: "Finance", couleur: "#d9a400", emoji: "💶" },
  admin: { label: "Admin", couleur: "#6d5a8f", emoji: "🗂️" },
  autre: { label: "Autre", couleur: "#8a8fa3", emoji: "📌" },
};
const CANAUX: Record<string, string> = { tiktok: "🎵 TikTok", instagram: "📸 Instagram", linkedin: "💼 LinkedIn", facebook: "👍 Facebook", youtube: "▶️ YouTube", telephone: "📞 Téléphone", email: "✉️ E-mail", visite: "🚶 Visite", autre: "• Autre" };
export const STATUTS: Record<Statut, { label: string; cls: string }> = {
  a_faire: { label: "À faire", cls: "bg-[#c4c4c4] text-white" },
  en_cours: { label: "En cours", cls: "bg-[#fdab3d] text-white" },
  fait: { label: "Fait", cls: "bg-[#00c875] text-white" },
};
const SUIVANT: Record<Statut, Statut> = { a_faire: "en_cours", en_cours: "fait", fait: "a_faire" };
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// ------------------------------------------------------------------ dates (heure de Paris)
const aujourdhui = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
const ajouter = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lundiDe = (jour: string) => ajouter(jour, -((new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7));
const libelleJour = (jour: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${jour}T12:00:00Z`));

// ------------------------------------------------------------------ démo (sans base) : exemples de la semaine
function demo(lundi: string): Tache[] {
  const t = (i: number, d: number, heure: string | null, categorie: Categorie, canal: string | null, titre: string, details: string | null, statut: Statut = "a_faire", agent: string | null = null, priorite = 1): Tache => ({
    id: `demo-${i}`,
    titre,
    details,
    categorie,
    canal,
    jour: ajouter(lundi, d),
    heure,
    statut,
    priorite,
    pour: null,
    agent_id: agent,
    opportunity_id: null,
    lien: null,
  });
  return [
    t(1, 0, "10:30", "appel", "telephone", "📞 Appeler Boulangerie du Port", "Tél. 04 67 00 00 01\n\nScript : Bonjour, je suis Jérémy de MJAGENCY, une agence web à Sète…", "fait", "sacha", 2),
    t(2, 0, "18:30", "contenu", "tiktok", "Publier la vidéo « Avant / après : le site de La Marée »", "Accroche : « Ce restaurant de Sète a doublé ses réservations… »\n#sete #restaurant #siteweb", "fait", "chloe"),
    t(3, 1, "12:15", "contenu", "instagram", "Publier le carrousel « 3 erreurs sur Google »", "7 diapositives prêtes dans Rapports (images 1080 × 1350).", "en_cours", "chloe"),
    t(4, 1, "14:00", "appel", "telephone", "📞 Appeler Fleurs de Thau", "Tél. 04 67 00 00 02", "a_faire", "sacha", 2),
    t(5, 2, "09:00", "rdv", null, "🤝 RDV La Marée : présentation du devis", "Fiche RDV de Théo dans Rapports.", "a_faire", "theo", 3),
    t(6, 2, "18:00", "contenu", "tiktok", "Tourner : « Une journée à l'agence »", "Plans : arrivée au port, écran du QG, café, appel client.", "a_faire", "chloe"),
    t(7, 3, null, "finance", null, "Valider la facture du Bistrot du Canal", null, "a_faire", "bastien"),
    t(8, 3, "17:30", "contenu", "linkedin", "Publier l'article « Site web pour restaurant à Sète »", null, "a_faire", "lina"),
    t(9, 4, "11:00", "prospection", "visite", "🚶 Passer voir 3 commerces rue Gambetta", null, "a_faire", "sacha"),
    t(10, 4, "16:00", "admin", null, "Point de la semaine avec Matheis", null, "a_faire", "marius"),
  ];
}

const CLE_DEMO = "leport.calendrier.demo";

export function CalendrierPanel() {
  const conn = useUI((s) => s.conn);
  const douane = useWorld((s) => s.approvals.length);
  const [lundi, setLundi] = useState(() => lundiDe(aujourdhui()));
  const mobile = useIsMobile();
  const [vue, setVue] = useState<"semaine" | "tableau">("semaine");
  // sur téléphone, le tableau se lit mieux que sept colonnes
  useEffect(() => {
    if (mobile) setVue("tableau");
  }, [mobile]);
  const [filtre, setFiltre] = useState<Categorie | "tout">("tout");
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [ouverte, setOuverte] = useState<Tache | "nouvelle" | null>(null);
  const live = conn !== "demo";
  const dimanche = ajouter(lundi, 6);
  const auj = aujourdhui();

  const charger = useCallback(async () => {
    const sb = browserSupabase();
    if (!live || !sb) {
      let l: Tache[] = [];
      try {
        l = JSON.parse(localStorage.getItem(CLE_DEMO) ?? "null") ?? demo(lundiDe(aujourdhui()));
      } catch {
        l = demo(lundiDe(aujourdhui()));
      }
      return setTaches(l);
    }
    const { data, error } = await sb.from("calendrier").select("*").gte("jour", lundi).lte("jour", dimanche).order("jour").order("heure", { ascending: true, nullsFirst: false });
    if (error) {
      setTaches([]);
      return toast({ kind: "alerte", titre: "Calendrier indisponible", texte: /calendrier/.test(error.message) ? "La base n'a pas encore le calendrier (migration 1900 à appliquer)." : error.message });
    }
    setTaches(((data ?? []) as Tache[]).map((t) => ({ ...t, heure: t.heure ? t.heure.slice(0, 5) : null })));
  }, [live, lundi, dimanche]);

  useEffect(() => {
    void charger();
    const sb = browserSupabase();
    if (!live || !sb) return;
    // un agent ajoute une tâche : l'écran se met à jour tout seul
    const ch = sb
      .channel("calendrier")
      .on("postgres_changes", { event: "*", schema: "public", table: "calendrier" }, () => void charger())
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [charger, live]);

  const sauverDemo = (l: Tache[]) => {
    setTaches(l);
    try {
      localStorage.setItem(CLE_DEMO, JSON.stringify(l));
    } catch {
      // navigation privée : les changements ne durent que le temps de la page
    }
  };

  const modifier = async (t: Tache, patch: Partial<Tache>) => {
    const nouv = { ...t, ...patch };
    setTaches((l) => (l ?? []).map((x) => (x.id === t.id ? nouv : x)));
    const sb = browserSupabase();
    if (!live || !sb) return sauverDemo((taches ?? []).map((x) => (x.id === t.id ? nouv : x)));
    const row: Record<string, unknown> = { ...patch, maj_le: new Date().toISOString() };
    if (patch.statut) row.fait_le = patch.statut === "fait" ? new Date().toISOString() : null;
    const { error } = await sb.from("calendrier").update(row).eq("id", t.id);
    if (error) {
      toast({ kind: "alerte", titre: "Pas enregistré", texte: error.message });
      void charger();
    } else if (patch.statut === "fait") toast({ kind: "fete", titre: "Bien joué !", texte: t.titre });
  };

  const creer = async (t: Omit<Tache, "id">) => {
    const sb = browserSupabase();
    if (!live || !sb) return sauverDemo([...(taches ?? []), { ...t, id: `demo-${Date.now()}` }]);
    const { error } = await sb.from("calendrier").insert({ ...t, cree_par: "fondateur" });
    if (error) return toast({ kind: "alerte", titre: "Pas enregistré", texte: error.message });
    void charger();
  };

  const supprimer = async (t: Tache) => {
    setTaches((l) => (l ?? []).filter((x) => x.id !== t.id));
    const sb = browserSupabase();
    if (!live || !sb) return sauverDemo((taches ?? []).filter((x) => x.id !== t.id));
    const { error } = await sb.from("calendrier").delete().eq("id", t.id);
    if (error) toast({ kind: "alerte", titre: "Pas supprimé", texte: error.message });
  };

  const semaine = useMemo(() => (taches ?? []).filter((t) => t.jour >= lundi && t.jour <= dimanche && (filtre === "tout" || t.categorie === filtre)), [taches, lundi, dimanche, filtre]);
  const faits = semaine.filter((t) => t.statut === "fait").length;
  const pct = semaine.length ? Math.round((100 * faits) / semaine.length) : 0;
  const enRetard = (taches ?? []).filter((t) => t.statut !== "fait" && t.jour < auj).length;

  return (
    <RoutePanel title="Calendrier" kicker={`Semaine du ${libelleJour(lundi)} au ${libelleJour(dimanche)}`} icon="🗓️" accent="#e04f9a" width={1080}>
      {/* barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => setLundi(ajouter(lundi, -7))} aria-label="Semaine précédente">
            ←
          </button>
          <button type="button" className={btn} onClick={() => setLundi(lundiDe(auj))}>
            Cette semaine
          </button>
          <button type="button" className={btn} onClick={() => setLundi(ajouter(lundi, 7))} aria-label="Semaine suivante">
            →
          </button>
        </div>
        <div className="inline-flex rounded-full border border-ink/15 bg-white/70 p-0.5" role="group" aria-label="Affichage">
          {(["semaine", "tableau"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVue(v)} aria-pressed={vue === v} className={`rounded-full px-3 py-1 text-[12.5px] font-medium ${vue === v ? "bg-ink text-white" : ""}`}>
              {v === "semaine" ? "Semaine" : "Tableau"}
            </button>
          ))}
        </div>
        <button type="button" className={`${btnDark} ml-auto`} onClick={() => setOuverte("nouvelle")}>
          + Ajouter une tâche
        </button>
      </div>

      {/* filtres et avancement */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Puce actif={filtre === "tout"} onClick={() => setFiltre("tout")} couleur="#2a2140">
          Tout
        </Puce>
        {(Object.keys(CATEGORIES) as Categorie[]).map((c) => (
          <Puce key={c} actif={filtre === c} onClick={() => setFiltre(c)} couleur={CATEGORIES[c].couleur}>
            {CATEGORIES[c].emoji} {CATEGORIES[c].label}
          </Puce>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[12px]">
        <div className="h-2 min-w-[160px] flex-1 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement de la semaine">
          <div className="h-full rounded-full bg-[#00c875] transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums">
          <b>{faits}</b> / {semaine.length} faites
        </span>
        {enRetard > 0 && <span className="rounded-full bg-phare/10 px-2 py-0.5 font-medium text-phare">{enRetard} en retard</span>}
        {douane > 0 && (
          <Link href="/douane" className="rounded-full bg-white/70 px-2 py-0.5 font-medium hover:bg-white">
            🛂 {douane} en Douane →
          </Link>
        )}
        {!live && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">DÉMO · exemples</span>}
      </div>

      <div className="mt-3">
        {!taches ? (
          <p className="text-sm text-ink-soft">Chargement du calendrier…</p>
        ) : vue === "semaine" ? (
          <VueSemaine lundi={lundi} auj={auj} taches={semaine} onOuvrir={setOuverte} onStatut={(t) => void modifier(t, { statut: SUIVANT[t.statut] })} onDeplacer={(t, jour) => void modifier(t, { jour })} />
        ) : (
          <VueTableau taches={semaine} auj={auj} onOuvrir={setOuverte} onStatut={(t) => void modifier(t, { statut: SUIVANT[t.statut] })} />
        )}
        {taches && semaine.length === 0 && (
          <p className="mt-3 rounded-xl bg-white/50 p-3 text-[13px] text-ink-soft">
            Rien de prévu cette semaine{filtre !== "tout" ? " dans cette catégorie" : ""}. Les agents y ajoutent leurs tâches tout seuls (posts de Chloé, appels préparés par Sacha, prospects qui répondent…) ; tu peux aussi en ajouter avec « + Ajouter une tâche ».
          </p>
        )}
      </div>

      {ouverte && (
        <Fiche
          tache={ouverte === "nouvelle" ? null : ouverte}
          jourParDefaut={auj >= lundi && auj <= dimanche ? auj : lundi}
          onFermer={() => setOuverte(null)}
          onSauver={async (patch) => {
            if (ouverte === "nouvelle") await creer(patch as Omit<Tache, "id">);
            else await modifier(ouverte, patch);
            setOuverte(null);
          }}
          onSupprimer={
            ouverte === "nouvelle"
              ? undefined
              : async () => {
                  await supprimer(ouverte);
                  setOuverte(null);
                }
          }
        />
      )}
    </RoutePanel>
  );
}

function Puce({ actif, onClick, couleur, children }: { actif: boolean; onClick: () => void; couleur: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${actif ? "text-white" : "bg-white/60 hover:bg-white"}`}
      style={actif ? { background: couleur, borderColor: couleur } : { borderColor: `${couleur}55` }}
    >
      {children}
    </button>
  );
}

function PastilleStatut({ statut, onClick }: { statut: Statut; onClick: () => void }) {
  const s = STATUTS[statut];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-semibold transition hover:brightness-95 ${s.cls}`}
      title="Cliquer pour changer le statut"
    >
      {s.label}
    </button>
  );
}

// ------------------------------------------------------------------ vue semaine (une colonne par jour)
function VueSemaine({ lundi, auj, taches, onOuvrir, onStatut, onDeplacer }: { lundi: string; auj: string; taches: Tache[]; onOuvrir: (t: Tache) => void; onStatut: (t: Tache) => void; onDeplacer: (t: Tache, jour: string) => void }) {
  const [survol, setSurvol] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid min-w-[880px] grid-cols-7 gap-2">
        {JOURS.map((nom, i) => {
          const jour = ajouter(lundi, i);
          const liste = taches.filter((t) => t.jour === jour);
          const estAuj = jour === auj;
          return (
            <div
              key={jour}
              onDragOver={(e) => {
                e.preventDefault();
                setSurvol(jour);
              }}
              onDragLeave={() => setSurvol((s) => (s === jour ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setSurvol(null);
                const id = e.dataTransfer.getData("text/plain");
                const t = taches.find((x) => x.id === id);
                if (t && t.jour !== jour) onDeplacer(t, jour);
              }}
              className={`flex min-h-[320px] flex-col rounded-2xl border p-1.5 transition ${estAuj ? "border-[#e04f9a]/50 bg-[#e04f9a]/[0.06]" : "border-paper-edge bg-white/40"} ${survol === jour ? "ring-2 ring-[#e04f9a]/60" : ""}`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-1.5 px-1">
                <span className={`text-[12.5px] font-semibold ${estAuj ? "text-[#c0357f]" : ""}`}>{nom}</span>
                <span className="font-silk text-[9px] text-ink-soft">{estAuj ? "aujourd'hui" : libelleJour(jour)}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {liste.map((t) => (
                  <Carte key={t.id} t={t} enRetard={t.statut !== "fait" && t.jour < auj} onOuvrir={onOuvrir} onStatut={onStatut} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-soft">Astuce : glisse une carte sur un autre jour pour la déplacer ; clique sur le statut pour le faire avancer.</p>
    </div>
  );
}

function Carte({ t, enRetard, onOuvrir, onStatut }: { t: Tache; enRetard: boolean; onOuvrir: (t: Tache) => void; onStatut: (t: Tache) => void }) {
  const c = CATEGORIES[t.categorie] ?? CATEGORIES.autre;
  const agent = t.agent_id ? agentById(t.agent_id) : undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      onClick={() => onOuvrir(t)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOuvrir(t)}
      className={`group cursor-pointer overflow-hidden rounded-xl border bg-white/85 text-left shadow-[0_1px_0_var(--color-paper-edge)] transition hover:-translate-y-px hover:bg-white ${t.statut === "fait" ? "opacity-60" : ""} ${enRetard ? "border-phare/40" : "border-paper-edge"}`}
    >
      <div className="h-1" style={{ background: c.couleur }} />
      <div className="p-1.5">
        <div className="flex items-center gap-1 text-[10px] text-ink-soft">
          {t.heure && <span className="font-silk tabular-nums">{t.heure}</span>}
          {t.canal && <span>{CANAUX[t.canal]?.split(" ")[0] ?? "•"}</span>}
          {t.priorite >= 3 && <span className="font-semibold text-phare">urgent</span>}
          {enRetard && <span className="font-semibold text-phare">en retard</span>}
        </div>
        <div className={`mt-0.5 text-[12px] leading-snug font-medium ${t.statut === "fait" ? "line-through" : ""}`}>{t.titre}</div>
        <div className="mt-1 flex items-center justify-between gap-1">
          <PastilleStatut statut={t.statut} onClick={() => onStatut(t)} />
          {agent && <Portrait agentId={agent.id} size={1} className="shrink-0" />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ vue tableau (façon Monday)
function VueTableau({ taches, auj, onOuvrir, onStatut }: { taches: Tache[]; auj: string; onOuvrir: (t: Tache) => void; onStatut: (t: Tache) => void }) {
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const groupes = (Object.keys(CATEGORIES) as Categorie[]).map((c) => ({ c, liste: taches.filter((t) => t.categorie === c) })).filter((g) => g.liste.length);
  return (
    <div className="space-y-3">
      {groupes.map(({ c, liste }) => {
        const cat = CATEGORIES[c];
        const replie = replies.has(c);
        const faits = liste.filter((t) => t.statut === "fait").length;
        return (
          <section key={c}>
            <button
              type="button"
              onClick={() =>
                setReplies((s) => {
                  const n = new Set(s);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
              className="flex items-center gap-2 text-[13.5px] font-semibold"
              style={{ color: cat.couleur }}
              aria-expanded={!replie}
            >
              <span>{replie ? "▸" : "▾"}</span>
              {cat.emoji} {cat.label}
              <span className="text-[11px] font-normal text-ink-soft">
                {faits}/{liste.length} faites
              </span>
            </button>
            {!replie && (
              <div className="mt-1 overflow-x-auto rounded-xl border border-paper-edge bg-white/70" style={{ borderLeft: `4px solid ${cat.couleur}` }}>
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-paper-edge text-left text-[10.5px] text-ink-soft uppercase">
                      <th className="px-2 py-1.5 font-medium">Tâche</th>
                      <th className="w-[110px] px-2 py-1.5 font-medium">Jour</th>
                      <th className="w-[60px] px-2 py-1.5 font-medium">Heure</th>
                      <th className="w-[110px] px-2 py-1.5 font-medium">Canal</th>
                      <th className="w-[90px] px-2 py-1.5 text-center font-medium">Statut</th>
                      <th className="w-[110px] px-2 py-1.5 font-medium">Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map((t) => {
                      const agent = t.agent_id ? agentById(t.agent_id) : undefined;
                      const retard = t.statut !== "fait" && t.jour < auj;
                      return (
                        <tr key={t.id} onClick={() => onOuvrir(t)} className="cursor-pointer border-b border-paper-edge/60 last:border-0 hover:bg-white">
                          <td className={`px-2 py-1.5 font-medium ${t.statut === "fait" ? "text-ink-soft line-through" : ""}`}>
                            {t.titre}
                            {t.priorite >= 3 && <span className="ml-1.5 rounded bg-phare/10 px-1 text-[10px] font-semibold text-phare">urgent</span>}
                          </td>
                          <td className={`px-2 py-1.5 capitalize ${retard ? "font-semibold text-phare" : ""}`}>{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${t.jour}T12:00:00Z`))}</td>
                          <td className="px-2 py-1.5 tabular-nums">{t.heure ?? "—"}</td>
                          <td className="px-2 py-1.5">{t.canal ? (CANAUX[t.canal] ?? t.canal) : "—"}</td>
                          <td className="px-2 py-1 text-center">
                            <PastilleStatut statut={t.statut} onClick={() => onStatut(t)} />
                          </td>
                          <td className="px-2 py-1.5">
                            {agent ? (
                              <span className="flex items-center gap-1">
                                <Portrait agentId={agent.id} size={1} /> {agent.nom}
                              </span>
                            ) : (
                              <span className="text-ink-soft">Toi</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ fiche d'une tâche (voir, modifier, créer)
function Fiche({ tache, jourParDefaut, onFermer, onSauver, onSupprimer }: { tache: Tache | null; jourParDefaut: string; onFermer: () => void; onSauver: (patch: Partial<Tache>) => Promise<void>; onSupprimer?: () => Promise<void> }) {
  const [f, setF] = useState({
    titre: tache?.titre ?? "",
    jour: tache?.jour ?? jourParDefaut,
    heure: tache?.heure ?? "",
    categorie: (tache?.categorie ?? "autre") as Categorie,
    canal: tache?.canal ?? "",
    details: tache?.details ?? "",
    statut: (tache?.statut ?? "a_faire") as Statut,
    priorite: tache?.priorite ?? 1,
  });
  const [envoi, setEnvoi] = useState(false);
  const agent = tache?.agent_id ? agentById(tache.agent_id) : undefined;
  useEffect(() => {
    // Échap ferme seulement la fiche, pas tout le calendrier (écoute en premier, puis marque la touche comme prise)
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onFermer();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onFermer]);
  const sauver = async () => {
    if (!f.titre.trim()) return;
    setEnvoi(true);
    await onSauver({
      titre: f.titre.trim(),
      jour: f.jour,
      heure: f.heure || null,
      categorie: f.categorie,
      canal: f.canal || null,
      details: f.details.trim() || null,
      statut: f.statut,
      priorite: f.priorite,
      ...(tache ? {} : { pour: null, agent_id: null, opportunity_id: null, lien: null }),
    });
    setEnvoi(false);
  };
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(f.details);
      toast({ kind: "info", titre: "Texte copié", texte: "Colle-le dans TikTok, Instagram…" });
    } catch {
      toast({ kind: "alerte", titre: "Copie impossible", texte: "Sélectionne le texte à la main." });
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onFermer} role="dialog" aria-modal="true" aria-label={tache ? "Tâche du calendrier" : "Nouvelle tâche"}>
      <div className="paper max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-[22px] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-[18px]">{CATEGORIES[f.categorie].emoji}</span>
          <h2 className="flex-1 font-pixel text-[18px]">{tache ? "Tâche" : "Nouvelle tâche"}</h2>
          <button type="button" onClick={onFermer} className="rounded-full px-2 text-[18px] text-ink-soft hover:bg-ink/5" aria-label="Fermer">
            ×
          </button>
        </div>
        {agent && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-soft">
            <Portrait agentId={agent.id} size={1.1} /> Ajoutée par <b className="text-ink">{agent.nom}</b>
          </p>
        )}
        <div className="mt-3 space-y-2.5">
          <label className="block text-[12px] font-medium">
            Quoi
            <input id="cal-titre" className={`${input} mt-1`} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder="Ex. Publier la vidéo TikTok « Avant / après »" autoFocus={!tache} />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block text-[12px] font-medium">
              Jour
              <input id="cal-jour" type="date" className={`${input} mt-1`} value={f.jour} onChange={(e) => setF({ ...f, jour: e.target.value })} />
            </label>
            <label className="block text-[12px] font-medium">
              Heure
              <input id="cal-heure" type="time" className={`${input} mt-1`} value={f.heure} onChange={(e) => setF({ ...f, heure: e.target.value })} />
            </label>
            <label className="block text-[12px] font-medium">
              Catégorie
              <select id="cal-cat" className={`${input} mt-1`} value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value as Categorie })}>
                {(Object.keys(CATEGORIES) as Categorie[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium">
              Canal
              <select id="cal-canal" className={`${input} mt-1`} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })}>
                <option value="">—</option>
                {Object.entries(CANAUX).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="text-[12px] font-medium">Statut</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(Object.keys(STATUTS) as Statut[]).map((s) => (
                <button key={s} type="button" onClick={() => setF({ ...f, statut: s })} aria-pressed={f.statut === s} className={`rounded-md px-3 py-1 text-[12px] font-semibold transition ${f.statut === s ? STATUTS[s].cls : "bg-ink/5 text-ink-soft hover:bg-ink/10"}`}>
                  {STATUTS[s].label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1.5 text-[12px]">
                <input type="checkbox" checked={f.priorite >= 3} onChange={(e) => setF({ ...f, priorite: e.target.checked ? 3 : 1 })} /> Urgent
              </label>
            </div>
          </div>
          <label className="block text-[12px] font-medium">
            <span className="flex items-center justify-between">
              Détails (texte du post, script d&apos;appel, coordonnées…)
              {f.details && (
                <button type="button" onClick={() => void copier()} className="text-[11.5px] font-normal text-sea hover:underline">
                  Copier le texte
                </button>
              )}
            </span>
            <textarea id="cal-details" rows={7} className={`${input} mt-1 leading-relaxed`} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
          </label>
          {tache?.lien && (
            <Link href={tache.lien} className="inline-block text-[12.5px] text-sea hover:underline">
              Voir l&apos;affaire liée →
            </Link>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={btnDark} disabled={envoi || !f.titre.trim()} onClick={() => void sauver()}>
            {tache ? "Enregistrer" : "Ajouter au calendrier"}
          </button>
          <button type="button" className={btn} onClick={onFermer}>
            Annuler
          </button>
          {onSupprimer && (
            <button type="button" className="ml-auto rounded-full px-3 py-1.5 text-[12.5px] text-phare hover:bg-phare/10" onClick={() => void onSupprimer()}>
              Supprimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
