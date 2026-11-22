---
title: "I tested small models for Brev's generative tier"
published: 2026-10-27
description: "I ran four small models (1.7B to 4B) on the same 1,960-row classification arm for Brev's generative tier. The 4B models tie around 84%, and LFM3-1.7B drops to 12%, so the current 4B tiers stay."
tags: [AI, Benchmark, Research]
category: Research
thumbnail: ./thumb.webp
draft: false
---

Brev's generative tier acts as a second opinion. laya, the small router, handles most messages, and the generative model re-classifies the uncertain ones, roughly 6% of traffic. It runs in the browser as ONNX on WebGPU, and the current tiers are Qwen3.5-4B and FrogNano-4B.

I wanted to see if a smaller or newer model could take over that job, so I tested four: Spark-X2.6-4B, Qwen3.5-4B, FrogNano-4B and LiquidAI's LFM3-1.7B.

Every model ran on the same arm: 1,960 real support messages, 196 intents, all rules in the prompt, roughly 19k tokens in and a few tokens out. The three 4B models ran as Q4_K_M on llama.cpp on the same machine. LFM3 had to run through transformers on MPS because neither llama.cpp nor MLX supports its architecture yet.

The three 4B models basically tied: Spark scored 84.6%, Qwen3.5-4B scored 84.4%, and FrogNano scored 83.9%. Across 1,960 rows those differences are within noise. All three sit about 5.7 points behind the 27B teacher at 90.4%.

LFM3-1.7B didn't work at all here. It scored 12.1% with 78% of rows failing to parse. Looking at the raw outputs, it starts narrating its reasoning ("We need to classify the user's message…") and hits its 32-token cap before printing a label. The test runner turns off thinking with a Qwen-specific kwarg that LFM3's chat template ignores, so it keeps thinking out loud and never outputs an answer. Running unoptimized on MPS also made it an order of magnitude slower.

For Spark, the real blocker is shipping it. Brev delivers this tier as ONNX q4f16 on WebGPU, and no ONNX build of Spark exists yet. The exporter I use doesn't have a builder for Spark's architecture, which mixes sliding-window and full attention layers with a per-head output gate. Shipping Spark would mean writing a new model builder and validating the WebGPU execution provider from scratch, and I'd likely run into the same graph-size buffer-aliasing bug I already hit on a 7B model.

So I'm keeping the current tiers. Closing the gap to the 27B means finding a stronger 4B model rather than going smaller.

## What I don't trust yet

- Latency was measured on CPU-bound llama.cpp (for the 4B models) and transformers on MPS (for LFM3). Those numbers work for relative comparisons within a runtime, and they don't reflect the shipped WebGPU path.
- This benchmark arm is harder than the real product prompt, which has about 12 categories instead of 196 rules, so the gap between models should be even smaller in production.
- The model card benchmarks test thinking-mode coding and agentic tasks, and this local run shows they don't carry over to no-thinking classification.
- Part of LFM3's 12.1% comes from the 32-token cap. A higher token budget or a fixed chat template would help, though its base capability on this task still looks too weak.
- All 1,960 rows are real messages from a single domain, so I'd want a second domain before putting too much weight on the numbers.

[Open the report](/research/spark-x2-6-4b/)
