import type { MetadataRoute } from "next";

/** LE PORT installable sur téléphone (« Ajouter à l'écran d'accueil »). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LE PORT — QG IA de MJAGENCY",
    short_name: "LE PORT",
    description: "Le quartier général IA de MJAGENCY : la ville où travaillent les agents de l'agence.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#b7b3f2",
    theme_color: "#b7b3f2",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "La Douane", short_name: "Douane", url: "/douane" },
      { name: "Journal", url: "/journal" },
      { name: "Atelier", url: "/atelier" },
    ],
  };
}
