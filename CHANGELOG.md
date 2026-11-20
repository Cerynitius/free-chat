# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Nothing yet.

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