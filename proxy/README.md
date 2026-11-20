# Hippocrene's Model Chat proxy

A zero-dependency CORS + SSE reverse proxy for the static chat frontend.

One implementation (`handler.js`), four ways to run it: Cloudflare Workers, Deno
Deploy, Vercel Edge Functions, and a plain Node server.

---

## Why this exists

The upstream API is `https://182.92.245.176:1920`. It speaks the OpenAI API and
works fine from `curl`. It does not work from a browser, for two independent
reasons:

1. **It sends no CORS headers at all.** A page served from
   `https://jihuiyiyou.github.io` asking for `https://182.92.245.176:1920` is a
   cross-origin request. The browser lets the request go out, reads the
   response, and then throws it away because the response has no
   `Access-Control-Allow-Origin`. From JavaScript this is indistinguishable
   from a network failure — the console only says "Failed to fetch".

2. **The `OPTIONS` preflight is answered with 401.** Any request that carries
   `Authorization` or `Content-Type: application/json` triggers a preflight
   first. The upstream's nginx layer authenticates every request, including the
   preflight, and answers `401` with an HTML error page instead of CORS
   headers. The browser never gets past this step, so the real request is never
   sent.

The server is not ours to change. So we stand in the middle: the proxy answers
the preflight itself, adds the CORS headers the upstream is missing, injects
the API key from the server side, and streams the SSE response through
untouched.

The frontend already knows how to talk to it — switch the app to "proxy" mode
and point it at the proxy's base URL.

---

## What the proxy does

| Route | Behaviour |
|---|---|
| `OPTIONS *` | Answered locally with `204` + full CORS headers. Never reaches the upstream. |
| `GET /__ping` | Real connectivity probe. Actually calls the upstream `/health` and reports latency, reachability, and the raw error. |
| `GET /v1/models` | Forwarded, with CORS headers added. |
| `POST /v1/chat/completions` | Forwarded, streamed through as `text/event-stream`. |
| `GET /health` | Forwarded. |
| anything else | `403` with the upstream's own error shape. |

Only `/v1/chat/completions`, `/v1/models`, and `/health` are allowed through —
the same three routes the upstream exposes. The proxy must not become a
general-purpose relay.

### Configuration

All platforms inject the same three variables:

| Variable | Default | Meaning |
|---|---|---|
| `UPSTREAM` | `https://182.92.245.176:1920` | Upstream base URL. Only `https` works; plain HTTP to that port gets nginx's `400 plain HTTP request was sent to HTTPS port`. |
| `API_KEY` | *(unset)* | Bearer token injected into upstream requests. **If set, it overrides whatever the client sent.** If unset, the client's `Authorization` header is passed through unchanged. |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated `Origin` allowlist. Empty means allow everything (`*`). When non-empty, only listed origins get an `Access-Control-Allow-Origin` header — for any other origin the header is simply omitted, and the browser does the blocking. |

### The API key never reaches the browser

The key lives in the proxy's environment (or as an encrypted platform secret)
and is injected server-side on every upstream request. The frontend's proxy
mode does not send an `Authorization` header at all — it asks `/__ping` whether
the proxy has a key (`hasKey`), and only sends its own key if the proxy
reports it does not.

Direct mode (no proxy) cannot offer this guarantee: a key baked into a
JavaScript bundle is readable by anyone who opens DevTools. That is why proxy
mode is the recommended setup for the GitHub Pages deployment.

---

## Deployment

### 1. Local Node server (development)

Requires Node 18 or newer (for the global `fetch`, `Request`, `Response`).

```bash
cd proxy
API_KEY=sk-your-key node server.mjs
# or
API_KEY=sk-your-key npm run dev
```

Options:

```bash
node server.mjs --port 9000            # default 8787, or set PORT
node server.mjs --upstream https://...  # or set UPSTREAM
node server.mjs --host 0.0.0.0          # default 127.0.0.1; set HOST
```

Environment variables: `PORT`, `HOST`, `UPSTREAM`, `API_KEY`, `ALLOWED_ORIGINS`.

Verify:

```bash
curl http://127.0.0.1:8787/__ping
```

### 2. Cloudflare Workers

```bash
cd proxy
npm install -g wrangler        # or: npx wrangler ...
wrangler login
wrangler secret put API_KEY    # encrypted secret, never in git
wrangler deploy
```

`wrangler.toml` holds `UPSTREAM` and `ALLOWED_ORIGINS` as plain vars (they are
public), while the key goes in as a secret. Add your own domain to
`ALLOWED_ORIGINS` before deploying to production.

Verify:

```bash
curl https://hippocrenes-model-chat-proxy.<your-subdomain>.workers.dev/__ping
```

### 3. Deno Deploy

`deno.ts` is the entry point.

```bash
deno deploy --project=<your-project> deno.ts
```

Set the environment variables in the Deno Deploy dashboard
(`UPSTREAM`, `API_KEY`, `ALLOWED_ORIGINS`).

Verify:

```bash
curl https://<your-project>.deno.dev/__ping
```

### 4. Vercel Edge Functions

Copy `vercel/edge.ts` into the `api/` directory of a Vercel project (for
example `api/edge.ts`), keeping `handler.js` next to it, then set `UPSTREAM`,
`API_KEY`, and `ALLOWED_ORIGINS` as project environment variables.

