---
title: "LPM: a small model as a function call, performance and results so far"
published: 2026-10-26
description: "Measured results from the first three milestones of LPM, a Rust engine that runs a small language model on the GPU through one WGSL source, on native Metal and in Chrome WebGPU, with every number labelled by model, machine, target and load, plus the eight lessons that cost time getting there."
tags: [Research]
category: Research
draft: false
---

LPM runs a small language model on the GPU so a Rust program can call it like a function. I wrote the kernels once in WGSL and run them on native Metal and in Chrome WebGPU. The report has the numbers and the lessons.

What held up: both models match a float32 reference on both targets, and a 1.4 GiB model loads in Chrome with the wasm heap at 17.3 MiB. What did not: the decision latency target is 10 ms and the best I have is 135 ms. Many timings were taken on a shared GPU at a load average of 100 to 330, and the page says which.

Eight things cost time getting the one shader set to run on both targets: the wait call that slept for 1 ms, a missing browser feature that looked like a bug in three other places, a kernel DSL I dropped, an upload call that kept the wasm heap flat, and a few measuring habits for a busy machine. Each lesson has its evidence.

[Open the report](/research/lpm-model-as-a-function-call-results/)
