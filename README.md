# quappe-web

The Quappe **browser UI** — a presentation-only SvelteKit app that consumes the
[quappe-service](https://github.com/quappe-org/quappe-service) API. No domain
logic, no database: it renders and calls endpoints.

Editorial, calm, top-down design. Two axes of reader control: amount (Fibonacci
complexity slider) and density (author reading registers). Themes + accessibility
modes. i18n (en/de/fr/es via Paraglide).

## Run

Needs a running `quappe-service` (default `http://localhost:5273`).

```bash
npm install
PRIVATE_SERVICE_URL=http://localhost:5273 npm run dev   # http://localhost:5173
npm run check
```

## How it talks to the service

`src/routes/api/[...path]/+server.ts` is a reverse proxy: every `fetch('/api/…')`
in the UI is forwarded to `PRIVATE_SERVICE_URL`. This keeps the browser
same-origin (no CORS) and lets the httpOnly identity cookie stay first-party.
In production, point `PRIVATE_SERVICE_URL` at the internal service address.

## Part of the Quappe platform

- **quappe-service** — API + DB + logic (the contract).
- **quappe-web** — this repo.
- **quappe-ops / quappe-insight / quappe-docs** — later.

## License

PolyForm Noncommercial 1.0.0 — see [`LICENSE`](./LICENSE).
