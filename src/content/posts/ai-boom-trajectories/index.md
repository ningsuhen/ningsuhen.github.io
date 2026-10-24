---
title: "Simulating an AI investment boom: first results"
published: 2026-10-24
description: "Eight observations from my simulation of the US economy with an AI investment boom in it. It is a model, not a forecast."
tags: [AI, Simulation, Economics, Research]
category: Research
thumbnail: ./thumb.webp
draft: false
---

I built a simulation of the US economy with an AI investment boom in it. It is a stock-flow-consistent model. I ran 50,000 simulated paths, where a path is one run of the model from 2026Q3 to 2031Q3. I exported 10,000 of them. The full report is at [/research/ai-economy/](/research/ai-economy/). Data is as of 2026-10-17.

This is not a forecast. The model has not been backtested, and it has not been checked against out-of-sample history. The last section lists what I don't trust yet.

## What I saw

The headline odds, from the report:

![Headline odds from the report: recession, S&P 500 drawdown, OpenAI distress and big-4 AI capex decline at 6, 12, 24 and 60 months](./headline-odds.webp)

Each number is the share of the exported paths where the event starts by that point.

**1. In the model, a recession within five years is more likely than not.**
Recession odds in any quarter are 9% at 6 months, 23% at 12 months, 43% at 24 months and 80% at 60 months. Over 20 quarters, the model's long run is about 80%. Under the same rule, history from 1953 to 2026 gives 74.9%. The rule is two negative quarters or a jump in unemployment. So the model runs a few points above history on this measure.

**2. The AI boom is not the biggest lever.**
For entering a recession, a flatter yield curve adds about 8 points. The report gives the AI boom 4.3 points in its chart and about 5 in its text.

For the 24-month odds, the baseline is 43%. The biggest drivers are not AI. I set each parameter to its low and high bound, one at a time. The top three were baseline recession risk (29% to 69%), how strongly credit spreads raise recession risk (29% to 68%) and recession-risk calibration (35% to 54%). The answer depends more on my assumptions than on the boom.

**3. The model sits below the markets.**
For a recession by the end of 2027, the model gives 17.9%. Polymarket gives 34.5%. For the NY Fed's 12-month probit, the model gives 9.6% and the NY Fed gives 12.8%. Each comparison uses the model rule that matches the market's contract. The model is 3 to 17 points below every venue with a matching rule. I don't know yet whether I am missing something or the markets price something I am not.

**4. The AI side.**
Big-4 AI capex declines in 32% of paths by 24 months and 86% by 60 months. OpenAI distress is 11% at 24 months and 49% at 60 months. Anthropic is 2% and 17%. An S&P 500 drawdown of 30% or more is 11% at 24 months and 42% at 60 months.

**5. The money is a lot more than the revenue.**
The report counts \$1,113.6B committed through binding deals, excluding \$118B of contingent guarantees. It lists another \$975B as announced and does not count it. Big-4 2026 capex guidance is \$760bn. Disclosed direct AI revenue is \$152bn. I found 5 committed round-trip loops, with \$55B circulating on committed legs. That is round-trip exposure, not an accusation. The deals I found so far, one lane per company:

![Timeline of AI deals, one lane per company, colored by deal type, width showing cash committed](./deal-flow.webp)

**6. Bubble indicators: stretched level, calm momentum.**
Four of five bubble indicators are above their 90th historical percentile. CAPE is 40.6x. Credit spreads are tight. The report reads the level as stretched and the momentum as calm. The gauge reads Alert at 98.4 for October 2026, which the report links to its full-bust cluster. The stress it finds sits in three AI-exposed names, CoreWeave, SoftBank and Oracle, not across the market.

**7. Four clusters of paths.**
The 10,000 exported paths group into four clusters. Each one is a story the model keeps telling. The shares below are shares of paths.

- **The build that still breaks, 49%.** The AI succeeds, but the build is financed so hard that a recession is the most common outcome.
- **The credit stretch, 29%.** Credit stretches and the labs go public, but the economy holds.
- **The AI disappointment, 15%.** The payoff disappoints. Capex cools, both labs are distressed, and a rescue is likely.
- **The full bust, 7%.** Creative work is displaced, the AI index halves and the credit complex unwinds together.

These are the fan charts for GDP growth, unemployment, the S&P 500 and high-yield spreads across the exported paths:

![Fan charts of GDP growth, unemployment, S&P 500 and high-yield spread across the exported paths from 2026Q3 to 2031Q3](./fan-charts.webp)

**8. Not all of it stays in the US.**
Of \$970bn of AI capex, 42% leaks out of the US in the model. Taiwan is the most exposed.

## What I don't trust yet

- No backtest. The stationary-moment gate is the closest check I have.
- At 60 months, 23.5% of paths run unemployment below the 1971-2019 low. I reported it. I have not fixed it yet.
- Some bubble indicators are shown but not counted. The AI index bubble test is unvalidated.
- Many parameters are my judgment, not data. Changing the method moved the numbers. The 12-month recession odds went from 29% to 19% between an earlier draft and the regenerated run.

If you want to poke at it, [open the report](/research/ai-economy/) and change the conditions yourself. If you find something wrong, tell me.
