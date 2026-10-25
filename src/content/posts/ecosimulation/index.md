---
title: I ran 50,000 paths through a model of the AI economy
published: 2026-10-24
description: "A stock-flow-consistent model of the AI economy, run 50,000 times. The page lets you condition it on a driver state and watch six series re-fan."
tags: [Experiment, AI, Simulation]
category: Experiment
thumbnail: ./thumb.webp
draft: true
---

I built a model of the AI economy and let it run. It is a network of companies and countries where every payment has a payer and a payee, so the cash is conserved and the accounting identities are checked every tick. I drew 50,000 paths from one fixed seed and exported 10,000 of them to a page. The data is cut at 2026-10-17.

The [experiment page](/experiments/ecosimulation/) lets you pick a driver state and watch six series re-fan across five years: GDP growth, unemployment, the S&P 500, high-yield credit spreads, big-4 AI capex, and direct AI revenue. There is a fuller [report](/research/ai-economy/) with the live engine and the source facts.

## What the paths show

In these paths, a US recession appears in 9% of cases within six months, 23% within a year, 43% within two years, and 80% within five. The median path is a slow fade, not a crash. A 30% drop in the S&P 500 is a 1% event at one year, 11% at two, and 42% over five years.

These are shares of simulated paths, not forecasts. The seed is 20261017, so a re-run reproduces the same numbers.

## The bill

The part that matters is the bill. In the first simulated year, the four biggest spenders put \$748bn into AI capex against \$243bn of direct AI revenue. That is a large gap between what they spend and the revenue that is directly measured. The disclosed 2026 figures point the same way: \$760bn of big-4 capex guidance against \$152bn of disclosed direct AI revenue. Of \$970bn of total AI capex, the model puts 42% outside the US.

Because the model conserves cash, that outlay has to clear somewhere. The gap is the number I keep checking.

## How to use the page

Two ways to ask the model a question. "Condition" filters the 10,000 exported paths and runs in the browser. "Intervene" re-runs the engine with a state forced, drawing 5,000 fresh paths in a Web Worker. Re-simulated paths never replace the headline; they are labelled as an intervention.

You can set driver states like how fast capability improves, whether open-weight models get blocked by policy, or whether power is the bottleneck. The fans recompute as you change them.

## What I don't trust yet

The revenue and capex series rest on a small number of disclosed figures, and I have not tested the model against an actual cycle. The bands map the model's own uncertainty, not the probability the world will do this.
