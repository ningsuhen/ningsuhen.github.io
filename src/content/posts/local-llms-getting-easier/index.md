---
title: Local LLMs are getting easier
published: 2026-10-24
description: "Running a small language model on my own hardware keeps getting simpler, and the browser is the next place I want to test it."
tags: [AI, Local LLM, WebGPU, Opinion]
category: Thoughts
draft: false
---

Running a language model on my own machine used to be a project: the right Python, the right GPU driver, a model file from somewhere, and time to debug it. I have not timed that old setup, so no numbers. Today it is mostly one download and one command.

Two things changed that. First, **quantization**. The llama.cpp README lists 1.5 to 8-bit integer quantization "for faster inference and reduced memory use" ([source](https://github.com/ggml-org/llama.cpp), read 2026-10-24). Second, small models got useful. I think a 4B model can now do a narrow job well.

## The browser

Here we go. A web page runs the model on your GPU, with no install and no server.

- **WebGPU** is the browser API for the GPU. MDN marks it "limited availability" and requires a secure context, meaning HTTPS ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API), read 2026-10-24). The implementation status page, last edited 2 October 2026, lists Chromium (Chrome, Edge) on Mac, Windows and ChromeOS since version 113, Firefox since 141 on Windows and 147 on all Mac versions, and Safari 26 with it on by default ([gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), read 2026-10-24). I have not checked Linux or phones.
- **Transformers.js** runs Hugging Face models in the browser on ONNX Runtime, on CPU by default and on WebGPU when you ask for it ([docs](https://huggingface.co/docs/transformers.js/index), read 2026-10-24).
- **WebLLM** is an in-browser LLM engine with an OpenAI-compatible API, accelerated by WebGPU ([README](https://github.com/mlc-ai/web-llm), read 2026-10-24).
- **ONNX Runtime Web** has WebGPU and WebAssembly backends. WebGPU covers only a subset of ONNX operators ([docs](https://onnxruntime.ai/docs/tutorials/web/), read 2026-10-24).

## The model I am watching

Microsoft's FrogNano-4B-2609 is dated 22 September 2026 ([model card](https://huggingface.co/microsoft/FrogNano-4B-2609), read 2026-10-24). It is a 4.66 billion parameter coding model derived from Qwen3.5-4B. The BF16 weights alone are about 9.3 GB. The card says quantized formats are not validated yet. It links a WebGPU demo Space. The license reads MIT in one place and Apache 2.0 in another.

A Japanese write-up by Hack-Log, dated 3 October 2026, reports FrogNano-4B and Qwen3.5-4B both at about 28 tokens per second when run alone, on an M4 Mac with 16 GB, using llama.cpp at Q4_K_M ([note.com](https://note.com/hacklog_stealth/n/ne992cad2fc4a), read 2026-10-24). That is their measurement, not mine.

## What it still costs

- **Downloads.** The generative path in my Brev project (laya) is about 2.8 GB. My FrogNano ONNX build is about 2.27 GiB of sidecar files.
- **Memory.** Full-precision weights take 16 bits per parameter. A 4-bit file is a quarter of that, on paper. I have not measured a real file.
- **Support.** Some visitors will have no WebGPU. The page has to fall back.
- **Heat and battery.** I think a laptop gets hot and drains fast. I have not measured it.

## What I measured

Not in the browser, yet. From my [Brev benchmark](/posts/brev-tree-benchmark/):

- A 4B model on one RTX 4060, with a cached rules prompt: 77.1% accuracy at 159 ms. At 4 requests in flight, 447 ms. At 8, 938 ms.
- A 27B model on a shared endpoint: 90.4% at 685 ms in a timing pass, 858 ms in the accuracy run. Queueing is included.
- A small trained head in front: 65% of rows answered locally in about 8 ms.

A small model is fast alone and slow under load. One number hides that.

## What is coming

I am building a GPU speed test for the browser. It is not live yet. When it works, it goes on the [experiments page](/experiments/). The in-browser LLM part of Brev is still unproven in my hands: its README says the decode loop has never executed. That is why I want the speed test.

## What I don't trust yet

- I have not run FrogNano in a browser myself. The numbers above are from others or my GPU box.
- The 28 tokens per second is one author, one Mac, one quantization.
- Browser support moves. The dates above will age.
- My benchmark has its own problems, listed in the Brev post. Banking77 is public, so the models may have seen it.
