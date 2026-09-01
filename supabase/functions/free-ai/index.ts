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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const FREE_MODES = new Set(["auto", "fast", "plan"]);

// ─── Roblox catalog search (live, public Marketplace API) ──────────────────
const SUBCATEGORY_MAP: Record<string, number> = {
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
        keyword: { type: "string", description: "Search keyword, e.g. 'smile face' or 'dragon mesh'." },
        category: {
          type: "string",
          enum: Object.keys(SUBCATEGORY_MAP),
          description: "Catalog subcategory. 'faces' for Head.Face decals, 'hats' for accessories, etc.",
        },
      },
      required: ["keyword"],
    },
  },
};

async function searchRobloxCatalog(keyword: string, categoryKey: string): Promise<{ results: CatalogAsset[] }> {
  const subcategory = SUBCATEGORY_MAP[categoryKey?.toLowerCase()] ?? SUBCATEGORY_MAP.all;
  const params = new URLSearchParams({
    Category: "1",
    Subcategory: String(subcategory),
    Keyword: keyword.slice(0, 100),
    Limit: "10",
    SortType: "0",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://catalog.roblox.com/v1/search/items/details?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return { results: [] };
    const body = await response.json();
    const items = Array.isArray(body?.data) ? body.data.slice(0, 5) : [];

    // Fetch thumbnails
    const ids = items.map((i: Record<string, unknown>) => i.id).filter((id: unknown) => typeof id === "number");
    let thumbMap = new Map<number, string>();
    if (ids.length > 0) {
      try {
        const thumbParams = new URLSearchParams({
          assetIds: ids.join(","),
          size: "150x150",
          format: "Png",
          isCircular: "false",
        });
        const thumbResp = await fetch(`https://thumbnails.roblox.com/v1/assets?${thumbParams.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (thumbResp.ok) {
          const thumbBody = await thumbResp.json();
          const thumbData = Array.isArray(thumbBody?.data) ? thumbBody.data : [];
          for (const entry of thumbData) {
            if (typeof entry.targetId === "number" && typeof entry.imageUrl === "string") {
              thumbMap.set(entry.targetId, entry.imageUrl);
            }
          }
        }
      } catch { /* thumbnails are best-effort */ }
    }

    const results: CatalogAsset[] = items.map((item: Record<string, unknown>) => ({
      id: item.id as number,
      name: item.name as string,
      assetType: item.assetType as number | undefined,
      itemType: item.itemType as string | undefined,
      creatorName: item.creatorName as string | undefined,
      thumbnailUrl: thumbMap.get(item.id as number) ?? null,
      rbxAssetId: `rbxassetid://${item.id}`,
    }));
    return { results };
  } catch {
    clearTimeout(timeout);
    return { results: [] };
  }
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
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

  // ── Token deduction (first pass: 1 token) ──────────────────────────────
  // If the AI triggers a live catalog search, we deduct a 2nd token after.
  type TokenRow = { tokens_remaining?: number; reset_at?: string | null; tokens_charged?: number };
  let creditRows: TokenRow | TokenRow[] | null = null;
  let creditError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await userClient.rpc("consume_free_ai_tokens", { p_count: 1 });
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

  await new Promise((resolve) => setTimeout(resolve, 900));
  const maxCompletionTokens = mode === "plan" ? 700 : 900;

  const groundedSystem =
    system +
    "\n\nYou are Retrox, built into RetroStudio. You cannot import raw 3D model geometry. " +
    "You CAN reference real, existing Roblox catalog assets by ID — set Decal.Texture, " +
    "SpecialMesh.MeshId, or MeshPart.MeshId to \"rbxassetid://<id>\". " +
    "When a user wants a face, decal, hat, or accessory, call search_roblox_catalog first " +
    "to find real asset IDs. The search returns up to 5 results — review them, pick the " +
    "best-matching one, and embed its rbxassetid:// in your code. " +
    "Always explain which asset you chose and why. " +
    "If the user just wants a decal or mesh ID without a full build, give them the ID directly " +
    "with the asset name and creator — no need to write a full Luau script. " +
    "Never invent an asset ID.";

  const conversation: Array<Record<string, unknown>> = [
    { role: "system", content: groundedSystem },
    { role: "user", content: prompt },
  ];

  let finalContent: string | null = null;
  let assetsFound: CatalogAsset[] = [];
  let usedToolCall = false;

  for (let round = 0; round < 2; round += 1) {
    let groqResponse: Response;
    try {
      groqResponse = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: conversation,
          max_completion_tokens: maxCompletionTokens,
          temperature: 0.6,
          include_reasoning: false,
          ...(round === 0 ? { tools: [CATALOG_TOOL], tool_choice: "auto" } : {}),
        }),
      });
    } catch {
      return json(request, { error: "Free AI provider is unavailable; one token was used" }, 503);
    }

    let groqBody: any;
    try {
      groqBody = await groqResponse.json();
    } catch {
      return json(request, { error: "Free AI provider returned an invalid response" }, 502);
    }
    if (!groqResponse.ok) {
      return json(request, { error: "Free AI provider is unavailable; one token was used" }, 502);
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
        // Collect all assets found across all tool calls
        assetsFound = assetsFound.concat(results).slice(0, 5);
        const toolResult = JSON.stringify({ results: results.map(r => ({
          id: r.id, name: r.name, rbxAssetId: r.rbxAssetId,
          creatorName: r.creatorName, thumbnailUrl: r.thumbnailUrl,
        }))});
        conversation.push({ role: "tool", tool_call_id: call.id, content: toolResult });
      }
      continue;
    }

    finalContent = typeof message?.content === "string" ? message.content : null;
    break;
  }

  // ── If live search was used, deduct a 2nd token ────────────────────────
  if (usedToolCall) {
    const { data: extraCredit, error: extraError } = await userClient.rpc("consume_free_ai_tokens", { p_count: 1 });
    if (!extraError) {
      const extra = Array.isArray(extraCredit) ? extraCredit[0] : extraCredit;
      tokensRemaining = Number(extra?.tokens_remaining ?? tokensRemaining - 1);
    } else {
      tokensRemaining = Math.max(0, tokensRemaining - 1);
    }
  }

  if (!finalContent) {
    return json(request, { error: "Free AI returned no usable response" }, 502);
  }

  return json(request, {
    content: finalContent,
    tokens_remaining: tokensRemaining,
    reset_at: credit?.reset_at ?? null,
    model: GROQ_MODEL,
    used_live_search: usedToolCall,
    assets_found: assetsFound,
  });
});
