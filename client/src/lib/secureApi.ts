export type EncodeMode = "default" | "strict";

export type SecureEncodeResult = {
  encoded: string;
  blocks: number;
  skippedFeatures: string[];
  tokensRemaining: number;
  auditedCompatibility: boolean;
};

export type SecureDecodeResult = {
  valid: boolean;
  blocks: number;
  auditedCompatibility: boolean;
};

export class SecureApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SecureApiError";
  }
}

const DEVICE_COOKIE = "retrostudio_device";
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

function createOpaqueDeviceValue(): string {
  const values = new Uint8Array(32);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getOpaqueDeviceHash(): Promise<string> {
  let opaqueValue = readCookie(DEVICE_COOKIE);
  if (!opaqueValue) {
    opaqueValue = createOpaqueDeviceValue();
    const secureAttribute = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(DEVICE_COOKIE)}=${opaqueValue}; Path=/; SameSite=Strict; Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}${secureAttribute}`;
  }
  return sha256Hex(opaqueValue);
}

function secureApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!configured) {
    throw new SecureApiError("SERVICE_UNAVAILABLE", "The secure encoder endpoint is not configured.", 503);
  }
  const parsed = new URL(configured);
  const localDevelopment = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new SecureApiError("SERVICE_UNAVAILABLE", "The secure encoder endpoint must use HTTPS.", 503);
  }
  return parsed.toString().replace(/\/$/, "");
}

function newRequestId(): string {
  return crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, "");
}

export async function encodeWithSecureApi(input: {
  source: string;
  mode: EncodeMode;
  accessToken: string;
  turnstileToken?: string;
}): Promise<SecureEncodeResult> {
  if (!input.accessToken.trim()) {
    throw new SecureApiError("AUTH_REQUIRED", "Sign in to continue.", 401);
  }

  const response = await fetch(`${secureApiBaseUrl()}/api/encoder/encode`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: input.source,
      mode: input.mode,
      device_hash: await getOpaqueDeviceHash(),
      request_id: newRequestId(),
      ...(input.turnstileToken ? { turnstile_token: input.turnstileToken } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | SecureEncodeResult
    | { code?: string; message?: string }
    | null;
  if (!response.ok) {
    const error = payload as { code?: string; message?: string } | null;
    throw new SecureApiError(error?.code ?? "SERVICE_UNAVAILABLE", error?.message ?? "The secure encoder request failed.", response.status);
  }
  return payload as SecureEncodeResult;
}

export async function decodeWithSecureApi(input: {
  encoded: string;
  accessToken: string;
  turnstileToken?: string;
}): Promise<SecureDecodeResult> {
  if (!input.accessToken.trim()) {
    throw new SecureApiError("AUTH_REQUIRED", "Sign in to continue.", 401);
  }

  const response = await fetch(`${secureApiBaseUrl()}/api/encoder/decode`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      encoded: input.encoded,
      device_hash: await getOpaqueDeviceHash(),
      request_id: newRequestId(),
      ...(input.turnstileToken ? { turnstile_token: input.turnstileToken } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | SecureDecodeResult
    | { code?: string; message?: string }
    | null;
  if (!response.ok) {
    const error = payload as { code?: string; message?: string } | null;
    throw new SecureApiError(error?.code ?? "SERVICE_UNAVAILABLE", error?.message ?? "The secure decoder request failed.", response.status);
  }
  return payload as SecureDecodeResult;
}
