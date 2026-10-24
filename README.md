# ningsuhen.github.io

Personal site built with [Astro](https://astro.build) + the [Fuwari](https://github.com/saicaca/fuwari) theme (MIT), edited via [Pages CMS](https://pagescms.org) (`.pages.yml`).

## Layout

- **Projects** (posts): `src/content/posts/<slug>/index.md` + `cover.png`
- **About / Skills / Experience / Contact**: `src/content/spec/about.md`
- **Site config** (title, subtitle, banner, profile, links, theme): `src/config.ts`
- **Legacy redirects**: `astro.config.mjs` → `redirects`

## Development

```sh
pnpm install
pnpm dev        # local dev server
pnpm check      # astro check (type-check)
pnpm build      # astro build + pagefind index
pnpm preview    # preview the built site
```

Requires Node 22+ and pnpm (the repo pins `packageManager: pnpm@9.14.4`).

## Editing content

Open the repo in [Pages CMS](https://pagescms.org) (or edit the files directly). `.pages.yml` defines:

- `posts` — the project posts (folder-per-entry, `image` is the `./cover.png` in the post folder).
- `about` — the About page body.
- `site` — `src/config.ts` as a code editor.
- `uploads` — media library at `public/uploads`.

## Theme

Light by default on first visit (ignores the OS preference); the light/dark toggle in the navbar still works and the choice is persisted in `localStorage`.

## Comments (Giscus)

Posts show GitHub-Discussions-powered comments via [Giscus](https://giscus.app). Config lives in `src/config.ts` (`commentConfig`). One-time setup: install the [giscus GitHub App](https://github.com/apps/giscus) on this repo (Settings → App integrations → Add giscus). Discussions are enabled and use the "Announcements" category.

## Deploy

Push to `master` → GitHub Actions builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`, pnpm + Node 22).

One-time setup: in the repo **Settings → Pages → Source**, choose **GitHub Actions**.
