"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { agentById, useCatalogVersion } from "@/data/catalog";
import { formatParis } from "@/lib/paris";
import { browserSupabase } from "@/lib/supabase/client";
import { useUI } from "@/store/ui";
import { Portrait } from "../../Portrait";

interface Status {
  configure: { client: boolean; cle: boolean; serveur: boolean };
  attendu: string;
  redirectUri: string;
  connexion: { compte: string; statut: "connecte" | "erreur"; erreur: string | null; scopes: string[]; par: string | null; le: string } | null;
}

const RETOURS: Record<string, { ok: boolean; texte: string }> = {
  ok: { ok: true, texte: "Google est connecté. Lucie trie la boîte au prochain passage du moteur." },
  autre: { ok: false, texte: "Connecté, mais avec un autre compte que la boîte officielle. Déconnecte puis reconnecte-toi avec mjagency.officiel@gmail.com." },
  config: { ok: false, texte: "Il manque des variables sur Vercel (voir ci-dessous)." },
  refuse: { ok: false, texte: "Connexion annulée sur l'écran Google." },
  etat: { ok: false, texte: "Lien de connexion expiré ou invalide : réessaie." },
  sans_refresh: { ok: false, texte: "Google n'a pas donné d'accès permanent. Va sur myaccount.google.com/permissions, retire « LE PORT », puis reconnecte." },
  scopes: { ok: false, texte: "Toutes les autorisations n'ont pas été cochées (Gmail et Agenda sont nécessaires). Reconnecte en cochant tout." },
  erreur: { ok: false, texte: "Google a renvoyé une erreur." },
};

const SCOPE_LABEL = (s: string) =>
  s.endsWith("gmail.modify") ? "Lire et classer les mails" : s.endsWith("gmail.send") ? "Envoyer (après Douane)" : s.endsWith("calendar.events") ? "Agenda" : null;

export function ConnexionsTab() {
  const conn = useUI((s) => s.conn);
  if (conn === "demo")
    return <p className="text-sm text-ink-soft">Mode démo : branche Supabase pour connecter Google. Les agents utilisent une boîte mail et un agenda de démonstration.</p>;
  return (
    <div className="space-y-4">
      <GoogleCard />
      <RulesCard />
      <CourrierCard />
    </div>
  );
}

