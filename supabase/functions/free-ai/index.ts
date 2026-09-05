import { createClient } from "npm:@supabase/supabase-js@2";

// ─── CORS + origin allowlist (enforced, not just echoed) ─────────────────────
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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS = ["openai/gpt-oss-20b", "llama-3.3-70b-versatile"]; // primary + auto-fallback
const FREE_MODES = new Set(["auto", "fast", "plan", "think", "long", "coder"]);
const CHARGE_BASE = 3;        // credits per Retrox use (server decides; client never sends cost)
const CHARGE_SEARCH_EXTRA = 2; // extra credits when live Roblox catalog search runs

// ─── Roblox catalog search (live, public Marketplace API) ──────────────────
// Toolbox marketplace API is used first (not IP-blocked, returns rich data);
// catalog.roblox.com is tried for wearables with graceful fallback.

const TOOLBOX_TYPES: Record<string, number> = {
  decals: 13, faces: 13, meshes: 4, images: 1, models: 10, audio: 3,
};

const CATALOG_SUBCATEGORIES: Record<string, number> = {
  all: 1, faces: 10, heads: 15, hats: 9, hair: 20,
  gear: 5, accessories: 19, bundles: 37, animations: 27,
  shirts: 12, pants: 14, tshirts: 13,
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

const CATALOG_TOOL = {
  type: "function",
  function: {
    name: "search_roblox_catalog",
    description:
      "Live-searches the real, public Roblox Marketplace catalog. " +
      "Returns up to 5 results with asset ID, name, creator, and thumbnail. " +
      "Use this whenever the user wants a face, decal, mesh, hat, or accessory — never invent an asset ID. " +
      "Pick the best-matching result and embed its rbxassetid://<id> in your Luau code.",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Search keyword, e.g. 'smile face' or 'dragon mesh'.",
        },
        category: {
          type: "string",
          enum: Array.from(new Set([...Object.keys(TOOLBOX_TYPES), ...Object.keys(CATALOG_SUBCATEGORIES)])),
          description: "Catalog subcategory. 'faces' for Head.Face decals, 'hats' for accessories, etc.",
        },
      },
      required: ["keyword"],
    },
  },
};

const TOOLBOX_SEARCH_URL = "https://apis.roblox.com/toolbox-service/v1/marketplace";
const TOOLBOX_DETAILS_URL = "https://apis.roblox.com/toolbox-service/v1/items/details";
const CATALOG_URL = "https://catalog.roblox.com/v1/search/items/details";
const THUMBNAIL_URL = "https://thumbnails.roblox.com/v1/assets";

function httpHeaders(robloxApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "RetroStudioEncoder/2.0",
  };
  if (robloxApiKey) headers["x-api-key"] = robloxApiKey;
  return headers;
}

async function fetchThumbnails(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  try {
    const params = new URLSearchParams({ assetIds: ids.join(","), size: "150x150", format: "Png", isCircular: "false" });
    const resp = await fetch(`${THUMBNAIL_URL}?${params.toString()}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return map;
    const body = await resp.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const entry of data) {
      if (typeof entry.targetId === "number" && typeof entry.imageUrl === "string" && entry.state === "Completed") {
        map.set(entry.targetId, entry.imageUrl);
      }
    }
  } catch { /* best-effort */ }
  return map;
}

// ── Toolbox flow: search → details (name/creator) → thumbnails ──────────
async function searchToolbox(keyword: string, assetType: number): Promise<{ results: CatalogAsset[] }> {
  const robloxApiKey = Deno.env.get("ROBLOX_API_KEY");
  const params = new URLSearchParams({ limit: "20", keyword: keyword.slice(0, 100) });
  try {
    const resp = await fetch(`${TOOLBOX_SEARCH_URL}/${assetType}?${params.toString()}`, { headers: httpHeaders(robloxApiKey), signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return { results: [] };
    const body = await resp.json();
    const items = Array.isArray(body?.data) ? body.data.slice(0, 5) : [];
    const ids = items.map((i: Record<string, unknown>) => i.id).filter((id: unknown) => typeof id === "number") as number[];
    if (ids.length === 0) return { results: [] };

    // Enrich with details (name, creator, description)
    let details = new Map<number, { name?: string; creator?: string }>();
    try {
      const dparams = new URLSearchParams({ assetIds: ids.join(",") });
      const dresp = await fetch(`${TOOLBOX_DETAILS_URL}?${dparams.toString()}`, { headers: httpHeaders(robloxApiKey), signal: AbortSignal.timeout(7000) });
      if (dresp.ok) {
        const dbody = await dresp.json();
        const ddata = Array.isArray(dbody?.data) ? dbody.data : [];
        for (const item of ddata) {
          const id = item?.asset?.id;
          if (typeof id === "number") {
            details.set(id, { name: item.asset?.name, creator: item?.creator?.name });
          }
        }
      }
    } catch { /* best-effort */ }

    const thumbs = await fetchThumbnails(ids);
    const results: CatalogAsset[] = ids.map((id) => ({
      id,
      name: details.get(id)?.name || "Roblox asset",
      assetType: assetType,
      itemType: "Asset",
      creatorName: details.get(id)?.creator || "Unknown",
      thumbnailUrl: thumbs.get(id) ?? null,
      rbxAssetId: `rbxassetid://${id}`,
    }));
    return { results };
  } catch {
    return { results: [] };
  }
}

