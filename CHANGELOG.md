# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A workflow that hosts the proxy on a GitHub Actions runner, `.github/workflows/tunnel.yml`: it starts one run every four hours (`cron: 17 */4 * * *`), lets each run live for at most 5.5 hours (`timeout-minutes: 330`), installs `cloudflared`, starts the local proxy with the key read from the repository secret `VITE_API_KEY`, opens the tunnel, and publishes the resulting address into the `tunnel-url` file on the `runtime` branch. The run fails when the runner cannot reach the origin: the workflow probes `/__ping` and requires `"reachable": true` in the answer. The workflow sets no concurrency group, so a new run starts alongside the previous one instead of cancelling it or queueing behind it; the previous round stays up for another 1.5 hours after the new one takes the pointer, so the handover leaves no gap.
- An upstream pointer in the proxy, `UPSTREAM_POINTER`: the proxy fetches a publicly readable text file at runtime and uses its content as the upstream. The result is cached for thirty seconds, and a failed read keeps the last address that worked instead of taking the proxy down. `proxy/wrangler.toml` points it at the `tunnel-url` file on the `runtime` branch.
- A `runtime` branch, an orphan branch that holds nothing but the `tunnel-url` file the pointer reads.
- A tunnel launcher, `proxy/tunnel.mjs`, wired to `npm run tunnel`: it starts the local proxy, opens a Cloudflare quick tunnel to it, and writes the resulting `trycloudflare.com` address into the repository variable `VITE_PROXY_URL` with the `gh` CLI before triggering the Pages deployment. The tunnel address changes on every restart, and the site follows it automatically.
- A Vercel entry point on the Node runtime, `proxy/api/[...path].js`, with `proxy/vercel.json` rewriting every path onto `/api/:path*`. The project root is `proxy/`. Node rather than Edge, because an Edge function runs on an edge node and only a real container can be relied on to reach a bare IP on a non-standard port.

### Changed

- The default deployment path is now the Actions-hosted proxy behind a fixed Cloudflare Worker address, instead of a proxy on a machine somebody has to keep running. Actions minutes are free for a public repository, so this costs nothing and needs no account. `VITE_PROXY_URL` still means "the public address of the proxy", and in that setup it points at the Worker, whose address does not change when the tunnel does: a new tunnel address reaches the Worker within thirty seconds and neither the Worker nor the site has to be redeployed.
- The project is now a chat client for exactly one model, `dsv4-flash`, and both READMEs say so. The generic OpenAI-compatible framing is gone.
- The connection target is decided at build time instead of at runtime. `src/config.ts` is the single source of truth for the origin URL, the model id, the API key, the default reasoning effort, and the sampling parameters.
- `VITE_PROXY_URL` selects the endpoint: when it is set every request goes through that proxy, when it is empty the request goes straight to the origin. In development an unset `VITE_PROXY_URL` falls back to `http://127.0.0.1:8787`, the local proxy, so a fresh clone runs with `npm install && npm run proxy && npm run dev`.
- `VITE_API_KEY` injects the API key at build time. The repository holds no real value.
- The settings panel is gone. Only the theme and the reasoning effort remain adjustable, and both are reachable directly from the interface: the theme from the icon button at the bottom of the sidebar, the reasoning effort from the chip at the bottom-left of the composer.
- The reasoning effort chip now offers all five levels: off, none, low, high, and max.
- The empty state is reduced to the product name. The onboarding guide, the introduction copy, and the suggested questions are gone.
- The API key table in the READMEs now lists two locations instead of three, and the claim that the frontend probes `/__ping` before sending its own key was dropped: the proxy injects the key server-side and overrides whatever the client sent.
- The README deployment chapter now tells you to set the repository variable `VITE_PROXY_URL` to the public address of your proxy — the Worker address in the default setup, the tunnel address, the Vercel or Deno Deploy URL, or the address of your own server — instead of telling you to type a proxy address into the interface.
- Both READMEs and `proxy/README.md` no longer present Cloudflare Workers as a way to run this proxy. The upstream is reached over TLS at a bare IP whose certificate names only that IP, and the Workers edge refuses to connect to it: `error code: 1003` for the bare IP, `526 Invalid SSL Certificate` for a hostname that points at the same address, and the free plan cannot do TLS over `cloudflare:sockets`. The proxy therefore has to run on a machine with unrestricted network access — the Actions runner, the quick tunnel, Vercel on the Node runtime, Deno Deploy, or a self-hosted Node server. The Workers deployment files stay in `proxy/` and still apply to an upstream that has a domain name. Against this upstream the Worker is used the other way round: as the fixed entry point in front of the tunnel, which it can do because it only has to fetch an ordinary hostname.
- The README deployment chapters now describe three hosting options in the order they are worth trying — GitHub Actions (default, free), your own server / Vercel / Deno Deploy, and your own machine plus a tunnel — and the Quick Start now starts from the published site already working, because the reader no longer has to run anything to get a working chat.

