import { icone } from "@/lib/icone";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Icône de l'onglet du navigateur. */
export default function Icon() {
  return icone(64, 0.04);
}
