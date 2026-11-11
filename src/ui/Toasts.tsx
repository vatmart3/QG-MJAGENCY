"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { agentById } from "@/data/catalog";
import { fermerToast, toastStore, useToasts, type ToastKind } from "@/store/toasts";
import { Portrait } from "./Portrait";
import { jouer } from "./sons";

const STYLE: Record<ToastKind, { icone: string; bord: string; fond: string }> = {
  mail: { icone: "📬", bord: "#3a7bd5", fond: "#eaf2fd" },
  envoi: { icone: "✉️", bord: "#2e9d62", fond: "#e6f5ec" },
  douane: { icone: "🛂", bord: "#d8433a", fond: "#fdecea" },
  alerte: { icone: "⚠️", bord: "#e0812c", fond: "#fff2e3" },
  mission: { icone: "🎯", bord: "#7c5cd6", fond: "#f1ecfd" },
  fete: { icone: "🎉", bord: "#c2930f", fond: "#fdf6dc" },
  info: { icone: "⚓", bord: "#2a2140", fond: "#f6f3ee" },
};
const DUREE = 7000;

/** Notifications du port en haut à droite : « Vous avez reçu un mail », réponse envoyée, Douane, alertes… */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const router = useRouter();

  // fermeture automatique
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      for (const x of toastStore.getState().toasts) if (now - x.at > DUREE) fermerToast(x.id);
    }, 500);
    return () => clearInterval(t);
  }, []);
  // un petit son à l'arrivée (désactivable dans Réglages)
  const dernier = toasts[0]?.id;
  const kind = toasts[0]?.kind;
  useEffect(() => {
    if (!dernier || !kind) return;
    jouer(kind === "douane" || kind === "mail" ? "douane" : kind === "alerte" ? "alerte" : kind === "fete" ? "fete" : "clic");
  }, [dernier, kind]);

  return (
    <div className="pointer-events-none fixed top-[68px] right-3 z-[60] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const st = STYLE[t.kind];
          const agent = t.agentId ? agentById(t.agentId) : null;
          return (
            <motion.button
              key={t.id}
              type="button"
              layout
              initial={{ opacity: 0, x: 60, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              onClick={() => {
                fermerToast(t.id);
                if (t.href) router.push(t.href);
              }}
              className="pointer-events-auto flex w-full items-start gap-2.5 rounded-2xl border-l-4 px-3 py-2.5 text-left shadow-lg backdrop-blur"
              style={{ borderColor: st.bord, background: `${st.fond}f2` }}
            >
              <span className="relative mt-0.5 shrink-0">
                {agent ? <Portrait agentId={agent.id} size={1.6} /> : <span className="text-xl">{st.icone}</span>}
                {agent && <span className="absolute -right-2 -bottom-1 text-sm">{st.icone}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-tight font-semibold text-ink">{t.titre}</span>
                {t.texte && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-soft">{t.texte}</span>}
              </span>
              <motion.span className="absolute bottom-0 left-0 h-[3px] rounded-full" style={{ background: st.bord }} initial={{ width: "100%" }} animate={{ width: "0%" }} transition={{ duration: DUREE / 1000, ease: "linear" }} />
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
