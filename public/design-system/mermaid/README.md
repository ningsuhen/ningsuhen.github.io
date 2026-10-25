# Mermaid theme for the research design system

Static diagrams (architecture, flows, sequences) are Mermaid source, pre-rendered to SVG (or PNG). The
render uses the `--rd-*` tokens, so an inlined SVG follows the page's light/dark toggle. A standalone
render (no page CSS) falls back to the light palette.

**Never ship the Mermaid runtime** (megabytes of JS) to a page or a game, and **never use Mermaid's default
theme**. Only the pre-rendered SVG/PNG ships.

## Author

- At most about 12 nodes, sentence-case labels, no emoji, one direction (`flowchart LR` or `TD`).
- Colour by role with `class`, not ad-hoc colours or `style`/`classDef`:

| Class | Colour token | Use for |
|---|---|---|
| `actor` | `--rd-cat-1` | people, clients, callers |
| `compute` | `--rd-cat-2` | GPUs, workers, models |
| `memory` | `--rd-cat-3` | caches, buffers, state |
| `control` | `--rd-cat-4` | routers, schedulers, policy |
| `data` | `--rd-cat-5` | payloads, files, streams |
| `external` | `--rd-cat-6` | third-party or out-of-scope services |
| `good` / `warn` / `bad` | `--rd-good` / `--rd-warn` / `--rd-bad` | status (solid fill, bold text: never confused with a role) |

```
flowchart LR
  A([Client]) --> B[Router]
  class A actor
  class B control
```

Sequence diagrams take the theme but have no node classes. Examples: `examples/*.mmd`.

## Render

From the repo root (paths are relative to where you run it):

```
pnpm render:mermaid public/design-system/mermaid/examples/request-flow.mmd out/request-flow.svg
pnpm render:mermaid diagram.mmd diagram.png      # white background, 2x
```

The script applies `config.json` and `theme.css`, gives the SVG an id from the output file name
(`mmd-<name>`, so several inlined diagrams on one page never share style rules), drops Mermaid's literal
colours, and keeps only var() colours. Name output files uniquely per page.

Chrome: puppeteer needs a Chrome. If it has none, set `MERMAID_CHROME` (or `CHROME_PATH`) to any
Chrome/Chromium binary, for example the Playwright Chromium.

The SVG carries its intrinsic size (text is 14px everywhere, never scaled); wide diagrams scroll inside the figure. `examples/legend.mmd` shows all nine classes and doubles as a regression view.

Inline the SVG in `<figure class="rd-figure" aria-label="...">`. Show the `.mmd` source in a code block.

## Vendor into another project

Copy these files and record the source commit in your project's docs (for example "mermaid theme from
ningsuhen.github.io@<sha>"):

- `public/design-system/mermaid/config.json`
- `public/design-system/mermaid/theme.css`
- `public/design-system/mermaid/README.md`
- `scripts/render-mermaid.mjs` (adjust the `dir` path at its top to where you put the two files above)
- devDependency `@mermaid-js/mermaid-cli`, same exact version as this repo's `package.json`

For SVGs inlined in a page, load `research.css` (the `--rd-*` tokens). Without it the light fallbacks apply.
