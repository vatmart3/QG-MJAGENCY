"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { useIsMobile } from "./hooks";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: ReactNode;
  accent?: string;
  icon?: ReactNode;
  children: ReactNode;
  side?: "right" | "left";
  width?: number;
  tilt?: number;
  footer?: ReactNode;
}

/**
 * Fiche papier légèrement inclinée qui glisse depuis le bord (desktop)
 * ou bottom sheet qu'on peut descendre au doigt (mobile).
 */
export function Sheet({ open, onClose, title, kicker, accent = "#2a2140", icon, children, side = "right", width = 420, tilt = 0.6, footer }: SheetProps) {
  const mobile = useIsMobile();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const header = (
    <header className="relative flex items-start gap-3 px-5 pt-5 pb-3">
      {icon && (
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in srgb, ${accent} 16%, white)` }}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {kicker && <div className="font-silk text-[10px] uppercase tracking-wider" style={{ color: accent }}>{kicker}</div>}
        <h2 className="truncate text-xl font-bold leading-tight">{title}</h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink active:scale-95"
        aria-label="Fermer"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );

  if (mobile) {
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet-m"
            className="paper fixed inset-x-0 bottom-0 z-40 flex max-h-[80dvh] flex-col rounded-t-[28px] pb-[env(safe-area-inset-bottom)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info: PanInfo) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/20" />
            {header}
            <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 pb-6" onPointerDownCapture={(e) => e.stopPropagation()}>
              {children}
            </div>
            {footer && <div className="border-t border-paper-edge px-4 py-3">{footer}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const from = side === "right" ? 60 : -60;
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="sheet-d"
          className="paper fixed top-[84px] bottom-[112px] z-40 flex flex-col rounded-[22px]"
          style={{ width, [side]: 18 }}
          initial={{ x: from, opacity: 0, rotate: side === "right" ? 2.4 : -2.4 }}
          animate={{ x: 0, opacity: 1, rotate: side === "right" ? tilt : -tilt }}
          exit={{ x: from, opacity: 0, rotate: side === "right" ? 2.4 : -2.4 }}
          transition={{ type: "spring", damping: 26, stiffness: 260 }}
        >
          <div className="tape" />
          {header}
          <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="border-t border-paper-edge px-4 py-3">{footer}</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center justify-between">
      <h3 className="font-silk text-[10px] uppercase tracking-wider text-ink-soft">{children}</h3>
      {right}
    </div>
  );
}

export function DemoBadge() {
  return <span className="rounded-full bg-phare/10 px-2 py-0.5 font-silk text-[9px] text-phare">DÉMO</span>;
}
