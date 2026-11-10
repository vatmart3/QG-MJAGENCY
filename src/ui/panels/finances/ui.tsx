"use client";

import type { ReactNode } from "react";
import { eur, num, totalLignes, type Ligne } from "@/finance/types";

export const btn = "rounded-full border border-ink/15 bg-white/70 px-3 py-1.5 text-[13px] font-medium transition hover:bg-white active:scale-95 disabled:opacity-50";
export const btnDark = "rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-ink/90 active:scale-95 disabled:opacity-50";
export const input = "w-full rounded-xl border border-paper-edge bg-white/80 px-3 py-2 text-[13px] outline-none focus:border-ink/40";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-paper-edge bg-white/65 p-3 ${className}`}>{children}</div>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "alert" | "ok" }) {
  return (
    <div className="rounded-2xl border border-paper-edge bg-white/65 px-3 py-2">
      <div className={`font-pixel text-xl leading-tight ${tone === "alert" ? "text-phare" : tone === "ok" ? "text-moss" : ""}`}>{value}</div>
      <div className="text-[11px] text-ink-soft">{label}</div>
      {hint && <div className="text-[10.5px] text-ink-soft/80">{hint}</div>}
    </div>
  );
}

export function Bar({ pct, tone = "moss" }: { pct: number; tone?: "moss" | "amber" | "phare" }) {
  const c = tone === "phare" ? "bg-phare" : tone === "amber" ? "bg-amber-500" : "bg-moss";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-ink/8">
      <div className={`h-full rounded-full ${c}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export const STATUT_FACTURE: Record<string, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-ink/8 text-ink-soft" },
  emise: { label: "Émise", cls: "bg-sky-100 text-sky-800" },
  envoyee: { label: "Envoyée", cls: "bg-indigo-100 text-indigo-800" },
  payee: { label: "Payée", cls: "bg-moss/15 text-moss" },
  annulee: { label: "Annulée (avoir)", cls: "bg-ink/8 text-ink-soft line-through" },
  emis: { label: "Émis", cls: "bg-sky-100 text-sky-800" },
  envoye: { label: "Envoyé", cls: "bg-indigo-100 text-indigo-800" },
  accepte: { label: "Accepté", cls: "bg-moss/15 text-moss" },
  refuse: { label: "Refusé", cls: "bg-phare/10 text-phare" },
  expire: { label: "Expiré", cls: "bg-ink/8 text-ink-soft" },
};

export function Statut({ s, retard }: { s: string; retard?: number }) {
  const st = STATUT_FACTURE[s] ?? { label: s, cls: "bg-ink/8" };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${retard && retard > 0 ? "bg-phare/10 text-phare" : st.cls}`}>
      {retard && retard > 0 ? `En retard · ${retard} j` : st.label}
    </span>
  );
}

/** Éditeur de lignes (désignation, quantité, prix unitaire). */
export function LignesEditor({ value, onChange }: { value: Ligne[]; onChange: (l: Ligne[]) => void }) {
  const set = (i: number, patch: Partial<Ligne>) => onChange(value.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <div className="space-y-1.5">
        {value.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_96px_28px] items-start gap-1.5">
            <textarea rows={1} className={`${input} resize-y`} value={l.designation} placeholder="Désignation (ex. Site vitrine 5 pages)" onChange={(e) => set(i, { designation: e.target.value })} aria-label="Désignation" />
            <input className={`${input} text-right`} inputMode="decimal" value={l.quantite} onChange={(e) => set(i, { quantite: num(e.target.value) })} aria-label="Quantité" />
            <input className={`${input} text-right`} inputMode="decimal" value={l.prix_unitaire} onChange={(e) => set(i, { prix_unitaire: num(e.target.value) })} aria-label="Prix unitaire" />
            <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="mt-1.5 text-[16px] text-ink-soft hover:text-phare" aria-label="Retirer la ligne">
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" className={btn} onClick={() => onChange([...value, { designation: "", quantite: 1, prix_unitaire: 0 }])}>
          + Ligne
        </button>
        <span className="text-[14px]">
          Total : <b>{eur(totalLignes(value))}</b> <span className="text-[11px] text-ink-soft">(TVA non applicable, art. 293 B du CGI)</span>
        </span>
      </div>
    </div>
  );
}

export function Msg({ m }: { m: { ok: boolean; t: string } | null }) {
  if (!m) return null;
  return <p className={`mt-2 text-[12.5px] ${m.ok ? "text-moss" : "text-phare"}`}>{m.t}</p>;
}
