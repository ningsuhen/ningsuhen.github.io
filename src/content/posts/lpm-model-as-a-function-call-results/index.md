---
title: "LPM: a small model as a function call, performance and results so far"
published: 2026-10-26
description: "Measured results from the first three milestones of LPM, a Rust engine that runs a small language model on the GPU through one WGSL source, on native Metal and in Chrome WebGPU, with every number labelled by model, machine, target and load, plus the eight lessons that cost time getting there."
tags: [Research]
category: Research
thumbnail: ./thumb.webp
draft: false
---

<!-- owner:scene Why did you want to call a small language model like a Rust function in the first place? -->

LPM is a Rust engine I'm building to run a small language model on the GPU so a program can call it like a normal function. I wrote the GPU kernels once in WGSL and run the same shader code on both native Metal and Chrome WebGPU. The report collects the numbers from the first three milestones along with what tripped me up along the way.

On accuracy and browser memory, both models match a float32 reference on both targets, and a 1.4 GiB model loads in Chrome while keeping the wasm heap at 17.3 MiB. Latency is still way off. My target for a decision call is 10 ms, and the fastest I have right now is 135 ms. Quite a few timings were also collected on a shared GPU while machine load average sat between 100 and 330, and the report flags which runs those are.

Getting one WGSL shader set working across both targets took longer than expected, and the report walks through eight things that ate time, with the evidence for each. That includes a wait call that quietly slept for 1 ms, a missing browser feature that disguised itself as bugs in three other places, a kernel DSL I ended up dropping, an upload call that kept the wasm heap flat, and a few habits I picked up for measuring on a busy machine.

[Open the report](/research/lpm-model-as-a-function-call-results/)
