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

This is the first post in a series I'm calling Predictions. Each post writes down a prediction or an idea, puts a date on it, and spells out how I'll check it later. Everything in the series uses the `Predictions` tag, and I'll label predictions as predictions and opinions as opinions.

<!-- owner:confirm The original said this first one "is a look back"; the rewrite says it "starts with a look back" because the post also makes forward predictions. Is that change OK? -->

This first one starts with a look back before making a few calls on what comes next.

## What I thought would happen

<!-- owner:fact When did you first have the open-source rewrite idea, and which software was it? The post only says "some of the software I use". -->

I had been thinking about building open-source versions of some of the software I use, though it stayed an idea and I never got to a first version.

## What happened instead

A GitHub organization called StoryTold showed up with a set of open-source Rust apps, several of them described as clean-room rewrites of commercial software: WordCraft for Microsoft Word, DeckCraft for PowerPoint, GridCraft for Excel-style spreadsheets, SoundCraft for Pro Tools and CADCraft for AutoCAD-style drafting ([storytold repos](https://github.com/storytold)).

<!-- owner:fact PhotoCraft (72,393 stars) is cited but is not in the list of rewrites above. What does PhotoCraft rewrite, if you know? -->

According to the [GitHub API](https://api.github.com/orgs/storytold/repos), the first app repositories were created on 30 September 2026, followed by the Word, PowerPoint, spreadsheet and audio apps on 7 October 2026. When I checked the API on 24 October, PhotoCraft had 72,393 stars. The [WordCraft README](https://github.com/storytold/wordcraft) lists it as alpha, dual-licensed under MIT or Apache-2.0, and "built from public specifications and observation".

I don't know how close any of this is to what I would have built, and I'm certainly not claiming it came from my idea.

## Why I'm not shipping open source myself

Right now my full-time job and the agreements that come with it keep me from publishing open-source software.

## What I got right so far, and what I'm not sure about

<!-- owner:fact When and where did you predict that Rust would become a preferred language for AI? A date or a link would make the retrospective checkable. -->

I also predicted that Rust would become a preferred language for AI, which looks partly right so far.

Several major AI developer tools are written in Rust: uv has 91,122 stars ([GitHub API](https://api.github.com/repos/astral-sh/uv)), Ruff has 50,264, and Hugging Face's [tokenizers](https://github.com/huggingface/tokenizers) and [candle](https://github.com/huggingface/candle) ML framework are Rust too. On the Stack Overflow survey, Rust grew from 12.6% of respondents in [2024](https://survey.stackoverflow.co/2024/technology) to 14.8% in [2025](https://survey.stackoverflow.co/2025/technology).

Even so, Python is still the default for actual AI code, used by 57.9% of respondents in the 2025 survey. GitHub's [Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) report says Python dominates AI projects and powers nearly half of all new AI repositories, 582,196 of them, up 50.7% year on year. The big inference servers aren't Rust either: [vLLM](https://github.com/vllm-project/vllm) is primarily Python, [llama.cpp](https://github.com/ggml-org/llama.cpp) is primarily C++ and [Ollama](https://github.com/ollama/ollama) is primarily Go.

In my opinion, Rust has landed well for the tooling and infrastructure around AI, though it doesn't look like the preferred language for most AI code yet. The Rust rewrite idea is in a similar bucket: StoryTold matches the thesis, yet one organization isn't enough to call a broader trend.

## What I think comes next

As a forward prediction, I think more open-source projects will pick licenses that keep the code open while making most of their money from enterprise customers.

Licensing has been shifting around for a while. [HashiCorp](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license) announced its move to the Business Source License 1.1 on 10 August 2023, and the community fork OpenTofu appeared on GitHub six days later on 16 August 2023 under MPL-2.0 ([GitHub API](https://api.github.com/repos/opentofu/opentofu)). [Redis](https://redis.io/blog/agplv3/) switched to SSPL in March 2024, then added AGPLv3 as an option with Redis 8 on 1 May 2025. [Elastic](https://www.elastic.co/blog/elasticsearch-is-open-source-again) announced AGPL as an extra option alongside its existing licenses on 29 August 2024.

None of those announcements includes revenue figures and I don't have revenue data, so the enterprise-income part is my guess. I'll count this prediction wrong if the next few years move back toward permissive licenses without enterprise revenue showing up for the projects that switched.

## Open-weight models

Open-weight models have been closing in on closed frontier models. On 29 May 2026, [Epoch AI](https://epoch.ai/data-insights/open-closed-eci-gap) reported that since January 2026 open-weight models had trailed frontier closed models by roughly four months on its Epoch Capabilities Index, an average gap of 8 points. Epoch notes that four months is an average and varies by task.

My prediction is that the gap stays under six months in Epoch's next update, assuming they publish one by 30 June 2027. If that update puts the gap over six months, I'm wrong.

## What I will check

- By 30 June 2027, check Epoch's next open-weight gap figure (prediction: under six months).
- By 31 December 2027, check the next Stack Overflow survey after 2025 (prediction: Rust above 14.8% across all respondents; wrong if equal or lower).
- By 31 December 2027, check the next Octoverse report (prediction: Python still leads AI repositories; wrong if another language takes the lead).
- By 24 October 2027, check WordCraft's README (prediction: still labelled alpha; wrong if it isn't).
- By 24 October 2027, check the StoryTold repo licenses (prediction: still MIT or Apache-2.0; wrong if any change).

## Sources

All read 2026-10-24. The GitHub API numbers were checked that day and will move over time.

- [storytold organization repositories](https://api.github.com/orgs/storytold/repos)
- [WordCraft README](https://github.com/storytold/wordcraft)
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/technology)
- [Stack Overflow Developer Survey 2024](https://survey.stackoverflow.co/2024/technology)
- [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
- [Epoch AI, open vs closed gap](https://epoch.ai/data-insights/open-closed-eci-gap)
- [HashiCorp, Business Source License](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [Redis, AGPLv3](https://redis.io/blog/agplv3/)
- [Elastic, open source again](https://www.elastic.co/blog/elasticsearch-is-open-source-again)
