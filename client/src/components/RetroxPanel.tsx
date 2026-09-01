import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Loader2, Search, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";

type CatalogAsset = {
  id: number;
  name: string;
  assetType?: number;
  itemType?: string;
  creatorName?: string;
  thumbnailUrl: string | null;
  rbxAssetId: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  assets?: CatalogAsset[];
  usedLiveSearch?: boolean;
};

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "faces", label: "Faces" },
  { value: "decals", label: "Decals" },
  { value: "meshes", label: "Meshes" },
  { value: "images", label: "Images" },
  { value: "hats", label: "Hats" },
  { value: "heads", label: "Heads" },
  { value: "hair", label: "Hair" },
  { value: "gear", label: "Gear" },
  { value: "accessories", label: "Accessories" },
  { value: "all", label: "All" },
];

const RETROX_SYSTEM_PROMPT =
  "You are Retrox, a Roblox Luau building assistant built into RetroStudio. " +
  "You cannot import raw 3D model geometry, but you CAN reference real, live Roblox catalog " +
  "assets by ID for Decal.Texture, SpecialMesh.MeshId, and MeshPart.MeshId properties using " +
  "the rbxassetid://<id> format — that is how Roblox actually loads assets at runtime. " +
  "When the user references specific catalog assets below, use their exact IDs in your code. " +
  "Never invent an asset ID. Keep answers focused and include working Luau code blocks when asked to build something. " +
  "If the user just wants a decal or mesh ID, give them the ID, name, and creator — no need for a full script.";