// ── Catalog flow (wearables) — may be rate-limited; callers fall back ────
async function searchCatalog(keyword: string, subcategoryKey: string): Promise<{ results: CatalogAsset[] }> {
  const subcategory = CATALOG_SUBCATEGORIES[subcategoryKey] ?? CATALOG_SUBCATEGORIES.all;
  const params = new URLSearchParams({
    Category: "1",
    Subcategory: String(subcategory),
    Keyword: keyword.slice(0, 100),
    Limit: "10",
    SortType: "0",
  });
  try {
    const resp = await fetch(`${CATALOG_URL}?${params.toString()}`, { headers: httpHeaders(), signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return { results: [] };
    const body = await resp.json();
    const items = Array.isArray(body?.data) ? body.data.slice(0, 5) : [];
    const ids = items.map((i: Record<string, unknown>) => i.id).filter((id: unknown) => typeof id === "number") as number[];
    const thumbs = await fetchThumbnails(ids);
    const results: CatalogAsset[] = items.map((item: Record<string, unknown>) => ({
      id: item.id as number,
      name: item.name as string,
      assetType: item.assetType as number | undefined,
      itemType: item.itemType as string | undefined,
      creatorName: item.creatorName as string | undefined,
      thumbnailUrl: thumbs.get(item.id as number) ?? null,
      rbxAssetId: `rbxassetid://${item.id}`,
    }));
    return { results };
  } catch {
    return { results: [] };
  }
}

async function searchRobloxCatalog(keyword: string, categoryKey: string): Promise<{ results: CatalogAsset[] }> {
  const catLower = (categoryKey || "").toLowerCase();

  // Faces, decals, meshes, images, models, audio → toolbox flow (reliable)
  if (catLower in TOOLBOX_TYPES) {
    return searchToolbox(keyword, TOOLBOX_TYPES[catLower]);
  }

  // Wearables (hats, hair, gear, …) → try catalog, fall back to toolbox decals
  let { results } = await searchCatalog(keyword, catLower);
  if (results.length === 0) {
    results = (await searchToolbox(keyword, TOOLBOX_TYPES.decals)).results;
  }
  return { results };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request) });
}

