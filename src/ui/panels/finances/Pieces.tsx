"use client";

import { useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { dateFr, eur, num, totalLignes, type Client, type Invoice, type Ligne, type Payment, type Quote } from "@/finance/types";
import { api, pdfUrl, today, type FinanceData } from "./data";
import { btn, btnDark, Card, input, LignesEditor, Msg, Statut } from "./ui";

type Kind = "facture" | "devis";
type Piece = Invoice | Quote;
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function PiecesTab({ kind, d, reload, ouvrir, setOuvrir }: { kind: Kind; d: FinanceData; reload: () => void; ouvrir: string | null; setOuvrir: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState<"tous" | "brouillon" | "attente" | "regle">("tous");
  const list: Piece[] = kind === "facture" ? d.invoices : d.quotes;
  const regle = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of d.payments) m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + p.montant);
    return m;
  }, [d.payments]);

  if (ouvrir === "nouveau") return <Editor kind={kind} d={d} reload={reload} onClose={(id) => setOuvrir(id)} />;
  const piece = ouvrir ? list.find((p) => p.id === ouvrir) : null;
  if (piece) return piece.statut === "brouillon" ? <Editor kind={kind} d={d} piece={piece} reload={reload} onClose={(id) => setOuvrir(id)} /> : <Vue kind={kind} d={d} piece={piece} reload={reload} onClose={() => setOuvrir(null)} onOpen={setOuvrir} />;

  const t = today();
  const shown = list.filter((p) => {
    if (filtre === "brouillon" && p.statut !== "brouillon") return false;
    if (filtre === "attente" && !["emise", "envoyee", "emis", "envoye"].includes(p.statut)) return false;
    if (filtre === "regle" && !["payee", "accepte", "annulee"].includes(p.statut)) return false;
    if (!q) return true;
    return norm(`${p.numero ?? ""} ${p.objet} ${p.client_snapshot?.nom ?? d.clients.find((c) => c.id === p.client_id)?.nom ?? ""}`).includes(norm(q));
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnDark} onClick={() => setOuvrir("nouveau")}>
          + {kind === "facture" ? "Nouvelle facture" : "Nouveau devis"}
        </button>
        <input className={`${input} max-w-56 flex-1`} placeholder="Chercher (numéro, client, objet)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${input} w-auto`} value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
          <option value="tous">Tous</option>
          <option value="brouillon">Brouillons</option>
          <option value="attente">{kind === "facture" ? "À encaisser" : "En attente de réponse"}</option>
          <option value="regle">{kind === "facture" ? "Payées / annulées" : "Acceptés"}</option>
        </select>
      </div>
      <ul className="mt-3 divide-y divide-paper-edge rounded-2xl border border-paper-edge bg-white/60">
        {shown.slice(0, 200).map((p) => {
          const inv = kind === "facture" ? (p as Invoice) : null;
          const retard = inv && ["emise", "envoyee"].includes(inv.statut) && inv.echeance ? Math.floor((Date.parse(t) - Date.parse(inv.echeance)) / 86400_000) : 0;
          const reste = inv ? inv.total - (regle.get(inv.id) ?? 0) : 0;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => setOuvrir(p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/80">
                <span className="w-28 shrink-0 text-[12.5px] font-semibold">{p.numero ?? "Brouillon"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{p.client_snapshot?.nom ?? d.clients.find((c) => c.id === p.client_id)?.nom ?? "—"}</span>
                  <span className="block truncate text-[11px] text-ink-soft">
                    {p.objet} · {dateFr(p.emis_le ?? p.cree_le)}
                    {inv?.type === "avoir" ? " · avoir" : ""}
                    {inv?.importee ? " · importée" : ""}
                  </span>
                </span>
                <span className="text-right">
                  <b className="block text-[13px]">{eur(p.total)}</b>
                  {inv && ["emise", "envoyee"].includes(inv.statut) && reste < inv.total && <span className="block text-[10.5px] text-ink-soft">reste {eur(reste)}</span>}
                </span>
                <Statut s={p.statut} retard={retard > 0 ? retard : undefined} />
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-3 py-8 text-center text-[13px] text-ink-soft">Rien ici pour l&apos;instant.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ brouillon : édition
function Editor({ kind, d, piece, reload, onClose }: { kind: Kind; d: FinanceData; piece?: Piece; reload: () => void; onClose: (id: string | null) => void }) {
  const [clientId, setClientId] = useState(piece?.client_id ?? "");
  const [nouveau, setNouveau] = useState<Partial<Client> | null>(null);
  const [objet, setObjet] = useState(piece?.objet ?? "");
  const [lignes, setLignes] = useState<Ligne[]>(piece?.lignes?.length ? piece.lignes : [{ designation: "", quantite: 1, prix_unitaire: 0 }]);
  const [delai, setDelai] = useState((piece as Invoice | undefined)?.delai_jours ?? d.settings.delai_paiement);
  const [conditions, setConditions] = useState((piece as Quote | undefined)?.conditions ?? "");
  const [notes, setNotes] = useState(piece?.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const table = kind === "facture" ? "invoices" : "quotes";

  const save = async (): Promise<string | null> => {
    const sb = browserSupabase();
    if (!sb) return null;
    let cid = clientId;
    if (nouveau?.nom?.trim()) {
      const { data, error } = await sb.from("clients").insert({ ...nouveau, nom: nouveau.nom.trim(), type: nouveau.type ?? "pro" }).select("id").single();
      if (error) throw new Error(error.message);
      cid = data.id as string;
      setClientId(cid);
      setNouveau(null);
    }
    if (!cid) throw new Error("Choisis un client (ou crée-le).");
    const clean = lignes.filter((l) => l.designation.trim() || l.prix_unitaire);
    const row: Record<string, unknown> = { client_id: cid, objet: objet.trim(), lignes: clean, notes: notes.trim() || null };
    if (kind === "facture") row.delai_jours = delai;
    else row.conditions = conditions.trim() || null;
    if (piece) {
      const { error } = await sb.from(table).update(row).eq("id", piece.id);
      if (error) throw new Error(error.message);
      return piece.id;
    }
    const { data, error } = await sb.from(table).insert({ ...row, cree_par: "fondateur" }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <button type="button" className="text-[13px] text-ink-soft hover:text-ink" onClick={() => onClose(null)}>
        ← Retour
      </button>
      <h3 className="text-lg font-bold">{piece ? `${kind === "facture" ? "Facture" : "Devis"} (brouillon)` : kind === "facture" ? "Nouvelle facture" : "Nouveau devis"}</h3>
      <Card>
        <label className="block text-[12px] font-semibold">Client</label>
        {nouveau ? (
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <input className={`${input} col-span-2`} placeholder="Nom / raison sociale *" value={nouveau.nom ?? ""} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} />
            <input className={input} placeholder="E-mail" value={nouveau.email ?? ""} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })} />
            <input className={input} placeholder="SIRET (pro)" value={nouveau.siret ?? ""} onChange={(e) => setNouveau({ ...nouveau, siret: e.target.value })} />
            <input className={`${input} col-span-2`} placeholder="Adresse" value={nouveau.adresse ?? ""} onChange={(e) => setNouveau({ ...nouveau, adresse: e.target.value })} />
            <input className={input} placeholder="Code postal" value={nouveau.code_postal ?? ""} onChange={(e) => setNouveau({ ...nouveau, code_postal: e.target.value })} />
            <input className={input} placeholder="Ville" value={nouveau.ville ?? ""} onChange={(e) => setNouveau({ ...nouveau, ville: e.target.value })} />
            <select className={input} value={nouveau.type ?? "pro"} onChange={(e) => setNouveau({ ...nouveau, type: e.target.value as Client["type"] })}>
              <option value="pro">Professionnel</option>
              <option value="particulier">Particulier</option>
            </select>
            <button type="button" className={btn} onClick={() => setNouveau(null)}>
              Annuler
            </button>
          </div>
        ) : (
          <div className="mt-1 flex gap-1.5">
            <select className={input} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Choisir —</option>
              {d.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
            <button type="button" className={`${btn} shrink-0`} onClick={() => setNouveau({ type: "pro" })}>
              + Nouveau
            </button>
          </div>
        )}
        <label className="mt-3 block text-[12px] font-semibold">Objet</label>
        <input className={`${input} mt-1`} value={objet} onChange={(e) => setObjet(e.target.value)} placeholder="ex. Création du site vitrine" />
      </Card>
      <Card>
        <LignesEditor value={lignes} onChange={setLignes} />
      </Card>
      <Card>
        {kind === "facture" ? (
          <label className="block text-[12px] font-semibold">
            Délai de paiement
            <select className={`${input} mt-1`} value={delai} onChange={(e) => setDelai(Number(e.target.value))}>
              {[0, 7, 15, 30, 45].map((j) => (
                <option key={j} value={j}>
                  {j ? `${j} jours` : "À réception"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-[12px] font-semibold">
            Conditions (acompte, délais, abonnement…)
            <textarea className={`${input} mt-1`} rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} />
          </label>
        )}
        <label className="mt-2 block text-[12px] font-semibold">
          Note sur le document
          <textarea className={`${input} mt-1`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. Merci pour votre confiance !" />
        </label>
      </Card>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={btn}
          onClick={() =>
            void run(async () => {
              const id = await save();
              reload();
              setMsg({ ok: true, t: "Brouillon enregistré ✓" });
              if (!piece && id) onClose(id);
            })
          }
        >
          Enregistrer le brouillon
        </button>
        {piece && (
          <a className={btn} href={pdfUrl(kind, piece.id)} target="_blank" rel="noreferrer">
            Aperçu PDF
          </a>
        )}
        <button
          type="button"
          disabled={busy || totalLignes(lignes) === 0}
          className={btnDark}
          onClick={() =>
            void run(async () => {
              if (!window.confirm(`Émettre ${kind === "facture" ? "la facture" : "le devis"} ? Le numéro sera définitif et le document ne pourra plus être modifié${kind === "facture" ? " (seulement corrigé par un avoir)" : ""}.`)) return;
              const id = await save();
              if (!id) return;
              const r = await api<{ numero: string }>("/api/finance/emit", { kind, id });
              reload();
              setMsg({ ok: true, t: `${r.numero} émis ✓` });
              onClose(id);
            })
          }
        >
          Émettre ({eur(totalLignes(lignes))})
        </button>
        {piece && (
          <button
            type="button"
            disabled={busy}
            className="ml-auto text-[12.5px] text-phare"
            onClick={() =>
              void run(async () => {
                if (!window.confirm("Supprimer ce brouillon ?")) return;
                const sb = browserSupabase();
                const { error } = (await sb?.from(table).delete().eq("id", piece.id)) ?? { error: null };
                if (error) throw new Error(error.message);
                reload();
                onClose(null);
              })
            }
          >
            Supprimer le brouillon
          </button>
        )}
      </div>
      <Msg m={msg} />
    </div>
  );
}

// ------------------------------------------------------------------ pièce émise : consultation et actions
function Vue({ kind, d, piece, reload, onClose, onOpen }: { kind: Kind; d: FinanceData; piece: Piece; reload: () => void; onClose: () => void; onOpen: (id: string) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paiement, setPaiement] = useState<{ montant: string; date: string; moyen: Payment["moyen"] } | null>(null);
  const [envoi, setEnvoi] = useState<{ a: string; message: string } | null>(null);
  const inv = kind === "facture" ? (piece as Invoice) : null;
  const pays = inv ? d.payments.filter((p) => p.invoice_id === inv.id) : [];
  const regle = pays.reduce((s, p) => s + p.montant, 0);
  const reste = inv ? Math.round((inv.total - regle) * 100) / 100 : 0;
  const origine = inv?.avoir_de ? d.invoices.find((i) => i.id === inv.avoir_de) : null;
  const avoirs = inv ? d.invoices.filter((i) => i.avoir_de === inv.id) : [];
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const c = piece.client_snapshot;

  return (
    <div className="space-y-3">
      <button type="button" className="text-[13px] text-ink-soft hover:text-ink" onClick={onClose}>
        ← Retour
      </button>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xl font-bold">
            {inv?.type === "avoir" ? "Avoir" : kind === "facture" ? "Facture" : "Devis"} {piece.numero}
          </h3>
          <p className="text-[12.5px] text-ink-soft">
            {c?.nom} · émis le {dateFr(piece.emis_le)}
            {inv?.echeance ? ` · échéance ${dateFr(inv.echeance)}` : ""}
            {!inv && (piece as Quote).valable_jusqu ? ` · valable jusqu'au ${dateFr((piece as Quote).valable_jusqu)}` : ""}
          </p>
        </div>
        <Statut s={piece.statut} />
      </div>
      <Card>
        <p className="text-[13px] font-medium">{piece.objet}</p>
        <ul className="mt-2 divide-y divide-paper-edge text-[13px]">
          {piece.lignes.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 py-1">
              <span className="min-w-0 flex-1">{l.designation}</span>
              <span className="text-ink-soft">
                {num(l.quantite)} × {eur(num(l.prix_unitaire))}
              </span>
              <b className="w-24 text-right">{eur(num(l.quantite) * num(l.prix_unitaire))}</b>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-paper-edge pt-2 text-[14px]">
          <span>Total</span>
          <b>{eur(piece.total)}</b>
        </div>
        {inv && inv.type === "facture" && (
          <p className="mt-1 text-[12.5px] text-ink-soft">
            Encaissé : {eur(regle)} · Reste : <b className={reste > 0 ? "text-phare" : "text-moss"}>{eur(Math.max(0, reste))}</b>
          </p>
        )}
        {origine && (
          <button type="button" className="mt-1 text-[12.5px] text-sea underline" onClick={() => onOpen(origine.id)}>
            Avoir sur la facture {origine.numero}
          </button>
        )}
        {avoirs.map((a) => (
          <button key={a.id} type="button" className="mt-1 block text-[12.5px] text-sea underline" onClick={() => onOpen(a.id)}>
            Avoir {a.numero} ({eur(a.total)})
          </button>
        ))}
        {piece.pdf_sha256 && <p className="mt-2 break-all text-[10.5px] text-ink-soft">PDF archivé · SHA-256 {piece.pdf_sha256}</p>}
        {inv?.relances?.length ? <p className="mt-1 text-[11.5px] text-ink-soft">Relances : {inv.relances.map((r) => `niveau ${r.niveau} le ${dateFr(r.le)}`).join(" · ")}</p> : null}
      </Card>

      <div className="flex flex-wrap gap-2">
        <a className={btn} href={pdfUrl(kind, piece.id)} target="_blank" rel="noreferrer">
          📄 Voir le PDF
        </a>
        <a className={btn} href={pdfUrl(kind, piece.id, true)}>
          ⬇️ Télécharger
        </a>
        {piece.statut !== "annulee" && inv?.type !== "avoir" && (
          <button type="button" className={btnDark} onClick={() => setEnvoi({ a: c?.email ?? "", message: "" })}>
            ✉️ Envoyer au client
          </button>
        )}
        {inv && inv.type === "facture" && reste > 0 && inv.statut !== "annulee" && (
          <button type="button" className={btn} onClick={() => setPaiement({ montant: String(reste), date: today(), moyen: "virement" })}>
            💶 Encaisser
          </button>
        )}
        {inv && inv.type === "facture" && inv.statut !== "annulee" && (
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() =>
              void run(async () => {
                const motif = window.prompt("Motif de l'avoir (annule la facture en totalité) :");
                if (!motif?.trim()) return;
                const r = await api<{ numero: string }>("/api/finance/avoir", { id: inv.id, motif });
                reload();
                setMsg({ ok: true, t: `Avoir ${r.numero} émis ✓` });
              })
            }
          >
            ↩︎ Faire un avoir
          </button>
        )}
        {!inv && ["emis", "envoye"].includes(piece.statut) && (
          <>
            <button
              type="button"
              className={btn}
              onClick={() =>
                void run(async () => {
                  await browserSupabase()?.from("quotes").update({ statut: "accepte" }).eq("id", piece.id);
                  reload();
                })
              }
            >
              ✓ Accepté
            </button>
            <button
              type="button"
              className={btn}
              onClick={() =>
                void run(async () => {
                  await browserSupabase()?.from("quotes").update({ statut: "refuse" }).eq("id", piece.id);
                  reload();
                })
              }
            >
              ✕ Refusé
            </button>
          </>
        )}
        {!inv && piece.statut !== "refuse" && (
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() =>
              void run(async () => {
                const sb = browserSupabase();
                if (!sb) return;
                const { data, error } = await sb
                  .from("invoices")
                  .insert({ client_id: piece.client_id, objet: piece.objet, lignes: piece.lignes, quote_id: piece.id, delai_jours: d.settings.delai_paiement, cree_par: "fondateur" })
                  .select("id")
                  .single();
                if (error) throw new Error(error.message);
                if (piece.statut !== "accepte") await sb.from("quotes").update({ statut: "accepte" }).eq("id", piece.id);
                reload();
                setMsg({ ok: true, t: `Facture brouillon créée depuis ${piece.numero} : ouvre l'onglet Factures pour la vérifier et l'émettre. (id ${data.id})` });
              })
            }
          >
            🧾 Transformer en facture
          </button>
        )}
      </div>

      {paiement && inv && (
        <Card>
          <b className="text-[13px]">Enregistrer un paiement</b>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <input className={input} inputMode="decimal" value={paiement.montant} onChange={(e) => setPaiement({ ...paiement, montant: e.target.value })} aria-label="Montant" />
            <input className={input} type="date" value={paiement.date} onChange={(e) => setPaiement({ ...paiement, date: e.target.value })} aria-label="Date" />
            <select className={input} value={paiement.moyen} onChange={(e) => setPaiement({ ...paiement, moyen: e.target.value as Payment["moyen"] })}>
              <option value="virement">Virement</option>
              <option value="carte">Carte</option>
              <option value="especes">Espèces</option>
              <option value="cheque">Chèque</option>
              <option value="prelevement">Prélèvement</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">Un paiement enregistré entre dans le livre des recettes et ne se modifie plus.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              className={btnDark}
              onClick={() =>
                void run(async () => {
                  const { error } = (await browserSupabase()?.from("payments").insert({ invoice_id: inv.id, montant: num(paiement.montant), date: paiement.date, moyen: paiement.moyen, cree_par: "fondateur" })) ?? { error: null };
                  if (error) throw new Error(error.message);
                  setPaiement(null);
                  reload();
                  setMsg({ ok: true, t: "Paiement enregistré ✓" });
                })
              }
            >
              Enregistrer
            </button>
            <button type="button" className={btn} onClick={() => setPaiement(null)}>
              Annuler
            </button>
          </div>
        </Card>
      )}

      {envoi && (
        <Card>
          <b className="text-[13px]">Envoyer {piece.numero} par mail (PDF joint, depuis la boîte de l&apos;agence)</b>
          <input className={`${input} mt-2`} value={envoi.a} onChange={(e) => setEnvoi({ ...envoi, a: e.target.value })} placeholder="E-mail du client" />
          <textarea className={`${input} mt-1.5`} rows={4} value={envoi.message} onChange={(e) => setEnvoi({ ...envoi, message: e.target.value })} placeholder="Message (laisser vide pour le message standard)" />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !envoi.a.includes("@")}
              className={btnDark}
              onClick={() =>
                void run(async () => {
                  const r = await api<{ demo?: boolean }>("/api/finance/send", { kind, id: piece.id, a: envoi.a, message: envoi.message });
                  setEnvoi(null);
                  reload();
                  setMsg({ ok: true, t: r.demo ? "Envoi simulé (Google non connecté)." : "Envoyé ✓" });
                })
              }
            >
              Envoyer
            </button>
            <button type="button" className={btn} onClick={() => setEnvoi(null)}>
              Annuler
            </button>
          </div>
        </Card>
      )}
      {pays.length > 0 && (
        <Card>
          <b className="text-[13px]">Paiements</b>
          <ul className="mt-1 text-[12.5px]">
            {pays.map((p) => (
              <li key={p.id}>
                {dateFr(p.date)} · {eur(p.montant)} · {p.moyen}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Msg m={msg} />
    </div>
  );
}
