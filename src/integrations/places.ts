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
  kind: "google" | "osm" | "demo";
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

// ------------------------------------------------------------------ OpenStreetMap (gratuit, sans clé)
/**
 * Commerces trouvés dans OpenStreetMap (données libres, © les contributeurs d'OpenStreetMap, licence ODbL) via
 * l'API Overpass : nom, adresse, et souvent site, téléphone, e-mail, Instagram. Pas de note ni d'avis Google.
 */
const OSM_METIERS: { cles: string[]; label: string; filtres: string[] }[] = [
  { cles: ["restaurant", "resto", "brasserie"], label: "Restaurant", filtres: ['["amenity"="restaurant"]'] },
  { cles: ["boulangerie", "patisserie", "pâtisserie"], label: "Boulangerie", filtres: ['["shop"~"^(bakery|pastry)$"]'] },
  { cles: ["coiffeur", "coiffure", "barbier"], label: "Coiffeur", filtres: ['["shop"="hairdresser"]'] },
  { cles: ["institut", "beaute", "beauté", "esthetique", "esthétique", "onglerie"], label: "Institut de beauté", filtres: ['["shop"~"^(beauty|cosmetics|nails)$"]'] },
  { cles: ["fleuriste", "fleurs"], label: "Fleuriste", filtres: ['["shop"="florist"]'] },
  { cles: ["garage", "automobile", "mecanique", "mécanique"], label: "Garage automobile", filtres: ['["shop"~"^(car_repair|car|tyres)$"]'] },
  { cles: ["artisan", "batiment", "bâtiment", "plombier", "electricien", "électricien", "maçon", "macon", "menuisier"], label: "Artisan du bâtiment", filtres: ['["craft"~"^(builder|electrician|plumber|carpenter|painter|roofer|tiler|hvac|stonemason|glaziery|window_construction)$"]'] },
  { cles: ["caviste", "cave", "vin"], label: "Caviste", filtres: ['["shop"~"^(wine|alcohol)$"]'] },
  { cles: ["vetement", "vêtement", "mode", "boutique"], label: "Boutique de vêtements", filtres: ['["shop"~"^(clothes|boutique|shoes)$"]'] },
  { cles: ["sport", "fitness", "salle"], label: "Salle de sport", filtres: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]'] },
  { cles: ["bar", "cafe", "café"], label: "Bar / café", filtres: ['["amenity"~"^(bar|cafe|pub)$"]'] },
  { cles: ["hotel", "hôtel", "gite", "gîte", "chambre"], label: "Hébergement", filtres: ['["tourism"~"^(hotel|guest_house|apartment)$"]'] },
  { cles: ["immobilier", "agence immobiliere"], label: "Agence immobilière", filtres: ['["office"="estate_agent"]', '["shop"="estate_agent"]'] },
  { cles: ["opticien", "optique"], label: "Opticien", filtres: ['["shop"="optician"]'] },
  { cles: ["traiteur", "poissonnerie", "boucherie", "fromagerie", "epicerie", "épicerie"], label: "Commerce de bouche", filtres: ['["shop"~"^(deli|seafood|butcher|cheese|greengrocer|convenience|pastry)$"]'] },
];

const sansAcc = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const echapper = (s: string) => s.replace(/["\\]/g, " ").trim();

/** « boulangerie à Sète » → métier + commune. */
export function decouperRequete(q: string): { metier: string; zone: string | null } {
  const m = q.match(/^(.*?)\s+(?:à|a|sur|dans|en)\s+(.+)$/i);
  return m ? { metier: m[1]!.trim(), zone: m[2]!.trim() } : { metier: q.trim(), zone: null };
}

export function requeteOverpass(q: string, max: number): { ql: string; label: string } {
  const { metier, zone } = decouperRequete(q);
  const n = sansAcc(metier);
  const def = OSM_METIERS.find((d) => d.cles.some((c) => n.includes(sansAcc(c))));
  const z = echapper(zone ?? "Sète");
  const zoneQl = `area["name"="${z}"]["boundary"="administrative"]["admin_level"="8"]->.a;`;
  const corps = def
    ? def.filtres.map((f) => `nwr${f}["name"](area.a);`).join("")
    : `nwr["shop"]["name"~"${echapper(metier)}",i](area.a);nwr["amenity"]["name"~"${echapper(metier)}",i](area.a);nwr["craft"]["name"~"${echapper(metier)}",i](area.a);`;
  return { ql: `[out:json][timeout:12];${zoneQl}(${corps});out center tags ${Math.max(20, max * 4)};`, label: def?.label ?? metier };
}

interface OsmEl {
  type: string;
  id: number;
  tags?: Record<string, string>;
}

const httpUrl = (u?: string) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`) : undefined);
const insta = (v?: string) => v?.match(/instagram\.com\/([a-z0-9._]{2,30})/i)?.[1] ?? (v && /^@?[a-z0-9._]{2,30}$/i.test(v) ? v.replace(/^@/, "") : undefined);

export function placesDepuisOsm(els: OsmEl[], label: string, zone: string | null, max: number): Place[] {
  const out: Place[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (!t.name || t["disused:shop"] || t["abandoned:shop"]) continue;
    const ville = t["addr:city"] ?? zone ?? undefined;
    const rue = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    out.push({
      place_id: `osm:${e.type}/${e.id}`,
      nom: t.name,
      adresse: [rue, [t["addr:postcode"], ville].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      ville,
      telephone: t.phone ?? t["contact:phone"] ?? t["contact:mobile"],
      site: httpUrl(t.website ?? t["contact:website"] ?? t.url),
      email: (t.email ?? t["contact:email"])?.toLowerCase(),
      instagram: insta(t["contact:instagram"] ?? t.instagram),
      maps_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      metier: label,
    });
  }
  // d'abord ceux qu'on peut joindre (e-mail, puis site, puis téléphone)
  const rang = (p: Place) => (p.email ? 0 : p.site ? 1 : p.telephone ? 2 : 3);
  return out.sort((a, b) => rang(a) - rang(b)).slice(0, max);
}

const OVERPASS = (process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter").split(",");

export function osmPlaces(): Places {
  return {
    kind: "osm",
    async search(query, max) {
      const { ql, label } = requeteOverpass(query, max);
      let derniere: unknown;
      for (const url of OVERPASS) {
        try {
          const res = await fetch(url.trim(), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "LE-PORT-MJAGENCY/1.0 (prospection locale)" },
            body: new URLSearchParams({ data: ql }),
            signal: AbortSignal.timeout(13_000),
          });
          if (!res.ok) throw new Error(`OpenStreetMap : HTTP ${res.status}${res.status === 429 ? " (trop de demandes, réessaie dans une minute)" : res.status === 504 ? " (serveur surchargé)" : ""}`);
          const j = (await res.json()) as { elements?: OsmEl[] };
          return placesDepuisOsm(j.elements ?? [], label, decouperRequete(query).zone, Math.min(20, max));
        } catch (e) {
          derniere = e;
        }
      }
      throw derniere instanceof Error ? new Error((derniere as Error).name === "TimeoutError" ? "OpenStreetMap ne répond pas (serveur lent)" : (derniere as Error).message) : new Error("OpenStreetMap ne répond pas.");
    },
  };
}
