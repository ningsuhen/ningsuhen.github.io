---
title: Can a decision tree hold the knowledge? What the Brev benchmark says
published: 2026-10-24
description: "Primary observations from the Brev Tree Benchmark: a tree-walking 400M model against a 27B model, on 77 and 196 intents."
tags: [AI, Benchmark, Rust, Experiment]
category: Research
draft: false
---

I have been building Brev. It runs a small model called laya in the browser, from Rust compiled to WebAssembly. The question I wanted to answer: **can a decision tree hold the knowledge, so a 400M encoder that reads only the criteria on its path matches a 27B model given a short instruction, without its latency?**

I tested it on Banking77 (77 intents), then on 196 intents, and kept a ledger of every hypothesis. The full thing is [here](/brev-tree-benchmark/). These are the things that stood out.

**1. Where it ended up is a three-stage chain.**
A word TF-IDF head answers what it is sure about (225 of 300 rows, 96.9% right). The 4B takes the rest with 8 retrieved examples, and only its least confident 9% go to the 27B. Measured live, end to end: **93.3% vs 93.9% for the 27B alone, at a mean of 49 ms per query vs about 10 s.** On 300 rows that accuracy gap is not distinguishable from zero, and only 27 rows were escalated, so the intervals are wide.

**2. The tree walk is fast, but not good.**
laya's greedy walk takes 52 ms at p50 and gets 47.0% on Banking77. The 27B with a short instruction gets 77.8% at 306 ms. That is 30.8 points behind (CI -32.8 to -28.9).

**3. The criteria carry the knowledge.**
Names only: 36.8%. Opaque ids plus criteria: 40.6%. Both: 47.0%. Shuffle the criteria between siblings and it drops to 8.9%. laya follows the text even when the text is wrong.

**4. At 196 intents, flat rules in a cached prompt beat the tree.**
27B with all the rules: 90.4% at 685 ms. Best tree cascade: 81.6% at 4,118 ms. Walking the tree node by node had 40% recall at 605 intents, retrieval (RRF) had 98.2%. So the tree's value has to come from fewer prompt tokens, not from routing.

**5. A small model with a cached prefix is surprisingly quick, until you load it.**
The 4B with flat cached rules gets 77.1% at 159 ms. At 4 requests in flight that is 447 ms, at 8 it is 938 ms.

**6. Cache hygiene is a real thing.**
Append-only changes invalidate 2% of the cache (589 ms). Insert at the front and it is 99.8% (9.4 s).

**7. The boring part carries it.**
A TF-IDF character n-gram head in front of the pipeline answers 65% of rows locally at 97% precision, cuts hosted-classifier spend by 55%, and the accuracy goes up: 91.3% vs 88.5% (CI +1.7 to +3.9), with p50 around 8 ms instead of 219 ms. The page's own short answer: yes for the headline pipeline, and a cheap trained head in front improves both accuracy and cost. Retrieved examples are what make the 4B useful: with the 8 nearest labelled examples it gets 93.96% vs 89.59% for the head alone, but with candidate names only it is worse than the head (78.58%), on 4,948 rows and 478 classes. Learning new classes from a few examples is the weak part.

## What I don't trust yet

- The three-stage chain was measured on 300 rows, 27 of them escalated, on a loaded machine, and the 4B call includes about 10 to 15 ms of network. Treat 93.3% vs 93.9% as "close", not "equal".
- Banking77 is public, so the models may have seen it. The control with opaque ids scored 81.2% vs 81.9% with real names, so the 27B's lead is not just that.
- The 27B runs on a shared endpoint, so its latency includes queueing. Everything else is one RTX 4060.
- The 27B's 685 ms comes from a 300-row timing pass, and the accuracy run shows 858 ms. Both are on the page.
- The learn-as-you-go result uses a simulated teacher. A strong sign, not proof.
- The "top results" table is curated by hand. The ledger is the source of truth.

[Open the report](/brev-tree-benchmark/) and look at the ledger. If something looks wrong, tell me.
