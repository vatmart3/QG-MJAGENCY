"use client";

import { useUI } from "@/store/ui";
import { useState } from "react";
import { slugify, useCatalog } from "@/data/catalog";
import { getRepo } from "@/data/repo";
import type { Routine } from "@/data/types";
import { firstError, routineSchema } from "@/lib/schemas";
import { Field, ListRow, SaveBar, Toggle, inputCls, useSaver } from "./fields";

const JOURS = ["L", "M", "M", "J", "V", "S", "D"];

export function horaire(r: Routine): string {
  const jours = r.jours.length ? r.jours.map((j) => ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"][j - 1]).join(", ") : "tous les jours";
  const quand = r.mode === "intervalle" ? `toutes les ${r.intervalleMinutes} min (${r.plageDebut}–${r.plageFin})` : r.heure;
  if (r.jourDuMois) return `le ${r.jourDuMois === 1 ? "1er" : r.jourDuMois} du mois à ${r.heure}`;
  return `${quand} · ${jours}`;
}

const blank = (agentId: string): Routine => ({
  id: "",
  nom: "",
  agentId,
  mode: "fixe",
  heure: "09:00",
  intervalleMinutes: 30,
  plageDebut: "08:00",
  plageFin: "20:00",
  jours: [1, 2, 3, 4, 5],
  jourDuMois: null,
  promptTache: "",
  actif: true,
});

export function RoutinesTab() {
  const routines = useCatalog((s) => s.routines);
  const agents = useCatalog((s) => s.agents);
  const live = useUI((s) => s.conn) !== "demo";
  const [editing, setEditing] = useState<{ draft: Routine; isNew: boolean } | null>(null);

  if (editing) return <RoutineForm key={editing.draft.id || "nouvelle"} initial={editing.draft} isNew={editing.isNew} onDone={() => setEditing(null)} />;

  const sorted = [...routines].sort((a, b) => (a.mode === "intervalle" ? "00:00" : a.heure).localeCompare(b.mode === "intervalle" ? "00:00" : b.heure));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-ink-soft">Fuseau Europe/Paris · actives = automatiques ; ▶ pour lancer quand tu veux</p>
        <button type="button" onClick={() => setEditing({ draft: blank(agents[0]?.id ?? ""), isNew: true })} className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white">
          + Routine
        </button>
      </div>
      <div className="space-y-0.5">
        {sorted.map((r) => (
          <div key={r.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <ListRow onClick={() => setEditing({ draft: r, isNew: false })}>
                <span className={`min-w-0 flex-1 ${r.actif ? "" : "opacity-60"}`}>
                  <span className="block truncate font-medium">{r.nom}</span>
                  <span className="block truncate text-[11px] opacity-70">
                    {agents.find((a) => a.id === r.agentId)?.nom ?? "—"} · {r.id === "rt_nuit" ? `de ${r.plageDebut} à ${r.plageFin} · Lucie et Jade de garde` : PLUS_TARD[r.id] ? `arrive en phase ${PLUS_TARD[r.id]}` : r.actif ? horaire(r) : "à la demande"}
                  </span>
                </span>
              </ListRow>
            </div>
            {live && !PLUS_TARD[r.id] && r.id !== "rt_nuit" && <LaunchButton id={r.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutineForm({ initial, isNew, onDone }: { initial: Routine; isNew: boolean; onDone: () => void }) {
  const [r, setR] = useState<Routine>(initial);
  const agents = useCatalog((s) => s.agents).filter((a) => a.actif);
  const routines = useCatalog((s) => s.routines);
  const saver = useSaver();
  const set = <K extends keyof Routine>(k: K, v: Routine[K]) => setR((x) => ({ ...x, [k]: v }));

  const save = () => {
    const draft: Routine = { ...r, id: isNew ? `rt_${slugify(r.nom).replace(/-/g, "_")}`.slice(0, 60) : r.id };
    const parsed = routineSchema.safeParse(draft);
    if (!parsed.success) return saver.fail(firstError(parsed.error));
    if (isNew && routines.some((x) => x.id === draft.id)) return saver.fail("Une routine porte déjà ce nom.");
    void saver.run(async () => {
      await getRepo().saveRoutine(draft);
      if (isNew) onDone();
    });
  };
  const remove = () => {
    if (!window.confirm(`Supprimer la routine « ${r.nom} » ?`)) return;
    void saver.run(async () => {
      await getRepo().deleteRoutine(r.id);
      onDone();
    }, "Supprimée");
  };

  return (
    <div>
      <button type="button" onClick={onDone} className="mb-3 text-sm text-sea">
        ← Toutes les routines
      </button>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom">
            <input className={inputCls} value={r.nom} onChange={(e) => set("nom", e.target.value)} maxLength={120} />
          </Field>
          <Field label="Agent">
            <select className={inputCls} value={r.agentId} onChange={(e) => set("agentId", e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom} — {a.role}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-1 rounded-full bg-ink/5 p-1">
          {(["fixe", "intervalle"] as const).map((m) => (
            <button key={m} type="button" onClick={() => set("mode", m)} className={`flex-1 rounded-full px-3 py-1.5 text-[13px] ${r.mode === m ? "bg-white shadow-sm" : "text-ink-soft"}`}>
              {m === "fixe" ? "À heure fixe" : "À intervalle"}
            </button>
          ))}
        </div>
        {r.mode === "fixe" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heure">
              <input type="time" className={inputCls} value={r.heure} onChange={(e) => set("heure", e.target.value)} />
            </Field>
            <Field label="Jour du mois (option)" hint="Ex. 1 = le 1er du mois">
              <input
                type="number"
                min={1}
                max={28}
                className={inputCls}
                value={r.jourDuMois ?? ""}
                onChange={(e) => set("jourDuMois", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Toutes les (min)">
              <input type="number" min={5} max={1440} className={inputCls} value={r.intervalleMinutes} onChange={(e) => set("intervalleMinutes", Number(e.target.value))} />
            </Field>
            <Field label="De">
              <input type="time" className={inputCls} value={r.plageDebut} onChange={(e) => set("plageDebut", e.target.value)} />
            </Field>
            <Field label="À">
              <input type="time" className={inputCls} value={r.plageFin} onChange={(e) => set("plageFin", e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Jours" hint="Aucun jour coché = tous les jours">
          <div className="flex gap-1">
            {JOURS.map((j, i) => {
              const d = i + 1;
              const on = r.jours.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set("jours", on ? r.jours.filter((x) => x !== d) : [...r.jours, d].sort())}
                  className={`size-9 rounded-full text-[13px] font-medium ${on ? "bg-ink text-white" : "bg-ink/6 text-ink-soft"}`}
                  aria-pressed={on}
                >
                  {j}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Ce que l'agent doit faire">
          <textarea className={inputCls} rows={4} value={r.promptTache} onChange={(e) => set("promptTache", e.target.value)} />
        </Field>
        <Toggle checked={r.actif} onChange={(v) => set("actif", v)} label="Active" />
      </div>
      <SaveBar saver={saver} onSave={save} onCancel={onDone} onDelete={isNew ? undefined : remove} />
    </div>
  );
}

/** routines qui attendent les outils d'une phase suivante (même liste que le moteur) */
const PLUS_TARD: Record<string, number> = { rt_sante_sites: 8, rt_echues: 6, rt_leads: 7, rt_relances_devis: 7, rt_cloture: 6 };

/** ▶ Lancer maintenant (le compte rendu arrive dans l'onglet Rapports). */
function LaunchButton({ id }: { id: string }) {
  const [etat, setEtat] = useState<"idle" | "envoi" | "ok" | "rien" | "erreur">("idle");
  const [msg, setMsg] = useState("");
  const go = async () => {
    setEtat("envoi");
    try {
      const res = await fetch(`/api/routines/${encodeURIComponent(id)}/run`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setEtat(data.ok ? "ok" : "rien");
      setMsg(data.message ?? "");
      if (data.ok) void import("@/sync/live").then(({ kickEngine }) => kickEngine());
    } catch (e) {
      setEtat("erreur");
      setMsg(e instanceof Error ? e.message : "Erreur");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={etat === "envoi"}
      title={msg || "Lancer maintenant"}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${etat === "ok" ? "bg-moss/15 text-moss" : etat === "erreur" ? "bg-phare/10 text-phare" : "border border-ink/15 hover:bg-white"}`}
    >
      {etat === "envoi" ? "…" : etat === "ok" ? "✓ Lancé" : etat === "rien" ? "Rien à faire" : etat === "erreur" ? "Erreur" : "▶ Lancer"}
    </button>
  );
}
