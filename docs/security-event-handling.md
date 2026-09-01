# Security Event Retention and Operator Review

## Purpose and retention standard

`RETROSTUDIO_SECURITY_EVENTS` supports narrowly scoped anti-abuse investigation, rate-control validation, and incident response. It is not a behavioral-profile database and must never be used to make permanent automated decisions from a single event. Operational security events are retained for **30 days** from creation. After the 30-day period, they must be deleted by a server-only maintenance operation once a production scheduler is configured; the browser has no read, write, or deletion access to this table.

Until that maintenance operation is enabled in the production hosting environment, the owner must review the table at least monthly through a trusted administrative workflow and remove records older than the retention window. The scheduled cleanup must be added only after the project’s periodic-workflow design and service credentials have been reviewed; it must be idempotent, bounded, and audited.

## Data minimization boundary

| Category | Allowed in the security event record | Prohibited from the security event record |
|---|---|---|
| Account reference | Supabase user UUID only | Email address, OAuth access token, refresh token, or identity-provider profile data |
| Device signal | SHA-256-compatible 64-character device hash only | Raw device cookie, browser fingerprint payload, IP address, hardware identifier, or user-agent string |
| Request context | Operation category, opaque request identifier, cost category, and decision category | Submitted Lua source, encoded result, AI prompt, model response, or private encoder mapping |
| Challenge result | Coarse success/failure decision and timestamp when needed | Turnstile response token, Turnstile secret, challenge payload, or enterprise fingerprint metadata |

## Operator review procedure

An operator should review an account only when a private risk restriction, temporary challenge pattern, moderation report, or verified anomaly warrants it. The review begins with the minimal decision metadata: the event type, time range, rate-window summary, token-ledger entries, and current moderation state. The operator may apply a proportional server-side restriction or remove one after verifying the context; they must not infer identity from device hashes or use stored security events to target unrelated accounts.

Every manual moderation action remains subject to the existing protected moderation audit path. The operator should record a concise reason, avoid copying source content or credentials into free-text notes, and use the smallest effective restriction. Permanent bans, account deletion, role changes, owner allowance changes, and token adjustments require their separate dedicated controls; this event table does not authorize any of them.

## Review safeguards

The browser cannot retrieve raw security events, calculate a risk score, or submit a trusted risk outcome. FastAPI receives only the safe database decision code it needs to present a generic user message. Access to raw event records is limited to the production service role and the owner’s approved administrative workflow. Any future analytics export must aggregate counts and must not include user UUIDs or device hashes.
