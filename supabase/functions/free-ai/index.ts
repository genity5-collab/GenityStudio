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
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const FREE_MODES = new Set(["auto", "fast", "plan", "think", "long", "coder"]);
// Mode-based pricing, charged through the existing consume_free_ai_tokens RPC
// (which clamps each charge to 1..6). The client never sends a cost.
const CHARGE_BY_MODE: Record<string, number> = {
  fast: 1,   // lowest compute, quick answers
  auto: 2,   // default everyday mode ("Normal")
  plan: 2,
  think: 3,  // more reasoning
  long: 4,  // extended reasoning for difficult tasks
  coder: 5,  // complex programming / agentic coding
};
const CHARGE_SEARCH_EXTRA = 2; // extra credits when live Roblox catalog search runs
const MODE_PRICES_PUBLIC: Record<string, number> = {
  fast: 1, auto: 2, think: 3, long: 4, coder: 5,
};

// Heuristic: when the prompt clearly wants an asset AND clearly wants a build,
// force the search tool on the first round instead of leaving it to model whim
// (small models sometimes skip the tool call even when told to use it).
const ASSET_KEYWORD_RE = /\b(decal|decals|mesh|meshes|face|faces|hat|hats|hair|gear|sound|audio|texture|textures|skin|skins|model|models|accessory|accessories|image|images|shirt|shirts|pants|tshirt|t-shirt|bundle|bundles|animation|animations)\b/i;
const BUILD_INTENT_RE = /\b(build|add|make|create|put|give|place|script|insert|use|attach|apply|equip|spawn|generate)\b/i;

// ─── Roblox catalog search (live, public Marketplace API) ──────────────────
// Toolbox marketplace API is used first (not IP-blocked, returns rich data);
// catalog.roblox.com is tried for wearables with graceful fallback.

const TOOLBOX_TYPES: Record<string, number> = {
  decals: 13, faces: 13, meshes: 40, images: 13, models: 10, audio: 3,
};

const CATALOG_SUBCATEGORIES: Record<string, number> = {
  all: 1, faces: 10, heads: 15, hats: 9, hair: 20,
  gear: 5, accessories: 19, bundles: 37, animations: 27,
  shirts: 12, pants: 14, tshirts: 13,
};

const KIND_BY_CATEGORY: Record<string, string> = {
  decals: "decal", faces: "face", meshes: "mesh", images: "image",
  models: "model", audio: "sound", hats: "hat", hair: "hair", gear: "gear",
  heads: "head", accessories: "accessory", bundles: "bundle",
  animations: "animation", shirts: "shirt", pants: "pants", tshirts: "t-shirt",
};

function kindFor(categoryKey: string): string {
  return KIND_BY_CATEGORY[(categoryKey || "").toLowerCase()] || "asset";
}

type CatalogAsset = {
  id: number;
  name: string;
  assetType?: number;
  itemType?: string;
  creatorName?: string;
  thumbnailUrl: string | null;
  rbxAssetId: string;
};

