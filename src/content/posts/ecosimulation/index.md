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

I built a model of the AI economy and let it run. It's a network of companies and countries where every payment has a payer and a payee. So the cash is conserved, and the accounting identities get checked every tick. I drew 50,000 paths from one fixed seed and put 10,000 of them on a page. The data is cut at 2026-10-17.

On the [experiment page](/playground/ecosimulation/) you pick a driver state and watch six series re-fan across five years: GDP growth, unemployment, the S&P 500, high-yield credit spreads, big-4 AI capex and direct AI revenue. The fuller [report](/research/ai-economy/) has the live engine and the source facts.

## What the paths show

The median path is a slow fade, not a crash. A US recession shows up in 9% of paths within six months, 23% within a year, 43% within two years and 80% within five. A 30% drop in the S&P 500 is a 1% event at one year, 11% at two and 42% over five years.

These are shares of simulated paths, not forecasts. The seed is 20261017, so a re-run gives the same numbers.

## The bill

<!-- owner:fact The disclosed 2026 figures (760bn big-4 capex guidance, 152bn direct AI revenue) have no source link. Link them, or point to the report as the source? -->

The bill is the part that matters. In the first simulated year the four biggest spenders put \$748bn into AI capex against \$243bn of direct AI revenue. That is a big gap between spend and directly measured revenue. The disclosed 2026 figures point the same way: \$760bn of big-4 capex guidance against \$152bn of disclosed direct AI revenue. Of \$970bn of total AI capex, the model puts 42% outside the US.

<!-- owner:scene "The gap is the number I keep checking." Is there a reaction behind it (surprised, worried, sceptical)? Only if you want to say it. -->

The model conserves cash, so that outlay has to clear somewhere. The gap is the number I keep checking.

## How to use the page

There are two ways to ask the model a question. "Condition" filters the 10,000 exported paths and runs in the browser. "Intervene" re-runs the engine with a state forced, drawing 5,000 fresh paths in a Web Worker. Re-simulated paths are labelled as an intervention and never replace the headline.

Driver states are things like how fast capability improves, whether policy blocks open-weight models, or whether power is the bottleneck. Change one and the fans recompute.

## What I don't trust yet

The revenue and capex series rest on a few disclosed figures, and I haven't tested the model against an actual cycle. The bands map the model's own uncertainty, not the probability that the world will do this.
