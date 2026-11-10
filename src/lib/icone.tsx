import { ImageResponse } from "next/og";

/**
 * Icône de LE PORT dessinée en code (pixel art, aucun fichier) : un phare sur la mer, ciel lilas.
 * `marge` : part laissée autour du dessin (0,2 pour les icônes « maskable » d'Android).
 */
const PIXELS = [
  "................",
  "......DDDD......",
  ".....DYYYYD.....",
  ".....DYYYYD.....",
  "....DDDDDDDD....",
  "......RRRR......",
  "......WWWW......",
  "......RRRR......",
  ".....WWWWWW.....",
  ".....RRRRRR.....",
  ".....WWWWWW.....",
  "....RRRRRRRR....",
  "...DDDDDDDDDD...",
  "LLBBBBBBBBBBBBLL",
  "BBBLLBBBBBLLBBBB",
  "BBBBBBBBBBBBBBBB",
];
const COULEURS: Record<string, string> = { D: "#1d1b33", Y: "#ffd34d", R: "#e2574c", W: "#fbf7ee", B: "#3a5fd0", L: "#8fb3ff" };

export function icone(taille: number, marge = 0.08, arrondi = true): ImageResponse {
  const zone = Math.round(taille * (1 - 2 * marge));
  const px = zone / 16;
  const off = (taille - zone) / 2;
  const cases = PIXELS.flatMap((ligne, y) =>
    [...ligne].map((c, x) =>
      c === "." ? null : <div key={`${x}-${y}`} style={{ position: "absolute", left: off + x * px, top: off + y * px, width: Math.ceil(px), height: Math.ceil(px), background: COULEURS[c] }} />,
    ),
  );
  return new ImageResponse(
    (
      <div style={{ width: taille, height: taille, display: "flex", position: "relative", backgroundImage: "linear-gradient(180deg, #c9c5ff 0%, #b7b3f2 55%, #9fb6f5 100%)", borderRadius: arrondi ? taille * 0.22 : 0 }}>
        {/* faisceau du phare */}
        <div style={{ position: "absolute", left: off + 10 * px, top: off + 1.6 * px, width: 6 * px, height: 1.6 * px, background: "rgba(255, 230, 140, 0.55)", borderRadius: px }} />
        <div style={{ position: "absolute", left: off, top: off + 1.6 * px, width: 6 * px, height: 1.6 * px, background: "rgba(255, 230, 140, 0.55)", borderRadius: px }} />
        {cases}
      </div>
    ),
    { width: taille, height: taille },
  );
}
