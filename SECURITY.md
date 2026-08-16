# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a private
  [security advisory](https://github.com/quappe-org/quappe-web/security/advisories/new).
- Or email **quappe-org@proton.me**.
- Include: what you found, how to reproduce it, and the potential impact.

We aim to acknowledge reports promptly and will keep you updated. Please give us
a reasonable window to remediate before any public disclosure.

## Scope

`quappe-web` is **presentation-only** — no database, no domain logic. It renders
the UI and proxies `/api/*` to `quappe-service`. Areas of interest here:

- **The reverse proxy** (`src/routes/api/[...path]`) — header/cookie handling,
  request smuggling, SSRF via the proxy target.
- **Client-side handling** — anything that leaks or mishandles the identity
  cookie, or renders untrusted content unsafely.

Almost all security-relevant logic (identity/JWT, budgets, rate limits, data
integrity) lives in **quappe-service** — see its `SECURITY.md`.

## Not in scope

- Denial of service from raw request volume.
- Issues requiring a compromised host or physical access.
