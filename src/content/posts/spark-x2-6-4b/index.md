---
title: "I tested small models for Brev's generative tier"
published: 2026-10-27
description: "We ran four small models (1.7B–4B) against Brev's generative tier on the same 1,960-row classification arm. The 4B models tie at ~84%; the 1.7B LFM3 collapses to 12%. The current 4B tiers stay."
tags: [AI, Benchmark, Research]
category: Research
thumbnail: ./thumb.webp
draft: false
---

Brev's generative tier is the second-opinion step. laya, the small router, decides most messages, and the model re-classifies the ones it is unsure about, roughly 6% of traffic. It runs in the browser as ONNX on WebGPU. The current tiers are Qwen3.5-4B and FrogNano-4B.

I wanted to know if a smaller or newer model could do the job. So I ran four: Spark-X2.6-4B, Qwen3.5-4B, FrogNano-4B, and LiquidAI's LFM3-1.7B.

Same arm for all of them: 1,960 real support messages, 196 intents, every rule in the prompt, about 19k tokens in, a few tokens out. The three 4B models ran as Q4_K_M via llama.cpp on the same machine. LFM3 had to run via transformers on MPS, because no llama.cpp or MLX build supports its architecture yet.

The 4B models tie. Spark got 84.6%, Qwen3.5-4B got 84.4%, FrogNano got 83.9%. On 1,960 rows that is noise. The 27B teacher sits at 90.4%, so all three leave about 5.7 points on the table.

LFM3-1.7B is a clear non-starter. It got 12.1%, with 78% of the rows unparsed. The reason is visible in the raw outputs: it narrates its reasoning ("We need to classify the user's message…") and runs out of its 32-token budget before ever emitting the label. The harness's no-thinking flag is a Qwen-specific kwarg that LFM3's chat template ignores, so it thinks out loud and never answers. It is also an order of magnitude slower, running unoptimized on MPS.

For Spark, the decisive problem is not the accuracy. It is the shipping path. Brev ships the tier as ONNX q4f16 on WebGPU. No such build of Spark exists, and the exporter I use has no builder for its architecture. Its attention is a hybrid of sliding-window and full layers with a per-head output gate, which the closest existing builder does not cover. Shipping it means writing a new model builder and validating the WebGPU execution provider from scratch. I hit a graph-size buffer-aliasing bug on a 7B model before, and this would likely hit it too.

So the current tiers stay. If the goal is to close the gap to the 27B, the lever is a better 4B, not a smaller one.

## What I don't trust yet

- The latency is llama.cpp (4B) and transformers on MPS (LFM3), CPU-bound. It is a fair relative number within each runtime, not the shipped WebGPU path.
- The arm is harder than the real prompt. The product prompt has about 12 categories, not 196 rules. The gap between the models would be even smaller there.
- The card's benchmarks are thinking-mode, agentic and coding. They do not transfer to a no-thinking classification task, and the local run shows it.
- LFM3's 12.1% is partly a token-budget artifact. A larger budget or a fixed chat template could change it, but the base capability on this task is clearly insufficient.
- The 1,960 rows are real, but they are one domain. I would want a second domain before trusting any of these numbers.

[Open the report](/research/spark-x2-6-4b/)
