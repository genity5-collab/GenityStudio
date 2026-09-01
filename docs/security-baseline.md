# Production Security Baseline

The initial production review confirmed that the existing token, device-claim, account-guard, owner-allowlist, moderation, and audit tables have RLS enabled. The current guarded token procedures preserve the eligible 15-token reset every 48 hours, restrict starter allocation to mature Discord or Google identities, protect the owner exception through a private allowlist, and use only hashed device values.

The review also identified a public `SECURITY DEFINER` event-trigger helper that had no legitimate browser-facing purpose. Its anonymous and authenticated execution rights were revoked and verified as unavailable to both browser roles.

The advisor continues to report intentionally private RLS tables without browser policies, which is expected when all access is server-only. It also reports signed-in access to several legacy security-definer RPCs. The migration will replace browser calls to sensitive operations with the FastAPI/Supabase server workflow, then reduce those public RPC grants to the minimum legitimate read-only surface. Existing social and moderation behavior will be preserved through authenticated routes rather than hidden client checks.

No credential values, user identifiers, or private database content are included in this report.

## Post-migration advisor review

The post-migration advisor review reported no new warning for the service-role-only encoder authorization, eligibility, or finalization functions. The new rate-window, request-guard, risk-state, security-event, and token-ledger tables are deliberately reported as RLS-enabled tables without browser policies. This is expected: every browser privilege is revoked, RLS is forced, and only the service role accesses them through narrowly scoped private procedures.

Legacy warnings remain for existing signed-in `SECURITY DEFINER` social, moderation, token, and release-log functions, as well as several legacy functions with a mutable search path. They must be inventoried and migrated one capability at a time to protected server endpoints before their grants are revoked or implementation is changed. Changing those legacy functions in this milestone could break friends, moderation, and historical token behavior, so the new encoder path does not depend on them for authorization or finalization.

The Supabase advisor’s RLS-without-policy explanation is available in the [official database linter reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and its guidance on signed-in `SECURITY DEFINER` functions is available in the [corresponding function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
