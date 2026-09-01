import { createClient, type AuthChangeEvent, type Session, type Subscription } from "@supabase/supabase-js";

import { SecureApiError } from "./secureApi";

export type SupportedOAuthProvider = "google" | "discord";

let browserClient: ReturnType<typeof createClient> | null = null;

function publicAuthConfiguration(): { url: string; key: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new SecureApiError("SERVICE_UNAVAILABLE", "Secure sign-in is not configured yet.", 503);
  }
  return { url, key };
}

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const { url, key } = publicAuthConfiguration();
    browserClient = createClient(url, key, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return browserClient;
}

export async function startOAuthSignIn(provider: SupportedOAuthProvider): Promise<void> {
  const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) {
    throw new SecureApiError("AUTH_UNAVAILABLE", "Secure sign-in could not start. Please try again later.", 503);
  }
}

export async function readAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export function observeAuthSession(callback: (session: Session | null) => void): Subscription {
  const { data } = getSupabaseBrowserClient().auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
    callback(session);
  });
  return data.subscription;
}
