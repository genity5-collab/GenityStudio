import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://retrostudioencoderdev.oneapp.dev",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const FREE_MODES = new Set(["auto", "fast", "plan"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !groqKey) {
    console.error("Free AI server is missing required configuration");
    return json({ error: "Free AI is temporarily unavailable" }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Authentication required" }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "Invalid session" }, 401);
  }

  let body: { prompt?: unknown; system?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const system = typeof body.system === "string" ? body.system.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "fast";
  if (!prompt || prompt.length > 2000 || !system || system.length > 18000) {
    return json({ error: "Prompt is invalid or too large" }, 400);
  }
  if (!FREE_MODES.has(mode)) {
    return json({ error: "That mode is unavailable for Free AI" }, 403);
  }

  // The RPC uses the authenticated caller's JWT. It locks the row and deducts
  // exactly one token from a five-token, forty-eight-hour allocation. A short
  // retry covers the brief schema-cache delay that can follow a fresh deployment.
  type TokenRow = { tokens_remaining?: number; reset_at?: string | null };
  let creditRows: TokenRow | TokenRow[] | null = null;
  let creditError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await userClient.rpc("consume_free_ai_token");
    creditRows = result.data;
    creditError = result.error;
    if (!creditError) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (creditError) {
    const message = creditError.message || "";
    const exhausted = /exhausted/i.test(message);
    console.error("Free AI token RPC failed", { message, userId: userData.user.id });
    return json({
      error: exhausted
        ? "Free AI tokens are exhausted"
        : "Free AI tokens are being prepared. Please try again in a moment.",
    }, exhausted ? 429 : 503);
  }
  const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;

  // The intentional short delay and conservative completion cap keep this
  // shared Free AI tier predictable and slower than user-supplied providers.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const maxCompletionTokens = mode === "plan" ? 700 : 900;
  const reasoningEffort = mode === "auto" ? "low" : undefined;

  let groqResponse: Response;
  try {
    groqResponse = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: maxCompletionTokens,
        temperature: 0.6,
        include_reasoning: false,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });
  } catch {
    return json({ error: "Free AI provider is unavailable; one token was used for this request" }, 503);
  }

  let groqBody: any;
  try {
    groqBody = await groqResponse.json();
  } catch {
    return json({ error: "Free AI provider returned an invalid response" }, 502);
  }
  if (!groqResponse.ok) {
    console.warn("Groq request failed", { status: groqResponse.status, userId: userData.user.id });
    return json({ error: "Free AI provider is unavailable; one token was used for this request" }, 502);
  }

  const content = groqBody?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return json({ error: "Free AI returned no usable response" }, 502);
  }

  return json({
    content,
    tokens_remaining: Number(credit?.tokens_remaining ?? 0),
    reset_at: credit?.reset_at ?? null,
    model: GROQ_MODEL,
  });
});
