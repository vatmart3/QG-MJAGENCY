"use client";

import { createStore, useStore } from "zustand";

/** Notifications à l'écran (en haut à droite) : mail reçu, réponse envoyée, Douane, alertes, missions… */
export type ToastKind = "mail" | "envoi" | "douane" | "alerte" | "mission" | "fete" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  titre: string;
  texte?: string;
  agentId?: string | null;
  href?: string;
  at: number;
}

interface ToastState {
  toasts: Toast[];
}

export const toastStore = createStore<ToastState>(() => ({ toasts: [] }));
export const useToasts = <T,>(sel: (s: ToastState) => T): T => useStore(toastStore, sel);

let seq = 0;
const vus = new Set<string>();

/** Affiche une notification (une clé déjà vue n'est jamais réaffichée). */
export function toast(t: Omit<Toast, "id" | "at">, cle?: string): void {
  if (cle) {
    if (vus.has(cle)) return;
    vus.add(cle);
    if (vus.size > 500) vus.clear();
  }
  const item: Toast = { ...t, id: `t${Date.now().toString(36)}${seq++}`, at: Date.now() };
  toastStore.setState((s) => ({ toasts: [item, ...s.toasts].slice(0, 5) }));
}

export function fermerToast(id: string): void {
  toastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
