# Third-party licenses

This site is built on third-party software. Those components remain under their own licenses;
the restrictions in `LICENSE` do not apply to them and do not override them.

## Fuwari (theme)

Source: https://github.com/saicaca/fuwari. Licensed under the MIT License, reproduced in full:

    MIT License
    
    Copyright (c) 2024 saicaca
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## ONNX Runtime Web (neural voice)

- Version 1.27.0, Copyright Microsoft Corporation, MIT License. Upstream: https://github.com/microsoft/onnxruntime
- JavaScript loader committed in `public/tts/vendor/ort/` (LICENSE-onnxruntime.txt there).
- WebAssembly binary fetched at runtime from https://huggingface.co/ningsuhen/onnxruntime-web-1.27.0 (pinned commit c25145ab811e50c175798b09cd6da3fc272d9411), with the NOTICE and MIT LICENSE of that repository: https://huggingface.co/ningsuhen/onnxruntime-web-1.27.0/tree/c25145ab811e50c175798b09cd6da3fc272d9411

## Dependencies

npm packages installed through `pnpm install` (Astro, Tailwind CSS, Svelte, Expressive Code, and others)
are each distributed under their own license; see their packages' `LICENSE` files and `pnpm-lock.yaml`
for the exact list.
