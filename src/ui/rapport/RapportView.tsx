"use client";

import { useState } from "react";
import { agentById, poleById } from "@/data/catalog";
import { mdToHtml, nomFichier } from "@/lib/rapport";
import { formatParis } from "@/lib/paris";
import { useWorld, type RapportItem } from "@/store/world";
import { Portrait } from "../Portrait";
import { downloadFichier, downloadMarkdown, downloadZip, printPdf } from "./download";

const FICHIER_ICON = { md: "📝", txt: "📄", csv: "📊", html: "🌐", json: "🧾" } as const;

/** Lecture d'un compte rendu, rangé, avec ses fichiers à télécharger. */
export function RapportView({ item }: { item: RapportItem }) {
  const r = item.rapport;
  const a = agentById(item.agentId);
  const pole = poleById(a?.pole ?? "");
  const mission = useWorld((s) => (item.missionId ? s.missions.find((m) => m.id === item.missionId) : undefined));
  const [ouvert, setOuvert] = useState<string | null>(null);
  const btn = "rounded-full border border-ink/15 bg-white/70 px-3 py-1.5 text-[13px] font-medium transition hover:bg-white active:scale-95";

  return (
    <article className="space-y-4">
      <header className="rounded-2xl border border-paper-edge bg-white/70 p-4">
        <div className="flex items-center gap-3">
          <Portrait agentId={item.agentId} size={1.6} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-soft">
              {a?.nom ?? item.agentId} · {a?.role} {pole && <span style={{ color: pole.couleur }}>· {pole.court}</span>}
            </p>
            <p className="text-[12px] text-ink-soft">{formatParis(item.at, "EEEE d MMMM · HH:mm")}</p>
          </div>
        </div>
        <h3 className="mt-3 text-lg leading-snug font-bold">{r.titre}</h3>
        {mission && <p className="mt-1 text-[12px] text-ink-soft">🎯 Mission : {mission.text}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className={`${btn} !bg-ink !text-white`} onClick={() => printPdf(item)}>
            ⬇️ PDF
          </button>
          <button type="button" className={btn} onClick={() => downloadZip(item)} title="Compte rendu + fichiers joints">
            🗜️ Tout (.zip)
          </button>
          <button type="button" className={btn} onClick={() => downloadMarkdown(item)}>
            📝 .md
          </button>
        </div>
      </header>

      <section>
        <h4 className="mb-1.5 font-silk text-[10px] tracking-wider text-ink-soft uppercase">Résumé</h4>
        <p className="rounded-r-xl border-l-4 border-moss bg-moss/8 px-3 py-2 text-[14px] leading-relaxed">{r.resume}</p>
      </section>

      {!!r.points_cles?.length && (
        <section>
          <h4 className="mb-1.5 font-silk text-[10px] tracking-wider text-ink-soft uppercase">Points clés</h4>
          <ul className="space-y-1">
            {r.points_cles.map((p, i) => (
              <li key={i} className="flex gap-2 text-[14px]">
                <span className="text-moss">✓</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.sections.map((s, i) => (
        <section key={i}>
          <h4 className="mb-1.5 border-b-2 border-ink pb-1 text-[15px] font-bold">{s.titre}</h4>
          <div className="rapport-md" dangerouslySetInnerHTML={{ __html: mdToHtml(s.contenu) }} />
        </section>
      ))}

      {!!r.prochaines_etapes?.length && (
        <section>
          <h4 className="mb-1.5 border-b-2 border-ink pb-1 text-[15px] font-bold">Prochaines étapes</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left font-silk text-[9px] tracking-wider text-ink-soft uppercase">
                  <th className="py-1.5 pr-2">Action</th>
                  <th className="py-1.5 pr-2">Qui</th>
                  <th className="py-1.5">Quand</th>
                </tr>
              </thead>
              <tbody>
                {r.prochaines_etapes.map((e, i) => (
                  <tr key={i} className="border-t border-paper-edge align-top">
                    <td className="py-1.5 pr-2">{e.action}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{e.qui ?? "—"}</td>
                    <td className="py-1.5 whitespace-nowrap text-ink-soft">{e.echeance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!!r.fichiers?.length && (
        <section>
          <h4 className="mb-1.5 border-b-2 border-ink pb-1 text-[15px] font-bold">Fichiers joints</h4>
          <ul className="space-y-1.5">
            {r.fichiers.map((f, i) => {
              const key = `${i}-${f.nom}`;
              return (
                <li key={key} className="rounded-xl border border-paper-edge bg-white/70">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="text-lg">{FICHIER_ICON[f.type]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{nomFichier(f.nom, f.type)}</span>
                      {f.description && <span className="block truncate text-[11px] text-ink-soft">{f.description}</span>}
                    </span>
                    <button type="button" className="text-[12px] text-ink-soft underline-offset-2 hover:underline" onClick={() => setOuvert(ouvert === key ? null : key)}>
                      {ouvert === key ? "Masquer" : "Aperçu"}
                    </button>
                    <button type="button" className={btn} onClick={() => downloadFichier(f)} aria-label={`Télécharger ${f.nom}`}>
                      ⬇️
                    </button>
                  </div>
                  {ouvert === key &&
                    (f.type === "md" ? (
                      <div className="rapport-md max-h-80 overflow-auto border-t border-paper-edge px-3 py-2" dangerouslySetInnerHTML={{ __html: mdToHtml(f.contenu) }} />
                    ) : (
                      <pre className="max-h-80 overflow-auto border-t border-paper-edge px-3 py-2 text-[11px] whitespace-pre-wrap">{f.contenu}</pre>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
