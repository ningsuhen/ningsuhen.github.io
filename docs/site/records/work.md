# Work

## W-1 Fix the two broken external links on the AI economy report (issue #282)

```yaml
phase: "1"
where: "public/research/ai-economy/"
done_when: "The weekly link check lists no Broken links for /research/ai-economy/, and issue #282 is closed."
verify: ["! rg -q 'openai-light-balance-sheet-ipo-scrutiny|ie_data.xls' public/research/ai-economy/"]
```

The weekly external-link check found two 404s on the AI economy report: a TNW article and the Shiller data spreadsheet. Replace each with a live or archived source that backs the same claim, or drop the claim. It covers no requirement yet: requirements wait on Q-1.

## W-2 Stop every fragment's page.css being inlined into every Fuwari page

```yaml
phase: "1"
where: "src/layouts/StandaloneShell.astro"
done_when: "After pnpm build, no Fuwari page carries a fragment's page.css, and no page names a Draft fragment."
verify: ["pnpm build", "! rg -q 'data-page=' dist/about/index.html"]
```

Every Fuwari page (posts, about, archive, index) inlines the page.css of every standalone fragment, Drafts included. That costs each page a few KB and names unpublished pages. The import path is unknown: bisect a build to find it. It covers no requirement yet: requirements wait on Q-1.
