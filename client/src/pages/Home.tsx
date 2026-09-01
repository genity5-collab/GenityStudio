import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decodeWithSecureApi, encodeWithSecureApi, SecureApiError } from "@/lib/secureApi";
import { cn } from "@/lib/utils";
import { observeAuthSession, readAccessToken, startOAuthSignIn, type SupportedOAuthProvider } from "@/lib/supabaseClient";
import {
  Braces,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Copy,
  FileCode2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type StudioTab = "encoder" | "retrox" | "social";
type ConversionMode = "encode" | "decode";
type ConversionStatus = "idle" | "loading" | "success" | "error";

const studioTabs: Array<{ id: StudioTab; label: string; icon: typeof Code2 }> = [
  { id: "encoder", label: "Encoder", icon: Code2 },
  { id: "retrox", label: "Retrox", icon: Sparkles },
  { id: "social", label: "Social", icon: Users },
];

const sourcePlaceholder = {
  encode: 'local part = Instance.new("Part")\npart.Name = "Foundation"\npart.Parent = workspace',
  decode: "Paste a CoolFormat payload to validate and decode through the protected service…",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<StudioTab>("encoder");
  const [mode, setMode] = useState<ConversionMode>("encode");
  const [source, setSource] = useState("");
  const [copied, setCopied] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const [conversionResult, setConversionResult] = useState("");
  const [conversionSummary, setConversionSummary] = useState("Audited compatibility is available only through the protected service.");
  const [conversionStatus, setConversionStatus] = useState<ConversionStatus>("idle");
  const [isAuthOptionsOpen, setIsAuthOptionsOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    let active = true;
    void readAccessToken().then((token) => {
      if (active) setIsSignedIn(Boolean(token));
    });
    const subscription = observeAuthSession((session) => setIsSignedIn(Boolean(session)));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const sourceSummary = useMemo(() => {
    const lines = source ? source.split(/\r?\n/).length : 0;
    return `${source.length.toLocaleString()} characters${lines ? ` · ${lines} lines` : ""}`;
  }, [source]);

  const copySource = async () => {
    if (!source) return;
    await navigator.clipboard?.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const beginOAuth = async (provider: SupportedOAuthProvider) => {
    setIsSigningIn(true);
    setAuthMessage("");
    try {
      await startOAuthSignIn(provider);
    } catch {
      setAuthMessage("Secure sign-in is not available yet. Please try again later.");
      setIsSigningIn(false);
    }
  };

  const runConversion = async () => {
    if (!source.trim()) {
      setConversionStatus("error");
      setConversionSummary(`Paste ${mode === "encode" ? "Luau source" : "a CoolFormat payload"} first.`);
      return;
    }
    const accessToken = await readAccessToken();
    if (!accessToken) {
      setConversionStatus("error");
      setConversionSummary("Sign in with a verified provider before using the protected converter.");
      return;
    }

    setConversionStatus("loading");
    setConversionResult("");
    setConversionSummary(`Submitting ${mode} request to the protected service…`);
    try {
      if (mode === "encode") {
        const result = await encodeWithSecureApi({ source, mode: "default", accessToken });
        setConversionResult(result.encoded);
        setConversionSummary(`${result.blocks} blocks · ${result.skippedFeatures.length} skipped · ${result.tokensRemaining} tokens remaining · audited compatibility`);
      } else {
        const result = await decodeWithSecureApi({ encoded: source, accessToken });
        setConversionResult(`CoolFormat payload verified\n${result.blocks} serialized blocks\nAudited compatibility: ${result.auditedCompatibility ? "yes" : "no"}`);
        setConversionSummary("Validated safely. Structural decode does not expose private catalog mappings or reconstruct unverified Lua.");
      }
      setConversionStatus("success");
    } catch (error) {
      const message = error instanceof SecureApiError ? error.message : "The protected converter is temporarily unavailable.";
      setConversionStatus("error");
      setConversionSummary(message);
    }
  };

  const copyResult = async () => {
    if (!conversionResult) return;
    await navigator.clipboard?.writeText(conversionResult);
    setResultCopied(true);
    window.setTimeout(() => setResultCopied(false), 1400);
  };

  return (
    <div className="min-h-screen bg-[#090b0d] px-3 py-4 text-[#f5f7f8] sm:px-6 sm:py-8">
      <main className="mx-auto max-w-[1120px]">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#111416] px-4 py-3 shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[radial-gradient(circle_at_28%_22%,#9dffde,transparent_34%),linear-gradient(135deg,#3d5afe,#8b5cf6)] shadow-[0_8px_24px_rgba(99,102,241,.34)]">
              <Braces className="size-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.02em] text-white">RetroStudio</p>
              <p className="truncate text-[11px] text-[#8f979b]">Encoder · secure compatibility workspace</p>
            </div>
          </div>

          <div className="relative shrink-0">
            <Button
              onClick={() => setIsAuthOptionsOpen((open) => !open)}
              className="h-9 rounded-xl border border-white/[0.09] bg-white/[0.07] px-3 text-xs font-medium text-white hover:bg-white/[0.12]"
              aria-expanded={isAuthOptionsOpen}
            >
              <ShieldCheck className="mr-1.5 size-3.5 text-emerald-300" />
              <span className="hidden xs:inline">{isSignedIn ? "Signed in" : "Sign in"}</span>
              <span className="xs:hidden">{isSignedIn ? "In" : "Sign in"}</span>
              <ChevronDown className="ml-1.5 size-3.5 text-[#aeb5ba]" />
            </Button>
            {isAuthOptionsOpen && (
              <div className="absolute right-0 top-[calc(100%+0.55rem)] z-30 w-56 rounded-2xl border border-white/[0.1] bg-[#171b1e] p-2 shadow-2xl">
                <p className="px-2 pb-2 text-[11px] leading-4 text-[#9fa8ac]">Use a verified identity. Tokens and permissions remain server-owned.</p>
                {(["discord", "google"] as const).map((provider) => (
                  <Button
                    key={provider}
                    variant="ghost"
                    className="h-9 w-full justify-start rounded-xl px-3 text-xs capitalize text-white hover:bg-white/[0.08]"
                    onClick={() => beginOAuth(provider)}
                    disabled={isSigningIn}
                  >
                    Continue with {provider}
                  </Button>
                ))}
                {authMessage && <p className="px-2 pb-1 pt-2 text-[11px] leading-4 text-amber-200">{authMessage}</p>}
              </div>
            )}
          </div>
        </header>

        <nav className="mt-3 flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0e1113] p-1.5" aria-label="Studio tabs">
          {studioTabs.map(({ id, label, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors",
                  selected ? "bg-[#252a2e] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.09)]" : "text-[#8f989d] hover:bg-white/[0.045] hover:text-white",
                )}
                onClick={() => setActiveTab(id)}
              >
                <Icon className={cn("size-3.5", selected ? "text-violet-300" : "text-[#768085]")} />
                {label}
              </button>
            );
          })}
          <div className="ml-auto hidden items-center gap-1.5 pr-2 text-[11px] text-[#7f898e] sm:flex">
            <LockKeyhole className="size-3.5 text-emerald-300" />
            Server protected
          </div>
        </nav>

        {activeTab === "encoder" ? (
          <section className="mt-3 overflow-hidden rounded-[22px] border border-white/[0.09] bg-[#111416] shadow-[0_24px_80px_rgba(0,0,0,.22)]">
            <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-xl border border-violet-300/15 bg-violet-400/10 text-violet-200">
                  <FileCode2 className="size-[18px]" />
                </div>
                <div>
                  <h1 className="text-sm font-semibold text-white">Luau converter</h1>
                  <p className="mt-0.5 text-[11px] text-[#90999e]">Legacy-style workflow, protected service boundary.</p>
                </div>
              </div>
              <div className="inline-flex w-full rounded-xl border border-white/[0.08] bg-black/20 p-1 sm:w-auto">
                {(["encode", "decode"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setMode(option);
                      setSource("");
                      setConversionResult("");
                      setConversionStatus("idle");
                      setConversionSummary("Audited compatibility is available only through the protected service.");
                    }}
                    className={cn(
                      "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors sm:flex-none",
                      mode === option ? "bg-[#343b40] text-white shadow-sm" : "text-[#8f999e] hover:text-white",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,.92fr)]">
              <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0d0e]">
                <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-md bg-white/[0.06] text-[10px] font-bold text-[#bcc4c8]">1</span>
                    <span className="text-xs font-medium text-[#dfe4e6]">{mode === "encode" ? "Source Luau" : "Encoded input"}</span>
                  </div>
                  <button onClick={copySource} className="flex items-center gap-1.5 text-[11px] text-[#95a0a5] hover:text-white" disabled={!source}>
                    {copied ? <Check className="size-3.5 text-emerald-300" /> : <Clipboard className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <Textarea
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder={sourcePlaceholder[mode]}
                  className="min-h-[300px] resize-y rounded-none border-0 bg-transparent px-3.5 py-3 font-mono text-[12px] leading-6 text-[#dde4e7] placeholder:text-[#4d575c] focus-visible:ring-0"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between border-t border-white/[0.07] px-3.5 py-2.5 text-[11px] text-[#808a8f]">
                  <span>{sourceSummary}</span>
                  <span className="hidden sm:inline">Input limits verified by server</span>
                </div>
              </section>

              <section className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-dashed border-violet-300/20 bg-[radial-gradient(circle_at_50%_8%,rgba(139,92,246,.14),transparent_36%),#0c0f11]">
                <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-md bg-violet-400/10 text-[10px] font-bold text-violet-200">2</span>
                    <span className="text-xs font-medium text-[#e4defd]">{mode === "encode" ? "Encoded result" : "Decoded result"}</span>
                  </div>
                  <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.12em]", conversionStatus === "error" ? "border-rose-300/15 bg-rose-300/[0.07] text-rose-200" : "border-emerald-300/10 bg-emerald-300/[0.07] text-emerald-200")}>
                    {conversionStatus === "loading" ? "Working" : conversionStatus === "success" ? "Verified" : conversionStatus === "error" ? "Needs attention" : "Protected"}
                  </span>
                </div>
                <div className="flex flex-1 flex-col px-5 py-5 text-center">
                  {conversionResult ? (
                    <pre className="m-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/[0.07] bg-black/20 p-3 text-left font-mono text-[11px] leading-5 text-[#e2e6e8]">{conversionResult}</pre>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center">
                      <div className="grid size-12 place-items-center rounded-2xl border border-white/[0.09] bg-white/[0.045] text-violet-200 shadow-[0_12px_30px_rgba(0,0,0,.2)]">
                        {conversionStatus === "loading" ? <RefreshCw className="size-5 animate-spin" /> : <LockKeyhole className="size-5" />}
                      </div>
                      <h2 className="mt-4 text-sm font-semibold text-white">{conversionStatus === "error" ? "Converter needs attention" : `Ready for the protected ${mode}`}</h2>
                    </div>
                  )}
                  <p className="mx-auto mt-4 max-w-xs text-xs leading-5 text-[#8e999e]">{conversionSummary}</p>
                </div>
                <div className="border-t border-white/[0.07] p-3">
                  {conversionResult ? (
                    <Button onClick={copyResult} className="h-10 w-full rounded-xl bg-violet-500/35 text-xs font-medium text-violet-50 hover:bg-violet-500/45">
                      {resultCopied ? "Copied result" : "Copy verified result"}
                      {resultCopied ? <Check className="ml-2 size-3.5" /> : <Copy className="ml-2 size-3.5" />}
                    </Button>
                  ) : (
                    <Button onClick={runConversion} disabled={conversionStatus === "loading" || !source.trim() || !isSignedIn} className="h-10 w-full rounded-xl bg-violet-500/35 text-xs font-medium text-violet-50 hover:bg-violet-500/45 disabled:bg-violet-500/20 disabled:text-violet-100/70">
                      {conversionStatus === "loading" ? "Contacting secure service" : mode === "encode" ? "Encode securely" : "Decode securely"}
                      <RefreshCw className={cn("ml-2 size-3.5", conversionStatus === "loading" && "animate-spin")} />
                    </Button>
                  )}
                </div>
              </section>
            </div>

            <footer className="flex flex-col gap-2 border-t border-white/[0.07] bg-black/[0.12] px-4 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-2 text-[#9ba5aa]">
                <ShieldCheck className="size-3.5 text-emerald-300" />
                Browser changes cannot grant tokens or alter compatibility rules.
              </div>
              <div className="flex items-center gap-1.5 text-[#7f898e]">
                <Copy className="size-3.5" />
                Copy action appears with the verified result
              </div>
            </footer>
          </section>
        ) : (
          <section className="mt-3 rounded-[22px] border border-white/[0.09] bg-[#111416] p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,.22)] sm:p-9">
            {activeTab === "retrox" ? <MessageSquareText className="mx-auto size-6 text-violet-300" /> : <Users className="mx-auto size-6 text-sky-300" />}
            <h1 className="mt-3 text-base font-semibold text-white">{activeTab === "retrox" ? "Retrox workspace" : "Social workspace"}</h1>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#929da2]">This section will follow the same compact dark layout once its protected service contracts are moved from the legacy browser implementation.</p>
          </section>
        )}
      </main>
    </div>
  );
}
