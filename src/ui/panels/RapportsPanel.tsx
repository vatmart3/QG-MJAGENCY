"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { agentById, poleById, useCatalogVersion } from "@/data/catalog";
import { formatParis } from "@/lib/paris";
import { useWorld, type RapportItem } from "@/store/world";
import { Portrait } from "../Portrait";
import { inputCls } from "./reglages/fields";
import { RapportView } from "../rapport/RapportView";
import { RoutePanel } from "./RoutePanel";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Onglet « Rapports » : tous les comptes rendus des agents, rangés par jour, à lire et télécharger. */
export function RapportsPanel() {
  useCatalogVersion();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const rapports = useWorld((s) => s.rapports);
  const missions = useWorld((s) => s.missions);
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState<"tous" | "syntheses">("tous");

  const list = useMemo(() => {
    const all = Object.values(rapports).sort((a, b) => b.at - a.at);
    const n = norm(q.trim());
    return all.filter((r) => {
      if (filtre === "syntheses" && !(r.missionId && !r.parentId)) return false;
      if (!n) return true;
      const a = agentById(r.agentId);
      return norm(`${r.rapport.titre} ${r.rapport.resume} ${r.tache} ${a?.nom ?? ""} ${a?.role ?? ""}`).includes(n);
    });
  }, [rapports, q, filtre]);

  const groups = useMemo(() => {
    const g = new Map<string, RapportItem[]>();
    for (const r of list) {
      const day = formatParis(r.at, "EEEE d MMMM");
      g.set(day, [...(g.get(day) ?? []), r]);
    }
    return [...g.entries()];
  }, [list]);

  const selected = id ? rapports[id] : undefined;

  if (id) {
    return (
      <RoutePanel title="Compte rendu" kicker="Rapports" icon="📄" accent="#c2930f" width={600}>
        <button type="button" onClick={() => router.push("/rapports")} className="mb-3 text-[13px] text-ink-soft hover:text-ink">
          ← Tous les comptes rendus
        </button>
        {selected ? <RapportView item={selected} /> : <p className="py-8 text-center text-sm text-ink-soft">Ce compte rendu n&apos;est pas (encore) chargé.</p>}
      </RoutePanel>
    );
  }

  return (
    <RoutePanel title="Rapports" kicker="Comptes rendus des agents" icon="📄" accent="#c2930f" width={520}>
      <div className="flex gap-2">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher (agent, sujet…)" aria-label="Chercher un compte rendu" />
      </div>
      <div className="mt-2 flex gap-1 rounded-full bg-ink/5 p-1">
        {(
          [
            ["tous", "Tous"],
            ["syntheses", "Synthèses de mission"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFiltre(k)} className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium ${filtre === k ? "bg-white shadow-sm" : "text-ink-soft"}`}>
            {label}
          </button>
        ))}
      </div>

      {groups.map(([day, items]) => (
        <section key={day} className="mt-4">
          <h4 className="mb-1.5 font-silk text-[10px] tracking-wider text-ink-soft uppercase">{day}</h4>
          <ul className="space-y-2">
            {items.map((r) => {
              const a = agentById(r.agentId);
              const synthese = !!r.missionId && !r.parentId;
              const mission = r.missionId ? missions.find((m) => m.id === r.missionId) : undefined;
              return (
                <li key={r.taskId}>
                  <button
                    type="button"
                    onClick={() => router.push(`/rapports?id=${encodeURIComponent(r.taskId)}`)}
                    className={`w-full rounded-2xl border p-3 text-left transition hover:bg-white ${synthese ? "border-amber-300 bg-amber-50/70" : "border-paper-edge bg-white/60"}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Portrait agentId={r.agentId} size={1.25} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] leading-snug font-semibold">
                          {synthese && <span className="mr-1 rounded-full bg-amber-200 px-1.5 py-px align-middle text-[10px] font-bold">SYNTHÈSE</span>}
                          {r.rapport.titre}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-ink-soft">{r.rapport.resume}</span>
                        <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-soft">
                          <span>
                            {a?.nom} · {poleById(a?.pole ?? "")?.court} · {formatParis(r.at, "HH:mm")}
                          </span>
                          {!!r.rapport.fichiers?.length && <span>📎 {r.rapport.fichiers.length} fichier{r.rapport.fichiers.length > 1 ? "s" : ""}</span>}
                          {mission && !synthese && <span className="truncate">🎯 {mission.text.slice(0, 40)}</span>}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!list.length && (
        <p className="py-10 text-center text-sm text-ink-soft">
          {q ? "Aucun compte rendu ne correspond." : "Pas encore de compte rendu. Donne une mission à Marius dans la barre du bas : chaque agent rendra le sien ici."}
        </p>
      )}
    </RoutePanel>
  );
}
