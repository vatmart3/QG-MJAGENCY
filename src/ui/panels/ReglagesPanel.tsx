"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useUI } from "@/store/ui";
import { AccesTab } from "./reglages/AccesTab";
import { AgentsTab } from "./reglages/AgentsTab";
import { ConnexionsTab } from "./reglages/ConnexionsTab";
import { DemoTab } from "./reglages/DemoTab";
import { MemoryTab } from "./reglages/MemoryTab";
import { PolesTab } from "./reglages/PolesTab";
import { RoutinesTab } from "./reglages/RoutinesTab";
import { RoutePanel } from "./RoutePanel";

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "poles", label: "Pôles" },
  { id: "routines", label: "Routines" },
  { id: "memoire", label: "Mémoire" },
  { id: "acces", label: "Accès & budget" },
  { id: "connexions", label: "Connexions & règles" },
  { id: "demo", label: "Affichage & tests" },
] as const;

export function ReglagesPanel() {
  const params = useSearchParams();
  const initial = TABS.find((t) => t.id === params.get("onglet"))?.id ?? "agents";
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(initial);
  const conn = useUI((s) => s.conn);
  return (
    <RoutePanel title="Réglages" kicker={conn === "demo" ? "Mode démo — enregistré dans ce navigateur" : "Enregistré dans Supabase"} icon="⚙️" accent="#5b5470" width={580}>
      <div className="hide-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${tab === t.id ? "bg-ink text-white" : "bg-ink/5 text-ink-soft hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "agents" && <AgentsTab />}
      {tab === "poles" && <PolesTab />}
      {tab === "routines" && <RoutinesTab />}
      {tab === "memoire" && <MemoryTab />}
      {tab === "acces" && <AccesTab />}
      {tab === "connexions" && <ConnexionsTab />}
      {tab === "demo" && <DemoTab />}
    </RoutePanel>
  );
}
