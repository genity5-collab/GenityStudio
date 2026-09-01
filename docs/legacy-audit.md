# Legacy RetroStudio Audit

The legacy application is a single browser-delivered HTML file of approximately 457 KB. Its useful user-facing surface includes the Lua/Luau-to-CoolFormat encoder, Retrox AI modes, server-side verified Roblox asset search, Discord-oriented OAuth/linking, social friends and chat, moderation notices, a RetroCoder notice channel, owner administration, runtime feature controls, and public release notes.

## Preserved feature surface

| Area | Existing behavior to preserve | Secure migration destination |
|---|---|---|
| Encoder | Accept Luau, skip unsupported syntax safely, normalize physical-part colors, emit the existing `0000000000000004` CoolFormat header, and provide copy/download output | Private FastAPI encoder module |
| Retrox | AI plans/build responses, authoritative token display, protected provider routing, and verified Roblox decal/audio/mesh search | Authenticated server endpoint plus existing private Supabase data procedures |
| OAuth | Discord sign-in/linking, with Google requested as an additional approved provider | Supabase Auth with server-side JWT validation and configured OAuth providers |
| Social | Search, friend requests, friend list, direct messages, read state, and account relationships | Supabase RLS and authenticated procedures |
| Moderation | Ban, warning, unban, broadcast, account deletion, and owner-controlled runtime/release-log controls | Private Supabase owner allowlist and audited server procedures |

## Trust and exposure findings

The legacy browser directly implements the encoder transformation and formatting rules, which makes proprietary behavior downloadable. It also presents local UI checks for identity, role, mode access, and operational state. Although the existing database hardening already protects several server-side values, the client must be treated as untrusted and no longer contain private encoder, AI contract, or privileged decision logic.

The browser invokes social, moderation, token-status, release-log, and entitlement RPCs. The secure rebuild will retain those behaviors through narrow authenticated routes while treating every user-supplied identifier, role, price, balance, provider, and action parameter as untrusted. The audit records configuration-location findings without reproducing any credentials.
