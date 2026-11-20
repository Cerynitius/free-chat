# Contributing

Thanks for taking the time to contribute. This document is the working agreement for the repository: what the environment must look like, what has to pass before a commit, and the visual rules the interface is not allowed to break.

## Requirements

| Tool | Version |
|---|---|
| Node.js | 24 |
| npm | 11 |

Check with:

```bash
node --version
npm --version
```

## Getting started

```bash
git clone https://github.com/JiHuiYiYou/hippocrenes-model-chat.git
cd hippocrenes-model-chat
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies. |
| `npm run dev` | Start the Vite dev server on `http://localhost:5173`. |
| `npm run proxy` | Start the local proxy on `http://127.0.0.1:8787`. It reads the key from `API_KEY`. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run build` | Type check and produce the production build in `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run check:readme` | Verify that the two README files stay in sync. |

The frontend needs a proxy to chat, so run `npm run proxy` in a second terminal while developing.

## The three gates

Every commit must pass all three, in this order:

```bash
npm run typecheck
npm run build
npm run check:readme
```

CI runs exactly the same three commands on every push and pull request, and the readme check runs before the build. A change that breaks any of them does not land.

## Documentation rules

**`README.md` and `README.zh-CN.md` must be updated in the same commit.** The two files have to keep the same section skeleton, which is checked by `npm run check:readme`. The check compares the machine-readable section marker in both files, verifies that they link to each other, verifies that both carry the current version number from `package.json`, and rejects Chinese characters in the prose of the English file.

The skeleton marker looks like this and must appear verbatim in both files:

```
<!-- sections: intro features quickstart connect deploy settings design dev contribute license -->
```

**Code comments are written in Simplified Chinese. Public-facing documentation is written in English.** The only Chinese facade document is `README.zh-CN.md`. Never mix languages inside a single document: an English document contains no Chinese prose, and a Chinese document contains no English prose. Technical identifiers, commands, file paths, model names, and the contents of code blocks are exempt, since those are identifiers rather than prose.

## Visual red lines

The interface has a deliberately quiet visual language. These rules are not suggestions:

- **Borders.** Every outline in the interface is `1px solid #EAEAEA`. Do not introduce a second border colour or a heavier border weight.
- **Radius.** Large containers stop at 12 pixels. The `rounded-full` utility is reserved for small tags and pills. Nothing else is fully rounded.
- **Shadow.** There is exactly one elevation level: `0 2px 8px rgba(0, 0, 0, 0.04)`. Tailwind's `shadow-md`, `shadow-lg`, and `shadow-xl` are forbidden.
- **Primary action.** Background `#111111`, white text, radius between 4 and 6 pixels, no shadow, and `:active { transform: scale(0.98) }`.
- **Body text.** Line height 1.6. Primary text `#111111` or `#2F3437`; secondary text `#787774`.
- **Forbidden treatments.** No gradients, no neon, no glassmorphism, no blurred backdrops.
- **Motion.** Animate `transform` and `opacity` only. Never animate width, height, or colour. The single easing curve is `cubic-bezier(0.16, 1, 0.3, 1)`.
- **No emoji.** Icons come from Phosphor, using the Bold and Fill weights only.

The design tokens live in one place, `src/styles.css`. If a colour, radius, shadow, or easing value is wrong, fix the token rather than hard-coding a value in a component.

## Commit identity

Commit with this identity:

```
JHYY <15901598712@163.com>
```

and end the message with this trailer:

```
Co-Authored-By: MiniMax-M3.1-Flash <noreply@MiniMax>
```

## Pushing to GitHub

Push over SSH. The token behind the `gh` command line tool does not carry the `workflow` scope, so pushing workflow files over HTTPS is rejected by GitHub, and the deploy workflow would never run.

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519 && GIT_SSH=/usr/bin/ssh git push origin main
```

If port 22 is blocked on the current network, route GitHub SSH through port 443 instead:

```bash
mkdir -p ~/.ssh
cat >> ~/.ssh/config <<'EOF'
Host github.com
  Hostname ssh.github.com
  Port 443
  User git
EOF
```

Then push as usual:

```bash
git push origin main
```

## Pull requests

1. Branch from `main`.
2. Make sure the three gates pass locally.
3. Update `README.md` and `README.zh-CN.md` together if the change affects behaviour, configuration, or the interface.
4. Describe what changed and why in the pull request body.

## Reporting bugs

Open an issue with the version, the browser, and the steps to reproduce. Never paste an API key into an issue, a pull request, a screenshot, or a log. See `SECURITY.md` for how to report a security problem privately.