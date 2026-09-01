# Private Encoder Parity Acceptance Criteria

The public **Encode** control remains disabled until the server-only compiler satisfies every criterion in this document. This avoids presenting a partial transformation subset as a compatible production encoder.

## Fixture rule

> Each golden fixture is generated only by the audited legacy parser path in an isolated, non-browser process. It is stored under `backend/tests/fixtures/`, never imported by the React client, and never derived from user-submitted production content.

| Acceptance area | Required evidence before activation |
|---|---|
| Block serialization | The private compiler exactly matches the legacy serialized block stream for every accepted fixture. |
| Transport | The private CoolFormat envelope has the required header and base-93/raw-DEFLATE decodes to the exact accepted serialized stream. Different valid raw-DEFLATE byte choices are permitted only when they decode to the same stream. |
| Safe skip behavior | Unsupported forms preserve supported neighboring statements and return the expected concise skip record; they never cause arbitrary execution. |
| Legacy forms | Fixture coverage includes object creation/properties, values and tables, basic control flow, callbacks/events, modern Luau normalization, and safe unsupported forms. |
| Operational bounds | Source, encoded output, timeout, and concurrency tests pass; a transformation failure or timeout never finalizes a token debit. |
| Security boundary | Browser source and production assets contain no catalog templates, parser/serializer implementation, privileged RPC name, service credential, or private prompt. |

## Current evidence

The suite currently covers audited object/color/vector construction, a strict-mode declaration with tables and basic `if`, a `Part.Touched` callback, and a safe unsupported-call skip. These fixtures validate the private compiler foundation but do **not** represent full legacy parser coverage. Broader logic, services, GUI, data persistence, loops, functions, and remaining catalog mappings must be added before activation.

## Sign-off gate

Before enabling the endpoint and client button, the full test suite must pass, the accepted fixture inventory must be reviewed, production output limits must remain enabled, and the server authorization-to-transform-to-finalization path must be exercised without charging a failed transformation. OAuth/provider configuration and Render secret configuration are separate production prerequisites.
