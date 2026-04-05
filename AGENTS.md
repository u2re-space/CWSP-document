# AGENTS.md

## Cursor Cloud specific instructions

### Overview

CrossWord i1 is an AI-powered markdown/document processing PWA with a Fastify backend. It is a git submodule of the [unite-2.man](https://github.com/u2re-space/unite-2.man) monorepo and expects to sit at `apps/CrossWord/` within that monorepo. The `shared/fest/` framework libraries are symlinks into `../../modules/projects/` (the monorepo's fest-live submodules).

### Monorepo layout

Since `/workspace` is the crossword repo, `../../` resolves to `/`. The update script clones the monorepo's `modules/` and `assets/` to `/modules/` and `/assets/` so that relative symlinks like `../../modules/shared/test` resolve correctly. It also creates `/node_modules` as a symlink to `/workspace/node_modules` for the `assets/icons` symlink.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Vite dev server (frontend) | `npm run dev` or `npx vite dev --port 5173` | 443 (default) or custom | Use `--port 5173` to avoid needing root privileges |
| Fastify endpoint (backend) | `cd src/endpoint && npm run start` | 8443 (HTTPS) + 8080 (HTTP) | |

### Key caveats

- **Node.js >= 24 required.** Use `nvm install 24 && nvm alias default 24`.
- **HTTPS certificates:** Both Vite and the endpoint server require TLS certs. Self-signed certs are generated in `private/https/` (frontend) and `src/endpoint/https/` (backend). These dirs are gitignored and created by the update script.
- **Port 443** needs `sudo setcap cap_net_bind_service=+ep $(which node)` or use `--port 5173`.
- **`cssnano-preset-advanced`** and **`cbor-x`** are runtime-required but not in `package.json`; the update script installs them.
- **`shared/fest/`** symlinks: Must point to real fest-live library sources from the monorepo (`/modules/projects/*/src`). The update script sets these up.
- **`font-registry.ts`** stub: The veela.css module's `font-loader.ts` dynamically imports `./font-registry` which is a generated file. The update script creates an empty stub at `/modules/projects/veela.css/src/ts/font-registry.ts`.
- **Python tests** (`src/endpoint/tests/`) all depend on `windows-use` (Windows-only). They cannot run on Linux.
- **Production build** may fail with a `font-registry` resolution error in the PWA service worker build step; the dev server works fine.
- **Endpoint `clipboardy`** is listed as optional but imported unconditionally; must be installed for the backend to start.

### Lint / Test / Build

- **Lint (formatting):** `npx prettier --check "src/**/*.ts"` (root)
- **Build (frontend):** `npm run build` (root) — may fail on font-registry; dev server is the primary workflow
- **Tests (frontend):** `npm run test:test` (root) — echoes "No tests configured"
- **Tests (endpoint):** `cd src/endpoint && python3 -m pytest tests/unit/ -v` — requires `windows-use` (Windows-only)
- **Typecheck (endpoint):** `cd src/endpoint && npx tsc -p tsconfig.json --noEmit` — 2 pre-existing errors
- **Dev server:** `npx vite dev --port 5173 --no-open` (root) — the primary development workflow

## Token & Context Optimization

To minimize token usage and optimize context window:
- **No Yapping**: Keep responses extremely concise. Answer directly without filler text.
- **Targeted Edits**: Never repeat code that hasn't changed. Use precise file editing tools.
- **Avoid Large Files**: Do not read package lockfiles, compiled assets, or large data files into context.
- **Limit Output**: Only generate necessary code files. Do NOT generate unnecessary reports (e.g., `BUGFIX.md`, `SUMMARY.md`) unless explicitly requested.
- **Use Memory over Context**: Rely on the `pantry` system instead of reading the whole codebase repeatedly or asking the user for context over and over again.

## Pantry — persistent notes

You have access to a persistent note storage system via the `pantry` MCP tools.

**Session start — MANDATORY**: Before doing any work, retrieve notes from previous sessions:

- Call `pantry_context` to get recent notes for this project
- If the request relates to a specific topic, also call `pantry_search` with relevant terms

**Session end — MANDATORY**: After any task that involved changes, decisions, bugs, or learnings, call `pantry_store` with:

- `title`: short descriptive title
- `what`: what happened or was decided
- `why`: reasoning behind it
- `impact`: what changed
- `category`: one of `decision`, `pattern`, `bug`, `context`, `learning`
- `details`: full context for a future agent with no prior knowledge

Do not skip either step. Notes are how context survives across sessions.
