# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| < 0.1 | No |

## Never share an API key

Do not paste an API key into an issue, a pull request, a discussion, a screenshot, a screen recording, or a log file. If a key ever appears in public text, treat it as compromised and rotate it immediately.

## Where the API key can live

There are three places the upstream key can be stored, with very different exposure profiles:

| Location | How it is set | Who can read it |
|---|---|---|
| Browser `localStorage` | Typed into the settings panel at runtime | Anyone with access to that browser or its profile. This is the direct-connection mode. |
| Worker secret | `npx wrangler secret put API_KEY` on Cloudflare Workers, or the equivalent on other platforms | Nobody outside the platform. The proxy injects it server-side on every upstream request. **Recommended.** |
| Build-time repository secret | The `VITE_API_KEY` repository secret, injected by the deployment workflow during the build | Everyone. The value is compiled into the JavaScript bundle that is published to the public internet. |

In proxy mode the frontend sends no `Authorization` header at all. It asks the proxy whether it holds a key and only falls back to sending its own when the proxy reports that it has none. This is the configuration to prefer for any public deployment.

## A key compiled into a web page is published

There is no way around it: anything the browser can send, the browser can also reveal to anyone who opens the developer tools or downloads the bundle. A key injected through `VITE_API_KEY` at build time is readable by every visitor.

Because of that:

- Prefer proxy mode for public deployments, so the key never leaves the server.
- If a key has to be compiled into the bundle, rotate it on a regular schedule and keep its permissions as narrow as the upstream allows.
- Rotate a key immediately if it appears in a screenshot, a public repository, a CI log, or a chat message.

## Reporting a vulnerability

Please report security problems privately rather than through a public issue.

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version, and the steps to reproduce.

Private vulnerability reporting opens a GitHub Security Advisory, which only you and the maintainers can read. Expect an acknowledgement within 48 hours, and a status update until the report is resolved.

If private reporting is unavailable for your account, open a regular issue that contains only a description of the problem with no proof-of-concept details and no credentials, and ask for a private channel to continue the discussion.

## Scope

The project hosts no data server side. Conversations live in the visitor's own browser, and the deployment publishes static files only. Reports about the upstream API's own behaviour, or about third-party services used for deployment, are out of scope for this repository.