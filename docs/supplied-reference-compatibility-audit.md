# Supplied Reference Compatibility Audit

## Reference examined

The user supplied `RetroStudio_Download_This_File_2026.html` on 2026-08-25 as a compatibility reference. The file presents itself as **“RetroStudio — Luau Encoder & AI”** and contains the familiar combined encoder, Retrox, social, account, moderation, and update-log user experience.

## Encoder-facing behavior to preserve

The visible UI definitions include an encoded-result card, encoded-output region, success/status presentation, block/count-oriented metadata, and an explicit primary copy action. The secure rebuild should preserve this user contract: submit source, show a concise server result and conversion summary, make the final encoded string easy to copy, and display safe unsupported-feature information. The user should not need to manually re-paste an encoded output into a separate area.

## Security and compatibility constraints

The reference loads browser CDN copies of `pako` and Supabase JavaScript and places a very large, obfuscated implementation inside a single script block. Its hidden catalog, transformation rules, output encoding path, and browser authority logic are therefore accessible to any visitor. This is **not** an acceptable deployment model for the new secure application.

The reference is a behavioral target, not a source file to ship or directly execute. The secure port must reproduce only validated output semantics inside the private Python encoder package. The React client will send source text and display the server response; it will not receive catalog mappings, serialization/compression implementation, provider prompts, or privileged Supabase behavior.

The first private fixture now proves exact parity for its serialized block stream. The legacy browser’s `pako` compressor and the Python runtime can select different, yet valid, raw-DEFLATE byte streams for the same serialized input. Therefore, parity is gated on exact serialized blocks together with a successful base-93/raw-DEFLATE decode back to those blocks; it is not gated on an unnecessary byte-for-byte match of a compressor-specific stream.

## Required parity work

| Requirement | Secure implementation boundary |
|---|---|
| Legacy-compatible encoded result | Private Python transformer with golden test vectors; no browser implementation. |
| Encoded-result card and copy action | React UI, using only an encoded string returned by FastAPI after server authorization and finalization. |
| Unsupported syntax or block handling | Server produces structured safe skip/error metadata; client renders it without inference. |
| Compression/serialization compatibility | Private implementation must validate its deterministic byte/text output against approved legacy fixtures before activation. |
| Credits, owner allowance, and anti-abuse | Existing service-role Supabase authorization and finalization procedures; never controlled by this reference HTML. |

## Current conclusion

**Yes:** the supplied file demonstrates the expected *user experience*—especially generating a copyable encoded result rather than returning raw Lua. **No:** its browser-resident encoder cannot be reused as the new public implementation. The secure app will enable its Encode control only after a server-only compatibility port produces verified, matching outputs.