function GoogleCard() {
  const params = useSearchParams();
  const retour = params.get("google");
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch("/api/integrations/google/status")
      .then(async (r) => (r.ok ? setSt((await r.json()) as Status) : setErr(`Erreur ${r.status}`)))
      .catch(() => setErr("Réseau indisponible"));
  }, []);
  useEffect(load, [load]);

  const disconnect = async () => {
    if (!window.confirm("Déconnecter Google ? Les agents repasseront sur la boîte de démonstration.")) return;
    setBusy(true);
    await fetch("/api/integrations/google/disconnect", { method: "POST" }).catch(() => undefined);
    setBusy(false);
    load();
  };

  const c = st?.connexion;
  const pret = st && st.configure.client && st.configure.cle && st.configure.serveur;
  const btn = "inline-block rounded-full px-4 py-2 text-[13px] font-medium transition active:scale-95";

  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold">Google · Gmail & Agenda</h4>
        <span className={`rounded-full px-2 py-0.5 font-silk text-[9px] ${c?.statut === "connecte" ? "bg-moss/15 text-moss" : c ? "bg-phare/10 text-phare" : "bg-amber-100 text-amber-800"}`}>
          {c?.statut === "connecte" ? "CONNECTÉ" : c ? "À RECONNECTER" : "DÉMO"}
        </span>
      </div>
      {retour && RETOURS[retour] && (
        <p className={`mt-2 rounded-xl px-3 py-2 text-[12.5px] ${RETOURS[retour].ok ? "bg-moss/10 text-moss" : "bg-phare/10 text-phare"}`}>
          {RETOURS[retour].texte}
          {params.get("detail") && <span className="block opacity-80">{params.get("detail")}</span>}
        </p>
      )}
      {err && <p className="mt-2 text-[12px] text-phare">{err}</p>}
      {!st && !err && <p className="mt-2 text-[12px] text-ink-soft">Chargement…</p>}

      {st && c && (
        <div className="mt-2 text-[13px]">
          <p>
            Boîte connectée : <b>{c.compte}</b>
            {c.compte !== st.attendu && <span className="ml-1 text-phare">(attendu : {st.attendu})</span>}
          </p>
          <p className="text-[12px] text-ink-soft">
            Depuis le {formatParis(new Date(c.le).getTime(), "d MMMM à HH:mm")}
            {c.par ? ` · par ${c.par}` : ""}
          </p>
          {c.erreur && <p className="mt-1 text-[12px] text-phare">⚠️ {c.erreur}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {c.scopes.flatMap((s) => SCOPE_LABEL(s) ?? []).map((l) => (
              <span key={l} className="rounded-full bg-ink/6 px-2 py-0.5 text-[11px]">
                ✓ {l}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/integrations/google/connect" className={`${btn} border border-ink/15`}>
              Reconnecter
            </a>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className={`${btn} border border-phare/30 text-phare`}>
              Déconnecter
            </button>
          </div>
        </div>
      )}

      {st && !c && (
        <div className="mt-2 text-[13px]">
          <p className="text-ink-soft">
            Sans connexion, Lucie, Noé, Firmin et Céleste travaillent sur une boîte et un agenda de <b>démonstration</b> (rien ne part vraiment).
          </p>
          {pret ? (
            <>
              <a href="/api/integrations/google/connect" className={`${btn} mt-3 bg-ink text-white`}>
                Connecter Google
              </a>
              <p className="mt-2 text-[12px] text-ink-soft">
                Sur l&apos;écran Google, choisis <b>{st.attendu}</b> et coche toutes les autorisations.
              </p>
            </>
          ) : (
            <div className="mt-2 rounded-xl bg-amber-50 p-3 text-[12.5px]">
              <p className="font-semibold">À configurer sur Vercel avant de connecter :</p>
              <ul className="mt-1 space-y-0.5">
                <li>{st.configure.client ? "✓" : "✗"} GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET</li>
                <li>{st.configure.cle ? "✓" : "✗"} ENCRYPTION_KEY (chiffre l&apos;accès Google dans la base)</li>
                <li>{st.configure.serveur ? "✓" : "✗"} SUPABASE_SERVICE_ROLE_KEY</li>
              </ul>
              {!st.configure.cle && <KeyMaker />}
            </div>
          )}
        </div>
      )}
      {st && (
        <p className="mt-3 text-[11px] break-all text-ink-soft">
          Adresse de retour à déclarer dans Google Cloud : <code className="rounded bg-ink/5 px-1">{st.redirectUri}</code>
        </p>
      )}
    </div>
  );
}

interface RuleRow {
  id: string;
  agent_id: string;
  type_action: string;
  cree_par: string | null;
  cree_le: string;
}

const TYPE_LABEL: Record<string, string> = { email: "mails", relance: "relances", rdv: "invitations", devis: "devis", facture: "factures", autre: "autres envois" };

/** Règles « Toujours autoriser » créées en Douane : listées et révocables. */
function RulesCard() {
  useCatalogVersion();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const load = useCallback(() => {
    const sb = browserSupabase();
    if (!sb) return;
    void sb
      .from("autonomy_rules")
      .select("id, agent_id, type_action, cree_par, cree_le")
      .eq("actif", true)
      .order("cree_le", { ascending: false })
      .then(({ data }) => setRules((data ?? []) as RuleRow[]));
  }, []);
  useEffect(load, [load]);
  const revoke = async (id: string) => {
    const sb = browserSupabase();
    if (!sb) return;
    await sb.from("autonomy_rules").update({ actif: false }).eq("id", id);
    load();
  };
  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <h4 className="text-sm font-bold">Règles d&apos;autonomie</h4>
      <p className="mt-1 text-[12px] text-ink-soft">
        Créées avec « Toujours autoriser ce type » en Douane : l&apos;agent envoie sans attendre, mais seulement à une adresse déjà connue. Jamais automatique : paiements, factures, mise en demeure.
      </p>
      <ul className="mt-2 divide-y divide-paper-edge">
        {(rules ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2 text-[13px]">
            <Portrait agentId={r.agent_id} size={1} />
            <span className="min-w-0 flex-1">
              <b>{agentById(r.agent_id)?.nom ?? r.agent_id}</b> envoie ses {TYPE_LABEL[r.type_action] ?? r.type_action} sans validation
              <span className="block text-[11px] text-ink-soft">
                depuis le {formatParis(new Date(r.cree_le).getTime(), "d MMM")}
                {r.cree_par ? ` · ${r.cree_par}` : ""}
              </span>
            </span>
            <button type="button" onClick={() => void revoke(r.id)} className="shrink-0 rounded-full border border-phare/30 px-3 py-1 text-[12px] text-phare">
              Révoquer
            </button>
          </li>
        ))}
        {rules && !rules.length && <li className="py-2 text-[12.5px] text-ink-soft">Aucune règle : tout passe par la Douane.</li>}
      </ul>
    </div>
  );
}

