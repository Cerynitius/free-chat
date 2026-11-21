# Hippocrene's Model Chat proxy

A zero-dependency CORS + SSE reverse proxy for the static chat frontend.

One implementation (`handler.js`), several ways to run it: a GitHub Actions
runner (the default), a plain Node server, a Cloudflare quick tunnel in front of
that server, Vercel on the Node runtime, Deno Deploy, and Cloudflare Workers.

**The default setup costs nothing and needs no account.** The proxy runs on a
GitHub Actions runner — Actions minutes are free for a public repository — and
the site on GitHub Pages talks to a fixed Cloudflare Worker address that follows
the tunnel. See [Deployment](#deployment).

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

The frontend talks to it through one build-time variable: set `VITE_PROXY_URL`
to the proxy's base URL and the app routes every request through it. Locally
that variable defaults to `http://127.0.0.1:8787`, which is where
`npm run proxy` listens.

---

## It cannot run on Cloudflare Workers

The upstream is reached over TLS at a bare IP address, `182.92.245.176:1920`.
There is no domain name for it, and its certificate names only that IP. That
combination is what rules the Workers deployment out. Measured, not assumed:

| Attempt | Result |
|---|---|
| `fetch()` straight to the bare IP | `HTTP 403` with Cloudflare error `1003`. The edge does not connect to IP addresses. |
| `fetch()` to a wildcard DNS name pointing at the same IP (`nip.io`, `sslip.io`) | `HTTP 526 Invalid SSL Certificate`. The certificate names the IP, not the host. |
| `resolveOverride`, in either direction | `1003` and `526` again. |
| The IP in other spellings: IPv4-mapped IPv6, trailing dot, octal, hexadecimal | `1003` every time. The edge normalizes the address before it checks it. |
| `cloudflare:sockets` on the free plan | Plain TCP connects, but `secureTransport: 'on'` silently degrades to cleartext and the upstream answers `400 The plain HTTP request was sent to HTTPS port`. `startTls()` throws. TLS over sockets needs the Workers Paid plan. |

The conclusion is one rule: **the proxy has to run on a machine with
unrestricted network access** — an ordinary container or a virtual machine.

That rules out the *proxy* on Workers. It does not rule out the *Worker* as a
front door: the Worker only has to fetch an ordinary hostname, and the tunnel
address is one. So the Worker is used here as the fixed entry point in front of
the tunnel, not as the place where the proxy runs. See
[Deployment](#deployment).

---

## What the proxy does

| Route | Behaviour |
|---|---|
| `OPTIONS *` | Answered locally with `204` + full CORS headers. Never reaches the upstream. |
| `GET /__ping` | Real connectivity probe. Actually calls the upstream `/health` and reports latency, reachability, and the raw error. |
| `GET /v1/models` | Forwarded, with CORS headers added. |
| `POST /v1/chat/completions` | Forwarded, streamed through as `text/event-stream`. |
| `GET /health` | Forwarded. |
| `GET /tools/search?q=` | Answered here. Searches the web and returns `{ok, source, results}`. |
| `GET /tools/fetch?url=` | Answered here. Fetches a page and returns `{ok, url, title, text}`. |
| `POST /tools/ocr` | Answered here. Image bytes in, recognised text out. Also takes `?url=` instead of a body. |
| `POST /tools/document` | Answered here. Document bytes in, text out. Takes `?filename=`, and `?offset=` / `?limit=` to page through it. |
| anything else | `403` with the upstream's own error shape. |

Only `/v1/chat/completions`, `/v1/models`, and `/health` are allowed through to
the upstream — the same three routes the upstream exposes. The proxy must not
become a general-purpose relay. The four `/tools/*` routes never reach the
upstream: they are the proxy's own work.

### The tool routes

The browser cannot reach a search engine or a web page on its own — neither
sends CORS headers — so those requests have to come from a server. The proxy
does them.

**Search** tries four backends in this order and takes the first that answers:
a self-hosted SearXNG (`SEARXNG_URL`), the Brave API (`BRAVE_API_KEY`), the
Tavily API (`TAVILY_API_KEY`), and finally the Bing result page. The last one
needs no account, but it is a fallback and not a promise — the page layout can
change under it, and search engines rate-limit by address.

**Fetch** goes through Jina Reader first, which returns clean markdown and
handles pages that need JavaScript. If that fails the proxy extracts the text
itself. Either way the URL is checked first: only `http` and `https`, and the
address the name resolves to must not be a private, loopback, link-local or
reserved one. The proxy is on the public internet and the model picks these
URLs, so without that check it would be a way into the machine it runs on.

**OCR and documents** need a parser, and parsers need a real runtime — the
Workers edge and Vercel Edge cannot run them. They live in a small Python
service next to the proxy, `doc_service.py`, and the proxy forwards the bytes
to it. When the proxy runs as a front door in front of a tunnel, it forwards
the tool routes to the tunnel as well, because that is where the service is.

The service is optional. Without it, everything else works and the two routes
that need it answer that the service is not running.

```bash
pip install -r requirements-doc.txt
npm run doc          # or: node doc.mjs --port 8788
```

### Configuration

All platforms inject the same variables:

| Variable | Default | Meaning |
|---|---|---|
| `UPSTREAM` | `https://182.92.245.176:1920` | Upstream base URL. Only `https` works; plain HTTP to that port gets nginx's `400 plain HTTP request was sent to HTTPS port`. |
| `UPSTREAM_POINTER` | *(unset)* | URL of a publicly readable text file whose content is the current upstream address. When it is set, the proxy fetches that file at runtime and uses what it finds as the upstream. See [The upstream pointer](#the-upstream-pointer). It also marks this deployment as a front door: the tool routes are then forwarded to the tunnel instead of answered here. |
| `API_KEY` | *(unset)* | Bearer token injected into upstream requests. **If set, it overrides whatever the client sent.** If unset, the client's `Authorization` header is passed through unchanged. |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated `Origin` allowlist. Empty means allow everything (`*`). When non-empty, only listed origins get an `Access-Control-Allow-Origin` header — for any other origin the header is simply omitted, and the browser does the blocking. |
| `SEARXNG_URL` | *(unset)* | Base URL of a SearXNG instance. Its JSON API has to be enabled — `formats: [html, json]` in `settings.yml`; the stock container answers `403` otherwise. |
| `BRAVE_API_KEY` | *(unset)* | Brave Search API key. 2000 queries a month for free. |
| `TAVILY_API_KEY` | *(unset)* | Tavily API key. 1000 queries a month for free. |
| `DOC_URL` | `http://127.0.0.1:8788` | Where the document service listens. If it is not there, the two routes that need it say so. |

If the proxy itself runs behind an HTTP proxy, add `127.0.0.1` to `NO_PROXY` —
otherwise the request to the document service goes out through that proxy too
and never arrives.

### The upstream pointer

A tunnel address changes on every restart. Baking it into the build would mean
redeploying the site every time the tunnel came back, so the upstream is
resolved at runtime instead: `UPSTREAM_POINTER` names a publicly readable text
file whose content is the current upstream address, and the proxy fetches that
file and uses what it finds.

`wrangler.toml` points it at the `tunnel-url` file on the `runtime` branch:

```
UPSTREAM_POINTER = "https://raw.githubusercontent.com/JiHuiYiYou/hippocrenes-model-chat/runtime/tunnel-url"
```

The `runtime` branch is an orphan branch that holds nothing but that one file.
The pointer is cached for 30 seconds, so a new upstream address reaches the
proxy within half a minute. A failed read keeps the last address that worked
instead of taking the proxy down.

### The proxy's own key never reaches the browser

The key lives in the proxy's environment (or as an encrypted platform secret) and is injected server-side on every upstream request. The frontend always sends its own Authorization header; when the proxy holds a key it overrides whatever arrived, so the two never conflict. The guarantee here is that the proxy's key never leaves the server.

Calling the origin directly cannot offer this guarantee: a key baked into a JavaScript bundle is readable by anyone who opens DevTools. That is why the proxy is the recommended setup for the GitHub Pages deployment.

---

## Deployment

### 1. GitHub Actions (default, free, no registration)

Actions minutes are free for public repositories, so this costs nothing and
needs no account of your own.

`.github/workflows/tunnel.yml` hosts the proxy on a runner. It starts one run
every four hours (`cron: 17 */4 * * *`) and lets each run live for at most 5.5
hours (`timeout-minutes: 330`). Inside a run it:

1. installs `cloudflared`;
2. starts the local proxy (`node proxy/server.mjs`) with the key read from the
   repository secret `VITE_API_KEY`;
3. installs the document service and starts it — optional, and a failure there
   does not take the tunnel down;
4. opens `cloudflared tunnel --url http://127.0.0.1:8787`;
5. writes the resulting tunnel address into the `tunnel-url` file on the
   `runtime` branch;
6. keeps the proxy and the tunnel alive until the job reaches its time limit.

The run fails when the runner cannot reach the origin: the workflow probes
`/__ping` and requires `"reachable": true` in the answer, so a tunnel that came
up but cannot reach the upstream never passes as a success.

The workflow sets no concurrency group, so a new run starts alongside the
previous one instead of cancelling it or queueing behind it. The previous round
keeps running for another 1.5 hours after the new round has taken the pointer,
so both tunnels are online during the handover and the site sees no gap.

A Cloudflare Worker sits in front of the tunnel as the fixed entry point:

```
browser -> GitHub Pages -> Cloudflare Worker (fixed address) -> tunnel (trycloudflare.com) -> proxy on the Actions runner -> upstream
```

The Worker never changes address. It reads the current tunnel address from the
pointer file on the `runtime` branch, so a new tunnel reaches it within 30
seconds and neither the Worker nor the site has to be redeployed.

One limit to know about: GitHub stops scheduled workflows after 60 days
without repository activity.

### 2. Local Node server (development)

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

### 3. Vercel (Node runtime)

The project root is the `proxy/` directory. The entry point is `api/[...path].js`,
and `vercel.json` rewrites every path onto it.

Use the Node runtime, not Edge. An Edge function runs on an edge node; a Node
function runs in a real container, and only a real container can be relied on to
reach a bare IP on a non-standard port.

```bash
cd proxy
npx vercel --prod
```

Set `API_KEY` as a project environment variable in the Vercel dashboard.
`UPSTREAM` and `ALLOWED_ORIGINS` have working defaults.

Verify:

```bash
curl https://<your-project>.vercel.app/__ping
```

### 4. Deno Deploy

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

### 5. Your own server

The Node runner binds to `127.0.0.1` by default. To expose it, bind to all
interfaces and put a TLS-terminating reverse proxy in front of it:

```bash
API_KEY=sk-your-key node server.mjs --host 0.0.0.0 --port 8787
```

Keep the proxy on HTTPS. A browser page loaded over HTTPS cannot call an
`http://` proxy (mixed content), and the API key would cross the network in
clear text.

### 6. Cloudflare quick tunnel on your own machine (no registration)

`proxy/tunnel.mjs` starts the local Node server and a `cloudflared` tunnel to
it, then publishes the tunnel address into the repository variable
`VITE_PROXY_URL` and triggers the Pages deployment:

```
browser -> GitHub Pages -> tunnel (trycloudflare.com) -> local proxy -> upstream
```

The tunnel address changes on every restart, so the script rewrites the
variable and redeploys instead of leaving the site pointing at a dead address.
This path bypasses the Worker and the Actions runner: the built site talks
straight to your tunnel, and your machine has to be on for that to work.

Prerequisites:

- The `cloudflared` binary. It is about 55 MB and is deliberately not
  committed (`.gitignore` lists `proxy/cloudflared.exe` and `proxy/cloudflared`).
  Windows:

  ```powershell
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "proxy/cloudflared.exe"
  ```

  Linux and macOS:

  ```bash
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o proxy/cloudflared
  chmod +x proxy/cloudflared
  ```

- The `gh` CLI, authenticated with `gh auth login`. The script uses it to write
  the repository variable. On Windows it looks for
  `C:/Program Files/GitHub CLI/gh.exe`; `GH_PATH` overrides the lookup.

Then, from the repository root:

```bash
API_KEY=sk-your-key npm run tunnel
```

The key is read from `API_KEY` first and from `proxy/.dev.vars` second. Set
`NO_SYNC=1` to keep the script from touching the repository — it then only
prints the tunnel address.

Measured on a running tunnel:

| Check | Result |
|---|---|
| `GET /__ping` | `reachable: true`, `hasKey: true`, `latencyMs` between 29 and 134 |
| CORS preflight | `204` with `Access-Control-Allow-Origin: *` |
| SSE stream | 90 frames spread between 2745 ms and 3912 ms, so it is a real stream and not one buffered blob |

### 7. Cloudflare Workers as a fixed entry point

The Worker cannot run the proxy against `182.92.245.176:1920` — see
[It cannot run on Cloudflare Workers](#it-cannot-run-on-cloudflare-workers).
It can, however, sit in front of a tunnel and follow its address through
`UPSTREAM_POINTER`, which is how the default setup uses it.

```bash
cd proxy
npm install -g wrangler        # or: npx wrangler ...
wrangler login
wrangler secret put API_KEY    # encrypted secret, never in git
wrangler deploy
```

`wrangler.toml` holds `UPSTREAM`, `UPSTREAM_POINTER`, and `ALLOWED_ORIGINS` as
plain vars (they are public), while the key goes in as a secret. Add your own
domain to `ALLOWED_ORIGINS` before deploying to production.

Verify:

```bash
curl https://hippocrenes-model-chat-proxy.<your-subdomain>.workers.dev/__ping
```

With a pointer configured, the `upstream` field of the answer shows the address
the pointer currently names — the current tunnel address — rather than the
origin.

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
| `upstream` | The upstream the proxy actually used. With `UPSTREAM_POINTER` set, this is the address the pointer names — the current tunnel address — rather than the origin. |
| `reachable` | Upstream answered at all (any status). `false` means the network path is broken. |
| `latencyMs` | Round-trip time of the probe request. |
| `error` | The raw error. `null` on success. Network failures keep the original message so you can see the actual cause. |
| `sample` | First 400 characters of the upstream response body. On success this is the upstream's JSON; on a `401` it is nginx's HTML error page. |
| `hasKey` | Whether `API_KEY` is configured on the proxy. |

`reachable: false` almost always means the platform cannot reach that
non-standard port. Against this upstream Cloudflare Workers always fails here
(`1003`; see [It cannot run on Cloudflare Workers](#it-cannot-run-on-cloudflare-workers)).
Switch to the Actions runner, the tunnel, Deno Deploy, Vercel on the Node
runtime, or a self-hosted Node server.

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

# The tools: search answers with results, fetch answers with text
curl -s "https://your-proxy.example/tools/search?q=weather" | head -c 300
curl -s "https://your-proxy.example/tools/fetch?url=https://example.com" | head -c 300

# The SSRF guard: a private address has to be refused
curl -s "https://your-proxy.example/tools/fetch?url=http://169.254.169.254/"
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
the key: the `API_KEY` environment variable for Node and for the tunnel, the
dashboard on Deno Deploy and Vercel, or `wrangler secret put API_KEY` on
Workers.

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
`export default { fetch: handleRequest }` for Workers and Deno Deploy, a bare
`export default handleRequest` for Vercel Edge, and a Node-style
`(req, res)` function for `api/[...path].js`.

---

## Files

| File | Purpose |
|---|---|
| `handler.js` | Core logic. Exports `handleRequest(request, env)` and `default { fetch }`. Zero dependencies, Web standard APIs only. Resolves the upstream from `UPSTREAM_POINTER` when that variable is set. |
| `tools.js` | The tool routes: search, fetch, OCR, documents. Zero dependencies, Web standard APIs only, no file access — so it runs on every runtime the proxy runs on. |
| `server.mjs` | Node runner. `node:http` plus Node 18+ globals. Streams SSE chunk by chunk. |
| `tunnel.mjs` | Starts `server.mjs` plus a `cloudflared` tunnel, writes the tunnel address into `VITE_PROXY_URL` with the `gh` CLI, and triggers the Pages deployment. The self-hosted alternative to the Actions runner. |
| `doc_service.py` | The document service: MarkItDown for documents, RapidOCR for pictures, pypdfium2 for scanned PDFs. Standard library only on the outside — the parsers are optional. |
| `doc.mjs` | Starts the document service with whatever python the machine has (`python3`, `python`, or `py -3`). |
| `requirements-doc.txt` | What the document service needs: `markitdown`, `rapidocr-onnxruntime`, `onnxruntime`, `pypdfium2`, `pillow`, `numpy`. |
| `searxng/` | A self-hosted SearXNG for the search tool: `docker-compose.yml` and a `settings.yml` with the JSON API turned on. |
| `deno.ts` | Deno Deploy entry point. |
| `api/[...path].js` | Vercel entry point on the Node runtime. Strips the `/api` prefix the rewrite added, then writes the response back chunk by chunk. |
| `vercel.json` | Vercel routing: every path is rewritten onto `/api`. |
| `vercel/edge.ts` | Vercel Edge entry point. |
| `wrangler.toml` | Cloudflare Workers configuration. `API_KEY` is a secret, not a var; `UPSTREAM_POINTER` points the Worker at the current tunnel address. |
| `.dev.vars.example` | Template for `.dev.vars` (git-ignored) used by `wrangler dev`. |