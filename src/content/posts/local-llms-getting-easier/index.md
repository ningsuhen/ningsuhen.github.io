---
title: Running a small model on my own machine is getting easier
published: 2026-10-24
description: "Local models are simpler to run than they were. The browser is next, and I want to test a small model there."
tags: [AI, Local LLM, WebGPU, Opinion]
category: Thoughts
thumbnail: ./thumb.webp
draft: false
---

Running a language model on my own machine used to be a project. You needed the right Python, the right GPU driver, a model file from somewhere, and then time to fix whatever broke. I did not time that old setup, so I have no numbers for it. Now it is mostly one download and one command.

I think two things made that happen. The first is quantization. The llama.cpp README lists 1.5 to 8-bit integer quantization "for faster inference and reduced memory use" ([source](https://github.com/ggml-org/llama.cpp), read 2026-10-24). The second is that small models are good enough for narrow jobs. I think a 4B model can do one job well now.

## The browser

The next step is running the model in a web page. The page uses your GPU, with no install and no server.

- **WebGPU** is the browser API for the GPU. MDN marks it "limited availability", and it only works in a secure context, which means HTTPS ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), read 2026-10-24).
- The gpuweb implementation status page, last edited 2 October 2026, lists Chromium (Chrome, Edge) on Mac, Windows and ChromeOS from version 113. It lists Firefox on Windows from 141, and on Mac from 145 on macOS 26 and later, and from 147 on all macOS versions. It lists Safari 26 with WebGPU on by default on macOS, iOS, iPadOS and visionOS 26 ([gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), read 2026-10-24). Linux and Android are patchy on that page, and some of it sits behind flags. I have not tested either.
- **Transformers.js** runs Hugging Face models on ONNX Runtime. It uses the CPU by default, and WebGPU when you set `device: 'webgpu'` ([docs](https://huggingface.co/docs/transformers.js/index), read 2026-10-24).
- **WebLLM** is an in-browser LLM engine with an OpenAI-compatible API, accelerated by WebGPU ([README](https://github.com/mlc-ai/web-llm), read 2026-10-24).
- **ONNX Runtime Web** has a WebGPU backend and a WebAssembly backend. WebAssembly supports all ONNX operators. WebGPU supports only a subset ([docs](https://onnxruntime.ai/docs/tutorials/web/), read 2026-10-24).

## The model I am watching

Microsoft's FrogNano-4B-2609 has a model card dated 22 September 2026 ([model card](https://huggingface.co/microsoft/FrogNano-4B-2609), read 2026-10-24). The card calls it a compact repository-level coding agent derived from Qwen3.5-4B. It gives about 4.66 billion parameters for the checkpoint, and the metadata says 5B. The weights are BF16, in two safetensors files that add up to about 9.3 GB. The card says quantized formats are not validated yet. The license says MIT in the metadata and Apache 2.0 in the body, so I do not know which one applies.

A Japanese write-up on note.com, dated 3 October 2026, ran FrogNano-4B and Qwen3.5-4B in llama.cpp at Q4_K_M, on an M4 Mac with 16 GB ([note.com](https://note.com/hacklog_stealth/n/ne992cad2fc4a), read 2026-10-24). Each model ran at about 28 tokens per second when run alone. When both ran at once, each fell to 14 to 15 tokens per second. That is their measurement, not mine. It is one Mac and one quantization, and the article does not say how many runs it averaged.

## What it still costs

- **Downloads.** The Qwen3.5-4B ONNX export behind the LLM path in my Brev project is about 2.8 GB (q4f16, text only). The community ONNX export of FrogNano that I tested is about 2.27 GiB of weight files.
- **Memory.** In my Brev test on 6 October, the FrogNano weight files took 2.27 GiB of JavaScript memory, and the ONNX Runtime wasm heap peaked at 3.17 GiB. The wasm32 limit is 4 GiB. That was one session build, not a generation.
- **Support.** Some visitors will not have WebGPU. The page needs a fallback.
- **Heat and battery.** I think a laptop gets hot and drains fast under load. I have not measured it.

## What I measured

These come from my [Brev benchmark](/posts/brev-tree-benchmark/), on a 196-intent set. Latency is the median (p50).

- The 4B model with every rule in the prompt, about 18.8k tokens: 77.1% accuracy, 159 ms median. It ran on one RTX 4060, served from llama.cpp's prefix cache (99.9% of prompt tokens cached, one request at a time). I didn't measure it without the cache.
- The same 4B under load, on that cache: 447 ms with 4 requests in flight, 938 ms with 8. These are timing runs with no accuracy.
- The 27B model on a shared endpoint, with every rule in the prompt: 90.4% accuracy, 685 ms. The endpoint is shared, so the latency includes queueing.
- A small TF-IDF model in front answers 65% of rows locally at 97% precision, in about 8 ms.

A small model is fast alone and slow under load. One number hides that.

## What is next

I want to build a small GPU speed test for the browser. It does not exist yet. If it works, it goes on the [experiments page](/experiments/). My Brev notes say its LLM decode loop has never run. That is one more reason to measure it.

## What I don't trust yet

- I have not run FrogNano in a browser. In my Brev project I built one session from a community ONNX export, and I have not generated text with it.
- The 28 tokens per second is one author, one Mac, one quantization.
- Browser support moves. The dates above will age.
- The Brev post lists the benchmark's caveats. Banking77 is public, so the models may have seen it.
