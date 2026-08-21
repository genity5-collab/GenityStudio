# Deploying RetroStudio Social and Free AI

This release deliberately does **not** contain a Groq API key in `retrostudio.html`. The Free AI provider works only after the database migration and the `free-ai` Edge Function are deployed to the same Supabase project.

## 1. Rotate the shared Groq key

The prior key was exposed outside a secret manager. Revoke it in the Groq console, create a replacement production key, and store it only as the `GROQ_API_KEY` secret in Supabase. Do not add it to the HTML file, GitHub, browser storage, or chat.

## 2. Apply the database migration

Open the Supabase project SQL Editor and run:

```sql
-- Paste the full contents of:
-- supabase/migrations/20260821_social_chat_and_free_ai.sql
```

The migration enables the required social/chat policies and creates the server-authoritative `FREE_AI_CREDITS` table. Each authenticated user receives five credits that reset every 48 hours. `consume_free_ai_credit()` locks and deducts one credit atomically, so browser-side changes cannot grant more credits.

## 3. Deploy the Edge Function

Create a new Edge Function named `free-ai` and paste the contents of:

```text
supabase/functions/free-ai/index.ts
```

Keep JWT verification enabled. Add this secret through Supabase’s Edge Function secrets interface:

```text
GROQ_API_KEY=<the newly rotated Groq key>
```

The Supabase runtime provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the function. The function accepts requests only from `https://retrostudioencoderdev.oneapp.dev`, verifies the caller’s Supabase session, allows only Auto, Fast, and Plan modes, deducts one server-side credit, and calls `openai/gpt-oss-20b` with capped output and a deliberate short delay.

## 4. Publish the updated HTML

Copy the latest `retrostudio.html` from GitHub into the publisher and publish it. The Free AI model selector should show **Server-managed Free AI key**; visitors must never see or enter the shared Groq key.

## 5. Verify as a real user

Sign in on the published site. Confirm that the following all work:

1. Search for another user and send a friend request.
2. Accept a request from the receiving account.
3. Open a chat and send a message.
4. Choose Free AI, send one Fast or Auto request, and confirm the balance falls from 5 to 4.
5. Confirm Think, Long, and Coder remain locked across every provider.
6. Confirm no dashboard or social surface displays an email address.

If a social action reports a policy error, verify that the migration was run in the same project used by the site and that the table/column names have not been renamed.
