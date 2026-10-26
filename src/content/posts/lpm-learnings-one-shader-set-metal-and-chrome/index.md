---
title: "LPM learnings: one shader set for Metal and Chrome"
published: 2026-10-26
description: "Eight concrete lessons from building a GPU language-model engine whose WGSL runs unchanged on native Metal and in Chrome, each with its evidence and its cost."
tags: [Research]
category: Research
draft: true
---

<!-- owner:voice This post is a plain draft written by an assistant from the project notes, not in your voice. Rewrite it in your own words before it goes Live. -->

Eight things that cost time while getting one set of WGSL kernels to run on Metal and in Chrome: the wait call that slept for 1 ms, a missing browser feature that looked like a bug in three other places, a kernel DSL we dropped, an upload call that kept the wasm heap flat, and a few measuring habits for a busy machine. Each lesson in the report has its evidence.

[Open the report](/research/lpm-learnings-one-shader-set-metal-and-chrome/)