### Removed

- The whole settings panel: connection mode, proxy URL, origin URL, API key input, model name, temperature, top_p, max_tokens, system prompt, and font size.
- The SetupGuide card that explained how to reach the service, together with its three deployment paths.
- The connection status badge (untested, connected, latency) and the token usage bar.
- The client-side token estimate that was shown under each message.
- URL hash encoding of conversations, and the confirmation card that went with it.
- Exporting a conversation as Markdown.
- The model name label and the hint line under the composer.
- The "connection not tested yet" notice.

### Fixed

- Long answers and long thoughts are no longer cut off in the middle. The upstream counts `reasoning_content` against the same `max_tokens` budget as the answer, so thinking hard ate the whole budget and left the answer nothing: measured against this upstream, a deep reasoning task at `max_tokens: 4096` spent all 4096 tokens on thinking and produced not a single token of answer. `MAX_TOKENS` is now `32768`; the upstream accepts values up to `131072`.
- A cut-off response is no longer presented as a finished one. The client now tracks the upstream's `finish_reason` and whether the stream ended with a termination marker, and a truncated message carries a notice that tells a token-budget cut, a dropped connection, and an upstream filter apart. Previously every one of them looked like a normal completed answer.
- The upstream's `finish_reason` is read before the delta, so a last frame that carries no `delta` no longer swallows the termination reason.
- The Vercel entry point asks for 300 seconds instead of 60. Vercel kills a function at `maxDuration`, and a long think easily runs past a minute.

## [0.1.0] - 2026-11-20

### Added

- Streaming chat over Server-Sent Events against an OpenAI-compatible endpoint, with a blinking typing caret and buffered rendering at twelve flushes per second.
- A dedicated reasoning panel that keeps `reasoning_content` separate from the answer body, collapsible, with a "thought for X.X seconds" readout.
- Five reasoning effort levels: off, none, low, high, and max, sent as `reasoning_effort`.
- Full multi-turn conversation history sent back with every request.
- GitHub Flavored Markdown rendering with tables, sanitized through DOMPurify.
- Syntax highlighting for fourteen languages, with a working copy button on every code block.
- KaTeX rendering for inline and display math formulas.
- Regenerate, stop generation with an abort controller, copy an answer, and export a whole conversation as Markdown.
- Local conversation history in `localStorage`, grouped by today, yesterday, this week, and earlier, with new and delete.
- A settings panel covering connection mode, proxy URL, origin URL, API key, model, reasoning effort, temperature, top_p, max_tokens, system prompt, theme, and font size.
- A connection test and a proxy self-check against `/__ping`, reporting latency and whether the proxy holds a key.
- Light, dark, and follow-the-system themes.
- A persistent desktop sidebar and a mobile drawer, with soft-keyboard handling through `visualViewport`.
- A context usage meter based on a client-side token estimate.
- Conversation sharing through the URL hash, with no backend involved.
- A responsive layout that covers both phones and desktops.
- A zero-dependency reverse proxy in `proxy/`, running on Node, Cloudflare Workers, Deno Deploy, and Vercel Edge.
- Continuous integration for type checking, readme parity, and production builds.
- Automated deployment to GitHub Pages.

[Unreleased]: https://github.com/JiHuiYiYou/hippocrenes-model-chat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JiHuiYiYou/hippocrenes-model-chat/releases/tag/v0.1.0