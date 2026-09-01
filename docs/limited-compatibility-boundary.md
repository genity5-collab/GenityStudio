# Limited Protected Compatibility Boundary

The secure application may expose a **limited compatibility path** before the full legacy encoder port is complete. This is a truthful opt-in for audited forms, not a claim that every historical RetroStudio script is compatible.

## Audited encode subset

The private compiler currently has retained legacy fixtures for object creation and properties, physical-part properties including BrickColor, Material, an inline `Vector3.new` form such as Orientation, and a three-coordinate `CFrame.new` position form, Color3-to-BrickColor, Vector3, common GUI `UDim2.new`, `Color3.fromRGB`, and `Color3.new` properties, one anonymous `MouseButton1Click` callback form, basic tables, strict-mode declarations, `if`/`else`, numeric `for`, `Part.Touched` callbacks, simple `print`, waits, and concise unsupported-call skips. `UDim2.fromOffset`, `UDim.new` corner-radius assignments, named GUI callback functions, and `MouseButton1Down` callbacks are intentionally retained as verified skips because the audited legacy implementation does not encode their event behavior. The compiler preserves verified historical output behavior for these forms; it does not evaluate Luau, load modules, access Roblox services, or perform network operations.

## Decode contract

CoolFormat is a serialized block format, not a reversible Lua source archive. The protected decode endpoint therefore validates the envelope, safely inflates it under strict limits, and returns a minimal structural result: validity, user-block count, and whether the payload is within the audited format boundary. It does **not** return raw private catalog templates, server mappings, or a fabricated Lua reconstruction.

## Protection rules

Both modes require a verified Supabase session, opaque device hash, request identifier, and server-side authorization/rate/risk decision. Encode finalizes token use only after a successful transformation. Decode does not change balances, but it still uses the protected authorization gate and bounded concurrency. Neither result can enable browser-side token, role, moderation, or provider decisions.

## Activation rule

The limited path is controlled by a server-only setting. The UI must say **“audited compatibility”** when it is enabled and must preserve a full-parity status for unsupported syntax. The legacy-style interface may always be visible, but no public conversion action is active until the secure API URL and deployment secrets are configured.
