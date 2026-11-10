/**
 * Boutique MJ E-comm : Shopify Admin API (GraphQL). Deux façons de se connecter :
 *  - SHOPIFY_STORE_DOMAIN + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (application du Dev Dashboard, recommandé :
 *    jeton de 24 h obtenu automatiquement, « client credentials ») ;
 *  - SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN (ancienne application personnalisée créée dans l'admin, shpat_…).
 * Sans clés : boutique de DÉMONSTRATION (produits et commandes fictifs), clairement marquée.
 * LE PORT ne fait que lire ; toute modification (stock, prix, statut) passe par La Douane.
 */

export interface LigneCommande {
  titre: string;
  quantite: number;
}

export interface Commande {
  id: string;
  nom: string;
  cree_le: string;
  client: string | null;
  email: string | null;
  total: number;
  devise: string;
  paiement: string;
  expedition: string;
  annulee: boolean;
  articles: LigneCommande[];
  lien: string | null;
}

export interface Variante {
  id: string;
  titre: string;
  sku: string | null;
  prix: number;
  stock: number | null;
  inventory_item_id: string | null;
  suivi: boolean;
}

export interface Produit {
  id: string;
  titre: string;
  statut: "ACTIVE" | "DRAFT" | "ARCHIVED" | string;
  stock_total: number | null;
  variantes: Variante[];
  lien: string | null;
}

export type ModifBoutique =
  | { op: "stock"; inventory_item_id: string; quantite: number; avant: number | null; libelle: string }
  | { op: "prix"; produit_id: string; variante_id: string; prix: number; libelle: string }
  | { op: "statut"; produit_id: string; statut: "ACTIVE" | "DRAFT" | "ARCHIVED"; libelle: string };

export interface Boutique {
  kind: "shopify" | "demo";
  domaine: string | null;
  commandes(o: { depuis?: string; max: number; recherche?: string }): Promise<Commande[]>;
  produits(o: { max: number; recherche?: string }): Promise<Produit[]>;
  appliquer(m: ModifBoutique, cle: string): Promise<string>;
}

export const BOUTIQUE_DEFAUT = { seuil_stock: 3, delai_expedition_h: 48 };
export type ReglagesBoutique = typeof BOUTIQUE_DEFAUT;
export function lireBoutique(v: unknown): ReglagesBoutique {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ReglagesBoutique>;
  return {
    seuil_stock: Number.isFinite(o.seuil_stock) ? Math.max(0, Math.min(1000, Number(o.seuil_stock))) : BOUTIQUE_DEFAUT.seuil_stock,
    delai_expedition_h: Number.isFinite(o.delai_expedition_h) ? Math.max(6, Math.min(720, Number(o.delai_expedition_h))) : BOUTIQUE_DEFAUT.delai_expedition_h,
  };
}

const VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";
const domaineShop = (d: string) => d.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

// jeton « client credentials » mis en cache (24 h, renouvelé une heure avant)
let cache: { cle: string; jeton: string; expire: number } | null = null;

async function jeton(shop: string): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  const id = process.env.SHOPIFY_CLIENT_ID!;
  if (cache && cache.cle === `${shop}:${id}` && cache.expire > Date.now()) return cache.jeton;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: process.env.SHOPIFY_CLIENT_SECRET ?? "" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Shopify refuse la connexion (HTTP ${res.status}) : vérifie l'identifiant, le secret et que l'application est installée sur la boutique.`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cache = { cle: `${shop}:${id}`, jeton: j.access_token, expire: Date.now() + Math.max(600, (j.expires_in ?? 86399) - 3600) * 1000 };
  return j.access_token;
}

export function shopifyConfigure(): boolean {
  return !!process.env.SHOPIFY_STORE_DOMAIN && (!!process.env.SHOPIFY_ADMIN_TOKEN || (!!process.env.SHOPIFY_CLIENT_ID && !!process.env.SHOPIFY_CLIENT_SECRET));
}

export function boutiqueDepuisEnv(): Boutique {
  return shopifyConfigure() ? shopify(domaineShop(process.env.SHOPIFY_STORE_DOMAIN!)) : demoBoutique();
}

type Gql = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

function client(shop: string): Gql {
  return async <T,>(query: string, variables?: Record<string, unknown>) => {
    const res = await fetch(`https://${shop}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await jeton(shop) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) cache = null;
    if (!res.ok) throw new Error(`Shopify : HTTP ${res.status}`);
    const j = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (j.errors?.length) throw new Error(`Shopify : ${j.errors.map((e) => e.message).join(" ; ").slice(0, 300)}`);
    return j.data as T;
  };
}