export default function RetroxPanel() {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("decals");
  const [results, setResults] = useState<CatalogAsset[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<CatalogAsset[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [tokensRemaining, setTokensRemaining] = useState<number | null>(null);

  const runSearch = async () => {
    const trimmed = keyword.trim();
    if (!trimmed || isSearching) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const { data, error } = await getSupabaseBrowserClient().functions.invoke("roblox-search", {
        body: { keyword: trimmed, category, limit: 10 },
      });
      if (error) throw error;
      setResults(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSearchError("Live search is unavailable right now. Try again shortly.");
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const toggleAsset = (asset: CatalogAsset) => {
    setSelectedAssets((prev) => {
      const exists = prev.some((item) => item.id === asset.id);
      if (exists) return prev.filter((item) => item.id !== asset.id);
      if (prev.length >= 5) return prev;
      return [...prev, asset];
    });
  };

  const sendMessage = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    setChatError(null);

    const referenceBlock =
      selectedAssets.length > 0
        ? "\n\nReferenced catalog assets (use these exact IDs):\n" +
          selectedAssets.map((a) => `- "${a.name}" by ${a.creatorName ?? "Unknown"} -> ${a.rbxAssetId}`).join("\n")
        : "";

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const { data, error } = await getSupabaseBrowserClient().functions.invoke("free-ai", {
        body: {
          prompt: trimmed + referenceBlock,
          system: RETROX_SYSTEM_PROMPT,
          mode: "fast",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.content,
        assets: Array.isArray(data.assets_found) ? data.assets_found : [],
        usedLiveSearch: Boolean(data.used_live_search),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setTokensRemaining(typeof data.tokens_remaining === "number" ? data.tokens_remaining : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retrox is unavailable right now.";
      setChatError(message);
    } finally {
      setIsSending(false);
    }
  };

  const copyAssetId = (assetId: string) => {
    navigator.clipboard?.writeText(assetId);
  };

  return (
    <section className="mt-3 flex flex-col gap-3 rounded-[22px] border border-white/[0.09] bg-[#111416] p-4 shadow-[0_24px_80px_rgba(0,0,0,.22)] sm:p-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-violet-300" />
        <h1 className="text-sm font-semibold text-white">Retrox — live asset search &amp; build</h1>
        {tokensRemaining !== null && (
          <span className="ml-auto rounded-lg border border-white/[0.09] bg-white/[0.05] px-2 py-1 text-[11px] text-[#9fa8ac]">
            {tokensRemaining}/5 tokens
          </span>
        )}
      </div>
      <p className="text-xs leading-5 text-[#929da2]">
        Search the live Roblox catalog AND toolbox for faces, decals, meshes, images, and accessories. Retrox can't import 3D models
        directly, but it embeds real asset IDs (rbxassetid://…) directly into the Luau it writes.
      </p>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-[#0e1113] p-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/[0.15] px-3">
          <Search className="size-3.5 text-[#7f898e]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search Roblox catalog… e.g. smile face"
            className="h-9 w-full bg-transparent text-xs text-white placeholder:text-[#6c7679] focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-xl border border-white/[0.08] bg-black/[0.15] px-2 text-xs text-white focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#111416]">
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          onClick={runSearch}
          disabled={isSearching || !keyword.trim()}
          className="h-9 rounded-xl bg-violet-500/90 px-4 text-xs font-medium text-white hover:bg-violet-500"
        >
          {isSearching ? <Loader2 className="size-3.5 animate-spin" /> : "Search"}
        </Button>
      </div>
      {searchError && <p className="text-[11px] text-amber-200">{searchError}</p>}

      {/* ── Search results grid ─────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {results.map((asset) => {
            const selected = selectedAssets.some((item) => item.id === asset.id);
            return (
              <button
                key={asset.id}
                onClick={() => toggleAsset(asset)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors",
                  selected ? "border-violet-400/60 bg-violet-400/10" : "border-white/[0.07] bg-[#0e1113] hover:bg-white/[0.04]",
                )}
              >
                <div className="grid size-14 place-items-center overflow-hidden rounded-lg bg-black/20">
                  {asset.thumbnailUrl ? (
                    <img src={asset.thumbnailUrl} alt={asset.name} className="size-14 object-cover" />
                  ) : (
                    <Sparkles className="size-4 text-[#6c7679]" />
                  )}
                </div>
                <p className="line-clamp-2 text-[10px] leading-tight text-white">{asset.name}</p>
                <p className="text-[9px] text-[#7f898e]">#{asset.id}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Selected asset chips ───────────────────────────────────────── */}
      {selectedAssets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedAssets.map((asset) => (
            <span
              key={asset.id}
              className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-[10px] text-violet-200"
            >
              {asset.name}
              <button onClick={() => toggleAsset(asset)} className="ml-0.5 hover:text-white">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Chat ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-[#0e1113] p-3">
        <div className="flex max-h-[400px] flex-col gap-3 overflow-y-auto">
          {messages.length === 0 && (
            <p className="py-6 text-center text-[11px] text-[#6c7679]">
              Search an asset above, then ask Retrox to build with it — e.g. "add this face to my NPC head".
              Or just ask for a decal ID and Retrox will search live and give you the real ID.
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} className="flex flex-col gap-2">
              {/* User message */}
              {message.role === "user" && (
                <div className="max-w-[85%] self-end rounded-xl bg-violet-500/90 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-white">
                  {message.content}
                </div>
              )}

              {/* Assistant message */}
              {message.role === "assistant" && (
                <div className="flex flex-col gap-2">
                  {message.usedLiveSearch && (
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                      <Search className="size-3" />
                      Live catalog search — 2 tokens used
                    </div>
                  )}

                  {/* Asset cards found by the AI's live search */}
                  {message.assets && message.assets.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-2.5">
                      <p className="text-[10px] font-medium text-emerald-300">
                        Retrox found {message.assets.length} asset{message.assets.length > 1 ? "s" : ""}:
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {message.assets.map((asset) => (
                          <div
                            key={asset.id}
                            className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#0e1113] p-2"
                          >
                            {/* Thumbnail */}
                            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30">
                              {asset.thumbnailUrl ? (
                                <img src={asset.thumbnailUrl} alt={asset.name} className="size-12 object-cover" />
                              ) : (
                                <Sparkles className="size-3.5 text-[#6c7679]" />
                              )}
                            </div>
                            {/* Info */}
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <p className="truncate text-[11px] font-medium text-white">{asset.name}</p>
                              <p className="text-[9px] text-[#7f898e]">
                                by {asset.creatorName ?? "Unknown"}
                              </p>
                              <div className="flex items-center gap-1.5">
                                <code className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                  {asset.rbxAssetId}
                                </code>
                                <button
                                  onClick={() => copyAssetId(asset.rbxAssetId)}
                                  className="text-[#6c7679] hover:text-white"
                                  title="Copy ID"
                                >
                                  <Copy className="size-2.5" />
                                </button>
                                <a
                                  href={`https://www.roblox.com/catalog/${asset.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#6c7679] hover:text-white"
                                  title="View on Roblox"
                                >
                                  <ExternalLink className="size-2.5" />
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI response text */}
                  <div className="max-w-[90%] self-start rounded-xl bg-white/[0.06] px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-[#dfe3e5]">
                    {message.content}
                  </div>
                </div>
              )}
            </div>
          ))}
          {isSending && (
            <div className="self-start rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-[#9fa8ac]">
              <Loader2 className="inline size-3 animate-spin" /> Retrox is thinking…
              {isSending && <span className="ml-1 text-[#6c7679]">(searching live catalog if needed)</span>}
            </div>
          )}
        </div>
        {chatError && <p className="text-[11px] text-amber-200">{chatError}</p>}
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask Retrox to build something or find a decal ID…"
            className="min-h-9 flex-1 resize-none rounded-xl border-white/[0.08] bg-black/[0.15] text-xs text-white placeholder:text-[#6c7679]"
          />
          <Button
            onClick={sendMessage}
            disabled={isSending || !prompt.trim()}
            className="h-9 rounded-xl bg-violet-500/90 px-3 text-white hover:bg-violet-500"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
        <p className="text-[9px] text-[#6c7679]">
          Normal prompt = 1 token · Live catalog search = 2 tokens · 5 tokens per 48h
        </p>
      </div>
    </section>
  );
}
