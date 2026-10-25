---
title: "Predictions #1: the open-source clone I did not write"
published: 2026-10-24
description: "The first post in a series of predictions: an idea I never built, a project that built something close to it, and dated checks on what comes next."
thumbnail: ./thumb.webp
tags: [Predictions, Open Source, Rust, Opinion]
category: Thoughts
draft: false
---

<!-- owner:scene Why start a Predictions series now? The opening says what the series is, not what made you start it. -->

This is the first post in a series I'm calling Predictions. Each one states a prediction or an idea, dates it, and says how I'll check it later. Every post in the series gets the `Predictions` tag, and I mark predictions as predictions and opinions as opinions.

<!-- owner:confirm The original said this first one "is a look back"; the rewrite says it "starts with a look back" because the post also makes forward predictions. Is that change OK? -->

This first one starts with a look back.

## What I thought would happen

<!-- owner:fact When did you first have the open-source rewrite idea, and which software was it? The post only says "some of the software I use". -->

I thought about writing open-source versions of some of the software I use. It stayed a thought, and I never got to a first version.

## What happened instead

A project called StoryTold came out. It's a GitHub organization of open-source Rust apps, and several are described as clean-room rewrites of commercial programs: WordCraft for Microsoft Word, DeckCraft for PowerPoint, GridCraft for Excel-style spreadsheets, SoundCraft for Pro Tools and CADCraft for AutoCAD-style drafting ([storytold repos](https://github.com/storytold)).

<!-- owner:fact PhotoCraft (72,393 stars) is cited but is not in the list of rewrites above. What does PhotoCraft rewrite, if you know? -->

The first app repositories were created on 30 September 2026, and the Word, PowerPoint, spreadsheet and audio apps on 7 October 2026 ([GitHub API](https://api.github.com/orgs/storytold/repos)). When I read the API on 24 October, PhotoCraft had 72,393 stars. The [WordCraft README](https://github.com/storytold/wordcraft) says it is in alpha, dual-licensed under MIT or Apache-2.0, and "built from public specifications and observation".

I don't know how close this is to what I had in mind, and I don't claim it came from my idea.

## Why I'm not shipping open source myself

Because of my full-time job and the agreements that come with it, I can't publish open-source software right now. That's the whole reason.

## What I got right so far, and what I'm not sure about

<!-- owner:fact When and where did you predict that Rust would become a preferred language for AI? A date or a link would make the retrospective checkable. -->

I predicted that Rust would become a preferred language for AI. I think that's partly right.

Rust is the main language of several AI tools. The uv package manager is Rust, with 91,122 stars ([GitHub API](https://api.github.com/repos/astral-sh/uv)), and so is Ruff, with 50,264. Hugging Face [tokenizers](https://github.com/huggingface/tokenizers) and the [candle](https://github.com/huggingface/candle) ML framework are Rust too. Rust went from 12.6% of respondents in the [2024 Stack Overflow survey](https://survey.stackoverflow.co/2024/technology) to 14.8% in [2025](https://survey.stackoverflow.co/2025/technology).

But Python is still the default for AI code. It was used by 57.9% of respondents in the 2025 survey. GitHub's [Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) report says Python dominates AI projects and now powers nearly half of all new AI repositories, 582,196 of them, up 50.7% year on year. The big inference servers aren't Rust either: [vLLM](https://github.com/vllm-project/vllm) is primarily Python, [llama.cpp](https://github.com/ggml-org/llama.cpp) is primarily C++ and [Ollama](https://github.com/ollama/ollama) is primarily Go.

My opinion: Rust looks like a good fit for the tools and infrastructure around AI. It doesn't look like the preferred language for most AI code yet.

The rewrites part is the same kind of guess. StoryTold is a wave of Rust rewrites and it fits the idea, but one project doesn't show a trend.

## What I think comes next

This one is a prediction. I think more open-source projects will use licenses that keep the code open but get most of their revenue from enterprise customers.

The license question is still moving: [HashiCorp](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license) moved its products to the Business Source License 1.1, announced 10 August 2023. A community fork called OpenTofu was created on GitHub on 16 August 2023 under MPL-2.0 ([GitHub API](https://api.github.com/repos/opentofu/opentofu)). [Redis](https://redis.io/blog/agplv3/) moved to SSPL in March 2024, then added AGPLv3 as an option with Redis 8, published 1 May 2025. [Elastic](https://www.elastic.co/blog/elasticsearch-is-open-source-again) added AGPL as another option next to its existing licenses, announced 29 August 2024.

None of those changes shows revenue, and I have no revenue numbers, so the enterprise part is my guess. I'd be wrong if the next few years bring more permissive licenses and no enterprise income for the projects that changed.

## More predictions in this series

Open-weight models are getting closer to the closed ones. In a piece published 29 May 2026, [Epoch AI](https://epoch.ai/data-insights/open-closed-eci-gap) found that since January 2026, open-weight models had trailed the frontier closed models by about four months on its Epoch Capabilities Index. The average gap was 8 points.

My prediction: the gap is still under six months on the next Epoch update, if they publish one by 30 June 2027. It's wrong if the gap is over six months on that update. Epoch's own text says the four-month figure is an average, and that the gap differs by task.

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
