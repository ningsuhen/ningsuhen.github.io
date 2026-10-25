---
title: "Predictions #1: the open-source clone I did not write"
published: 2026-10-24
description: "The first post in a series of predictions. An idea I never built, a project that built something close to it, and dated checks on what comes next."
thumbnail: ./thumb.webp
tags: [Predictions, Open Source, Rust, Opinion]
category: Thoughts
draft: false
---

This is the first post in a series I am calling Predictions. Each one states a prediction or an idea, dates it, and says how I will check it later. Every post in the series gets the `Predictions` tag. Predictions are marked as predictions. Opinions are marked as opinions.

This first one is a look back.

## What I thought would happen

I thought about writing open-source versions of some of the software I use. It stayed a thought. I did not get to a first version.

## What happened instead

A project called StoryTold came out. It is a GitHub organization with open-source apps written in Rust. Several of them are described as clean-room rewrites of commercial programs: WordCraft for Microsoft Word, DeckCraft for PowerPoint, GridCraft for Excel-style spreadsheets, SoundCraft for Pro Tools, and CADCraft for AutoCAD-style drafting ([GitHub API, storytold repos](https://github.com/storytold), read 2026-10-24).

The first app repositories were created on 30 September 2026. The Word, PowerPoint, spreadsheet and audio apps were created on 7 October 2026 ([GitHub API](https://api.github.com/orgs/storytold/repos), read 2026-10-24). When I read the API that day, PhotoCraft had 72,393 stars. WordCraft's README says it is in alpha, that it is dual-licensed under MIT or Apache-2.0, and that it was "built from public specifications and observation" ([WordCraft README](https://github.com/storytold/wordcraft), read 2026-10-24).

I do not know how close this is to what I had in mind. I do not claim it came from my idea.

## Why I am not shipping open source myself

Because of my full-time job and the agreements that come with it, I cannot publish open-source software right now. That is the whole reason.

## What I got right so far, and what I am not sure about

I predicted that Rust would become a preferred language for AI. I think that is partly right.

Rust is the main language of several AI tools. The uv package manager is Rust, with 91,122 stars. Ruff is Rust, with 50,264. Hugging Face tokenizers and the candle ML framework are Rust too ([GitHub API](https://api.github.com/repos/astral-sh/uv), read 2026-10-24; [tokenizers](https://github.com/huggingface/tokenizers), read 2026-10-24; [candle](https://github.com/huggingface/candle), read 2026-10-24). Rust went from 12.6% of respondents in the 2024 Stack Overflow survey to 14.8% in 2025 ([2025](https://survey.stackoverflow.co/2025/technology), read 2026-10-24; [2024](https://survey.stackoverflow.co/2024/technology), read 2026-10-24).

Python is still the default for AI code. It was used by 57.9% of respondents in the 2025 survey. GitHub's Octoverse 2025 report says Python dominates AI projects and now powers nearly half of all new AI repositories, 582,196 of them, up 50.7% year on year ([Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/), read 2026-10-24). The big inference servers are not Rust either. vLLM is primarily Python, llama.cpp is primarily C++, and Ollama is primarily Go ([vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggml-org/llama.cpp), [Ollama](https://github.com/ollama/ollama), all read 2026-10-24).

My opinion: Rust looks like a good fit for the tools and infrastructure around AI. It does not look like the preferred language for most AI code yet.

The rewrites part is the same kind of guess. StoryTold is a wave of Rust rewrites, and it fits the idea. One project does not show a trend.

## What I think comes next

This is a prediction. I think more open-source projects will use licenses that keep the code open but get most of their revenue from enterprise customers.

The license question is still moving. HashiCorp moved its products to the Business Source License 1.1, announced 10 August 2023 ([HashiCorp](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license), read 2026-10-24). A community fork called OpenTofu was created on GitHub on 16 August 2023 under MPL-2.0 ([GitHub API](https://api.github.com/repos/opentofu/opentofu), read 2026-10-24). Redis moved to SSPL in March 2024, then added AGPLv3 as an option with Redis 8, published 1 May 2025 ([Redis](https://redis.io/blog/agplv3/), read 2026-10-24). Elastic added AGPL as another option next to its existing licenses, announced 29 August 2024 ([Elastic](https://www.elastic.co/blog/elasticsearch-is-open-source-again), read 2026-10-24).

Those are license changes. None of them shows revenue. I have no revenue numbers, so the enterprise part is my guess. I would be wrong if the next few years bring more permissive licenses and no enterprise income for the projects that changed.

## More predictions in this series

Open-weight models are getting closer to the closed ones. Epoch AI found that since January 2026, open-weight models had trailed the frontier closed models by about four months on its Epoch Capabilities Index. The average gap was 8 points ([Epoch AI](https://epoch.ai/data-insights/open-closed-eci-gap), published 29 May 2026, read 2026-10-24).

My prediction: the gap is still under six months on the next Epoch update, if they publish one by 30 June 2027. It is wrong if the gap is over six months on that update. Epoch's own text says the four-month figure is an average, and that the gap differs by task.

## What I will check

- **By 30 June 2027:** the next Epoch open-weight gap figure. Prediction: under six months.
- **By 31 December 2027:** the next Stack Overflow survey after 2025. Prediction: Rust above 14.8% for all respondents. Wrong if equal or lower.
- **By 31 December 2027:** the next Octoverse report. Prediction: Python still leads AI repositories. Wrong if another language does.
- **By 24 October 2027:** WordCraft's README. Prediction: still labelled alpha. Wrong if it is not.
- **By 24 October 2027:** the license of the StoryTold repos. Prediction: still MIT or Apache-2.0. Wrong if any changes.

## Sources

All read 2026-10-24. The GitHub API figures were read that day and will change.

- [storytold organization repositories](https://api.github.com/orgs/storytold/repos)
- [WordCraft README](https://github.com/storytold/wordcraft)
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/technology)
- [Stack Overflow Developer Survey 2024](https://survey.stackoverflow.co/2024/technology)
- [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
- [Epoch AI, open vs closed gap](https://epoch.ai/data-insights/open-closed-eci-gap)
- [HashiCorp, Business Source License](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [Redis, AGPLv3](https://redis.io/blog/agplv3/)
- [Elastic, open source again](https://www.elastic.co/blog/elasticsearch-is-open-source-again)
