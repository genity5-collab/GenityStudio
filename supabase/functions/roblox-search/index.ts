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

// ─── Roblox catalog subcategory map (public Marketplace API) ───────────────
// See: https://create.roblox.com/docs/projects/assets/api
const SUBCATEGORY_MAP: Record<string, number> = {
  all: 1,
  faces: 10,        // face decals — used for Head.Face
  heads: 15,
  hats: 9,
  hair: 20,
  gear: 5,
  accessories: 19,
  bundles: 37,
  animations: 27,
  shirts: 12,
  pants: 14,
  tshirts: 13,
};

const CATALOG_URL = "https://catalog.roblox.com/v1/search/items/details";
const THUMBNAIL_URL = "https://thumbnails.roblox.com/v1/assets";
const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

  // Require an authenticated session so this proxy can't be scraped anonymously.
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
  let subcategoryKey = "all";
  let limit = 10;

  if (request.method === "GET") {
    const url = new URL(request.url);
    keyword = (url.searchParams.get("keyword") || "").trim();
    subcategoryKey = (url.searchParams.get("category") || "all").trim().toLowerCase();
    limit = Number(url.searchParams.get("limit") || 10);
  } else {
    let body: { keyword?: unknown; category?: unknown; limit?: unknown };
    try {
      body = await request.json();
    } catch {
      return json(request, { error: "Invalid request body" }, 400);
    }
    keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
    subcategoryKey = typeof body.category === "string" ? body.category.trim().toLowerCase() : "all";
    limit = typeof body.limit === "number" ? body.limit : 10;
  }

  if (!keyword || keyword.length > 100) {
    return json(request, { error: "Provide a search keyword (max 100 characters)" }, 400);
  }
  const subcategory = SUBCATEGORY_MAP[subcategoryKey] ?? SUBCATEGORY_MAP.all;
  const safeLimit = [10, 28, 30].includes(limit) ? limit : 10;

  const searchParams = new URLSearchParams({
    Category: "1",
    Subcategory: String(subcategory),
    Keyword: keyword,
    Limit: String(safeLimit),
    SortType: "0",
  });

  let items: Array<Record<string, unknown>> = [];
  try {
    const catalogResponse = await fetchWithTimeout(`${CATALOG_URL}?${searchParams.toString()}`, {
      headers: { "Accept": "application/json" },
    });
    if (!catalogResponse.ok) {
      return json(request, { error: "Roblox catalog is temporarily unavailable" }, 502);
    }
    const catalogBody = await catalogResponse.json();
    items = Array.isArray(catalogBody?.data) ? catalogBody.data : [];
  } catch {
    return json(request, { error: "Roblox catalog request timed out" }, 504);
  }

  if (items.length === 0) {
    return json(request, { items: [] });
  }

  const ids = items.map((item) => item.id).filter((id) => typeof id === "number");
  let thumbnailById = new Map<number, string>();
  try {
    const thumbParams = new URLSearchParams({
      assetIds: ids.join(","),
      size: "150x150",
      format: "Png",
      isCircular: "false",
    });
    const thumbResponse = await fetchWithTimeout(`${THUMBNAIL_URL}?${thumbParams.toString()}`, {
      headers: { "Accept": "application/json" },
    });
    if (thumbResponse.ok) {
      const thumbBody = await thumbResponse.json();
      const thumbData = Array.isArray(thumbBody?.data) ? thumbBody.data : [];
      for (const entry of thumbData) {
        if (typeof entry.targetId === "number" && typeof entry.imageUrl === "string") {
          thumbnailById.set(entry.targetId, entry.imageUrl);
        }
      }
    }
  } catch {
    // Thumbnails are best-effort — search still returns without images.
  }

  const results = items.map((item) => ({
    id: item.id,
    name: item.name,
    assetType: item.assetType,
    itemType: item.itemType,
    creatorName: item.creatorName,
    thumbnailUrl: thumbnailById.get(item.id as number) ?? null,
    rbxAssetId: `rbxassetid://${item.id}`,
  }));

  return json(request, { items: results, keyword, category: subcategoryKey });
});