```bash
vercel deploy
```

Verify:

```bash
curl https://<your-project>.vercel.app/api/edge/__ping
```

### Self-hosting the Node server

The Node runner binds to `127.0.0.1` by default. To expose it, bind to all
interfaces and put a TLS-terminating reverse proxy in front of it:

```bash
API_KEY=sk-your-key node server.mjs --host 0.0.0.0 --port 8787
```

Keep the proxy on HTTPS. A browser page loaded over HTTPS cannot call an
`http://` proxy (mixed content), and the API key would cross the network in
clear text.

---

## Verifying a deployment

`GET /__ping` is the first thing to check after every deploy. It is a real
probe: it makes an actual request to the upstream `/health` and reports what
happened.

```bash
curl https://your-proxy.example/__ping
```

```json
{
  "ok": true,
  "upstream": "https://182.92.245.176:1920",
  "hasKey": true,
  "reachable": true,
  "latencyMs": 123,
  "error": null,
  "sample": "{\"status\":\"ok\",\"model\":\"dsv4-flash\",...}",
  "time": "2026-01-01T00:00:00.000Z",
  "upstreamStatus": 200
}
```

| Field | Meaning |
|---|---|
| `ok` | Upstream answered `2xx`. |
| `reachable` | Upstream answered at all (any status). `false` means the network path is broken. |
| `latencyMs` | Round-trip time of the probe request. |
| `error` | The raw error. `null` on success. Network failures keep the original message so you can see the actual cause. |
| `sample` | First 400 characters of the upstream response body. On success this is the upstream's JSON; on a `401` it is nginx's HTML error page. |
| `hasKey` | Whether `API_KEY` is configured on the proxy. |

`reachable: false` almost always means the platform cannot reach that
non-standard port — Cloudflare Workers in particular is inconsistent about
outbound connections to port 1920. Switch to Deno Deploy, Vercel Edge, or a
self-hosted Node server.

Other checks:

```bash
# Preflight: 204 with full CORS headers, and it must NOT reach the upstream
curl -i -X OPTIONS https://your-proxy.example/v1/chat/completions \
  -H "Origin: https://jihuiyiyou.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

# Models list: 200, JSON, CORS headers
curl -i https://your-proxy.example/v1/models -H "Authorization: Bearer sk-your-key"

# Streaming: chunks must arrive over time, not all at once
curl -N https://your-proxy.example/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"dsv4-flash","messages":[{"role":"user","content":"say hi"}],"stream":true,"reasoning_effort":"off"}'

# Path allowlist: 403 in the upstream's error shape
curl -i https://your-proxy.example/v1/embeddings -X POST
```

---

## Troubleshooting

**"Failed to fetch" in the browser, and the network tab shows no request.**
The preflight is failing. Check that the proxy answered `OPTIONS` with
`204` and an `Access-Control-Allow-Origin` header. If the origin is missing
from `ALLOWED_ORIGINS`, the header is deliberately omitted and the browser
blocks the response — add the exact origin (scheme + host + port) to the list.

**`HTTP 401` from the upstream.** The proxy has no `API_KEY` configured, or the
key is wrong. `/__ping` shows `hasKey: false` when nothing is configured. Set
the key: `wrangler secret put API_KEY` on Workers, the dashboard on Deno
Deploy and Vercel, or the `API_KEY` environment variable for Node.

**`HTTP 403` with "is not allowed on this endpoint".** Expected — the upstream
only exposes `/v1/chat/completions`, `/v1/models`, and `/health`. The proxy
enforces the same list.

**`HTTP 400` with "backend doesn't support non-stream".** The upstream requires
`"stream": true` in the request body. The frontend always sends it; a manual
`curl` must add it too.

**`502` from the proxy.** The proxy could not reach the upstream. The body
carries the original error message. Check the upstream URL, remember that only
`https` works on that port, and remember that the upstream's certificate is a
valid Let's Encrypt IP certificate (SAN contains `IP:182.92.245.176`) — so
certificate validation should pass without any workaround.

**Responses arrive all at once instead of streaming.** Something is buffering
the response. The proxy sets `X-Accel-Buffering: no` and `Cache-Control:
no-cache, no-transform` for SSE responses, but a reverse proxy in front of the
proxy may still buffer. Disable proxy buffering (`proxy_buffering off;` in
nginx) and make sure compression is off for the `text/event-stream` path.

**`Cannot read properties of undefined (reading 'get')` or odd errors right
after deploying.** Check that the entry point exports the right shape:
`export default { fetch: handleRequest }` for Workers and Deno Deploy, and a
bare `export default handleRequest` for Vercel Edge.

---

## Files

| File | Purpose |
|---|---|
| `handler.js` | Core logic. Exports `handleRequest(request, env)` and `default { fetch }`. Zero dependencies, Web standard APIs only. |
| `server.mjs` | Node runner. `node:http` plus Node 18+ globals. Streams SSE chunk by chunk. |
| `deno.ts` | Deno Deploy entry point. |
| `vercel/edge.ts` | Vercel Edge entry point. |
| `wrangler.toml` | Cloudflare Workers configuration. `API_KEY` is a secret, not a var. |
| `.dev.vars.example` | Template for `.dev.vars` (git-ignored) used by `wrangler dev`. |
