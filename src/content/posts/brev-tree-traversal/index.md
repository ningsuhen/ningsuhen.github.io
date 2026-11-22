---
title: "Brev tree traversal"
published: 2026-10-24
updated: 2026-10-25
description: "Watch a 400M encoder walk a 23-node intent tree on Banking77, node by node, replayed from a recorded run, compare it with flat rules and a 27B model, then time the same encoder on your own GPU in the browser."
tags: [Playground]
category: Playground
thumbnail: ./thumb.webp
draft: false
---

<!-- owner:scene Why did you build the replay page? The opening is an invitation, not a reason. One true sentence from you would fix that. -->

This page replays laya, the 400M encoder from my Brev project, walking a decision tree on the Banking77 test set one question at a time. It comes from a recorded run I measured earlier. [Open the experiment](/playground/brev-tree-traversal/).

## The tree

The tree has 23 nodes covering 77 intents. The root asks which of 7 groups a message belongs to, such as payments, cards or account, and each group asks one more question to pick a single intent. At each node laya reads the option names with a short criterion for each, scores every option and follows the highest score.

<!-- owner:fact This paragraph contradicts itself: "I wrote the tree myself" and "A separate model, gpt-oss-120b, did the writing." Did you write the tree, or did gpt-oss-120b write it from your prompt? Rewrite the paragraph to say which. -->

I wrote the tree myself, from the label names and five training examples per label. A separate model, gpt-oss-120b, did the writing, and it never saw a test message.

<!-- owner:question When the v5b export lands, should this post describe the in-browser speed test from PR #134? This section is unchanged for now. -->

## How to use the page

You can pick a message by intent, by error kind (correct, wrong at the root, wrong lower down, lowest margin or shortest), or by number.

Step through the walk using Next, Back, the arrow keys or Auto-play. Each step shows the question, each option's probability from laya, the choice it made, and the gold option as long as the walk is still on the right path. The URL updates on every step so the Back button works and you can link to a specific step.

## What it shows

The walk runs quickly, though once it misses early on it has no way to recover. Across all 3,080 test messages, the greedy walk gets 47.0% right, while a 27B model with a short prompt gets 77.8%. A 4B model given 70-word rules per intent also gets 77.8%, though I didn't record its latency.

For 865 messages, the walk leaves the gold path right at the root question. Once it picks the wrong top-level group, nothing lower in the tree can fix it.

Latency is the part that actually looks good. On one RTX 4060, the walk has a 52 ms p50 with one forward pass per level. According to the ledger, sending the lowest-margin 15% of walks to the 27B raises the tree to 55.2%.

## Speed test in your browser

The page also has a Speed test tab that runs laya directly on your GPU in the browser using WebGPU. Nothing downloads until you tick the box and click Start, at which point it pulls the 846 MB model and the 24 MB ONNX Runtime binary from Hugging Face and caches both in the browser.

So far I only have numbers from one Apple Metal GPU in Chrome 155 on a Mac that was busy with other work. The download took 77.7 s (about 10.9 MB/s). It ran 19 to 22 decisions per second, with one pass taking about 46 to 52 ms at p50, and across all 3 runs every decision matched native fp32. On a second visit, loading from cache had the test ready in 1.8 s.

Those numbers came from one GPU and one browser running an ONNX Runtime Web 1.31 preview. The page now uses the same 1.27.0 runtime as the rest of the site, and I haven't rerun the timings on it or tried other browsers yet, so your numbers may differ.

## What it does not show

- The traversal tab is a replay of recorded probabilities. Only the Speed test tab runs the model live, and there is no input box to test your own message.
- The 60 sample messages are weighted toward errors and short texts on purpose, so don't treat them as an accuracy estimate.
- Everything here is one run, one tree and one dataset. Because the arms use different models, prompts and hardware, latencies aren't directly comparable: laya ran locally, whereas the 27B number includes network time and a shared queue.
- Banking77 is public, so any of these models may have seen it in training, and I haven't checked for that.

The full report and hypothesis ledger live at [the Brev tree benchmark](/research/brev-tree-benchmark/). In the ledger, the criteria carry most of the accuracy: names alone score 36.8%, opaque ids with criteria score 40.6%, and both together get 47.0%.

## What I don't trust yet

- The gap between 47.0% and 77.8% is wide. I think the criteria matter most, though I haven't tested that by varying one piece at a time on a second dataset.
- The per-level numbers come straight from the ledger; I only re-derived the replay, which matches 47.0%.
- The 27B and 4B figures come from a single prompt each, and a different prompt could shift them.