interface EmailRow {
  id: string;
  de: string;
  objet: string;
  recu_le: string | null;
  categorie: string | null;
  resume: string | null;
  urgence: number;
  statut: "a_trier" | "trie" | "traite";
  demo: boolean;
}

const CAT: Record<string, string> = { client: "🤝 Client", prospect: "🎯 Prospect", fournisseur: "📦 Fournisseur", admin: "🏛️ Admin", spam: "🚫 Spam", perso: "👤 Perso", autre: "📁 Autre" };

/** Les derniers mails vus par Lucie. */
function CourrierCard() {
  const [list, setList] = useState<EmailRow[] | null>(null);
  useEffect(() => {
    const sb = browserSupabase();
    if (!sb) return;
    void sb
      .from("emails")
      .select("id, de, objet, recu_le, categorie, resume, urgence, statut, demo")
      .order("recu_le", { ascending: false })
      .limit(15)
      .then(({ data }) => setList((data ?? []) as EmailRow[]));
  }, []);
  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <h4 className="text-sm font-bold">Courrier trié par Lucie</h4>
      <p className="mt-1 text-[12px] text-ink-soft">Tri toutes les 15 min de 8 h à 20 h (routine « Tri des nouveaux mails »). Relances de Firmin à 14 h en semaine.</p>
      <ul className="mt-2 divide-y divide-paper-edge">
        {(list ?? []).map((m) => (
          <li key={m.id} className="py-2">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-medium">
                {m.urgence === 2 ? "🔴 " : m.urgence === 1 ? "🟠 " : ""}
                {m.objet}
              </span>
              {m.demo && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">DÉMO</span>}
              <span className="shrink-0 text-[11px] text-ink-soft">{m.categorie ? CAT[m.categorie] : "à trier"}</span>
            </div>
            <p className="truncate text-[11.5px] text-ink-soft">
              {m.de}
              {m.recu_le ? ` · ${formatParis(new Date(m.recu_le).getTime(), "d MMM HH:mm")}` : ""}
              {m.statut === "traite" ? " · ✓ traité" : ""}
            </p>
            {m.resume && <p className="text-[12px]">{m.resume}</p>}
          </li>
        ))}
        {list && !list.length && <li className="py-2 text-[12.5px] text-ink-soft">Pas encore de mail trié.</li>}
      </ul>
    </div>
  );
}

/** Génère une ENCRYPTION_KEY dans le navigateur (rien n'est envoyé) : à coller dans Vercel. */
function KeyMaker() {
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = () => {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    setKey(btoa(String.fromCharCode(...b)));
    setCopied(false);
  };
  return (
    <div className="mt-2">
      <button type="button" onClick={make} className="rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px]">
        🔑 Générer une ENCRYPTION_KEY
      </button>
      {key && (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px]">{key}</code>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(key).then(() => setCopied(true))}
            className="shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] text-white"
          >
            {copied ? "Copiée ✓" : "Copier"}
          </button>
        </div>
      )}
      {key && <p className="mt-1 text-[11px] text-ink-soft">Créée sur ton appareil, envoyée nulle part. Colle-la dans Vercel (ENCRYPTION_KEY) puis redéploie. Garde-la : si elle change, il faudra reconnecter Google.</p>}
    </div>
  );
}
