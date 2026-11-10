"use client";

import { useMemo } from "react";
import { resumeFinance } from "@/finance/calc";
import { calendrierFiscal } from "@/finance/fiscal";
import { dateFr, eur } from "@/finance/types";
import { today, type FinanceData } from "./data";
import { Bar, Card, Kpi } from "./ui";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export function Dashboard({ d, onOpen }: { d: FinanceData; onOpen: (kind: "facture", id: string) => void }) {
  const t = today();
  const r = useMemo(() => resumeFinance({ invoices: d.invoices, payments: d.payments, subscriptions: d.subscriptions, settings: d.settings, mois: t.slice(0, 7), aujourdhui: t }), [d, t]);
  const echeances = calendrierFiscal(t, d.settings, 45).slice(0, 4);
  const max = Math.max(1, d.settings.objectif_mensuel, ...r.historique.map((h) => Math.max(h.encaisse, h.facture)));
  const vide = !d.invoices.some((i) => i.statut !== "brouillon");

  return (
    <div className="space-y-3">
      {vide && (
        <Card className="bg-amber-50/80">
          <p className="text-[13px]">
            Aucune facture pour l&apos;instant. Commence par <b>Exports & import</b> pour reprendre tes anciennes factures, ou crée ta première facture dans l&apos;onglet <b>Factures</b> (ou demande-la à Bastien : « @Bastien fais la facture de… »).
          </p>
        </Card>
      )}
      <Card>
        <div className="text-[12px] text-ink-soft">Encaissé ce mois-ci / objectif de rémunération ({eur(d.settings.objectif_mensuel, 0)})</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-pixel text-4xl">{eur(r.encaisseMois, 0)}</span>
          <span className="text-sm text-ink-soft">{r.pctObjectif} %</span>
        </div>
        <div className="mt-2">
          <Bar pct={r.pctObjectif} tone={r.pctObjectif >= 100 ? "moss" : r.pctObjectif >= 60 ? "amber" : "phare"} />
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Facturé ce mois" value={eur(r.factureMois, 0)} />
        <Kpi label="Reste à encaisser" value={eur(r.aEncaisser, 0)} />
        <Kpi label="Impayés en retard" value={eur(r.totalImpayes, 0)} tone={r.totalImpayes > 0 ? "alert" : "ok"} hint={`${r.impayes.length} facture${r.impayes.length > 1 ? "s" : ""}`} />
        <Kpi label="Cotisations estimées (mois)" value={eur(r.cotisationsMois, 0)} hint={`${Math.round(d.settings.taux_cotisations * 1000) / 10} % de l'encaissé`} />
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between text-[12px]">
          <b>12 derniers mois</b>
          <span className="flex gap-3 text-ink-soft">
            <span>
              <i className="mr-1 inline-block size-2 rounded-sm bg-moss" />
              encaissé
            </span>
            <span>
              <i className="mr-1 inline-block size-2 rounded-sm bg-sky-300" />
              facturé
            </span>
            <span className="text-phare">--- objectif</span>
          </span>
        </div>
        <div className="relative flex h-40 items-end gap-1.5 pb-5">
          <div className="absolute inset-x-0 border-t border-dashed border-phare/60" style={{ bottom: `${20 + (d.settings.objectif_mensuel / max) * 130}px` }} />
          {r.historique.map((h) => (
            <div key={h.mois} className="flex flex-1 flex-col items-center gap-0.5" title={`${libMois(h.mois)} : encaissé ${eur(h.encaisse, 0)}, facturé ${eur(h.facture, 0)}`}>
              <div className="flex h-[130px] w-full items-end justify-center gap-px">
                <div className="w-1/2 rounded-t bg-moss" style={{ height: `${(h.encaisse / max) * 130}px` }} />
                <div className="w-1/2 rounded-t bg-sky-300" style={{ height: `${(h.facture / max) * 130}px` }} />
              </div>
              <span className="font-silk text-[7.5px] text-ink-soft">{libMois(h.mois)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <b className="text-[13px]">Prévision (Héloïse)</b>
          <ul className="mt-1.5 space-y-1 text-[13px]">
            {r.prevision.map((p) => (
              <li key={p.mois} className="flex justify-between">
                <span>{libMois(p.mois)}</span>
                <b>≈ {eur(p.montant, 0)}</b>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-soft">Tendance des 3 derniers mois, abonnements ({eur(r.abonnementsMensuels, 0)}/mois) et factures en attente.</p>
        </Card>
        <Card>
          <b className="text-[13px]">Franchise de TVA (Agathe)</b>
          <div className="mt-1.5 text-[13px]">
            {eur(r.caAnnuelEncaisse, 0)} encaissés en {t.slice(0, 4)} sur {eur(r.seuilTva, 0)}
          </div>
          <div className="mt-1.5">
            <Bar pct={r.pctSeuilTva} tone={r.pctSeuilTva >= 90 ? "phare" : r.pctSeuilTva >= 70 ? "amber" : "moss"} />
          </div>
          <ul className="mt-2 space-y-0.5 text-[12px] text-ink-soft">
            {echeances.map((e) => (
              <li key={e.date + e.titre}>
                🗓️ {dateFr(e.date)} · {e.titre}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {r.impayes.length > 0 && (
        <Card>
          <b className="text-[13px] text-phare">Factures en retard (Rémi prépare les relances à J+3, J+10, J+30)</b>
          <ul className="mt-1.5 divide-y divide-paper-edge">
            {r.impayes.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onOpen("facture", x.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] hover:bg-white/60">
                  <span className="w-24 shrink-0 font-medium">{x.numero}</span>
                  <span className="min-w-0 flex-1 truncate">{x.client}</span>
                  <span className="text-phare">{x.retardJours} j</span>
                  <b className="w-24 text-right">{eur(x.reste)}</b>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