const gid = (g: string) => g.split("/").pop() ?? g;
const filtre = (s: string) => s.replace(/["\\]/g, " ").trim();

interface GOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: { title: string; quantity: number }[] };
  email?: string | null;
  customer?: { displayName: string } | null;
}

export function shopify(shop: string): Boutique {
  const gql = client(shop);
  const admin = `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}`;
  let location: string | null = null;
  const commandesQ = (avecClient: boolean) => `query($q: String, $n: Int!) { orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
    id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 10) { nodes { title quantity } }
    ${avecClient ? "email customer { displayName }" : ""} } } }`;
  return {
    kind: "shopify",
    domaine: shop,
    async commandes(o) {
      const q = [o.depuis ? `created_at:>='${o.depuis}'` : "", o.recherche ? filtre(o.recherche) : ""].filter(Boolean).join(" ") || null;
      const vars = { q, n: Math.min(50, o.max) };
      // nom et e-mail du client : données protégées, l'application peut ne pas y avoir accès → on s'en passe
      const data = await gql<{ orders: { nodes: GOrder[] } }>(commandesQ(true), vars).catch(() => gql<{ orders: { nodes: GOrder[] } }>(commandesQ(false), vars));
      return data.orders.nodes.map((n) => ({
        id: n.id,
        nom: n.name,
        cree_le: n.createdAt,
        client: n.customer?.displayName ?? null,
        email: n.email ?? null,
        total: Number(n.totalPriceSet.shopMoney.amount),
        devise: n.totalPriceSet.shopMoney.currencyCode,
        paiement: n.displayFinancialStatus ?? "?",
        expedition: n.displayFulfillmentStatus,
        annulee: !!n.cancelledAt,
        articles: n.lineItems.nodes.map((l) => ({ titre: l.title, quantite: l.quantity })),
        lien: `${admin}/orders/${gid(n.id)}`,
      }));
    },
    async produits(o) {
      const data = await gql<{ products: { nodes: { id: string; title: string; status: string; totalInventory: number | null; variants: { nodes: { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null; inventoryItem: { id: string; tracked: boolean } | null }[] } }[] } }>(
        `query($q: String, $n: Int!) { products(first: $n, sortKey: UPDATED_AT, reverse: true, query: $q) { nodes {
          id title status totalInventory
          variants(first: 20) { nodes { id title sku price inventoryQuantity inventoryItem { id tracked } } } } } }`,
        { q: o.recherche ? filtre(o.recherche) : null, n: Math.min(100, o.max) },
      );
      return data.products.nodes.map((p) => ({
        id: p.id,
        titre: p.title,
        statut: p.status,
        stock_total: p.totalInventory,
        lien: `${admin}/products/${gid(p.id)}`,
        variantes: p.variants.nodes.map((v) => ({ id: v.id, titre: v.title, sku: v.sku, prix: Number(v.price), stock: v.inventoryQuantity, inventory_item_id: v.inventoryItem?.id ?? null, suivi: !!v.inventoryItem?.tracked })),
      }));
    },
    async appliquer(m, cle) {
      if (m.op === "stock") {
        if (!location) location = (await gql<{ locations: { nodes: { id: string }[] } }>("{ locations(first: 1) { nodes { id } } }")).locations.nodes[0]?.id ?? null;
        if (!location) throw new Error("Aucun entrepôt (location) dans la boutique.");
        const r = await gql<{ inventorySetQuantities: { userErrors: { message: string }[] } }>(
          `mutation($input: InventorySetQuantitiesInput!, $cle: String!) { inventorySetQuantities(input: $input) @idempotent(key: $cle) { userErrors { code message } } }`,
          { cle, input: { name: "available", reason: "correction", referenceDocumentUri: `leport://douane/${cle}`, quantities: [{ inventoryItemId: m.inventory_item_id, locationId: location, quantity: m.quantite, changeFromQuantity: m.avant }] } },
        );
        if (r.inventorySetQuantities.userErrors.length) throw new Error(r.inventorySetQuantities.userErrors.map((e) => e.message).join(" ; "));
        return `Stock de ${m.libelle} : ${m.avant ?? "?"} → ${m.quantite}`;
      }
      if (m.op === "prix") {
        const r = await gql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
          `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
          { p: m.produit_id, v: [{ id: m.variante_id, price: m.prix.toFixed(2) }] },
        );
        if (r.productVariantsBulkUpdate.userErrors.length) throw new Error(r.productVariantsBulkUpdate.userErrors.map((e) => e.message).join(" ; "));
        return `Prix de ${m.libelle} : ${m.prix.toFixed(2).replace(".", ",")} €`;
      }
      const r = await gql<{ productUpdate: { userErrors: { message: string }[] } }>(
        `mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }`,
        { p: { id: m.produit_id, status: m.statut } },
      );
      if (r.productUpdate.userErrors.length) throw new Error(r.productUpdate.userErrors.map((e) => e.message).join(" ; "));
      return `${m.libelle} : ${m.statut === "ACTIVE" ? "en ligne" : m.statut === "DRAFT" ? "brouillon (retiré de la vente)" : "archivé"}`;
    },
  };
}

// ------------------------------------------------------------------ démonstration
const DEMO_PRODUITS: [string, number, number][] = [
  ["Plaque NFC avis Google — comptoir", 39, 14],
  ["Chevalet NFC terrasse (lot de 5)", 149, 2],
  ["Carte de visite NFC bois", 29, 31],
  ["Stickers QR menu (x20)", 19, 0],
  ["Pack Lancement commerce", 249, 6],
];

export function demoBoutique(now = new Date()): Boutique {
  const h = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString();
  const produits: Produit[] = DEMO_PRODUITS.map(([titre, prix, stock], i) => ({
    id: `demo-p${i + 1}`,
    titre,
    statut: "ACTIVE",
    stock_total: stock,
    lien: null,
    variantes: [{ id: `demo-v${i + 1}`, titre: "Par défaut", sku: `MJ-${100 + i}`, prix, stock, inventory_item_id: `demo-i${i + 1}`, suivi: true }],
  }));
  const commandes: Commande[] = [
    { nom: "#1048", h: 3, client: "Camille R. (démo)", email: "camille@client.example", p: 0, q: 1, paiement: "PAID", exp: "UNFULFILLED" },
    { nom: "#1047", h: 20, client: "Le Bistrot du Quai (démo)", email: "contact@bistrot.example", p: 1, q: 1, paiement: "PAID", exp: "FULFILLED" },
    { nom: "#1046", h: 60, client: "Thomas B. (démo)", email: "thomas@client.example", p: 2, q: 3, paiement: "PAID", exp: "UNFULFILLED" },
    { nom: "#1045", h: 100, client: "Salon Éclat (démo)", email: "eclat@salon.example", p: 4, q: 1, paiement: "PAID", exp: "FULFILLED" },
  ].map((c) => ({
    id: `demo-o${c.nom.slice(1)}`,
    nom: c.nom,
    cree_le: h(c.h),
    client: c.client,
    email: c.email,
    total: DEMO_PRODUITS[c.p]![1] * c.q,
    devise: "EUR",
    paiement: c.paiement,
    expedition: c.exp,
    annulee: false,
    articles: [{ titre: DEMO_PRODUITS[c.p]![0], quantite: c.q }],
    lien: null,
  }));
  const cherche = (t: string, r?: string) => !r || t.toLowerCase().includes(r.toLowerCase());
  return {
    kind: "demo",
    domaine: null,
    async commandes(o) {
      return commandes.filter((c) => (!o.depuis || c.cree_le >= o.depuis) && (cherche(`${c.nom} ${c.client} ${c.email}`, o.recherche))).slice(0, o.max);
    },
    async produits(o) {
      return produits.filter((p) => cherche(p.titre, o.recherche)).slice(0, o.max);
    },
    async appliquer(m) {
      return `${m.libelle} : modification simulée (DÉMO, aucune boutique connectée)`;
    },
  };
}

export const statutFr = (s: string) =>
  ({ PAID: "payée", PENDING: "paiement en attente", REFUNDED: "remboursée", PARTIALLY_REFUNDED: "remboursée en partie", AUTHORIZED: "autorisée", VOIDED: "annulée", UNFULFILLED: "à expédier", FULFILLED: "expédiée", PARTIALLY_FULFILLED: "expédiée en partie", IN_PROGRESS: "en préparation", ON_HOLD: "en attente", SCHEDULED: "programmée" })[s] ?? s.toLowerCase();

export const euros = (n: number, devise = "EUR") => new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise }).format(n);