type SearchRecord = {
  keyword: string;
  category: string;
  kind: string;
  source: string;
  results: CatalogAsset[];
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

const REFERENCE_TOOL = {
  type: "function",
  function: {
    name: "reference_asset_image",
    description:
      "Pulls a real Roblox asset image (decal, face, image, mesh, model) and shows it to the user as a " +
      "visual reference card in the chat. Use it when a picture genuinely helps — e.g. the user wants to see " +
      "what a decal/texture looks like before you embed it. Do NOT call it for every build; skip it when the " +
      "build does not need a visual. It does not embed anything by itself.",
    parameters: {
      type: "object",
      properties: {
        asset_id: {
          type: "number",
          description: "Known Roblox asset ID (from a previous search).",
        },
        keyword: {
          type: "string",
          description: "Search keyword when no ID is known yet, e.g. 'brick texture'.",
        },
        category: {
          type: "string",
          enum: Array.from(new Set([...Object.keys(TOOLBOX_TYPES), ...Object.keys(CATALOG_SUBCATEGORIES)])),
          description: "Asset category. Defaults to decals when searching by keyword.",
        },
        note: {
          type: "string",
          description: "One short line explaining why this image is shown as reference (max 80 chars).",
        },
      },
      required: [],
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
async function searchToolbox(keyword: string, assetType: number): Promise<{ results: CatalogAsset[]; source: string }> {
  const robloxApiKey = Deno.env.get("ROBLOX_API_KEY");
  const params = new URLSearchParams({ limit: "20", keyword: keyword.slice(0, 100) });
  try {
    const resp = await fetch(`${TOOLBOX_SEARCH_URL}/${assetType}?${params.toString()}`, { headers: httpHeaders(robloxApiKey), signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return { results: [], source: "Roblox Creator Store" };
    const body = await resp.json();
    const items = Array.isArray(body?.data) ? body.data.slice(0, 5) : [];
    const ids = items.map((i: Record<string, unknown>) => i.id).filter((id: unknown) => typeof id === "number") as number[];
    if (ids.length === 0) return { results: [], source: "Roblox Creator Store" };

    // Enrich with details (name, creator, description)
    let details = new Map<number, { name?: string; creator?: string; description?: string; meshId?: number }>();
    try {
      const dparams = new URLSearchParams({ assetIds: ids.join(",") });
      const dresp = await fetch(`${TOOLBOX_DETAILS_URL}?${dparams.toString()}`, { headers: httpHeaders(robloxApiKey), signal: AbortSignal.timeout(7000) });
      if (dresp.ok) {
        const dbody = await dresp.json();
        const ddata = Array.isArray(dbody?.data) ? dbody.data : [];
        for (const item of ddata) {
          const id = item?.asset?.id;
          if (typeof id === "number") {
            details.set(id, {
              name: item.asset?.name,
              creator: item?.creator?.name,
              description: item.asset?.description,
              // For mesh assets the catalog asset id is a wrapper; the REAL mesh
              // content id lives in asset.meshId and is what MeshPart.MeshId /
              // SpecialMesh.MeshId should reference when present.
              meshId: typeof item.asset?.meshId === "number" ? item.asset.meshId : undefined,
            });
          }
        }
      }
    } catch { /* best-effort */ }

    const thumbs = await fetchThumbnails(ids);
    const results: CatalogAsset[] = ids.map((id) => {
      const detail = details.get(id);
      return {
        id,
        name: detail?.name || "Roblox asset",
        assetType: assetType,
        itemType: "Asset",
        creatorName: detail?.creator || "Unknown",
        thumbnailUrl: thumbs.get(id) ?? null,
        // Mesh assets: reference the real mesh content id when the details
        // response provides one; everything else uses the catalog asset id.
        rbxAssetId: detail?.meshId ? `rbxassetid://${detail.meshId}` : `rbxassetid://${id}`,
      };
    });
    return { results, source: "Roblox Creator Store (live)" };
  } catch {
    return { results: [], source: "Roblox Creator Store" };
  }
}

// ── Catalog flow (wearables) — may be rate-limited; callers fall back ────
async function searchCatalog(keyword: string, subcategoryKey: string): Promise<{ results: CatalogAsset[]; source: string }> {
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
    if (!resp.ok) return { results: [], source: "Roblox Marketplace (live)" };
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
    return { results, source: "Roblox Marketplace (live)" };
  } catch {
    return { results: [], source: "Roblox Marketplace" };
  }
}

async function searchRobloxCatalog(keyword: string, categoryKey: string): Promise<{ results: CatalogAsset[]; source: string }> {
  const catLower = (categoryKey || "").toLowerCase();

  // Faces, decals, meshes, images, models, audio → toolbox flow (reliable)
  if (catLower in TOOLBOX_TYPES) {
    return searchToolbox(keyword, TOOLBOX_TYPES[catLower]);
  }

  // Wearables (hats, hair, gear, …) → try catalog, fall back to toolbox decals
  let { results, source } = await searchCatalog(keyword, catLower);
  if (results.length === 0) {
    const fallback = await searchToolbox(keyword, TOOLBOX_TYPES.decals);
    results = fallback.results;
    source = fallback.source;
  }
  return { results, source };
}

// ── Build the payload the frontend "Retrox Verified Asset Search" card renders ──
function buildAssetSearchPayload(searches: SearchRecord[], content: string): Record<string, unknown> | null {
  if (searches.length === 0) return null;

  // Which asset IDs did the model actually embed in its code?
  const usedIds = new Set<number>();
  for (const m of content.matchAll(/rbxassetid:\/\/(\d+)/g)) {
    usedIds.add(Number(m[1]));
  }

  // Flatten to at most 5 unique assets (in search order)
  const seen = new Set<number>();
  const assets: Array<Record<string, unknown>> = [];
  for (const s of searches) {
    for (const r of s.results) {
      if (seen.has(r.id) || assets.length >= 5) continue;
      seen.add(r.id);
      assets.push({
        id: r.id,
        name: r.name,
        kind: s.kind,
        creator: r.creatorName || "Unknown",
        thumbnail_url: r.thumbnailUrl,
        source_url: `https://www.roblox.com/catalog/${r.id}`,
        used_in_build: usedIds.has(r.id),
      });
    }
  }

  const chosen = assets.filter((a) => a.used_in_build);
  const kwList = searches.map((s) => `"${s.keyword}"`).join(", ");
  let summary: string;
  if (chosen.length === 1) {
    summary =
      `Retrox live-searched ${kwList} and reviewed ${assets.length} verified result(s). ` +
      `It chose ${chosen[0].name} (ID ${chosen[0].id}) for this build — the ${chosen[0].kind} is embedded in the code.`;
  } else if (chosen.length > 1) {
    summary =
      `Retrox live-searched ${kwList} and reviewed ${assets.length} verified result(s). ` +
      `It used ${chosen.length} of them in the build: ` +
      chosen.map((a) => `${a.name} (ID ${a.id})`).join(", ") + ".";
  } else {
    summary =
      `Retrox live-searched ${kwList} and found ${assets.length} verified result(s). ` +
      `The best matches are listed below — Retrox picked the closest one for the code.`;
  }

  const sources = searches.slice(0, 3).map((s) => ({
    name: s.source,
    status: s.results.length > 0 ? "verified live" : "no results",
    count: s.results.length,
    note: `keyword: ${s.keyword}${s.category && s.category !== "all" ? ` · category: ${s.category}` : ""}`,
    url: `https://www.roblox.com/search/catalog?Keyword=${encodeURIComponent(s.keyword)}`,
  }));

  return { summary, assets, sources };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request) });
}

// ─── Retrox building-skill system prompt ──────────────────────────────────────
const BUILDING_SKILLS = `
You are Retrox, the resident AI builder inside RetroStudio. You are a Luau and
Roblox engineering expert.

INTENT FIRST (decide before answering — most important):
- CASUAL CHAT / GREETINGS / QUESTIONS: If the user greets you, asks who you are,
  asks a general question, or is clearly just talking ("hi", "what can you do",
  "how does X work"), reply in PLAIN CONVERSATIONAL TEXT ONLY. No Luau code.
  No building. No encoder output. Keep it short and friendly.
- ASSET SEARCH ONLY: If the user asks you to find/search an asset (decal, mesh,
  sound, face, hat, texture) WITHOUT asking for a build or script, call
  search_roblox_catalog and then reply in PLAIN TEXT ONLY — no code. Give the
  best match's name, its ID as rbxassetid://<id>, and the creator. Optionally
  add a one-line description and offer to build something with it.
- BUILD REQUESTS: Only when the user clearly wants something built, changed,
  scripted, or fixed do you output Luau code. Only then may a script card appear.
- Never wrap a plain answer in code. Never emit Luau unless the user asked for
  a build or an explicit code example.

Follow these rules when you build:

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

UI BUILDS (ScreenGui / menus / HUDs / shops / dialogs):
- Root every UI in a ScreenGui parented to the LocalPlayer's PlayerGui (from a
  LocalScript) or StarterGui (for a construction/Model script). Never parent
  GuiObjects straight to Workspace or ServerScriptService.
- Build the tree top-down and parent each piece as you create it: ScreenGui ->
  Frame (container) -> child GuiObjects (TextLabel, TextButton, ImageLabel,
  ImageButton, TextBox, ScrollingFrame).
- Use UDim2 for every Size/Position — UDim2.new(scaleX, offsetX, scaleY, offsetY).
  Prefer scale-based layout (e.g. UDim2.new(0.4, 0, 0.5, 0)) so it holds up on
  different screen sizes; use offset pixels only for fixed-size details like
  padding or icon sizes.
- AnchorPoint (Vector2.new(0.5,0.5)) + Position at the 0.5,0.5 scale point is
  the standard way to center a Frame on screen.
- Style with real properties: BackgroundColor3, BackgroundTransparency,
  TextColor3, TextScaled or TextSize, Font (Enum.Font.SourceSansBold etc.).
  Add UICorner (CornerRadius = UDim.new(0, 8)) for rounded panels and
  UIListLayout / UIGridLayout + UIPadding for clean automatic spacing instead
  of manually positioning every child.
- Wire interactions with real events: button.MouseButton1Click:Connect(...),
  frame.Visible = true/false for open/close, TweenService for slide/fade
  transitions. Give a close/back button — never build a dialog with no way
  to dismiss it.
- Keep one LocalScript (or the Main Script if the whole build is server-only
  logic) driving the UI's behavior — don't scatter UI logic across scripts.

ROBLOX ASSETS:
- You cannot import raw 3D geometry. You CAN reference real catalog assets by ID.
  Property names and casing matter — get them exactly right:
    * Decal / Texture instance: Decal.Texture = "rbxassetid://<id>"
    * Sound: Sound.SoundId = "rbxassetid://<id>"
    * SpecialMesh: MeshId (mesh shape) and TextureId (surface texture) are TWO
      SEPARATE properties — never combine them or put a texture ID into MeshId.
      CRITICAL: MeshType MUST be Enum.MeshType.FileMesh for a custom MeshId to
      render at all — any other MeshType (Head, Brick, Sphere, Cylinder, Torso,
      Wedge, Prism, Pyramid, ParallelRamp, RightAngleRamp, CornerWedge) ignores
      MeshId/TextureId and draws a built-in primitive instead. Example:
        local mesh = Instance.new("SpecialMesh")
        mesh.MeshType = Enum.MeshType.FileMesh
        mesh.MeshId = "rbxassetid://<mesh id>"
        mesh.TextureId = "rbxassetid://<texture id>"  -- omit ("") if there is no texture asset
        mesh.Parent = part
  * RETROSTUDIO IS A ~2010 ROBLOX RECREATION: MeshPart does not exist there.
    ALWAYS use SpecialMesh (parented to a Part) for custom meshes — never MeshPart.
  * Texture rules: the search results include real mesh IDs. If the search did NOT
    return a separate texture/decal asset, leave TextureId as "" (empty string) —
    do not copy the mesh ID into TextureId.
  * MESHES HAVE A SCALE PROPERTY TOO — get this right or the mesh renders as an
    invisible speck or a giant blob:
      - mesh.Scale = Vector3.new(x, y, z) is a MULTIPLIER of the PARENT PART'S
        Size, not an absolute size and not the mesh's native/raw dimensions.
      - DEFAULT: Vector3.new(1, 1, 1) — this makes the mesh roughly fill the
        part's bounding box. Start here for almost every mesh.
      - NEVER default to a tiny value like Vector3.new(0.1, 0.1, 0.1) "to be
        safe" — that shrinks the mesh to 10% of the part and makes it look like
        it's missing entirely. Only use small/large Scale values when you are
        deliberately resizing a specific axis (e.g. flattening a rug mesh with
        Vector3.new(1, 0.05, 1)), never as a generic default.
      - To make a mesh bigger or smaller overall, resize the PART (part.Size),
        then keep Scale near Vector3.new(1,1,1) — don't fight the part size
        with an extreme Scale value.
      - mesh.Offset = Vector3.new(x,y,z) nudges the mesh within the part local
        space (rarely needed; default Vector3.new(0,0,0)).
- ASSET USAGE IS MANDATORY, NOT OPTIONAL: when a BUILD needs a face, decal,
  mesh, hat, or sound, call search_roblox_catalog FIRST to find real asset IDs —
  always, even if you think you already know an ID. Review the up to 5 results,
  pick the best match, and embed its rbxassetid:// in your code.
  * Finding an asset is NOT enough — the FINAL Luau script you output MUST
    actually contain the resulting property assignment (Decal.Texture,
    SpecialMesh.MeshId/TextureId, or Sound.SoundId) wired to a real part/model
    in the build. A build that mentions a found asset in chat but doesn't use
    it in the code is INCOMPLETE — always wire it in.
  * Always end with one line naming the chosen asset: "Chosen asset:
  <name> (ID <id>) — <short reason>."
- If a search returns no usable results, try again once with a broader or
  different keyword/category before giving up. If nothing matches, tell the user
  honestly instead of inventing an ID.
- If the user just wants an asset ID, give the ID + name + creator directly.
- NEVER invent an asset ID.

REFERENCE IMAGES:
- reference_asset_image pulls an asset's picture and shows it to the user as a visual
  reference card. Call it only when seeing the asset actually helps the user decide
  (decals, textures, faces, artwork). Never call it when the build needs no image.
  You still cannot see images yourself — the card is for the user.

ENCODER-FRIENDLY LUAU (important — this is why builds sometimes fail to encode):
- The in-app encoder converts your Luau into RetroStudio blocks using a limited block
  set. Keep syntax as PLAIN as possible so the encoded script card always renders.
  NEVER use:
    * type annotations (x: number), --!strict headers, or generics
    * string interpolation (use .. concatenation instead of template braces)
    * goto/labels, continue (not real Luau anyway — use a flag var or nested if)
    * compound assignment operators (+=, -=, *=, /=, //=, %=, ..=) — always write
      the full form: x = x + 1
    * compound/bitwise operators (&, |, ~, <<, >>)
    * destructuring, multiple-return one-liners beyond simple local a, b = f()
    * multi-line long-bracket comments --[[ ... ]] — use only single-line -- comments
    * metatables / setmetatable / OOP class patterns — use plain functions and tables
    * varargs (...) or deeply nested mixed array/hash table constructors
  Prefer: local vars, Instance.new + one property assignment per line, if/elseif/else,
  numeric for, while, CFrame/Vector3/Color3/UDim2 construction, event connections
  (.Touched, MouseButton1Click, :Connect).
  ONE STATEMENT PER LINE — NEVER wrap or split a statement across lines. No line
  may end with an unclosed parenthesis, a trailing comma, or a dangling operator.
- You may use PathfindingService, TweenService, Humanoids, RemoteEvents and similar
  services when the build needs them, written in the same plain style.
- AVOID CUSTOM FUNCTIONS (local function foo(...) ... end) IN BOTH SCRIPTS, not just
  the model script. Function-definition/call blocks are the least reliable part of
  the encoder and are the most common reason a Main Script fails to import even
  though a Model Script with the same style works fine. Instead:
  * Write logic directly inline inside each event handler (.Touched:Connect(function()
    ... end), MouseButton1Click:Connect(function() ... end)) — duplicate a few lines
    of code across handlers rather than factoring out a shared helper function.
  * If a script genuinely needs the exact same block repeated 3+ times, still prefer
    explicit repetition over a helper function — repetition encodes reliably,
    functions do not.
- If a build is unavoidably complex, still follow every rule above — simplicity is
  what makes the encoder succeed, not shorter code.

MODEL-FIRST BUILD ORDER (required for every build that creates a physical model):
- If the build creates ANY physical model/structure (house, shop, stand, pedestal,
  bridge, vehicle, statue, mesh display, or any multi-part construction), you MUST
  output TWO scripts in this exact order:
  SCRIPT 1 — THE MODEL SCRIPT (build the world model):
    * Contains ONLY construction code — every Part, SpecialMesh, Decal, Model,
      weld, anchor, position, color, texture. NOTHING else: no player logic, no
      events, no leaderstats, no tools, no chat commands.
    * CONSTRUCTION CODE MUST BE FLAT AND EXPLICIT (the encoder compiles it line
      by line — anything clever gets skipped):
      - Write EVERY part out literally. NEVER generate parts with a table of
        positions + a pairs/ipairs loop, and NEVER build part names or args with
        .. concatenation (e.g. "Wall"..i) — repeat the part code instead.
      - Avoid helper functions (local function makePart(...)). If you must use
        one it gets inlined, but explicit repeated code is far more reliable.
      - Positions: part.CFrame = CFrame.new(x, y, z) with literal numbers or
        simple arithmetic of numeric locals (local h = 6 ... h/2+0.5 is fine).
        Same for part.Size = Vector3.new(x, y, z).
      - Colors: part.BrickColor = BrickColor.new("Color name") — prefer named
        BrickColors. part.Color = Color3.fromRGB(r, g, b) also works.
      - part.Material = Enum.Material.X. Instance.new("Part", workspace) with
        the parent argument. Do NOT call game:GetService in model scripts —
        use the bare workspace global.
      - Anchored = true on every structural part so the build does not fall.
    * MANDATORY CHECKLIST — verify ALL of these before you print the final line,
      go back and add whatever is missing:
      1. ROOF: any house/building/shop/booth needs a roof — a slanted pair of
         angled Part "panels" (CFrame.Angles) or a flat cap Part covering the top.
         A structure with 4 walls and no roof is NOT finished.
      2. COLOR + MATERIAL on every single part: BrickColor.new(...) or Color3, AND
         Material = Enum.Material.X. A part left at default gray Plastic is a bug.
      3. Every SpecialMesh has MeshType, MeshId, and TextureId set (TextureId = ""
         only when the search genuinely found no separate texture asset) and a
         Scale near Vector3.new(1,1,1) (see the mesh Scale rules above).
      4. Every Decal has Texture set, every Sound has SoundId set.
    * End it with exactly: print("Model built - you can delete this script now")
    * After the code, tell the user: "Run this script in RetroStudio Studio first
      (paste in the command bar or run once) so the model appears in the world.
      Delete the script afterwards."
  SCRIPT 2 — THE MAIN SCRIPT (the logic):
    * Contains the interactive logic (events, tools, leaderstats, animations,
      sounds, etc.).
    * Preface it with where to place it, e.g.:
      "Place this in ServerScriptService (regular Script):"
  If the build has logic, both scripts are required — the model script first,
  always. If the build is pure model with no logic, output only the model script
  with the run-in-studio instruction.
- Use this exact header format for each script block, followed by a 1-2 sentence
  summary of THAT script, then its code:
  "Script 1 — Model (run once in Studio)"
  "Script 2 — Main (place in <location>, <Script|LocalScript>)"

COMPLETENESS (critical — builds must be finished, never stubbed):
- NEVER output a placeholder, demo, or minimal script when the user asks for a real
  build. A request like "build a house" means a REAL house: floor, all four walls,
  door opening with a working door, windows, a full roof — every part fully created
  with real sizes, positions, colors and materials. No "print hello" demos, no
  "rest of the parts here" comments, no truncation hints, no asking the user to
  finish it themselves.
- Write out every part with its own Instance.new + properties. A structure build
  should contain at minimum 8-15 parts. If the response is getting long, KEEP
  WRITING — a complete build beats a short one.
- The one print() line allowed in a model script is the "Model built" confirmation
  above; logic scripts may use print for real status messages only.
- Never use player:Kick() in normal builds. Never add joke/test behaviors the user
  did not ask for.

RESPONSE FORMAT:
- Plain text only — no markdown, no **, no triple backticks, no headers with #.
- For chat/asset-search answers: plain text only, no code block at all.
- For builds: lead with a SHORT CONTEXT SUMMARY (1-3 plain sentences, no code) covering
  what the script does, the key objects/instances it creates or modifies, which
  events it hooks (if any), and which asset IDs are embedded (if any) — then the
  Luau code. This summary is required for every build so the user knows what the
  script contains before they encode or paste it.
- Keep code complete and paste-ready.`;

// Appended only for Coder mode: complex builds may need more than one script.
const CODER_MULTI_SCRIPT_ADDENDUM = `

CODER MODE — MULTIPLE SCRIPTS WHEN THE BUILD NEEDS THEM:
- The user is in Coder mode (highest-effort mode) for agentic/complex programming.
  When the task genuinely needs separation — e.g. a server Script plus a client
  LocalScript, a main system plus a supporting ModuleScript, or several independent
  features — output MULTIPLE complete, separate scripts in one response.
- Only split when there is a real reason (different Script type, different
  instance/location, or a clean separation of concerns). A small single-purpose
  request is still just ONE script — do not split for the sake of splitting.
- The MODEL-FIRST BUILD ORDER above always applies first: Script 1 is the model
  script, Script 2 is the main logic script. Only ADD further scripts beyond
  those when there is a real reason (a separate client LocalScript, a
  ModuleScript, a second independent system).
- Format each additional script as its own block, in order:
  "Script N — <where it goes, e.g. ServerScriptService> (<Script|LocalScript|ModuleScript>): <one-line purpose>"
  followed by a 1-2 sentence context summary for THAT script, then its Luau code.
- Every individual script must still follow all ENCODER-FRIENDLY LUAU rules above.`;

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
  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");

  // Provider fallback chain: Groq gpt-oss-20b -> Groq llama-3.3-70b -> OpenRouter gpt-oss-20b
  type Provider = { name: string; url: string; key: string; model: string };
  const PROVIDERS: Provider[] = [];
  if (groqKey) {
    PROVIDERS.push({ name: "groq", url: GROQ_URL, key: groqKey, model: "openai/gpt-oss-20b" });
    PROVIDERS.push({ name: "groq", url: GROQ_URL, key: groqKey, model: "llama-3.3-70b-versatile" });
  }
  if (openrouterKey) {
    PROVIDERS.push({ name: "openrouter", url: OPENROUTER_URL, key: openrouterKey, model: "openai/gpt-oss-20b" });
    // Deeper last-resort free models: only reached when everything above failed
    // (e.g. Groq rate-limited AND primary OpenRouter model down). :free variants
    // have tight OpenRouter rate limits but cost nothing.
    PROVIDERS.push({ name: "openrouter", url: OPENROUTER_URL, key: openrouterKey, model: "meta-llama/llama-3.3-70b-instruct:free" });
    PROVIDERS.push({ name: "openrouter", url: OPENROUTER_URL, key: openrouterKey, model: "qwen/qwen-2.5-72b-instruct:free" });
    PROVIDERS.push({ name: "openrouter", url: OPENROUTER_URL, key: openrouterKey, model: "deepseek/deepseek-chat-v3-0324:free" });
  }
  if (!supabaseUrl || !supabaseAnonKey || PROVIDERS.length === 0) {
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

  let body: { prompt?: unknown; system?: unknown; mode?: unknown; stream?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "Invalid request body" }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const system = typeof body.system === "string" ? body.system.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "fast";
  const wantsStream = body.stream === true;
  if (!prompt || prompt.length > 2000 || !system || system.length > 18000) {
    return json(request, { error: "Prompt is invalid or too large" }, 400);
  }
  if (!FREE_MODES.has(mode)) {
    return json(request, { error: "That mode is unavailable for Free AI" }, 403);
  }

  // ── Token deduction (first pass: base cost, server-decided) ─────────────
  type TokenRow = { tokens_remaining?: number; reset_at?: string | null; tokens_charged?: number };
  const CHARGE_BASE = CHARGE_BY_MODE[mode] ?? 3;
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
    return json(request, {
      error: "Free AI tokens are being prepared. Try again in a moment.",
    }, 503);
  }
  let credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
  let tokensRemaining = Number(credit?.tokens_remaining ?? 0);
  let tokensCharged = Number(credit?.tokens_charged ?? CHARGE_BASE);

  // tokens_charged === 0 means the RPC deducted nothing — the account truly
  // doesn't have enough for this mode. Report the REAL remaining balance and
  // the cheapest mode that would fit, instead of a blind "exhausted" message.
  if (tokensCharged === 0) {
    const resetAt = credit?.reset_at ?? null;
    const affordable = Object.entries(CHARGE_BY_MODE)
      .filter(([, cost]) => cost <= tokensRemaining)
      .sort((a, b) => a[1] - b[1])[0];
    let hint: string;
    if (tokensRemaining <= 0) {
      hint = "You're out of Retrox tokens.";
    } else if (affordable) {
      hint = `You have ${tokensRemaining} Retrox token${tokensRemaining === 1 ? "" : "s"} left — ` +
        `${mode} mode needs ${CHARGE_BASE}. Try ${affordable[0]} mode (${affordable[1]}cr) instead.`;
    } else {
      hint = `You have ${tokensRemaining} Retrox token${tokensRemaining === 1 ? "" : "s"} left — not enough for any mode right now.`;
    }
    if (resetAt) {
      const mins = Math.max(0, Math.round((new Date(resetAt).getTime() - Date.now()) / 60000));
      const hours = Math.floor(mins / 60);
      hint += hours > 0 ? ` Refills in ${hours}h ${mins % 60}m.` : ` Refills in ${mins}m.`;
    }
    return json(request, {
      error: hint,
      tokens_remaining: tokensRemaining,
      reset_at: resetAt,
      mode_prices: MODE_PRICES_PUBLIC,
    }, 402);
  }

  await new Promise((resolve) => setTimeout(resolve, 900));
  const TOKEN_BUDGET_BY_MODE: Record<string, number> = {
    fast: 4352, auto: 5632, plan: 6144, think: 6656, long: 8704, coder: 9728,
  };
  const maxCompletionTokens = TOKEN_BUDGET_BY_MODE[mode] ?? 4096;
  const reasoningEffort = mode === "fast" || mode === "auto" ? "low" : "medium";

  const groundedSystem = system + BUILDING_SKILLS + (mode === "coder" ? CODER_MULTI_SCRIPT_ADDENDUM : "");
  const forceSearchTool = ASSET_KEYWORD_RE.test(prompt) && BUILD_INTENT_RE.test(prompt);

  const conversation: Array<Record<string, unknown>> = [
    { role: "system", content: groundedSystem },
    { role: "user", content: prompt },
  ];

  const searches: SearchRecord[] = [];
  const providerErrors: string[] = [];

  // ── SSE plumbing (live search events) ───────────────────────────────────
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let sseStream: ReadableStream<Uint8Array> | null = null;
  if (wantsStream) {
    sseStream = new ReadableStream({
      start(controller) { streamController = controller; },
    });
  }
  function sse(event: string, data: unknown) {
    if (!streamController) return;
    try {
      streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch { /* client gone */ }
  }

  let finalContent: string | null = null;
  let usedToolCall = false;
  let usedReference = false;
  let usedModel = "openai/gpt-oss-20b";

  // Pull one asset's image as a visual reference for the user (no charge).
  async function referenceAssetImage(args: { asset_id?: unknown; keyword?: unknown; category?: unknown }): Promise<{ name: string; id: number | null; thumbnailUrl: string | null; kind: string } | null> {
    const catLower = String(args.category || "").toLowerCase();
    if (typeof args.asset_id === "number" && Number.isFinite(args.asset_id)) {
      const id = args.asset_id;
      const thumbs = await fetchThumbnails([id]);
      let name = "Roblox asset";
      try {
        const dparams = new URLSearchParams({ assetIds: String(id) });
        const dresp = await fetch(`${TOOLBOX_DETAILS_URL}?${dparams.toString()}`, { headers: httpHeaders(Deno.env.get("ROBLOX_API_KEY")), signal: AbortSignal.timeout(7000) });
        if (dresp.ok) {
          const dbody = await dresp.json();
          const item = Array.isArray(dbody?.data) ? dbody.data[0] : null;
          if (item?.asset?.name) name = String(item.asset.name);
        }
      } catch { /* best-effort */ }
      return { name, id, thumbnailUrl: thumbs.get(id) ?? null, kind: "asset" };
    }
    const keyword = String(args.keyword || "").slice(0, 100);
    if (!keyword) return null;
    const typeKey = catLower in TOOLBOX_TYPES ? catLower : "decals";
    const { results } = await searchToolbox(keyword, TOOLBOX_TYPES[typeKey]);
    if (results.length === 0) return null;
    const best = results[0];
    return { name: best.name, id: best.id, thumbnailUrl: best.thumbnailUrl, kind: KIND_BY_CATEGORY[typeKey] || "asset" };
  }

  // Stream a provider completion, forwarding text deltas live to the client.
  async function streamCompletion(provider: Provider, messages: Array<Record<string, unknown>>, reasoning: string): Promise<{ content: string | null; error: string | null }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    };
    if (provider.name === "openrouter") {
      headers["HTTP-Referer"] = "https://retrostudioencoderbeta.onrender.com";
      headers["X-Title"] = "RetroStudio Encoder";
    }
    const requestBody: Record<string, unknown> = {
      model: provider.model,
      messages,
      max_completion_tokens: maxCompletionTokens,
      temperature: 0.6,
      stream: true,
      ...(provider.name === "groq" ? { include_reasoning: false, reasoning_effort: reasoning } : {}),
    };
    let content = "";
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok || !response.body) return { content: null, error: `status ${response.status}` };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) {
              content += delta;
              sse("content", { text: delta });
            }
          } catch { /* skip malformed frame */ }
        }
      }
    } catch (err) {
      // partial content already shown: accept it instead of duplicating
      if (content) return { content, error: null };
      return { content: null, error: err instanceof Error ? err.message : "network error" };
    }
    return { content: content || null, error: null };
  }

  // Plain (non-stream) completion — used for the tool round and as a final fallback.
  async function plainCompletion(provider: Provider, messages: Array<Record<string, unknown>>, reasoning: string, withTools: boolean, toolChoice?: unknown): Promise<{ message: any; error: string | null }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    };
    if (provider.name === "openrouter") {
      headers["HTTP-Referer"] = "https://retrostudioencoderbeta.onrender.com";
      headers["X-Title"] = "RetroStudio Encoder";
    }
    const requestBody: Record<string, unknown> = {
      model: provider.model,
      messages,
      max_completion_tokens: maxCompletionTokens,
      temperature: 0.6,
      ...(provider.name === "groq" ? { include_reasoning: false, reasoning_effort: reasoning } : {}),
      ...(withTools ? { tools: [CATALOG_TOOL, REFERENCE_TOOL], tool_choice: toolChoice ?? "auto" } : {}),
    };
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });
      const parsed = await response.json().catch(() => null);
      if (response.ok && parsed?.choices?.length) return { message: parsed.choices[0].message, error: null };
      return { message: null, error: parsed?.error?.message || `status ${response.status}` };
    } catch (err) {
      return { message: null, error: err instanceof Error ? err.message : "network error" };
    }
  }

  // One tool call's worth of work: search or reference. Shared by the initial
  // tool round and the single empty-search retry below.
  async function handleToolCall(call: any): Promise<void> {
    let args: { keyword?: string; category?: string; asset_id?: number; note?: string } = {};
    try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* ignore malformed args */ }
    const fname = String(call.function?.name || "");
    if (fname === "reference_asset_image") {
      usedReference = true;
      const ref = await referenceAssetImage(args);
      const note = String(args.note || "").slice(0, 80);
      if (ref) {
        sse("reference", { name: ref.name, id: ref.id, kind: ref.kind, thumbnail_url: ref.thumbnailUrl, note });
        conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ shown_to_user: true, id: ref.id, name: ref.name, thumbnailUrl: ref.thumbnailUrl, rbxAssetId: ref.id ? `rbxassetid://${ref.id}` : null, note }) });
      } else {
        sse("reference", { name: "Reference image unavailable", id: null, kind: "asset", thumbnail_url: null, note: note || "No matching Roblox asset was found" });
        conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ shown_to_user: false, error: "No matching Roblox asset found for the reference request" }) });
      }
      return;
    }
    const keyword = String(args.keyword || "").slice(0, 100);
    const category = String(args.category || "all");
    const { results, source } = await searchRobloxCatalog(keyword, category);
    const record: SearchRecord = {
      keyword: keyword || "(unspecified)",
      category,
      kind: kindFor(category),
      source,
      results,
    };
    searches.push(record);
    // Live event: every result searched for (max 5), with thumbnails.
    sse("search", {
      keyword: record.keyword,
      category: record.category,
      kind: record.kind,
      source: record.source,
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        kind: record.kind,
        creator: r.creatorName || "Unknown",
        thumbnail_url: r.thumbnailUrl,
      })),
    });
    const toolResult = JSON.stringify({ results: results.map((r) => ({
      id: r.id, name: r.name, rbxAssetId: r.rbxAssetId,
      creatorName: r.creatorName, thumbnailUrl: r.thumbnailUrl,
    })) });
    conversation.push({ role: "tool", tool_call_id: call.id, content: toolResult });
  }

  for (let round = 0; round < 2; round += 1) {
    // Tool round: non-streamed so tool_calls arrive in one shot.
    if (round === 0) {
      let message: any = null;
      let lastError = "provider unavailable";
      const toolChoice = forceSearchTool
        ? { type: "function", function: { name: "search_roblox_catalog" } }
        : "auto";
      for (const provider of PROVIDERS) {
        const res = await plainCompletion(provider, conversation, reasoningEffort, true, toolChoice);
        if (res.message) { message = res.message; usedModel = `${provider.model} (${provider.name})`; break; }
        lastError = res.error || lastError;
        providerErrors.push(`${provider.name}/${provider.model}: ${res.error || "no message"}`);
      }
      if (!message) {
        const errPayload = { error: "Free AI provider is unavailable; " + tokensCharged + " token(s) were used", status: 502 };
        if (streamController) {
          sse("error", errPayload);
          try { streamController.close(); } catch { /* already closed */ }
          return new Response(sseStream, { headers: { ...corsHeadersFor(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
        }
        return json(request, errPayload, 502);
      }
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        finalContent = typeof message?.content === "string" ? message.content : null;
        break;
      }
      usedToolCall = true;
      conversation.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls.slice(0, 3)) {
        await handleToolCall(call);
      }

      // Reliability fix: if every search call in this round came back empty
      // (bad keyword/category, rate limit, etc.), give the model exactly ONE
      // more non-streamed chance to retry with a different keyword/category
      // before it has to answer — instead of silently giving up on the asset.
      const allSearchesEmpty = searches.length > 0 && searches.every((s) => s.results.length === 0);
      if (allSearchesEmpty) {
        conversation.push({
          role: "system",
          content: "Your catalog search returned zero results. Call search_roblox_catalog ONE more time " +
            "with a broader or different keyword/category (drop adjectives, try a synonym, or switch category) " +
            "if that seems likely to help. If you're confident nothing will match, tell the user honestly " +
            "instead of inventing an asset ID.",
        });
        let retryMessage: any = null;
        for (const provider of PROVIDERS) {
          const res = await plainCompletion(provider, conversation, reasoningEffort, true);
          if (res.message) { retryMessage = res.message; usedModel = `${provider.model} (${provider.name})`; break; }
          providerErrors.push(`${provider.name}/${provider.model}: ${res.error || "no message"}`);
        }
        const retryToolCalls = Array.isArray(retryMessage?.tool_calls) ? retryMessage.tool_calls : [];
        if (retryToolCalls.length > 0) {
          conversation.push({ role: "assistant", content: retryMessage.content ?? null, tool_calls: retryToolCalls });
          for (const call of retryToolCalls.slice(0, 3)) {
            await handleToolCall(call);
          }
        } else if (typeof retryMessage?.content === "string" && retryMessage.content.trim()) {
          // Model answered directly on the retry without another tool call — use it as-is.
          finalContent = retryMessage.content;
          break;
        }
      }
      continue;
    }

    // Final round: stream the answer live; provider fallback chain still applies.
    let streamFailed = true;
    for (const provider of PROVIDERS) {
      const res = await streamCompletion(provider, conversation, reasoningEffort);
      if (res.content) {
        finalContent = res.content;
        usedModel = `${provider.model} (${provider.name})`;
        streamFailed = false;
        break;
      }
      if (res.error) { providerErrors.push(`${provider.name}/${provider.model}: ${res.error}`); continue; }
    }
    if (streamFailed) {
      // Streaming unavailable on every provider: last-chance plain completion.
      for (const provider of PROVIDERS) {
        const res = await plainCompletion(provider, conversation, reasoningEffort, false);
        if (res.message && typeof res.message?.content === "string" && res.message.content.trim()) {
          finalContent = res.message.content;
          usedModel = `${provider.model} (${provider.name})`;
          break;
        }
        providerErrors.push(`${provider.name}/${provider.model}: ${res.error || "no content"}`);
      }
    }
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
    const detail = providerErrors.length ? ` (${providerErrors.slice(0, 3).join("; ")})` : "";
    const errPayload = { error: "Free AI returned no usable response" + detail, status: 502 };
    if (streamController) {
      sse("error", errPayload);
      try { streamController.close(); } catch { /* already closed */ }
      return new Response(sseStream, { headers: { ...corsHeadersFor(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    return json(request, errPayload, 502);
  }

  // Plain-text hygiene: strip markdown fences if the model added them anyway.
  let content = finalContent;
  content = content.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  // Also strip markdown bold/italic/headers/hr the small models sometimes emit
  // despite the plain-text rule — they would render literally in the chat UI.
  content = content.replace(/^#{1,6}\s+/gm, "");
  content = content.replace(/\*\*(.+?)\*\*/g, "$1");
  content = content.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2");
  content = content.replace(/^\s*-{3,}\s*$/gm, "");
  if (content.trim().length === 0) {
    const errPayload = { error: "Free AI returned no usable response (empty after plain-text cleanup)", status: 502 };
    if (streamController) {
      sse("error", errPayload);
      try { streamController.close(); } catch { /* already closed */ }
      return new Response(sseStream, { headers: { ...corsHeadersFor(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    return json(request, errPayload, 502);
  }

  const assetsFound = searches.flatMap((s) => s.results).slice(0, 5);
  const robloxAssetSearch = buildAssetSearchPayload(searches, content);
  const finalPayload = {
    content,
    tokens_remaining: tokensRemaining,
    tokens_used: tokensCharged,
    reset_at: credit?.reset_at ?? null,
    model: usedModel,
    mode: mode,
    mode_prices: MODE_PRICES_PUBLIC,
    charge_base: CHARGE_BASE,
    used_live_search: usedToolCall,
    used_reference: usedReference,
    assets_found: assetsFound,
    roblox_asset_search: robloxAssetSearch,
  };

  if (streamController) {
    sse("done", finalPayload);
    try { streamController.close(); } catch { /* already closed */ }
    return new Response(sseStream, { headers: { ...corsHeadersFor(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }
  return json(request, finalPayload);
});
