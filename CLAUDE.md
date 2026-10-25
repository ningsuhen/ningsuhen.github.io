# CLAUDE.md

## What this repo is

Personal site for Ning Waikhom: Astro + Fuwari theme, deployed to GitHub Pages from `master` by GitHub Actions (https://ningsuhen.github.io/). Content is Markdown posts plus standalone HTML reports. Edited through Pages CMS (`.pages.yml`). All rights reserved: research and content may not be reused without permission (`/license/`).

## Structure

- Wording: Research = reports (static analyses and benchmarks you read). Experiments = live experiments (things you play with in the browser). Ideas = short write-ups of things I may build or test (not research or experiments yet).
- `src/content/posts/<slug>/index.md`: posts. Report posts: tag and category `Research`. Live-experiment posts: tag and category `Experiment`. Idea posts: tag and category `Idea`. All three show the LicenseNote.
- `/research/`: `src/pages/research.astro`, data `src/data/research.json` (cards chipped "Report").
- `/experiments/`: `src/pages/experiments.astro`, data `src/data/experiments.json` (cards chipped "Live experiment"). Status `Coming soon` shows a dimmed card with no links; `Draft` is hidden on both pages.
- `/ideas/`: `src/pages/ideas.astro`, data `src/data/ideas.json` (cards chipped "Idea"); no standalone page, the entry links to the idea post; empty shows "Nothing here yet."
- Shared card list: `src/components/EntryCards.astro` (prop `kind`), type `src/types/entry.ts`.
- Standalone pages: reports at `public/research/<slug>/index.html`, live experiments at `public/experiments/<slug>/index.html`. Shipped as-is, not Fuwari pages. Never create `public/research/index.html` or `public/experiments/index.html`: the Astro pages own those URLs.
- Old report URLs redirect (`redirects` in `astro.config.mjs`): add one there when moving a page.
- `public/design-system/`: design system and `template.html` (scaffold source). Do not edit casually.
- Listen player (every post, opt-out `noListen: true`): `src/components/ListenPlayer.astro` + `src/scripts/tts/` (engine contract `engine.ts`, normaliser `normalize.ts`, article extraction `extract.ts`, Web Speech engine, Kokoro stub, `listen-player.ts`). Neural engine (Kokoro-82M, `public/tts/`, from Brev): `kokoro.js`, `kokoro_glue.js`, `kokoro_bg.wasm`, `snippets/`; `vendor/ort/` and `lexicon-en-us.txt` are gitignored until the owner decides vendor vs CDN+SRI. Off unless `KOKORO_ENABLED` is true in `ListenPlayer.astro`; the CPU tier stays off (`window.__KOKORO_CPU`). ORT base: `PUBLIC_KOKORO_ORT_BASE` at build time, default `/tts/vendor/ort/`. Licences: `public/tts/LICENSES.txt`. `pnpm check:kokoro`: real-browser check (needs internet; not in `pnpm check`).
- `src/integrations/standalone-header.ts`: injects the navbar and license footer into every `public/**/*.html` at build and in dev.
- `src/config.ts`: `navBarConfig` (the standalone navbar derives from it).
- `scripts/`: `new-experiment.mjs` (scaffold; `--research` for Research, `--idea` for Ideas), `check-standalone-pages.mjs`, `sync-dev-next.sh`, `merge-pr.sh`, `test-pre-push.sh`, `dev-server.sh`, `install-hooks.sh`.

## Commands

- `pnpm dev`: the always-on dev server on http://127.0.0.1:4321 (strict: exits if 4321 is taken).
- `pnpm dev:agent`: ad-hoc dev server for agents and worktrees, first free port from 4400 up (the URL is printed).
- Agents must NEVER start a server on port 4321 (`pnpm dev`, `pnpm preview`, `astro dev --port 4321`): the LaunchAgent owns it. Use `pnpm dev:agent`.
- `pnpm build`: Astro build + Pagefind.
- `pnpm check:standalone`: real-browser check of standalone pages and Back navigation. Needs a build and `CHROME_PATH` (or `pnpm exec playwright-core install chromium`).
- `pnpm check:theme`: real-browser check of the theme model (light default, only `auto` follows the OS, toggles, navigation, second tab). Needs a build and `CHROME_PATH`.
- `pnpm check:design-system`: conformance of every standalone page against the design system and the main post page (`/posts/rust-learnings/`), in a real browser. Needs a build. `--update-baseline` for local triage only. Rules, exceptions and baseline policy: design-system guide, "Conformance".
- `pnpm check:listen`: real-browser check of the Listen player on a built post (speech is stubbed). `pnpm test:tts`: unit tests for the speech normaliser and chunker.
- `pnpm astro check`: type check.
- `pnpm new-research <slug> "<Title>" ["<summary>"]` / `pnpm new-experiment <slug> "<Title>" ["<summary>"]`: scaffold page, draft post and Draft entry. `pnpm new-idea <slug> "<Title>" ["<summary>"]`: draft post and Draft entry only (no page). Then set the entry's status to `Live` (or `Coming soon`).
- `pnpm sync`: local-only dev/next sync (see below). `pnpm merge-pr <n>`: squash-merge a PR, then sync.
- `pnpm test:hooks`: tests the pre-push guard.
- `pnpm check:leaks`: scans the built site, `public/`, `src/content/`, `src/data/` and these docs for leaks (see CRITICAL "No leaks"). `node scripts/check-public-leaks.mjs <dir>` scans any export folder.
- `scripts/leak-denylist.local.txt` (gitignored, never committed): optional extra private terms, one per line, read by `check:leaks`.
- Dev server: LaunchAgent `com.ningsuhen.github-io.dev` runs `scripts/dev-server.sh` (pnpm dev, port 4321) against the branch checked out in the project root. It only picks up merged work after `pnpm sync`. Its log is the LaunchAgent log file under the user's Library/Logs.

## Repo contents: shipped output only (CRITICAL)

This repo holds the site and the compiled output that research and experiments need to run. Everything else lives in its own repo.

- Allowed: the Astro site source, posts and their images, and for each report or experiment its built files only (`index.html`, minified JS, WASM, CSS, fonts, data the page loads, thumbnails).
- Not allowed: source code of experiments, games or simulations (Rust, Python, TypeScript sources, generators, notebooks, build scripts for them), model weights, raw datasets, logs, intermediate or debug outputs, unminified bundles when a minified build exists, duplicate versions of an artifact (keep the current one; history has the rest).
- Build and develop in the owning project's repo, then copy in only the compiled result. Record where it came from (project name and a build hash) in the PR, never a local path.
- Keep payloads small: strip source maps and unused assets, prefer gzip-friendly formats, and ask before adding anything over 1 MB. Large models are fetched from their public host at runtime, never committed.
- Before adding a file ask: does the live page need it at runtime? If not, it does not belong here.
- Periodically audit `public/` for files no page references and remove them.

## Rules

- Navbar and license footer are injected by the build. Never hand-roll them in a standalone page. Standalone pages set `<html data-theme>`; light is the default. The navbar mounts on `<html>` before `<body>`.
- Standalone pages: no iframes. Swup must not intercept links to standalone pages (`src/layouts/Layout.astro`, `src/utils/standalone-utils.ts`).
- Icons inside standalone pages are Lucide (`<svg class="rd-icon"><use href="#i-name"/></svg>`; `pnpm build` generates the sprite). No emoji or glyph arrows as UI icons.
- Standalone pages must conform to the design system (`pnpm check:design-system`, CI). Known violations are in `scripts/design-system-baseline.json` with an owner (EcoSimulation, Brev, site). New violations fail; an entry that stops firing must be deleted in the same PR. Never add an entry for a new violation to get green: fix it, or document an exception (`<meta name="ds-allow">`). Re-exports from EcoSimulation or Brev must pass the check before they land.
- CRITICAL, posts: every post (new or substantially edited) must be in the owner's voice: run `/tmc-brainstorm` on it for title/outline/voice and apply it; learn the voice from the owner's own old posts, About page and `local-llms-getting-easier` (casual first person, short plain sentences, honest about what is unmeasured, no hype or AI filler, no emoji). Keep a claim table (claim | source | verified) and delete unverified claims; never invent personal facts; never name private projects, hosts, paths or employers (leak-scan before merging). First-person or sensitive posts are merged only after the owner confirms the voice.
- In Markdown, escape every literal dollar sign as `\$` (math renderer).
- Card thumbnails: every published post (`draft: false`) must have a purpose-made square `thumbnail` (800x800 `thumb.webp`, ONE focal element, no text, under 60 KB). If the post has no suitable image, generate one from its content (AI image tool if available, else a programmatic illustration). Never auto-crop covers or body images. `pnpm check:thumbnails` fails for a missing or non-conforming thumbnail; the build warns about the same posts. `public/images/default-thumbnail.webp` is only the fallback for drafts.
- CRITICAL, no leaks: nothing published (posts, reports, experiments, exported pages, images, build output, commit messages, PR text) may contain local absolute or home-relative paths, `../` links that escape the site, machine, user or host names, internal URLs or ports, IP addresses, personal email (commits use the GitHub noreply address), tokens or keys, private project, employer or agreement names, or image metadata (EXIF, XMP, text chunks). `pnpm check:leaks` must pass (CI runs it) and agents run it before every PR. Exported pages from other projects are scanned before merge. History-only leaks are reported to the owner, never rewritten without an explicit go.
- The check must pass before a PR: `pnpm build && CHROME_PATH=<chrome-headless-shell path> pnpm check:standalone`.
- Shell: `rg`, `fd`, `rm -f`, never `git reset --hard`, never `--no-verify`.

## Git and PR flow

- `master` is protected. Work on a branch in a worktree under `.worktrees/` only. Open PRs with `gh pr create --base master`; merge with squash (`pnpm merge-pr <n>`).
- PR body ends with a blank line, `---`, then `<sub>Ning›🤖›</sub>`.
- Git hooks: `pnpm install` runs `prepare`, which installs `.githooks/` into the repo. Needs `gitleaks` (`brew install gitleaks`); pre-commit and pre-push scan for secrets.
- `dev/next` is a LOCAL-ONLY branch. It mirrors `origin/master` so the dev server previews merged work (`pnpm sync` keeps it at origin/master, checks it out in the primary checkout when that is clean, and deletes local branches already merged). It is never a PR base, never pushed (pre-push refuses it), and it refuses to move if it has local commits.
