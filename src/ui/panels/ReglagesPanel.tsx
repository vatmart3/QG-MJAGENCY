"use client";

import { hhmm } from "@/lib/paris";
import { useWorld, world } from "@/store/world";
import { useUI } from "@/store/ui";
import { SectionTitle } from "../Sheet";
import { RoutePanel } from "./RoutePanel";

const HOURS: { label: string; h: number | null }[] = [
  { label: "Heure réelle (Paris)", h: null },
  { label: "06:20 — Aube", h: 6.33 },
  { label: "08:29 — Juste avant le stand-up", h: 8.48 },
  { label: "12:00 — Plein jour", h: 12 },
  { label: "18:30 — Coucher de soleil", h: 18.5 },
  { label: "19:45 — Crépuscule", h: 19.75 },
  { label: "23:00 — Nuit", h: 23 },
];

const TODO: { phase: string; items: string[] }[] = [
  { phase: "Phase 2", items: ["Projet Supabase (URL, clé anon, clé service)", "Adresse e-mail de Matheis pour l'allowlist"] },
  { phase: "Phase 3", items: ["Clé API Anthropic"] },
  { phase: "Phase 4", items: ["Client OAuth Google (Gmail + Agenda) pour mjagency.officiel@gmail.com"] },
  { phase: "Phase 7", items: ["Clé Google Places API (New)"] },
  { phase: "Phase 8", items: ["Domaine Shopify + token Admin API (custom app)"] },
];

export function ReglagesPanel() {
  const override = useWorld((s) => s.clockOverride);
  const chatter = useWorld((s) => s.chatterEnabled);
  const fps = useUI((s) => s.fps);

  return (
    <RoutePanel title="Réglages" kicker="Mode démo — Phase 1" icon="⚙️" accent="#5b5470">
      <SectionTitle>Démo</SectionTitle>
      <label className="block text-sm">
        <span className="text-ink-soft">Heure de la ville</span>
        <select
          value={override === null ? "" : String(override)}
          onChange={(e) => world.setClockOverride(e.target.value === "" ? null : Number(e.target.value))}
          className="mt-1 w-full rounded-full border border-paper-edge bg-white/70 px-3 py-2"
        >
          {HOURS.map((h) => (
            <option key={h.label} value={h.h === null ? "" : String(h.h)}>
              {h.label}
            </option>
          ))}
        </select>
      </label>
      {override !== null && <p className="mt-1 text-xs text-ink-soft">Heure forcée : {hhmm(override)}. Les agents rentrent chez eux à 20 h 30 et reviennent à 7 h.</p>}

      <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-paper-edge bg-white/60 px-3 py-2.5 text-sm">
        <span>
          Bavardage d&apos;ambiance
          <span className="block text-xs text-ink-soft">Petites répliques entre agents (Haiku, ~1 appel / 10 min en réel)</span>
        </span>
        <input type="checkbox" checked={chatter} onChange={(e) => world.setChatter(e.target.checked)} className="size-5 accent-ink" />
      </label>
      <p className="mt-2 font-silk text-[9px] text-ink-soft">Rendu : {fps} i/s</p>

      <SectionTitle>Accès</SectionTitle>
      <p className="text-sm">Allowlist (Phase 2, magic link Supabase) :</p>
      <ul className="mt-1 text-sm text-ink-soft">
        <li>• jeremyvatuonepro@gmail.com</li>
        <li>• mjagency.officiel@gmail.com</li>
        <li>• adresse de Matheis — à renseigner</li>
      </ul>

      <SectionTitle>Ce qu&apos;il faudra fournir</SectionTitle>
      <ul className="space-y-2">
        {TODO.map((t) => (
          <li key={t.phase} className="rounded-2xl border border-paper-edge bg-white/60 px-3 py-2 text-sm">
            <b>{t.phase}</b>
            {t.items.map((i) => (
              <div key={i} className="text-ink-soft">
                ▸ {i}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">L&apos;édition des agents, pôles, routines et de la mémoire d&apos;entreprise arrive avec Supabase (Phase 2).</p>
    </RoutePanel>
  );
}
