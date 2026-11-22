---
title: I ran 50,000 paths through a model of the AI economy
published: 2026-10-24
description: "A stock-flow-consistent model of the AI economy, run 50,000 times. The page lets you condition it on a driver state and watch six series re-fan."
tags: [Playground, AI, Simulation]
category: Playground
thumbnail: ./thumb.webp
draft: true
---

<!-- owner:scene Why did you build the model? The post opens with "I built a model of the AI economy and let it run" and no reason. -->

I built a model of the AI economy and let it run. It represents companies and countries as a network where every payment has a payer and a payee, so cash stays conserved and the accounting identities get checked on every tick. I drew 50,000 paths from one fixed seed and put 10,000 of them on a page, using data cut at 2026-10-17.

On the [experiment page](/playground/ecosimulation/) you can pick a driver state and watch six series re-fan over five years: GDP growth, unemployment, the S&P 500, high-yield credit spreads, big-4 AI capex and direct AI revenue. The fuller [report](/research/ai-economy/) has the live engine and the source data.

## What the paths show

The median path fades gradually rather than crashing all at once. A US recession shows up in 9% of paths within six months, 23% within a year, 43% within two years and 80% within five. A 30% drop in the S&P 500 happens in 1% of paths at one year, 11% at two and 42% over five years.

Keep in mind these are shares of simulated paths from a fixed seed (`20261017`), so re-running gives the exact same numbers, and they shouldn't be read as a forecast.

## The bill

<!-- owner:fact The disclosed 2026 figures (760bn big-4 capex guidance, 152bn direct AI revenue) have no source link. Link them, or point to the report as the source? -->

In the first simulated year, the four biggest spenders put \$748bn into AI capex against \$243bn of direct AI revenue, leaving a wide gap between spend and directly measured revenue. Disclosed 2026 figures look similar: \$760bn in big-4 capex guidance against \$152bn of disclosed direct AI revenue. Out of \$970bn of total AI capex, the model sends 42% outside the US.

<!-- owner:scene "The gap is the number I keep checking." Is there a reaction behind it (surprised, worried, sceptical)? Only if you want to say it. -->

Because the model conserves cash, all that spending has to clear somewhere, so that gap is the number I keep checking.

## How to use the page

You can query the model in two ways. "Condition" filters the 10,000 exported paths right in the browser, while "Intervene" forces a state and re-runs the engine to draw 5,000 fresh paths in a Web Worker. Re-simulated paths are marked as an intervention so they never overwrite the baseline.

Driver states cover things like how fast capability improves, whether policy blocks open-weight models, or whether power becomes the bottleneck. Change one and the fan charts update.

## What I don't trust yet

The revenue and capex series rely on a small set of disclosed figures, and I haven't tested the model against an actual economic cycle. The bands only show the model's internal uncertainty rather than real-world odds.
