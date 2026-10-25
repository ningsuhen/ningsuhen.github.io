---
title: "Editing my blog from the page I'm reading"
published: 2026-10-25
description: "An idea: click Edit on my own post, fix it on the page, and let a pull request carry the change to the Markdown. Astro makes the way back easier. I'm building a rough version; nothing is measured."
tags: [Idea, Astro, GitHub Pages, Browser Extension]
category: Idea
thumbnail: ./thumb.webp
draft: false
---

This blog is Markdown in a GitHub repo. Astro builds it and GitHub Pages serves it. When I spot a typo in a post, fixing it is a small trip. I find the repo, then the file, then the line. I edit the Markdown, open a pull request, wait for the checks and the deploy, and look at the page again. GitHub's web editor (press `.` on a repo) helps with the editing, but I'm still somewhere else from where I saw the typo.

So I wrote an [idea page](/ideas/edit-blog-in-place/) for a browser extension that lets me edit a post where I'm reading it. I'm building a rough version for this site. It isn't finished, and I haven't measured anything.

## The idea

I click Edit on my own post, or right-click and pick "Edit this post". I fix the text right on the page, with the site's real styling. Before anything leaves the browser, I see a diff of the Markdown. When I press Publish, the extension changes only the lines for that paragraph and opens a pull request. The repo's checks decide when it merges.

## Why Astro makes it easier

The hard part is the way back, from a paragraph on the page to the lines in a file. Astro helps. Markdown files in `src/pages/` become pages by their path, and content collection entries get their id from the file name ([routing](https://docs.astro.build/en/guides/routing/), [collections](https://docs.astro.build/en/guides/content-collections/)). So the URL is a good guess for the file, and the page's text can confirm it. A small build plugin can do better and mark each block with the lines it came from.

When none of that works, for example inside an MDX component, the extension hands the before and after text to an AI coding agent. The agent finds the source and opens the pull request itself.

## Something I found while checking

GitHub's auto-merge waits for required reviews and status checks. But it's only offered on pull requests that can't be merged right away ([docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)). So the checks only gate the merge if the repo requires them. I had to turn that on for this site.

My repo is also public, so a pushed branch can be seen on GitHub before any check runs. A leak scan can keep a mistake off the live site, but not out of sight. The diff before Publish is the real last check.

## What I could not settle

- How often the text matching finds the right lines on other people's Astro sites. I've only looked at mine.
- Custom domains. The extension needs another way to find which repo serves the page.
- Whether this is faster than the web editor. I haven't timed either.

Sources, read 2026-10-25: [GitHub: automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request), [GitHub: the github.dev web-based editor](https://docs.github.com/en/codespaces/the-githubdev-web-based-editor), [Astro: routing](https://docs.astro.build/en/guides/routing/), [Astro: content collections](https://docs.astro.build/en/guides/content-collections/).
