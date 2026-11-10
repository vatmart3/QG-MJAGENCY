"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { agentById, poleById, useCatalogVersion } from "@/data/catalog";
import { formatParis } from "@/lib/paris";
import { useWorld, type TaskItem } from "@/store/world";
import { ui } from "@/store/ui";
import { getGame } from "../gameRef";
import { Portrait } from "../Portrait";
import { DemoBadge, SectionTitle } from "../Sheet";
import { RoutePanel } from "./RoutePanel";

const TABS: { id: TaskItem["status"]; label: string }[] = [
  { id: "running", label: "En cours" },
  { id: "waiting_approval", label: "En Douane" },
  { id: "done", label: "Terminées" },
];

export function TachesPanel() {
  useCatalogVersion();
  const tasks = useWorld((s) => s.tasks);
  const missions = useWorld((s) => s.missions);
  const rapports = useWorld((s) => s.rapports);
  const router = useRouter();
  const [tab, setTab] = useState<TaskItem["status"]>("running");
  const list = tasks.filter((t) => t.status === tab);

  return (
    <RoutePanel title="Tâches" kicker="Ce que font les agents" icon="🗂️" accent="#3a7bd5">
      {missions.length > 0 && (
        <>
          <SectionTitle>Missions des fondateurs</SectionTitle>
          <ul className="space-y-2">
            {missions.slice(0, 5).map((m) => (
              <li key={m.id} className="rounded-2xl border border-paper-edge bg-white/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{m.text}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${m.status === "terminee" ? "bg-moss/15 text-moss" : "bg-ink/8"}`}>
                    {{ nouvelle: "Reçue", planification: "Planification", en_cours: "En cours", terminee: "Terminée", annulee: "Abandonnée" }[m.status]}
                  </span>
                </div>
                {m.plan.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[13px] text-ink-soft">
                    {m.plan.map((p) => (
                      <li key={p.agentId}>
                        ▸ <b className="text-ink">{agentById(p.agentId)?.nom}</b> — {p.title}
                      </li>
                    ))}
                  </ul>
                )}
                {m.synthese && <p className="mt-2 font-hand text-lg leading-tight">{m.synthese}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Link href={`/flux?mission=${encodeURIComponent(m.id)}`} className="rounded-full border border-ink/15 px-2.5 py-1 text-[12px] hover:bg-white">
                    🔀 Voir le flux
                  </Link>
                  {(() => {
                    const s = Object.values(rapports).find((r) => r.missionId === m.id && !r.parentId && r.agentId === m.target);
                    return s ? (
                      <Link href={`/rapports?id=${encodeURIComponent(s.taskId)}`} className="rounded-full bg-ink px-2.5 py-1 text-[12px] text-white">
                        📄 Compte rendu
                      </Link>
                    ) : null;
                  })()}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 flex gap-1 rounded-full bg-ink/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${tab === t.id ? "bg-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
          >
            {t.label} <span className="font-silk text-[9px]">{tasks.filter((x) => x.status === t.id).length}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <DemoBadge />
      </div>
      <ul className="mt-1 divide-y divide-paper-edge">
        {list.slice(0, 60).map((t) => {
          const a = agentById(t.agentId);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  if (rapports[t.id]) return router.push(`/rapports?id=${encodeURIComponent(t.id)}`);
                  getGame()?.flyToAgent(t.agentId);
                  ui.selectAgent(t.agentId);
                }}
                className="flex w-full items-center gap-3 py-2 text-left"
              >
                <Portrait agentId={t.agentId} size={1.25} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block text-[11px] text-ink-soft">
                    {a?.nom} · {poleById(a?.pole ?? "")?.court} · {formatParis(t.updatedAt, "HH:mm")}
                    {rapports[t.id] && <span className="ml-1 text-ink">· 📄 compte rendu</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!list.length && <li className="py-6 text-center text-sm text-ink-soft">Rien ici pour le moment.</li>}
      </ul>
    </RoutePanel>
  );
}
