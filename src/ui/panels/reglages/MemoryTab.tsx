"use client";

import { useState } from "react";
import { useCatalog } from "@/data/catalog";
import { getRepo } from "@/data/repo";
import type { MemoryEntry } from "@/data/types";
import { firstError, memorySchema } from "@/lib/schemas";
import { inputCls, useSaver } from "./fields";

/** Mémoire d'entreprise : ce que tous les agents savent de MJAGENCY (§10). */
export function MemoryTab() {
  const memory = useCatalog((s) => s.memory);
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <p className="mb-3 text-sm text-ink-soft">Lue par tous les agents à chaque tâche (avec mise en cache des prompts). Les agents peuvent proposer des mises à jour, qui passent par la Douane.</p>
      <div className="space-y-2">
        {memory.map((m) => (
          <MemoryCard key={m.id} entry={m} />
        ))}
        {adding ? (
          <MemoryCard entry={{ id: `mem_${Date.now().toString(36)}`, cle: "", contenu: "" }} isNew onDone={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="w-full rounded-2xl border-2 border-dashed border-paper-edge py-3 text-sm text-ink-soft hover:border-ink/20 hover:text-ink">
            + Ajouter une information
          </button>
        )}
      </div>
    </div>
  );
}

function MemoryCard({ entry, isNew, onDone }: { entry: MemoryEntry; isNew?: boolean; onDone?: () => void }) {
  const [m, setM] = useState(entry);
  const saver = useSaver();
  const dirty = isNew || m.cle !== entry.cle || m.contenu !== entry.contenu;

  const save = () => {
    const parsed = memorySchema.safeParse({ ...m, cle: m.cle.trim() });
    if (!parsed.success) return saver.fail(firstError(parsed.error));
    void saver.run(async () => {
      await getRepo().saveMemory(parsed.data);
      onDone?.();
    });
  };

  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-2.5">
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] font-semibold outline-none"
          value={m.cle}
          placeholder="cle_en_minuscules"
          onChange={(e) => setM({ ...m, cle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
          aria-label="Clé"
        />
        {!isNew && (
          <button
            type="button"
            onClick={() => window.confirm(`Supprimer « ${entry.cle} » ?`) && void saver.run(() => getRepo().deleteMemory(entry.id), "Supprimée")}
            className="text-[12px] text-phare/80 hover:text-phare"
          >
            Supprimer
          </button>
        )}
      </div>
      <textarea className={`${inputCls} mt-1.5`} rows={Math.min(6, Math.max(2, Math.ceil(m.contenu.length / 70)))} value={m.contenu} onChange={(e) => setM({ ...m, contenu: e.target.value })} aria-label={`Contenu de ${m.cle}`} />
      {(dirty || saver.message) && (
        <div className="mt-1.5 flex items-center gap-2">
          {dirty && (
            <button type="button" onClick={save} className="rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-white">
              Enregistrer
            </button>
          )}
          {isNew && (
            <button type="button" onClick={onDone} className="text-[12px] text-ink-soft">
              Annuler
            </button>
          )}
          {saver.message && <span className={`text-[12px] ${saver.status === "error" ? "text-phare" : "text-moss"}`}>{saver.message}</span>}
        </div>
      )}
    </div>
  );
}
