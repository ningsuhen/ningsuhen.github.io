---
title: "LPM: a small model as a function call, performance and results so far"
published: 2026-10-26
description: "Measured results from the first three milestones of LPM, a Rust engine that runs a small language model on the GPU through one WGSL source, on native Metal and in Chrome WebGPU, with every number labelled by model, machine, target and load."
tags: [Research]
category: Research
draft: true
---

<!-- owner:voice This post is a plain draft written by an assistant from the project notes, not in your voice. Rewrite it in your own words before it goes Live. -->

LPM runs a small language model on the GPU so a Rust program can call it like a function. The same shader source runs on Metal and in Chrome. The report has the numbers.

What held up: both models match a float32 reference on both targets, and a 1.4 GiB model loads in Chrome with the wasm heap at 17.3 MiB. What did not: the decision latency target is 10 ms and the best we have is 135 ms. Many timings were taken on a shared GPU at a load average of 100 to 330, and the page says which.

[Open the report](/research/lpm-model-as-a-function-call-results/)
