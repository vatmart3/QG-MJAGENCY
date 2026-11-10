"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet } from "../Sheet";

/** Fiche ouverte par un onglet de la barre haute (route), à gauche de l'écran. */
export function RoutePanel({ title, kicker, icon, accent, children, width = 460 }: { title: string; kicker?: string; icon?: string; accent?: string; children: ReactNode; width?: number }) {
  const router = useRouter();
  return (
    <Sheet open onClose={() => router.push("/")} title={title} kicker={kicker} icon={icon} accent={accent} side="left" width={width} tilt={0.5}>
      {children}
    </Sheet>
  );
}
