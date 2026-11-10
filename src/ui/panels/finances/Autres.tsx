"use client";

import { useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { margeEcomm, moisDecale } from "@/finance/calc";
import { parseCsv } from "@/finance/csv";
import { calendrierFiscal } from "@/finance/fiscal";
import { dateFr, eur, num, totalLignes, type Client, type EcommMonth, type FinanceSettings, type Ligne, type Subscription } from "@/finance/types";
import { api, today, type FinanceData } from "./data";
import { btn, btnDark, Card, input, Kpi, LignesEditor, Msg } from "./ui";

const run = async (set: (m: { ok: boolean; t: string } | null) => void, fn: () => Promise<string | void>) => {
  set(null);
  try {
    const t = await fn();
    if (t) set({ ok: true, t });
  } catch (e) {
    set({ ok: false, t: e instanceof Error ? e.message : String(e) });
  }
};

// ------------------------------------------------------------------ clients
export function ClientsTab({ d, reload }: { d: FinanceData; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Client> | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const ca = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of d.invoices) if (i.statut !== "brouillon" && i.client_id) m.set(i.client_id, (m.get(i.client_id) ?? 0) + i.total);
    return m;
  }, [d.invoices]);
  const set = (k: keyof Client, v: string) => setEdit((e) => ({ ...e, [k]: v }));

  if (edit)
    return (
      <div className="space-y-2">
        <button type="button" className="text-[13px] text-ink-soft" onClick={() => setEdit(null)}>
          ← Retour
        </button>
        <Card>
          <div className="grid grid-cols-2 gap-1.5">
            <input className={`${input} col-span-2`} placeholder="Nom / raison sociale *" value={edit.nom ?? ""} onChange={(e) => set("nom", e.target.value)} />
            <input className={input} placeholder="Contact" value={edit.contact ?? ""} onChange={(e) => set("contact", e.target.value)} />
            <input className={input} placeholder="E-mail" value={edit.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            <input className={input} placeholder="Téléphone" value={edit.telephone ?? ""} onChange={(e) => set("telephone", e.target.value)} />
            <input className={input} placeholder="SIRET" value={edit.siret ?? ""} onChange={(e) => set("siret", e.target.value)} />
            <input className={`${input} col-span-2`} placeholder="Adresse" value={edit.adresse ?? ""} onChange={(e) => set("adresse", e.target.value)} />
            <input className={input} placeholder="Code postal" value={edit.code_postal ?? ""} onChange={(e) => set("code_postal", e.target.value)} />
            <input className={input} placeholder="Ville" value={edit.ville ?? ""} onChange={(e) => set("ville", e.target.value)} />
            <select className={input} value={edit.type ?? "pro"} onChange={(e) => set("type", e.target.value)}>
              <option value="pro">Professionnel</option>
              <option value="particulier">Particulier</option>
            </select>
            <textarea className={`${input} col-span-2`} rows={2} placeholder="Notes" value={edit.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <button
            type="button"
            className={`${btnDark} mt-2`}
            onClick={() =>
              void run(setMsg, async () => {
                if (!edit.nom?.trim()) throw new Error("Le nom est obligatoire.");
                const sb = browserSupabase();
                const row = { nom: edit.nom.trim(), contact: edit.contact || null, email: edit.email || null, telephone: edit.telephone || null, siret: edit.siret || null, adresse: edit.adresse || null, code_postal: edit.code_postal || null, ville: edit.ville || null, type: edit.type ?? "pro", notes: edit.notes || null };
                const { error } = edit.id ? ((await sb?.from("clients").update(row).eq("id", edit.id)) ?? { error: null }) : ((await sb?.from("clients").insert(row)) ?? { error: null });
                if (error) throw new Error(error.message);
                reload();
                setEdit(null);
              })
            }
          >
            Enregistrer
          </button>
          <p className="mt-1 text-[11px] text-ink-soft">Les factures déjà émises gardent les coordonnées du jour de l&apos;émission.</p>
          <Msg m={msg} />
        </Card>
      </div>
    );

  const list = d.clients.filter((c) => !q || c.nom.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="flex gap-2">
        <button type="button" className={btnDark} onClick={() => setEdit({ type: "pro" })}>
          + Client
        </button>
        <input className={`${input} max-w-60`} placeholder="Chercher" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="mt-3 divide-y divide-paper-edge rounded-2xl border border-paper-edge bg-white/60">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setEdit(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/80">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.nom}</span>
                <span className="block truncate text-[11px] text-ink-soft">{[c.email, c.ville, c.type === "particulier" ? "particulier" : c.siret ? `SIRET ${c.siret}` : "pro"].filter(Boolean).join(" · ")}</span>
              </span>
              <b className="text-[12.5px]">{eur(ca.get(c.id) ?? 0, 0)}</b>
            </button>
          </li>
        ))}
        {!list.length && <li className="px-3 py-8 text-center text-[13px] text-ink-soft">Aucun client.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ abonnements
export function AbonnementsTab({ d, reload }: { d: FinanceData; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Subscription> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const total = d.subscriptions.filter((s) => s.actif).reduce((s, x) => s + x.montant, 0);
  if (edit)
    return (
      <div className="space-y-2">
        <button type="button" className="text-[13px] text-ink-soft" onClick={() => setEdit(null)}>
          ← Retour
        </button>
        <Card>
          <div className="grid grid-cols-2 gap-1.5">
            <select className={input} value={edit.client_id ?? ""} onChange={(e) => setEdit({ ...edit, client_id: e.target.value })}>
              <option value="">— Client —</option>
              {d.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
            <input className={input} placeholder="Libellé (ex. Maintenance du site)" value={edit.libelle ?? ""} onChange={(e) => setEdit({ ...edit, libelle: e.target.value })} />
            <label className="text-[12px]">
              Début
              <input className={input} type="date" value={edit.debut ?? today()} onChange={(e) => setEdit({ ...edit, debut: e.target.value })} />
            </label>
            <label className="text-[12px]">
              Fin (optionnelle)
              <input className={input} type="date" value={edit.fin ?? ""} onChange={(e) => setEdit({ ...edit, fin: e.target.value || null })} />
            </label>
          </div>
          <div className="mt-2">
            <LignesEditor value={edit.lignes ?? []} onChange={(l: Ligne[]) => setEdit({ ...edit, lignes: l })} />
          </div>
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={edit.actif ?? true} onChange={(e) => setEdit({ ...edit, actif: e.target.checked })} /> Actif (facturé le 1er de chaque mois, envoi après validation en Douane)
          </label>
          <button
            type="button"
            className={`${btnDark} mt-2`}
            onClick={() =>
              void run(setMsg, async () => {
                if (!edit.client_id || !edit.libelle?.trim() || !edit.lignes?.length) throw new Error("Client, libellé et au moins une ligne sont obligatoires.");
                const row = { client_id: edit.client_id, libelle: edit.libelle.trim(), lignes: edit.lignes, debut: edit.debut ?? today(), fin: edit.fin ?? null, actif: edit.actif ?? true };
                const sb = browserSupabase();
                const { error } = edit.id ? ((await sb?.from("subscriptions").update(row).eq("id", edit.id)) ?? { error: null }) : ((await sb?.from("subscriptions").insert(row)) ?? { error: null });
                if (error) throw new Error(error.message);
                reload();
                setEdit(null);
              })
            }
          >
            Enregistrer
          </button>
          <Msg m={msg} />
        </Card>
      </div>
    );
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={btnDark} onClick={() => setEdit({ actif: true, lignes: [{ designation: "", quantite: 1, prix_unitaire: 0 }] })}>
          + Abonnement
        </button>
        <span className="text-[13px]">
          Récurrent : <b>{eur(total)}</b> / mois
        </span>
      </div>
      <ul className="mt-3 divide-y divide-paper-edge rounded-2xl border border-paper-edge bg-white/60">
        {d.subscriptions.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setEdit(s)} className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/80 ${s.actif ? "" : "opacity-50"}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{s.libelle}</span>
                <span className="block truncate text-[11px] text-ink-soft">
                  {d.clients.find((c) => c.id === s.client_id)?.nom} · depuis le {dateFr(s.debut)}
                  {s.dernier_mois ? ` · dernière facture : ${s.dernier_mois}` : ""}
                </span>
              </span>
              <b className="text-[13px]">{eur(totalLignes(s.lignes))}</b>
            </button>
          </li>
        ))}
        {!d.subscriptions.length && <li className="px-3 py-8 text-center text-[13px] text-ink-soft">Aucun abonnement. Bastien facture les abonnements actifs le 1er de chaque mois.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ exports + import
const CHAMPS: Record<"clients" | "factures", { k: string; label: string; req?: boolean }[]> = {
  clients: [
    { k: "nom", label: "Nom / raison sociale", req: true },
    { k: "email", label: "E-mail" },
    { k: "telephone", label: "Téléphone" },
    { k: "adresse", label: "Adresse" },
    { k: "code_postal", label: "Code postal" },
    { k: "ville", label: "Ville" },
    { k: "siret", label: "SIRET" },
    { k: "contact", label: "Contact" },
    { k: "type", label: "Type (pro / particulier)" },
  ],
  factures: [
    { k: "numero", label: "Numéro", req: true },
    { k: "date", label: "Date d'émission", req: true },
    { k: "client", label: "Client", req: true },
    { k: "total", label: "Montant total", req: true },
    { k: "objet", label: "Objet / désignation" },
    { k: "echeance", label: "Échéance" },
    { k: "date_paiement", label: "Date de paiement (si payée)" },
    { k: "moyen", label: "Moyen de paiement" },
  ],
};
const deviner = (champ: string, entetes: string[]) => {
  const n = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const syn: Record<string, string[]> = {
    nom: ["nom", "client", "raison", "societe", "entreprise"],
    email: ["mail"],
    telephone: ["tel", "phone"],
    adresse: ["adresse", "rue"],
    code_postal: ["postal", "cp"],
    ville: ["ville", "commune"],
    siret: ["siret", "siren"],
    contact: ["contact", "interlocuteur"],
    type: ["type"],
    numero: ["numero", "n°", "facture", "ref"],
    date: ["date", "emission"],
    client: ["client", "nom", "societe"],
    total: ["total", "montant", "ttc", "ht", "prix"],
    objet: ["objet", "designation", "libelle", "description"],
    echeance: ["echeance"],
    date_paiement: ["paiement", "paye", "regle", "encaisse"],
    moyen: ["moyen", "mode"],
  };
  return entetes.findIndex((h) => (syn[champ] ?? [champ]).some((s) => n(h).includes(s)));
};

export function ExportsTab({ reload }: { reload: () => void }) {
  const t = today();
  const moisCourant = t.slice(0, 7);
  const [mois, setMois] = useState(moisDecale(moisCourant, -1));
  const [du, setDu] = useState(`${t.slice(0, 4)}-01-01`);
  const [au, setAu] = useState(t);
  const [kind, setKind] = useState<"clients" | "factures">("factures");
  const [csv, setCsv] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const charger = async (f: File) => {
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return setMsg({ ok: false, t: "Fichier vide ou sans en-têtes." });
    setCsv(rows);
    const m: Record<string, number> = {};
    for (const c of CHAMPS[kind]) m[c.k] = deviner(c.k, rows[0]!);
    setMap(m);
    setMsg(null);
  };
  const lignes = csv ? csv.slice(1).map((r) => Object.fromEntries(CHAMPS[kind].map((c) => [c.k, map[c.k]! >= 0 ? (r[map[c.k]!] ?? "") : ""]))) : [];

  return (
    <div className="space-y-3">
      <Card>
        <b className="text-[13px]">Livre des recettes (obligatoire en micro-entreprise)</b>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            Du
            <input type="date" className={input} value={du} onChange={(e) => setDu(e.target.value)} />
          </label>
          <label className="text-[12px]">
            Au
            <input type="date" className={input} value={au} onChange={(e) => setAu(e.target.value)} />
          </label>
          <a className={btn} href={`/api/finance/export?kind=livre&format=csv&du=${du}&au=${au}`}>
            ⬇️ CSV
          </a>
          <a className={btn} href={`/api/finance/export?kind=livre&format=pdf&du=${du}&au=${au}`}>
            ⬇️ PDF
          </a>
        </div>
      </Card>
      <Card>
        <b className="text-[13px]">Pour l&apos;expert-comptable</b>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            Mois
            <input type="month" className={input} value={mois} onChange={(e) => setMois(e.target.value)} />
          </label>
          <a className={btnDark} href={`/api/finance/export?kind=zip&mois=${mois}`}>
            🗜️ Paquet ZIP du mois (PDF + CSV)
          </a>
          <a className={btn} href={`/api/finance/export?kind=factures&annee=${t.slice(0, 4)}`}>
            ⬇️ Toutes les factures {t.slice(0, 4)} (CSV)
          </a>
        </div>
      </Card>
      <Card>
        <b className="text-[13px]">Reprise de l&apos;existant (import CSV)</b>
        <p className="mt-1 text-[12px] text-ink-soft">Exporte tes clients ou tes anciennes factures en CSV depuis ton ancien outil, puis associe les colonnes. Les factures gardent leur numéro ; LE PORT reprend la numérotation à la suite.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className={`${input} w-auto`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setCsv(null);
            }}
          >
            <option value="factures">Anciennes factures</option>
            <option value="clients">Clients</option>
          </select>
          <input type="file" accept=".csv,text/csv" className="text-[12px]" onChange={(e) => e.target.files?.[0] && void charger(e.target.files[0])} />
        </div>
        {csv && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-1.5">
              {CHAMPS[kind].map((c) => (
                <label key={c.k} className="text-[12px]">
                  {c.label}
                  {c.req ? " *" : ""}
                  <select className={input} value={map[c.k] ?? -1} onChange={(e) => setMap({ ...map, [c.k]: Number(e.target.value) })}>
                    <option value={-1}>— ignorer —</option>
                    {csv[0]!.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `colonne ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[12px] font-semibold">Aperçu ({lignes.length} lignes)</p>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-ink-soft">
                    {CHAMPS[kind].map((c) => (
                      <th key={c.k} className="pr-2">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-paper-edge">
                      {CHAMPS[kind].map((c) => (
                        <td key={c.k} className="max-w-32 truncate pr-2">
                          {r[c.k]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              disabled={busy || CHAMPS[kind].some((c) => c.req && (map[c.k] ?? -1) < 0)}
              className={`${btnDark} mt-2`}
              onClick={() => {
                setBusy(true);
                void run(setMsg, async () => {
                  const r = await api<{ crees: number; ignores: string[] }>("/api/finance/import", { kind, rows: lignes });
                  reload();
                  setCsv(null);
                  return `${r.crees} ${kind === "factures" ? "facture(s)" : "client(s)"} importé(s).${r.ignores.length ? ` Ignorés : ${r.ignores.slice(0, 5).join(" · ")}${r.ignores.length > 5 ? "…" : ""}` : ""}`;
                }).finally(() => setBusy(false));
              }}
            >
              Importer {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
            </button>
          </div>
        )}
        <Msg m={msg} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ fiscal + réglages
export function FiscalTab({ d, reload }: { d: FinanceData; reload: () => void }) {
  const [s, setS] = useState<FinanceSettings>(d.settings);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const t = today();
  const cal = calendrierFiscal(t, d.settings, 200);
  const set = <K extends keyof FinanceSettings>(k: K, v: FinanceSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <Card>
        <b className="text-[13px]">Calendrier (Agathe vous prévient 7 jours avant)</b>
        <ul className="mt-2 divide-y divide-paper-edge text-[13px]">
          {cal.map((e) => (
            <li key={e.date + e.titre} className="py-1.5">
              <b>{dateFr(e.date)}</b> · {e.titre}
              <span className="block text-[11.5px] text-ink-soft">{e.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-soft">Dates usuelles, à vérifier sur autoentrepreneur.urssaf.fr et impots.gouv.fr. Rien n&apos;est déclaré automatiquement.</p>
      </Card>
      <Card>
        <b className="text-[13px]">Réglages finance</b>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          <label>
            Objectif mensuel (rémunération des deux fondateurs) €
            <input className={input} inputMode="decimal" value={s.objectif_mensuel} onChange={(e) => set("objectif_mensuel", num(e.target.value))} />
          </label>
          <label>
            Taux de cotisations sociales (%)
            <input className={input} inputMode="decimal" value={Math.round(s.taux_cotisations * 1000) / 10} onChange={(e) => set("taux_cotisations", num(e.target.value) / 100)} />
          </label>
          <label>
            Déclaration URSSAF
            <select className={input} value={s.periodicite} onChange={(e) => set("periodicite", e.target.value as FinanceSettings["periodicite"])}>
              <option value="mensuelle">Mensuelle</option>
              <option value="trimestrielle">Trimestrielle</option>
            </select>
          </label>
          <label>
            Seuil de franchise de TVA €
            <input className={input} inputMode="decimal" value={s.seuil_tva} onChange={(e) => set("seuil_tva", num(e.target.value))} />
          </label>
          <label>
            Délai de paiement par défaut (jours)
            <input className={input} inputMode="numeric" value={s.delai_paiement} onChange={(e) => set("delai_paiement", num(e.target.value))} />
          </label>
          <label>
            Validité des devis (jours)
            <input className={input} inputMode="numeric" value={s.validite_devis} onChange={(e) => set("validite_devis", num(e.target.value))} />
          </label>
          <label className="col-span-2">
            IBAN (affiché sur les factures)
            <input className={input} value={s.iban} onChange={(e) => set("iban", e.target.value)} placeholder="FR76 …" />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">Taux micro-entreprise indicatifs : 24,6 % (BNC, prestations intellectuelles), 21,2 % (BIC services). À vérifier chaque année.</p>
        <button
          type="button"
          className={`${btnDark} mt-2`}
          onClick={() =>
            void run(setMsg, async () => {
              const { error } = (await browserSupabase()?.from("settings").update({ finance: s }).eq("id", 1)) ?? { error: null };
              if (error) throw new Error(error.message);
              reload();
              return "Enregistré ✓";
            })
          }
        >
          Enregistrer
        </button>
        <Msg m={msg} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ MJ E-comm (séparé de l'agence)
export function EcommTab({ d, reload }: { d: FinanceData; reload: () => void }) {
  const mois = today().slice(0, 7);
  const [m, setM] = useState<EcommMonth>(d.ecomm.find((x) => x.mois === mois) ?? { mois, ca: 0, cout_marchandises: 0, depenses_pub: 0, autres_frais: 0, note: null });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const cur = d.ecomm.find((x) => x.mois === mois);
  const pick = (k: string) => {
    const x = d.ecomm.find((e) => e.mois === k) ?? { mois: k, ca: 0, cout_marchandises: 0, depenses_pub: 0, autres_frais: 0, note: null };
    setM(x);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="CA du mois" value={eur(cur?.ca ?? 0, 0)} />
        <Kpi label="Marge estimée" value={eur(cur ? margeEcomm(cur) : 0, 0)} tone={cur && margeEcomm(cur) < 0 ? "alert" : "ok"} />
        <Kpi label="Dépenses pub" value={eur(cur?.depenses_pub ?? 0, 0)} />
      </div>
      <Card>
        <div className="flex items-end gap-2">
          <label className="text-[12px]">
            Mois
            <input type="month" className={input} value={m.mois} onChange={(e) => pick(e.target.value)} />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          {(
            [
              ["ca", "Chiffre d'affaires (€)"],
              ["cout_marchandises", "Coût des marchandises (€)"],
              ["depenses_pub", "Dépenses publicitaires (€)"],
              ["autres_frais", "Autres frais (€)"],
            ] as const
          ).map(([k, l]) => (
            <label key={k}>
              {l}
              <input className={input} inputMode="decimal" value={m[k]} onChange={(e) => setM({ ...m, [k]: num(e.target.value) })} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[13px]">
          Marge estimée : <b>{eur(margeEcomm(m))}</b>
        </p>
        <button
          type="button"
          className={`${btnDark} mt-2`}
          onClick={() =>
            void run(setMsg, async () => {
              const { error } = (await browserSupabase()?.from("ecomm_months").upsert({ ...m, maj_le: new Date().toISOString() }, { onConflict: "mois" })) ?? { error: null };
              if (error) throw new Error(error.message);
              reload();
              return "Enregistré ✓";
            })
          }
        >
          Enregistrer
        </button>
        <Msg m={msg} />
        <p className="mt-2 text-[11px] text-ink-soft">Activité séparée de l&apos;agence (aucun mélange dans le CA ni le livre des recettes de MJAGENCY). Les ventes Shopify réelles arrivent en phase 8.</p>
      </Card>
      {d.ecomm.length > 0 && (
        <Card>
          <ul className="divide-y divide-paper-edge text-[13px]">
            {d.ecomm.map((x) => (
              <li key={x.mois} className="flex justify-between py-1.5">
                <span>{x.mois}</span>
                <span>
                  CA {eur(x.ca, 0)} · marge <b>{eur(margeEcomm(x), 0)}</b>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
