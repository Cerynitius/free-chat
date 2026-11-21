<!-- sections: intro features quickstart connect deploy settings design dev contribute license -->

# Hippocrene's Model Chat

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

![License MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-111111?style=flat-square)
![Deploy GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-111111?style=flat-square)
[![Deploy to Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

By default the proxy is hosted on a GitHub Actions runner, which is free for a public repository, and the site on GitHub Pages talks to a fixed Cloudflare Worker address that follows the tunnel. The Cloudflare button still deploys that Worker entry point. What does not work is running the proxy itself on Cloudflare Workers: the upstream is a bare IP with an IP-only certificate, and the Workers edge refuses to connect to it. See [Why this proxy cannot run on Cloudflare Workers](#workers).

A ready-to-use streaming chat client for `dsv4-flash`, with a collapsible reasoning panel, code highlighting, KaTeX math, and full mobile support.

<a id="intro"></a>
## Introduction

**Hippocrene's Model Chat** is a single-page chat client built for exactly one model: `dsv4-flash` (DeepSeek-V4-Flash-0731-CRACK) at `https://182.92.245.176:1920`. It is styled after DeepSeek.com: a persistent sidebar on the desktop that can be folded away, a drawer on the phone, a blinking caret while the answer streams in, and a collapsible panel that shows the model's thinking separately from the answer, in a fixed-height window that scrolls as the thinking grows.

There is no configuration screen and no model picker. The origin URL, the model id, the API key, the sampling parameters, and the default reasoning effort all live in `src/config.ts`, which is the single source of truth. Only three things stay adjustable at runtime: the theme, the reasoning effort, and whether the sidebar is folded.

The upstream speaks the OpenAI chat-completions protocol over Server-Sent Events and is perfectly usable from `curl`, but it serves no CORS headers at all, so a browser page cannot talk to it directly. The repository therefore ships a zero-dependency reverse proxy in `proxy/` that fixes the three things a browser needs: it answers the CORS preflight itself, injects the API key from the server side, and streams the SSE response through untouched.

That upstream is reached over TLS at a bare IP address, and its certificate names only that IP. Every deployment constraint in this repository follows from that one fact: the proxy has to run somewhere with unrestricted network access, and Cloudflare Workers is not such a place. See [Why this proxy cannot run on Cloudflare Workers](#workers). A GitHub Actions runner is such a place, it is free for a public repository, and it needs nothing from you, so that is where the proxy runs by default.

Everything in this repository is static: the built output is plain HTML, CSS, and JavaScript that can be served from GitHub Pages or any static file server. There is no backend of its own, no database, and no account system.

<a id="features"></a>
## Features

| Area | Capability |
|---|---|
| Streaming | Server-Sent Events with a blinking typing caret; output is buffered to about twelve flushes per second so long answers stay smooth |
| Reasoning | `reasoning_content` is rendered in its own panel, separate from the answer body: a fixed-height window in which the thinking scrolls up as it streams, its top edge softened instead of cut off, with a readout of how many seconds the model spent thinking |
| Truncation | A cut-off answer says so: the message carries a notice telling a token-budget cut, a dropped connection, and an upstream filter apart |
| Reasoning effort | Five levels: off, none, low, high, max. Picked from the chip at the bottom-left of the composer and sent as `reasoning_effort`; the default is `low` |
| Context | Full multi-turn history is sent back with every request |
| Markdown | GitHub Flavored Markdown including tables, rendered through `markdown-it` and sanitized with DOMPurify |
| Code | Syntax highlighting for 14 languages, with a working copy button on every code block |
| Math | KaTeX rendering for inline `$...$`, display `$$...$$`, and the LaTeX-native `\(...\)` and `\[...\]`; a formula KaTeX cannot parse falls back to monospaced source instead of a wall of red |
| Actions | Regenerate an answer, stop generation mid-flight, copy an answer as plain text or as Markdown, and rewrite a question — editing it drops the whole round that followed and asks again |
| History | Conversations are stored locally and grouped by today, yesterday, this week, and earlier; each one is named automatically, can be renamed and pinned, and offers rename / pin / delete from a right-click menu |
| Themes | Light, dark, or follow the system preference, driven by a single icon button at the bottom of the sidebar |
| Layout | Persistent sidebar on desktop that can be folded away, drawer on phones, soft-keyboard aware on mobile through `visualViewport` |
| Welcome | Every visit opens on a fresh conversation; the previous ones are one click away in the sidebar |
| Responsive | One layout that adapts from narrow phones to wide desktops |

Deliberately out of scope: tool calling (the server does not support it), image input (the API has no vision capability), and multi-model switching (there is a single model).

<a id="quickstart"></a>
## Quick Start

The published site already works. The proxy is hosted on a GitHub Actions runner, and the site on GitHub Pages talks to a fixed Cloudflare Worker address, so there is nothing to configure and no account to create: open the site and start typing.

To run your own copy instead, clone the repository and install the dependencies. The local proxy needs no registration and no account anywhere.

```bash
git clone https://github.com/JiHuiYiYou/hippocrenes-model-chat.git
cd hippocrenes-model-chat
npm install
```

### Chat on your own machine

Linux and macOS:

```bash
API_KEY=sk-your-key npm run proxy
```

Windows PowerShell:

```powershell
$env:API_KEY = "sk-your-key"; npm run proxy
```

The proxy listens on `127.0.0.1:8787` and reads the key from the `API_KEY` environment variable. In development the frontend points at that address on its own, so no environment variable is needed on the frontend side. Confirm the proxy is alive before opening the page:

```bash
curl http://127.0.0.1:8787/__ping
```

Then start the frontend in a second terminal:

```bash
npm run dev
```

Open `http://localhost:5173` and start typing. That is the whole setup: `npm install && npm run proxy && npm run dev`.

If you only want to work on the interface, the frontend runs fine on its own and simply reports the connection error until a proxy is running.

### Make the published site talk to your own machine

The proxy above is only reachable from your own machine. To let the site on GitHub Pages reach it, expose it through a Cloudflare quick tunnel:

```bash
npm run tunnel
```

`npm run tunnel` starts the local proxy, opens a `cloudflared` tunnel to it, and publishes the resulting `https://<random>.trycloudflare.com` address into the repository variable `VITE_PROXY_URL`, then triggers a fresh Pages deployment. The tunnel address changes on every restart, and the site follows it automatically.

This path bypasses the Worker and the Actions runner: the built site talks straight to your tunnel, and your machine has to be on for that to work.

It needs two things on the machine:

1. The `cloudflared` binary, about 55 MB, deliberately not committed to the repository. Windows PowerShell:

   ```powershell
   Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "proxy/cloudflared.exe"
   ```

   Linux and macOS:

   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o proxy/cloudflared
   chmod +x proxy/cloudflared
   ```

2. The `gh` CLI, authenticated with `gh auth login`, because the tunnel script uses it to update the repository variable.

Then run it with the key:

```bash
API_KEY=sk-your-key npm run tunnel
```

```powershell
$env:API_KEY = "sk-your-key"; npm run tunnel
```

To publish the site itself, push the repository to GitHub and let the included workflow build and deploy it.

See [Deployment](#deployment) for the full procedure.

<a id="connect"></a>
## Connecting to an API

### The upstream contract

| Property | Value |
|---|---|
| Base URL | `https://182.92.245.176:1920` |
| Scheme | HTTPS only. Plain HTTP to that port is rejected by nginx. |
| Entry point | A bare IP address. There is no domain name for this upstream. |
| Certificate | A valid Let's Encrypt IP certificate whose SAN contains the IP address and no DNS name, so browsers accept it without a warning and no certificate workaround is needed. |
| Allowed routes | `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`. Every other path returns `403`. |
| Authentication | `Authorization: Bearer <key>` on every request. |
| Streaming | Mandatory. `stream: false` is rejected with `400 stream_required`. |
| Reasoning channel | `delta.content` and `delta.reasoning_content` are two independent fields inside the same SSE frame. |
| Termination | `finish_reason: "stop"`, or `"length"` when the token budget runs out. There is no `usage` field in any frame. |
| Reasoning effort | Accepts `off`, `none`, `low`, `high`, and `max`. |
| Sampling | Supports the `system` role, `temperature`, `top_p`, and `stop`. |
| Tool calling | Not supported by the server. |

Because the server never reports token usage, the interface shows no usage counter at all. There is nothing to estimate and nothing to display.

### The token budget

`max_tokens` is a **shared** budget: the upstream counts `reasoning_content` against it as well. A long think therefore eats the room the answer needs, and when the budget runs out the stream ends with `finish_reason: "length"` — usually in the middle of the reasoning, before the answer has even started. Measured against this upstream, a hard reasoning task at `max_tokens: 4096` spent all 4096 tokens on thinking and produced not a single token of answer.

`MAX_TOKENS` is `131072` for that reason. The upstream takes that value without complaint, and it does not check it against the context window either: a 150,000-character prompt with `max_tokens: 131072` still comes back `200`. The value is a ceiling, not a target — in a side-by-side run the model wrote a *shorter* answer under the larger ceiling, because `max_tokens` says how much it may say, not how much it will.

The client does not hide a cut-off response. The message carries a notice that tells the three cases apart:

| Notice | What happened |
|---|---|
| Output was truncated | The upstream hit `max_tokens`. Thinking and the answer share that one budget. |
| Connection dropped | The stream ended without a termination marker, so the text below may be incomplete. |
| Content was filtered | The upstream's own filter cut the response. |

### Where the endpoint comes from

There is no screen where the user picks a backend. The target is decided at build time and baked into the bundle:

| Constant | Source | Meaning |
|---|---|---|
| `BASE_URL` | Hardcoded in `src/config.ts` | The origin address. `https://182.92.245.176:1920`. |
| `PROXY_URL` | `VITE_PROXY_URL`, or `http://127.0.0.1:8787` in development | The proxy's public address — the Worker's address in the default setup. When it is set, every request goes through the proxy; when it is empty, the request goes straight to the origin. |
| `API_KEY` | `VITE_API_KEY` | The bearer token. Empty when the proxy injects the key server-side. |
| `MODEL` | Hardcoded in `src/config.ts` | `dsv4-flash`. |
| `TEMPERATURE`, `TOP_P`, `MAX_TOKENS`, `SYSTEM_PROMPT` | Hardcoded in `src/config.ts` | The sampling parameters. `0.7`, `1`, `131072`, and an empty system prompt. |

The rule is one line long: **a configured proxy wins, otherwise the browser calls the origin directly.** The second half only works if the origin serves CORS headers, and it does not.

### The CORS problem

This is the single most important thing to understand about the upstream, so it is worth spelling out in full.

A page served from `https://jihuiyiyou.github.io` asking for `https://182.92.245.176:1920` is a cross-origin request. The browser applies the same-origin policy to the result: the request may go out, but JavaScript is only allowed to read the response if it carries a matching `Access-Control-Allow-Origin` header. The upstream carries no such header, and its preflight is answered by the authentication layer instead of by a CORS handler. Measured behaviour:

```
OPTIONS /v1/chat/completions  ->  401 Unauthorized
   (the nginx auth layer rejects the preflight before CORS is ever evaluated)

GET /v1/models  ->  200 OK, but not a single CORS header in the response
   (no Access-Control-Allow-Origin / Allow-Headers / Allow-Methods)

POST /v1/chat/completions  ->  likewise zero CORS headers
```

Two independent failures are stacked on top of each other:

1. **The preflight never reaches a CORS handler.** Any request that carries `Authorization` or `Content-Type: application/json` triggers an `OPTIONS` preflight first. The upstream's nginx authenticates every request, including the preflight, and answers `401` with an HTML error page. The browser stops there and never sends the real request.
2. **The real responses carry no CORS headers.** Even if the preflight were bypassed, a `GET /v1/models` would come back `200` and then be discarded by the browser, because the response has no `Access-Control-Allow-Origin`. From JavaScript, a discarded response is indistinguishable from a network failure: the console only says "Failed to fetch".

### Why this proxy cannot run on Cloudflare Workers

<a id="workers"></a>

This was measured, not assumed. Every configuration of the Workers deployment fails against this upstream:

| Attempt | Result |
|---|---|
| `fetch()` straight to the bare IP | `HTTP 403` with Cloudflare error `1003`. The edge does not connect to IP addresses. |
| `fetch()` to a wildcard DNS name pointing at the same IP (`nip.io`, `sslip.io`) | `HTTP 526 Invalid SSL Certificate`. The certificate names the IP, not the host. |
| `resolveOverride`, in either direction | `1003` and `526` again. |
| The IP in other spellings: IPv4-mapped IPv6, trailing dot, octal, hexadecimal | `1003` every time. The edge normalizes the address before it checks it. |
| `cloudflare:sockets` on the free plan | Plain TCP connects, but `secureTransport: 'on'` silently degrades to cleartext and the upstream answers `400 The plain HTTP request was sent to HTTPS port`. `startTls()` throws. TLS over sockets needs the Workers Paid plan. |

The rule that falls out of this is short: **the proxy has to run on a machine with unrestricted network access** — an ordinary container or a virtual machine.

That rules out the *proxy* on Workers. It does not rule out the *Worker* as a front door: the Worker only has to fetch an ordinary hostname, and the tunnel address is one. So in this repository the Worker is the fixed entry point in front of the tunnel, not the place where the proxy runs. See [Where the proxy runs](#hosting).

<a id="hosting"></a>
### Where the proxy runs

Three ways to host it, in the order they are worth trying. The first one needs no account, no server of your own, and no money.

#### A. GitHub Actions (default, free, no registration)

The proxy runs on a GitHub Actions runner. Actions minutes are free for public repositories, so this costs nothing and needs no account of your own.

The chain is:

```
browser -> GitHub Pages -> Cloudflare Worker (fixed address) -> tunnel (trycloudflare.com) -> proxy on the Actions runner -> upstream
```

`.github/workflows/tunnel.yml` drives the whole chain. A run lives for at most 5.5 hours (`timeout-minutes: 330`), and **each run starts its own successor ninety minutes before it runs out** — the handover does not lean on GitHub's scheduler (why, see the known limits below). Inside a run it:

1. installs `cloudflared`;
2. starts the local proxy (`node proxy/server.mjs`) with the key read from the repository secret `VITE_API_KEY`;
3. opens `cloudflared tunnel --url http://127.0.0.1:8787`;
4. writes the resulting `https://<random>.trycloudflare.com` address into the `tunnel-url` file on the `runtime` branch;
5. keeps the proxy and the tunnel alive until the job reaches its time limit;
6. ninety minutes before that limit, calls the Actions API with the repository's own `GITHUB_TOKEN` to start the next round. `workflow_dispatch` is exempt from the rule that events triggered by `GITHUB_TOKEN` do not create a new run, so the repository's own token is enough.

The runner refuses to fake a success: the workflow probes `/__ping` and fails the run unless the answer contains `"reachable": true`. A tunnel that came up but cannot reach the upstream never passes.

The `runtime` branch is an orphan branch that holds nothing but that one file.

The workflow sets no concurrency group, so a new run starts alongside the previous one instead of cancelling it or queueing behind it. The previous round keeps running for another 1.5 hours after the new round has taken the pointer, so both tunnels are online during the handover and the site never sees a gap.

Starting the `Tunnel` workflow by hand from the **Actions** tab takes two inputs. `takeover` defaults to `auto`, which probes the tunnel the pointer currently names and stands down if it is still alive, so a manual run never fights the self-perpetuating chain for the pointer; `always` takes over unconditionally. `handoff_now` starts the next round the moment the tunnel is up — the pointer moves to it at once — and keeps this round alive as a spare.

##### The Worker is the fixed entry point, the tunnel address is a pointer

The Worker in front of the tunnel never changes address, so the site never has to be rebuilt when the tunnel does. `proxy/handler.js` reads the upstream from a pointer: `UPSTREAM_POINTER` names a publicly readable text file whose content is the current tunnel address, and the Worker fetches that file at runtime and uses what it finds. `proxy/wrangler.toml` points it at the file on the `runtime` branch:

```
UPSTREAM_POINTER = "https://raw.githubusercontent.com/JiHuiYiYou/hippocrenes-model-chat/runtime/tunnel-url"
```

The pointer is cached for 30 seconds, so a new tunnel address reaches the Worker within half a minute. If the pointer cannot be read, the Worker keeps using the last address it saw instead of going down.

Measured against the Worker that fronts the tunnel:

| Check | Result |
|---|---|
| `GET /__ping` | `upstream` shows the current tunnel address, `reachable: true`, `latencyMs` between 1200 and 1600 — the chain has one more hop than a direct connection |
| The Actions runner | reaches the origin; the workflow fails the run when it does not |
| The published site | chats normally with the local tunnel and the local proxy both stopped |

#### B. Your own server, Vercel, or Deno Deploy

More predictable and faster than the free runner. Vercel and Deno Deploy have free quotas but need an account; a server of your own is yours to keep.

On your own server, run the Node proxy and put a TLS-terminating reverse proxy in front of it:

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

Keep the whole chain on HTTPS: a page loaded over HTTPS cannot call an `http://` endpoint (mixed content), and the key would otherwise cross the network in clear text.

On Vercel, use the **Node** runtime, not Edge. An Edge function runs on an edge node; a Node function runs in a real container, and only a real container can be relied on to reach a bare IP on a non-standard port. The project root is the `proxy/` directory, the entry point is `proxy/api/[...path].js`, and `proxy/vercel.json` rewrites every path to `/api/:path*`.

```bash
cd proxy
npx vercel --prod
```

Set `API_KEY` as a project environment variable in the Vercel dashboard. `UPSTREAM` and `ALLOWED_ORIGINS` have working defaults.

Vercel kills a function after `maxDuration` seconds, and a long think easily runs past a minute. The entry point asks for 300 seconds, which needs a paid plan — the Hobby plan pins every function at 60 seconds no matter what the function asks for, so a response that thinks for longer than that gets cut off by the platform.

On Deno Deploy, `proxy/deno.ts` is the entry point:

```bash
deno deploy --project=<your-project> deno.ts
```

Set `UPSTREAM`, `API_KEY`, and `ALLOWED_ORIGINS` in the Deno Deploy dashboard.

#### C. Your own machine plus a tunnel

`npm run tunnel` is the zero-registration path for people who want the proxy on their own machine. It starts the local proxy, opens a `cloudflared` tunnel to it, writes the tunnel address into the repository variable `VITE_PROXY_URL` with the `gh` CLI, and triggers the Pages deployment, so the published site talks to your machine:

```
browser -> GitHub Pages -> tunnel (trycloudflare.com) -> local proxy -> upstream
```

Prerequisites are the `cloudflared` binary and an authenticated `gh` CLI (`gh auth login`). The download command is in [Quick Start](#quickstart).

The tunnel address changes on every restart, and the site follows it automatically, so nothing has to be edited by hand. The price of this path is that your machine has to stay on and connected.

Measured on the running tunnel:

| Check | Result |
|---|---|
| `GET /__ping` | `reachable: true`, `hasKey: true`, `latencyMs` between 29 and 134 |
| CORS preflight | `204` with `Access-Control-Allow-Origin: *` |
| SSE stream | 90 frames spread between 2745 ms and 3912 ms, so it is a real stream and not one buffered blob |
| The published site | Chats normally |

#### Appendix: direct connection to the origin (optional, needs an administrator)

The origin needs no change to work with any of the paths above. This section is only for administrators who want browsers to reach the origin without running a proxy of their own; nothing in this repository depends on it, and the proxy stays the simpler option. If you would rather let browsers call it directly, add the following to the `listen 1920 ssl;` server block:

```nginx
    # 预检短路：server 级 if 在 rewrite 阶段执行，早于 access(鉴权) 阶段
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
        add_header Access-Control-Max-Age       86400 always;
        return 204;
    }
    # 真实请求也要带 CORS 头；always 不可省（源站会回 401/403/500）
    add_header Access-Control-Allow-Origin  "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
    add_header Access-Control-Expose-Headers "Content-Type" always;
    # SSE：关掉缓冲，否则流会被攒成一坨再一次性吐出来
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 3600s;
```

Two pitfalls will bite you if you skip them:

- **nginx `add_header` inheritance.** If a `location` block declares even one `add_header` of its own, the entire server-level set is discarded for that location. Every `location` has to be inspected and the headers copied in by hand.
- **Only `return` and `rewrite` are allowed inside `if`.** `proxy_pass` inside an `if` block is invalid and nginx will refuse to start.

Verify the result with a preflight:

```bash
curl -i -X OPTIONS https://182.92.245.176:1920/v1/chat/completions \
  -H "Origin: https://jihuiyiyou.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

A `204` with the four CORS headers is the expected answer.

### API key visibility

A key that is compiled into a web page is a key that is published. If the key is baked into the JavaScript bundle, anyone who opens DevTools can read it, and so can anyone who downloads the bundle. There is no way around this: anything the browser can send is something the browser can also reveal.

Two places the key can live:

| Location | Visible to the browser | Recommendation |
|---|---|---|
| Proxy secret (server side, proxy mode) | No. The key is injected server-side on every upstream request and overrides whatever the client sent. | Recommended |
| Build-time repository secret `VITE_API_KEY` (Pages) | Yes. The value ends up in the public bundle. | Acceptable only if the key is rotated regularly and scoped narrowly |

The proxy injects the key on every upstream request, so the frontend does not need a key of its own. If the proxy has no key configured, the client's own `VITE_API_KEY` header is passed through unchanged.

Whichever path you choose, rotate the key periodically. A key that has been sitting in a public bundle should be treated as compromised.

<a id="deploy"></a>
## Deployment

### GitHub Pages

The repository ships with a workflow that builds and publishes automatically.

1. **Push the repository to GitHub.** The target repository is `https://github.com/JiHuiYiYou/hippocrenes-model-chat`.
2. **Add the repository secret.** Under **Settings**, then **Secrets and variables**, then **Actions**, create a repository secret named `VITE_API_KEY` and put the upstream key in it. The secret is injected at build time and never lands in the repository.
3. **Add the repository variable.** Create a repository variable named `VITE_PROXY_URL` and set it to the **public address of your proxy** — the address a browser can reach, not a local one. This is the one setting that tells the built site where to send its requests. Without it the site calls the origin directly and the browser discards every response, because the origin serves no CORS headers. Leave it unset only if you host the site somewhere the origin is reachable with CORS headers.

   The address comes from whichever way you host the proxy:

   | Where the proxy runs | What to put in `VITE_PROXY_URL` |
   |---|---|
   | GitHub Actions (default) | The address of the Cloudflare Worker in front of the tunnel. It never changes, so the site is built once and stays valid. |
   | Local proxy behind a Cloudflare quick tunnel | The `https://<random>.trycloudflare.com` address printed by `npm run tunnel`. The script writes it into the variable for you. |
   | Vercel | `https://<your-project>.vercel.app` |
   | Deno Deploy | `https://<your-project>.deno.dev` |
   | Your own server | `https://proxy.example.com`, the address in front of your TLS-terminating reverse proxy |

   A tunnel address is temporary: it changes whenever the tunnel restarts. `npm run tunnel` handles that by rewriting the variable and redeploying the site, so the site keeps working as long as the tunnel runs.

   **When the proxy is hosted on Actions, the tunnel address never reaches the build.** `VITE_PROXY_URL` points at the Worker, and the Worker looks the real upstream up at runtime through `UPSTREAM_POINTER` (see [Where the proxy runs](#hosting)). A new tunnel address reaches the Worker within 30 seconds and nothing has to be redeployed — not the Worker, not the site.
4. **Enable Pages.** The workflow uses `enablement: true`, so the site is created automatically on the first run. You can also set it manually under **Settings**, then **Pages**, with **GitHub Actions** as the source.
5. **Push to `main`.** The `Deploy to GitHub Pages` workflow builds the site and publishes it. The result is served from a URL of the form `https://<user>.github.io/<repo>/`.

The build uses a relative base path (`./`), so the same `dist/` directory also works on any static file server, on a local disk, or inside a subdirectory of another domain.

### Known limits of the Actions-hosted proxy

The `Tunnel` workflow has to be running for the site to reach the model. Two things about it are worth knowing:

- **GitHub's cron did not fire for this repository for a while.** The workflow keeps `cron: 17 */4 * * *` as a backstop, but it never ran (2026-11-20: neither the 12:17Z nor the 16:17Z slot moved), so every round of the tunnel was killed at its time limit with nobody taking over, and the site sat dark — the browser reported `HTTP 530 · error code: 1016` (the connector was still up, but the proxy process behind it had been taken away first) or `1033`. The handover therefore no longer depends on the scheduler: each round starts its own successor. Should the schedule ever wake up, it does no harm: a backstop-triggered round probes the tunnel the pointer names and stands down when it is still alive instead of fighting the chain for the pointer.
- **GitHub stops the schedule after 60 days without activity.** If the repository sees no activity for 60 days, the cron schedule stops firing and the tunnel stops coming up. Push a commit, or start the `Tunnel` workflow by hand from the **Actions** tab, to bring it back.

### Self-hosting

The build output in `dist/` is a static site with no server-side requirement. Serve it with any web server. The only thing that has to keep running somewhere is the proxy, and the simplest option is the same Node runner used for local development:

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

Build the site with the proxy's public address baked in, so the browser talks to the proxy rather than the origin:

```bash
VITE_PROXY_URL=https://proxy.example.com npm run build
```

The same build works with the Worker address in place of your own proxy: the Worker forwards to whatever upstream the pointer names.

Put a TLS-terminating reverse proxy in front of it. Keep the whole chain on HTTPS: a page loaded over HTTPS cannot call an `http://` endpoint (mixed content), and the key would otherwise cross the network in clear text.

### What the deployment does not do

The deployment publishes static files only. It does not proxy the API, does not store conversations on a server, and does not rate-limit anything. Conversations live in the visitor's own browser, and the only key that ever reaches the browser is the one you choose to compile in.

<a id="settings"></a>
## Adjustable Options

There is no configuration screen. Three options are adjustable at runtime, and all of them are reachable directly from the interface:

| Option | Default | Where | Description |
|---|---|---|---|
| Theme | `system` | Icon button at the bottom of the sidebar | `light`, `dark`, or follow the operating system. The button flips between light and dark. |
| Reasoning effort | `low` | Chip at the bottom-left of the composer | One of `off`, `none`, `low`, `high`, `max`. Sent as `reasoning_effort` with every request. |
| Sidebar fold | unfolded | Icon button at the top-left of the main area | Folds the desktop sidebar away. Remembered across visits. |

Everything else is hardcoded in `src/config.ts` and is not editable in the interface: the origin URL, the proxy URL, the API key, the model id, `temperature`, `top_p`, `max_tokens`, and the system prompt. Changing any of them means editing that one file and rebuilding.

<a id="design"></a>
## Design System

The visual language is deliberately quiet: hairlines instead of shadows, near-black text on a light canvas, and no decoration that competes with the answer.

### Colour tokens

Defined once in `src/styles.css` and overridden as a block in dark mode, so every utility follows along automatically.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-canvas` | `#FFFFFF` | `#0E0E0D` | Page background |
| `--color-canvas-2` | `#F7F6F3` | `#141413` | Secondary background |
| `--color-canvas-3` | `#FBFBFA` | `#121211` | Tertiary background |
| `--color-surface` | `#FFFFFF` | `#161615` | Card and panel surface |
| `--color-surface-2` | `#F9F9F8` | `#1C1C1A` | Muted surface, inline code |
| `--color-line` | `#EAEAEA` | `#2A2A27` | Hairline border |
| `--color-ink` | `#111111` | `#F2F1ED` | Primary text |
| `--color-ink-2` | `#2F3437` | `#D6D5D0` | Secondary text |
| `--color-muted` | `#787774` | `#8E8D87` | Tertiary text |
| `--color-faint` | `#A8A7A3` | `#6E6D68` | Quaternary text |

The four semantic tints each ship as a background and an ink pair, used for status and for the syntax theme.

| Tint | Background (light) | Ink (light) | Background (dark) | Ink (dark) |
|---|---|---|---|---|
| Red | `#FDEBEC` | `#9F2F2D` | `#3A1E1E` | `#E3A3A1` |
| Blue | `#E1F3FE` | `#1F6C9F` | `#14303F` | `#8FC4E4` |
| Green | `#EDF3EC` | `#346538` | `#1D2E1C` | `#9CC79A` |
| Yellow | `#FBF3DB` | `#956400` | `#332912` | `#D9B570` |

### Typography

| Role | Stack |
|---|---|
| Sans | `SF Pro Display`, `Geist Variable`, `Helvetica Neue`, `PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`, `Noto Sans SC`, `system-ui`, sans-serif |
| Serif | `Newsreader`, `Lyon Text`, `Songti SC`, `Source Han Serif SC`, `Noto Serif SC`, `Georgia`, `Times New Roman`, serif |
| Mono | `Geist Mono Variable`, `SF Mono`, `JetBrains Mono`, `Cascadia Code`, `Consolas`, `PingFang SC`, monospace |

Latin text and numerals use Geist, CJK falls back to the system font, and both are geometric sans faces so the mixed setting stays coherent. The fonts are self-hosted, so there is no runtime CDN request. Body text is 15 pixels with a line height of 1.6.

### Shape, depth, and motion

| Token | Value | Rule |
|---|---|---|
| Border | `1px solid #EAEAEA` | Every outline in the interface uses this one hairline. |
| Radius | 4, 6, 8, 12 px | Large containers stop at 12 pixels. The pill radius is reserved for small tags. |
| Shadow | `0 2px 8px rgba(0, 0, 0, 0.04)` | The card elevation level. Floating layers, such as the right-click menu, use one stronger step: `0 8px 28px rgba(0, 0, 0, 0.13)`. |
| Primary action | `#111111` background, white text, radius 4 to 6 pixels, no shadow | Pressed state is `transform: scale(0.98)`. |
| Easing | `cubic-bezier(0.16, 1, 0.3, 1)` | Applied to every transition. |
| Animation | `transform` and `opacity` only | Two sizes do move, both under 250 ms: the reasoning window unfolds by `max-height`, and the sidebar folds by `width`. |

No gradients, no glow, no glassmorphism, and no emoji anywhere in the interface. Icons come from Phosphor in the Bold and Fill weights only.

<a id="dev"></a>
## Development

### Stack

| Layer | Choice |
|---|---|
| UI | React 19 with TypeScript 5.9 |
| Build | Vite 8, with the React plugin and the Tailwind CSS v4 plugin |
| Styling | Tailwind CSS v4 with a custom `@theme` block in `src/styles.css` |
| State | Zustand 5, split into three slices over a common type module |
| Markdown | `markdown-it` with DOMPurify sanitization |
| Highlighting | `highlight.js`, restricted to 14 registered languages |
| Math | KaTeX, with inline and display rules written as a custom plugin |
| Icons | `@phosphor-icons/react` |
| Fonts | `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, self-hosted |

### Commands

```bash
npm install        # install dependencies
npm run dev        # dev server on http://localhost:5173
npm run proxy      # local proxy on http://127.0.0.1:8787
npm run tunnel     # optional: local proxy plus a Cloudflare quick tunnel, synced to the repository
npm run typecheck  # TypeScript, no emit
npm run build      # type check plus production build into dist/
npm run preview    # serve the production build locally
npm run check:readme  # verify that the two README files stay in sync
```

### Layout

```
hippocrenes-model-chat/
├── index.html            # HTML shell
├── vite.config.ts        # Vite config, relative base path, @ alias
├── tsconfig.json
├── src/
│   ├── main.tsx          # entry point
│   ├── App.tsx           # application shell
│   ├── config.ts         # origin, model, key, sampling parameters
│   ├── styles.css        # design tokens and component classes
│   ├── lib/              # api, chat, sse, markdown, hljs,
│   │                     # storage, theme, date, clipboard
│   ├── state/            # store, three slices, types, persistence
│   └── ui/               # presentational components
├── proxy/
│   ├── handler.js        # common core: CORS, key injection, SSE passthrough
│   ├── server.mjs        # Node runner
│   ├── tunnel.mjs        # local proxy plus a Cloudflare quick tunnel
│   ├── deno.ts           # Deno Deploy entry point
│   ├── api/[...path].js # Vercel entry point on the Node runtime
│   ├── vercel/edge.ts    # Vercel Edge entry point
│   ├── vercel.json       # Vercel routing
│   └── wrangler.toml     # Cloudflare Workers configuration
├── tools/
│   └── check-readme-parity.mjs
└── .github/workflows/
    ├── ci.yml            # type check, README sync check, build
    ├── deploy.yml        # build and publish to GitHub Pages
    └── tunnel.yml        # host the proxy on a GitHub Actions runner
```

### State layout

State is split into three slices over a common type module, so no slice has to import another one:

- `settingsSlice` holds the two runtime options, the theme and the reasoning effort.
- `chatSlice` holds conversations and the streaming lifecycle. Incoming SSE frames are buffered and flushed to the store twelve times per second, which keeps a long answer from re-rendering the tree on every token.
- `uiSlice` holds sidebar visibility, scroll position, unread counters, and toasts.

Conversations and settings are persisted to `localStorage` under the key `hippocrenes.chat.v2`, debounced by 400 milliseconds, and capped at 50 conversations.

<a id="contribute"></a>
## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first: it lists the development requirements, the checks that must pass before a commit, the visual red lines, and the release procedure.

<a id="license"></a>
## License

Released under the MIT License. See [LICENSE](LICENSE) for the full text.

Current version: `0.1.0`