// ─── Retrox building-skill system prompt ──────────────────────────────────────
const BUILDING_SKILLS = `

You are Retrox, the resident AI builder inside RetroStudio. You are a Luau and
Roblox engineering expert. Follow these rules when you build:

POSITIONING (most important):
- Place parts precisely with CFrame.new(x, y, z) — a part's position is its center.
- To position relative to another part: part.CFrame = ref.CFrame * CFrame.new(0, 5, 0)
  offsets are in the REFERENCE part's local space (Y up, -Z forward).
- For whole models use Model:PivotTo(CFrame) or Model:MoveTo(Vector3) — never loop
  over children setting .Position (it breaks welds and relative layout).
- Relative math: for spacing n studs between 4-stud-thick walls, step by (thickness + n).
- Reorient with CFrame.Angles(math.rad(deg), 0, 0) or CFrame.fromEulerAnglesXYZ.

BUILD QUALITY:
- Anchor every structural part you place (Anchored = true) unless it must move.
- Connect moving parts to a static anchor with WeldConstraint (Part0 = anchor, Part1 = mover).
- Set Material, Color, Transparency, and Reflectance thoughtfully.
- Use TweenService for doors, platforms, and pop-up effects.
- Fire/Sparkles/ParticleEmitter for FX, PointLight/SpotLight for lighting.
- ClickDetector or ProximityPrompt for interactions, CollectionService for batches.

STRUCTURE & STYLE:
- Group related parts into Models with a PrimaryPart set.
- Give variables clear names (wallFront, roofPanel, leverBase).
- Add short "--" comments explaining key numbers (positions, sizes).

ROBLOX ASSETS:
- You cannot import raw 3D geometry. You CAN reference real catalog assets by ID:
  set Decal.Texture, SpecialMesh.MeshId, or MeshPart.MeshId to "rbxassetid://<id>".
- When a user wants a face, decal, hat, or mesh, call search_roblox_catalog FIRST
  to find real asset IDs. Review up to 5 results, pick the best match, and embed
  its rbxassetid:// in your code. Always say which asset you chose and why.
- If the user just wants an asset ID, give the ID + name + creator directly.
- NEVER invent an asset ID.

RESPONSE FORMAT:
- Plain text only — no markdown, no **, no triple backticks, no headers with #.
- Lead with one short sentence about what you built, then the Luau code.
- Keep code complete and paste-ready.`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  // Origin enforcement: only the production frontends may call this service.
  const origin = request.headers.get("Origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, { error: "Forbidden origin" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !groqKey) {
    return json(request, { error: "Free AI is temporarily unavailable" }, 503);
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

  let body: { prompt?: unknown; system?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "Invalid request body" }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const system = typeof body.system === "string" ? body.system.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "fast";
  if (!prompt || prompt.length > 2000 || !system || system.length > 18000) {
    return json(request, { error: "Prompt is invalid or too large" }, 400);
  }
  if (!FREE_MODES.has(mode)) {
    return json(request, { error: "That mode is unavailable for Free AI" }, 403);
  }

  // ── Token deduction (first pass: base cost, server-decided) ─────────────
  type TokenRow = { tokens_remaining?: number; reset_at?: string | null; tokens_charged?: number };
  let creditRows: TokenRow | TokenRow[] | null = null;
  let creditError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await userClient.rpc("consume_free_ai_tokens", { p_count: CHARGE_BASE });
    creditRows = result.data;
    creditError = result.error;
    if (!creditError) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (creditError) {
    const message = creditError.message || "";
    const exhausted = /exhausted/i.test(message);
    return json(request, {
      error: exhausted ? "Free AI tokens are exhausted" : "Free AI tokens are being prepared. Try again in a moment.",
    }, exhausted ? 429 : 503);
  }
  let credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
  let tokensRemaining = Number(credit?.tokens_remaining ?? 0);
  let tokensCharged = Number(credit?.tokens_charged ?? CHARGE_BASE);

  await new Promise((resolve) => setTimeout(resolve, 900));
  const maxCompletionTokens = 4096;
  const reasoningEffort = mode === "plan" || mode === "think" ? "medium" : "low";

  const groundedSystem = system + BUILDING_SKILLS;

  const conversation: Array<Record<string, unknown>> = [
    { role: "system", content: groundedSystem },
    { role: "user", content: prompt },
  ];

  let finalContent: string | null = null;
  let assetsFound: CatalogAsset[] = [];
  let usedToolCall = false;
  let usedModel = GROQ_MODELS[0];

  for (let round = 0; round < 2; round += 1) {
    let groqResponse: Response | null = null;
    let groqBody: any = null;
    let lastError = "provider unavailable";

    // Provider fallback chain: primary model, then fallback model.
    for (const model of GROQ_MODELS) {
      try {
        const response = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: conversation,
            max_completion_tokens: maxCompletionTokens,
            temperature: 0.6,
            include_reasoning: false,
            reasoning_effort: reasoningEffort,
            ...(round === 0 ? { tools: [CATALOG_TOOL], tool_choice: "auto" } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        });
        const parsed = await response.json().catch(() => null);
        if (response.ok && parsed) {
          groqResponse = response;
          groqBody = parsed;
          usedModel = model;
          break;
        }
        lastError = parsed?.error?.message || `status ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "network error";
      }
    }
    if (!groqResponse || !groqBody) {
      return json(request, { error: "Free AI provider is unavailable; " + tokensCharged + " token(s) were used" }, 502);
    }

    const message = groqBody?.choices?.[0]?.message;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length > 0 && round === 0) {
      usedToolCall = true;
      conversation.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls.slice(0, 3)) {
        let args: { keyword?: string; category?: string } = {};
        try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
        const { results } = await searchRobloxCatalog(String(args.keyword || ""), String(args.category || "all"));
        assetsFound = assetsFound.concat(results).slice(0, 5);
        const toolResult = JSON.stringify({ results: results.map((r) => ({
          id: r.id, name: r.name, rbxAssetId: r.rbxAssetId,
          creatorName: r.creatorName, thumbnailUrl: r.thumbnailUrl,
        })) });
        conversation.push({ role: "tool", tool_call_id: call.id, content: toolResult });
      }
      continue;
    }

    finalContent = typeof message?.content === "string" ? message.content : null;
    break;
  }

  // ── If live catalog search was used, charge the extra credits ───────────
  if (usedToolCall) {
    const { data: extraCredit, error: extraError } = await userClient.rpc("consume_free_ai_tokens", { p_count: CHARGE_SEARCH_EXTRA });
    if (!extraError) {
      const extra = Array.isArray(extraCredit) ? extraCredit[0] : extraCredit;
      tokensRemaining = Number(extra?.tokens_remaining ?? tokensRemaining - CHARGE_SEARCH_EXTRA);
      tokensCharged += Number(extra?.tokens_charged ?? CHARGE_SEARCH_EXTRA);
    } else {
      tokensRemaining = Math.max(0, tokensRemaining - CHARGE_SEARCH_EXTRA);
      tokensCharged += CHARGE_SEARCH_EXTRA;
    }
  }

  if (!finalContent) {
    return json(request, { error: "Free AI returned no usable response" }, 502);
  }

  // Plain-text hygiene: strip markdown fences if the model added them anyway.
  let content = finalContent;
  content = content.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  if (content.trim().length === 0) {
    return json(request, { error: "Free AI returned no usable response" }, 502);
  }

  return json(request, {
    content,
    tokens_remaining: tokensRemaining,
    tokens_used: tokensCharged,
    reset_at: credit?.reset_at ?? null,
    model: usedModel,
    used_live_search: usedToolCall,
    assets_found: assetsFound,
  });
});
