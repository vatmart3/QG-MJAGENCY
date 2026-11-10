/**
 * Google Places API (New) — recherche de commerces locaux. Sans clé GOOGLE_PLACES_API_KEY : commerces
 * de DÉMONSTRATION (fictifs, domaines .example), clairement marqués.
 */

export interface Place {
  place_id: string;
  nom: string;
  adresse: string;
  ville?: string;
  telephone?: string;
  site?: string;
  note?: number;
  nb_avis?: number;
  maps_url?: string;
  metier?: string;
  ferme?: boolean;
  /** démo uniquement : coordonnées déjà connues */
  email?: string;
  instagram?: string;
  demo?: boolean;
}

export interface Places {
  kind: "google" | "demo";
  search(query: string, max: number): Promise<Place[]>;
}

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
].join(",");

interface GPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
}

export function googlePlaces(key: string): Places {
  return {
    kind: "google",
    async search(query, max) {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
        body: JSON.stringify({ textQuery: query, languageCode: "fr", regionCode: "FR", maxResultCount: Math.min(20, max) }),
      });
      const data = (await res.json().catch(() => ({}))) as { places?: GPlace[]; error?: { message?: string } };
      if (!res.ok) throw new Error(`Google Places : ${data.error?.message ?? res.status}`);
      return (data.places ?? []).map((p) => ({
        place_id: p.id,
        nom: p.displayName?.text ?? "?",
        adresse: p.formattedAddress ?? "",
        ville: p.addressComponents?.find((c) => c.types?.includes("locality"))?.longText,
        telephone: p.nationalPhoneNumber,
        site: p.websiteUri,
        note: p.rating,
        nb_avis: p.userRatingCount,
        maps_url: p.googleMapsUri,
        metier: p.primaryTypeDisplayName?.text,
        ferme: p.businessStatus === "CLOSED_PERMANENTLY" || p.businessStatus === "CLOSED_TEMPORARILY",
      }));
    },
  };
}

const DEMO: Place[] = [
  { place_id: "demo-pl-1", nom: "Le Fournil du Quai (DÉMO)", adresse: "12 quai de Bosc, 34200 Sète", ville: "Sète", telephone: "04 67 00 00 01", note: 4.7, nb_avis: 212, metier: "Boulangerie", email: "contact@fournil-du-quai.example", instagram: "fournilduquai" },
  { place_id: "demo-pl-2", nom: "La Marée (DÉMO)", adresse: "3 rue Gambetta, 34200 Sète", ville: "Sète", telephone: "04 67 00 00 02", site: "https://lamaree-sete.example", note: 4.3, nb_avis: 18, metier: "Restaurant", email: "bonjour@lamaree-sete.example", instagram: "lamaree.sete" },
  { place_id: "demo-pl-3", nom: "Coiffure Thau Style (DÉMO)", adresse: "8 avenue Victor Hugo, 34110 Frontignan", ville: "Frontignan", telephone: "04 67 00 00 03", note: 4.9, nb_avis: 47, metier: "Coiffeur", instagram: "thaustyle" },
  { place_id: "demo-pl-4", nom: "Garage du Pont-Levis (DÉMO)", adresse: "21 route de Montpellier, 34200 Sète", ville: "Sète", telephone: "04 67 00 00 04", site: "http://garage-pont-levis.example", note: 3.9, nb_avis: 9, metier: "Garage automobile", email: "garage-pont-levis@example.fr" },
  { place_id: "demo-pl-5", nom: "Fleurs de Balaruc (DÉMO)", adresse: "5 place du Mail, 34540 Balaruc-les-Bains", ville: "Balaruc-les-Bains", telephone: "04 67 00 00 05", note: 4.8, nb_avis: 96, metier: "Fleuriste", instagram: "fleursdebalaruc" },
  { place_id: "demo-pl-6", nom: "Cave du Port (DÉMO)", adresse: "1 quai Général Durand, 34200 Sète", ville: "Sète", telephone: "04 67 00 00 06", site: "https://cave-du-port.example", note: 4.6, nb_avis: 158, metier: "Caviste", email: "cave@cave-du-port.example" },
];

export function demoPlaces(): Places {
  return {
    kind: "demo",
    async search(query, max) {
      const q = query.toLowerCase();
      const hit = DEMO.filter((p) => q.includes((p.metier ?? "").toLowerCase().split(" ")[0]!) || q.includes((p.ville ?? "").toLowerCase()));
      return (hit.length ? hit : DEMO).slice(0, max).map((p) => ({ ...p, demo: true }));
    },
  };
}
