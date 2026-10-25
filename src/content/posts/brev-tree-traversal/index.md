---
title: "Brev tree traversal"
published: 2026-10-24
description: "Watch a 400M encoder walk a 23-node intent tree on Banking77, node by node, replayed from a recorded run, then compare it with flat rules and a 27B model."
tags: [Playground]
category: Playground
thumbnail: ./thumb.webp
draft: false
---

<!-- owner:scene Why did you build the replay page? The opening is an invitation, not a reason. One true sentence from you would fix that. -->

Here you can watch laya, the 400M encoder in my Brev project, walk a decision tree on the Banking77 test set, one question at a time. It is a replay of one thing I measured. [Open the experiment](/playground/brev-tree-traversal/).

## The tree

The tree has 23 nodes and 77 intents. The root asks which of 7 groups a message belongs to: payments, cards, account and so on. Each group asks one more question, down to one intent. At each node laya reads the option names and a short criterion for each, scores every option, and follows the highest.

<!-- owner:fact This paragraph contradicts itself: "I wrote the tree myself" and "A separate model, gpt-oss-120b, did the writing." Did you write the tree, or did gpt-oss-120b write it from your prompt? Rewrite the paragraph to say which. -->

I wrote the tree myself, from the label names and five training examples per label. A separate model, gpt-oss-120b, did the writing, and it never saw a test message.

<!-- owner:question When the v5b export lands, should this post describe the in-browser speed test from PR #134? This section is unchanged for now. -->

## How to use the page

Pick a message by intent, by kind, or by number. The kinds are: correct, wrong at the root, wrong lower down, lowest margin, and shortest.

Step through the walk with Next, Back, the arrow keys or Auto-play. Each step shows the question, every option with laya's probability, the option it chose, and the gold option when the walk is still on the gold path. The URL changes with each step, so Back works and a step can be linked.

## What it shows

The walk is fast, but it goes wrong early and does not recover. On the 3,080 test messages the greedy walk gets 47.0% right. A 27B model with a short prompt gets 77.8%. A 4B model with 70-word rules for each intent also gets 77.8%, but I did not record its latency.

For 865 messages the walk leaves the gold path at the root question. A wrong group at the top cannot be fixed further down.

Speed is the part that holds up. The walk's p50 is 52 ms, one forward pass per level, on one RTX 4060. In the ledger, holding the lowest-margin 15% of walks for the 27B lifts the tree to 55.2%.

## What it does not show

- It is a replay. The probabilities were recorded from a real run. Nothing on the page calls a model, and there is no box to type your own message.
- The 60 messages are a sample, weighted toward errors and short texts on purpose. Do not read accuracy off it.
- One run, one tree, one dataset. The arms differ in model, prompt and hardware, so the latencies are not like-for-like: laya ran locally, and the 27B figure includes the network and a shared queue.
- Banking77 is public, so any of these models may have seen it in training. I have not checked that.

The full report and the hypothesis ledger are at [the Brev tree benchmark](/research/brev-tree-benchmark/). The ledger says the criteria carry most of the knowledge: names alone get 36.8%, opaque ids with the criteria 40.6%, both together 47.0%.

## What I don't trust yet

- The gap between 47.0% and 77.8% is large. I think the criteria matter most, but I have not tested that by changing one thing at a time on a second dataset.
- The per-level figures are the ledger's own. I did not re-derive them, except the replay, which matches 47.0%.
- The 27B and 4B numbers come from one prompt each. A different prompt could move them.
