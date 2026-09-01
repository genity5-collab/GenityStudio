import { createClient } from "npm:@supabase/supabase-js@2";

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  "https://retrostudioencoderbeta.onrender.com",
  "https://retrostudioencoderdev.oneapp.dev",
  "http://localhost:5173",
]);

function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://retrostudioencoderbeta.onrender.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request) });
}

// ─── Catalog subcategories (catalog.roblox.com — wearables) ────────────────
const CATALOG_SUBCATEGORIES: Record<string, number> = {
  all: 1, faces: 10, heads: 15, hats: 9, hair: 20,
  gear: 5, accessories: 19, bundles: 37, animations: 27,
  shirts: 12, pants: 14, tshirts: 13,
};

// ─── Toolbox asset types (apis.roblox.com — raw assets: decals, meshes, etc.) ──
const TOOLBOX_ASSET_TYPES: Record<string, number> = {
  decals: 13,
  meshes: 4,
  images: 1,
  textures: 13, // decal-type textures
  audio: 3,
  models: 10,
  plugins: 19,
};

type CatalogAsset = {
  id: number;
  name: string;
  assetType?: number;
  itemType?: string;
  creatorName?: string;
  thumbnailUrl: string | null;
  rbxAssetId: string;
};

const CATALOG_URL = "https://catalog.roblox.com/v1/search/items/details";
const TOOLBOX_URL = "https://apis.roblox.com/toolbox-service/v1/marketplace";
const THUMBNAIL_URL = "https://thumbnails.roblox.com/v1/assets";
const REQUEST_TIMEOUT_MS = 7000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Search catalog (wearables: faces, hats, etc.) ──────────────────────────
async function searchCatalog(keyword: string, subcategoryKey: string, limit: number): Promise<CatalogAsset[]> {
  const subcategory = CATALOG_SUBCATEGORIES[subcategoryKey] ?? CATALOG_SUBCATEGORIES.all;
  const params = new URLSearchParams({
    Category: "1",
    Subcategory: String(subcategory),
    Keyword: keyword.slice(0, 100),
    Limit: String(Math.min(limit, 30)),
    SortType: "0",
  });
  try {
    const resp = await fetchWithTimeout(`${CATALOG_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const body = await resp.json();
    return Array.isArray(body?.data) ? body.data.map((item: Record<string, unknown>) => ({
      id: item.id as number,
      name: item.name as string,
      assetType: item.assetType as number | undefined,
      itemType: item.itemType as string | undefined,
      creatorName: item.creatorName as string | undefined,
      thumbnailUrl: null,
      rbxAssetId: `rbxassetid://${item.id}`,
    })) : [];
  } catch { return []; }
}

// ─── Search toolbox (raw assets: decals, meshes, images, etc.) ──────────────
async function searchToolbox(keyword: string, assetType: number, limit: number, apiKey?: string): Promise<CatalogAsset[]> {
  const params = new URLSearchParams({
    limit: String(Math.min(limit * 2, 50)),
    keyword: keyword.slice(0, 100),
  });
  const headers: Record<string, string> = { Accept: "application/json" };
  // Roblox Open Cloud API key — optional, improves rate limits
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const resp = await fetchWithTimeout(`${TOOLBOX_URL}/${assetType}?${params.toString()}`, { headers });
    if (!resp.ok) return [];
    const body = await resp.json();
    const items = Array.isArray(body?.data) ? body.data : [];
    return items.map((item: Record<string, unknown>) => ({
      id: item.asset?.id as number ?? item.id as number,
      name: (item.asset?.name as string) ?? (item.name as string) ?? "Unknown",
      assetType: assetType,
      itemType: "Asset",
      creatorName: (item.creator?.name as string) ?? (item.creatorName as string) ?? "Unknown",
      thumbnailUrl: null,
      rbxAssetId: `rbxassetid://${item.asset?.id ?? item.id}`,
    })).filter((a: CatalogAsset) => a.id);
  } catch { return []; }
}

// ─── Batch fetch thumbnails ──────────────────────────────────────────────────
async function fetchThumbnails(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  try {
    const params = new URLSearchParams({
      assetIds: ids.join(","),
      size: "150x150",
      format: "Png",
      isCircular: "false",
    });
    const resp = await fetchWithTimeout(`${THUMBNAIL_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return map;
    const body = await resp.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const entry of data) {
      if (typeof entry.targetId === "number" && typeof entry.imageUrl === "string") {
        map.set(entry.targetId, entry.imageUrl);
      }
    }
  } catch { /* best-effort */ }
  return map;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(request, { error: "Roblox search is temporarily unavailable" }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json(request, { error: "Authentication required" }, 401);
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json(request, { error: "Invalid session" }, 401);
  }

  let keyword = "";
  let categoryKey = "all";
  let limit = 10;

  if (request.method === "GET") {
    const url = new URL(request.url);
    keyword = (url.searchParams.get("keyword") || "").trim();
    categoryKey = (url.searchParams.get("category") || "all").trim().toLowerCase();
    limit = Number(url.searchParams.get("limit") || 10);
  } else {
    let body: { keyword?: unknown; category?: unknown; limit?: unknown };
    try { body = await request.json(); } catch { return json(request, { error: "Invalid request body" }, 400); }
    keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
    categoryKey = typeof body.category === "string" ? body.category.trim().toLowerCase() : "all";
    limit = typeof body.limit === "number" ? body.limit : 10;
  }

  if (!keyword || keyword.length > 100) {
    return json(request, { error: "Provide a search keyword (max 100 characters)" }, 400);
  }
  const safeLimit = [10, 20, 30].includes(limit) ? limit : 10;

  // Optional Roblox Open Cloud API key for enhanced rate limits
  const robloxApiKey = Deno.env.get("ROBLOX_API_KEY");

  // ── Route: toolbox search (decals, meshes, images, models, audio) ────────
  let items: CatalogAsset[] = [];
  if (categoryKey in TOOLBOX_ASSET_TYPES) {
    const assetType = TOOLBOX_ASSET_TYPES[categoryKey];
    items = await searchToolbox(keyword, assetType, safeLimit, robloxApiKey);
  } else {
    // ── Route: catalog search (faces, hats, heads, hair, etc.) ──────────────
    items = await searchCatalog(keyword, categoryKey, safeLimit);
  }

  if (items.length === 0) {
    return json(request, { items: [], keyword, category: categoryKey });
  }

  // ── Fetch thumbnails for all results ─────────────────────────────────────
  const ids = items.map((i) => i.id).filter((id) => typeof id === "number");
  const thumbMap = await fetchThumbnails(ids);
  items = items.map((item) => ({
    ...item,
    thumbnailUrl: thumbMap.get(item.id) ?? null,
  }));

  return json(request, { items, keyword, category: categoryKey });
});
