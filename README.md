<!-- sections: intro features quickstart connect deploy settings design dev contribute license -->

# Hippocrene's Model Chat

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

![License MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-111111?style=flat-square)
![Deploy GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-111111?style=flat-square)
[![Deploy to Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

A ready-to-use streaming chat client for `dsv4-flash`, with a collapsible reasoning panel, code highlighting, KaTeX math, and full mobile support.

<a id="intro"></a>
## Introduction

**Hippocrene's Model Chat** is a single-page chat client built for exactly one model: `dsv4-flash` (DeepSeek-V4-Flash-0731-CRACK) at `https://182.92.245.176:1920`. It is styled after DeepSeek.com: a persistent sidebar on the desktop, a drawer on the phone, a blinking caret while the answer streams in, and a collapsible panel that shows the model's thinking separately from the answer.

There is no configuration screen and no model picker. The origin URL, the model id, the API key, the sampling parameters, and the default reasoning effort all live in `src/config.ts`, which is the single source of truth. Only two things stay adjustable at runtime: the theme and the reasoning effort.

The upstream speaks the OpenAI chat-completions protocol over Server-Sent Events and is perfectly usable from `curl`, but it serves no CORS headers at all, so a browser page cannot talk to it directly. The repository therefore ships a zero-dependency reverse proxy in `proxy/` that fixes the three things a browser needs: it answers the CORS preflight itself, injects the API key from the server side, and streams the SSE response through untouched.

Everything in this repository is static: the built output is plain HTML, CSS, and JavaScript that can be served from GitHub Pages or any static file server. There is no backend of its own, no database, and no account system.

<a id="features"></a>
## Features

| Area | Capability |
|---|---|
| Streaming | Server-Sent Events with a blinking typing caret; output is buffered to about twelve flushes per second so long answers stay smooth |
| Reasoning | `reasoning_content` is rendered in its own collapsible panel, separate from the answer body, with a readout of how many seconds the model spent thinking |
| Reasoning effort | Five levels: off, none, low, high, max. Picked from the chip at the bottom-left of the composer and sent as `reasoning_effort`; the default is `low` |
| Context | Full multi-turn history is sent back with every request |
| Markdown | GitHub Flavored Markdown including tables, rendered through `markdown-it` and sanitized with DOMPurify |
| Code | Syntax highlighting for 14 languages, with a working copy button on every code block |
| Math | KaTeX rendering for inline `$...$` and display `$$...$$` formulas |
| Actions | Regenerate an answer, stop generation mid-flight, copy an answer |
| History | Conversations are stored locally and grouped by today, yesterday, this week, and earlier; new and delete are supported |
| Themes | Light, dark, or follow the system preference, driven by a single icon button at the bottom of the sidebar |
| Layout | Persistent sidebar on desktop, drawer on phones, soft-keyboard aware on mobile through `visualViewport` |
| Responsive | One layout that adapts from narrow phones to wide desktops |

Deliberately out of scope: tool calling (the server does not support it), image input (the API has no vision capability), and multi-model switching (there is a single model).

<a id="quickstart"></a>
## Quick Start

Clone it, install it, and you are chatting. The local proxy needs no registration and no account anywhere.

```bash
git clone https://github.com/JiHuiYiYou/hippocrenes-model-chat.git
cd hippocrenes-model-chat
npm install
```

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

To publish it, push the repository to GitHub and let the included workflow build and deploy it.

See [Deployment](#deployment) for the full procedure.

<a id="connect"></a>
## Connecting to an API

### The upstream contract

| Property | Value |
|---|---|
| Base URL | `https://182.92.245.176:1920` |
| Scheme | HTTPS only. Plain HTTP to that port is rejected by nginx. |
| Certificate | A valid Let's Encrypt IP certificate whose SAN contains the IP address, so browsers accept it without a warning and no certificate workaround is needed. |
| Allowed routes | `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`. Every other path returns `403`. |
| Authentication | `Authorization: Bearer <key>` on every request. |
| Streaming | Mandatory. `stream: false` is rejected with `400 stream_required`. |
| Reasoning channel | `delta.content` and `delta.reasoning_content` are two independent fields inside the same SSE frame. |
| Termination | `finish_reason: "stop"`. There is no `usage` field in any frame. |
| Reasoning effort | Accepts `off`, `none`, `low`, `high`, and `max`. |
| Sampling | Supports the `system` role, `temperature`, `top_p`, and `stop`. |
| Tool calling | Not supported by the server. |

Because the server never reports token usage, the interface shows no usage counter at all. There is nothing to estimate and nothing to display.

### Where the endpoint comes from

There is no screen where the user picks a backend. The target is decided at build time and baked into the bundle:

| Constant | Source | Meaning |
|---|---|---|
| `BASE_URL` | Hardcoded in `src/config.ts` | The origin address. `https://182.92.245.176:1920`. |
| `PROXY_URL` | `VITE_PROXY_URL`, or `http://127.0.0.1:8787` in development | The proxy address. When it is set, every request goes through the proxy; when it is empty, the request goes straight to the origin. |
| `API_KEY` | `VITE_API_KEY` | The bearer token. Empty when the proxy injects the key server-side. |
| `MODEL` | Hardcoded in `src/config.ts` | `dsv4-flash`. |
| `TEMPERATURE`, `TOP_P`, `MAX_TOKENS`, `SYSTEM_PROMPT` | Hardcoded in `src/config.ts` | The sampling parameters. `0.7`, `1`, `4096`, and an empty system prompt. |

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

There are three ways out. Paths A and B need nothing from the server operator.

#### A. Local proxy (no registration, recommended)

The `proxy/` directory holds a portable, zero-dependency proxy. `npm run proxy` starts it on `127.0.0.1:8787`, reading the key from `API_KEY`. It answers the preflight locally with `204`, adds the missing CORS headers to every response, injects the key server-side, and forwards the SSE body as a live stream rather than buffering it.

The same core also runs on Deno Deploy and Vercel Edge Functions; see `proxy/README.md`.

#### B. Cloudflare Workers (public deployment)

The same core adapts to Cloudflare Workers, and the API key is stored as an encrypted Worker secret that the browser can never read.

```bash
cd proxy
npm install
npx wrangler login
npx wrangler secret put API_KEY     # type the key when prompted
npx wrangler deploy
```

You end up with a `https://<your-subdomain>.workers.dev` address. Put that into the repository variable `VITE_PROXY_URL` and rebuild: from then on the frontend talks to your proxy instead of the origin. The key now lives in the Worker secret, so the browser never carries it.

[![Deploy to Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

Check the deployment with a real probe:

```bash
curl https://<your-subdomain>.workers.dev/__ping
```

#### C. Direct connection to the origin (optional, needs an administrator)

The origin needs no change to work with paths A and B. This section is only for administrators who want browsers to reach the origin without running a proxy of their own; nothing in this repository depends on it. If you would rather let browsers call it directly, add the following to the `listen 1920 ssl;` server block:

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
| Worker secret (proxy mode) | No. The key is injected server-side on every upstream request and overrides whatever the client sent. | Recommended |
| Build-time repository secret `VITE_API_KEY` (Pages) | Yes. The value ends up in the public bundle. | Acceptable only if the key is rotated regularly and scoped narrowly |

The proxy injects the key on every upstream request, so the frontend does not need a key of its own. If the proxy has no key configured, the client's own `VITE_API_KEY` header is passed through unchanged.

Whichever path you choose, rotate the key periodically. A key that has been sitting in a public bundle should be treated as compromised.

<a id="deploy"></a>
## Deployment

### GitHub Pages

The repository ships with a workflow that builds and publishes automatically.

1. **Push the repository to GitHub.** The target repository is `https://github.com/JiHuiYiYou/hippocrenes-model-chat`.
2. **Add the repository secret.** Under **Settings**, then **Secrets and variables**, then **Actions**, create a repository secret named `VITE_API_KEY` and put the upstream key in it. The secret is injected at build time and never lands in the repository.
3. **Add the repository variable.** Create a repository variable named `VITE_PROXY_URL` and set it to the address of your proxy, for example `https://hippocrenes-model-chat-proxy.<your-subdomain>.workers.dev`. This is the one setting that tells the built site where to send its requests. Without it the site calls the origin directly and the browser discards every response, because the origin serves no CORS headers. Leave it unset only if you host the site somewhere the origin is reachable with CORS headers.
4. **Enable Pages.** The workflow uses `enablement: true`, so the site is created automatically on the first run. You can also set it manually under **Settings**, then **Pages**, with **GitHub Actions** as the source.
5. **Push to `main`.** The `Deploy to GitHub Pages` workflow builds the site and publishes it. The result is served from a URL of the form `https://<user>.github.io/<repo>/`.

The build uses a relative base path (`./`), so the same `dist/` directory also works on any static file server, on a local disk, or inside a subdirectory of another domain.

### Self-hosting

The build output in `dist/` is a static site with no server-side requirement. Serve it with any web server. The only thing that has to keep running somewhere is the proxy, and the simplest option is the same Node runner used for local development:

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

Build the site with the proxy address baked in, so the browser talks to the proxy rather than the origin:

```bash
VITE_PROXY_URL=https://proxy.example.com npm run build
```

Put a TLS-terminating reverse proxy in front of it. Keep the whole chain on HTTPS: a page loaded over HTTPS cannot call an `http://` endpoint (mixed content), and the key would otherwise cross the network in clear text.

### What the deployment does not do

The deployment publishes static files only. It does not proxy the API, does not store conversations on a server, and does not rate-limit anything. Conversations live in the visitor's own browser, and the only key that ever reaches the browser is the one you choose to compile in.

<a id="settings"></a>
## Adjustable Options

There is no configuration screen. Two options are adjustable at runtime, and both are reachable directly from the interface:

| Option | Default | Where | Description |
|---|---|---|---|
| Theme | `system` | Icon button at the bottom of the sidebar | `light`, `dark`, or follow the operating system. The button flips between light and dark. |
| Reasoning effort | `low` | Chip at the bottom-left of the composer | One of `off`, `none`, `low`, `high`, `max`. Sent as `reasoning_effort` with every request. |

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
| Shadow | `0 2px 8px rgba(0, 0, 0, 0.04)` | The only elevation level in the system. |
| Primary action | `#111111` background, white text, radius 4 to 6 pixels, no shadow | Pressed state is `transform: scale(0.98)`. |
| Easing | `cubic-bezier(0.16, 1, 0.3, 1)` | Applied to every transition. |
| Animation | `transform` and `opacity` only | Nothing animates width, height, or colour. |

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
│   ├── deno.ts           # Deno Deploy entry point
│   ├── vercel/edge.ts    # Vercel Edge entry point
│   └── wrangler.toml     # Cloudflare Workers configuration
├── tools/
│   └── check-readme-parity.mjs
└── .github/workflows/
    ├── ci.yml            # type check, README sync check, build
    └── deploy.yml        # build and publish to GitHub Pages
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