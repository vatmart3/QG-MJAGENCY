import { icone } from "@/lib/icone";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Icône de l'écran d'accueil sur iPhone (iOS arrondit lui-même les coins). */
export default function AppleIcon() {
  return icone(180, 0.1, false);
}
