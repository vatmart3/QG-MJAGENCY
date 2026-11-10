"use client";

import { useState } from "react";
import { DemoBadge, SectionTitle } from "../Sheet";
import { RoutePanel } from "./RoutePanel";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// Données de démonstration (Phase 6 : factures réelles, livre des recettes, prévisionnel)
const MONTHS = [
  { m: "juin", ca: 3120 },
  { m: "juil.", ca: 4480 },
  { m: "août", ca: 2950 },
  { m: "sept.", ca: 5210 },
  { m: "oct.", ca: 4870 },
  { m: "nov.", ca: 3890 },
];

export function FinancesPanel() {
  const [tab, setTab] = useState<"agence" | "ecomm">("agence");
  const objectif = 6000;
  const ca = 3890;
  const encaisse = 2650;
  const max = Math.max(...MONTHS.map((x) => x.ca), objectif);

  return (
    <RoutePanel title="Finances" kicker="Novembre 2026" icon="💶" accent="#2e9d62">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-full bg-ink/5 p-1">
          {(["agence", "ecomm"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${tab === t ? "bg-white shadow-sm" : "text-ink-soft"}`}>
              {t === "agence" ? "Agence" : "MJ E-comm"}
            </button>
          ))}
        </div>
        <DemoBadge />
      </div>

      {tab === "agence" ? (
        <>
          <div className="mt-4 rounded-2xl border border-paper-edge bg-white/70 p-4">
            <div className="text-xs text-ink-soft">CA du mois / objectif ({eur(objectif)} = 2 × 3 000 € de rémunération)</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-pixel text-4xl">{eur(ca)}</span>
              <span className="text-sm text-ink-soft">{Math.round((ca / objectif) * 100)} %</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink/8">
              <div className="h-full rounded-full bg-moss" style={{ width: `${(ca / objectif) * 100}%` }} />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { k: "Encaissé", v: eur(encaisse) },
              { k: "À encaisser", v: eur(ca - encaisse) },
              { k: "Impayés", v: eur(590), alert: true },
            ].map((x) => (
              <div key={x.k} className="rounded-2xl border border-paper-edge bg-white/60 px-3 py-2">
                <div className={`font-pixel text-lg ${x.alert ? "text-phare" : ""}`}>{x.v}</div>
                <div className="text-[11px] text-ink-soft">{x.k}</div>
              </div>
            ))}
          </div>

          <SectionTitle>CA des 6 derniers mois</SectionTitle>
          <div className="relative flex h-36 items-end gap-2 rounded-2xl border border-paper-edge bg-white/50 px-3 pt-3 pb-6">
            <div className="absolute inset-x-3 border-t border-dashed border-phare/60" style={{ bottom: `${24 + (objectif / max) * 108}px` }}>
              <span className="absolute -top-4 right-0 font-silk text-[8px] text-phare">objectif</span>
            </div>
            {MONTHS.map((x, i) => (
              <div key={x.m} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t-md" style={{ height: `${(x.ca / max) * 108}px`, background: i === MONTHS.length - 1 ? "#2e9d62" : "#9fd3b5" }} title={eur(x.ca)} />
                <span className="font-silk text-[8px] text-ink-soft">{x.m}</span>
              </div>
            ))}
          </div>

          <SectionTitle>À venir en Phase 6</SectionTitle>
          <ul className="space-y-1 text-sm text-ink-soft">
            <li>▸ Factures conformes et verrouillées (F-2026-0001…), avoirs, PDF archivés + SHA-256</li>
            <li>▸ Import CSV de l&apos;existant, livre des recettes, ZIP mensuel pour l&apos;expert-comptable</li>
            <li>▸ Prévisionnel 3 mois, cotisations estimées, seuil de franchise de TVA</li>
          </ul>
        </>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { k: "CA du mois", v: eur(2140) },
              { k: "Marge estimée", v: eur(780) },
              { k: "Dépenses pub", v: eur(410) },
            ].map((x) => (
              <div key={x.k} className="rounded-2xl border border-paper-edge bg-white/60 px-3 py-2">
                <div className="font-pixel text-lg">{x.v}</div>
                <div className="text-[11px] text-ink-soft">{x.k}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-soft">Finances de la boutique séparées de l&apos;agence. Données Shopify réelles en Phase 8 (Shopify Admin API), dépenses pub saisies à la main.</p>
        </>
      )}
    </RoutePanel>
  );
}
