"use client";

import { useState } from "react";
import { agentById, allAgents, allPoles, poleById, useCatalogVersion } from "@/data/catalog";
import { formatParis } from "@/lib/paris";
import { useWorld, type JournalEntry } from "@/store/world";
import { DemoBadge, SectionTitle } from "../Sheet";
import { RoutePanel } from "./RoutePanel";

const TYPE_ICON: Record<JournalEntry["type"], string> = {
  action: "✍️",
  echange: "💬",
  decision: "🧭",
  mission: "🎯",
  alerte: "⚠️",
  validation: "📦",
  recap: "📰",
};

export function JournalPanel() {
  useCatalogVersion();
  const journal = useWorld((s) => s.journal);
  const [pole, setPole] = useState("");
  const [agent, setAgent] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = journal.filter((e) => (!pole || e.poleId === pole || agentById(e.agentId ?? "")?.pole === pole) && (!agent || e.agentId === agent));

  return (
    <RoutePanel title="Journal" kicker="Tout ce qui se passe au port" icon="📓" accent="#355c8c" width={480}>
      <div className="flex gap-2">
        <select value={pole} onChange={(e) => setPole(e.target.value)} className="min-w-0 flex-1 rounded-full border border-paper-edge bg-white/70 px-3 py-2 text-sm" aria-label="Filtrer par pôle">
          <option value="">Tous les pôles</option>
          {allPoles().map((p) => (
            <option key={p.id} value={p.id}>
              {p.icone} {p.nom}
            </option>
          ))}
        </select>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="min-w-0 flex-1 rounded-full border border-paper-edge bg-white/70 px-3 py-2 text-sm" aria-label="Filtrer par agent">
          <option value="">Tous les agents</option>
          {allAgents().map((a) => (
            <option key={a.id} value={a.id}>
              {a.nom}
            </option>
          ))}
        </select>
      </div>

      <SectionTitle right={<DemoBadge />}>Aujourd&apos;hui</SectionTitle>
      <ol className="relative ml-2 border-l-2 border-dashed border-paper-edge">
        {list.slice(0, 120).map((e) => {
          const a = e.agentId ? agentById(e.agentId) : undefined;
          const p = poleById(e.poleId ?? a?.pole ?? "");
          return (
            <li key={e.id} className="relative pb-3 pl-5">
              <span className="absolute top-0.5 -left-[11px] grid size-5 place-items-center rounded-full bg-paper text-[11px] ring-2 ring-paper-edge">{TYPE_ICON[e.type]}</span>
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === e.id ? null : e.id)} disabled={!e.detail}>
                <div className="font-silk text-[9px] text-ink-soft">
                  {formatParis(e.at, "HH:mm")} {p ? `· ${p.icone} ${p.court}` : ""}
                </div>
                <div className="text-sm leading-snug">{e.title}</div>
                {e.detail && open !== e.id && <div className="text-[11px] text-sea">Voir le détail</div>}
              </button>
              {e.detail && open === e.id && <pre className="mt-1 rounded-xl bg-white/70 p-2 font-hand text-[17px] leading-tight whitespace-pre-wrap">{e.detail}</pre>}
            </li>
          );
        })}
        {!list.length && <li className="py-6 pl-5 text-sm text-ink-soft">Aucune entrée pour ce filtre.</li>}
      </ol>

      <SectionTitle>Récaps quotidiens archivés</SectionTitle>
      <p className="text-sm text-ink-soft">Le récap de 07:30 (mail HTML + archive ici) arrive en Phase 5. Diane écrira la météo de l&apos;entreprise en une phrase, les validations en attente, l&apos;agenda, les finances…</p>
    </RoutePanel>
  );
}
