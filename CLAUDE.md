# CLAUDE.md

## What this repo is

Personal site for Ning Waikhom: Astro + Fuwari theme, deployed to GitHub Pages from `master` by GitHub Actions (https://ningsuhen.github.io/). Content is Markdown posts plus standalone HTML reports. Edited through Pages CMS (`.pages.yml`). All rights reserved: research and content may not be reused without permission (`/license/`).

## Structure

- Wording: Research = reports (static analyses and benchmarks you read). Experiments = live experiments (things you play with in the browser).
- `src/content/posts/<slug>/index.md`: posts. Report posts: tag and category `Research`. Live-experiment posts: tag and category `Experiment`. Both show the LicenseNote.
- `/research/`: `src/pages/research.astro`, data `src/data/research.json` (cards chipped "Report").
- `/experiments/`: `src/pages/experiments.astro`, data `src/data/experiments.json` (cards chipped "Live experiment"). Status `Coming soon` shows a dimmed card with no links; `Draft` is hidden on both pages.
- Shared card list: `src/components/EntryCards.astro` (prop `kind`), type `src/types/entry.ts`.
- Standalone pages: reports at `public/research/<slug>/index.html`, live experiments at `public/experiments/<slug>/index.html`. Shipped as-is, not Fuwari pages. Never create `public/research/index.html` or `public/experiments/index.html`: the Astro pages own those URLs.
- Old report URLs redirect (`redirects` in `astro.config.mjs`): add one there when moving a page.
- `public/design-system/`: design system and `template.html` (scaffold source). Do not edit casually.
- `src/integrations/standalone-header.ts`: injects the navbar and license footer into every `public/**/*.html` at build and in dev.
- `src/config.ts`: `navBarConfig` (the standalone navbar derives from it).
- `scripts/`: `new-experiment.mjs` (scaffold; `--research` for Research), `check-standalone-pages.mjs`, `sync-dev-next.sh`, `merge-pr.sh`, `test-pre-push.sh`, `dev-server.sh`, `install-hooks.sh`.

## Commands

- `pnpm dev`: the always-on dev server on http://127.0.0.1:4321 (strict: exits if 4321 is taken).
- `pnpm dev:agent`: ad-hoc dev server for agents and worktrees, first free port from 4400 up (the URL is printed).
- Agents must NEVER start a server on port 4321 (`pnpm dev`, `pnpm preview`, `astro dev --port 4321`): the LaunchAgent owns it. Use `pnpm dev:agent`.
- `pnpm build`: Astro build + Pagefind.
- `pnpm check:standalone`: real-browser check of standalone pages and Back navigation. Needs a build and `CHROME_PATH` (or `pnpm exec playwright-core install chromium`).
- `pnpm astro check`: type check.
- `pnpm new-research <slug> "<Title>" ["<summary>"]` / `pnpm new-experiment <slug> "<Title>" ["<summary>"]`: scaffold page, draft post and Draft entry. Then set the entry's status to `Live` (or `Coming soon`).
- `pnpm sync`: local-only dev/next sync (see below). `pnpm merge-pr <n>`: squash-merge a PR, then sync.
- `pnpm test:hooks`: tests the pre-push guard.
- Dev server: LaunchAgent `com.ningsuhen.github-io.dev` runs `scripts/dev-server.sh` (pnpm dev, port 4321) against the branch checked out in the project root. It only picks up merged work after `pnpm sync`. Log: `~/Library/Logs/ningsuhen-github-io/dev.log`.

## Rules

- Navbar and license footer are injected by the build. Never hand-roll them in a standalone page. Standalone pages set `<html data-theme>`; light is the default. The navbar mounts on `<html>` before `<body>`.
- Standalone pages: no iframes. Swup must not intercept links to standalone pages (`src/layouts/Layout.astro`, `src/utils/standalone-utils.ts`).
- Icons inside standalone pages are Lucide (`<svg class="rd-icon"><use href="#i-name"/></svg>`; `pnpm build` generates the sprite). No emoji or glyph arrows as UI icons.
- In Markdown, escape every literal dollar sign as `\$` (math renderer).
- Card thumbnails: only the `thumbnail` field (a square 800x800 `thumb.webp` showing ONE focal element, under 60 KB), else `public/images/default-thumbnail.webp`. Never auto-crop covers or body images. `pnpm check:thumbnails` enforces the size rules; the build warns about posts with images but no `thumbnail`.
- Before publishing, redact internal host names (e.g. `*.mac-mini-eby`) from posts and reports.
- The check must pass before a PR: `pnpm build && CHROME_PATH=$(fd -t f 'chrome-headless-shell$' ~/Library/Caches/ms-playwright -d 4 | tail -1) pnpm check:standalone`.
- Shell: `rg`, `fd`, `rm -f`, never `git reset --hard`, never `--no-verify`.

## Git and PR flow

- `master` is protected. Work on a branch in a worktree under `.worktrees/` only. Open PRs with `gh pr create --base master`; merge with squash (`pnpm merge-pr <n>`).
- PR body ends with a blank line, `---`, then `<sub>Ning›🤖›</sub>`.
- Git hooks: `pnpm install` runs `prepare`, which installs `.githooks/` into the repo. Needs `gitleaks` (`brew install gitleaks`); pre-commit and pre-push scan for secrets.
- `dev/next` is a LOCAL-ONLY branch. It mirrors `origin/master` so the dev server previews merged work (`pnpm sync` keeps it at origin/master, checks it out in the primary checkout when that is clean, and deletes local branches already merged). It is never a PR base, never pushed (pre-push refuses it), and it refuses to move if it has local commits.
