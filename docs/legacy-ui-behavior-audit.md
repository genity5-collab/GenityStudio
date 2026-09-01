# Legacy UI and Workflow Audit

The supplied HTML opens on a compact, centered dark authentication card. Its hierarchy places a narrow top control area above a small **RetroStudio** title, the subtitle **“Encoder · 76 Blocks · AI”**, a high-contrast Discord sign-in button, and a simple password fallback. This is much denser and more familiar than the current wide dashboard shell.

Static controls identify distinct AI, encoder, social, and dashboard tabs (`tabAi`, `tabEnc`, `tabSocial`, and `tabDash`), as well as a model/mode area and a dedicated output-copy action (`copyBtn`). The secure redesign should therefore use a compact tabbed studio rather than a large marketing-style hero, with the encoder tab foregrounded and a clear copyable result panel.

The supplied page could not expose its authenticated encoder/decode panel without a user session. The redesign will preserve the observed compact dark rhythm and known user contract—source input, encode/decode mode, concise status, result, and copy—but will not replicate the browser-resident encoder, credentials, or token decisions.
