---
title: "Editing my blog from the page I'm reading"
published: 2026-10-25
description: "I'm building a rough browser extension to edit a post right on the live page and send the change back to the Markdown via a pull request. Nothing is measured yet."
tags: [Idea, Astro, GitHub Pages, Browser Extension]
category: Idea
thumbnail: ./thumb.webp
draft: false
---

This blog is just Markdown in a GitHub repo, built by Astro and served on GitHub Pages. Whenever I spot a typo while reading a post, fixing it takes way more steps than it should. I have to open the repo, hunt down the file and line, edit the Markdown, open a pull request, wait for CI and deploy, and then check the page again. GitHub's web editor (pressing `.` on a repo) speeds up the editing part, though I'm still pulled away from the actual page where I saw the mistake.

So I put together an [idea page](/ideas/edit-blog-in-place/) for a browser extension that lets me edit a post right where I'm reading it. I'm building a rough version for this site now. It isn't finished yet, and I haven't measured anything.

## How it works

I click Edit on my own post, or right-click and choose "Edit this post", then fix the text directly on the page with the site's normal styling. Before anything leaves the browser, it shows me a diff of the Markdown. Clicking Publish updates only the lines for that paragraph and opens a pull request, leaving the repo's checks to decide when it merges.

The tricky part is mapping a paragraph on the rendered page back to its exact lines in the source file. Astro makes this easier because Markdown files in `src/pages/` map to URLs by their path, and content collection entries get their id from the file name ([routing](https://docs.astro.build/en/guides/routing/), [collections](https://docs.astro.build/en/guides/content-collections/)). That gives a good guess for the file from the URL, and matching the page text confirms it. A small build plugin can go a step further and tag every block with the source lines it came from.

When that mapping breaks down, such as inside an MDX component, the extension passes the before and after text to an AI coding agent to find the source and open the pull request itself.

## Things I ran into while checking

GitHub's auto-merge waits for required reviews and status checks, and it's only available on pull requests that can't be merged immediately ([docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)). That means CI checks only block a merge if the repo explicitly requires them, which I had to turn on for this site.

Because this repo is public, any pushed branch is visible on GitHub before checks even run. A leak scan can stop a mistake from reaching the live site, though people could still see it on the branch, so reading the diff before clicking Publish is the real safety check.

## Open questions

- How reliably text matching finds the right lines on other people's Astro sites, since I've only tested my own.
- Custom domains, where the extension needs another way to figure out which repo backs the page.
- Whether this actually saves time over the web editor, since I haven't timed either one.

Sources, read 2026-10-25: [GitHub: automatically merging a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request), [GitHub: the github.dev web-based editor](https://docs.github.com/en/codespaces/the-githubdev-web-based-editor), [Astro: routing](https://docs.astro.build/en/guides/routing/), [Astro: content collections](https://docs.astro.build/en/guides/content-collections/).
