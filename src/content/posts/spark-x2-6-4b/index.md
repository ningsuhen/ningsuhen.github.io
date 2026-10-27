---
title: "I tried Spark-X2.6-4B for Brev's 4B tier"
published: 2026-10-27
description: "We ran XHToken/Spark-X2.6-4B against Brev's current 4B generative tiers on the same 1,960-row classification arm: it ties on accuracy, costs more, and can't ship on the current ONNX-WebGPU path, so the current tiers stay."
tags: [AI, Benchmark, Research]
category: Research
thumbnail: ./thumb.webp
draft: false
---

Spark-X2.6-4B is a 4B model from XHToken. Its card puts it at 63.3 on an aggregate of agentic, coding and math benchmarks, against 43.2 for Qwen3.5-4B. That gap is large enough that I wanted to know if it would replace the 4B tier in Brev.

Brev's 4B tier is the second-opinion step. laya, the small router, decides most messages, and the 4B re-classifies the ones it is unsure about, roughly 6% of traffic. It runs in the browser as ONNX on WebGPU. The current tiers are Qwen3.5-4B and FrogNano-4B.

I ran all three on the same arm: 1,960 real support messages, 196 intents, every rule in the prompt, about 19k tokens in, a few tokens out. Same quantization, same runtime, same machine. Only the model changes.

It ties. Spark got 84.6%, Qwen3.5-4B got 84.4%, FrogNano got 83.9%. On 1,960 rows that is noise. The 27B teacher sits at 90.4%, so all three 4B models leave about 5.7 points on the table.

The tie comes at a cost. Spark is 28% bigger at the same quantization (3.30 GB against 2.55 to 2.61 GB), decodes slower (757 ms p50 against 296 to 399 ms), and renders the same rules 1,273 tokens longer under its own tokenizer.

The decisive problem is not the accuracy. It is the shipping path. Brev ships the tier as ONNX q4f16 on WebGPU. No such build of Spark exists, and the exporter I use has no builder for its architecture. Its attention is a hybrid of sliding-window and full layers with a per-head output gate, which the closest existing builder does not cover. Shipping it means writing a new model builder and validating the WebGPU execution provider from scratch. I hit a graph-size buffer-aliasing bug on a 7B model before, and this would likely hit it too.

So the current tiers stay. If the goal is to close the gap to the 27B, the lever is a better 4B, not this one.

## What I don't trust yet

- The latency is llama.cpp on an M4 Max, CPU-bound. It is a fair relative number, not the shipped WebGPU path.
- The arm is harder than the real prompt. The product prompt has about 12 categories, not 196 rules. The gap between the models would be even smaller there.
- The card's benchmarks are thinking-mode, agentic and coding. They do not transfer to a no-thinking classification task, and the local run shows it.
- The 1,960 rows are real, but they are one domain. I would want a second domain before trusting any of the three 4B numbers.

[Open the report](/research/spark-x2-6-4b/)
