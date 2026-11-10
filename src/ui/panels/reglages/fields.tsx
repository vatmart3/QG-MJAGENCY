"use client";

import { useState, type ReactNode } from "react";

export const inputCls =
  "w-full rounded-xl border border-paper-edge bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-ink/40 disabled:opacity-60";

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-ink-soft">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-phare">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-paper-edge bg-white/60 px-3 py-2">
      <span className="text-sm">
        {label}
        {hint && <span className="block text-[11px] text-ink-soft">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink" />
    </label>
  );
}

export function ListRow({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition ${active ? "bg-ink text-white" : "hover:bg-ink/5"}`}
    >
      {children}
    </button>
  );
}

/** Statut d'enregistrement (en cours / ok / erreur) partagé par les formulaires. */
export function useSaver() {
  const [state, setState] = useState<{ status: "idle" | "saving" | "ok" | "error"; message: string }>({ status: "idle", message: "" });
  const run = async (fn: () => Promise<void>, okMsg = "Enregistré ✓") => {
    setState({ status: "saving", message: "" });
    try {
      await fn();
      setState({ status: "ok", message: okMsg });
      setTimeout(() => setState((s) => (s.status === "ok" ? { status: "idle", message: "" } : s)), 2500);
      return true;
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Erreur inconnue" });
      return false;
    }
  };
  const fail = (message: string) => setState({ status: "error", message });
  return { ...state, run, fail };
}

export function SaveBar({
  saver,
  onSave,
  onDelete,
  onCancel,
  deleteLabel = "Supprimer",
  deleteDisabled,
  saveLabel = "Enregistrer",
}: {
  saver: ReturnType<typeof useSaver>;
  onSave: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  deleteLabel?: string;
  deleteDisabled?: string;
  saveLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-4 flex flex-wrap items-center gap-2 border-t border-paper-edge bg-paper/95 px-1 py-3 backdrop-blur">
      <button type="button" onClick={onSave} disabled={saver.status === "saving"} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink/90 active:scale-95 disabled:opacity-50">
        {saver.status === "saving" ? "Enregistrement…" : saveLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-2 text-sm text-ink-soft hover:text-ink">
          Annuler
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={!!deleteDisabled}
          title={deleteDisabled}
          className="ml-auto rounded-full px-3 py-2 text-sm text-phare transition hover:bg-phare/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleteLabel}
        </button>
      )}
      {saver.message && (
        <span className={`w-full text-[12px] ${saver.status === "error" ? "text-phare" : "text-moss"}`} role={saver.status === "error" ? "alert" : "status"}>
          {saver.message}
        </span>
      )}
    </div>
  );
}

export const linesToList = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
